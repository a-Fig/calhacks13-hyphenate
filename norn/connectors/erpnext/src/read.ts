// readBaseline: the production baseline (the checks library's `Baseline`) read from ERPNext's REST API.
//
// One list request per doctype, all in parallel, with `fields` and no page limit. A company's own
// names (price lists, warehouses, custom fields) come from the options. See NOTES.md for the mapping.

import { createHash } from 'node:crypto';
import type {
  Baseline, BomLine, BuiltUnit, Item, ItemCode, Program, Sourcing, StockRow, SupplierConstraint, VolumeRow, WorkCenter,
} from './baseline.ts';
import { ErpnextClient } from './client.ts';
import type { ErpnextOptions, StockLocationKey, SupplierConstraintSource } from './options.ts';

/** Where a baseline part came from: ERPNext's own records, or the fallback passed in the options. */
export type PartSource = 'erpnext' | 'fallback' | 'none';

export interface ReadResult {
  baseline: Baseline;
  /** The date the baseline is as of (decides which price rows are current). */
  asOf: string;
  /** Content hash of the baseline alone (sha256, hex): equal hashes are equal baselines. Cache on this. */
  hash: string;
  meta: {
    /** ISO timestamp of the read. */
    readAt: string;
    readMs: number;
    requests: number;
    counts: Record<Exclude<keyof Baseline, 'supplierConstraints'>, number> & { supplierConstraints?: number };
    sources: { volumePlan: PartSource; builtAircraft: PartSource };
    /** Things a reader should look at: an item with no current standard cost, a program with no BOM, ... */
    warnings: string[];
  };
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Today as 'YYYY-MM-DD' in the given time zone (default: this machine's). */
export const today = (timeZone?: string) => new Date().toLocaleDateString('sv-SE', { timeZone });

/** True when a price row's validity window holds the date. Frappe omits null dates. */
export function validOn(row: { valid_from?: string; valid_upto?: string }, date: string): boolean {
  return (!row.valid_from || row.valid_from <= date) && (!row.valid_upto || row.valid_upto >= date);
}

/** JSON with object keys sorted at every depth, so equal data gives equal text. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, val]) => [k, sort(val)]))
    : x;
  return JSON.stringify(sort(v));
}
export const hashOf = (b: Baseline) => createHash('sha256').update(canonicalJson(b)).digest('hex');

/** Units of each descendant per one unit of `top`, through the BOM lines. The top item itself is left out. */
export function explodeQty(bom: BomLine[], top: ItemCode): Map<ItemCode, number> {
  const kids = new Map<ItemCode, BomLine[]>();
  for (const l of bom) kids.set(l.parent, [...(kids.get(l.parent) ?? []), l]);
  // Per-unit descendants of each item, computed once: a sub-assembly used in many places is not re-walked.
  const memo = new Map<ItemCode, Map<ItemCode, number>>();
  const below = (code: ItemCode, path: ItemCode[]): Map<ItemCode, number> => {
    const known = memo.get(code);
    if (known) return known;
    const out = new Map<ItemCode, number>();
    for (const l of kids.get(code) ?? []) {
      if (path.includes(l.child)) throw new Error(`BOM cycle: ${[...path, l.child].join(' > ')}`);
      out.set(l.child, (out.get(l.child) ?? 0) + l.qty);
      for (const [d, q] of below(l.child, [...path, l.child])) out.set(d, (out.get(d) ?? 0) + l.qty * q);
    }
    memo.set(code, out);
    return out;
  };
  return below(top, [top]);
}

export async function readBaseline(opts: ErpnextOptions): Promise<ReadResult> {
  const t0 = Date.now();
  const c = new ErpnextClient(opts);
  const asOf = opts.asOf ?? today(opts.timeZone);
  const cf = opts.customFields ?? {};
  const itemF = cf.item ?? {};
  const quoteF = cf.quote ?? {};
  const warnings: string[] = [];
  const co = ['company', '=', opts.company] as [string, string, unknown];

  const itemFields = ['name', 'item_name', 'item_group', 'disabled', 'is_stock_item', itemF.revision, itemF.status, itemF.programs].filter((f): f is string => !!f);
  const quoteFields = ['name', 'item_code', 'price_list', 'supplier', 'price_list_rate', 'lead_time_days', 'valid_from', 'valid_upto',
    quoteF.priceP10, quoteF.priceP90, quoteF.leadWeeksP10, quoteF.leadWeeksP90, quoteF.qualified, quoteF.primary, quoteF.allocation].filter((f): f is string => !!f);

  const wcF = cf.workCenter?.externalId;
  const [items, itemDefaults, boms, bomItems, bomOps, stations, prices, bins, serials, schedule, constraintRows] = await Promise.all([
    c.list('Item', { fields: itemFields }),
    c.list('Item Default', { parent: 'Item', fields: ['parent', 'company', 'default_supplier'] }),
    c.list('BOM', { filters: [co, ['docstatus', '=', 1], ['is_active', '=', 1], ['is_default', '=', 1]], fields: ['name', 'item', 'quantity'] }),
    c.list('BOM Item', { parent: 'BOM', filters: [['docstatus', '=', 1]], fields: ['parent', 'item_code', 'stock_qty', 'qty', 'idx'] }),
    c.list('BOM Operation', { parent: 'BOM', filters: [['docstatus', '=', 1]], fields: ['parent', 'workstation', 'time_in_mins', 'idx'] }),
    c.list('Workstation', { fields: wcF ? ['name', 'hour_rate', wcF] : ['name', 'hour_rate'] }),
    c.list('Item Price', { filters: [['price_list', 'in', [opts.standardCostPriceList, opts.supplierPriceList]]], fields: quoteFields }),
    c.list('Bin', { fields: ['item_code', 'warehouse', 'actual_qty', 'ordered_qty'] }),
    readSerials(c, opts),
    readSchedule(c, opts),
    opts.supplierConstraints ? readConstraintRows(c, opts.supplierConstraints) : undefined,
  ]);

  // Work center ids the company's other systems use, when the ERP holds them; otherwise the ERPNext name.
  const centerId = new Map<string, string>(stations.filter((w) => wcF && w[wcF]).map((w) => [w.name, String(w[wcF!])]));
  const wid = (name: string) => centerId.get(name) ?? name;

  // ---- items, programs, BOM -----------------------------------------------------------------
  const itemRow = new Map<ItemCode, (typeof items)[number]>(items.map((i) => [i.name, i]));
  const tops = items.filter((i) => i.item_group === opts.programItemGroup);

  const bomOf = new Map<ItemCode, { name: string; quantity: number }>();
  for (const b of boms) {
    if (bomOf.has(b.item)) warnings.push(`${b.item} has more than one active default BOM; using ${bomOf.get(b.item)!.name}`);
    else bomOf.set(b.item, { name: b.name, quantity: num(b.quantity) || 1 });
  }
  const bomByName = new Map([...bomOf].map(([item, b]) => [b.name, { item, quantity: b.quantity }]));

  const bom: BomLine[] = [];
  for (const l of bomItems) {
    const parent = bomByName.get(l.parent);
    if (!parent) continue; // a line of an inactive or superseded version
    bom.push({ parent: parent.item, child: l.item_code, qty: r6(num(l.stock_qty ?? l.qty) / parent.quantity), seq: l.idx });
  }

  // Labor: the default BOM's operations. Hours per unit; the first operation's workstation is the item's work center.
  const labor = new Map<ItemCode, { hours: number; workCenter?: string }>();
  for (const o of [...bomOps].sort((a, b) => a.idx - b.idx)) {
    const parent = bomByName.get(o.parent);
    if (!parent) continue;
    const cur = labor.get(parent.item) ?? { hours: 0 };
    cur.hours += num(o.time_in_mins) / 60 / parent.quantity;
    cur.workCenter ??= o.workstation ? wid(o.workstation) : undefined;
    labor.set(parent.item, cur);
  }

  const workCenters: WorkCenter[] = stations.map((w) => ({ id: wid(w.name), laborRatePerHour: r6(num(w.hour_rate)) }));

  // ---- prices: standard cost and supplier quotes ----------------------------------------------
  const costRow = new Map<ItemCode, (typeof prices)[number]>();
  for (const p of prices) {
    if (p.price_list !== opts.standardCostPriceList || !validOn(p, asOf)) continue;
    const cur = costRow.get(p.item_code);
    if (!cur || (p.valid_from ?? '') > (cur.valid_from ?? '')) costRow.set(p.item_code, p);
  }
  const supplierOf = new Map<ItemCode, string>();
  for (const d of itemDefaults) if (d.company === opts.company && d.default_supplier && !supplierOf.has(d.parent)) supplierOf.set(d.parent, d.default_supplier);

  const baselineItems: Item[] = items.map((i) => {
    const code: ItemCode = i.name;
    const make = bomOf.has(code);
    const cost = costRow.get(code);
    if (!cost) warnings.push(`${code} has no ${opts.standardCostPriceList} price valid on ${asOf}`);
    const status = itemF.status ? (i[itemF.status] === 'proposed' ? 'proposed' : 'released') : i.disabled ? 'proposed' : 'released';
    const lab = labor.get(code);
    const item: Item = {
      code, name: i.item_name, rev: itemF.revision ? String(i[itemF.revision] ?? '') : '', makeBuy: make ? 'make' : 'buy', status,
      standardCost: r6(num(cost?.price_list_rate)),
    };
    const sup = supplierOf.get(code);
    if (sup) item.defaultSupplier = sup;
    if (make && lab && lab.hours > 0) {
      item.laborHours = r6(lab.hours);
      if (lab.workCenter) item.workCenter = lab.workCenter;
    }
    return item;
  });

  const quoteRows = prices.filter((p) => p.price_list === opts.supplierPriceList && p.supplier && validOn(p, asOf));
  const seenItem = new Set<ItemCode>();
  const sourcing: Sourcing[] = quoteRows.map((q) => {
    const rate = num(q.price_list_rate);
    const weeks = num(q.lead_time_days) / 7;
    const first = !seenItem.has(q.item_code);
    seenItem.add(q.item_code);
    const primary = quoteF.primary ? !!q[quoteF.primary] : first;
    return {
      item: q.item_code, supplier: q.supplier, primary,
      allocation: r6(quoteF.allocation ? num(q[quoteF.allocation]) : primary ? 1 : 0),
      unitPrice: { p10: r6(quoteF.priceP10 && q[quoteF.priceP10] != null ? num(q[quoteF.priceP10]) : rate), p50: r6(rate), p90: r6(quoteF.priceP90 && q[quoteF.priceP90] != null ? num(q[quoteF.priceP90]) : rate) },
      leadTimeWeeks: { p10: r6(quoteF.leadWeeksP10 && q[quoteF.leadWeeksP10] != null ? num(q[quoteF.leadWeeksP10]) : weeks), p50: r6(weeks), p90: r6(quoteF.leadWeeksP90 && q[quoteF.leadWeeksP90] != null ? num(q[quoteF.leadWeeksP90]) : weeks) },
      qualified: quoteF.qualified ? !!q[quoteF.qualified] : true,
    };
  });

  // ---- programs: one per top item -------------------------------------------------------------
  const programs: Program[] = tops.map((t) => ({
    id: (itemF.programs ? String(t[itemF.programs] ?? '').split(',')[0].trim() : '') || t.name,
    name: opts.programName ? opts.programName(t.item_name, t.name) : t.item_name,
    topItem: t.name,
  }));
  const programOfTop = new Map(programs.map((p) => [p.topItem, p.id]));
  for (const p of programs) if (!bomOf.has(p.topItem)) warnings.push(`program ${p.id}: top item ${p.topItem} has no active default BOM`);

  // ---- built aircraft: Serial Nos of the top items, else the fallback ------------------------------
  const serialOf = opts.serialNumber ?? ((s: string) => { const m = s.match(/(\d+)\s*$/); return m ? Number(m[1]) : undefined; });
  let builtAircraft: BuiltUnit[] = [];
  for (const s of serials) {
    const program = programOfTop.get(s.item_code);
    const serial = serialOf(s.serial_no);
    if (!program || serial === undefined || !s.posting_date) { warnings.push(`Serial No ${s.name} skipped: no program, number or date`); continue; }
    builtAircraft.push({ program, serial, completed: s.posting_date });
  }
  let builtSource: PartSource = builtAircraft.length ? 'erpnext' : 'none';
  if (!builtAircraft.length && opts.fallback?.builtAircraft) { builtAircraft = opts.fallback.builtAircraft.map((b) => ({ ...b })); builtSource = 'fallback'; }
  if (builtSource === 'none') warnings.push('no built aircraft in ERPNext (Serial No on the program items) and no fallback given');

  // ---- volume plan: planned quantities of the top items in a Master Production Schedule, else the fallback
  const months = new Map<string, VolumeRow>();
  for (const r of schedule) {
    const program = programOfTop.get(r.item_code);
    if (!program || !r.delivery_date) continue;
    const key = `${r.delivery_date.slice(0, 7)}|${program}`;
    const row = months.get(key) ?? { month: r.delivery_date.slice(0, 7), program, units: 0 };
    row.units = r6(row.units + num(r.planned_qty));
    months.set(key, row);
  }
  let volumePlan = [...months.values()];
  let volumeSource: PartSource = volumePlan.length ? 'erpnext' : 'none';
  if (!volumePlan.length && opts.fallback?.volumePlan) { volumePlan = opts.fallback.volumePlan.map((v) => ({ month: v.month, program: v.program, units: v.units })); volumeSource = 'fallback'; }
  if (volumeSource === 'none') warnings.push('no volume plan in ERPNext (Master Production Schedule) and no fallback given');

  // ---- stock: bins by warehouse, on order from open POs, in field from built aircraft ---------------
  const where = opts.warehouses;
  const at = new Map<ItemCode, Record<StockLocationKey, number> & { ordered: number }>();
  for (const b of bins) {
    const row = at.get(b.item_code) ?? { stores: 0, wip: 0, finishedGoods: 0, supplierFinished: 0, ordered: 0 };
    const loc = where[b.warehouse];
    if (loc) row[loc] += num(b.actual_qty);
    row.ordered += num(b.ordered_qty);
    at.set(b.item_code, row);
  }
  const inField = new Map<ItemCode, number>();
  for (const p of programs) {
    const built = builtAircraft.filter((b) => b.program === p.id).length;
    if (!built) continue;
    for (const [code, q] of explodeQty(bom, p.topItem)) inField.set(code, (inField.get(code) ?? 0) + built * q);
  }
  const stock: StockRow[] = items.filter((i) => i.is_stock_item && !i.disabled).map((i) => {
    const b = at.get(i.name);
    const supplierFinished = b?.supplierFinished ?? 0;
    return {
      item: i.name, stores: r6(b?.stores ?? 0), wip: r6(b?.wip ?? 0), finishedGoods: r6(b?.finishedGoods ?? 0), supplierFinished: r6(supplierFinished),
      onOrder: r6(opts.supplierFinishedOnOpenOrders ? Math.max(0, (b?.ordered ?? 0) - supplierFinished) : (b?.ordered ?? 0)),
      inField: r6(inField.get(i.name) ?? 0),
    };
  });

  // ---- deterministic order, then the hash --------------------------------------------------------------
  const baseline: Baseline = {
    programs: programs.sort((a, b) => cmp(a.id, b.id)),
    workCenters: workCenters.sort((a, b) => cmp(a.id, b.id)),
    items: baselineItems.sort((a, b) => cmp(a.code, b.code)),
    bom: bom.sort((a, b) => cmp(a.parent, b.parent) || (a.seq ?? 0) - (b.seq ?? 0) || cmp(a.child, b.child)),
    sourcing: sourcing.sort((a, b) => cmp(a.item, b.item) || cmp(a.supplier, b.supplier)),
    stock: stock.sort((a, b) => cmp(a.item, b.item)),
    volumePlan: volumePlan.sort((a, b) => cmp(a.month, b.month) || cmp(a.program, b.program)),
    builtAircraft: builtAircraft.sort((a, b) => cmp(a.program, b.program) || a.serial - b.serial),
  };
  // Only a company that keeps constraints in its ERP configures them; without the setting the key is absent, so the hash is as before.
  if (opts.supplierConstraints && constraintRows) {
    const supplied = new Set(baseline.sourcing.map((s) => s.supplier));
    baseline.supplierConstraints = mapSupplierConstraints(opts.supplierConstraints, constraintRows.parents, constraintRows.items, supplied, warnings);
  }
  return {
    baseline, asOf, hash: hashOf(baseline),
    meta: {
      readAt: new Date().toISOString(), readMs: Date.now() - t0, requests: c.requests,
      counts: Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v.length])) as Record<keyof Baseline, number>,
      sources: { volumePlan: volumeSource, builtAircraft: builtSource }, warnings,
    },
  };
}

