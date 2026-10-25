// Cost completeness (#130): an applicable cost the cost page leaves out is a gap, not an assessed $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { deriveRecommendation, ruleInputOf } from '../../workers/src/level1/recommendation.ts';
import { assessCostFactors, incompleteCostFactors } from '../src/completeness.ts';
import { costCheck, type CostCheckResult } from '../src/cost.ts';
import { lognormal } from '../src/dist.ts';
import { costCheckRows } from '../src/rows.ts';
import { COST_BLOCKS, type ChangeRequest, type CostPageRow } from '../src/types.ts';

const SEED = 'norn-seed-1';
const get = (id: string): ChangeRequest => structuredClone(bowman.ecrs.find((x) => x.id === id)) as unknown as ChangeRequest;
const run = (e: ChangeRequest, assumptions?: Parameters<typeof costCheck>[2]['assumptions']) => costCheck(bowman, e, { seed: SEED, draws: 2000, maxDraws: 2000, assumptions });
const recommend = (r: CostCheckResult) => deriveRecommendation(ruleInputOf(costCheckRows(r), []));
const gapFlags = (r: CostCheckResult) => r.flags.filter((f) => f.kind === 'needs_estimate');
const rowsOf = (r: CostCheckResult) => COST_BLOCKS.flatMap((b) => r.blocks[b]);

const QUAL = 'cost:ECR-0407:production:qualification';
// An ECR with a clean cost page: ECR-0407 at its filing has nothing else the rule would call a gap.
const withRow = (e: ChangeRequest, row: CostPageRow): ChangeRequest => ((e.costPage.production = [...e.costPage.production, row]), e);

test('ECR-0407: coupon tests "Not estimated" and no cost-page row is a named gap, so no unconditional approval', () => {
  const e = get('ECR-0407');
  assert.deepEqual(e.costPage.production.map((r) => r.label), ['Prepreg unit cost'], 'the fixture is as filed: only the material saving');
  const r = run(e);
  const row = rowsOf(r).find((x) => x.id === QUAL)!;
  assert.ok(row, 'the omitted factor is a row on the cost page');
  assert.equal(row.needsEstimate, true);
  assert.equal(row.basis, 'default', 'a default standing in for a number, as a blank row is');
  assert.equal(row.total.point, 0);
  assert.equal(r.headline.oneTimeTotal.point, 0, 'still counted as $0, but marked unestimated');
  const gap = gapFlags(r);
  assert.equal(gap.length, 1);
  assert.equal(gap[0].ref, QUAL);
  assert.match(gap[0].message, /Test and qualification.*not on the cost page/);
  const input = r.inputs.find((i) => i.id === QUAL)!;
  assert.equal(input.needsEstimate, true);
  assert.equal(input.source, 'default');
  const factor = r.inputs.find((i) => i.id === 'factor:ECR-0407:qualification')!;
  assert.equal(factor.value, 'unknown');
  assert.match(factor.rationale!, /Cardinal data package/);
  assert.deepEqual(row.total.trace.uses.map((u) => u.id), ['factor:ECR-0407:qualification', QUAL]);
  // The stored rows carry it to the recommendation rule, the web report and the PLM statement.
  const stored = costCheckRows(r);
  assert.equal(JSON.parse(stored.find((x) => x.key === `line:${QUAL}`)!.detailJson).needsEstimate, true);
  const d = recommend(r);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.ok(d.conditions.some((c) => c.includes('Test and qualification')), d.conditions.join('; '));
});

