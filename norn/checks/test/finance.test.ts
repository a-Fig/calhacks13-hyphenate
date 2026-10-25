// The delay cost, the budget impact and the runway impact (src/finance.ts, and the cost check that draws them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck, slug, type CostCheckResult, type Money } from '../src/cost.ts';
import { lognormal, point } from '../src/dist.ts';
import { renderCostPage } from '../src/format.ts';
import { monthSpan, perDay } from '../src/finance.ts';
import { costCheckRows } from '../src/rows.ts';
import { timelineCheck } from '../src/timeline.ts';
import { COST_BLOCKS, type Baseline, type ChangeRequest, type Finance } from '../src/types.ts';

const SEED = 'norn-seed-1';
const fast = { seed: SEED, draws: 10_000, maxDraws: 10_000 };
const ecr = (id: string): ChangeRequest => structuredClone(bowman.ecrs.find((x) => x.id === id)!) as unknown as ChangeRequest;
const rows = (r: CostCheckResult) => COST_BLOCKS.flatMap((b) => r.blocks[b]);
const DELAY = `cost:ECR-0417:other:${slug('Delay cost of holding S/N 011-014 at the controller-install station')}`;
const withFinance = (f: (x: Finance) => void): Baseline => {
  const b = structuredClone(bowman) as unknown as Baseline;
  f(b.finance!);
  return b;
};
const near = (a: number, b: number, abs: number, what: string) => assert.ok(Math.abs(a - b) <= abs, `${what}: ${a} vs ${b} (±${abs})`);

const none = costCheck({ ...bowman, finance: undefined }, ecr('ECR-0417'), fast);
const r = costCheck(bowman, ecr('ECR-0417'), fast);

test('the blank delay line is filled in place, as an exposure, not duplicated', () => {
  const delayRows = rows(r).filter((x) => /delay/i.test(x.label));
  assert.equal(delayRows.length, 1, 'one delay line');
  const d = delayRows[0];
  assert.equal(d.id, DELAY, 'the same row id as the blank line, so assumptions keep finding it');
  assert.equal(d.block, 'other');
  assert.match(d.label, /^Delay cost of holding S\/N 011-014 at the controller-install station \(exposure\)$/);
  assert.equal(d.exposure, true);
  assert.equal(d.basis, 'computed');
  assert.equal(d.needsEstimate, undefined);
  assert.match(d.note ?? '', /exposure \(worst case\)/);
  assert.ok(!r.flags.some((f) => f.kind === 'needs_estimate' && f.ref === DELAY), 'no longer flagged as blank');
  assert.equal(rows(none).find((x) => x.id === DELAY)!.total.point, 0, 'without finance data it stays the $0 blank');
  assert.equal(none.delay, null);
  assert.equal(none.finance, null);
  // It joins the one-time total and the block subtotal.
  near(r.headline.oneTimeTotal.point - none.headline.oneTimeTotal.point, d.total.point, 0.01, 'one-time total moves by the delay line');
  assert.equal(r.blockTotals.other.total.point, d.total.point);
  assert.equal(r.delay!.row, DELAY);
  assert.deepEqual(r.delay!.cost, d.total);
});

