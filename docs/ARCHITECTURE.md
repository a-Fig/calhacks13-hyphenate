# Architecture: ECR/ECO → production-impact forecasting

Drafted 2026-10-24 for CalHacks 13. The repo was empty at the time of writing, so nothing here describes existing code.

**Scope.** Loop 1 (forecast) is the goal. Loop 2 (benchmark against actuals and self-improve) is deferred and only has a few cheap hooks reserved (§9).

**Epistemic status.** The product description comes from conversations with Archer senior staff. We have not seen a real ECR/ECO, BOM, or supplier dataset, so every data shape below is an assumption. Claims about SpacetimeDB are from the author's training knowledge and are unverified against the current release. §7 lists the ones to check first.

---

## 1. Problem and users

Engineering teams change the aircraft design constantly. Each change is filed as an engineering change request (ECR) and, once approved, becomes an engineering change order (ECO). There is a backlog of ECRs.

Finance does not care what a change costs R&D. They care what it does to **production**:

1. final per-unit cost at production volume,
2. when the change can reach the line (timeline),
3. what the supply chain looks like after the change, how it can be interrupted, and the resulting risk.

Output for each ECR is a "production impact card". Output for the backlog is a roll-up across ECRs. Both show ranges, not point estimates, and every number traces back to the assumptions that produced it.

## 2. Principles

- **LLMs interpret; code computes.** Agents read prose (ECR text, supplier notes), extract structure, choose priors, and write explanations. Arithmetic, BOM diffs, and simulation are deterministic code. An LLM never produces a final cost number directly.
- **Assumptions are data.** Every input that isn't a given fact (a lead-time distribution, a scrap rate, a learning-curve slope) is a row with a value, a distribution, a source (`given` / `default` / `agent_estimated`), and a rationale. A forecast is only meaningful alongside the assumptions it used.
- **Forecasts are decomposed and carry ranges.** Cost is a sum of line items, each with p10/p50/p90. Timeline is a critical path of named steps. This is what lets a human ask "why", and what makes Loop 2 possible later.
- **Forecast runs are immutable.** A change to inputs produces a new run; it never edits an old one.
- **Compute stays out of the database.** Monte Carlo and LLM calls run in workers. The database holds state, coordinates work, and pushes updates.

## 3. Pipeline (Loop 1)

Each stage reads and writes rows (§5). Stages are tasks in a DAG per ECR (§6).

| Stage | Input | Output | Agent or code |
|---|---|---|---|
| S0 Ingest | ECR/ECO document | `ChangeSet`: structured list of `ChangeItem`s (part added/removed/replaced, spec/material change, supplier change, quantity change), each with a confidence and a pointer to the source text | Agent (extraction), human-confirmable in the UI |
| S1 BOM delta | Baseline production BOM + `ChangeSet` | New BOM revision (a diff, not a copy), plus the list of affected parts and suppliers | Code |
| S2 Cost | BOM delta + sourcing options + assumptions | Per-unit cost delta by line item at each point on the production volume schedule: material, labor/assembly time, tooling (amortized), scrap/yield, learning curve | Code, with agents proposing missing assumptions |
| S3 Timeline | BOM delta + sourcing + assumptions | Effectivity date: critical path over requalification/testing, tooling lead time, supplier lead time, inventory burn-down of the old part | Code, with agents proposing missing assumptions |
| S4 Supply chain | New sourcing graph | Monte Carlo over lead time, price, capacity and disruption events. Risk metrics: probability of missing the effectivity date, single-source exposure, p90 lead time, cost-at-risk, top disruption scenarios | Code (simulation), agent proposes disruption scenarios |
| S5 Synthesis | S2–S4 results | Production impact card: headline numbers with ranges, the top drivers (sensitivity), plain-language explanation, flagged low-confidence assumptions | Agent (narration only; numbers are passed in) |

Notes on stages:
- **S0 is the fragile stage.** ECR prose is free-form and may reference part numbers that don't map cleanly. Low-confidence items surface in the UI for a human to confirm instead of silently flowing downstream.
- **S2/S3 gap-filling.** Real ECRs will rarely state a requalification duration or a tooling cost. An agent proposes a distribution from category defaults and comparable parts, records it as an `agent_estimated` assumption with a rationale, and the card flags it. A finance reader can see which numbers rest on guesses.
- **S4 is where the "different route" story lives.** A change that swaps a supplier or a material creates a new sourcing graph; the simulation compares old versus new route on the same random draws so the difference is not noise.

## 4. Backlog roll-up

Summing per-ECR deltas is wrong when ECRs touch the same part, the same supplier, or depend on one another (ECR B only makes sense if ECR A lands). The roll-up therefore works on a **scenario**: an ordered set of ECRs applied to the baseline BOM, producing one merged BOM revision, which is forecast as a unit.

- Per-ECR cards (each ECR applied alone to the baseline) answer "what does this one change do".
- Scenario cards answer "what does the backlog do", and let finance toggle ECRs in or out to see the effect.
- First cut: detect and flag conflicts (shared parts or suppliers) without trying to resolve them. Automatic resolution is out of scope.

