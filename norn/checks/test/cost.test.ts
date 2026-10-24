import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { demoScenarios } from '../../../bowman/data/scenarios.ts';
import { costCheck, type CostCheckResult, type Money } from '../src/cost.ts';
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

const r417 = costCheck(bowman, ecr('ECR-0417'), { seed: SEED });

test('ECR-0417 matches the answer key in bowman/data/scenarios.ts', () => {
  const k = key('ECR-0417');
  const vesper = r417.headline.unitCostDelta.find((u) => u.program === 'vesper')!.perUnit;
  assert.equal(vesper.point, k.steadyStateDeltaPerAircraftUsd, 'steady state +12 × $34.60 per aircraft');
  const nre = ['production[1]', 'production[2]', 'production[3]', 'production[4]', 'production[5]'].reduce((a, i) => a + row(r417, `cost:ECR-0417:${i}`).total.point, 0);
  assert.equal(nre, k.oneTimeNreUsd, 'tooling, NC programming, first article, engineering, qualification');
  assert.equal(row(r417, 'cost:ECR-0417:retrofit[0]').total.point, k.retrofitPartsUsd);
  assert.equal(row(r417, 'cost:ECR-0417:retrofit[1]').total.point, k.retrofitLaborUsd);
  const inv = r417.inventory.find((i) => i.item === 'BW-5120-210')!;
  const scrapped = inv.rows.filter((x) => x.disposition === 'scrap' || x.disposition === 'mandatory_install');
  assert.equal(scrapped.reduce((a, x) => a + x.qty, 0), k.brackets_scrapped, 'stores 96, WIP 48, at Halden 60, installed 120');
  near(scrapped.reduce((a, x) => a + x.cost.point, 0), k.scrapNetOfSalvageUsd, 0.001, 'scrap net of salvage');
  assert.equal(inv.rows.find((x) => x.disposition === 'cancel')!.cost.point, k.cancellationChargeUsd, 'the quoted 10% on 60 not started');
  const premium = row(r417, 'premium:Q-HAL-26-1187#1').total.point;
  assert.equal(premium, 25 * (239.5 - 221), 'first lot of 25 at $239.50: $18.50 a bracket over the new standard');
  near(r417.headline.oneTimeTotal.point, k.oneTimeTotalUsd + premium, 0.001, 'one-time total (the key leaves out the first-lot premium)');
  assert.equal(r417.headline.unitCostDelta.find((u) => u.program === 'meridian')!.perUnit.point, 34.6 * 8, 'Meridian: $34.60 × 8, no retrofit');
  assert.deepEqual(r417.effectivity.map((e) => [e.program, e.cutInSerial, e.source]), [['vesper', 11, 'given'], ['meridian', 1, 'default']]);
});

test('ECR-0417 has the shape and rough size of docs/IN-PRACTICE.md\'s worked example, scaled to the dataset', () => {
  // The worked example: 4 retrofit aircraft and 252 scrapped brackets; one-time $111,194, steady state +$415.
  // Bowman's data: 10 aircraft built and 324 brackets to scrap. Scale the volume-driven lines, keep the rest.
  const retrofit = (10_608 + 5_280) * (10 / 4);
  const scrap = (46_973 - 718) * (324 / 252);
  const fixed = 13_600 + 18_500 + 15_370 + 1_118;
  near(r417.headline.oneTimeTotal.point, retrofit + scrap + fixed, 0.01, 'one-time total against the scaled example');
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
  const delay = row(r417, 'cost:ECR-0417:other[0]');
  assert.equal(delay.basis, 'default');
  assert.equal(delay.needsEstimate, true);
  assert.equal(delay.total.point, 0);
  const rec = r417.inputs.find((i) => i.id === 'cost:ECR-0417:other[0]')!;
  assert.equal(rec.source, 'default');
  assert.equal(rec.needsEstimate, true);
  assert.ok(r417.flags.some((f) => f.kind === 'needs_estimate' && f.ref === 'cost:ECR-0417:other[0]'));
  assert.ok(!rows(r417).some((x) => x.id === 'cost:ECR-0417:production[6]'), 'no $0 placeholder for the scrap row');
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
    assert.equal(JSON.parse(x.detailJson).trace.evidence, 'computation', x.key);
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
  assert.match(renderCostPage(r), /\(11\.40\)/);
});

test('an agent\'s estimate replaces a default by id, and the trace says so (#32 hook included)', () => {
  const r = costCheck(bowman, ecr('ECR-0417'), {
    seed: SEED,
    assumptions: [
      { id: 'cost:ECR-0417:other[0]', source: 'agent_estimated', dist: lognormal(30_000, 0.25), rationale: 'Four aircraft held 14 weeks', by: 'planner agent' },
      { id: 'recovery:BW-5120-210', source: 'agent_estimated', dist: point(0.5), rationale: 'Half the Rev B stock reworks into Meridian spares' },
    ],
  });
  const delay = row(r, 'cost:ECR-0417:other[0]');
  assert.equal(delay.basis, 'agent_estimated');
  assert.equal(delay.needsEstimate, undefined);
  assert.equal(delay.total.point, 30_000);
  assert.ok(!r.flags.some((f) => f.ref === 'cost:ECR-0417:other[0]'), 'no longer flagged');
  assert.deepEqual(delay.total.trace.uses.find((u) => u.id === 'cost:ECR-0417:other[0]'), { id: 'cost:ECR-0417:other[0]', source: 'agent_estimated' });
  const scrap = (x: CostCheckResult) => x.inventory[0].rows.filter((y) => y.disposition !== 'cancel').reduce((a, y) => a + y.cost.point, 0);
  near(scrap(r), 324 * 186.4 * 0.5, 1e-9, 'scrap at 50% recovery');
  near(r.headline.oneTimeTotal.point - r417.headline.oneTimeTotal.point, 30_000 + scrap(r) - scrap(r417), 1e-9, 'one-time total moves by exactly the two estimates');
});

test('an effectivity set by a person replaces the ECR\'s and moves the recurring split', () => {
  const r = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, assumptions: [{ id: 'effectivity:ECR-0417:vesper', source: 'given', value: 15, rationale: 'Planner: Rev C reaches the line at S/N 015' }] });
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