test('delay cost: weeks late (the timeline model) times the weekly cost, hand-checked', () => {
  const t = timelineCheck(bowman, ecr('ECR-0417'), { seed: SEED, draws: 10_000, maxDraws: 10_000 });
  const w = r.delay!.weeksLate;
  // ECR-0417 states S/N 11 (2026-11-16); the timeline puts the cut-in 13.12 weeks later at the median, and in every draw.
  assert.equal(t.late!.probability, 1, 'late in every draw, so flooring at 0 changes nothing here');
  assert.equal(w.point, t.late!.weeks.point, 'the point estimate is the timeline\'s');
  for (const q of ['p10', 'p50', 'p90'] as const) assert.equal(w[q], t.late!.weeks[q], `weeks late ${q} is the timeline's, draw for draw`);
  // The point estimate: every input at its stated value, so weeks x the p50 weekly cost of $32,000.
  assert.equal(bowman.finance.delayCosts.find((x) => x.program === 'vesper')!.perWeekUsd.p50, 32_000);
  near(r.delay!.cost.point, w.point * 32_000, 0.01, 'point = weeks late x $32,000 a week');
  assert.ok(r.delay!.cost.p10 < r.delay!.cost.p50 && r.delay!.cost.p50 < r.delay!.cost.p90);
  // Weeks and weekly cost vary independently of each other enough that p10 and p90 of the product are inside the
  // product of the extremes and outside the product of the medians' neighbours.
  assert.ok(r.delay!.cost.p10 > w.p10 * 20_000 && r.delay!.cost.p90 < w.p90 * 55_000, 'a product of two ranges is narrower than the product of their ends');
  assert.ok(r.delay!.cost.p10 < w.p50 * 32_000 && r.delay!.cost.p90 > w.p50 * 32_000);
  // The trace names both factors and the timeline inputs behind the weeks.
  const ids = r.delay!.cost.trace.uses.map((u) => u.id);
  for (const id of [DELAY.replace('cost:', 'row:'), 'finance:vesper:delay-per-week', 'decision:ECR-0417', 'stated:ECR-0417', 'lead:ECR-0417:BW-5120-210']) assert.ok(ids.includes(id), `trace names ${id}`);
  assert.equal(r.delay!.cost.trace.uses.find((u) => u.id === 'finance:vesper:delay-per-week')!.source, 'given');
  assert.equal(r.delay!.cost.trace.uses.find((u) => u.id === 'decision:ECR-0417')!.source, 'default');
});

test('weeks late is floored at 0: a change that arrives before the stated effectivity costs nothing', () => {
  const e = ecr('ECR-0417');
  e.effectivity.production = { basis: 'serial', from: '60' };
  const t = timelineCheck(bowman, e, fast);
  assert.ok(t.late!.weeks.p90 < 0, 'the timeline says it is early');
  const x = costCheck(bowman, e, fast);
  assert.equal(x.delay!.weeksLate.p90, 0);
  assert.equal(x.delay!.cost.p90, 0);
  assert.equal(x.delay!.cost.point, 0);
});

test('budget impact: the cost in the period over the remaining budget, hand-checked', () => {
  const f = r.finance!;
  assert.equal(f.program, 'vesper');
  assert.equal(f.period.label, 'FY2027 (Jul 2026 to Jun 2027)');
  assert.equal(f.budget.budgetUsd, 72_000_000);
  assert.equal(f.budget.spentToDateUsd, 20_400_000);
  assert.equal(f.budget.remainingUsd, 51_600_000, '72.0M - 20.4M');
  // Cut-in S/N 11 is November 2026; the plan completes 12 Vesper aircraft from then to June 2027 (Nov, Dec, Jan, Feb 1 each; Mar to Jun 2 each).
  // The recurring change is $415.20 an aircraft (12 brackets x $34.60). Meridian's cut-in (2027-09) is after the period.
  const oneTime = r.headline.oneTimeTotal.point;
  near(f.periodCost.point, oneTime + 12 * 415.2, 0.01, 'period cost = one-time total + 12 aircraft x $415.20');
  near(f.budget.share!.point, f.periodCost.point / 51_600_000, 0.00005, 'share = period cost / $51.6M');
  for (const q of ['p10', 'p50', 'p90'] as const) near(f.budget.share![q], f.periodCost[q] / 51_600_000, 0.00005, `share ${q} is the cost's ${q} over a constant`);
  assert.ok(f.budget.share!.p10 < f.budget.share!.p50 && f.budget.share!.p50 < f.budget.share!.p90);
  assert.ok(f.budget.share!.p50 > 0.005 && f.budget.share!.p50 < 0.02, `about 1%: ${f.budget.share!.p50}`);
  assert.equal(f.budget.probabilityOver, 0, 'half a million against $51.6M left');
  // It is the year-one cost less the units after June 2027.
  assert.ok(f.periodCost.p50 < r.headline.windowTotal.p50, 'a period that ends in June 2027 holds less recurring cost than the 12 months from the cut-in');
});

