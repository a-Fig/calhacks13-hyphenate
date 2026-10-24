// Reads the baseline from ERPNext (as the API user in the environment) and compares it with the reference
// dataset the ERP was seeded from. Prints one pass/fail line per check and the read time; exits 1 on any failure.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON norn/connectors/erpnext/check.ts --config <settings.ts> [--reference <dataset.json>]
//
// --config     a module exporting `erpnext` (ErpnextSettings) and, optionally, `erpnextCheck`:
//              { reference: path of the dataset relative to the repo root, rollups: { topItem: expected roll-up cost } }
//              optional `spot`: one item whose history reads are checked against fixed values (see Spot below).
//              optional `view`: (dataset) => dataset, applied to the reference before comparing. For a company whose ERP holds a
//              different structure from the reference (Bowman's ERP holds the manufacturing BOM, the dataset's `bom` is the
//              engineering BOM), it returns the reference as the ERP should hold it.
// --reference  overrides erpnextCheck.reference.
// The reference is JSON holding the baseline's own arrays (programs, workCenters, items, bom, sourcing, stock,
// volumePlan, builtAircraft). It may carry more fields (the checks only compare the ones the baseline has) and
// `suppliers` as {id, name}: ERPNext identifies a supplier by its name (the PLM connector maps its own supplier names to
// those), so the reference's supplier ids are mapped to names. Work centers are compared by id, so the settings
// must give the ERP's work center id field (customFields.workCenter).
// Needs ERPNEXT_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET in the environment or in ENV_FILE (default: the .env at the repo root).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Baseline, BomLine, ItemCode } from './src/baseline.ts';
import { connect, connectionFromEnv, loadEnvFile, readBaseline } from './src/index.ts';
import type { ErpnextSettings } from './src/index.ts';

