# Norn's company configuration

The schema, validator and loader for the file that tunes Norn to one company (#34, #39), and the pure functions that
read it to route an ECR and decide an agent's action (#75). Norn is general: nothing here names a company. Bowman's
file is `bowman/norn-config/bowman.config.ts`. No runtime dependencies; Node 24 runs the `.ts` files directly.

```
npm ci                # dev dependencies only: typescript and @types/node
npm run typecheck     # tsc, strict
npm test              # node --test
npm run check         # load and validate Bowman's file
```

## Routing and deciding (`src/route.ts`)

Both are pure functions of a validated `CompanyConfig` and the facts about one ECR. They read no database, clock or
random number generator. The policy gate (#43), the router and the fast track call them. Every answer carries the rule
in the configuration that decided it and the reasons in plain words, so the gate can record why next to what it did.

`routeEcr(config, facts)` returns:
- **classes**: the company and regulatory class, from `facts.classes`, or the axis's `whenUnsure` class when none is
  set (the answer says which);
- **cost**: the size of the change by `approval.costMeasure`;
- **tier**: the first tier whose `upTo` holds that size (inclusive), its body and chair, and the bodies that also review it;
- **fastTrack**: whether the ECR can take the fast track, with the never-fast-track tests that hold, the criteria that
  are not met and the tests nobody has answered.

`decideAction(config, { action, actor, facts, route? })` returns one of `approve`, `approve_sampled`, `recommend`,
`escalate` or `deny`, with `actsNow` (the action may be taken now), the reasons, the limits it checked, the sample draw,
and who receives a recommendation or an escalation. It never throws on a bad id or a missing fact: it denies and says why.

### The facts (`EcrFacts`)

| Fact | Where it comes from | If missing |
|---|---|---|
| `ecrId` | the PLM number, such as ECR-0417 | required |
| `cost` | `costForecastFromCheck(costCheck(...))` | the cost is unmeasured |
| `slipP90Days` | the timeline check (not built yet) | a `maxP90SlipDays` limit is not met |
| `reportLevel` | the level of the report the decision rests on | a `minReportLevel` limit is not met |
| `classes` | set on the ECR, or proposed by the classifier | the axis's `whenUnsure` class |
| `answers` | yes or no per test id in `neverFastTrack`, `requireAll`, `requireOneOf` | the test is unanswered |
| `triggers` | the named conditions Norn detected (`TRIGGERS`) | none detected |
| `ownerId` | the person who owns the changed item | an approver who must own the change is refused |
| `approvedBy` | `'fast_track'`, or the id of the approving body | the ECR is not approved |

### The order of a decision

1. The action must exist. A person, or the person an agent acts for, must exist and hold the action in their role's
   `can`. Tier approval also needs a person who chairs a body whose tier covers the change, and a fast-track approver who
   must own the change has to be the owner. An agent acting for a person that fails any of this is refused.
2. The action must be available. `approve_fast_track_ecr` needs a fast-track eligible ECR, for anyone, and otherwise is
   denied with `reroute`: the same actor's decision on `approve_ecr_at_tier`, to the body of the cost tier. `release_eco`
   and the four ERP actions need an approved ECR (`approvedBy`).
3. A person acting as themselves is approved, since roles carry no limits.
4. An agent gets the company's rule for the action. A detected `escalateOn` trigger escalates. Otherwise `limits` are
   checked, and a failed one drops the level to `otherwise`. `carriesOutApproval` waives the limits when the approving
   body's tier is the tier of today's cost or above. Then the level applies: `approve_sampled` draws with `isSampled`.

The four ERP actions are `recommend` in the configuration, so they are always a recommendation, to the roles that hold them.

## Design calls

- **The cost measure is estimated from ranges.** The configuration defines it per draw of the forecast. `costCheck`
  gives p10, p50 and p90 of the signed totals, not the draws. `measureCost` leans high: at p90 each spend takes its p90
  and each saving the size of its p10, and spend and saving are summed across the one-time and recurring parts. It
  only ever over-states a change, so a change is never routed below what its forecast supports. A check that works
  the exact figure per draw hands it over as `cost.measured` and it wins.
- **The horizon must match.** A forecast over a different number of months than `horizonMonths` cannot be used, so the
  cost is unmeasured.
- **Unmeasured cost goes to the top tier** and fails every `maxCost` limit.
- **Missing facts count against the actor.** An unanswered test, an unforecast slip and a missing report level are not
  satisfied. The configuration has `whenUnsure` for classes only; the same caution is applied elsewhere.
- **A class is not parsed from its trigger text.** Class triggers are prose, so Norn cannot test them here. The class
  comes from the facts (set by a person, or proposed by the classifier, #33).
- **Eligibility covers all three fast-track lists**, not only `neverFastTrack`: `requireAll` must hold and one of
  `requireOneOf` must hold.
- **An ineligible fast track is `deny`, not `recommend`.** The configuration says the action is not available, so
  nobody is asked to recommend it. `reroute` carries what happens instead.
- **`approve_sampled` has one outcome whether or not it is drawn.** `sample.sampled` and `actsNow` say which.
- **Without a PLM number the outcome is `recommend`** with `waitsForPlmNumber`. A number is `<idPrefix>-<digits>`
  by `ecrForm`; the `NORN-<id>` placeholder is not one. The action is decided again once the PLM has numbered the ECR.
- **Stricter-of.** A person's side can only allow or refuse, because roles carry no limits, so the stricter of the two is
  the company's agent rule once the person's side allows it.
- **An approval is required, not matched to a tier,** for the follow-on actions. Only `carriesOutApproval` looks at which body.
- **The recommendation for `approve_ecr_at_tier` goes to the chair of the body of the tier**, not to every role that holds the action.
- **The fast-track signatures** of the other approvers are reported as a reason when a person approves; the gate does not track them.
