# Level 1 impact statement (#42) and the PLM ingest source (#40)

When an ECR's current change-request revision has a finished `s2_cost` check run, its timeline and supply
checks (`s3_timeline`, `s4_supply`) have settled or been waited for (see below), and it has no Level 1
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
- Which revision a statement belongs to. The module records the check run a statement was written
  from (`impact_statement.checkRunId`: the run that started the session, from the credential's
  spawnedBy `norn:check_run:<id>`, else the run its first computation number was copied from). The
  run's inputs name the change-request revision and the ERP baseline. `post_impact_statement`
  refuses a session whose run is no longer `done` (a new revision, baseline or assumption made it
  stale), so a late revision-1 session cannot post, and cannot suppress revision 2's session. The
  dispatcher also stops running sessions of an earlier revision when the next one arrives. A
  statement that rests on no run (judgment only, from an agent whose spawnedBy is not a check run) is
  never bound by when it was posted: it does not stop a session from being dispatched, and the
  publisher takes it only while the ECR is still at the `prRevision` the module recorded for it.
- Sessions are keyed by ECR and revision (the job id names both), so another ECR's session never
  blocks this one.
- Waiting for s3 and s4 (#120, `siblings.ts`). The statement carries the cut-in date and the supplier
  findings, so the dispatcher starts the session once s3 and s4 have settled (done, failed or blocked), not
  at s2 alone. Measured on Bowman's data (norn-seed-1, 10,000 draws, one process): s2 takes 0.5 to 1.0 s,
  s3 0.06 to 0.13 s and s4 0.10 to 0.47 s, and the module queues all three at once once s1 is done, so
  the wait is normally a second or two. The wait is bounded: `SIBLING_WAIT_MS` (30 s) after s2 finished.
  Once the cutoff has strictly passed the session starts whatever their state (a finish exactly at the
  cutoff still counts, so the dispatcher does not go ahead at the cutoff itself: see `siblings.ts`), and the
  statement says that check is unavailable (failed, blocked, or not finished in time), never holds Level 1 back, and is never the
  reason for a Send back. The cutoff is a constant, not a setting: the dispatcher and the publisher both
  read it, because it decides which runs a statement counts as having had.
- Which s3 and s4 run a statement rests on. s2, s3 and s4 all read the same s1 run, so a run of s3 or s4
  belongs to the statement's snapshot when it names the same `upstream.s1_bom_delta` hash and the same
  change-request revision as the statement's own s2 run (`impact_statement.checkRunId`). Among those, the
  newest that had settled by the cutoff (a stale run counts: it finished on those inputs and was made
  stale later). A later run, such as s4 re-run because another ECR was filed, is never read. The
  dispatcher and the publisher call the same `siblingsForRun` (`source.ts`).
- Times are compared at full precision: `RunRow` carries SpacetimeDB timestamps as bigint microseconds, never
  milliseconds, so a run created a few hundred microseconds after s2 is not mistaken for one of its siblings.
- The agent's words against the rule (#123, `prose.ts`, `guard.ts`). The PLM text lists every derived
  blocker and condition itself, whatever the agent wrote. The MCP server (`mcp/src/main.ts`) runs `guard.ts` on
  every post: a statement that says the checks are clean, or that there are no issues, while the rule has a
  condition or a check has a finding, or that quotes a dollar figure no check result contains, is refused with
  the reason, and the agent posts again. The agent's prose is never rewritten.
- Events also go to a JSONL file (`teeSink`) as a fallback if the database is unreachable.

## The agent (`prompt.ts`)

It calls `get_ecr`, `get_impact` and `list_assumptions`, then `post_impact_statement` at level 1:
the unit cost per program, the one-time cost and the 12-month total, each p10/p50/p90 copied from
`get_impact`; the top drivers; flagged assumptions and blank lines that need an estimate; and a
recommendation marked judgment. Since #120 it also posts the timeline and supply findings
(`timeline-supply.ts`): headline numbers that are the stored s3/s4 rows (`cut_in_date`, `cut_in_serial`,
`late_weeks`, `single_source_items`, `peer_cut_in_shift_weeks`, one `bundle_saving:*`, as computation
evidence with their resultKeys, so the module copies the digits and binds the statement to those runs),
and at most one claim starting "Timeline: " and one "Supply: ", built from sentences the job prompt
supplies with likelihood in the ICD 203 words (`likelihoodWord`, same scale as the system prompt). What
clears Bowman's bars decides what is raised: a cut-in or slot slip over 14 days, a bundle saving over the
$10,000 one-time bar, a part with one source; the cut-in date and serial are always given. A check that is
not available gets one judgment claim saying so and no number. ICD 203 wording and Bowman's posting standards (materiality, evidence
classes, words to avoid) are in the system prompt. The standards are constants copied from
`bowman/norn-config/bowman.config.ts` on 2026-10-24 (`norn/config` was not on this branch); read
them from the loaded config when it is.

