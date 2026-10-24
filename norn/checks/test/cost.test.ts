import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { demoScenarios } from '../../../bowman/data/scenarios.ts';
import { costCheck, slug, type CostCheckResult, type Money } from '../src/cost.ts';
import { lognormal, point } from '../src/dist.ts';
import { formatUsd, renderCostPage } from '../src/format.ts';
import { costCheckRows } from '../src/rows.ts';
import { COST_BLOCKS, type ChangeRequest } from '../src/types.ts';

const SEED = 'norn-seed-1';
const ecr = (id: string): ChangeRequest => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return structuredClone(e);
};
const near = (a: number, b: number, rel: number, what: string) =>
  assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-9), `${what}: ${a} vs ${b} (±${rel * 100}%)`);
const rows = (r: CostCheckResult) => COST_BLOCKS.flatMap((b) => r.blocks[b]);
const row = (r: CostCheckResult, id: string) => {
  const x = rows(r).find((y) => y.id === id);
  if (!x) throw new Error(`no row ${id}: ${rows(r).map((y) => y.id).join(', ')}`);
  return x;
};
const key = (id: string) => demoScenarios.find((s) => s.ecrs.includes(id))!.reference!;
/** A cost-page row's id: the slug of its label, so it survives rows being added or reordered. */
const rowId = (ecrId: string, block: string, label: string) => `cost:${ecrId}:${block}:${slug(label)}`;
const DELAY = rowId('ECR-0417', 'other', 'Delay cost of holding S/N 011-014 at the controller-install station');
const PREMIUM = 'premium:Q-HAL-26-1187#1';

const r417 = costCheck(bowman, ecr('ECR-0417'), { seed: SEED });

test('ECR-0417 matches the answer key in bowman/data/scenarios.ts', () => {
  const k = key('ECR-0417');
  const vesper = r417.headline.unitCostDelta.find((u) => u.program === 'vesper')!.perUnit;
  assert.equal(vesper.point, k.steadyStateDeltaPerAircraftUsd, 'steady state +12 × $34.60 per aircraft');
  const nre = r417.blocks.production.filter((x) => x.id.startsWith('cost:ECR-0417:production:')).reduce((a, x) => a + x.total.point, 0);
  assert.equal(nre, k.oneTimeNreUsd, 'tooling, NC programming, first article, engineering, qualification');
  assert.equal(row(r417, rowId('ECR-0417', 'retrofit', 'Rev C brackets for retrofit, S/N 001-010')).total.point, k.retrofitPartsUsd);
  assert.equal(row(r417, rowId('ECR-0417', 'retrofit', 'Installation labor, 12 h per aircraft at $110')).total.point, k.retrofitLaborUsd);
  const inv = r417.inventory.find((i) => i.item === 'BW-5120-210')!;
  const scrapped = inv.rows.filter((x) => x.disposition === 'scrap' || x.disposition === 'mandatory_install');
  assert.equal(scrapped.reduce((a, x) => a + x.qty, 0), k.brackets_scrapped, 'stores 96, WIP 48, at Halden 60, installed 120');
  near(scrapped.reduce((a, x) => a + x.cost.point, 0), k.scrapNetOfSalvageUsd, 0.001, 'scrap net of salvage');
  assert.equal(inv.rows.find((x) => x.disposition === 'cancel')!.cost.point, k.cancellationChargeUsd, 'the quoted 10% on 60 not started');
  const ppv = row(r417, PREMIUM);
  assert.equal(ppv.label, 'First-lot price premium (booked as PPV)');
  assert.equal(ppv.basis, 'supplier_quote');
  assert.equal(ppv.total.point, 25 * (239.5 - 221), 'first lot of 25 at $239.50: $18.50 a bracket over the new standard');
  // The key books the premium as a purchase price variance, not one-time cost: compare without that row.
  near(r417.headline.oneTimeTotal.point - ppv.total.point, k.oneTimeTotalUsd, 0.001, 'one-time total without the PPV row');
  assert.equal(r417.headline.unitCostDelta.find((u) => u.program === 'meridian')!.perUnit.point, 34.6 * 8, 'Meridian: $34.60 × 8, no retrofit');
  assert.deepEqual(r417.effectivity.map((e) => [e.program, e.cutInSerial, e.source]), [['vesper', 11, 'given'], ['meridian', 1, 'default']]);
});

