// The timeline and supply checks (s3, s4) in the Level 1 statement (#120), offline: which runs a statement rests on,
// when the dispatcher stops waiting for them, what the recommendation rule makes of them, what the agent is told
// and what the PLM shows. The rows are the real checks' on Bowman's data (norn-seed-1), as the workers store them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobFactsOf, factsOf } from './dispatcher.ts';
import { statementToPlmFields, type StatementDoc } from './format.ts';
import { statementGuardFor } from './guard.ts';
import { findingsByCheck, findingsOf } from './prose.ts';
import { decide, type DecideOptions, type EcrFacts } from './plan.ts';
import { CLAIM_FIT, SUPPLY_CLAIM, TIMELINE_CLAIM, jobPrompt, usd } from './prompt.ts';
import { gather } from './publisher.ts';
import { deriveRecommendation, ruleInputOf, type RunRow } from './recommendation.ts';
import { storedRows, storedSupplyRows, storedTimelineRows } from './routing-fixture.ts';
import { SIBLING_CACHE_GRACE_US, SIBLING_WAIT_MS, siblingCutoffUs, siblingOf, waitingForSiblings } from './siblings.ts';
import { ruleInputForRun, ruleSiblingsOf, siblingsForRun } from './source.ts';
import { flagsOf, headlineNumbers, isTimelineSupplyKey, likelihoodWord, ruleCheckOf, supplierName, tableNumbers, timelineSupplyFacts, type SiblingView, type StoredRow } from './timeline-supply.ts';

// ---- runs ---------------------------------------------------------------------------------------------

const T0 = Date.parse('2026-10-24T20:00:00Z');
/** Milliseconds as SpacetimeDB microseconds: run times are compared at full precision (recommendation.ts `RunRow`). */
function us(ms: number): bigint;
function us(ms: null): null;
function us(ms: undefined): undefined;
function us(ms: number | null): bigint | null;
function us(ms: number | null | undefined) {
  return ms == null ? ms : BigInt(ms) * 1000n;
}
const S1 = 'hash-s1';
const run = (id: number, stage: string, status: string, over: Partial<RunRow> = {}): RunRow => ({
  id: BigInt(id),
  stage,
  status,
  inputHash: `h${id}`,
  createdUs: us(T0 + id * 100),
  startedUs: us(T0 + id * 100),
  finishedUs: us(status === 'queued' || status === 'running' || status === 'blocked' ? null : T0 + id * 100 + 50),
  upstreamS1: stage === 's1_bom_delta' ? undefined : S1,
  revision: 1,
  ...over,
});
/** s2 was created at T0 (with s3 and s4, in one transaction) and completed at T0+10 s; the cutoff is 30 s after that. */
const s2 = run(3, 's2_cost', 'done', { createdUs: us(T0), startedUs: us(T0), finishedUs: us(T0 + 10_000), completedUs: us(T0 + 10_000) });
/** An s3 or s4 run created with s2 (the same timestamp) that completed at T0+11 s unless told otherwise. */
const done = (id: number, stage: string, over: Partial<RunRow> = {}) => run(id, stage, 'done', { createdUs: us(T0), startedUs: us(T0), finishedUs: us(T0 + 11_000), completedUs: us(T0 + 11_000), ...over });
const CUTOFF = siblingCutoffUs(s2);
const CUTOFF_MS = Number(CUTOFF / 1000n);
/** The last moment the dispatcher still waits for a missing sibling: the cutoff plus the cache grace. One microsecond later it goes ahead. */
const GO = CUTOFF + SIBLING_CACHE_GRACE_US;
const GO_MS = Number(GO / 1000n);

test('a sibling is the s3 or s4 run on the same s1 and revision created no later than the s2 run: a later run is never eligible, however soon it finishes', () => {
  assert.equal(CUTOFF, us(T0 + 10_000 + SIBLING_WAIT_MS));
  const runs = [s2, done(4, 's3_timeline'), done(5, 's4_supply')];
  assert.equal(siblingOf(runs, s2, 's3_timeline').run?.id, 4n);
  assert.equal(siblingOf(runs, s2, 's4_supply').state, 'ready');
  // s4 re-runs because another ECR was filed: created later, so not the statement's, finished inside or after the window
  for (const completedUs of [us(T0 + 12_000), CUTOFF - 1n, CUTOFF + 1n]) {
    const rerun = done(9, 's4_supply', { createdUs: us(T0 + 5_000), completedUs, finishedUs: completedUs });
    assert.equal(siblingOf([...runs, rerun], s2, 's4_supply').run?.id, 5n, `a run created after s2 is not eligible (completed at +${(completedUs - us(T0)) / 1000n} ms)`);
    assert.equal(siblingOf([...runs, rerun], s2, 's4_supply').state, 'ready');
  }
  // the run that was queued with s2 and went stale because of that re-run is still the statement's, with its own results
  const staled = { ...done(5, 's4_supply'), status: 'stale', finishedUs: us(T0 + 5_000 /* overwritten when it went stale */) };
  assert.equal(siblingOf([s2, done(4, 's3_timeline'), staled, done(9, 's4_supply', { createdUs: us(T0 + 5_000) })], s2, 's4_supply').run?.id, 5n);
  assert.equal(siblingOf([s2, staled], s2, 's4_supply').state, 'ready');
  // another revision, another s1 run, and cancelled runs are not this snapshot's
  assert.equal(siblingOf([s2, done(4, 's3_timeline', { revision: 2 })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, done(4, 's3_timeline', { upstreamS1: 'other' })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'cancelled', { createdUs: us(T0) })], s2, 's3_timeline').state, 'pending');
  // eligible runs: the newest by id
  assert.equal(siblingOf([s2, done(4, 's3_timeline'), done(8, 's3_timeline', { completedUs: us(T0 + 12_000) })], s2, 's3_timeline').run?.id, 8n);
});

test("a stale run's results say when it completed, not its overwritten finishedAt; the s2 run's cutoff does not move when it goes stale", () => {
  // finishedAt was overwritten to a time far past the cutoff when it went stale; its results are from T0+11 s
  const staleEarly = { ...done(4, 's3_timeline'), status: 'stale', finishedUs: CUTOFF + 99_000_000n };
  assert.equal(siblingOf([s2, staleEarly], s2, 's3_timeline').state, 'ready');
  // the s2 run itself is stale now (a baseline-only change): the cutoff does not move with its overwritten finishedAt
  assert.equal(siblingCutoffUs({ ...s2, status: 'stale', finishedUs: us(T0 + 900_000) }), CUTOFF);
  // a stale run with no results never completed
  assert.equal(siblingOf([s2, { ...run(4, 's3_timeline', 'stale', { createdUs: us(T0) }), completedUs: undefined }], s2, 's3_timeline').state, 'pending');
});

test('(b) a sibling created before s2 that completes after the cutoff is unavailable at dispatch once the cutoff has passed, and at publication even after it has finished', () => {
  const late = (status: string, finishedUs: bigint | null) => run(4, 's3_timeline', status, { createdUs: us(T0 - 1_000), finishedUs, ...(finishedUs ? { completedUs: finishedUs } : {}) });
  const s4 = done(5, 's4_supply');
  // at dispatch: up to and including the cutoff plus the grace the dispatcher still waits; only after it does it go ahead, and the check is unavailable
  assert.equal(waitingForSiblings([s2, late('running', null), s4], s2, CUTOFF - 1n), true);
  assert.equal(waitingForSiblings([s2, late('running', null), s4], s2, CUTOFF), true, 'at the cutoff itself it still waits (see below)');
  assert.equal(waitingForSiblings([s2, late('running', null), s4], s2, GO), true, 'and through the grace');
  assert.equal(waitingForSiblings([s2, late('running', null), s4], s2, GO + 1n), false);
  assert.equal(siblingOf([s2, late('running', null), s4], s2, 's3_timeline').state, 'pending');
  // at publication, later: the run has finished (after the cutoff). Same answer: unavailable.
  const finished = late('done', CUTOFF + 20_000_000n);
  assert.equal(siblingOf([s2, finished, s4], s2, 's3_timeline').state, 'pending', 'completed after the cutoff');
  assert.equal(siblingOf([s2, { ...finished, status: 'stale' }, s4], s2, 's3_timeline').state, 'pending', 'and still after it went stale');
  assert.equal(siblingOf([s2, late('failed', CUTOFF + 5_000_000n), s4], s2, 's3_timeline').state, 'pending', 'a failure after the cutoff likewise');
  // one that completed exactly at the cutoff counts
  assert.equal(siblingOf([s2, late('done', CUTOFF), s4], s2, 's3_timeline').state, 'ready');
});

test('(c) timestamps are compared in microseconds: a rerun created 800 microseconds after s2 is not eligible, at dispatch or at publication', () => {
  const s2At = (us(T0) + 123n); // not on a millisecond boundary
  const own = { ...s2, createdUs: s2At };
  const sibling = (id: number, stage: string, createdUs: bigint) => done(id, stage, { createdUs, startedUs: createdUs });
  // the module made s3 and s4 with s2: one timestamp. Run 9 is a rerun made 800 us later, which truncates to the same millisecond
  const rerun = sibling(9, 's4_supply', s2At + 800n);
  assert.equal(rerun.createdUs / 1000n, s2At / 1000n, 'the fixture: both are in the same millisecond');
  const runs = [own, sibling(4, 's3_timeline', s2At), sibling(5, 's4_supply', s2At), rerun];
  assert.equal(siblingOf(runs, own, 's4_supply').run?.id, 5n);
  // 1 us is enough
  assert.equal(siblingOf([...runs.slice(0, 3), sibling(9, 's4_supply', s2At + 1n)], own, 's4_supply').run?.id, 5n);
  // and one made before s2, by any margin, is eligible
  assert.equal(siblingOf([own, sibling(4, 's3_timeline', s2At - 1n)], own, 's3_timeline').run?.id, 4n);
  // a cutoff that is not on a millisecond boundary counts the microseconds: finishing 1 us late is late
  const cutoff = siblingCutoffUs(own);
  assert.equal(siblingOf([own, done(4, 's3_timeline', { createdUs: s2At, completedUs: cutoff + 1n })], own, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([own, done(4, 's3_timeline', { createdUs: s2At, completedUs: cutoff })], own, 's3_timeline').state, 'ready');
});

test('(c) the same on the client cache: dispatch and publication both pick run 5 when run 9 was created 800 microseconds after s2', () => {
  const s2Us = us(T0) + 123n;
  const base = [s1, { ...s2, createdUs: s2Us }, done(4, 's3_timeline', { createdUs: s2Us }), done(5, 's4_supply', { createdUs: s2Us })];
  const rerun = done(9, 's4_supply', { createdUs: s2Us + 800n, startedUs: s2Us + 800n, finishedUs: us(T0 + 12_000), completedUs: us(T0 + 12_000) });
  const c = cache({
    runs: [...base.slice(0, 3), { ...base[3]!, status: 'stale' }, rerun],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000), ...withRun(storedSupplyRows('ECR-0417'), 5, 3000), ...withRun(storedSupplyRows('ECR-0421'), 9, 4000)],
  });
  const r = resolved(c);
  assert.deepEqual(r.dispatchRuns, [4, 5], 'dispatch');
  assert.deepEqual(r.publishRuns, [4, 5], 'publication');
});

