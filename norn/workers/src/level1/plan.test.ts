// The dispatcher's idempotency rules (plan.ts), with no database, runner or model:
//   npm run test:level1 -w @norn/workers
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actorFor, decide, jobIdFor, jobsFromEvents, parseJobId, supersededJobs, type DecideOptions, type EcrFacts, type EventRow } from './plan.ts';

const T0 = Date.parse('2026-10-24T20:00:00Z');
const opts = (over: Partial<DecideOptions> = {}): DecideOptions => ({ nowMs: T0 + 60_000, maxAttempts: 2, retryDelayMs: 60_000, orphanMs: 330_000, running: new Set(), ...over });
const facts = (over: Partial<EcrFacts> = {}): EcrFacts => ({
  number: 'ECR-0417',
  status: 'draft',
  crSeq: 1,
  crCreatedMs: T0,
  s2Done: [{ id: 7, inputsRevision: 1, mock: false }],
  statements: [],
  jobs: [],
  ...over,
});
const ev = (jobId: string, eventType: string, tsMs: number, payload: object = {}): EventRow => ({ jobId, eventType, tsMs, payloadJson: JSON.stringify(payload) });

test('a finished cost check on the current revision starts attempt 1', () => {
  const d = decide(facts(), opts());
  assert.deepEqual(d, { action: 'dispatch', revision: 1, attempt: 1, s2RunId: 7 });
});

test('it waits for the cost check of the current revision, and never uses mock numbers', () => {
  assert.equal(decide(facts({ s2Done: [] }), opts()).action, 'skip');
  // a finished run, but of the previous revision
  assert.equal(decide(facts({ crSeq: 2, crCreatedMs: T0 + 1000, s2Done: [{ id: 7, inputsRevision: 1, mock: false }] }), opts()).action, 'skip');
  assert.equal(decide(facts({ s2Done: [{ id: 7, inputsRevision: 1, mock: true }] }), opts()).action, 'skip');
  // no change request at all (the worker's mock handlers)
  assert.equal(decide(facts({ crSeq: null, crCreatedMs: null, s2Done: [{ id: 7, inputsRevision: null, mock: true }] }), opts()).action, 'skip');
});

test('only open ECRs get a session', () => {
  for (const status of ['approved', 'merged', 'closed']) assert.equal(decide(facts({ status }), opts()).action, 'skip', status);
  assert.equal(decide(facts({ status: 'review' }), opts()).action, 'dispatch');
});

test('a session that is running, here or in the stored events, blocks a second', () => {
  const id = jobIdFor('ECR-0417', 1, 1);
  // started in this process, no event stored yet
  assert.match((decide(facts(), opts({ running: new Set([id]) })) as any).reason, /running/);
  // after a restart: the stored events show a session that has not finished and is not old
  const jobs = jobsFromEvents([ev(id, 'job_queued', T0 + 10_000), ev(id, 'job_started', T0 + 11_000)]);
  assert.match((decide(facts({ jobs }), opts()) as any).reason, /running/);
});

test('after a restart, a finished session with a statement starts nothing', () => {
  const id = jobIdFor('ECR-0417', 1, 1);
  const jobs = jobsFromEvents([ev(id, 'job_queued', T0 + 10_000), ev(id, 'job_finished', T0 + 30_000, { status: 'succeeded', error: null })]);
  const d = decide(facts({ jobs, statements: [{ level: 1, createdMs: T0 + 25_000, crSeq: 1 }] }), opts({ nowMs: T0 + 3_600_000 }));
  assert.match((d as any).reason, /already has a statement/);
});

test('a baseline-only re-check starts nothing: same revision, a newer cost run, a statement already there', () => {
  const f = facts({ s2Done: [{ id: 7, inputsRevision: 1, mock: false }, { id: 12, inputsRevision: 1, mock: false }], statements: [{ level: 1, createdMs: T0 + 25_000, crSeq: 1 }] });
  assert.equal(decide(f, opts()).action, 'skip');
});

test('a new revision gets its own session even though the previous revision has a statement', () => {
  const old = jobIdFor('ECR-0417', 1, 1);
  const f = facts({
    crSeq: 2,
    crCreatedMs: T0 + 600_000,
    s2Done: [{ id: 7, inputsRevision: 1, mock: false }, { id: 15, inputsRevision: 2, mock: false }],
    statements: [{ level: 1, createdMs: T0 + 25_000, crSeq: 1 }],
    jobs: jobsFromEvents([ev(old, 'job_finished', T0 + 30_000, { status: 'succeeded' })]),
  });
  assert.deepEqual(decide(f, opts({ nowMs: T0 + 700_000 })), { action: 'dispatch', revision: 2, attempt: 1, s2RunId: 15 });
});

