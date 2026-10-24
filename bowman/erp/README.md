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
- **Writes, when an ECO is released:** a new BOM (submitted; BOMs can't be edited after submit),
  the old one made inactive and replaced, an updated standard cost, and draft journal entries for
  scrap or revaluation. Whether Norn may also post a journal entry is Bowman's configuration
  (#24).
- **As whom:** a Norn API user with its own role, limited to what those reads and writes need. The
  exact grants are in `NOTES.md`.

## Where it runs

On Tyler's home server, in Docker, reached from the laptop through an SSH tunnel on port 8081
(this laptop can't bind 8080). The compose file and start script are in this folder, so the
instance can be rebuilt from the repo. Keys live in the untracked `.env` at the repo root. Setup
steps and the verified API calls are in `NOTES.md` once it lands.

Issues: label `area: erp`.