test('(d) a sibling that finishes or fails exactly at the cutoff resolves the same way at dispatch and at publication', () => {
  const stillRunning = run(4, 's3_timeline', 'running', { createdUs: us(T0), startedUs: us(T0) });
  const s4 = done(5, 's4_supply');
  // What the dispatcher would tell the agent at `nowUs` (null: it keeps waiting), given the sibling as the cache shows it.
  const atDispatch = (s3: RunRow, nowUs: bigint) => (waitingForSiblings([s2, s3, s4], s2, nowUs) ? null : siblingOf([s2, s3, s4], s2, 's3_timeline').state);
  const atPublication = (s3: RunRow) => siblingOf([s2, s3, s4], s2, 's3_timeline').state;
  const ended = (status: 'done' | 'failed', at: bigint) => run(4, 's3_timeline', status, { createdUs: us(T0), startedUs: us(T0), finishedUs: at, ...(status === 'done' ? { completedUs: at } : {}) });
  for (const [status, inside] of [['done', 'ready'], ['failed', 'failed']] as const) {
    // ends at the cutoff: counts. A dispatcher that looks at the cutoff before it has seen the end must not go ahead, so it cannot have told the agent "pending".
    assert.equal(atPublication(ended(status, CUTOFF)), inside, `${status} at the cutoff counts at publication`);
    assert.equal(atDispatch(stillRunning, CUTOFF), null, `${status} at the cutoff: a dispatcher looking at the cutoff still waits`);
    assert.equal(atDispatch(stillRunning, GO), null, `${status} at the cutoff: and through the grace`);
    assert.equal(atDispatch(ended(status, CUTOFF), CUTOFF), inside, `${status} at the cutoff: and once it has seen the end it says the same as publication`);
    // ends one microsecond after: too late. The dispatcher goes ahead only after the cutoff and the grace, when it is still running, and says pending; so does publication.
    assert.equal(atDispatch(stillRunning, GO + 1n), 'pending');
    assert.equal(atPublication(ended(status, CUTOFF + 1n)), 'pending', `${status} 1 us after the cutoff is late at publication`);
    // ends one microsecond before: counts at both.
    assert.equal(atDispatch(ended(status, CUTOFF - 1n), CUTOFF - 1n), inside);
    assert.equal(atPublication(ended(status, CUTOFF - 1n)), inside);
  }
});

test('(g) a sibling that finished exactly at the cutoff but reaches the cache late, inside the grace, reads ready at dispatch and at publication', () => {
  const s4 = done(5, 's4_supply');
  const stillRunning = run(4, 's3_timeline', 'running', { createdUs: us(T0), startedUs: us(T0) });
  const finished = run(4, 's3_timeline', 'done', { createdUs: us(T0), startedUs: us(T0), finishedUs: CUTOFF, completedUs: CUTOFF });
  // What the dispatcher would tell the agent at `nowUs` given what its cache shows then (null: it keeps waiting).
  const atDispatch = (s3: RunRow, nowUs: bigint) => (waitingForSiblings([s2, s3, s4], s2, nowUs) ? null : siblingOf([s2, s3, s4], s2, 's3_timeline').state);
  // The run finished in the database at the cutoff; the cache still shows it running a millisecond later, and then catches up 1.5 s after.
  assert.equal(atDispatch(stillRunning, CUTOFF + 1_000n), null, 'the cache has not caught up: inside the grace the dispatcher still waits');
  assert.equal(atDispatch(finished, CUTOFF + 1_500_000n), 'ready', 'the cache has caught up: the dispatcher tells the agent ready');
  assert.equal(atDispatch(finished, GO + 1n), 'ready', 'and the same had it looked only after the grace');
  assert.equal(siblingOf([s2, finished, s4], s2, 's3_timeline').state, 'ready', 'publication reads ready too');
});

test('a queued or running sibling is not available, a failure or block is how it ended, and the newest eligible run decides', () => {
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'running', { createdUs: us(T0) })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'queued', { createdUs: us(T0) })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'failed', { createdUs: us(T0), finishedUs: us(T0 + 12_000) })], s2, 's3_timeline').state, 'failed');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'blocked', { createdUs: us(T0) })], s2, 's3_timeline').state, 'blocked');
  assert.equal(siblingOf([s2, done(4, 's3_timeline'), run(8, 's3_timeline', 'failed', { createdUs: us(T0), finishedUs: us(T0 + 12_000) })], s2, 's3_timeline').state, 'failed');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'failed', { createdUs: us(T0), finishedUs: us(T0 + 12_000) }), done(8, 's3_timeline')], s2, 's3_timeline').state, 'ready');
  // a run that cannot be tied to the s2 run (no upstream recorded) binds nothing
  assert.equal(siblingOf([done(4, 's3_timeline')], { ...s2, upstreamS1: undefined }, 's3_timeline').state, 'pending');
});

test('the dispatcher waits while a sibling is unavailable, and goes ahead when both have settled or at the cutoff', () => {
  const both = [s2, done(4, 's3_timeline'), done(5, 's4_supply')];
  assert.equal(waitingForSiblings(both, s2, us(T0 + 12_000)), false, 'both done: no waiting');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline')], s2, us(T0 + 12_000)), true, 's4 not there yet');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'running', { createdUs: us(T0) })], s2, GO), true, 'a hung s4 is waited for up to and including the cutoff plus the grace');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'running', { createdUs: us(T0) })], s2, GO + 1n), false, 'and not a microsecond longer');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed', { createdUs: us(T0) })], s2, us(T0 + 12_000)), false, 'a failed s4 is settled: no reason to wait');
  assert.equal(waitingForSiblings([s2, run(4, 's3_timeline', 'blocked', { createdUs: us(T0) }), done(5, 's4_supply')], s2, us(T0 + 12_000)), false);
  assert.equal(waitingForSiblings([s2], s2, us(T0 + 1_000_000)), false, 'neither ever ran: after the cutoff, go ahead');
  // a re-run created later does not make the dispatcher wait again
  assert.equal(waitingForSiblings([...both, run(9, 's4_supply', 'running', { createdUs: us(T0 + 5_000) })], s2, us(T0 + 12_000)), false);
});

const opts = (over: Partial<DecideOptions> = {}): DecideOptions => ({ nowMs: T0 + 60_000, maxAttempts: 2, retryDelayMs: 60_000, orphanMs: 330_000, running: new Set(), ...over });
const ecrFacts = (siblings: { pending: boolean; cutoffUs: bigint } | undefined): EcrFacts => ({
  number: 'ECR-0417',
  status: 'review',
  crSeq: 1,
  crCreatedMs: T0,
  s2Done: [{ id: 3, inputsRevision: 1, mock: false, ...(siblings ? { siblings } : {}) }],
  statements: [],
  jobs: [],
});

test('decide: Level 1 waits for s3 and s4 until the cutoff, then starts whatever their state, and without sibling facts it behaves as before', () => {
  const cutoff = T0 + 40_000;
  const cutoffUs = us(cutoff);
  const waiting = decide(ecrFacts({ pending: true, cutoffUs }), opts({ nowMs: T0 + 20_000 }));
  assert.equal(waiting.action, 'skip');
  assert.match((waiting as { reason: string }).reason, /waiting for the timeline and supply checks until 2026-10-24T20:00:42/, 'the cutoff plus the 2 s grace');
  assert.equal(decide(ecrFacts({ pending: false, cutoffUs }), opts({ nowMs: T0 + 20_000 })).action, 'dispatch', 'settled: no waiting');
  assert.equal(decide(ecrFacts({ pending: true, cutoffUs }), opts({ nowMs: cutoff })).action, 'skip', 'at the cutoff itself it still waits: a sibling that finishes exactly then still counts');
  assert.equal(decide(ecrFacts({ pending: true, cutoffUs }), opts({ nowMs: cutoff + 2_000 })).action, 'skip', 'through the grace it still waits');
  assert.equal(decide(ecrFacts({ pending: true, cutoffUs }), opts({ nowMs: cutoff + 2_001 })).action, 'dispatch', 'a hung check does not hold Level 1 back');
  assert.equal(decide(ecrFacts(undefined), opts({ nowMs: T0 + 20_000 })).action, 'dispatch');
});

// ---- the rule ---------------------------------------------------------------------------------------------

const view = (rows: StoredRow[], state: SiblingView['state'] = 'ready'): SiblingView => ({ state, runId: 1, rows: state === 'ready' ? rows : [] });
const rowsOf = (xs: { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string }[]): StoredRow[] => xs;
const real = (ecr: string) => ({ timeline: view(rowsOf(storedTimelineRows(ecr))), supply: view(rowsOf(storedSupplyRows(ecr))) });
const rule = (ecr: string, t: SiblingView, s: SiblingView) => deriveRecommendation(ruleInputOf(storedRows(ecr), [], ruleSiblingsOf({ timeline: t, supply: s }, ecr)));
const flagOnly = (flags: object[]): SiblingView => view([{ key: 'detail', label: 'd', unit: 'json', p10: 0, p50: 0, p90: 0, detailJson: JSON.stringify({ flags }) }]);

test("ECR-0417 keeps its outcome, Approve with conditions under rule 2, and its three blank cost lines first; the two unassessed-implementation gaps and the missed need date follow, and the single source is not a condition", () => {
  const a = real('ECR-0417');
  const flags = [...(JSON.parse(a.timeline.rows.find(r => r.key === 'detail')!.detailJson).flags as { kind: string }[]), ...(JSON.parse(a.supply.rows.find(r => r.key === 'detail')!.detailJson).flags as { kind: string }[])].map(f => f.kind);
  assert.ok(flags.includes('likely_late') && flags.includes('single_source'), `the real checks do warn about it: ${flags}`);
  const d = rule('ECR-0417', a.timeline, a.supply);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.deepEqual(d.blockers, []);
  const base = deriveRecommendation(ruleInputOf(storedRows('ECR-0417'), [])).conditions;
  assert.equal(base.length, 3);
  assert.deepEqual(d.conditions.slice(0, 3), base, 'the same three blank lines, in the same order');
  assert.deepEqual(d.conditions.slice(3), ['Qualification and release not assessed', 'Retrofit work and downtime not assessed', 'CCB to accept slip to 2027-02-16 (S/N 15) at the median, 2027-04-11 at P90 (tail past 14 days), against the need (S/N 11 and subsequent), or expedite']);
  // the recommendation claim as the agent writes it, with all six conditions, still fits the 520 characters past which the job asks for shortened ones
  const claim = `Recommendation: ${d.recommendation}. Rule ${d.rule}: ${d.conditions.map((c, i) => `(${i + 1}) ${c}`).join('; ')}.`;
  assert.equal(d.conditions.length, 6);
  assert.ok(claim.length <= CLAIM_FIT, `${claim.length} characters`);
  assert.ok(!jobPrompt({ ...factsFor0417(), recommendation: d }).includes('would not fit one claim'), 'so the job does not ask for shortened conditions');
  const b = real('ECR-0423');
  const e = rule('ECR-0423', b.timeline, b.supply);
  assert.equal(e.recommendation, 'Approve');
  assert.equal(e.rule, 3);
  assert.deepEqual(e.conditions, [], 'ECR-0423 has no stated need and no conflict: nothing is added');
});

