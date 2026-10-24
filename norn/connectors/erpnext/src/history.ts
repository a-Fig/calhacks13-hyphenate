// History reads for agents and checks: what an item cost, how long its orders took, what is on order,
// and how its BOM changed. Thin on purpose: each result row says which ERPNext document it came from
// (`ref`), so Norn can cite it. Dates are ISO 'YYYY-MM-DD'.

import type { ItemCode } from './baseline.ts';
import { ErpnextClient } from './client.ts';
import type { ErpnextOptions } from './options.ts';

/** The ERPNext document a row comes from. */
export interface DocRef {
  doctype: string;
  name: string;
}

export interface PricePoint {
  rate: number;
  validFrom?: string;
  /** Absent: still open. */
  validUpto?: string;
  supplier?: string;
  ref: DocRef;
}

export interface LeadTime {
  supplier: string;
  orderedOn: string;
  receivedOn: string;
  /** Receipt date minus PO date. */
  days: number;
  qty: number;
  po: DocRef;
  /** The company's own PO number, when `customFields.purchaseOrder.externalId` is set. */
  poLabel?: string;
  receipt: DocRef;
}

export interface OpenOrder {
  supplier: string;
  orderedOn: string;
  /** The line's required date. */
  dueOn?: string;
  qty: number;
  receivedQty: number;
  openQty: number;
  rate: number;
  po: DocRef;
  poLabel?: string;
  /** The PO line. */
  line: DocRef;
}

export interface BomVersion {
  bom: DocRef;
  active: boolean;
  default: boolean;
  /** Release date field if the company has one, else the creation date. */
  releasedOn: string;
  changeOrder?: string;
  rawMaterialCost: number;
  operatingCost: number;
  totalCost: number;
  /** The price list the version was costed from. */
  costedFrom?: string;
  lines: { child: ItemCode; qty: number }[];
}

const num = (v: unknown) => Number(v) || 0;
const day = (s: unknown) => String(s).slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** Item Price rows of one price list (default: the standard cost list) for an item, oldest first. */
export async function priceHistory(opts: ErpnextOptions, item: ItemCode, priceList = opts.standardCostPriceList): Promise<PricePoint[]> {
  const c = new ErpnextClient(opts);
  const rows = await c.list('Item Price', {
    filters: [['item_code', '=', item], ['price_list', '=', priceList]],
    fields: ['name', 'price_list_rate', 'valid_from', 'valid_upto', 'supplier'], orderBy: 'valid_from asc',
  });
  return rows.map((r) => ({
    rate: num(r.price_list_rate), ...(r.valid_from && { validFrom: day(r.valid_from) }), ...(r.valid_upto && { validUpto: day(r.valid_upto) }),
    ...(r.supplier && { supplier: r.supplier }), ref: { doctype: 'Item Price', name: r.name },
  }));
}

/** One row per received PO line and receipt date: the days from order to receipt. Oldest receipt first. */
export async function realisedLeadTimes(opts: ErpnextOptions, item: ItemCode): Promise<LeadTime[]> {
  const c = new ErpnextClient(opts);
  const ext = opts.customFields?.purchaseOrder?.externalId;
  const lines = await c.list('Purchase Receipt Item', {
    parent: 'Purchase Receipt', filters: [['item_code', '=', item], ['docstatus', '=', 1], ['purchase_order', '!=', '']],
    fields: ['parent', 'purchase_order', 'qty'],
  });
  if (!lines.length) return [];
  const [receipts, orders] = await Promise.all([
    c.list('Purchase Receipt', { filters: [['name', 'in', uniq(lines.map((l) => l.parent))]], fields: ['name', 'posting_date'] }),
    c.list('Purchase Order', { filters: [['name', 'in', uniq(lines.map((l) => l.purchase_order))]], fields: ['name', 'supplier', 'transaction_date', ...(ext ? [ext] : [])] }),
  ]);
  const receipt = new Map(receipts.map((r) => [r.name, r]));
  const order = new Map(orders.map((o) => [o.name, o]));
  return lines.flatMap((l) => {
    const r = receipt.get(l.parent);
    const o = order.get(l.purchase_order);
    if (!r || !o) return [];
    return [{
      supplier: o.supplier, orderedOn: day(o.transaction_date), receivedOn: day(r.posting_date), days: daysBetween(day(o.transaction_date), day(r.posting_date)),
      qty: num(l.qty), po: { doctype: 'Purchase Order', name: o.name }, ...(ext && o[ext] && { poLabel: String(o[ext]) }), receipt: { doctype: 'Purchase Receipt', name: r.name },
    }];
  }).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.po.name.localeCompare(b.po.name));
}

