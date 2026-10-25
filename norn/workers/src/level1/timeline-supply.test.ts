// The timeline and supply checks (s3, s4) in the Level 1 statement (#120), offline: which runs a statement rests on,
// when the dispatcher stops waiting for them, what the recommendation rule makes of them, what the agent is told
// and what the PLM shows. The rows are the real checks' on Bowman's data (norn-seed-1), as the workers store them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobFactsOf, factsOf } from './dispatcher.ts';
import { statementToPlmFields, type StatementDoc } from './format.ts';
import { decide, type DecideOptions, type EcrFacts } from './plan.ts';
import { SUPPLY_CLAIM, TIMELINE_CLAIM, jobPrompt } from './prompt.ts';
import { gather } from './publisher.ts';
import { deriveRecommendation, ruleInputOf, type RunRow } from './recommendation.ts';
import { storedRows, storedSupplyRows, storedTimelineRows } from './routing-fixture.ts';
import { SIBLING_WAIT_MS, siblingCutoffMs, siblingOf, waitingForSiblings } from './siblings.ts';
import { siblingsForRun } from './source.ts';
import { headlineNumbers, isTimelineSupplyKey, likelihoodWord, ruleCheckOf, supplierName, timelineSupplyFacts, type SiblingView, type StoredRow } from './timeline-supply.ts';

// ---- runs ---------------------------------------------------------------------------------------------

const T0 = Date.parse('2026-10-24T20:00:00Z');
const S1 = 'hash-s1';
let n = 0;
const run = (id: number, stage: string, status: string, over: Partial<RunRow> = {}): RunRow => ({
  id: BigInt(id),
  stage,
  status,
  inputHash: `h${id}`,
  createdMs: T0 + id * 100,
  startedMs: T0 + id * 100,
  finishedMs: status === 'queued' || status === 'running' || status === 'blocked' ? null : T0 + id * 100 + 50,
  upstreamS1: stage === 's1_bom_delta' ? undefined : S1,
  revision: 1,
  ...over,
});
/** s2 finished at T0+10 s; s3 and s4 below default to finishing a second later. */
const s2 = run(3, 's2_cost', 'done', { createdMs: T0, startedMs: T0, finishedMs: T0 + 10_000 });
const done = (id: number, stage: string, over: Partial<RunRow> = {}) => run(id, stage, 'done', { createdMs: T0 + 10_000, startedMs: T0 + 10_000, finishedMs: T0 + 11_000, ...over });

test('s3 and s4 are the newest runs on the same s1 and revision that had settled by the cutoff; a later run is not the statement\'s', () => {
  const cutoff = siblingCutoffMs(s2);
  assert.equal(cutoff, T0 + 10_000 + SIBLING_WAIT_MS);
  const s3a = done(4, 's3_timeline');
  const s4a = done(5, 's4_supply');
  const runs = [s2, s3a, s4a];
  assert.equal(siblingOf(runs, s2, 's3_timeline').run?.id, 4n);
  assert.equal(siblingOf(runs, s2, 's4_supply').state, 'ready');
  // s4 re-runs because another ECR was filed, after the cutoff: the statement does not move
  const rerun = done(9, 's4_supply', { finishedMs: cutoff + 1 });
  assert.equal(siblingOf([...runs, rerun], s2, 's4_supply').run?.id, 5n, 'a run finished after the cutoff is not read');
  // a re-run inside the window is the newer snapshot
  const inside = done(9, 's4_supply', { finishedMs: cutoff - 1 });
  assert.equal(siblingOf([...runs, inside], s2, 's4_supply').run?.id, 9n);
  // another revision, another s1 run, and cancelled runs are not this snapshot's
  assert.equal(siblingOf([s2, done(4, 's3_timeline', { revision: 2 })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, done(4, 's3_timeline', { upstreamS1: 'other' })], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'cancelled')], s2, 's3_timeline').state, 'pending');
});