test('a missed need date is a condition only past the 14-day bar; a single source is never one; a slot or capacity conflict with a named ECR is', () => {
  const ready = (flags: object[], extra: object): SiblingView => ({ ...flagOnly(flags), ...extra });
  const late = { kind: 'likely_late', severity: 'warn', ref: 'stated:E', message: 'late' };
  const slip = (weeks: number, over: object = {}) => ruleCheckOf({ ...flagOnly([late]), rows: [{ key: 'late_weeks', label: 'l', unit: 'weeks', p10: weeks / 2, p50: weeks, p90: weeks, detailJson: '{}' }, ...flagOnly([late]).rows] , ...over });
  const t = (weeks: number) => deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), [], { timeline: slip(weeks) }));
  assert.equal(t(1.5).recommendation, 'Approve', 'under two weeks at P90: below the bar, nothing to accept');
  assert.equal(t(3).recommendation, 'Approve with conditions');
  assert.match(t(3).conditions[0]!, /^CCB to accept slip, whose P90 tail crosses 14 days, against the need, or expedite$/, 'no date known: the generic words');
  // single source alone, on both checks
  const single = flagOnly([{ kind: 'single_source', severity: 'warn', ref: 'BW-1', message: 'one source' }]);
  assert.deepEqual(rule('ECR-0423', single, single).conditions, []);
  // a conflict with another ECR: slot, capacity, or both in one condition, never duplicated
  const supply = (kinds: string[], peers: string[]) => ruleCheckOf({ ...flagOnly(kinds.map(kind => ({ kind, severity: 'warn', message: kind }))), rows: [{ key: 'detail', label: 'd', unit: 'json', p10: 0, p50: 0, p90: 0, detailJson: JSON.stringify({ flags: kinds.map(kind => ({ kind, severity: 'warn', message: kind })), interaction: { peers: peers.map(ecr => ({ ecr })) } }) }] });
  const s = (k: string[], p: string[]) => deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), [], { supply: supply(k, p) })).conditions;
  assert.deepEqual(s(['slot_contention'], ['ECR-0419']), ['Resolve the supplier slot conflict with ECR-0419']);
  assert.deepEqual(s(['capacity_exceeded'], ['ECR-0419', 'ECR-0420']), ['Resolve the supplier capacity conflict with ECR-0419, ECR-0420']);
  assert.deepEqual(s(['slot_contention', 'capacity_exceeded', 'slot_contention'], ['ECR-0419']), ['Resolve the supplier slot and capacity conflict with ECR-0419']);
  assert.deepEqual(s(['capacity_exceeded'], []), [], 'no other ECR named: the ECR alone exceeding capacity is a finding');
  assert.deepEqual(s(['likely_late'], ['ECR-0419']), [], "the supply check's own lateness is the timeline's, not a second condition");
});

test('(e) the late-slip condition quotes the P90 date next to the median and says the P90 tail is what is past 14 days', () => {
  // The bar is read at P90, so a median that slips only a week still has a condition: the text must say which date crosses it.
  const timelineWith = (medianDate: string, p90Date: string, medianWeeks: number, p90Weeks: number) =>
    ruleCheckOf({
      state: 'ready',
      runId: 1,
      rows: [
        { key: 'cut_in_date', label: 'Cut-in date', unit: 'day', p10: 0, p50: 0, p90: 0, detailJson: JSON.stringify({ date: { p50: medianDate, p90: p90Date } }) },
        { key: 'cut_in_serial', label: 'Cut-in serial', unit: 'serial', p10: 11, p50: 12, p90: 14, detailJson: '{}' },
        { key: 'late_weeks', label: 'Weeks late', unit: 'weeks', p10: 0, p50: medianWeeks, p90: p90Weeks, detailJson: '{}' },
        { key: 'detail', label: 'd', unit: 'json', p10: 0, p50: 0, p90: 0, detailJson: JSON.stringify({ stated: { label: 'need date 2027-02-09' }, flags: [{ kind: 'likely_late', severity: 'warn', ref: 'stated:E', message: 'late' }] }) },
      ],
    });
  const c = deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), [], { timeline: timelineWith('2027-02-16', '2027-03-09', 1, 4) })).conditions[0]!;
  assert.equal(c, 'CCB to accept slip to 2027-02-16 (S/N 12) at the median, 2027-03-09 at P90 (tail past 14 days), against the need (need date 2027-02-09), or expedite');
  assert.ok(!/[—–]/.test(c), 'no dashes');
  // on the real rows the P90 date is the stored one
  const real0417 = real('ECR-0417');
  const p90 = (JSON.parse(real0417.timeline.rows.find(r => r.key === 'cut_in_date')!.detailJson) as { date: { p90: string } }).date.p90;
  const d = rule('ECR-0417', real0417.timeline, real0417.supply);
  const slip = d.conditions.find(c => c.startsWith('CCB to accept slip'))!;
  assert.ok(slip.includes(`, ${p90} at P90 (tail past 14 days)`), slip);
  // without a P90 date or without any date the text still says which tail is meant
  const noTail = { ...timelineWith('2027-02-16', '2027-03-09', 1, 4), cutIn: { date: '2027-02-16', serial: 12, stated: 'need date 2027-02-09', lateWeeksP90: 4 } };
  assert.equal(deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), [], { timeline: noTail })).conditions[0], 'CCB to accept slip to 2027-02-16 (S/N 12) at the median, with the P90 tail crossing 14 days, against the need (need date 2027-02-09), or expedite');
});

test('ECR-0421 on the real rows: its own unassessed plan, the slip, the slot conflict with ECR-0419 and the raw-material gap are its added conditions, after its cost ones; the gaps of ECR-0419 are not', () => {
  const r = real('ECR-0421');
  const base = deriveRecommendation(ruleInputOf(storedRows('ECR-0421'), []));
  const d = rule('ECR-0421', r.timeline, r.supply);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.deepEqual(d.conditions.slice(0, base.conditions.length), base.conditions);
  const added = d.conditions.slice(base.conditions.length);
  assert.equal(added.length, 4);
  assert.equal(added[0], 'Qualification and release not assessed', "ECR-0421's own plan; ECR-0419's implementation gaps in its supply check are not its own");
  assert.equal(added[1], 'CCB to accept slip to 2027-10-28 (S/N 2) at the median, 2027-12-08 at P90 (tail past 14 days), against the need (from 2027-06-01), or expedite');
  assert.match(added[2]!, /^The raw-material share of a part's price is a default/);
  assert.equal(added[3], 'Resolve the supplier slot conflict with ECR-0419');
});

test('the recommendation claim must fit 600 characters: when the conditions written out would not, the job asks for each in a few words, keeping all of them', () => {
  const many = deriveRecommendation({ detail: { flags: [{ kind: 'no_quote', severity: 'warn', message: 'x'.repeat(190) }, { kind: 'no_quote2', severity: 'warn', message: 'y'.repeat(190) }, { kind: 'no_quote3', severity: 'warn', message: 'z'.repeat(190) }] } });
  assert.equal(many.conditions.length, 3);
  const p = jobPrompt({ ...factsFor0417(), recommendation: many });
  assert.match(p, /Written out in full they would not fit one claim \(600 characters\): name each condition in a few words, keeping every one and its date, serial or ECR\./);
  assert.ok(!jobPrompt({ ...factsFor0417(), recommendation: deriveRecommendation({ detail: { flags: [{ kind: 'no_quote', severity: 'warn', message: 'short' }] } }) }).includes('would not fit'));
});

test('flags that say the check could not assess something are gaps, named briefly: Approve with conditions, never Send back', () => {
  const gaps = flagOnly([
    { kind: 'stock_beyond_plan', severity: 'warn', ref: 'stock:ECR-0423', message: 'a very long message the rule does not repeat' },
    { kind: 'unreadable_peer', severity: 'warn', ref: 'ECR-0999', message: 'x' },
    { kind: 'no_price', severity: 'warn', ref: 'BW-1', message: 'x' },
    { kind: 'beyond_published_slots', severity: 'warn', ref: 'BW-2', message: 'x' },
    { kind: 'cut_in_beyond_plan', severity: 'warn', message: 'x' },
    { kind: 'unused_assumption', severity: 'warn', ref: 'a:1', message: 'Assumption a:1 was not applied: it has no distribution.' },
    { kind: 'shared_supplier', severity: 'info', message: 'info is neither' },
    { kind: 'single_source', severity: 'warn', ref: 'BW-3', message: 'a finding, not a gap' },
  ]);
  const d = rule('ECR-0423', gaps, view([]));
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.deepEqual(d.blockers, []);
  assert.equal(d.conditions.length, 6);
  assert.ok(d.conditions[0]!.startsWith('No cut-in date can be placed (stock:ECR-0423)'));
  assert.ok(d.conditions.some(c => c.includes('ECR-0999') && c.includes('could not be read')));
  assert.ok(d.conditions.some(c => c.includes('BW-1') && c.includes('no quote or item master price')));
  assert.ok(d.conditions.some(c => c === 'Assumption a:1 was not applied: it has no distribution.'));
  assert.ok(d.conditions.every(c => c.length < 130), 'short enough to fit a statement claim with the rest');
  // ECR-0417 plus a gap: its three cost conditions come first, the new one after
  const plus = rule('ECR-0417', flagOnly([{ kind: 'no_price', severity: 'warn', ref: 'BW-1', message: 'x' }]), flagOnly([]));
  assert.equal(plus.conditions.length, 4);
  assert.ok(plus.conditions[3]!.includes('BW-1'));
});

test('a timeline or supply check that failed, is blocked, had not finished or is mock is a stated gap; a failure of the cost check still sends it back', () => {
  const ok = real('ECR-0423');
  const msg: Record<string, string> = { failed: 'failed', blocked: 'is blocked', pending: 'had not finished', mock: 'placeholder' };
  for (const state of ['failed', 'blocked', 'pending', 'mock'] as const) {
    const d = rule('ECR-0423', view([], state), ok.supply);
    assert.equal(d.recommendation, 'Approve with conditions', state);
    assert.deepEqual(d.conditions.length, 1);
    assert.ok(d.conditions[0]!.startsWith('The timeline check') && d.conditions[0]!.includes(msg[state]!), d.conditions[0]);
    const s = rule('ECR-0423', ok.timeline, view([], state));
    assert.ok(s.conditions[0]!.startsWith('The supply check'), s.conditions[0]);
  }
  const both = rule('ECR-0423', view([], 'failed'), view([], 'pending'));
  assert.equal(both.conditions.length, 2);
  assert.equal(deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), ['s2_cost'], { timeline: ruleCheckOf(view([], 'failed')) })).recommendation, 'Send back');
  // without sibling input the rule says nothing about them (callers that have none)
  assert.equal(deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), [])).recommendation, 'Approve');
});

test('the rule is deterministic over the stored rows: the same input twice, flags in any order', () => {
  const flags = [
    { kind: 'no_price', severity: 'warn', ref: 'B', message: 'x' },
    { kind: 'stock_beyond_plan', severity: 'warn', ref: 'A', message: 'x' },
  ];
  const a = rule('ECR-0423', flagOnly(flags), view([]));
  const b = rule('ECR-0423', flagOnly([...flags].reverse()), view([]));
  assert.deepEqual([...a.conditions].sort(), [...b.conditions].sort());
  assert.deepEqual(rule('ECR-0423', flagOnly(flags), view([])), a);
});

// ---- what the agent is told -------------------------------------------------------------------------------

