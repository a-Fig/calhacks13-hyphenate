# Norn's research agent (#138)

Written 2026-10-24. The cost-engineer agent that replaces a Norn default, or fills a blank cost-page
row, with a researched number, and the code that decides whether to believe it. The agent proposes
inputs. Code decides which to use and computes every number (`../ARCHITECTURE.md` §3).

```
npm ci                # in norn/, once
npm test              # 60 tests, no model, no network, no login (about 25 s)
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

## Wiring it in (follow-up)

- `norn/workers`: a job kind `research` that, for an ECR with a finished cost run, calls `prepare`,
  submits `buildResearchJob` to the runner, then `finish`, and stores the accepted overrides as
  `Assumption` rows (source `agent_estimated`) and the report as a run row. Needs the module
  schema's assumption table and the check-run hash to include them (assumptions are inputs to the
  run hash), so the cost check re-runs when one lands.
- `norn/web`: the report on the impact page (held and rejected proposals, flags, before and after),
  with the quote and URL one click from the number.
- Policy: `needs_person` and flagged proposals need a person's approve action. Bowman's autonomy
  limits decide whether an accepted, unflagged one applies without a person.
- Runner config: a role model for `researcher`, the token as an environment variable on the home
  server, and a log sink into the action log.
- Timeline targets exist for defaulted lead times (`:lead` inputs) but the current ECRs have none.
