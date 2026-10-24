// Calls every ERPNext operation Norn will use, as the Norn Agent user, against throwaway test
// documents in the Bowman company, then removes the test documents (as Administrator).
//
//   node bowman/erp/verify.mjs            run and clean up
//   node bowman/erp/verify.mjs --keep     leave the test documents in place
//   node bowman/erp/verify.mjs --clean    only remove leftovers from an earlier run
//   node bowman/erp/verify.mjs --wait-cost  wait for the Update Cost job to finish (can take 15-30 min:
//                                           ERPNext resumes it from a 15-minute cron, one BOM level per run)
//
// Needs ERPNEXT_URL, ERPNEXT_ADMIN_PASSWORD, ERPNEXT_API_KEY, ERPNEXT_API_SECRET in .env.
// Prints the status of each call and a short note. Never prints keys or secrets.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Erp, enc, readEnv } from "./erp.mjs";

const env = readEnv();
const base = env.ERPNEXT_URL || "http://127.0.0.1:8081";
const args = new Set(process.argv.slice(2));

const COMPANY = "Bowman Aviation";
const PFX = "ZZ-NORN-TEST";
const TOP = `${PFX}-TOP`; // finished good, uses SUB
const SUB = `${PFX}-SUB`; // sub-assembly, the BOM that an ECO changes
const P1 = `${PFX}-P1`;
const P2 = `${PFX}-P2`;
const P3 = `${PFX}-P3`;
const OVL = `${PFX}-OVL`; // costed from an overlapping price row
const ITEMS = [
  [OVL, "Assemblies"],
  [TOP, "Aircraft"],
  [SUB, "Assemblies"],
  [P1, "Purchased Parts"],
  [P2, "Purchased Parts"],
  [P3, "Purchased Parts"],
];
const REMARK = "norn-verify test document";

const admin = new Erp(base);
await admin.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
const norn = new Erp(base, { token: `${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}` });

// Site time zone is America/Los_Angeles (set by bootstrap.mjs); used to find rows made by this run.
const runStart = new Date().toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" });
const transcript = [];
const createdLogs = []; // BOM Update Log names made by this run, removed in cleanup
let failures = 0;

function errText(b) {
  try {
    const m = b._server_messages ? JSON.parse(b._server_messages).map((x) => JSON.parse(x).message.replace(/<[^>]+>/g, "")) : [];
    return [b.exc_type, ...m].filter(Boolean).join(" | ").slice(0, 300);
  } catch {
    return JSON.stringify(b).slice(0, 200);
  }
}

