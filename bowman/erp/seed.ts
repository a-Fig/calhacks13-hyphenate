// Loads bowman/data/bowman.json into Bowman's ERPNext through the REST API, as Administrator.
// Re-runnable: every phase looks up what already exists and creates only what is missing.
//
//   node bowman/erp/seed.ts                 all phases, in order
//   node bowman/erp/seed.ts boms pos        only the named phases
//
// Phases: fields masters prices boms pos receipts stock
// Needs the tunnel to the ERP open and ERPNEXT_URL / ERPNEXT_ADMIN_PASSWORD in the repo-root .env
// (override the file with ENV_FILE=...). Node 24; erasable TypeScript syntax only. Mapping decisions
// are listed in NOTES.md.
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

// ---- the parts of bowman.json this script reads ---------------------------------------------------
interface Item { code: string; name: string; itemGroup: string; costGroup: string; kind: string; uom: string; makeBuy: "make" | "buy"; rev: string; status: string; workCenter?: string; laborHours?: number; safetyCritical: boolean; programs: string[]; standardCost: number; defaultSupplier?: string }
interface Supplier { id: string; name: string; country: string; supplies: string; singleSource: boolean; programs: string[]; paymentTerms: string; onTimeDeliveryPct: number; qualityPpm: number }
interface Quote { item: string; supplier: string; primary: boolean; allocation: number; unitPrice: { p10: number; p50: number; p90: number }; leadTimeWeeks: { p10: number; p50: number; p90: number }; moq: number; qualified: boolean; soleSource: boolean; requalMonths: number; priceValidUntil: string; capacityPerYear?: number }
interface PoLine { item: string; qty: number; unitPrice: number; requiredDate: string; receivedDate?: string; receivedQty: number }
interface Po { id: string; supplier: string; orderDate: string; status: string; buyer: string; lines: PoLine[] }
interface Stock { item: string; stores: number; wip: number; finishedGoods: number; supplierFinished: number }
interface Eco { id: string; releasedOn: string; itemChanges: { item: string; op: string; changes: { field: string; from: unknown; to: unknown }[] }[] }
interface Dataset {
  company: { asOf: string };
  workCenters: { id: string; name: string; laborRatePerHour: number }[];
  suppliers: Supplier[]; items: Item[]; bom: { parent: string; child: string; qty: number; seq: number }[];
  sourcing: Quote[]; stock: Stock[]; purchaseOrders: Po[]; history: Eco[];
}
const data: Dataset = JSON.parse(readFileSync(new URL("../data/bowman.json", import.meta.url), "utf8"));

// ---- constants ------------------------------------------------------------------------------------
const COMPANY = "Bowman Aviation";
const WH = { stores: "Stores - BWA", wip: "Work In Progress - BWA", fg: "Finished Goods - BWA", supplier: "At Supplier - BWA" };
const INITIAL = "2025-01-15"; // the production BOM's initial release (every item's revHistory starts here)
const SUPPLIER_PRICE_FROM = "2026-01-01";
const UOM: Record<string, string> = { Nos: "Nos", kg: "Kg", m2: "Square Meter", L: "Litre" };
const COUNTRY: Record<string, string> = { "USA (Utah)": "United States", "USA (Washington)": "United States", "USA (North Carolina)": "United States", "USA (Kansas)": "United States", "USA (Arizona)": "United States", "USA (Ohio)": "United States", "Canada (Quebec)": "Canada", "Mexico": "Mexico" };

