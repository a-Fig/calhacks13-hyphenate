# Norn's MCP server: notes

Written 2026-10-24 for issue #56. `norn/mcp/` is the one set of tools every agent works through.
Norn's own agents are Claude Code sessions the runner starts (`norn/runner`), and they get the tools
through the job's `mcpServers`. A person's own agent (Claude Code on an engineer's laptop) connects
to the same server with a credential and acts for that person; that is M5 and only its shape is
built. Every write goes through the module's reducers, so through its policy gate and its action log,
with the actor, the person it acted for and what spawned it.

## Run it

Node 22.18 or newer. SpacetimeDB must be running (`npm run db:start` in `norn/`).

```
npm run key:ensure -w @norn/mcp       # once: adds NORN_MCP_SIGNING_KEY to the root .env of the main checkout (appends, prints no key)
npm run start -w @norn/mcp            # serves http://127.0.0.1:3917/mcp for the database "norn"
NORN_DB=norn-mcp npm run start -w @norn/mcp      # or for another database
npm run typecheck -w @norn/mcp
npm run test:unit -w @norn/mcp        # 8 tests: tokens, nornMcpFor, the key script. No database, no model
npm run check:gate -w @norn/mcp       # 48 checks through real HTTP and MCP against the database norn-mcp. No model
npm run e2e -w @norn/mcp              # one real Haiku session through the runner (uses the laptop's Claude login)
npm run e2e -w @norn/mcp -- --statement    # and a second session that posts a Level 1 statement
npm run token:person -w @norn/mcp -- --person jeff --label laptop --ecr BWM-ECR-0417
```

Environment: `NORN_URI` (default `ws://127.0.0.1:3000`), `NORN_DB` (`norn`), `NORN_MCP_PORT` (`3917`),
`NORN_MCP_URL` (what `nornMcpFor` puts in a job; default the loopback URL), `NORN_MCP_STATE_DIR`
(`norn/mcp/.state`, untracked), `NORN_ENV_FILE` (a `.env` to use instead of the main checkout's).

`check:gate` and `e2e` rebuild the separate database `norn-mcp` from the real module (`spacetime
publish norn-mcp --no-config ... --delete-data=always`; the name is a literal in `test/kit.ts`), seed
it with the skeleton's `seed.ts`, and run the skeleton's mock worker against it. They never touch
`norn`. The check results that ECR-0417 has in these tests are that worker's output, labelled
`mock: true`; #41's real checks are not wired in yet.

## What a job builder does

```ts
import { nornMcpFor, nornTools, NORN_MCP_SERVER_NAME } from '@norn/mcp';

const identity = { actor: 'agent:norn/level1/BWM-ECR-0417', onBehalfOf: 'person:jeff', spawnedBy: 'norn' };
const spec: JobSpec = {
  id: jobId, role: 'level1-writeup', prompt, identity,
  mcpServers: { [NORN_MCP_SERVER_NAME]: nornMcpFor(identity, { jobId, role: 'level1-writeup', ecrs: ['BWM-ECR-0417'] }) },
  allowedTools: nornTools('read', 'add_comment'),      // mcp__norn__get_ecr, ...
};
```

`nornMcpFor` returns `{ type: 'http', url, headers: { Authorization: 'Bearer <token>' } }`. The token
is minted for that job (default 30 minutes, at most 6 hours) from the identity you pass, so build the
runner's `identity` and the token from the same object. `ecrs` are full PLM numbers. The runner's
`allowedTools` is the second lock: the server offers all nine tools, and the runner denies the ones
a role does not list.

## Tools

Every answer says its evidence class (`docs/GLOSSARY.md`: fact, assumption, computation, judgment).
Reads answer from a live mirror of the database and are open to any valid token. A write names an
ECR by its PLM number (a unique tail such as `ECR-0417` works too) and never names who is acting.

| Tool | Does | Evidence class of what it returns |
|---|---|---|
| `list_ecrs` | ECRs: number, title, status, revision, impact state, statement levels posted | fact |
| `get_ecr` | text, status, revision, base version, affected parts, impact state, newest statement of each level | fact; affected parts are matched from the text and check details, so can be incomplete (the overlay is not built) |
| `get_impact` | latest check results by stage: p10/p50/p90, unit, trace, the assumptions each run read with their sources. `state`: `no_results`, `partial`, `current` or `stale`, with a hint. `mock` flagged. `key` returns one result's full trace | computation |
| `get_part` | one part, and the ECRs whose text names it | fact (as held in Norn; ERP not wired in) |
| `list_assumptions` | baseline plus the ECR's own, each with value, source, rationale, revision | `given` is fact; `default` and `agent_estimated` are assumptions |
| `get_ecr_history` | comments and actions, oldest first: who, for whom, spawned by, outcome; a refusal shows as `denied` with its reason | fact |
| `add_comment` | a comment under the agent's own name | writes |
| `propose_assumption` | a number or triangular range with rationale and sources, recorded as `agent_estimated`; the ECR's checks re-run on it | writes |
| `post_impact_statement` | Level 1 to 3: class, route, headline, numbers (p10/p50/p90), drivers, assumptions, claims, each with an evidence class | writes |

`post_impact_statement` keeps the agent from forging a number: a number with evidence `computation`
names a `resultKey` from `get_impact` and the server copies its digits, label and unit from that
result (the agent does not type them), and the module re-checks that it equals a current
`check_result` exactly. An assumption's source is filled in from Norn's record, and the module
refuses a relabelled one. Judgment and fact numbers carry their own p10/p50/p90.

The ERP history tools (#40) have a seam: `src/erp.ts` registers nothing yet, and says what to add.

## Tokens

```
nmt1.<base64url(claims JSON)>.<base64url(HMAC-SHA256(NORN_MCP_SIGNING_KEY, "nmt1." + payload))>
```

| Claim | |
|---|---|
| `kind` | `job` (minted per runner job) or `person_agent` (a person's own agent) |
| `jobId` | the job, or an id for the credential; names the scope grant |
| `role` | what the agent is for |
| `actor` | the principal's name in Norn, e.g. `agent:norn/level1/BWM-ECR-0417`; up to 64 printable characters |
| `onBehalfOf` | the person it acts for; `null` when Norn acts on its own; required for `person_agent` |
| `spawnedBy` | `norn`, a parent job id, or for a person's agent the person; goes into `meta.spawnedBy` of every write |
| `ecrs` | PLM numbers it may write to; `["*"]` (any ECR, never the baseline) is for `person_agent` only |
| `iat`, `exp` | seconds; a job token lives at most 6 hours, a person's at most 30 days |

The server checks signature (constant time), shape, `exp` and `iat` before anything else, on every
request. The tools take no identity argument, so the only identity an agent can have is the one in
its token. The key never leaves the process environment and the root `.env`; no log line, error or
file written by this package contains it or a token (`check:gate` searches the action log for it,
and `e2e` searches the runner's JSONL for the token and the key).

`scripts/mint-person-token.ts` writes a person agent's token to a file (mode 0600), not to the
screen, and prints the `claude mcp add --transport http ...` line that reads it. The actor is
`agent:<person>/<label>`, registered as an outside agent (`origin: external`) for `person:<person>`.
It names the ECRs it may write to, or `--all-ecrs`.

## How an identity becomes a principal, and how a refusal is made

1. The request carries a token. The server verifies it and builds a fresh MCP server for that
   request, bound to the token's claims (stateless: no session to hijack).
2. `Norn.actorFor(claims)` returns that actor's own SpacetimeDB connection, cached by kind and actor
   name. Its identity token is kept in `.state/identities/` (untracked, mode 0600) so a restart keeps
   the identity. It calls `register_actor` (kind `agent`, origin `norn` for a job or `external` for a
   person's agent, `onBehalfOf` from the token) and `grant_scope`.
3. `grant_scope` writes an `actor_scope` row for that identity: the job id, the ECRs (or any ECR) and
   an expiry. The module's `authorize()` reads it (`resolveActor` puts it on the `Actor`), and the rule
   in `module/src/scope.ts` runs on every write. A scoped actor may only comment, record
   `agent_estimated` assumptions and post statements, only on ECRs in its scope, never on the baseline,
   and never to replace a `given` assumption (on the ECR or inherited from the baseline).
4. A write outside that is refused by the module itself: the reducer returns normally, and the
   `action_log` row has outcome `denied`, the reason, the actor, `onBehalfOf`, `spawnedBy` and the ECR
   attempted. The tool finds that row by request id and answers with `Refused by Norn's policy gate:
   <reason>. ... Do not retry`. The tool does not pre-check scope; the gate owns the decision.
5. A second live job cannot take over an actor that already holds a live grant for another job or
   widen it (HTTP 409). Give each job its own actor name, as the runner's example does
   (`agent:norn/researcher/ECR-0417/1`). The same job can reconnect and refresh its grant.

Allowed writes log the reason too: `allow (job scope: job <id> may write to <ECR>)`.

## Module changes (`norn/module`, `norn/bindings` regenerated)

- **`actor_scope`** table and **`grant_scope`** reducer (above). `Actor` gained an optional `scope`.
- **`scope.ts`**: the rule, registered into `POLICY_RULES` by a side-effect import from
  `reducers.ts`, so the test module has it too. #43 will rewrite the gate's rules around Bowman's
  configuration; this rule is about the credential and should survive that.
- **`authorize()`** now returns the reason of the first rule that explicitly allowed (it used to
  ignore it); with no such rule it still says `allow (no rules yet)`, which `check:policy` expects.
- **`impact_statement`** table and **`post_impact_statement`** reducer. Typed columns (class, route,
  headline, and arrays of numbers, drivers, assumptions and claims, each with an evidence class)
  rather than a JSON blob or a `comment`, so the UI can render them without parsing and the module
  can validate them. Append-only; the reader takes the newest of each level. `prRevision` is the
  ECR's revision when it was written, so a statement shows as out of date once the ECR moves on.
  Refused: a level outside 1 to 3, p10 > p50 > p90 ordering, a `computation` number that is not
  a current check result to the digit, an assumption the ECR does not see or whose source is
  relabelled, and an ECR that is not open.

The existing `check:module` (48 checks) and `check:policy` (6) pass on `norn-test` with these changes.
Nothing in the existing tables or reducers changed shape, so the `norn` database can take a plain
`db:publish`; this branch did not publish it.

## What is tested

| What | How | Result |
|---|---|---|
| Tokens, `nornMcpFor`, `.env` parsing, the key script | `test:unit` | 8 of 8 |
| The edge: no token, wrong key, expired, edited payload, wrong host name, GET, unknown ECR in a token | `check:gate` | pass |
| All nine tools through real HTTP and the MCP client; the comment's author, the action-log fields, the allow reason | `check:gate` | pass |
| A write to another ECR is refused by the module and logged (`denied`, reason, actor, for whom); a tool answer, not a crash; nothing written | `check:gate`, `e2e` | pass |
| Reducers outside the scoped set, baseline writes, a scope widened by its holder, a grant that has run out, an agent replacing a `given` assumption | `check:gate` | pass |
| Statement rules in the module itself (bad digits, relabelled source, level 4, p10 > p90) | `check:gate` with a raw client | pass |
| A person's agent token (`*`, external origin, on-behalf-of) | `check:gate` | pass |
| A real Haiku session through the runner with only Norn's tools: reads ECR-0417 and its impact, posts one comment, tries one write to ECR-0418 | `e2e` | pass: 8.3 s, 5 turns; the agent made the refused attempt itself |
| A second Haiku session that posts a Level 1 statement with two `computation` numbers and two assumptions | `e2e -- --statement` | pass: 16.2 s, 6 turns; its first call used a wrong result key and the error text fixed it |
| `npm run typecheck` (all workspaces), the runner's typecheck and 61 unit tests, `check:module`, `check:policy` | local | pass |

## Found along the way

- **A Haiku agent wrote `resultKey: "s2_cost.unit_cost_delta"`** (stage and key joined) on its first
  statement call, because `get_impact` groups results by stage. The refusal named the problem and it
  corrected itself on the second call. The server now accepts either form and the error lists the
  keys that exist.
- **`tsx -e` with an ESM import hangs** in a non-interactive shell here; the checks are files.
- **Git Bash runs a backgrounded `( ... ) &` chain only until its parent command ends**; the long
  checks run as the foreground command of a background task.

## Not tested, or not built

- **Direct SpacetimeDB access.** Identity is enforced at the MCP door. A client that connects to
  SpacetimeDB directly is still unscoped and self-declares its identity (`norn/NOTES.md`, identity
  locking); only identities this server grants are held to a scope. The runner keeps agents away from
  the database (no shell, loopback fetches blocked), but the module does not verify the claims itself.
  The fix is for the module to check a signed claim or JWT (`ctx.senderAuth`), as M5 needs.
- **Revocation.** A token cannot be withdrawn before it expires except by changing the key. Job tokens are short; a
  person's agent token defaults to 8 hours.
- **The token is on the command line.** The Agent SDK passes MCP server configs to the `claude`
  process, so a job's bearer token is probably visible to other processes of the same user for the life
  of the job. Not checked. It is loopback-only, scoped to the job's ECRs and short-lived.
- **A real person's Claude Code** connected with a minted token (`claude mcp add ...`): the mint script
  and the HTTP path are tested with the MCP client, not with the CLI.
- **SpacetimeDB restarting under a running server.** Connections are set to reconnect, but whether
  the mirror's subscriptions come back was not tested. Restart the server if the database restarts.
- **Maincloud, Linux, Streamable HTTP sessions and server-sent streams** (the server is stateless and
  answers with plain JSON), concurrent jobs sharing the server (two actors were exercised, not two
  live sessions), more than a few hundred rows.
- **Policy beyond scope** (autonomy limits, the stricter-of rule, fast-track): #43 and M5. A person's
  agent today gets the scope its token names and nothing stricter.
- **Real checks.** `get_impact` reads `check_result` as the module stores it. The trace is
  `detailJson` (clipped to 1,500 characters per result unless `key` is given) plus the run's inputs
  and the assumptions it read. #41's traces (`formula`, `uses`, `inputs`) will show up as they are.
- **The runner's event stream** is not published to `agent_event` by this package (the runner
  does not write to the database yet).
- No fresh-context review of this work has been run.

## Design calls for Tyler

- **Scope lives in the module, set by the MCP server.** The alternative, putting the job's ECRs in
  every call's `meta`, would change all reducers' signatures and the UI branch's bindings. The cost is
  the gap above: `grant_scope` is as self-declared as `register_actor`.
- **One principal per actor name, not per job.** Identities are cached by actor, as asked, so two live
  jobs may not share an actor name (the second gets 409). A job's scope is therefore tied to its actor.
- **`default` and `agent_estimated` assumptions are both evidence class `assumption`.** The glossary
  does not say where an agent's estimate falls (assumption or judgment). Say if you want it to be
  judgment.
- **An agent may not replace a `given` assumption**, and a scoped actor may not record any source but
  `agent_estimated`. That is stricter than the old module, which let anyone write any source.
- **`propose_assumption` takes effect at once** (it is the module's `record_assumption`: the ECR's
  checks re-run on it). It is "recorded as agent_estimated", not held for a person's approval. If you
  want proposals to wait for a person, that is a new state, not a tool change.
- **Statements are append-only and not tied to a check run.** A newer statement for the same level
  supersedes the older; a statement written against an older ECR revision shows `current: false`.
- **Tools accept a unique tail of the ECR number** (`ECR-0417` finds `BWM-ECR-0417`); tokens must carry the full number.
