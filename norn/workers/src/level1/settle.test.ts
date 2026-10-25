// Supply settling in a batch (the live rerun that ingested ten ECRs within seconds): every ECR filed re-runs its peers'
// supply check, so an ECR's s4 is stale-and-replaced several times while its own s2 run finishes. The dispatcher holds
// the session until supply settles, and the statement binds the settled run, the same one at dispatch, in the post
// guard and in the publisher. Offline: a fake client cache holding the runs as the module left them, and the real
// checks' rows on Bowman's data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSessionSpawn } from '../../../module/src/gate-logic.ts';
import { factsOf, jobFactsOf } from './dispatcher.ts';
import { statementGuardFor } from './guard.ts';
import { decide, spawnedByFor, type DecideOptions } from './plan.ts';
import { jobPrompt } from './prompt.ts';
import { gather } from './publisher.ts';
import { deriveRecommendation, type RunRow } from './recommendation.ts';
import { storedRows, storedSupplyRows, storedTimelineRows } from './routing-fixture.ts';
import { settingsFromEnv } from './settings.ts';
import { SETTLE_WAIT_MS, SIBLING_CACHE_GRACE_US, settleCapUs, siblingOf, siblingSnapshotUs, siblingsUnsettled, waitingForSiblings } from './siblings.ts';
import { ruleInputForRun, siblingsForRun, snapshotForRun } from './source.ts';

const T0 = Date.parse('2026-10-24T20:00:00Z');
const us = (ms: number) => BigInt(Math.round(ms * 1000));
const S1 = 'hash-s1';
const at = (micros: bigint) => ({ microsSinceUnixEpoch: micros });

/** A run as the module stores it. `doneAt`: when its results were written (absent: it never completed). */
type Spec = { id: number; stage: string; status: string; created: number; doneAt?: number; finished?: number };
const toRun = (x: Spec): RunRow => ({
  id: BigInt(x.id),
  stage: x.stage,
  status: x.status,
  inputHash: `h${x.id}`,
  createdUs: us(T0 + x.created),
  startedUs: us(T0 + x.created),
  finishedUs: x.finished === undefined ? null : us(T0 + x.finished),
  upstreamS1: x.stage === 's1_bom_delta' ? undefined : S1,
  revision: 1,
  ...(x.doneAt === undefined ? {} : { completedUs: us(T0 + x.doneAt) }),
});

/**
 * The client cache of one ECR (pull request 5) with the given runs. Results are stored for the runs that completed: the
 * cost, timeline and supply rows of the real checks, each stamped with the time the run completed.
 */