test('the period clips the recurring cost: units built from the cut-in to the period end', () => {
  const at = (from: string, to: string) => costCheck(withFinance((f) => { f.budgets[0].period = { label: 'test', from, to }; }), ecr('ECR-0417'), fast).finance!;
  const oneTime = r.headline.oneTimeTotal.point;
  near(at('2026-07', '2026-12').periodCost.point, oneTime + 2 * 415.2, 0.01, 'November and December: 2 aircraft');
  near(at('2026-07', '2026-10').periodCost.point, oneTime, 0.01, 'a period that ends before the cut-in has only the one-time cost');
  near(at('2027-01', '2027-02').periodCost.point, oneTime + 2 * 415.2, 0.01, 'a period that starts after the cut-in counts only its own months (January, February)');
  assert.equal(monthSpan('2026-07', '2027-06'), 12);
  assert.equal(monthSpan('2026-12', '2027-01'), 2);
});

test('whether the change exceeds the remaining budget: the share of draws over it', () => {
  const p50 = r.finance!.periodCost.p50;
  const at = (remaining: number) => costCheck(withFinance((f) => { f.budgets[0].spentToDateUsd = f.budgets[0].budgetUsd - remaining; }), ecr('ECR-0417'), fast).finance!;
  const mid = at(Math.round(p50));
  near(mid.budget.probabilityOver, 0.5, 0.03, 'remaining budget at the cost\'s median: about half the draws are over');
  near(mid.budget.share!.p50, 1, 0.03, 'and the share is about 100%');
  assert.equal(at(1_000).budget.probabilityOver, 1);
  assert.equal(at(100_000_000).budget.probabilityOver, 0);
  const gone = costCheck(withFinance((f) => { f.budgets[0].spentToDateUsd = f.budgets[0].budgetUsd; }), ecr('ECR-0417'), fast);
  assert.equal(gone.finance!.budget.share, null, 'nothing left to take a share of');
  assert.equal(gone.finance!.budget.probabilityOver, 1);
  assert.ok(!costCheckRows(gone).some((x) => x.key.startsWith('budget_share')));
  assert.match(renderCostPage(gone), /is spent/);
});

test('runway impact: days of cash burn the cost uses, hand-checked', () => {
  const rw = r.finance!.runway;
  const perDayUsd = (10_400_000 * 12) / 365;
  assert.equal(perDay(10_400_000), perDayUsd);
  near(perDayUsd, 341_917.81, 0.01, '$10.4M a month x 12 / 365 = $341,917.81 a day');
  assert.equal(rw.burnPerDayUsd, 341_917.81);
  assert.equal(rw.runwayDaysNow, 690, '$236M / $341,918 = 690.2 days');
  near(rw.daysUsed.point, rw.periodCost.point / perDayUsd, 0.0005, 'days = cost / burn per day');
  for (const q of ['p10', 'p50', 'p90'] as const) near(rw.daysUsed[q], rw.periodCost[q] / perDayUsd, 0.0005, `days ${q}`);
  assert.ok(rw.daysUsed.p50 > 1 && rw.daysUsed.p50 < 3, `about a day and a half: ${rw.daysUsed.p50}`);
  // The runway counts every program the change touches; the budget only the ECR's own. Here Meridian's cut-in is after the period.
  const wide = costCheck(withFinance((f) => { f.budgets[0].period = { label: 'to 2028', from: '2026-07', to: '2028-12' }; }), ecr('ECR-0417'), fast).finance!;
  assert.ok(wide.runway.periodCost.point > wide.periodCost.point, 'Meridian\'s recurring cost is in the runway figure, not in the Vesper budget figure');
  // A saving extends the runway: ECR-0423 swaps a part for one $1.90 cheaper, so its cost is negative and so are the days.
  // Its cut-in, S/N 28, is after FY2027, so the period is stretched to end in 2028 to catch the units.
  const s = costCheck(withFinance((f) => { f.budgets[0].period = { label: 'to 2028', from: '2026-07', to: '2028-12' }; }), ecr('ECR-0423'), fast).finance!; // its cut-in (S/N 28) is after FY2027
  assert.ok(s.runway.periodCost.p90 < 0, `a net saving: ${s.runway.periodCost.p90}`);
  assert.ok(s.runway.daysUsed.p90 < 0 && s.runway.daysUsed.p10 < s.runway.daysUsed.p90, 'negative days: runway gained');
  near(s.runway.daysUsed.p50, s.runway.periodCost.p50 / perDayUsd, 0.01, 'same arithmetic, negative sign');
  assert.ok(s.budget.share!.p50 < 0 && s.budget.probabilityOver === 0);
});

