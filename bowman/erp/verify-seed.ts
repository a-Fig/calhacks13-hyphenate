// Checks the seeded ERPNext as the Norn Agent user (read-only): BOM roll-up against the dataset's standard
// cost, prices, stock, purchase orders and realised lead times. Exits 1 if any check fails.
//
//   node bowman/erp/verify-seed.ts
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

const data = JSON.parse(readFileSync(new URL("../data/bowman.json", import.meta.url), "utf8"));
const env = readEnv();
const norn = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081", { token: `${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}` });
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); };
const list = async (dt: string, filters: unknown[], fields: string[]): Promise<any[]> =>
  (await norn.get(`/api/resource/${enc(dt)}`, { filters, fields, limit_page_length: 0 })).body.data;
const std = new Map<string, number>(data.items.map((i: any) => [i.code, i.standardCost]));
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// 1. Vesper V4 and Meridian M6 top-level BOMs, read back and costed by ERPNext itself.
for (const [item, label] of [["BW-0001-000", "Vesper V4"], ["BW-M000-000", "Meridian M6"]]) {
  const boms = await list("BOM", [["item", "=", item], ["docstatus", "=", 1], ["is_default", "=", 1]], ["name", "is_active", "rm_cost_as_per", "buying_price_list", "raw_material_cost", "operating_cost", "total_cost"]);
  const b = boms[0];
  check(boms.length === 1 && b.is_active === 1, `${label} has one active default submitted BOM`, b?.name);
  check(b.rm_cost_as_per === "Price List" && b.buying_price_list === "Standard Cost", `${label} BOM is costed from the Standard Cost price list`);
  check(near(b.total_cost, std.get(item)!), `${label} BOM total_cost ${b.total_cost.toFixed(2)} matches the dataset roll-up ${std.get(item)}`, `(material ${b.raw_material_cost.toFixed(2)} + operating ${b.operating_cost.toFixed(2)})`);
  const doc = (await norn.get(`/api/resource/BOM/${enc(b.name)}`)).body.data;
  const exploded = (await norn.get("/api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_items", { bom: b.name, company: "Bowman Aviation", qty: 1, fetch_exploded: 1 })).body.message;
  console.log(`     ${doc.items.length} top-level lines, ${exploded.length} distinct exploded items`);
}

// 2. Every default BOM against its item's roll-up.
const defaults = await list("BOM", [["docstatus", "=", 1], ["is_default", "=", 1]], ["name", "item", "total_cost"]);
const off = defaults.filter((b) => !near(b.total_cost, std.get(b.item)!));
check(defaults.length === 47 && off.length === 0, `all ${defaults.length} default BOMs match their standard cost`, off.slice(0, 3).map((b) => `${b.item} ${b.total_cost}`).join("; "));
const all = await list("BOM", [["docstatus", "=", 1]], ["name", "is_active", "bw_eco"]);
console.log(`     ${all.length} submitted BOM versions, ${all.filter((b) => !b.is_active).length} inactive earlier versions, ${all.filter((b) => b.bw_eco).length} tagged with their ECO`);

// 3. Counts.
const items = await list("Item", [], ["name", "disabled"]);
check(items.length === data.items.length, `${items.length} items`, `(${items.filter((i) => i.disabled).length} disabled, proposed)`);
check((await list("Supplier", [], ["name"])).length === data.suppliers.length, `${data.suppliers.length} suppliers`);
const quotes = await list("Item Price", [["price_list", "=", "Standard Buying"]], ["name"]);
check(quotes.length === data.sourcing.length, `${quotes.length} supplier prices on Standard Buying`);
const pos = await list("Purchase Order", [["docstatus", "=", 1]], ["name", "bw_po_id", "per_received", "transaction_date"]);
const openPos = pos.filter((p) => p.per_received < 100);
check(pos.length === data.purchaseOrders.length && openPos.length === data.purchaseOrders.filter((p: any) => p.status === "open").length, `${pos.length} purchase orders, ${openPos.length} open`);

