// Seed phases added after seed.ts for what the Norn connector reads beyond the first seed: the volume plan,
// the built aircraft, and the read grants those need. Kept in its own file so seed.ts (PR #51/#55) is untouched.
// Same rules as seed.ts: REST only, as Administrator, every phase looks first and creates only what is missing.
//
//   node bowman/erp/seed-planning.ts                 all phases, in order
//   node bowman/erp/seed-planning.ts schedule        only the named phases
//
// Phases:
//   grants    Norn Agent gets read on Workstation (labor rates), Master Production Schedule and Serial No.
//             The first bootstrap gave none of the three; the connector needs all of them.
//   schedule  The volume plan as one Master Production Schedule: one row per month and program, planned_qty =
//             units completed that month, delivery_date = the month's last day. Sites are summed (the checks
//             do not use them).
//   aircraft  The built aircraft as Serial Nos of the program's top item, posting_date = completion date.
//             No stock entry is posted, so no Bin changes and the reconciled quantities stay as seeded. The item
//             is not flagged Has Serial No: v16 refuses that until Stock Settings enables serial and batch
//             numbers for items, and ERPNext accepts Serial No records without the flag.
//
// Needs the tunnel open and ERPNEXT_URL / ERPNEXT_ADMIN_PASSWORD in the repo-root .env (ENV_FILE=... overrides).
// Node 24; erasable TypeScript syntax only.
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

interface Program { id: string; name: string; topItem: string }
interface Built { program: string; serial: number; completed: string; kind: string }
interface Volume { month: string; program: string; units: number }
const data: { company: { asOf: string }; programs: Program[]; volumePlan: Volume[]; builtAircraft: Built[] } =
  JSON.parse(readFileSync(new URL("../data/bowman.json", import.meta.url), "utf8"));

const COMPANY = "Bowman Aviation";
const NORN_ROLE = "Norn Agent";
const FG = "Finished Goods - BWA";
const env = readEnv();
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
const t0 = Date.now();
const log = (msg: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${msg}`);
const counts: Record<string, string> = {};
const list = async (doctype: string, filters: unknown[] = [], fields: string[] = ["name"]): Promise<any[]> =>
  (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0 })).body.data;

async function phaseGrants() {
  const pm = "/api/method/frappe.core.page.permission_manager.permission_manager";
  const done: string[] = [];
  for (const doctype of ["Workstation", "Master Production Schedule", "Serial No"]) {
    // Role Permissions Manager endpoints copy the doctype's stock permissions first; posting Custom DocPerm rows by hand would not.
    const have = await list("Custom DocPerm", [["parent", "=", doctype], ["role", "=", NORN_ROLE], ["permlevel", "=", 0]], ["name", "read"]);
    if (!have.length) await erp.post(`${pm}.add`, { parent: doctype, role: NORN_ROLE, permlevel: 0 });
    if (!have.length || !have[0].read) {
      await erp.post(`${pm}.update`, { doctype, role: NORN_ROLE, permlevel: 0, ptype: "read", value: "1" });
      done.push(doctype);
    }
  }
  counts["grants"] = done.length ? `read added on ${done.join(", ")}` : "already in place";
}

async function phaseSchedule() {
  const have = await list("Master Production Schedule", [["company", "=", COMPANY]], ["name"]);
  if (have.length) { counts["schedule"] = `already seeded (${have[0].name})`; return; }
  const top = new Map(data.programs.map((p) => [p.id, p.topItem]));
  const sums = new Map<string, number>();
  for (const v of data.volumePlan) sums.set(`${v.month}|${v.program}`, (sums.get(`${v.month}|${v.program}`) ?? 0) + v.units);
  const lastDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };
  const rows = [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([key, units]) => {
    const [month, program] = key.split("|");
    return { item_code: top.get(program)!, delivery_date: lastDay(month), planned_qty: units, warehouse: FG };
  });
  const months = rows.map((r) => r.delivery_date).sort();
  const doc = (await erp.post("/api/resource/Master Production Schedule", {
    company: COMPANY, posting_date: data.company.asOf, from_date: months[0].slice(0, 8) + "01", to_date: months[months.length - 1],
    parent_warehouse: "All Warehouses - BWA", select_items: data.programs.map((p) => ({ item_code: p.topItem })), items: rows,
  })).body.data;
  counts["schedule"] = `${doc.name}: ${rows.length} rows (${data.volumePlan.length} dataset rows summed over sites), ${months[0].slice(0, 7)} to ${months[months.length - 1].slice(0, 7)}`;
}

async function phaseAircraft() {
  const tops = data.programs.map((p) => p.topItem);
  const have = new Set((await list("Serial No", [["item_code", "in", tops]])).map((s) => s.name));
  let made = 0;
  for (const p of data.programs) {
    const mine = data.builtAircraft.filter((b) => b.program === p.id);
    if (!mine.length) continue;
    for (const b of mine) {
      const serial_no = `${p.id.toUpperCase()}-${String(b.serial).padStart(3, "0")}`;
      if (have.has(serial_no)) continue;
      await erp.post("/api/resource/Serial No", { serial_no, item_code: p.topItem, company: COMPANY, posting_date: b.completed, status: "Active" });
      made++;
    }
  }
  counts["aircraft"] = `${data.builtAircraft.length} Serial Nos (${made} new)`;
}

const PHASES: Record<string, () => Promise<void>> = { grants: phaseGrants, schedule: phaseSchedule, aircraft: phaseAircraft };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!PHASES[w]) { console.error(`unknown phase ${w}; phases: ${Object.keys(PHASES).join(" ")}`); process.exit(2); }
const run = wanted.length ? wanted : Object.keys(PHASES);
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
for (const p of run) {
  log(`phase ${p}`);
  await PHASES[p]();
}
log("done");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