test('a failed session is tried again once, after the delay, under a new job id', () => {
  const first = jobIdFor('ECR-0417', 1, 1);
  const jobs = jobsFromEvents([ev(first, 'job_queued', T0), ev(first, 'job_finished', T0 + 20_000, { status: 'failed', error: { kind: 'overloaded', retryable: true, resetsAt: null } })]);
  assert.match((decide(facts({ jobs }), opts({ nowMs: T0 + 40_000 })) as any).reason, /waits until/);
  assert.deepEqual(decide(facts({ jobs }), opts({ nowMs: T0 + 90_000 })), { action: 'dispatch', revision: 1, attempt: 2, s2RunId: 7 });
});

test('a usage limit waits for the window to reset', () => {
  const first = jobIdFor('ECR-0417', 1, 1);
  const resets = T0 + 3_600_000;
  const jobs = jobsFromEvents([ev(first, 'job_finished', T0 + 20_000, { status: 'failed', error: { kind: 'usage_limit', retryable: true, resetsAt: new Date(resets).toISOString() } })]);
  assert.equal(decide(facts({ jobs }), opts({ nowMs: T0 + 600_000 })).action, 'skip');
  assert.equal(decide(facts({ jobs }), opts({ nowMs: resets + 1000 })).action, 'dispatch');
});

test('attempts are capped per revision, not per restart', () => {
  const jobs = jobsFromEvents([
    ev(jobIdFor('ECR-0417', 1, 1), 'job_finished', T0 + 20_000, { status: 'failed' }),
    ev(jobIdFor('ECR-0417', 1, 2), 'job_finished', T0 + 200_000, { status: 'succeeded' }), // ended without posting
  ]);
  assert.match((decide(facts({ jobs }), opts({ nowMs: T0 + 3_600_000 })) as any).reason, /attempt/);
});

test('a text edit gives the ECR a fresh attempt budget: sessions refused for the old ECR revision do not count (Sol #128 round 5)', () => {
  const jobs = jobsFromEvents([
    ev(jobIdFor('ECR-0417', 1, 1, 1), 'job_finished', T0 + 20_000, { status: 'succeeded' }), // ended without posting
    ev(jobIdFor('ECR-0417', 1, 2, 1), 'job_finished', T0 + 200_000, { status: 'succeeded' }), // refused: the text changed under it
  ]);
  const later = opts({ nowMs: T0 + 3_600_000 });
  assert.match((decide(facts({ jobs, ecrRevision: 1 }), later) as any).reason, /attempt/);
  assert.deepEqual(decide(facts({ jobs, ecrRevision: 2 }), later), { action: 'dispatch', revision: 1, attempt: 3, s2RunId: 7 });
  const more = jobsFromEvents([
    ...[1, 2].map(a => ev(jobIdFor('ECR-0417', 1, a, 1), 'job_finished', T0 + a * 1000, { status: 'succeeded' })),
    ...[3, 4].map(a => ev(jobIdFor('ECR-0417', 1, a, 2), 'job_finished', T0 + a * 1000, { status: 'succeeded' })),
  ]);
  assert.match((decide(facts({ jobs: more, ecrRevision: 2 }), later) as any).reason, /attempt/);
  // an older id without the ECR revision still counts, whatever the ECR's revision now
  const legacy = jobsFromEvents([1, 2].map(a => ev(jobIdFor('ECR-0417', 1, a), 'job_finished', T0 + a * 1000, { status: 'failed' })));
  assert.match((decide(facts({ jobs: legacy, ecrRevision: 5 }), later) as any).reason, /attempt/);
});

test('job ids carry the ECR revision and still read back, and older ids still parse', () => {
  const id = jobIdFor('ECR-0417', 3, 2, 7);
  assert.equal(id, 'l1-ECR-0417-r3-e7-a2');
  assert.deepEqual(parseJobId(id), { revision: 3, attempt: 2, ecrRevision: 7 });
  assert.deepEqual(parseJobId('l1-ECR-0417-r3-a2'), { revision: 3, attempt: 2 });
  assert.equal(jobsFromEvents([ev(id, 'job_queued', T0)])[0]!.ecrRevision, 7);
  assert.deepEqual(supersededJobs({ number: 'ECR-0417', crSeq: 4 }, [id]), [id]);
});

test('a session that died with its process is retried once its events stop for the orphan time', () => {
  const id = jobIdFor('ECR-0417', 1, 1);
  const jobs = jobsFromEvents([ev(id, 'job_queued', T0), ev(id, 'job_started', T0 + 2000)]);
  assert.equal(decide(facts({ jobs }), opts({ nowMs: T0 + 100_000 })).action, 'skip');
  assert.deepEqual(decide(facts({ jobs }), opts({ nowMs: T0 + 400_000 })), { action: 'dispatch', revision: 1, attempt: 2, s2RunId: 7 });
  // ...but not while this process is still running it
  assert.equal(decide(facts({ jobs }), opts({ nowMs: T0 + 400_000, running: new Set([id]) })).action, 'skip');
});

