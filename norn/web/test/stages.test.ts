// #131 (real S3/S4 pages and their unavailable states), #133 (approval route from records) and #135 (cost split),
// on rows the real checks produce. Not part of `tsc -p .`; node runs them directly:  npm test -w @norn/web
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costAssessment } from '../../checks/src/assessment.ts';
import { supplyCheckRows, timelineRows } from '../../checks/src/rows.ts';
import { supplyCheck } from '../../checks/src/supply.ts';
import { dateOf } from '../../checks/src/time.ts';
import { fromChecks } from '../src/assessment/adapter.ts';
import { buildAssessment, buildSummary, routeSteps, type PrRow, type ResultRow, type RunRow, type Snapshot } from '../src/assessment/live/build.ts';
import { buildGate, type ApprovalRow } from '../src/assessment/live/gate.ts';

type Row = { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string };
const ts = (n: number) => ({ microsSinceUnixEpoch: BigInt(n) * 1_000_000n, toDate: () => new Date(n * 1000) });
const id = (h: string) => ({ toHexString: () => h });
const ecr = (eid: string) => structuredClone(bowman.ecrs.find(e => e.id === eid)!);

const SEED = 'norn-seed-1', DRAWS = 1500;
const cost = costAssessment(bowman, ecr('ECR-0417'), { seed: SEED, draws: DRAWS });
const s3 = timelineRows(cost.timeline) as Row[];
const s4 = supplyCheckRows(supplyCheck(bowman, ecr('ECR-0417'), { seed: SEED, draws: DRAWS })) as Row[];

const pr = (over: Partial<PrRow> = {}): PrRow => ({ id: 1n, plmEcrNumber: 'ECR-0417', title: 't', description: 'd', status: 'review', revision: 2, createdBy: id('aa'), createdAt: ts(1), updatedAt: ts(1), ...over });
const run = (rid: bigint, stage: string, status: string, created: number, note = ''): RunRow =>
  ({ id: rid, prId: 1n, stage, status, note, createdAt: ts(created), finishedAt: status === 'done' ? ts(created + 5) : undefined });
const rowsOf = (runId: bigint, rows: Row[], mock = false): ResultRow[] => rows.map((r, i) => ({ ...r, id: runId * 1000n + BigInt(i), checkRunId: runId, prId: 1n, mock, createdAt: ts(20) }));
const snap = (runs: RunRow[], res: ResultRow[], extra: Partial<Snapshot> = {}): Snapshot =>
  ({ prs: [pr()], revisions: [], runs, results: res, statements: [], comments: [], actions: [], events: [], principals: [], ...extra });
const COST = rowsOf(1n, cost.rows as Row[]);
const costRun = run(1n, 's2_cost', 'done', 10);
const check = (a: ReturnType<typeof buildAssessment>, cid: string) => a!.checks.find(c => c.id === cid)!;

// ---------------------------------------------------------------- #135

test('retrofit and support lines keep unit cost × quantity as extended, with no nonrecurring component', () => {
  const v = fromChecks(cost.rows as Row[]);
  const brackets = v.cost.rows.find(r => r.block === 'retrofit' && /brackets/.test(r.label))!;
  assert.equal(brackets.recurring, false, 'retrofit is not ongoing production');
  assert.equal(brackets.nonrecurring, undefined);
  assert.equal(brackets.quantity, 120);
  assert.ok(brackets.unitCost && brackets.extended);
  assert.equal(Math.round(brackets.extended.point!), 26520);
  assert.equal(brackets.total.point, brackets.extended.point, 'the line total is its extended amount');
  const tooling = v.cost.rows.find(r => /Special tooling/.test(r.label))!;
  assert.ok(tooling.nonrecurring && !tooling.extended, 'a nonrecurring line has no extended amount');
});

test('the nonrecurring and extended columns add up to the net, and the rollout aggregate has its own label', () => {
  const v = fromChecks(cost.rows as Row[]);
  const sum = (f: (r: (typeof v.cost.rows)[number]) => number | undefined) => v.cost.rows.reduce((t, r) => t + (f(r) ?? 0), 0);
  const columns = sum(r => r.nonrecurring?.point) + sum(r => r.extended?.point);
  assert.ok(Math.abs(columns - v.cost.net.point!) < 1, `${columns} vs ${v.cost.net.point}`);
  assert.match(v.traces['one_time_total'].title, /Rollout budget/);
  assert.match(v.traces['recurring_year_one'].title, /Ongoing production/);
  assert.doesNotMatch(v.traces['one_time_total'].title, /^One-time/i);
});

