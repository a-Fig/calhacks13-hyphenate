# Glossary

The terms this project uses, and what they mean. Started 2026-10-24.

These are Bowman's terms (#3). Bowman has one vocabulary and one set of systems, so this doc states
what Bowman does, not how other companies differ (Tyler, 2026-10-24).

## Two vocabularies

We design the product with a Git metaphor (`norn/ARCHITECTURE.md` §2), but the people we sell to speak
engineering-change and accounting language. So there are two vocabularies, and each has its place:

- **Git terms** are for building: code, `norn/ARCHITECTURE.md`, issues, PRs and team chat.
- **Business terms** go in everything a judge, user or finance person sees: the UI, the demo, the
  video, Devpost and the pitch (Tyler, 2026-10-24). Nobody outside the team should hear "branch"
  or "merge".

Where this repo's own GitHub workflow needs a git word too, say "repo PR" versus "product PR"
(`CLAUDE.md`).

## The mapping

| Git term (internal) | Business term (what people see) | Meaning |
|---|---|---|
| `main` | **Production baseline** | The current released definition of the product: BOM, sourcing, volume plan, standard costs and assumptions |
| Issue | **Nonconformance report (NCR)**, or discrepancy report | A problem found, with the fix not yet known. Example: "the 12-inch bolt doesn't seat here" (#8). |
| Branch | **Proposed change**, or redline | The set of edits a change would make to the baseline |
| Draft PR | **Draft ECR** | A change request that is still being written |
| Pull request | **Engineering change request (ECR)** | A proposed change submitted for review |
| Commit | **ECR revision** | One edit to the ECR: the agent's extraction, an engineer's correction, a reviewer's change to an assumption |
| Review / approve | **CCB review and disposition** | The Change Control Board's decision: approve, reject, or send back |
| Merge | **ECR approved, ECO released** | The change becomes an engineering change order and enters the baseline |
| Merge notification | **ECO release** | Releasing the ECO is what tells planning, purchasing and accounting that the change is official |
| CI checks | **Impact assessment** | Cost, schedule, supply-chain and certification analysis of the change |
| Bot comment / impact card | **Change impact statement** | The summary the board reads: headline numbers with ranges, drivers, flagged assumptions |
| Cheap checks / deep review (#10) | **Impact screen / full impact assessment** *(proposed)* | The always-on automated pass versus the on-demand deep analysis |
| Merge conflict | **Conflicting changes** | Two ECRs that edit the same part or field |
| Shared-resource conflict | **Change interaction** | Two ECRs that touch different parts but share a supplier or capacity |
| Integration branch | **Change package** *(proposed)* | A chosen, ordered set of ECRs assessed together: the backlog roll-up |
| Stacked PR | **Dependent ECR** | An ECR that only makes sense after another one is approved |
| Rebase onto `main` | **Re-baseline** | Re-run the assessment against a newer production baseline |
| Revert | **Superseding ECO** | Industry practice doesn't undo a released change; a new ECO replaces it |

## Engineering change terms

Detail on how these fit together, and who does what, is in `CHANGE-CONTROL.md`.

- **BOM (bill of materials).** The parts list for an assembly, with quantities.
- **CCB (Change Control Board).** The cross-functional group that approves or rejects ECRs, run by
  configuration management.
- **Configuration management (CM).** The function that keeps the baseline accurate, logs changes
  and runs the CCB.
- **Effectivity.** Where a change cuts in on the line: a unit serial number, a lot or a date.
  Units before it are built the old way.
- **Inventory disposition.** What happens to stock of the old part: use it up, rework it, or scrap
  it.
- **MRB (Material Review Board).** Decides what to do with a nonconforming part: use as is, rework,
  or scrap. A design flaw it finds becomes an ECR.
- **NCR, ECR, ECO.** Bowman's three change documents:
  - **NCR**: a problem is found.
  - **ECR**: a change is requested.
  - **ECO**: the change is approved and released. Releasing the ECO notifies downstream teams;
    Bowman issues no separate change notice (ECN).
- **CMII and Teamcenter equivalents.** Bowman keeps the classic, more widely known terms (Tyler,
  2026-10-24). CMII and Teamcenter call the same objects:
  - Change Request (ECR);
  - Change Review Board (CCB);
  - Change Notice (ECO).

  Bowman follows CMII's process all the same: closed-loop change, effectivity on the release, and a
  fast track for small changes. Avoid "ECN": CMII and classic usage give it opposite meanings.
  Sources: `research/change-terminology.md`.
- **Fast track.** Approval of a small, low-risk ECR without convening the full CCB. CMII puts it at
  75-85% of changes. Our agent can approve these, or recommend approval, depending on how Bowman
  configures it (#22).
- **PLM / ERP / MRP.**
  - Product lifecycle management holds the design and the BOM.
  - Enterprise resource planning holds finance, purchasing and inventory.
  - Material requirements planning schedules parts against production.
  - Bowman runs one of each: its PLM (`bowman/plm/`, standing in for Teamcenter) and ERPNext
    (`bowman/erp/`, standing in for SAP), which also does MRP and holds the ledger.
- **Major / minor change.** The FAA's split for changes to a type-certificated design (14 CFR
  21.93). A major change can mean new testing and approval, which is often the largest schedule
  risk for aircraft.

## Cost and supply terms

- **Standard cost.** The planned cost per unit that accounting books against. A change updates it.
- **Should-cost.** An engineering estimate of what a part ought to cost, built from materials,
  labor and overhead.
- **Lead time.** The time from ordering a part to having it.
- **MOQ (minimum order quantity).** The smallest order a supplier accepts.
- **Single source / sole source.** Single source: only one supplier is used. Sole source: only one
  exists. Either is a supply risk.
- **Learning curve.** Unit cost falls as cumulative volume rises.
- **Cost at completion.** The forecast total cost of a program, as program finance tracks it.

## Our forecasting terms

- **p10 / p50 / p90.** The 10th, 50th and 90th percentiles of a forecast: a low case, a middle case
  and a high case.
- **Paired simulation.** Old and new routes run on the same random draws, so their difference isn't
  noise (`norn/ARCHITECTURE.md` §5).
- **Assumption source.** Each assumption is `given` (a stated fact), `default` (a category
  default) or `agent_estimated` (proposed by an agent, with a rationale).

## How Norn marks evidence

The audit trail (#25) is described in `research/trust-patterns-human.md`.

- **Evidence class, shown as a text label** (Tyler, 2026-10-24, #115). Every number and claim is one of four
  classes, so anyone can tell at a glance what it rests on:
  - **Fact:** read from a source, such as the ERP, the PLM or a quote.
  - **Assumption:** supposed, in order to frame or support the analysis.
  - **Computation:** calculated by code from other values.
  - **Judgment:** the agent's conclusion.

  The UI uses neutral Primer badges and standard hover, selection and focus highlighting.
  Colour in charts is supplementary; the text label names the class. Evidence class does not
  indicate risk, confidence or whether a value has been independently verified.
- **Verification marks** *(proposed)*. These are letters borrowed from audit tick marks, so finance
  readers recognise them. They show how a value was checked:
  - **T**, traced: followed from the source forward;
  - **V**, vouched: followed from the record back to the source;
  - **R**, recomputed: calculated again independently;
  - **C**, confirmed: confirmed with a third party, such as a supplier.

  Clicking a mark shows exactly where the value came from. No universal tick-mark standard exists;
  each audit firm defines a legend, and so do we.
- **Likelihood words** (Tyler, 2026-10-24: standard). Norn uses the intelligence community's fixed
  scale (ODNI ICD 203). Each word has a fixed range:

  | Word | Probability |
  |---|---|
  | almost no chance | 1-5% |
  | very unlikely | 5-20% |
  | unlikely | 20-45% |
  | roughly even | 45-55% |
  | likely | 55-80% |
  | very likely | 80-95% |
  | almost certain | 95-99% |

  Likelihood (how probable an event is) and confidence (how solid the basis for that judgment is)
  are stated separately, and never in the same sentence.

## Overloaded words

- **Agent.** One of three things:
  - Norn's own agents (extraction, research, review, the narration of the impact statement);
  - a person's own agent connected to Norn, acting on their behalf (#34);
  - a coding agent working on this repo.
- **Norn.** Our product's name (Tyler, 2026-10-24). The Norns of Norse myth know the past, the
  present and the future. Norn reads a company's history to forecast what a change will do.
  Orrery was second. The candidates are in `research/naming.md`.
- **Bowman.** Our fictional, Archer-like electric-aircraft maker (`bowman/README.md`).
- **Level 1, 2, 3.** How far Norn's report on an ECR has got: Level 1 is the provisional impact
  screen, Level 3 is Norn's final verdict after adversarial review (#26). Not the CCB's cost tiers.

The accounting basics (double-entry, general ledger, journal entry and so on) are already defined in
`hyphenate-track.md`, under "Key concepts".
