# Norn agent runner: notes

Written 2026-10-24 for issue #48. The runner starts one Claude Code session per job through the
Claude Agent SDK (TypeScript, `@anthropic-ai/claude-agent-sdk` 0.3.310, which bundles Claude Code
2.1.310) and streams everything the session does to an event sink. No Anthropic API key is used.

## Run it

Node 22.18 or newer. The `.ts` files run directly through Node's type stripping; `tsc` only
typechecks. Everything below is run from `norn/runner/`.

```
npm ci
npm run typecheck                      # tsc --noEmit
npm run test:unit                      # 32 tests, no model, no login
npm run smoke                          # live: 6 to 8 Haiku sessions on the machine's Claude login
npm run smoke -- core                  #   or just "core" (6 sessions) / "stop" (2 sessions)
npm run job -- examples/job.example.json --model claude-haiku-5-5 --log logs/x.jsonl
```

`smoke` also takes `SMOKE_MEMORY_CWD` (a directory that has auto memory) and `SMOKE_MEMORY_PHRASE`
(words from a note title there) to add the auto-memory pair; without them it prints SKIP.

From code:

```ts
import { Runner, jsonlFileSink } from './src/index.ts';
const runner = new Runner({ sink: jsonlFileSink('logs/run.jsonl'), config: { concurrency: 2 } });
const job = runner.submit(spec);   // throws JobSpecError at once for a bad spec
const result = await job.result;   // JobResult; never rejects. job.cancel() stops it.
```

CLI exit codes: 0 all succeeded, 1 a job failed, 2 usage limit, 3 timed out, 4 cancelled, 64 bad
input. Several job files run together under `--concurrency` (default 2).

## Job spec (`src/types.ts`)

| Field | |
|---|---|
| `id`, `role`, `prompt` | `id` is unique among live jobs and names the work directory and log lines |
| `systemPrompt?` | role instructions; replaces the SDK's minimal default prompt |
| `model?`, `effort?` | model: spec, else `config.roleModels[role]`, else `claude-sonnet-5-5` |
| `maxTurns?`, `timeoutMs?` | defaults 25 turns, 10 minutes |
| `mcpServers?` | stdio, http, sse (also from JSON files), or in-process `createSdkMcpServer` (code only) |
| `allowedTools` | the role's whole tool list: `WebSearch`, `WebFetch`, `mcp__norn__*`, `mcp__norn__get_bom`. `[]` allows none. A bare `*` is rejected |
| `identity` | `{ actor, onBehalfOf: string \| null, spawnedBy }`; `spawnedBy` is `norn` or the parent job id |

`WEB_TOOLS` in `src/config.ts` is the web pair for research roles.

## Events (`NornEvent`)

One JSON object per line in the JSONL sink. Every event has `seq` (0-based, in order per job),
`ts`, `jobId`, `role`, `identity`, `sessionId`, and `type`:

```json
{"seq":4,"ts":"2026-10-24T12:00:27.052Z","jobId":"smoke-l1","role":"level1-writeup","identity":{"actor":"agent:norn/level1/ECR-0417","onBehalfOf":"person:tyler","spawnedBy":"norn"},"sessionId":"…","type":"tool_call","toolUseId":"toolu_…","tool":"mcp__demo__lookup_part","input":{"part_id":"BRKT-100"},"parentToolUseId":null}
```

`job_queued` (Runner only), `job_started` (model, work dir, prompt, allowlist), `session_init`
(tools the model was offered, MCP server status, skills, plugins, `apiKeySource`), `assistant_text`,
`tool_call`, `tool_result` (`isError`, content), `permission_denied`, `rate_limit`, `api_retry`,
`sdk_notice` (any other SDK message, so there are no silent gaps), `result` (the SDK's final
result: usage, turns, denials), `job_finished` (always last: status and typed error).

The sink is `(event) => void | Promise<void>`. The runner awaits it, so a slow sink slows the job
and cannot reorder it. If it throws, the job is stopped with `error.kind = 'sink_failed'` rather
than run unlogged. `(jobId, seq)` is a natural key for a table. Text fields are cut at 100,000
characters and flagged `truncated`. Not logged: thinking text, thinking-token notices, and repeats
of an unchanged rate-limit report.

## Results and failures

`JobResult.status` is `succeeded`, `failed`, `cancelled` or `timed_out`. A failure carries
`error: { kind, message, retryable, resetsAt }`. Kinds: `usage_limit`, `rate_limited`,
`overloaded`, `auth`, `account`, `model_unavailable`, `max_turns`, `timeout`, `session_error`,
`process_error`, `sink_failed`. `usage_limit` is separate from the others on purpose: it is
retryable only after `resetsAt`, and it will happen because the team's build agents share the
subscription. Classification looks only at error text and error fields, never at what the agent
wrote.

## Auth

- **Laptop (now).** The session uses the login Claude Code already has here (honours
  `CLAUDE_CONFIG_DIR`). `session_init.apiKeySource` is `none`.
- **Home server (later).** Tyler runs `claude setup-token` himself and sets
  `CLAUDE_CODE_OAUTH_TOKEN` in the runner's service environment. The runner never reads or prints
  it; each session's environment is the runner's own, passed on unchanged. The token is
  inference-only, so claude.ai connectors can't load with it either.
