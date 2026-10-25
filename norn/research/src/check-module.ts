// Checks against a real Norn module, for the pieces of the research worker (#148) that only the module can answer:
//
//   2. record_assumption refuses, atomically, a proposal researched against an earlier change-request revision
//      (`expectedCrRev`), and every caller that omits it behaves as before;
//   5. the worker tells a refused record_assumption call from an applied one by that call's own action-log row
//      (`callResult`), not by an older assumption row that happens to look the same;
//   1. the Level 1 dispatcher, reading the real client cache, waits for the research result of the revision
//      (`NORN_L1_WAIT_FOR_RESEARCH`), so a statement is written on the researched numbers and not the earlier ones.
//
// It plays the worker by hand (claims and completes check runs) and writes synthetic ECRs; it reads no ERP and no
// PLM, runs no model and no Bright Data. Use a scratch database that you publish yourself and delete afterwards:
//
//   spacetime publish norn-fx152-<x> --module-path module --server local --delete-data=always --yes     (from norn/)
//   NORN_DB=norn-fx152-<x> npm run check:module -w @norn/research
//   spacetime delete norn-fx152-<x> -s local -y
//
// It refuses to run on the demo and test databases.
import { Timestamp } from 'spacetimedb';
import { connect, subscribe, type Client } from '../../workers/src/connect.ts';
import { factsOf, RESEARCH_RESULTS_QUERY } from '../../workers/src/level1/dispatcher.ts';
import { toInput } from '../../workers/src/level1/agent-events.ts';
import { decide, type DecideOptions } from '../../workers/src/level1/plan.ts';
import { TABLES, kit, recorder, rejects } from '../../workers/src/testkit.ts';
import { AGENT_NAME } from './guardrails.ts';
import { callResult, type AssumptionRow, type LogRow, type RecordAssumptionArgs } from './live/assumptions.ts';
import { RESULT_EVENT, RESULT_SEQ, ROLE, jobIdFor as researchJobIdFor } from './live/plan.ts';

const DB = process.env.NORN_DB ?? '';
const PROTECTED = ['', 'norn', 'norn-test', 'norn-mcp', 'norn-live', 'norn-ui', 'norn-l1'];
if (PROTECTED.includes(DB)) throw new Error(`check:module writes ECRs and assumptions: set NORN_DB to a scratch database (norn-fx152-<x>), not '${DB || 'norn'}'`);

