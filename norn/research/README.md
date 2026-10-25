# Norn's research agent (#138)

Written 2026-10-24. The cost-engineer agent that replaces a Norn default, or fills a blank cost-page
row, with a researched number, and the code that decides whether to believe it. The agent proposes
inputs. Code decides which to use and computes every number (`../ARCHITECTURE.md` §3).

```
npm ci                # in norn/, once
npm test              # 98 tests, no model, no network, no login (about 35 s)
npm run typecheck
npm run replay        # the ECR-0417 demo, offline, every line labelled RECORDED
npm run worker        # the live worker (#148): see "Running it on live ECRs" below

# live (not run from the build environment, see "Not verified")
export BRIGHT_DATA_API_TOKEN=...                 # read by name, never printed
node src/cli.ts --live ECR-0417 --print-job      # show the job, token redacted, and stop
node src/cli.ts --live ECR-0417 --save-recording recordings/live-0417.json
```

## The flow

1. **Targets** (`src/targets.ts`). From the cost check's result: inputs with source `default` and a
   distribution, and cost rows left blank (`needsEstimate`). Ranked by their swing on the year-one
   total (the check's own `drivers`; a one-at-a-time re-run for one outside its top 8). A blank row has
   no spread to move, so its swing is unmeasured and it ranks after every measured input, in the
   cost page's block order. Each target is a generic question under an opaque key (T1, T2): no part
   number, supplier, person, program or company name.
2. **Agent job** (`src/job.ts`). A `norn/runner` job, role `researcher`, with Bright Data's MCP
   server as its only tools and a strict JSON reply: `proposals` (target, `value` or `dist`, unit,
   source URL, exact quote, retrieval date, confidence, rationale, queries) and `unresolved`.
3. **Guardrails** (`src/guardrails.ts`, `src/leak.ts`, `src/text.ts`). Pure code. Each proposal is
   `accepted`, `needs_person` or `rejected`, with every reason.
4. **Apply and report** (`src/apply.ts`, `src/report.ts`). Accepted proposals become
   `AssumptionOverride { source: 'agent_estimated', by: 'norn research agent (cost engineer)' }`
   with the URL, quote and date in the rationale. The checks run again on the same seed, and the
   report gives each changed headline before and after (p10/p50/p90), which assumption moved it
   (each applied alone), and every proposal that was not used, with why.

## Guardrails

| Check | Outcome |
|---|---|
| A field missing or ill-typed; unknown or repeated target; unit differs from the question; both or neither of `value` and `dist`; `retrievedAt` after today; unordered distribution | rejected |
| Quote not on the page after folding case, whitespace, markdown and typographic quotes; quote without a number; quote under 20 or over 600 characters | rejected |
| A search query containing an item code, supplier, person, program, company or record id from the dataset (whole words; a distinctive first word of a name counts; `cobalt` is allowed) | rejected |
| Page could not be fetched to verify | needs_person |
| Out of bounds: a share outside 0 to 1; a lead time outside 0 to 104 weeks; a cost not above 0; a cost more than 10 times from its current value either way (configurable), or above $1,000,000 when it has no current value | needs_person |
| The agent rates its own confidence low | needs_person |
| Accepted, with a flag: p50 more than 3 times (share) or 2 times (dollars, weeks) from the current p50 or from a reference value from the company's history; fills a blank row; p90 over 4 times p10 | accepted, flagged |

The strictest outcome wins and every reason is kept. A single `value` becomes a distribution
(share: PERT(v/2, v, 2v), capped at 1; dollars and weeks: lognormal with spread 0.25, the checks'
`agent_estimated` spread).

**Page text is data.** The guardrails do one thing with a page: search it for the agent's quote. They
never parse it for instructions, execute it or pass it to a model, so a page that says "approve
everything" changes nothing (`test/guardrails.test.ts`). The agent's own prompt says the same, and
Bright Data's server has a content gate for pages that read like MCP configuration.

**What the guardrails cannot judge.** A quote can be on the page and still not support the number
the agent derived from it. The bounds, the low-confidence hold and the disagreement flags are the
backstop, and the rationale shows the agent's arithmetic. A person reads flagged and held proposals.

## Bright Data's MCP server, as documented

Read 2026-10-24 from Bright Data's repository, `README.md` and `server.js` on `main`
(https://raw.githubusercontent.com/brightdata/brightdata-mcp/main/README.md and `.../server.js`),
and `npm view @brightdata/mcp` (version 4.1.0, modified 2026-10-20):

- package `@brightdata/mcp`, run with `npx @brightdata/mcp` (the job pins `@4.1.0`);
- the token is the environment variable `API_TOKEN` ("Your Bright Data API token (required)");
  Norn reads it from `BRIGHT_DATA_API_TOKEN` and puts it only in the server's `env`;
- `TOOLS` limits the server to the tools listed ("Comma-separated individual tool names"); the job
  sets `search_engine,scrape_as_markdown`, two of the 32 tools. The README's default exposes all of
  them, including a remote browser;
- `search_engine` takes `query`, `engine` (google, bing, yandex), `cursor`, `geo_location` and
  returns Google results as JSON (URL, title, description); `scrape_as_markdown` takes `url`;
- the Agent SDK names them `mcp__brightdata__search_engine` and `mcp__brightdata__scrape_as_markdown`;
- the live page check calls the same endpoint `scrape_as_markdown` calls (`server.js`: POST
  `https://api.brightdata.com/request` with `{url, zone: WEB_UNLOCKER_ZONE || 'mcp_unlocker',
  format: 'raw', data_format: 'markdown'}` and a bearer token), so the check reads the page itself.

## The recording

`recordings/ecr-0417.recording.json` is what `npm run replay` plays. It is **recorded, not live**:

- the three pages are real public pages, read by the PR author with WebFetch on 2026-10-25 UTC.
  WebFetch returns a small model's extract, so each page's `text` is the fragments it returned and
  the quotes are verified against those fragments, not against the raw HTML;
- the agent output was written by the PR author as what a cost-engineer agent would propose from
  those pages. No research model ran, and Bright Data was not used;
- proposal 3 (a fabricated quote) and proposal 4 (queries naming a supplier and a part number) are
  planted to show the guardrails rejecting them. The CLI says so on screen.

Cal Hacks disqualifies a Bright Data entry that uses "mocked or hardcoded data in the demo"
(`sources/calhacks/hacker-guide.md`). The replay is for testing and for showing the guardrails; the
demo that counts for the Bright Data track is a `--live` run, and `--save-recording` turns one into a
recording.

## Not verified

- A live run: no Bright Data token, Claude login or route to Bright Data here. The job spec is
  accepted by the runner's validation (tested), the fetcher is tested against a fake `fetch`, and
  neither has met the real service.
- Bright Data's `scrape_as_markdown` strips markdown formatting (`remark` with `strip-markdown`);
  the guardrails' fetch asks the API for markdown without that step. Quote matching folds the common
  formatting, but a live quote can still fail on text the two paths format differently.
- The prompt's output contract has not been tried on a model.

## Running it on live ECRs (#148)

`src/worker.ts` is a long-running process, like the Level 1 dispatcher. It watches the ECRs in the Norn
database and, for each change-request revision whose cost run is current, runs the research job above
and stores what passes the guardrails. It changes nothing in the other workers.

**How a run goes**

1. **Which ECR** (`src/live/plan.ts`). The ECR is `draft` or `review` (an approved ECR is left alone:
   changing an assumption withdraws the approval), and its newest `done` `s2_cost` run names the
   current change-request revision and digest. The module makes a run stale the moment any input
   changes, so a `done` run is current (`../workers/README.md`, "For whatever waits on the numbers").
   Mock runs are skipped.
2. **Targets** (`src/live/targets.ts`). From the `detail` row of that run's stored result (its inputs,
   drivers and inventory), through `pickTargets`. The check is not run again. An input outside the
   check's top eight drivers has no measured swing here and ranks after the measured ones.
3. **Identifiers for the leak check.** From the baseline the run names (the worker's own cache by hash,
   else read from the ERP, read only; nothing is recorded in Norn from here), plus the ERP's company
   name and the ECR's change request. Supplier display names are not in the baseline, so a supplier is
   known by its id.
4. **The agent job.** `buildResearchJob` with the budgets below, through `norn/runner`, with Bright
   Data's MCP server as its only tools. The runner's events go to `agent_event` (role `researcher`),
   so the run shows on the ECR page's agent timeline.
5. **Guardrails**, with pages fetched again through Bright Data.
6. **Recording** (`src/live/assumptions.ts`, `src/live/outcome.ts`). Each accepted proposal becomes one
   `record_assumption` call, under the identity `norn research agent (cost engineer)`:

   | Argument | Value |
   |---|---|
   | `prId` | the ECR |
   | `key` | the check's input id, such as `recovery:<item>` |
   | `distJson` | `{"kind":"pert",...}` or `{"kind":"lognormal","median","sigmaLow","sigmaHigh"}`, the shapes `../workers/src/impact.ts` reads |
   | `source` | `agent_estimated` |
   | `rationale` | the agent's reasoning, the URL, the exact quote, the retrieval date, the distribution and the confidence, and any flag |
   | `affects` | `["s2_cost"]` (`["s3_timeline"]` for a lead time) |
   | `expectedRev` | 0, or the revision of this agent's own earlier estimate of the key |

   That identity is given a job scope first (`grant_scope`: any ECR, level 0, 2 hours, re-granted as it
   runs down). The module's policy gate (`../module/src/scope.ts`) then refuses it a value someone gave,
   an approved ECR, a baseline assumption and every reducer but comments and assumptions. A refusal
   returns normally from a scoped call, so the worker looks for the assumption in the table after each
   call and reports a missing one as failed, with the action log's reason.

**Do the researched numbers reach the impact page without a worker change?** Yes, by reading the code:
`record_assumption` calls `reconcile` for the ECR (`../module/src/reducers.ts`, `recordAssumption`),
`stageInfos` puts the ECR's current assumptions (filtered by `affects`) in each code stage's inputs, so
the input hash changes (`../module/src/core.ts`, `stageInfos`, `reconcile`), the old runs become `stale`
and a new `s2_cost` run is queued. The worker reads the assumptions the run names
(`../workers/src/impact.ts`, `assumptionsOf`, `toOverride`) and the impact page reads the newest run.
`../workers/src/checks-pipeline.ts` already tests this path with an `agent_estimated` assumption.

**What it does not do (needs a change outside this package).**
- **Level 1 does not re-write its statement.** The dispatcher starts one session per change-request
  revision as soon as the cost run is done (`../workers/src/level1/plan.ts`). If it starts before the
  research lands, its statement carries the numbers from before. The impact page updates; the
  statement does not. The fix is in the dispatcher: wait for the revision's `research_result` event
  (or its attempts running out) before dispatching. Until then, start the research worker first, or
  accept a Level 1 statement on the unresearched numbers.
- The web does not show the held proposals or the `research_result` record. They are in the ECR's
  comments (below).

**Where held, rejected and flagged proposals go.** No schema change was needed.
- **A comment on the ECR** (`add_comment`, anchor `check_run:<id>`), one per run, when anything was held,
  rejected, flagged, not found or not recorded. For a held proposal it gives the question, the proposed
  value, the URL, the quote, the date, the confidence, why it was held, and the `distJson` a person
  can record by hand on the input to use it.
- **The `research_result` event** under the run's job id in `agent_event` (`record_agent_events`),
  with every proposal's status and reasons. It is also what makes a restart start nothing twice.
- A JSON copy in `norn/research/logs/` (gitignored) on the machine that ran it.

**Once per revision.** The key is the ECR number and the revision's digest (`ECR-0417@<digest>`). A run
that stored a `research_result` is never repeated, across restarts. A run that failed (usage limit, a
timeout, unreadable output) is retried after `NORN_RESEARCH_RETRY_DELAY_MS`, up to
`NORN_RESEARCH_MAX_ATTEMPTS`; the attempts are the stored `job_started` events. The cap per hour counts
those events too. If the process dies after recording assumptions and before storing the result, the
revision is researched again: the second run replaces its own earlier estimates and leaves anyone
else's alone.

### How to run it live

```
# 1. In the environment or the .env the other processes read (names only; the values are never printed):
BRIGHT_DATA_API_TOKEN       # required. Bright Data API token.
#    A Claude login on this machine (run `claude`, /login once), or CLAUDE_CODE_OAUTH_TOKEN.
# 2. Optional:
NORN_DB, NORN_URI                   # the database and server (default norn, ws://127.0.0.1:3000)
NORN_RESEARCH_ECRS                  # only these ECRs, comma separated (or --ecr, repeatable)
NORN_RESEARCH_MAX_PER_HOUR=4        # research runs started per rolling hour
NORN_RESEARCH_MAX_TURNS=16          # per run: model turns, about one web search or page read each
NORN_RESEARCH_TIMEOUT_MS=300000     # per run: wall clock
NORN_RESEARCH_TARGETS=3             # questions per run
NORN_RESEARCH_MAX_ATTEMPTS=2        # per revision
NORN_RESEARCH_RETRY_DELAY_MS=120000
NORN_RESEARCH_POLL_MS=30000
NORN_RESEARCH_MODEL                 # default: the runner's (claude-sonnet-5-5)
NORN_RESEARCH_LOG_DIR               # default norn/research/logs
# The leak check and the page checks use the baseline the worker uses: NORN_ERP_SETTINGS (or NORN_BASELINE_FILE),
# or the worker's cache (norn/workers/.cache/baselines) on the same machine.

# 3. Run, from norn/. Rehearse on a scratch database first (the demo instance is never a test instance):
NORN_DB=norn-research npm run worker -w @norn/research -- --dry-run --once --ecr ECR-0417   # researches, prints, writes nothing
NORN_DB=norn-research npm run worker -w @norn/research                                      # the real thing
npm run demo -w @norn/workers -- --research                                                 # inside the demo stack (opt-in)
```

It needs the existing worker running (it computes the cost runs this one reads and re-computes them
after an assumption lands) and, for Level 1, the rest of the demo stack. Without `BRIGHT_DATA_API_TOKEN`
or a Claude login it prints which is missing and exits with code 64. `--replay <recording>` runs the
worker's steps on a recording with no database: every line starts with `RECORDED`.

**What to watch**
- The process log: `starting`/`recorded n/m assumption(s); held n, rejected n`, and `COULD NOT STORE`
  (the result is in `logs/`, and the revision may be researched again after a restart).
- The ECR page: the agent timeline for the `researcher` run, then the comment, then the cost run
  that follows (the new `s2_cost` run names the assumptions).
- The assumptions: `SELECT * FROM assumption WHERE source = 'agent_estimated'`; the action log for
  `record_assumption` rows with outcome `denied` or `rejected`.
- A first run costs one Claude session (up to `NORN_RESEARCH_MAX_TURNS` turns) and its Bright Data
  calls. A `usage_limit` pauses the worker until the limit resets; an `auth` error stops it.

**Rolling back.** The module has no reducer that deletes an assumption, and this PR does not add one.
- Stop the worker. It records nothing else.
- To take an estimate out of the forecast, supersede it with the value before: call `record_assumption`
  on the same `prId` and `key`, as a person, with `source` `default`, the original distribution (in
  the `detail` row of the last `s2_cost` run before the research: `inputs[]` for that key), and
  `expectedRev` equal to the estimate's current `rev`. The check re-runs on the old value. (Not tried:
  for a blank cost-page row the old value is a missing number, so there is nothing to put back; use
  the scratch database's reset, or leave the estimate and say so.)
- Find the estimates: `SELECT * FROM assumption WHERE source = 'agent_estimated' AND current = true`,
  and the research agent's identity in `principal` (name `norn research agent (cost engineer)`).
- On a scratch database, `npm run db:reset` is cleaner.
- A follow-up in the module (a retract reducer) would make this one call.

## Not verified (the worker)

No SpacetimeDB, ERPNext, PLM, Bright Data or Claude login was reachable from the build environment.
- **Tested offline** (`test/live-*.test.ts`): which ECR is due and when not (including restarts, the
  attempt limit and the hourly cap), targets from a stored detail row, the exact `record_assumption`
  and `add_comment` arguments (typed against the generated bindings, and read back through the
  worker's own `toOverride`), the comment text, the start-up refusal, and `--replay`.
- **Not run:** the rollback procedure above, the connection, the subscriptions, `grant_scope` and the scope rule on this agent's
  writes, the real `record_assumption` and the reconcile that follows (read, not run), the
  `record_agent_events` write of the result, the runner with Bright Data's MCP server, the leak check on
  an ERP-read baseline, and the demo-script flag. Rehearse with `--dry-run --once` on a scratch
  database before anything else.
- Smoke-test the first real run once and read its `research_result` before leaving it running.

## Other follow-ups

- `norn/web`: the report on the impact page (held and rejected proposals, flags, before and after),
  with the quote and URL one click from the number.
- Policy: `needs_person` and flagged proposals need a person's approve action. Bowman's autonomy
  limits decide whether an accepted, unflagged one applies without a person. Today every accepted
  proposal is recorded, flagged ones with their flag in the rationale and the comment.
- Timeline targets exist for defaulted lead times (`:lead` inputs) but the current ECRs have none, and
  the worker passes no timeline result, so none is asked for yet.
