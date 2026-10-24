import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck } from '../src/cost.ts';
import { point } from '../src/dist.ts';
import type { ChangeRequest } from '../src/types.ts';

const SEED = 'norn-seed-1';
const ecr = (id: string): ChangeRequest => structuredClone(bowman.ecrs.find((x) => x.id === id)!) as ChangeRequest;
const GROSS = { horizonMonths: 12, savingsOffset: false };
const NET = { horizonMonths: 12, savingsOffset: true };
const exact = (m: ReturnType<typeof costCheck>['measures'][number]) => {
  assert.equal(m.source, 'exact');
  return m as Extract<typeof m, { source: 'exact' }>;
};

test('a row that nets a spend against a saving is measured by its gross components', () => {
  const e = ecr('ECR-0423');
  e.costPage.other.push({ label: 'Tooling against a supplier credit', oneTime: 200_000, unitCost: -190_000, quantity: 1, basis: 'supplier_quote' });
  const r = costCheck(bowman, e, { seed: SEED, measures: [GROSS, NET] });
  const gross = exact(r.measures[0]!);
  const net = exact(r.measures[1]!);
  // The row's own total is about 10,000; the rule without offsets sees the 200,000 spend.
  assert.ok(gross.p50 >= 195_000 && gross.p90 >= gross.p50, `gross ${gross.p50} / ${gross.p90}`);
  assert.ok(net.p90 < 50_000, `net ${net.p90}`);
});

test('each stock location is its own component: a rework credit does not offset a scrap write-off', () => {
  const e = ecr('ECR-0417');
  e.inventoryProposal = [
    { item: 'BW-5120-210', location: 'stores', disposition: 'scrap' },
    { item: 'BW-5120-210', location: 'wip', disposition: 'rework' },
  ] as ChangeRequest['inventoryProposal'];
  const assumptions = [
    { id: 'recovery:BW-5120-210', source: 'agent_estimated' as const, rationale: 'test', dist: point(0) },
    { id: 'rework:ECR-0417:BW-5120-210:wip', source: 'agent_estimated' as const, rationale: 'test', dist: point(-17_000) },
  ];
  const r = costCheck(bowman, e, { seed: SEED, assumptions, measures: [GROSS] });
  const m = exact(r.measures[0]!);
  const w = r.headline.windowTotal;
  // Every other component is a spend, so the gross measure is the window total without the 17,000 credit.
  assert.ok(Math.abs(m.p50 - (w.p50 + 17_000)) <= 0.01, `gross ${m.p50} vs window ${w.p50}`);
});

test('a change whose costs all point one way measures the same as its window total', () => {
  // Every ECR-0417 component is a spend in every draw, so its size is its window total.
  const r = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, measures: [GROSS] });
  const m = exact(r.measures[0]!);
  const w = r.headline.windowTotal;
  assert.ok(Math.abs(m.p50 - w.p50) <= 0.01 && Math.abs(m.p90 - w.p90) <= 0.01, `p50 ${m.p50} vs ${w.p50}, p90 ${m.p90} vs ${w.p90}`);
});

test('gross spend is never below the netted total: a component that is a saving in some draws is not netted', () => {
  // ECR-0409's components are spends at their quantiles but one dips below zero in some draws.
  const r = costCheck(bowman, ecr('ECR-0409'), { seed: SEED, measures: [GROSS] });
  const m = exact(r.measures[0]!);
  const w = r.headline.windowTotal;
  assert.ok(m.p50 >= w.p50 - 0.01 && m.p90 >= w.p90 - 0.01, `p50 ${m.p50} vs ${w.p50}, p90 ${m.p90} vs ${w.p90}`);
});

test('a saving is measured by its size, and offsets only when the rule says so', () => {
  const r = costCheck(bowman, ecr('ECR-0423'), { seed: SEED, measures: [GROSS, NET] });
  const gross = exact(r.measures[0]!);
  const net = exact(r.measures[1]!);
  assert.ok(gross.p50 > 0 && net.p50 > 0, `${gross.p50} ${net.p50}`);
  assert.ok(gross.p90 >= net.p90 - 0.01, `gross ${gross.p90} net ${net.p90}`);
});

test('a horizon other than the window is unavailable, with the reason', () => {
  const r = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, measures: [{ horizonMonths: 24, savingsOffset: false }] });
  const m = r.measures[0]!;
  assert.equal(m.source, 'unavailable');
  assert.match((m as { reason: string }).reason, /window is 12 months, not 24/);
});

test('measures are paired with the run: same seed, same numbers, and none unless asked', () => {
  const a = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, measures: [GROSS] });
  const b = costCheck(bowman, ecr('ECR-0417'), { seed: SEED, measures: [GROSS] });
  assert.deepEqual(a.measures, b.measures);
  assert.equal(exact(a.measures[0]!).draws, a.draws);
  assert.deepEqual(costCheck(bowman, ecr('ECR-0417'), { seed: SEED }).measures, []);
});