/** One recorded call. who = "norn" | "admin". */
async function call(label, who, method, path, { query, body } = {}) {
  const client = who === "norn" ? norn : admin;
  const r = await client.req(method, path, { query, body, allow: true });
  transcript.push({ label, who, method, path, query, body, status: r.status, response: r.status < 300 ? r.body : errText(r.body) });
  const ok = r.status < 300;
  console.log(`${String(r.status).padEnd(3)} ${who.padEnd(5)} ${method.padEnd(6)} ${path}${query ? " ?" + Object.keys(query).join(",") : ""}  - ${label}${ok ? "" : "  => " + errText(r.body)}`);
  return r;
}
const data = (r) => r.body.data ?? r.body.message;
function expect(r, status, what) {
  if (r.status !== status) {
    failures++;
    console.log(`    UNEXPECTED: wanted ${status} for ${what}`);
  }
  return r;
}
async function step(name, fn) {
  console.log(`\n== ${name}`);
  try {
    return await fn();
  } catch (e) {
    failures++;
    console.log(`    STEP FAILED: ${e.message}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- cleanup (as Administrator) -------------------------------------------------------------
async function cleanup() {
  console.log("\n== cleanup (Administrator)");
  const deleted = []; // [doctype, name] pairs; their Deleted Document rows are removed at the end
  const del = async (dt, name) => {
    const r = await admin.del(`/api/resource/${enc(dt)}/${enc(name)}`, { allow: true });
    if (r.status >= 300 && r.status !== 404) console.log(`    could not delete ${dt} ${name}: ${r.status} ${errText(r.body)}`);
    else if (r.status < 300) deleted.push([dt, name]);
    return r.status;
  };
  const cancel = async (dt, name) => {
    const r = await admin.post("/api/method/frappe.client.cancel", { doctype: dt, name }, { allow: true });
    if (r.status >= 300) console.log(`    could not cancel ${dt} ${name}: ${r.status} ${errText(r.body)}`);
  };
  const list = async (dt, filters, fields = ["name"]) =>
    (await admin.get(`/api/resource/${enc(dt)}`, { filters, fields, limit_page_length: 0 })).body.data;

  // Journal entries made by the test.
  for (const je of await list("Journal Entry", [["user_remark", "=", REMARK]], ["name", "docstatus"])) {
    if (je.docstatus === 1) await cancel("Journal Entry", je.name);
    await del("Journal Entry", je.name);
  }
  // BOM Update Logs (submitted: cancel first).
  const logs = await list("BOM Update Log", [["current_bom", "like", `BOM-${PFX}-%`]], ["name", "docstatus"]);
  for (const name of createdLogs) logs.push({ name, docstatus: 1 });
  for (const l of logs) {
    const g = await admin.get(`/api/resource/BOM Update Log/${enc(l.name)}`, undefined, { allow: true });
    if (g.status !== 200) continue;
    if (g.body.data.docstatus === 1) await cancel("BOM Update Log", l.name);
    await del("BOM Update Log", l.name);
  }
  // BOMs, parents first. A submitted BOM must be cancelled before deletion.
  const boms = await list("BOM", [["item", "like", `${PFX}-%`]], ["name", "item", "docstatus", "creation"]);
  const order = [TOP, SUB];
  boms.sort((a, b) => order.indexOf(a.item) - order.indexOf(b.item) || b.creation.localeCompare(a.creation));
  for (const b of boms) {
    if (b.docstatus === 1) await cancel("BOM", b.name);
  }
  // Item.default_bom links to a BOM; clear before deleting.
  for (const [code] of ITEMS) {
    const it = await admin.get(`/api/resource/Item/${enc(code)}`, undefined, { allow: true });
    if (it.status === 200 && it.body.data.default_bom) await admin.put(`/api/resource/Item/${enc(code)}`, { default_bom: null });
  }
  for (const b of boms) await del("BOM", b.name);
  for (const ip of await list("Item Price", [["item_code", "like", `${PFX}-%`]])) await del("Item Price", ip.name);
  for (const [code] of ITEMS) await del("Item", code);
  // History and bookkeeping rows that point at the deleted test documents.
  for (const dt of ["BOM", "Item", "Item Price", "Journal Entry"]) {
    for (const v of await list("Version", [["ref_doctype", "=", dt], ["docname", "like", `%${PFX}%`]])) await del("Version", v.name);
  }
  for (const [dt, name] of deleted) {
    for (const dd of await list("Deleted Document", [["deleted_doctype", "=", dt], ["deleted_name", "=", name]])) {
      await admin.del(`/api/resource/Deleted%20Document/${enc(dd.name)}`, { allow: true });
    }
  }
  // Deleting a document leaves a content-free "Deleted" comment on it. Remove the ones from this run.
  const comments = await list("Comment", [["comment_type", "=", "Deleted"], ["creation", ">=", runStart], ["reference_doctype", "in", [...new Set(deleted.map(([dt]) => dt))]]]);
  for (const c of comments) await admin.del(`/api/resource/Comment/${enc(c.name)}`, { allow: true });
  // ...and deleting those comments leaves Deleted Document rows of their own.
  for (const dd of await list("Deleted Document", [["deleted_doctype", "=", "Comment"], ["creation", ">=", runStart]])) {
    await admin.del(`/api/resource/Deleted%20Document/${enc(dd.name)}`, { allow: true });
  }
  console.log("    done");
}

if (args.has("--clean")) {
  await cleanup();
  process.exit(0);
}
await cleanup(); // leftovers from an interrupted run
transcript.length = 0;

// ---- setup (Administrator): test items -------------------------------------------------------
await step("setup: test items (Administrator)", async () => {
  for (const [code, group] of ITEMS) {
    const r = await call(`create ${code}`, "admin", "POST", "/api/resource/Item", {
      body: { item_code: code, item_name: code, item_group: group, stock_uom: "Nos", is_stock_item: 1 },
    });
    expect(r, 200, "item create");
  }
});

// ---- 1. read an Item -------------------------------------------------------------------------
await step("1. read an Item (Norn)", async () => {
  const r = await call("get one item", "norn", "GET", `/api/resource/Item/${enc(P1)}`);
  expect(r, 200, "item read");
  const d = r.body.data;
  console.log(`    fields present: valuation_rate=${"valuation_rate" in d} last_purchase_rate=${"last_purchase_rate" in d} lead_time_days=${"lead_time_days" in d} min_order_qty=${"min_order_qty" in d} safety_stock=${"safety_stock" in d} default_bom=${"default_bom" in d}`);
  await call("list items with fields", "norn", "GET", "/api/resource/Item", {
    query: { filters: [["item_code", "like", `${PFX}-%`]], fields: ["item_code", "valuation_rate", "last_purchase_rate", "lead_time_days", "min_order_qty", "safety_stock", "default_bom"], limit_page_length: 0 },
  });
});

// ---- 2. Item Price on "Standard Cost" --------------------------------------------------------
const prices = {};
await step("2. Item Price on Standard Cost (Norn)", async () => {
  const mk = (item, rate, from) => ({ item_code: item, price_list: "Standard Cost", price_list_rate: rate, buying: 1, currency: "USD", valid_from: from });
  prices.P1a = data(expect(await call("create P1 standard cost 10 from 2026-01-01", "norn", "POST", "/api/resource/Item Price", { body: mk(P1, 10, "2026-01-01") }), 200, "item price create"));
  prices.P2 = data(await call("create P2 standard cost 20", "norn", "POST", "/api/resource/Item Price", { body: mk(P2, 20, "2026-01-01") }));
  prices.P3 = data(await call("create P3 standard cost 30", "norn", "POST", "/api/resource/Item Price", { body: mk(P3, 30, "2026-01-01") }));
  // Supersede: close the old row, then add the new one with a later valid_from.
  expect(await call("close old P1 row (valid_upto)", "norn", "PUT", `/api/resource/Item Price/${enc(prices.P1a.name)}`, { body: { valid_upto: "2026-06-30" } }), 200, "item price close");
  prices.P1b = data(expect(await call("create P1 standard cost 12 from 2026-07-01", "norn", "POST", "/api/resource/Item Price", { body: mk(P1, 12, "2026-07-01") }), 200, "item price supersede"));
  await call("read prices back with the research filter shape", "norn", "GET", "/api/resource/Item Price", {
    query: { filters: [["buying", "=", 1], ["item_code", "like", `${PFX}-%`]], fields: ["name", "item_code", "supplier", "price_list", "price_list_rate", "lead_time_days", "valid_from", "valid_upto"], limit_page_length: 0 },
  });
});

// ---- 3. create and submit a BOM --------------------------------------------------------------
const bom = {};
const bomBody = (item, rows) => ({
  item,
  quantity: 1,
  company: COMPANY,
  currency: "USD",
  uom: "Nos",
  is_active: 1,
  is_default: 1,
  rm_cost_as_per: "Price List",
  buying_price_list: "Standard Cost",
  items: rows.map(([item_code, qty, bom_no]) => ({ item_code, qty, uom: "Nos", ...(bom_no ? { bom_no } : {}) })),
});
await step("3. create + submit a BOM (Norn): POST then frappe.client.submit", async () => {
  const r = expect(await call("create SUB BOM v1 (draft)", "norn", "POST", "/api/resource/BOM", { body: bomBody(SUB, [[P1, 2], [P2, 1]]) }), 200, "bom create");
  bom.sub1 = r.body.data.name;
  console.log(`    name=${bom.sub1} docstatus=${r.body.data.docstatus} raw_material_cost=${r.body.data.raw_material_cost} total_cost=${r.body.data.total_cost}`);
  const s = expect(await call("submit SUB BOM v1 via frappe.client.submit", "norn", "POST", "/api/method/frappe.client.submit", { body: { doc: r.body.data } }), 200, "bom submit");
  console.log(`    after submit: docstatus=${s.body.message?.docstatus}`);
});

await step("3b. BOM posted with docstatus 1 in one call (Norn), uses SUB v1 as a sub-assembly", async () => {
  const body = { ...bomBody(TOP, [[SUB, 1, bom.sub1]]), docstatus: 1 };
  const r = await call("create TOP BOM v1 with docstatus:1", "norn", "POST", "/api/resource/BOM", { body });
  if (r.status === 200) {
    bom.top1 = r.body.data.name;
    console.log(`    one-shot POST worked: name=${bom.top1} docstatus=${r.body.data.docstatus}`);
  } else {
    // Fall back to the two-call path so the later steps still run.
    const d = expect(await call("create TOP BOM v1 (draft)", "norn", "POST", "/api/resource/BOM", { body: bomBody(TOP, [[SUB, 1, bom.sub1]]) }), 200, "top create");
    bom.top1 = d.body.data.name;
    await call("submit TOP BOM v1", "norn", "POST", "/api/method/frappe.client.submit", { body: { doc: d.body.data } });
  }
});

// ---- 4. second BOM, retire the first, replace and recost -------------------------------------
await step("4a. second BOM for SUB; PUT docstatus:1 to submit (Norn)", async () => {
  const r = expect(await call("create SUB BOM v2 (draft)", "norn", "POST", "/api/resource/BOM", { body: bomBody(SUB, [[P1, 2], [P2, 2], [P3, 1]]) }), 200, "bom v2 create");
  bom.sub2 = r.body.data.name;
  const s = await call("submit SUB BOM v2 via PUT docstatus:1", "norn", "PUT", `/api/resource/BOM/${enc(bom.sub2)}`, { body: { docstatus: 1, modified: r.body.data.modified } });
  console.log(`    name=${bom.sub2}; PUT docstatus:1 -> ${s.status}`);
  if (s.status >= 300) {
    const g = (await norn.get(`/api/resource/BOM/${enc(bom.sub2)}`)).body.data;
    await call("submit SUB BOM v2 via frappe.client.submit (fallback)", "norn", "POST", "/api/method/frappe.client.submit", { body: { doc: g } });
  }
  for (const n of [bom.sub1, bom.sub2]) {
    const g = (await call(`read ${n}`, "norn", "GET", `/api/resource/BOM/${enc(n)}`)).body.data;
    console.log(`    ${n}: docstatus=${g.docstatus} is_active=${g.is_active} is_default=${g.is_default} raw_material_cost=${g.raw_material_cost}`);
  }
  const it = (await call("read SUB item default_bom", "norn", "GET", `/api/resource/Item/${enc(SUB)}`)).body.data;
  console.log(`    Item.default_bom=${it.default_bom}`);
});

await step("4b. set the first BOM inactive while a parent BOM still uses it (Norn): research order, expected to be refused", async () => {
  expect(await call("retire SUB BOM v1 before replacing it", "norn", "PUT", `/api/resource/BOM/${enc(bom.sub1)}`, { body: { is_active: 0 } }), 417, "retire refused while linked");
  const g = (await norn.get(`/api/resource/BOM/${enc(bom.sub1)}`)).body.data;
  console.log(`    ${bom.sub1}: docstatus=${g.docstatus} is_active=${g.is_active} is_default=${g.is_default}`);
});

async function pollLog(name, label, maxSeconds = 120) {
  for (let i = 0; i < maxSeconds / 5; i++) {
    const r = await admin.get(`/api/resource/BOM Update Log/${enc(name)}`);
    const st = r.body.data.status;
    if (["Completed", "Failed", "Cancelled"].includes(st)) {
      console.log(`    ${label} log ${name}: ${st}`);
      transcript.push({ label: `poll ${label} log`, who: "admin", method: "GET", path: `/api/resource/BOM Update Log/${name}`, status: 200, response: { status: st, error_log: r.body.data.error_log, processed_boms: r.body.data.processed_boms } });
      return r.body.data;
    }
    await sleep(5000);
  }
  console.log(`    ${label} log ${name}: still not finished after ${maxSeconds} s`);
}

await step("4c. replace SUB v1 with v2 in parent BOMs (Norn): enqueue_replace_bom", async () => {
  const r = await call("enqueue_replace_bom", "norn", "POST", "/api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom", {
    body: { boms: { current_bom: bom.sub1, new_bom: bom.sub2 } },
  });
  expect(r, 200, "replace bom");
  if (r.status === 200) {
    createdLogs.push(r.body.message.name);
    console.log(`    returned: ${JSON.stringify({ name: r.body.message.name, status: r.body.message.status, update_type: r.body.message.update_type, docstatus: r.body.message.docstatus })}`);
    await pollLog(r.body.message.name, "replace");
  }
  const t = (await call("read TOP BOM after replace", "norn", "GET", `/api/resource/BOM/${enc(bom.top1)}`)).body.data;
  console.log(`    ${bom.top1} sub-assembly row bom_no=${t.items[0].bom_no} rate=${t.items[0].rate} (want ${bom.sub2}); docstatus=${t.docstatus}`);
});

await step("4c2. now set the first BOM inactive (Norn): PUT is_active:0", async () => {
  expect(await call("retire SUB BOM v1 after replacing it", "norn", "PUT", `/api/resource/BOM/${enc(bom.sub1)}`, { body: { is_active: 0 } }), 200, "bom retire");
  const g = (await norn.get(`/api/resource/BOM/${enc(bom.sub1)}`)).body.data;
  console.log(`    ${bom.sub1}: docstatus=${g.docstatus} is_active=${g.is_active} is_default=${g.is_default}`);
});

await step("4c3. top-level item: new BOM, retire the old one (no parents to replace in)", async () => {
  const r = expect(await call("create TOP BOM v2 (draft)", "norn", "POST", "/api/resource/BOM", { body: bomBody(TOP, [[SUB, 1, bom.sub2], [P3, 4]]) }), 200, "top v2 create");
  bom.top2 = r.body.data.name;
  expect(await call("submit TOP BOM v2 via PUT docstatus:1 (no modified)", "norn", "PUT", `/api/resource/BOM/${enc(bom.top2)}`, { body: { docstatus: 1 } }), 200, "top v2 submit");
  expect(await call("retire TOP BOM v1", "norn", "PUT", `/api/resource/BOM/${enc(bom.top1)}`, { body: { is_active: 0 } }), 200, "top v1 retire");
  for (const n of [bom.top1, bom.top2]) {
    const g = (await norn.get(`/api/resource/BOM/${enc(n)}`)).body.data;
    console.log(`    ${n}: docstatus=${g.docstatus} is_active=${g.is_active} is_default=${g.is_default} total_cost=${g.total_cost}`);
  }
  const it = (await norn.get(`/api/resource/Item/${enc(TOP)}`)).body.data;
  console.log(`    Item.default_bom=${it.default_bom}`);
});

await step("4d. recost all BOMs (Norn): enqueue_update_cost", async () => {
  const r = await call("enqueue_update_cost", "norn", "POST", "/api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_update_cost");
  expect(r, 200, "update cost");
  if (r.status === 200) {
    createdLogs.push(r.body.message.name);
    console.log(`    returned: ${JSON.stringify({ name: r.body.message.name, status: r.body.message.status, update_type: r.body.message.update_type })}`);
    await pollLog(r.body.message.name, "update cost", args.has("--wait-cost") ? 2400 : 60);
  }
  for (const n of [bom.sub1, bom.sub2, bom.top1, bom.top2]) {
    const g = (await norn.get(`/api/resource/BOM/${enc(n)}`)).body.data;
    console.log(`    ${n}: raw_material_cost=${g.raw_material_cost} total_cost=${g.total_cost} is_active=${g.is_active} is_default=${g.is_default}`);
  }
});

// ---- 5. draft Journal Entry ------------------------------------------------------------------
let je;
await step("5. draft Journal Entry (Norn), and a refused submit", async () => {
  const r = await call("create draft Journal Entry", "norn", "POST", "/api/resource/Journal Entry", {
    body: {
      voucher_type: "Journal Entry",
      company: COMPANY,
      posting_date: "2026-10-24",
      user_remark: REMARK,
      accounts: [
        { account: "51900 - Inventory Shrinkage and Adjustments - BWA", debit_in_account_currency: 100 },
        { account: "21210 - Accrued Expenses - BWA", credit_in_account_currency: 100 },
      ],
    },
  });
  expect(r, 200, "je create");
  je = r.body.data;
  console.log(`    name=${je?.name} docstatus=${je?.docstatus} total_debit=${je?.total_debit}`);
  const s = await call("try to submit it (must be refused)", "norn", "POST", "/api/method/frappe.client.submit", { body: { doc: je } });
  expect(s, 403, "je submit refused");
  const g = (await norn.get(`/api/resource/Journal Entry/${enc(je.name)}`)).body.data;
  console.log(`    docstatus still ${g.docstatus}`);
  const u = await call("try to edit the draft (write not granted)", "norn", "PUT", `/api/resource/Journal Entry/${enc(je.name)}`, { body: { user_remark: REMARK + " edited" } });
  console.log(`    PUT on own draft -> ${u.status}`);
});

// ---- 6. Version history ----------------------------------------------------------------------
await step("6. Version history (Norn)", async () => {
  const v = async (dt, name) => {
    const r = await call(`Version rows for ${dt} ${name}`, "norn", "GET", "/api/resource/Version", {
      query: { filters: [["ref_doctype", "=", dt], ["docname", "=", name]], fields: ["name", "creation", "owner", "docname", "data"], order_by: "creation asc", limit_page_length: 0 },
    });
    expect(r, 200, "version read");
    for (const row of r.body.data ?? []) {
      let d = {};
      try { d = JSON.parse(row.data); } catch {}
      const keys = Object.keys(d).filter((k) => (Array.isArray(d[k]) ? d[k].length : d[k]));
      console.log(`    ${row.creation} by ${row.owner}: ${keys.join(",")} ${d.changed ? JSON.stringify(d.changed).slice(0, 120) : ""}${d.updater_reference ? " updater_reference=" + JSON.stringify(d.updater_reference).slice(0, 100) : ""}`);
    }
  };
  await v("BOM", bom.sub1);
  await v("BOM", bom.top1);
  await v("BOM", bom.sub2);
  await v("Item Price", prices.P1a.name);
});

// ---- 6b. overlapping Item Price rows ----------------------------------------------------------
await step("6b. what happens if the old Item Price row is NOT closed before adding a newer one (Norn)", async () => {
  const mk = (rate, from) => ({ item_code: P2, price_list: "Standard Cost", price_list_rate: rate, buying: 1, currency: "USD", valid_from: from });
  const r = await call("create overlapping P2 row (25 from 2026-07-01; the 20 row from 2026-01-01 has no valid_upto)", "norn", "POST", "/api/resource/Item Price", { body: mk(25, "2026-07-01") });
  console.log(`    overlapping row accepted: ${r.status === 200}`);
  const d = await call("draft BOM costing P2 only", "norn", "POST", "/api/resource/BOM", { body: bomBody(OVL, [[P2, 1]]) });
  console.log(`    draft BOM raw_material_cost for 1 x P2 = ${d.body.data?.raw_material_cost} (20 = older row used, 25 = newer valid_from used)`);
});

// ---- 7. other reads, BOM methods, and refusals -----------------------------------------------
await step("7a. BOM read methods from the research (Norn)", async () => {
  await call("BOM list with the research filter shape", "norn", "GET", "/api/resource/BOM", {
    query: { filters: [["item", "=", SUB], ["docstatus", "=", 1]], fields: ["name", "item", "is_active", "is_default", "raw_material_cost", "operating_cost", "total_cost"] },
  });
  await call("exploded BOM", "norn", "GET", "/api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_items", { query: { bom: bom.top1, company: COMPANY, qty: 1, fetch_exploded: 1 } });
  await call("BOM diff", "norn", "GET", "/api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_diff", { query: { bom1: bom.sub1, bom2: bom.sub2 } });
});

await step("7b. read access on every granted doctype (Norn)", async () => {
  for (const dt of ["Item", "BOM", "Item Price", "Supplier", "Supplier Quotation", "Purchase Order", "Bin", "Stock Ledger Entry", "GL Entry", "Journal Entry", "Version", "Company", "Warehouse", "Price List", "Account", "Cost Center", "Fiscal Year", "UOM", "Item Group"]) {
    const r = await call(`list ${dt}`, "norn", "GET", `/api/resource/${enc(dt)}`, { query: { limit_page_length: 1 } });
    if (r.status !== 200) console.log(`    >> ${dt}: not readable by Norn`);
  }
});

await step("7c. things Norn must not be able to do", async () => {
  expect(await call("create an Item", "norn", "POST", "/api/resource/Item", { body: { item_code: `${PFX}-NOPE`, item_name: "x", item_group: "Purchased Parts", stock_uom: "Nos" } }), 403, "item create refused");
  expect(await call("delete the submitted BOM", "norn", "DELETE", `/api/resource/BOM/${enc(bom.top1)}`), 403, "bom delete refused");
  expect(await call("cancel a BOM", "norn", "POST", "/api/method/frappe.client.cancel", { body: { doctype: "BOM", name: bom.top1 } }), 403, "bom cancel refused");
  const ul = await call("list Users (Frappe lets every user read its own record)", "norn", "GET", "/api/resource/User", { query: { fields: ["name"], limit_page_length: 0 } });
  console.log(`    users visible to Norn: ${JSON.stringify((ul.body.data ?? []).map((u) => u.name))}`);
  expect(await call("read the Administrator user", "norn", "GET", "/api/resource/User/Administrator"), 403, "other user refused");
});

writeFileSync(process.env.VERIFY_TRANSCRIPT ?? join(tmpdir(), "norn-verify-transcript.json"), JSON.stringify(transcript, null, 1));

if (!args.has("--keep")) await cleanup();

console.log(`\n${failures ? failures + " UNEXPECTED RESULT(S)" : "All expectations met"}`);
process.exit(failures ? 1 : 0);
