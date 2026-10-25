// Norn's research worker (#148): a long-running process that runs the research agent (#138) on Norn's
// live ECRs and stores what passes the guardrails as `agent_estimated` assumptions.
//
//   npm run worker -w @norn/research                       # from norn/: watch the database NORN_DB (default norn)
//   npm run worker -w @norn/research -- --dry-run --once   # research the ECRs that are due, print what it would write, write nothing to the database
//   npm run worker -w @norn/research -- --replay recordings/ecr-0417.recording.json   # offline; everything labelled RECORDED
//
// It changes nothing in the other workers. It reads the same tables they do, calls the module's existing
// `record_assumption` reducer, and the module's reconcile makes the ECR's cost run stale and queues a new
// one, which the existing worker computes (module/src/reducers.ts `recordAssumption`, core.ts `reconcile`).
//
// Two identities, so the module's policy gate holds the writes of the one that records assumptions:
//   - `norn-research-worker` (WORKER_NAME) reads, and stores the run's events (record_agent_events);
//   - `norn research agent (cost engineer)` writes assumptions and one comment per run. It is given a job
//     scope (grant_scope) of agent_estimated assumptions and comments only: the gate (module/src/scope.ts)
//     then refuses a given value, an approved ECR, and any other reducer.
// A denial returns normally from a scoped call, so each write is checked in the assumption table afterwards.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Timestamp } from 'spacetimedb';
import { bowman } from '../../../bowman/data/index.ts';
import { envFileCandidates, readEnvValue } from '../../mcp/src/env.ts';
import { Runner, jsonlFileSink, teeSink } from '../../runner/src/index.ts';
import { BaselineStore, baselineSourceFromEnv } from '../../workers/src/baseline.ts';
import { classify, connect, subscribe, withRetry, type Client } from '../../workers/src/connect.ts';
import { agentEventWriter, toInput, type AgentEventWriter } from '../../workers/src/level1/agent-events.ts';
import type { ChangeRequest } from '../../checks/src/index.ts';
import { AGENT_NAME, reviewProposals } from './guardrails.ts';
import { AgentOutputError, buildResearchJob, DEFAULT_TOKEN_ENV, parseAgentOutput } from './job.ts';
import { collectIdentifiers, type IdentifierSource } from './leak.ts';
import { brightDataFetcher } from './pages.ts';
import { loadRecording } from './recording.ts';
import type { Company } from './run.ts';
import { callResult, type AssumptionRow, type LogRow } from './live/assumptions.ts';
import { buildOutcome, commentArgs, type Outcome } from './live/outcome.ts';
import { decide, factsFor, RESEARCHABLE, ROLE, RESULT_EVENT, RESULT_SEQ, type Decision, type EventRow, type EcrFacts } from './live/plan.ts';
import { renderReplay, replayPlan } from './live/replay.ts';
import { DEFAULTS, missingForLive, settingsFromEnv, SettingsError, type Settings } from './live/settings.ts';
import { targetsFromDetail } from './live/targets.ts';

const USAGE = `Usage:
  npm run worker -w @norn/research -- [--dry-run] [--once] [--ecr ECR-0417]
  npm run worker -w @norn/research -- --replay <recording.json>

  --dry-run   do the research and print what would be written; write no assumption, comment, result or runner event to the database
  --once      handle the ECRs that are due now, then exit
  --ecr       only this ECR (repeatable); the same as NORN_RESEARCH_ECRS
  --replay    offline: run the worker's steps on a recording; reads and writes no database`;

const here = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.NORN_RESEARCH_LOG_DIR ?? join(here, '..', 'logs');
const GRANT_JOB = 'norn-research-worker';
const t0 = () => new Date().toISOString().slice(11, 23);

function die(msg: string, code = 64): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

/** The Bright Data token, from the environment or the .env files the other processes use. Never printed. */
function tokenFound(): boolean {
  if (process.env[DEFAULT_TOKEN_ENV]?.trim()) return true;
  for (const f of [process.env.ENV_FILE, ...envFileCandidates()]) {
    const v = f ? readEnvValue(f, DEFAULT_TOKEN_ENV) : undefined;
    if (v) {
      process.env[DEFAULT_TOKEN_ENV] = v;
      return true;
    }
  }
  return false;
}

function writeLocal(name: string, body: unknown) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(join(LOG_DIR, name), JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
  } catch {
    // the local copy is a convenience; the database holds the record
  }
}

async function replayMode(path: string): Promise<never> {
  const rec = await loadRecording(path);
  const plan = await replayPlan(rec, bowman as unknown as Company);
  console.log(renderReplay(rec, plan));
  process.exit(0);
}

