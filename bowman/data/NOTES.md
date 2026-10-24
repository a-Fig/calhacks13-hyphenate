# Bowman dataset: notes

Written 2026-10-24. Bowman Aviation is fictional. This dataset is the single source of truth for both stand-in systems: the PLM gets parts, revisions, engineering BOMs and change records, ERPNext gets items, BOMs, suppliers, prices, standard costs, stock, purchase orders and history. Item codes are identical in both.

## Run it

```
node bowman/data/check.ts     # validate and print a summary (exit 1 on failure)
node bowman/data/export.ts    # write bowman/data/bowman.json for seeders in any language
```

Node 24, no dependencies, TypeScript with erasable syntax only. `check.ts` fails if `bowman.json` is stale, so re-run `export.ts` after any change.

## What is in it

| Section | Count | File |
|---|---|---|
| Items | 214: 47 make, 167 buy, 3 proposed (not in any released BOM) | `catalog-vesper.ts`, `catalog-meridian.ts`, expanded by `derive.ts` |
| BOM lines | 257, multi-level: aircraft, 11 major assemblies, sub-assemblies, parts | same |
| People | 17, with CCB roles | `company.ts` |
| Suppliers | 14, 3 strategic single-source (Orrin Magnetics, Vantage Cells, Aurelio Power Systems) | `suppliers.ts` |
| Sourcing quotes | 172: price p10/p50/p90, lead time p10/p50/p90 weeks, MOQ, sole-source flag, months to requalify | `derive.ts` |
| Stock | 209 rows: stores, WIP, finished goods, supplier-finished, on order, installed | `derive.ts` |
| Purchase orders | 140 (42 open), 376 lines, with price history and realised lead times | `derive.ts`, `pricing.ts` |
| Volume plan | 2026-10 to 2030-12, by program and site; 10 aircraft built so far | `volume.ts` |
| Released ECOs | 10, each with forecast at approval and actual | `history.ts` |
| Open NCRs / ECRs | 5 / 10, in engineer prose plus ECP fields | `changes.ts` |
| Answer key | 5 planted scenarios and 3 background traps | `scenarios.ts` |

Vesper V4 standard cost rolls up to $2,800,019 with shares of 20.0% avionics, 22.0% motors/inverters/propellers, 15.0% battery, 20.0% airframe, 10.0% actuation and thermal, 13.0% other. Labor is 14.0% ($392k). With the at-rate factors in `rateFactors` it falls to $1.797M against the $1.8M target. Meridian M6 rolls up to $5.007M and reuses 29 of 71 Vesper powertrain and battery items (40.8%).

## Schema in brief

`types.ts` defines everything. Items carry `makeBuy`; make items have BOM lines and labor hours at a work-center rate, buy items have a `Sourcing` record. Standard cost is a roll-up, not an input: `derive.ts` computes it and `check.ts` recomputes it independently from the exported records. An `Ecr` holds the DD 1692 / MIL-HDBK-61A fields: priority, justification code, company Class I/II and FAA major/minor (set separately), description, need, consequences, alternatives, an item and BOM overlay, supplier quotes, effectivity, an inventory proposal, and a four-block cost page (production, retrofit, logistics support, other; one-time versus unit cost x quantity). Rows the originator did not fill are `basis: 'not_provided'`: that is what Norn has to estimate.

## Provenance

Every record has `prov: { basis: 'sourced' | 'invented', ref?, note? }`. Sections without per-record provenance are covered by `sectionProvenance`. `sourced` means the value is stated in a research doc, with the doc and section in `ref`. This includes the Archer-derived architecture (12-tilt-6, 2-blade aft propellers, four flight control computers, six packs), the supplier pairings (Garmin, Safran, Honeywell, FACC and Hexcel analogs), the cost shares and lead-time table from "Suggested basis for Bowman" (a proposal that the doc itself calls invented), and the ECR-0417 numbers (illustrative in the doc). Everything else is invented. Real company names appear only in `analog` and `note` fields, never as a Bowman supplier.

## Design calls