const env = readEnv();
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
const t0 = Date.now();
const log = (msg: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${msg}`);
const counts: Record<string, string> = {};

async function list(doctype: string, filters: unknown[] = [], fields: string[] = ["name"]): Promise<any[]> {
  return (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0 })).body.data;
}
async function names(doctype: string, filters: unknown[] = []): Promise<Set<string>> {
  return new Set((await list(doctype, filters)).map((r) => r.name));
}
async function create(doctype: string, body: Record<string, unknown>): Promise<any> {
  try {
    return (await erp.post(`/api/resource/${enc(doctype)}`, body)).body.data;
  } catch (e: any) {
    throw new Error(`creating ${doctype} ${String(body.name ?? body.item_code ?? body.supplier_name ?? body.item ?? body.bw_po_id ?? "")}: ${e.message}`);
  }
}
async function pool<T>(rows: T[], n: number, fn: (row: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < rows.length) await fn(rows[i++]); }));
}
const dayBefore = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
const uom = (u: string) => UOM[u] ?? u;
const itemByCode = new Map(data.items.map((i) => [i.code, i]));
const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
const wcByid = new Map(data.workCenters.map((w) => [w.id, w]));

// ---- phase: custom fields -------------------------------------------------------------------------
// Dataset facts that ERPNext has no field for. Read-only for Norn by default (it has read on these doctypes).
const CUSTOM_FIELDS: [dt: string, fieldname: string, label: string, fieldtype: string][] = [
  ["Item", "bw_rev", "Revision", "Data"], ["Item", "bw_status", "Lifecycle status", "Data"], ["Item", "bw_cost_group", "Cost group", "Data"],
  ["Item", "bw_safety_critical", "Safety critical", "Check"], ["Item", "bw_programs", "Programs", "Data"],
  ["Workstation", "bw_work_center_id", "Dataset work center id", "Data"],
  ["Supplier", "bw_single_source", "Strategic single source", "Check"], ["Supplier", "bw_on_time_delivery_pct", "On-time delivery %", "Float"],
  ["Supplier", "bw_quality_ppm", "Quality (ppm)", "Float"], ["Supplier", "bw_programs", "Programs", "Data"],
  ["Item Price", "bw_price_p10", "Price p10", "Currency"], ["Item Price", "bw_price_p90", "Price p90", "Currency"],
  ["Item Price", "bw_lead_weeks_p10", "Lead time p10 (weeks)", "Float"], ["Item Price", "bw_lead_weeks_p90", "Lead time p90 (weeks)", "Float"],
  ["Item Price", "bw_moq", "Minimum order qty", "Float"], ["Item Price", "bw_qualified", "Qualified source", "Check"],
  ["Item Price", "bw_sole_source", "Sole source for this part", "Check"], ["Item Price", "bw_requal_months", "Months to requalify", "Int"],
  ["Item Price", "bw_primary", "Primary source", "Check"], ["Item Price", "bw_allocation", "Allocation", "Float"],
  ["Item Price", "bw_capacity_per_year", "Capacity per year", "Float"],
  ["BOM", "bw_eco", "Released by ECO", "Data"], ["BOM", "bw_released_on", "Released on", "Date"],
  ["Purchase Order", "bw_po_id", "Dataset PO id", "Data"], ["Purchase Order", "bw_buyer", "Buyer", "Data"],
];
async function phaseFields() {
  const have = await names("Custom Field");
  let made = 0;
  for (const [dt, fieldname, label, fieldtype] of CUSTOM_FIELDS) {
    if (have.has(`${dt}-${fieldname}`)) continue;
    await create("Custom Field", { dt, fieldname, label, fieldtype });
    made++;
  }
  counts["custom fields"] = `${CUSTOM_FIELDS.length} (${made} new)`;
}

// ---- phase: masters -------------------------------------------------------------------------------
const groupName = new Map<string, string>(); // dataset item group -> ERPNext item group
async function phaseMasters() {
  // Item groups. MariaDB compares names case-insensitively, so "Raw material" maps to the stock "Raw Material".
  const existing = await names("Item Group");
  const lower = new Map([...existing].map((n) => [n.toLowerCase(), n]));
  for (const g of [...new Set(data.items.map((i) => i.itemGroup))]) {
    let name = lower.get(g.toLowerCase());
    if (!name) {
      await create("Item Group", { item_group_name: g, parent_item_group: "All Item Groups", is_group: 0 });
      name = g;
    }
    groupName.set(g, name);
  }
  // UOMs used by the dataset must exist.
  const uoms = await names("UOM");
  for (const u of new Set(data.items.map((i) => uom(i.uom)))) if (!uoms.has(u)) await create("UOM", { uom_name: u });
  // Warehouse for stock that sits at a supplier (the dataset's supplierFinished).
  if (!(await names("Warehouse")).has(WH.supplier)) {
    await create("Warehouse", { warehouse_name: "At Supplier", company: COMPANY, parent_warehouse: "All Warehouses - BWA", is_group: 0 });
  }
  // Work centers become Workstations (hourly labor rate) plus one Operation each, so BOM operating cost carries labor.
  const ws = await names("Workstation");
  const ops = await names("Operation");
  for (const w of data.workCenters) {
    // v16 builds a Workstation's hour rate from operating-cost components; the loaded labor rate goes under Wages.
    const costs = [{ operating_component: "Wages", operating_cost: w.laborRatePerHour }];
    if (!ws.has(w.name)) await create("Workstation", { workstation_name: w.name, workstation_costs: costs, bw_work_center_id: w.id });
    else {
      const have = (await erp.get(`/api/resource/Workstation/${enc(w.name)}`)).body.data;
      if (have.hour_rate !== w.laborRatePerHour) await erp.put(`/api/resource/Workstation/${enc(w.name)}`, { workstation_costs: costs });
      if (have.bw_work_center_id !== w.id) await erp.put(`/api/resource/Workstation/${enc(w.name)}`, { bw_work_center_id: w.id });
    }
    if (!ops.has(w.name)) await create("Operation", { name: w.name, workstation: w.name });
  }
  // Suppliers.
  if (!(await names("Supplier Group")).has("Aerospace Suppliers")) {
    await create("Supplier Group", { supplier_group_name: "Aerospace Suppliers", parent_supplier_group: "All Supplier Groups", is_group: 0 });
  }
  const haveSup = await names("Supplier");
  for (const s of data.suppliers) {
    if (haveSup.has(s.name)) continue;
    await create("Supplier", {
      supplier_name: s.name, supplier_group: "Aerospace Suppliers", supplier_type: "Company",
      country: COUNTRY[s.country] ?? s.country, default_currency: "USD",
      supplier_details: `Supplies: ${s.supplies}\nPayment terms: ${s.paymentTerms}\nLocation: ${s.country}`,
      bw_single_source: s.singleSource ? 1 : 0, bw_on_time_delivery_pct: s.onTimeDeliveryPct, bw_quality_ppm: s.qualityPpm, bw_programs: s.programs.join(","),
    });
  }
  counts["item groups"] = String(groupName.size);
  counts["suppliers"] = String(data.suppliers.length);
  // Items.
  const haveItems = await names("Item");
  const primary = new Map(data.sourcing.filter((q) => q.primary).map((q) => [q.item, q]));
  let made = 0;
  await pool(data.items.filter((i) => !haveItems.has(i.code)), 4, async (i) => {
    const q = primary.get(i.code);
    const defaults: Record<string, unknown> = { company: COMPANY, default_warehouse: WH.stores };
    if (i.defaultSupplier && supplierName.get(i.defaultSupplier)) defaults.default_supplier = supplierName.get(i.defaultSupplier);
    await create("Item", {
      item_code: i.code, item_name: i.name, description: i.name, item_group: groupName.get(i.itemGroup),
      stock_uom: uom(i.uom), is_stock_item: 1, include_item_in_manufacturing: 1,
      is_purchase_item: i.makeBuy === "buy" ? 1 : 0, is_sales_item: i.kind === "aircraft" ? 1 : 0,
      disabled: i.status === "proposed" ? 1 : 0,
      ...(q ? { lead_time_days: Math.round(q.leadTimeWeeks.p50 * 7), min_order_qty: q.moq } : {}),
      item_defaults: [defaults],
      bw_rev: i.rev, bw_status: i.status, bw_cost_group: i.costGroup, bw_safety_critical: i.safetyCritical ? 1 : 0, bw_programs: i.programs.join(","),
    });
    made++;
  });
  counts["items"] = `${data.items.length} (${made} new; ${data.items.filter((i) => i.status === "proposed").length} proposed, disabled)`;
}

// ---- phase: prices --------------------------------------------------------------------------------
// ECO price changes per item, oldest first.
interface PriceStep { eco: string; releasedOn: string; from: number; to: number }
const priceSteps = new Map<string, PriceStep[]>();
for (const eco of data.history) {
  for (const c of eco.itemChanges) {
    const f = c.changes.find((x) => x.field === "unit_price_usd");
    if (!f) continue;
    const arr = priceSteps.get(c.item) ?? [];
    arr.push({ eco: eco.id, releasedOn: eco.releasedOn, from: Number(f.from), to: Number(f.to) });
    priceSteps.set(c.item, arr);
  }
}
for (const arr of priceSteps.values()) arr.sort((a, b) => a.releasedOn.localeCompare(b.releasedOn));

// BOM structure, and the earlier versions the ECO history implies. A BOM gets one version per ECO that repriced
// one of its direct children, plus the initial one; the last version is the current one. (All ten released ECOs
// are revisions that change an item's price, so BOM lines never differ between versions, only their cost.)
const childrenOf = new Map<string, { child: string; qty: number; seq: number }[]>();
for (const b of data.bom) childrenOf.set(b.parent, [...(childrenOf.get(b.parent) ?? []), { child: b.child, qty: b.qty, seq: b.seq }]);
for (const arr of childrenOf.values()) arr.sort((a, b) => a.seq - b.seq);
function ecosOf(parent: string): [eco: string, releasedOn: string][] {
  const m = new Map<string, string>();
  for (const k of childrenOf.get(parent) ?? []) for (const s of priceSteps.get(k.child) ?? []) m.set(s.eco, s.releasedOn);
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}
/** A buy item's standard cost just before the given ECO released. */
function priceBefore(item: string, eco: [string, string]): number {
  const steps = priceSteps.get(item) ?? [];
  const done = steps.filter((s) => s.releasedOn < eco[1] || (s.releasedOn === eco[1] && s.eco < eco[0]));
  return done.length ? done[done.length - 1].to : steps.length ? steps[0].from : itemByCode.get(item)!.standardCost;
}
const beforeList = (eco: string) => `Standard Cost before ${eco}`;

async function phasePrices() {
  const key = (r: any) => `${r.item_code}|${r.price_list}|${r.supplier ?? ""}|${r.valid_from}`;
  const have = new Set((await list("Item Price", [], ["item_code", "price_list", "supplier", "valid_from"])).map(key));
  const todo: Record<string, unknown>[] = [];
  // Standard Cost: every item at its rolled-up standard. Items an ECO repriced get earlier rows too.
  for (const i of data.items) {
    const steps = priceSteps.get(i.code) ?? [];
    const chainOk = steps.length > 0 && steps[steps.length - 1].to === i.standardCost;
    if (steps.length && !chainOk) log(`  note: ${i.code} standard ${i.standardCost} differs from its last ECO price; single row only`);
    const rows: { rate: number; from: string; upto?: string }[] = [];
    if (chainOk) {
      rows.push({ rate: steps[0].from, from: INITIAL, upto: dayBefore(steps[0].releasedOn) });
      steps.forEach((s, k) => rows.push({ rate: s.to, from: s.releasedOn, upto: steps[k + 1] ? dayBefore(steps[k + 1].releasedOn) : undefined }));
    } else rows.push({ rate: i.standardCost, from: INITIAL });
    for (const r of rows) {
      todo.push({ item_code: i.code, price_list: "Standard Cost", buying: 1, currency: "USD", uom: uom(i.uom), price_list_rate: r.rate, valid_from: r.from, ...(r.upto ? { valid_upto: r.upto } : {}) });
    }
  }
  // Supplier prices and lead times (p50 as the rate, the bands in custom fields).
  for (const q of data.sourcing) {
    const i = itemByCode.get(q.item)!;
    todo.push({
      item_code: q.item, price_list: "Standard Buying", buying: 1, currency: "USD", uom: uom(i.uom), supplier: supplierName.get(q.supplier),
      price_list_rate: q.unitPrice.p50, lead_time_days: Math.round(q.leadTimeWeeks.p50 * 7), valid_from: SUPPLIER_PRICE_FROM, valid_upto: q.priceValidUntil,
      bw_price_p10: q.unitPrice.p10, bw_price_p90: q.unitPrice.p90, bw_lead_weeks_p10: q.leadTimeWeeks.p10, bw_lead_weeks_p90: q.leadTimeWeeks.p90,
      bw_moq: q.moq, bw_qualified: q.qualified ? 1 : 0, bw_sole_source: q.soleSource ? 1 : 0, bw_requal_months: q.requalMonths,
      bw_primary: q.primary ? 1 : 0, bw_allocation: q.allocation, bw_capacity_per_year: q.capacityPerYear ?? 0,
    });
  }
  // Earlier BOM versions are costed from a price list that holds the prices just before their successor ECO.
  const lists = await names("Price List");
  const historic = new Map<string, Map<string, number>>();
  for (const parent of childrenOf.keys()) {
    const ecos = ecosOf(parent);
    ecos.forEach((eco, j) => {
      void j;
      const rows = historic.get(beforeList(eco[0])) ?? new Map<string, number>();
      for (const k of childrenOf.get(parent)!) if (itemByCode.get(k.child)!.makeBuy === "buy") rows.set(k.child, priceBefore(k.child, eco));
      historic.set(beforeList(eco[0]), rows);
    });
  }
  for (const [name, rows] of historic) {
    if (!lists.has(name)) await create("Price List", { price_list_name: name, currency: "USD", enabled: 1, buying: 1, selling: 0 });
    for (const [item, rate] of rows) todo.push({ item_code: item, price_list: name, buying: 1, currency: "USD", uom: uom(itemByCode.get(item)!.uom), price_list_rate: rate, valid_from: INITIAL });
  }
  const missing = todo.filter((r) => !have.has(key(r)));
  await pool(missing, 4, async (r) => { await create("Item Price", r); });
  counts["item prices"] = `${todo.length} (${missing.length} new): ${data.items.length} items on Standard Cost (+${todo.filter((r) => r.price_list === "Standard Cost").length - data.items.length} earlier ECO rows), ${data.sourcing.length} supplier quotes, ${todo.filter((r) => String(r.price_list).startsWith("Standard Cost before")).length} rows in ${historic.size} pre-ECO price lists`;
}

// ---- phase: BOMs ----------------------------------------------------------------------------------
const bomName = new Map<string, string>(); // item -> its current (default) BOM
async function phaseBoms() {
  // Children before parents.
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    for (const c of childrenOf.get(code) ?? []) visit(c.child);
    if (childrenOf.has(code)) order.push(code);
  };
  for (const code of childrenOf.keys()) visit(code);

  const existing = await list("BOM", [["company", "=", COMPANY], ["docstatus", "=", 1]], ["name", "item", "is_default", "is_active"]);
  let versionsMade = 0, bomsSkipped = 0;
  for (const code of order) {
    const item = itemByCode.get(code)!;
    const kids = childrenOf.get(code)!;
    const ecoList = ecosOf(code);
    const versions = [{ eco: "", date: INITIAL }, ...ecoList.map(([eco, date]) => ({ eco, date }))];

    const have = existing.filter((b) => b.item === code);
    if (have.length === versions.length) { bomName.set(code, (have.find((b) => b.is_default) ?? have[have.length - 1]).name); bomsSkipped++; continue; }
    if (have.length) throw new Error(`${code} has ${have.length} of ${versions.length} BOM versions; delete them and re-run`);

    const wc = item.workCenter ? wcByid.get(item.workCenter) : undefined;
    const operations = item.laborHours && wc ? [{ operation: wc.name, workstation: wc.name, time_in_mins: item.laborHours * 60 }] : [];
    const made: string[] = [];
    for (let j = 0; j < versions.length; j++) {
      const final = j === versions.length - 1;
      const rows = kids.map((k) => {
        const child = itemByCode.get(k.child)!;
        const row: Record<string, unknown> = { item_code: k.child, qty: k.qty, uom: uom(child.uom) };
        if (child.makeBuy === "make") row.bom_no = bomName.get(k.child);
        return row;
      });
      const bom = await create("BOM", {
        item: code, quantity: 1, company: COMPANY, currency: "USD", uom: uom(item.uom), is_active: 1, is_default: 1,
        rm_cost_as_per: "Price List", buying_price_list: final ? "Standard Cost" : beforeList(ecoList[j][0]),
        with_operations: operations.length ? 1 : 0, ...(operations.length ? { operations } : {}),
        bw_eco: versions[j].eco, bw_released_on: versions[j].date, items: rows, docstatus: 1,
      });
      made.push(bom.name);
      versionsMade++;
    }
    for (const older of made.slice(0, -1)) await erp.put(`/api/resource/BOM/${enc(older)}`, { is_active: 0 });
    bomName.set(code, made[made.length - 1]);
  }
  counts["BOMs"] = `${order.length} items, ${versionsMade} versions made, ${bomsSkipped} items already done`;
}

// ---- phase: purchase orders -----------------------------------------------------------------------
async function phasePos() {
  const have = new Set((await list("Purchase Order", [["company", "=", COMPANY]], ["bw_po_id"])).map((p) => p.bw_po_id));
  const todo = [...data.purchaseOrders].sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.id.localeCompare(b.id)).filter((p) => !have.has(p.id));
  let n = 0;
  for (const p of todo) {
    await create("Purchase Order", {
      supplier: supplierName.get(p.supplier), company: COMPANY, currency: "USD", transaction_date: p.orderDate,
      schedule_date: p.lines.map((l) => l.requiredDate).sort().slice(-1)[0], bw_po_id: p.id, bw_buyer: p.buyer,
      items: p.lines.map((l) => ({ item_code: l.item, qty: l.qty, rate: l.unitPrice, uom: uom(itemByCode.get(l.item)!.uom), schedule_date: l.requiredDate, warehouse: WH.stores })),
      docstatus: 1,
    });
    if (++n % 25 === 0) log(`  ${n}/${todo.length} purchase orders`);
  }
  counts["purchase orders"] = `${data.purchaseOrders.length} (${todo.length} new; ${data.purchaseOrders.filter((p) => p.status === "open").length} open), ${data.purchaseOrders.reduce((s, p) => s + p.lines.length, 0)} lines`;
}

// ---- phase: purchase receipts (the received history) ----------------------------------------------
// One Purchase Receipt per PO and receipt date, created in date order so no backdated stock repost is needed.
async function phaseReceipts() {
  const pos = await list("Purchase Order", [["company", "=", COMPANY]], ["name", "bw_po_id", "per_received"]);
  const byId = new Map(pos.map((p) => [p.bw_po_id, p]));
  const groups: { po: Po; date: string; lines: { idx: number; qty: number }[] }[] = [];
  for (const po of data.purchaseOrders) {
    const erpPo = byId.get(po.id);
    if (!erpPo) throw new Error(`${po.id} is not in ERPNext; run the pos phase first`);
    if (erpPo.per_received > 0) continue; // already received (this or an earlier run)
    const byDate = new Map<string, { idx: number; qty: number }[]>();
    po.lines.forEach((l, idx) => { if (l.receivedQty > 0 && l.receivedDate) byDate.set(l.receivedDate, [...(byDate.get(l.receivedDate) ?? []), { idx, qty: l.receivedQty }]); });
    for (const [date, lines] of byDate) groups.push({ po, date, lines });
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.po.id.localeCompare(b.po.id));
  let n = 0;
  for (const g of groups) {
    const erpPo = byId.get(g.po.id);
    const src = (await erp.get("/api/method/erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_receipt", { source_name: erpPo.name })).body.message;
    const poDoc = (await erp.get(`/api/resource/Purchase Order/${enc(erpPo.name)}`)).body.data;
    const rowName = new Map<number, string>(g.lines.map((l) => [l.idx, poDoc.items[l.idx].name]));
    const qtyOf = new Map<string, number>(g.lines.map((l) => [poDoc.items[l.idx].name, l.qty]));
    const items = src.items.filter((r: any) => rowName.size && [...rowName.values()].includes(r.purchase_order_item)).map((r: any) => ({ ...r, qty: qtyOf.get(r.purchase_order_item), received_qty: qtyOf.get(r.purchase_order_item) }));
    if (items.length !== g.lines.length) throw new Error(`${g.po.id}: expected ${g.lines.length} receipt rows, mapped ${items.length}`);
    const doc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) if (!k.startsWith("__") && k !== "name" && k !== "items" && k !== "owner" && k !== "creation" && k !== "modified" && k !== "modified_by") doc[k] = v;
    await create("Purchase Receipt", { ...doc, posting_date: g.date, posting_time: "12:00:00", set_posting_time: 1, items: items.map(clean), docstatus: 1 });
    if (++n % 25 === 0) log(`  ${n}/${groups.length} receipts`);
  }
  counts["purchase receipts"] = `${groups.length} new`;
}
function clean(row: any) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("__") && !["name", "owner", "creation", "modified", "modified_by", "parent", "parentfield", "parenttype", "idx"].includes(k)) out[k] = v;
  return out;
}

// ---- phase: stock ---------------------------------------------------------------------------------
// Items that never received a PO line get an Opening Stock entry the day before the first release. Items that
// did get a reconciliation on the as-of date, which sets the dataset's quantity and posts the difference.
async function phaseStock() {
  const done = await list("Stock Reconciliation", [["company", "=", COMPANY], ["docstatus", "=", 1]]);
  if (done.length) { counts["stock"] = `already seeded (${done.length} reconciliations)`; return; }
  const cogs = (await list("Account", [["company", "=", COMPANY], ["account_type", "=", "Cost of Goods Sold"], ["is_group", "=", 0]]))[0]?.name;
  const temp = (await list("Account", [["company", "=", COMPANY], ["account_type", "=", "Temporary"], ["is_group", "=", 0]]))[0]?.name;
  if (!cogs || !temp) throw new Error("cost of goods sold or temporary opening account not found");
  const received = new Set(data.purchaseOrders.flatMap((p) => p.lines.filter((l) => l.receivedQty > 0).map((l) => l.item)));
  const opening: any[] = [], recon: any[] = [];
  const stockRows = new Map(data.stock.map((s) => [s.item, s]));
  const add = (target: any[], item: string, warehouse: string, qty: number) => target.push({ item_code: item, warehouse, qty, valuation_rate: itemByCode.get(item)!.standardCost });
  for (const i of data.items) {
    const s = stockRows.get(i.code);
    const target = received.has(i.code) ? recon : opening;
    if (received.has(i.code)) add(recon, i.code, WH.stores, s?.stores ?? 0); // also zeroes receipts the dataset has used up
    else if (s?.stores) add(opening, i.code, WH.stores, s.stores);
    if (s?.wip) add(target, i.code, WH.wip, s.wip);
    if (s?.finishedGoods) add(target, i.code, WH.fg, s.finishedGoods);
    if (s?.supplierFinished) add(target, i.code, WH.supplier, s.supplierFinished);
  }
  const post = async (rows: any[], purpose: string, date: string, account: string) => {
    for (let k = 0; k < rows.length; k += 40) {
      await create("Stock Reconciliation", { purpose, company: COMPANY, posting_date: date, posting_time: "08:00:00", set_posting_time: 1, expense_account: account, cost_center: "Main - BWA", items: rows.slice(k, k + 40), docstatus: 1 });
    }
  };
  await post(opening, "Opening Stock", dayBefore(INITIAL), temp);
  await post(recon, "Stock Reconciliation", data.company.asOf, cogs);
  counts["stock"] = `${opening.length} opening rows, ${recon.length} reconciliation rows`;
}

// ---- main -----------------------------------------------------------------------------------------
const PHASES: Record<string, () => Promise<void>> = { fields: phaseFields, masters: phaseMasters, prices: phasePrices, boms: phaseBoms, pos: phasePos, receipts: phaseReceipts, stock: phaseStock };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!PHASES[w]) { console.error(`unknown phase ${w}; phases: ${Object.keys(PHASES).join(" ")}`); process.exit(2); }
const run = wanted.length ? wanted : Object.keys(PHASES);

await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
// Later phases need the item-group map and BOM names; rebuild them if their phase is not in this run.
if (!run.includes("masters")) for (const g of new Set(data.items.map((i) => i.itemGroup))) groupName.set(g, g);
for (const p of run) {
  log(`phase ${p}`);
  await PHASES[p]();
}
log("done");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
