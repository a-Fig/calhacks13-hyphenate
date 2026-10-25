// Validator for the Bowman dataset. Run: node bowman/data/check.ts
// Checks referential integrity, recomputes the standard-cost roll-up from the dataset records
// (not from the catalog source), checks the planted demo scenarios, and prints a short summary.
// Exits with code 1 if any check fails.

import { bowman as d } from './index.ts';
import type { CostGroup, Ecr, Item, ItemCode, Provenance } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';
import { JSON_PATH, render } from './export.ts';
import { serialRanges } from './volume.ts';

const failures: string[] = [];
const warnings: string[] = [];
let checks = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) failures.push(msg);
}
function warn(cond: unknown, msg: string): void {
  if (!cond) warnings.push(msg);
}
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n: number) => n.toFixed(1) + '%';
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------------ indexes

const itemBy = new Map<ItemCode, Item>();
for (const it of d.items) {
  ok(!itemBy.has(it.code), `duplicate item ${it.code}`);
  itemBy.set(it.code, it);
}
const supplierBy = new Map(d.suppliers.map((s) => [s.id, s]));
const personBy = new Map(d.people.map((p) => [p.id, p]));
const wcBy = new Map(d.workCenters.map((w) => [w.id, w]));
const siteIds = new Set(d.sites.map((s) => s.id));
const ncrBy = new Map(d.ncrs.map((n) => [n.id, n]));
const ecrBy = new Map(d.ecrs.map((e) => [e.id, e]));

// ------------------------------------------------------------------ people, suppliers, work centers

for (const p of d.people) {
  ok(!p.reportsTo || personBy.has(p.reportsTo), `person ${p.id} reportsTo unknown ${p.reportsTo}`);
  ok(siteIds.has(p.site), `person ${p.id} unknown site ${p.site}`);
  ok(/@bowman-aviation\.example$/.test(p.email), `person ${p.id} email must use the .example domain`);
}
for (const seat of ['design_engineer', 'cm_analyst', 'ccb_chair', 'cost_engineer', 'buyer', 'production_planner', 'cost_accountant', 'quality', 'certification', 'cfo'] as const) {
  ok(d.people.some((p) => p.seat === seat), `no person in seat ${seat}`);
}
ok(d.people.some((p) => p.seat === 'design_engineer' && p.name.startsWith('Jeff ')), 'no design engineer named Jeff');
ok(d.people.filter((p) => p.ccbRole === 'chair').length === 1, 'need exactly one CCB chair');
for (const w of d.workCenters) ok(siteIds.has(w.site), `work center ${w.id} unknown site`);

ok(d.suppliers.length >= 12 && d.suppliers.length <= 15, `expected about 12 suppliers, have ${d.suppliers.length}`);
ok(d.suppliers.filter((s) => s.singleSource).length === 3, `expected 3 strategic single-source suppliers, have ${d.suppliers.filter((s) => s.singleSource).length}`);
for (const s of d.suppliers) ok(!/^(garmin|safran|honeywell|facc|hexcel|molicel|ge |stellantis)/i.test(s.name), `supplier ${s.name} looks like a real company name`);
for (const c of d.supplierConstraints) {
  ok(supplierBy.has(c.supplier), `constraint ${c.id} unknown supplier`);
  for (const it of c.items) ok(itemBy.has(it), `constraint ${c.id} unknown item ${it}`);
}

// ------------------------------------------------------------------ BOM

const kids = new Map<ItemCode, { child: ItemCode; qty: number }[]>();
for (const l of d.bom) {
  ok(itemBy.has(l.parent), `BOM parent ${l.parent} not an item`);
  ok(itemBy.has(l.child), `BOM child ${l.child} (under ${l.parent}) not an item`);
  ok(l.qty > 0, `BOM ${l.parent}/${l.child} qty must be positive`);
  const list = kids.get(l.parent) ?? [];
  list.push({ child: l.child, qty: l.qty });
  kids.set(l.parent, list);
}
for (const it of d.items) {
  if (it.makeBuy === 'make') ok((kids.get(it.code)?.length ?? 0) > 0, `make item ${it.code} has no BOM lines`);
  else ok(!kids.has(it.code), `buy item ${it.code} has BOM lines`);
  if (it.workCenter) ok(wcBy.has(it.workCenter), `item ${it.code} unknown work center`);
  if (it.makeBuy === 'make' && (it.laborHours ?? 0) > 0) ok(it.workCenter, `item ${it.code} has labor hours but no work center`);
}

// Cycle check and reachability
const tops = d.programs.map((p) => p.topItem);
for (const t of tops) ok(itemBy.has(t), `program top item ${t} missing`);
const reach: Record<string, Set<ItemCode>> = { vesper: new Set(), meridian: new Set() };
const state = new Map<ItemCode, number>();
function dfs(code: ItemCode, program: string) {
  if (state.get(code) === 1) {
    failures.push(`BOM cycle through ${code}`);
    return;
  }
  reach[program].add(code);
  state.set(code, 1);
  for (const k of kids.get(code) ?? []) dfs(k.child, program);
  state.set(code, 2);
}
for (const p of d.programs) {
  state.clear();
  dfs(p.topItem, p.id);
}
for (const it of d.items) {
  const inV = reach.vesper.has(it.code);
  const inM = reach.meridian.has(it.code);
  if (it.status === 'proposed') {
    ok(!inV && !inM, `proposed item ${it.code} must not be in a released BOM`);
    continue;
  }
  ok(inV || inM, `released item ${it.code} is in no BOM (orphan)`);
  const expected = [...(inV ? ['vesper'] : []), ...(inM ? ['meridian'] : [])].join(',');
  ok(it.programs.join(',') === expected, `item ${it.code} programs ${it.programs} != ${expected}`);
}