test('ECR-0417 has the shape and rough size of docs/IN-PRACTICE.md\'s worked example, scaled to the dataset', () => {
  // The worked example: 4 retrofit aircraft and 252 scrapped brackets; one-time $111,194 (which includes the
  // $462.50 first-lot premium), steady state +$415. Bowman's data: 10 aircraft built and 324 brackets to
  // scrap. Scale the volume-driven lines, keep the rest.
  const retrofit = (10_608 + 5_280) * (10 / 4);
  const scrap = (46_973 - 718) * (324 / 252);
  const fixed = 13_600 + 18_500 + 15_370 + 1_118 + 462.5;
  assert.ok(Math.abs(13_600 + 18_500 + 15_370 + 10_608 + 5_280 + 46_973 - 718 + 1_118 + 462.5 - 111_194) < 1, 'the example adds up with the premium in it');
  near(r417.headline.oneTimeTotal.point, retrofit + scrap + fixed, 0.001, 'one-time total against the scaled example');
  near(r417.headline.unitCostDelta[0].perUnit.p50, 415, 0.01, 'steady state per aircraft');
  for (const b of COST_BLOCKS) assert.ok(Array.isArray(r417.blocks[b]), `block ${b}`);
  assert.ok(r417.blocks.production.some((x) => x.recurring) && r417.blocks.production.some((x) => !x.recurring), 'production has recurring and one-time rows');
  assert.ok(r417.blocks.production.some((x) => x.id === 'inventory:BW-5120-210'), 'inventory disposition is its own line');
  const head = r417.piecePrices.find((p) => p.item === 'BW-5120-210')!.head!;
  assert.ok(head.p10 < 221 && head.p90 > 221, `piece price range ${head.p10} to ${head.p90}`);
  near(head.p50, 221, 0.005, 'piece price p50');
  assert.equal(r417.drivers[0].kind, 'decision', 'use-up versus scrap is the biggest swing');
  assert.match(r417.drivers[0].id, /BW-5120-210/);
});

test('blank cost-page rows become flagged default assumptions; the blank scrap row is filled by the disposition line', () => {
  const delay = row(r417, DELAY);
  assert.equal(delay.basis, 'default');
  assert.equal(delay.needsEstimate, true);
  assert.equal(delay.total.point, 0);
  const rec = r417.inputs.find((i) => i.id === DELAY)!;
  assert.equal(rec.source, 'default');
  assert.equal(rec.needsEstimate, true);
  assert.ok(r417.flags.some((f) => f.kind === 'needs_estimate' && f.ref === DELAY));
  assert.ok(!rows(r417).some((x) => x.id === rowId('ECR-0417', 'production', 'Scrap and write-off of Rev B inventory')), 'no $0 placeholder for the scrap row');
  assert.match(row(r417, 'inventory:BW-5120-210').note ?? '', /Scrap and write-off of Rev B inventory/);
});

