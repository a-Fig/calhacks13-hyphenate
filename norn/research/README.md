# Norn's research agent (#138)

Written 2026-10-24. The cost-engineer agent that replaces a Norn default, or fills a blank cost-page
row, with a researched number, and the code that decides whether to believe it. The agent proposes
inputs. Code decides which to use and computes every number (`../ARCHITECTURE.md` §3).

Bowman Aviation, its parts, suppliers, people, programs and figures are fictional: a demonstration
dataset. The CLI says so on every run, recorded or live.

```
npm ci                # in norn/, once
npm test              # no model, no network, no login (about 30 s)
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
2. **Agent job** (`src/job.ts`). A `norn/runner` job, role `researcher`. The agent searches and reads with
   Claude Code's own `WebSearch` and `WebFetch` first; Bright Data's MCP server (`search_engine`,
   `scrape_as_markdown`) is the fallback, for when those fail, come back empty or blocked, or the source is a
   site they cannot read (LinkedIn, TikTok, YouTube and similar). The prompt names that order, and asks for
   each `queries` entry to start with the tool used for it. Its calls to all four tools count against the same
   turn budget (`NORN_RESEARCH_MAX_TURNS`). The reply is strict JSON: `proposals` (target, `value` or `dist`, unit,
   source URL, the date the source states for itself, exact quote, retrieval date, confidence,
   rationale, queries) and `unresolved`. Every search and page fetch the agent makes is checked for
   company identifiers by the runner before it is sent (see "Before a call is sent").
3. **Guardrails** (`src/guardrails.ts`, `src/leak.ts`, `src/text.ts`). Pure code. Each proposal is
   `accepted`, `needs_person` or `rejected`, with every reason. Only `accepted` is applied.
4. **Apply and report** (`src/apply.ts`, `src/report.ts`). Accepted proposals, which have no flag,
   become `AssumptionOverride { source: 'agent_estimated', by: 'norn research agent (cost engineer)' }`
   with the URL, quote and date in the rationale. The checks run again on the same seed, and the
   report gives each changed headline before and after (p10/p50/p90), which assumption moved it
   (each applied alone), every proposal that was not used, with why, the targets the agent said it
   could not resolve (with its reason), and the targets that got no answer at all.

## Guardrails

| Check | Outcome |
|---|---|
| A field missing or ill-typed; unknown or repeated target; unit differs from the question; both or neither of `value` and `dist`; `retrievedAt` or `sourceDate` after today; a `sourceDate` that is not a date; unordered distribution; a distribution whose quantiles are not finite numbers (e.g. `{p10: 1e-100, p50: 1e-10, p90: 1e300}`) | rejected |
| Quote not on the page after folding case, whitespace, invisible characters, markdown and typographic quotes; a quote that starts or ends in the middle of a number on the page (see below); quote without a number; quote under 20 or over 600 characters | rejected |
| A search query the agent lists, or the source URL (host, path, query, fragment), containing an item code, supplier, person, program, company or record id from the dataset (see "Leak check"; `cobalt` is allowed) | rejected |
| A dollar input with a current value whose median is within 10 times of it but whose p90 is above 10 times the current p90, or whose p10 is below a tenth of the current p10 (configurable) | rejected |
| Page could not be fetched to verify | needs_person |
| Out of bounds: a share outside 0 to 1; a lead time outside 0 to 104 weeks; a cost not above 0; a cost whose median is more than 10 times from its current value either way (configurable), or above $1,000,000 when it has no current value | needs_person |
| The agent rates its own confidence low | needs_person |
| The quote does not state the proposed value: none of the figures in the quote, with their unit and scale, equals the proposal's `value` (or the p50 of its quantiles, or the mode of its PERT) | needs_person ("quote does not state the proposed value") |
| Stale source: the proposal states a source date more than 3 years before today (configurable) | needs_person |
| Any flag: p50 more than 3 times (share) or 2 times (dollars, weeks) from the current p50 or from a reference value from the company's history; **fills a blank cost-page row**; p90 over 4 times p10; **no source date stated** | needs_person (held, not applied; the flags are listed) |

The strictest outcome wins and every reason is kept. Only a proposal with no reason to hold it and
no flag is `accepted`, and only an accepted one becomes an assumption. A single `value` becomes a
distribution (share: PERT(v/2, v, 2v), capped at 1; dollars and weeks: lognormal with spread 0.25,
the checks' `agent_estimated` spread). One proposal that fails in any way, including an exception
while it is being read, is rejected with a reason and the review goes on with the next.

**Source date.** `sourceDate` is the date the page states for itself (published, last updated,
"prices as of"), as `YYYY-MM-DD`, `YYYY-MM` or `YYYY`; a period counts up to its last day. The
guardrails do not read it from the page; they use what the agent states. A proposal that states
none is flagged, which holds it. A recorded or live page that states a date therefore needs the
agent to copy that date.

**The quote must state the value.** A quote can be on the page and say nothing about the amount: a
recycler's "$0.75/lb" under a $400,000 estimate. So the figures in the quote are read with their unit
and scale (`src/quotevalue.ts`): dollars need a currency sign or "USD"/"dollars" and take k, thousand,
million, billion and cents; a share takes % or "percent", or a plain decimal from 0 to 1; weeks take
weeks, days, months or years. One of them must equal the proposed value (the `value`, the p50 of
quantiles, or the mode of a PERT) or the proposal is held for a person. A value the agent works out
itself, such as a price per pound times a part weight, is therefore always held. The review
(`quoteMustStateValue`, default on; only the tests of the other checks turn it off) keeps the
reason in the report.

A blank cost-page row that is filled is held too (`replaces_blank_row`), because the quote checks
only that a figure is on the page, not that a number of that size belongs in that row. Approval of
held proposals is follow-up work.

**Quote and numbers.** The quote must be found in the page text, and where it starts or ends with a
number that number must be a whole token of the page. A quote may not start after a digit, letter,
decimal point or thousands separator (comma, point, space, apostrophe), sign, slash, colon or
currency sign, and may not end before a digit, letter, decimal point or separator and a digit,
percent sign or scale word (k, million, percent...). So "75 per lb for clean aluminum cuts" does not
verify against "$0.75 per lb for clean aluminum cuts", which it would otherwise misquote by 100
times. A quote that starts mid-number is rejected even if the same words also appear elsewhere on the
page with whole numbers; one clean occurrence is enough.

**Leak check** (`src/leak.ts`). Text is folded before it is compared: zero-width, soft-hyphen, bidi
and other format characters removed, NFKC, accents stripped, case and punctuation dropped. Two matches
run: whole words (`bw-5120-210`, `BW 5120 210`; a distinctive first word of a supplier, program or
surname counts), and compact forms with every separator and space removed for part numbers, record ids
and multi-word names (`5120210`, `BW5120210`, `JeffHargrove`, `Bow<ZWSP>man Aviation`). A digit at the
edge of a compact match must be the edge of a number in the text, so `15120210` is not part
5120-210. The check errs towards rejecting. It does not catch look-alike letters from another script
(a Cyrillic "a" in "Halden"). `test/leak.test.ts` runs every identifier the check collects from
Bowman's dataset (610 of them) through it, as written and inside a longer query, and all are caught
except the one deliberately allowed word, `COBALT` (a metal as well as a supplier).

**Page text is data.** The guardrails do one thing with a page: search it for the agent's quote. They
never parse it for instructions, execute it or pass it to a model, so a page that says "approve
everything" changes nothing (`test/guardrails.test.ts`). The agent's own prompt says the same, and
Bright Data's server has a content gate for pages that read like MCP configuration.

**What the guardrails cannot judge.** A quote can be on the page and still not support the number
the agent derived from it. The bounds, the low-confidence hold, the staleness hold and the flags are
the backstop, and the rationale shows the agent's arithmetic. A person reads held proposals.

## Before a call is sent

The leak check on the agent's own list of queries runs only after the session has ended, and that
list is the agent's report. So the runner checks the real arguments first. `JobSpec.toolInputGuards`
(`../runner/src/types.ts`) lets a job supply a function per named tool; the runner's `PreToolUse`
hook (`toolInputGuardHook` in `../runner/src/hooks.ts`) calls it with the arguments the model gave,
and the call is made only if the guard allows it. A guard that throws or answers with anything but
`{ allow: true }` denies. Tools with no guard, and every other job, behave as before.

`researchToolGuards` (`src/job.ts`) supplies the guards for all four tools, the same two shapes:

- `WebSearch` and `mcp__brightdata__search_engine`: every string in the arguments, object keys included
  (WebSearch's domain lists too), goes through the leak check, and a call with no `query` is refused;
- `WebFetch` and `mcp__brightdata__scrape_as_markdown`: the URL (host, path, query, fragment) and every other
  string (WebFetch's `prompt` too) go through the leak check, and a call with no URL is refused.

The runner's own `WebFetch` guard (the public-address check, `../runner/src/fetch-guard.ts`) is unchanged, but it
runs after the identifier guards, in the same hook (`buildJobHooks`): it resolves the host, and a lookup tells the name
server what is being fetched, so a host name that carries an identifier is refused without ever being looked up.

Every string is checked as written and after decoding: percent-escapes decoded until stable (at most
3 passes, so `%48%61%6C%64%65%6E` and a double-encoded name are read as Halden), `+` read as a space,
and then the folding described under "Leak check". Arguments nested deeper than 6 levels, or holding
more than 500 strings (a cyclic object too), are refused outright, since what is not walked is not
checked.

A refused call is never sent. The reason sent back to the agent names the kind of
identifier (supplier, item...), not the text. A source URL in a proposal is checked the same way
before the guardrails' own page fetch, and a proposal whose URL leaks is rejected without a fetch.
In a live run the CLI prints how many calls were checked and how many were refused.

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

- the three pages are real public pages, read by the research engineer with WebFetch on 2026-10-25 UTC.
  WebFetch returns a small model's extract, so each page's `text` is the fragments it returned and
  the quotes are verified against those fragments, not against the raw HTML;
- the agent output was written by the research engineer as what a cost-engineer agent would propose from
  those pages. No research model ran, and Bright Data was not used;
- proposal 3 (a fabricated quote) and proposal 4 (queries naming a supplier and a part number) are
  planted to show the guardrails rejecting them. The CLI says so on screen;
- the `sourceDate` of proposals 1 and 2 is the date the recorded page states (the recycler's "Last
  Updated: 10/25/2026" and the trade article's "December 2, 2025");
- **nothing in the recording is applied, so no headline number moves in the replay.** Proposal 1, the
  real scrap price, is verified on the page, but its quote is a price per pound and the proposal is a
  share the agent worked out, so the quote does not state the value and it is held for a person
  (it would also be flagged for being more than 3 times from the default's); proposal 2 is held for
  the same reason and because the agent rated itself low; 3 and 4 are rejected. Applying a proposal
  is tested in `test/replay.test.ts` with a variant of proposal 1 that quotes a page stating its share.

Cal Hacks disqualifies a Bright Data entry that uses "mocked or hardcoded data in the demo"
(`sources/calhacks/hacker-guide.md`). The replay is for testing and for showing the guardrails; the
demo that counts for the Bright Data track is a `--live` run, and `--save-recording` turns one into a
recording.

## Not verified

- Web first (WebSearch, WebFetch, the plain page fetch) has been tested with fake fetchers and the hook the runner
  runs, not against a real site or a real session. How often the agent falls back, and whether a plain fetch of
  a real page gets past bot checks, is not known.
- A live run: no Bright Data token, Claude login or route to Bright Data here. The job spec is
  accepted by the runner's validation (tested), the fetcher is tested against a fake `fetch`, and
  neither has met the real service.
- Bright Data's `scrape_as_markdown` strips markdown formatting (`remark` with `strip-markdown`);
  the guardrails' fetch asks the API for markdown without that step. Quote matching folds the common
  formatting, but a live quote can still fail on text the two paths format differently.
- The prompt's output contract, including the `sourceDate` field the agent is asked to copy from the
  page, has not been tried on a model. An agent that leaves the date out gets every proposal held.
- The runner's tool-input hook is tested with scripted sessions and hook calls, not with a real Claude
  Code session: whether Claude Code runs a `PreToolUse` hook for MCP tools as it does for `WebFetch`
  is what the SDK documents, and not yet seen here.

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
4. **The agent job.** `buildResearchJob` with the budgets below, through `norn/runner`, with
   WebSearch and WebFetch first and Bright Data's MCP server as the fallback. The runner's events go to `agent_event` (role `researcher`),
   so the run shows on the ECR page's agent timeline.
5. **Guardrails**, with pages fetched again, a plain HTTPS fetch first (`plainFetcher`, `src/pages.ts`: https only, a
   20 s timeout, HTML turned into text). Before the request, and again for every redirect's `Location`, the address goes
   through the identifier check (a leak is refused before any lookup or request, the proposal is rejected, and Bright Data
   is not asked to follow it), then is resolved once and checked to be public, and the connection is pinned to the address
   that was checked (`pinnedLookup`, with the host name still on the certificate check), so a name that answers differently
   the second time (DNS rebinding) cannot reach a private address
   and Bright Data's scrape only when that fails or returns an empty or blocked page (`webFirstFetcher`). The
   verdict, the report (`read by a plain HTTPS fetch` or `read through Bright Data`) and the stored
   `research_result` (`verifiedVia`) say which one read each page. This comes after the runner's timeout, not inside
   it: each page check has its own limit (20 s plain, then 60 s for Bright Data; the fetches run side by side), and the baseline read before the job is
   not limited by either. A run can therefore take about 6 minutes from start to finish with the default 5-minute
   runner timeout, longer when the ERP is slow.
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
   | `expectedCrRev` | the change-request revision the run was researched against. The module refuses the call, in the same transaction, if the ECR is on another one by then |

   That identity is given a job scope first (`grant_scope`: any ECR, level 0, 2 hours, re-granted as it
   runs down). The module's policy gate (`../module/src/scope.ts`) then refuses it a value someone gave,
   an approved ECR, a baseline assumption and every reducer but comments and assumptions. A refusal
   returns normally from a scoped call, so the worker reads the call's own row in the action log, found by the
   request id it sent (`src/live/assumptions.ts` `callResult`): `applied` names the assumption the call wrote, which
   must be the key, value and revision asked for; `denied` and `rejected` carry the reason, and the call is reported
   as failed with it. An older assumption of the same value does not count. The one call that logs nothing is one
   that changes nothing (the module returns early on an identical assumption). If no log row arrives within
   6 seconds and an identical current row is in the table, the call is reported as unconfirmed, not recorded: the
   ECR comment lists it under "Accepted but not recorded" and the `research_result` event under `failed`.

**Do the researched numbers reach the impact page without a worker change?** Yes, by reading the code:
`record_assumption` calls `reconcile` for the ECR (`../module/src/reducers.ts`, `recordAssumption`),
`stageInfos` puts the ECR's current assumptions (filtered by `affects`) in each code stage's inputs, so
the input hash changes (`../module/src/core.ts`, `stageInfos`, `reconcile`), the old runs become `stale`
and a new `s2_cost` run is queued. The worker reads the assumptions the run names
(`../workers/src/impact.ts`, `assumptionsOf`, `toOverride`) and the impact page reads the newest run.
`../workers/src/checks-pipeline.ts` already tests this path with an `agent_estimated` assumption.

**What it does not do (needs a change outside this package).**
- **Level 1 does not re-write its statement; it waits for the research instead.** The dispatcher starts
  one session per change-request revision and never writes a second statement for it, because the
  statement is keyed on that revision and a research run keeps the revision (it changes assumptions, which
  re-runs the cost check on the same change request). A session that started before the research landed
  would have left the statement on the numbers from before for good, while the impact page moved on. So
  with `--research`, the dispatcher holds the first session for a revision until this worker has stored its
  `research_result` for it (`../workers/src/level1/plan.ts`, `researchWait`), or until
  `NORN_L1_RESEARCH_WAIT_MS` (default 600000, ten minutes) after the first cost run on the revision finished (later re-runs of the check, by research or a baseline change, do not move it, and neither does a server clock ahead of the dispatcher's), whichever comes first.
  The order of starting the processes does not matter. The real sequence is: cost run done, research runs
  (about 6 minutes at the longest with the defaults, see step 5), its assumptions re-run the cost check,
  the `research_result` is stored, the dispatcher starts the session on the re-run's numbers.
  - Without `--research` (no `NORN_L1_WAIT_FOR_RESEARCH=1` on the dispatcher) it behaves as it always did.
    Running the worker by hand next to a dispatcher you started yourself: set that variable on the dispatcher
    (and `NORN_L1_RESEARCH_ECRS` if this worker is limited to some ECRs, so the others are not held).
  - The wait is a bound, not a guarantee. After ten minutes, or when research failed, hit its attempt
    limit, was held by the hourly cap, or is not running, the session goes ahead on the numbers it has, and
    a research result that lands afterwards does not change that statement. A revision with nothing left to
    research stores a result saying so, so it is not held for the full ten minutes.
  - A retry after a failed Level 1 session is not held up again.
- The web does not show the held proposals or the `research_result` record. They are in the ECR's
  comments (below).

**Where held, rejected and flagged proposals go.** No schema change was needed.
- **A comment on the ECR** (`add_comment`, anchor `check_run:<id>`), one per run, when anything was held,
  rejected, flagged, not found, not answered or not recorded. For a held proposal it gives the question,
  the proposed value, the URL, the quote, the date the source states for itself (or that it gave none), the
  retrieval date, the confidence, every reason it was held (a stale or undated source, a flag, low
  confidence, a page that could not be checked) and the `distJson` a person can record by hand on the
  input to use it. Questions the agent declared unresolved are listed with its reason, and questions it
  neither answered nor declared unresolved are listed as having no answer.
- **The `research_result` event** under the run's job id in `agent_event` (`record_agent_events`),
  with every proposal's status, reasons and flags, the unresolved and unanswered questions, and what was
  recorded or failed. It is also what makes a restart start nothing twice.
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
NORN_RESEARCH_TIMEOUT_MS=300000     # per run: wall clock of the agent session; the page checks (60 s each) come after it
NORN_RESEARCH_TARGETS=3             # questions per run
NORN_RESEARCH_MAX_ATTEMPTS=2        # per revision
NORN_RESEARCH_RETRY_DELAY_MS=120000
NORN_RESEARCH_POLL_MS=30000
NORN_RESEARCH_MODEL                 # default: the runner's (claude-sonnet-5-5)
NORN_RESEARCH_LOG_DIR               # default norn/research/logs
# The leak check and the page checks use the baseline the worker uses: NORN_ERP_SETTINGS (or NORN_BASELINE_FILE),
# or the worker's cache (norn/workers/.cache/baselines) on the same machine.

# 3. Run, from norn/. Rehearse on a scratch database first (the demo instance is never a test instance):
NORN_DB=norn-research npm run worker -w @norn/research -- --dry-run --once --ecr ECR-0417   # researches and prints; writes nothing to the database
NORN_DB=norn-research npm run worker -w @norn/research                                      # the real thing
npm run demo -w @norn/workers -- --research                                                 # inside the demo stack (opt-in)
```