test('an omitted row, a blank row, an explicit $0 and a stated "not applicable" are four different things', () => {
  const omitted = run(get('ECR-0407'));
  assert.equal(recommend(omitted).recommendation, 'Approve with conditions');

  // A blank row the originator left: the existing machinery flags it once; no second placeholder is added.
  const blank = run(withRow(get('ECR-0407'), { label: 'Coupon tests', basis: 'not_provided', factor: 'qualification' } as CostPageRow));
  assert.equal(gapFlags(blank).length, 1);
  assert.equal(gapFlags(blank)[0].ref, 'cost:ECR-0407:production:coupon-tests');
  assert.ok(!rowsOf(blank).some((x) => x.id === QUAL), 'no placeholder beside the blank row');
  assert.equal(blank.inputs.find((i) => i.id === 'factor:ECR-0407:qualification')!.value, 'unknown');
  assert.equal(recommend(blank).recommendation, 'Approve with conditions');

  // An explicit zero is an assessment: stated, traced, and not a gap.
  const zero = run(withRow(get('ECR-0407'), { label: 'Coupon tests', basis: 'engineer_estimate', oneTime: 0, factor: 'qualification' } as CostPageRow));
  assert.equal(gapFlags(zero).length, 0);
  const zeroRow = rowsOf(zero).find((x) => x.id === 'cost:ECR-0407:production:coupon-tests')!;
  assert.deepEqual([zeroRow.basis, zeroRow.oneTime?.p50, zeroRow.oneTime?.point], ['engineer_estimate', 0, 0], 'the stated $0 is a range, not a missing amount');
  assert.deepEqual([zeroRow.basis, zeroRow.oneTime?.p50, zeroRow.oneTime?.point], ['engineer_estimate', 0, 0], 'the stated $0 is a range, not a missing amount');
  assert.equal(zero.inputs.find((i) => i.id === 'factor:ECR-0407:qualification')!.source, 'given');
  assert.equal(recommend(zero).recommendation, 'Approve');

  // Not applicable, declared: recorded with its reason, not a gap, even though the prose describes tests.
  const na = get('ECR-0407') as ChangeRequest & { costFactors?: unknown };
  na.costFactors = [{ factor: 'qualification', status: 'not_applicable', note: 'Cardinal qualified the resin to the same allowables; no Bowman testing' }];
  const naRun = run(na);
  assert.equal(gapFlags(naRun).length, 0);
  const rec = naRun.inputs.find((i) => i.id === 'factor:ECR-0407:qualification')!;
  assert.equal(rec.value, 'not_applicable');
  assert.equal(rec.source, 'given');
  assert.match(rec.rationale!, /same allowables/);
  assert.equal(recommend(naRun).recommendation, 'Approve');

  // "Not applicable" with no reason is not an answer.
  for (const note of [undefined, '', '  ']) {
    const bare = get('ECR-0407') as ChangeRequest & { costFactors?: unknown };
    bare.costFactors = [{ factor: 'qualification', status: 'not_applicable', ...(note === undefined ? {} : { note }) }];
    const g = incompleteCostFactors(bare);
    assert.deepEqual(g.map((f) => [f.key, f.basis]), [['qualification', 'declared']], JSON.stringify(note));
    assert.match(g[0].reason, /without saying why/);
    assert.equal(recommend(run(bare)).recommendation, 'Approve with conditions');
  }
});

test('an estimate recorded as an assumption fills the omitted row and clears the gap', () => {
  const r = costCheck(bowman, get('ECR-0407'), { seed: SEED, assumptions: [{ id: QUAL, source: 'agent_estimated', rationale: 'Coupon tests at the lab rate', dist: lognormal(25_000, 0.25) }] });
  assert.equal(gapFlags(r).length, 0);
  const row = rowsOf(r).find((x) => x.id === QUAL)!;
  assert.equal(row.basis, 'agent_estimated');
  assert.ok(Math.abs(row.total.point - 25_000) < 1);
  assert.equal(recommend(r).recommendation, 'Approve');
});

test('no-impact and fast-track changes are left alone: ECR-0423 gets no invented estimate', () => {
  const e = get('ECR-0423');
  const r = run(e);
  assert.deepEqual(assessCostFactors(e).map((f) => [f.key, f.status]), [['qualification', 'not_applicable']]);
  assert.equal(gapFlags(r).length, 0);
  assert.ok(!rowsOf(r).some((x) => x.id.includes('qualification')), 'no placeholder row');
  assert.equal(recommend(r).recommendation, 'Approve');
  // No test text at all, or a blank one, is "none", never a gap.
  const withText = (text: string | undefined) => {
    const x = get('ECR-0423') as ChangeRequest & { testAndQualification?: string };
    if (text === undefined) delete x.testAndQualification; else x.testAndQualification = text;
    return incompleteCostFactors(x).length;
  };
  for (const text of [undefined, 'None', 'N/A', 'Not applicable.']) assert.equal(withText(text), 0, JSON.stringify(text));
  // A blank field is not an answer: only an explicit "none" can mean none.
  for (const text of ['', '  ']) assert.equal(withText(text), 1, JSON.stringify(text));
});

