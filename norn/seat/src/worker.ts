// Norn's cost engineer seat on the live stack (#162): a long-running process that chases the missing
// inputs of every open ECR whose cost check is current. It asks the person who owns each number on
// the ECR, reads their reply, records it as a given assumption (the module then re-checks the ECR),
// and reminds and escalates when nobody answers. It keeps no state of its own: the questions, replies
// and reminders are the ECR's comments, so a restart picks up where the conversation is.
//
//   npm run seat -w @norn/seat                       # from norn/: watch the database NORN_DB (default norn)
//   npm run seat -w @norn/seat -- --dry-run --once   # print what it would write, write nothing
//   npm run seat -w @norn/seat -- --demo-clock +25h  # DEMO CLOCK: treat now as 25 hours later (reminders and escalations fire early)
//   npm run seat -w @norn/seat -- --ecr ECR-0417     # only this ECR (repeatable)
//
// One identity, "Norn · Product Cost Engineer" (an agent of origin norn). It holds no job scope on
// purpose: the scoped gate refuses an agent a `given` assumption, and a person's answer is exactly that.
// The module's company gate still decides every call it makes.
import { parseArgs } from 'node:util';
import { bowman } from '../../../bowman/data/index.ts';
import { costEngineerSeat as seat } from '../../../bowman/norn-config/seats/cost-engineer.ts';
import { classify, connect, subscribe } from '../../workers/src/connect.ts';
import { chase, parseOffset } from './chase.ts';
import { recordNote } from './calls.ts';
import { gapsFromDetail, type StoredComment } from './state.ts';
import { SEAT_DISPLAY_PREFIX, anchorFor, parseAnchor } from './thread.ts';
import type { Person } from './types.ts';

const USAGE = `Usage: npm run seat -w @norn/seat -- [--dry-run] [--once] [--ecr ECR-0417] [--demo-clock +25h] [--poll 15]`;
const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false }, once: { type: 'boolean', default: false }, ecr: { type: 'string', multiple: true }, 'demo-clock': { type: 'string' }, poll: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  strict: true,
});
if (values.help) { console.log(USAGE); process.exit(0); }
const DRY = values['dry-run']!;
const ONCE = values.once!;
const OFFSET = values['demo-clock'] ? parseOffset(values['demo-clock']) : 0;
const CLOCK_LABEL = values['demo-clock'] ? `DEMO CLOCK ${values['demo-clock']}` : undefined;
const POLL_MS = Number(values.poll ?? 15) * 1000;
const ONLY = new Set(values.ecr ?? []);

const NAME = `${SEAT_DISPLAY_PREFIX}${seat.title}`;
const dbName = process.env.NORN_DB ?? 'norn';
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${NAME}]${CLOCK_LABEL ? ` [${CLOCK_LABEL}]` : ''} ${m}`);
const die = (m: string): never => { process.stderr.write(`${m}\n`); process.exit(1); };

const people: Person[] = bowman.people.map((p) => ({ id: p.id, name: p.name, title: p.title, seat: p.seat, programs: (p as { programs?: string[] }).programs }));

const reach = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer from SpacetimeDB at ${process.env.NORN_URI ?? 'ws://127.0.0.1:3000'} for database '${dbName}' after 20 s`)), 20_000))]);
const client = await reach(connect({ kind: 'agent', name: NAME, origin: 'norn', spawnedBy: 'Norn' })).catch((e) => die(`The seat cannot start: ${(e as Error).message}. Is SpacetimeDB running and the database published (npm run db:start, db:publish)?`));
const db = client.conn.db;
const me = client.identity.toHexString();
await subscribe(client.conn, [
  'SELECT * FROM pull_request', 'SELECT * FROM check_run', 'SELECT * FROM check_result', 'SELECT * FROM assumption', 'SELECT * FROM comment', 'SELECT * FROM principal',
]);

type Pr = NonNullable<ReturnType<typeof db.pullRequest.id.find>>;
const OPEN = new Set(['draft', 'review']); // recording an answer on an approved ECR would withdraw its approval
const iso = (t: { toDate(): Date }) => t.toDate().toISOString();
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const inFlight = new Set<string>();

/** The newest finished cost run, its detail row and its one-time total. Null while a newer run is still computing or none exists. */
function costRunOf(pr: Pr) {
  const runs = [...db.checkRun.prId.filter(pr.id)].filter((r) => r.stage === 's2_cost').sort((a, b) => Number(a.id - b.id));
  const last = runs[runs.length - 1];
  if (!last || last.status !== 'done') return null; // queued, running or stale: the numbers are about to change
  const rows = [...db.checkResult.checkRunId.filter(last.id)];
  const detail = rows.find((r) => r.key === 'detail');
  return { run: last, runs, detail: detail?.detailJson ?? null, mock: rows.some((r) => r.mock) };
}
const oneTime = (runId: bigint): number | null => [...db.checkResult.checkRunId.filter(runId)].find((r) => r.key === 'one_time_total')?.p50 ?? null;

function commentsOf(pr: Pr): StoredComment[] {
  const names = new Map([...db.principal.iter()].map((p) => [p.identity.toHexString(), p.name]));
  return [...db.comment.prId.filter(pr.id)].map((c) => ({ id: Number(c.id), author: c.author.toHexString(), anchor: c.anchor, body: c.body, at: iso(c.createdAt), authorName: names.get(c.author.toHexString()) }));
}