const { values } = parseArgs({
  options: { replay: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, once: { type: 'boolean', default: false }, ecr: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } },
  strict: true,
});
if (values.help) die(USAGE, 0);
if (values.replay) await replayMode(resolve(values.replay));

// ---------------------------------------------------------------- start-up: refuse without what a run needs

let settings: Settings;
try {
  settings = settingsFromEnv();
} catch (e) {
  if (e instanceof SettingsError) die(e.message);
  throw e;
}
settings.ecrs = [...new Set([...settings.ecrs, ...(values.ecr ?? [])])];
const DRY = values['dry-run']!;
const ONCE = values.once!;

const missing = missingForLive(process.env, { exists: existsSync, home: homedir(), platform: process.platform }, tokenFound());
if (missing.length) die(`The research worker cannot start:\n${missing.map((m) => `  - ${m}`).join('\n')}`);

const name = process.env.WORKER_NAME ?? 'norn-research-worker';
const dbName = process.env.NORN_DB ?? 'norn';
const log = (m: string) => console.log(`${t0()} [${name}] ${m}`);

/** `connect` waits for ever when nothing answers (or the process just ends); say what was tried instead. */
const reach = <T>(p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer from SpacetimeDB at ${process.env.NORN_URI ?? 'ws://127.0.0.1:3000'} for database '${dbName}' after 20 s`)), 20_000)),
  ]);
const worker = await reach(connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' })).catch((e) => die(`The research worker cannot start: ${(e as Error).message}. Is SpacetimeDB running and the database published (npm run db:start, db:publish)?`, 1));
const agent: Client = DRY ? worker : await reach(connect({ kind: 'agent', name: AGENT_NAME, origin: 'norn', spawnedBy: 'Norn' }));
const agentHex = agent.identity.toHexString();
const db = worker.conn.db;

await subscribe(worker.conn, [
  'SELECT * FROM pull_request',
  'SELECT * FROM ecr_revision',
  'SELECT * FROM check_run',
  'SELECT * FROM check_result',
  'SELECT * FROM assumption',
  `SELECT * FROM agent_event WHERE role = '${ROLE}' AND event_type = 'job_started'`,
  `SELECT * FROM agent_event WHERE role = '${ROLE}' AND event_type = '${RESULT_EVENT}'`,
  // Every outcome of a record_assumption call (applied, denied, rejected): the answer to each call this worker makes is its row.
  "SELECT * FROM action_log WHERE reducer = 'record_assumption'",
]);

// ---------------------------------------------------------------- reading the cache

type Pr = NonNullable<ReturnType<typeof db.pullRequest.id.find>>;
const ms = (t: { toDate(): Date }) => t.toDate().getTime();

function factsOf(pr: Pr): EcrFacts {
  const runs = [...db.checkRun.prId.filter(pr.id)];
  const done = new Set(runs.filter((r) => r.stage === 's2_cost' && r.status === 'done').map((r) => r.id));
  return factsFor(
    pr,
    [...db.ecrRevision.prId.filter(pr.id)],
    runs,
    [...db.checkResult.prId.filter(pr.id)].filter((r) => done.has(r.checkRunId))
  );
}

const eventsOf = (): EventRow[] => [...db.agentEvent.iter()].filter((e) => e.role === ROLE).map((e) => ({ jobId: e.jobId, eventType: e.eventType, tsMs: ms(e.ts) }));
const assumptionsOf = (prId: bigint): AssumptionRow[] =>
  [...db.assumption.iter()].filter((a) => a.prId === prId).map((a) => ({ id: a.id, prId: a.prId, key: a.key, rev: a.rev, source: a.source, current: a.current, distJson: a.distJson, createdBy: a.createdBy.toHexString(), rationale: a.rationale, affects: a.affects }));
const logRowsOf = (requestId: string): LogRow[] => [...db.actionLog.requestId.filter(requestId)].map((l) => ({ id: l.id, prId: l.prId, requestId: l.requestId, reducer: l.reducer, outcome: l.outcome, entity: l.entity, summary: l.summary }));

// ---------------------------------------------------------------- the runner, the baseline cache, the grant

mkdirSync(LOG_DIR, { recursive: true });
const runIdOf = new Map<string, bigint>();
// A dry run stores nothing in the database, the runner's events included: a stored `job_started` is what the plan counts as
// a used attempt, so a dry run that stored one would leave a later live run refused ("2 attempt(s) made"). Its events go
// to a JSONL file of their own, apart from the live run's.
const writer: AgentEventWriter = DRY ? { sink: () => {}, drain: async () => true } : agentEventWriter(worker.R, (id) => runIdOf.get(id) ?? 0n, log);
const runner = new Runner({ sink: teeSink(jsonlFileSink(join(LOG_DIR, `${dbName}${DRY ? '-dry-run' : ''}-events.jsonl`)), writer.sink), config: { concurrency: 1 } });
// Baselines are read the way the worker reads them (cache by hash, else the ERP, read only). Nothing is recorded in Norn from here.
const baselines = new BaselineStore(await baselineSourceFromEnv(), async () => {});

let grantedUntil = 0;
async function ensureGrant() {
  if (grantedUntil - Date.now() > 30 * 60_000) return;
  const until = Date.now() + 2 * 3_600_000;
  // agent_estimated assumptions and comments only, on any ECR the gate lets an agent change; no impact statements (level 0).
  await agent.R.grantScope({ jobId: GRANT_JOB, anyEcr: true, prIds: [], maxLevel: 0, expiresAt: Timestamp.fromDate(new Date(until)) });
  grantedUntil = until;
}

const sleep = (n: number) => new Promise<void>((r) => setTimeout(r, n));
async function until<T>(f: () => T | undefined, ms: number): Promise<T | undefined> {
  for (const t = Date.now(); Date.now() - t < ms; ) {
    const v = f();
    if (v !== undefined) return v;
    await sleep(250);
  }
  return f();
}

// ---------------------------------------------------------------- one research run

const startedHere = new Map<string, number>();
const running = new Set<string>();
const finishedHere = new Set<string>();
const failures = new Map<string, number>();
let pausedUntil = 0;

async function researchOne(pr: Pr, d: Extract<Decision, { action: 'research' }>) {
  running.add(d.key);
  startedHere.set(d.jobId, Date.now());
  runIdOf.set(d.jobId, d.costRun.id);
  try {
    const rev = [...db.ecrRevision.prId.filter(pr.id)].find((r) => r.seq === d.seq && r.digest === d.digest);
    if (!rev) throw new Error('the change-request revision is gone from the cache');
    const cr = JSON.parse(rev.changeRequestJson) as ChangeRequest & { description?: string };
    const hash = (JSON.parse(d.costRun.inputsJson) as { erpBaseline?: string }).erpBaseline;
    if (!hash) throw new Error('the cost run names no baseline');
    const baseline = await baselines.get(hash, log);
    if (!baseline) throw new Error(`the baseline ${hash.slice(0, 12)} is no longer the ERP's; the cost run is stale and will be replaced`);
    const ids: IdentifierSource = {
      ...baseline,
      company: { name: baselines.source?.erp?.settings.company },
      suppliers: [...new Set([...baseline.sourcing.map((s) => s.supplier), ...baseline.items.map((i) => i.defaultSupplier).filter((s): s is string => !!s)])].map((id) => ({ id, name: id })),
      ecrs: [cr],
    };
    const identifiers = collectIdentifiers(ids);
    const targets = targetsFromDetail(d.costRun.detailJson!, cr, identifiers, settings.targets);
    if (!targets.length) {
      log(`${pr.plmEcrNumber} r${d.seq}: nothing the cost check assumed on its own is left to research`);
      if (DRY) {
        finishedHere.add(d.key);
        return;
      }
      // Store that as a result, so the Level 1 dispatcher (which waits for one) is not held for its whole timeout for nothing.
      const { outcome } = buildOutcome({ mode: 'LIVE', key: d.key, ecr: pr.plmEcrNumber, prId: pr.id, revision: d.seq, digest: d.digest, s2RunId: d.costRun.id, jobId: d.jobId, now: new Date().toISOString(), targets: [], agentOutput: { proposals: [], unresolved: [] }, verdicts: [], existing: [], agentHex });
      outcome.skipped = 'nothing the cost check assumed on its own is left to research';
      await store(pr, outcome);
      return;
    }

    const job = buildResearchJob(targets, { jobId: d.jobId, ecr: pr.plmEcrNumber, identifiers, onToolCall: (c) => { if (!c.allowed) log(`${d.jobId}: the tool guard refused a ${c.tool} call (it carried: ${c.kinds.join(', ') || 'nothing nameable'})`); }, maxTurns: settings.maxTurns, timeoutMs: settings.timeoutMs, ...(settings.model ? { model: settings.model } : {}) });
    log(`${d.jobId}: ${targets.length} question(s) on ${pr.plmEcrNumber} revision ${d.seq}, up to ${settings.maxTurns} turns and ${settings.timeoutMs / 1000} s`);
    const result = await runner.run(job);
    await writer.drain();
    if (result.status !== 'succeeded' || !result.result) {
      log(`${d.jobId} ${result.status}${result.error ? `: ${result.error.kind}: ${result.error.message}` : ''}`);
      if (result.error?.kind === 'usage_limit') pausedUntil = result.error.resetsAt ? Date.parse(result.error.resetsAt) || Date.now() + 30 * 60_000 : Date.now() + 30 * 60_000;
      if (result.error?.kind === 'auth' || result.error?.kind === 'account') die(`LIVE: the Claude login was rejected (${result.error.kind}); stopping. Log in again on this machine and restart.`, 1);
      return;
    }
    let output;
    try {
      output = parseAgentOutput(result.result);
    } catch (e) {
      if (e instanceof AgentOutputError) {
        log(`${d.jobId}: ${e.message}`);
        return;
      }
      throw e;
    }

    const today = new Date().toISOString().slice(0, 10);
    const verdicts = await reviewProposals(output.proposals, targets, brightDataFetcher({ today }), { today, identifiers });

    // The ECR may have moved on while the agent worked: then these numbers are for a forecast that no longer exists.
    // This look only saves the calls. What makes it safe is `expectedCrRev` on each call, which the module checks in the
    // transaction that writes the assumption: the ECR can still move between this look and the call.
    const nowPr = db.pullRequest.id.find(pr.id);
    const now = nowPr ? factsOf(nowPr) : null;
    const superseded = !now
      ? 'the ECR is gone, so these numbers were not recorded'
      : now.revision?.digest !== d.digest
        ? 'the ECR has a newer change-request revision, so these numbers were not recorded'
        : !(RESEARCHABLE as readonly string[]).includes(now.status)
          ? `the ECR is now ${now.status}, so these numbers were not recorded (changing an assumption would withdraw an approval)`
          : null;

    const { outcome, calls } = buildOutcome({
      mode: 'LIVE', key: d.key, ecr: pr.plmEcrNumber, prId: pr.id, revision: d.seq, digest: d.digest, s2RunId: d.costRun.id, jobId: d.jobId,
      sessionId: result.sessionId ?? undefined, model: result.model, now: new Date().toISOString(), targets, agentOutput: output, verdicts, existing: assumptionsOf(pr.id), agentHex,
    });
    if (superseded) {
      outcome.superseded = superseded;
      calls.length = 0;
    }

    if (DRY) {
      log(`DRY RUN: nothing written. Would record ${calls.length} assumption(s); ${outcome.proposals.filter((p) => p.status !== 'accepted').length} held or rejected.`);
      console.log(JSON.stringify({ outcome, calls: calls.map((c) => ({ ...c, args: { ...c.args, prId: String(c.args.prId) } })) }, null, 2));
      finishedHere.add(d.key);
      return;
    }

    if (calls.length) await ensureGrant();
    for (const [n, c] of calls.entries()) {
      const requestId = `${d.jobId}-w${n + 1}`;
      try {
        // The call carries the change-request revision it was researched against; the module refuses it if the ECR has moved on.
        await agent.R.recordAssumption({ ...c.args, meta: { requestId } });
      } catch (e) {
        outcome.failed.push({ targetKey: c.targetKey, key: c.args.key, why: `record_assumption failed: ${classify(e).message}` });
        continue;
      }
      // A scoped call that the gate or the module refuses returns normally. The answer is this call's own row in the action log.
      const look = (final: boolean) => callResult(c.args, requestId, logRowsOf(requestId), assumptionsOf(pr.id), agentHex, final);
      const res = (await until(() => (look(false).state === 'pending' ? undefined : look(false)), 6000)) ?? look(true);
      if (res.state === 'applied' || res.state === 'unchanged') outcome.recorded.push({ targetKey: c.targetKey, key: res.row.key, rev: res.row.rev, assumptionId: Number(res.row.id) });
      else outcome.failed.push({ targetKey: c.targetKey, key: c.args.key, why: res.state === 'refused' ? res.why : 'no outcome for this call yet; see the action log' });
    }
    log(`${d.jobId}: recorded ${outcome.recorded.length}/${calls.length} assumption(s); held ${outcome.proposals.filter((p) => p.status === 'needs_person').length}, rejected ${outcome.proposals.filter((p) => p.status === 'rejected').length}${outcome.failed.length ? `, FAILED ${outcome.failed.length}` : ''}`);

    await store(pr, outcome);
  } catch (e) {
    failures.set(d.key, (failures.get(d.key) ?? 0) + 1);
    log(`${d.jobId} stopped: ${(e as Error).message}`);
  } finally {
    setTimeout(() => (running.delete(d.key), schedule()), 15_000);
  }
}

