# Bowman dataset: notes

Written 2026-10-24. Bowman Aviation is fictional. This dataset is the single source of truth for both stand-in systems. Item codes are identical in both.

| Goes to the PLM | Goes to ERPNext |
|---|---|
| Items with revisions and `revHistory`, BOM lines (engineering BOM), NCRs, open ECRs with their item and BOM overlay, released ECOs, work centers and people for approvals | Items, BOM lines (manufacturing BOM), suppliers, `sourcing` as supplier item prices and lead times, standard cost, stock rows, purchase orders and history, volume plan |

## Run it

```
node bowman/data/check.ts     # validate and print a summary (exit 1 on failure)
node bowman/data/export.ts    # write bowman/data/bowman.json for seeders in any language
```

Node 24, no dependencies, TypeScript with erasable syntax only. `check.ts` fails if `bowman.json` is stale, so re-run `export.ts` after any change. `import { bowman } from './index.ts'` gives the typed object.

## What is in it

| Section | Count | File |
|---|---|---|
| Items | 214: 47 make, 167 buy, 3 proposed (not in any released BOM) | `catalog-vesper.ts`, `catalog-meridian.ts`, expanded by `derive.ts` |
| BOM lines | 257, multi-level: aircraft, 11 major assemblies, sub-assemblies, parts | same |
| People | 18, with CCB roles | `company.ts` |
| Change-control policy | CCB cadence and dates, dollar tiers, fast-track and never-fast-track rules | `company.ts` |
| Suppliers | 14, 3 strategic single-source (Orrin Magnetics, Vantage Cells, Aurelio Power Systems) | `suppliers.ts` |
| Sourcing quotes | 172: price p10/p50/p90, lead time p10/p50/p90 weeks, MOQ, sole-source flag, months to requalify | `derive.ts` |
| Stock | 209 rows: stores, WIP, finished goods, supplier-finished, on order, installed | `derive.ts` |
| Purchase orders | 144 (42 open), 386 lines, with price history and realised lead times | `derive.ts`, `pricing.ts` |
| Volume plan | every month 2026-10 to 2030-12 by program and site; 10 aircraft built so far | `volume.ts` |
| Released ECOs | 10, each with forecast at approval and actual | `history.ts` |
| Open NCRs / ECRs | 5 / 10, in engineer prose plus ECP fields | `changes.ts` |
| Finance | a budget and a cost of a week of delay per program, cash and monthly burn; all invented | `finance.ts` |
| Answer key | 5 planted scenarios and 3 background traps | `scenarios.ts` |

Vesper V4 standard cost rolls up to $2,800,019 with shares of 20.0% avionics, 22.0% motors/inverters/propellers, 15.0% battery, 20.0% airframe, 10.0% actuation and thermal, 13.0% other. Labor is 14.0% ($392k). With the at-rate factors in `rateFactors` it falls to $1.797M against the $1.8M target. Meridian M6 rolls up to $5.007M and reuses 29 of 71 Vesper powertrain and battery items (40.8%).

## The open ECRs

| Scenario | ECRs | What it tests |
|---|---|---|
| S1 worked example | ECR-0417 (NCR-0119) | Bracket Rev B to Rev C, supplier quote given, inventory scrap versus use-up, retrofit, single source |
| S2 big change | ECR-0409 (NCR-0113) | Aft propellers 2 to 4 blades, Class I, FAA major, one-time cost dominates, cut-in set by certification |
| S3 fast track | ECR-0423 | Panel colour, same supplier, $1.90 cheaper, Class II |
| S4 conflict | ECR-0412 and ECR-0415 | Same item (BW-8210-110), same fields set differently |
| S5 shared supplier | ECR-0419 (Vesper) and ECR-0421 (Meridian) | Different parts, one single-source supplier and one qualification slot |
| B1-B3 background traps | ECR-0406, ECR-0407, ECR-0410 | Class II filed on a safety item; a cheap resin swap that needs requalification; a saving that cuts redundancy |

`scenarios.ts` holds what a correct run should find, with reference arithmetic. It is an answer key, not an input to Norn. The NCR open with no ECR is NCR-0124 (door seal).

## Schema in brief

`types.ts` defines everything. Items carry `makeBuy`; make items have BOM lines and labor hours at a work-center rate, buy items have a `Sourcing` record. Standard cost is a roll-up, not an input: `derive.ts` computes it and `check.ts` recomputes it independently from the exported records. An `Ecr` holds the DD 1692 / MIL-HDBK-61A fields: priority, justification code, company Class I/II and FAA major/minor (set separately), description, need, consequences, alternatives, an item and BOM overlay, supplier quotes, effectivity, an inventory proposal, and a four-block cost page (production, retrofit, logistics support, other; one-time versus unit cost x quantity per aircraft). Rows the originator did not fill are `basis: 'not_provided'`: that is what Norn has to estimate. FAA class on an ECR is the originator's proposal; certification decides.

## Provenance

Every record has `prov: { basis: 'sourced' | 'invented', ref?, note? }`. Sections without per-record provenance are covered by `sectionProvenance`. `sourced` means the value is stated in a research doc, with the doc and section in `ref`. That covers the Archer-derived architecture (12-tilt-6, 2-blade aft propellers, four flight control computers, six packs), the supplier pairings, the cost shares and lead-time table from "Suggested basis for Bowman" (a proposal that the doc itself calls invented), the dollar tiers, and the ECR-0417 numbers (illustrative in the doc). Everything else is invented. Real company and product names appear only in `prov` and `analog` fields; `check.ts` scans every other string.

## Design calls

