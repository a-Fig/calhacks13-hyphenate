# Norn's impact checks

The code checks of the impact screen, as a pure TypeScript library: **S1, the BOM delta**,
**S2, cost**, **S3, timeline** and **S4, supply** (`../ARCHITECTURE.md` §5). No database, no I/O,
no dependencies at run time. The worker (`../workers`) calls them and stores the rows.
Written 2026-10-24.

```
npm install          # dev dependencies only: typescript and @types/node, for the typecheck
npm test             # node --test on test/*.test.ts (Node 24 runs the .ts files directly)
npm run typecheck    # tsc, no emit
node demo.ts ECR-0417 [seed]   # print an ECR's cost page from Bowman's dataset
```

## What each check returns

- **`bomDelta(baseline, ecr)`**: the BOM at head, the line-level diff, each item change checked
  against the value its author saw on the baseline (a mismatch is a conflict, not an overwrite),
  the quantity per finished unit of every changed item in every program, and the affected items,
  assemblies, suppliers and programs.
- **`costCheck(baseline, ecr, { seed })`**: the ECP cost page (docs/IN-PRACTICE.md §1 and §8,
  recommendations 1-3 and 6-8):
  - four blocks: production, retrofit, logistics support and other;
  - each row with a one-time column and unit cost times quantity, savings negative;
  - production recurring cost is the per-unit change from the BOM delta, times the units the
    volume plan builds after the cut-in;
  - the old stock's disposition (scrap, cancel, use up) is its own production line, with a
    recovery share per item as the hook for #32.

  It also returns the headline numbers (per-unit change for each program, one-time total,
  year-one and whole-plan totals), each program's unit cost at base and head, the piece-price
  ranges, recurring cost by year, the biggest swings, and a convergence check.

- **`timelineCheck(baseline, ecr, { seed })`** (S3): when the change can reach the line. See
  "Timeline and supply" below.
- **`supplyCheck(baseline, ecr, { seed, peers? })`** (S4): single-source parts, lead times, spend
  and capacity, and what changes when other open ECRs buy from the same supplier.

All results are plain JSON. `bomDeltaRows`, `costCheckRows`, `timelineRows` and `supplyCheckRows`
turn them into rows of `{ key, label, unit, p10, p50, p90, detailJson }`, the worker's `Result`
shape. The last row of each is `detail`, which carries the whole result with every input the
traces name.

## Timeline and supply (S3 and S4)

Both read the ECR's own program, from the same model (`src/plan.ts`), and follow S2's conventions:
per-input draws keyed by the seed and the input's id, correlation 0.3 inside a group, a second-seed
convergence check on every continuous result they compute (cut-in weeks, weeks late, spend, capacity
use, the shift with peers, the bundle savings; a part's lead time is one input's own draws and is not
checked), traces whose ids are all in `inputs`, and assumptions by id (`replacesGiven` for stated numbers).
Dates hang on the ECR's filing date, never on the clock, so a result is a function of its inputs and
the seed.

**The model.** The board decides some weeks after filing (a PERT range from the filing history:
3, 4, 7 weeks for a routine change, 1.5, 3, 5 for an urgent one; the median of the history is 4.1
weeks). Each changed buy part then takes its supplier's lead time. The quote's `leadTimeWeeks` is
the median, spread by the sourcing record's p10/p50/p90; with no sourcing record the spread is a
default (sigma 0.15 for a firm quote, 0.25 for a budgetary one). A part with no quote uses the
sourcing record alone; a part with neither takes the median of the sourced parts and is flagged
`needs_estimate`. A part from a supplier with a qualification slot
(`supplierConstraints`, kind `qualification_slot`) is ordered at the first slot that opens after the
decision. The change reaches the line on the latest of: every changed part in the building, and the
old stock the proposal uses up having been built into aircraft. The first serial that can take it is
the first one the volume plan completes on or after that day.

**Which parts, and their prices.** The changed buy parts are the ones the ECR changes or adds, plus
any part the change needs more of than the baseline does, wherever in the BOM the quantity rises
(a `set_qty` on a part, or a changed assembly above it): the spend is at the full head quantity, not
only the increase. A part's price is the quote line that names that part (a quote can price several
parts, so the order of its lines does not matter), or a line that names none and is on the quote for
that part, else the item master's. S4 draws the price from the same variables the cost check uses:
the sourcing record's p10/p50/p90 as a multiplier (`price:<item>`; a part with no record takes the
cost check's default range), and a budgetary quote's own spread (`quote:<item>`).

**What S3 returns.** The decision date, the cut-in date (P10, P50, P90), the weeks from filing, the
first serial, how late that is against the effectivity the ECR states (positive is late) with the
share of draws in which it is late, and each step on the path with how often it sets the cut-in.
The old-stock step is the day the aircraft before the stock's serial are planned to complete, from
the volume plan alone, so it differs from the cut-in whenever a part arrives later. Row values for
days are days since 1970-01-01 (unit `day`); the ISO dates are in the `detail` row.

