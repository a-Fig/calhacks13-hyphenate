import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { researchRevisionOfJobId } from '../../workers/src/level1/plan.ts';
import { decide, factsFor, jobIdFor, keyOf, RESULT_EVENT, type EcrFacts, type EventRow, type PlanContext, type ResultRow, type RevisionRow, type RunRow } from '../src/live/plan.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 25, 6, 0, 0);
const DIGEST = 'a1b2c3d4e5f60718';
const pr = { id: 7n, plmEcrNumber: 'ECR-0417', status: 'review' };
const rev = (seq: number, digest: string, current = true): RevisionRow => ({ seq, digest, current, changeRequestJson: '{}' });
const run = (id: number, status: string, revision: number, overlay: string, stage = 's2_cost'): RunRow => ({ id: BigInt(id), stage, status, inputsJson: JSON.stringify({ revision, overlay, erpBaseline: 'h' }) });
const detail = (id: number, mock = false): ResultRow[] => [
  { checkRunId: BigInt(id), key: 'detail', mock, detailJson: '{"inputs":[]}' },
  { checkRunId: BigInt(id), key: 'net_total_year_one', mock, detailJson: '{}' },
];

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ nowMs: NOW, maxPerHour: 4, maxAttempts: 2, retryDelayMs: 120_000, startedHere: new Map(), running: new Set(), ecrs: [], ...over });
const due = (over: Partial<EcrFacts> = {}): EcrFacts => ({ ...factsFor(pr, [rev(2, DIGEST)], [run(11, 'done', 2, DIGEST)], detail(11)), ...over });
const started = (jobId: string, agoMs: number): EventRow => ({ jobId, eventType: 'job_started', tsMs: NOW - agoMs });

describe('factsFor: the ECR revision whose cost run is current', () => {
  it('takes the newest finished s2 run that names the current revision and digest', () => {
    const runs = [run(5, 'done', 1, 'old'), run(9, 'done', 2, DIGEST), run(11, 'done', 2, DIGEST), run(12, 'stale', 2, DIGEST), run(13, 'queued', 2, DIGEST), run(14, 'done', 2, DIGEST, 's1_bom_delta')];
    const f = factsFor(pr, [rev(1, 'old', false), rev(2, DIGEST)], runs, [...detail(9), ...detail(11)]);
    assert.equal(f.costRun?.id, 11n);
    assert.equal(f.costRun?.detailJson, '{"inputs":[]}');
    assert.deepEqual(f.revision, { seq: 2, digest: DIGEST });
  });
  it("ignores a done run of an earlier revision, which can linger for a moment after a new revision arrives", () => {
    const f = factsFor(pr, [rev(1, 'old', false), rev(2, DIGEST)], [run(5, 'done', 1, 'old')], detail(5));
    assert.equal(f.costRun, null);
  });
  it('marks a run mock when any of its rows is mock, and has no revision before the first change request', () => {
    assert.equal(factsFor(pr, [rev(2, DIGEST)], [run(11, 'done', 2, DIGEST)], detail(11, true)).costRun?.mock, true);
    assert.equal(factsFor(pr, [], [], []).revision, null);
  });
});

