import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { supplyCheckRows } from '../src/rows.ts';
import { supplyCheck, type SupplyResult } from '../src/supply.ts';
import { timelineCheck } from '../src/timeline.ts';
import type { Baseline, ChangeRequest } from '../src/types.ts';

const SEED = 'norn-seed-1';
const ecr = (id: string): ChangeRequest => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return structuredClone(e);
};
const baseline: Baseline = bowman;
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const traceIds = (x: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.evidence === 'computation' && Array.isArray(o.uses)) for (const u of o.uses as { id: string }[]) out.push(u.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(x);
  return out;
};

const r417 = supplyCheck(baseline, ecr('ECR-0417'), { seed: SEED });
const r419 = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [ecr('ECR-0421')] });
const r421 = supplyCheck(baseline, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });

test('ECR-0417: the bracket has one source, 14 weeks of lead time and a certain miss of S/N 011', () => {
  assert.equal(r417.parts.length, 1);
  const p = r417.parts[0];
  assert.equal(p.item, 'BW-5120-210');
  assert.equal(p.supplier, 'SUP-HALDEN');
  assert.deepEqual(p.sources, ['SUP-HALDEN']);
  assert.equal(p.singleSource, true);
  assert.deepEqual(r417.singleSourceItems, ['BW-5120-210']);
  assert.equal(p.leadFrom, 'quote');
  assert.equal(p.quoteId, 'Q-HAL-26-1187');
  near(p.leadWeeks.p50, 14, 0.5, 'median lead time');
  assert.ok(p.leadWeeks.p10 < 11 && p.leadWeeks.p90 > 19, `${p.leadWeeks.p10} to ${p.leadWeeks.p90}`);
  assert.equal(r417.missEffectivity!.probability, 1);
  near(r417.missEffectivity!.weeks.p50, 13, 1.5, 'weeks late against S/N 011');
  assert.ok(r417.flags.some((f) => f.kind === 'single_source' && f.ref === 'BW-5120-210'));
  assert.ok(r417.flags.some((f) => f.kind === 'likely_late'));
  assert.equal(r417.interaction, null, 'no other open ECR buys from Halden');
});

test('ECR-0417: a year of production at $221 spends about 12 brackets per aircraft on the aircraft built after the cut-in', () => {
  const y = r417.spend.yearOne;
  assert.ok(y.p10 < y.p50 && y.p50 < y.p90);
  // 12 brackets x $221 = $2,652 an aircraft; the plan builds 20 to 30 Vesper in the year after February 2027.
  assert.ok(y.p50 > 12 * 221 * 15 && y.p50 < 12 * 221 * 35, String(y.p50));
  assert.equal(r417.spend.singleSourceYearOne.p50, y.p50, 'the one part is the single-source part');
});

test('ECR-0417 with no peer that shares Halden: the same numbers, and the peers are listed as left out', () => {
  const withPeers = supplyCheck(baseline, ecr('ECR-0417'), { seed: SEED, peers: [ecr('ECR-0419'), ecr('ECR-0421'), ecr('ECR-0409')] });
  assert.equal(withPeers.interaction, null);
  assert.deepEqual(withPeers.unrelatedPeers, ['ECR-0409', 'ECR-0419', 'ECR-0421']);
  assert.equal(JSON.stringify({ ...withPeers, unrelatedPeers: [] }), JSON.stringify(r417));
});

test('ECR-0419 and ECR-0421 share Orrin: the second to file waits a quarter for the slot', () => {
  const i419 = r419.interaction!;
  const i421 = r421.interaction!;
  assert.deepEqual(i419.peers.map((p) => p.ecr), ['ECR-0421']);
  assert.deepEqual(i421.peers.map((p) => p.ecr), ['ECR-0419']);
  assert.deepEqual(i421.peers[0].sharedSuppliers, ['SUP-ORRIN']);
  // ECR-0419 was filed first and keeps the 2027-Q2 slot.
  assert.deepEqual(i419.slots[0].alone.p50, '2027-04-01');
  assert.deepEqual(i419.slots[0].withPeers.p50, '2027-04-01');
  assert.equal(i419.cutIn.shiftWeeks.p50, 0);
  assert.equal(i419.cutIn.probabilityLater, 0);
  // ECR-0421 slips to 2027-Q3: 13 weeks, in every draw.
  assert.equal(i421.slots[0].alone.p50, '2027-04-01');
  assert.equal(i421.slots[0].withPeers.p50, '2027-07-01');
  assert.deepEqual(i421.slots[0].peers.map((p) => [p.ecr, p.opens.p50]), [['ECR-0419', '2027-04-01']]);
  assert.equal(i421.cutIn.shiftWeeks.p10, 13);
  assert.equal(i421.cutIn.shiftWeeks.p90, 13);
  assert.equal(i421.cutIn.probabilityLater, 1);
  assert.ok(i421.cutIn.withPeers.p50 > i421.cutIn.alone.p50);
  assert.ok(i421.late!.weeks.p50 > r421.missEffectivity!.weeks.p50 + 12.9);
  assert.ok(r421.flags.some((f) => f.kind === 'slot_contention'));
  assert.ok(r419.flags.every((f) => f.kind !== 'slot_contention'));
  assert.ok(r419.flags.some((f) => f.kind === 'shared_supplier'));
});

