// Checks for the live view-model builder and the adapter, on the saved fixtures:  npm test -w @norn/web
// Not part of `tsc -p .` (the test files use Node's types); node runs them directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromChecks } from '../src/assessment/adapter.ts';
import { buildAssessment, buildSummary, costViewOf, plainSummary, type PrRow, type ResultRow, type RunRow, type Snapshot, type StatementRow } from '../src/assessment/live/build.ts';
import rows0423 from '../src/assessment/fixtures/ecr-0423.json' with { type: 'json' };
import rows0417l1 from '../src/assessment/fixtures/ecr-0417.l1.json' with { type: 'json' };
import rows0417l3 from '../src/assessment/fixtures/ecr-0417.l3.json' with { type: 'json' };

type Row = { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string };
const ts = (n: number) => ({ microsSinceUnixEpoch: BigInt(n) * 1_000_000n, toDate: () => new Date(n * 1000) });
const id = (h: string) => ({ toHexString: () => h });

const pr: PrRow = { id: 1n, plmEcrNumber: 'ECR-0417', title: 't', description: 'd', status: 'review', revision: 2, createdBy: id('aa'), createdAt: ts(1), updatedAt: ts(1) };
const run = (rid: bigint, status: string, created: number, finished?: number): RunRow =>
  ({ id: rid, prId: 1n, stage: 's2_cost', status, note: '', createdAt: ts(created), finishedAt: finished === undefined ? undefined : ts(finished) });
const results = (runId: bigint, rows: Row[], at?: number): ResultRow[] => rows.map((r, i) => ({ ...r, id: runId * 1000n + BigInt(i), checkRunId: runId, prId: 1n, mock: false, createdAt: at === undefined ? undefined : ts(at) }));
const statement = (at: number): StatementRow => ({
  id: 1n, prId: 1n, level: 1, prRevision: 1, changeClass: 'Class I, FAA minor', route: 'As filed', headline: 'h',
  numbers: [{ key: 'net_total_year_one', label: 'Net', unit: 'USD', p10: 0, p50: 0, p90: 0, evidence: 'computation', resultKey: 'net_total_year_one' }],
  drivers: [], assumptions: [], claims: [], author: id('bb'), createdAt: ts(at),
});
const snap = (runs: RunRow[], res: ResultRow[], statements: StatementRow[] = []): Snapshot =>
  ({ prs: [pr], revisions: [], runs, results: res, statements, comments: [], actions: [], events: [], principals: [] });
const net = (rows: Row[]) => rows.find(r => r.key === 'net_total_year_one')!;

test('a net saving is likely when the whole range is below zero (ECR-0423)', () => {
  const l = fromChecks(rows0423 as Row[]).headline.year1Likelihood!;
  assert.equal(l.word, 'almost certain');
  assert.ok(l.probability > 0.99);
  assert.equal(l.event, 'that this is a net saving');
});

test('a cost run without a detail row is "not available", not a throw', () => {
  const only = [{ key: 'unit_cost_delta', label: 'Per-unit cost change', unit: 'USD', p10: -1, p50: 0, p90: 1, detailJson: '{}' }];
  assert.ok(costViewOf(only).why);
  const s = snap([run(1n, 'done', 10, 20)], results(1n, only));
  assert.equal(buildAssessment(s, pr), undefined);
  const sum = buildSummary(s, pr);
  assert.equal(sum.hasAssessment, false);
  assert.match(sum.costNote!, /Cost not available for this revision/);
  assert.equal(sum.cost, undefined);
});