**What S4 returns.** Each changed part's sources (single-source is flagged) and lead time, the
probability the parts miss the stated effectivity, year-one spend and the single-source share of
it, and capacity use against a `capacity` constraint. When `peers` (the other open ECRs'
change requests) share a supplier with this one, it adds the interaction:
- **Slots.** Per draw, ECRs take slots in the order they were filed (`filedOn`, then id). The ECR
  filed second waits for the next slot. This is a rule Norn assumes, not one the supplier states.
  The headline numbers treat the ECR alone; the interaction is shown beside them (cut-in alone and
  with the peers, the shift in weeks, the probability it is later).
- **Bundles.** Two part numbers from one supplier within the constraint's window get a cheaper
  qualification for the later one and a raw-material price break on both. The saving is shown for
  this ECR and for the pair, from the same draws, so it is the same number from either ECR.
- **Capacity** counts the open changes it is given, not the supplier's other customers. It ignores
  the constraint's window and any yield penalty.

**Where the constraint terms come from.** The dataset states a slot's cadence and its bundle terms
in the constraint's description. The library takes structured fields when present
(`slotCadenceMonths`, `bundle`), and otherwise reads the description for the cadence, "within N
weeks", "N% less" and "N% ... price break", flagging `terms_from_text`. The raw-material share of
the part price (40%, 60%, 80%) that the price break applies to is a default nobody stated, flagged
`needs_estimate`. The ERP baseline carries no constraints: without them there is no slot to wait
for, and S4 reports the shared supplier without a shift.

**Limits.**
- S2 still reads the effectivity the ECR states, so S2's money does not move when S3 reports a
  later cut-in. S3 is the earliest the change can reach the line, on the facts it has.
- Only the ECR's own program is timed.
- Using up the old stock can need a serial past the end of the volume plan. Then no day can be
  placed: the serial floor is kept (`cut_in_serial`), the cut-in date and weeks, the lateness and
  the interaction shift are left out (null in the result, absent from the rows), the chance of
  missing a stated effectivity is 1 with no weeks, the year-one spend and capacity use are 0 (no
  planned aircraft takes the change), and a `stock_beyond_plan` flag says the plan needs to run
  further.
- `peers` are the caller's to pass. The worker names them in the run's inputs (each open ECR's
  change request revision and digest), so a run is a function of them and filing, editing, closing
  or reopening a peer re-runs S4. The peer list, with a content hash of each peer's change request,
  is in the `detail` row.
- Convergence is checked on the continuous results only. Serial numbers and probabilities are
  steps and are not.
- The cumulative units a plan completes are interpolated through each month, so the serial that
  takes the change is the one planned to complete on or after the cut-in day, not a rounded month.

## Ranges

- 10,000 Monte Carlo draws, Latin hypercube sampled (one draw in each of 10,000 equal-probability
  strata of every input). Every number has p10, p50 and p90, a mean, and a point estimate (every
  input at its stated value).
- Costs and prices are lognormal through their stated p10, p50 and p90: quantiles, not bounds.
  Bounded shares (scrap recovery, cancellation charge) are PERT.
- Inputs in one group (same supplier, shared internal labour) correlate 0.3; inputs in no common
  group are independent.
- Convergence: P80 and P90 of the headline numbers are recomputed on a second seed and must agree
  within 1%. A run that misses doubles its draws, up to 40,000 (`maxDraws`), and `draws` in the
  result says how many it used. On 12 seeds tried (`seed-0` to `seed-11`), S3 and S4 converged at
  10,000 draws on every seed for six of the ten dataset ECRs; ECR-0417, ECR-0409, ECR-0412 and
  ECR-0419 needed 20,000 or 40,000 on some, and ECR-0417 missed the tolerance on `seed-0` even at
  40,000 (its weeks-late number) and was flagged `not_converged`. A run that still misses at the cap
  is flagged `not_converged`.

## Paired draws and the seed rule

Base and head are simulated in one call, on the same draws. Every uncertain input draws from its
own stream, keyed by the seed and the input's id (`price:BW-5120-210`, `cost:ECR-0417:other[0]`),
so an input both sides use gets the same numbers on both, whatever else the change adds or
removes. A change is the percentiles of the per-draw difference, never p50(head) − p50(base).

**The seed is the deployment's configured seed (`norn_config.seed`), the same for every ECR and
every run.** Inside one `costCheck` call, base and head share draws whatever the seed. The rule
matters across runs:
- a revised ECR is compared with its previous forecast on the same draws;
- a backlog roll-up of several ECRs agrees with each ECR on its own, because an item's price draws
  are the same in all of them;
- a cached forecast of the baseline stays comparable with every ECR built on it.

