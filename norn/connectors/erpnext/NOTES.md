# ERPNext connector

Written 2026-10-24 for issue #40 (the PLM half is separate). Norn's view of a company's ERPNext: one call returns the production baseline in the shape the checks library reads, plus four history reads for agents, and (issues #44 and #73, section "ERP change package") the ERP change package of a released ECO: what a person enters in ERPNext, checked against what is there. The connector only reads; Norn never writes to the ERP (Tyler, 2026-10-24, #71). Plain TypeScript on Node 24 (erasable syntax), no runtime dependencies. Nothing in `src/` names a company; a company supplies its names as options (Bowman's: `bowman/norn-config/erpnext.ts`).

## Run it

The ERP is on Tyler's home-server Mac and reachable only through the laptop's SSH tunnel on `127.0.0.1:8081` (`bowman/erp/up.sh tunnel` starts it; `bowman/erp/NOTES.md` has the rest). The connector reads `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` (the Norn Agent user's token; never Administrator) from the environment or from `ENV_FILE`, default the `.env` at the repo root. A worktree has no `.env`: point `ENV_FILE` at the main checkout's.

```
cd norn/connectors/erpnext && npm install   # typescript and @types/node only
npm run typecheck                           # tsc, strict, erasableSyntaxOnly
npm test                                    # offline: a stubbed REST API (GET only), no ERPNext needed
# from the repo root, with the tunnel open: read the baseline and compare it with the dataset
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON norn/connectors/erpnext/check.ts --config bowman/norn-config/erpnext.ts
# the same, for a released ECO: print its ERP change package and which lines are already entered (reads only)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts
```

The warning flag is only there until `bowman/norn-config/` has a `package.json` with `"type": "module"` (the config session is adding one).

## API (`src/index.ts`)

```ts
readBaseline(opts): Promise<{ baseline, asOf, hash, meta }>
priceHistory(opts, item, priceList?)  -> PricePoint[]   // Item Price rows, oldest first
realisedLeadTimes(opts, item)         -> LeadTime[]     // receipt date minus PO date
openOrders(opts, item)                -> OpenOrder[]    // submitted PO lines with quantity still to come
bomVersions(opts, item)               -> BomVersion[]   // every submitted BOM version with its lines and cost
buildErpChangePackage(conn, settings, release) -> ErpChangePackage  // see "ERP change package" below
formatErpChangePackage(pkg)           -> string                      // the package as markdown
connect(opts)                         // the five reads and erpChangePackage(release) bound to opts
connectionFromEnv(), loadEnvFile()    // the three ERPNEXT_* variables
```

`opts` is `ErpnextSettings & ErpnextConnection & { asOf? }` (`src/options.ts`, each field commented). The settings are the company's price lists, the warehouse-to-stock-location map, the item group that marks a program's top item, the custom-field names, and an optional `fallback`. Every history row carries `ref: { doctype, name }` (a PO row also its PO number from the company's own field, when set), so Norn can cite it.

`asOf` (default today) decides which price rows count as current; `hash` is a sha256 of the baseline alone, with every array sorted and every object key ordered, so equal hashes are equal baselines and a worker can cache on it. `meta` has the read time, request count, row counts, `sources` of the two parts that may not come from ERPNext, and `warnings` (an item with no current standard cost, a program top item with no BOM, an empty volume plan).

Reading is 12 list requests issued together (`fields`, `limit_page_length=0`; child tables with `parent=<doctype>`). Measured against the live ERP through the tunnel: 0.5 to 0.8 s for the whole baseline, and about 1.1 s for the four history reads of one item.

## Mapping

| Baseline | From ERPNext |
|---|---|
| items | `Item` (all, disabled included). `rev`, `status` from custom fields; `standardCost` is the item's row in the standard-cost price list valid on `asOf` (latest `valid_from` wins). `makeBuy` is `make` when the item has an active default submitted BOM. `defaultSupplier` is the `Item Default` for the company. Without a status field a disabled item is `proposed`. |
| items: `laborHours`, `workCenter` | The default BOM's `BOM Operation` rows: minutes / 60 / BOM quantity, summed; the first operation's workstation. |
| workCenters | `Workstation`: name as id (or the field named by `customFields.workCenter.externalId`), `hour_rate` as the labor rate. |
| bom | `BOM Item` rows of default, active, submitted BOMs: `stock_qty` / BOM quantity per parent unit, `idx` as `seq`. |
| sourcing | `Item Price` rows on the supplier price list that have a supplier and are valid on `asOf`. `unitPrice.p50` is the rate, `leadTimeWeeks.p50` is `lead_time_days / 7`; p10/p90, `qualified`, `primary` and `allocation` are custom fields (without them: p10 = p90 = p50, qualified, first row primary with allocation 1). |
| stock | One row per enabled stock item. `Bin.actual_qty` by warehouse via the options' map. `onOrder` is `ordered_qty` summed over warehouses minus `supplierFinished`, because the quantity finished at a supplier is still on its open PO and the checks count it separately. |
| stock: `inField` | Not in ERPNext, so derived: for each program, built aircraft x the item's exploded quantity per aircraft in the current BOM. It assumes every built aircraft matches the current BOM. |
| programs | One per item in the program item group. Id: first entry of the item's programs field, else the item code. Name: `programName(itemName)`, else the item name. |
| volumePlan | The planned quantities of the program top items in a `Master Production Schedule`; month is `delivery_date`'s first 7 characters, rows of one month and program are summed. Default: the company's latest MPS; `productionSchedule` names one. |
| builtAircraft | `Serial No` of the program top items: `posting_date` is the completion date, the trailing digits of `serial_no` the serial (`serialNumber` overrides). |

Suppliers are identified by their ERPNext names (`Tarn Composites`), not by the dataset ids (`SUP-TARN`): the PLM connector maps the PLM's supplier names to the same ERP names, so a quote links to its supplier's price index. The check script maps the dataset's supplier ids to names. A work center is its ERPNext name (`Structure assembly`) unless `customFields.workCenter.externalId` names a Workstation field holding another id; Bowman's holds the dataset id (`WC-STRUCT`), written by `seed.ts`.

## Volume plan and built aircraft: where they come from

Decision (2026-10-24): ERPNext v16 has natural homes for both, so they are seeded there and read back as Norn, not passed in as a side file.
- **Volume plan: Master Production Schedule.** v16 has it (and Sales Forecast, which feeds it). A MPS row is item, `delivery_date`, `planned_qty`: planned production per period, which is what "units completed in the month" is. Sales Forecast would be demand, which is a different number. One MPS holds all programs (`MPS26-000001`, 102 rows: 51 months x 2 programs, Oct 2026 to Dec 2030, sites summed because the baseline has no site). Meridian's zero months are kept so the series stays continuous.
- **Built aircraft: Serial No.** One per aircraft (`VESPER-001` to `-010`), `posting_date` as completion date, `status` Active. A real flow would post a Manufacture or Receipt stock entry with a serial bundle; that would add a finished-goods Bin and a GL posting and break the reconciled stock quantities, so the seed creates the Serial No records directly. v16 refuses `Has Serial No` on the item until Stock Settings turns serial and batch numbers on, so the flag is not set; ERPNext accepts the records without it.
- The seed is `bowman/erp/seed-planning.ts` (phases `grants schedule aircraft`), a new file next to `seed.ts`, which is untouched. Test versus production aircraft and the site split are in the dataset but not in ERPNext.
- `fallback: { volumePlan?, builtAircraft? }` exists for an ERP without these records: it is used only when ERPNext returns no rows (never on a failed read), and `meta.sources` says `fallback`. Bowman passes none.

## What Norn's role needed

`bowman/erp/NOTES.md` lists Norn's read grants. The connector also needs read on `Workstation` (labor rates; without it `GET Workstation` is 403), `Master Production Schedule` and `Serial No`. `seed-planning.ts grants` adds them through the Role Permissions Manager endpoints, as `bootstrap.mjs` does; a second run found them in place. Verified as Norn: reads work and POST/PUT on all three return 403. It also reads Item, Item Default, BOM, BOM Item, BOM Operation, Item Price, Bin, Purchase Order (and Item), Purchase Receipt (and Item), all already granted.

## Check script (`check.ts`)

Reads the baseline twice (cold, then again) and compares it with `bowman/data/bowman.json` field by field: counts, items (name, revision, make/buy, status, standard cost, supplier, labor), work center rates, every BOM line and quantity, every sourcing row's price and lead-time p10/p50/p90, stock in all six places, volume plan, built aircraft, then a simple BOM explode (leaves at standard cost, make items add labor hours x rate): Vesper V4 **2,800,019.00**, Meridian M6 **5,007,356.80**, and all 47 make items within $1 of their own standard cost. It also runs the four history reads for the ECR-0417 bracket (`BW-5120-210`) against the values in `bowman/erp/NOTES.md`.

Result 2026-10-24: 28 of 28 pass; read 0.60 s for 12 requests, second read 0.51 s, hash identical. A negative control (a copy of the dataset with seven values changed) failed the six expected checks. The stock check covers the 209 items the dataset has stock rows for; the baseline has 211 (the two aircraft top items, zero everywhere).

## ERP change package (`src/package.ts`, issues #44, #71, #72, #73)

Written 2026-10-24. Norn never writes to the ERP, not even drafts (Tyler, #71). A released ECO instead carries an ERP change package: every line a person enters in ERPNext, with the exact values, traced to the ECO, the ECR and Norn's decision (#72). Issue #44 first built this as a write-back that created the documents as the Norn Agent user, and ran it live the same day. #73 kept its planner and its verified order, turned the plan into the package, and removed every write path: `applyEcoRelease`, its error and result types, the client's `post` and `put`, the write grants on the role and `release-eco.ts`.

```ts
buildErpChangePackage(conn, settings, release): Promise<ErpChangePackage>  // reads ERPNext (GET only) and returns the package
formatErpChangePackage(pkg): string                                         // the package as markdown, in business words
```

`conn` is the Norn token (`ErpnextConnection`), `settings` the company's `ErpnextSettings`; `connect(opts).erpChangePackage(release)` binds both. A test keeps the connector read-only: every request the fake ERPNext sees must be an explicit GET without a body, the client has only `get` and `list`, and no source file names another HTTP method.

**The release** (`EcoRelease`, unchanged from the write-back, because Norn's side of #72 calls it) is what Norn's assessment hands over: `eco`, `ecr`, `decision: { id, url }`, `effectiveDate` (first day of the new standard cost; also the journal posting date unless `postingDate` is set), `items` (item, new `rev`, new `standardCost`), optional `bomChanges` (`add`, `remove`, `set_qty` on the default BOM of a parent; `qty` is per ONE unit of the parent, as Norn's assessment counts, and the package multiplies it by the BOM's own `quantity` when it writes or compares a line, so 4 per unit on a BOM that makes 10 is entered as 40), and `journals`: each a `key`, a `title` and lines of `amount`, a `debit` account role, a `credit` account role and a `memo`. The connector never computes a journal amount. Account roles are looked up in `settings.changePackage.accounts`; Bowman's are in `bowman/norn-config/erpnext.ts`.

**The package** (`ErpChangePackage`, `version: 1`) is plain data that survives `JSON.stringify`: the `release`, `erpUrl`, `readAt`, `lines` in the order to enter them, `counts` (total, entered, toEnter, conflict), `effects` (the estimated change in each program's unit cost, from the BOM lines), `warnings` and `problems`. A problem means the package cannot be followed as it stands (a missing, disabled, group or stock-type account, an item that is not in ERPNext, a price row that starts after the effective date); a conflict sits on its own line. Each `ChangeLine` has a stable `id`, a `title`, the seat that enters it (`cost accountant` or `manufacturing engineer`), the `doctype` and `document` to open, how (`new`, `edit`, `duplicate` from an existing BOM, or `tool` for the BOM Update Tool), a `path` relative to the ERP address, one `instruction` sentence, the exact `fields` (ERPNext field name, form label, value, money flag) and child `tables` (BOM items, journal accounts), `amounts`, the `trace` (ECO, ECR, decision id and link), a `status`, the document `found` for it, and a `note` saying why a line is a conflict or a draft. A value that is a document the package itself creates (the new BOM on the replace line and on a parent BOM's sub-assembly row) is `null` with `from` naming the line, and is filled in once that BOM exists.

**Order** (the one verified in `bowman/erp/NOTES.md`; retiring before replacing is a 417). Line ids: `standard-cost-close:ITEM` and `standard-cost:ITEM` (close the old price row, add the new one); then for each BOM that holds a repriced item (or a `bomChanges` parent), children first, `bom:ITEM` (new version: duplicate the old one, set the fields and ECO tags, submit), `bom-replace:ITEM` (BOM Update Tool, only when an active parent BOM uses it) and `bom-retire:ITEM` (untick Is Active, after the replace); then `journal-entry:KEY` for each journal.

**Status comes from a read of ERPNext** that finds each entry by the ECO number the person types into the ECO fields (`bw_eco`, and `bw_eco_entry` on a journal entry). Run the build again after entering lines and each moves from `to-enter` to `entered`:
- *Close line*: entered when the old row's `valid_upto` is the day before the effective date; to enter while open or running longer; conflict if closed earlier.
- *Standard cost line*: the Item Price row tagged with the ECO. Entered when its rate and `valid_from` match; conflict when either differs (the note says which).
- *BOM line*: the BOM tagged with the ECO (found even if it left out the repriced item). Entered when submitted, its output `quantity` is the package's, and its lines match the package's (quantities of one item are added up, and a sub-assembly line uses the BOM the package names: the new version when this release versions the sub-assembly); a saved draft stays to enter, with a note; another output quantity, a missing item, another line quantity, another sub-assembly BOM or an extra line is a conflict.
- *Replace line*: entered when no active parent BOM uses the old BOM any more; to enter while one does.
- *Retire line*: entered when the old BOM is inactive.
- *Journal entry line*: the entry with the ECO and the key. Entered when submitted and its total, posting date and accounting rows match (read from `Journal Entry Account`: per account and side, debits and credits added up to the cent; a row on the wrong account or the wrong side is a conflict); a draft stays to enter; a different total, date or row is a conflict.

A journal entry with the ECO number that the release does not contain is a warning.

**Not verified live.** Everything in the package was tested offline against a fake ERPNext only. That includes reading `Journal Entry Account` rows with `parent=Journal Entry` as the Norn user (child rows follow the parent's read permission, as BOM Item does, but this exact read has not been made) (the connector has not touched the live ERP since the change, by design of #73). In particular: the labels of ERPNext's own fields (for example "Rate Of Materials Based On", "Valid Upto", "Accounting Entries") are from memory of v16 and unchecked; the BOM Update Tool path `/app/bom-update-tool` and the Duplicate route are unchecked; a Duplicate copies the old BOM's ECO tag, so the person must overwrite it, which the field table says; and the package's wording of a step is untested on a person. `bowman/erp/eco-setup.ts` makes the ECO fields editable (they were read-only for the write-back) and has not been re-run either.

### What a person enters, and what Norn recognises

| Document | Carries |
|---|---|
| BOM | Released by ECO (`bw_eco`), Released on, Norn decision (`bw_decision_url`, a link field). |
| Item Price | Released by ECO, Norn decision, and the `note`: "ECO-0319 (ECR-0417); Norn decision DEC-ECR-0417: <url>. BW-5120-210 Rev C standard cost 221.00 from 2026-10-24, was 186.40." The old row is closed the day before, not edited otherwise. |
| Journal Entry | Released by ECO, ECO entry, Norn decision, and a remark on each account row. No Title: ERPNext v16 hides `title` (and the entry's own `user_remark`) on the form, so the package does not ask for them; the entry's name is in the instruction. |

The first screenshots of these three, taken in headless Edge as Administrator after Norn's own write-back, were removed from the repo with the write path, because they showed Norn writing. Two things they showed are ERPNext's doing: `user_remark` on the Journal Entry itself is hidden in the form (v16 marks it hidden), so the visible trace is the three custom fields (the screenshots also showed a title, which the package no longer asks for); and the item-price form puts the seed's supplier-quote custom fields above the price, so the ECO fields sit lower on the page. `bowman/erp/screenshot-eco.ts` takes new ones of whatever is entered.

The **Item's revision** (`bw_rev`) stays `B`: the package does not change the Item. The new revision is in the descriptions only. In a real deployment the PLM-to-ERP gateway owns it (`docs/PLAN.md` section 2).

### Journal entries: the finance logic (ECR-0417; Tyler to confirm)

Bowman carries stock at standard cost: a Rev B bracket is $186.40 in the ledger (`valuation_rate` was seeded from it). Rev B failed fatigue (NCR-0119), so none of it can be used up. The dataset's answer key (`bowman/data/scenarios.ts`, S1) writes the scrap down net of an estimated scrap value of **$2.85 per bracket** (not stated there; it is what the key's totals imply: 324 x 186.40 - 59,470.20, over 324). So each bracket's loss is 186.40 - 2.85 = **$183.55**, a write-down to net realisable value (lower of cost and NRV). All three entries debit **51900 Inventory Shrinkage and Adjustments** (role `scrapExpense`), so the cost of the ECO sums in one account; the chart has no better one. The posting date is the effective date, 2026-10-24.

1. **Scrap of Stores and WIP stock**: Stores 96 x 183.55 = 17,620.80 and WIP 48 x 183.55 = 8,810.40, **26,431.20**. Dr 51900; Cr **11420 Reserve for Obsolete Inventory**. The credit cannot be 11410 Inventory on Hand: with perpetual inventory on, ERPNext rejects it (tested live: 417 `StockAccountInvalidTransaction`, "can only be updated via Stock Transactions", even as a draft). As I remember ERPNext's source the check only fires while the account balance equals the stock ledger's value; I did not test the other case. The textbook allowance method fits: the loss is booked when it is known, the bracket stays in stock at cost with the reserve against it, and when stores physically scrap it a Stock Entry (Material Issue) with 11420 as its difference account relieves both. The US chart has no inventory reserve, so `bowman/erp/eco-setup.ts` adds 11420 under 11400 Inventory (the one account this work adds). What is left of the reserve after that Stock Entry is the 144 x 2.85 = 410.40 scrap value, until the scrap is sold. Finance decides how to carry that.
2. **Supplier-finished units Bowman must still pay for**: 60 finished at Halden, not shipped, on the open PO-26-0144 line due 2026-11-02. 60 x 183.55 = **11,013.00**. Dr 51900; Cr **21210 Accrued Expenses**. Bowman owes Halden the full 11,184.00 when they ship and invoice; the bracket is worth 171.00 as scrap. A loss on a firm purchase commitment is recognised when it is known, measured like an inventory loss (ASC 330-10-35-17), so the 11,013.00 is accrued now and cleared when the invoice arrives (Dr 21210 11,013.00, Dr inventory 171.00, Cr Accounts Payable 11,184.00). Accounts Payable itself is not used: it needs a supplier party and an invoice.
3. **Cancellation charge**: the 60 Rev B brackets not started, cancelled at Halden's 10% (quote Q-HAL-26-1187): 60 x 18.64 = **1,118.40**. Dr 51900; Cr 21210 Accrued Expenses, for Halden's invoice. It is recognised when the cancellation is decided, which is this decision.

Total expense 38,562.60. The answer key's 59,470.20 + 1,118.40 = 60,588.60 also includes the 120 brackets installed on S/N 001-010, **22,026.00 at 183.55**. They are not in these entries: installed brackets are not in ERPNext's stock or ledger (the baseline derives them), so there is nothing to credit, and the loss arises when the retrofit removes them. `bowman/erp/ecr-0417-release.ts` prints this reconciliation.

**Flagged, not guessed:**
- **Net or gross of scrap value.** Entries follow the answer key (net). If finance books the full 186.40 and recognises scrap proceeds on sale, change the line amounts in the release; no connector change.
- **The 60 supplier-finished units are on the books twice.** `seed.ts` put them in the `At Supplier - BWA` warehouse at 186.40 (11,184.00 in 11410, the difference posted to Cost of Goods Sold) and also left them on the open PO line. If finance regards them as already in inventory, entry 2 should credit 11420 like entry 1 (change its `credit` role); either way, receiving the PO line later would add them again. This is the seed's modelling, not something the change package can resolve.
- **Standard cost change on stock that is not scrapped.** Standard costing would revalue stock on hand of a repriced item. Here all Rev B stock is scrapped, so there is none. Assemblies in stock or WIP that contain the bracket are not revalued, and the first lot at $239.50 against the new $221.00 standard will show as purchase price variance ($18.50 each) when received, as for any purchase.
- **Ancestors' standard cost rows.** The BOM replace recosts every BOM above the bracket (BOM total cost of Vesper rises by exactly 12 x 34.60 = 415.20, Meridian by 8 x 34.60 = 276.80), but the `Standard Cost` price rows of BW-5120-000 and the assemblies above it keep their old roll-ups; a cost roll is a finance step, or more `items` in the release. While an ECO is entered the connector's roll-up checks in `check.ts` therefore fail (seen in the 2026-10-24 write-back run, before Norn stopped writing); after the reset they pass.
- **A journal entry that no longer matches the release** (another amount, posting date or account) is a `conflict` on its line. Norn cannot change it; the person corrects or cancels it in ERPNext.
- **The decision URL** in the demo release is a stand-in (`norn.bowman.example`) until `norn/web` has decision pages; `eco-package.ts --decision-url` overrides it.

### Setup, run and reset (all in `bowman/erp/`, Node 24)

```
node bowman/erp/eco-setup.ts                  # once, as Administrator: the editable ECO fields (bw_eco / bw_decision_url / bw_eco_entry) and account 11420
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts            # print the ECR-0417 package as markdown; reads only
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts --json     # the same as JSON
node bowman/erp/screenshot-eco.ts ECO-0319 <folder>   # headless Edge as Administrator, of what has been entered
node bowman/erp/reset-eco.ts ECO-0319         # undo what was entered, as Administrator, so the demo can run again (--dry-run lists the steps)
```

`reset-eco.ts` stays: a rehearsal enters the package more than once, so the demo needs a way back, and it never was Norn's. It reactivates the previous BOM as default and replaces the ECO's version with it in the parents (ERPNext recosts everything above), cancels the BOM Update Logs that link the ECO's BOM (ERPNext will not cancel a BOM while a submitted log links it) and then the BOM, deletes the ECO's price row and reopens the row it closed, and deletes the draft journal entries. A submitted journal entry has posted, so it is left and reported. What stays: the cancelled BOM and logs (ERPNext keeps them, so the next release is BOM `-004`, `-005`...), Version history. It finds documents by the ECO tag, so it works the same on what a person entered. After a reset `check.ts` passed 28 of 28 with the same baseline hash as before the ECO (measured on the write-back run).

Measured on 2026-10-24 on the write-back run, twice (apply, reset, `check.ts`), and the basis of the order and the estimated effects above: the replace cascades through all five levels and both paths to Vesper and Meridian in one BOM Update Log, and the totals are exact (Vesper rises by 12 x 34.60 = 415.20, Meridian by 8 x 34.60 = 276.80). That run wrote the documents as Norn, which no longer can; the package has not been entered by hand on the live ERP yet.

## What differs from the research (`docs/research/software-options.md`)

1. **Standard cost is a price list, not the item's valuation rate.** v16 has no standard-costing method, and `valuation_rate` drifts once stock moves. The connector reads the `Standard Cost` Item Price rows, as the seed wrote them.
2. **Price history comes from Item Price rows** (`valid_from` / `valid_upto`), not from `Version`: an insert writes no Version row, its dates are `mm-dd-yyyy` and its currencies formatted strings (`bowman/erp/NOTES.md`, difference 6).
3. **Quotes are Item Price rows, not Supplier Quotation** (none exist).
4. **Stock is `Bin`** (the research had not read its schema): `actual_qty` and `ordered_qty` per item and warehouse. "In the field" has no ERPNext field at all.
5. **BOMs are read in bulk** (`BOM Item` with `parent=BOM`), not one `GET /api/resource/BOM/<name>` each; that is what makes the read about 12 requests.

Other things that surprised me:
- A list of a child doctype needs `parent=<doctype>` (`Item Default`, `BOM Item`, `BOM Operation`, `Purchase Order Item`...); without it Frappe answers 403 "Insufficient Permission", which reads like a missing grant.
- Frappe leaves null fields out of the row, so `valid_upto` is absent for an open price row.
- An API-created Serial No has an empty `item_group`; filter on `item_code`, not on the group.
- PO names follow the creation year, not the order date: `PUR-ORD-2026-00006` is the PO dated 2025-02-12. The dataset's number is in `bw_po_id`, and the history rows carry it as `poLabel`.
- The Master Production Schedule accepts rows by REST with no demand source behind them, and is not submittable.
- `bowman/erp/NOTES.md` says volume plan and built aircraft are "not loaded"; as of `seed-planning.ts` they are.

## Not done

- The change package is untested on the live ERP and on a person (section "ERP change package"). The live role still holds the old write grants until `bowman/erp/bootstrap.mjs` is run once more (`bowman/erp/NOTES.md`).
- `baseline.ts` mirrors `norn/checks/src/types.ts` (the checks library, #41, is not on this branch). Replace it with an import when #41 lands; the shapes are identical today (copied from the working tree of that branch on 2026-10-24).
- History reads are not paged or cached; each is two or three requests.
- A Mac or Colima restart, and a tunnel drop mid-read: not tried. The client throws `ErpnextError` (status and path, never a header) after a 30 s timeout and does not retry.
