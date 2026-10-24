// Supplier constraints in Bowman's ERPNext: the limits a supplier puts on what Bowman can buy (a qualification slot per quarter,
// so many cells a year). Loaded as Administrator, from `supplierConstraints` in bowman/data/bowman.json. Re-runnable: each phase
// looks first and creates only what is missing.
//
//   node bowman/erp/seed-constraints.ts                 all phases, in order
//   node bowman/erp/seed-constraints.ts records         only the named phases
//
// Phases:
//   doctype   The custom DocType "Supplier Constraint" in the Buying module (next to Supplier), named by its constraint id, and its
//             child table "Supplier Constraint Item" (one Link to Item per row). Purchase Manager can edit it; Norn Agent can read it.
//   records   One Supplier Constraint per dataset constraint. The supplier is the ERPNext supplier name ("Orrin Magnetics"), the
//             dataset's id mapped as seed.ts maps it. The bundle terms and slot cadence stay empty: the dataset states them only in
//             the description text, and Norn's supply check reads the description when they are empty.
//
// The doctype is a custom one (custom = 1), so it needs no developer mode and no app. Norn only reads it
// (norn/connectors/erpnext, option `supplierConstraints`). Needs the tunnel open and ERPNEXT_URL / ERPNEXT_ADMIN_PASSWORD in the
// repo-root .env (ENV_FILE=... overrides). Node 24; erasable TypeScript syntax only. Why it exists: NOTES.md, "Supplier constraints".
import { readFileSync } from "node:fs";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

interface Constraint {
  id: string; supplier: string; kind: "qualification_slot" | "capacity"; description: string; items: string[];
  capacityPerYear?: number; window?: { from: string; to: string };
}
const data: { suppliers: { id: string; name: string }[]; supplierConstraints: Constraint[] } =
  JSON.parse(readFileSync(new URL("../data/bowman.json", import.meta.url), "utf8"));

