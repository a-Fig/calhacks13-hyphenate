# Norn's architecture: ECRs as branches, ECOs as merged PRs

The design of Norn's engine: its internal model, checks, data and state layer. Drafted 2026-10-24 for CalHacks 13, rewritten the same day around a Git-style branch/PR model, and moved here from `docs/` the same day. The repo had no code when this was written, so nothing here describes existing code. Where Norn sits among Bowman's systems, the demo and the milestones are in `docs/PLAN.md`; what Norn is responsible for is `README.md` in this folder.

**Scope.** Loop 1 (forecast production impact) is the goal. Loop 2 (benchmark forecasts against actuals, self-improve) is deferred; only a few cheap hooks are reserved (§11).

**Epistemic status.**
- The product description comes from conversations with Archer senior staff. We have not seen a real ECR/ECO, BOM, supplier file, or their PLM system, so every data shape and workflow state below is an assumption.
- SpacetimeDB facts in §9 come from its docs, read on 2026-10-24, and from an independent review of the docs and release notes the same day. The docs are marketing-heavy in places and several limits are unstated, so unverified items are marked. Nothing in §9 has been run.
- The PLM/ECO process facts in §2 come from vendor blogs and ERP/PLM documentation, not independent studies.

**Decided since the first draft** (Tyler, 2026-10-24; `docs/PLAN.md` has the whole picture):
- **The company and its systems.** Norn is deployed at Bowman Aviation, a fake Archer (`bowman/`). Bowman's PLM is a stand-in for Teamcenter and its ERP is ERPNext, standing in for SAP. Norn reads both and writes its results back into both.
- **ECRs** follow Bowman's form, modelled on the defense ECP (#6). An NCR, the problem found, comes before the ECR, like an issue before a PR (#8).
- **Review in tiers** (#10, #26). The impact screen (code checks plus one cheap agent pass) runs automatically and publishes Level 1. The full impact assessment (research agents, adversarial review) runs on demand, once or at most twice per ECR, and publishes Levels 2 and 3. §8 is updated for this.
- **Identity and policy** (#34). Every write records its actor, on whose behalf, what spawned it, and the policy check that allowed it. Autonomy limits come from the company's configuration.

---

## 1. Problem and users

Engineering teams change the aircraft design constantly. Each change is filed as an engineering change request (ECR) and, once approved, becomes an engineering change order (ECO). There is a backlog of ECRs.

Finance does not care what a change costs R&D. They care what it does to **production**:

1. final per-unit cost at production volume,
2. when the change takes effect on the line,
3. what the supply chain looks like afterwards, how it can be interrupted, and the resulting risk.

For each ECR they get a **production impact card**; for the backlog they get a **roll-up**. Both show ranges, not point estimates, and every number traces back to the assumptions that produced it.

## 2. The model: version control for the production definition

The production definition (BOM, sourcing options, assumptions) is a repository. Proposed changes are branches. Review is a pull request. Approval is a merge.

| Git / GitHub | Here |
|---|---|
| `main` | The production baseline: BOM, sourcing options, volume plan, assumptions |
| Branch | An ECR: an overlay of changes (parts, quantities, specs, suppliers) on a base version of `main` |
| Commit | A revision of that overlay: agent extraction from the ECR text, an engineer's correction, a reviewer's edit to an assumption |
| Pull request | The ECR under review |
| Merge | The ECO: the change becomes part of the baseline |
| CI checks | The forecast stages (§5), run on (base, head) |
| Bot comment | The production impact card |
| Diff | A BOM diff plus a **forecast diff**: forecast(base + ECR) − forecast(base) |
| Merge conflict | Two ECRs changing the same entity/field, or interacting through a shared supplier or part (§6) |
| Stacked PRs | An ECR that only makes sense after another one lands |
| Merge queue / integration branch | The backlog roll-up: a chosen, ordered set of ECRs merged into one branch and forecast as a unit |
| CI re-run when `main` moves | A new supplier quote or a merged ECO changes the base, so open forecasts recompute |
| Post-merge review / revert | Loop 2: compare the forecast to actuals |

What this buys us:
- The backlog roll-up is "forecast the integration branch", not a special feature. It also fixes the double-counting you get from summing per-ECR deltas when ECRs touch the same part.
- Conflict detection has a defined meaning (a three-way comparison against the common base).
- Human-in-the-loop is natural. A reviewer correcting an agent-estimated assumption is a new commit that re-triggers the checks.
- The UI is a pattern reviewers already understand.

### Where the analogy breaks

- **Effectivity.** A merged ECO does not change every unit. Arena's ECO template carries a material effectivity date and an inventory disposition per affected item, and PLM guidance stresses handling in-flight stock and work in progress. So `main` is closer to a timeline than a single state, and "when does the merged change take effect" is an output of our timeline stage (§5), not metadata. See §7.
- **Hidden coupling.** Two ECRs can merge cleanly and still interact physically (a weight change alters range, which alters battery sizing). We can detect shared-entity conflicts; we cannot detect physics. Interaction flags are best-effort.
- **Vocabulary.** Settled for Bowman: NCR → ECR → ECO, with no separate ECN. `GLOSSARY.md` maps each Git term to its business term, and anything a judge or user sees uses the business term.
- **We mirror, not replace.** Norn reads ECRs and baseline data from Bowman's PLM and ERP, and writes its results back into them; it does not become the system of record (#19, `docs/PLAN.md` §2).
- **Prior art.** The idea already exists in PLM: Onshape markets branch-and-merge as ECO-style change isolation, and PLM systems keep "redlined" pending BOMs. We are not inventing the concept, we are attaching a production-cost-and-risk forecast to it.

### What we don't build

A general version-control engine. A branch is a base pointer plus an overlay keyed by (entity, field); the state at a branch head is a deterministic function of `main` at the base plus the overlay's commits. At the scale we expect (hundreds of parts, tens of ECRs) this is a few tables.

## 3. Principles

- **LLMs interpret; code computes.** Agents read prose (ECR text, supplier notes), extract structure, propose assumptions, and write explanations. Arithmetic, BOM diffs, and simulation are deterministic code. An LLM never produces a final cost number directly.
- **Assumptions are data.** Every input that isn't a given fact (a lead-time distribution, a scrap rate, a learning-curve slope) is a versioned row with a value or distribution, a source (`given` / `default` / `agent_estimated`), and a rationale. Assumptions live on `main` and can be overridden in a branch.
- **Forecasts are decomposed and carry ranges.** Cost is a sum of line items, each with p10/p50/p90. Timeline is a critical path of named steps. This is what lets a human ask "why", and what makes Loop 2 possible.
- **A check run is a pure function of its inputs.** Each run is keyed by a hash of (base state, overlay, assumptions, code version, seed). Same hash, same numbers. "Is this forecast current?" is a hash comparison.
- **Compute stays out of the database.** Monte Carlo and LLM calls run in workers. The state layer holds data, coordinates work, and shows results.

## 4. Data model (sketch)

Names and fields are provisional.

**Baseline (`main`)**
- `Part(id, name, category, spec_json)`, `Supplier(id, region, ...)`
- `BomLine(main_version, assembly, part, qty)`
- `SourcingOption(part, supplier, unit_price_dist, lead_time_dist, moq, capacity, qualified)`
- `VolumePlan(period, units)`
- `Assumption(id, scope, key, dist_json, source, rationale, created_by)`
- `MainVersion(n, parent, merged_pr, merged_at, effectivity)`: appended on every merge or reference-data update.

**Branches and PRs**
- `Branch(id, kind: ecr | integration, base_version, head_commit)`
- `Commit(id, branch, parent, author_kind: agent | human, author, message, created_at)`
- `Change(commit, entity_type, entity_id, field, op: set | add | remove, expected_old, value_json, source_span)`: the overlay. `expected_old` is the value the author saw on `main`; rebasing onto a newer `main` is a three-way check of `expected_old` against the current value, and a mismatch is a textual conflict (§6). `source_span` points into the ECR text for agent-extracted changes, with a confidence.
- `PullRequest(id, branch, status: draft | review | approved | merged | closed, title)`, `Review(pr, reviewer, verdict)`, `Comment(pr, author, anchor, body)`
- `IntegrationMember(integration_branch, ecr_branch, position)`

**Check runs (immutable)**
- `CheckRun(id, pr_or_branch, stage, input_hash, status, claimed_by, lease_expires_at, started, finished)`
- `CostLine(check_run, line_item, volume_period, p10, p50, p90)`
- `TimelineStep(check_run, step, depends_on, duration_dist, on_critical_path)`, `TimelineResult(check_run, effectivity_p10/p50/p90)`
- `RiskMetric(check_run, metric, value, detail_json)`
- `ImpactCard(check_run, summary_md, drivers_json, flags_json)`

Raw Monte Carlo samples are not stored as rows. Rows hold summary statistics and histogram bins; the seed plus code version regenerates samples on demand.

## 5. Checks (the forecast pipeline)

Each check runs on (base, head) for a branch and produces a result plus a delta against the same check on the base. `forecast(main)` is itself a cached check, computed once per `MainVersion`.

| Check | Input | Output | Agent or code |
|---|---|---|---|
| S0 Extract | ECR document | A commit of `Change`s: structured list of part/quantity/spec/supplier changes, each with a confidence and a pointer to the source text | Agent, human-confirmable on the PR page |
| S1 BOM delta | `main@base` + overlay | The BOM at head, the diff, affected parts and suppliers | Code |
| S2 Cost | BOM delta, sourcing options, assumptions | Per-unit cost delta by line item at each point on the volume plan: material, labor/assembly time, tooling (amortized), scrap/yield, learning curve | Code, with agents proposing missing assumptions |
| S3 Timeline | BOM delta, sourcing, assumptions | Effectivity date: critical path over requalification/testing, tooling lead time, supplier lead time, burn-down of old-part inventory | Code, with agents proposing missing assumptions |
| S4 Supply chain | Sourcing graph at head | Monte Carlo over lead time, price, capacity and disruption events. Risk metrics: probability of missing the effectivity date, single-source exposure, p90 lead time, cost-at-risk, top disruption scenarios | Code (simulation), agent proposes disruption scenarios |
| S5 Card | S2–S4 results | Impact card: headline numbers with ranges, top drivers (sensitivity), plain-language explanation, flagged low-confidence assumptions | Agent (narration only; numbers are passed in) |

Notes:
- **S0 is the fragile check.** ECR prose is free-form and may reference part numbers that don't map cleanly. Low-confidence changes are surfaced on the PR page for a human to confirm instead of flowing downstream silently.
- **Gap-filling.** Real ECRs will rarely state a requalification duration or a tooling cost. An agent proposes a distribution from category defaults and comparable parts and records it as an `agent_estimated` assumption with a rationale. The card flags it. A finance reader can see which numbers rest on guesses and edit them.
- **S4 compares routes on shared random draws.** Old route versus new route use the same random numbers, so the difference isn't simulation noise. The same applies to cost and timeline deltas: percentiles of two distributions cannot be subtracted, so a forecast diff is the percentiles of the per-draw difference (paired simulation), not p50(head) − p50(base).
- **DAG.** `S0 → S1 → {S2, S3, S4} → S5`. If S3 turns out to need S4's lead-time results the DAG gets an edge.

## 6. Integration branch and conflicts

The backlog roll-up is an integration branch: an ordered list of ECR branches merged into one overlay and checked as a unit. Order matters (later ECRs see earlier ones), so the roll-up is scenario-specific and finance can reorder, add, or drop members.

Conflict kinds, from most to least certain:

1. **Textual**: two branches change the same (entity, field) differently, or one removes what the other modifies. Detected by comparing overlays against the common base. Blocks the merge until someone chooses.
2. **Shared-resource**: different entities, same supplier or same capacity-limited part. Not a merge failure, but the combined forecast differs from the sum, so it is flagged and the integration forecast is what to read.
3. **Dependency**: an ECR is only meaningful after another (stacked). Declared by a human or suggested by an agent reading the ECR text.
4. **Physical interaction**: not detectable here (§2). Out of scope.

First cut: detect 1 and 2, flag 3 when declared, ignore 4.

## 7. Effectivity and `main` as a timeline

Merging an ECO sets an effectivity (a date or unit boundary) taken from the S3 result, possibly overridden by a human. Cost and volume math then splits production into before and after the cut-in: units before use the old part, units after use the new one, and there is a transition period burning down old inventory. S2 consumes this split.

Minimum viable version: one effectivity date per ECO and a simple inventory burn-down. Anything finer (per-serial effectivity, lot boundaries) is deferred.

## 8. Execution model

- **Workers** claim a pending check run whose dependencies are done, run it, and write results. Claiming is atomic (one worker wins), and each claim has a lease so a crashed worker's run is retried.
- **Invalidation is a reconcile loop.** When `main` advances, or a branch gets a new commit, the expected `input_hash` for each check changes. Any code check without a matching completed run is enqueued. Agent-heavy deep review is not re-run automatically: it runs when someone asks, or when the company's configuration says so, and a stale one is marked stale rather than recomputed (#10). Because the hash is a pure function of inputs, this stays correct even if enqueueing is not atomic with the change.
- **Idempotency.** A check's output is keyed by `(branch, stage, input_hash)`. Re-running a completed key is a no-op. The hash covers canonical JSON of everything that affects the result: `main` version, overlay, assumptions, seed, and code/worker version.
- **Edit bursts and approvals.** Assumption edits are debounced so a reviewer typing doesn't trigger a burst of recomputes. A new revision of a PR dismisses approvals given on the previous one.
- **Determinism.** Seeds and code version are in the hash. Only S0, gap-filling, and S5 involve an LLM; their outputs are stored, not re-derived.

## 9. State layer: SpacetimeDB (decided)

**Decision, 2026-10-24: the team is using SpacetimeDB.** It is the confirmed state and coordination layer; the rest of the stack is still open. The team wanted a reason it fits, not just a reason it doesn't hurt. The reasoning below (the author's analysis plus an independent review by a separate agent, briefed with the workload and the docs findings but not the author's conclusion) is kept so later readers can see what the choice rests on and what it doesn't.

What the choice rests on: the live, multi-user PR review surface (§2, §10) and the consistent single-update invalidation on assumption edits. What it does not rest on: price (Maincloud is $0 / $25 / $250 per month at the Free / Pro / Team tiers on 2026-10-24, and the source is available on GitHub under a Business Source License; the license text itself has not been read), analytics, or compute, none of which SpacetimeDB contributes.

Known open risks, not blockers: TypeScript is the newest SpacetimeDB module language (new in 2.0) while Rust is the longest-standing, so the spike checks the TypeScript module and a Rust module is the fallback inside SpacetimeDB; the product is young with breaking changes in recent minor releases; and if Archer's ECR/BOM data is export-controlled (e.g. ITAR; not checked), Maincloud may be unusable and the options are self-hosting or the custom-priced Enterprise tier. Whether finance values "live" as much as the demo does is also untested; ECR review is largely asynchronous.

### What the layer must provide

1. Live updates to a multi-user PR page: check results stream in, assumption edits and comments appear for other viewers.
2. Safe concurrent edits (two reviewers editing assumptions or toggling integration members).
3. Atomic task claiming by workers, with leases.
4. A place for the overlay and baseline tables (§4), at small scale.
5. Narrow enough write surface that swapping the layer later is cheap.

It does **not** need analytics, large data, or heavy compute.

### What the SpacetimeDB docs say (read 2026-10-24)

The independent review put the current release at 2.13.0 (21 Oct 2026), not the 2.8 the first read showed, and noted breaking changes in recent minors (2.12 rejects HS256 JWTs; 2.13 changed TypeScript `Result` types). Pin the version. [Releases](https://github.com/clockworklabs/SpacetimeDB/releases).

- Reducers are transactional and cannot do I/O. Procedures can make HTTP calls (30 s default timeout, capped at 180 s), must open transactions manually, and cannot send HTTP while holding one. Procedures are marked unstable in C#, C++ and Rust.
- Views are subscribable. Query-builder views update incrementally; procedural views re-run when their read set changes. Documented operators are semijoin and `count()`; no sum or group-by was found.
- Subscription SQL: no aggregates, joins limited to two tables with indexed join columns. One-off queries document only `COUNT`.
- Modules: Rust, C#, TypeScript (new in 2.0), C++. Official client SDKs: TypeScript, Rust, C#, C++. There is no official Python SDK (the PyPI `spacetimedb-sdk` 0.7.0 is stale). A Python worker has three documented routes: `POST /v1/database/:db/call/:reducer` (JSON array of arguments; also works for procedures), `POST /v1/database/:db/sql` (queries and DML), and a raw websocket at `/subscribe` using the `v1.json.spacetimedb` text protocol. See the [HTTP API](https://spacetimedb.com/docs/http/database).
- All data is held in RAM. The FAQ says Maincloud handles replication; the review found no "single node" statement (my earlier wording was an inference). The FAQ says it is "designed for any real-time application" and "purpose-built for real-time applications, not batch processing or analytics".
- Reducers "may execute concurrently". No documented reducer time limit and no named isolation level were found. Subscription updates arrive as one atomic message per transaction, in commit order. Equality filters on indexed columns are cheap, so a per-`pr_id` subscription is fine. The TypeScript client reconnects automatically since 2.12.
- Modules can expose their own HTTP routes (beta, bypasses normal auth checks). Scheduled functions run concurrently since 2.10.1.
- Schema changes: adding a column at the end with a default is safe; most other changes need `--delete-data`. Keep a reseed script.
- Scheduled tables can trigger reducers or procedures at set times.
- No native branching or forking was found. The overlay model in §4 is ordinary tables either way.

Sources: [FAQ](https://spacetimedb.com/docs/intro/faq), [Functions](https://spacetimedb.com/docs/functions), [Views](https://spacetimedb.com/docs/functions/views), [Procedures](https://spacetimedb.com/docs/functions/procedures), [SQL reference](https://spacetimedb.com/docs/reference/sql).

### Assessment

Requirement 1 and 2 are where SpacetimeDB is built to be strong: a PR page is a collaboration dashboard, and clients subscribing to rows filtered by an indexed column (e.g. `pr_id`) get push updates with a local cache and no hand-written websocket layer. Requirement 3 works but is a pattern we build (a claim reducer plus a lease), not a feature. Requirements 4–5 are neutral.

The aggregation and analytics limits do not bite: roll-ups are forecasts of a merged branch, computed in workers and stored as rows, and percentiles don't aggregate by SQL anyway. The RAM limit does not bite at this scale.

Two earlier arguments are weaker than the first draft of this spec claimed:
- *Atomic invalidation cascade.* With hash-keyed runs (§8), a reconcile loop is correct without it.
- *DB as agent queue.* Doable, but Postgres with `SELECT ... FOR UPDATE SKIP LOCKED` is equally mature.

### Independent review (summary)

Verdict: a conditional yes, as the coordination and live-state layer only. If the team writes Python and nobody wants to write the module in TypeScript, use Supabase (Postgres + Realtime) instead. Do not use Dolt.

Where it beats the alternatives (the reviewer's inference, not tested):
1. **One transaction, one update on every screen.** A single `edit_assumption` reducer can check the expected revision, write the new one, mark old runs stale, enqueue jobs and dismiss stale approvals. Every viewer receives that as one update, so nobody sees half-invalidated checks. Postgres can do this in a function, but a client on Supabase Realtime gets separate row events and has to refetch. This revises the first-draft argument: hash-keyed runs make staleness *correct* without atomicity (§8), but atomicity still gives viewers a *consistent screen*, which matters for a live demo.
2. **The job queue comes almost free.** A `claim` reducer with a lease is race-free; workers learn of new jobs via subscription; a scheduled reducer reclaims expired leases.
3. **No backend to write.** The module is the backend and generates typed TypeScript bindings. With SQLite the API, websocket fan-out and client cache would be roughly 300–500 lines (the reviewer's estimate).

Where it is worse:
- **Python workers are second-class**: HTTP polling, or a small TypeScript process using the SDK in front of them (budget 1–2 hours). Monte Carlo over a few hundred parts in Node is fine. (No longer applies: the stack is TypeScript, §10.)
- **No ad-hoc analytics.** Every roll-up is code that writes rows.
- **Schema changes in a hurry cost a republish** (see above).
- **Learning curve**: 2–4 hours to a first live table for a new team, versus about 30 minutes for Supabase (the reviewer's estimate).
- **Dolt**: branches and diffs operate on raw table cells, not on the meaning of a change; no realtime; adds a server.

### Alternatives

| Option | Strong at | Costs |
|---|---|---|
| SpacetimeDB | Live multi-user subscriptions, one system for state + reactivity | Younger ecosystem; no Python SDK; procedures/long-task behavior unverified; team learning curve |
| Postgres + realtime layer (e.g. LISTEN/NOTIFY, Supabase Realtime, Electric) | Mature; Python-friendly; branch overlay queries in full SQL | We assemble the live layer and client cache ourselves |
| Dolt | Native branch/diff/merge over SQL (`dolt_diff`, `DOLT_MERGE`) | No live push; not designed for many small concurrent edits; still need a reactive layer |
| SQLite/Postgres + a small websocket server | Simplest to reason about | Hand-rolled everything live |

### Spike (first build step, time-boxed)

The spike exercises the real scenario, not a toy. The reviewer estimated about 4 hours; that figure is unverified.
1. **TypeScript worker and module**: a TypeScript worker using the SDK claims a check run, writes results, and hits a reducer error, against a TypeScript module. Confirm error behavior is reliable enough to build retry logic on, and note any TypeScript-module rough edges (the newest module language).
2. **Two browsers on one PR** (subscription filtered by `pr_id`): an assumption edit invalidates old checks atomically on both screens, and switching PRs is clean (subscribe to the new one before unsubscribing from the old one, per the docs).
3. **Streaming progress**: a Monte Carlo worker writes progress rows at about 2 per second with percentile arrays, and the UI keeps up.
4. **Crash recovery**: a killed worker's lease expires and the run is retried by another worker.
5. **Iteration speed**: republishing after a column change plus reseeding takes under a minute.
6. **Hosting**: a Maincloud deploy with anonymous demo users works, or we decide to run locally with `spacetime start` for the demo.

The decision is made, so the spike's job is to surface problems early, not to approve the choice. If something fails badly (any of 1–3 takes unreasonable time, or the TypeScript module proves too immature), bring it back to the team with what was tried before changing course; the contingency is Postgres + Supabase Realtime, and the narrow API below keeps that switch contained.

### Fallback and portability

All writes go through a narrow API (`enqueue_check`, `claim_check`, `complete_check`, `add_commit`, `record_assumption`, `add_comment`, `set_pr_status`) instead of workers or the UI touching tables ad hoc. Swapping the layer then means reimplementing that API.

## 10. Components

Norn's parts (state layer, workers, connectors, web, MCP server) and their folders are listed in `README.md`. The first draft's data generator is now Bowman's dataset, `bowman/data/`. The web UI's first-draft scope still holds: backlog list, PR page (diff, impact card, streaming check status, assumption inspector with inline editing, comments, reviews), integration-branch builder with reorder/toggle and conflict flags, and the S0 confirmation screen.

**Language policy (decided 2026-10-24): TypeScript by default; another language only where it clearly earns its place.** The team has no language preference beyond that. Concretely: the SpacetimeDB module, UI, agent workers and compute workers are all TypeScript, sharing types through the generated bindings. The reducers are small claim/CRUD/transaction logic with no performance demand, so a TypeScript module costs nothing in speed.

Candidates for a different language, none needed yet:
- The **Monte Carlo hot loop in Rust** (native or WASM) if profiling shows TypeScript is too slow. The author's estimate is that a few hundred nodes and thousands of draws is comfortably fast in TypeScript; this is unmeasured.
- The **SpacetimeDB module in Rust**, the longest-standing module language, if the TypeScript module proves immature in the spike.

Python is not planned. The narrow API (§9) remains the seam if a component in another language is added.

## 11. Loop 2 hooks (everything else deferred)

Done now because it's nearly free and hard to retrofit:
- Check runs are immutable and store seed, code version, assumptions hash, and base/overlay.
- A merged PR keeps the forecast it was approved on, so "what did we think when we merged it" stays answerable.
- Outputs are decomposed with ranges (§3), so a later variance can be attributed to a line item or assumption.
- `Assumption.source` and `rationale` are recorded.

Deferred: `Actual`, `Variance`, `Attribution` tables; scheduled revisits (post-merge review); prior updates; a backtest harness; a "why were we wrong" agent.

## 12. Fake data

Now Bowman's dataset: `bowman/data/README.md`. It keeps this section's constraints: a plausible electric-aircraft BOM, suppliers with lead-time distributions, a volume ramp, ECRs written as realistic prose of varied clarity, one pair that conflicts textually, one pair that interacts through a shared supplier, and past changes with their actual outcomes.

## 13. Suggested build order

The milestones in `docs/PLAN.md` §7 supersede this list across all three layers. It's kept as the order of work inside Norn.

1. SpacetimeDB spike (§9): stand up a module, a worker, and two live browsers, and surface problems early.
2. Schema + narrow API + check-run queue running end to end with a dummy check.
3. Minimal fake data: small BOM, a few suppliers, 3–5 ECRs.
4. Branch/overlay model: apply an overlay to `main`, produce the BOM at head and the diff (S1), PR page shell.
5. S0 extraction with confirmation UI.
6. S2 (cost) and S3 (timeline) with simple distributions, forecast diff on the PR page.
7. S4 (supply chain simulation) and S5 (card): **one ECR in, PR page with live checks and impact card out.**
8. Integration branch with ordering, toggling, and textual/shared-resource conflict flags.
9. Live demo moves: change a supplier input on `main` and watch open PRs recompute; reviewer edits an assumption and the card updates.
10. Loop 2, if time remains.

## 14. Open questions

- What does an ECR look like at Bowman? Decided: a structured form in the PLM, modelled on the defense ECP, with free-text description and justification (#6). S0 extracts from the text and checks it against the fields.
- Is "production" cost the full aircraft or per subsystem? This sets BOM depth.
- Who confirms S0 output in practice: the filing engineer, or finance?
- How does finance want ranges shown (p10/p50/p90, probability of exceeding a threshold, scenario table)?
- Does Bowman track cross-ECR dependencies, or do we infer them?
- Effectivity: per date, per unit, or per serial range?

## Sources for §2

[Onshape: cloud-native CAD/PDM/PLM workflow](https://www.onshape.com/en/blog/cloud-native-cad-pdm-plm-workflow-onshape-arena), [Autodesk: engineering change management process](https://www.autodesk.com/blogs/design-and-manufacturing/engineering-change-management-process/), [Arena ECO template](https://www.arenasolutions.com/wp-content/uploads/arena-eco-template.pdf), [Oracle PeopleSoft: Creating and Maintaining ECRs](https://docs.oracle.com/cd/G47724_01/fscm92pbr55/eng/fscm/segg/CreatingandMaintainingECRs-9f1453.html), [Dolt cheat sheet](https://www.dolthub.com/docs/guides/cheat-sheet.md).
