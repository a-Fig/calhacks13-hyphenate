// The schedule exposure, the budget impact and the runway impact (src/finance.ts, and the cost check that draws them).
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

test('the schedule exposure is reported beside the totals; the blank delay line and every total stay as on main', () => {
  const d = rows(r).find((x) => x.id === DELAY)!;
  assert.equal(d.basis, 'default', 'the originator\'s delay line is still the flagged blank');
  assert.equal(d.needsEstimate, true);
  assert.equal(d.total.point, 0);
  assert.equal(rows(r).filter((x) => /delay/i.test(x.label)).length, 1, 'one delay line, not two');
  assert.ok(r.flags.some((f) => f.kind === 'needs_estimate' && f.ref === DELAY));
  // Every total equals what the dataset gives without finance data (= main): the exposure is in none of them.
  for (const k of ['oneTimeTotal', 'recurringWindow', 'windowTotal', 'recurringPlan', 'planTotal'] as const) {
    assert.deepEqual(r.headline[k], none.headline[k], k);
  }
  assert.deepEqual(r.blockTotals, none.blockTotals);
  assert.deepEqual(r.measures, none.measures);
  assert.deepEqual(r.periods, none.periods);
  assert.deepEqual(r.unitCost, none.unitCost);
  // The numbers main prints for ECR-0417.
  assert.deepEqual([r.headline.oneTimeTotal.p10, r.headline.oneTimeTotal.p50, r.headline.oneTimeTotal.p90].map(Math.round), [142_083, 148_521, 155_795]);
  assert.equal(Math.round(r.headline.windowTotal.p50), 157_150);
  assert.equal(none.exposure, null);
  assert.equal(none.finance, null);
  assert.ok(r.exposure && r.exposure.cost.p50 > 100_000);
  // The same measure an approval rule asks for is the same with and without finance data.
  const m = costCheck(bowman, ecr('ECR-0417'), { ...fast, measures: [{ horizonMonths: 12, savingsOffset: false }] }).measures;
  const m0 = costCheck({ ...bowman, finance: undefined }, ecr('ECR-0417'), { ...fast, measures: [{ horizonMonths: 12, savingsOffset: false }] }).measures;
  assert.deepEqual(m, m0);
});

test('delay cost: weeks late (the timeline model) times the weekly cost, hand-checked', () => {
  const t = timelineCheck(bowman, ecr('ECR-0417'), { seed: SEED, draws: 10_000, maxDraws: 10_000 });
  const w = r.exposure!.weeksLate;
  // ECR-0417 states S/N 11 (2026-11-16); the timeline puts the cut-in 13.12 weeks later at the median, and in every draw.
  assert.equal(t.late!.probability, 1, 'late in every draw, so flooring at 0 changes nothing here');
  assert.equal(w.point, t.late!.weeks.point, 'the point estimate is the timeline\'s');
  for (const q of ['p10', 'p50', 'p90'] as const) assert.equal(w[q], t.late!.weeks[q], `weeks late ${q} is the timeline's, draw for draw`);
  // The point estimate: every input at its stated value, so weeks x the p50 weekly cost of $32,000.
  assert.equal(bowman.finance.delayCosts.find((x) => x.program === 'vesper')!.perWeekUsd.p50, 32_000);
  near(r.exposure!.cost.point, w.point * 32_000, 0.01, 'point = weeks late x $32,000 a week');
  assert.ok(r.exposure!.cost.p10 < r.exposure!.cost.p50 && r.exposure!.cost.p50 < r.exposure!.cost.p90);
  // Weeks and weekly cost vary independently of each other enough that p10 and p90 of the product are inside the
  // product of the extremes and outside the product of the medians' neighbours.
  assert.ok(r.exposure!.cost.p10 > w.p10 * 20_000 && r.exposure!.cost.p90 < w.p90 * 55_000, 'a product of two ranges is narrower than the product of their ends');
  assert.ok(r.exposure!.cost.p10 < w.p50 * 32_000 && r.exposure!.cost.p90 > w.p50 * 32_000);
  // The trace names both factors and the timeline inputs behind the weeks.
  const ids = r.exposure!.cost.trace.uses.map((u) => u.id);
  for (const id of ['finance:vesper:delay-per-week', 'decision:ECR-0417', 'stated:ECR-0417', 'lead:ECR-0417:BW-5120-210']) assert.ok(ids.includes(id), `trace names ${id}`);
  assert.equal(r.exposure!.cost.trace.uses.find((u) => u.id === 'finance:vesper:delay-per-week')!.source, 'given');
  assert.equal(r.exposure!.cost.trace.uses.find((u) => u.id === 'decision:ECR-0417')!.source, 'default');
});

