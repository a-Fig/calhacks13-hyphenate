// Undoes what was entered for a released ECO in Bowman's ERPNext so the demo can run again, as Administrator: the lines a
// person entered and the drafts Fern saved. Fern drafts, people submit (Tyler, 2026-10-25, reversing #71); Fern's own
// account cannot delete or cancel, so this script is for the person resetting the demo.
//
//   node bowman/erp/reset-eco.ts ECO-0319              undo it
//   node bowman/erp/reset-eco.ts ECO-0319 --dry-run    say what it would do
//
// What it undoes (everything entered for the ECO and tagged with its number in the "Released by ECO" field):
//   0. Draft BOMs (docstatus 0), Fern's or a person's: deleted.
//   1. Journal entries: drafts (Fern's or a person's) are deleted. A submitted one has posted to the ledger, so it is left and reported; cancel it
//      in ERPNext first.
//   2. BOMs: the version before the ECO's is made active and default again, the ECO's version is replaced by it in the parent
//      BOMs (ERPNext recosts the assemblies above), and the ECO's version is cancelled (after the BOM Update Logs that link it).
//   3. Item Price rows: the ECO's rows are deleted and the row they closed is reopened.
// What stays: cancelled BOMs (ERPNext keeps them, so the next release is numbered after them), cancelled BOM Update Logs,
// Version history, and deleted-document records. Then `check.ts` in the connector passes again.
//
// Needs the tunnel to the ERP and ERPNEXT_URL / ERPNEXT_ADMIN_PASSWORD in the repo-root .env (override with ENV_FILE).
// Node 24, erasable TypeScript syntax only.
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

const eco = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!eco) { console.error("usage: node bowman/erp/reset-eco.ts <ECO number> [--dry-run]"); process.exit(2); }
const dry = process.argv.includes("--dry-run");

const env = readEnv();
if (!env.ERPNEXT_ADMIN_PASSWORD) throw new Error("ERPNEXT_ADMIN_PASSWORD is not set");
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);

const COMPANY = "Bowman Aviation";
const REPLACE = "/api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom";
const say = (m: string) => console.log(`${dry ? "[dry run] " : ""}${m}`);
// A child doctype (BOM Item) must name its parent doctype, or Frappe answers with nothing useful.
const list = async (doctype: string, filters: unknown[], fields: string[], order_by?: string, parent?: string): Promise<any[]> =>
  (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0, ...(order_by ? { order_by } : {}), ...(parent ? { parent } : {}) })).body.data;
const dayBefore = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
let problems = 0;

// ---- 0. draft BOMs ----------------------------------------------------------------------------------
// A draft is not in use anywhere (only a submitted BOM can be a parent's line or an item's default), so it is just deleted.
for (const b of await list("BOM", [["bw_eco", "=", eco], ["company", "=", COMPANY], ["docstatus", "=", 0]], ["name", "item"])) {
  say(`delete draft BOM ${b.name} (${b.item})`);
  if (!dry) await erp.del(`/api/resource/BOM/${enc(b.name)}`);
}

// ---- 1. journal entries -----------------------------------------------------------------------------
for (const je of await list("Journal Entry", [["bw_eco", "=", eco]], ["name", "docstatus", "total_debit", "bw_eco_entry"])) {
  if (je.docstatus === 0) {
    say(`delete draft journal entry ${je.name} (${je.bw_eco_entry}, ${je.total_debit})`);
    if (!dry) await erp.del(`/api/resource/${enc("Journal Entry")}/${enc(je.name)}`);
  } else if (je.docstatus === 1) {
    say(`LEFT ${je.name}: it is submitted and has posted to the ledger. Cancel it in ERPNext, then run this again`);
    problems++;
  } else say(`${je.name} is already cancelled; left`);
}