/** The comment for the people on the ECR, then the full record under the run's job id (this is what makes a restart start nothing twice). */
async function store(pr: Pr, outcome: Outcome) {
  writeLocal(`${outcome.jobId}.result.json`, outcome);
  finishedHere.add(outcome.key);
  const comment = commentArgs(outcome, pr.id);
  if (comment) {
    try {
      await ensureGrant();
      await agent.R.addComment(comment);
    } catch (e) {
      log(`could not post the comment on ${outcome.ecr}: ${classify(e).message} (the record is in the result event and ${join(LOG_DIR, `${outcome.jobId}.result.json`)})`);
    }
  }
  try {
    const input = toInput({ ...outcome, seq: RESULT_SEQ, ts: new Date().toISOString(), jobId: outcome.jobId, role: ROLE, identity: { actor: `agent:norn/research/${outcome.ecr}`, onBehalfOf: null, spawnedBy: 'norn' }, sessionId: outcome.sessionId ?? undefined, type: RESULT_EVENT } as never);
    await withRetry(() => worker.R.recordAgentEvents({ checkRunId: BigInt(outcome.s2RunId), events: [input] }), { idempotent: true, label: 'record_agent_events' });
  } catch (e) {
    log(`COULD NOT STORE the result of ${outcome.jobId}: ${classify(e).message}. This revision may be researched again after a restart. The record is in ${join(LOG_DIR, `${outcome.jobId}.result.json`)}`);
  }
}

