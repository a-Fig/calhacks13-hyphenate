// One-off setup for the ECO write-back (norn/connectors/erpnext/src/write.ts), as Administrator. Re-runnable:
// it looks up what exists and creates only what is missing.
//
//   node bowman/erp/eco-setup.ts
//
// Adds, so that a finance user can follow a change from ERPNext back to the ECO and Norn's decision:
//   - custom fields "Released by ECO" (bw_eco) and "Norn decision" (bw_decision_url, a clickable link) on BOM, Item Price
//     and Journal Entry; the BOM already has bw_eco from seed.ts, so it gets only the link. Journal Entry also gets
//     "ECO entry" (bw_eco_entry), the key that lets Norn find its own entry again on a retry.
//   - the account "11420 - Reserve for Obsolete Inventory" under "11400 - Inventory". The US chart has no inventory
//     reserve, and with perpetual inventory ERPNext refuses a journal entry that credits "11410 - Inventory on Hand"
//     ("can only be updated via Stock Transactions"), so a stock write-down needs a non-stock account to credit.
// Needs the tunnel to the ERP and ERPNEXT_URL / ERPNEXT_ADMIN_PASSWORD in the repo-root .env (override with ENV_FILE).
// seed.ts is not touched. Node 24, erasable TypeScript syntax only.
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

const COMPANY = "Bowman Aviation";
const env = readEnv();
if (!env.ERPNEXT_ADMIN_PASSWORD) throw new Error("ERPNEXT_ADMIN_PASSWORD is not set");
const erp = new Erp(env.ERPNEXT_URL || "http://127.0.0.1:8081");
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);

interface Field { dt: string; fieldname: string; label: string; fieldtype: string; insert_after: string; options?: string; description?: string }
const FIELDS: Field[] = [
  { dt: "BOM", fieldname: "bw_decision_url", label: "Norn decision", fieldtype: "Data", options: "URL", insert_after: "bw_eco", description: "The Norn decision that caused this version." },
  { dt: "Item Price", fieldname: "bw_eco", label: "Released by ECO", fieldtype: "Data", insert_after: "valid_upto" },
  { dt: "Item Price", fieldname: "bw_decision_url", label: "Norn decision", fieldtype: "Data", options: "URL", insert_after: "bw_eco", description: "The Norn decision that caused this price." },
  { dt: "Journal Entry", fieldname: "bw_eco", label: "Released by ECO", fieldtype: "Data", insert_after: "posting_date" },
  { dt: "Journal Entry", fieldname: "bw_eco_entry", label: "ECO entry", fieldtype: "Data", insert_after: "bw_eco", description: "Which of the ECO's entries this is." },
  { dt: "Journal Entry", fieldname: "bw_decision_url", label: "Norn decision", fieldtype: "Data", options: "URL", insert_after: "bw_eco_entry", description: "The Norn decision that caused this entry." },
];

const exists = async (doctype: string, name: string): Promise<boolean> =>
  (await erp.get(`/api/resource/${enc(doctype)}`, { filters: [["name", "=", name]], fields: ["name"] })).body.data.length > 0;

for (const f of FIELDS) {
  const name = `${f.dt}-${f.fieldname}`;
  if (await exists("Custom Field", name)) { console.log(`field ${name}: already there`); continue; }
  await erp.post("/api/resource/Custom%20Field", { ...f, read_only: 1 });
  console.log(`field ${name}: created`);
}

const account = `11420 - Reserve for Obsolete Inventory - BWA`;
if (await exists("Account", account)) console.log(`account ${account}: already there`);
else {
  await erp.post("/api/resource/Account", {
    company: COMPANY, account_name: "Reserve for Obsolete Inventory", account_number: "11420", parent_account: "11400 - Inventory - BWA", is_group: 0, root_type: "Asset",
  });
  console.log(`account ${account}: created`);
}