const { check, finish } = recorder();
const stamp = Date.now().toString(36);
const quiet = { persistToken: false, quiet: true } as const;
const A = await connect({ kind: 'agent', name: `fx152-worker-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, quiet); // plays the worker and the PLM ingest
const AG = await connect({ kind: 'agent', name: AGENT_NAME, origin: 'norn', spawnedBy: 'Norn' }, quiet); // the research agent's identity
const sessions: Client[] = []; // Level 1 sessions: a live grant cannot be handed to another job, so each one connects as its own actor
const D = await connect({ kind: 'agent', name: `fx152-dispatcher-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, quiet); // the dispatcher's cache

await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM impact_statement']);
await subscribe(AG.conn, ['SELECT * FROM assumption', 'SELECT * FROM action_log', 'SELECT * FROM pull_request']);
// Exactly the subscriptions the dispatcher makes (dispatcher.ts), with research waiting on.
await subscribe(D.conn, [
  'SELECT * FROM pull_request',
  'SELECT * FROM ecr_revision',
  'SELECT * FROM check_run',
  'SELECT * FROM check_result',
  'SELECT * FROM impact_statement',
  'SELECT * FROM norn_config',
  ...['job_queued', 'job_started', 'job_finished'].map((t) => `SELECT * FROM agent_event WHERE role = 'level1-statement' AND event_type = '${t}'`),
  RESEARCH_RESULTS_QUERY,
]);

const K = kit(A as unknown as Client);
const { until, holds, run } = K;
const db = A.conn.db;
const agentHex = AG.identity.toHexString();
const fixed = (value: number) => JSON.stringify({ kind: 'fixed', value });
const ecrNumber = (s: string) => `ECR-FX152-${stamp}-${s}`;

async function ingest(number: string, cr: Record<string, unknown> = {}) {
  await A.R.ingestEcr({ plmEcrNumber: number, title: `fx152 ${number}`, description: 'check', changeRequestJson: JSON.stringify({ id: number, ...cr }), source: 'check', sourceRef: `r${Date.now()}` });
  return until(() => [...db.pullRequest.iter()].find((p) => p.plmEcrNumber === number), 5000, `ECR ${number}`);
}
const pr = (number: string) => [...db.pullRequest.iter()].find((p) => p.plmEcrNumber === number)!;
const crRev = (prId: bigint) => [...db.ecrRevision.iter()].find((r) => r.prId === prId && r.current)!;

/** Play the worker for one stage: claim the current queued run and complete it with a real (not mock) result. */
async function complete(prId: bigint, stage: string) {
  const queued = await until(() => K.current(prId, stage)?.status === 'queued' && K.current(prId, stage)!, 5000, `${stage} to be queued`);
  await A.R.claimCheck({ checkRunId: queued.id, leaseMs: 30000 });
  const claimed = await until(() => run(queued.id).status === 'running' && run(queued.id), 5000, `${stage} to run`);
  await A.R.completeCheck({ checkRunId: queued.id, attempt: claimed.attempts, results: [{ key: 'net_total_year_one', label: 'Net total, year one', unit: 'USD', p10: 1000, p50: 2000, p90: 3000, detailJson: '{}', mock: false }] });
  await until(() => run(queued.id).status === 'done', 5000, `${stage} done`);
  return run(queued.id);
}
async function allDone(prId: bigint) {
  let s2 = null;
  for (const s of ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply']) {
    const r = await complete(prId, s);
    if (s === 's2_cost') s2 = r;
  }
  return s2!;
}

const logFor = (requestId: string) => [...db.actionLog.iter()].filter((l) => l.requestId === requestId);
const logRows = (requestId: string): LogRow[] => logFor(requestId).map((l) => ({ id: l.id, prId: l.prId, requestId: l.requestId, reducer: l.reducer, outcome: l.outcome, entity: l.entity, summary: l.summary }));
const rowsOf = (prId: bigint): AssumptionRow[] => [...db.assumption.iter()].filter((a) => a.prId === prId).map((a) => ({ id: a.id, prId: a.prId, key: a.key, rev: a.rev, source: a.source, current: a.current, distJson: a.distJson, createdBy: a.createdBy.toHexString(), rationale: a.rationale, affects: a.affects }));
const current = (prId: bigint, key: string) => rowsOf(prId).find((r) => r.key === key && r.current);

let grants = 0;
async function scope(c: Pick<typeof AG, 'R'>, jobId: string, prIds: bigint[], maxLevel: number) {
  await c.R.grantScope({ jobId, anyEcr: prIds.length === 0, prIds, maxLevel, expiresAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)) });
  grants++;
}
/** The call the research worker makes, with the arguments `toRecordAssumption` builds. */
const call = (prId: bigint, key: string, value: number, over: Partial<RecordAssumptionArgs> = {}): RecordAssumptionArgs => ({ prId, key, distJson: fixed(value), source: 'agent_estimated', rationale: 'check: research', affects: ['s2_cost'], expectedRev: 0, ...over });
async function send(args: RecordAssumptionArgs, requestId: string) {
  await AG.R.recordAssumption({ ...args, meta: { requestId } });
  await holds(() => logFor(requestId).length > 0, 2500); // a call that changes nothing leaves no row
}
/** What the worker used to conclude (research/src/live/assumptions.ts before this fix): an assumption row that matches the value, source and author. */
const oldAppliedRow = (a: RecordAssumptionArgs) => rowsOf(a.prId).find((r) => r.key === a.key && r.current && r.source === a.source && r.distJson === a.distJson && r.createdBy === agentHex);

// ==================================================================================================
// 2. A proposal researched against revision 1 is refused once the ECR is on revision 2
// ==================================================================================================
const E = await ingest(ecrNumber('A'));
await allDone(E.id);
await scope(AG, 'check-fx152', [], 0);
check('the ECR starts on change-request revision 1', crRev(E.id).seq === 1);

await ingest(ecrNumber('A'), { changed: 'yes' });
const rev2 = await until(() => crRev(E.id).seq === 2 && crRev(E.id), 5000, 'change-request revision 2');
check('...and the PLM then reports a change: revision 2 is current', rev2.seq === 2);

