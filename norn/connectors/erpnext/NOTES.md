# ERPNext connector (read side)

Written 2026-10-24 for issue #40 (the PLM half is separate). Norn's read-only view of a company's ERPNext: one call returns the production baseline in the shape the checks library reads, plus four history reads for agents. Plain TypeScript on Node 24 (erasable syntax), no runtime dependencies. Nothing in `src/` names a company; a company supplies its names as options (Bowman's: `bowman/norn-config/erpnext.ts`).

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

- Writes (the ECO write-back) are the other half of #40's ERP work, not this.
- `baseline.ts` mirrors `norn/checks/src/types.ts` (the checks library, #41, is not on this branch). Replace it with an import when #41 lands; the shapes are identical today (copied from the working tree of that branch on 2026-10-24).
- History reads are not paged or cached; each is two or three requests.
- A Mac or Colima restart, and a tunnel drop mid-read: not tried. The client throws `ErpnextError` (status and path, never a header) after a 30 s timeout and does not retry.