/** The planned rows of one Master Production Schedule: the named one, else the company's latest. */
async function readSchedule(c: ErpnextClient, opts: ErpnextOptions): Promise<{ item_code: string; delivery_date: string; planned_qty: number }[]> {
  let name = opts.productionSchedule;
  if (!name) {
    const [head] = await c.list('Master Production Schedule', { filters: [['company', '=', opts.company]], fields: ['name'], orderBy: 'modified desc', limit: 1 });
    name = head?.name;
  }
  if (!name) return [];
  return c.list('Master Production Schedule Item', { parent: 'Master Production Schedule', filters: [['parent', '=', name]], fields: ['item_code', 'delivery_date', 'planned_qty'] });
}

/** Serial Nos of the program top items. ERPNext leaves a Serial No's own item_group empty when it is created by API, so filter on the items. */
async function readSerials(c: ErpnextClient, opts: ErpnextOptions): Promise<{ name: string; serial_no: string; item_code: string; posting_date?: string }[]> {
  const tops = await c.list('Item', { filters: [['item_group', '=', opts.programItemGroup]], fields: ['name'] });
  if (!tops.length) return [];
  return c.list('Serial No', { filters: [['company', '=', opts.company], ['item_code', 'in', tops.map((t) => t.name)]], fields: ['name', 'serial_no', 'item_code', 'posting_date'] });
}