test('likelihood words follow the ICD 203 scale in the system prompt, to its edges', () => {
  const at = (p: number) => likelihoodWord(p);
  assert.equal(at(0), 'almost no chance (1-5%)');
  assert.equal(at(0.049), 'almost no chance (1-5%)');
  assert.equal(at(0.05), 'very unlikely (5-20%)');
  assert.equal(at(0.36), 'unlikely (20-45%)');
  assert.equal(at(0.5), 'roughly even (45-55%)');
  assert.equal(at(0.7), 'likely (55-80%)');
  assert.equal(at(0.9), 'very likely (80-95%)');
  assert.equal(at(0.95), 'almost certain (95-99%)');
  assert.equal(at(1), 'almost certain (95-99%)');
});

test('ECR-0417: the facts give the cut-in range, the lateness against S/N 11 in the scale\'s words, and the single source', () => {
  const { timeline, supply } = real('ECR-0417');
  const f = timelineSupplyFacts(timeline, supply);
  assert.deepEqual(f.unavailable, []);
  assert.equal(f.timeline.length, 2);
  assert.equal(f.timeline[0], 'The change can first reach the line on 2027-02-16 (P10 2027-01-13, P90 2027-04-11), from serial 15 (13 to 18).');
  assert.match(f.timeline[1]!, /^That is 8\.3 to 20\.9 weeks after the stated effectivity \(S\/N 11 and subsequent, planned for 2026-11-16\), 13\.1 at the median; likelihood it is late: almost certain \(95-99%\)\.$/);
  assert.equal(f.supply.length, 1);
  assert.match(f.supply[0]!, /^BW-5120-210 \(Halden\) has one qualified source; its lead time is 14 weeks \(P10 9\.3, P90 21\.7\), and a second source would need its own qualification\.$/);
  assert.ok([...f.timeline, ...f.supply].every(s => s.length < 300));
});

