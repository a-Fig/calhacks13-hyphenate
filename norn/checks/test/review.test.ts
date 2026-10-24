// Regressions from the review of S3 and S4 (#45): each test here fails on the code that review
// found it in. Fix 1 (peers named in the run's inputs) is in workers/test/impact-peers.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { point } from '../src/dist.ts';
import { supplyCheckRows, timelineRows } from '../src/rows.ts';
import { supplyCheck } from '../src/supply.ts';
import { timelineCheck } from '../src/timeline.ts';
import type { AssumptionOverride, Baseline, ChangeRequest } from '../src/types.ts';

const SEED = 'norn-seed-1';
const ecr = (id: string): ChangeRequest => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return structuredClone(e);
};
const baseline: Baseline = bowman;
/** A fixed value for a draw, replacing a stated number: the checks see no uncertainty in it. */
const fix = (id: string, value: number): AssumptionOverride => ({ id, source: 'agent_estimated', dist: point(value), replacesGiven: true, rationale: 'fixed for the test' }) as AssumptionOverride;

test('a quote that prices several parts gives each part its own line, whatever the order of the lines', () => {
  const e = ecr('ECR-0409');
  const prices = (x: ChangeRequest) => Object.fromEntries(supplyCheck(baseline, x, { seed: SEED }).parts.map((p) => [p.item, p.price]));
  assert.deepEqual(prices(e), { 'BW-4210-200': 3950, 'BW-4220-200': 930, 'BW-4240-200': 330 }, 'the blade is $930, not the hub\'s $3,950');
  const reordered = structuredClone(e);
  for (const q of reordered.supplierQuotes) q.lines.reverse();
  assert.deepEqual(prices(reordered), prices(e));
  const spend = (x: ChangeRequest) => supplyCheck(baseline, x, { seed: SEED }).spend.yearOne.p50;
  assert.equal(spend(reordered), spend(e), 'the order of the quote lines does not move the spend');
});

test('a quantity increase below the changed part buys more of it: parts, spend and a lead time follow', () => {
  const e = ecr('ECR-0417');
  e.itemChanges = [];
  e.supplierQuotes = [];
  e.bomChanges = [{ op: 'set_qty', parent: 'BW-5120-000', child: 'BW-5120-210', qtyFrom: 1, qtyTo: 20 }];
  const s = supplyCheck(baseline, e, { seed: SEED });
  assert.deepEqual(s.parts.map((p) => [p.item, p.perUnit]), [['BW-5120-210', 240]], '12 brackets an assembly times 20');
  assert.ok(s.spend.yearOne.p50 > 0, 'the extra brackets are bought');
  const t = timelineCheck(baseline, e, { seed: SEED });
  const path = t.paths.find((p) => p.id === 'parts:BW-5120-210')!;
  assert.equal(path.criticalShare, 1, 'the cut-in waits for the brackets, not only for the board');
});

test('S4 draws the price: a wide sourcing range spreads the spend, a narrow one does not', () => {
  const e = ecr('ECR-0417');
  e.supplierQuotes = [];
  const assumptions = [fix('decision:ECR-0417', 3), fix('lead:ECR-0417:BW-5120-210', 14)];
  const withRange = (factor: number): Baseline => ({
    ...baseline,
    sourcing: baseline.sourcing.map((r) => (r.item === 'BW-5120-210' ? { ...r, unitPrice: { p10: r.unitPrice.p50 / factor, p50: r.unitPrice.p50, p90: r.unitPrice.p50 * factor } } : r)),
  });
  const narrow = supplyCheck(withRange(1.02), structuredClone(e), { seed: SEED, assumptions }).spend.yearOne;
  const wide = supplyCheck(withRange(100), structuredClone(e), { seed: SEED, assumptions }).spend.yearOne;
  assert.ok(wide.p10 < wide.p50 && wide.p50 < wide.p90, `${wide.p10} < ${wide.p50} < ${wide.p90}`);
  assert.ok(wide.p90 / wide.p10 > 1000, 'a hundredfold either way is a spread of that size');
  assert.ok(narrow.p90 / narrow.p10 < 1.1);
  assert.ok(wide.trace.uses.some((u) => u.id === 'price:BW-5120-210'), 'the price draw is in the trace');
});

test('S4 spreads a budgetary quote\'s price by its own default, and says so', () => {
  const r = supplyCheck(baseline, ecr('ECR-0409'), { seed: SEED });
  assert.ok(r.inputs.some((i) => i.id === 'quote:BW-4220-200' && i.source === 'default'));
  assert.ok(r.spend.yearOne.p90 / r.spend.yearOne.p10 > 1.2);
});