A dry run still spends a Claude session and Bright Data calls. It records no assumption, comment or result, and
it stores none of the runner's events either (they go to `logs/<db>-dry-run-events.jsonl` on this machine), so it
uses up none of the revision's attempts and none of the hourly cap, and a live run afterwards starts as if it
had not happened. (It used to store the events, and a stored `job_started` is what counts as an attempt.)

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
- A first run costs one Claude session (up to `NORN_RESEARCH_MAX_TURNS` turns, every tool call counting) and
  whatever Bright Data calls the agent's fallback and the page checks needed (none, when the plain web works). A `usage_limit` pauses the worker until the limit resets; an `auth` error stops it.

**Rolling back.** The module has no reducer that deletes an assumption, and this PR does not add one.
- Stop the worker. It records nothing else.
- To take an estimate out of the forecast, supersede it with the value before: call `record_assumption`
  on the same `prId` and `key`, as a person, with `source` `default`, the original distribution (in
  the `detail` row of the last `s2_cost` run before the research: `inputs[]` for that key), and
  `expectedRev` equal to the estimate's current `rev`. The check re-runs on the old value. (Not tried:
  for a blank cost-page row the old value is a missing number, so there is nothing to put back; on a scratch
  database, republish it (last point below), or leave the estimate and say so.)
