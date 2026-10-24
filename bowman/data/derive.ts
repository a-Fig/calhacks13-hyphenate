import type {
  BomLine, Item, ItemCode, PurchaseOrder, PurchaseOrderLine, RateFactor, RevEntry, Sourcing, StockRow, SupplierId,
} from './types.ts';
import { LEAD, PRICE_VOL, REQUAL_MONTHS } from './catalog-core.ts';
import type { BuyRow, Row } from './catalog-core.ts';
import { vesper } from './catalog-vesper.ts';
import { meridian } from './catalog-meridian.ts';
import { rollUp, explode } from './rollup.ts';
import { history } from './history.ts';
import { supplierConstraints } from './suppliers.ts';
import { PRICE_PATHS, KEY_ITEMS } from './pricing.ts';
import { ARCHER, INV, inv, src } from './prov.ts';

export const rows: Row[] = [...vesper, ...meridian];
const rolled = rollUp(rows);
const vesperQty = explode(rows, 'BW-0001-000');
const meridianQty = explode(rows, 'BW-M000-000');

const TODAY = '2026-10-24';
const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => (x >= 1000 ? Math.round(x) : cents(x));

// ------------------------------------------------------------------ items

const revEntries = new Map<ItemCode, RevEntry[]>();
for (const eco of [...history].sort((a, b) => a.releasedOn.localeCompare(b.releasedOn))) {
  for (const ch of eco.itemChanges) {
    if (!ch.toRev) continue;
    const list = revEntries.get(ch.item) ?? [];
    list.push({ rev: ch.toRev, date: eco.releasedOn, eco: eco.id, note: eco.title });
    revEntries.set(ch.item, list);
  }
}

export const items: Item[] = rows.map((r) => {
  const t = rolled.get(r.code)!;
  const inV = vesperQty.has(r.code);
  const inM = meridianQty.has(r.code);
  const programs: Item['programs'] = [...(inV ? (['vesper'] as const) : []), ...(inM ? (['meridian'] as const) : [])];
  const proposed = r.type === 'buy' && r.status === 'proposed';
  const first = inV ? '2025-01-15' : '2026-06-30';
  const revHistory: RevEntry[] = proposed
    ? []
    : [{ rev: 'A', date: first, note: inV ? 'Initial release with the production BOM.' : 'Initial release with the preliminary-design BOM.' }, ...(revEntries.get(r.code) ?? [])];
  return {
    code: r.code,
    name: r.name,
    itemGroup: r.itemGroup,
    costGroup: r.group,
    kind: r.kind,
    uom: r.uom,
    makeBuy: r.type,
    rev: r.rev,
    status: proposed ? 'proposed' : 'released',
    defaultSupplier: r.type === 'buy' ? r.supplier : undefined,
    workCenter: r.type === 'make' ? r.workCenter : undefined,
    laborHours: r.type === 'make' ? r.hours : undefined,
    safetyCritical: r.safety,
    programs,
    standardCost: cents(t.total),
    standardCostMaterial: cents(t.material),
    standardCostLabor: cents(t.labor),
    revHistory,
    prov: r.prov,
  } satisfies Item;
});

// ------------------------------------------------------------------ BOM

export const bom: BomLine[] = [];
for (const r of rows) {
  if (r.type !== 'make') continue;
  r.children.forEach(([child, qty], i) => bom.push({ parent: r.code, child, qty, seq: (i + 1) * 10 }));
}

// ------------------------------------------------------------------ sourcing

const LEAD_FROM_SUGGESTED_BASIS = new Set(['cells', 'magnets', 'prepreg', 'avionics']);
// Annual capacity of the supplier for the item as bought today. UH-grade capacity (a future grade) is in supplierConstraints.
const capacityByItem = new Map<ItemCode, number>([
  ['BW-3120-340', 9000], ['BW-3220-340', 9000], ['BW-M512-340', 9000], // SH grade magnet sets across all rotors
  ['BW-6110-100', 180000], // 2027 cell allocation; see CON-VANTAGE-ALLOC
  ['BW-M310-100', 24],
]);
void supplierConstraints;

function sourcingProv(r: BuyRow) {
  if (r.prov.basis === 'sourced') {
    if (r.code === 'BW-5120-210') return r.prov;
    return { ...r.prov, note: `${r.prov.note ?? ''} Supplier pairing from the source; price and lead time invented.`.trim() };
  }
  if (LEAD_FROM_SUGGESTED_BASIS.has(r.lead)) {
    return src(`${ARCHER} "Suggested basis for Bowman", lead-time table`, 'Lead-time range follows the table (itself a proposal marked invented there). Price invented.');
  }
  return INV;
}