// 4. Stock: every dataset quantity against Bin, and on-order against open POs.
const bins = await list("Bin", [], ["item_code", "warehouse", "actual_qty", "ordered_qty"]);
const bin = new Map(bins.map((b) => [`${b.item_code}|${b.warehouse}`, b]));
const wh: Record<string, string> = { stores: "Stores - BWA", wip: "Work In Progress - BWA", finishedGoods: "Finished Goods - BWA", supplierFinished: "At Supplier - BWA" };
let stockBad = 0, ordBad = 0;
for (const s of data.stock) {
  for (const [k, w] of Object.entries(wh)) if ((bin.get(`${s.item}|${w}`)?.actual_qty ?? 0) !== s[k]) stockBad++;
  const ordered = bins.filter((b) => b.item_code === s.item).reduce((n, b) => n + b.ordered_qty, 0);
  if (ordered !== s.onOrder + s.supplierFinished) ordBad++; // dataset: open PO qty = onOrder + supplierFinished
}
check(stockBad === 0, `Bin quantities match the dataset for ${data.stock.length} items in four warehouses`, stockBad ? `${stockBad} differ` : "");
check(ordBad === 0, "Bin ordered_qty matches the dataset's open PO quantity (onOrder + supplierFinished)", ordBad ? `${ordBad} items differ` : "");

// 5. The bracket from the worked example (ECR-0417).
const B = "BW-5120-210";
const prices = await list("Item Price", [["item_code", "=", B]], ["price_list", "supplier", "price_list_rate", "valid_from", "valid_upto", "lead_time_days", "bw_price_p10", "bw_price_p90", "bw_lead_weeks_p10", "bw_lead_weeks_p90", "bw_moq", "bw_sole_source", "bw_requal_months"]);
const cur = prices.find((p) => p.price_list === "Standard Cost" && !p.valid_upto);
const old = prices.find((p) => p.price_list === "Standard Cost" && p.valid_upto);
check(cur?.price_list_rate === 186.4 && old?.price_list_rate === 175.2, `${B} Standard Cost ${cur?.price_list_rate} since ${cur?.valid_from} (earlier ${old?.price_list_rate} until ${old?.valid_upto})`);
const quote = prices.find((p) => p.price_list === "Standard Buying");
check(quote?.supplier === "Halden Precision" && quote.lead_time_days === 63, `${B} quote: ${quote?.supplier}, ${quote?.price_list_rate} (p10 ${quote?.bw_price_p10}, p90 ${quote?.bw_price_p90}), lead time ${quote?.lead_time_days} days (p10 ${quote?.bw_lead_weeks_p10}, p90 ${quote?.bw_lead_weeks_p90} weeks), MOQ ${quote?.bw_moq}, sole source ${quote?.bw_sole_source}`);
const sb = ["Stores - BWA", "Work In Progress - BWA", "Finished Goods - BWA", "At Supplier - BWA"].map((w) => `${w.split(" - ")[0]} ${bin.get(`${B}|${w}`)?.actual_qty ?? 0}`);
check(bin.get(`${B}|Stores - BWA`)?.actual_qty === 96 && bin.get(`${B}|Work In Progress - BWA`)?.actual_qty === 48 && bin.get(`${B}|At Supplier - BWA`)?.actual_qty === 60, `${B} stock: ${sb.join(", ")}; ordered ${bins.filter((b) => b.item_code === B).reduce((n, b) => n + b.ordered_qty, 0)}`);
const open = await list("Purchase Order", [["Purchase Order Item", "item_code", "=", B], ["docstatus", "=", 1], ["per_received", "<", 100]], ["name", "bw_po_id", "supplier", "transaction_date"]);
const lines: string[] = [];
for (const p of [...new Map(open.map((o) => [o.name, o])).values()]) for (const l of (await norn.get(`/api/resource/Purchase Order/${enc(p.name)}`)).body.data.items.filter((i: any) => i.item_code === B)) lines.push(`${p.bw_po_id} ${l.qty - l.received_qty} at ${l.rate} due ${l.schedule_date}`);
check(lines.length === 2 && lines.every((l) => l.startsWith("PO-26-0144")), `${B} open POs: ${lines.join("; ")}`);
const received = await list("Purchase Receipt", [["Purchase Receipt Item", "item_code", "=", B], ["docstatus", "=", 1]], ["name", "posting_date"]);
const rl: string[] = [];
for (const pr of received) {
  const doc = (await norn.get(`/api/resource/Purchase Receipt/${enc(pr.name)}`)).body.data;
  const po = pos.find((p) => p.name === doc.items[0].purchase_order);
  if (po) rl.push(`${po.bw_po_id} ${Math.round((Date.parse(pr.posting_date) - Date.parse(po.transaction_date)) / 864e5)}d`);
}
check(received.length > 0, `${B} realised lead times (receipt date minus PO date): ${rl.join(", ")}`);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
