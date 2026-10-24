// Gives Bowman's ERPNext the manufacturing BOM (MBOM): the aircraft as built, in build stations. The PLM keeps
// the engineering BOM (bowman/data `bom`); the ERP's differs only at each program's top level (bowman/data `mbom`,
// bowman/data/mbom.ts). Run after seed.ts, as Administrator. Re-runnable: each phase creates only what is missing.
//
//   node bowman/erp/seed-mbom.ts              all phases
//   node bowman/erp/seed-mbom.ts stations     only the named phases
//
// Phases:
//   items     the "Build stations" item group, the 8 station items and their Standard Cost prices
//   stations  one submitted BOM per station: its top-level children, and its share of the final-assembly labor as an operation
//   tops      a new default BOM for each aircraft that lists the stations, then the old top BOM is set inactive
//             (a top item has no parent BOM, so the "replace in parents" step of the write-back does not apply)
// Then it prints ERPNext's own total_cost of each aircraft before and after; they must be equal.
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

interface Item { code: string; name: string; itemGroup: string; costGroup: string; uom: string; rev: string; status: string; workCenter?: string; laborHours?: number; programs: string[]; standardCost: number; safetyCritical: boolean }
interface Line { parent: string; child: string; qty: number; seq: number }
interface Dataset { company: { asOf: string }; workCenters: { id: string; name: string }[]; items: Item[]; programs: { id: string; topItem: string }[]; mbom: { items: Item[]; bom: Line[] } }
const data: Dataset = JSON.parse(readFileSync(new URL("../data/bowman.json", import.meta.url), "utf8"));