test('a stale run still counts (a later input change made it stale), a queued or running one does not, and a failure or block is how it ended', () => {
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'stale', { finishedMs: T0 + 11_000 })], s2, 's3_timeline').state, 'ready');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'running')], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'queued')], s2, 's3_timeline').state, 'pending');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'failed', { finishedMs: T0 + 12_000 })], s2, 's3_timeline').state, 'failed');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'blocked')], s2, 's3_timeline').state, 'blocked');
  // the newest settled run is the answer: a failed re-run after a good one, and the reverse
  assert.equal(siblingOf([s2, done(4, 's3_timeline'), run(8, 's3_timeline', 'failed', { finishedMs: T0 + 12_000 })], s2, 's3_timeline').state, 'failed');
  assert.equal(siblingOf([s2, run(4, 's3_timeline', 'failed', { finishedMs: T0 + 12_000 }), done(8, 's3_timeline')], s2, 's3_timeline').state, 'ready');
  // a re-run that is still running at the cutoff leaves the earlier good one standing
  assert.equal(siblingOf([s2, done(4, 's3_timeline'), run(8, 's3_timeline', 'running')], s2, 's3_timeline').run?.id, 4n);
  // a run that cannot be tied to the s2 run (no upstream recorded) binds nothing
  assert.equal(siblingOf([done(4, 's3_timeline')], { ...s2, upstreamS1: undefined }, 's3_timeline').state, 'pending');
});

