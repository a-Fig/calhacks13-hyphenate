// One-time (idempotent) setup of Bowman's ERPNext over REST: company, fiscal years, item groups,
// the Standard Cost price list, the Norn Agent role and permissions, and the Norn API user.
//
//   node bowman/erp/bootstrap.mjs            (tunnel to 127.0.0.1:8081 must be open; see NOTES.md)
//
// Reads ERPNEXT_URL and ERPNEXT_ADMIN_PASSWORD from the repo-root .env (override: ENV_FILE=...).
// Writes ERPNEXT_API_KEY and ERPNEXT_API_SECRET to the same file. Prints no secret.
import { Erp, enc, readEnv, setEnv } from "./erp.mjs";

const env = readEnv();
const base = env.ERPNEXT_URL || "http://127.0.0.1:8081";
if (!env.ERPNEXT_ADMIN_PASSWORD) throw new Error("ERPNEXT_ADMIN_PASSWORD is empty in .env");

const COMPANY = "Bowman Aviation";
const ABBR = "BWA";
const NORN_USER = "norn@bowman.example";
const NORN_ROLE = "Norn Agent";

// What the Norn Agent role may do. Keep in step with NOTES.md.
export const GRANTS = {
  Item: ["read"],
  BOM: ["read", "write", "create", "submit"],
  "Item Price": ["read", "write", "create"],
  Supplier: ["read"],
  "Supplier Quotation": ["read"],
  "Purchase Order": ["read"],
  Bin: ["read"],
  "Stock Ledger Entry": ["read"],
  "GL Entry": ["read"],
  "Journal Entry": ["read", "create"], // draft only: no write, submit, cancel or amend
  Version: ["read"],
  Company: ["read"],
  Warehouse: ["read"],
  "Price List": ["read"],
  // Beyond the list Tyler gave. Both were needed by calls verify.mjs makes:
  "BOM Update Log": ["read", "create", "submit"], // enqueue_replace_bom and enqueue_update_cost create and submit one
  Account: ["read"], // to pick accounts for a draft Journal Entry
  "Purchase Receipt": ["read"], // receipt date minus PO date is the realised lead time (research section 5)
};

const log = (...a) => console.log(...a);
const erp = new Erp(base);

async function exists(doctype, name) {
  const r = await erp.get(`/api/resource/${enc(doctype)}/${enc(name)}`, undefined, { allow: true });
  return r.status === 200;
}
async function ensure(doctype, name, doc) {
  if (await exists(doctype, name)) return log(`  ${doctype} "${name}": exists`);
  await erp.post(`/api/resource/${enc(doctype)}`, { doctype, ...doc });
  log(`  ${doctype} "${name}": created`);
}

