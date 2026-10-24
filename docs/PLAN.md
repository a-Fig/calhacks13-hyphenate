# Norn: the solution and the plan

The overarching doc: what we're building, how the parts fit, and in what order. Written
2026-10-24, when the three-layer architecture was agreed with Tyler. The work itself lives in
GitHub issues, grouped by the milestones in §7. Each component's own doc is in its folder
(`CLAUDE.md` lists them). Terms are defined in `GLOSSARY.md`.

Marked *(proposed)* where this doc decides something Tyler hasn't confirmed.

## 1. The problem

An aircraft maker changes its design constantly: a thicker bracket, a new supplier, a four-blade
propeller. Each change is filed as an engineering change request (ECR). Before the Change Control
Board (CCB) approves it, a cost engineer, a buyer, a planner and a cost accountant each work out
its effect by hand, usually in spreadsheets, and someone stitches the pieces together
(`CHANGE-CONTROL.md`). One study measured 2.5 hours of value-adding work inside a 144-day average
ECR lead time (`IN-PRACTICE.md`). The waiting is the cost.

Finance cares what a change does to **production** and to the books:
1. the cost per unit at production volume, and the one-time costs;
2. when the change reaches the line (effectivity);
3. what the supply chain looks like afterwards, and the risk to it.

## 2. The solution: three layers