describe('decide: what starts a research run', () => {
  it('starts one on a current cost run, with the job id and key built from the ECR and its revision digest', () => {
    const d = decide(due(), [], ctx());
    assert.equal(d.action, 'research');
    if (d.action !== 'research') return;
    assert.equal(d.key, 'ECR-0417@a1b2c3d4e5f60718');
    assert.equal(d.key, keyOf('ECR-0417', DIGEST));
    assert.equal(d.jobId, 'research-ECR-0417-r2-a1b2c3d4-a1');
    assert.equal(d.jobId, jobIdFor('ECR-0417', 2, DIGEST, 1));
    assert.equal(d.costRun.id, 11n);
  });

  it('does nothing while the cost check has not finished on the current revision, or ran as mock compute', () => {
    assert.match((decide(due({ costRun: null }), [], ctx()) as { why: string }).why, /waiting for the cost check/);
    assert.match((decide(due({ costRun: { id: 1n, inputsJson: '{}', detailJson: '{}', mock: true } }), [], ctx()) as { why: string }).why, /mock/);
    assert.match((decide(due({ costRun: { id: 1n, inputsJson: '{}', detailJson: null, mock: false } }), [], ctx()) as { why: string }).why, /no detail row/);
    assert.match((decide(due({ revision: null }), [], ctx()) as { why: string }).why, /no change request/);
  });

  it('leaves approved, released and closed ECRs alone: changing an assumption would withdraw the approval', () => {
    for (const status of ['approved', 'merged', 'closed']) assert.equal(decide(due({ status }), [], ctx()).action, 'skip', status);
    for (const status of ['draft', 'review']) assert.equal(decide(due({ status }), [], ctx()).action, 'research', status);
  });

  it('honours the list of ECRs it was limited to', () => {
    assert.equal(decide(due(), [], ctx({ ecrs: ['ECR-0423'] })).action, 'skip');
    assert.equal(decide(due(), [], ctx({ ecrs: ['ECR-0423', 'ECR-0417'] })).action, 'research');
  });

  it('researches a revision once: a stored result, in a restarted process, stops a second run', () => {
    const events: EventRow[] = [started(jobIdFor('ECR-0417', 2, DIGEST, 1), 600_000), { jobId: jobIdFor('ECR-0417', 2, DIGEST, 1), eventType: RESULT_EVENT, tsMs: NOW - 500_000 }];
    const d = decide(due(), events, ctx());
    assert.deepEqual(d, { action: 'skip', why: 'already researched' });
  });

  it('researches the next revision of the same ECR, because the key includes the digest', () => {
    const events: EventRow[] = [started(jobIdFor('ECR-0417', 2, DIGEST, 1), 2 * HOUR), { jobId: jobIdFor('ECR-0417', 2, DIGEST, 1), eventType: RESULT_EVENT, tsMs: NOW - 2 * HOUR }];
    const f = factsFor(pr, [rev(3, 'ffff0000ffff0000')], [run(21, 'done', 3, 'ffff0000ffff0000')], detail(21));
    const d = decide(f, events, ctx());
    assert.equal(d.action, 'research');
    if (d.action === 'research') assert.equal(d.jobId, 'research-ECR-0417-r3-ffff0000-a1');
  });

  it('skips a run in progress in this process', () => {
    assert.match((decide(due(), [], ctx({ running: new Set([keyOf('ECR-0417', DIGEST)]) })) as { why: string }).why, /in progress/);
  });

  it('retries a failed attempt after the delay, up to the attempt limit, then stops', () => {
    const a1 = jobIdFor('ECR-0417', 2, DIGEST, 1);
    const waiting = decide(due(), [started(a1, 30_000)], ctx());
    assert.equal(waiting.action, 'wait');
    if (waiting.action === 'wait') assert.equal(waiting.untilMs, NOW - 30_000 + 120_000);
    const retry = decide(due(), [started(a1, 300_000)], ctx());
    assert.equal(retry.action, 'research');
    if (retry.action === 'research') assert.deepEqual([retry.attempt, retry.jobId], [2, jobIdFor('ECR-0417', 2, DIGEST, 2)]);
    const spent = decide(due(), [started(a1, 900_000), started(jobIdFor('ECR-0417', 2, DIGEST, 2), 400_000)], ctx());
    assert.equal(spent.action, 'skip');
    assert.match((spent as { why: string }).why, /2 attempt\(s\) made/);
  });

  it('caps the runs per hour across ECRs, counting the stored events and this process own starts, and says when to look again', () => {
    const other = (n: number, ago: number) => started(`research-ECR-09${n}-r1-abcdef00-a1`, ago);
    const full = [other(1, 50 * 60_000), other(2, 40 * 60_000), other(3, 20 * 60_000), other(4, 10 * 60_000)];
    const d = decide(due(), full, ctx());
    assert.equal(d.action, 'wait');
    if (d.action === 'wait') assert.equal(d.untilMs, NOW - 50 * 60_000 + HOUR);
    // three stored plus one this process started that the cache does not show yet
    const mixed = decide(due(), full.slice(0, 3), ctx({ startedHere: new Map([['research-ECR-0999-r1-abcdef00-a1', NOW - 1000]]) }));
    assert.equal(mixed.action, 'wait');
    // the same job id seen in both places counts once
    const same = decide(due(), full.slice(0, 3), ctx({ startedHere: new Map([[(full[2] as EventRow).jobId, NOW - 20 * 60_000]]) }));
    assert.equal(same.action, 'research');
    // a run that started over an hour ago no longer counts
    assert.equal(decide(due(), [other(1, 61 * 60_000), other(2, 62 * 60_000), other(3, 63 * 60_000), other(4, 64 * 60_000)], ctx()).action, 'research');
  });

  it('counts only research jobs, not the other agents events', () => {
    const l1: EventRow[] = Array.from({ length: 6 }, (_, i) => started(`level1-ECR-0417-r1-a${i}`, 1000));
    assert.equal(decide(due(), l1, ctx()).action, 'research');
  });
});

describe('the Level 1 dispatcher waits for the result this worker stores (workers/src/level1/plan.ts)', () => {
  it('reads the change-request revision from the job ids this package makes, and only for the ECR they name', () => {
    for (const [number, seq, attempt] of [['ECR-0417', 1, 1], ['ECR-0417', 12, 2], ['ECR-0423', 3, 1]] as const) {
      const id = jobIdFor(number, seq, DIGEST, attempt);
      assert.equal(researchRevisionOfJobId(id, number), seq, id);
      assert.equal(researchRevisionOfJobId(id, number === 'ECR-0417' ? 'ECR-0423' : 'ECR-0417'), null, id);
    }
  });
});