test('the supplier quote is a given input, and every traced id is in the inputs with the same source', () => {
  const byId = new Map(r417.inputs.map((i) => [i.id, i]));
  const quote = byId.get('quote:Q-HAL-26-1187#0')!;
  assert.equal(quote.source, 'given');
  assert.ok(r417.headline.unitCostDelta[0].perUnit.trace.uses.some((u) => u.id === 'quote:Q-HAL-26-1187#0'), 'the new price traces to the quote');
  assert.equal(byId.get('cancel:BW-5120-210')!.source, 'given', 'the cancellation charge is read from the quote');
  const moneys: Money[] = [];
  const walk = (x: unknown) => {
    if (x && typeof x === 'object') {
      if ('trace' in x && 'p50' in x) moneys.push(x as Money);
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(r417);
  assert.ok(moneys.length > 40, `${moneys.length} numbers`);
  for (const m of moneys) {
    assert.equal(m.trace.evidence, 'computation');
    assert.ok(m.trace.formula.length > 0, 'a formula label');
    for (const u of m.trace.uses) {
      const rec = byId.get(u.id);
      assert.ok(rec, `traced id ${u.id} is in the inputs`);
      assert.equal(rec.source, u.source, `${u.id} source`);
    }
    assert.ok(m.p10 <= m.p50 && m.p50 <= m.p90, `ordered percentiles ${m.p10} ${m.p50} ${m.p90}`);
  }
});

test('the result is plain JSON, ready to store as check result rows', () => {
  const json = JSON.stringify(r417);
  assert.ok(!/NaN|Infinity/.test(json));
  assert.deepEqual(JSON.parse(json), r417);
  const out = costCheckRows(r417);
  assert.ok(out.length > 15);
  for (const x of out) {
    assert.ok(Number.isFinite(x.p10) && x.p10 <= x.p50 && x.p50 <= x.p90, x.key);
    if (x.key !== 'detail') assert.equal(JSON.parse(x.detailJson).trace.evidence, 'computation', x.key);
  }
  assert.ok(out.some((x) => x.key === 'one_time_total' && x.unit === 'USD'));
});

test('P80 and P90 agree across two seeds within 1% (convergence)', () => {
  assert.equal(r417.convergence.converged, true);
  assert.deepEqual(r417.convergence.seeds, [SEED, `${SEED}:convergence`]);
  for (const m of r417.convergence.metrics) assert.ok(m.relDiff <= 0.01, `${m.key} ${m.relDiff}`);
});

test('the same inputs and seed give the same output; another seed moves only the sampling noise', () => {
  const again = costCheck(bowman, ecr('ECR-0417'), { seed: SEED });
  assert.equal(JSON.stringify(again), JSON.stringify(r417));
  const other = costCheck(bowman, ecr('ECR-0417'), { seed: 'another-seed' });
  assert.equal(other.headline.oneTimeTotal.point, r417.headline.oneTimeTotal.point, 'point estimates do not depend on the seed');
  assert.notEqual(other.headline.oneTimeTotal.p90, r417.headline.oneTimeTotal.p90);
  near(other.headline.oneTimeTotal.p90, r417.headline.oneTimeTotal.p90, 0.01, 'P90 across seeds');
});

test('the unit cost change is paired: the per-draw difference of head and base, not a difference of percentiles', () => {
  const u = r417.unitCost.find((x) => x.program === 'vesper')!;
  const direct = r417.headline.unitCostDelta.find((x) => x.program === 'vesper')!.perUnit;
  near(u.delta.p50, direct.p50, 1e-6, 'head minus base, draw by draw, is the change itself');
  near(u.delta.p90, direct.p90, 1e-6, 'and at P90');
  const naive = u.head.p50 - u.base.p50;
  assert.ok(Math.abs(naive - u.delta.p50) > 1, `p50(head) - p50(base) = ${naive.toFixed(2)}, paired ${u.delta.p50}`);
  assert.ok(u.delta.p90 - u.delta.p10 < (u.base.p90 - u.base.p10) / 100, 'the change is far narrower than either side: the shared noise cancels');
  near(u.base.point, 2_800_019, 1e-6, 'base point is the standard-cost roll-up');
});

test('ECR-0423: the fast-track saving of $11.40 an aircraft, in parentheses, with no one-time cost', () => {
  const r = costCheck(bowman, ecr('ECR-0423'), { seed: SEED });
  const k = key('ECR-0423');
  const per = r.headline.unitCostDelta[0].perUnit;
  assert.equal(per.point, -k.savingPerAircraftUsd);
  assert.equal(formatUsd(per.point), '(11.40)');
  assert.equal(r.headline.oneTimeTotal.point, 0, 'use up the grey stock: no write-off, no tooling');
  assert.equal(r.inventory[0].rows[0].disposition, 'use_until_depleted');
  assert.equal(r.inventory[0].total.point, 0);
  near(per.point * 650, -k.savingAtRateUsd, 1e-9, 'saving at 650 a year');
  const y2027 = r.periods.find((p) => p.period === '2027')!;
  assert.ok(y2027.recurring.point < 0 && y2027.recurring.point >= -k.savingYear2027Usd, `2027 saving ${y2027.recurring.point}: at most 24 aircraft, fewer while grey stock is used up`);
  assert.equal(r.effectivity[0].basis, 'use_up');
  assert.equal(r.effectivity[0].source, 'default');
  assert.ok(Math.abs(per.p50 - per.point) < 0.05, `p50 ${per.p50} is the stated saving give or take sampling`);
  assert.ok(renderCostPage(r).includes(formatUsd(per.p50)), 'the cost page shows the p50');
});

test('an agent\'s estimate replaces a default by id, and the trace says so (#32 hook included)', () => {
  const r = costCheck(bowman, ecr('ECR-0417'), {
    seed: SEED,
    assumptions: [
      { id: DELAY, source: 'agent_estimated', dist: lognormal(30_000, 0.25), rationale: 'Four aircraft held 14 weeks', by: 'planner agent' },
      { id: 'recovery:BW-5120-210', source: 'agent_estimated', dist: point(0.5), rationale: 'Half the Rev B stock reworks into Meridian spares' },
    ],
  });
  const delay = row(r, DELAY);
  assert.equal(delay.basis, 'agent_estimated');
  assert.equal(delay.needsEstimate, undefined);
  assert.equal(delay.total.point, 30_000);
  assert.ok(!r.flags.some((f) => f.ref === DELAY), 'no longer flagged');
  assert.deepEqual(delay.total.trace.uses.find((u) => u.id === DELAY), { id: DELAY, source: 'agent_estimated' });
  const scrap = (x: CostCheckResult) => x.inventory[0].rows.filter((y) => y.disposition !== 'cancel').reduce((a, y) => a + y.cost.point, 0);
  near(scrap(r), 324 * 186.4 * 0.5, 1e-9, 'scrap at 50% recovery');
  near(r.headline.oneTimeTotal.point - r417.headline.oneTimeTotal.point, 30_000 + scrap(r) - scrap(r417), 1e-9, 'one-time total moves by exactly the two estimates');
});

test('an effectivity set by a person replaces the ECR\'s and moves the recurring split', () => {
  const r = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, assumptions: [{ id: 'effectivity:ECR-0417:vesper', source: 'given', value: 15, rationale: 'Planner: Rev C reaches the line at S/N 015', replacesGiven: true }] });
  assert.equal(r.effectivity[0].cutInSerial, 15);
  assert.equal(r.effectivity[0].basis, 'override');
  const units = (x: CostCheckResult) => x.blocks.production.find((y) => y.id === 'recurring:vesper')!.quantity!;
  assert.ok(units(r) > 0 && r.window.from! > r417.window.from!, `window from ${r.window.from}, ${units(r)} units`);
});