test('same inputs and seed give the same numbers; another seed moves only sampling noise', () => {
  const again = costCheck(bowman, ecr('ECR-0417'), fast);
  assert.equal(JSON.stringify(again.finance), JSON.stringify(r.finance));
  assert.equal(JSON.stringify(again.delay), JSON.stringify(r.delay));
  assert.equal(JSON.stringify(costCheckRows(again)), JSON.stringify(costCheckRows(r)));
  const other = costCheck(bowman, ecr('ECR-0417'), { ...fast, seed: 'norn-seed-2' });
  assert.notEqual(JSON.stringify(other.delay), JSON.stringify(r.delay));
  near(other.delay!.cost.p50 / r.delay!.cost.p50, 1, 0.05, 'delay cost p50 across seeds');
  near(other.finance!.budget.share!.p50 / r.finance!.budget.share!.p50, 1, 0.05, 'budget share p50 across seeds');
});

test('the new numbers are in the convergence check, and every traced id is an input', () => {
  const keys = r.convergence.metrics.map((m) => m.key);
  for (const k of ['delayWeeks', `${DELAY}/total`, 'periodCost']) assert.ok(keys.includes(k), `convergence covers ${k}`);
  const full = costCheck(bowman, ecr('ECR-0417'), { seed: SEED });
  assert.equal(full.convergence.converged, true);
  const ids = new Set(full.inputs.map((i) => i.id));
  const moneys: Money[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === 'object') {
      if ('trace' in x && 'p50' in x) moneys.push(x as Money);
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(full.finance);
  walk(full.delay);
  assert.ok(moneys.length >= 6);
  for (const m of moneys) for (const u of m.trace.uses) {
    assert.ok(ids.has(u.id), `trace names ${u.id}, which is not in the inputs`);
    assert.equal(full.inputs.find((i) => i.id === u.id)!.source, u.source);
  }
  // The finance figures are inputs with their provenance in the rationale.
  const burn = full.inputs.find((i) => i.id === 'finance:burn')!;
  assert.equal(burn.value, 10_400_000);
  assert.match(burn.rationale ?? '', /^invented: /);
});

test('rows: delay weeks, period cost, budget share, chance over budget, days of runway', () => {
  const out = costCheckRows(r);
  const by = new Map(out.map((x) => [x.key, x]));
  const delay = by.get(`line:${DELAY}`)!;
  assert.match(delay.label, /\(exposure\)$/);
  assert.equal(delay.p50, r.delay!.cost.p50);
  assert.equal(by.get('delay_weeks')!.unit, 'weeks');
  assert.equal(by.get('delay_weeks')!.p50, r.delay!.weeksLate.p50);
  assert.equal(by.get('period_cost:vesper')!.unit, 'USD');
  assert.equal(by.get('budget_share:vesper')!.unit, 'fraction');
  assert.equal(by.get('budget_share:vesper')!.p50, r.finance!.budget.share!.p50);
  assert.equal(by.get('p_over_budget:vesper')!.unit, 'probability');
  assert.equal(by.get('runway_days')!.unit, 'days');
  assert.equal(by.get('runway_days')!.p90, r.finance!.runway.daysUsed.p90);
  for (const k of ['delay_weeks', 'period_cost:vesper', 'budget_share:vesper', 'runway_days']) {
    const x = by.get(k)!;
    assert.ok(x.p10 <= x.p50 && x.p50 <= x.p90, k);
    const d = JSON.parse(x.detailJson);
    assert.ok(d.trace.formula.length > 0 && d.trace.uses.length > 0, `${k} has a trace`);
  }
  assert.equal(out.at(-1)!.key, 'detail', 'detail stays last');
  const detail = JSON.parse(out.at(-1)!.detailJson);
  assert.equal(detail.finance.budget.remainingUsd, 51_600_000);
  assert.equal(detail.delay.row, DELAY);
  // Without finance data the rows are the old ones.
  assert.ok(!costCheckRows(none).some((x) => /^(delay_weeks|period_cost|budget_share|p_over_budget|runway_days)/.test(x.key)));
});

test('the text page prints the delay exposure, the budget share and the runway', () => {
  const text = renderCostPage(r);
  assert.match(text, /Delay cost of holding S\/N 011-014 at the controller-ins… †/);
  assert.match(text, /† exposure, not an expected cost/);
  assert.match(text, /Weeks late against the stated effectivity \(floored at 0\): 13\.12 \[8\.3 to 20\.85\]/);
  assert.match(text, /Share of the remaining vesper budget: 1\.\d+% \[0\.\d+% to 1\.\d+%\] of 51,600,000/);
  assert.match(text, /Runway used: 1\.\d+ days \[/);
  assert.ok(!/delay.*counted as 0/i.test(text.split('\n').filter((l) => l.includes('Delay cost')).join('\n')));
});

test('an assumption still replaces the delay line, and the weekly cost needs replacesGiven', () => {
  const est = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: DELAY, source: 'agent_estimated', dist: point(30_000), rationale: 'Four aircraft held two days' }] });
  const d = rows(est).find((x) => x.id === DELAY)!;
  assert.equal(d.total.point, 30_000);
  assert.equal(d.basis, 'agent_estimated');
  assert.equal(est.delay, null, 'the estimate replaces the model, so there is no model result');
  assert.equal(rows(est).filter((x) => /delay/i.test(x.label)).length, 1);
  const weeklyId = 'finance:vesper:delay-per-week';
  const refused = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: weeklyId, source: 'agent_estimated', dist: point(10_000), rationale: 'cheaper' }] });
  assert.ok(refused.flags.some((f) => f.kind === 'assumption_not_applied' && f.ref === weeklyId));
  assert.equal(refused.delay!.cost.point, r.delay!.cost.point, 'stated number kept');
  const applied = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: weeklyId, source: 'agent_estimated', dist: point(10_000), rationale: 'cheaper', replacesGiven: true }] });
  near(applied.delay!.cost.point, applied.delay!.weeksLate.point * 10_000, 0.01, 'weeks x $10,000');
  assert.equal(applied.delay!.cost.trace.uses.find((u) => u.id === weeklyId)!.source, 'agent_estimated');
  // An assumption on the board's decision time (a timeline input) moves the weeks, and is not reported unused.
  const quick = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: 'decision:ECR-0417', source: 'agent_estimated', dist: point(1), rationale: 'Emergency board' }] });
  assert.ok(quick.delay!.weeksLate.p50 < r.delay!.weeksLate.p50, 'a quicker decision means fewer weeks late');
  assert.ok(!quick.flags.some((f) => f.kind === 'unused_assumption' && f.ref === 'decision:ECR-0417'));
});