Draws come in blocks of the starting count (10,000), each Latin hypercube sampled from its own
stream, so a run that doubled to 20,000 starts with the same 10,000 draws as a run that didn't.
Two runs are paired on the draws they share. Their percentiles still differ by sampling noise when
their lengths differ, so a comparison across runs is made per draw on the shared draws, or with
`maxDraws` pinned so every run has the same count.

A seed derived from the run's input hash changes whenever the inputs change, so none of those
comparisons would be paired. The skeleton worker seeds from the input hash today
(`workers/src/sim.ts`, `seedFrom`); when these checks are wired in, pass the configured seed
instead. The run stays deterministic because the seed is part of the input hash.

The point estimate (every input at its stated value) of a unit cost at base is the standard cost.
Its p50 is higher, because most price ranges lean upward: for Vesper the standard sits near p11.
That is the S-curve doing its job, and the card should label it rather than call it a mismatch.

## Traces

Every number carries `trace: { formula, uses: [{ id, source }], evidence: 'computation' }`. Each
id is in the result's `inputs`, with its source (`given`, `default` or `agent_estimated`), its
value or distribution, where it came from and why. The supplier quote's lines are `given` inputs.
A cost-page row the originator left blank (`not_provided`) becomes a `default` assumption of $0,
flagged `needsEstimate`. A blank scrap row is filled by the disposition line instead, when the ECR
proposes a disposition; otherwise it is an ordinary blank row.

The price ranges of parts the change doesn't touch are drawn one by one, since they set the unit
cost at base and head, but they are listed as one input, `baseline:price-ranges`, because they
cancel in every change. Only stated (`given`) ranges with no assumption on them fold in; a
default range or an agent's estimate is listed on its own. That keeps ECR-0417's stored detail near 23 KB rather than 116 KB.

An assumption recorded on the ECR replaces a default by id
(`options.assumptions: [{ id, source: 'agent_estimated', dist, rationale }]`). That is how an
agent's estimate of a blank row, a recovery share (#32) or a cut-in lands, and how the trace
shows it.
- **Stable ids.** A cost-page row's id is the PLM's row id when it has one, else a slug of its
  label, so adding or reordering rows doesn't move an assumption onto another row. An example is
  `cost:ECR-0417:other:delay-cost-of-holding-s-n-011-014-at-the`.
- **Stated numbers.** A number someone stated, such as a quote or an engineer's estimate, is
  replaced only by an assumption with `replacesGiven: true`. Otherwise the assumption is recorded,
  not applied, and flagged.
- **Unused assumptions.** An assumption that matches no input is flagged, never dropped silently.

## Rules it applies that a reader might not guess

- **Unit price.** An item's base unit price is its standard cost. The overlay's
  `unit_price_usd` sets it at head. The new price traces to any quote line that states it.
- **First-lot premium.** A quote line priced above the new steady-state price, with a quantity,
  is read as a first-lot premium: (lot price − steady price) × lot quantity.
  - It is its own one-time row, "First-lot price premium (booked as PPV)". It is cash the change
    causes, and the books show it as a purchase price variance against the new standard.
  - It is skipped if a production row of the same amount already lists it: a supplier-quote row,
    or one whose label says premium, first lot or PPV.
  - It is flagged for a person to confirm, because extra hardware such as engineering samples looks
    the same.
- **Budgetary quotes.** A quote marked `firmness: 'budgetary'`, or whose note says budgetary,
  indicative or plus or minus, gets the wider spread (0.15). Without a mark the quote counts as
  firm (0.05). Its new prices also carry an extra multiplier of their own.
- **BOM lines.** Two lines with the same parent and child are summed into one.
- **Bad sourcing ranges.** A sourcing range that isn't positive and in order falls back to the
  default range, with a flag; it doesn't fail the check.
- **Conflicts.** A conflicted ECR is still computed, so the reviewer sees its numbers, but its
  result says `bomDelta.ok: false` and lists every conflict as a flag.
- **Cancellation charge.** A quote line for the item, with the on-order quantity and a price
  below the old price, gives the cancellation charge. Otherwise the charge is a default
  PERT(5%, 10%, 30%) of price.
- **Cut-in.** The ECR's own program takes its stated serial or date. A lot-based or undecided
  effectivity defaults to one of two rules, flagged until the timeline check (S3) replaces it:
  - when stock is proposed for use-up, the cut-in comes after that stock is used up;
  - otherwise, the filing date plus the longest quoted lead time.

  Every other program the item is in takes the change on every unit not yet built. An assumption
  `effectivity:<ecr>:<program>` with a serial or a month replaces a default cut-in, and replaces a
  stated one only with `replacesGiven: true`.
- **Year-one window.** It runs 12 months from the cut-in on the ECR's own program.
- **At today's prices.** Recurring cost doesn't apply the dataset's at-rate price factors.