async function comment(prId: bigint, anchor: string, body: string, why: string) {
  inFlight.add(anchor);
  if (DRY) return log(`DRY RUN, would comment (${why}): ${anchor}\n    ${body}`);
  try {
    await client.R.addComment({ prId, anchor, body });
    log(`${why}`);
  } catch (e) {
    inFlight.delete(anchor);
    log(`could not comment (${why}): ${classify(e).message}`);
  }
}

async function look(pr: Pr) {
  if (!OPEN.has(pr.status) || (ONLY.size && !ONLY.has(pr.plmEcrNumber))) return;
  const cr = costRunOf(pr);
  if (!cr) return;
  if (cr.mock || !cr.detail) return void log(`${pr.plmEcrNumber}: the cost run is ${cr.mock ? 'mock compute' : 'missing its detail row'}; nothing to chase`);
  const ecr = bowman.ecrs.find((e) => e.id === pr.plmEcrNumber);
  const originator = people.find((p) => p.id === ecr?.originator);
  if (!ecr || !originator) return void log(`${pr.plmEcrNumber}: not in the company's people data, so nobody to ask`);

  const comments = commentsOf(pr);
  const current = [...db.assumption.prId.filter(pr.id)].filter((a) => a.current);
  const live = new Set(comments.map((c) => c.anchor));
  for (const a of [...inFlight]) if (live.has(a)) inFlight.delete(a);
  const now = new Date(Date.now() + OFFSET).toISOString();
  const { calls } = chase(seat, people, {
    prId: pr.id, ecr: pr.plmEcrNumber, program: ecr.program, originator, gaps: gapsFromDetail(seat, cr.detail), comments,
    givenKeys: current.filter((a) => a.source === 'given').map((a) => a.key),
    revisions: Object.fromEntries(current.map((a) => [a.key, a.rev])), inFlight, demoClock: values['demo-clock'],
  }, now);

  for (const { call } of calls) {
    if (call.reducer === 'add_comment') await comment(call.args.prId, call.args.anchor, call.args.body, `${pr.plmEcrNumber}: ${call.label}`);
    else if (DRY) log(`DRY RUN, would record_assumption (${call.label}): ${JSON.stringify({ ...call.args, prId: String(call.args.prId) })}`);
    else {
      try {
        await client.R.recordAssumption(call.args);
        log(`${pr.plmEcrNumber}: ${call.label} (given, rev ${call.args.expectedRev + 1}); the module re-checks the ECR`);
      } catch (e) {
        log(`${pr.plmEcrNumber}: could not ${call.label}: ${classify(e).message}`);
      }
    }
  }
  await notes(pr, cr, comments, current);
}

/** After an answer is recorded and the checks have re-run on it: one note on the ECR with the new figure. */
async function notes(pr: Pr, cr: NonNullable<ReturnType<typeof costRunOf>>, comments: StoredComment[], current: NonNullable<ReturnType<typeof db.assumption.id.find>>[]) {
  const noted = new Set(comments.map((c) => parseAnchor(c.anchor)).filter((a) => a?.kind === 'record').map((a) => a!.inputId));
  const gaps = gapsFromDetail(seat, cr.detail!);
  for (const a of current) {
    if (a.source !== 'given' || a.createdBy.toHexString() !== me || noted.has(a.key)) continue;
    const reply = [...comments].reverse().find((c) => parseAnchor(c.anchor)?.kind === 'reply' && parseAnchor(c.anchor)!.inputId === a.key);
    const who = people.find((p) => p.id === parseAnchor(reply?.anchor ?? '')?.personId);
    if (!who || cr.run.createdAt.toDate() < a.createdAt.toDate()) continue; // the checks have not re-run on it yet
    const before = [...cr.runs].reverse().find((r) => r.createdAt.toDate() < a.createdAt.toDate() && oneTime(r.id) !== null);
    const label = gaps.find((g) => g.inputId === a.key)?.label ?? [...db.assumption.prId.filter(pr.id)].find((x) => x.key === a.key)?.key ?? a.key;
    const after = oneTime(cr.run.id);
    await comment(pr.id, anchorFor({ kind: 'record', inputId: a.key }), recordNote({ personName: who.name, label: seatLabel(a.key, label), before: before ? usd(oneTime(before.id)!) : null, after: after === null ? null : usd(after) }), `${pr.plmEcrNumber}: recorded-answer note for ${a.key}`);
  }
}
const seatLabel = (inputId: string, label: string) => (label === inputId ? inputId.split(':').pop()! : label);

let busy = false;
let again = false;
async function sweep() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      for (const pr of db.pullRequest.iter()) await look(pr).catch((e) => log(`${pr.plmEcrNumber}: look failed: ${(e as Error).message}`));
    } while (again);
  } finally { busy = false; }
  if (ONCE) { client.close(); process.exit(0); }
}

log(`${DRY ? 'DRY RUN, ' : ''}watching '${dbName}' for open ECRs with a current cost check${ONLY.size ? ` (only ${[...ONLY].join(', ')})` : ''}${CLOCK_LABEL ? `. ${CLOCK_LABEL}: reminders and escalations use a clock ${values['demo-clock']} ahead of the real one; their comments say so` : ''}`);
if (!ONCE) for (const t of [db.comment, db.checkRun, db.checkResult, db.assumption, db.pullRequest] as unknown as { onInsert(f: () => void): void }[]) t.onInsert(() => setTimeout(() => void sweep(), 400));
setInterval(() => void sweep(), POLL_MS);
void sweep();
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