test('correlation within groups widens the P90 of a total; with none it narrows', () => {
  const indep = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, correlation: 0, draws: 6000 });
  const corr = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, correlation: 0.3, draws: 6000 });
  const spread = (x: CostCheckResult) => x.headline.oneTimeTotal.p90 - x.headline.oneTimeTotal.p10;
  assert.ok(spread(corr) > spread(indep) * 1.05, `spread ${spread(corr)} with 0.3 against ${spread(indep)} with 0`);
});

test('a piece-cost change with no supplier quote is flagged (docs/IN-PRACTICE.md §8, recommendation 3)', () => {
  const e = ecr('ECR-0423');
  e.supplierQuotes = [];
  const r = costCheck(bowman, e, { seed: SEED, draws: 2000 });
  assert.ok(r.flags.some((f) => f.kind === 'no_quote' && f.ref === 'BW-9440-030'));
});

test('every ECR in the dataset runs, converges and stays traceable', () => {
  for (const e of bowman.ecrs) {
    const r = costCheck(bowman, e, { seed: SEED, draws: 4000, convergenceTolerance: 0.02 });
    assert.equal(r.bomDelta.ok, true, e.id);
    assert.ok(r.convergence.converged, `${e.id}: ${JSON.stringify(r.convergence.metrics)}`);
    assert.ok(r.headline.unitCostDelta.length >= 1, e.id);
  }
});

test('an assumption stays on its row when rows are added above it', () => {
  const e = ecr('ECR-0417');
  e.costPage.other.unshift({ label: 'Line stoppage contingency', oneTime: 80_000, basis: 'engineer_estimate' });
  const r = costCheck(bowman, e, { seed: SEED, draws: 2000, assumptions: [{ id: DELAY, source: 'agent_estimated', dist: point(30_000), rationale: 'Planner estimate' }] });
  assert.equal(row(r, DELAY).total.point, 30_000);
  assert.equal(row(r, DELAY).basis, 'agent_estimated');
  const added = row(r, rowId('ECR-0417', 'other', 'Line stoppage contingency'));
  assert.equal(added.total.point, 80_000);
  assert.equal(added.basis, 'engineer_estimate');
});