export const sourcing: Sourcing[] = [];
for (const r of rows) {
  if (r.type !== 'buy') continue;
  const [lo, hi] = PRICE_VOL[r.vol];
  const proposed = r.status === 'proposed';
  const mk = (supplier: SupplierId, price: number, primary: boolean, allocation: number, moq: number, leadShift: number): Sourcing => ({
    item: r.code,
    supplier,
    primary,
    allocation,
    unitPrice: { p10: money(price * lo), p50: money(price), p90: money(price * hi) },
    leadTimeWeeks: { p10: LEAD[r.lead].p10 + leadShift, p50: LEAD[r.lead].p50 + leadShift, p90: LEAD[r.lead].p90 + leadShift },
    moq,
    qualified: !proposed,
    soleSource: !r.alt,
    requalMonths: r.code === 'BW-5120-210' ? 4 : REQUAL_MONTHS[r.lead],
    ...(capacityByItem.has(r.code) ? { capacityPerYear: capacityByItem.get(r.code) } : {}),
    priceValidUntil: proposed ? '2026-12-31' : '2027-06-30',
    prov: sourcingProv(r),
  });
  sourcing.push(mk(r.supplier, r.price, true, r.alt ? 1 - r.alt.share : 1, r.moq, 0));
  if (r.alt) sourcing.push(mk(r.alt.supplier, cents(r.price * r.alt.priceFactor), false, r.alt.share, Math.max(r.moq, 1) * 2, 2));
}

// ------------------------------------------------------------------ rate factors

const RATE_SRC = src(`${ARCHER} "Suggested basis for Bowman", Program A`, 'Standard cost $2.8M today and $1.8M target at rate are decided facts; the split by cost group is invented to land on that target.');
export const rateFactors: RateFactor[] = [
  { costGroup: 'avionics', atDesignRate: 0.8, prov: RATE_SRC },
  { costGroup: 'powertrain', atDesignRate: 0.6, prov: RATE_SRC },
  { costGroup: 'battery', atDesignRate: 0.5, prov: RATE_SRC },
  { costGroup: 'airframe', atDesignRate: 0.62, prov: RATE_SRC },
  { costGroup: 'actuation_thermal', atDesignRate: 0.7, prov: RATE_SRC },
  { costGroup: 'other', atDesignRate: 0.62, prov: RATE_SRC },
];

// ------------------------------------------------------------------ purchase orders

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rnd: () => number) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const addMonths = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCMonth(t.getUTCMonth() + n);
  return t.toISOString().slice(0, 10);
};

const byCode = new Map(rows.map((r) => [r.code, r]));

function pathPrice(r: BuyRow, date: string): number {
  const path = PRICE_PATHS[r.code];
  if (path) {
    let p = path[0][1];
    for (const [d, price] of path) if (d <= date) p = price;
    return p;
  }
  // Default: slow drift up to today's price. Volatile classes drift faster.
  const k = r.vol === 'volatile' ? 0.06 : r.vol === 'stable' ? 0.02 : 0.035;
  const yearsAgo = (new Date(TODAY).getTime() - new Date(date).getTime()) / (365 * 864e5);
  return r.price / (1 + k * Math.max(0, yearsAgo));
}

function useRate(date: string): number {
  if (date < '2025-03-01') return 0.3;
  if (date < '2025-09-01') return 0.4;
  if (date < '2026-03-01') return 0.5;
  if (date < '2026-07-01') return 0.8;
  return 1;
}

const GAP: Record<string, number> = { cells: 2, magnets: 3, prepreg: 2, avionics: 4, hardware: 2, machined: 2, rawsmall: 2 };

interface RawLine { r: BuyRow; line: PurchaseOrderLine; orderDate: string }
const rawLines: RawLine[] = [];

function sampleLead(r: BuyRow, rnd: () => number): number {
  const l = LEAD[r.lead];
  const mu = Math.log(l.p50);
  const sigma = (Math.log(l.p90) - Math.log(l.p10)) / (2 * 1.2816);
  return Math.max(l.p10 * 0.7, Math.exp(mu + sigma * normal(rnd)));
}

