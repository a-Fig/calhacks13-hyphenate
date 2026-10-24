# ERPNext connector

Written 2026-10-24 for issue #40 (the PLM half is separate). Norn's view of a company's ERPNext: one call returns the production baseline in the shape the checks library reads, plus four history reads for agents, and (issue #44, section "ECO write-back") the write-back of a released ECO. Plain TypeScript on Node 24 (erasable syntax), no runtime dependencies. Nothing in `src/` names a company; a company supplies its names as options (Bowman's: `bowman/norn-config/erpnext.ts`).

## Run it

The ERP is on Tyler's home-server Mac and reachable only through the laptop's SSH tunnel on `127.0.0.1:8081` (`bowman/erp/up.sh tunnel` starts it; `bowman/erp/NOTES.md` has the rest). The connector reads `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` (the Norn Agent user's token; never Administrator) from the environment or from `ENV_FILE`, default the `.env` at the repo root. A worktree has no `.env`: point `ENV_FILE` at the main checkout's.

```
cd norn/connectors/erpnext && npm install   # typescript and @types/node only
npm run typecheck                           # tsc, strict, erasableSyntaxOnly
npm test                                    # offline: a stubbed REST API, no ERPNext needed
# from the repo root, with the tunnel open: read the baseline and compare it with the dataset
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON norn/connectors/erpnext/check.ts --config bowman/norn-config/erpnext.ts
```

The warning flag is only there until `bowman/norn-config/` has a `package.json` with `"type": "module"` (the config session is adding one).

## API (`src/index.ts`)

```ts
readBaseline(opts): Promise<{ baseline, asOf, hash, meta }>
priceHistory(opts, item, priceList?)  -> PricePoint[]   // Item Price rows, oldest first
realisedLeadTimes(opts, item)         -> LeadTime[]     // receipt date minus PO date
openOrders(opts, item)                -> OpenOrder[]    // submitted PO lines with quantity still to come
bomVersions(opts, item)               -> BomVersion[]   // every submitted BOM version with its lines and cost
connect(opts)                         // the five above bound to opts
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
| workCenters | `Workstation`: name as id, `hour_rate` as the labor rate. |
| bom | `BOM Item` rows of default, active, submitted BOMs: `stock_qty` / BOM quantity per parent unit, `idx` as `seq`. |
| sourcing | `Item Price` rows on the supplier price list that have a supplier and are valid on `asOf`. `unitPrice.p50` is the rate, `leadTimeWeeks.p50` is `lead_time_days / 7`; p10/p90, `qualified`, `primary` and `allocation` are custom fields (without them: p10 = p90 = p50, qualified, first row primary with allocation 1). |
| stock | One row per enabled stock item. `Bin.actual_qty` by warehouse via the options' map. `onOrder` is `ordered_qty` summed over warehouses minus `supplierFinished`, because the quantity finished at a supplier is still on its open PO and the checks count it separately. |
| stock: `inField` | Not in ERPNext, so derived: for each program, built aircraft x the item's exploded quantity per aircraft in the current BOM. It assumes every built aircraft matches the current BOM. |
| programs | One per item in the program item group. Id: first entry of the item's programs field, else the item code. Name: `programName(itemName)`, else the item name. |
| volumePlan | The planned quantities of the program top items in a `Master Production Schedule`; month is `delivery_date`'s first 7 characters, rows of one month and program are summed. Default: the company's latest MPS; `productionSchedule` names one. |
| builtAircraft | `Serial No` of the program top items: `posting_date` is the completion date, the trailing digits of `serial_no` the serial (`serialNumber` overrides). |

Work centers and suppliers are identified by their ERPNext names (`Structure assembly`, `Tarn Composites`), not by the dataset ids (`WC-STRUCT`, `SUP-TARN`). The check script maps them back.

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

## ECO write-back (`src/write.ts`, issue #44)

Written 2026-10-24. When an ECO is released, Norn writes its effects into ERPNext as the Norn Agent user: the new standard cost, a new BOM version replaced in the parent assemblies, and draft journal entries. Each document carries the ECO number and a link to Norn's decision.

```ts
planEcoRelease(conn, settings, release): Promise<EcoPlan>        // reads ERPNext, writes nothing
applyEcoRelease(conn, settings, plan, run?): Promise<ApplyResult> // executes it; returns doctype, name and link of each document
formatPlan(plan): string                                          // the plan as text for a person
```

`conn` is the Norn token (`ErpnextConnection`), `settings` the company's `ErpnextSettings`. `connect(opts)` binds both as `planEcoRelease(release)` and `applyEcoRelease(plan)`.

**The release** (`EcoRelease`) is what Norn's assessment hands over: `eco`, `ecr`, `decision: { id, url }`, `effectiveDate` (first day of the new standard cost; also the journal posting date unless `postingDate` is set), `items` (item, new `rev`, new `standardCost`), optional `bomChanges` (`add`, `remove`, `set_qty` on the default BOM of a parent), and `journals`: each a `key`, a `title` and lines of `amount`, a `debit` account role, a `credit` account role and a `memo`. The connector never computes a journal amount. Account roles are looked up in `settings.write.accounts`; Bowman's are in `bowman/norn-config/erpnext.ts`.

**The plan** is plain data: `steps` in order, each with `id`, `kind`, `doctype`, a one-line `summary`, `amounts`, and a `status` (`todo`; `done` when the ECO's own earlier write was found; `conflict`), plus `effects` (the estimated change in each program's unit cost, from the BOM lines), `warnings` and `problems`. `applyEcoRelease` refuses a plan with problems (a missing or stock-type account, a journal entry already written for another amount, a price row that starts after the effective date).

**Order** (the one verified in `bowman/erp/NOTES.md`; retiring before replacing is a 417): close the old price row, write the new one; then for each BOM that holds a repriced item (or a `bomChanges` parent), children first: new version (submitted, default, costed from the standard-cost list), replace it in the parent BOMs with `enqueue_replace_bom` (waits for the BOM Update Log to complete, then checks no active parent still points at the old one), retire the old version; then the journal entries, as drafts.

**Idempotent.** Every document carries the ECO number (`bw_eco`), and a journal entry also its `key` (`bw_eco_entry`). Each step looks for its own earlier write first and skips it (`action: 'existing'`), whatever the plan said, so a stale plan, a retry after a failure, or a second apply writes nothing twice. A failure throws `EcoApplyError` with what was written; applying again continues from there. Cancelled documents do not count as written, so the demo reset (below) lets the release run again. Verified live: a second `--apply` wrote nothing.

### What a finance user sees in ERPNext

| Document | Carries |
|---|---|
| BOM | Released by ECO (`bw_eco`), Released on, Norn decision (`bw_decision_url`, a link field). Created By "Norn Agent". |
| Item Price | Released by ECO, Norn decision, and the `note`: "ECO-0319 (ECR-0417); Norn decision DEC-ECR-0417: <url>. BW-5120-210 Rev C standard cost 221.00 from 2026-10-24, was 186.40." The old row is closed the day before, not edited otherwise. |
| Journal Entry | Title "ECO-0319: <what>", Released by ECO, ECO entry, Norn decision, `user_remark` with the same in words, and a memo on each row. Status Draft. |

Screenshots of the three, taken in headless Edge as Administrator: `screenshots/` (`bowman/erp/screenshot-eco.ts`). Two things the screenshots show that are ERPNext's doing: `user_remark` is hidden in the Journal Entry form (v16 marks it hidden, and `remark` stays empty on a draft), so the visible trace is the three custom fields and the title; and the item-price form puts the seed's supplier-quote custom fields above the price, so the ECO fields sit lower on the page.

Not traceable from ERPNext, by design of Norn's role: the **Item's revision** (`bw_rev`) stays `B`, because Norn has no write on Item. The new revision is in the descriptions only. In a real deployment the PLM-to-ERP gateway owns it (`docs/PLAN.md` section 2).

### Journal entries: the finance logic (ECR-0417; Tyler to confirm)

Bowman carries stock at standard cost: a Rev B bracket is $186.40 in the ledger (`valuation_rate` was seeded from it). Rev B failed fatigue (NCR-0119), so none of it can be used up. The dataset's answer key (`bowman/data/scenarios.ts`, S1) writes the scrap down net of an estimated scrap value of **$2.85 per bracket** (not stated there; it is what the key's totals imply: 324 x 186.40 - 59,470.20, over 324). So each bracket's loss is 186.40 - 2.85 = **$183.55**, a write-down to net realisable value (lower of cost and NRV). All three entries debit **51900 Inventory Shrinkage and Adjustments** (role `scrapExpense`), so the cost of the ECO sums in one account; the chart has no better one. The posting date is the effective date, 2026-10-24.

1. **Scrap of Stores and WIP stock**: Stores 96 x 183.55 = 17,620.80 and WIP 48 x 183.55 = 8,810.40, **26,431.20**. Dr 51900; Cr **11420 Reserve for Obsolete Inventory**. The credit cannot be 11410 Inventory on Hand: with perpetual inventory on, ERPNext rejects it (tested live: 417 `StockAccountInvalidTransaction`, "can only be updated via Stock Transactions", even as a draft). As I remember ERPNext's source the check only fires while the account balance equals the stock ledger's value; I did not test the other case. The textbook allowance method fits: the loss is booked when it is known, the bracket stays in stock at cost with the reserve against it, and when stores physically scrap it a Stock Entry (Material Issue) with 11420 as its difference account relieves both. The US chart has no inventory reserve, so `bowman/erp/eco-setup.ts` adds 11420 under 11400 Inventory (the one account this work adds). What is left of the reserve after that Stock Entry is the 144 x 2.85 = 410.40 scrap value, until the scrap is sold. Finance decides how to carry that.
2. **Supplier-finished units Bowman must still pay for**: 60 finished at Halden, not shipped, on the open PO-26-0144 line due 2026-11-02. 60 x 183.55 = **11,013.00**. Dr 51900; Cr **21210 Accrued Expenses**. Bowman owes Halden the full 11,184.00 when they ship and invoice; the bracket is worth 171.00 as scrap. A loss on a firm purchase commitment is recognised when it is known, measured like an inventory loss (ASC 330-10-35-17), so the 11,013.00 is accrued now and cleared when the invoice arrives (Dr 21210 11,013.00, Dr inventory 171.00, Cr Accounts Payable 11,184.00). Accounts Payable itself is not used: it needs a supplier party and an invoice.
3. **Cancellation charge**: the 60 Rev B brackets not started, cancelled at Halden's 10% (quote Q-HAL-26-1187): 60 x 18.64 = **1,118.40**. Dr 51900; Cr 21210 Accrued Expenses, for Halden's invoice. It is recognised when the cancellation is decided, which is this decision.

Total expense 38,562.60. The answer key's 59,470.20 + 1,118.40 = 60,588.60 also includes the 120 brackets installed on S/N 001-010, **22,026.00 at 183.55**. They are not in these entries: installed brackets are not in ERPNext's stock or ledger (the baseline derives them), so there is nothing to credit, and the loss arises when the retrofit removes them. `bowman/erp/ecr-0417-release.ts` prints this reconciliation.

**Flagged, not guessed:**
- **Net or gross of scrap value.** Entries follow the answer key (net). If finance books the full 186.40 and recognises scrap proceeds on sale, change the line amounts in the release; no connector change.
- **The 60 supplier-finished units are on the books twice.** `seed.ts` put them in the `At Supplier - BWA` warehouse at 186.40 (11,184.00 in 11410, the difference posted to Cost of Goods Sold) and also left them on the open PO line. If finance regards them as already in inventory, entry 2 should credit 11420 like entry 1 (change its `credit` role); either way, receiving the PO line later would add them again. This is the seed's modelling, not something the write-back can resolve.
- **Standard cost change on stock that is not scrapped.** Standard costing would revalue stock on hand of a repriced item. Here all Rev B stock is scrapped, so there is none. Assemblies in stock or WIP that contain the bracket are not revalued, and the first lot at $239.50 against the new $221.00 standard will show as purchase price variance ($18.50 each) when received, as for any purchase.
- **Ancestors' standard cost rows.** The BOM replace recosts every BOM above the bracket (BOM total cost of Vesper rises by exactly 12 x 34.60 = 415.20, Meridian by 8 x 34.60 = 276.80), but the `Standard Cost` price rows of BW-5120-000 and the assemblies above it keep their old roll-ups; a cost roll is a finance step, or more `items` in the release. While an ECO is applied the connector's roll-up checks in `check.ts` therefore fail; after the reset they pass.
- **Journal entries cannot be amended by Norn** (no write on Journal Entry). A changed release that no longer matches a written draft is a `conflict`; delete the draft in ERPNext and apply again.
- **The decision URL** in the demo release is a stand-in (`norn.bowman.example`) until `norn/web` has decision pages; `release-eco.ts --decision-url` overrides it.

### Setup, run and reset (all in `bowman/erp/`, Node 24)

```
node bowman/erp/eco-setup.ts                  # once, as Administrator: the custom fields bw_eco / bw_decision_url / bw_eco_entry and account 11420
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/release-eco.ts            # dry run: print the ECR-0417 plan, write nothing
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/release-eco.ts --apply    # apply it as Norn, then read the numbers back
node bowman/erp/screenshot-eco.ts ECO-0319 norn/connectors/erpnext/screenshots   # headless Edge as Administrator
node bowman/erp/reset-eco.ts ECO-0319         # undo it as Administrator so the demo can run again (--dry-run lists the steps)
```

`reset-eco.ts` reactivates the previous BOM as default and replaces the ECO's version with it in the parents (ERPNext recosts everything above), cancels the BOM Update Logs that link the ECO's BOM (ERPNext will not cancel a BOM while a submitted log links it) and then the BOM, deletes the ECO's price row and reopens the row it closed, and deletes the draft journal entries. A submitted journal entry has posted, so it is left and reported. What stays: the cancelled BOM and logs (ERPNext keeps them, so the next release is BOM `-004`, `-005`...), Version history. After a reset `check.ts` passes 28 of 28 with the same baseline hash as before the ECO.

Verified live on 2026-10-24, twice (apply, reset, `check.ts`): the apply of ECR-0417 takes about 6 s for 8 writes; the replace cascades through all five levels and both paths to Vesper and Meridian in one BOM Update Log, and the totals are exact.

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

- Writes are in `src/write.ts` (section "ECO write-back"). `bowman/erp/NOTES.md` still describes the call sequence; its Norn Agent permission table is unchanged.
- `baseline.ts` mirrors `norn/checks/src/types.ts` (the checks library, #41, is not on this branch). Replace it with an import when #41 lands; the shapes are identical today (copied from the working tree of that branch on 2026-10-24).
- History reads are not paged or cached; each is two or three requests.
- A Mac or Colima restart, and a tunnel drop mid-read: not tried. The client throws `ErpnextError` (status and path, never a header) after a 30 s timeout and does not retry.