test('weeks late is floored at 0: a change that arrives before the stated effectivity costs nothing', () => {
  const e = ecr('ECR-0417');
  e.effectivity.production = { basis: 'serial', from: '60' };
  const t = timelineCheck(bowman, e, fast);
  assert.ok(t.late!.weeks.p90 < 0, 'the timeline says it is early');
  const x = costCheck(bowman, e, fast);
  assert.equal(x.exposure!.weeksLate.p90, 0);
  assert.equal(x.exposure!.cost.p90, 0);
  assert.equal(x.exposure!.cost.point, 0);
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
  assert.ok(f.budget.share!.p50 > 0.0025 && f.budget.share!.p50 < 0.0035, `about 0.3% (the exposure is not in it): ${f.budget.share!.p50}`);
  for (const q of ['p10', 'p50', 'p90'] as const) near(f.budget.share![q], f.periodCost[q] / 51_600_000, 0.00005, `share ${q} is the cost's ${q} over a constant`);
  assert.ok(f.budget.share!.p10 < f.budget.share!.p50 && f.budget.share!.p50 < f.budget.share!.p90);
  
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

test('with and without the schedule exposure: the base figures exclude it, the second figure adds it per draw', () => {
  const f = r.finance!;
  const x = f.withExposure!;
  // The period cost without the exposure is the one-time total and the period's recurring cost: nothing else.
  near(f.periodCost.point, r.headline.oneTimeTotal.point + 12 * 415.2, 0.01, 'excludes the exposure');
  near(x.periodCost.point, f.periodCost.point + r.exposure!.cost.point, 0.01, 'point: period cost + exposure');
  assert.ok(x.periodCost.p50 > f.periodCost.p50 + 200_000 && x.periodCost.p90 > f.periodCost.p90 + 500_000);
  assert.ok(x.budgetShare!.p50 > 3 * f.budget.share!.p50, 'about 1.1% against about 0.3%');
  near(x.budgetShare!.p50, x.periodCost.p50 / 51_600_000, 0.00005, 'share including the exposure');
  assert.ok(f.budget.share!.p50 < 0.004 && x.budgetShare!.p50 > 0.01);
  assert.ok(x.daysUsed.p50 > 3 * f.runway.daysUsed.p50);
  // The exposure is added draw for draw: the second period cost's mean is the first plus the exposure's mean (means add exactly).
  near(x.periodCost.mean, f.periodCost.mean + r.exposure!.cost.mean, 0.02, 'means add');
  assert.ok(x.probabilityOver >= f.budget.probabilityOver);
  // Without a delay cost in the data there is no second figure.
  assert.equal(costCheck(withFinance((d) => { d.delayCosts = []; }), ecr('ECR-0417'), fast).finance!.withExposure, null);
  // Rows.
  const by = new Map(costCheckRows(r).map((y) => [y.key, y]));
  assert.equal(by.get('period_cost_with_exposure:vesper')!.p50, x.periodCost.p50);
  assert.equal(by.get('budget_share_with_exposure:vesper')!.p90, x.budgetShare!.p90);
  assert.equal(by.get('runway_days_with_exposure')!.p50, x.daysUsed.p50);
  assert.equal(by.get('schedule_exposure')!.p50, r.exposure!.cost.p50);
  assert.match(by.get('schedule_exposure')!.label, /not in totals/);
  assert.ok(JSON.parse(by.get('schedule_exposure')!.detailJson).trace.uses.length > 3);
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
  assert.ok(rw.daysUsed.p50 > 0.4 && rw.daysUsed.p50 < 0.5, `about half a day without the exposure: ${rw.daysUsed.p50}`);
  const ex = r.finance!.withExposure!;
  near(ex.daysUsed.p50, ex.periodCost.p50 / perDayUsd, 0.0005, 'days including the exposure');
  assert.ok(ex.daysUsed.p50 > 1 && ex.daysUsed.p50 < 3, `about a day and a half with it: ${ex.daysUsed.p50}`);
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
  assert.equal(JSON.stringify(again.exposure), JSON.stringify(r.exposure));
  assert.equal(JSON.stringify(costCheckRows(again)), JSON.stringify(costCheckRows(r)));
  const other = costCheck(bowman, ecr('ECR-0417'), { ...fast, seed: 'norn-seed-2' });
  assert.notEqual(JSON.stringify(other.exposure), JSON.stringify(r.exposure));
  near(other.exposure!.cost.p50 / r.exposure!.cost.p50, 1, 0.05, 'delay cost p50 across seeds');
  near(other.finance!.budget.share!.p50 / r.finance!.budget.share!.p50, 1, 0.05, 'budget share p50 across seeds');
});

test('the exposure and period cost are checked for convergence apart from the totals, which keep main\'s draws; every traced id is an input', () => {
  assert.deepEqual(r.convergence.metrics.map((m) => m.key), none.convergence.metrics.map((m) => m.key), 'the totals\' convergence loop is unchanged');
  assert.equal(r.draws, none.draws, 'so the totals are drawn exactly as on main');
  assert.deepEqual(r.financeConvergence!.metrics.map((m) => m.key).sort(), ['delayWeeks', 'exposure', 'periodCost', 'periodCostExposed']);
  assert.equal(none.financeConvergence, null);
  const full = costCheck(bowman, ecr('ECR-0417'), { seed: SEED });
  assert.equal(full.convergence.converged, true);
  assert.equal(full.financeConvergence!.converged, true);
  const ids = new Set(full.inputs.map((i) => i.id));
  const moneys: Money[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === 'object') {
      if ('trace' in x && 'p50' in x) moneys.push(x as Money);
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(full.finance);
  walk(full.exposure);
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
  assert.equal(by.get(`line:${DELAY}`)!.p50, 0, 'the delay line is the flagged blank');
  assert.equal(by.get('delay_weeks')!.unit, 'weeks');
  assert.equal(by.get('delay_weeks')!.p50, r.exposure!.weeksLate.p50);
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
  assert.equal(detail.exposure.cost.p50, r.exposure!.cost.p50);
  // Without finance data the rows are the old ones.
  assert.ok(!costCheckRows(none).some((x) => /^(delay_weeks|period_cost|budget_share|p_over_budget|runway_days)/.test(x.key)));
});

test('the text page prints the exposure apart from the totals, and the budget and runway with and without it', () => {
  const text = renderCostPage(r);
  const lines = text.split('\n');
  const totalsAt = lines.findIndex((l) => l.startsWith('Net total, whole volume plan'));
  const exposureAt = lines.findIndex((l) => l === 'Schedule exposure (not in totals)');
  assert.ok(exposureAt > totalsAt && totalsAt > 0, 'a section after the totals');
  assert.match(lines[exposureAt + 1], /Weeks late against S\/N 11 and subsequent: 13\.12 \[8\.3 to 20\.85\]/);
  assert.match(lines[exposureAt + 3], /Exposure if the line holds for every late week: 429,029 \[218,233 to 849,928\]/);
  assert.match(text, /One-time total: 148,521 \[142,083 to 155,795\]/);
  assert.match(text, /Net total, year one: 157,150 \[150,665 to 164,489\]/);
  assert.match(text, /Subtotal, other\s+0\s+0\s*$/m);
  assert.match(text, /Share of the remaining vesper budget: 0\.3% \[0\.29% to 0\.31%\] of 51,600,000/);
  assert.match(text, /including schedule exposure: 1\.13% \[0\.72% to 1\.95%\]/);
  assert.match(text, /Runway used: 0\.45 days \[0\.43 days to 0\.47 days\] of 690/);
  assert.match(text, /including schedule exposure: 1\.71 days \[1\.08 days to 2\.94 days\]/);
  assert.ok(!costCheckRows(none).some((y) => /exposure/.test(y.key)));
  assert.ok(!renderCostPage(none).includes('Schedule exposure'));
});

test('an assumption still replaces the delay line, and the weekly cost needs replacesGiven', () => {
  const est = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: DELAY, source: 'agent_estimated', dist: point(30_000), rationale: 'Four aircraft held two days' }] });
  const d = rows(est).find((x) => x.id === DELAY)!;
  assert.equal(d.total.point, 30_000);
  assert.equal(d.basis, 'agent_estimated');
  near(est.headline.oneTimeTotal.point - none.headline.oneTimeTotal.point, 30_000, 0.01, 'an estimate on the line is a cost in the totals, as on main');
  assert.equal(est.exposure!.cost.point, r.exposure!.cost.point, 'and the exposure is unchanged beside it');
  assert.equal(rows(est).filter((x) => /delay/i.test(x.label)).length, 1);
  const weeklyId = 'finance:vesper:delay-per-week';
  const refused = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: weeklyId, source: 'agent_estimated', dist: point(10_000), rationale: 'cheaper' }] });
  assert.ok(refused.flags.some((f) => f.kind === 'assumption_not_applied' && f.ref === weeklyId));
  assert.equal(refused.exposure!.cost.point, r.exposure!.cost.point, 'stated number kept');
  const applied = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: weeklyId, source: 'agent_estimated', dist: point(10_000), rationale: 'cheaper', replacesGiven: true }] });
  near(applied.exposure!.cost.point, applied.exposure!.weeksLate.point * 10_000, 0.01, 'weeks x $10,000');
  assert.equal(applied.exposure!.cost.trace.uses.find((u) => u.id === weeklyId)!.source, 'agent_estimated');
  // An assumption on the board's decision time (a timeline input) moves the weeks, and is not reported unused.
  const quick = costCheck(bowman, ecr('ECR-0417'), { ...fast, assumptions: [{ id: 'decision:ECR-0417', source: 'agent_estimated', dist: point(1), rationale: 'Emergency board' }] });
  assert.ok(quick.exposure!.weeksLate.p50 < r.exposure!.weeksLate.p50, 'a quicker decision means fewer weeks late');
  assert.ok(!quick.flags.some((f) => f.kind === 'unused_assumption' && f.ref === 'decision:ECR-0417'));
});

test('no stated effectivity to be late against: no exposure, the blank line stays flagged, and the budget is still measured', () => {
  const e = ecr('ECR-0417');
  e.effectivity.production = { basis: 'tbd', from: '' };
  const x = costCheck(bowman, e, fast);
  assert.equal(x.exposure, null);
  assert.equal(rows(x).find((y) => y.id === DELAY)!.needsEstimate, true);
  assert.ok(x.flags.some((f) => f.kind === 'exposure_not_computed' && f.ref === DELAY));
  assert.ok(x.finance && x.finance.budget.share);
});

test('finance data for another program, or none, leaves the cost page as it was', () => {
  const noBudget = costCheck(withFinance((f) => { f.budgets = f.budgets.filter((b) => b.program !== 'vesper'); }), ecr('ECR-0417'), fast);
  assert.equal(noBudget.finance, null);
  assert.ok(noBudget.flags.some((f) => f.kind === 'no_budget'));
  assert.ok(noBudget.exposure, 'the delay cost does not need the budget');
  const noDelay = costCheck(withFinance((f) => { f.delayCosts = []; }), ecr('ECR-0417'), fast);
  assert.equal(noDelay.exposure, null);
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
