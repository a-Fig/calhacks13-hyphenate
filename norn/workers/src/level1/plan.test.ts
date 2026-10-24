// The dispatcher's idempotency rules (plan.ts), with no database, runner or model:
//   npm run test:level1 -w @norn/workers
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actorFor, decide, jobIdFor, jobsFromEvents, parseJobId, type DecideOptions, type EcrFacts, type EventRow } from './plan.ts';

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
  const d = decide(facts({ jobs, statements: [{ level: 1, createdMs: T0 + 25_000 }] }), opts({ nowMs: T0 + 3_600_000 }));
  assert.match((d as any).reason, /already has a statement/);
});

test('a baseline-only re-check starts nothing: same revision, a newer cost run, a statement already there', () => {
  const f = facts({ s2Done: [{ id: 7, inputsRevision: 1, mock: false }, { id: 12, inputsRevision: 1, mock: false }], statements: [{ level: 1, createdMs: T0 + 25_000 }] });
  assert.equal(decide(f, opts()).action, 'skip');
});

test('a new revision gets its own session even though the previous revision has a statement', () => {
  const old = jobIdFor('ECR-0417', 1, 1);
  const f = facts({
    crSeq: 2,
    crCreatedMs: T0 + 600_000,
    s2Done: [{ id: 7, inputsRevision: 1, mock: false }, { id: 15, inputsRevision: 2, mock: false }],
    statements: [{ level: 1, createdMs: T0 + 25_000 }],
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