/** One item's history, as the company knows it, for the history reads. */
interface Spot {
  item: ItemCode;
  /** Standard cost rows, oldest first: [rate, validFrom, validUpto?]. */
  standardCost: [number, string, string?][];
  /** Days from PO date to receipt, in receipt order. */
  leadTimeDays: number[];
  /** Open PO lines, earliest due first: [open quantity, due date]. */
  openOrders: [number, string][];
  /** An item whose BOM has several versions, and those versions oldest first: [active, total cost]. */
  bomItem: ItemCode;
  bomVersions: [boolean, number][];
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const configFile = arg('config');
if (!configFile) { console.error('usage: node check.ts --config <settings module> [--reference <dataset.json>]'); process.exit(2); }

const root = resolve(import.meta.dirname, '../../..');
const mod = await import(pathToFileURL(resolve(configFile)).href);
const settings: ErpnextSettings = mod.erpnext;
const spec: { reference?: string; rollups?: Record<ItemCode, number>; spot?: Spot; view?: (dataset: any) => any } = mod.erpnextCheck ?? {};
const refFile = arg('reference') ?? (spec.reference ? resolve(root, spec.reference) : undefined);
if (!settings || !refFile) { console.error('the config module must export `erpnext`, and a reference dataset must be given'); process.exit(2); }
const dataset = JSON.parse(readFileSync(refFile, 'utf8'));
const ref: Omit<Partial<Baseline>, 'workCenters'> & { suppliers?: { id: string; name: string }[]; workCenters?: { id: string; name?: string; laborRatePerHour: number }[] } = spec.view ? spec.view(dataset) : dataset;

loadEnvFile();
const opts = { ...settings, ...connectionFromEnv() };

// ---- read, twice: the first is the cold read the worker would pay, the second shows the hash is stable -------
const first = await readBaseline(opts);
const second = await readBaseline(opts);
const b = first.baseline;

let failed = 0;
let total = 0;
function check(ok: boolean, what: string, detail = '') {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`);
}
/** A check that passes when `diffs` is empty; shows the first few differences. */
const same = (what: string, n: number, diffs: string[]) => check(diffs.length === 0, `${what}: ${n - diffs.length} of ${n} match`, diffs.slice(0, 3).join('; '));
const near = (a: number | undefined, c: number | undefined, tol = 1e-9) => Math.abs((a ?? 0) - (c ?? 0)) <= tol;

const supplierName = new Map((ref.suppliers ?? []).map((s) => [s.id, s.name]));
const sup = (id?: string) => (id === undefined ? undefined : supplierName.get(id) ?? id);
const wc = (id?: string) => id;

// ---- counts ---------------------------------------------------------------------------------------
const monthKey = (r: { month: string; program: string }) => `${r.month}|${r.program}`;
const refPlan = new Map<string, number>();
for (const r of ref.volumePlan ?? []) refPlan.set(monthKey(r), (refPlan.get(monthKey(r)) ?? 0) + r.units); // sites summed
check(b.programs.length === (ref.programs?.length ?? 0), `programs: ${b.programs.length}`, b.programs.map((p) => `${p.id}=${p.topItem}`).join(', '));
check(b.workCenters.length === (ref.workCenters?.length ?? 0), `work centers: ${b.workCenters.length}`);
check(b.items.length === (ref.items?.length ?? 0), `items: ${b.items.length}`);
check(b.bom.length === (ref.bom?.length ?? 0), `BOM lines: ${b.bom.length}`);
check(b.sourcing.length === (ref.sourcing?.length ?? 0), `sourcing rows: ${b.sourcing.length}`);
check(b.volumePlan.length === refPlan.size, `volume plan months x programs: ${b.volumePlan.length}`, `(${ref.volumePlan?.length} dataset rows, summed over sites)`);
check(b.builtAircraft.length === (ref.builtAircraft?.length ?? 0), `built aircraft: ${b.builtAircraft.length}`);
const refStockItems = new Set((ref.stock ?? []).map((s) => s.item));
check(b.stock.filter((s) => refStockItems.has(s.item)).length === refStockItems.size, `stock rows: ${refStockItems.size} reference rows present`, `(${b.stock.length - refStockItems.size} more, items the reference holds no stock row for)`);

// ---- field by field -------------------------------------------------------------------------------
const items = new Map(b.items.map((i) => [i.code, i]));
{
  const diffs: string[] = [];
  for (const r of ref.items ?? []) {
    const i = items.get(r.code);
    if (!i) { diffs.push(`${r.code} missing`); continue; }
    const bad = [
      i.name !== r.name && 'name', i.rev !== r.rev && 'rev', i.makeBuy !== r.makeBuy && 'makeBuy', i.status !== r.status && 'status',
      !near(i.standardCost, r.standardCost) && `standardCost ${i.standardCost} vs ${r.standardCost}`,
      i.defaultSupplier !== sup(r.defaultSupplier) && 'defaultSupplier', !near(i.laborHours, r.laborHours) && 'laborHours', i.workCenter !== wc(r.workCenter) && 'workCenter',
    ].filter(Boolean);
    if (bad.length) diffs.push(`${r.code} ${bad.join(', ')}`);
  }
  same('items (name, rev, make/buy, status, standard cost, supplier, labor)', ref.items?.length ?? 0, diffs);
}
{
  const diffs: string[] = [];
  const have = new Map(b.workCenters.map((w) => [w.id, w.laborRatePerHour]));
  for (const w of ref.workCenters ?? []) if (!near(have.get(wc(w.id)!), w.laborRatePerHour)) diffs.push(`${w.id} ${have.get(wc(w.id)!)} vs ${w.laborRatePerHour}`);
  same('work center labor rates', ref.workCenters?.length ?? 0, diffs);
}
{
  const key = (l: BomLine) => `${l.parent}>${l.child}`;
  const have = new Map(b.bom.map((l) => [key(l), l.qty]));
  const diffs = (ref.bom ?? []).filter((l) => !near(have.get(key(l)), l.qty)).map((l) => `${key(l)} ${have.get(key(l))} vs ${l.qty}`);
  same('BOM lines (parent, child, quantity)', ref.bom?.length ?? 0, diffs);
}
{
  const have = new Map(b.sourcing.map((s) => [`${s.item}|${s.supplier}`, s]));
  const diffs: string[] = [];
  for (const r of ref.sourcing ?? []) {
    const s = have.get(`${r.item}|${sup(r.supplier)}`);
    if (!s) { diffs.push(`${r.item}/${r.supplier} missing`); continue; }
    const bad = [
      s.primary !== r.primary && 'primary', s.qualified !== r.qualified && 'qualified', !near(s.allocation, r.allocation) && 'allocation',
      ...(['p10', 'p50', 'p90'] as const).flatMap((q) => [!near(s.unitPrice[q], r.unitPrice[q]) && `price ${q}`, !near(s.leadTimeWeeks[q], r.leadTimeWeeks[q]) && `weeks ${q}`]),
    ].filter(Boolean);
    if (bad.length) diffs.push(`${r.item}/${r.supplier} ${bad.join(', ')}`);
  }
  same('sourcing price and lead-time p10/p50/p90', ref.sourcing?.length ?? 0, diffs);
}
{
  const have = new Map(b.stock.map((s) => [s.item, s]));
  const loc = ['stores', 'wip', 'finishedGoods', 'supplierFinished', 'onOrder', 'inField'] as const;
  const diffs: string[] = [];
  for (const r of ref.stock ?? []) {
    const s = have.get(r.item);
    const bad = loc.filter((k) => !s || !near(s[k], r[k]));
    if (bad.length) diffs.push(`${r.item} ${bad.map((k) => `${k} ${s?.[k]} vs ${r[k]}`).join(', ')}`);
  }
  same('stock per location (stores, WIP, finished goods, at supplier, on order, in field)', ref.stock?.length ?? 0, diffs);
}
{
  const have = new Map(b.volumePlan.map((r) => [monthKey(r), r.units]));
  const diffs = [...refPlan].filter(([k, u]) => !near(have.get(k), u)).map(([k, u]) => `${k} ${have.get(k)} vs ${u}`);
  same('volume plan units per month and program', refPlan.size, diffs);
}
{
  const programId = new Set(b.programs.map((p) => p.id));
  const have = new Map(b.builtAircraft.map((u) => [`${u.program}|${u.serial}`, u.completed]));
  const diffs = (ref.builtAircraft ?? []).filter((u) => have.get(`${u.program}|${u.serial}`) !== u.completed).map((u) => `${u.program} #${u.serial}`);
  same('built aircraft serial and completion date', ref.builtAircraft?.length ?? 0, diffs);
  check((ref.programs ?? []).every((p) => programId.has(p.id) && b.programs.find((q) => q.id === p.id)?.topItem === p.topItem), 'program ids and top items', b.programs.map((p) => p.name).join(', '));
}

// ---- roll-up by a simple BOM explode: leaves at standard cost, make items add labor hours x rate --------------
const kids = new Map<ItemCode, BomLine[]>();
for (const l of b.bom) kids.set(l.parent, [...(kids.get(l.parent) ?? []), l]);
const rate = new Map(b.workCenters.map((w) => [w.id, w.laborRatePerHour]));
const memo = new Map<ItemCode, number>();
function rollup(code: ItemCode): number {
  const known = memo.get(code);
  if (known !== undefined) return known;
  const i = items.get(code)!;
  const own = i.makeBuy === 'make' ? (i.laborHours ?? 0) * (rate.get(i.workCenter ?? '') ?? 0) : i.standardCost;
  const total = own + (kids.get(code) ?? []).reduce((s, l) => s + l.qty * rollup(l.child), 0);
  memo.set(code, total);
  return total;
}
for (const p of b.programs) {
  const want = spec.rollups?.[p.topItem];
  const got = rollup(p.topItem);
  if (want !== undefined) check(near(got, want, 0.005), `${p.name} roll-up ${got.toFixed(2)}`, `(expected ${want.toFixed(2)})`);
  else console.log(`info ${p.name} roll-up ${got.toFixed(2)} (no expected value given)`);
}
{
  const make = b.items.filter((i) => i.makeBuy === 'make' && i.status === 'released');
  const off = make.filter((i) => Math.abs(rollup(i.code) - i.standardCost) > 1);
  same('every make item: BOM explode within $1 of its standard cost', make.length, off.map((i) => `${i.code} ${rollup(i.code).toFixed(2)} vs ${i.standardCost}`));
}

// ---- history reads, for one item ------------------------------------------------------------------------
if (spec.spot) {
  const sp = spec.spot;
  const erp = connect(opts);
  const t0 = Date.now();
  const [prices, lead, open, versions] = await Promise.all([erp.priceHistory(sp.item), erp.realisedLeadTimes(sp.item), erp.openOrders(sp.item), erp.bomVersions(sp.bomItem)]);
  const cited = (rows: { ref?: unknown; po?: unknown; bom?: unknown }[]) => rows.every((r) => [r.ref ?? r.po ?? r.bom].every((d) => !!(d as { doctype?: string; name?: string })?.doctype && !!(d as { name?: string })?.name));
  check(prices.length === sp.standardCost.length && sp.standardCost.every(([rate, from, upto], k) => near(prices[k]?.rate, rate, 0.005) && prices[k]?.validFrom === from && prices[k]?.validUpto === upto),
    `priceHistory(${sp.item}): ${prices.map((p) => `${p.rate} from ${p.validFrom}`).join(', ')}`);
  check(JSON.stringify(lead.map((l) => l.days)) === JSON.stringify(sp.leadTimeDays), `realisedLeadTimes(${sp.item}): ${lead.map((l) => l.days).join(', ')} days`);
  check(JSON.stringify(open.map((o) => [o.openQty, o.dueOn])) === JSON.stringify(sp.openOrders), `openOrders(${sp.item}): ${open.map((o) => `${o.openQty} due ${o.dueOn} on ${o.poLabel ?? o.po.name}`).join('; ')}`);
  check(JSON.stringify(versions.map((v) => [v.active, v.totalCost])) === JSON.stringify(sp.bomVersions), `bomVersions(${sp.bomItem}): ${versions.map((v) => `${v.bom.name} ${v.active ? 'active' : 'inactive'} ${v.totalCost}`).join(', ')}`);
  check(cited(prices) && cited(lead) && cited(open) && cited(versions), `every history row names its source document (doctype and name); four reads took ${Date.now() - t0} ms`);
}

// ---- the contract: parts came from ERPNext, the hash is stable, the read is fast ------------------------------------
check(first.meta.sources.volumePlan === 'erpnext' && first.meta.sources.builtAircraft === 'erpnext', `volume plan and built aircraft read from ERPNext`, JSON.stringify(first.meta.sources));
check(first.meta.warnings.length === 0, 'no read warnings', first.meta.warnings.slice(0, 3).join('; '));
check(first.hash === second.hash, `hash stable across two reads: ${first.hash.slice(0, 16)}`);
check(first.meta.readMs < 5000, `read time ${(first.meta.readMs / 1000).toFixed(2)} s for ${first.meta.requests} requests (second read ${(second.meta.readMs / 1000).toFixed(2)} s), asOf ${first.asOf}`);

console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
process.exit(failed ? 1 : 0);
