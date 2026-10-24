# Norn's company configuration

The schema, validator and loader for the one file that tunes Norn to a company. Written 2026-10-24.
Norn is general, so nothing here names a company. A company's file lives with the company (Bowman's
is `bowman/norn-config/bowman.config.ts`) and default-exports an object of type `CompanyConfig`, or
is a `.json` file holding it.

```
cd norn/config
npm test                                                   # the schema, the rules between fields, the loader, the stored form
npm run check                                              # validates Bowman's file and prints a summary
node src/cli.ts <file> --json                              # the { key, value } pairs Norn's set_config takes
```

## At start-up

The worker (`norn/workers/src/config.ts`) loads the file named by `NORN_COMPANY_CONFIG` before it
connects to anything.
- **Malformed, missing, or rejected by the validator.** The worker prints the problems, one per
  line, and exits with code 1. Nothing has been written to the database.
- **Valid.** Once connected, the worker sends the pairs below through `set_config`, but only the
  ones that differ from what the database already holds. Starting again with the same file stores
  nothing. A call that returns is not proof that it took effect, because the policy gate can deny it
  and the module then returns normally. So the worker waits (5 s) for each value to show in
  `norn_config`; if it does not, the worker exits with code 1 and gives the reason from the action log
  row of that request, such as the job scope that denied `set_config`.