// ------------------------------------------------------------------ sourcing

const srcBy = new Map<ItemCode, typeof d.sourcing>();
for (const s of d.sourcing) {
  ok(itemBy.has(s.item), `sourcing unknown item ${s.item}`);
  ok(supplierBy.has(s.supplier), `sourcing ${s.item} unknown supplier ${s.supplier}`);
  ok(s.unitPrice.p10 <= s.unitPrice.p50 && s.unitPrice.p50 <= s.unitPrice.p90, `sourcing ${s.item}/${s.supplier} price quantiles not ordered`);
  ok(s.leadTimeWeeks.p10 <= s.leadTimeWeeks.p50 && s.leadTimeWeeks.p50 <= s.leadTimeWeeks.p90, `sourcing ${s.item}/${s.supplier} lead-time quantiles not ordered`);
  ok(s.moq > 0 && s.allocation > 0 && s.allocation <= 1, `sourcing ${s.item}/${s.supplier} moq or allocation invalid`);
  const list = srcBy.get(s.item) ?? [];
  list.push(s);
  srcBy.set(s.item, list);
}
for (const it of d.items) {
  const list = srcBy.get(it.code) ?? [];
  if (it.makeBuy === 'buy') {
    ok(list.length > 0, `buy item ${it.code} has no sourcing`);
    const primary = list.filter((s) => s.primary);
    ok(primary.length === 1, `buy item ${it.code} needs exactly one primary source`);
    ok(primary[0]?.supplier === it.defaultSupplier, `item ${it.code} default supplier != primary source`);
    ok(near(list.reduce((a, s) => a + s.allocation, 0), 1, 1e-6), `item ${it.code} allocations do not sum to 1`);
    ok(list.every((s) => s.soleSource === (list.length === 1)), `item ${it.code} soleSource flag inconsistent`);
  } else {
    ok(list.length === 0, `make item ${it.code} should have no sourcing`);
  }
}

// ------------------------------------------------------------------ independent standard-cost roll-up

const price = (code: ItemCode) => srcBy.get(code)!.find((s) => s.primary)!.unitPrice.p50;
const rolled = new Map<ItemCode, number>();
function cost(code: ItemCode): number {
  const hit = rolled.get(code);
  if (hit !== undefined) return hit;
  const it = itemBy.get(code)!;
  let c: number;
  if (it.makeBuy === 'buy') c = price(code);
  else {
    c = (it.laborHours ?? 0) * (it.workCenter ? wcBy.get(it.workCenter)!.laborRatePerHour : 0);
    for (const k of kids.get(code) ?? []) c += k.qty * cost(k.child);
  }
  rolled.set(code, c);
  return c;
}
for (const it of d.items) {
  if (it.status === 'proposed') continue;
  ok(near(cost(it.code), it.standardCost, 0.02 + it.standardCost * 1e-6), `standard cost of ${it.code}: stored ${it.standardCost}, recomputed ${cost(it.code).toFixed(2)}`);
  ok(near(it.standardCostMaterial + it.standardCostLabor, it.standardCost, 0.02), `standard cost split of ${it.code} does not add up`);
}

function groupShare(top: ItemCode): { total: number; groups: Record<CostGroup, number> } {
  const groups: Record<CostGroup, number> = { airframe: 0, powertrain: 0, battery: 0, avionics: 0, actuation_thermal: 0, other: 0 };
  const walk = (code: ItemCode, mult: number) => {
    const it = itemBy.get(code)!;
    if (it.makeBuy === 'buy') {
      groups[it.costGroup] += price(code) * mult;
      return;
    }
    groups[it.costGroup] += (it.laborHours ?? 0) * (it.workCenter ? wcBy.get(it.workCenter)!.laborRatePerHour : 0) * mult;
    for (const k of kids.get(code) ?? []) walk(k.child, mult * k.qty);
  };
  walk(top, 1);
  return { total: Object.values(groups).reduce((a, b) => a + b, 0), groups };
}

const vesper = d.programs.find((p) => p.id === 'vesper')!;
const meridian = d.programs.find((p) => p.id === 'meridian')!;
const v = groupShare(vesper.topItem);
const m = groupShare(meridian.topItem);
const TARGET: Record<CostGroup, number> = { avionics: 20, powertrain: 22, battery: 15, airframe: 20, actuation_thermal: 10, other: 13 };

ok(near(v.total, 2_800_000, 14_000), `Vesper roll-up ${fmt(v.total)} not within 0.5% of $2.8M`);
for (const g of Object.keys(TARGET) as CostGroup[]) {
  ok(near((100 * v.groups[g]) / v.total, TARGET[g], 0.5), `Vesper ${g} share ${pct((100 * v.groups[g]) / v.total)} != target ${TARGET[g]}%`);
}
ok(near(m.total, 5_000_000, 250_000), `Meridian roll-up ${fmt(m.total)} not within 5% of $5.0M`);
ok(near(vesper.standardCostUsd, v.total, 0.005 * vesper.standardCostUsd), 'program record Vesper standard cost drifts from roll-up');
ok(near(meridian.standardCostUsd, m.total, 0.02 * meridian.standardCostUsd), 'program record Meridian standard cost drifts from roll-up');