const COMPANY = "Bowman Aviation";
const GROUP = "Build stations";
const INITIAL = "2025-01-15";
const UOM: Record<string, string> = { Nos: "Nos", kg: "Kg", m2: "Square Meter", L: "Litre" };
const uom = (u: string) => UOM[u] ?? u;
const env = readEnv();
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
const t0 = Date.now();
const log = (m: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${m}`);
const counts: Record<string, string> = {};

async function list(doctype: string, filters: unknown[] = [], fields: string[] = ["name"]): Promise<any[]> {
  return (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0 })).body.data;
}
async function create(doctype: string, body: Record<string, unknown>): Promise<any> {
  try { return (await erp.post(`/api/resource/${enc(doctype)}`, body)).body.data; }
  catch (e: any) { throw new Error(`creating ${doctype} ${String(body.item_code ?? body.item ?? body.item_group_name ?? "")}: ${e.message}`); }
}
const itemByCode = new Map(data.items.map((i) => [i.code, i]));
const stations = data.mbom.items;
const centerName = new Map(data.workCenters.map((w) => [w.id, w.name]));

async function phaseItems() {
  const groups = new Set((await list("Item Group")).map((g) => g.name.toLowerCase()));
  if (!groups.has(GROUP.toLowerCase())) await create("Item Group", { item_group_name: GROUP, parent_item_group: "All Item Groups", is_group: 0 });
  // A station is a grouping on the assembly line, not something the stores hold: a non-stock item (ERPNext still allows
  // a BOM on it). That also keeps it out of the baseline's stock rows and its derived in-the-field quantity.
  const have = new Map((await list("Item", [["item_code", "in", stations.map((s) => s.code)]], ["name", "is_stock_item"])).map((i) => [i.name, i.is_stock_item]));
  let made = 0;
  for (const s of stations) {
    if (have.has(s.code)) {
      if (have.get(s.code)) throw new Error(`${s.code} exists as a stock item, which ERPNext will not change once it has a BOM; delete the station BOMs and items and re-run`);
      continue;
    }
    await create("Item", {
      item_code: s.code, item_name: s.name, description: s.name, item_group: GROUP, stock_uom: uom(s.uom), is_stock_item: 0,
      include_item_in_manufacturing: 1, is_purchase_item: 0, is_sales_item: 0, disabled: 0,
      bw_rev: s.rev, bw_status: s.status, bw_cost_group: s.costGroup, bw_safety_critical: s.safetyCritical ? 1 : 0, bw_programs: s.programs.join(","),
    });
    made++;
  }
  const prices = new Set((await list("Item Price", [["price_list", "=", "Standard Cost"], ["item_code", "in", stations.map((s) => s.code)]], ["item_code"])).map((p) => p.item_code));
  let priced = 0;
  for (const s of stations) {
    if (prices.has(s.code)) continue;
    await create("Item Price", { item_code: s.code, price_list: "Standard Cost", buying: 1, currency: "USD", uom: uom(s.uom), price_list_rate: s.standardCost, valid_from: INITIAL });
    priced++;
  }
  counts["station items"] = `${stations.length} (${made} new, ${priced} prices new)`;
}

/** The current default BOM of each item, by item code. */
async function defaultBoms(): Promise<Map<string, any>> {
  const rows = await list("BOM", [["company", "=", COMPANY], ["docstatus", "=", 1], ["is_default", "=", 1], ["is_active", "=", 1]], ["name", "item", "total_cost", "raw_material_cost", "operating_cost"]);
  return new Map(rows.map((r) => [r.item, r]));
}

async function phaseStations() {
  const bomOf = await defaultBoms();
  let made = 0;
  for (const s of stations) {
    if (bomOf.has(s.code)) continue;
    const wc = centerName.get(s.workCenter!)!;
    const rows = data.mbom.bom.filter((l) => l.parent === s.code).sort((a, b) => a.seq - b.seq).map((l) => {
      const child = itemByCode.get(l.child)!;
      const row: Record<string, unknown> = { item_code: l.child, qty: l.qty, uom: uom(child.uom) };
      const sub = bomOf.get(l.child);
      if (sub) row.bom_no = sub.name;
      else if (child.laborHours !== undefined && child.laborHours > 0) throw new Error(`${l.child} is a make item with no default BOM; run seed.ts boms first`);
      return row;
    });
    const bom = await create("BOM", {
      item: s.code, quantity: 1, company: COMPANY, currency: "USD", uom: uom(s.uom), is_active: 1, is_default: 1,
      rm_cost_as_per: "Price List", buying_price_list: "Standard Cost",
      with_operations: 1, operations: [{ operation: wc, workstation: wc, time_in_mins: (s.laborHours ?? 0) * 60 }],
      bw_eco: "", bw_released_on: data.company.asOf, items: rows, docstatus: 1,
    });
    bomOf.set(s.code, bom);
    made++;
  }
  counts["station BOMs"] = `${stations.length} (${made} new)`;
}

const before = new Map<string, number>();
async function phaseTops() {
  const bomOf = await defaultBoms();
  const stationCodes = new Set(stations.map((s) => s.code));
  let swapped = 0;
  for (const p of data.programs) {
    const top = p.topItem;
    const current = bomOf.get(top);
    if (!current) throw new Error(`${top} has no default BOM`);
    const lines = (await erp.get(`/api/resource/BOM/${enc(current.name)}`)).body.data.items as { item_code: string }[];
    before.set(top, current.total_cost);
    if (lines.length && lines.every((l) => stationCodes.has(l.item_code))) continue; // already the MBOM
    const rows = data.mbom.bom.filter((l) => l.parent === top).sort((a, b) => a.seq - b.seq).map((l) => ({ item_code: l.child, qty: l.qty, uom: "Nos", bom_no: bomOf.get(l.child)!.name }));
    const fresh = await create("BOM", {
      item: top, quantity: 1, company: COMPANY, currency: "USD", uom: uom(itemByCode.get(top)!.uom), is_active: 1, is_default: 1,
      rm_cost_as_per: "Price List", buying_price_list: "Standard Cost", with_operations: 0, // the stations carry the labor
      bw_eco: "", bw_released_on: data.company.asOf, items: rows, docstatus: 1,
    });
    // Submitting the new BOM made it the default and cleared the old one's default flag; a top item has no parent
    // BOM to replace it in, so the old one can now be set inactive.
    await erp.put(`/api/resource/BOM/${enc(current.name)}`, { is_active: 0 });
    log(`  ${top}: ${current.name} (${current.total_cost.toFixed(2)}) replaced by ${fresh.name} (${fresh.total_cost.toFixed(2)})`);
    swapped++;
  }
  counts["top BOMs"] = `${data.programs.length} (${swapped} swapped to station BOMs)`;
}

const PHASES: Record<string, () => Promise<void>> = { items: phaseItems, stations: phaseStations, tops: phaseTops };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!PHASES[w]) { console.error(`unknown phase ${w}; phases: ${Object.keys(PHASES).join(" ")}`); process.exit(2); }
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
for (const p of wanted.length ? wanted : Object.keys(PHASES)) { log(`phase ${p}`); await PHASES[p](); }

// ERPNext's own cost of each aircraft, which the MBOM must not change.
let bad = 0;
const now = await defaultBoms();
for (const p of data.programs) {
  const b = now.get(p.topItem);
  const std = itemByCode.get(p.topItem)!.standardCost;
  const ok = Math.abs(b.total_cost - std) < 0.005;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.topItem} ${b.name}: total_cost ${b.total_cost.toFixed(2)} (material ${b.raw_material_cost.toFixed(2)}, operating ${b.operating_cost.toFixed(2)}), roll-up ${std}${before.has(p.topItem) ? `, before ${before.get(p.topItem)!.toFixed(2)}` : ""}`);
}
log("done");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
process.exit(bad ? 1 : 0);