- **Scope grew past the 150-item guide.** The BOM is rolled up from 214 items so that the cost shares come from parts and labor, not from allocation. The seeders pay no price for the extra rows.
- **Cost shares are met by tuning item prices, then checked by `check.ts`.** Labor is booked to the group of the make item that carries it; final assembly labor and the landing gear, interior and electrical distribution make up "other".
- **Battery pack cost is an assumption.** Six packs at 6 modules x 252 cells give 9,072 cells, about 147 kWh. The 15% share makes a pack about $70k, roughly $2,900 per kWh. That is high against automotive cells and is justified only by certification grade, fire containment and low rate. The research doc flags the 5-10x spread in public figures.
- **"3 single-source" is a supplier flag, not an item count.** 159 of 164 released buy items have one qualified source, which is normal for aerospace part numbers (Archer's 10-K says it relies on single-source suppliers). `soleSource` is per item; `Supplier.singleSource` marks the three where losing the supplier stops the line with no alternate in the market; `requalMonths` gives the severity per item. Halden Precision is sole source for the bracket but not on the strategic list.
- **ECR-0417 kept its part, prices and story but not its volumes.** The volume plan says 10 aircraft exist (S/N 001-004 test, 005-010 production, undelivered). Rev B is on all ten, so retrofit covers 120 brackets rather than 48, scrap is 324 pieces rather than 252, and production cut-in is S/N 011 rather than 009, because S/N 011-014 wait at the controller-install station. The stock at the supplier and in stores (96, 48, 60, 60) is unchanged. The bracket's earlier revision, ECO-0271, explains why Rev B is the production revision and carries a first-lot premium story ($201.50, $188.90, then $186.40).
- **Forecasts in history are deliberately biased.** Most cost increases land 15-40% above forecast, savings 10-30% below, one-time costs 20-35% over, and cut-in slips 5-10 weeks when a tooling step or a supplier qualification slot is involved (mean error +18%, mean slip 4.5 weeks across all ten). Three ECOs landed on time and one cost came in under forecast. This gives Norn a pattern to learn and a forecast-versus-actual view to show.
- **The shared-supplier interaction is built into supplier data, not into the ECRs.** ECR-0419 (Vesper) and ECR-0421 (Meridian) never mention each other. Orrin's quotes and the `CON-ORRIN-*` constraints in `suppliers.ts` carry the facts: one UH-grade qualification lot per quarter per part number, 1,200 sets per year until 2028-Q3, a 6% price break and a 40% cheaper second qualification when both land within 26 weeks. ECO-0297 shows the same slot problem already happened once.
- **Conflict means the same item and fields.** ECR-0412 and ECR-0415 both revise BW-8210-110 to Rev C with different flow, motor power, housing and price. The pump is also used by Meridian. TS-8210 rev 3 is out of date against NCR-0112.
- **FAA class is the originator's proposal.** ECR-0407 and ECR-0410 propose "minor" where the right answer is likely major. Those are the background traps. The design approval holder (Gideon Falk) decides, not a DER.
- **Meridian is not yet type certificated**, so its FAA field is "major for planning" with the reason stated.
- **Purchase orders and stock are generated, deterministically.** A seeded generator draws lead times from the quoted p10/p90 and prices from the price paths in `pricing.ts`. The bracket and the ECO-affected parts follow the ECO story. Open PO quantity equals `onOrder + supplierFinished` per item, checked.
- **Standard cost is frozen at the roll-up.** `standardCostHistory` shows how it got from $3.46M to $2.8M; only the last point is derived.
- **Emails use `bowman-aviation.example`.** Names are invented.

## Known gaps

- ECRs, NCRs and ECOs have no attachments (drawings, test reports); the prose refers to them.
- No tooling or fixture records, no learning-curve parameters per item beyond work-center slopes and the group rate factors.
- The ERPNext field mapping (item group, UOM names, warehouses, work orders from WIP) is not written; `uom` uses short codes (`Nos`, `kg`, `m2`, `L`).
- Physical coupling between ECRs is not modeled; ECR-0409 (four blades) changes the vibration spectrum that ECR-0417's bracket sits in, noted in the answer key only.