test('a stated retrofit with no retrofit cost is a gap; a retrofit still to be decided is not', () => {
  const e = get('ECR-0407');
  (e as { costFactors?: unknown }).costFactors = [{ factor: 'qualification', status: 'not_applicable', note: 'Same allowables, no Bowman testing' }];
  e.effectivity = { ...e.effectivity, retrofit: { basis: 'serial', from: '1', to: '10' } };
  const r = run(e);
  for (const k of ['retrofit_installation', 'retrofit_test']) {
    const row = rowsOf(r).find((x) => x.id === `cost:ECR-0407:retrofit:${k}`)!;
    assert.equal(row.block, 'retrofit');
    assert.equal(row.needsEstimate, true);
  }
  assert.equal(recommend(r).recommendation, 'Approve with conditions');

  // Parts alone do not stand for fitting and checking them; a row tagged for each does.
  const parts = { label: 'Retrofit kits, S/N 001-010', basis: 'supplier_quote', unitCost: 221, quantity: 120 } as CostPageRow;
  e.costPage.retrofit = [parts];
  assert.deepEqual(incompleteCostFactors(e).map((f) => f.key), ['retrofit_installation', 'retrofit_test']);
  e.costPage.retrofit = [parts, { label: 'Fit kits', basis: 'engineer_estimate', oneTime: 13_200, factor: 'retrofit_installation' } as CostPageRow];
  assert.deepEqual(incompleteCostFactors(e).map((f) => f.key), ['retrofit_test']);
  e.costPage.retrofit.push({ label: 'Re-test', basis: 'engineer_estimate', oneTime: 0, factor: 'retrofit_test' } as CostPageRow);
  assert.deepEqual(incompleteCostFactors(e), [], 'an explicit $0 re-test is an assessment');

  e.effectivity = { ...e.effectivity, retrofit: { basis: 'tbd', from: 'tbd' } };
  assert.equal(incompleteCostFactors(e).length, 0, 'tbd is an open question for the originator, and the schedule says so');
});

test('a factor the ECR declares applicable lands in its own block; declared "assessed" needs a row to stand', () => {
  const e = get('ECR-0407') as ChangeRequest & { costFactors?: unknown };
  e.costFactors = [{ factor: 'qualification', status: 'not_applicable', note: 'Same allowables, no Bowman testing' }, { factor: 'logistics_support', status: 'unknown', note: 'Manuals and spares not assessed' }, { factor: 'assessed_nowhere', status: 'assessed' }];
  const r = run(e);
  const row = rowsOf(r).find((x) => x.id === 'cost:ECR-0407:logisticsSupport:logistics_support')!;
  assert.equal(row.block, 'logisticsSupport');
  assert.match(gapFlags(r).map((f) => f.message).join('\n'), /Manuals and spares not assessed/);
  assert.ok(rowsOf(r).some((x) => x.id === 'cost:ECR-0407:other:assessed_nowhere' && x.needsEstimate), 'declared assessed with no row is still a gap');
});

test('the helper is pure and agrees with the cost check: schedule and PLM paths can use it alone', () => {
  const e = get('ECR-0407');
  const before = JSON.stringify(e);
  const gaps = incompleteCostFactors(e);
  assert.equal(JSON.stringify(e), before);
  assert.deepEqual(gaps.map((g) => [g.key, g.basis, g.rowIds.length]), [['qualification', 'inferred', 0]]);
  assert.deepEqual(gapFlags(run(e)).map((f) => f.ref), gaps.map((g) => `cost:ECR-0407:${g.block}:${g.key}`));
});

test('the dataset: factors with a tagged row are assessed; the only omitted qualification costs are the backlog\'s', () => {
  const status = Object.fromEntries(bowman.ecrs.map((e) => [e.id, Object.fromEntries(assessCostFactors(e as unknown as ChangeRequest).map((f) => [f.key, f.status]))]));
  for (const id of ['ECR-0417', 'ECR-0412', 'ECR-0415', 'ECR-0419', 'ECR-0421']) assert.equal(status[id].qualification, 'assessed', id);
  assert.equal(status['ECR-0409'].qualification, 'unknown', 'its testing row is blank: the row is the gap, not a second placeholder');
  assert.equal(status['ECR-0417'].retrofit_installation, 'assessed');
  assert.equal(status['ECR-0417'].retrofit_test, 'unknown', 'its re-test row is blank: the row is the gap');
  const omitted = bowman.ecrs.filter((e) => incompleteCostFactors(e as unknown as ChangeRequest).some((f) => f.rowIds.length === 0)).map((e) => e.id);
  assert.deepEqual(omitted, ['ECR-0406', 'ECR-0407', 'ECR-0410']);
});