const stale = call(E.id, 'recovery:FX-1', 0.4, { expectedCrRev: 1 });
await send(stale, `fx-stale-${stamp}`);
const staleLog = logFor(`fx-stale-${stamp}`)[0];
check('revision-1 proposal after revision 2: refused, logged as rejected with the reason, nothing recorded', staleLog?.outcome === 'rejected' && /change-request revision 2, not 1/.test(staleLog.summary) && !current(E.id, 'recovery:FX-1'), staleLog ? `${staleLog.outcome}: ${staleLog.summary}` : 'no log row');
check('...and callResult reads it as refused, with the module\'s reason', (() => { const r = callResult(stale, `fx-stale-${stamp}`, logRows(`fx-stale-${stamp}`), rowsOf(E.id), agentHex); return r.state === 'refused' && /revision 2, not 1/.test(r.why); })());

await send(call(E.id, 'recovery:FX-1', 0.4, { expectedCrRev: 2 }), `fx-current-${stamp}`);
const okRow = current(E.id, 'recovery:FX-1');
check('the same proposal against the current revision 2: applied at revision 1 of the assumption', logFor(`fx-current-${stamp}`)[0]?.outcome === 'applied' && okRow?.rev === 1, `${logFor(`fx-current-${stamp}`)[0]?.outcome} rev ${okRow?.rev}`);

await send(call(E.id, 'recovery:FX-2', 0.3), `fx-nocr-${stamp}`);
check('a caller that gives no expectedCrRev (every caller before this change) is unchanged: applied', logFor(`fx-nocr-${stamp}`)[0]?.outcome === 'applied' && current(E.id, 'recovery:FX-2')?.rev === 1);

const unscoped = await rejects(A.R.recordAssumption({ ...call(E.id, 'recovery:FX-3', 0.3, { expectedCrRev: 1 }), meta: { requestId: `fx-unscoped-${stamp}` } }));
check('an unscoped caller with a stale expectedCrRev gets the error it always gets for a refusal, and nothing is written', !!unscoped && /change-request revision 2, not 1/.test(unscoped.message) && !current(E.id, 'recovery:FX-3'), unscoped?.message);

await send(call(0n, 'recovery:FX-9', 0.3, { expectedCrRev: 1 }), `fx-baseline-${stamp}`);
check('a scoped agent is still refused the production baseline (the gate runs first)', logFor(`fx-baseline-${stamp}`)[0]?.outcome === 'denied');

// ==================================================================================================
// 5. A refused call is not counted as applied because an older row matches
// ==================================================================================================
await send(call(E.id, 'recovery:FX-5', 0.25, { expectedCrRev: 2 }), `fx5-first-${stamp}`);
const first = callResult(call(E.id, 'recovery:FX-5', 0.25, { expectedCrRev: 2 }), `fx5-first-${stamp}`, logRows(`fx5-first-${stamp}`), rowsOf(E.id), agentHex);
check('a first call is applied (revision 1), found by its own log row', first.state === 'applied' && first.row.rev === 1, first.state);

// The same value again, but from a worker that did not see revision 1 (expectedRev 0): the module refuses it.
const again = call(E.id, 'recovery:FX-5', 0.25, { expectedCrRev: 2, rationale: 'check: a second run' });
await send(again, `fx5-refused-${stamp}`);
const refusedLog = logFor(`fx5-refused-${stamp}`)[0];
check('the second call at a stale assumption revision is refused by the module', refusedLog?.outcome === 'rejected' && /is at revision 1, not 0/.test(refusedLog.summary), refusedLog?.summary);
check('the old check (value, source, author) would have counted it as recorded', oldAppliedRow(again) !== undefined, 'this is the bug');
const refused = callResult(again, `fx5-refused-${stamp}`, logRows(`fx5-refused-${stamp}`), rowsOf(E.id), agentHex);
check('callResult reports it refused, with the module\'s reason', refused.state === 'refused' && /is at revision 1, not 0/.test(refused.why), refused.state === 'refused' ? refused.why : refused.state);

// A call that supersedes: new rationale at the right revision is applied as revision 2.
const super2 = call(E.id, 'recovery:FX-5', 0.25, { expectedCrRev: 2, expectedRev: 1, rationale: 'check: a second run, seeing revision 1' });
await send(super2, `fx5-super-${stamp}`);
const sup = callResult(super2, `fx5-super-${stamp}`, logRows(`fx5-super-${stamp}`), rowsOf(E.id), agentHex);
check('a call at the right revision with a new rationale is applied as revision 2', sup.state === 'applied' && sup.row.rev === 2, sup.state);

