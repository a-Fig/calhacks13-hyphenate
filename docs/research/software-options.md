# Software options for Bowman: PLM, ERP and ledger

Researched 2026-10-24 by a Sonnet research agent from project docs, source code and Archer job postings. Nothing was installed or run.

**Legend.** **R** = read in a primary source (project docs, source code, job posting). **I** = inferred, not read. **U** = not verified.

**Scope.** Bowman is a fictional electric-aircraft maker modeled on Archer Aviation. It needs one PLM (design, BOM, ECR/ECO workflow), one ERP/MRP (purchasing, inventory, planning, standard cost) and one accounting ledger (GL, journal entries). Preference: open-source or very hackable software we can run and integrate in hours, that still looks like what a real company runs (SAP, Siemens Teamcenter, PTC Windchill, Oracle, NetSuite). The change flow is NCR -> ECR -> ECO.

---

## 1. Comparison table

| Candidate | BOM revisions | Native ECR/ECO | Std cost / rollup | Suppliers, lead time, price | API and auth | Local run | Sample data | License | Judge realism |
|---|---|---|---|---|---|---|---|---|---|
| **ERPNext v16** (v16.52.1, 2026-10-22) | No revision field. A submitted BOM is locked, so you cancel, duplicate and resubmit (R, [BOM docs](https://docs.frappe.io/erpnext/user/manual/en/bill-of-materials)). The BOM Update Tool has "Replace BOM" and "Update Cost" jobs (R, `bom_update_log.py`). `get_bom_diff(bom1, bom2)` is whitelisted (R, `bom.py` v16). | **No.** The only mention is closed issue [#28267](https://github.com/frappe/erpnext/issues/28267), a 2021 request for ECR/ECO that says "ERPNext does not have the PLM functionality". Checked: the BOM docs page, the `manufacturing/doctype` listing (on `develop`), and a GitHub search for Frappe/ERPNext PLM apps (nothing credible). I did not browse the full docs sidebar. | The BOM has `rm_cost_as_per` (Valuation Rate, Last Purchase Rate or Price List) and `update_cost` (R). Item valuation is FIFO, Moving Average or LIFO in v15 and v16. "Standard Cost" exists only on `develop` (R, `item.json` per branch). | Item has `lead_time_days`, `min_order_qty`, `safety_stock`, `last_purchase_rate`, `valuation_rate`, `default_bom`. Item Price has `supplier`, `lead_time_days`, `price_list_rate`, `valid_from`/`valid_upto`. Supplier Quotation Item has `lead_time_days` (all R, doctype JSON). | REST at `/api/resource/<DocType>` and `/api/method/...`. Auth is `Authorization: token key:secret`, session cookie or OAuth bearer (R, [REST docs](https://docs.frappe.io/framework/user/en/api/rest)). | `docker compose -f pwd.yml up -d`, wait a couple of minutes, login `Administrator`/`admin`. It is a disposable demo that cannot take custom apps (R, [frappe_docker](https://github.com/frappe/frappe_docker)). | The demo company generator ships only Items, Customers and Suppliers (R, `setup/demo_data`), with no BOMs. You seed your own. | ERPNext GPL-3.0, Frappe MIT. | Moderate. A recognised open-source ERP, with a real GL. |
| **Odoo Community 20.0** | None. `mrp.bom` has no version field (R). | **No.** `mrp_plm` is absent from the community `addons/` listing (R). | `mrp_account` has `button_bom_cost` (rollup) and `standard_price` (R). | `product.supplierinfo` has `min_qty`, `price`, `delay` (R). | JSON-2 at `POST /json/2/<model>/<method>` with a bearer API key (R). The docs say external API access needs a *Custom* plan on Odoo Online. Self-hosted Community is presumably unaffected (I). | Official Docker image `odoo:20.0`, updated 2026-10-17 (R, Docker Hub). | None needed. | LGPL-3 (R, LICENSE). | Moderate. |
| **Odoo Enterprise** | Yes, via ECO plus a BOM revision (R, [ECO docs](https://github.com/odoo/documentation/blob/master/content/applications/inventory_and_mrp/plm/manage_changes/engineering_change_orders.rst)). | **Yes.** ECO types and stages, approvals, effective date, "Start Revision" copies the BOM. | As Community, plus full Accounting (`account_accountant`, absent from the community repo, R). | Same as Community. | Same as Community. | Needs a paid subscription or trial. The docs do not state the edition (R), but the Odoo blog and editions-page search put PLM on the Enterprise side. I'd treat it as Enterprise-only. | Trial data (U). | Proprietary. | Good, but no code access and licensing friction. |
| **Aras Innovator Community** (2025 Release) | Yes. Product Engineering ("parts, BOMs, product documentation") is included in the install (R, [2025 release notes](https://aras.com/wp-content/uploads/2025/06/Aras-Innovator-2025-Release-Release-Notes.pdf)). | The Aras platform has PR, ECR, ECN, ECO and MCO item types (R, [ArasLabs/change-management-actions](https://github.com/ArasLabs/change-management-actions)). **Whether the Community Edition ships Change Management is U.** The release notes list only Product Engineering as included. | None. It is PLM, not ERP. | Not applicable. | OData REST at `/server/odata/Part`, with `$filter`, `$expand` and `[Part BOM]` (R, [2025 RESTful API PDF](https://aras.com/wp-content/uploads/2025/06/Aras-Innovator-2025-Release-RESTful-API.pdf)). Auth is OAuth 2.0 (R). | Windows or Windows Server, IIS, SQL Server 2016-2022, .NET, 16 GB RAM minimum, and a license key that must be requested and is bound to a MAC address (R, Aras docs and [download page](https://aras.com/en/download)). Up to 50 named users. No official Docker path found; a community thread mentions one, which I could not open (403). | None found. | Proprietary community license (U, agreement not read). | **High**: Aras competes with Teamcenter. |
| **Kosha PLM 1.0.0rc1** ([repo](https://github.com/kishor-desarda/Kosha)) | Yes: revisions A, B, C, lifecycle In work -> In review -> Released -> Obsolete, BOM compare, as-of-date and as-built BOM views (R, README and `bom-views-and-cost.md`). | **Yes: ECR-26-nnnn -> ECO-26-nnnn**, approval routes, effectivity "when implemented", "from a date", "from a serial" or "immediately" (R, `docs/changes.md`). Also NCRs, CAPA and FMEA (R, README). | A "cost roll-up" is documented. Cost is read back from the ERP. | Not its job. | REST at `/api/v1/...`, OpenAPI at `/api/openapi.json`, cursor paging, `Idempotency-Key`, `If-Match` (R, `api-rules.md`). | `pip install` then `python -m kosha --demo`, or `docker compose up`. Port 8080 is the default (R), so remap it. | Demo company makes mixers, conveyors and pumps. | AGPL-3.0. | Low name recognition. |
| **Tryton** | No; `production.bom` has only an active flag (R). | No PLM module in `modules/` (R). | `product` has cost price methods (R). | `purchase.product_supplier` has `lead_time` (R). | JSON-RPC (U). | Not checked. | None checked. | GPL-3 (I). | Low. |
| **Dolibarr 24.0.1** | BOM status is Draft, Enabled or Disabled; no revisions (R). | No (I, no BOM revision or change object seen). | Basic. | Basic. | REST (`api_boms`, `api_products` exist, R). | Not checked. | None checked. | GPL-3.0. | Low. |
| **iDempiere** | U | None found by file-name search of the tree (I). | U | U | U | Java/OSGi and PostgreSQL (R, README). Heavy. | U | GPL-2.0. | Low-moderate. |
| **ADempiere** | U | U | U | U | U | U | U | GPL-2.0. | Last release 2023-12-20 (R). |
| **OpenPLM / DocDokuPLM** | Not evaluated. | Not evaluated. | N/A | N/A | N/A | N/A | N/A | MIT (`openPLM/openPLM`), AGPL (DocDoku). | Not credible. `openPLM/openPLM` is a 2026 "CPG/Retail PLM" with 0 stars, unrelated to the old OpenPLM. DocDokuPLM was last pushed 2021-05-10. |
| **Ledgers** | | | | | | | | | |
| Formance Ledger | N/A | N/A | N/A | N/A | HTTP/gRPC; v2.4.16 (2026-10-21) while `main` is a v3 Raft rewrite (R) | Not checked. | N/A | Not shown by the API. | A ledger primitive, not a GL. |
| TigerBeetle | N/A | N/A | N/A | N/A | Client libraries. | N/A | N/A | Apache-2.0, 0.17.9. | A ledger primitive, not a GL. |
| Beancount / Fava | N/A | N/A | N/A | N/A | Text files plus a web UI. | N/A | N/A | GPL-2.0 / MIT. | Hackable but not credible as a company GL. |

I did not read the Aras Community license agreement or the Odoo editions page's PLM row (it was blank in the retrieved text).

### What real aerospace/eVTOL companies run (Archer specifically)

Archer evidence (R, Archer's Greenhouse postings, fetched 2026-10-24, [board](https://job-boards.greenhouse.io/archer56)):
- The Senior Application Engineer, PLM/Teamcenter posting lists Teamcenter "Foundation, Change Management, NX Integration, MPP/Easy Plan".
- The Principal Solution Architect - Supply Chain Systems posting names SAP S/4HANA (MM, SD, EWM, PP, TM, GTS, Ariba), plus IBP, Palantir, BTP, Workato and Mendix.
- The Staff Supply Chain System Analyst posting names MRP Live and ePP/DS.
- The Staff Manufacturing Systems Analyst posting names SAP PP-PEO (shop floor orders, product costing).
- The Cost Analyst posting says "Develop, implement, and maintain standard costs in SAP".
- The Configuration Management postings say effectivity is managed in the PLM system.
- I found no Archer posting naming Windchill, NetSuite or Oracle.

Other eVTOL companies (web search snippets, not fetched in full):
- Joby postings name 3DEXPERIENCE (ENOVIA/CATIA/DELMIA) and Dynamics 365.
- Wisk and Lilium posted Teamcenter roles.
- BETA names Plex ERP and has an "Engineering Change Planner" role.

Postings change and expire; re-check before quoting.

---

## 2. Recommended stack for Bowman

| Role | Pick | Stands in for |
|---|---|---|
| PLM (BOM revisions, NCR/ECR/ECO, effectivity) | **Kosha** on a 30-minute go/no-go (else a fallback below) | Siemens Teamcenter |
| ERP/MRP (purchasing, inventory, planning, cost) | **ERPNext v16.52.1** via frappe_docker `pwd.yml` | SAP S/4HANA (MM, PP, MRP Live) |
| GL / journal entries | **ERPNext's own GL**. No separate ledger. | SAP FI/CO |

**Why ERPNext.** It is the only candidate that covers ERP, MRP and a real chart of accounts and Journal Entry in one container stack. Odoo Community lacks both PLM and full Accounting. Aras has no ERP. A separate ledger such as Formance or TigerBeetle would add an integration seam and nothing finance judges would recognise as a GL. S/4HANA is itself ERP plus GL in one system, so one ERPNext standing in for SAP is realistic.

**Why Kosha, with reservations.** It is the only open-source option found that natively has ECR -> ECO, NCR, BOM revisions, effectivity (date or serial) and an OpenAPI REST API. It also pushes released items and BOMs to ERPNext over ERPNext's REST API (R, its ERPNext connector README). That mirrors Bowman's real PLM -> ERP release flow. The risks are real:
- The repo is 11 days old, has 1 star, and the contributors are one person and "claude".
- It is a release candidate and has not been run.
- Its demo data is not aircraft.
- Nobody will recognise the name.

### Integration surface (ERPNext, base `/api/resource/...`)

- **BOM list:** `GET /api/resource/BOM?filters=[["item","=","BWM-1000"],["docstatus","=",1]]&fields=["name","item","is_active","is_default","raw_material_cost","operating_cost","total_cost"]`.
- **BOM detail:** `GET /api/resource/BOM/<name>` returns the `items` child table (BOM Item: `item_code`, `qty`, `rate`, `amount`, `bom_no`).
- **Exploded BOM:** `GET /api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_items?bom=&company=&qty=1&fetch_exploded=1`.
- **BOM diff:** `GET /api/method/erpnext.manufacturing.doctype.bom.bom.get_bom_diff?bom1=&bom2=`.
- **Item cost and supply:** `GET /api/resource/Item/<code>` returns `valuation_rate`, `last_purchase_rate`, `lead_time_days`, `min_order_qty`, `safety_stock`, `default_bom`.
- **Supplier price and lead time:** `GET /api/resource/Item Price?filters=[["buying","=",1]]&fields=["item_code","supplier","price_list_rate","lead_time_days","valid_from","valid_upto"]`.
- **Open POs and quotes:** `Purchase Order`, `Supplier Quotation`.
- **Stock on hand:** `Bin` (I; schema not read).
- **Simulating an ECO's effect:** `POST /api/resource/BOM Update Log` with `update_type` "Replace BOM" or "Update Cost", `current_bom` and `new_bom`. This is a write, so it is for the demo's "merge", not the forecast. See section 4 for the preferred call path.
- **Agent-proposed accounting:** `POST /api/resource/Journal Entry` as a draft, read back through `GL Entry`.
- **Standard cost gap:** v16 has no Standard Cost valuation method. Use a "Standard Cost" Price List with `rm_cost_as_per = "Price List"` (I).
- **Kosha:** `GET /api/v1/items`, change requests and change orders under `/api/v1/...`. The exact route names are U, so read `/api/docs` once it is running. BOM view: `GET /api/items/{id}/bom/view?view=released|in_work|as_of`.

### Setup estimate (mine, not measured)

- ERPNext to first login: 15-30 minutes, mostly image pulls.
- Seeding about 40 aircraft parts, suppliers, price lists, BOMs and purchase orders over REST: 1.5-2.5 hours.
- Kosha spike: 30 minutes to decide, then 1-2 hours to reseed with aircraft data and ECRs.

---

## 3. Fallbacks

1. **Kosha fails the 30-minute spike.** Build ECR and ECO as custom DocTypes in the same ERPNext, with Frappe's built-in Workflow (states, transitions and roles, R via search snippets and ERPNext workflow docs). Fields: ECR text, NCR reference, affected-items table (item, old BOM, new BOM), status, effectivity date. Cost: 1.5-3 hours. Creating custom DocTypes via REST without developer mode is I, not verified. The downside is that PLM and ERP are visibly the same product.
2. **Fastest and safest.** A small TypeScript server serving seeded JSON shaped like Aras OData (`/server/odata/Part`, `Part BOM`, `ECR`, `ECO`; R from the Aras REST PDF). Label it "Bowman PLM". Cost: 1-2 hours.
3. **ERPNext itself fails.** Mock its REST shape. The `{data: [...]}` envelope and field names above are documented, so seeded JSON behind Mockoon or a Hono server is a drop-in.

---

## 4. Risks and unknowns

- **Port 8080.** `pwd.yml` and Kosha both publish it, and the laptop cannot bind it. Use a copy of the compose file with `"8081:8080"`. The pwd.yml image pins `frappe/erpnext:v16.52.1` and `mariadb:11.8` (R).
- **Docker.** Docker Desktop appears to be on the PATH, but I did not check that the engine runs.
- **Aras.** It needs Windows, IIS, SQL Server and a license key whose issuance time I could not establish. It is the most credible PLM name but I would not bet the day on it.
- **Kosha.** Possibly AI-generated code and unproven by anyone else. The ERPNext connector is a Frappe app that `pwd.yml` cannot install; the REST sync appears not to require it (R, connector README).
- **ERPNext gaps.**
  - There is no ECO feature, no standard-cost variance accounting (PPV) and no BOM revision numbers (revision naming such as `BOM-<item>-001` is R in `BOM.autoname`, see section 5).
  - Finance judges who know SAP may notice the missing standard-cost mechanics.
  - Check `develop` for the Standard Cost valuation method if that matters; it is not in v16.
- **Odoo Enterprise.** PLM and Accounting need Enterprise. I did not find a way to get a free hosted trial with API access.
- **Archer postings.** They are a snapshot and can expire.

Sources: [ERPNext](https://github.com/frappe/erpnext), [frappe_docker](https://github.com/frappe/frappe_docker), [Frappe REST](https://docs.frappe.io/framework/user/en/api/rest), [Odoo](https://github.com/odoo/odoo), [Odoo docs source](https://github.com/odoo/documentation), [Aras download](https://aras.com/en/download), [Aras 2025 release notes](https://aras.com/wp-content/uploads/2025/06/Aras-Innovator-2025-Release-Release-Notes.pdf), [Aras REST PDF](https://aras.com/wp-content/uploads/2025/06/Aras-Innovator-2025-Release-RESTful-API.pdf), [Kosha](https://github.com/kishor-desarda/Kosha), [Archer Greenhouse board](https://job-boards.greenhouse.io/archer56).

---

## ERPNext history, write-back and permissions

Findings are from Frappe and ERPNext source on the `version-16` branch head (the `frappe/frappe` and `frappe/erpnext` repos), not the exact v16.52.1 tag. Nothing was run. R, I and U are as defined at the top.

### 5. History

**Version doctype and `track_changes`**
- **What it stores:** `Version` has `ref_doctype`, `docname` and `data` (R, `version.json`). `data` is a diff:
  - `changed [[field, old, new]]`
  - `added`
  - `removed`
  - `row_changed`
  - `updater_reference`
- **Which doctypes are tracked:** `track_changes=1` on BOM, Item and Item Price (R). The setting is absent from the Purchase Order, Purchase Receipt, Supplier Quotation, Journal Entry, GL Entry and Stock Ledger Entry JSON (R).
- **Gaps in the history:**
  - No Version row is written on first insert unless `updater_reference` is set (R, `document.py` `save_version`). Initial values have to be rebuilt by rewinding diffs (I).
  - Code, HTML and text-editor fields are on a blacklist in `get_diff` (R). I did not read how it is applied.
- **Who can read it:** only System Manager and Administrator by default (R). The API role needs an explicit read grant.

**BOMs and amendments**
- **Submitted BOMs are locked:** the only `allow_on_submit` fields are `is_active`, `is_default`, `rm_cost_as_per`, `buying_price_list` and website fields (R, `bom.json`). Items cannot change.
- **Cancel:** sets `docstatus` 2 and `is_active`/`is_default` to 0 (R, `bom.py` `on_cancel`).
- **Amend:** a new draft with `amended_from` pointing at a cancelled doc (R, `validate_amended_from`).
- **Amended names:** the default is a numeric suffix such as `-1` (R, `naming.py` `_set_amended_name`). A site setting can switch it to "Default Naming". I did not read that setting's docs (U).
- **A new revision is not an amendment:** `BOM.autoname` yields `BOM-<item>-001`, `-002` and so on, counting only BOMs with no `amended_from` (R).
- **Default flips are not versioned:**
  - `set_default()` uses `frappe.db.set` and a raw SQL update (R).
  - `manage_default_bom` uses `frappe.db.set_value` on `Item.default_bom` (R).
  - So "which BOM was default on date D" cannot be rebuilt from Version.
  - Rebuild it from BOM `creation`, `modified` and `docstatus` (I), or record the ECO-to-BOM mapping and timestamp in our own state layer.

**Ledgers**
- **GL Entry and Stock Ledger Entry are not strictly append-only.**
  - On cancel, `make_reverse_gl_entries` UPDATEs the originals to `is_cancelled=1` and inserts reversed debit/credit copies (R, `general_ledger.py`).
  - If the immutable-ledger setting is on, the originals are not flagged, only reversals are added (R). I did not find where the setting lives (U).
  - The Stock Ledger Entry has `is_cancelled` too (R). `stock_ledger.py` has repost logic that can rewrite entries (partly read, U).
- **Purchase Receipt:** submittable, so a cancel moves it to `docstatus` 2 (I).
- **Roles:** GL Entry and Stock Ledger Entry are read-only for all roles (R).

**As-of queries over REST**
- **Field history:** `GET /api/resource/Version?filters=[["ref_doctype","=","Item"],["docname","=","X"]]&fields=["creation","owner","data"]&order_by=creation asc&limit_page_length=0` (R, [REST docs](https://docs.frappe.io/framework/user/en/api/rest)).
- **Ledgers as of D:** filter `posting_date<=D` and `is_cancelled=0` on GL Entry and Stock Ledger Entry (both fields R).
- **Quoted lead times:** `Item Price` has `lead_time_days`, `supplier`, `valid_from` and `valid_upto` (R). `Supplier Quotation Item` has `lead_time_days` (R).
- **Actual lead times:**
  - `Purchase Receipt Item` links back through `purchase_order` and `purchase_order_item` (R).
  - Actual = receipt `posting_date` minus PO `transaction_date`; compare with PO Item `schedule_date` for the promised date. `transaction_date` was not in my field check (I).
  - ERPNext ships "Procurement Tracker" and "Purchase Order Analysis" reports. I read only their names (U).
- **Child tables over REST:** `frappe.client.get_list` takes a `parent` argument (R). Whether `/api/resource/Purchase Receipt Item?parent=Purchase Receipt` works is U.

### 6. ECO approval write-back

1. **Once:** create the Price List `Standard Cost` with `POST /api/resource/Price List` (field names U).
2. **New BOM:** `POST /api/resource/BOM` with `item`, `quantity`, `is_active:1`, `is_default:1`, `rm_cost_as_per:"Price List"`, `buying_price_list:"Standard Cost"` and `items:[{item_code, qty, uom}]`. It returns `BOM-<item>-00N`.
3. **Submit:** `POST /api/method/frappe.client.submit` with `{"doc": <that JSON>}` (R). `manage_default_bom` then clears `is_default` on every other BOM for the item and sets `Item.default_bom` (R). Posting with `docstatus:1` in one call is U.
4. **Retire the old BOM:** `PUT /api/resource/BOM/<old>` with `{"is_active":0}`. This is allowed after submit (R), and the old BOM keeps `is_active=1` otherwise.
5. **Parent assemblies, only if the changed BOM is a sub-assembly:** `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom` with `{"boms":{"current_bom":old,"new_bom":new}}` (R).
   - It needs write on the old BOM and on every ancestor BOM (R).
   - Each parent gets a Version row labelled "via BOM Update Tool" (R, `bom_updation_utils.py`).
6. **Recost:** `POST /api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_update_cost` (R).
7. **Standard cost:** `POST /api/resource/Item Price` with `item_code`, `price_list:"Standard Cost"`, `price_list_rate`, `buying:1` and `valid_from:<effectivity>`. To supersede, `PUT` the old row's `valid_upto`, then POST the new row.
   - The duplicate check includes `valid_from` (R, `item_price.py`), so a different start date is accepted.
   - How overlapping date ranges resolve is U.
   - v16 has no Standard Cost valuation method; it exists only on `develop` (R).
8. **Old BOM afterwards:** yes, still queryable. Unless you cancel it, it stays `docstatus` 1 and readable via `GET /api/resource/BOM/<old>` (R). Cancelling is blocked while other BOMs use it (R, `validate_bom_links`).

### 7. API user permissions

- **Roles and keys:**
  - Create a Role and a User, then call `POST /api/method/frappe.core.doctype.user.user.generate_keys?user=` (R; System Manager only).
  - Per-role rights live in `Custom DocPerm` rows, which is what the Role Permissions Manager writes. That comes from a forum post, not official docs. Creating them over REST is I.
  - `DocPerm` flags include read, write, create, submit, cancel, amend, delete and `if_owner` (R).
- **Do not reuse stock roles.** Defaults would grant too much: Purchase User is `rwcscad` on Purchase Order, Purchase Receipt and Supplier Quotation (R).
- **Item Price write is needed for step 7 of the write-back.** Item Price write exists only for Sales Master Manager and Purchase Master Manager by default (R), so a "read-only Item Price" role cannot publish a standard cost. The role needs write and create on Item Price.
- **BOM:** it needs write and submit (R). Replace BOM also needs write on all ancestor BOMs (R).
- **BOM Update Log:** it needs create and submit (R). Defaults are System Manager and Manufacturing Manager.
- **Draft Journal Entry only:** grant create and write, omit submit, cancel and amend. The submit flag is documented as "Allow user to submit the document" (R). Nothing restricts which accounts the draft touches (I).
- **Version read:** grant read on Version if the agents will use history (R).
- **Docs pages:**
  - [Users and Permissions](https://docs.frappe.io/framework/user/en/basics/users-and-permissions) (read) covers the flags and the Role Permissions Manager, but says nothing about API users.
  - [Role Based Permissions](https://docs.frappe.io/erpnext/user/manual/en/role-based-permissions) and [Permission Types](https://docs.frappe.io/framework/permission-types) turned up in search; I did not read them.
  - API key creation is on the [REST API page](https://docs.frappe.io/framework/user/en/api/rest) (R): generate the key and secret from the user's Settings tab, and a dedicated API user is recommended.
- **Unread:** the permission checks on `enqueue_update_cost`, and whether `expand` on linked docs needs read on the link target.