test('no stated effectivity to be late against: the delay line stays blank, flagged, and the budget is still measured', () => {
  const e = ecr('ECR-0417');
  e.effectivity.production = { basis: 'tbd', from: '' };
  const x = costCheck(bowman, e, fast);
  assert.equal(x.delay, null);
  assert.equal(rows(x).find((y) => y.id === DELAY)!.needsEstimate, true);
  assert.ok(x.flags.some((f) => f.kind === 'delay_not_computed' && f.ref === DELAY));
  assert.ok(x.finance && x.finance.budget.share);
});

test('finance data for another program, or none, leaves the cost page as it was', () => {
  const noBudget = costCheck(withFinance((f) => { f.budgets = f.budgets.filter((b) => b.program !== 'vesper'); }), ecr('ECR-0417'), fast);
  assert.equal(noBudget.finance, null);
  assert.ok(noBudget.flags.some((f) => f.kind === 'no_budget'));
  assert.ok(noBudget.delay, 'the delay cost does not need the budget');
  const noDelay = costCheck(withFinance((f) => { f.delayCosts = []; }), ecr('ECR-0417'), fast);
  assert.equal(noDelay.delay, null);
  assert.equal(noDelay.headline.oneTimeTotal.point, none.headline.oneTimeTotal.point);
  assert.ok(noDelay.finance, 'the budget does not need the delay cost');
});

test('the library names no company', () => {
  for (const f of ['finance.ts', 'cost.ts', 'defaults.ts', 'rows.ts', 'format.ts']) {
    assert.ok(!/bowman/i.test(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')), `src/${f} names a company`);
  }
});

// Keep the imports used by the type checker honest.
void lognormal;