## 5. Data model (sketch)

Names and fields are provisional. Grouped by role.

**Reference data (baseline, changes rarely)**
- `Part(id, name, category, spec_json)`
- `BomRevision(id, parent_revision, source: baseline | ecr | scenario)` and `BomLine(revision, part, qty, ...)` stored as diffs against the parent.
- `Supplier(id, region, ...)`
- `SourcingOption(part, supplier, unit_price_dist, lead_time_dist, moq, capacity, qualified: bool)`
- `VolumePlan(period, units)`

**Inputs**
- `Ecr(id, text, status, filed_at)`, `ChangeSet(ecr, ...)`, `ChangeItem(changeset, kind, part, payload_json, confidence, source_span)`
- `Assumption(id, scope, key, dist_json, source, rationale, created_by)`

**Outputs (immutable per run)**
- `ForecastRun(id, scenario_or_ecr, bom_revision, assumptions_hash, code_version, seed, created_at, status)`
- `CostLine(run, line_item, volume_period, p10, p50, p90)`
- `TimelineStep(run, step, depends_on, duration_dist, on_critical_path)` and `TimelineResult(run, effectivity_p10/p50/p90)`
- `RiskMetric(run, metric, value, detail_json)`
- `ImpactCard(run, summary_md, drivers_json, flags_json)`

**Coordination**
- `Task(id, run, kind, status, claimed_by, lease_expires_at, attempts, depends_on)`
- `Scenario(id, owner, ecr_ids_ordered)`

Raw Monte Carlo samples are not stored as rows. Rows hold summary statistics and histogram bins; the seed plus `code_version` regenerates the samples on demand.

## 6. Execution model