test('the dispatcher waits while a sibling is unsettled, and goes ahead when both have settled or at the cutoff', () => {
  const cutoff = siblingCutoffMs(s2);
  const both = [s2, done(4, 's3_timeline'), done(5, 's4_supply')];
  assert.equal(waitingForSiblings(both, s2, T0 + 12_000), false, 'both done: no waiting');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline')], s2, T0 + 12_000), true, 's4 not there yet');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'running')], s2, cutoff - 1), true, 'a hung s4 is waited for up to the cutoff');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'running')], s2, cutoff), false, 'and not a moment longer');
  assert.equal(waitingForSiblings([s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed')], s2, T0 + 12_000), false, 'a failed s4 is settled: no reason to wait');
  assert.equal(waitingForSiblings([s2, run(4, 's3_timeline', 'blocked'), done(5, 's4_supply')], s2, T0 + 12_000), false);
  assert.equal(waitingForSiblings([s2], s2, T0 + 1_000_000), false, 'neither ever ran: after the cutoff, go ahead');
});

const opts = (over: Partial<DecideOptions> = {}): DecideOptions => ({ nowMs: T0 + 60_000, maxAttempts: 2, retryDelayMs: 60_000, orphanMs: 330_000, running: new Set(), ...over });
const ecrFacts = (siblings: { pending: boolean; cutoffMs: number } | undefined): EcrFacts => ({
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
  const waiting = decide(ecrFacts({ pending: true, cutoffMs: cutoff }), opts({ nowMs: T0 + 20_000 }));
  assert.equal(waiting.action, 'skip');
  assert.match((waiting as { reason: string }).reason, /waiting for the timeline and supply checks until 2026-10-24T20:00:40/);
  assert.equal(decide(ecrFacts({ pending: false, cutoffMs: cutoff }), opts({ nowMs: T0 + 20_000 })).action, 'dispatch', 'settled: no waiting');
  assert.equal(decide(ecrFacts({ pending: true, cutoffMs: cutoff }), opts({ nowMs: cutoff })).action, 'dispatch', 'a hung check does not hold Level 1 back');
  assert.equal(decide(ecrFacts(undefined), opts({ nowMs: T0 + 20_000 })).action, 'dispatch');
});

// ---- the rule ---------------------------------------------------------------------------------------------

const view = (rows: StoredRow[], state: SiblingView['state'] = 'ready'): SiblingView => ({ state, runId: 1, rows: state === 'ready' ? rows : [] });
const rowsOf = (xs: { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string }[]): StoredRow[] => xs;
const real = (ecr: string) => ({ timeline: view(rowsOf(storedTimelineRows(ecr))), supply: view(rowsOf(storedSupplyRows(ecr))) });
const rule = (ecr: string, t: SiblingView, s: SiblingView) => deriveRecommendation(ruleInputOf(storedRows(ecr), [], { timeline: ruleCheckOf(t), supply: ruleCheckOf(s) }));
const flagOnly = (flags: object[]): SiblingView => view([{ key: 'detail', label: 'd', unit: 'json', p10: 0, p50: 0, p90: 0, detailJson: JSON.stringify({ flags }) }]);

test("ECR-0417 and ECR-0423 keep their outcomes with the real timeline and supply rows: its late cut-in and single source are findings, not conditions", () => {
  const a = real('ECR-0417');
  const flags = [...(JSON.parse(a.timeline.rows.find(r => r.key === 'detail')!.detailJson).flags as { kind: string }[]), ...(JSON.parse(a.supply.rows.find(r => r.key === 'detail')!.detailJson).flags as { kind: string }[])].map(f => f.kind);
  assert.ok(flags.includes('likely_late') && flags.includes('single_source'), `the real checks do warn about it: ${flags}`);
  const d = rule('ECR-0417', a.timeline, a.supply);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.equal(d.conditions.length, 3, 'still exactly its three blank cost lines');
  assert.deepEqual(d.conditions, deriveRecommendation(ruleInputOf(storedRows('ECR-0417'), [])).conditions, 'the same three, in the same order');
  const b = real('ECR-0423');
  const e = rule('ECR-0423', b.timeline, b.supply);
  assert.equal(e.recommendation, 'Approve');
  assert.equal(e.rule, 3);
});

test('a late cut-in, a single source, slot contention and exceeded capacity never move the recommendation', () => {
  const findings = flagOnly(['likely_late', 'single_source', 'slot_contention', 'capacity_exceeded'].map(kind => ({ kind, severity: 'warn', message: `${kind} happened`, ref: 'X' })));
  const d = rule('ECR-0423', findings, findings);
  assert.equal(d.recommendation, 'Approve');
  assert.deepEqual(d.conditions, []);
  // the real ECR-0421 (late in every draw, one source at Orrin, a slot shared with ECR-0419) adds no condition for any of that;
  // the one it does add is the supply check's own gap, a default raw-material share that a buyer should estimate
  const r = real('ECR-0421');
  const base = deriveRecommendation(ruleInputOf(storedRows('ECR-0421'), []));
  const withSiblings = rule('ECR-0421', r.timeline, r.supply);
  assert.equal(withSiblings.recommendation, base.recommendation);
  assert.deepEqual(withSiblings.conditions.slice(0, base.conditions.length), base.conditions);
  assert.equal(withSiblings.conditions.length, base.conditions.length + 1);
  assert.match(withSiblings.conditions.at(-1)!, /^The raw-material share of a part's price is a default/);
});

test('flags that say the check could not assess something are gaps, named briefly: Approve with conditions, never Send back', () => {
  const gaps = flagOnly([
    { kind: 'stock_beyond_plan', severity: 'warn', ref: 'stock:ECR-0417', message: 'a very long message the rule does not repeat' },
    { kind: 'unreadable_peer', severity: 'warn', ref: 'ECR-0999', message: 'x' },
    { kind: 'no_price', severity: 'warn', ref: 'BW-1', message: 'x' },
    { kind: 'beyond_published_slots', severity: 'warn', ref: 'BW-2', message: 'x' },
    { kind: 'cut_in_beyond_plan', severity: 'warn', message: 'x' },
    { kind: 'unused_assumption', severity: 'warn', ref: 'a:1', message: 'Assumption a:1 was not applied: it has no distribution.' },
    { kind: 'shared_supplier', severity: 'info', message: 'info is neither' },
    { kind: 'likely_late', severity: 'warn', message: 'a finding' },
  ]);
  const d = rule('ECR-0423', gaps, view([]));
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.deepEqual(d.blockers, []);
  assert.equal(d.conditions.length, 6);
  assert.ok(d.conditions[0]!.startsWith('No cut-in date can be placed (stock:ECR-0417)'));
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
  assert.match(f.supply[0]!, /^It shares Stratus with ECR-0406; neither the slots nor the capacity move its cut-in\.$/);
});

test('the numbers to post are the checks\' own rows that clear Bowman\'s bars, capped by the room left under twelve', () => {
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

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });
interface FakeRun extends RunRow {
  inputs?: object;
}
/** Just enough of the client cache for factsOf, jobFactsOf and gather: check runs and results of one ECR (id 5). */
function cache(o: { runs: RunRow[]; results: { id: number; run: number; row: { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string }; mock?: boolean }[]; statements?: any[]; ecr?: string }) {
  const runRows = o.runs.map((r: FakeRun) => ({
    id: r.id,
    prId: 5n,
    stage: r.stage,
    status: r.status,
    inputHash: r.inputHash,
    createdAt: at(r.createdMs),
    startedAt: r.startedMs === null ? undefined : at(r.startedMs),
    finishedAt: r.finishedMs === null ? undefined : at(r.finishedMs),
    inputsJson: JSON.stringify({ revision: r.revision, revisionSource: 'plm', erpBaseline: '2c02958e00', erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24', ...(r.upstreamS1 ? { upstream: { s1_bom_delta: r.upstreamS1 } } : {}) }),
  }));
  const resultRows = o.results.map(x => ({ ...x.row, id: BigInt(x.id), prId: 5n, checkRunId: BigInt(x.run), mock: x.mock ?? false }));
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
/** The three finished runs of ECR-0417, with the real rows. s1 is run 2; s2 is run 3 (finished at T0+10 s). */
function healthy(ecr = 'ECR-0417', extraRuns: RunRow[] = [], extraResults: ReturnType<typeof withRun> = []) {
  return cache({
    runs: [run(2, 's1_bom_delta', 'done'), s2, done(4, 's3_timeline'), done(5, 's4_supply'), ...extraRuns],
    results: [...withRun(storedRows(ecr), 3, 1000), ...withRun(storedTimelineRows(ecr), 4, 2000), ...withRun(storedSupplyRows(ecr), 5, 3000), ...extraResults],
  });
}

test('factsOf: the dispatcher waits while s4 is running and starts once it has finished', () => {
  const rows = [run(2, 's1_bom_delta', 'done'), s2, done(4, 's3_timeline')];
  const waiting = cache({ runs: [...rows, run(5, 's4_supply', 'running')], results: [] });
  const f = factsOf(waiting, pr5, 'level1-statement').s2Done[0]!;
  assert.deepEqual(f.siblings, { pending: true, cutoffMs: siblingCutoffMs(s2) });
  assert.equal(decide({ ...ecrFacts(f.siblings), s2Done: [{ ...f, id: 3, inputsRevision: 1, mock: false }] }, opts({ nowMs: T0 + 20_000 })).action, 'skip');
  const settled = factsOf(cache({ runs: [...rows, done(5, 's4_supply')], results: [] }), pr5, 'level1-statement').s2Done[0]!;
  assert.equal(settled.siblings?.pending, false);
});

test('jobFactsOf: ECR-0417 is asked for the cost numbers, then the cut-in, serial, weeks late and single source, and its conditions are unchanged', () => {
  const facts = jobFactsOf(healthy(), pr5, 1, 3);
  assert.deepEqual(
    facts.numbers.map(x => x.resultKey),
    ['unit_cost_delta:vesper', 'unit_cost_delta:meridian', 'one_time_total', 'net_total_year_one', 'cut_in_date', 'cut_in_serial', 'late_weeks', 'single_source_items']
  );
  assert.equal(facts.recommendation?.recommendation, 'Approve with conditions');
  assert.equal(facts.recommendation?.rule, 2);
  assert.equal(facts.recommendation?.conditions.length, 3);
  assert.equal(facts.timelineSupply?.timeline.length, 2);
  const p = jobPrompt(facts);
  assert.ok(p.includes('resultKey "cut_in_date"') && p.includes('resultKey "late_weeks"') && p.includes('resultKey "single_source_items"'));
  assert.ok(p.includes(`One claim starting "${TIMELINE_CLAIM}" (evidence "computation")`) && p.includes(`One claim starting "${SUPPLY_CLAIM}" (evidence "computation")`));
  assert.ok(p.includes('The change can first reach the line on 2027-02-16') && p.includes('likelihood it is late: almost certain (95-99%)'));
  assert.ok(p.includes('and the median date it reaches the line'));
  assert.ok(!/branch|merge|pull request/i.test(p.replace(/Never use:[^\n]*/, '')), 'business words only');
});

test('jobFactsOf: ECR-0423 gets Approve and a quiet pair of claims', () => {
  const facts = jobFactsOf(healthy('ECR-0423'), { ...pr5, plmEcrNumber: 'ECR-0423' }, 1, 3);
  assert.equal(facts.recommendation?.recommendation, 'Approve');
  assert.deepEqual(facts.numbers.map(x => x.resultKey).filter(isTimelineSupplyKey), ['cut_in_date', 'cut_in_serial']);
});

test('a failed s4 does not stop Level 1: the agent is told the supply check is not available, asked for no supply number, and the rule names it', () => {
  const c = cache({
    runs: [run(2, 's1_bom_delta', 'done'), s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed', { finishedMs: T0 + 11_000 })],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000)],
  });
  const facts = jobFactsOf(c, pr5, 1, 3);
  assert.deepEqual(facts.timelineSupply?.unavailable, [{ check: 'supply', why: 'it failed' }]);
  assert.ok(!facts.numbers.some(x => x.resultKey === 'single_source_items'));
  assert.equal(facts.recommendation?.recommendation, 'Approve with conditions');
  assert.equal(facts.recommendation?.conditions.length, 4);
  assert.equal(facts.recommendation?.conditions[3], 'The supply check failed, so it is not assessed');
  const p = jobPrompt(facts);
  assert.ok(p.includes('saying the supply check is not available because it failed'));
  assert.ok(p.includes('The change can first reach the line on 2027-02-16'), 'the timeline is still there');
});

test('an s3 that never settled by the cutoff (hung) is "not finished in time", and a run that finishes after the cutoff is never read', () => {
  const late = cache({
    runs: [run(2, 's1_bom_delta', 'done'), s2, done(4, 's3_timeline', { finishedMs: siblingCutoffMs(s2) + 5_000 }), done(5, 's4_supply')],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000), ...withRun(storedSupplyRows('ECR-0417'), 5, 3000)],
  });
  const facts = jobFactsOf(late, pr5, 1, 3);
  assert.deepEqual(facts.timelineSupply?.unavailable, [{ check: 'timeline', why: 'it had not finished in time' }]);
  assert.ok(!facts.numbers.some(x => x.resultKey === 'cut_in_date'));
  assert.equal(facts.recommendation?.conditions[3], 'The timeline check had not finished when this assessment was made, so it is not assessed');
});

test('the statement\'s own s3 and s4 runs are read, not a newer rerun with other numbers', () => {
  const rerunRows = withRun(storedSupplyRows('ECR-0421'), 9, 4000); // some other numbers, from a run after the cutoff
  const c = healthy('ECR-0417', [done(9, 's4_supply', { finishedMs: siblingCutoffMs(s2) + 60_000 })], rerunRows);
  const sib = siblingsForRun(c, 5n, 3n)!;
  assert.equal(sib.supply.runId, 5);
  assert.equal(sib.timeline.runId, 4);
  assert.ok(!sib.supply.rows.some(r => r.key === 'bundle_saving:CON-ORRIN-UH-SLOT'));
  assert.equal(siblingsForRun(c, 5n, 0n), undefined, 'no run, nothing bound');
  assert.equal(siblingsForRun(c, 5n, 4n), undefined, 'a run that is not an s2_cost run binds nothing');
});

// ---- the PLM text -------------------------------------------------------------------------------------------

const statementFor = (ecr: string, over: Partial<StatementDoc> = {}): StatementDoc => {
  const t = real(ecr);
  const rows = [...storedRows(ecr), ...t.timeline.rows, ...t.supply.rows];
  const pick = (k: string) => rows.find(r => r.key === k)!;
  const keys = ['unit_cost_delta:vesper', 'one_time_total', 'net_total_year_one', ...headlineNumbers(t.timeline, t.supply, 9).map(x => x.resultKey)].filter(k => rows.some(r => r.key === k));
  const f = timelineSupplyFacts(t.timeline, t.supply);
  return {
    id: 12,
    level: 1,
    prRevision: 3,
    createdAtIso: '2026-10-24T20:42:11.000Z',
    changeClass: 'Class I',
    route: "Pending Norn's routing",
    headline: 'ECR-0417 adds money, and the change reaches the line on 2027-02-16 at the median.',
    numbers: keys.map(k => ({ key: k.replace(/[^A-Za-z0-9_]/g, '_'), label: pick(k).label, unit: pick(k).unit, p10: pick(k).p10, p50: pick(k).p50, p90: pick(k).p90, evidence: 'computation', resultKey: k })),
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
  formulas: {},
  mock: false,
  ruleInput: ruleInputOf(storedRows(ecr), [], { timeline: ruleCheckOf(t.timeline), supply: ruleCheckOf(t.supply) }),
  ...over,
});

test('the PLM text has its own "Timeline and supply" section after the cost numbers: dates, weeks, serials, the single source and the two sentences', () => {
  const f = statementToPlmFields(statementFor('ECR-0417'), ecr417, provFor('ECR-0417'), o);
  const html = f.fields.impact_statement as string;
  const iCost = html.indexOf('Headline numbers');
  const iTs = html.indexOf('Timeline and supply</h5>');
  const iRests = html.indexOf('Change class and approval route');
  assert.ok(iCost > 0 && iTs > iCost && iRests > iTs, 'after the headline numbers, before the class and route');
  const section = html.slice(iTs, html.indexOf('<h5', iTs + 10) > 0 ? html.indexOf('<h5', iTs + 10) : undefined);
  for (const w of ['Earliest cut-in date', '2027-01-13', '2027-02-16', '2027-04-11', 'S/N 15', 'S/N 13', 'S/N 18', '8.3 weeks', '13.1 weeks', '20.9 weeks', 'Changed parts with one qualified source', '1 part', 'same', 'Timeline: The change can first reach the line', 'Supply: BW-5120-210 (Halden)', 'almost certain (95-99%)']) assert.ok(section.includes(w), w);
  // the cost table no longer carries them, and dates are never shown as day numbers
  const cost = html.slice(iCost, iTs);
  assert.ok(!cost.includes('Earliest cut-in date') && !cost.includes('Changed parts'));
  assert.ok(!/208\d\d/.test(html), 'no raw day numbers');
  assert.ok(!html.includes('Also noted'), 'the two claims are in their section, not repeated');
  assert.ok(html.includes('Timeline and supply: computed by Norn\'s timeline and supply checks (timeline run 4, supply run 5)'));
  assert.ok(!/\b(branch|merge|pull request)\b/i.test(html), 'business words only');
  // the recommendation field is the rule's, unchanged for ECR-0417
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(f.overridden, undefined);
});

test('a check that is not available is said so in its section from the run\'s state, whatever the agent wrote, and the recommendation names it', () => {
  const t = { timeline: real('ECR-0417').timeline, supply: view([], 'failed') };
  const claims = [{ text: 'Recommendation: Approve with conditions. Rule 2.', evidence: 'judgment' }];
  const stmt = statementFor('ECR-0417', { claims, numbers: statementFor('ECR-0417').numbers.filter(x => !['single_source_items'].includes(x.resultKey)) });
  const f = statementToPlmFields(stmt, ecr417, provFor('ECR-0417', t as any), o);
  const html = f.fields.impact_statement as string;
  assert.ok(html.includes('The supply check failed.') && html.includes('No supplier finding is assessed.'));
  assert.ok(!html.includes('The timeline check'), 'only the check that is missing');
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(f.overridden, undefined, 'the agent agreed: its own words stand');
  assert.ok(deriveRecommendation(provFor('ECR-0417', t as any).ruleInput!).conditions.includes('The supply check failed, so it is not assessed'), 'and the rule names the missing check among its conditions');
  const none = statementToPlmFields(statementFor('ECR-0417'), ecr417, provFor('ECR-0417', { timeline: view([], 'pending'), supply: view([], 'pending') } as any), o).fields.impact_statement as string;
  assert.ok(none.includes('The timeline check had not finished when this assessment was made.') && none.includes('The supply check had not finished when this assessment was made.'));
});

test('a statement with no timeline or supply content has no such section (a Level 1 posted before this change)', () => {
  const old = statementFor('ECR-0417', { numbers: statementFor('ECR-0417').numbers.slice(0, 3), claims: [{ text: 'Recommendation: Approve with conditions. Rule 2.', evidence: 'judgment' }] });
  const html = statementToPlmFields(old, ecr417, { baseline: 'b', changeRequest: 'c', formulas: {}, mock: false }, o).fields.impact_statement as string;
  assert.ok(!html.includes('Timeline and supply'));
});

test('gather binds the statement to its own s3 and s4 runs: their ids, flags and the recommendation come from them, never from a later rerun', () => {
  const stmtRow = (checkRunId: bigint) => ({
    id: 12n, level: 1, prRevision: 3, checkRunId, createdAt: { toDate: () => new Date(T0 + 120_000) }, changeClass: 'Class I', route: 'r', headline: 'h', author: null,
    numbers: statementFor('ECR-0417').numbers, drivers: [], assumptions: [], claims: statementFor('ECR-0417').claims,
  });
  // the statement's own runs are healthy; a later s4 failed (after the cutoff)
  const c = healthy('ECR-0417', [run(9, 's4_supply', 'failed', { createdMs: siblingCutoffMs(s2) + 1_000, finishedMs: siblingCutoffMs(s2) + 2_000 })]);
  c.impactStatement = { prId: { filter: () => [stmtRow(3n)] } };
  const g = gather(c, pr5)!;
  assert.equal(g.prov.timelineRunId, 4);
  assert.equal(g.prov.supplyRunId, 5);
  assert.equal(g.prov.ruleInput?.supply?.state, 'ready');
  const f = statementToPlmFields(g.statement, g.ecr, g.prov, o);
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.ok(!(f.fields.impact_statement as string).includes('The supply check'), 'a failure after the statement does not change it');
  // the same ECR where s4 had already failed inside the window: the statement says so
  const d = cache({
    runs: [run(2, 's1_bom_delta', 'done'), s2, done(4, 's3_timeline'), run(5, 's4_supply', 'failed', { finishedMs: T0 + 11_000 })],
    results: [...withRun(storedRows('ECR-0417'), 3, 1000), ...withRun(storedTimelineRows('ECR-0417'), 4, 2000)],
  });
  d.impactStatement = { prId: { filter: () => [stmtRow(3n)] } };
  const g2 = gather(d, pr5)!;
  assert.equal(g2.prov.ruleInput?.supply?.state, 'failed');
  assert.ok((statementToPlmFields(g2.statement, g2.ecr, g2.prov, o).fields.impact_statement as string).includes('The supply check failed.'));
});

test('the dispatcher and the publisher read the same snapshot, so the agent is told what the PLM shows', () => {
  const c = healthy('ECR-0417', [done(9, 's3_timeline', { finishedMs: siblingCutoffMs(s2) + 1 })], withRun(storedTimelineRows('ECR-0421'), 9, 4000));
  const told = jobFactsOf(c, pr5, 1, 3).recommendation!;
  c.impactStatement = { prId: { filter: () => [{ id: 12n, level: 1, prRevision: 3, checkRunId: 3n, createdAt: { toDate: () => new Date(T0 + 90_000) }, changeClass: 'Class I', route: 'r', headline: 'h', author: null, numbers: statementFor('ECR-0417').numbers, drivers: [], assumptions: [], claims: [] }] } };
  const g = gather(c, pr5)!;
  const shown = deriveRecommendation(g.prov.ruleInput!);
  assert.deepEqual([told.recommendation, told.rule, told.conditions], [shown.recommendation, shown.rule, shown.conditions]);
});
