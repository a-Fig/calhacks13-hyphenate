# Norn

Our product. Norn forecasts what an engineering change will do to production and to the books,
lets agents act on that forecast within the limits a company sets, and keeps a record of every
step that anyone can dig into. Written 2026-10-24. Where Norn sits among Bowman's systems is
`docs/PLAN.md`; the engine's design is `ARCHITECTURE.md` in this folder.

Norn is general. Everything specific to one company comes from that company's configuration, so
Bowman's is in `bowman/norn-config/`, not here. Code in this folder shouldn't need to name Bowman.

## Responsibilities

- **Mirror the production baseline.** Read parts, BOMs and change records from the PLM, and costs,
  suppliers, stock and history from the ERP. Norn keeps a working copy; the PLM and ERP stay the
  systems of record.
- **Hold proposed changes.** Each ECR is an overlay of edits on a version of the baseline, revised
  as people and agents correct it (`ARCHITECTURE.md` §2, §4).
- **Assess impact.** Run the impact screen automatically (cheap code checks and one inexpensive
  agent pass, published as Level 1), and the full impact assessment on demand (research agents,
  adversarial review, a blind checker, published as Levels 2 and 3). Every number is a range.
- **Route and decide.** Set the change class, propose the approval route, and apply Bowman's
  autonomy limits: approve, approve with a sampled check, recommend, or escalate.
- **Write results back** where people work: the impact statement onto the ECR in the PLM, and the
  ECO's effects into the ERP.
- **Give every agent an identity** and check every write against policy: who acted, for whom,
  spawned by what, and the stricter of the person's and the company's limits.
- **Keep the audit trail.** Every claim carries its evidence class and its sources, and can be
  traced to the data, rule or person behind it.

Not Norn's job: designing parts, running MRP, keeping the ledger, or replacing the PLM or ERP.

## Parts

Folders are created as code lands.

| Part | Folder | Does |
|---|---|---|
| State layer | `module/` | The SpacetimeDB module: the tables, the narrow write API, the action log and the policy gate |
| Workers | `workers/` | Compute checks: BOM delta, cost, timeline, supply simulation |
| Agent runner | `runner/` | Starts and steers Norn's agents as Claude Code sessions through the Agent SDK: extraction, classification, research, review, narration, post check. Streams every step into the action log |
| Connectors | `connectors/` | Read from and write to the PLM and ERPNext over their REST APIs and webhooks |
| Web | `web/` | Norn's own screens: an ECR's impact assessment, the "why" behind any number, the backlog roll-up, the audit trail |
| MCP server | `mcp/` | The tools every agent works through: Norn's own agents, and a person's own agent connecting with credentials to act on their behalf |

## Interfaces

- **In from the PLM:** webhooks on NCR and ECR changes; REST reads of parts, BOMs and change
  records.
- **Out to the PLM:** the impact statement, class and route on the ECR, through the same API a
  real PLM integration would use.
- **ERPNext:** REST reads of items, BOMs, prices, stock, orders and history; writes of the new BOM,
  standard cost and draft journal entries when an ECO releases. Its API user's permissions are in
  `bowman/erp/`.
- **Agents:** MCP, with each agent's identity, the person it acts for, and what spawned it.
- **Configuration:** one company config file, validated against Norn's config schema at start-up.

## Stack

TypeScript throughout, SpacetimeDB for state and live updates, and Claude Code sessions through
the Claude Agent SDK for the agents (decided; `ARCHITECTURE.md` §9-10, `docs/PLAN.md` §4). How to
run it goes in `CLAUDE.md`'s commands once it exists.

Issues: label `area: norn`.