// ---------------------------------------------------------------- the look

let sweeping = false;
let again = false;
let timer: NodeJS.Timeout | undefined;
let wake: NodeJS.Timeout | undefined;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void sweep(), 500);
};

async function sweep() {
  if (sweeping) {
    again = true;
    return;
  }
  sweeping = true;
  try {
    do {
      again = false;
      if (Date.now() < pausedUntil) break;
      let nextAt = Infinity;
      for (const pr of db.pullRequest.iter()) {
        const f = factsOf(pr);
        if (f.revision && finishedHere.has(`${f.number}@${f.revision.digest}`)) continue;
        if (f.revision && (failures.get(`${f.number}@${f.revision.digest}`) ?? 0) >= 3) continue; // gave up until a restart
        const d = decide(f, eventsOf(), { nowMs: Date.now(), maxPerHour: settings.maxPerHour, maxAttempts: settings.maxAttempts, retryDelayMs: settings.retryDelayMs, startedHere, running, ecrs: settings.ecrs });
        if (d.action === 'wait') nextAt = Math.min(nextAt, d.untilMs);
        if (d.action !== 'research') continue;
        await researchOne(pr, d);
        again = true; // the table changed under us; look again from the top
        break;
      }
      clearTimeout(wake);
      if (nextAt < Infinity) wake = setTimeout(schedule, Math.max(1000, nextAt - Date.now() + 500));
    } while (again);
  } catch (e) {
    log(`look failed: ${(e as Error).message}`);
  } finally {
    sweeping = false;
  }
  if (ONCE && running.size === 0) {
    await writer.drain(10_000);
    process.exit(0);
  }
}

log(`${DRY ? 'DRY RUN, ' : ''}watching '${dbName}' for ECR revisions with a finished cost check${settings.ecrs.length ? ` (only ${settings.ecrs.join(', ')})` : ''}; at most ${settings.maxPerHour} run(s) an hour, ${settings.targets} question(s), ${settings.maxTurns} turns and ${settings.timeoutMs / 1000} s each, ${settings.maxAttempts} attempt(s) per revision (defaults: ${DEFAULTS.maxPerHour}/h, ${DEFAULTS.maxTurns} turns)`);
if (baselines.source) log(`baseline source: ${baselines.source.describe}`);
else log('no baseline source (NORN_ERP_SETTINGS / NORN_BASELINE_FILE): only baselines already cached by the worker can be used');
if (!ONCE)
  for (const t of [db.checkRun, db.ecrRevision, db.agentEvent, db.pullRequest] as unknown as { onInsert(f: () => void): void; onUpdate?(f: () => void): void }[]) {
    t.onInsert(schedule);
    t.onUpdate?.(schedule);
  }
setInterval(schedule, settings.pollMs);
schedule();

const shutdown = async () => {
  log('shutting down; the run in progress, if any, is stopped by its own timeout and its events so far are stored');
  await writer.drain(5000);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
