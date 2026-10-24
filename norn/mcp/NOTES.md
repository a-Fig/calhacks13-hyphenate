# Norn's MCP server: notes

Written 2026-10-24 for issue #56, revised the same day after the review of PR #64. `norn/mcp/` is the
one set of tools every agent works through. Norn's own agents are Claude Code sessions the runner
starts (`norn/runner`), and they get the tools through the job's `mcpServers`. A person's own agent
(Claude Code on an engineer's laptop) connects to the same server with a credential and acts for that
person; that is M5 and only its shape is built. Every write goes through the module's reducers, so
through its policy gate and its action log, with the actor, the person it acted for and what spawned it.

Norn never writes to the ERP (Tyler, issues #71 and #72), not even drafts. Nothing here offers an ERP
write, and the seam in `src/erp.ts` is for reads only.

## Run it

Node 22.18 or newer. SpacetimeDB must be running (`npm run db:start` in `norn/`).

```
npm run key:ensure -w @norn/mcp       # once: adds NORN_MCP_SIGNING_KEY to the root .env of the main checkout (appends, prints no key)
npm run start -w @norn/mcp            # serves http://127.0.0.1:3917/mcp for the database "norn"
NORN_DB=norn-mcp npm run start -w @norn/mcp      # or for another database
npm run typecheck -w @norn/mcp
npm run test:unit -w @norn/mcp        # 15 tests: tokens, strict signatures, levels, nornMcpFor and its helper, the key and mint scripts, Windows ACLs. No database, no model
npm run check:gate -w @norn/mcp       # 69 checks through real HTTP and MCP against the database norn-mcp. No model
npm run e2e -w @norn/mcp              # one real Haiku session through the runner (uses the laptop's Claude login)
npm run e2e -w @norn/mcp -- --statement    # and a second session that posts a Level 1 statement
npm run probe:argv -w @norn/mcp       # two short Haiku sessions: is the token on the claude command line?
npm run token:person -w @norn/mcp -- --person jeff --label laptop --ecr BWM-ECR-0417
```

Environment: `NORN_URI` (default `ws://127.0.0.1:3000`), `NORN_DB` (`norn`), `NORN_MCP_PORT` (`3917`),
`NORN_MCP_URL` (what `nornMcpFor` puts in a job; default the loopback URL), `NORN_MCP_STATE_DIR`
(`norn/mcp/.state`, untracked), `NORN_ENV_FILE` (a `.env` to use instead of the main checkout's).

`check:gate`, `e2e` and `probe:argv` use the separate database `norn-mcp`. The first two rebuild it from
the real module (`spacetime publish norn-mcp --no-config ... --delete-data=always`; the name is a
literal in `test/kit.ts`), seed it with `workers/src/seed.ts`, and run the skeleton's mock worker
against it. They never touch `norn` or `norn-test`. The seeded ECRs have no change request, so their
check results are the mock worker's, labelled `mock: true`; an ECR the PLM ingests with a change
request gets the real checks library's results instead (`workers/README.md`).

## What a job builder does

```ts
import { nornMcpFor, nornTools, NORN_MCP_SERVER_NAME } from '@norn/mcp';

const id = `level1-${Date.now().toString(36)}`;
const identity = { actor: `agent:norn/level1/BWM-ECR-0417/${id}`, onBehalfOf: null, spawnedBy: 'norn' };
const spec: JobSpec = {
  id, role: 'level1-writeup', prompt, identity,
  mcpServers: { [NORN_MCP_SERVER_NAME]: nornMcpFor(identity, { jobId: id, role: 'level1-writeup', ecrs: ['BWM-ECR-0417'] }) },
  allowedTools: nornTools('read', 'post_impact_statement'),      // mcp__norn__get_ecr, ...
};
```

- **Put the job id in the actor name.** An actor can be held by one live job at a time, so a rerun of a
  job under the same actor name inside its token's life (a second demo rehearsal) is refused with HTTP
  409. One name per job avoids that. It also means one SpacetimeDB identity per job (files under
  `.state/identities/`).
- **The token stays off the command line.** The Agent SDK passes MCP server configs to the `claude`
  process as `--mcp-config <json>`, so a token in `headers` is on argv, which on Linux any local user
  can read through `/proc/<pid>/cmdline`. `npm run probe:argv` ran two Haiku sessions on 2026-10-24 and
  read the live process: with `headers` the token was on the command line; with `headersHelper` it was
  not, and the tool call worked. So `nornMcpFor` returns `{ type: 'http', url, headersHelper: 'node
  headers-helper.mjs <token file>' }` by default: Claude Code runs the helper, which prints the
  `Authorization` header from a file in a private directory (`.state/job-tokens/`; files older than a
  day are removed). `delivery: 'header'` gives `{ type: 'http', url, headers: { Authorization } }` for
  other MCP clients and tests. The runner's own environment allowlist keeps `PATH`, so `node` is found.
  `headersHelper` is not in the SDK's `McpHttpServerConfig` type; the SDK passes it through and Claude
  Code honours it (checked on the CLI bundled with `@anthropic-ai/claude-agent-sdk` 0.3.310).
- The token is minted for that job (default 30 minutes, at most 6 hours) from the identity you pass, so
  build the runner's `identity` and the token from the same object. `ecrs` are full PLM numbers.
- The runner's `allowedTools` is the second lock: the server offers all nine tools, and the runner
  denies the ones a role does not list.
- **Roles decide the highest statement level a job may post** (see below): `level1-writeup` posts
  Level 1, `level2-...` Level 2, `level3-...` Level 3; any other role posts none (it can still comment
  and propose assumptions).

## Tools

Every answer says its evidence class (`docs/GLOSSARY.md`: fact, assumption, computation, judgment).
Reads answer from a live mirror of the database and are open to any valid token. A write names an
ECR by its PLM number (a unique tail such as `ECR-0417` works too) and never names who is acting.

| Tool | Does | Evidence class of what it returns |
|---|---|---|
| `list_ecrs` | ECRs: number, title, status, revision, impact state, statement levels posted | fact |
| `get_ecr` | text, status, revision, base version, affected parts, impact state, newest statement of each level (with who posted it, for whom, as recorded then) | fact; affected parts are matched from the text and check details, so can be incomplete |
| `get_impact` | latest check results by stage: p10/p50/p90, unit, trace, the assumptions each run read with their sources, and `readOf`: the base version, code version, seed, the change request's source and revision, and the ERP baseline's hash, source (`erp`, or `file` for a stand-in) and as-of date. `state`: `no_results`, `partial`, `current` or `stale`, with a hint. `mock` flagged. `key` returns one result's full trace | computation |
| `get_part` | one part, and the ECRs whose text names it | fact (as held in Norn; ERP not wired in) |
| `list_assumptions` | baseline plus the ECR's own, each with value, source, rationale, revision, who set it and for whom | `given` is fact; `default` and `agent_estimated` are assumptions |
| `get_ecr_history` | comments and actions, oldest first: who, for whom, spawned by, outcome; a refusal shows as `denied` (the policy gate) or `rejected` (the write was invalid) with its reason | fact |
| `add_comment` | a comment under the agent's own name | writes |
| `propose_assumption` | a number or triangular range with rationale and sources, recorded as `agent_estimated`; the ECR's checks re-run on it | writes |
| `post_impact_statement` | Level 1 to 3: class, route, headline, numbers (p10/p50/p90), drivers, assumptions, claims, each with an evidence class | writes |

`post_impact_statement` keeps the agent from forging a number: a number with evidence `computation`
names a `resultKey` from `get_impact` and the server copies its digits, label and unit from that
result (what the agent typed for them is ignored), and the module re-checks that key, label, unit and
digits equal a current `check_result`. An assumption's source is filled in from Norn's record, and the
module refuses a relabelled one. Other numbers carry their own p10/p50/p90 and are `judgment` or
`assumption`. An agent cannot label anything `fact`: the tool does not offer it and the gate refuses
it, because a fact is read from a source Norn can check and an agent's say-so is not one.

## Tokens

```
nmt1.<base64url(claims JSON)>.<base64url(HMAC-SHA256(NORN_MCP_SIGNING_KEY, "nmt1." + payload))>
```

| Claim | |
|---|---|
| `kind` | `job` (minted per runner job) or `person_agent` (a person's own agent) |
| `jobId` | the job, or an id for the credential; names the scope grant |
| `role` | what the agent is for; a `job` role of `level<N>-...` allows statements up to Level N |
| `actor` | the principal's name in Norn, e.g. `agent:norn/level1/BWM-ECR-0417/<jobId>`; up to 64 of `A-Za-z0-9:_./@+-` |
| `onBehalfOf` | the person it acts for; `null` when Norn acts on its own; required for `person_agent` |
| `spawnedBy` | `norn`, a parent job id, or for a person's agent the person; goes into `meta.spawnedBy` of every write |
| `ecrs` | PLM numbers it may write to; `["*"]` (any ECR, never the baseline) is for `person_agent` only |
| `iat`, `exp` | seconds; a job token lives at most 6 hours, a person's at most 30 days |

The server checks the token before anything else, on every request: the shape (three parts, base64url
with no padding or stray characters, a signature of exactly 43 characters), the signature (constant
time, compared as the canonical string, so an edited or re-padded copy does not verify), the claims
(known fields only, the character set above), then `exp` and `iat`. The tools take no identity
argument, so the only identity an agent can have is the one in its token. The key lives only in the
process environment and the root `.env`; no log line, error or file written by this package contains
it or a token (`check:gate` searches the action log for it, and `e2e` searches the runner's JSONL for
the token and the key).

`scripts/mint-person-token.ts` writes a person agent's token to a file in a private directory, not to
the screen, and prints the `claude mcp add --transport http ...` line that reads it. The actor is
`agent:<person>/<label>`, registered as an outside agent (`origin: external`) for `person:<person>`.
It names the ECRs it may write to, or `--all-ecrs`. The job id is stable for a person and label, so
minting again refreshes the same grant instead of being refused as a second job; a wider ECR list than
a live grant allows needs the old token to expire, or a new `--label`. Nothing can revoke a token before
it expires except changing the key.

## How an identity becomes a principal, and how a refusal is made

1. The request carries a token. The server verifies it and builds a fresh MCP server for that
   request, bound to the token's claims (stateless: no session to hijack).
2. `Norn.actorFor(claims)` returns that actor's own SpacetimeDB connection, cached by kind and actor
   name. Its identity token is kept in `.state/identities/` so a restart keeps the identity. It calls
   `register_actor` (kind `agent`, origin `norn` for a job or `external` for a person's agent,
   `onBehalfOf` from the token) and then `grant_scope`.
3. `grant_scope` writes an `actor_scope` row for that identity: the job id, the ECRs (or any ECR), the
   highest statement level (`maxLevel`: from the role for a job, 2 for a person's agent) and an expiry.
   The module's `authorize()` reads it, and the rule in `module/src/scope.ts` runs on every write. A
   scoped actor may only comment, record `agent_estimated` assumptions and post statements:
   - only on ECRs in its scope, never on the baseline;
   - never replacing a `given` assumption (on the ECR or inherited from the baseline);
   - never changing an assumption of an `approved` ECR, because any assumption change re-checks the ECR
     and takes its approval back to review (comment instead);
   - statements up to its `maxLevel` only: a `level1-writeup` job posts Level 1, a person's own agent
     never Level 3 ("Norn's final verdict"), a job whose role posts none, none;
   - no number, driver or claim labelled `fact`.
4. A write outside that is refused by the module itself: the reducer returns normally, and the
   `action_log` row has outcome `denied`, the reason, the actor, `onBehalfOf`, `spawnedBy` and the ECR
   attempted. The tool finds that row by request id and answers `Refused by Norn's policy gate:
   <reason>. ... Do not retry`. The tool does not pre-check scope; the gate owns the decision.
5. A write that is allowed but invalid (a forged computation number, a closed ECR, a revision conflict)
   is a `Refusal`. For a job-scoped agent it also returns normally and leaves a row with outcome
   `rejected` and the reason; any other caller (workers, the UI) still gets a `SenderError`, as before.
   `Refusal` is thrown only before the reducer has written anything.
6. While a job holds an actor, `register_actor` cannot change that actor's name or on-behalf-of, and
   `grant_scope` cannot give it to another job or widen it (HTTP 409). A refused second job therefore
   leaves the first job's principal as it was (a `denied` row, not an `applied` one). After the grant
   expires a new job may take the actor over. Because the principal can then change, history and
   statements show the actor, on-behalf-of and spawned-by recorded in the action log when each thing
   was done, not the live principal row.

Allowed writes log the reason too: `allow (job scope: job <id> may write to <ECR>)`.

## Module changes (`norn/module`, `norn/bindings` and `norn/module-test/bindings` regenerated)

- **`actor_scope`** table and **`grant_scope`** reducer (above). `Actor` gained an optional `scope`.
- **`scope.ts`**: the rule, registered into `POLICY_RULES` by a side-effect import from
  `reducers.ts`, so the test module has it too. #43 will rewrite the gate's rules around Bowman's
  configuration; this rule is about the credential and should survive that.
- **`authorize()`** returns the reason of the first rule that explicitly allowed (it used to ignore
  it); with no such rule it still says `allow (no rules yet)`, which `check:policy` expects.
- **`Refusal`** (core.ts) and the **`rejected`** outcome of `action_log`: see step 5. `record_assumption`
  (frozen ECR, revision conflict, bad source or JSON) and `post_impact_statement` (every validation)
  throw it.
- **`impact_statement`** table and **`post_impact_statement`** reducer. Typed columns (class, route,
  headline, and arrays of numbers, drivers, assumptions and claims, each with an evidence class)
  rather than a JSON blob or a `comment`, so the UI can render them without parsing and the module
  can validate them. Append-only; the reader takes the newest of each level. `prRevision` is the
  ECR's revision when it was written, so a statement shows as out of date once the ECR moves on.
  Refused: a level outside 1 to 3, p10 > p50 > p90 ordering, a `computation` number whose key, label,
  unit or digits are not a current check result, an assumption the ECR does not see or whose source is
  relabelled, and an ECR that is not open.
- Messages that an agent reads name ECRs by PLM number, not internal id.

Nothing in the tables or reducers that existed before this work changed shape (`actor_scope`,
`impact_statement` and `grant_scope` are new, as are the `rejected` value and `maxLevel`), so the `norn`
database can take a plain `db:publish`; this branch did not publish it.

## What is tested

| What | How | Result |
|---|---|---|
| Tokens (strict signature and claims, expiry, kinds), `nornMcpFor` in both deliveries and the helper script, `maxLevelFor`, `.env` parsing, the key and mint scripts, connect-error text, the Windows ACL of the state directory | `test:unit` | 15 of 15 |
| The edge: no token, wrong key, expired, edited payload, wrong host name, GET, unknown ECR in a token | `check:gate` | pass |
| All nine tools through real HTTP and the MCP client; the comment's author, the action-log fields, the allow reason | `check:gate` | pass |
| A write to another ECR is refused by the module and logged (`denied`, reason, actor, for whom); a tool answer, not a crash; nothing written | `check:gate`, `e2e` | pass |
| Reducers outside the scoped set, baseline writes, a scope widened by its holder, a grant that has run out, an agent replacing a `given` assumption | `check:gate` | pass |
| Review findings: approval withdrawal (#1), relabelled computation numbers in the tool and the module (#2), level caps for a level1 job, a person's agent and a role with none (#3), a refused second job leaving the principal alone and history keeping the on-behalf-of recorded at the time (#4), `fact` (#5), `rejected` rows for a forged number, a revision conflict and a closed ECR, and no such row for an unscoped caller (#6), plain-text ECR numbers in refusals (#11), the helper form of the entry (#10) | `check:gate`, one or more checks each | pass |
| A person's agent token (`*`, external origin, on-behalf-of) | `check:gate` | pass |
| A real Haiku session through the runner with only Norn's tools, token delivered through the headers helper: reads ECR-0417 and its impact, posts one comment, tries one write to ECR-0418 | `e2e` | pass: 9.4 s, 5 turns; the agent made the refused attempt itself |
| A second Haiku session that posts a Level 1 statement with two `computation` numbers and two assumptions | `e2e -- --statement` | pass: 11.4 s, 5 turns; every computation number equals its check result |
| Token on the `claude` command line, `headers` vs `headersHelper` | `probe:argv` (two Haiku sessions) | on argv with `headers`, not with the helper; both connected and answered |
| `npm run typecheck` (all workspaces), the runner's typecheck and 61 unit tests | local | pass |
| `check:module` (48) and `check:policy` (6) | on a scratch copy of the test module (`norn-mcp-test`), not `norn-test` | pass |

## Found along the way

- **A Haiku agent wrote `resultKey: "s2_cost.unit_cost_delta"`** (stage and key joined) on its first
  statement call, because `get_impact` groups results by stage. The refusal named the problem and it
  corrected itself on the second call. The server now accepts either form and the error lists the
  keys that exist.
- **`icacls /inheritance:r /grant:r ... /T` on a directory that already holds files leaves them with an
  empty ACL**, which nobody can open, the owner included. `securePrivateDir` grants first and cuts
  inheritance second, each on the directory alone; Windows carries both down to what is inside.
- **File modes do nothing on Windows**: `mode 0600` is ignored, and a directory under the repo inherits
  `BUILTIN\Users: Modify`. On Windows `securePrivateDir` (`src/fsutil.ts`) removes the inheritance on
  the state directories this package creates and grants only the current user; on POSIX it is mode 0700
  / 0600. It touches nothing above those directories. The root `.env` of the main checkout is a
  separate matter: this package appended the signing key to it and did not change its permissions.
- **`tsx -e` with an ESM import hangs** in a non-interactive shell here; the checks are files.
- **Git Bash runs a backgrounded `( ... ) &` chain only until its parent command ends**; the long
  checks run as the foreground command of a background task.

## Not tested, or not built

- **Direct SpacetimeDB access.** Identity is enforced at the MCP door. A client that connects to
  SpacetimeDB directly is still unscoped and self-declares its identity (`norn/NOTES.md`, identity
  locking); only identities this server grants are held to a scope. The runner keeps agents away from
  the database (no shell, loopback fetches blocked), but the module does not verify the claims itself.
  The fix is for the module to check a signed claim or JWT (`ctx.senderAuth`), as M5 needs.
- **Revocation.** A token cannot be withdrawn before it expires except by changing the key. Job tokens
  are short; a person's agent token defaults to 8 hours.
- **`headersHelper` on other Claude Code versions, and on Linux.** It works on the bundled CLI here
  (Windows). The helper needs `node` on the `claude` process's `PATH`. Whether a person's own Claude Code
  should use a helper too (`claude mcp add` takes the header on its command line, as printed by the
  mint script) is a choice for M5.
- **A real person's Claude Code** connected with a minted token (`claude mcp add ...`): the mint script
  and the HTTP path are tested with the MCP client, not with the CLI.
- **SpacetimeDB restarting under a running server.** Connections are set to reconnect, but whether
  the mirror's subscriptions come back was not tested. Restart the server if the database restarts.
- **Maincloud, Linux, Streamable HTTP sessions and server-sent streams** (the server is stateless and
  answers with plain JSON), concurrent jobs sharing the server (several actors were exercised, not
  several live sessions at once), more than a few hundred rows.
- **Policy beyond scope** (autonomy limits, the stricter-of rule, fast-track): #43 and M5. A person's
  agent today gets the scope its token names and nothing stricter.
- **Statement numbers do not carry a `mock` flag.** `get_impact` flags mock results; a statement
  built from them says so only if its headline does. CLAUDE.md wants mock output labelled wherever it
  is shown, so the UI should read the flag from the result (`resultKey`) until the statement table
  carries it.
- **Facts.** Agents cannot post `fact`. A fact needs a source reference the module can check (a PLM or
  ERP record id, a quote); until that exists no statement can contain one.
- **The runner's event stream** is not published to `agent_event` by this package.
- No fresh-context review of the fixes has been run.

## Design calls for Tyler

- **Scope lives in the module, set by the MCP server.** The alternative, putting the job's ECRs in
  every call's `meta`, would change all reducers' signatures and the UI branch's bindings. The cost is
  the gap above: `grant_scope` is as self-declared as `register_actor`.
- **One principal per actor name, not per job.** Identities are cached by actor, as asked. A second
  live job may not take an actor over (409), so job builders put the job id in the actor name.
- **Level caps.** `level<N>-...` job roles post up to Level N, other job roles none, a person's own
  agent up to Level 2 (never "Norn's final verdict"). Level 2 for an outside agent is my choice; Level 1
  would be stricter. New roles that should post statements need a `level<N>-` prefix (`maxLevelFor` in
  `src/norn.ts`).
- **`default` and `agent_estimated` assumptions are both evidence class `assumption`.** The glossary
  does not say where an agent's estimate falls (assumption or judgment). Say if you want it to be
  judgment.
- **An agent may not replace a `given` assumption or touch an approved ECR's assumptions**, and a
  scoped actor may not record any source but `agent_estimated`. That is stricter than the old module.
- **`propose_assumption` takes effect at once** (it is the module's `record_assumption`: the ECR's
  checks re-run on it). It is "recorded as agent_estimated", not held for a person's approval. If you
  want proposals to wait for a person, that is a new state, not a tool change.
- **`rejected` rows exist for job-scoped agents only.** Workers and the UI keep getting `SenderError`s
  and no row, because they depend on them.
- **Statements are append-only and not tied to a check run.** A newer statement for the same level
  supersedes the older; a statement written against an older ECR revision shows `current: false`.
- **Tools accept a unique tail of the ECR number** (`ECR-0417` finds `BWM-ECR-0417`); tokens must carry
  the full number.