// ---- 2. BOMs ----------------------------------------------------------------------------------------
async function activeParents(bom: string): Promise<string[]> {
  const refs = await list("BOM Item", [["bom_no", "=", bom], ["docstatus", "=", 1]], ["parent"], undefined, "BOM");
  if (!refs.length) return [];
  return (await list("BOM", [["name", "in", [...new Set(refs.map((r) => r.parent))]], ["is_active", "=", 1], ["docstatus", "=", 1]], ["name"])).map((b) => b.name);
}
async function waitFor(log: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const status = (await erp.get(`/api/resource/${enc("BOM Update Log")}/${enc(log)}`)).body.data.status;
    if (status === "Completed") return;
    if (status === "Failed") throw new Error(`${log} failed`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${log} did not finish in 2 minutes`);
}

// The ECO's own BOMs, newest first: a person enters the children before the parents (the package orders them so), so this undoes parents first.
const tagged = await list("BOM", [["bw_eco", "=", eco], ["company", "=", COMPANY], ["docstatus", "=", 1]], ["name", "item", "creation"], "creation desc");
for (const n of tagged) {
  const earlier = (await list("BOM", [["item", "=", n.item], ["company", "=", COMPANY], ["docstatus", "=", 1], ["name", "!=", n.name]], ["name", "creation", "is_active", "is_default", "bw_eco"], "creation desc"))
    .filter((b) => b.creation < n.creation && b.bw_eco !== eco);
  const old = earlier[0];
  if (!old) { say(`LEFT ${n.name}: ${n.item} has no earlier BOM to go back to`); problems++; continue; }
  say(`${n.item}: reactivate ${old.name} as default, replace ${n.name} with it in ${(await activeParents(n.name)).join(", ") || "no parent BOM"}, cancel ${n.name}`);
  if (dry) continue;
  await erp.put(`/api/resource/${enc("BOM")}/${enc(old.name)}`, { is_active: 1, is_default: 1 });
  if ((await activeParents(n.name)).length) {
    const res = await erp.post(REPLACE, { boms: { current_bom: n.name, new_bom: old.name } });
    const log = res.body.message?.name ?? res.body.data?.name;
    if (!log) throw new Error("ERPNext did not return a BOM Update Log");
    await waitFor(log);
    const left = await activeParents(n.name);
    if (left.length) throw new Error(`${left.join(", ")} still use ${n.name}`);
  }
  // ERPNext will not cancel a BOM that a submitted BOM Update Log still links (the release's replace, and the one above).
  for (const field of ["current_bom", "new_bom"]) {
    for (const log of await list("BOM Update Log", [[field, "=", n.name], ["docstatus", "=", 1]], ["name"])) {
      say(`  cancel ${log.name}, which links ${n.name}`);
      await erp.post("/api/method/frappe.client.cancel", { doctype: "BOM Update Log", name: log.name });
    }
  }
  await erp.post("/api/method/frappe.client.cancel", { doctype: "BOM", name: n.name });
}

// ---- 3. item prices ---------------------------------------------------------------------------------
for (const p of await list("Item Price", [["bw_eco", "=", eco]], ["name", "item_code", "price_list", "price_list_rate", "valid_from"])) {
  const before = (await list("Item Price", [["item_code", "=", p.item_code], ["price_list", "=", p.price_list], ["valid_upto", "=", dayBefore(p.valid_from)]], ["name", "price_list_rate", "valid_upto"]))
    .filter((r) => r.name !== p.name);
  say(`delete ${p.item_code} price ${p.price_list_rate} from ${p.valid_from} (${p.name})${before.length === 1 ? `; reopen ${before[0].name} (${before[0].price_list_rate})` : "; no earlier row ended the day before"}`);
  if (dry) continue;
  await erp.del(`/api/resource/${enc("Item Price")}/${enc(p.name)}`);
  if (before.length === 1) await erp.put(`/api/resource/${enc("Item Price")}/${enc(before[0].name)}`, { valid_upto: null });
  else problems++;
}

console.log(problems ? `\nFinished with ${problems} thing(s) left to do by hand (see above).` : `\n${dry ? "Nothing changed. " : ""}${eco} is ${dry ? "ready to undo" : "undone"}.`);
process.exit(problems ? 1 : 0);