// A call that changes nothing leaves no log row: recognised only once the worker has waited, and only for an identical row.
const same = { ...super2, expectedRev: 2 };
await send(same, `fx5-nochange-${stamp}`);
check('a call that changes nothing leaves no log row', logFor(`fx5-nochange-${stamp}`).length === 0);
check('...so it is pending until the final look, then unconfirmed, not applied', callResult(same, `fx5-nochange-${stamp}`, [], rowsOf(E.id), agentHex).state === 'pending' && callResult(same, `fx5-nochange-${stamp}`, [], rowsOf(E.id), agentHex, true).state === 'unconfirmed');

// ==================================================================================================
// 1. Level 1 waits for the research result, then writes on the researched numbers
// ==================================================================================================
const T = (m: number) => m * 60_000;
const opts = (nowMs: number, research: boolean): DecideOptions => ({ nowMs, maxAttempts: 2, retryDelayMs: 60_000, orphanMs: 330_000, running: new Set(), ...(research ? { research: { waitMs: T(10) } } : {}) });
const factsFor = (number: string, withResearch = true) => factsOf(D.conn.db, [...D.conn.db.pullRequest.iter()].find((p) => p.plmEcrNumber === number)!, 'level1-statement', withResearch);
const finishedMs = (number: string) => factsFor(number).s2Done.at(-1)!.finishedMs!;
const dispatchOf = (number: string, nowMs: number, research: boolean) => decide(factsFor(number), opts(nowMs, research));
/** What an early Level 1 session does: post a statement from a given check run. */
async function earlyStatement(prId: bigint, runId: bigint) {
  const L1 = await connect({ kind: 'agent', name: `fx152-level1-${stamp}-${runId}`, origin: 'norn', spawnedBy: 'Norn' }, quiet);
  sessions.push(L1 as unknown as Client);
  await scope(L1, `fx152-l1-${prId}-${runId}`, [prId], 1);
  const p = [...db.pullRequest.iter()].find((x) => x.id === prId)!;
  await L1.R.postImpactStatement({
    prId, level: 1, changeClass: 'II', route: 'check', headline: 'check: a statement on the numbers read', numbers: [{ key: 'n', label: 'n', unit: 'USD', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }], drivers: [], assumptions: [], claims: [],
    meta: { requestId: `fx1-stmt-${runId}-${stamp}`, spawnedBy: `norn:check_run:${runId}:revision:${p.revision}` },
  });
}

// -- the bug, as Sol reproduced it: research off (as before), the dispatcher starts at once, research lands later
const C = await ingest(ecrNumber('C'));
const c1 = await allDone(C.id);
await until(() => factsFor(ecrNumber('C')).s2Done.length === 1, 5000, 'the dispatcher cache to see the cost run');
const c1done = finishedMs(ecrNumber('C'));
check('research off: the dispatcher starts the session as soon as the cost run is done (unchanged)', dispatchOf(ecrNumber('C'), c1done + 1000, false).action === 'dispatch');
await earlyStatement(C.id, c1.id);
const earlyLog = await until(() => logFor(`fx1-stmt-${c1.id}-${stamp}`)[0], 3000, 'the early statement in the log');
check('research off: the early session posts its statement from the first cost run', earlyLog.outcome === 'applied', `${earlyLog.outcome}: ${earlyLog.summary}`);
await send(call(C.id, 'recovery:FX-C', 0.4, { expectedCrRev: 1 }), `fx1-c-research-${stamp}`);
const c2 = await complete(C.id, 's2_cost');
await until(() => factsFor(ecrNumber('C')).s2Done.some((r) => r.id === Number(c2.id)), 5000, 'the dispatcher cache to see the second cost run');
const stuck = decide(factsFor(ecrNumber('C')), opts(finishedMs(ecrNumber('C')) + 1000, false));
check("the bug: research landed after the early statement, the cost run was redone, and the dispatcher says 'revision 1 already has a statement'", stuck.action === 'skip' && /already has a statement/.test(stuck.reason), stuck.action === 'skip' ? stuck.reason : stuck.action);

// -- the fix: research on, the dispatcher holds the first session until the research result of the revision is stored
const B = await ingest(ecrNumber('B'));
const b1 = await allDone(B.id);
await until(() => factsFor(ecrNumber('B')).s2Done.length === 1, 5000, 'the dispatcher cache to see the cost run');
const b1done = finishedMs(ecrNumber('B'));
const held = dispatchOf(ecrNumber('B'), b1done + T(1), true);
check('research on: one minute after the cost run, the session is held for research', held.action === 'skip' && /waiting for the research on revision 1/.test(held.reason), held.action === 'skip' ? held.reason : held.action);
check('...while research off would have started it', dispatchOf(ecrNumber('B'), b1done + T(1), false).action === 'dispatch');