test('ECR-0419 and ECR-0421: the bundle earns 40% off the later qualification lot and a 6% raw-material price break', () => {
  const b419 = r419.interaction!.bundles[0];
  const b421 = r421.interaction!.bundles[0];
  assert.equal(b419.constraint, 'CON-ORRIN-UH-SLOT');
  assert.equal(b419.withinWeeks, 26);
  assert.equal(b419.probabilityBundled, 1, 'slots 13 weeks apart are inside the 26-week window');
  // Only the later ECR gets the cheaper qualification: 40% of Orrin's $142,000 lot for the Meridian magnets.
  const qualification = 0.4 * 142_000;
  assert.ok(b421.ownSaving.point >= qualification && b421.ownSaving.point < qualification + 10_000, String(b421.ownSaving.point));
  assert.ok(b419.ownSaving.point > 0 && b419.ownSaving.point < qualification * 4, 'ECR-0419 gets the price break only');
  // The pair's saving is the sum of the two, and does not depend on which ECR is asked.
  near(b419.pairSaving.point, b419.ownSaving.point + b421.ownSaving.point, 0.02, 'pair = 0419 + 0421, at the stated values');
  assert.equal(b419.pairSaving.p50, b421.pairSaving.p50, 'the same draws give the same pair number from either side');
  // The raw-material share is a default nobody stated, and says so.
  const raw = r419.inputs.find((i) => i.id === 'plan:rawMaterialShare')!;
  assert.equal(raw.source, 'default');
  assert.equal(raw.needsEstimate, true);
  assert.ok(r419.flags.some((f) => f.kind === 'needs_estimate' && f.ref === 'plan:rawMaterialShare'));
});

test('the interaction depends on who filed first, not on the order peers are passed', () => {
  const early = ecr('ECR-0421');
  early.filedOn = '2026-10-18';
  const r = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [early] });
  assert.equal(r.interaction!.cutIn.probabilityLater, 1, 'ECR-0419 now files second and waits');
  const a = supplyCheck(baseline, ecr('ECR-0417'), { seed: SEED, peers: [ecr('ECR-0419'), ecr('ECR-0421')] });
  const b = supplyCheck(baseline, ecr('ECR-0417'), { seed: SEED, peers: [ecr('ECR-0421'), ecr('ECR-0419')] });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const x = supplyCheck(baseline, ecr('ECR-0419'), { seed: SEED, peers: [ecr('ECR-0421'), ecr('ECR-0417')] });
  assert.deepEqual(x.unrelatedPeers, ['ECR-0417']);
  assert.equal(JSON.stringify({ ...x, unrelatedPeers: [] }), JSON.stringify({ ...r419, unrelatedPeers: [] }), 'an unrelated peer changes nothing');
});

test('the headline treats the ECR alone: the interaction is the what-if beside it', () => {
  const alone = supplyCheck(baseline, ecr('ECR-0421'), { seed: SEED });
  assert.equal(alone.interaction, null);
  assert.equal(JSON.stringify(alone.missEffectivity), JSON.stringify(r421.missEffectivity));
  assert.equal(JSON.stringify(alone.spend), JSON.stringify(r421.spend));
  // The timeline check is alone by construction, and agrees with the supply check's alone side.
  const t = timelineCheck(baseline, ecr('ECR-0421'), { seed: SEED });
  assert.equal(t.cutIn.date.p50, r421.interaction!.cutIn.alone.p50 === 0 ? '' : t.cutIn.date.p50);
  assert.equal(t.late!.weeks.p50, r421.missEffectivity!.weeks.p50);
});

test('capacity: the 1,200 UH sets a year are far from used by either ECR, and flagged when a smaller figure is set', () => {
  const c = r419.capacity.find((x) => x.constraint === 'CON-ORRIN-UH-CAPACITY')!;
  assert.equal(c.capacityPerYear, 1200);
  assert.ok(c.utilization.p50 > 0.2 && c.utilization.p50 < 0.4, String(c.utilization.p50));
  assert.ok(c.utilizationWithPeers!.p50 > c.utilization.p50, 'the Meridian sets add to it');
  assert.ok(r419.flags.every((f) => f.kind !== 'capacity_exceeded' && f.kind !== 'capacity_tight'));
  const small: Baseline = { ...baseline, supplierConstraints: bowman.supplierConstraints.map((s) => (s.id === 'CON-ORRIN-UH-CAPACITY' ? { ...s, capacityPerYear: 200 } : s)) };
  const r = supplyCheck(small, ecr('ECR-0419'), { seed: SEED });
  assert.ok(r.flags.some((f) => f.kind === 'capacity_exceeded' && f.ref === 'CON-ORRIN-UH-CAPACITY'));
  assert.deepEqual(r417.capacity, [], 'Halden has no capacity constraint');
});