test('assumptions that match nothing, or that would replace a stated number, are flagged and not applied', () => {
  const qual = rowId('ECR-0417', 'production', 'Qualification: vibration re-test on the endurance rig');
  const r = costCheck(bowman, ecr('ECR-0417'), {
    seed: SEED, draws: 2000,
    assumptions: [
      { id: 'cost:ECR-0417:other:typo', source: 'agent_estimated', dist: point(1), rationale: 'mistyped id' },
      { id: rowId('ECR-0417', 'production', 'Scrap and write-off of Rev B inventory'), source: 'agent_estimated', dist: point(5_000), rationale: 'the blank scrap row' },
      { id: 'recovery:BW-5120-210', source: 'agent_estimated', value: 0.5, rationale: 'a value where a distribution is needed' },
      { id: qual, source: 'agent_estimated', dist: point(40_000), rationale: 'the engineer is low' },
    ],
  });
  const unused = r.flags.filter((f) => f.kind === 'unused_assumption').map((f) => f.ref);
  assert.deepEqual(unused.sort(), ['cost:ECR-0417:other:typo', 'recovery:BW-5120-210', rowId('ECR-0417', 'production', 'Scrap and write-off of Rev B inventory')].sort());
  assert.match(r.flags.find((f) => f.ref?.includes('scrap-and-write-off'))!.message, /recovery share/);
  assert.equal(row(r, qual).total.point, 18_500, 'the engineer\'s number stands');
  assert.ok(r.flags.some((f) => f.kind === 'assumption_not_applied' && f.ref === qual));
  const r2 = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, draws: 2000, assumptions: [{ id: qual, source: 'agent_estimated', dist: point(40_000), rationale: 'the engineer is low', replacesGiven: true }] });
  assert.equal(row(r2, qual).total.point, 40_000);
  assert.equal(row(r2, qual).total.trace.uses.find((u) => u.id === qual)!.source, 'agent_estimated');
});

test('a duplicated BOM line is summed, not double-exploded', () => {
  const base = structuredClone(bowman);
  const line = base.bom.find((l) => l.parent === 'BW-0001-000')!;
  base.bom.push({ ...line, seq: 999 });
  const r = costCheck(base, ecr('ECR-0423'), { seed: SEED, draws: 2000 });
  assert.equal(r.headline.unitCostDelta[0].perUnit.point, -11.4);
  assert.equal(r.bomDelta.ok, true);
});

test('a bad sourcing range on an unrelated part falls back to the default and is flagged', () => {
  const base = structuredClone(bowman);
  const src = base.sourcing.find((x) => x.item === 'BW-1110-100')!;
  src.unitPrice.p10 = 0;
  const r = costCheck(base, ecr('ECR-0423'), { seed: SEED, draws: 2000 });
  assert.equal(r.headline.unitCostDelta[0].perUnit.point, -11.4);
  assert.ok(r.flags.some((f) => f.kind === 'bad_sourcing' && f.ref === 'BW-1110-100'));
  assert.equal(r.inputs.find((i) => i.id === 'price:BW-1110-100')?.source, 'default', 'listed on its own, not folded into the given price ranges');
  assert.ok(r.unitCost[0].base.trace.uses.some((u) => u.id === 'price:BW-1110-100' && u.source === 'default'));
});

test('an assumption on an untouched part\'s price is listed on its own and shows in the trace', () => {
  const r = costCheck(bowman, ecr('ECR-0423'), {
    seed: SEED, draws: 2000,
    assumptions: [{ id: 'price:BW-1110-100', source: 'agent_estimated', dist: lognormal(1.2, 0.1), rationale: 'a price rise the buyer expects', replacesGiven: true }],
  });
  assert.equal(r.inputs.find((i) => i.id === 'price:BW-1110-100')?.source, 'agent_estimated');
  assert.ok(r.unitCost[0].base.trace.uses.some((u) => u.id === 'price:BW-1110-100' && u.source === 'agent_estimated'));
  assert.ok(!r.flags.some((f) => f.kind === 'unused_assumption'));
});

test('a first-lot premium the engineer already listed is not added again', () => {
  const e = ecr('ECR-0417');
  e.costPage.production.push({ label: 'First lot premium, 25 at $239.50', oneTime: 462.5, basis: 'supplier_quote' });
  const r = costCheck(bowman, e, { seed: SEED, draws: 2000 });
  assert.ok(!rows(r).some((x) => x.id === PREMIUM));
  near(r.headline.oneTimeTotal.point, r417.headline.oneTimeTotal.point, 1e-9, 'one-time total unchanged');
});