const PARENT = "Supplier Constraint";
const CHILD = "Supplier Constraint Item";
const MODULE = "Buying";
const NORN_ROLE = "Norn Agent";
const env = readEnv();
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
const t0 = Date.now();
const log = (msg: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${msg}`);
const counts: Record<string, string> = {};
const list = async (doctype: string, filters: unknown[] = [], fields: string[] = ["name"]): Promise<any[]> =>
  (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0 })).body.data;
// The same mapping seed.ts uses: the dataset's supplier id to the ERPNext supplier name.
const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));

const FIELDS = [
  { fieldname: "constraint_id", label: "Constraint ID", fieldtype: "Data", reqd: 1, unique: 1, in_list_view: 1 },
  { fieldname: "supplier", label: "Supplier", fieldtype: "Link", options: "Supplier", reqd: 1, in_list_view: 1, in_standard_filter: 1 },
  { fieldname: "kind", label: "Kind", fieldtype: "Select", options: "qualification_slot\ncapacity", reqd: 1, in_list_view: 1, in_standard_filter: 1,
    description: "qualification_slot: the supplier qualifies one part number per slot. capacity: units the supplier can make per year." },
  { fieldname: "items", label: "Items", fieldtype: "Table", options: CHILD, reqd: 1 },
  { fieldname: "description", label: "Description", fieldtype: "Text", description: "The terms in the supplier's words." },
  { fieldname: "section_window", label: "When it applies", fieldtype: "Section Break" },
  { fieldname: "window_from", label: "Window from", fieldtype: "Date" },
  { fieldname: "column_window", fieldtype: "Column Break" },
  { fieldname: "window_to", label: "Window to", fieldtype: "Date" },
  { fieldname: "section_capacity", label: "Capacity and slots", fieldtype: "Section Break" },
  { fieldname: "capacity_per_year", label: "Capacity per year", fieldtype: "Float", description: "In the items' unit. For a capacity constraint." },
  { fieldname: "slot_cadence_months", label: "Slot cadence (months)", fieldtype: "Int", description: "Months between qualification slots. Empty: read from the description." },
  { fieldname: "section_bundle", label: "Two part numbers together", fieldtype: "Section Break" },
  { fieldname: "bundle_within_weeks", label: "Within weeks", fieldtype: "Int", description: "A second part number qualified within this many weeks of the first earns the two terms below." },
  { fieldname: "column_bundle", fieldtype: "Column Break" },
  { fieldname: "bundle_second_qualification_discount", label: "Second qualification discount", fieldtype: "Float", description: "A fraction: 0.4 is 40% off." },
  { fieldname: "bundle_price_break", label: "Raw-material price break", fieldtype: "Float", description: "A fraction: 0.06 is 6% off." },
];
const perm = (role: string, rest: Record<string, number>) => ({ role, permlevel: 0, ...rest });

async function phaseDoctype() {
  const have = new Set((await list("DocType", [["name", "in", [PARENT, CHILD]]])).map((d) => d.name));
  const made: string[] = [];
  if (!have.has(CHILD)) {
    await erp.post("/api/resource/DocType", {
      name: CHILD, module: MODULE, custom: 1, istable: 1, editable_grid: 1,
      fields: [{ fieldname: "item_code", label: "Item", fieldtype: "Link", options: "Item", reqd: 1, in_list_view: 1 }],
    });
    made.push(CHILD);
  }
  if (!have.has(PARENT)) {
    await erp.post("/api/resource/DocType", {
      name: PARENT, module: MODULE, custom: 1, autoname: "field:constraint_id", naming_rule: "By fieldname", title_field: "constraint_id",
      sort_field: "creation", sort_order: "ASC", fields: FIELDS,
      permissions: [
        perm("System Manager", { read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 }),
        perm("Purchase Manager", { read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1 }),
        perm("Purchase User", { read: 1, report: 1 }),
        perm(NORN_ROLE, { read: 1, report: 1 }),
      ],
    });
    made.push(PARENT);
  }
  // A doctype that exists already must still hold every field and let Norn read it.
  const doc = (await erp.get(`/api/resource/DocType/${enc(PARENT)}`)).body.data;
  const missing = FIELDS.filter((f) => !doc.fields.some((x: any) => x.fieldname === f.fieldname)).map((f) => f.fieldname);
  if (missing.length) throw new Error(`${PARENT} exists but lacks fields: ${missing.join(", ")}`);
  if (!doc.permissions.some((p: any) => p.role === NORN_ROLE && p.read)) throw new Error(`${NORN_ROLE} cannot read ${PARENT}; add it in the Role Permissions Manager`);
  counts["doctype"] = made.length ? `created ${made.join(" and ")}` : "already there";
}

async function phaseRecords() {
  const have = new Set((await list(PARENT)).map((r) => r.name));
  let made = 0;
  for (const c of data.supplierConstraints) {
    if (have.has(c.id)) continue;
    const supplier = supplierName.get(c.supplier);
    if (!supplier) throw new Error(`${c.id}: dataset supplier ${c.supplier} has no name`);
    await erp.post(`/api/resource/${enc(PARENT)}`, {
      constraint_id: c.id, supplier, kind: c.kind, description: c.description, items: c.items.map((item_code) => ({ item_code })),
      ...(c.capacityPerYear !== undefined && { capacity_per_year: c.capacityPerYear }),
      ...(c.window && { window_from: c.window.from, window_to: c.window.to }),
    });
    made++;
  }
  counts["records"] = `${data.supplierConstraints.length} constraints (${made} new)`;
}

const PHASES: Record<string, () => Promise<void>> = { doctype: phaseDoctype, records: phaseRecords };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!PHASES[w]) { console.error(`unknown phase ${w}; phases: ${Object.keys(PHASES).join(" ")}`); process.exit(2); }
if (!env.ERPNEXT_ADMIN_PASSWORD) throw new Error("ERPNEXT_ADMIN_PASSWORD is not set");
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
for (const p of wanted.length ? wanted : Object.keys(PHASES)) {
  log(`phase ${p}`);
  await PHASES[p]();
}
log("done");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