test('the old stock is gone when its own last aircraft is built, not when the parts arrive', () => {
  const t = timelineCheck(baseline, ecr('ECR-0419'), { seed: SEED });
  const stock = t.paths.find((p) => p.kind === 'stock')!;
  assert.deepEqual(stock.date, { p10: '2027-08-24', p50: '2027-08-24', p90: '2027-08-24' }, 'S/N 26 completes on 2027-08-24');
  assert.notDeepEqual(stock.date, t.cutIn.date, 'the cut-in is later: the 28-week part sets it');
  assert.ok(stock.day!.trace.uses.some((u) => u.id === 'volume:vesper'));
  assert.ok(!stock.day!.trace.uses.some((u) => u.id.startsWith('lead:') || u.id.startsWith('decision:')), 'the stock date does not depend on the suppliers');
});

test('stock that outlasts the volume plan keeps its serial floor and places no date', () => {
  const short: Baseline = { ...baseline, volumePlan: baseline.volumePlan.filter((v) => v.month <= '2027-06') };
  const assumptions = [fix('lead:ECR-0419:BW-3120-340', 1)];
  const t = timelineCheck(short, ecr('ECR-0419'), { seed: SEED, assumptions });
  assert.equal(t.cutIn.placed, false);
  assert.equal(t.cutIn.day, null);
  assert.equal(t.cutIn.date, null);
  assert.equal(t.cutIn.serial.p50, 27, 'the stock needs S/N 27 first, and the plan ends at S/N 22');
  assert.equal(t.late, null);
  assert.ok(t.flags.some((f) => f.kind === 'stock_beyond_plan'));
  const stock = t.paths.find((p) => p.kind === 'stock')!;
  assert.equal(stock.date, null);
  assert.equal(stock.criticalShare, 1);
  const keys = timelineRows(t).map((r) => r.key);
  assert.ok(keys.includes('cut_in_serial') && !keys.includes('cut_in_date') && !keys.includes('cut_in_weeks'));
  for (const r of timelineRows(t)) assert.ok(Number.isFinite(r.p10 + r.p50 + r.p90), r.key);

  const s = supplyCheck(short, ecr('ECR-0419'), { seed: SEED, assumptions, peers: [ecr('ECR-0421')] });
  assert.equal(s.cutInPlaced, false);
  assert.equal(s.spend.yearOne.p50, 0, 'no aircraft is planned to take the change');
  assert.equal(s.interaction!.cutIn, null);
  assert.ok(s.flags.some((f) => f.kind === 'stock_beyond_plan'));
  for (const r of supplyCheckRows(s)) assert.ok(Number.isFinite(r.p10 + r.p50 + r.p90), r.key);
  // The unchanged plan places the same ECR at S/N 27 or later, on a date.
  const full = timelineCheck(baseline, ecr('ECR-0419'), { seed: SEED, assumptions });
  assert.equal(full.cutIn.placed, true);
  assert.ok(full.cutIn.serial.p50 >= 27);
});

test('a stated effectivity is missed for certain when the old stock runs past the plan', () => {
  const short: Baseline = { ...baseline, volumePlan: baseline.volumePlan.filter((v) => v.month <= '2027-06') };
  const e = ecr('ECR-0419');
  e.effectivity.production = { basis: 'serial', from: '20' };
  const s = supplyCheck(short, e, { seed: SEED, assumptions: [fix('lead:ECR-0419:BW-3120-340', 1)] });
  assert.deepEqual(s.missEffectivity && [s.missEffectivity.probability, s.missEffectivity.weeks], [1, null]);
});

test('the convergence check covers the savings: fixed timing, one tolerance, and the pair saving is not converged', () => {
  const assumptions = [fix('decision:ECR-0419', 3), fix('decision:ECR-0421', 3), fix('lead:ECR-0419:BW-3120-340', 30), fix('lead:ECR-0421:BW-M512-340', 30)];
  const run = (seed: string) => supplyCheck(baseline, ecr('ECR-0419'), { seed, assumptions, peers: [ecr('ECR-0421')], draws: 1000, maxDraws: 4000, convergenceTolerance: 0.000001 });
  const a = run('seed-a');
  const b = run('seed-b');
  const pair = (r: ReturnType<typeof run>) => r.interaction!.bundles[0].pairSaving.p90;
  assert.notEqual(pair(a), pair(b), 'the pair saving moves with the seed');
  for (const r of [a, b]) {
    const keys = r.convergence.metrics.map((m) => m.key);
    assert.ok(keys.includes('bundlePairSaving:CON-ORRIN-UH-SLOT') && keys.includes('bundleOwnSaving:CON-ORRIN-UH-SLOT'), keys.join());
    assert.equal(r.convergence.converged, false, 'moved by more than 0.0001%');
    assert.ok(r.flags.some((f) => f.kind === 'not_converged'));
  }
});