- **Do not add `--bare`** (or `CLAUDE_CODE_SIMPLE`) to get isolation. Bare mode does not read
  `CLAUDE_CODE_OAUTH_TOKEN` (code.claude.com/docs/en/authentication). `settingSources: []` plus the
  environment switches below give the same isolation without it.
- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are dropped from every session's environment by
  name (their values are never read). Left in, they would override the subscription.
- Anthropic does not let a shipped product offer claude.ai login (`docs/PLAN.md` §4). This is for
  the demo on Tyler's account.

## Isolation and permissions (`src/session.ts`)

| Setting | Why |
|---|---|
| `settingSources: []` | no user, project or local settings, CLAUDE.md, rules, hooks |
| `skills: []`, `plugins: []`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` | omitting `skills` is not "off" (SDK reference) |
| `strictMcpConfig`, `ENABLE_CLAUDEAI_MCP_SERVERS=false` | claude.ai connectors (Gmail, Drive) load on a claude.ai login otherwise |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | auto memory loads whatever `settingSources` says |
| parent-session variables dropped (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_*`, ...) | present when the runner is started from inside a Claude Code session |
| `persistSession: false` | nothing written under the Claude config directory |
| empty work directory per job under `<tmp>/norn-runner/`, removed afterwards | |
| `tools: [built-ins on the allowlist]` | other built-ins are not in the model's context |
| `allowedTools`, `permissionMode: 'dontAsk'`, `permissionPrompts: 'none'` | listed tools run; anything else that reaches the check is denied, never asked |

Attaching an MCP server makes all its tools visible to the model; the ones not on the allowlist are
denied when called. Attach only servers you mean to.

## Verified on 2026-10-24 (laptop login, `claude-haiku-5-5`, `npm run smoke`, 19 of 19 checks)

1. **Allowed tool call is logged with identity.** `lookup_part` on an in-process MCP server ran
   once; its call and result are in the log; the cost it returned (random per run) came back in the
   agent's answer; every event carries job id and identity, with `seq` 0..n.
2. **Disallowed tools are refused.** (a) Bash is not offered. (b) `purge_part`, attached but not
   allowed, was attempted, denied without asking, and its handler never ran. (c) With Bash made
   visible on purpose, it is denied and the file it would have written does not exist.
3. **No personal configuration.** The isolated session lists no personal skills or plugins
   (the same login with settings on lists 50 namespaced skills). A canary CLAUDE.md in the directory above the
   job's is not seen (a control with settings on repeats it back). Auto memory: a note title is
   found with the switch left on and not found as the runner sets it.
4. **Concurrency.** Two jobs through `Runner` (limit 2) overlapped for 5.3 seconds.
5. Also: WebFetch works for a research role; a timeout and a `cancel()` each stop a session stuck in
   a tool call, the process exits (the work directory can be removed) and `job_finished` is last;
   the CLI ran a job file end to end; a stdio MCP server attaches (init only, no model call);
   a deliberately invalid `CLAUDE_CODE_OAUTH_TOKEN` fails as `auth` and a bad model as
   `model_unavailable`, with the real CLI messages. `tsc --noEmit` is clean and 32 unit tests pass.

Usage while building: 23 Haiku sessions that reached the model and about 40 agent turns, over five
smoke invocations and one CLI run (two invocations were reruns after a fix). Plus two sessions that
failed before any model call (bad token, bad model) and a few init-only probes.

## Found along the way

- **Aborting the controller does not stop a session.** It interrupts the tool call in flight; the
  model then reads "interrupted" and carries on, spending usage. The runner calls `close()` on the
  query, which ends the process, and ignores messages after the stop.
- `skills: []` does not remove the CLI's bundled skills; an environment variable does.
- The SDK's `env` replaces the environment, and a runner started inside Claude Code would pass its
  parent's session variables on.
- With Bash visible, `dontAsk` still runs read-only commands like `echo`; the test uses a redirect.

## Not verified

- The real `~/.claude/CLAUDE.md`: this machine's config directory is a different one with no
  CLAUDE.md, and the other directory's login is a different identity, so I did not switch to it.
  The canary, skills/plugins and memory checks cover the same loading paths.
- A real usage limit. The CLI's wording is matched loosely; the error shapes for auth and model were
  captured live and are in the unit tests, the limit shape is assumed to match.
- `claude-sonnet-5-5` (the default) in a live session; a valid `CLAUDE_CODE_OAUTH_TOKEN`; Linux;
  `WebSearch`; an http/sse MCP server; more than 2 live sessions at once.
- Steering a running session (sending it a message mid-run). The job is one prompt for now;
  `Query.streamInput` is the SDK's route if it is wanted.

## Design calls

- Events come from the SDK's message stream, not hooks: hook callbacks run out of band and could
  land out of order against the stream. Norn's MCP server should still write its own record of what
  it did; this log also holds what it never sees (denied calls, web fetches).
- Two layers on tools: the model is offered only the allowlist, and `dontAsk` backs that up.
- `systemPrompt` replaces the SDK's minimal prompt instead of using the `claude_code` preset: no
  coding-agent instructions or environment block, fewer tokens. Switching is one line.
- Spec errors throw (`JobSpecError`); anything a session can do resolves as a `JobResult`.
- `estimatedCostUsd` is the SDK's figure; a subscription is not billed per token, so quota is in
  `usage`.
- Added to the requested spec: `systemPrompt` and `effort`.
- No build step; if another package needs compiled JS, add `tsc` emit.