/** Submitted PO lines for the item with quantity still to receive, on POs that are not closed. Earliest due first. */
export async function openOrders(opts: ErpnextOptions, item: ItemCode): Promise<OpenOrder[]> {
  const c = new ErpnextClient(opts);
  const ext = opts.customFields?.purchaseOrder?.externalId;
  const lines = await c.list('Purchase Order Item', {
    parent: 'Purchase Order', filters: [['item_code', '=', item], ['docstatus', '=', 1]],
    fields: ['name', 'parent', 'qty', 'received_qty', 'rate', 'schedule_date'],
  });
  const open = lines.filter((l) => num(l.qty) > num(l.received_qty));
  if (!open.length) return [];
  const orders = await c.list('Purchase Order', {
    filters: [['name', 'in', uniq(open.map((l) => l.parent))], ['status', 'not in', ['Closed', 'Cancelled', 'Completed']]],
    fields: ['name', 'supplier', 'transaction_date', ...(ext ? [ext] : [])],
  });
  const order = new Map(orders.map((o) => [o.name, o]));
  return open.flatMap((l) => {
    const o = order.get(l.parent);
    if (!o) return [];
    return [{
      supplier: o.supplier, orderedOn: day(o.transaction_date), ...(l.schedule_date && { dueOn: day(l.schedule_date) }), qty: num(l.qty), receivedQty: num(l.received_qty),
      openQty: num(l.qty) - num(l.received_qty), rate: num(l.rate), po: { doctype: 'Purchase Order', name: o.name }, ...(ext && o[ext] && { poLabel: String(o[ext]) }),
      line: { doctype: 'Purchase Order Item', name: l.name },
    }];
  }).sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.po.name.localeCompare(b.po.name));
}

/** Every submitted BOM version of the item with its lines, oldest release first. */
export async function bomVersions(opts: ErpnextOptions, item: ItemCode): Promise<BomVersion[]> {
  const c = new ErpnextClient(opts);
  const f = opts.customFields?.bom ?? {};
  const boms = await c.list('BOM', {
    filters: [['item', '=', item], ['company', '=', opts.company], ['docstatus', '=', 1]],
    fields: ['name', 'is_active', 'is_default', 'creation', 'quantity', 'raw_material_cost', 'operating_cost', 'total_cost', 'buying_price_list', ...[f.changeOrder, f.releasedOn].filter((x): x is string => !!x)],
  });
  if (!boms.length) return [];
  const lines = await c.list('BOM Item', { parent: 'BOM', filters: [['parent', 'in', boms.map((b) => b.name)], ['docstatus', '=', 1]], fields: ['parent', 'item_code', 'stock_qty', 'idx'] });
  return boms.map((b) => {
    const q = num(b.quantity) || 1;
    return {
      bom: { doctype: 'BOM', name: b.name }, active: !!b.is_active, default: !!b.is_default,
      releasedOn: day((f.releasedOn && b[f.releasedOn]) || b.creation), ...(f.changeOrder && b[f.changeOrder] && { changeOrder: String(b[f.changeOrder]) }),
      rawMaterialCost: num(b.raw_material_cost), operatingCost: num(b.operating_cost), totalCost: num(b.total_cost), ...(b.buying_price_list && { costedFrom: b.buying_price_list }),
      lines: lines.filter((l) => l.parent === b.name).sort((x, y) => x.idx - y.idx).map((l) => ({ child: l.item_code, qty: num(l.stock_qty) / q })),
    };
  }).sort((a, b) => a.releasedOn.localeCompare(b.releasedOn) || a.bom.name.localeCompare(b.bom.name));
}
