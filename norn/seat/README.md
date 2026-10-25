# Norn's seats

A seat is a job a company gives Norn: the duties it owns, who it asks for what, its deadlines and who
it escalates to. Written 2026-10-25 for #155. The first seat is Bowman's Product Cost Engineer
(`bowman/norn-config/seats/cost-engineer.ts`), the job held by Wei-Lin Zhao in the dataset.

Nothing here names a company. A seat file is data; another company writes its own.

## What the seat does today: chase missing inputs (#156)

1. **Find the gaps** (`gaps.ts`): every blank line on the cost page, and every default whose swing on
   the 12-month total is at least the seat's `materialityUsd`. Blank lines first, then by swing.
2. **Route each gap** (`route.ts`): the seat file's `asks` rules match the input's label and id to the
   company seat that owns that kind of number (re-inspection to quality, a held station to the
   planner, scrap recovery to procurement); the company's people say who holds that seat, preferring
   someone on the ECR's program. A fallback asks the originator.
3. **Ask** (`question.ts`): one short question per gap, saying what it is for, the unit wanted and why
   that person.
4. **Read the reply** (`answer.ts`): deterministic. One clear figure, a range ("$3,000 to $5,000") or an
   explicit zero is recorded; anything else gets one follow-up. A single figure gets the spread Norn
   uses for an engineer's estimate (lognormal, sigma 0.15); a range becomes p10 and p90.
5. **Record** (`plan.ts`): the answer becomes an assumption override on that input, source `given`,
   `by` the person, with their words quoted in the rationale, and the checks re-run on it.
6. **Chase**: a reminder after `remindAfterHours`, then escalations at each `escalateAfterHours` to the
   seats in `escalation`, skipping the person who was asked. Escalations are SBAR: situation,
   background, assessment, recommendation.

`nextActions(seat, people, state, now)` is a pure function: the same state and clock always give the
same actions, so any decision can be replayed. A worker carries the actions out (posting the question
on the ECR, recording the assumption); wiring it to the live database is the next step.

## Find the best option (#157)

`src/options.ts` lists the decisions hidden in an ECR and simulates each: the old stock (as filed, scrap all,
use up), the cut-in (using the stock up moves it to the serial the timeline check gives), retrofit of built
aircraft (as filed, none) and, when `supplyCheck` finds a peer ECR on the same supplier slot, qualifying
together. Each option is a changed ECR plus, at most, a cut-in serial override: never a typed amount, so every
number is the checks' own. All options use one seed, so they are paired.

A code screen (data-driven `PolicyRule`s) marks an option not eligible, quoting the text: keeping the old design
when the ECR or its NCR describes a failure, unless the NCR's disposition accepts use-as-is and does not reject
it; dropping a retrofit the ECR makes mandatory. The recommendation is the eligible option with the lowest
12-month total at p50; its tradeoffs sentence is a code template. An LLM narration is not built; it could be
added without touching a number.

```
node options-demo.ts ECR-0417 [--json out.json]   # from norn/seat: the options table and the recommendation
```

On ECR-0417 using the old stock up saves $38k one-time (the $60k disposition line includes $22k of Rev B
returned from built aircraft, scrapped either way) and is excluded for the fatigue crack; so is skipping the
retrofit. The ECR as filed is recommended. On ECR-0419, qualifying with ECR-0421 saves about $120k.

The ECR page shows a saved run (`web/src/assessment/fixtures/options-ecr-*.json`, with the time it was computed).
Computing options in the worker and storing them is not done.

## Run it

```
node demo.ts ECR-0417        # from norn/seat: the seat chasing ECR-0417, with SIMULATED replies
node --test test/*.test.ts   # the seat logic, the live half (state from comments, reply matching, reducer arguments) and the options (enumeration, pairing, safety screen, recommendation)
```

On ECR-0417 the seat asks Quality (re-inspection), the CM analyst (spares, manuals, training), the
planner (the held station) and procurement (scrap recovery). With the simulated reply "$3,000 to
$5,000" from Quality, the one-time total moves from $148,521 to $152,445 at p50, traced to her answer.

## Live: chasing on the running stack (#162)

`src/worker.ts` is a process that connects to SpacetimeDB as "Norn · Product Cost Engineer" (an agent of
origin `norn`) and, for each draft or in-review ECR whose newest s2 cost run is done and not mock, reads
the gaps from the run's stored detail row, derives the seat's state from the ECR's comments, runs
`nextActions` on the real clock and carries the actions out. It keeps no state of its own, so a restart
resumes the conversation and never asks a question that is already on the ECR.

- Questions, reminders, escalations and follow-ups are `add_comment` on the ECR. Each comment's anchor
  says what it is and which input it is about (`thread.ts`): `seat:ask:<personId>:<inputId>` and so on.
- A person answers under the question on the ECR page. The reply box posts `seat:reply:<personId>:<inputId>`
  from the web's own connection and the page labels it "Replying as Beatriz Nowak (demo sign-in)". The
  module has one author per comment (the connection's identity), so the person is carried in the anchor;
  nothing proves it, which is why it is a demo sign-in. The audit line on the recorded assumption names
  both the person and the connection that typed the reply.
- A clear figure or range becomes `record_assumption` with source `given`, so the module re-checks the
  ECR. The worker has no job scope on purpose: the scoped gate refuses an agent a `given` assumption.
  When the new cost run is done it posts one note (`seat:record:<inputId>`) with the new one-time cost.
- `--demo-clock +25h` shifts the clock the seat uses for reminders and escalations. The log lines say
  `DEMO CLOCK +25h` and each reminder or escalation comment ends with "(demo clock +25h)".

```
cd norn
npm run db:start                    # SpacetimeDB; then db:publish, and the demo stack (npm run demo -w @norn/workers) so ECR-0417 has a current cost check
npm run seat -- --dry-run --once    # print the comments it would write, write nothing
npm run seat                        # the live seat; open ECR-0417 and answer Quality's question as Beatriz
npm run seat -- --demo-clock +25h   # DEMO CLOCK: reminders and escalations fire without waiting
```

Only `ECR-0417`'s people come from Bowman's data (`bowman.people`); the seat file is
`bowman/norn-config/seats/cost-engineer.ts`.