for (const code of KEY_ITEMS) {
  const r = byCode.get(code);
  if (!r || r.type !== 'buy') throw new Error(`key item ${code} missing`);
  if (code === 'BW-5120-210') continue; // hand-written below
  const rnd = mulberry(hash(code));
  const perAircraft = vesperQty.get(code) ?? 1;
  const gap = GAP[r.lead] ?? 3;
  let d = addDays('2025-02-10', Math.floor(hash(code) % 20));
  while (d <= '2026-10-12') {
    const base = perAircraft * useRate(d) * gap * 1.6;
    let qty = Math.max(r.moq, Math.ceil(base));
    if (r.moq >= 25) qty = Math.ceil(qty / r.moq) * r.moq;
    const price = cents(pathPrice(r, d) * (1 + (rnd() - 0.5) * 0.016));
    const leadWeeks = sampleLead(r, rnd);
    const required = addDays(d, Math.round(LEAD[r.lead].p50 * 7 * 1.15)); // supplier promise date: quoted lead time plus a cushion
    const received = addDays(d, Math.round(leadWeeks * 7) + Math.round((rnd() - 0.5) * 6));
    const done = received <= TODAY;
    rawLines.push({
      r, orderDate: d,
      line: { item: code, qty, unitPrice: price, requiredDate: required, ...(done ? { receivedDate: received } : {}), receivedQty: done ? qty : 0 },
    });
    d = addDays(addMonths(d, gap), Math.round((rnd() - 0.5) * 12));
  }
}

// The bracket, hand-written to match the ECO-0271 story and the ECR-0417 inventory table.
const BRACKET = 'BW-5120-210';
const bracketOrders: [string, number, number, string, string | null][] = [
  // order date, qty, price, required, received
  ['2025-02-12', 100, 175.2, '2025-04-02', '2025-04-02'],
  ['2025-05-20', 100, 175.2, '2025-07-08', '2025-07-08'],
  ['2025-08-18', 100, 175.2, '2025-10-06', '2025-10-06'],
  ['2025-11-24', 25, 201.5, '2026-01-12', '2026-01-20'],
  ['2025-12-18', 50, 188.9, '2026-02-09', '2026-02-24'],
  ['2026-02-27', 100, 186.4, '2026-04-27', '2026-04-30'],
  ['2026-05-20', 100, 186.4, '2026-07-15', '2026-07-22'],
];
for (const [od, qty, price, req, rec] of bracketOrders) {
  rawLines.push({
    r: byCode.get(BRACKET) as BuyRow, orderDate: od,
    line: { item: BRACKET, qty, unitPrice: price, requiredDate: req, ...(rec ? { receivedDate: rec } : {}), receivedQty: rec ? qty : 0 },
  });
}
// Open PO of 120: 60 finished at the supplier, 60 not started.
rawLines.push({ r: byCode.get(BRACKET) as BuyRow, orderDate: '2026-08-24', line: { item: BRACKET, qty: 60, unitPrice: 186.4, requiredDate: '2026-11-02', receivedQty: 0 } });
rawLines.push({ r: byCode.get(BRACKET) as BuyRow, orderDate: '2026-08-24', line: { item: BRACKET, qty: 60, unitPrice: 186.4, requiredDate: '2026-12-07', receivedQty: 0 } });

// Every other Vesper buy item gets one open order for about three months of use (ordered recently).
const haveHistory = new Set(rawLines.map((l) => l.line.item));
for (const r of rows) {
  if (r.type !== 'buy' || r.status === 'proposed') continue;
  if (haveHistory.has(r.code)) continue;
  const perAircraft = vesperQty.get(r.code);
  const rnd = mulberry(hash('open' + r.code));
  if (perAircraft) {
    const weeksAgo = 3 + Math.floor(rnd() * 5);
    const od = addDays(TODAY, -weeksAgo * 7);
    let qty = Math.max(r.moq, Math.ceil(perAircraft * 3));
    if (r.moq >= 25) qty = Math.ceil(qty / r.moq) * r.moq;
    const required = addDays(od, Math.round(LEAD[r.lead].p50 * 7));
    rawLines.push({ r, orderDate: od, line: { item: r.code, qty, unitPrice: r.price, requiredDate: required, receivedQty: 0 } });
  } else if (!vesperQty.has(r.code) && LEAD[r.lead].p50 >= 14) {
    // Meridian-only long-lead item: one set ordered for the first-flight article.
    const qty = Math.max(r.moq, meridianQty.get(r.code) ?? 1);
    const od = '2026-09-' + String(2 + Math.floor(rnd() * 20)).padStart(2, '0');
    rawLines.push({ r, orderDate: od, line: { item: r.code, qty, unitPrice: r.price, requiredDate: addDays(od, Math.round(LEAD[r.lead].p90 * 7)), receivedQty: 0 } });
  }
}

