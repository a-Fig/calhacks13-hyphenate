# Norn agent runner: notes

Written 2026-10-24 for issue #48, revised the same day after a fresh-context review. The runner
starts one Claude Code session per job through the Claude Agent SDK (TypeScript,
`@anthropic-ai/claude-agent-sdk` 0.3.310, which bundles Claude Code 2.1.310) and streams everything
the session does to an event sink. No Anthropic API key is used.

## Run it

Node 22.18 or newer. The `.ts` files run directly through Node's type stripping; `tsc` only
typechecks. Everything below is run from `norn/runner/`.

```
npm ci
npm run typecheck                      # tsc --noEmit
npm run test:unit                      # 61 tests, no model, no login
npm run smoke                          # live: about 20 Haiku sessions on the machine's Claude login
npm run smoke -- core                  #   one group: core, stop, safety
npm run smoke -- safety:inbound        #   or one part of safety: env, agents, inbound, web, read
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
| `mcpServers?` | stdio, http, sse (also from JSON files), or in-process `createSdkMcpServer` (code only). One in-process instance serves one job; make one per job |
| `allowedTools` | the role's whole tool list: `WebSearch`, `WebFetch`, `mcp__norn__*`, `mcp__norn__get_bom`. `[]` allows none. Rejected: a bare `*`, and a specifier on `Bash`, `PowerShell` or `Monitor` (it does not limit them: read-only commands like `cat` run without a prompt in every mode, so `Bash(git status)` would expose the whole shell) |
| `allowOverage?` | default false. When the subscription's included usage is used up and the account has paid overage on, the job is stopped instead of spending money |
| `identity` | `{ actor, onBehalfOf: string \| null, spawnedBy }`; `spawnedBy` is `norn` or the parent job id |

`WEB_TOOLS` in `src/config.ts` is the web pair for research roles.

## Events (`NornEvent`)

One JSON object per line in the JSONL sink. Every event has `seq` (0-based, in order per job),
`ts`, `jobId`, `role`, `identity`, `sessionId`, and `type`:

```json
{"seq":4,"ts":"2026-10-24T12:00:27.052Z","jobId":"smoke-l1","role":"level1-writeup","identity":{"actor":"agent:norn/level1/ECR-0417","onBehalfOf":"person:tyler","spawnedBy":"norn"},"sessionId":"…","type":"tool_call","toolUseId":"toolu_…","tool":"mcp__demo__lookup_part","input":{"part_id":"BRKT-100"},"parentToolUseId":null}
```

`job_queued` (Runner only), `job_started` (model, work dir, prompt, allowlist, and the names of the
environment variables the session received), `session_init` (tools the model was offered, MCP
server status, skills, plugins, `apiKeySource`), `assistant_text`, `tool_call`, `tool_result`,
`tool_abandoned` (a call still open when the job ended; what it did is unknown),
`permission_denied` (from the permission layer or, with `reasonType: 'hook'`, the WebFetch guard),
`user_message` (text that reached the model from outside the tool loop: another session, a
channel), `rate_limit` (with the paid-overage fields), `api_retry`, `sdk_notice` (any other SDK
message, so there are no silent gaps), `result` (the SDK's final result: usage, turns, denials),
`job_finished` (always last: status, typed error, whether the process had exited, its pid).

The sink is `(event) => void | Promise<void>`. The runner awaits it, so a slow sink slows the job
and cannot reorder it. A call may take `sinkTimeoutMs` (30 s); a sink that throws or hangs stops the
job with `error.kind = 'sink_failed'` rather than running it unlogged. `(jobId, seq)` is a natural
key for a table. Text fields are cut at 100,000 characters and flagged `truncated` (`textTruncated`
on `result`). Not logged: thinking text, thinking-token notices, repeats of an unchanged rate-limit
report.

## Results and failures

`JobResult.status` is `succeeded`, `failed`, `cancelled` or `timed_out`. A failure carries
`error: { kind, message, retryable, resetsAt }`. Kinds: `usage_limit`, `rate_limited`,
`overloaded`, `auth`, `account`, `model_unavailable`, `max_turns`, `timeout`, `session_error`,
`process_error`, `sink_failed`. `usage_limit` is separate on purpose: it is retryable only after
`resetsAt`, and it will happen because the team's build agents share the subscription. It also
labels a job stopped to avoid paid overage (the message says so). Classification looks only at
error text and error fields, never at what the agent wrote, and a limit the session got past on
overage is not blamed for a later, unrelated failure. `JobResult.usedOverage` says whether any part
of the session ran on paid overage. `runJob` always settles: after a stop it waits `stopGraceMs`
(15 s) for its own loop, then returns without it, which frees the Runner slot.

## Auth

- **Laptop (now).** The session uses the login Claude Code already has here (honours
  `CLAUDE_CONFIG_DIR`). `session_init.apiKeySource` is `none`.
- **Home server (later).** Tyler runs `claude setup-token` himself and sets
  `CLAUDE_CODE_OAUTH_TOKEN` in the runner's service environment. The runner never reads or prints
  it. It passes it to the Claude Code process and to nothing that process starts (see below). The
  token is inference-only, so claude.ai connectors can't load with it either.
- **Do not add `--bare`** (or `CLAUDE_CODE_SIMPLE`) to get isolation. Bare mode does not read
  `CLAUDE_CODE_OAUTH_TOKEN` (code.claude.com/docs/en/authentication). `settingSources: []` plus the
  switches below give the same isolation without it.
- Anthropic does not let a shipped product offer claude.ai login (`docs/PLAN.md` §4). This is for
  the demo on Tyler's account.

## Isolation and permissions (`src/session.ts`, `src/hooks.ts`)

**Environment.** The Claude Code process gets an allowlist, not the runner's environment: PATH and
the Windows or POSIX system and home variables, temp, proxy and certificate settings,
`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, and the runner's switches. Provider keys, cloud
credentials, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `NODE_OPTIONS` and parent-session
variables never reach it. The walk is over names, so a dropped variable's value is never read, and
`job_started.envNames` records names only. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials
from what Claude Code starts, and `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1` starts stdio MCP servers with a
safe baseline plus the `env` their own spec names.