test('a statement opens the run it was written on, not the newest', () => {
  const a = rows0417l1 as Row[], b = rows0417l3 as Row[];
  assert.notEqual(net(a).p50, net(b).p50);
  const s = snap([run(1n, 'stale', 10, 20), run(2n, 'done', 30, 40)], [...results(1n, a), ...results(2n, b)], [statement(25)]);
  const out = buildAssessment(s, pr)!;
  const traceId = out.statement!.numbers[0].traceId!;
  assert.equal(traceId, 'stmt:1:run:net_total_year_one');
  assert.equal(out.traces[traceId].id, traceId);
  assert.match(out.traces[traceId].summary, /before the ECR changed/);
  assert.ok(out.statement!.numbersNote);
  // the cost page itself shows the newest run
  assert.equal(out.cost.net.p50, net(b).p50);
});

test('a statement finds its run by when the results were written, not by finishedAt', () => {
  // A: results at 20, marked stale at 30. B: results at 40, statement at 45, B marked stale at 50. C: results at 60.
  // Marking a run stale overwrites finishedAt, so finishedAt alone would pick A.
  const a = rows0417l1 as Row[], b = rows0417l3 as Row[];
  const s = snap([run(1n, 'stale', 10, 30), run(2n, 'stale', 35, 50), run(3n, 'done', 55, 60)],
    [...results(1n, a, 20), ...results(2n, b, 40), ...results(3n, a, 60)],
    [{ ...statement(45), numbers: [{ ...statement(45).numbers[0], p10: net(b).p10, p50: net(b).p50, p90: net(b).p90 }] }]);
  const out = buildAssessment(s, pr)!;
  const t = out.traces[out.statement!.numbers[0].traceId!];
  assert.ok(t, 'the statement drills into run B');
  assert.match(t.value!.text, new RegExp(Math.round(net(b).p50).toLocaleString('en-US')));
  // The evidence itself is run B's, not A's or C's.
  const inputsOf = (x: { inputs: { traceId?: string }[] }) => JSON.stringify(x.inputs.map(i => ({ ...i, traceId: undefined })));
  const fromA = inputsOf(fromChecks(a).traces.net_total_year_one), fromB = inputsOf(fromChecks(b).traces.net_total_year_one);
  assert.notEqual(fromA, fromB);
  assert.equal(inputsOf(t), fromB);
});

test('a statement whose run is gone has numbers but no drill-through', () => {
  const b = rows0417l3 as Row[];
  const s = snap([run(2n, 'done', 30, 40)], results(2n, b), [statement(25)]);
  const out = buildAssessment(s, pr)!;
  assert.equal(out.statement!.numbers[0].traceId, undefined);
  assert.match(out.statement!.numbersNote!, /no longer stored/);
});

test('a statement on the newest run drills into it', () => {
  const b = rows0417l3 as Row[];
  const s = snap([run(2n, 'done', 30, 40)], results(2n, b), [statement(45)]);
  const out = buildAssessment(s, pr)!;
  assert.equal(out.statement!.numbers[0].traceId, 'net_total_year_one');
  assert.equal(out.statement!.numbersNote, undefined);
});

test('previous-revision numbers are flagged while re-checking and after a failure', () => {
  const a = rows0417l1 as Row[];
  for (const [status, want] of [['queued', 'rechecking'], ['running', 'rechecking'], ['failed', 'failed'], ['blocked', 'failed']] as const) {
    const s = snap([run(1n, 'stale', 10, 20), run(2n, status, 30)], results(1n, a));
    assert.equal(buildSummary(s, pr).staleCost, want, status);
    assert.equal(buildAssessment(s, pr)!.ecr.staleCost, want, status);
  }
  const current = snap([run(1n, 'done', 10, 20)], results(1n, a));
  assert.equal(buildSummary(current, pr).staleCost, undefined);
});

test('reducer status changes are shown in business words', () => {
  assert.equal(plainSummary('approved -> merged'), 'moved from approved to released');
  assert.equal(plainSummary('draft -> review'), 'moved from submitted to in review');
  assert.equal(plainSummary('approved -> merged; baseline v3 -> v4, re-checked 2 other open ECR(s)'), 'moved from approved to released; baseline v3 to v4, re-checked 2 other open ECR(s)');
});