// At-rate roll-up with the group rate factors
const rf = new Map(d.rateFactors.map((r) => [r.costGroup, r.atDesignRate]));
let atRate = 0;
for (const g of Object.keys(TARGET) as CostGroup[]) {
  ok(rf.has(g), `no rate factor for ${g}`);
  atRate += v.groups[g] * (rf.get(g) ?? 1);
}
ok(near(atRate, 1_800_000, 54_000), `Vesper at-rate cost ${fmt(atRate)} not within 3% of $1.8M`);

const laborTotal = d.items.find((i) => i.code === vesper.topItem)!.standardCostLabor;
ok(laborTotal / v.total > 0.08 && laborTotal / v.total < 0.2, `labor share ${pct((100 * laborTotal) / v.total)} implausible`);

// Shared powertrain parts: Meridian reuses about 40% of Vesper powertrain (and battery) parts
const ptItems = d.items.filter((i) => (i.costGroup === 'powertrain' || i.costGroup === 'battery') && i.programs.includes('vesper'));
const sharedPt = ptItems.filter((i) => i.programs.includes('meridian'));
const sharePct = (100 * sharedPt.length) / ptItems.length;
ok(sharePct >= 35 && sharePct <= 46, `Meridian reuses ${pct(sharePct)} of Vesper powertrain parts, expected about 40%`);

// ------------------------------------------------------------------ manufacturing BOM (stations)

// The ERP's BOM is the engineering BOM below each program's top, plus d.mbom.bom for the top level.
const topSet = new Set(d.programs.map((p) => p.topItem));
const mbomLines = [...d.bom.filter((l) => !topSet.has(l.parent)), ...d.mbom.bom];
const mbomItems = [...d.items, ...d.mbom.items];
const mItemBy = new Map(mbomItems.map((i) => [i.code, i]));
for (const s of d.mbom.items) {
  ok(!itemBy.has(s.code), `station ${s.code} clashes with an engineering item`);
  ok(s.makeBuy === 'make' && s.itemGroup === 'Build stations' && s.laborHours && s.workCenter && wcBy.has(s.workCenter), `station ${s.code} is not a make item in Build stations with labor`);
  ok(!d.bom.some((l) => l.child === s.code || l.parent === s.code), `station ${s.code} appears in the engineering BOM`);
}
for (const t of topSet) {
  const top = itemBy.get(t)!;
  const stations = d.mbom.bom.filter((l) => l.parent === t);
  const engKids = d.bom.filter((l) => l.parent === t);
  ok(stations.length > 0 && stations.every((l) => mItemBy.get(l.child) && d.mbom.items.some((s) => s.code === l.child) && l.qty === 1), `${t}: MBOM top level is not a list of stations`);
  // Every top-level child of the engineering BOM sits under exactly one station, with its quantity.
  const placed = engKids.map((e) => d.mbom.bom.filter((l) => stations.some((s) => s.child === l.parent) && l.child === e.child && l.qty === e.qty));
  ok(placed.every((p) => p.length === 1), `${t}: a top-level child is missing from, or repeated across, the stations`);
  const held = d.mbom.bom.filter((l) => stations.some((s) => s.child === l.parent));
  ok(held.length === engKids.length, `${t}: the stations hold ${held.length} lines, the engineering top level ${engKids.length}`);
  // The top item's own labor is split across its stations, exactly.
  const hours = stations.reduce((h, l) => h + (mItemBy.get(l.child)!.laborHours ?? 0), 0);
  ok(hours === top.laborHours && stations.every((l) => mItemBy.get(l.child)!.workCenter === top.workCenter), `${t}: station hours ${hours} differ from the aircraft's own ${top.laborHours}, or sit in another work center`);
}
// Exploded leaf quantities per aircraft, engineering BOM against manufacturing BOM.
function explodeLeaves(lines: { parent: ItemCode; child: ItemCode; qty: number }[], top: ItemCode): Map<ItemCode, number> {
  const by = new Map<ItemCode, { child: ItemCode; qty: number }[]>();
  for (const l of lines) by.set(l.parent, [...(by.get(l.parent) ?? []), l]);
  const out = new Map<ItemCode, number>();
  const walk = (code: ItemCode, mult: number) => {
    const ks = by.get(code);
    if (!ks) { out.set(code, (out.get(code) ?? 0) + mult); return; }
    for (const k of ks) walk(k.child, mult * k.qty);
  };
  walk(top, 1);
  return out;
}
let leafKinds = 0;
for (const t of topSet) {
  const eng = explodeLeaves(d.bom, t);
  const mf = explodeLeaves(mbomLines, t);
  const diffs = [...new Set([...eng.keys(), ...mf.keys()])].filter((c) => eng.get(c) !== mf.get(c));
  ok(diffs.length === 0, `${t}: exploded leaf quantities differ between EBOM and MBOM: ${diffs.slice(0, 3).join(', ')}`);
  ok(eng.size > 50, `${t}: suspiciously few leaves (${eng.size})`);
  leafKinds += mf.size;
}
// MBOM roll-up: leaves at the primary quote, make items add their labor (the top has none in the MBOM).
const mRolled = new Map<ItemCode, number>();
const mKids = new Map<ItemCode, { child: ItemCode; qty: number }[]>();
for (const l of mbomLines) mKids.set(l.parent, [...(mKids.get(l.parent) ?? []), l]);
function mCost(code: ItemCode): number {
  const hit = mRolled.get(code);
  if (hit !== undefined) return hit;
  const it = mItemBy.get(code)!;
  const own = it.makeBuy === 'buy' ? srcBy.get(code)!.find((s) => s.primary)!.unitPrice.p50 : topSet.has(code) ? 0 : (it.laborHours ?? 0) * (it.workCenter ? wcBy.get(it.workCenter)!.laborRatePerHour : 0);
  const c = own + (mKids.get(code) ?? []).reduce((a, k) => a + k.qty * mCost(k.child), 0);
  mRolled.set(code, c);
  return c;
}
for (const t of topSet) ok(near(mCost(t), itemBy.get(t)!.standardCost, 0.02), `${t}: MBOM roll-up ${mCost(t).toFixed(2)} differs from the engineering roll-up ${itemBy.get(t)!.standardCost}`);
for (const s of d.mbom.items) {
  ok(near(mCost(s.code), s.standardCost, 0.02), `station ${s.code}: stored ${s.standardCost}, recomputed ${mCost(s.code).toFixed(2)}`);
  ok(near(s.standardCostMaterial + s.standardCostLabor, s.standardCost, 0.02), `station ${s.code}: cost split does not add up`);
}

