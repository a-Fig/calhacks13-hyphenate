# Bowman's ERP: ERPNext

ERPNext v16, the open-source ERP, set up as Bowman Aviation's ERP and general ledger. It stands in
for SAP S/4HANA, which Archer runs. It's real software with Bowman's data in it, not a mock.
Written 2026-10-24, while it was first being stood up.

Why ERPNext: it is the one open-source candidate with ERP, MRP, a real chart of accounts and
journal entries in one stack, and a documented REST API (`docs/research/software-options.md`).

## Responsibilities

What Bowman's finance and supply-chain people do here, as they would in SAP:
- **The item master** and the manufacturing BOMs, with every past BOM version kept.
- **Suppliers, supplier prices and lead times,** quotations and purchase orders.
- **Stock** by warehouse: stores, work in progress, finished goods.
- **Standard cost.** v16 has no standard-cost valuation method, so standard costs are a "Standard
  Cost" price list with effective dates.
- **The general ledger:** journal entries and GL entries.
- **History.** ERPNext versions every BOM, item and price change, which is the past Norn reads.

## What Norn does here

- **Reads:** items, BOMs, prices, lead times, stock, open orders, GL entries and version history.
- **Drafts, when an ECO is released:** the new BOM version(s) and the journal entries for scrap
  and the supplier's cancellation charge, as unsubmitted drafts tagged with the ECO and Fern's
  decision (Tyler, 2026-10-25, reversing #71). A person reviews and submits them. Norn cannot
  submit, cancel or delete, so it cannot post to the ledger or make a BOM active. The new standard
  cost, the replacement in parent BOMs and retiring the old BOM are entered by a person.
- **As whom:** a Norn API user with its own role: create, read and write on BOM and Journal Entry,
  read only on everything else. The exact grants are in `NOTES.md`.

## Where it runs

On Tyler's home server, in Docker, reached from the laptop through an SSH tunnel on port 8081
(this laptop can't bind 8080). The compose file and start script are in this folder, so the
instance can be rebuilt from the repo. Keys live in the untracked `.env` at the repo root. Setup
steps and the verified API calls are in `NOTES.md` once it lands.

Issues: label `area: erp`.
