# Norn: notes for whoever works here

Our Cal Hacks 13.0 entry for the Hyphenate track, "The Hyphenated Enterprise: Autonomous Systems
for Finance". This file is the map: what we're building, why, and where each piece lives. How the
team works is `docs/WORKFLOW.md`, imported at the end, so it loads here too.

## The vision

Every design change at an aircraft maker changes what the aircraft costs to build, when the change
reaches the line, and how exposed the supply chain is. Today a cost engineer, a buyer, a planner
and a cost accountant each work that out by hand, and a change can wait months for a decision that
needs a few hours of real work (`docs/IN-PRACTICE.md`).

Norn does that assessment. It reads the change from the company's PLM and the costs, suppliers,
stock and history from its ERP. It returns the unit cost, the one-time cost, the cut-in date and
the supply risk as ranges, and posts them where engineers and finance already work. Its agents
approve the small changes the company trusts them with, and bring everything else to the right
person with the work done. Every number can be traced to the data, rule or person behind it.

Norn is a general platform, tuned to each company by configuration. Inside, it works like GitHub
for the production definition: the baseline is `main`, a proposed change is a branch, the impact
checks are CI. That framing is ours alone; outside the team, it's Norn, ECRs, ECOs and impact
assessments.

## The goal this weekend

A live demo of Norn deployed at **Bowman Aviation**, a fictional Archer-like maker of electric
aircraft that runs real software: an engineer files a change in Bowman's PLM, Norn's assessment
appears on it, the board decides, and the released change order carries the ERP change package
for finance to enter, with any number traceable on request. Norn never writes to the ERP (#71). Hyphenate's judges ask "would you hire it?", and what's real, what's simulated, and
how we know (`docs/hyphenate-track.md`). The seats Norn fills are the cost engineer, cost
accountant and supply-chain analyst who write the impact assessment for the Change Control Board.
The Devpost deadline is Sun Oct 25, 09:00 PT (`README.md`).

## What we're building, and where it lives

| What | Folder | What it is |
|---|---|---|
| **Norn** | `norn/` | Our product. General: nothing in it should need to name Bowman. Design: `norn/ARCHITECTURE.md` |
| **Bowman's configuration of Norn** | `bowman/norn-config/` | Vocabulary, the ECR form, change classes, approval matrix, roles and agent autonomy limits |
| **Bowman's PLM** | `bowman/plm/` | Where Bowman's engineers file changes; stands in for Teamcenter. Scenery: we never pitch it or say we built a PLM (Tyler, #19) |
| **ERPNext** | `bowman/erp/` | Real open-source ERP, set up as Bowman's; stands in for SAP. Runs on Tyler's home server |
| **Bowman's data** | `bowman/data/` | The one dataset both systems are seeded from: parts, BOMs, suppliers, costs, people, history, the demo's changes |

Each folder's `README.md` says what that part does and what it's responsible for. How the parts
connect, the demo, and the milestones are in **`docs/PLAN.md`: start there.** The work is GitHub
issues, grouped into those milestones and labelled by folder (`area: norn` and so on).

## Other docs

- `docs/GLOSSARY.md`: our terms, and the mapping from the Git framing to the business terms.
- `docs/CHANGE-CONTROL.md` and `docs/IN-PRACTICE.md`: how engineering change and impact assessment
  work at real companies.
- `docs/hyphenate-track.md`, `docs/hyphenate-company.md`, `docs/hackathon-logistics.md`: the
  track, the sponsor and the schedule.
- `docs/research/`: dated research notes behind the decisions. Background, not instructions.
- `sources/`: raw material, kept verbatim.

## Words that mean two things

`docs/GLOSSARY.md` maps the product's Git framing onto the business terms.
- **Git words are for building.** The product borrows branch, PR, merge, `main` and checks for its
  own design. In this repo's workflow, those words mean git. Say "product PR" or "repo PR" when
  it's ambiguous.
- **Business words are for anything a judge or user sees.** The UI, demo, video, Devpost and pitch
  say NCR, ECR, ECO and impact assessment, never branch or merge (Tyler, 2026-10-24).

## Commands

None yet (2026-10-24). When the first runnable piece lands, add one fenced block here with every
command, each line commented.

@docs/WORKFLOW.md