// ------------------------------------------------------------------ stock, purchase orders

const stockBy = new Map(d.stock.map((s) => [s.item, s]));
for (const s of d.stock) {
  ok(itemBy.has(s.item), `stock unknown item ${s.item}`);
  ok([s.stores, s.wip, s.finishedGoods, s.supplierFinished, s.onOrder, s.inField].every((x) => x >= 0), `stock ${s.item} negative`);
}
for (const it of d.items) if (it.kind !== 'aircraft' && it.status === 'released') ok(stockBy.has(it.code), `no stock row for ${it.code}`);

const openByItem = new Map<ItemCode, number>();
const poIds = new Set<string>();
for (const po of d.purchaseOrders) {
  ok(!poIds.has(po.id), `duplicate PO ${po.id}`);
  poIds.add(po.id);
  ok(supplierBy.has(po.supplier), `PO ${po.id} unknown supplier`);
  ok(personBy.has(po.buyer), `PO ${po.id} unknown buyer`);
  ok(po.lines.length > 0, `PO ${po.id} has no lines`);
  const open = po.lines.some((l) => l.receivedQty < l.qty);
  ok(po.status === (open ? 'open' : 'received'), `PO ${po.id} status ${po.status} inconsistent with receipts`);
  for (const l of po.lines) {
    const it = itemBy.get(l.item);
    ok(it, `PO ${po.id} unknown item ${l.item}`);
    if (!it) continue;
    ok(srcBy.get(l.item)?.some((s) => s.supplier === po.supplier), `PO ${po.id}: ${po.supplier} is not a source for ${l.item}`);
    ok(l.qty > 0 && l.unitPrice > 0, `PO ${po.id} line ${l.item} qty or price invalid`);
    ok(!l.receivedDate || l.receivedDate >= po.orderDate, `PO ${po.id} ${l.item} received before ordered`);
    ok(l.receivedQty <= l.qty, `PO ${po.id} ${l.item} over-received`);
    if (l.receivedQty < l.qty) openByItem.set(l.item, (openByItem.get(l.item) ?? 0) + l.qty - l.receivedQty);
    ok(l.unitPrice > price(l.item) * 0.6 && l.unitPrice < price(l.item) * 1.6, `PO ${po.id} ${l.item} price ${l.unitPrice} far from current ${price(l.item)}`);
  }
}
for (const s of d.stock) {
  ok((openByItem.get(s.item) ?? 0) === s.onOrder + s.supplierFinished, `stock ${s.item}: open PO quantity ${openByItem.get(s.item) ?? 0} != onOrder + supplierFinished ${s.onOrder + s.supplierFinished}`);
}

// ------------------------------------------------------------------ volume plan, build history

const vYear = new Map<string, number>();
const mYear = new Map<string, number>();
for (const r of d.volumePlan) {
  ok(/^\d{4}-\d{2}$/.test(r.month) && r.month >= '2026-10' && r.month <= '2030-12', `volume row month ${r.month} out of range`);
  ok(siteIds.has(r.site), `volume row unknown site ${r.site}`);
  const map = r.program === 'vesper' ? vYear : mYear;
  map.set(r.month.slice(0, 4), (map.get(r.month.slice(0, 4)) ?? 0) + r.units);
}
for (const program of ['vesper', 'meridian'] as const) {
  const months = new Set(d.volumePlan.filter((r) => r.program === program).map((r) => r.month));
  for (let y = 2026; y <= 2030; y++) {
    for (let mth = 1; mth <= 12; mth++) {
      const month = `${y}-${String(mth).padStart(2, '0')}`;
      if (month >= '2026-10') ok(months.has(month), `${program} volume plan has no row for ${month}`);
    }
  }
}
const wantV: Record<string, number> = { '2026': 3, '2027': 24, '2028': 72, '2029': 210, '2030': 548 };
for (const [y, n] of Object.entries(wantV)) ok(vYear.get(y) === n, `Vesper ${y} volume ${vYear.get(y)} != ${n}`);
ok(mYear.get('2030') === 24, `Meridian 2030 volume ${mYear.get('2030')} != 24`);
const dec2030 = d.volumePlan.filter((r) => r.program === 'vesper' && r.month === '2030-12').reduce((a, r) => a + r.units, 0);
ok(dec2030 * 12 >= 640 && dec2030 * 12 <= 660, `December 2030 exit rate ${dec2030 * 12} per year is not about 650`);
ok(d.volumePlan.filter((r) => r.program === 'vesper' && r.month < '2028-07').every((r) => r.site === 'CA'), 'Georgia final line should open in 2028-07');
d.builtAircraft.forEach((a, i) => ok(a.serial === i + 1, `built aircraft serials not contiguous at ${a.serial}`));
ok(d.builtAircraft.every((a, i, arr) => i === 0 || arr[i - 1].completed <= a.completed), 'built aircraft not in date order');

