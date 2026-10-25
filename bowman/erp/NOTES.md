# Bowman ERP (ERPNext) notes

Written 2026-10-24, from the standup and a full verification run the same morning. Everything marked "verified" was run against the live instance as the Norn user, when that user still had write permissions; Tyler then decided Norn never writes to the ERP (#71), and on 2026-10-25 reversed that: Norn now creates BOMs and journal entries as unsubmitted drafts and a person submits them (section "The Norn Agent role and user"). The other write calls below are what a person does, run as Administrator by `verify.mjs`. Docs: `docs/research/software-options.md` sections 2 and 5-7 are the pre-standup research this corrects.

## What runs where

- ERPNext **16.52.1** (Frappe 16.53.0), MariaDB 11.8, Redis 6.2, from `frappe/erpnext:v16.52.1` (amd64, Docker Hub, pushed 2026-10-22).
- On Tyler's home-server Mac, in Colima, compose project `bowman-erp`, directory `~/bowman/erp`. Published on the Mac's `127.0.0.1:8081` only. About 0.9 GB RAM, about 5 GB of images on disk (`frappe/erpnext` is 4.5 GB), 0.3 GB of data so far. The Colima VM had 21 GB free before the pull.
- Site name `frontend`. Company **Bowman Aviation** (`BWA`), USD, US chart of accounts (numbered, e.g. `11410 - Inventory on Hand - BWA`), fiscal years 2025-2027, warehouses `Stores - BWA`, `Work In Progress - BWA`, `Finished Goods - BWA` (plus ERPNext's `Goods In Transit - BWA`). Item groups `Aircraft`, `Assemblies`, `Purchased Parts` (and ERPNext's own `Raw Material`, `Sub Assemblies`). Buying price list `Standard Cost`.
- Seeded from `bowman/data/bowman.json` on 2026-10-24 (see Seed below): 214 items, 47 BOMs, 144 purchase orders, stock.

## Start, stop, log in

All from the repo root; `up.sh` reads `.env` (see `.env.example`). `BOWMAN_ERP_SSH` there is `user@host` of the Mac, kept out of the repo.

```
bowman/erp/up.sh            # copy compose.yml to the Mac, start the stack, wait until the site answers
bowman/erp/up.sh stop       # stop containers; volumes (all data) stay
bowman/erp/up.sh status     # container state and a ping
bowman/erp/up.sh tunnel     # laptop 127.0.0.1:8081 -> Mac 127.0.0.1:8081, runs until Ctrl-C
node bowman/erp/bootstrap.mjs   # company, price list, Norn role and user (create/read/write on BOM and Journal Entry, read elsewhere, no submit/cancel/delete) (idempotent; tunnel must be open)
node bowman/erp/verify.mjs      # the call sequence below as Administrator, Norn's reads and refused writes, then removes its test documents
node bowman/erp/eco-setup.ts    # the ECO tag fields on BOM, Item Price and Journal Entry (editable), and the inventory reserve account
node bowman/erp/eco-package.ts  # print the ERP change package of ECR-0417's ECO and which lines are already entered (reads only)
node bowman/erp/reset-eco.ts ECO-0319  # undo the lines entered for an ECO and delete Norn's draft BOMs and journal entries for it, as Administrator, so the demo can run again
node bowman/erp/prove-no-submit.ts     # with Norn's own credentials, try to submit Norn's draft and show ERPNext refusing it
node bowman/erp/seed.ts         # load bowman/data/bowman.json as Administrator (re-runnable; phases can be named)
node bowman/erp/verify-seed.ts  # read the seed back as Norn and compare with the dataset
node bowman/erp/seed-mbom.ts     # the manufacturing BOM: build stations under each aircraft (after seed.ts; re-runnable)
node bowman/erp/seed-planning.ts # volume plan (Master Production Schedule), built aircraft (Serial Nos), and Norn's read grants for them
node bowman/erp/seed-constraints.ts # the Supplier Constraint doctype and the dataset's 4 supplier constraints (re-runnable)
```

With the tunnel open, browse `http://127.0.0.1:8081` and log in as `Administrator` with `ERPNEXT_ADMIN_PASSWORD` from `.env`. 8081 is used on both ends because the laptop cannot bind 8080.

- A first run took about 22 minutes: roughly 14 minutes pulling about 1 GB of compressed images, then roughly 8 minutes installing the site. A stop then start takes about 40 seconds and keeps all data (verified).
- The compose `restart_policy` is `on-failure`, as upstream. Not tested: whether the stack returns by itself after a Mac or Colima restart. Run `up.sh` if it does not.
- Passwords are read only when the site is first created. Changing `ERPNEXT_ADMIN_PASSWORD` in `.env` later does not change the login. The MariaDB root password is generated on the Mac in `~/bowman/erp/.env` (mode 600) and is not kept anywhere else.
- Deleting the volumes destroys the data. There is deliberately no wipe command in `up.sh`.

## The Norn Agent role and user

User `norn@bowman.example` (System User, only role `Norn Agent`, no password, API key and secret in `.env` as `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET`). Auth: `Authorization: token <key>:<secret>`. Permissions are added with the Role Permissions Manager endpoints (`frappe.core.page.permission_manager.permission_manager.add` and `.update`), which copy a doctype's stock permissions into Custom DocPerm before adding ours.

**Norn drafts, people submit (Tyler, 2026-10-25, reversing #71).** A released ECO carries an ERP change package: every line, with exact values, traced to the ECO and Norn's decision (`norn/connectors/erpnext/src/package.ts`, #72, #73). Norn creates the new BOM versions and the journal entries as unsubmitted drafts (docstatus 0) carrying `bw_eco`, `bw_decision_url` and, on journal entries, `bw_eco_entry`; a person reviews and submits them. So the role holds create, read and write on BOM and Journal Entry, and no submit, cancel, amend or delete anywhere. On every other doctype it holds `read` and nothing else: Item, Item Price, Supplier, Supplier Quotation, Purchase Order, Purchase Receipt, Bin, Stock Ledger Entry, GL Entry, Version, Company, Warehouse, Price List, Account, and (added by `seed-planning.ts`, #40) Workstation, Master Production Schedule and Serial No. Norn reads the custom fields it needs (the ECO tag fields) with the same read permission.

Until 2026-10-24 the role also held write, create and submit on BOM, write and create on Item Price, create on Journal Entry, and read, create and submit on BOM Update Log, as verified in the table below. `bootstrap.mjs` no longer grants them and now turns off any write, create, submit, cancel, amend or delete permission the role still holds, leaving read alone. **Not run against the live instance yet** (this change was made without contacting it): until `bootstrap.mjs` is run once more, the stored role keeps those old grants. `verify.mjs` step 7c checks that Norn's writes are refused (403), and has not been run either.

From 2026-10-24 to 2026-10-25 the role held `read` only (#71). Since 2026-10-25 it holds create, read and write on BOM and Journal Entry again, and still no submit, cancel, amend or delete. ERPNext refuses Norn's submit with a permission error; `prove-no-submit.ts` shows this with Norn's own credentials.

| Doctype | read | write | create | submit | cancel / amend / delete |
|---|---|---|---|---|---|
| BOM, Journal Entry (since 2026-10-25) | yes | yes | yes | no | no |
| Everything else above | yes | no | no | no | no |
| Before 2026-10-24: BOM | yes | yes | yes | yes | no |
| Before 2026-10-24: Item Price | yes | yes | yes | n/a | no |
| Before 2026-10-24: Journal Entry | yes | no | yes | no | no |
| Before 2026-10-24: BOM Update Log | yes | no | yes | yes | no |

Verified as the Norn user before the change: it could not submit a Journal Entry (403, draft stays draft), create an Item, cancel or delete a BOM, or read other users. It cannot read Cost Center or Fiscal Year. It can read UOM and Item Group (ERPNext default) and its own User record. Purchase Receipt read gives the receipt dates that make up realised lead times; Account read lets Norn check the accounts a change package names.

## Verified call sequence (ECO release)

The order in which an ECO's documents are entered, and why. Since 2026-10-25 Norn creates steps 3 and 7 as drafts and a person submits them (a BOM whose rows point at another new, unsubmitted BOM is left for the person, because ERPNext only lets a BOM use a submitted BOM); a person does the rest in the ERPNext screens following the change package; the REST calls are what `verify.mjs` makes, as Administrator since 2026-10-24 (they were verified as the Norn user, when it could write). Base `ERPNEXT_URL`, JSON bodies; token auth for the reads in steps 1 and 8, a login session for the writes. Test items were a finished good `TOP` whose BOM uses a sub-assembly `SUB`, with purchased parts `P1-P3`.

1. **Read.** `GET /api/resource/Item/<code>` gives `valuation_rate`, `last_purchase_rate`, `lead_time_days`, `min_order_qty`, `safety_stock`. Frappe leaves out null fields, so `default_bom` is absent until a BOM exists. `GET /api/resource/BOM?filters=[["item","=","SUB"],["docstatus","=",1]]&fields=["name","is_active","is_default","raw_material_cost","operating_cost","total_cost"]` works as in the research. Exploded BOM `GET /api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_items?bom=&company=&qty=1&fetch_exploded=1` and `...bom.get_bom_diff?bom1=&bom2=` work for Norn.
2. **Standard cost.** `POST /api/resource/Item Price` `{"item_code","price_list":"Standard Cost","price_list_rate":12,"buying":1,"currency":"USD","valid_from":"2026-07-01"}`. To supersede: `PUT /api/resource/Item Price/<name>` `{"valid_upto":"2026-06-30"}` first, then POST the new row (both accepted).
3. **New BOM.** `POST /api/resource/BOM` `{"item":"SUB","quantity":1,"company":"Bowman Aviation","currency":"USD","uom":"Nos","is_active":1,"is_default":1,"rm_cost_as_per":"Price List","buying_price_list":"Standard Cost","items":[{"item_code":"P1","qty":2,"uom":"Nos"},{"item_code":"P2","qty":1,"uom":"Nos","bom_no":"<only for a sub-assembly row>"}]}`. Returns `BOM-<item>-00N` with `raw_material_cost` already computed from the price list (for the dates valid today). Three ways to submit, all verified:
   - add `"docstatus":1` to the POST body (one call);
   - `PUT /api/resource/BOM/<name>` `{"docstatus":1}` (no `modified` needed);
   - `POST /api/method/frappe.client.submit` `{"doc": <the whole doc returned by the POST>}`.
   Submitting makes the new BOM the default and clears `is_default` on the old one; `Item.default_bom` follows.
4. **Replace in parent assemblies** (only if the changed item is a sub-assembly). `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom` `{"boms":{"current_bom":"<old>","new_bom":"<new>"}}`. Returns a submitted BOM Update Log with `status:"Queued"`; it reached `Completed` within seconds. The parent BOM's sub-assembly row then points at the new BOM and its costs are recalculated, with a Version row labelled "via BOM Update Tool". The new BOM must be submitted and active, for the same item, company and currency.
5. **Retire the old BOM.** `PUT /api/resource/BOM/<old>` `{"is_active":0}`. **Do this after step 4, not before** (see differences). For a top-level item with no parent BOMs, step 4 is skipped and this works right after step 3.
6. **Recost (optional).** `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_update_cost`, no body. It recosts every active BOM in the system, not one. It returns at once with `Queued`; ERPNext then advances one BOM level per run of a 15-minute cron, so a two-level tree took about 11 minutes. Step 3 already costs the new BOM and step 4 already recosts its parents, so the change package does not include this call.
7. **Journal Entry.** `POST /api/resource/Journal Entry` `{"voucher_type":"Journal Entry","company":"Bowman Aviation","posting_date":"2026-10-24","user_remark":"...","accounts":[{"account":"51900 - Inventory Shrinkage and Adjustments - BWA","debit_in_account_currency":100},{"account":"21210 - Accrued Expenses - BWA","credit_in_account_currency":100}]}`. Returns `docstatus:0`, number `ACC-JV-<year>-00001`; cost center `Main - BWA` is filled in.
8. **History.** `GET /api/resource/Version?filters=[["ref_doctype","=","BOM"],["docname","=","<name>"]]&fields=["name","creation","owner","docname","data"]&order_by=creation asc&limit_page_length=0`; same for `Item Price`. `data` is a JSON string.

## Seed (2026-10-24)

`seed.ts` reads `bowman/data/bowman.json` (PR #51) and creates everything through REST as Administrator, in phases `fields masters prices boms pos receipts stock`. Every phase looks up what exists first, so a second run created nothing (verified). A full run takes about 8 minutes, most of it the 222 purchase receipts. `verify-seed.ts` then reads it back as Norn and passed all checks.

| Loaded | Count |
|---|---|
| Items | 214 (47 make, 167 buy), 17 item groups, 3 proposed items disabled |
| Suppliers | 14 |
| Item Price on `Standard Cost` | 225 rows: 214 current plus 11 earlier rows for items an ECO repriced |
| Item Price on `Standard Buying` | 172 supplier quotes (price p50, lead time p50 in days) |
| Item Price on `Standard Cost before ECO-xxxx` | 80 rows in 10 price lists, used only to cost earlier BOM versions |
| BOMs | 47 items, 62 submitted versions (15 earlier versions, inactive), all costed from a price list |
| Purchase orders | 144 (42 open, 102 received), 386 lines, 222 purchase receipts |
| Stock | 192 opening rows and 71 reconciliation rows in 7 entries; 293 Bins |
| Custom fields | 24 (listed in `seed.ts`) |

Verified as Norn: Vesper V4's default BOM `BOM-BW-0001-000-001` has 12 top-level lines and 125 exploded items, and ERPNext's own `total_cost` is **2,800,019.00** (material 2,720,019 plus operating 80,000), equal to the dataset roll-up. Meridian M6 is 5,007,356.80, also equal. All 47 default BOMs match their item's roll-up to within $1. BW-5120-210: Standard Cost 186.40 from 2025-11-20 (175.20 before), Halden quote 186.40 (p10 182.67, p90 193.86) with a 63-day lead time and MOQ 25, stock Stores 96 / WIP 48 / At Supplier 60, open PO-26-0144 for 60 due 2026-11-02 and 60 due 2026-12-07, and seven realised lead times from 49 to 80 days.

Mapping decisions:

- **Labor is operating cost.** Each work center is a Workstation whose hour rate is its labor rate, filed under the `Wages` operating component (v16 builds the rate from `workstation_costs`; a plain rate field no longer exists), plus one Operation. A make item's BOM has one operation of `laborHours x 60` minutes. Sub-assembly rows take the child BOM's cost, so the roll-up equals the dataset's. Without operations Vesper would read $2.408M.
- **Costing method.** `rm_cost_as_per = "Price List"`, `buying_price_list = "Standard Cost"` on current BOMs. The `Standard Cost` list holds every item (make items too) at the dataset's `standardCost`.
- **Earlier BOM versions** (15, from the 10 released ECOs). Every ECO is a revise-with-price-change, so BOM lines never differ between versions; only cost does. A BOM that directly contains a repriced item gets one version per ECO plus the current one. The earlier versions are inactive and costed from a price list `Standard Cost before ECO-xxxx`, because v16 has no manual rate: `rm_cost_as_per` accepts only Valuation Rate, Last Purchase Rate and Price List ("Manual" raises a server error), and rates sent on BOM rows are overwritten. `bw_eco` and `bw_released_on` on each BOM record the ECO. Not done: the ancestors of an affected BOM are not re-versioned, and version timestamps are the seed time, not the ECO date.
- **Default BOMs.** Each item has one current BOM; it is submitted, active and default, including Vesper's and Meridian's top-level ones.
- **Items.** Code, name and group as in the dataset. "Raw material" maps to ERPNext's existing "Raw Material" (names compare case-insensitively). UOMs: `Nos`, `kg` to `Kg`, `m2` to `Square Meter`, `L` to `Litre`. Revision, lifecycle status, cost group, safety-critical and programs are custom fields. Lead time and MOQ come from the primary quote. The 3 proposed items (ECR-0409's 4-blade parts) are disabled, with prices and no BOM, stock or POs.
- **Supplier prices.** One `Standard Buying` Item Price per quote, valid 2026-01-01 to `priceValidUntil` (the dataset gives no start date). The p10 and p90 price and lead time, MOQ, qualified, sole-source, months to requalify, primary, allocation and capacity are custom fields on Item Price. Supplier performance and the single-source flag are custom fields on the Supplier, and payment terms are text in `supplier_details`; no Payment Terms templates were created.
- **Price history.** An item an ECO repriced has an earlier `Standard Cost` row (valid 2025-01-15 to the day before the ECO) and a current one from the ECO's release date. Supplier quotes have no history; the purchase orders carry the price over time.
- **Purchase orders and receipts.** Each PO keeps its order date, required dates and unit prices, and its dataset id in `bw_po_id` (ERPNext numbers them itself). Each received line becomes a Purchase Receipt on its received date, one per PO and date, created in date order so ERPNext needs no backdated stock repost. Receipt date minus PO date is the realised lead time.
- **Stock.** Stores, Work In Progress and Finished Goods quantities map to the three stock warehouses; `supplierFinished` goes to a new `At Supplier - BWA` warehouse; `onOrder` is not stock (open POs fill the Bin `ordered_qty`, which equals `onOrder + supplierFinished`); `inField` (installed on aircraft) is not loaded. Items never received on a PO got an Opening Stock entry dated 2025-01-14 against `Temporary Opening`. The rest were set to the dataset quantity by a Stock Reconciliation dated 2026-10-24, with the difference posted to Cost of Goods Sold. Valuation rate is the standard cost, so FIFO or moving-average valuation will drift from it once ERPNext starts moving stock.
- **Volume plan and built aircraft** are loaded by `seed-planning.ts`, not `seed.ts`: the volume plan as one Master Production Schedule (`MPS26-000001`, planned units per month and program), and the ten built Vespers as Serial Nos `VESPER-001` to `-010` with the completion date as `posting_date` (no stock entry, so the reconciled stock is unchanged). Details in `norn/connectors/erpnext/NOTES.md`.
- **Not loaded** (no natural ERPNext home, or Norn takes them from the PLM side): people, change-control policy, NCRs, ECRs, ECOs as documents, rate factors, scenarios. Supplier constraints are loaded by `seed-constraints.ts` (next section).
- **GL side effects.** The receipts credit `Inventory Received But Not Billed` and nothing clears it, because no purchase invoices were created. Reconciliation differences sit in Cost of Goods Sold and Temporary Opening.

## Supplier constraints (2026-10-24, #89)

A supplier's limits on what Bowman can buy: Orrin qualifies one UH-grade part number per quarter, Vantage commits 180,000 cells for 2027, Aurelio has 2 turbogenerator build slots in 2028. A real maker's purchasing team keeps these where it keeps its suppliers, because they come out of supplier agreements and change when a buyer renegotiates. ERPNext has no doctype for them, so `seed-constraints.ts` (Administrator, REST, re-runnable) adds one, the way a customer would with the Customize UI:

- **Supplier Constraint** (custom doctype, module Buying, named by its constraint id, e.g. `CON-ORRIN-UH-SLOT`): `supplier` (Link to Supplier), `kind` (`qualification_slot` or `capacity`), `items` (child table **Supplier Constraint Item**, one Link to Item per row), `description`, `window_from` and `window_to`, `capacity_per_year`, `slot_cadence_months`, and the bundle terms `bundle_within_weeks`, `bundle_second_qualification_discount`, `bundle_price_break` (fractions: 0.4 is 40%). Purchase Manager can edit, Purchase User and Norn Agent can read. Norn has read and nothing else, as on every doctype but BOM and Journal Entry.
- **Seeded:** the dataset's 4 constraints (`CON-ORRIN-UH-SLOT`, `CON-ORRIN-UH-CAPACITY`, `CON-VANTAGE-ALLOC`, `CON-AURELIO-SLOT`), the supplier set to the ERPNext name ("Orrin Magnetics") by the id-to-name map `seed.ts` uses. A second run created nothing. The dataset has no cadence or bundle numbers, only the description text, so those fields are empty and the supply check reads the description. The provenance (`prov`, "invented") is not loaded.
- The connector reads the doctype when `supplierConstraints` is set in the ERPNext settings (`bowman/norn-config/erpnext.ts`); `norn/connectors/erpnext/NOTES.md` has the read side. Adding the doctype changes the baseline hash: the baseline now carries `supplierConstraints`.
- Not tested: whether the doctype survives a `bench migrate` or an app update (it is a custom doctype, stored in the database like a Custom Field, so it should); how it renders in the desk UI.

## Manufacturing BOM (2026-10-24)

The PLM keeps the engineering BOM (the dataset's `bom`); the ERP holds the manufacturing BOM, `mbom` in `bowman/data/mbom.ts`. Only each program's top level differs: every sub-assembly BOM, leaf part and exploded quantity is the same. `seed-mbom.ts` (phases `items stations tops`, as Administrator) adds:

- Item group `Build stations` and 8 non-stock make items, `BW-0001-S10` to `S40` (Vesper) and `BW-M000-S10` to `S40` (Meridian): 10 structure join, 20 propulsion and energy install, 30 systems and avionics, 40 interior and final. Each has a `Standard Cost` price, a submitted BOM of the top-level children built there, and one operation: its share of the aircraft's own final-assembly hours (Vesper 120/200/220/100 = 640 h, Meridian 180/280/260/180 = 900 h).
- A new default BOM per aircraft listing the four stations, with no operations of its own. The old top BOM is then set inactive (the aircraft has no parent BOM, so the replace-in-parents step does not apply).
- ERPNext's own `total_cost` is unchanged: Vesper **2,800,019.00**, Meridian **5,007,356.80** (before and after, printed by the seed). The connector check expects the ERP as `erpnextCheck.view` in `bowman/norn-config/erpnext.ts` describes it (the dataset with `mbom` swapped in and no labor on the aircraft items); `bowman/data/check.ts` checks exploded leaf quantities and roll-ups against the engineering BOM.

Check-versus-dataset differences that are not errors: the volume plan has 102 rows against the dataset's 130 (the dataset has one row per site, the Master Production Schedule one per month and program), and stock has 211 rows against 209 (the two aircraft items are stock items with no dataset stock row). The cost check's p50 on the ERP baseline can differ from the dataset's by about 0.1% (ECR-0417 per-Vesper delta 415.20 against 415.15): its Monte Carlo draws are keyed by the name of the correlation group (`supplier:Halden Precision` against `supplier:SUP-HALDEN`), so renaming a supplier re-rolls the draws. Other seeds on the dataset alone give 415.11 to 415.27. The ERP baseline names suppliers by their ERPNext names on purpose: the PLM connector maps the PLM's supplier names to them.

## Differences from the research doc

1. **Retire-then-replace fails for sub-assemblies.** Research section 6 retires the old BOM (step 4) before replacing it in parents (step 5). `PUT is_active:0` on a BOM that an active parent BOM uses returns 417 "Cannot deactivate or cancel BOM as it is linked with other BOMs". Replace first, then retire.
2. **Replace and recost need BOM Update Log rights** (read, create, submit), not just BOM write. The research says this in section 7; the brief's grant list did not include it. Norn no longer makes these calls, so nothing but the person's own role needs those rights.
3. **One-shot submit works.** Section 6 marked "posting with `docstatus:1` in one call" as unknown; it works, as does `PUT {"docstatus":1}`.
4. **Overlapping Item Price rows are accepted.** Section 6 left this unknown. With the old row left open (no `valid_upto`), a second row with a later `valid_from` was accepted, and BOM costing used the newer row. Closing the old row first is still cleaner.
5. **Update Cost is slow and global** (step 6 above); the research implied a direct recost.
6. **History format.** A Version `data` string holds `added`, `changed`, `removed`, `row_changed`, `updater_reference`. Dates in `changed` use `mm-dd-yyyy` (`["valid_upto",null,"06-30-2026"]`), not ISO, and currency values are formatted (`"$ 44.00"`). No Version row exists for an insert (confirmed for BOM and Item Price). A BOM submit writes a row whose `added` holds the generated `exploded_items`, and `changed` holds `docstatus` 0 to 1. Setting `is_active` to 0 writes `[["is_active",1,0]]`. `get_bom_diff` shows currency fields as strings too.
7. **Key generation.** `generate_keys` accepts POST only and returns `{"api_key","api_secret"}`. Called with a JSON body `{"user": "..."}`.
8. **Custom DocPerm.** The research suggested POSTing Custom DocPerm rows directly. Frappe's `add_permission` source copies the stock rows first because Custom DocPerm rows replace a doctype's stock permissions entirely; posting directly would drop every other role's access to that doctype (read from source, not tested). The Role Permissions Manager endpoints avoid that.
9. **Setup wizard over REST works.** `POST /api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete` with `{"args": "<json string>"}` (language, country, timezone, currency, company_name, company_abbr, chart_of_accounts `United States - Chart of Accounts`, fy_start_date, fy_end_date) ran synchronously in about 2 minutes. Cookie-authenticated writes also need an `X-Frappe-CSRF-Token`, which `erp.mjs` takes from the `/app` page; token-authenticated calls do not.

## Gotchas found

- **Scheduler did not run until 17:15.** The Scheduled Job Types are created at install in a different time zone from the one the wizard then sets, so their `creation` was hours in the future and ERPNext (which times the next run from `creation` while `last_execution` is empty) ran nothing, including the BOM cost cron. `bootstrap.mjs` sets `last_execution` on those 84 rows; a fresh site needs that step again.
- `verify.mjs` was run on the empty instance before seeding. On the seeded one its `ZZ-` test items do not collide, but its `enqueue_update_cost` call would recost the real BOMs. It removes everything it creates: documents, Version rows, Deleted Document rows and "Deleted" comments. Frappe also winds a naming series back when the last document in it is deleted, so counters are as before (every run produced `ACC-JV-2026-00001`).
- Not tested: `if_owner` rules, whether Norn can read the Version rows of a doctype it cannot read, a Mac or Colima restart, Supplier Quotation reads (none exist), GL Entry and Stock Ledger Entry reads beyond access (458 and 486 rows now).