test('stored rows carry everything their traces point at', () => {
  const out = costCheckRows(r417);
  const detail = out.find((x) => x.key === 'detail')!;
  const d = JSON.parse(detail.detailJson);
  const ids = new Set((d.inputs as { id: string }[]).map((i) => i.id));
  for (const x of out) {
    if (x.key === 'detail') continue;
    for (const u of JSON.parse(x.detailJson).trace.uses) assert.ok(ids.has(u.id), `${x.key}: ${u.id}`);
  }
  assert.ok(Array.isArray(d.flags) && Array.isArray(d.drivers) && d.convergence.converged === true);
});

test('a budgetary quote widens its rows and its new prices', () => {
  const r = costCheck(bowman, ecr('ECR-0409'), { seed: SEED, draws: 4000 });
  const tooling = r.inputs.find((i) => i.id === rowId('ECR-0409', 'production', 'Blade mould set and hub forging tooling'))!;
  assert.equal(tooling.dist?.kind === 'lognormal' && tooling.dist.sigmaHigh, 0.15);
  assert.ok(r.flags.some((f) => f.kind === 'budgetary_quote'));
  const e = ecr('ECR-0409');
  for (const q of e.supplierQuotes) q.firmness = 'firm';
  const firm = costCheck(bowman, e, { seed: SEED, draws: 4000 });
  const width = (x: CostCheckResult) => x.headline.unitCostDelta[0].perUnit.p90 - x.headline.unitCostDelta[0].perUnit.p10;
  assert.ok(width(r) > width(firm) * 1.5, `per-unit range ${width(r)} budgetary against ${width(firm)} firm`);
  assert.equal(r.headline.unitCostDelta[0].perUnit.point, 8640, 'the point estimate does not move');
  assert.equal(r.piecePrices.find((p) => p.item === 'BW-4210-100')!.head, null, 'a part the change removes has no head price');
});

test('undecided units on order are priced as cancelled, not scrapped', () => {
  const r = costCheck(bowman, ecr('ECR-0419'), { seed: SEED, draws: 2000 });
  assert.match(r.flags.find((f) => f.kind === 'disposition_tbd' && f.message.includes('on order'))!.message, /cancelling them would cost about/);
});

test('an assumption replaces the cut-in the ECR states only with replacesGiven; one with a distribution is flagged as needing a value', () => {
  const stated = r417.effectivity[0].cutInSerial;
  const r = costCheck(bowman, ecr('ECR-0417'), {
    seed: SEED, draws: 2000,
    assumptions: [{ id: 'effectivity:ECR-0417:vesper', source: 'agent_estimated', value: 15, rationale: 'the agent thinks S/N 015' }],
  });
  assert.equal(r.effectivity[0].cutInSerial, stated, 'the ECR\'s cut-in stands');
  assert.match(r.flags.find((f) => f.kind === 'assumption_not_applied' && f.ref === 'effectivity:ECR-0417:vesper')!.message, /replacesGiven/);
  const d = costCheck(bowman, ecr('ECR-0423'), {
    seed: SEED, draws: 2000,
    assumptions: [{ id: 'effectivity:ECR-0423:vesper', source: 'agent_estimated', dist: point(30), rationale: 'a distribution where a serial is needed' }],
  });
  assert.equal(d.effectivity[0].basis, 'use_up');
  assert.match(d.flags.find((f) => f.kind === 'unused_assumption' && f.ref === 'effectivity:ECR-0423:vesper')!.message, /takes a value/);
  const rec = costCheck(bowman, ecr('ECR-0417'), {
    seed: SEED, draws: 2000,
    assumptions: [{ id: 'stock:BW-5120-210:stores', source: 'agent_estimated', value: 0, rationale: 'a recorded fact, not an input' }],
  });
  assert.match(rec.flags.find((f) => f.kind === 'unused_assumption' && f.ref === 'stock:BW-5120-210:stores')!.message, /names a record/);
});