test('a mixed line keeps both its nonrecurring amount and its unit-extended amount', () => {
  const rows = (cost.rows as Row[]).map(r => ({ ...r }));
  const brackets = rows.find(r => /retrofit:rev-c-brackets/.test(r.key))!;
  const tooling = rows.find(r => /special-tooling/.test(r.key))!;
  const d = JSON.parse(brackets.detailJson);
  d.oneTime = JSON.parse(tooling.detailJson).oneTime;
  brackets.detailJson = JSON.stringify(d);
  const mixed = fromChecks(rows).cost.rows.find(r => /brackets/.test(r.label))!;
  assert.equal(Math.round(mixed.nonrecurring!.point!), 6800);
  assert.equal(Math.round(mixed.extended!.point!), 26520);
  assert.equal(mixed.quantity, 120);
});

test('the cost page says it is the requested scenario, and the forecast scenario is a separate figure', () => {
  const v = fromChecks(cost.rows as Row[]);
  assert.match(v.cost.scenarios!.requested, /^Requested effectivity: S\/N \d+/);
  assert.ok(v.cost.scenarios!.alternative, 'the forecast scenario is costed');
  assert.notEqual(v.cost.scenarios!.alternative!.net.p50, v.cost.net.p50);
  assert.ok(v.traces['scenario:forecast_net']);
  assert.equal(v.cost.scenarios!.readiness, 'materials_only');
});

// ---------------------------------------------------------------- #131

test('finished real S3 and S4 runs show the timeline and the supply page, not "passed" with nothing', () => {
  const s = snap([costRun, run(2n, 's3_timeline', 'done', 11), run(3n, 's4_supply', 'done', 12)], [...COST, ...rowsOf(2n, s3), ...rowsOf(3n, s4)]);
  const a = buildAssessment(s, pr())!;
  assert.ok(!a.mock.includes('cutInEstimate') && !a.mock.includes('supply'), 'real results are not labelled mock');
  const t = check(a, 'timeline'), sp = check(a, 'supply');
  assert.ok(!t.mock && !sp.mock);
  assert.match(t.summary, /^Material readiness /, 'a materials-only date is not called the line date');
  assert.equal(a.cutIn.estimate!.label, 'Material readiness');
  assert.ok(a.cutIn.timeline!.steps.length > 0);
  assert.ok(a.supply!.detail!.parts.length > 0);
  assert.ok(a.supply!.detail!.parts.every(p => p.leadWeeks.p50 > 0));
  assert.equal(t.state, 'attention', 'unassessed prerequisites need a look');
  assert.ok(a.traces['s3:cut_in_date'] && a.traces['supply'], 'the numbers open their traces');
  assert.ok(a.traces['s3:cut_in_date'].formula?.expression);
});

test('a date figure names the same calendar day the check does (fractional days round, not floor)', () => {
  const s = snap([costRun, run(2n, 's3_timeline', 'done', 11)], [...COST, ...rowsOf(2n, s3)]);
  const a = buildAssessment(s, pr())!;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const f = a.cutIn.estimate!.figure;
  assert.equal(day(f.p50), cost.timeline.cutIn.date!.p50);
  assert.equal(day(f.p10!), cost.timeline.cutIn.date!.p10);
  assert.equal(day(f.p90!), cost.timeline.cutIn.date!.p90);
  const fractional = new Set([cost.timeline.cutIn.day!.p50, cost.timeline.cutIn.day!.p10, cost.timeline.cutIn.day!.p90].filter(x => x % 1 !== 0));
  assert.ok(fractional.size >= 0 && dateOf(cost.timeline.cutIn.day!.p50) === day(f.p50));
});

test('the summary states the date and the late chance once; warnings are counted, not repeated', () => {
  const s = snap([costRun, run(2n, 's3_timeline', 'done', 11), run(3n, 's4_supply', 'done', 12)], [...COST, ...rowsOf(2n, s3), ...rowsOf(3n, s4)]);
  const a = buildAssessment(s, pr())!;
  const t = check(a, 'timeline');
  assert.ok(t.summary.length < 240, t.summary);
  assert.equal((t.summary.match(/stated effectivity/g) ?? []).length <= 1, true);
  const msgs = a.cutIn.timeline!.flags.map(f => f.message);
  assert.equal(new Set(msgs).size, msgs.length, 'each warning once');
  assert.ok(!a.cutIn.timeline!.flags.some(f => /can first reach the line .* weeks after it/.test(f.message)), 'the late chance is a figure, not also a warning');
  assert.match(a.supply!.detail!.stated, /./);
});