| Setting | Why |
|---|---|
| `settingSources: []` | no user, project or local settings, CLAUDE.md, rules, hooks |
| `skills: []`, `plugins: []`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` | omitting `skills` is not "off" (SDK reference) |
| `strictMcpConfig`, `ENABLE_CLAUDEAI_MCP_SERVERS=false` | claude.ai connectors (Gmail, Drive) load on a claude.ai login otherwise |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | auto memory loads whatever `settingSources` says |
| inline `settings` (the `--settings` layer): `crossSessionInbound: 'refuse'`, `permissions.deny: [SendMessage, ListAgents]` | other local sessions can post to a `claude -p` session's inbox socket, and with no value set a `dontAsk` session accepts them |
| `permissions.blockReadsOutsideWorkingDirectories` | the file tools and read-only commands like `cat` otherwise read anywhere on disk without a prompt |
| `pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles = 'claude-md'` | no AGENTS.md is read. Not `managed-only`: it also loads auto memory at launch |
| `persistSession: false` | nothing written under the Claude config directory |
| empty work directory per job under `<tmp>/norn-runner/`, removed afterwards | |
| `tools: [built-ins on the allowlist]` | other built-ins are not in the model's context |
| `allowedTools`, `permissionMode: 'dontAsk'`, `permissionPrompts: 'none'` | listed tools run; anything else that reaches the check is denied, never asked |
| `PreToolUse` hook on WebFetch (`src/fetch-guard.ts`) | refuses loopback, private, link-local and Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48) addresses after DNS resolution, and local names; fails closed. Claude Code itself refuses only `localhost` and dotless names |
| `UserPromptSubmit` hook | records any prompt after the job's own (an inbound message) as a `user_message` before the model sees it; blocks it if the record cannot be written |
| `spawnClaudeCodeProcess` (`src/process.ts`) | the runner holds the process handle: it waits for exit, kills the process tree after `processExitMs` (10 s), and has an exit hook as the last resort |
| overage | a `rate_limit` report with `isUsingOverage`/`overageInUse`, or `rejected` with `overageStatus: 'allowed'`, stops the job unless `allowOverage` |

Attaching an MCP server makes all its tools visible to the model; the ones not on the allowlist are
denied when called. Attach only servers you mean to. When a job stops, its in-process MCP servers
are closed, which aborts `extra.signal` of any handler still running; Norn's tool handlers should
honour it. A call still open gets a `tool_abandoned` event, because what it did is not known.

## Verified on 2026-10-24 (laptop login, `claude-haiku-5-5`)

First round, `npm run smoke`, 19 of 19. Second round after the review fixes: one full
`npm run smoke` (33 of 35; the two failures were a control that the new AGENTS.md setting had
blinded, and the `managed-only` value switching auto memory back on, both fixed), then `core` and
`safety:agents` again, 20 of 20. `stop`, `safety:env`, `inbound`, `web` and `read` last ran in the
full run, on code that differs from the final commit only in that setting's value. `tsc --noEmit`
is clean and 61 unit tests pass.

1. **Allowed tool call is logged with identity.** Ran once; its call and result are in the log; the
   result reached the model; every event carries job id and identity, `seq` 0..n. A normal run
   logs no `user_message`.
2. **Disallowed tools are refused.** Bash is not offered. A tool attached but not allowed was
   attempted, denied without asking, and its handler never ran. With Bash made visible on purpose
   it is denied and the file it would have written does not exist.
3. **No personal configuration.** No personal skills or plugins (settings on lists 50 namespaced
   skills). A canary CLAUDE.md above the job directory is not seen (a control repeats it back).
   Auto memory: a real note is found with the switch left on and not found as the runner sets it.
4. **Concurrency.** Two jobs through `Runner` (limit 2) overlapped for 5 seconds.
5. **Environment.** A stdio MCP server started by a job reports the names it received: its own two
   spec variables and none of the planted ones (provider keys, a fake OAuth token, `NODE_OPTIONS`,
   a base URL, Bedrock switches). With the MCP layer switched off the planted names still don't
   appear, so the runner-level allowlist holds by itself. (Init only, no model call.)
6. **Inbound messages.** A message posted to a session's own inbox while it was stuck in a tool
   call: with no `crossSessionInbound` set the agent acts on it (its answer contains the canary)
   and the text is in the log before the model saw it; as the runner sets it, it never arrives and
   nothing steers the agent.
7. **AGENTS.md.** With the plugin at its default and project settings on, a canary AGENTS.md above
   the job directory is read; with the runner's setting it is not; as the runner runs it (no
   project settings) it is not read either.
8. **WebFetch.** To a local HTTP server: without the guard Claude Code connects; with it the call is
   refused, logged as a hook denial, and nothing connects. A Read of a file outside the work
   directory is refused.
9. **Stop.** A timeout and a `cancel()` each stop a session stuck in a tool call; the call gets a
   `tool_abandoned` event before `job_finished`; the in-process handler's signal fires; the process
   has exited (checked by pid) every time.
10. Also: WebFetch for a research role, the CLI on a job file, a stdio MCP server attaching,
   a fake OAuth token failing as `auth`, a bad model as `model_unavailable`.

Usage: the first round used 23 Haiku sessions and about 40 turns. The review round used 47 sessions that
reached the model (plus 5 stopped at start-up) and about 70 turns: three development runs of the new
checks, the full run, and the partial rerun.

## Found along the way

- **Aborting the controller does not stop a session.** It interrupts the tool call in flight; the
  model then reads "interrupted" and carries on. The runner closes the query, which ends the
  process, and ignores messages after the stop.
- **The SDK stream does not carry the text of an inbound message.** It shows a `command_lifecycle`
  frame while the model acts on the text. The `UserPromptSubmit` hook does see it.
- **`instructionFiles: 'managed-only'` turned auto memory back on** despite
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Use `claude-md`.
- **AGENTS.md was not readable in the runner's sessions even before the plugin setting**: it is read
  only when project settings are on, and `CLAUDE_CODE_DISABLE_CLAUDE_MDS` also stops it. The setting
  is a third lock, and the canary shows it works alone.
- **On Windows the temp directory is under the user's home**, and `<home>/.claude/CLAUDE.md` counts
  as a project-level CLAUDE.md for any directory below the home (Claude Code then skips AGENTS.md).
  A session with project settings on would pick up the user's own CLAUDE.md that way. The runner
  doesn't have project settings on.
- WebFetch upgrades `http://` to `https://`, so a plain-HTTP local service fails with a TLS error
  after the connection is made; an HTTPS one would be served.