test('a blank scrap row with no disposition proposed is an ordinary blank row, on its own id', () => {
  const scrap = rowId('ECR-0417', 'production', 'Scrap and write-off of Rev B inventory');
  const e = ecr('ECR-0417');
  e.inventoryProposal = [];
  const r = costCheck(bowman, e, { seed: SEED, draws: 2000 });
  assert.equal(row(r, scrap).needsEstimate, true);
  assert.ok(r.flags.some((f) => f.kind === 'needs_estimate' && f.ref === scrap));
  const est = costCheck(bowman, e, { seed: SEED, draws: 2000, assumptions: [{ id: scrap, source: 'agent_estimated', dist: point(5_000), rationale: 'the buyer\'s estimate' }] });
  assert.equal(row(est, scrap).total.point, 5_000);
  assert.ok(!est.flags.some((f) => f.kind === 'unused_assumption'));
  // A proposal for an item with no stock row computes no line, so the scrap row is blank after all.
  const none = ecr('ECR-0417');
  none.inventoryProposal = [{ item: 'BW-NOPE', location: 'stores', disposition: 'scrap' }];
  const rn = costCheck(bowman, none, { seed: SEED, draws: 2000, assumptions: [{ id: scrap, source: 'agent_estimated', dist: point(5_000), rationale: 'the buyer\'s estimate' }] });
  assert.ok(rn.flags.some((f) => f.kind === 'no_stock' && f.ref === 'BW-NOPE'));
  assert.equal(row(rn, scrap).total.point, 5_000);
  assert.ok(!rn.flags.some((f) => f.kind === 'unused_assumption'));
});

test('the computed premium is skipped only for a supplier-quote production row of the same amount', () => {
  const e = ecr('ECR-0417');
  e.costPage.other.push({ label: 'Contingency', oneTime: 462.5, basis: 'engineer_estimate' });
  e.costPage.production.push({ label: 'Programme allowance', oneTime: 462.5, basis: 'engineer_estimate' });
  const r = costCheck(bowman, e, { seed: SEED, draws: 2000 });
  assert.ok(rows(r).some((x) => x.id === PREMIUM), 'an unrelated row of the same amount doesn\'t hide the premium');
  const named = ecr('ECR-0417');
  named.costPage.production.push({ label: 'First-lot premium on the Rev C bracket', oneTime: 462.5, basis: 'engineer_estimate' });
  const rn = costCheck(bowman, named, { seed: SEED, draws: 2000 });
  assert.ok(!rows(rn).some((x) => x.id === PREMIUM), 'a row that names the premium, whatever its basis, isn\'t doubled');
});

test('a run that misses the convergence tolerance doubles its draws until it converges', () => {
  // Seeds w28 and w18 need 20,000 and 40,000 draws for ECR-0409, whose budgetary quote makes its change wide.
  for (const [seed, draws] of [['w28', 20_000], ['w18', 40_000], [SEED, 10_000]] as const) {
    const r = costCheck(bowman, ecr('ECR-0409'), { seed });
    assert.equal(r.draws, draws, seed);
    assert.ok(r.convergence.converged, seed);
    assert.ok(!r.flags.some((f) => f.kind === 'not_converged'), seed);
  }
  const capped = costCheck(bowman, ecr('ECR-0409'), { seed: 'w18', maxDraws: 10_000 });
  assert.equal(capped.draws, 10_000);
  assert.equal(capped.convergence.converged, false);
  assert.match(capped.flags.find((f) => f.kind === 'not_converged')!.message, /maxDraws/);
});

test('price ranges of parts the change does not touch are one input, and the stored detail stays small', () => {
  const prices = r417.inputs.filter((i) => i.id.startsWith('price:')).map((i) => i.id);
  assert.deepEqual(prices, ['price:BW-5120-210'], 'only the part the change touches');
  const bulk = r417.inputs.find((i) => i.id === 'baseline:price-ranges')!;
  assert.equal(bulk.source, 'given');
  assert.ok(r417.unitCost[0].base.trace.uses.some((u) => u.id === 'baseline:price-ranges'));
  const detail = costCheckRows(r417).find((x) => x.unit === 'json')!;
  assert.ok(detail.detailJson.length < 40_000, `detail row ${detail.detailJson.length} bytes`);
});

test('the trace names where the baseline and the change request came from', () => {
  const r = costCheck(bowman, ecr('ECR-0423'), { seed: SEED, draws: 2000, provenance: { baseline: 'a test baseline file, not the ERP', changeRequest: 'change request rev 1 from stub' } });
  const ref = (id: string) => r.inputs.find((i) => i.id === id)!.ref ?? '';
  assert.match(ref('baseline:items'), /^a test baseline file, not the ERP: /);
  assert.match(ref('ecr:ECR-0423:overlay'), /^change request rev 1 from stub: /);
  assert.ok(!JSON.stringify(r.inputs).includes('ERP and PLM item master'));
  assert.match(r417.inputs.find((i) => i.id === 'baseline:items')!.ref ?? '', /^the baseline: /, 'without provenance the trace names no system');
});