test('ECR-0421: the slot ECR-0419 holds moves the cut-in 13 weeks, and bundling saves money; both are said once, with the likelihood word', () => {
  const { timeline, supply } = real('ECR-0421');
  const f = timelineSupplyFacts(timeline, supply);
  const text = [...f.timeline, ...f.supply].join(' ');
  assert.match(text, /With ECR-0419 ahead of it at Orrin, the cut-in moves 13 weeks later \(13 at the median\); likelihood it moves: almost certain \(95-99%\)\. It then reaches the line 34\.3 weeks after the stated effectivity at the median\./);
  assert.match(text, /Ordering together on the supplier's bundle terms would save this ECR \$5\d,\d{3} to \$6\d,\d{3} \(\$60,\d{3} at the median\), and \$180,\d{3} across every ECR in the bundle\./);
  assert.match(text, /BW-M512-340 \(Orrin\) has one qualified source/);
});

test('ECR-0423: no deadline to miss and no conflict, so a short, quiet statement', () => {
  const { timeline, supply } = real('ECR-0423');
  const f = timelineSupplyFacts(timeline, supply);
  assert.equal(f.timeline.length, 2);
  assert.equal(f.timeline[0], 'The change can first reach the line on 2027-09-09, from serial 28.');
  assert.equal(f.timeline[1], 'The ECR states no effectivity, so there is no deadline to miss.');
  assert.equal(f.supply.length, 1);
  assert.equal(f.supply[0], 'It shares Stratus with ECR-0406; any shift of its cut-in is below the reporting threshold (14 days).');
});

test('item 5: a peer shift under the reporting threshold is said to be under it, never "no impact"', () => {
  const shiftRow = (p90: number): StoredRow => ({ key: 'peer_cut_in_shift_weeks', label: 'shift', unit: 'weeks', p10: 0, p50: p90 / 2, p90, detailJson: '{}' });
  const later: StoredRow = { key: 'p_cut_in_later_with_peers', label: 'later', unit: 'probability', p10: 0.3, p50: 0.3, p90: 0.3, detailJson: JSON.stringify({ peers: [{ ecr: 'ECR-0406', sharedSuppliers: ['SUP-STRATUS'] }] }) };
  const f = timelineSupplyFacts(view([], 'failed'), view([shiftRow(1), later]));
  assert.deepEqual(f.supply, ['It shares Stratus with ECR-0406; any shift of its cut-in is below the reporting threshold (14 days).']);
  assert.ok(!f.supply.join(' ').includes('neither') && !f.supply.join(' ').includes('move its cut-in.'), 'no positive no-impact claim');
  // a shift over the bar is reported as a shift
  assert.match(timelineSupplyFacts(view([], 'failed'), view([shiftRow(3), later])).supply[0]!, /the cut-in moves 0 to 3 weeks later/);
  // no shift row at all (nothing could be compared): the sharing is stated and nothing about its effect
  assert.deepEqual(timelineSupplyFacts(view([], 'failed'), view([later])).supply, ['It shares Stratus with ECR-0406.']);
});

test('the table\'s numbers are the bound runs\' own rows that clear Bowman\'s bars', () => {
  const r17 = real('ECR-0417');
  assert.deepEqual(headlineNumbers(r17.timeline, r17.supply, 9).map(x => x.resultKey), ['cut_in_date', 'cut_in_serial', 'late_weeks', 'single_source_items']);
  const r21 = real('ECR-0421');
  assert.deepEqual(headlineNumbers(r21.timeline, r21.supply, 9).map(x => x.resultKey), ['cut_in_date', 'cut_in_serial', 'late_weeks', 'single_source_items', 'peer_cut_in_shift_weeks', 'bundle_saving:CON-ORRIN-UH-SLOT']);
  const r23 = real('ECR-0423');
  assert.deepEqual(headlineNumbers(r23.timeline, r23.supply, 9).map(x => x.resultKey), ['cut_in_date', 'cut_in_serial'], 'no deadline, no single source, no move');
  assert.equal(headlineNumbers(r21.timeline, r21.supply, 2).length, 2, 'only what fits');
  assert.equal(headlineNumbers(r21.timeline, r21.supply, 0).length, 0);
  assert.deepEqual(headlineNumbers(view([], 'failed'), view([], 'pending'), 9), [], 'a check that is not available posts no number');
  assert.ok(['cut_in_date', 'late_weeks', 'single_source_items', 'bundle_saving:X', 'lead_weeks:BW-1', 'peer_cut_in_shift_weeks'].every(isTimelineSupplyKey));
  assert.ok(!['unit_cost_delta:vesper', 'one_time_total', 'net_total_year_one', 'detail', ''].some(isTimelineSupplyKey));
});

test('supplier codes are shown as a person would write them', () => {
  assert.equal(supplierName('SUP-HALDEN'), 'Halden');
  assert.equal(supplierName('SUP-ORRIN'), 'Orrin');
});

// ---- the dispatcher and publisher on a client cache ---------------------------------------------------------

const at = (micros: bigint) => ({ microsSinceUnixEpoch: micros });
type Row = { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string };
/** Just enough of the client cache for factsOf, jobFactsOf and gather: check runs and results of one ECR (id 5). A run's results are stamped when it completed. */
function cache(o: { runs: RunRow[]; results: { id: number; run: number; row: Row; mock?: boolean }[]; statements?: any[] }) {
  const runRows = o.runs.map(r => ({
    id: r.id,
    prId: 5n,
    stage: r.stage,
    status: r.status,
    inputHash: r.inputHash,
    createdAt: at(r.createdUs),
    startedAt: r.startedUs === null ? undefined : at(r.startedUs),
    finishedAt: r.finishedUs === null ? undefined : at(r.finishedUs),
    inputsJson: JSON.stringify({ revision: r.revision, revisionSource: 'plm', erpBaseline: '2c02958e00', erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24', ...(r.upstreamS1 ? { upstream: { s1_bom_delta: r.upstreamS1 } } : {}) }),
  }));
  const completed = new Map(o.runs.map(r => [Number(r.id), r.completedUs ?? r.finishedUs ?? r.createdUs]));
  const resultRows = o.results.map(x => ({ ...x.row, id: BigInt(x.id), prId: 5n, checkRunId: BigInt(x.run), mock: x.mock ?? false, createdAt: at(completed.get(x.run) ?? us(T0)) }));
  const by = <T>(rows: T[]) => ({ filter: (id: bigint) => (id === 5n ? rows : []) });
  return {
    pullRequest: {},
    ecrRevision: { prId: by([{ seq: 1, current: true, createdAt: { toDate: () => new Date(T0) }, prId: 5n }]) },
    impactStatement: { prId: by((o.statements ?? []).map(s => ({ ...s, prId: 5n }))) },
    agentEvent: { prId: by([]) },
    checkRun: { prId: by(runRows), id: { find: (id: bigint) => runRows.find(r => r.id === id) } },
    checkResult: { prId: by(resultRows) },
    nornConfig: { key: { find: () => null } },
  } as any;
}
const pr5 = { id: 5n, plmEcrNumber: 'ECR-0417', title: 'Motor-controller mounting bracket', status: 'review', revision: 3 } as any;
const withRun = (rows: object[], run: number, first: number) => rows.map((row: any, i) => ({ id: first + i, run, row }));
const s1 = run(2, 's1_bom_delta', 'done', { createdUs: us(T0) });
/** The finished runs of an ECR with the real rows: s1 is run 2, s2 run 3 (completed at T0+10 s), s3 run 4, s4 run 5. */
function healthy(ecr = 'ECR-0417', extraRuns: RunRow[] = [], extraResults: ReturnType<typeof withRun> = []) {
  return cache({
    runs: [s1, s2, done(4, 's3_timeline'), done(5, 's4_supply'), ...extraRuns],
    results: [...withRun(storedRows(ecr), 3, 1000), ...withRun(storedTimelineRows(ecr), 4, 2000), ...withRun(storedSupplyRows(ecr), 5, 3000), ...extraResults],
  });
}
const factsFor0417 = () => jobFactsOf(healthy(), pr5, 1, 3);

test('factsOf: the dispatcher waits while s4 is running and starts once it has finished', () => {
  const rows = [s1, s2, done(4, 's3_timeline')];
  const waiting = cache({ runs: [...rows, run(5, 's4_supply', 'running', { createdUs: us(T0) })], results: [] });
  const f = factsOf(waiting, pr5, 'level1-statement').s2Done[0]!;
  assert.deepEqual(f.siblings, { pending: true, cutoffUs: siblingCutoffUs(s2) });
  assert.equal(decide({ ...ecrFacts(f.siblings), s2Done: [{ ...f, id: 3, inputsRevision: 1, mock: false }] }, opts({ nowMs: T0 + 20_000 })).action, 'skip');
  const settled = factsOf(cache({ runs: [...rows, done(5, 's4_supply')], results: [] }), pr5, 'level1-statement').s2Done[0]!;
  assert.equal(settled.siblings?.pending, false);
});

test('jobFactsOf: the agent posts the cost numbers only, none of the timeline and supply ones; it gets their sentences, and ECR-0417 has six conditions', () => {
  const facts = jobFactsOf(healthy(), pr5, 1, 3);
  assert.deepEqual(
    facts.numbers.map(x => x.resultKey),
    ['unit_cost_delta:vesper', 'unit_cost_delta:meridian', 'one_time_total', 'net_total_year_one'],
    'the module never has a timeline or supply number to check against a newer run'
  );
  assert.ok(facts.numbers.length <= 12);
  assert.equal(facts.recommendation?.recommendation, 'Approve with conditions');
  assert.equal(facts.recommendation?.rule, 2);
  assert.equal(facts.recommendation?.conditions.length, 6);
  assert.equal(facts.timelineSupply?.timeline.length, 2);
  const p = jobPrompt(facts);
  assert.ok(!['cut_in_date', 'late_weeks', 'single_source_items', 'cut_in_serial'].some(k => p.includes(`resultKey "${k}"`)));
  assert.ok(p.includes(`One claim starting "${TIMELINE_CLAIM}" (evidence "computation")`) && p.includes(`One claim starting "${SUPPLY_CLAIM}" (evidence "computation")`));
  assert.ok(p.includes('The change can first reach the line on 2027-02-16') && p.includes('likelihood it is late: almost certain (95-99%)'));
  assert.ok(p.includes('and the median date it reaches the line'));
  assert.ok(p.includes('CCB to accept slip to 2027-02-16 (S/N 15)'));
  assert.ok(!/branch|merge|pull request/i.test(p.replace(/Never use:[^\n]*/, '')), 'business words only');
});

test('jobFactsOf: ECR-0423 gets Approve, no condition and a quiet pair of claims', () => {
  const facts = jobFactsOf(healthy('ECR-0423'), { ...pr5, plmEcrNumber: 'ECR-0423' }, 1, 3);
  assert.equal(facts.recommendation?.recommendation, 'Approve');
  assert.deepEqual(facts.recommendation?.conditions, []);
  assert.deepEqual(facts.numbers.map(x => x.resultKey).filter(isTimelineSupplyKey), []);
});

test('a failed s4 does not stop Level 1: the agent is told the supply check is not available and the rule names it', () => {
  const c = cache({
    runs: [s1, s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed', { createdUs: us(T0), finishedUs: us(T0 + 11_000) })],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000)],
  });
  const facts = jobFactsOf(c, pr5, 1, 3);
  assert.deepEqual(facts.timelineSupply?.unavailable, [{ check: 'supply', why: 'it failed' }]);
  assert.equal(facts.recommendation?.recommendation, 'Approve with conditions');
  assert.equal(facts.recommendation?.conditions.length, 7, 'three cost lines, the two unassessed-implementation gaps and the slip from the timeline, the missing check');
  assert.equal(facts.recommendation?.conditions[6], 'The supply check failed, so it is not assessed');
  const p = jobPrompt(facts);
  assert.ok(p.includes('saying the supply check is not available because it failed'));
  assert.ok(p.includes('The change can first reach the line on 2027-02-16'), 'the timeline is still there');
});

// ---- the snapshot is frozen: Sol's case and its mirror -----------------------------------------------------

/** What the dispatcher tells the agent and what the publisher shows, for one cache: run ids, rule, prompt sentences and the PLM text. */
function resolved(c: any, statementAtMs = T0 + 120_000) {
  const sib = siblingsForRun(c, 5n, 3n)!;
  const facts = jobFactsOf(c, pr5, 1, 3);
  const stmt = statementFor('ECR-0417');
  c.impactStatement = { prId: { filter: () => [{ id: 12n, level: 1, prRevision: 3, checkRunId: 3n, createdAt: { toDate: () => new Date(statementAtMs) }, changeClass: 'Class I', route: 'r', headline: 'h', author: null, numbers: stmt.numbers, drivers: [], assumptions: [], claims: stmt.claims }] } };
  const g = gather(c, pr5)!;
  const html = statementToPlmFields(g.statement, g.ecr, g.prov, o).fields.impact_statement as string;
  return { dispatchRuns: [sib.timeline.runId, sib.supply.runId], publishRuns: [g.prov.timelineRunId, g.prov.supplyRunId], states: [sib.timeline.state, sib.supply.state], conditions: facts.recommendation!.conditions, told: facts.timelineSupply, ruleConditions: deriveRecommendation(g.prov.ruleInput!).conditions, html };
}

test('(a) dispatch resolves run 5; a run 9 is created inside the window and finishes before the cutoff; publication still resolves run 5, with the same rows', () => {
  const atDispatch = resolved(healthy());
  assert.deepEqual(atDispatch.dispatchRuns, [4, 5]);
  // later, a peer ECR changed: s4 re-ran (run 9, created after s2, completed inside the 30 s window) with other numbers
  const rerunRows = withRun(storedSupplyRows('ECR-0421'), 9, 4000);
  const rerun = done(9, 's4_supply', { createdUs: us(T0 + 2_000), startedUs: us(T0 + 2_000), finishedUs: us(T0 + 12_000), completedUs: us(T0 + 12_000) });
  const staled5 = { ...done(5, 's4_supply'), status: 'stale', finishedUs: us(T0 + 2_000) }; // run 5 went stale when run 9 was queued
  const later = resolved(cache({
    runs: [s1, s2, done(4, 's3_timeline'), staled5, rerun],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000), ...withRun(storedSupplyRows('ECR-0417'), 5, 3000), ...rerunRows],
  }));
  assert.deepEqual(later.dispatchRuns, [4, 5], 'a dispatcher looking now still resolves run 5');
  assert.deepEqual(later.publishRuns, [4, 5], 'and so does the publisher');
  assert.deepEqual(later.states, ['ready', 'ready']);
  assert.deepEqual(later.conditions, atDispatch.conditions);
  assert.deepEqual(later.told, atDispatch.told);
  assert.equal(later.html, atDispatch.html, 'the PLM text is byte for byte the one built from run 5');
  assert.ok(!later.html.includes('bundle_saving') && !later.html.includes('Ordering together'), "none of run 9's numbers");
});

test('(b) a sibling created before s2 that finishes after the cutoff is unavailable at dispatch and at publication, even when publication is evaluated after it has finished', () => {
  const late = (completedUs: bigint | null, status = 'done') => run(4, 's3_timeline', status, { createdUs: us(T0 - 1_000), startedUs: us(T0 - 1_000), finishedUs: completedUs, ...(completedUs ? { completedUs } : {}) });
  const make = (s3: RunRow) => cache({ runs: [s1, s2, s3, done(5, 's4_supply')], results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...(s3.completedUs ? withRun(storedTimelineRows('ECR-0417'), 4, 2000) : []), ...withRun(storedSupplyRows('ECR-0417'), 5, 3000)] });
  // dispatch, once the cutoff has passed: still running. The dispatcher goes ahead and the timeline is unavailable.
  const running = make(late(null, 'running'));
  const f = factsOf(running, pr5, 'level1-statement').s2Done[0]!;
  assert.deepEqual(f.siblings, { pending: true, cutoffUs: CUTOFF });
  assert.equal(decide({ ...ecrFacts(f.siblings) }, opts({ nowMs: CUTOFF_MS - 1 })).action, 'skip', 'before the cutoff it waits');
  assert.equal(decide({ ...ecrFacts(f.siblings) }, opts({ nowMs: CUTOFF_MS })).action, 'skip', 'at the cutoff it still waits');
  assert.equal(decide({ ...ecrFacts(f.siblings) }, opts({ nowMs: GO_MS })).action, 'skip', 'and through the grace');
  assert.equal(decide({ ...ecrFacts(f.siblings) }, opts({ nowMs: GO_MS + 1 })).action, 'dispatch', 'after it, it goes');
  const atDispatch = resolved(running);
  assert.deepEqual(atDispatch.states, ['pending', 'ready']);
  assert.deepEqual(atDispatch.told?.unavailable, [{ check: 'timeline', why: 'it had not finished in time' }]);
  assert.ok(atDispatch.html.includes('The timeline check had not finished when this assessment was made.'));
  // publication, later: that run has since finished, 20 s after the cutoff. Still unavailable, the same words, the same conditions.
  const finished = resolved(make(late(CUTOFF + 20_000_000n)), CUTOFF_MS + 60_000);
  assert.deepEqual(finished.states, ['pending', 'ready']);
  assert.deepEqual(finished.ruleConditions, atDispatch.ruleConditions);
  assert.deepEqual(finished.conditions, atDispatch.conditions);
  assert.ok(finished.html.includes('The timeline check had not finished when this assessment was made.'));
  assert.ok(!finished.html.includes('Earliest cut-in date'), 'none of its numbers in the table, though it has finished since');
  assert.equal(finished.conditions[3], 'The timeline check had not finished when this assessment was made, so it is not assessed');
});

test('the statement rests on its own runs when an unrelated later s4 failed, and on the failure when it had failed inside the window', () => {
  const c = healthy('ECR-0417', [run(9, 's4_supply', 'failed', { createdUs: us(T0 + 2_000), finishedUs: CUTOFF + 2_000_000n })]);
  const g = resolved(c);
  assert.deepEqual(g.states, ['ready', 'ready']);
  assert.ok(!g.html.includes('The supply check'));
  const d = resolved(cache({
    runs: [s1, s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed', { createdUs: us(T0), finishedUs: us(T0 + 11_000) })],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000)],
  }));
  assert.deepEqual(d.states, ['ready', 'failed']);
  assert.ok(d.html.includes('The supply check failed.'));
});

test('siblingsForRun binds nothing for no run or a run that is not an s2_cost run', () => {
  const c = healthy();
  assert.equal(siblingsForRun(c, 5n, 0n), undefined, 'no run, nothing bound');
  assert.equal(siblingsForRun(c, 5n, 4n), undefined, 'a run that is not an s2_cost run binds nothing');
});

// ---- the PLM text -------------------------------------------------------------------------------------------

/** The statement an agent would post: the cost numbers (none of the timeline or supply ones) and its two claims. */
const statementFor = (ecr: string, over: Partial<StatementDoc> = {}): StatementDoc => {
  const t = real(ecr);
  const rows = storedRows(ecr);
  const pick = (k: string) => rows.find(r => r.key === k)!;
  const keys = ['unit_cost_delta:vesper', 'one_time_total', 'net_total_year_one'];
  const f = timelineSupplyFacts(t.timeline, t.supply);
  return {
    id: 12,
    level: 1,
    prRevision: 3,
    createdAtIso: '2026-10-24T20:42:11.000Z',
    changeClass: 'Class I',
    route: "Pending Norn's routing",
    headline: 'ECR-0417 adds money, and the change reaches the line on 2027-02-16 at the median.',
    numbers: keys.filter(k => rows.some(r => r.key === k)).map(k => ({ key: k.replace(/[^A-Za-z0-9_]/g, '_'), label: pick(k).label, unit: pick(k).unit, p10: pick(k).p10, p50: pick(k).p50, p90: pick(k).p90, evidence: 'computation', resultKey: k })),
    drivers: [],
    assumptions: [],
    claims: [
      { text: 'Recommendation: Approve with conditions. Rule 2: three cost lines are blank.', evidence: 'judgment' },
      ...(f.timeline.length ? [{ text: `${TIMELINE_CLAIM}${f.timeline.join(' ')}`, evidence: 'computation' }] : []),
      ...(f.supply.length ? [{ text: `${SUPPLY_CLAIM}${f.supply.join(' ')}`, evidence: 'computation' }] : []),
    ],
    ...over,
  };
};

const ecr417 = { number: 'ECR-0417', title: 'Motor-controller mounting bracket', revision: 1 };
const o = { nornBaseUrl: 'http://127.0.0.1:5173' };
const provFor = (ecr: string, t = real(ecr), over = {}) => ({
  baseline: 'ERPNext baseline 2c02958e, as of 2026-10-24',
  changeRequest: 'change request rev 1 from the PLM',
  codeVersion: 'checks-0.3.0',
  draws: 10000,
  s2RunId: 3,
  timelineRunId: 4,
  supplyRunId: 5,
  timelineSupplyNumbers: tableNumbers(t.timeline, t.supply),
  formulas: {},
  mock: false,
  ruleInput: ruleInputOf(storedRows(ecr), [], ruleSiblingsOf(t, ecr)),
  ...over,
});

test('the PLM text has its own "Timeline and supply" section after the cost numbers, built from the bound runs, though the statement carries none of its numbers', () => {
  const stmt = statementFor('ECR-0417');
  assert.ok(!stmt.numbers.some(n => isTimelineSupplyKey(n.resultKey)), 'the agent posted none');
  const f = statementToPlmFields(stmt, ecr417, provFor('ECR-0417'), o);
  const html = f.fields.impact_statement as string;
  const iCost = html.indexOf('Headline numbers');
  const iTs = html.indexOf('Timeline and supply</h5>');
  const iRests = html.indexOf('Change class and approval route');
  assert.ok(iCost > 0 && iTs > iCost && iRests > iTs, 'after the headline numbers, before the class and route');
  const section = html.slice(iTs, html.indexOf('<h5', iTs + 10) > 0 ? html.indexOf('<h5', iTs + 10) : undefined);
  for (const w of ['Earliest cut-in date', '2027-01-13', '2027-02-16', '2027-04-11', 'S/N 15', 'S/N 13', 'S/N 18', '8.3 weeks', '13.1 weeks', '20.9 weeks', 'Changed parts with one qualified source', '1 part', 'same', 'Timeline: The change can first reach the line', 'Supply: BW-5120-210 (Halden)', 'almost certain (95-99%)']) assert.ok(section.includes(w), w);
  const cost = html.slice(iCost, iTs);
  assert.ok(!cost.includes('Earliest cut-in date') && !cost.includes('Changed parts'));
  assert.ok(!/208\d\d/.test(html), 'no raw day numbers');
  assert.ok(!html.includes('Also noted'), 'the two claims are in their section, not repeated');
  assert.ok(html.includes("Timeline and supply: computed by Norn's timeline and supply checks (timeline run 4, supply run 5)"));
  assert.ok(!/\b(branch|merge|pull request)\b/i.test(html), 'business words only');
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(f.overridden, undefined);
});

test('a check that is not available is said so in its section from the run\'s state, whatever the agent wrote, and the recommendation names it', () => {
  const t = { timeline: real('ECR-0417').timeline, supply: view([], 'failed') };
  const claims = [{ text: 'Recommendation: Approve with conditions. Rule 2.', evidence: 'judgment' }];
  const stmt = statementFor('ECR-0417', { claims });
  const f = statementToPlmFields(stmt, ecr417, provFor('ECR-0417', t as any), o);
  const html = f.fields.impact_statement as string;
  assert.ok(html.includes('The supply check failed.') && html.includes('No supplier finding is assessed.'));
  assert.ok(!html.includes('The timeline check'), 'only the check that is missing');
  assert.ok(!html.includes('Changed parts with one qualified source'), 'no supply number from a check that is not there');
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(f.overridden, undefined, 'the agent agreed: its own words stand');
  assert.ok(deriveRecommendation(provFor('ECR-0417', t as any).ruleInput!).conditions.includes('The supply check failed, so it is not assessed'), 'and the rule names the missing check among its conditions');
  const none = statementToPlmFields(statementFor('ECR-0417'), ecr417, provFor('ECR-0417', { timeline: view([], 'pending'), supply: view([], 'pending') } as any), o).fields.impact_statement as string;
  assert.ok(none.includes('The timeline check had not finished when this assessment was made.') && none.includes('The supply check had not finished when this assessment was made.'));
});

test('a statement with no timeline or supply content has no such section (a Level 1 posted before this change)', () => {
  const old = statementFor('ECR-0417', { claims: [{ text: 'Recommendation: Approve with conditions. Rule 2.', evidence: 'judgment' }] });
  const html = statementToPlmFields(old, ecr417, { baseline: 'b', changeRequest: 'c', formulas: {}, mock: false }, o).fields.impact_statement as string;
  assert.ok(!html.includes('Timeline and supply'));
});

test('a timeline or supply number an older statement still carries is shown when no bound runs are given, and ignored when they are', () => {
  const t = real('ECR-0417');
  const row = t.timeline.rows.find(r => r.key === 'cut_in_serial')!;
  const carried = { key: 'cut_in_serial', label: row.label, unit: row.unit, p10: row.p10, p50: row.p50, p90: row.p90, evidence: 'computation', resultKey: 'cut_in_serial' };
  const stmt = statementFor('ECR-0417', { numbers: [...statementFor('ECR-0417').numbers, carried] });
  const without = statementToPlmFields(stmt, ecr417, { baseline: 'b', changeRequest: 'c', formulas: {}, mock: false }, o).fields.impact_statement as string;
  assert.ok(without.includes('First serial that can take the change') && without.includes('Timeline and supply</h5>'));
  const withRuns = statementToPlmFields(stmt, ecr417, provFor('ECR-0417'), o).fields.impact_statement as string;
  assert.equal(withRuns.split('First serial that can take the change').length - 1, 1, 'shown once, from the bound runs');
});

// ---- the agent's words against the rule's findings (#123, round 2) ---------------------------------------------

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ecr421 = { number: 'ECR-0421', title: 'Bracket', revision: 1 };

test('(f) ECR-0421: the PLM text lists every derived condition by code, whatever the agent wrote, and says so when its wording is "clean"', () => {
  const prov = provFor('ECR-0421');
  const derived = deriveRecommendation(prov.ruleInput!);
  assert.equal(derived.recommendation, 'Approve with conditions');
  assert.ok(derived.conditions.some(c => c.startsWith('Resolve the supplier slot conflict with ECR-0419')), 'the rule has the supplier conflict');
  // Sol's reproduction: the agent agrees with the recommendation, says the checks are clean, quotes a figure no check has, and leaves the conditions out
  const said = statementFor('ECR-0421', { headline: 'Checks are clean. The change costs $999,999 a year.', claims: [{ text: 'Recommendation: Approve with conditions. Rule 2: some cost lines are blank.', evidence: 'judgment' }] });
  const html = statementToPlmFields(said, ecr421, prov, o).fields.impact_statement as string;
  for (const c of derived.conditions) assert.ok(html.includes(escHtml(c)), `condition shown: ${c}`);
  assert.ok(html.includes('Resolve the supplier slot conflict with ECR-0419') && html.includes('CCB to accept slip'));
  assert.ok(html.includes('Checks are clean.'), "the agent's prose is not rewritten");
  assert.ok(html.includes("Wording elsewhere in this statement that says there are none is the agent's, and the checks stand."), 'and the page says the checks stand');
  assert.ok(!/[\u2014\u2013]/.test(html.slice(html.indexOf('Conditions for the CCB'), html.indexOf('Headline numbers'))), 'no dashes in the rule-written part');
  // an agent that says nothing of the conditions still gets them shown, with no note when its wording is fine
  const quiet = statementToPlmFields(statementFor('ECR-0421', { claims: [{ text: 'Recommendation: Approve with conditions. Rule 2.', evidence: 'judgment' }] }), ecr421, prov, o).fields.impact_statement as string;
  for (const c of derived.conditions) assert.ok(quiet.includes(escHtml(c)), `condition shown: ${c}`);
  assert.ok(!quiet.includes('Wording elsewhere'));
  // when the reasoning is the rule's own (the agent wrote none, or disagreed) the conditions are in it once, not listed twice
  const none = statementToPlmFields(statementFor('ECR-0421', { claims: [] }), ecr421, prov, o).fields.impact_statement as string;
  assert.equal(none.split('Resolve the supplier slot conflict with ECR-0419').length - 1, 1);
});

test('(f) the post tool refuses clean wording and an invented figure while the rule has conditions, and accepts a statement without them', () => {
  const db = healthy('ECR-0421');
  const guard = statementGuardFor(db);
  const by = 'norn:check_run:3';
  const claim = (text: string) => ({ text, evidence: 'judgment' });
  const pr0421 = { ...pr5, plmEcrNumber: 'ECR-0421' };
  const post = (headline: string, claims: { text: string }[] = [claim('Recommendation: Approve with conditions. Rule 2: the conditions are listed.')], spawnedBy = by) => guard(pr0421, spawnedBy, { headline, drivers: [], claims });
  const net = storedRows('ECR-0421').find(r => r.key === 'net_total_year_one')!;
  const good = `The change costs ${usd(net.p10)} to ${usd(net.p90)} over 12 months.`;
  assert.equal(post(good), undefined, 'figures as get_impact shows them are fine');
  assert.equal(post(`About $${Math.round(net.p50 / 1000)}k over 12 months, with $${(Math.round(net.p50 / 10_000) / 100).toFixed(2)} million as the median.`), undefined, 'rounded the way a person writes them');
  assert.equal(post('Nothing here needs more than a routine look.'), undefined, 'the sentence the prompt prescribes is about the cost bars');
  assert.equal(post(good, [claim('Recommendation: Approve with conditions. Rule 2. There is no conflict with other ECRs on the cut-in.')]), undefined, 'a specific negative is not "no issues"');
  // the clean wording is refused, with what was found, in words the agent can act on
  const clean = post('Checks are clean.')!;
  assert.match(clean, /^Not posted\. Your headline says "clean", but Norn's checks found \d+ items for ECR-0421: \(1\) /);
  assert.ok(clean.includes('Resolve the supplier slot conflict with ECR-0419') && clean.includes('CCB to accept slip'), 'it names the derived conditions');
  assert.ok(clean.endsWith('post again.'));
  assert.ok(/no issues/.test(post(good, [claim('Recommendation: Approve with conditions. There are no issues.')])!));
  assert.ok(/nothing to flag/i.test(post(good, [claim('Recommendation: Approve with conditions. Nothing to flag here.')])!));
  // the invented figure
  const invented = post('The change costs $999,999 a year.')!;
  assert.match(invented, /^Not posted\. The \$999,999 in your headline is not in any check result of ECR-0421\. /);
  assert.ok(invented.endsWith('post again.'));
  assert.match(post('Clean. And $999,999.')!, /headline says "Clean".*\$999,999/);
  // sessions that no check run started are not checked here
  assert.equal(post('Checks are clean. $999,999.', undefined, 'Norn'), undefined);
  // and when the rule finds nothing, "clean" is true
  const calm = statementGuardFor(healthy('ECR-0423'));
  const calmInput = ruleInputForRun(healthy('ECR-0423'), 5n, 3n, 'ECR-0423')!.input;
  const calmFindings = findingsOf(calmInput, deriveRecommendation(calmInput));
  assert.equal(calmFindings.length, 0, "ECR-0423's own checks found nothing; ECR-0406's flags in its supply check are not its findings");
  assert.equal(calm({ ...pr5, plmEcrNumber: 'ECR-0423' }, by, { headline: 'Checks are clean.', drivers: [], claims: [] }), undefined);
});

// ---- the #147 merge: peers' flags, the cost check's copies of the timeline's, and its scenario flag ---------------

const peerGap = { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0406', message: 'Qualification, release or retrofit prerequisites have not all been assessed.' };

test('ECR-0423 stays a plain Approve with no condition when its supply check carries a peer ECR-0406 implementation_unestimated warn, on every path that builds the rule input', () => {
  // the real fixture carries it: the supply check runs ECR-0406 through the same book
  const s4flags = (JSON.parse(real('ECR-0423').supply.rows.find(r => r.key === 'detail')!.detailJson).flags as { kind: string; severity: string; ref: string }[]).filter(f => f.kind === 'implementation_unestimated');
  assert.deepEqual(s4flags.map(f => `${f.severity}:${f.ref}`), ['warn:implementation:ECR-0406']);
  // and a synthetic one, pinned explicitly
  const supply = flagOnly([peerGap, { kind: 'no_stated_effectivity', severity: 'info', ref: 'stated:ECR-0406', message: 'x' }]);
  const d = rule('ECR-0423', real('ECR-0423').timeline, supply);
  assert.equal(d.recommendation, 'Approve');
  assert.deepEqual(d.conditions, []);
  // the same flag in ECR-0406's own check is a condition of 0406
  assert.deepEqual(ruleCheckOf(supply, 'ECR-0406').flags?.map(f => f.ref), ['implementation:ECR-0406', 'stated:ECR-0406']);
  // every caller: the dispatcher's facts, the guard's input and the publisher's gather
  const facts = jobFactsOf(healthy('ECR-0423'), { ...pr5, plmEcrNumber: 'ECR-0423' }, 1, 3);
  assert.equal(facts.recommendation?.recommendation, 'Approve');
  assert.deepEqual(facts.recommendation?.conditions, []);
  const guardInput = ruleInputForRun(healthy('ECR-0423'), 5n, 3n, 'ECR-0423')!.input;
  assert.equal(deriveRecommendation(guardInput).recommendation, 'Approve');
  const c = healthy('ECR-0423');
  const stmt = statementFor('ECR-0423');
  c.impactStatement = { prId: { filter: () => [{ id: 12n, level: 1, prRevision: 3, checkRunId: 3n, createdAt: { toDate: () => new Date(T0 + 120_000) }, changeClass: 'Class I', route: 'r', headline: 'h', author: null, numbers: stmt.numbers, drivers: [], assumptions: [], claims: stmt.claims }] } };
  const g = gather(c, { ...pr5, plmEcrNumber: 'ECR-0423' })!;
  assert.equal(deriveRecommendation(g.prov.ruleInput!).recommendation, 'Approve');
  assert.deepEqual(deriveRecommendation(g.prov.ruleInput!).conditions, []);
});

test('flagsOf with an ECR keeps its own flags, flags that name no ECR, and an unreadable peer (a gap of this check), and drops the other ECRs', () => {
  const v = flagOnly([
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423', message: 'own' },
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0406:retrofit', message: 'peer retrofit' },
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0042:task-1', message: 'peer task' },
    { kind: 'no_price', severity: 'warn', ref: 'BW-1', message: 'part' },
    { kind: 'slot_contention', severity: 'warn', message: 'no ref' },
    { kind: 'unreadable_peer', severity: 'warn', ref: 'ECR-0999', message: 'peer unreadable' },
  ]);
  assert.deepEqual(flagsOf(v, 'ECR-0423').map(f => f.message), ['own', 'part', 'no ref', 'peer unreadable']);
  assert.equal(flagsOf(v).length, 6, 'without an ECR nothing is dropped (older callers)');
  // ECR-04230 is not ECR-0423
  assert.equal(flagsOf(flagOnly([{ kind: 'x', severity: 'warn', ref: 'implementation:ECR-04230', message: 'm' }]), 'ECR-0423').length, 0);
});

test("an unestimated implementation of the statement's own ECR is a condition, in short fixed wording, once however many checks carry it", () => {
  const own = [
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423', message: 'Qualification, release or retrofit prerequisites have not all been assessed. Dates show material readiness only; implementation may be later.' },
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423:retrofit', message: 'Retrofit execution, installation/retest and aircraft downtime have not been assessed.' },
    { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423:inspect', message: 'Inspect brackets: no owner is assigned.' },
  ];
  const d = rule('ECR-0423', flagOnly(own), flagOnly(own));
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.deepEqual(d.conditions, ['Qualification and release not assessed', 'Retrofit work and downtime not assessed', 'Inspect brackets: no owner is assigned.']);
});

/** The ECR's cost rows with these flags added to the s2 detail, and the extra detail fields. */
const costRowsWith = (ecr: string, flags: object[], extra: object = {}) =>
  storedRows(ecr).map(r => {
    if (r.key !== 'detail') return r;
    const d = JSON.parse(r.detailJson);
    return { ...r, detailJson: JSON.stringify({ ...d, flags: [...(d.flags ?? []), ...flags], ...extra }) };
  });
const copy = (kind: string) => ({ kind, severity: 'warn', ref: 'implementation-scenario:ECR-0423', message: `${kind} copied from the timeline` });
const emptyCheck = view([{ key: 'detail', label: 'd', unit: 'json', p10: 0, p50: 0, p90: 0, detailJson: '{}' }]);

test("the cost check's copies of the timeline's warns (ref implementation-scenario:<ECR>) are not a second condition when the timeline is in hand; without it they are conditions as before", () => {
  const copies = [copy('likely_late'), copy('implementation_unestimated'), copy('beyond_published_slots'), copy('cut_in_beyond_plan')];
  const rows = costRowsWith('ECR-0423', copies);
  const sib = (timeline: SiblingView) => ruleSiblingsOf({ timeline, supply: emptyCheck }, 'ECR-0423');
  // with the timeline and supply checks (nothing to say): the copies add nothing
  const quiet = deriveRecommendation(ruleInputOf(rows, [], sib(emptyCheck)));
  assert.deepEqual(quiet.conditions, []);
  assert.equal(quiet.recommendation, 'Approve');
  // the same fact from the timeline check is one condition, not two
  const own = flagOnly([{ kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423', message: 'long message' }]);
  assert.deepEqual(deriveRecommendation(ruleInputOf(rows, [], sib(own))).conditions, ['Qualification and release not assessed']);
  // a likely_late copy does not skip the 14-day bar: a P90 slip of 1.5 weeks gives no condition from the timeline, so none at all
  const lateFlag = { kind: 'likely_late', severity: 'warn', ref: 'stated:ECR-0423', message: 'late' };
  const small: SiblingView = { state: 'ready', runId: 1, rows: [{ key: 'late_weeks', label: 'l', unit: 'weeks', p10: 0.5, p50: 1, p90: 1.5, detailJson: '{}' }, ...flagOnly([lateFlag]).rows] };
  assert.equal(deriveRecommendation(ruleInputOf(rows, [], sib(small))).recommendation, 'Approve');
  // a pending timeline check: its absence is the one condition; the copies do not repeat the facts
  assert.deepEqual(deriveRecommendation(ruleInputOf(rows, [], sib(view([], 'pending')))).conditions, ['The timeline check had not finished when this assessment was made, so it is not assessed']);
  // a caller with no sibling input (an older statement) behaves as it did: every s2 warn is a condition
  assert.deepEqual(deriveRecommendation(ruleInputOf(rows, [])).conditions, copies.map(c => c.message));
  // a warn of the cost check's own with the same kind but another ref is not a copy
  const own2 = deriveRecommendation(ruleInputOf(costRowsWith('ECR-0423', [{ ...lateFlag, message: 'own late' }]), [], sib(emptyCheck)));
  assert.deepEqual(own2.conditions, ['own late']);
});

test("the cost check's implementation_scenario warn is a gap only when the alternative could not be costed; not_converged still sends it back", () => {
  const costed = { kind: 'implementation_scenario', severity: 'warn', ref: 'implementation-scenario:ECR-0423', message: 'Primary costs assume requested S/N 11; the implementation median is S/N 15. The separately costed scenario excludes unestimated delay and support costs.' };
  const unplaced = { kind: 'implementation_scenario', severity: 'warn', ref: 'implementation-scenario:ECR-0423', message: 'Implementation cannot be placed in the volume plan. Primary costs remain a requested-effectivity scenario; feasible implementation cost is unknown.' };
  const sib = ruleSiblingsOf({ timeline: emptyCheck, supply: emptyCheck }, 'ECR-0423');
  const withAlt = { implementationScenario: { alternative: { net: {} } } };
  const a = deriveRecommendation(ruleInputOf(costRowsWith('ECR-0423', [costed], withAlt), [], sib));
  assert.equal(a.recommendation, 'Approve', 'costed: information about the basis, not a gap');
  assert.deepEqual(a.conditions, []);
  const b = deriveRecommendation(ruleInputOf(costRowsWith('ECR-0423', [unplaced], { implementationScenario: { alternative: null } }), [], sib));
  assert.equal(b.recommendation, 'Approve with conditions');
  assert.deepEqual(b.conditions, ['Implementation cannot be placed in the volume plan, so its feasible cost is unknown']);
  // the same without any timeline input (older statements): costed is still no gap
  assert.deepEqual(deriveRecommendation(ruleInputOf(costRowsWith('ECR-0423', [costed], withAlt), [])).conditions, []);
  // the alternative's own cost forecast not converging blocks, as on main
  const nc = deriveRecommendation(ruleInputOf(costRowsWith('ECR-0423', [{ kind: 'not_converged', severity: 'warn', ref: 'implementation-scenario:ECR-0423', message: 'The alternative implementation-cost scenario did not converge.' }], withAlt), [], sib));
  assert.equal(nc.recommendation, 'Send back');
  assert.equal(nc.rule, 1);
});

// ---- #123 round 3: every displayed field, scoped and negated wording --------------------------------------------

/** One statement with this text in each field the PLM page and the web page show from the agent, one at a time. */
/** The position the added number takes in the base statement. */
const ADDED = () => statementFor('ECR-0421').numbers.length + 1;
const fieldsWith = (text: string): Record<string, (base: StatementDoc) => StatementDoc> => ({
  headline: b => ({ ...b, headline: text }),
  'change class': b => ({ ...b, changeClass: text }),
  'approval route': b => ({ ...b, route: text }),
  [`number ${ADDED()} label`]: b => ({ ...b, numbers: [...b.numbers, { key: 'extra', label: text, unit: 'USD', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }] }),
  [`number ${ADDED()} unit`]: b => ({ ...b, numbers: [...b.numbers, { key: 'extra', label: 'Extra', unit: text, p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }] }),
  'driver 1': b => ({ ...b, drivers: [{ text, evidence: 'judgment' }] }),
  'assumption 1 note': b => ({ ...b, assumptions: [{ key: 'baseline:scrap', source: 'default', note: text }] }),
  [`claim ${statementFor('ECR-0421').claims.length + 1}`]: b => ({ ...b, claims: [...b.claims, { text, evidence: 'judgment' }] }),
});
/** The same statement as the tool receives it (post_impact_statement's arguments). */
const proseOfDoc = (s: StatementDoc) => ({ headline: s.headline, changeClass: s.changeClass, route: s.route, numbers: s.numbers, drivers: s.drivers, assumptions: s.assumptions, claims: s.claims });

test("(round 3) Sol's case and one per field: clean wording or an invented figure in ANY displayed field is refused by the post tool's guard, and noted on the PLM page", () => {
  const guard = statementGuardFor(healthy('ECR-0421'));
  const by = 'norn:check_run:3';
  const pr0421 = { ...pr5, plmEcrNumber: 'ECR-0421' };
  const base = statementFor('ECR-0421');
  assert.equal(guard(pr0421, by, proseOfDoc(base)), undefined, 'the base statement is fine');
  // Sol's exact case: an existing assumption's note
  const sol = guard(pr0421, by, proseOfDoc({ ...base, assumptions: [{ key: 'baseline:scrap', source: 'default', note: 'Checks are clean. The change costs $999,999 a year.' }] }))!;
  assert.match(sol, /^Not posted\. Your assumption 1 note says "clean", but Norn's checks found/);
  assert.match(sol, /The \$999,999 in your assumption 1 note is not in any check result of ECR-0421/);
  const prov = provFor('ECR-0421');
  for (const [where, put] of Object.entries(fieldsWith('Checks are clean.'))) {
    const refused = guard(pr0421, by, proseOfDoc(put(base)));
    assert.match(refused ?? '', new RegExp(`Your ${where} says "clean"`), `guard: ${where}`);
    const html = statementToPlmFields(put(base), ecr421, prov, o).fields.impact_statement as string;
    assert.ok(html.includes("Wording elsewhere in this statement that says there are none is the agent's, and the checks stand."), `page note: ${where}`);
  }
  for (const [where, put] of Object.entries(fieldsWith('It costs $999,999 a year.')))
    assert.match(guard(pr0421, by, proseOfDoc(put(base))) ?? '', new RegExp(`The \\$999,999 in your ${where} is not in any check result`), `figure: ${where}`);
  for (const [where, put] of Object.entries(fieldsWith('It costs 999,999 USD a year.')))
    assert.match(guard(pr0421, by, proseOfDoc(put(base))) ?? '', new RegExp(`The 999,999 USD in your ${where} is not in any check result`), `USD: ${where}`);
  // the words render as written (the guard refuses before they get here; the page still notes any that did)
  const sneaked = statementToPlmFields({ ...base, assumptions: [{ key: 'baseline:scrap', source: 'default', note: 'Checks are clean.' }] }, ecr421, prov, o).fields.impact_statement as string;
  assert.ok(sneaked.includes('baseline:scrap: Checks are clean.'));
  // a statement with none of it gets no note
  assert.ok(!(statementToPlmFields(base, ecr421, prov, o).fields.impact_statement as string).includes('Wording elsewhere'));
});

test('(round 3) "the checks are not clean" is allowed, and "the cost check is clean" only when the cost check found nothing', () => {
  // ECR-0423 with one gap in the timeline check only
  const gap = storedTimelineRows('ECR-0423').map(r => (r.key === 'detail' ? { ...r, detailJson: JSON.stringify({ ...JSON.parse(r.detailJson), flags: [{ kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423', message: 'x' }] }) } : r));
  const db = cache({ runs: [s1, s2, done(4, 's3_timeline'), done(5, 's4_supply')], results: [...withRun(storedRows('ECR-0423'), 3, 1000), ...withRun(gap, 4, 2000), ...withRun(storedSupplyRows('ECR-0423'), 5, 3000)] });
  const guard = statementGuardFor(db);
  const pr0423 = { ...pr5, plmEcrNumber: 'ECR-0423' };
  const post = (headline: string) => guard(pr0423, 'norn:check_run:3', { headline, drivers: [], claims: [{ text: 'Recommendation: Approve with conditions. Rule 2: the timeline check has a gap.' }] });
  assert.equal(post('The checks are not clean: the timeline check found a gap.'), undefined);
  assert.equal(post("The assessment isn't clean."), undefined);
  assert.equal(post('The cost check is clean but the timeline check found a gap.'), undefined);
  assert.equal(post('The cost and supply checks are clean; the timeline check found a gap.'), undefined);
  assert.match(post('The timeline check is clean.') ?? '', /Your headline says "clean"/);
  assert.match(post('Checks are clean.') ?? '', /Your headline says "clean"/);
  assert.match(post('There are no issues.') ?? '', /Your headline says "no issues"/);
  // and with a finding in the cost check, the same words are refused
  const withCost = statementGuardFor(healthy('ECR-0417'))(pr5, 'norn:check_run:3', { headline: 'The cost check is clean.', drivers: [], claims: [] });
  assert.match(withCost ?? '', /Your headline says "clean"/, 'ECR-0417 has blank cost lines');
});

test('(#128) the guard reads the run id from norn:check_run:N and from norn:check_run:N:revision:M alike, and from nothing else', () => {
  const guard = statementGuardFor(healthy('ECR-0417'));
  const pr0417 = { ...pr5, plmEcrNumber: 'ECR-0417' };
  const post = (spawnedBy: string) => guard(pr0417, spawnedBy, { headline: 'Checks are clean.', drivers: [], claims: [] });
  for (const by of ['norn:check_run:3', 'check_run:3', `norn:check_run:3:revision:${pr0417.revision}`])
    assert.match(post(by) ?? '', /^Not posted\. Your headline says "clean"/, by);
  // a session on an older (or newer) ECR revision is left to the module's freshness refusal, which comes first
  for (const by of [`norn:check_run:3:revision:${pr0417.revision - 1}`, `norn:check_run:3:revision:${pr0417.revision + 9}`]) assert.equal(post(by), undefined, by);
  // a session not started by a check run is not checked here, as before; neither is a malformed suffix
  for (const by of ['norn:ecr_filed:3', 'norn:check_run:3:revision:', 'norn:check_run:3:revision:x', 'norn:check_run:3:other:1']) assert.equal(post(by), undefined, by);
});

// ---- Sol round 4 -------------------------------------------------------------------------------------------

test("(rounds 4 to 6) a Level 1 statement's numbers are computations only: any other is refused, whatever its label, key or unit", () => {
  const guard = statementGuardFor(healthy('ECR-0421'));
  const pr0421 = { ...pr5, plmEcrNumber: 'ECR-0421' };
  const base = statementFor('ECR-0421');
  const withNumber = (n: object) => guard(pr0421, 'norn:check_run:3', proseOfDoc({ ...base, numbers: [...base.numbers, n as any] }));
  const told = /A Level 1 statement's numbers are exactly the ones the job names, each evidence computation with its key and resultKey; post it as one of those or leave it out\./;
  // round 4 and 5: Sol's repros
  assert.match(withNumber({ key: 'annual', label: 'Annual cost', unit: 'USD', evidence: 'judgment', p10: 999999, p50: 999999, p90: 999999 }) ?? '', /^Not posted\. Your number \d+ \(Annual cost\) has evidence "judgment"\./);
  assert.match(withNumber({ key: 'x', label: 'Annual cost (USD)', unit: '', evidence: 'judgment', p10: 999999, p50: 999999, p90: 999999 }) ?? '', told);
  assert.match(withNumber({ key: 'x', label: 'Bundle saving', unit: 'kUSD', evidence: 'judgment', p10: 250, p50: 250, p90: 250 }) ?? '', told);
  // round 6: the key as the label, and labels no money test knew
  assert.match(withNumber({ key: 'Annual cost (USD)', unit: 'count', evidence: 'judgment', p10: 999999, p50: 999999, p90: 999999 }) ?? '', /Your number \d+ \(Annual cost \(USD\)\) has evidence "judgment"/);
  for (const label of ['Annual cost (cents)', 'Annual cost (CAD)', 'Annual cost (bucks)', 'Annual cost (¢)', 'Annual cost (＄)'])
    assert.match(withNumber({ key: 'x', label, unit: 'weeks', evidence: 'judgment', p10: 9, p50: 9, p90: 9 }) ?? '', told, label);
  // weeks and percentages too, and an assumption or no evidence at all: the job names no such number
  for (const n of [{ unit: 'weeks', evidence: 'judgment' }, { unit: '%', evidence: 'assumption' }, { unit: 'count' }])
    assert.match(withNumber({ key: 'x', label: 'Retrofit slip', p10: 3, p50: 3, p90: 3, ...n }) ?? '', told, JSON.stringify(n));
  // a computation is never refused for its label, key or unit (the module replaces them with its check result's)
  assert.equal(withNumber({ key: 'y', label: 'Annual cost (USD)', unit: 'kUSD', evidence: 'computation', resultKey: 'net_total_year_one' }), undefined);
  // and Sol's three headlines are refused by the guard
  for (const headline of ['Annual cost: £999,999.', '＄999,999.', '$  999,999.'])
    assert.match(guard(pr0421, 'norn:check_run:3', proseOfDoc({ ...base, headline })) ?? '', /999,999 in your headline is not in any check result of ECR-0421/, headline);
});

test("(round 5) the four ECRs' honest generated statements pass the guard", () => {
  for (const ecr of ['ECR-0417', 'ECR-0419', 'ECR-0421', 'ECR-0423']) {
    const pr = { ...pr5, plmEcrNumber: ecr };
    assert.equal(statementGuardFor(healthy(ecr))(pr, 'norn:check_run:3', proseOfDoc(statementFor(ecr))), undefined, ecr);
  }
});

test("(round 4) Sol's case: a finding both the timeline and the supply check raise is each one's, so \"the supply check is clean\" is refused", () => {
  // ECR-0423 whose test and qualification is "Qualification required; duration not estimated.": both checks raise implementation_unestimated on its own plan
  const own = { kind: 'implementation_unestimated', severity: 'warn', ref: 'implementation:ECR-0423', message: 'Qualification required; duration not estimated.' };
  const withOwn = (rows: { key: string; detailJson: string }[]) => rows.map(r => (r.key === 'detail' ? { ...r, detailJson: JSON.stringify({ ...JSON.parse(r.detailJson), flags: [...(JSON.parse(r.detailJson).flags ?? []), own] }) } : r));
  const db = cache({ runs: [s1, s2, done(4, 's3_timeline'), done(5, 's4_supply')], results: [...withRun(storedRows('ECR-0423'), 3, 1000), ...withRun(withOwn(storedTimelineRows('ECR-0423')), 4, 2000), ...withRun(withOwn(storedSupplyRows('ECR-0423')), 5, 3000)] });
  const input = ruleInputForRun(db, 5n, 3n, 'ECR-0423')!.input;
  const derived = deriveRecommendation(input);
  assert.deepEqual(derived.conditions, ['Qualification and release not assessed'], 'the rule names it once');
  const by = findingsByCheck(input, derived);
  assert.deepEqual(by.timeline, ['Qualification and release not assessed']);
  assert.deepEqual(by.supply, ['Qualification and release not assessed']);
  assert.deepEqual(by.cost, []);
  const post = (headline: string) => statementGuardFor(db)({ ...pr5, plmEcrNumber: 'ECR-0423' }, 'norn:check_run:3', { headline, drivers: [], claims: [{ text: 'Recommendation: Approve with conditions. Rule 2.' }] });
  assert.match(post('The supply check is clean.') ?? '', /Your headline says "clean"/);
  assert.match(post('The timeline check is clean.') ?? '', /Your headline says "clean"/);
  assert.equal(post('The cost check is clean; qualification and release are not assessed.'), undefined);
  assert.equal(post('The cost check has no issues; the timeline has a gap.'), undefined, "Sol's P2: honest scoped wording");
  assert.match(post('The supply check has no issues.') ?? '', /Your headline says "no issues"/);
  assert.match(post('There are no known issues.') ?? '', /Your headline says "no known issues"/);
});
