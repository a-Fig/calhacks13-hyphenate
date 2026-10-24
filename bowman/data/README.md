# Bowman's data

The one dataset both of Bowman's systems are seeded from, so the PLM and ERPNext agree, and Norn
finds a company with a past (#3, #5). Written 2026-10-24, before the data existed.

## Responsibilities

- **Be the single source.** Every part, BOM line, supplier, price, stock level and person is
  defined once here. Seed scripts in `../plm/` and `../erp/` load it through those systems' own
  APIs. Item codes are the same in both systems.
- **Look real.** Numbers come from public data where possible (`docs/research/archer-public-data.md`)
  and are plausible where invented. Each value says which it is: `sourced`, with a pointer, or
  `invented`.
- **Give Norn a history to read.** Past released ECOs, each with what was forecast at approval and
  what actually happened, plus price history for key parts. Norn's research agents read this, and
  it lets the demo compare forecasts with actuals.
- **Carry the demo's changes.** The open NCRs and ECRs the demo uses, written as engineers write
  them, with Bowman's structured ECR fields:
  - ECR-0417, the motor-controller bracket (`docs/IN-PRACTICE.md`'s worked example);
  - the aft propellers going from two blades to four;
  - a trivial change that should fast-track;
  - two ECRs that conflict, editing the same field of the same part;
  - two ECRs that interact through a supplier shared with Meridian.
- **Check itself.** A validator confirms that every reference resolves and that Vesper's standard
  cost rolls up to about $2.8M.

## Contents

Plain TypeScript modules with no dependencies, which Node 24 runs directly:
- the company and its people (fictional names);
- Vesper V4 and Meridian M6: items, multi-level BOMs, labor;
- suppliers (fictional names), prices, lead-time ranges, minimum order quantities, single-source
  flags;
- standard costs, stock (stores, WIP, finished goods, on order) and the volume plan;
- history and the open changes.

How to run the check, and the design calls behind the data, are in `NOTES.md` once it lands.