await send(call(B.id, 'recovery:FX-B', 0.4, { expectedCrRev: 1 }), `fx1-b-research-${stamp}`);
check('research records its assumption: the first cost run goes stale', (await holds(() => run(b1.id).status === 'stale')), run(b1.id).status);
const midway = decide(factsFor(ecrNumber('B')), opts(b1done + T(2), true));
check('research on, assumptions recorded but no result stored and no new cost run: still held', midway.action === 'skip', midway.action === 'skip' ? midway.reason : midway.action);
const b2 = await complete(B.id, 's2_cost');
await until(() => factsFor(ecrNumber('B')).s2Done.some((r) => r.id === Number(b2.id)), 5000, 'the dispatcher cache to see the second cost run');
const noResult = decide(factsFor(ecrNumber('B')), opts(Number(b2.finishedAt!.toDate().getTime()) + T(1), true));
check('the new cost run is done but the research result is not stored yet: still held', noResult.action === 'skip' && /waiting for the research/.test(noResult.reason), noResult.action === 'skip' ? noResult.reason : noResult.action);

// The research worker stores its result the way worker.ts does: a research_result event under the run's job id.
const digest = crRev(B.id).digest;
const jobId = researchJobIdFor(ecrNumber('B'), 1, digest, 1);
const input = toInput({ seq: RESULT_SEQ, ts: new Date().toISOString(), jobId, role: ROLE, identity: { actor: `agent:norn/research/${ecrNumber('B')}`, onBehalfOf: null, spawnedBy: 'norn' }, type: RESULT_EVENT } as never);
await A.R.recordAgentEvents({ checkRunId: b1.id, events: [input] });
await until(() => factsFor(ecrNumber('B')).researched?.includes(1), 5000, "the dispatcher cache to see the research result");
const released = decide(factsFor(ecrNumber('B')), opts(Number(b2.finishedAt!.toDate().getTime()) + T(1), true));
check('the research result is stored: the session is released, on the NEW cost run (the researched numbers), not the first', released.action === 'dispatch' && released.s2RunId === Number(b2.id) && released.s2RunId !== Number(b1.id), JSON.stringify(released));

const bf = factsFor(ecrNumber('B'));
check('the wait counts from the FIRST cost run on the revision (now stale), not the re-run: the dispatcher reads it from the real cache', Math.abs(bf.firstS2FinishedMs! - run(b1.id).finishedAt!.toDate().getTime()) < 5 && bf.firstS2FinishedMs! < bf.s2Done.at(-1)!.finishedMs!, `${bf.firstS2FinishedMs} vs run ${run(b1.id).finishedAt!.toDate().getTime()}, re-run ${bf.s2Done.at(-1)!.finishedMs}`);
const afterRerun = decide({ ...bf, firstS2SeenMs: bf.firstS2FinishedMs! }, opts(bf.firstS2FinishedMs! + T(10), true));
check('...so ten minutes after the first run it is released even though the re-run finished later', afterRerun.action === 'dispatch', afterRerun.action === 'skip' ? afterRerun.reason : afterRerun.action);

// -- and a session started now can post, because its run still stands
await earlyStatement(B.id, b2.id);
const stmtLog = await until(() => logFor(`fx1-stmt-${b2.id}-${stamp}`)[0], 3000, 'the statement call in the log');
check('a Level 1 statement written from that run is accepted by the module', stmtLog.outcome === 'applied' && [...db.impactStatement.iter()].some((s) => s.prId === B.id && s.checkRunId === b2.id), `${stmtLog.outcome}: ${stmtLog.summary}`);

// -- the fallback: research never answers, the wait ends 10 minutes after the cost run finished
const F = await ingest(ecrNumber('F'));
await allDone(F.id);
await until(() => factsFor(ecrNumber('F')).s2Done.length === 1, 5000, 'the dispatcher cache to see the cost run');
const f1 = finishedMs(ecrNumber('F'));
check('no research result ever: held at 9m59s, released at 10m', dispatchOf(ecrNumber('F'), f1 + T(10) - 1000, true).action === 'skip' && dispatchOf(ecrNumber('F'), f1 + T(10), true).action === 'dispatch');

for (const c of [A, AG, D, ...sessions]) c.close();
console.log(`(${grants} scope grants made on '${DB}')`);
process.exit(finish() ? 0 : 1);
