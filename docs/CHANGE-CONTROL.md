# How engineering change control works in a real company

What our product replaces, and who does that work today. Written 2026-10-24 from general industry
knowledge. Nothing here has been checked against Archer or another specific company, and job
titles vary by company. Archer's job postings would confirm its titles (#3). Terms are defined in
`GLOSSARY.md`.

## No single job

There isn't one job title for "work out what an engineering change does to production". The work
is split across several functions. Each one writes its own part of the impact assessment, and
they meet at the Change Control Board (CCB). Today that work is done by hand, often in
spreadsheets, and someone has to stitch the parts together before each board meeting. That
handoff is what the product replaces.

## How a change moves

1. **A problem is found.** A mechanic or engineer writes a nonconformance report (NCR), also
   called a discrepancy report: the part doesn't fit, fails inspection, or can't be sourced. The
   Material Review Board (MRB) decides what to do with the affected parts: use them as is, rework
   them, or scrap them.
2. **A change is requested.** If the design itself is wrong, or an improvement is wanted, the
   design engineer who owns the part files an engineering change request (ECR).
3. **Configuration management logs and routes it.** A CM analyst checks the ECR is complete and
   sends it to each function for an impact assessment.
4. **Each function writes an impact assessment.** These are the seats in the table below.
5. **The CCB decides.** It can approve, reject, or send the ECR back for more work. An approval
   releases an engineering change order (ECO) with its effectivity.
6. **Everyone is told.** The released ECO goes to downstream teams. Some companies issue a separate
   engineering change notice (ECN); Bowman doesn't (`GLOSSARY.md`). Planning
   updates schedules, purchasing updates orders, and accounting updates the standard cost.

## Who writes the impact assessment

| Seat | Assesses | Our forecast stage (`norn/ARCHITECTURE.md` §5) |
|---|---|---|
| **Product cost engineer** (should-cost, cost estimating) | Change in cost per unit: parts, labor, tooling | S2 cost |
| **Manufacturing / industrial engineer** | Assembly time, tooling, line changes, scrap | S2 cost, S3 timeline |
| **Supply chain / procurement** (buyers, commodity managers) | Supplier quotes, lead times, single-source risk, MOQs | S4 supply chain |
| **Production planning** (MRP planner) | Effectivity, and what happens to old-part inventory | S3 timeline |
| **Cost accountant / program finance** (often "program control" in aerospace) | Changes to standard cost and program budget, and cost at completion | S2 cost, roll-up |
| **Certification / airworthiness** | Major or minor change under FAA rules, and any re-testing it triggers | Not modeled yet |
| **Quality, stress and weight engineering** | Safety margins, weight, inspection plans | Not modeled |

## What this means for us

- Our forecast stages already line up with the cost, planning, supply-chain and finance seats.
  Certification is often the largest schedule risk for an aircraft change, and the spec doesn't
  model it yet. It's a natural fit for the on-demand deep review (#10).
- Our issue-then-ECR flow (#8) is the real NCR-to-ECR flow, so the business names will read as
  authentic to judges who know manufacturing.
- *(proposed)* A candidate one-line description of the seats, for Hyphenate: "the cost engineer,
  cost accountant and supply-chain analyst who write the impact assessment for the Change Control
  Board." The finance seat is the cost accountant / program finance role, which falls under
  Hyphenate's FP&A category.