function cacheOf(ecr: string, specs: Spec[], statements: any[] = []) {
  const runs = specs.map(toRun);
  const rows: Record<string, any[]> = { s2_cost: storedRows(ecr), s3_timeline: storedTimelineRows(ecr), s4_supply: storedSupplyRows(ecr) };
  let rid = 1000;
  const results = specs.filter(x => x.doneAt !== undefined && rows[x.stage]).flatMap(x => rows[x.stage]!.map(r => ({ ...r, id: BigInt(rid++), prId: 5n, checkRunId: BigInt(x.id), mock: false, createdAt: at(us(T0 + x.doneAt!)) })));
  const runRows = runs.map(r => ({
    id: r.id,
    prId: 5n,
    stage: r.stage,
    status: r.status,
    inputHash: r.inputHash,
    createdAt: at(r.createdUs),
    startedAt: at(r.startedUs!),
    finishedAt: r.finishedUs === null ? undefined : at(r.finishedUs),
    inputsJson: JSON.stringify({ revision: 1, revisionSource: 'plm', erpBaseline: '2c02958e00', erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24', ...(r.upstreamS1 ? { upstream: { s1_bom_delta: r.upstreamS1 } } : {}) }),
  }));
  const by = <T>(xs: T[]) => ({ filter: (id: bigint) => (id === 5n ? xs : []) });
  return {
    pullRequest: {},
    ecrRevision: { prId: by([{ seq: 1, current: true, createdAt: { toDate: () => new Date(T0) }, prId: 5n }]) },
    impactStatement: { prId: by(statements.map(s => ({ ...s, prId: 5n }))) },
    agentEvent: { prId: by([]) },
    checkRun: { prId: by(runRows), id: { find: (id: bigint) => runRows.find(r => r.id === id) } },
    checkResult: { prId: by(results) },
    nornConfig: { key: { find: () => null } },
  } as any;
}

const prOf = (ecr: string) => ({ id: 5n, plmEcrNumber: ecr, title: 'A change', status: 'review', revision: 3 }) as any;

/**
 * The batch as it was found in the database: s2 and its siblings were queued together, and the s4 of the first ones went
 * stale before it completed, because the next ECR filed re-ran it. Ids are the live ones (ECR-0417: s2 41; s4 43, 60, 71 stale, 83 done).
 */
function batch(s2Id: number, s3Id: number, stale: number[], live: number, over: { liveStatus?: string; liveDoneAt?: number | undefined; extra?: Spec[] } = {}): Spec[] {
  const liveStatus = over.liveStatus ?? 'done';
  const liveDoneAt = 'liveDoneAt' in over ? over.liveDoneAt : 7_400;
  return [
    { id: s2Id - 1, stage: 's1_bom_delta', status: 'done', created: 0, doneAt: 100, finished: 100 },
    { id: s2Id, stage: 's2_cost', status: 'done', created: 0, doneAt: 800, finished: 800 },
    { id: s3Id, stage: 's3_timeline', status: 'done', created: 0, doneAt: 200, finished: 200 },
    // stale before they completed: no results, and a finishedAt that is when they went stale
    ...stale.map((id, i) => ({ id, stage: 's4_supply', status: 'stale', created: i === 0 ? 0 : 2_000 + i * 2_000, finished: 2_000 + (i + 1) * 2_000 })),
    { id: live, stage: 's4_supply', status: liveStatus, created: 2_000 + stale.length * 2_000, ...(liveDoneAt === undefined ? {} : { doneAt: liveDoneAt, finished: liveStatus === 'done' ? liveDoneAt : undefined }) },
    ...(over.extra ?? []),
  ];
}

const CASES = [
  { ecr: 'ECR-0417', s2: 41, s3: 42, stale: [43, 60, 71], live: 83 },
  { ecr: 'ECR-0419', s2: 51, s3: 52, stale: [53, 72], live: 84 },
  { ecr: 'ECR-0421', s2: 61, s3: 62, stale: [63, 73, 81], live: 85 },
];

for (const c of CASES) {
  test(`${c.ecr}: in the batch (s4 re-run for later-filed peers, only the last completed) the statement binds the settled s4 and has a supply section`, () => {
    const db = cacheOf(c.ecr, batch(c.s2, c.s3, c.stale, c.live));
    const pr = prOf(c.ecr);
    // supply has settled: nothing queued or running, the newest s4 is done
    const f = factsOf(db, pr, 'level1-statement').s2Done[0]!;
    assert.equal(f.id, c.s2);
    assert.equal(f.siblings?.pending, false, 'the dispatcher does not hold');
    // what the dispatcher tells the agent
    const snap = snapshotForRun(db, 5n, BigInt(c.s2))!;
    const sib = siblingsForRun(db, 5n, BigInt(c.s2), snap)!;
    assert.equal(sib.supply.state, 'ready');
    assert.equal(sib.supply.runId, c.live, 'the done s4, not one of the stale ones');
    assert.equal(sib.timeline.runId, c.s3);
    const facts = jobFactsOf(db, pr, 1, c.s2, snap);
    assert.deepEqual(facts.timelineSupply?.unavailable ?? [], [], 'nothing is unavailable');
    assert.ok((facts.timelineSupply?.supply.length ?? 0) > 0, 'the agent is given supply sentences');
    assert.ok(!jobPrompt(facts).includes('had not finished'), 'and is not told to say a check had not finished');
    assert.ok(!facts.recommendation?.conditions.some(x => /supply check/.test(x) && /not (finished|assessed)|had not finished/.test(x)), 'the rule adds no "supply check unfinished" condition');
  });
}

test('the same binding at dispatch, in the post guard and in the publisher, however many times s4 is re-run after the session started', () => {
  const ecr = 'ECR-0417';
  const pr = prOf(ecr);
  const db = cacheOf(ecr, batch(41, 42, [43, 60, 71], 83));
  const snap = snapshotForRun(db, 5n, 41n)!;
  const spawnedBy = spawnedByFor(41, pr.revision, snap); // what the dispatcher signs
  assert.match(spawnedBy, /^norn:check_run:41:revision:3:snap:\d+$/);
  assert.ok(spawnedBy.length <= 64, 'it fits the credential, which names at most 64 characters (mcp/src/token.ts)');
  assert.deepEqual(parseSessionSpawn(spawnedBy), { runId: '41', revision: 3, snapshotUs: snap });

  // After the session started two more ECRs are filed: s4 is re-run again (run 90 stale, 91 done), with other numbers.
  const later = cacheOf(
    ecr,
    batch(41, 42, [43, 60, 71], 83, { liveStatus: 'stale', extra: [{ id: 90, stage: 's4_supply', status: 'stale', created: 20_000, finished: 22_000 }, { id: 91, stage: 's4_supply', status: 'done', created: 22_000, doneAt: 22_400, finished: 22_400 }] })
  );
  const seen = (db: any, statementSnapshot: bigint) => {
    const dispatch = siblingsForRun(db, 5n, 41n, snap)!;
    const input = ruleInputForRun(db, 5n, 41n, ecr, parseSessionSpawn(spawnedBy)?.snapshotUs)!.input;
    const guardText = statementGuardFor(db)(pr, spawnedBy, { headline: 'Checks are clean.', drivers: [], claims: [] });
    const row = { id: 12n, level: 1, prRevision: 3, checkRunId: 41n, snapshotUs: statementSnapshot, createdAt: { toDate: () => new Date(T0 + 60_000) }, changeClass: 'Class I', route: 'r', headline: 'h', author: null, numbers: [], drivers: [], assumptions: [], claims: [] };
    db.impactStatement = { prId: { filter: () => [row] } };
    const g = gather(db, pr)!;
    return { dispatch: [dispatch.timeline.runId, dispatch.supply.runId], guard: deriveRecommendation(input).conditions, guardText, publisher: [g.prov.timelineRunId, g.prov.supplyRunId], published: deriveRecommendation(g.prov.ruleInput!).conditions };
  };
  const atStart = seen(db, snap);
  const afterwards = seen(later, snap);
  assert.deepEqual(atStart.dispatch, [42, 83]);
  assert.deepEqual(atStart.publisher, [42, 83]);
  assert.deepEqual(afterwards.dispatch, [42, 83], 'a re-run made after the session started is not the dispatcher\'s');
  assert.deepEqual(afterwards.publisher, [42, 83], 'nor the publisher\'s');
  assert.deepEqual(afterwards.guard, atStart.guard, 'nor the guard\'s');
  assert.equal(afterwards.guardText, atStart.guardText);
  assert.deepEqual(afterwards.published, atStart.guard);
  // without the snapshot (a statement posted outside a session) the three still agree with each other: they read the same rule
  const noSnap = siblingsForRun(later, 5n, 41n)!;
  assert.equal(noSnap.supply.runId, 83, 'a re-run made after the cutoff is not the snapshotless statement\'s either');
});

test('a snapshot is only read in the one form the dispatcher signs', () => {
  assert.deepEqual(parseSessionSpawn('norn:check_run:3:revision:2'), { runId: '3', revision: 2 });
  assert.deepEqual(parseSessionSpawn('norn:check_run:3'), { runId: '3' });
  assert.deepEqual(parseSessionSpawn('norn:check_run:3:revision:2:snap:1790000000123456'), { runId: '3', revision: 2, snapshotUs: 1790000000123456n });
  for (const bad of ['norn:check_run:3:snap:5', 'norn:check_run:3:revision:2:snap:', 'norn:check_run:3:revision:2:snap:x', 'norn:check_run:3:revision:2:snap:-5', 'norn:check_run:3:revision:2:snap:5:extra', 'norn:check_run:3:revision:2:other:5'])
    assert.equal(parseSessionSpawn(bad), undefined, bad);
  assert.equal(spawnedByFor(41, 3), 'norn:check_run:41:revision:3');
  assert.equal(spawnedByFor(41, 3, 1790000000123456n), 'norn:check_run:41:revision:3:snap:1790000000123456');
  assert.ok(spawnedByFor(1234567, 9999, 1790000000123456n).length <= 64, 'even with a seven-digit run id and a four-digit revision');
});

// ---- the dispatcher's hold ----------------------------------------------------------------------------------

const opts = (nowMs: number): DecideOptions => ({ nowMs, maxAttempts: 2, retryDelayMs: 60_000, orphanMs: 330_000, running: new Set() });
const decideAt = (db: any, nowMs: number, settleWaitMs?: number) => {
  const pr = prOf('ECR-0417');
  const f = factsOf(db, pr, 'level1-statement', false, settleWaitMs);
  return decide({ number: 'ECR-0417', status: 'review', crSeq: 1, crCreatedMs: T0, s2Done: f.s2Done.map(x => ({ ...x, inputsRevision: 1 })), statements: [], jobs: [] }, opts(nowMs));
};

test('the dispatcher holds while an s4 of the ECR is queued or running, and releases when it settles', () => {
  for (const status of ['queued', 'running']) {
    const db = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83, { liveStatus: status, liveDoneAt: undefined }));
    const d = decideAt(db, T0 + 9_000);
    assert.equal(d.action, 'skip', `s4 ${status}`);
    assert.match((d as { reason: string }).reason, /waiting for the timeline and supply checks/);
  }
  // it settles: the dispatcher starts the session at once
  const settled = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83));
  const d = decideAt(settled, T0 + 9_000);
  assert.equal(d.action, 'dispatch');
  assert.equal((d as { s2RunId: number }).s2RunId, 41);
});