- `skills: []` does not remove the CLI's bundled skills; an environment variable does.
- With Bash visible, `dontAsk` still runs read-only commands like `echo`.

## Not verified

- The real `~/.claude/CLAUDE.md`: this machine's config directory is a different one with no
  CLAUDE.md, and the other directory's login is a different identity, so I did not switch to it.
  The canary, skills/plugins and memory checks cover the same loading paths.
- A real usage limit or paid overage. The CLI's wording is matched loosely; auth and model error
  shapes were captured live. The `rate_limit` event with `overageStatus` was seen (`rejected`,
  `org_level_disabled` on this account); the `rejected` + `allowed` case is tested on canned
  messages only.
- DNS rebinding: the guard and Claude Code's own fetch each resolve the name. Network rules on the
  server are the second layer.
- `claude-sonnet-5-5` (the default) in a live session; a valid `CLAUDE_CODE_OAUTH_TOKEN`; Linux
  (the POSIX kill path and `detached` are untested); `WebSearch`; an http/sse MCP server; more
  than 2 live sessions at once.
- Steering a running session (a message mid-run from the runner). The job is one prompt for now;
  `Query.streamInput` is the SDK's route if it is wanted.

## Design calls

- Events come from the SDK's message stream, not hooks, because hook callbacks run out of band. Two
  exceptions where the stream has a gap: hook denials (the SDK doesn't report them) and inbound
  prompts (it doesn't carry their text). Both are noted by the runner and logged in order.
- Two layers on tools: the model is offered only the allowlist, and `dontAsk` backs that up.
- `systemPrompt` replaces the SDK's minimal prompt instead of using the `claude_code` preset: no
  coding-agent instructions or environment block, fewer tokens. Switching is one line.
- Spec errors throw (`JobSpecError`); anything a session can do resolves as a `JobResult`.
- `estimatedCostUsd` is the SDK's figure; a subscription is not billed per token, so quota is in
  `usage`.
- No build step; if another package needs compiled JS, add `tsc` emit.
- Norn's MCP server should still write its own record of what it did. This log also holds what it
  never sees (denied calls, web fetches).