test('job ids are runner-safe, name the revision and attempt, and fit an actor name', () => {
  for (const n of ['ECR-0417', 'BWM-ECR-0417', 'NORN-12', 'A weird/number with spaces and a very long tail xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']) {
    const id = jobIdFor(n, 12, 3);
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
    assert.deepEqual(parseJobId(id), { revision: 12, attempt: 3 });
    assert.ok(actorFor(id).length <= 64, actorFor(id));
  }
  assert.equal(parseJobId('e2e-mcp-abc'), null);
  assert.equal(jobsFromEvents([ev('e2e-mcp-abc', 'job_queued', T0)]).length, 0, 'other jobs are not ours');
});

// ---- review findings on #80 -----------------------------------------------------------------------

const rev2 = (over: Partial<EcrFacts> = {}) =>
  facts({ crSeq: 2, crCreatedMs: T0 + 600_000, s2Done: [{ id: 7, inputsRevision: 1, mock: false }, { id: 15, inputsRevision: 2, mock: false }], ...over });

test('a late statement from the revision-1 session does not stand in for revision 2', () => {
  // revision 2 arrived at T0+600s; the old session posted at T0+650s from revision 1's check run (crSeq 1)
  const late = { level: 1, createdMs: T0 + 650_000, crSeq: 1 };
  assert.deepEqual(decide(rev2({ statements: [late] }), opts({ nowMs: T0 + 700_000 })), { action: 'dispatch', revision: 2, attempt: 1, s2RunId: 15 });
  // revision 2's own statement does
  const own = { level: 1, createdMs: T0 + 680_000, crSeq: 2 };
  assert.match((decide(rev2({ statements: [late, own] }), opts({ nowMs: T0 + 700_000 })) as any).reason, /already has a statement/);
  // a Level 2 written from revision 2's run supersedes Level 1 as before
  assert.equal(decide(rev2({ statements: [{ level: 2, createdMs: T0 + 690_000, crSeq: 2 }] }), opts({ nowMs: T0 + 700_000 })).action, 'skip');
});

test('a statement that rests on no check run never stops a session, whenever it was posted', () => {
  // e.g. judgment-only numbers from a scoped agent whose spawnedBy is not a check run, after revision 2 arrived
  const noRun = (createdMs: number) => ({ level: 1, createdMs, crSeq: null });
  assert.equal(decide(rev2({ statements: [noRun(T0 + 25_000)] }), opts({ nowMs: T0 + 700_000 })).action, 'dispatch');
  assert.deepEqual(decide(rev2({ statements: [noRun(T0 + 650_000)] }), opts({ nowMs: T0 + 700_000 })), { action: 'dispatch', revision: 2, attempt: 1, s2RunId: 15 });
  assert.deepEqual(decide(facts({ statements: [noRun(T0 + 650_000)] }), opts()), { action: 'dispatch', revision: 1, attempt: 1, s2RunId: 7 });
});

test('a session still running for revision 1 does not hold back revision 2, and is named for stopping', () => {
  const old = jobIdFor('ECR-0417', 1, 1);
  const jobs = jobsFromEvents([ev(old, 'job_queued', T0 + 10_000), ev(old, 'job_started', T0 + 11_000)]);
  const running = new Set([old]);
  assert.deepEqual(decide(rev2({ jobs }), opts({ nowMs: T0 + 700_000, running })), { action: 'dispatch', revision: 2, attempt: 1, s2RunId: 15 });
  assert.deepEqual(supersededJobs({ number: 'ECR-0417', crSeq: 2 }, running), [old]);
  assert.deepEqual(supersededJobs({ number: 'ECR-0417', crSeq: 1 }, running), [], 'the current revision is not superseded');
  assert.deepEqual(supersededJobs({ number: 'ECR-0417', crSeq: null }, running), []);
  assert.deepEqual(supersededJobs({ number: 'ECR-0423', crSeq: 2 }, running), [], "another ECR's sessions are not this one's to stop");
});

test("another ECR's revision-1 session does not block ECR-0417 revision 1", () => {
  const other = jobIdFor('ECR-0423', 1, 1);
  const running = new Set([other]);
  assert.deepEqual(decide(facts(), opts({ running })), { action: 'dispatch', revision: 1, attempt: 1, s2RunId: 7 });
  // nor do its stored events (if they were ever mixed into this ECR's list), nor its used-up attempts
  const jobs = jobsFromEvents([ev(other, 'job_queued', T0 + 10_000), ev(jobIdFor('ECR-0423', 1, 2), 'job_finished', T0 + 20_000, { status: 'failed' })]);
  assert.deepEqual(decide(facts({ jobs }), opts()), { action: 'dispatch', revision: 1, attempt: 1, s2RunId: 7 });
  // but its own running session still does, and attempt numbers count from its own
  const mine = jobIdFor('ECR-0417', 1, 1);
  assert.match((decide(facts(), opts({ running: new Set([other, mine]) })) as any).reason, /running/);
});