test('the dispatcher holds while the newest s4 is stale with its replacement still pending, and while a re-run is queued behind a done one', () => {
  // 71 went stale and its replacement is not in the cache yet
  const staleNewest = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83, { liveStatus: 'stale', liveDoneAt: 7_400 }));
  assert.equal(decideAt(staleNewest, T0 + 9_000).action, 'skip');
  // 83 is done and another ECR was just filed: its re-run (84) is queued
  const rerun = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83, { extra: [{ id: 84, stage: 's4_supply', status: 'queued', created: 8_000 }] }));
  assert.equal(decideAt(rerun, T0 + 9_000).action, 'skip');
  // s3 too
  const s3Running = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83, { extra: [{ id: 85, stage: 's3_timeline', status: 'running', created: 8_000 }] }));
  assert.equal(decideAt(s3Running, T0 + 9_000).action, 'skip');
});

test('the hold ends at the cap: 3 minutes after the cost run finished by default, and after the configured time', () => {
  const stuck = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83, { liveStatus: 'running', liveDoneAt: undefined }));
  const s2DoneMs = T0 + 800;
  const capMs = s2DoneMs + SETTLE_WAIT_MS;
  const graceMs = Number(SIBLING_CACHE_GRACE_US / 1000n);
  assert.equal(SETTLE_WAIT_MS, 180_000);
  assert.equal(decideAt(stuck, capMs).action, 'skip', 'at the cap');
  assert.equal(decideAt(stuck, capMs + graceMs).action, 'skip', 'and through the cache grace');
  assert.equal(decideAt(stuck, capMs + graceMs + 1).action, 'dispatch', 'then it goes ahead');
  // and the section says unavailable, as before: the stuck run is not completed by the snapshot
  const snap = snapshotForRun(stuck, 5n, 41n)!;
  const facts = jobFactsOf(stuck, prOf('ECR-0417'), 1, 41, snap);
  assert.deepEqual(facts.timelineSupply?.unavailable, [{ check: 'supply', why: 'it had not finished in time' }]);
  // a configured cap
  assert.equal(decideAt(stuck, s2DoneMs + 30_000 + graceMs, 30_000).action, 'skip');
  assert.equal(decideAt(stuck, s2DoneMs + 30_000 + graceMs + 1, 30_000).action, 'dispatch');
  assert.equal(settingsFromEnv({}).settleMs, 180_000);
  assert.equal(settingsFromEnv({ NORN_L1_SETTLE_MS: '45000' }).settleMs, 45_000);
  assert.equal(settingsFromEnv({ NORN_L1_SETTLE_MS: 'soon' }).settleMs, 180_000, 'an unreadable value falls back');
});