// Group lines into POs by supplier and order month.
export const purchaseOrders: PurchaseOrder[] = (() => {
  const groups = new Map<string, RawLine[]>();
  for (const l of rawLines) {
    const key = `${l.r.supplier}|${l.orderDate.slice(0, 7)}`;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const da = a[1].reduce((m, l) => (l.orderDate < m ? l.orderDate : m), '9999');
    const db = b[1].reduce((m, l) => (l.orderDate < m ? l.orderDate : m), '9999');
    return da.localeCompare(db) || a[0].localeCompare(b[0]);
  });
  const seq: Record<string, number> = {};
  return ordered.map(([key, ls]) => {
    const orderDate = ls.reduce((m, l) => (l.orderDate < m ? l.orderDate : m), '9999');
    const yy = orderDate.slice(2, 4);
    seq[yy] = (seq[yy] ?? 100) + 1;
    const allReceived = ls.every((l) => l.line.receivedQty >= l.line.qty);
    const status: PurchaseOrder['status'] = allReceived ? 'received' : 'open';
    return {
      id: `PO-${yy}-${String(seq[yy]).padStart(4, '0')}`,
      supplier: key.split('|')[0],
      orderDate,
      status,
      buyer: 'EMP-09',
      lines: ls.map((l) => l.line),
      prov: INV,
    } satisfies PurchaseOrder;
  });
})();

// ------------------------------------------------------------------ stock

const COVER_MONTHS: Record<string, number> = {
  cells: 3, magnets: 4, prepreg: 3, avionics: 3, tier1: 2.5, machined: 3, powersemi: 4, electronics: 3, windings: 3,
  props: 3, actuators: 3, thermal: 3, harness: 3, interior: 3, gear: 3, hardware: 6, bearings: 4, rawsmall: 4, turbogen: 0,
};
const FG_ASSEMBLIES = new Set([
  'BW-3100-000', 'BW-3200-000', 'BW-4100-000', 'BW-4200-000', 'BW-5100-000', 'BW-5200-000', 'BW-6100-000', 'BW-6120-000',
  'BW-1210-000', 'BW-1310-000', 'BW-1410-000', 'BW-1420-000',
]);

const openByItem = new Map<ItemCode, number>();
for (const po of purchaseOrders) {
  for (const l of po.lines) {
    if (l.receivedQty < l.qty) openByItem.set(l.item, (openByItem.get(l.item) ?? 0) + (l.qty - l.receivedQty));
  }
}

export const stock: StockRow[] = [];
const STOCK_PROV = inv('Per-item counts generated from usage, cover and open purchase orders; the bracket matches the ECR-0417 worked example.');
for (const r of rows) {
  if (r.kind === 'aircraft') continue;
  if (r.type === 'buy' && r.status === 'proposed') continue;
  const q = vesperQty.get(r.code) ?? 0;
  const monthlyUse = q * 1; // about one Vesper per month now
  let stores = 0;
  let wip = 0;
  let finishedGoods = 0;
  let supplierFinished = 0;
  const inField = q * 10;
  const open = openByItem.get(r.code) ?? 0;
  let onOrder = open;
  if (r.type === 'buy' && q > 0) {
    const cover = COVER_MONTHS[r.lead] ?? 3;
    stores = Math.round(monthlyUse * cover);
    wip = r.itemGroup === 'Raw material' ? Math.round(q * 2) : q * 4;
  }
  if (r.type === 'make' && FG_ASSEMBLIES.has(r.code)) finishedGoods = Math.max(1, Math.round(q * 1));
  if (r.code === BRACKET) {
    stores = 96; wip = 48; supplierFinished = 60; onOrder = 60;
  }
  stock.push({ item: r.code, stores, wip, finishedGoods, supplierFinished, onOrder, inField, uom: r.uom, monthlyUse, prov: STOCK_PROV });
}

// ------------------------------------------------------------------ supplier on-time delivery, measured from the PO history

/** Share of received lines that arrived within 7 days of the promise date, by supplier (suppliers with at least 4 lines). */
export const otdBySupplier = new Map<SupplierId, number>();
{
  const tally = new Map<SupplierId, { n: number; ok: number }>();
  for (const po of purchaseOrders) {
    for (const l of po.lines) {
      if (!l.receivedDate) continue;
      const t = tally.get(po.supplier) ?? { n: 0, ok: 0 };
      t.n++;
      if (l.receivedDate <= addDays(l.requiredDate, 7)) t.ok++;
      tally.set(po.supplier, t);
    }
  }
  for (const [s, t] of tally) if (t.n >= 4) otdBySupplier.set(s, Math.round((100 * t.ok) / t.n));
}