- **Scope grew past the 150-item guide.** The BOM is rolled up from 214 items so that the cost shares come from parts and labor, not from allocation. The seeders pay no price for the extra rows.
- **Cost shares are met by tuning item prices, then checked by `check.ts`.** Labor is booked to the group of the make item that carries it; final assembly labor and the landing gear, interior and electrical distribution make up "other".
- **Battery pack cost is an assumption.** Six packs of 6 modules x 252 cells give 9,072 cells, about 147 kWh. The 15% share makes a pack about $70k, roughly $2,900 per kWh. That is high against automotive cells and is justified only by certification grade, fire containment and low rate. The research doc flags the 5-10x spread in public figures.
- **"3 single-source" is a supplier flag, not an item count.** 159 of 164 released buy items have one qualified source, which is normal for aerospace part numbers (Archer's 10-K says it relies on single-source suppliers). `soleSource` is per item; `Supplier.singleSource` marks the three where losing the supplier stops the line with no alternate in the market; `requalMonths` gives the severity per item. Halden Precision is sole source for the bracket but not on the strategic list.
- **ECR-0417 kept its part, prices and story but not its volumes.** The volume plan says 10 aircraft exist (S/N 001-004 test, 005-010 production, undelivered). Rev B is on all ten, so retrofit covers 120 brackets rather than 48, scrap is 324 pieces rather than 252, and production cut-in is S/N 011 rather than 009, because S/N 011-014 wait at the controller-install station. Stock in stores, WIP and at the supplier (96, 48, 60, 60) is unchanged. ECO-0271 explains why Rev B is the production revision and carries the first-lot premium story ($201.50, $188.90, then $186.40). The bracket is also in eight Meridian controllers.
- **History is biased on purpose.** Six of eight cost increases land 16-38% above forecast (one exact, one 12% under); the two savings land 10% and 31% short; eight of nine nonzero one-time costs ran 7-40% over; six ECOs slipped 5-10 weeks, all with a tooling step, a long lead time or a qualification slot, and four landed within a week. This gives Norn a pattern to learn and a forecast-versus-actual view.
- **History obeys the supply data.** Each ECO's actual unit-cost delta equals its price change times BOM quantity, and the first purchase order at the new price arrives between release and the actual cut-in (the lead time is clipped to fit). The ECO cut-in serials sit in the right months of the build history. `check.ts` enforces all three.
- **The shared-supplier interaction is in supplier data, not in the ECRs.** ECR-0419 and ECR-0421 never mention each other. Orrin's quotes and the `CON-ORRIN-*` constraints in `suppliers.ts` carry the facts: one UH-grade qualification lot per quarter per part number, 1,200 UH sets per year until 2028-Q3, a 6% price break and a 40% cheaper second qualification when both land within 26 weeks. ECO-0297 shows the same slot problem already happened once.
- **Conflict means the same item and fields.** ECR-0412 and ECR-0415 both revise BW-8210-110 to Rev C with different flow, motor power, housing and price. The pump is also used by Meridian. TS-8210 rev 3 (10.5 L/min) is out of date against NCR-0112 (12.5 L/min needed).
- **Engineers' proposed dates can be optimistic, never impossible.** Each effectivity ties to a serial and a month in the volume plan and respects the quoted lead time, except ECR-0419, where the note says what is unplanned.
- **FAA class is the originator's proposal.** ECR-0407 and ECR-0410 propose "minor" where the right answer is likely major, and ECR-0406 files Class II on a safety item. The design approval holder (Gideon Falk) decides, not a DER. Meridian is not yet type certificated, so ECR-0421 is "major for planning" with the reason stated.
- **Purchase orders, stock and on-time delivery are generated, deterministically.** A seeded generator draws lead times from the quoted p10/p90 and prices from `pricing.ts`. Supplier on-time delivery is measured from those orders (within 7 days of the promise date). Open PO quantity equals `onOrder + supplierFinished` per item, checked.
- **Standard cost is frozen at the roll-up.** `standardCostHistory` shows how it got from $3.46M to $2.8M; only the last point is derived.
- **Emails use `bowman-aviation.example`.** Names are invented. Supplier names were chosen not to match real companies; Dunmore was renamed to Ferrow after a review found a real firm of that name.
- **A fresh-context review found 21 issues** (contradictions between prose and data, ECO price history arriving after cut-in, real names in descriptions). All but the ECR-0417 priority question were fixed; priority stays urgent because the first aircraft reaches the held station in about three weeks (MIL-HDBK-61A: urgent means potential line stoppage within 30 days).

## Finance

`finance.ts` (invented, each record with its rationale): FY2027 (July to June) budgets of $72M for Vesper and $38M for Meridian with $20.4M and $13.2M spent by 2026-10-24; $236M cash and $10.4M a month of burn (22.7 months); and a weekly cost of delay, $20k/$32k/$55k (p10/p50/p90) for Vesper's line and $10k/$16k/$30k for Meridian's. Vesper's budget covers the 16 aircraft its period completes at the $2.8M standard cost plus about $27M of engineering and certification; burn is the two budgets plus $15M of overhead and plant build-out over 12 months. `check.ts` checks those relations. The ERP seed does not carry any of it yet.

## Known gaps

- ECRs, NCRs and ECOs have no attachments (drawings, test reports); the prose refers to them.
- No tooling or fixture records and no learning-curve parameters per item beyond work-center slopes and the group rate factors.
- The ERPNext field mapping (item group, UOM names, warehouses, work orders from WIP) is not written; `uom` uses short codes (`Nos`, `kg`, `m2`, `L`).
- Physical coupling between ECRs is not modeled; ECR-0409 (four blades) changes the vibration spectrum that ECR-0417's bracket sits in, flagged in ECR-0409's own text and in the answer key, not detected from shared entities.
- Magnet and pump engineering values (coercivity, remanence, flow) are plausible, not engineered.