test('another ECR\'s hold does not depend on this ECR having re-runs on an earlier change-request revision', () => {
  // a run on revision 0 (before the change request moved) that is still running does not hold the current revision
  const old: Spec = { id: 30, stage: 's4_supply', status: 'running', created: 0 };
  const db = cacheOf('ECR-0417', batch(41, 42, [43, 60, 71], 83));
  const runs = [...[old].map(toRun).map(r => ({ ...r, revision: 0 }))];
  const rows = [...(function* () { yield* (db.checkRun.prId.filter(5n) as any[]).map(r => ({ id: r.id })); })()];
  assert.ok(rows.length > 0);
  const s2 = toRun(batch(41, 42, [43, 60, 71], 83).find(x => x.id === 41)!);
  const all = batch(41, 42, [43, 60, 71], 83).map(toRun);
  assert.equal(siblingsUnsettled([...all, ...runs], s2), false);
  assert.equal(waitingForSiblings([...all, ...runs], s2, us(T0 + 9_000)), false);
  assert.equal(settleCapUs(s2), us(T0 + 800 + SETTLE_WAIT_MS));
  assert.equal(siblingOf(all, s2, 's4_supply', siblingSnapshotUs(all, s2)).run?.id, 83n);
});test('a run still running on an earlier change-request revision does not hold the current one', () => {
  const all = batch(41, 42, [43, 60, 71], 83).map(toRun);
  const s2 = all.find(r => r.id === 41n)!;
  const old = { ...toRun({ id: 30, stage: 's4_supply', status: 'running', created: 0 }), revision: 0 };
  assert.equal(siblingsUnsettled([...all, old], s2), false);
  assert.equal(waitingForSiblings([...all, old], s2, us(T0 + 9_000)), false);
  assert.equal(settleCapUs(s2), us(T0 + 800 + SETTLE_WAIT_MS));
  assert.equal(siblingOf(all, s2, 's4_supply', siblingSnapshotUs(all, s2)).run?.id, 83n);
});