- **Task DAG per run.** `S0 → S1 → {S2, S3, S4} → S5`. S2, S3, S4 can run in parallel once S1 is done (S3 reads S4's lead-time results when available; if that coupling proves necessary the DAG gets an edge).
- **Workers** claim a task whose dependencies are done, run it, and write results. Claiming is atomic (one worker wins), and each claim has a lease so a crashed worker's task is retried.
- **Idempotency.** A task's output is keyed by `(run, kind)`. Re-running overwrites nothing; it fails if results exist.
- **Invalidation cascade.** When a reference fact changes (a new supplier quote, a revised lead time, a BOM baseline update), every non-terminal run that read it is marked `stale` and a fresh run is enqueued. This must be atomic with the change that caused it, otherwise the UI shows forecasts that quietly no longer match the data.
- **Determinism.** A run records its seed and code version. Re-executing S2–S4 with the same inputs gives the same numbers; only S0, gap-filling, and S5 involve an LLM, and their outputs are stored, not re-derived.

## 7. Where SpacetimeDB fits (and where it doesn't)

SpacetimeDB is a database that runs application logic inside it (modules whose functions, called *reducers*, run as transactions) and pushes changes to clients that subscribe with SQL queries, keeping a local replicated cache. The question is whether this architecture needs those properties, as opposed to merely tolerating them.

### The case for

The architecture has three jobs that a conventional stack handles with separate glue, and SpacetimeDB covers all three in one place.

1. **Live reactive forecast graph.** The central product behavior is "an input changed, so every dependent forecast must update, and finance sees it happen". With Postgres that means building change notification, a websocket layer, and client cache invalidation. Here, the UI subscribes to `ImpactCard`/`RiskMetric` rows for the ECRs or scenario on screen, and updates arrive as rows land. During a demo, a supplier lead time changes and the backlog roll-up visibly re-prices.
2. **Atomic invalidation cascade (§6).** "Update the quote, mark dependent runs stale, enqueue new tasks" is one reducer, one transaction. That is the transactional-outbox pattern without the outbox. This is the strongest technical reason: the correctness requirement is real, and the usual solution is real extra machinery.
3. **The database as agent coordination bus.** Many workers (extraction agents, cost agents, simulators, narrators) need to claim tasks without double work, be woken when work appears, and publish results others react to. A `Task` table, a `claim_task` reducer, and worker subscriptions to pending tasks replace a separate queue plus pub/sub. Lease expiry runs as a scheduled reducer in the same system.
4. **Scenario-toggling is multi-client state.** Finance users toggling ECRs into a scenario and watching totals change is shared, live state with identity. The platform provides per-client identity and subscriptions directly.
5. **Later, for Loop 2:** "come back in N weeks and compare to actuals" maps onto scheduled reducers, and "every forecast is immutable with its inputs" maps onto append-only tables inside the same transaction model. This is a bonus, not a reason to choose it for Loop 1.

### The case against, stated plainly

- **It does no heavy compute.** Reducers are transactional, sandboxed, and not meant for long-running work, so the Monte Carlo, the LLM calls, and any dataframe-style analysis live in external workers either way. SpacetimeDB makes zero difference to the hardest part of the product.
- **It is a poor analytics store.** Subscription SQL is a restricted subset (as I understand it: limited joins, no aggregates). Roll-ups must be computed by a worker or reducer and stored as rows, not computed on the fly by the client. Finance will also want export (CSV/Excel); that is a worker or UI concern.
- **The glue it removes is moderate, not enormous.** Postgres with `SELECT ... FOR UPDATE SKIP LOCKED` for the queue, `LISTEN/NOTIFY` for wake-ups, and a small websocket gateway for the UI achieves the same behavior. That is perhaps a day of plumbing, not infeasible.
- **Risk.** It is a younger system than Postgres, with a smaller ecosystem and, for us, a learning curve inside a hackathon window.

### Verdict

SpacetimeDB is justified **if** we commit to the design in §6 (live invalidation cascade, DB-as-bus, live scenario toggling) as the product's core experience. It would not be justified for a batch "upload ECRs, get a PDF" tool, where Postgres is simply better. The honest summary: its value is deleting plumbing that this particular design needs a lot of, and the design is only worth it if the live, always-current feel is the demo.

### Spike before committing (time-boxed)

Verify these, and adopt SpacetimeDB only if all pass. Each is a place where my assumptions could be wrong:

1. A worker in our chosen language can connect, subscribe to `Task WHERE status = 'pending'`, claim one via reducer, and write results back. (Check which client SDKs are mature; a Python worker may need to use the HTTP API instead of a native SDK.)
2. Module language options and maturity for our team (Rust, C#, TypeScript status).
3. A reducer can enqueue tasks and mark many rows stale in one transaction at the row counts we expect (hundreds of parts, tens of ECRs).
4. Whether reducers can call out over HTTP (some version of "procedures"). Not required (workers do outbound calls) but would simplify the LLM path.
5. UI subscription latency and re-render behavior when a roll-up row updates.

**Fallback:** Postgres + a thin realtime layer. To keep this swap cheap, all writes go through a narrow API (`enqueue_run`, `claim_task`, `complete_task`, `record_assumption`, `mark_stale`) rather than workers touching tables ad hoc.

## 8. Components

Stack is deferred. The architecture implies four deployable pieces:

1. **State + coordination core** (SpacetimeDB module, or the Postgres fallback): tables from §5, reducers/API from §7.
2. **Workers**, split by kind:
   - *Agent workers*: S0 extraction, assumption proposals, S5 narration. Call an LLM.
   - *Compute workers*: S1 diff, S2 cost, S3 timeline, S4 Monte Carlo. Numeric libraries matter here (this is the main input to the language choice).
3. **UI**: ECR backlog view, per-ECR impact card, scenario builder with live roll-up, S0 confirmation screen, assumption inspector ("why is this number what it is").
4. **Data generator** (§10): produces fake baseline data and ECRs.

Language constraint worth deciding early: compute workers want good numerics (Python/NumPy is the path of least resistance); the UI side wants whatever the SpacetimeDB client SDK supports best. These two may end up in different languages, which is fine as long as the interface is the narrow API above.

## 9. Loop 2 hooks (everything else deferred)

Done now because it's nearly free and impossible to retrofit cleanly:
- Runs are immutable and store seed, code version, assumptions, and the BOM revision.
- Outputs are decomposed with ranges (§2), so a later variance can be attributed to a line item or assumption.
- `Assumption.source` and `rationale` are recorded.

Deferred until Loop 1 is working: `Actual`, `Variance`, `Attribution` tables; scheduled revisits; prior updates; backtest harness; any "why were we wrong" agent.

## 10. Fake data (not yet, but constrain the design)

The data will be generated and synthetic. When it's built it needs: a baseline production BOM of a plausible electric aircraft (tens of parts is enough for a demo), suppliers with regions and lead-time distributions, a volume ramp, and a set of ECRs written as realistic prose with varied clarity (some precise, some vague, one that conflicts with another). If Loop 2 gets built, the generator should also emit a hidden ground truth so "actuals" can be produced for a backtest; designing the generator with that in mind costs little now.

## 11. Suggested build order

Ordered by dependency, not by time estimate. The line after step 6 is the minimum credible demo.

1. SpacetimeDB spike (§7) and decision.
2. Schema + narrow API + task queue running end to end with a dummy task.
3. Minimal fake data: small BOM, a few suppliers, 3–5 ECRs.
4. S0 → S1 (extraction and BOM diff), with the confirmation UI.
5. S2 (cost) and S3 (timeline) with simple distributions.
6. S4 (supply chain simulation) and S5 (impact card) — **minimum credible demo: one ECR in, card out, live.**
7. Backlog scenario roll-up with toggling and conflict flags.
8. Live invalidation demo (change a supplier input, watch dependents re-forecast).
9. Loop 2, if time remains.

## 12. Open questions

- What does a real ECR/ECO look like at Archer: structured form, PDF, PLM export? S0 is only as good as our assumptions here.
- Is "production" cost the full aircraft rolled up, or per subsystem? This sets BOM depth.
- Who confirms S0 output in practice: the engineer who filed it, or finance?
- How does finance prefer ranges shown (p10/p50/p90, a probability of exceeding a threshold, a scenario table)?
- Is cross-ECR dependency something Archer already tracks, or will we have to infer it?