// ------------------------------------------------------------------ history

ok(d.history.length >= 6 && d.history.length <= 12, `expected 6-10 past ECOs, have ${d.history.length}`);
const openEcrIds = new Set(d.ecrs.map((e) => e.id));
for (const e of d.history) {
  ok(personBy.has(e.originator), `${e.id} unknown originator`);
  ok(!openEcrIds.has(e.ecr), `${e.id} points at an open ECR ${e.ecr}`);
  ok(e.fileDate <= e.approvedOn && e.approvedOn <= e.releasedOn, `${e.id} dates out of order`);
  ok(e.forecast.cutInDate > e.releasedOn && e.actual.cutInDate >= e.releasedOn && e.actual.cutInDate <= '2026-10-24', `${e.id} cut-in dates implausible`);
  ok(e.releasedOn >= '2025-04-24' && e.releasedOn <= '2026-10-24', `${e.id} released outside the last 18 months`);
  ok(e.actual.variance.length > 20, `${e.id} lacks a variance explanation`);
  for (const ch of e.itemChanges) {
    const it = itemBy.get(ch.item);
    ok(it, `${e.id} unknown item ${ch.item}`);
    if (!it) continue;
    ok(it.revHistory.some((r) => r.eco === e.id && r.rev === ch.toRev), `${e.id}: ${ch.item} revHistory lacks ${ch.toRev}`);
  }
}
for (const it of d.items) {
  if (it.status === 'proposed') continue;
  const last = it.revHistory[it.revHistory.length - 1];
  ok(last?.rev === it.rev, `item ${it.code} rev ${it.rev} != last revHistory rev ${last?.rev}`);
}
// The actual unit-cost delta of each ECO equals the price change times the quantity per aircraft
{
  const qtyPer = new Map<ItemCode, number>();
  const walk = (code: ItemCode, mult: number) => {
    qtyPer.set(code, (qtyPer.get(code) ?? 0) + mult);
    for (const k of kids.get(code) ?? []) walk(k.child, mult * k.qty);
  };
  walk(vesper.topItem, 1);
  for (const e of d.history) {
    let delta = 0;
    for (const ch of e.itemChanges) {
      const p = ch.changes.find((c) => c.field === 'unit_price_usd');
      if (p && typeof p.from === 'number' && typeof p.to === 'number') delta += (p.to - p.from) * (qtyPer.get(ch.item) ?? 0);
    }
    ok(near(delta, e.actual.unitCostDeltaUsd, Math.max(2, 0.01 * Math.abs(delta))), `${e.id}: price changes imply ${delta.toFixed(0)} per aircraft, actual says ${e.actual.unitCostDeltaUsd}`);
  }
}
// ECO program tags are the union of the programs of the items they change
for (const e of d.history) {
  const want = [...new Set(e.itemChanges.flatMap((c) => itemBy.get(c.item)?.programs ?? []))].sort().join(',');
  ok([...e.program].sort().join(',') === want, `${e.id}: program tags ${e.program} != programs of changed items ${want}`);
}
// The first purchase order received at the new price arrives after release and before the actual cut-in
for (const e of d.history) {
  for (const ch of e.itemChanges) {
    const p = ch.changes.find((c) => c.field === 'unit_price_usd');
    if (!p || typeof p.from !== 'number' || typeof p.to !== 'number' || Math.abs(p.to - p.from) / p.from < 0.01) continue;
    const mid = (p.from + p.to) / 2;
    const up = p.to > p.from;
    const recv = d.purchaseOrders
      .flatMap((po) => po.lines.filter((l) => l.item === ch.item && l.receivedDate && (up ? l.unitPrice > mid : l.unitPrice < mid)))
      .map((l) => l.receivedDate as string)
      .sort();
    ok(recv.length > 0, `${e.id}: no purchase order received at the new price of ${ch.item}`);
    if (recv.length) {
      ok(recv[0] > e.releasedOn, `${e.id}: ${ch.item} received at the new price (${recv[0]}) before release ${e.releasedOn}`);
      ok(recv[0] <= e.actual.cutInDate, `${e.id}: first ${ch.item} at the new price arrives ${recv[0]}, after the actual cut-in ${e.actual.cutInDate}`);
    }
  }
}
// Serial numbers sit in the right month of the build history or the volume plan
{
  const sr = serialRanges();
  const monthOfSerial = (s: number) => {
    const built = d.builtAircraft.find((a) => a.serial === s);
    if (built) return built.completed.slice(0, 7);
    return sr.find((r) => s >= r.first && s <= r.last)?.month;
  };
  ok(monthOfSerial(11) === '2026-11' && monthOfSerial(15) === '2027-03' && monthOfSerial(34) === '2027-12', 'serial-to-month mapping drifted from the volume plan');
  for (const e of d.history) {
    if (e.actual.cutInSerial === undefined) continue;
    const m = monthOfSerial(e.actual.cutInSerial);
    ok(m !== undefined && m >= e.actual.cutInDate.slice(0, 7), `${e.id}: cut-in serial ${e.actual.cutInSerial} completes ${m}, before the cut-in date ${e.actual.cutInDate}`);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let compared = 0;
  for (const e of d.ecrs) {
    const p = e.effectivity.production;
    if (p.basis !== 'serial') continue;
    const m = /[(](?:about )?([A-Za-z]+) ([0-9]{4})[)]/.exec(p.note);
    if (!m) continue;
    compared++;
    const want = `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
    ok(monthOfSerial(Number(p.from)) === want, `${e.id}: effectivity S/N ${p.from} is in ${monthOfSerial(Number(p.from))} per the volume plan, the note says ${want}`);
  }
  ok(compared >= 3, `expected to compare at least 3 effectivity months, compared ${compared}`);
}
// Mean forecast error, for the summary
const costErr = d.history.map((e) => (e.actual.unitCostDeltaUsd - e.forecast.unitCostDeltaUsd) / Math.abs(e.forecast.unitCostDeltaUsd));
const slipWeeks = d.history.map((e) => (new Date(e.actual.cutInDate).getTime() - new Date(e.forecast.cutInDate).getTime()) / (7 * 864e5));

// ------------------------------------------------------------------ NCRs and ECRs

for (const n of d.ncrs) {
  ok(personBy.has(n.openedBy), `${n.id} unknown opener`);
  const it = itemBy.get(n.item);
  ok(it, `${n.id} unknown item ${n.item}`);
  if (it) ok(it.rev === n.rev, `${n.id} item ${n.item} rev ${n.rev} != current ${it.rev}`);
  if (n.linkedEcr) {
    const e = ecrBy.get(n.linkedEcr);
    ok(e, `${n.id} links to unknown ${n.linkedEcr}`);
    ok(e?.originatingNcr === n.id, `${n.id} and ${n.linkedEcr} do not link back to each other`);
  } else ok(n.status === 'open', `${n.id} has no ECR but is not open`);
}

const bomQty = (parent: ItemCode, child: ItemCode) => kids.get(parent)?.find((k) => k.child === child)?.qty;
for (const e of d.ecrs) {
  ok(personBy.has(e.originator), `${e.id} unknown originator`);
  ok(['D', 'B', 'C', 'O', 'P', 'R', 'S', 'V'].includes(e.justificationCode), `${e.id} bad justification code`);
  if (e.originatingNcr) ok(ncrBy.get(e.originatingNcr)?.linkedEcr === e.id, `${e.id} originating NCR does not link back`);
  ok(e.filedOn <= '2026-10-24', `${e.id} filed in the future`);
  for (const ch of e.itemChanges) {
    const it = itemBy.get(ch.item);
    ok(it, `${e.id} unknown item ${ch.item}`);
    if (!it) continue;
    if (ch.op === 'revise') ok(it.rev === ch.fromRev, `${e.id}: ${ch.item} is Rev ${it.rev} in the baseline, ECR says Rev ${ch.fromRev}`);
    if (ch.op === 'add') ok(it.status === 'proposed', `${e.id}: added item ${ch.item} should be a proposed item`);
    for (const f of ch.changes.filter((c) => c.field === 'unit_price_usd' && c.from !== null)) {
      if (it.makeBuy === 'buy') ok(f.from === price(ch.item), `${e.id}: ${ch.item} price from ${f.from} != baseline ${price(ch.item)}`);
    }
  }
  for (const b of e.bomChanges) {
    ok(itemBy.has(b.parent) && itemBy.has(b.child), `${e.id} BOM change unknown item`);
    if (b.op === 'remove') ok(bomQty(b.parent, b.child) === b.qtyFrom, `${e.id}: ${b.parent} has ${bomQty(b.parent, b.child)} of ${b.child}, ECR removes ${b.qtyFrom}`);
    if (b.op === 'add') ok(bomQty(b.parent, b.child) === undefined, `${e.id}: ${b.child} already under ${b.parent}`);
    if (b.op === 'set_qty') ok(bomQty(b.parent, b.child) === b.qtyFrom, `${e.id}: ${b.parent} has ${bomQty(b.parent, b.child)} of ${b.child}, ECR changes ${b.qtyFrom}`);
  }
  for (const q of e.supplierQuotes) {
    ok(supplierBy.has(q.supplier) && itemBy.has(q.item), `${e.id} quote ${q.id} unknown supplier or item`);
    ok(srcBy.get(q.item)?.some((s) => s.supplier === q.supplier), `${e.id} quote ${q.id}: ${q.supplier} is not a source for ${q.item}`);
  }
  for (const inv of e.inventoryProposal) ok(itemBy.has(inv.item), `${e.id} inventory proposal unknown item ${inv.item}`);
  for (const blockName of ['production', 'retrofit', 'logisticsSupport', 'other'] as const) ok(Array.isArray(e.costPage[blockName]), `${e.id} cost page missing ${blockName}`);
  ok(e.description.length > 200 && e.need.length > 80, `${e.id} prose too thin`);
}

// ------------------------------------------------------------------ scenarios

function itemFieldSet(e: Ecr) {
  const m = new Map<string, string>();
  for (const ch of e.itemChanges) for (const f of ch.changes) m.set(`${ch.item}|${f.field}`, JSON.stringify(f.to));
  return m;
}
// S1: the worked example
{
  const e = ecrBy.get('ECR-0417')!;
  const s = stockBy.get('BW-5120-210')!;
  ok(e.companyClass === 'I' && e.faaClass === 'minor', 'ECR-0417 should be Class I and FAA minor');
  ok(s.stores === 96 && s.wip === 48 && s.supplierFinished === 60 && s.onOrder === 60, 'bracket stock does not match the worked example');
  ok(s.inField === 12 * d.builtAircraft.length, 'bracket in-field count must be 12 per built aircraft');
  const q = e.supplierQuotes[0];
  ok(q.lines[0].unitPrice === 221 && q.lines[1].unitPrice === 239.5, 'ECR-0417 quote prices changed');
  ok(price('BW-5120-210') === 186.4, 'bracket standard changed from $186.40');
  ok(srcBy.get('BW-5120-210')!.length === 1, 'bracket must be single-sourced');
  ok(e.effectivity.retrofit?.to === String(d.builtAircraft.length), 'retrofit scope should cover every built aircraft');
  ok(bomQty('BW-5100-000', 'BW-5120-000') === 1 && bomQty('BW-5200-000', 'BW-5120-000') === 1 && bomQty('BW-5120-000', 'BW-5120-210') === 1, 'bracket must be one per controller');
  const insts = d.bom.filter((l) => l.child === 'BW-3010-000' || l.child === 'BW-3510-000');
  ok(insts.length === 2 && insts.every((l) => l.qty === 6), 'twelve propulsor units expected');
}
// S2: aft propellers
{
  const e = ecrBy.get('ECR-0409')!;
  ok(e.companyClass === 'I' && e.faaClass === 'major', 'ECR-0409 should be Class I and FAA major');
  const before = (kids.get('BW-4200-000') ?? []).reduce((a, k) => a + k.qty * price(k.child), 0);
  let after = before;
  for (const b of e.bomChanges) {
    const p = price(b.child);
    after += b.op === 'add' ? (b.qtyTo ?? 0) * p : -(b.qtyFrom ?? 0) * p;
  }
  ok(near(after - before, 1440, 1), `aft propeller material delta ${(after - before).toFixed(0)} != 1,440`);
}
// S3: fast track
{
  const e = ecrBy.get('ECR-0423')!;
  const touched = e.itemChanges.map((c) => itemBy.get(c.item)!);
  ok(e.companyClass === 'II' && e.faaClass === 'minor' && e.effectivity.interchangeable, 'ECR-0423 must be Class II, FAA minor and interchangeable');
  ok(touched.every((t) => !t.safetyCritical), 'ECR-0423 touches a safety-critical item');
  ok(e.supplierQuotes.every((q) => q.supplier === itemBy.get(q.item)!.defaultSupplier), 'ECR-0423 changes supplier');
  ok(!e.costPage.production.some((l) => l.oneTime), 'ECR-0423 has one-time cost');
}
// S4: conflict
{
  const a = itemFieldSet(ecrBy.get('ECR-0412')!);
  const b = itemFieldSet(ecrBy.get('ECR-0415')!);
  const shared = [...a.keys()].filter((k) => b.has(k));
  const differing = shared.filter((k) => a.get(k) !== b.get(k));
  ok(shared.length >= 3 && differing.length >= 3, `conflict pair should share and differ on several fields (shared ${shared.length}, differing ${differing.length})`);
  ok(shared.every((k) => k.startsWith('BW-8210-110|')), 'conflict pair should be one item');
  ok(itemBy.get('BW-8210-110')!.programs.length === 2, 'pump should be shared with Meridian');
}
// S5: shared supplier, different parts
{
  const e1 = ecrBy.get('ECR-0419')!;
  const e2 = ecrBy.get('ECR-0421')!;
  const items1 = new Set(e1.itemChanges.map((c) => c.item));
  const items2 = new Set(e2.itemChanges.map((c) => c.item));
  ok([...items1].every((i) => !items2.has(i)), 'interaction pair must touch different items');
  const sup = (e: Ecr) => new Set(e.supplierQuotes.map((q) => q.supplier));
  const common = [...sup(e1)].filter((s) => sup(e2).has(s));
  ok(common.length === 1 && common[0] === 'SUP-ORRIN', 'interaction pair should share exactly Orrin Magnetics');
  ok(srcBy.get('BW-3120-340')!.length === 1 && srcBy.get('BW-M512-340')!.length === 1, 'both magnet items should be sole-sourced');
  ok(e1.program === 'vesper' && e2.program === 'meridian', 'interaction pair should span both programs');
  ok(d.supplierConstraints.some((c) => c.supplier === 'SUP-ORRIN' && c.kind === 'qualification_slot' && c.items.includes('BW-3120-340') && c.items.includes('BW-M512-340')), 'Orrin qualification-slot constraint missing');
}
// Background traps: look cheap or trivial, are not
{
  const e6 = ecrBy.get('ECR-0406')!;
  ok(e6.companyClass === 'II' && itemBy.get('BW-9450-100')!.safetyCritical, 'ECR-0406 trap: filed Class II on a safety-critical item');
  ok(e6.itemChanges[0].changes.some((c) => c.field === 'connector_pins'), 'ECR-0406 trap: connector change missing');
  const e10 = ecrBy.get('ECR-0410')!;
  ok(e10.bomChanges[0].op === 'set_qty' && bomQty('BW-9100-000', 'BW-9130-100') === e10.bomChanges[0].qtyFrom, 'ECR-0410 quantity does not match the BOM');
  ok(itemBy.get('BW-1910-100')!.programs.join() === 'vesper', 'prepreg should feed Vesper only');
}
ok(d.demoScenarios.filter((s) => s.kind !== 'background').length === 5, 'expected five planted demo scenarios');
ok(d.demoScenarios.filter((s) => s.kind === 'background').length === 3, 'expected three background scenarios');
for (const sc of d.demoScenarios) for (const id of sc.ecrs) ok(ecrBy.has(id), `scenario ${sc.id} unknown ECR ${id}`);

// ------------------------------------------------------------------ no real company or product names outside provenance and analog fields

{
  const REAL = new RegExp('\\b(Archer|Garmin|Safran|Honeywell|FACC|Hexcel|Molicel|Teamcenter|SAP|Midnight|Joby|Beta Technologies|GE Aerospace|Stellantis|Boeing|Lilium|Anduril|Palantir|Overair|Dunmore)\\b');
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (REAL.test(v)) failures.push(`real name in ${path}: ${v.slice(0, 60)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'prov' && k !== 'analog' && k !== 'sectionProvenance') walk(x, `${path}.${k}`);
    }
  };
  checks++;
  walk(d, 'dataset');
}

