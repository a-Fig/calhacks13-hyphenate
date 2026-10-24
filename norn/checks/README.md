# Norn's impact checks

The first two checks of the impact screen, as a pure TypeScript library: **S1, the BOM delta**,
and **S2, cost** (`../ARCHITECTURE.md` §5). No database, no I/O, no dependencies at run time.
The worker calls them and stores the result; wiring them into `workers/` is a later step.
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

Both results are plain JSON. `bomDeltaRows` and `costCheckRows` turn them into rows of
`{ key, label, unit, p10, p50, p90, detailJson }`, the skeleton worker's `Result` shape.

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
  result says how many it used. ECR-0409, whose budgetary quote makes its change wide, needed
  20,000 or 40,000 on 12 of 60 seeds tried; every other dataset ECR converged at 10,000 on all 12
  seeds tried. A run that still misses at the cap is flagged `not_converged`.

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