test('mock S3/S4 rows are still labelled mock and read as before', () => {
  const mockRows = [
    ...rowsOf(2n, [{ key: 'effectivity_weeks', label: 'w', unit: 'weeks', p10: 20, p50: 26, p90: 32, detailJson: '{}' }], true),
    ...rowsOf(3n, [
      { key: 'cost_at_risk', label: 'r', unit: 'USD', p10: 1000, p50: 1500, p90: 2000, detailJson: '{}' },
      { key: 'p_miss_effectivity', label: 'p', unit: 'probability', p10: 0.2, p50: 0.2, p90: 0.2, detailJson: '{}' },
    ], true),
  ];
  const a = buildAssessment(snap([costRun, run(2n, 's3_timeline', 'done', 11), run(3n, 's4_supply', 'done', 12)], [...COST, ...mockRows]), pr())!;
  assert.ok(a.mock.includes('cutInEstimate') && a.mock.includes('supply'));
  assert.ok(check(a, 'timeline').mock && check(a, 'supply').mock);
  assert.match(check(a, 'timeline').summary, /mock compute/);
  assert.equal(a.supply!.level, 'moderate');
  assert.equal(a.supply!.detail, undefined);
});

test('a stage that has not run, is queued, running, failed or blocked says so; none of them reads as passed', () => {
  const state = (status: string | undefined, note = '') => {
    const runs = [costRun, ...(status ? [run(2n, 's3_timeline', status, 11, note)] : [])];
    return check(buildAssessment(snap(runs, COST), pr())!, 'timeline');
  };
  assert.deepEqual([state(undefined).state, state(undefined).summary], ['pending', 'Not assessed yet']);
  assert.equal(state('queued').state, 'queued');
  assert.equal(state('running').state, 'running');
  const failed = state('failed', 'worker crashed');
  assert.equal(failed.state, 'attention');
  assert.match(failed.summary, /failed: worker crashed/);
  const blocked = state('blocked', 'waiting for the BOM');
  assert.equal(blocked.state, 'pending');
  assert.match(blocked.summary, /blocked: waiting for the BOM/);
});

test('a finished run with no rows, or rows that are not the check output, needs attention', () => {
  const empty = check(buildAssessment(snap([costRun, run(2n, 's3_timeline', 'done', 11)], COST), pr())!, 'timeline');
  assert.equal(empty.state, 'attention');
  assert.match(empty.summary, /no result rows/);
  const junk = rowsOf(2n, [{ key: 'something', label: 'x', unit: 'weeks', p10: 1, p50: 2, p90: 3, detailJson: '{}' }]);
  const a = buildAssessment(snap([costRun, run(2n, 's3_timeline', 'done', 11)], [...COST, ...junk]), pr())!;
  assert.equal(check(a, 'timeline').state, 'attention');
  assert.match(check(a, 'timeline').summary, /could not read the check's output/);
  assert.equal(a.cutIn.estimate, undefined);
  assert.equal(buildSummary(snap([costRun, run(2n, 's3_timeline', 'done', 11)], [...COST, ...junk]), pr()).checks, 'attention');
});

test('numbers from a replaced run are kept and flagged while re-checking and after a failure', () => {
  const stale = (next: string) => {
    const a = buildAssessment(snap([costRun, run(2n, 's3_timeline', 'stale', 11), run(4n, 's3_timeline', next, 30)], [...COST, ...rowsOf(2n, s3)]), pr())!;
    return a;
  };
  const re = stale('queued');
  assert.equal(re.cutIn.timeline!.stale, 'rechecking');
  assert.equal(check(re, 'timeline').state, 'queued');
  assert.match(check(re, 'timeline').summary, /previous revision/);
  const failed = stale('failed');
  assert.equal(failed.cutIn.timeline!.stale, 'failed');
  assert.equal(check(failed, 'timeline').state, 'attention');
  assert.ok(failed.cutIn.estimate, 'the last numbers stay');
});

// ---------------------------------------------------------------- #133

const appr = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: 1n, prId: 1n, prRevision: 2, kind: 'tier', bodyId: 'ccb', tierId: 'board', decisionJson: JSON.stringify({ route: { bodyName: 'Change Control Board' }, reasons: [] }),
  status: 'standing', pendingRecheck: false, approverKind: 'person', approverName: 'Jordan Reyes', approverOrigin: 'human', onBehalfOf: undefined,
  at: ts(200), endedAt: undefined, endedReason: '', ...over,
});
const routed = ['cost_engineer', 'quality'];
const stepsFor = (approvals: ApprovalRow[], p: PrRow) => routeSteps(routed, buildGate({ approvals }, p), p);