// ------------------------------------------------------------------ provenance

function provCount(label: string, records: { prov?: Provenance }[]) {
  let sourced = 0;
  for (const r of records) {
    ok(r.prov && (r.prov.basis === 'sourced' || r.prov.basis === 'invented'), `${label}: record without provenance`);
    if (r.prov?.basis === 'sourced') {
      sourced++;
      ok(r.prov.ref, `${label}: sourced record without a pointer`);
    }
  }
  return `${sourced}/${records.length}`;
}
const provRows: [string, string][] = [
  ['items', provCount('items', d.items)], ['stations', provCount('mbom.items', d.mbom.items)], ['sourcing', provCount('sourcing', d.sourcing)], ['suppliers', provCount('suppliers', d.suppliers)],
  ['people', provCount('people', d.people)], ['programs', provCount('programs', d.programs)], ['ECOs', provCount('history', d.history)],
  ['NCRs', provCount('ncrs', d.ncrs)], ['ECRs', provCount('ecrs', d.ecrs)], ['stock', provCount('stock', d.stock)], ['POs', provCount('purchaseOrders', d.purchaseOrders)],
];
for (const k of ['volumePlan', 'builtAircraft', 'standardCostHistory', 'bom', 'mbom', 'purchaseOrders', 'stock']) ok(d.sectionProvenance[k], `no section provenance for ${k}`);