The seam is `routing.ts`: `routeFor(ecr, assessment, config)` calls `routeEcr` (norn/config) on the company
configuration stored in `norn_config` (`company_config`), and the dispatcher and the publisher both call it with
the same stored config and the same run's cost rows (`costCheckOf`), so the agent is told the route the PLM gets.
The route is the tier's approval body with the cost against its limit, e.g. "Change Control Board, with Technical
Review Committee review (p90 cost about 164,489 USD, above 150,000 USD)". The class is returned only if the ECR
was given one that routing used (no caller gives one yet), so it stays the agent's proposal, marked judgment.
With no stored config (or one that does not validate) `routeFor` returns nothing and the route is
"Pending Norn's routing". The headline rows alone cannot place a change for a company whose cost measure does not
let savings offset spend (Bowman's): the cost reads as unmeasured and the top tier, so the cost check's rows are used.

### The recommendation (`recommendation.ts`)

Two live runs on ECR-0417 once gave "Approve with conditions" and "Send back" on the same facts, so the
recommendation is a rule, not a mood. `deriveRecommendation` reads the cost check's stored `detail` row
(flags, inputs, `bomDelta`) and whether the redline read, BOM delta or cost check failed or is blocked:
1. **Send back**: it cannot be assessed as filed. A BOM conflict with the baseline, an error flag, a forecast
   that did not converge, a failed or blocked check, or no cost detail.
2. **Approve with conditions**: it stands with stated gaps. Every blank or unestimated line, undecided stock
   disposition, price change with no quote, or other warn flag. The conditions name exactly those.
3. **Approve**: no blocker, no gap. Info flags are neither.
The timeline and supply checks (#120) add to rule 2 only, never to rule 1. A check that failed, is blocked,
had not finished at the cutoff or has mock numbers is one condition ("The supply check failed, so it is not
assessed"): the cost assessment stands, and sending the ECR back would ask the engineer to fix Norn. Their
warn flags that say the check could not assess something are gaps with short fixed wording
(`stock_beyond_plan`, `cut_in_beyond_plan`, `beyond_published_slots`, `unreadable_peer`, `no_price`, a raw-material
share that is a default, an assumption not applied). Their warn flags that are results (`likely_late`,
`single_source`, `slot_contention`, `capacity_exceeded`) are findings: shown in the statement, never a
condition and never a reason to change the recommendation. ECR-0417's late cut-in and single source are
findings, so its outcome and its three conditions are unchanged. Both checks are read as of the statement's
own snapshot (above).
Never Reject (a human call). The system prompt states the rule, the job prompt tells the agent what it gives
for this ECR (the agent states the rule that fired in its judgment claim), and the publisher applies it again:
when the agent's recommendation differs or is missing, the PLM gets the rule's and the statement carries a note
saying what the agent wrote, and the publisher leaves a comment on the ECR in Norn (once per statement and
outcome) so Norn's page and the PLM agree. Every input is bound to the statement's own run: its `detail` and
cost lines, the s1 run its inputs name, and an extraction failure only if it had happened when the run
finished, so a later failure does not change an existing statement. Cost lines on an estimate or quote basis
with no amount, and `no_disposition`, are gaps although the check does not warn about them. It overrides rather than refusing the post because the publisher cannot talk to
the agent and a refusal needs a module republish; the post stays valid and the PLM is never inconsistent. A
statement that rests on no check run has nothing to derive from and keeps the agent's recommendation.
The fast-track tool (`request_fast_track_approval`) is described in the system prompt but not yet in
`allowedTools` (TODO in `dispatcher.ts`). `e2e.ts` now stops the publisher before it clears the PLM, because a
publisher still sweeping wrote the statement back after the clear.

## The publisher (`publisher.ts`, `format.ts`, `plm.ts`)

Writes the seven `impact_*` fields with the connector's `writeImpact()` and nothing else (a comment
only if `NORN_PUBLISH_COMMENT=1`). `impact_statement` is self-contained HTML (inline styles, a table
of headline numbers, a "Timeline and supply" section, drivers, assumptions, evidence tags) that reads
without opening Norn. The section holds the s3/s4 numbers (dates as ISO dates, weeks, serials, counts), the
agent's "Timeline:" and "Supply:" sentences, and a line for each check that is not available, written from
the run's state whatever the agent said. A statement with none of these (a Level 1 from before #120) has no section. Its last
line carries `Ref <statement id>.<digest>`.

Idempotent: before every write it reads the ECR's fields from the PLM. If the ref is there and the
plain fields match, nothing is written. A restart, a second publisher or a reset scratch database
therefore writes nothing twice. A person editing a plain field gets it put back. Mock numbers
(s3, s4 placeholders) never reach the PLM as a headline. `NORN_PUBLISH_ECRS=ECR-0417` limits it.

Which statement: of those for the current revision (written from a run of the current change-request
revision, or with no run and posted at the ECR's current `prRevision`), the highest level, then the newest. An earlier revision's statement is never published over the current one, and with
none for the current revision nothing is written. The text's provenance (revision, baseline, code
version, formulas) is read from the statement's own check run, never inferred from matching numbers.

Two publishers at once: read-then-write is not atomic and the PLM cannot refuse a second identical
write, so a write takes a lease first (`claim_publication` / `release_publication`, table
`publication_claim`, one row per ECR, 60 s so a dead holder cannot block it). The holder is the
caller's identity, taken by the module from the connection; only that identity (and process) can
renew or release, and only Norn's own agents (principal kind agent, origin norn) can claim, which is
as strong as the module's notion of "Norn" is (register_actor does not prove origin). Once it has the
lease the publisher picks the newest statement again and reads the PLM again, and writes only if that
statement is still newest and the PLM does not already show it. The PLM is read on every sweep: a
remembered "published" ref is not trusted. A publisher that loses the claim writes nothing and
finds the ref on its next 15 s sweep. A write that outlasts the lease could still race; none does today.

## The PLM ingest (`ingest-plm.ts`)

Lists the PLM's ECRs once and takes in every one in a wanted state (`NORN_PLM_STATES`, default
Submitted, In CM Review, CCB Review; `NORN_PLM_ECRS` limits it), one at a time: an ECR that cannot be read
or mapped (a `PlmMappingError`) is logged by name and skipped (the watcher delivers it again once it is fixed),
and the rest are still taken in. An ECR that fails for any other reason (network, timeout, 5xx, a failed
report) goes to a retry queue and is tried again every watch interval with a doubling wait (up to 60 s)
until it is taken in, because the watcher only reports ECRs changed after the first listing. Then it watches the PLM
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
statement-to-PLM formatting, publisher idempotency and the lease race, statement selection and
provenance, and (`timeline-supply.test.ts`) which s3/s4 runs a statement rests on, the bounded wait, the
rule's treatment of their flags on Bowman's real rows (ECR-0417, -0421, -0423), the job prompt and the PLM section. The module side (the recorded check run, the stale-run refusal, the lease) is in
`npm run check:module`, against a scratch database.