/** Raw rows of the constraint doctype and its items table, as ERPNext returns them. */
interface ConstraintRows { parents: Record<string, any>[]; items: Record<string, any>[] }

/** The constraint doctype and its child table of items: two list requests, GET only. */
async function readConstraintRows(c: ErpnextClient, src: SupplierConstraintSource): Promise<ConstraintRows> {
  const f = src.fields;
  const fields = ['name', f.id, f.supplier, f.kind, f.capacityPerYear, f.windowFrom, f.windowTo, f.description, f.slotCadenceMonths,
    f.bundleWithinWeeks, f.bundleSecondQualificationDiscount, f.bundlePriceBreak].filter((x): x is string => !!x);
  const [parents, items] = await Promise.all([
    c.list(src.doctype, { fields }),
    c.list(src.items.doctype, { parent: src.doctype, fields: ['parent', src.items.itemField, 'idx'] }),
  ]);
  return { parents, items };
}

/**
 * ERPNext rows to the baseline's `supplierConstraints`. Frappe leaves null fields out and stores an unset number as 0,
 * so a 0 or a missing value means "not stated". Sorted by id, items by code, so the baseline hash is stable.
 * A row with an unknown kind, or no id, supplier or items is skipped with a warning. A constraint whose supplier no sourcing
 * row names is kept, with a warning: the supply check matches a constraint to the sourcing rows by that exact string, so it
 * will find nothing to apply it to, and the warning says why.
 */
