# Bowman ERP (ERPNext) notes

Written 2026-10-24, from the standup and a full verification run the same morning. Everything marked "verified" was run against the live instance as the Norn user. Docs: `docs/research/software-options.md` sections 2 and 5-7 are the pre-standup research this corrects.

## What runs where

- ERPNext **16.52.1** (Frappe 16.53.0), MariaDB 11.8, Redis 6.2, from `frappe/erpnext:v16.52.1` (amd64, Docker Hub, pushed 2026-10-22).
- On Tyler's home-server Mac, in Colima, compose project `bowman-erp`, directory `~/bowman/erp`. Published on the Mac's `127.0.0.1:8081` only. About 0.9 GB RAM, about 5 GB of images on disk (`frappe/erpnext` is 4.5 GB), 0.3 GB of data so far. The Colima VM had 21 GB free before the pull.
- Site name `frontend`. Company **Bowman Aviation** (`BWA`), USD, US chart of accounts (numbered, e.g. `11410 - Inventory on Hand - BWA`), fiscal years 2025-2027, warehouses `Stores - BWA`, `Work In Progress - BWA`, `Finished Goods - BWA` (plus ERPNext's `Goods In Transit - BWA`). Item groups `Aircraft`, `Assemblies`, `Purchased Parts` (and ERPNext's own `Raw Material`, `Sub Assemblies`). Buying price list `Standard Cost`.
- The instance holds no items, BOMs or transactions: seeding comes next.

## Start, stop, log in

All from the repo root; `up.sh` reads `.env` (see `.env.example`). `BOWMAN_ERP_SSH` there is `user@host` of the Mac, kept out of the repo.

```
bowman/erp/up.sh            # copy compose.yml to the Mac, start the stack, wait until the site answers
bowman/erp/up.sh stop       # stop containers; volumes (all data) stay
bowman/erp/up.sh status     # container state and a ping
bowman/erp/up.sh tunnel     # laptop 127.0.0.1:8081 -> Mac 127.0.0.1:8081, runs until Ctrl-C
node bowman/erp/bootstrap.mjs   # company, price list, Norn role and user (idempotent; tunnel must be open)
node bowman/erp/verify.mjs      # the call sequence below, then removes its test documents
```

With the tunnel open, browse `http://127.0.0.1:8081` and log in as `Administrator` with `ERPNEXT_ADMIN_PASSWORD` from `.env`. 8081 is used on both ends because the laptop cannot bind 8080.

- A first run took about 22 minutes: roughly 14 minutes pulling about 1 GB of compressed images, then roughly 8 minutes installing the site. A stop then start takes about 40 seconds and keeps all data (verified).
- The compose `restart_policy` is `on-failure`, as upstream. Not tested: whether the stack returns by itself after a Mac or Colima restart. Run `up.sh` if it does not.
- Passwords are read only when the site is first created. Changing `ERPNEXT_ADMIN_PASSWORD` in `.env` later does not change the login. The MariaDB root password is generated on the Mac in `~/bowman/erp/.env` (mode 600) and is not kept anywhere else.
- Deleting the volumes destroys the data. There is deliberately no wipe command in `up.sh`.

## The Norn Agent role and user

User `norn@bowman.example` (System User, only role `Norn Agent`, no password, API key and secret in `.env` as `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET`). Auth: `Authorization: token <key>:<secret>`. Permissions were added with the Role Permissions Manager endpoints (`frappe.core.page.permission_manager.permission_manager.add` and `.update`), which copy a doctype's stock permissions into Custom DocPerm before adding ours. Verified as stored:

| Doctype | read | write | create | submit | cancel / amend / delete |
|---|---|---|---|---|---|
| Item, Supplier, Supplier Quotation, Purchase Order, Bin, Stock Ledger Entry, GL Entry, Version, Company, Warehouse, Price List | yes | no | no | no | no |
| BOM | yes | yes | yes | **yes** | no |
| Item Price | yes | yes | yes | n/a | no |
| Journal Entry | yes | **no** | yes | **no** | no |
| BOM Update Log (not on the brief's list) | yes | no | yes | yes | no |
| Account (not on the brief's list) | yes | no | no | no | no |

Why the two extras: `enqueue_replace_bom` and `enqueue_update_cost` create and submit a BOM Update Log, and without that grant both return 403 (verified); Account read lets Norn pick accounts for a draft Journal Entry (create works without it, but Norn could not list the chart). Because Journal Entry has no write, Norn cannot edit or replace its own draft; Bowman can add write if wanted. Also verified: Norn cannot submit a Journal Entry (403, draft stays draft), create an Item, cancel or delete a BOM, or read other users. It cannot read Cost Center or Fiscal Year. It can read UOM and Item Group (ERPNext default) and its own User record.

## Verified call sequence (ECO release)

Base `ERPNEXT_URL`, header `Authorization: token <key>:<secret>`, JSON bodies. Test items were a finished good `TOP` whose BOM uses a sub-assembly `SUB`, with purchased parts `P1-P3`.

1. **Read.** `GET /api/resource/Item/<code>` gives `valuation_rate`, `last_purchase_rate`, `lead_time_days`, `min_order_qty`, `safety_stock`. Frappe leaves out null fields, so `default_bom` is absent until a BOM exists. `GET /api/resource/BOM?filters=[["item","=","SUB"],["docstatus","=",1]]&fields=["name","is_active","is_default","raw_material_cost","operating_cost","total_cost"]` works as in the research. Exploded BOM `GET /api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_items?bom=&company=&qty=1&fetch_exploded=1` and `...bom.get_bom_diff?bom1=&bom2=` work for Norn.
2. **Standard cost.** `POST /api/resource/Item Price` `{"item_code","price_list":"Standard Cost","price_list_rate":12,"buying":1,"currency":"USD","valid_from":"2026-07-01"}`. To supersede: `PUT /api/resource/Item Price/<name>` `{"valid_upto":"2026-06-30"}` first, then POST the new row (both accepted).
3. **New BOM.** `POST /api/resource/BOM` `{"item":"SUB","quantity":1,"company":"Bowman Aviation","currency":"USD","uom":"Nos","is_active":1,"is_default":1,"rm_cost_as_per":"Price List","buying_price_list":"Standard Cost","items":[{"item_code":"P1","qty":2,"uom":"Nos"},{"item_code":"P2","qty":1,"uom":"Nos","bom_no":"<only for a sub-assembly row>"}]}`. Returns `BOM-<item>-00N` with `raw_material_cost` already computed from the price list (for the dates valid today). Three ways to submit, all verified:
   - add `"docstatus":1` to the POST body (one call);
   - `PUT /api/resource/BOM/<name>` `{"docstatus":1}` (no `modified` needed);
   - `POST /api/method/frappe.client.submit` `{"doc": <the whole doc returned by the POST>}`.
   Submitting makes the new BOM the default and clears `is_default` on the old one; `Item.default_bom` follows.
4. **Replace in parent assemblies** (only if the changed item is a sub-assembly). `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom` `{"boms":{"current_bom":"<old>","new_bom":"<new>"}}`. Returns a submitted BOM Update Log with `status:"Queued"`; it reached `Completed` within seconds. The parent BOM's sub-assembly row then points at the new BOM and its costs are recalculated, with a Version row labelled "via BOM Update Tool". The new BOM must be submitted and active, for the same item, company and currency.
5. **Retire the old BOM.** `PUT /api/resource/BOM/<old>` `{"is_active":0}`. **Do this after step 4, not before** (see differences). For a top-level item with no parent BOMs, step 4 is skipped and this works right after step 3.
6. **Recost (optional).** `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_update_cost`, no body. It recosts every active BOM in the system, not one. It returns at once with `Queued`; ERPNext then advances one BOM level per run of a 15-minute cron, so a two-level tree took about 11 minutes. Step 3 already costs the new BOM and step 4 already recosts its parents, so the write-back does not need this call.
7. **Draft Journal Entry.** `POST /api/resource/Journal Entry` `{"voucher_type":"Journal Entry","company":"Bowman Aviation","posting_date":"2026-10-24","user_remark":"...","accounts":[{"account":"51900 - Inventory Shrinkage and Adjustments - BWA","debit_in_account_currency":100},{"account":"21210 - Accrued Expenses - BWA","credit_in_account_currency":100}]}`. Returns `docstatus:0`, number `ACC-JV-<year>-00001`; cost center `Main - BWA` is filled in.
8. **History.** `GET /api/resource/Version?filters=[["ref_doctype","=","BOM"],["docname","=","<name>"]]&fields=["name","creation","owner","docname","data"]&order_by=creation asc&limit_page_length=0`; same for `Item Price`. `data` is a JSON string.

## Differences from the research doc

1. **Retire-then-replace fails for sub-assemblies.** Research section 6 retires the old BOM (step 4) before replacing it in parents (step 5). `PUT is_active:0` on a BOM that an active parent BOM uses returns 417 "Cannot deactivate or cancel BOM as it is linked with other BOMs". Replace first, then retire.
2. **Replace and recost need BOM Update Log rights** (read, create, submit), not just BOM write. The research says this in section 7; the brief's grant list did not include it.
3. **One-shot submit works.** Section 6 marked "posting with `docstatus:1` in one call" as unknown; it works, as does `PUT {"docstatus":1}`.
4. **Overlapping Item Price rows are accepted.** Section 6 left this unknown. With the old row left open (no `valid_upto`), a second row with a later `valid_from` was accepted, and BOM costing used the newer row. Closing the old row first is still cleaner.
5. **Update Cost is slow and global** (step 6 above); the research implied a direct recost.
6. **History format.** A Version `data` string holds `added`, `changed`, `removed`, `row_changed`, `updater_reference`. Dates in `changed` use `mm-dd-yyyy` (`["valid_upto",null,"06-30-2026"]`), not ISO, and currency values are formatted (`"$ 44.00"`). No Version row exists for an insert (confirmed for BOM and Item Price). A BOM submit writes a row whose `added` holds the generated `exploded_items`, and `changed` holds `docstatus` 0 to 1. Setting `is_active` to 0 writes `[["is_active",1,0]]`. `get_bom_diff` shows currency fields as strings too.
7. **Key generation.** `generate_keys` accepts POST only and returns `{"api_key","api_secret"}`. Called with a JSON body `{"user": "..."}`.
8. **Custom DocPerm.** The research suggested POSTing Custom DocPerm rows directly. Frappe's `add_permission` source copies the stock rows first because Custom DocPerm rows replace a doctype's stock permissions entirely; posting directly would drop every other role's access to that doctype (read from source, not tested). The Role Permissions Manager endpoints avoid that.
9. **Setup wizard over REST works.** `POST /api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete` with `{"args": "<json string>"}` (language, country, timezone, currency, company_name, company_abbr, chart_of_accounts `United States - Chart of Accounts`, fy_start_date, fy_end_date) ran synchronously in about 2 minutes. Cookie-authenticated writes also need an `X-Frappe-CSRF-Token`, which `erp.mjs` takes from the `/app` page; token-authenticated calls do not.

## Gotchas found

- **Scheduler did not run until 17:15.** The Scheduled Job Types are created at install in a different time zone from the one the wizard then sets, so their `creation` was hours in the future and ERPNext (which times the next run from `creation` while `last_execution` is empty) ran nothing, including the BOM cost cron. `bootstrap.mjs` sets `last_execution` on those 84 rows; a fresh site needs that step again.
- `verify.mjs` removes everything it creates: documents, Version rows, Deleted Document rows and "Deleted" comments. Frappe also winds a naming series back when the last document in it is deleted, so counters are as before (every run produced `ACC-JV-2026-00001`). After the last run the instance holds only what the setup wizard and `bootstrap.mjs` created.
- Not tested: stock-moving documents (Purchase Receipt, stock entries), Norn reads of Supplier Quotation, Purchase Order, Bin, Stock Ledger Entry and GL Entry with data in them (the tables were empty, only access was checked), `if_owner` rules, whether Norn can read the Version rows of a doctype it cannot read, a Mac or Colima restart.
