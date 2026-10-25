# Norn's research agent (#138)

Written 2026-10-24. The cost-engineer agent that replaces a Norn default, or fills a blank cost-page
row, with a researched number, and the code that decides whether to believe it. The agent proposes
inputs. Code decides which to use and computes every number (`../ARCHITECTURE.md` §3).

Bowman Aviation, its parts, suppliers, people, programs and figures are fictional: a demonstration
dataset. The CLI says so on every run, recorded or live.

```
npm ci                # in norn/, once
npm test              # about 100 tests, no model, no network, no login (about 30 s)
npm run typecheck
npm run replay        # the ECR-0417 demo, offline, every line labelled RECORDED

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

`researchToolGuards` (`src/job.ts`) supplies the guards for the two Bright Data tools:

- `mcp__brightdata__search_engine`: every string in the arguments, object keys included, goes through
  the leak check, and a call with no `query` is refused;
- `mcp__brightdata__scrape_as_markdown`: the URL (host, path, query, fragment) and every other string
  go through the leak check, and a call with no URL is refused.

Every string is checked as written and after decoding: percent-escapes decoded until stable (at most
3 passes, so `%48%61%6C%64%65%6E` and a double-encoded name are read as Halden), `+` read as a space,
and then the folding described under "Leak check". Arguments nested deeper than 6 levels, or holding
more than 500 strings (a cyclic object too), are refused outright, since what is not walked is not
checked.

A refused call is never sent to Bright Data. The reason sent back to the agent names the kind of
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

## Wiring it in (follow-up)

- `norn/workers`: a job kind `research` that, for an ECR with a finished cost run, calls `prepare`,
  submits `buildResearchJob` to the runner, then `finish`, and stores the accepted overrides as
  `Assumption` rows (source `agent_estimated`) and the report as a run row. Needs the module
  schema's assumption table and the check-run hash to include them (assumptions are inputs to the
  run hash), so the cost check re-runs when one lands.
- `norn/web`: the report on the impact page (held and rejected proposals, flags, before and after),
  with the quote and URL one click from the number.
- Policy: a person's approve action for held proposals (`needs_person`, which now includes every
  flagged one) is follow-up work. Nothing implements it yet: a held proposal is listed in the report
  and is not applied. Bowman's autonomy limits would decide whether an accepted, unflagged one applies
  without a person.
- Runner config: a role model for `researcher`, the token as an environment variable on the home
  server, and a log sink into the action log.
- Timeline targets exist for defaulted lead times (`:lead` inputs) but the current ECRs have none.
