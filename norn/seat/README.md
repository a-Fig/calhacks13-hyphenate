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

## Run it

```
node demo.ts ECR-0417        # from norn/seat: the seat chasing ECR-0417, with SIMULATED replies
node --test test/*.test.ts   # 6 tests: reply parsing, gaps, routing, ask/record/re-run, reminders and escalation, follow-ups
```

On ECR-0417 the seat asks Quality (re-inspection), the CM analyst (spares, manuals, training), the
planner (the held station) and procurement (scrap recovery). With the simulated reply "$3,000 to
$5,000" from Quality, the one-time total moves from $148,521 to $152,445 at p50, traced to her answer.