export function mapSupplierConstraints(
  src: SupplierConstraintSource, parents: Record<string, any>[], itemRows: Record<string, any>[], sourcingSuppliers: Set<string>, warnings: string[],
): SupplierConstraint[] {
  const f = src.fields;
  const itemsOf = new Map<string, ItemCode[]>();
  for (const r of itemRows) {
    const code = r[src.items.itemField];
    if (code) itemsOf.set(r.parent, [...(itemsOf.get(r.parent) ?? []), String(code)]);
  }
  const positive = (v: unknown) => { const n = num(v); return n > 0 ? r6(n) : undefined; };
  const out: SupplierConstraint[] = [];
  for (const row of parents) {
    const id = String(row[f.id] ?? '');
    const supplier = String(row[f.supplier] ?? '');
    const kind = row[f.kind];
    const items = [...new Set(itemsOf.get(row.name) ?? [])].sort(cmp);
    if (!id || !supplier || !items.length || (kind !== 'qualification_slot' && kind !== 'capacity')) {
      warnings.push(`supplier constraint ${row.name} skipped: it needs an id, a supplier, items and a kind of qualification_slot or capacity`);
      continue;
    }
    if (!sourcingSuppliers.has(supplier)) warnings.push(`supplier constraint ${id}: no sourcing row names its supplier ${supplier}`);
    const c: SupplierConstraint = { id, supplier, kind, items };
    const capacity = f.capacityPerYear ? positive(row[f.capacityPerYear]) : undefined;
    if (capacity !== undefined) c.capacityPerYear = capacity;
    const from = f.windowFrom ? row[f.windowFrom] : undefined;
    const to = f.windowTo ? row[f.windowTo] : undefined;
    if (from && to) c.window = { from: String(from), to: String(to) };
    const description = f.description ? String(row[f.description] ?? '').trim() : '';
    if (description) c.description = description;
    const cadence = f.slotCadenceMonths ? positive(row[f.slotCadenceMonths]) : undefined;
    if (cadence !== undefined) c.slotCadenceMonths = cadence;
    const weeks = f.bundleWithinWeeks ? positive(row[f.bundleWithinWeeks]) : undefined;
    if (weeks !== undefined) {
      c.bundle = { withinWeeks: weeks };
      const discount = f.bundleSecondQualificationDiscount ? positive(row[f.bundleSecondQualificationDiscount]) : undefined;
      const priceBreak = f.bundlePriceBreak ? positive(row[f.bundlePriceBreak]) : undefined;
      if (discount !== undefined) c.bundle.secondQualificationDiscount = discount;
      if (priceBreak !== undefined) c.bundle.priceBreak = priceBreak;
    }
    out.push(c);
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}