test('an approved ECR with no approval rows invents no approvals and no chair', () => {
  const p = pr({ status: 'approved' });
  const steps = stepsFor([], p);
  assert.ok(steps.filter(x => x.role !== 'CCB').every(x => x.state === 'pending' && /No review is recorded/.test(x.note!)));
  const board = steps.find(x => x.role === 'CCB')!;
  assert.equal(board.state, 'waiting');
  assert.equal(board.person, undefined);
  assert.match(board.note!, /no approval is recorded/);
  assert.ok(!JSON.stringify(steps).includes('Rafael'));
  assert.ok(steps.every(x => x.state !== 'approved'));
});

test('a recorded board approval names the actual approver, time and revision, and seats stay unrecorded', () => {
  const p = pr({ status: 'approved', revision: 2 });
  const steps = stepsFor([appr()], p);
  const board = steps.find(x => x.role === 'CCB')!;
  assert.equal(board.person, 'Jordan Reyes');
  assert.equal(board.state, 'approved');
  assert.equal(board.revision, 'revision 2');
  assert.ok(board.when);
  assert.equal(board.note, undefined);
  assert.equal(steps.filter(x => x.state === 'approved').length, 1, 'the seats are not approved by the board');
});

test('a fast track is one approval by its actor: no board step and no chair', () => {
  const p = pr({ status: 'approved' });
  const steps = stepsFor([appr({ kind: 'fast_track', bodyId: 'fast_track', approverKind: 'agent', approverName: 'check-gate-agent', approverOrigin: 'norn', onBehalfOf: 'Dana Okafor' })], p);
  assert.equal(steps.some(x => x.role === 'CCB'), false);
  const ft = steps.find(x => x.role === 'Fast track')!;
  assert.equal(ft.state, 'approved');
  assert.match(ft.note!, /no board decision is recorded/);
  assert.match(ft.by!, /for Dana Okafor/);
  assert.ok(!JSON.stringify(steps).includes('Rafael'));
});

test('a withdrawn approval no longer counts, and says why', () => {
  const p = pr({ status: 'review' });
  const steps = stepsFor([appr({ status: 'withdrawn', endedAt: ts(300), endedReason: 'the cost changed' })], p);
  const board = steps.find(x => x.role === 'CCB')!;
  assert.equal(board.state, 'waiting');
  assert.match(board.note!, /Jordan Reyes on revision 2 was withdrawn/);
  assert.match(board.note!, /the cost changed/);
  assert.ok(steps.every(x => x.state !== 'approved'));
});

test('an approval from an older revision stays recorded but is marked as not the current revision', () => {
  const p = pr({ status: 'approved', revision: 3 });
  const board = stepsFor([appr({ prRevision: 2 })], p).find(x => x.role === 'CCB')!;
  assert.equal(board.state, 'approved');
  assert.equal(board.revision, 'revision 2');
  assert.match(board.note!, /Approved on revision 2; the ECR is now at revision 3/);
});

test('a superseded approval is replaced by the newer one; a pending re-check is not approved', () => {
  const p = pr({ status: 'approved', revision: 3 });
  const old = appr({ id: 1n, prRevision: 2, status: 'withdrawn', endedAt: ts(250), endedReason: 'superseded by revision 3' });
  const fresh = appr({ id: 2n, prRevision: 3, approverName: 'Casey Lin', at: ts(300) });
  const board = stepsFor([old, fresh], p).find(x => x.role === 'CCB')!;
  assert.equal(board.person, 'Casey Lin');
  assert.equal(board.revision, 'revision 3');
  assert.equal(board.note, undefined);
  const recheck = stepsFor([appr({ pendingRecheck: true })], pr({ status: 'approved' })).find(x => x.role === 'CCB')!;
  assert.equal(recheck.state, 'pending');
  assert.match(recheck.note!, /waiting for a re-check/);
});

test('the assessment route comes from the approval rows, not the ECR status', () => {
  const rev = { id: 1n, prId: 1n, seq: 1, changeRequestJson: JSON.stringify({ routedTo: routed }), source: 'plm', current: true, createdBy: id('aa'), createdAt: ts(2) };
  const base = (status: string, approvals: ApprovalRow[]) =>
    buildAssessment(snap([costRun], COST, { revisions: [rev], approvals, prs: [pr({ status })] }), pr({ status }))!.route.steps;
  assert.ok(base('merged', []).every(x => x.state !== 'approved'));
  assert.equal(base('review', [appr()]).find(x => x.role === 'CCB')!.state, 'approved');
});