- **Unset or blank.** The worker warns and keeps the company config already stored (or, if there
  is none, the module's built-in defaults). It does not refuse to start.

| Key | Value |
|---|---|
| `company_config` | the whole validated configuration, defaults filled in, as canonical JSON (sorted keys, no whitespace; `src/stored.ts`) |
| `deep_review_mode` | `reviewDepth.deepReview.mode` |
| `deep_review_limit` | `reviewDepth.deepReview.maxPasses` |

The file is the source of truth for these three keys: a start-up puts them back to the file's
values, including a `deep_review_mode` that someone switched in the web app since.

## What the module checks, and what it leaves to the loader

`set_config` for `company_config` (`norn/module/src/company-config.ts`) refuses a value that is
over 256 KB, is not JSON, is not an object with a whole-number `schemaVersion`, or is not in
canonical form. The canonical-form rule makes "has it changed" a string comparison.

The module does not run the validator: its TypeScript settings and runtime differ from this
package's. The schema and the rules between fields are checked only by the loader, so a caller that
skips the loader can store a config that passes the module and fails the schema. Code that reads
the stored config must not assume it was validated there.

## In the action log

Each change to `company_config` is one `set_config` row. Its summary gives the old and new
fingerprint (`configHash`, FNV-1a 64 bit, 16 hex characters), the sizes, and the top-level sections
that changed, were added or were removed, for example
`company_config: 335a59f8a0cbb143 -> 5a37a22e7cdd4ff5 (23.0 KB -> 23.0 KB); changed: materiality, reviewDepth`.
It never holds the old or the new JSON, which is in the `norn_config` table. The fingerprint is a
label for telling versions apart, not a signature.

Checked on 2026-10-24 against a scratch database: `NORN_DB=<scratch> npm run check:config` from
`norn/` (see `norn/workers/README.md`).

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

`decideAction(config, { action, actor, facts })` returns one of `approve`, `approve_sampled`, `recommend`,
`escalate` or `deny`, with `actsNow` (the action may be taken now), the reasons, the limits it checked, the sample draw,
and who receives a recommendation or an escalation. It works the route out again from the facts in every call, so a
route kept from an earlier cost cannot be reused. It never throws on a bad id or a missing fact: it denies and says why.

### The facts (`EcrFacts`)

| Fact | Where it comes from | If missing |
|---|---|---|
| `ecrId` | the PLM number, such as ECR-0417 | required |
| `cost` | `costForecastFromCheck(costCheck(...))` (an estimate, enough to route), plus `measured` (the exact measure, needed to act) | the cost is unmeasured |
| `slipP90Days` | the timeline check (not built yet) | a `maxP90SlipDays` limit is not met |
| `reportLevel` | the level of the report the decision rests on | a `minReportLevel` limit is not met |
| `classes` | set on the ECR, or proposed by the classifier | the axis's `whenUnsure` class |
| `answers` | yes or no per test id in `neverFastTrack`, `requireAll`, `requireOneOf` | the test is unanswered |
| `triggers` | the named conditions Norn detected (`TRIGGERS`) | none detected |
| `ownerId` | the person who owns the changed item | an approver who must own the change is refused |
| `approvedBy` | `'fast_track'`, or the id of the approving body | the ECR is not approved; an id that is not a configured body is denied |

### The order of a decision

1. The action must exist. A person, or the person an agent acts for, must exist and hold the action in their role's
   `can`. Tier approval also needs a person who chairs a body whose tier covers the change, and a fast-track approver who
   must own the change has to be the owner. An agent acting for a person that fails any of this is refused.
2. The action must be available. `approve_fast_track_ecr` needs a fast-track eligible ECR, for anyone, and otherwise is
   denied with `reroute`: the same actor's decision on `approve_ecr_at_tier`, to the body of the cost tier. `release_eco`
   and the four ERP actions need an approved ECR (`approvedBy`).
3. A person acting as themselves is approved, since roles carry no limits. The exception is `approve_ecr_at_tier`: a
   body's tier is shown to cover the change only by the exact cost measure, so without it the outcome is `recommend`.
4. An agent gets the company's rule for the action. A detected `escalateOn` trigger escalates. A rule that would
   `approve` or `approve_sampled` becomes `recommend` unless the cost is the exact measure, when its outcome rests on
   the cost: the rule has a `maxCost` limit, carries out an approval, or is the decision on a tier. Otherwise `limits` are
   checked, and a failed one drops the level to `otherwise`. `carriesOutApproval` waives the limits when the approving
   body's tier is the tier of today's cost or above. Then the level applies: `approve_sampled` draws with `isSampled`.

The four ERP actions are `recommend` in the configuration, so they are always a recommendation, to the roles that hold them.

## Design calls

- **Norn acts only on an exact cost measure.** The configuration defines the measure per draw of the forecast.
  `costCheck` gives p10, p50 and p90 of signed totals, not the draws. A quantile of the parts does not give the quantile
  of the whole: spend and saving that both have a p90 of 100,000 can have a larger-of p90 of 200,000, and a forecast
  with p10, p50 and p90 of 297, 12,165 and 24,033 can have a p90 of 26,703 in size. So any outcome of `approve` or
  `approve_sampled`, and any `actsNow`, needs `cost.measured`, computed per draw by the checks. That covers every
  action whose outcome rests on the cost: a rule with a `limits.maxCost` (the fast track, `release_eco`), `carriesOutApproval`,
  and `approve_ecr_at_tier` including a person's. `post_impact_statement`, `set_company_class` and any other rule
  without a cost limit decide as before, with no cost at all.
  - **Until the checks emit `measured`, Norn acts on nothing whose outcome rests on the cost.** That is the reason for the
    follow-up that makes `costCheck` produce it.
  - **`measured` is an `ExactCostMeasure`:** `source: 'exact'`, `horizonMonths`, `savingsOffset`, `p50` and `p90`. It
    counts only if the first three match the configuration and the forecast's `windowMonths` is the horizon. In each
    draw, over the first `horizonMonths` months from the cut-in, take every cost component (each row's one-time column,
    each row's unit cost times quantity, each stock disposition) separately, never netted into a row total. The spend is
    the sum of the positive ones, the saving the sum of the size of the negative ones. The size is the larger of the two
    when `savingsOffset` is false, and |spend - saving| when it is true. `p50` and `p90` are those percentiles of the
    size across the draws.
  - **Estimates still route**, so a card can show a tier and a body, and `measureCost` labels each one: `estimated`,
    `lower_bound` or `unmeasured`. With `savingsOffset` false the size needs `cost.gross` (net totals cannot give it:
    +200,000 of tooling and a 190,000 credit net to 10,000). `costForecastFromCheck` sets `gross` only when every cost
    component, read separately and not through a row total, has one sign. With `savingsOffset` true a range across
    zero is unmeasured at p90. An estimate can be too low whichever side of zero it falls on, because the tails beyond
    p10 and p90 are not known. The decision for an estimate says so: "Norn acts only on an exact measure".
- **The horizon must match**, for `measured` too. A forecast over a different number of months than `horizonMonths` is
  not used, so the cost is unmeasured.
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