- Find the estimates: `SELECT * FROM assumption WHERE source = 'agent_estimated' AND current = true`,
  and the research agent's identity in `principal` (name `norn research agent (cost engineer)`).
- On a scratch database, publish it again over itself, from `norn/`:
  `spacetime publish <scratch-name> --module-path module --server local --delete-data=always --yes`, or remove it:
  `spacetime delete <scratch-name> -s local -y`. **Never use `npm run db:reset` for this.** That script publishes
  to the database named `norn` with `--delete-data=always`, which wipes the shared demo data. Use scratch names of
  your own (`norn-research`, `norn-fx-<x>`), never `norn`, `norn-test`, `norn-mcp`, `norn-live`, `norn-ui` or `norn-l1`.
- A follow-up in the module (a retract reducer) would make this one call.

## Not verified (the worker)

No ERPNext, PLM, Bright Data or Claude login was reachable from the build environment.
- **Tested offline** (`test/live-*.test.ts`): which ECR is due and when not (including restarts, the
  attempt limit and the hourly cap), targets from a stored detail row, the exact `record_assumption`
  and `add_comment` arguments (typed against the generated bindings, and read back through the
  worker's own `toOverride`), how a call's outcome is read from the action log (`callResult`), the
  comment text, the start-up refusal, and `--replay`.
- **Run against a real module on a scratch database** (`npm run check:module -w @norn/research`, which
  plays the worker by hand on synthetic ECRs, no model and no Bright Data): `grant_scope` and the scope rule
  on this agent's identity; `record_assumption` with and without `expectedCrRev`, refused and applied, and
  the log rows each leaves; the reconcile that makes the cost run stale; the write of a `research_result`
  event; and the Level 1 dispatcher's facts and decision (`factsOf`, `decide`) read from a real client cache,
  held for research, released by the result, released by the timeout. Not the worker process itself.
- **Not run:** the worker process against a database (its connection, subscriptions and grant timing), the
  rollback procedure above, the runner with Bright Data's MCP server, the leak check on an ERP-read
  baseline, and the demo-script flag. Rehearse with `--dry-run --once` on a scratch database before
  anything else.
- Smoke-test the first real run once and read its `research_result` before leaving it running.

## Other follow-ups

- `norn/web`: the report on the impact page (held and rejected proposals, flags, before and after),
  with the quote and URL one click from the number.
- Policy: a person's approve action for held proposals (`needs_person`, which now includes every
  flagged one) is follow-up work. Nothing implements it yet: a held proposal is listed in the report
  and is not applied. Bowman's autonomy limits would decide whether an accepted, unflagged one applies
  without a person.
- Runner config: a role model for `researcher`, the token as an environment variable on the home
  server, and a log sink into the action log.
- Timeline targets exist for defaulted lead times (`:lead` inputs) but the current ECRs have none, and
  the worker passes no timeline result, so none is asked for yet.