| Layer | What it is | Stands in for | Pitched? | Folder |
|---|---|---|---|---|
| **Bowman PLM** | Where Bowman's engineers work: parts, revisions, engineering BOMs, NCRs, ECRs, ECOs | Siemens Teamcenter | Never. It's scenery (#19) | `bowman/plm/` |
| **Norn** | Our product, deployed and configured for Bowman | Nothing: this is new | Yes, as "Norn" | `norn/` + `bowman/norn-config/` |
| **ERPNext** | Where Bowman's finance and supply chain work: items, BOMs, suppliers, prices, stock, standard cost, ledger | SAP S/4HANA | Never | `bowman/erp/` |

Bowman's data (`bowman/data/`) is the one source both systems are seeded from, so they agree.

```
 Engineers ──► Bowman PLM ◄──────► Norn ◄──────► ERPNext ◄── Finance, supply chain
               (Teamcenter)          │            (SAP)
                                     ▲
                    Norn's agents, and people's own agents (MCP)
```

Data flows both ways (Tyler, 2026-10-24):
- **PLM to Norn:** a new or updated ECR or NCR, with its affected parts and the BOM.
- **Norn to PLM:** the impact statement, the change class and the approval route, posted on the ECR
  where engineers and the CCB already look.
- **ERP to Norn:** costs, supplier prices and lead times, stock, open orders, and history: past
  BOM versions, price changes and journal entries.
- **Norn to ERP:** when an ECO is released, the new BOM, the new standard cost and draft journal
  entries (scrap, revaluation), each linked to the decision that caused it. Price variance is
  tracked back against the forecast. In v1 Norn makes these writes; at a real customer the
  existing PLM-to-ERP gateway usually moves the BOM, and Norn writes the money side.

**Meet people where they are (#19).** Engineers stay in the PLM and finance stays in the ERP.
Norn's results land inside those tools. People open Norn's own screens only for what those
tools can't show: digging into a forecast, the audit trail, the backlog roll-up. An ECR can also
start in Norn.

**What we demo:** a deployed, configured Norn at Bowman (§6).

## 3. How a change moves through Norn

1. **Problem found.** Someone files an NCR in the PLM: "the bracket cracked at 8.2 hours of a
   20-hour vibration test" (#8).
2. **Change requested.** The part's design engineer files an ECR, in the PLM or in Norn, as a draft
   or ready for review. Its form is Bowman's ECR, modelled on the defense ECP (#6).
3. **Impact screen, automatic.** Norn reads the ECR, the BOM and the costs, and runs every cheap
   check: the BOM delta, cost, timeline and supply simulation, with ranges. It sets the change
   class (#33), proposes the approval route from Bowman's configuration, and posts a
   **Level 1** impact statement on the ECR (#26). Cheap means code plus one inexpensive agent pass.
4. **Full impact assessment, on demand.** When someone asks, or Bowman's configuration says so,
   Norn's agents research properly: they replace default assumptions with researched ones, read
   history, check quotes and stock, and estimate how much scrapped stock can be recovered (#32).
   An adversarial reviewer pushes back between levels, and a blind checker forms its own view
   without seeing the answer. The result is published as Level 2, then Level 3, "Norn's final
   verdict". Ideally this runs once per ECR, and at most twice (#10).
5. **Decision.** Bowman's configuration decides what happens to the agent's recommendation (#22,
   #24). The agent always files the same thing: a recommendation with its reasoning. If the agent
   may approve this kind of change, the approval goes through. If not, a person sees "Norn
   recommends approval" with everything ready. Larger changes go to the CCB.
6. **ECO released.** Approval releases the ECO with its effectivity, and the ERP is updated (§2).
7. **Later: actuals.** Purchase price variance and real cut-in dates are compared against the
   forecast. This is the learning loop, deferred (`norn/ARCHITECTURE.md` §11).

Whether a Level 1 report can trigger fast-track approval, or only Level 3, is open (Tyler,
2026-10-24, #26).

## 4. What Norn is made of

Norn is a general platform, tuned to one company by configuration (#34). Detail is in
`norn/README.md` and `norn/ARCHITECTURE.md`.

- **A Git-style model of the production definition.** Internally the baseline is `main`, an ECR is
  a branch holding an overlay of edits, the impact checks are CI, and an ECO is a merge. This is
  internal framing only: everything a judge or user sees says Norn, ECR, ECO and impact
  assessment (`GLOSSARY.md`).
- **Checks.** Code computes every number. Agents read prose, propose assumptions, research, and
  write the narration (`norn/ARCHITECTURE.md` §3, §5).
- **Agents.** Norn's own agents run inside Norn. People's own agents (for example Claude Code on an
  engineer's laptop) connect over MCP with credentials and act on that person's behalf.
- **Configuration.** Everything company-specific is a config file: vocabulary, the ECR form,
  change classes, the approval matrix, roles, autonomy limits, materiality thresholds. Bowman's is
  in `bowman/norn-config/`. There is no settings screen.
- **Connectors** to the PLM and the ERP, using only the interfaces a real PLM and SAP expose.
- **Stack** (decided): TypeScript throughout, SpacetimeDB as the state and live-update layer,
  Claude models for the agents.

## 5. Trust: identity, permissions and the audit trail

Hyphenate asks "would you hire it?", and wants "a clean record of its work". These are the answer.

**Decided** (Tyler, 2026-10-24):
- **Every action has an owner** (#34): the actor, on whose behalf it acted, what spawned it ("Norn,
  automatically", or "Jeff's agent, for Jeff"), and the policy check that allowed it.
- **The stricter limit applies.** An agent acting for someone can do at most what that person can,
  and only what Bowman allows agents to do.
- **Autonomy is configuration, never a hard rule** (#24). Per kind of action, Bowman chooses:
  approve, approve with a sampled second check, recommend only, or escalate.
- **Every number and claim is coloured by evidence class:** fact, assumption, computation or
  judgment. Likelihood uses the ICD 203 words (`GLOSSARY.md`).
- **Every recommendation can be dug into** (#25): the sources the agent read, the researchers it
  spawned, the assumptions and where each came from, the calculations, and the reasoning that
  links them. A curious person on their lunch break can follow it.
- **Evidence an outside agent brings in** is labelled "reported by agent" until Norn can fetch the
  source itself.

**Proposed**, from the research (`research/trust-patterns-ai.md`, `research/trust-patterns-human.md`):
- the platform writes the log, not the agent; the model's own reasoning text is not the audit
  record;
- every number is traced, so it can be replayed from its inputs;
- quotes are checked against their source before posting, and every post is checked against
  Bowman's standards before it goes up (#35);
- sign-offs bind to a version: a new ECR revision voids the approvals given on the old one;
- escalations are written as SBAR (situation, background, assessment, recommendation);
- materiality: no nitpicks and no inflating, the restraint of a good analyst in front of the CFO
  (#30);
- audit verification letters (T/V/R/C) on numbers.

## 6. What we demo *(proposed)*

Norn, deployed at Bowman, running live on real systems:
1. An engineer files ECR-0417 in Bowman's PLM: the motor-controller bracket goes from Rev B to Rev
   C after the vibration-crack NCR.
2. Within a minute, Norn's Level 1 impact statement appears on the ECR in the PLM: unit cost,
   one-time cost, cut-in date and supply risk, each with a range.
3. The full assessment runs. The scrap number drops once Norn finds the old stock can be used
   elsewhere, or holds when it can't (#32). The adversarial review is visible. Level 3 lands.
4. Bowman's configuration routes it: Class I and over the fast-track limit, so the CCB decides.
   A trivial colour change elsewhere was approved by Norn on its own, within its limits.
5. The CCB approves in the PLM. The ECO releases, and ERPNext shows the new BOM, the new standard
   cost and a draft journal entry for the scrap, each linking back to the decision.
6. A judge clicks any number and follows it to its source.

## 7. The first version: milestones

Each milestone is a GitHub milestone holding its issues; `gh issue list --milestone "<name>"`.
Priority follows the milestone. The order is by dependency.

| Milestone | Done when | Priority |
|---|---|---|
| **M1 Foundations** | ERPNext, the PLM and Norn all run from the repo, seeded with Bowman's data, and Norn's skeleton passes the SpacetimeDB spike | immediate |
| **M2 One ECR end to end** | Filing ECR-0417 in the PLM puts a Level 1 impact statement on it, and on Norn's own page, with cost ranges shaped like the ECP cost page | immediate |
| **M3 Decision and write-back** | Bowman's configuration routes each ECR, the policy gate checks every write, and releasing the ECO updates ERPNext's BOM and standard cost with a traceable draft journal entry | immediate |
| **M4 Depth and trust** | The full assessment runs on demand to Level 3 with adversarial review; every number is coloured and traceable; timeline and supply risk are simulated | before demo |
| **M5 Outside agents** | A person's own agent connects over MCP, acts on their behalf within the stricter limit, and its posts pass the post check | before demo |
| **M6 Demo and submission** | The demo path is rehearsed on the machines and network it will run on; the video and the Devpost draft are done | before demo |

Ideas past these milestones keep their `priority: if time` label: SAP's Engineering Change Cockpit
(#27), asking the agent questions about its report (#29), voice filing (#9).

## 8. Open questions

- Can a Level 1 report trigger fast-track approval, or only Level 3? (#26)
- What does a typical fast-tracked ECR at Bowman look like, and what are its limits? (#22)
- How do engineers come to file an ECR, and who is involved? (#7)
- Which tech the PLM stand-in uses: a second Frappe site, as #21 suggests, or a small app of our
  own. Settled when that work starts.
- The colours for the evidence classes, and whether the T/V/R/C letters are adopted.
- Whether Ankit can approve what the workflow says Tyler approves.
- Code-freeze time, the video deadline, and who records it.