test('deterministic for a seed; a different seed moves the draws', () => {
  const again = supplyCheck(baseline, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });
  assert.equal(JSON.stringify(again), JSON.stringify(r421));
  assert.notEqual(JSON.stringify(supplyCheck(baseline, ecr('ECR-0421'), { seed: 'other', peers: [ecr('ECR-0419')] })), JSON.stringify(r421));
});

test('converges, and every id in a trace is a recorded input', () => {
  for (const r of [r417, r419, r421]) {
    assert.ok(r.convergence.converged, `${r.ecr}: ${JSON.stringify(r.convergence.metrics)}`);
    const ids = new Set(r.inputs.map((i) => i.id));
    const used = traceIds(r);
    assert.ok(used.length > 5);
    for (const id of used) assert.ok(ids.has(id), `${r.ecr}: a trace names ${id}, which is not among the inputs`);
  }
});

test('structured bundle terms give the same numbers as the description they were read from', () => {
  const noText: Baseline = {
    ...baseline,
    supplierConstraints: bowman.supplierConstraints.map((s) =>
      s.id === 'CON-ORRIN-UH-SLOT' ? { ...s, description: 'Quarterly slots.', slotCadenceMonths: 3, bundle: { withinWeeks: 26, secondQualificationDiscount: 0.4, priceBreak: 0.06 } } : s),
  };
  const r = supplyCheck(noText, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });
  assert.equal(JSON.stringify(r.interaction!.bundles), JSON.stringify(r421.interaction!.bundles).replace(/terms_from_text/g, 'terms_from_text'));
  assert.ok(r.flags.every((f) => f.kind !== 'terms_from_text'));
});

test('a constraint that states no bundle terms gives the slot contention and no saving', () => {
  const bare: Baseline = {
    ...baseline,
    supplierConstraints: bowman.supplierConstraints.map((s) => (s.id === 'CON-ORRIN-UH-SLOT' ? { ...s, description: 'Open slots: 2027-Q2, then 2027-Q3.' } : s)),
  };
  const r = supplyCheck(bare, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });
  assert.equal(r.interaction!.cutIn.shiftWeeks.p50, 13);
  assert.deepEqual(r.interaction!.bundles, []);
  assert.ok(r.inputs.every((i) => i.id !== 'plan:rawMaterialShare'));
});

test('without constraints (the ERP holds none) there is no slot and no interaction beyond the shared supplier', () => {
  const { supplierConstraints: _, ...erpLike } = baseline;
  const r = supplyCheck(erpLike as Baseline, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });
  assert.equal(r.parts[0].slot, null);
  assert.equal(r.interaction!.cutIn.shiftWeeks.p50, 0);
  assert.deepEqual(r.interaction!.bundles, []);
  assert.deepEqual(r.capacity, []);
});

test('rows: finite and ordered, and the detail row carries the inputs, the peers and the flags', () => {
  const rows = supplyCheckRows(r421);
  const keys = rows.map((r) => r.key);
  for (const k of ['p_miss_effectivity', 'single_source_items', 'lead_weeks:BW-M512-340', 'spend_year_one', 'peer_cut_in_shift_weeks', 'p_cut_in_later_with_peers', 'p_miss_effectivity_with_peers', 'bundle_saving:CON-ORRIN-UH-SLOT', 'pair_bundle_saving:CON-ORRIN-UH-SLOT', 'detail']) {
    assert.ok(keys.includes(k), `${k} in ${keys.join(', ')}`);
  }
  for (const r of rows) {
    assert.ok([r.p10, r.p50, r.p90].every(Number.isFinite), r.key);
    assert.ok(r.p10 <= r.p50 && r.p50 <= r.p90, r.key);
    JSON.parse(r.detailJson);
  }
  assert.equal(rows.find((r) => r.key === 'p_cut_in_later_with_peers')!.p50, 1);
  assert.equal(rows.find((r) => r.key === 'peer_cut_in_shift_weeks')!.p50, 13);
  const detail = JSON.parse(rows.at(-1)!.detailJson) as SupplyResult;
  assert.equal(detail.interaction!.peers[0].ecr, 'ECR-0419');
  assert.match(detail.interaction!.peers[0].contentHash, /^[0-9a-f]{32}$/);
  assert.ok(detail.inputs.length > 10);
  assert.deepEqual(supplyCheckRows(r417).map((r) => r.key), ['p_miss_effectivity', 'single_source_items', 'lead_weeks:BW-5120-210', 'spend_year_one', 'spend_year_one_single_source', 'detail']);
});