async function main() {
  // Wait for the site.
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${base}/api/method/ping`);
      if (r.ok) break;
    } catch {}
    if (i > 30) throw new Error(`no answer from ${base}; is the tunnel open?`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);

  // 1. Company through the setup wizard (also creates the 2026 fiscal year, the US chart of
  //    accounts, the Stores / Work In Progress / Finished Goods warehouses and default price lists).
  if (!(await exists("Company", COMPANY))) {
    log("Running the setup wizard...");
    const args = {
      language: "English",
      country: "United States",
      timezone: "America/Los_Angeles",
      currency: "USD",
      company_name: COMPANY,
      company_abbr: ABBR,
      chart_of_accounts: process.env.BOWMAN_CHART ?? "United States - Chart of Accounts",
      fy_start_date: "2026-01-01",
      fy_end_date: "2026-12-31",
    };
    const r = await erp.post("/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete", {
      args: JSON.stringify(args),
    });
    log("  wizard:", JSON.stringify(r.body.message));
    for (let i = 0; i < 60 && !(await exists("Company", COMPANY)); i++) await new Promise((r) => setTimeout(r, 5000));
  }
  log(`Company "${COMPANY}": ${(await exists("Company", COMPANY)) ? "present" : "MISSING"}`);

  // 2. Neighbouring fiscal years, so historical and next-year documents can be posted.
  for (const y of [2025, 2027]) {
    await ensure("Fiscal Year", String(y), {
      year: String(y),
      year_start_date: `${y}-01-01`,
      year_end_date: `${y}-12-31`,
    });
  }

  // 3. Item groups for aircraft parts ("Raw Material" ships with ERPNext).
  for (const g of ["Aircraft", "Assemblies", "Purchased Parts"]) {
    await ensure("Item Group", g, { item_group_name: g, parent_item_group: "All Item Groups", is_group: 0 });
  }

  // 4. Standard costs live in a buying price list (v16 has no Standard Cost valuation method).
  await ensure("Price List", "Standard Cost", {
    price_list_name: "Standard Cost",
    currency: "USD",
    enabled: 1,
    buying: 1,
    selling: 0,
  });

  // 5. Role and permissions. The Role Permissions Manager endpoints copy the stock permissions
  //    into Custom DocPerm before adding ours; inserting Custom DocPerm rows by hand would
  //    drop every stock role's access to that doctype.
  await ensure("Role", NORN_ROLE, { role_name: NORN_ROLE, desk_access: 1, is_custom: 1 });
  const pm = "/api/method/frappe.core.page.permission_manager.permission_manager";
  for (const [doctype, ptypes] of Object.entries(GRANTS)) {
    await erp.post(`${pm}.add`, { parent: doctype, role: NORN_ROLE, permlevel: 0 });
    for (const ptype of ptypes) {
      await erp.post(`${pm}.update`, { doctype, role: NORN_ROLE, permlevel: 0, ptype, value: "1" });
    }
  }
  log(`Role "${NORN_ROLE}": permissions applied for ${Object.keys(GRANTS).length} doctypes`);

  // 6. The API user and its key pair (only if .env has none yet; regenerating rotates the secret).
  await ensure("User", NORN_USER, {
    email: NORN_USER,
    first_name: "Norn",
    last_name: "Agent",
    enabled: 1,
    send_welcome_email: 0,
    user_type: "System User",
    roles: [{ role: NORN_ROLE }],
  });
  if (!env.ERPNEXT_API_KEY || !env.ERPNEXT_API_SECRET) {
    const r = await erp.post("/api/method/frappe.core.doctype.user.user.generate_keys", { user: NORN_USER });
    setEnv("ERPNEXT_API_KEY", r.body.message.api_key);
    setEnv("ERPNEXT_API_SECRET", r.body.message.api_secret);
    log("API key and secret generated and written to .env (not shown)");
  } else {
    log("API key and secret already in .env; left alone");
  }

  // 7. Scheduler. Job types are created during site install in a different time zone from the one the
  //    wizard then sets, so their `creation` can lie hours in the future and ERPNext (which computes the
  //    next run from creation while last_execution is empty) would not run them until then. That stalls
  //    the BOM cost-update cron. Give any such job a last_execution in the past.
  const nowLA = new Date().toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" });
  const yesterdayLA = new Date(Date.now() - 864e5).toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" });
  const jobs = (await erp.get("/api/resource/Scheduled Job Type", { fields: ["name", "creation", "last_execution"], limit_page_length: 0 })).body.data;
  const stuck = jobs.filter((j) => !j.last_execution && j.creation > nowLA);
  for (const j of stuck) await erp.put(`/api/resource/Scheduled Job Type/${enc(j.name)}`, { last_execution: yesterdayLA });
  log(`Scheduler: ${stuck.length} of ${jobs.length} job types had a creation time in the future; last_execution set`);

  // 8. Report what the role holds, as stored.
  const perms = await erp.get("/api/resource/Custom DocPerm", {
    filters: [["role", "=", NORN_ROLE]],
    fields: ["parent", "read", "write", "create", "submit", "cancel", "amend", "delete"],
    limit_page_length: 0,
    order_by: "parent asc",
  });
  log(`
${NORN_ROLE} grants (Custom DocPerm):`);
  for (const p of perms.body.data) {
    const on = ["read", "write", "create", "submit", "cancel", "amend", "delete"].filter((k) => p[k]);
    log(`  ${p.parent}: ${on.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