// ------------------------------------------------------------------ exported JSON is current

if (existsSync(JSON_PATH)) {
  const onDisk = readFileSync(JSON_PATH, 'utf8').split('\r\n').join('\n');
  ok(onDisk === render(), 'bowman.json is out of date: run node bowman/data/export.ts');
} else {
  warn(false, 'bowman.json not found: run node bowman/data/export.ts');
}

// ------------------------------------------------------------------ summary

const make = d.items.filter((i) => i.makeBuy === 'make');
const buyI = d.items.filter((i) => i.makeBuy === 'buy');
const poLines = d.purchaseOrders.reduce((a, p) => a + p.lines.length, 0);
const soleSourced = d.items.filter((i) => i.makeBuy === 'buy' && srcBy.get(i.code)!.length === 1 && i.status === 'released').length;

console.log('Bowman dataset check');
console.log(`  as of ${d.company.asOf}`);
console.log(`  people ${d.people.length}, suppliers ${d.suppliers.length} (${d.suppliers.filter((s) => s.singleSource).length} strategic single-source), work centers ${d.workCenters.length}`);
console.log(`  items ${d.items.length}: ${make.length} make, ${buyI.length} buy, ${d.items.filter((i) => i.status === 'proposed').length} proposed; BOM lines ${d.bom.length}; sourcing records ${d.sourcing.length}; sole-sourced buy items ${soleSourced}`);
console.log(`  manufacturing BOM: ${d.mbom.items.length} build stations, ${d.mbom.bom.length} top-level lines (the ERP's BOM has ${mbomLines.length} lines, the PLM's ${d.bom.length}); ${leafKinds} leaf-quantity pairs equal across EBOM and MBOM`);
console.log(`  stock rows ${d.stock.length}; purchase orders ${d.purchaseOrders.length} (${d.purchaseOrders.filter((p) => p.status === 'open').length} open), lines ${poLines}`);
console.log(`  volume plan rows ${d.volumePlan.length}; Vesper per year ${[...vYear.entries()].map(([y, n]) => `${y}:${n}`).join(' ')}; built aircraft ${d.builtAircraft.length}`);
console.log(`  history: ${d.history.length} released ECOs, mean cost error ${pct(100 * costErr.reduce((a, b) => a + b, 0) / costErr.length)} of forecast, mean cut-in slip ${(slipWeeks.reduce((a, b) => a + b, 0) / slipWeeks.length).toFixed(1)} weeks`);
console.log(`  open: ${d.ncrs.length} NCRs (${d.ncrs.filter((n) => n.status === 'open').length} without an ECR), ${d.ecrs.length} ECRs, ${d.demoScenarios.length} planted scenarios`);
console.log('');
console.log(`Vesper V4 standard cost roll-up: ${fmt(v.total)} (target $2,800,000)`);
for (const g of Object.keys(TARGET) as CostGroup[]) {
  console.log(`  ${g.padEnd(18)} ${fmt(v.groups[g]).padStart(10)}  ${pct((100 * v.groups[g]) / v.total).padStart(6)}  (target ${TARGET[g]}%)`);
}
console.log(`  labor ${fmt(laborTotal)} (${pct((100 * laborTotal) / v.total)}), material ${fmt(v.total - laborTotal)}`);
console.log(`  at design rate with group factors: ${fmt(atRate)} (target $1,800,000)`);
console.log(`Meridian M6 standard cost roll-up: ${fmt(m.total)} (target $5,000,000); shares ${pct(sharePct)} of Vesper powertrain and battery parts (${sharedPt.length} of ${ptItems.length})`);
console.log(`Provenance sourced/total: ${provRows.map(([k, c]) => `${k} ${c}`).join(', ')}`);
console.log('');
console.log(`${checks} checks, ${failures.length} failed${warnings.length ? `, ${warnings.length} warnings` : ''}`);
for (const w of warnings) console.log(`  warning: ${w}`);
for (const f of failures.slice(0, 40)) console.log(`  FAIL: ${f}`);
if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
process.exit(failures.length ? 1 : 0);