test('the continuous outputs S4 reports are all in its convergence check', () => {
  const r = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [ecr('ECR-0421')] });
  const keys = new Set(r.convergence.metrics.map((m) => m.key));
  for (const k of ['cutInWeeks', 'spendYearOne', 'spendSingleSource', 'cutInShiftWeeks', 'cutInWeeksWithPeers', 'bundleOwnSaving:CON-ORRIN-UH-SLOT', 'bundlePairSaving:CON-ORRIN-UH-SLOT', 'utilization:CON-ORRIN-UH-CAPACITY', 'utilizationWithPeers:CON-ORRIN-UH-CAPACITY']) {
    assert.ok(keys.has(k), `${k} in ${[...keys].join()}`);
  }
});

// ---- round 2 (Sol's review of cfca174)

test('an incomplete peer is skipped and named, and the own S4 of the ECR still runs', () => {
  const alone = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED });
  const peers = [{ id: 'ECR-DRAFT' }, ecr('ECR-0421'), {} , null] as unknown as ChangeRequest[];
  const r = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers });
  assert.equal(r.parts.length, alone.parts.length, 'its own parts are unchanged');
  assert.deepEqual(r.interaction!.peers.map((p) => p.ecr), ['ECR-0421'], 'the readable peer still counts');
  const named = r.flags.filter((f) => f.kind === 'unreadable_peer');
  assert.ok(named.some((f) => f.ref === 'ECR-DRAFT' && f.message.includes('ECR-DRAFT')), 'the flag names the peer');
  assert.equal(named.length, 3, 'the empty object and null are named too');
});

test('one quote and one line decide the price, lead time and source alike', () => {
  const r = supplyCheck(baseline, ecr('ECR-0409'), { seed: SEED });
  const quote = ecr('ECR-0409').supplierQuotes[0];
  assert.ok(r.parts.length >= 3);
  for (const p of r.parts) {
    assert.equal(p.leadFrom, 'quote', `${p.item} takes its lead time from the quote`);
    assert.equal(p.quoteId, quote.id, `${p.item} is the part of the quote its lead time comes from`);
    assert.equal(p.supplier, quote.supplier, `${p.item} has the quoting supplier as its source`);
    assert.ok(Math.abs(p.leadWeeks.p50 - quote.leadTimeWeeks!) < 0.5, `${p.item} waits the quoted lead time, got ${p.leadWeeks.p50}`);
  }
});

test('two ECRs that change the same part number earn no bundle discount from each other', () => {
  const clone = ecr('ECR-0419');
  clone.id = 'ECR-9419';
  const r = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [clone] });
  assert.ok(r.interaction, 'the clone shares Orrin, so it is compared');
  const total = r.interaction!.bundles.reduce((a, b) => a + b.ownSaving.point + b.pairSaving.point, 0);
  assert.equal(total, 0, 'the same part qualified twice is one qualification, not a bundle');
  // The real pair, on different parts, still earns it.
  const pair = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [ecr('ECR-0421')] });
  assert.ok(pair.interaction!.bundles[0].pairSaving.point > 0);
});

test('the own lots of an ECR do not queue for one exclusive slot', () => {
  // ECR-0419 changes one Orrin part. A second part number of the same assembly goes to Orrin too, and
  // the slot constraint covers both part numbers.
  const e = ecr('ECR-0419');
  e.itemChanges.push({ item: 'BW-3125-100', op: 'revise', fromRev: 'A', toRev: 'B', changes: [{ field: 'unit_price_usd', from: 500, to: 520 }] } as never);
  const q = structuredClone(e.supplierQuotes[0]);
  e.supplierQuotes.push({ ...q, id: 'Q-OR-TEST', item: 'BW-3125-100', lines: [{ description: 'Second magnet part, UH grade', unitPrice: 520 }, { description: 'Qualification lot of 12 sets', oneTime: 40000 }] } as never);
  const two: Baseline = {
    ...baseline,
    supplierConstraints: baseline.supplierConstraints!.map((c) => (c.id === 'CON-ORRIN-UH-SLOT' ? { ...c, items: [...c.items, 'BW-3125-100'] } : c)),
  };
  const alone = supplyCheck(two, e, { seed: SEED });
  const slots = alone.parts.filter((p) => p.slot).map((p) => p.slot!.opens.p50);
  assert.equal(slots.length, 2, 'two slot-constrained parts: ' + alone.parts.map((p) => p.item).join(', '));
  assert.equal(new Set(slots).size, 2, 'a quarterly slot takes one lot, so the two lots take two quarters: ' + slots.join(', '));
});
