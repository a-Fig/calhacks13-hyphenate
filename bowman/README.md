# Bowman Aviation

Our imagined customer, and everything in its world that isn't Norn (#3). Bowman is a fictional,
Archer-like maker of electric aircraft. Hyphenate asks teams to assume what the company looks like
and build around it, so Bowman is that assumption, made concrete. Written 2026-10-24.

Bowman is one company, with one vocabulary and one set of systems (Tyler, 2026-10-24). These docs
state what Bowman does, not how other companies differ. It's built from real public data where we
could find it (`docs/research/archer-public-data.md`), and invented where we couldn't; the dataset
marks which is which.

Nothing in this folder is pitched as ours. The PLM especially is scenery: we never say we built or
replaced a PLM (Tyler, #19).

## The company

- **What it makes.** Two aircraft programs:
  - **Vesper V4**, in production: a piloted electric air taxi, pilot plus four passengers;
  - **Meridian M6**, in development: a hybrid-electric cargo and medevac aircraft that shares
    about 40% of Vesper's powertrain parts.

  Their numbers (volumes, standard costs, BOMs, suppliers) are in `data/`.
- **Where.** Headquarters and a pilot production line in California; a high-rate plant in
  Georgia.
- **How it changes its design.** NCR, then ECR, then CCB review, then a released ECO, with no
  separate ECN. Bowman follows CMII's process: closed-loop change, effectivity on the release, and
  a fast track for small changes. Its ECR form is modelled on the defense Engineering Change
  Proposal (ECP): company Class I or II, FAA major or minor set separately, and a cost page split
  into production, retrofit, logistics support and other, each one-time and recurring (#6).
  `docs/CHANGE-CONTROL.md` and `docs/IN-PRACTICE.md` describe the process.
- **Who's involved.** Design engineers file NCRs and ECRs. A configuration management analyst logs
  and routes them. The CCB, chaired by the program manager, decides. A cost engineer, a buyer, a
  production planner and a cost accountant write the impact assessment today, by hand. The CFO
  sees the large ones. The people are in `data/`.

## What's here

| Folder | What | Stands in for |
|---|---|---|
| `data/` | The dataset both systems are seeded from: programs, parts, BOMs, suppliers, prices, stock, people, past changes and their outcomes, and the open NCRs and ECRs the demo uses | Bowman's real history |
| `plm/` | Bowman's PLM: where engineers keep parts and file changes | Siemens Teamcenter |
| `erp/` | ERPNext v16, set up as Bowman's ERP and ledger | SAP S/4HANA |
| `norn-config/` | Bowman's configuration of Norn: vocabulary, the ECR form, classes, approval matrix, roles and autonomy limits | A customer's deployment settings |

Issues: label `area: bowman` for the data and the configuration, `area: plm` and `area: erp` for
the two systems.
