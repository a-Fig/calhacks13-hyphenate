# Level 1 impact statement (#42) and the PLM ingest source (#40)

When an ECR's current change-request revision has a finished `s2_cost` check run and no Level 1
statement, one Claude session reads Norn's impact numbers and posts a Level 1 statement. A publisher
then writes that statement onto the ECR in Bowman's PLM. Three processes, none of which writes to
ERPNext:

| process | start (from `norn/`, with `NORN_DB` set) | does |
|---|---|---|
| dispatcher | `npm run level1:dispatcher -w @norn/workers` | starts one session per ECR revision through `norn/runner` |
| publisher | `npm run level1:publisher -w @norn/workers` | writes each statement to the PLM through `norn/connectors/plm` |
| PLM ingest | `NORN_INGEST_SOURCE=plm npm run ingest -w @norn/workers` | `listEcrs()` then `watchEcrs()` and `readChangeRequest()` into the existing `ingest_ecr` path |

They also need Norn's MCP server for the same database (`npm run start -w @norn/mcp`, same `NORN_DB`)
and the PLM credentials (`PLM_URL`, `PLM_API_KEY`, `PLM_API_SECRET`; `ENV_FILE` points at the `.env`
of the main checkout, which a worktree does not have). Run ONE dispatcher per database.

## The dispatcher (`dispatcher.ts`, `plan.ts`, `settings.ts`)

- Job: role `level1-statement` (the MCP server lets a role named `level<N>-...` post a statement at
  level N only), actor `agent:norn/level1/<jobId>`, no onBehalfOf, spawnedBy `norn: check_run <id>`.
  `mcpServers` come from `nornMcpFor()` (default `headersHelper` delivery, the token is never on the
  command line), scoped to that ECR. `allowedTools` are Norn's MCP tools only.
- Defaults: 12 turns, 240 s, 2 attempts per revision. Settings: `NORN_L1_MODEL` (default
  `claude-haiku-5-5`), `NORN_L1_MAX_TURNS`, `NORN_L1_TIMEOUT_MS`, `NORN_L1_MAX_ATTEMPTS`,
  `NORN_L1_RETRY_DELAY_MS`, `NORN_L1_CONCURRENCY`, `NORN_L1_POLL_MS`.
- No duplicates. `plan.ts` is pure (a snapshot in, dispatch or skip out). The record of what was
  started is `agent_event`: every runner event is stored there through `record_agent_events`
  (`agent-events.ts`), and a job id names its ECR revision and attempt. So a restart starts nothing
  twice, and no extra table is needed. The key is the change request's revision, not the ECR's own
  counter, so a baseline-only re-check (ERP prices moved, an assumption changed) starts nothing. A
  session that failed or ended without a statement is retried, up to the attempt cap, under a new job id.
- Events also go to a JSONL file (`teeSink`) as a fallback if the database is unreachable.

## The agent (`prompt.ts`)

It calls `get_ecr`, `get_impact` and `list_assumptions`, then `post_impact_statement` at level 1:
the unit cost per program, the one-time cost and the 12-month total, each p10/p50/p90 copied from
`get_impact`; the top drivers; flagged assumptions and blank lines that need an estimate; and a
recommendation marked judgment. ICD 203 wording and Bowman's posting standards (materiality, evidence
classes, words to avoid) are in the system prompt. The standards are constants copied from
`bowman/norn-config/bowman.config.ts` on 2026-10-24 (`norn/config` was not on this branch); read
them from the loaded config when it is.

A change class is only ever the agent's own proposal, marked judgment. The approval route is
"Pending Norn's routing". The seam is `routing.ts`: `routeFor(ecr, assessment)` returns nothing now;
#75 fills it in there and nowhere else (the dispatcher and the publisher both call it).

## The publisher (`publisher.ts`, `format.ts`, `plm.ts`)

Writes the seven `impact_*` fields with the connector's `writeImpact()` and nothing else (a comment
only if `NORN_PUBLISH_COMMENT=1`). `impact_statement` is self-contained HTML (inline styles, a table
of headline numbers, drivers, assumptions, evidence tags) that reads without opening Norn. Its last
line carries `Ref <statement id>.<digest>`.

Idempotent: before every write it reads the ECR's fields from the PLM. If the ref is there and the
plain fields match, nothing is written. A restart, a second publisher or a reset scratch database
therefore writes nothing twice. A person editing a plain field gets it put back. Mock numbers
(s3, s4 placeholders) never reach the PLM as a headline. `NORN_PUBLISH_ECRS=ECR-0417` limits it.

## The PLM ingest (`ingest-plm.ts`)

Lists the PLM's ECRs once and takes in every one in a wanted state (`NORN_PLM_STATES`, default
Submitted, In CM Review, CCB Review; `NORN_PLM_ECRS` limits it), then watches the PLM
(`NORN_PLM_INTERVAL_MS`, default 1000) and reports each changed ECR. Norn's own writes to the PLM
are not offered back by the watcher. `ingest.ts` hands `ingestOnce` and `itemOf` in, because it is
the entry module and importing it back would deadlock on its top-level await.

## Helpers

- `plm-impact.ts read|clear ECR-0417`: show or empty the seven fields (put the demo record back).
- `screenshot.ts ECR-0417 out.png`: headless Edge on the PLM's Impact assessment tab.
- `e2e.ts` (`npm run level1:e2e -w @norn/workers`): the whole chain on the scratch database `norn-l1`
  (wiped on every run; the name is a literal on purpose), timed. It refuses to start when ECR-0417
  already carries an impact assessment, restarts the dispatcher and publisher to prove nothing is done
  twice, screenshots the tab and clears the seven fields. It spends one real Claude session.
  Other sessions that write to the same demo ECR (`bowman/plm/verify.ts`) will collide with it.

## Tests

`npm run test:level1 -w @norn/workers` (offline): dispatch rules and idempotency, the prompt,
statement-to-PLM formatting, publisher idempotency.
