# Devpost draft

First draft of the Devpost story, written 2026-10-24 for Cal Hacks' Saturday-night draft (#46).
Every claim is from what is merged on `main` that day, with the PR that shows it in brackets.
Strip the brackets before pasting. Submitting needs Tyler's ask. The video and the demo script
come later. The numbers are from the final rerun on the wiped `norn`, 2026-10-25 at `main`
35e2039 (`docs/DEMO.md`).

## Name

Fern

## Tagline

*(draft, for Tyler to replace)* The impact assessment for an engineering change, in under a
minute, with every number traced to its source.

## Inspiration

At an aircraft maker, every design change moves three things finance cares about: what each
aircraft costs to build, when the change reaches the line, and how exposed the supply chain is.
Before the Change Control Board can decide, a cost engineer, a buyer, a planner and a cost
accountant each work that out by hand, usually in spreadsheets. One study at Ascom measured
2.5 hours of value-adding work inside a 144-day average ECR lead time. The waiting is the cost.

Hyphenate asked for autonomous systems that fill finance seats. Fern fills three: the cost
engineer, the cost accountant and the supply-chain analyst who write the impact assessment for
the Change Control Board.

## What it does

Fern reads an engineering change request (ECR) from the company's PLM, and the costs, suppliers,
stock and history from its ERP. Its checks compute the unit cost, the one-time cost, the cut-in
date and the supply risk as ranges, and posts the impact statement on the ECR, where engineers and
the board already work (#123, #187).

We show it deployed at Bowman Aviation, a fictional maker of electric aircraft modelled on public
data about Archer. Bowman builds the Vesper V4 eVTOL air taxi and is developing the Meridian M6.
Its engineers work in a PLM that stands in for Teamcenter, and its finance team works in ERPNext,
standing in for SAP.

**ECR-0417, end to end.** An engineer files ECR-0417 in Bowman's PLM: a motor-controller bracket
goes from Rev B to Rev C after it cracked in a vibration test. Fern picks it up, runs its checks
against live ERPNext, and a Claude Haiku agent writes the Level 1 impact statement. The statement
lands back on the ECR in the PLM about a minute after the ECR reached Fern (#80, #112):

- about +$415 per Vesper (p10 to p90: $407 to $432) and +$277 per Meridian;
- a one-time cost of $142k to $156k, and a 12-month net of about $157k;
- the top driver: whether to use up or scrap the old brackets, a $60.6k swing;
- six cost lines with no estimate yet, each flagged;
- "Approve with conditions", from a stated rule that names those gaps and the board's call on the
  late cut-in (#112);
- the route from Bowman's own configuration: the Change Control Board with a Technical Review
  Committee review, because the p90 cost of about $164,556 is above Bowman's $150,000 limit (#112).

**When the change reaches the line, and who it collides with.** The timeline check puts ECR-0417's
cut-in at 2027-02-16 at the median, 13 weeks later than the engineer stated, because the supplier
quotes 14 weeks. The supply check reads every other open ECR: ECR-0419 and ECR-0421 buy from the
same supplier, so with ECR-0419 filed ahead, ECR-0421's cut-in moves 13 weeks. Bundling the two
saves about $180k at the median (#88).

**Decisions the company sets.** Every write Norn's agents make passes a policy gate built from
Bowman's configuration. On Bowman's unchanged configuration, Fern's Level 1 agent approves
ECR-0423, a small change at $622, on the fast track, and ECR-0417, which is over the cost and
schedule limits, goes to the Change Control Board. Each decision is stored with its reasons (#100,
#128). When the board approves an ECR in the PLM, Fern records the decision with the approver's name
(#129).

**The ERP stays the people's.** Norn reads the ERP, and its code has no ERP write path. Norn's
ERPNext account is read-only too: every write is refused by ERPNext itself (verified 2026-10-25).
When an ECO is released,
Fern puts the ERP change package on it: the new standard cost, the BOM lines and the journal entries
for scrap and the supplier's cancellation charge, each traced to the ECO and the assessment. The
cost accountant enters the costs and journal entries, and the manufacturing engineer enters the BOM
lines. Fern's next read shows which lines are entered (#74, #114). In the PLM, Fern writes only its own seven impact fields and
comments.

**What's real and what's simulated.** Bowman, its people and its history are fictional, and the
dataset marks each value `sourced` or `invented`. ERPNext is real software, seeded from that
dataset. The numbers above are from one live run on 2026-10-25: the real PLM, reads of live
ERPNext and real Claude sessions for all ten open ECRs. In the same run, ECR-0423 was approved on the
fast track, and a rehearsal ECR was approved in the PLM by the board chair's login: the PLM released
its ECO, Fern recorded the decision, and 17 seconds later the ERP change package was on the ECR, with
8 lines (2 standard costs, 6 BOM steps), none yet entered.

## How we built it

- **Fern's state** lives in SpacetimeDB: the ECRs, every check run, the impact statements, the
  approvals and an append-only action log. The module holds the policy gate, so every write goes
  through it.
- **The checks are code.** BOM delta, cost, timeline and supply checks in TypeScript, with seeded
  Monte Carlo draws, a second-seed convergence test and a trace behind every number. Agents read
  prose, propose assumptions and write the narration; they never compute a headline number. A
  number an agent marks as a computation must equal a stored check result to the digit (#64).
- **Fern's agents are Claude Code sessions**, started and steered through the Claude Agent SDK.
  Each job runs isolated: only Fern's MCP tools are offered, nothing from the host's Claude setup
  loads, and every step streams into the action log (#53).
- **One MCP server.** The agent sessions Fern's runner starts reach Fern only through its MCP
  tools, scoped to one ECR. Each request carries a signed, short-lived token naming the job, the
  actor, on whose behalf it acts, what spawned it and which ECRs it may write to. A write outside
  that scope is refused and logged (#64).
- **Configuration, not code, makes it Bowman's.** Vocabulary, the ECR form, change classes, the
  approval matrix, roles and agent autonomy limits are one config file, validated when the worker
  starts (#58, #83).
- **Connectors** read the PLM and ERPNext over their REST APIs. Bowman's PLM runs on Frappe and
  ERPNext is Bowman's ERP. Both run on a home server, seeded from one dataset so they agree (#55, #62).
- **Fern's own screens** are built on Primer, GitHub's open-source design system, with business words
  throughout (#63, #114).

## Challenges we ran into

- **The same facts gave two answers.** Two live runs on ECR-0417 recommended "Approve with
  conditions", then "Send back". The recommendation is now a rule computed from the checks, and
  the publisher applies it again before anything reaches the PLM (#112).
- **Two publishers wrote the same statement twice.** Read-then-write against the PLM is not
  atomic, so a write now takes a 60-second lease first (#80).
- **Stopping an agent did not stop it.** Aborting the SDK only interrupted the tool call in flight,
  and the model carried on spending usage. The runner now closes the session (#53).
- **The database runtime is not Node.** SpacetimeDB's runtime has no `structuredClone`, so
  validating the configuration inside the module panicked on the first real call (#100).
- **A multipart quote priced the wrong part.** A propeller blade took the hub's $3,950 price
  instead of its own $930, which moved one ECR's year-one spend by $3M (#88).

## Accomplishments that we're proud of

- An ECR filed in a PLM gets a ranged, sourced impact statement back in about a minute, and a
  restart writes nothing twice (#80).
- Every number on the statement traces to the change request revision and the ERP baseline it was
  computed from.
- The agents run under limits a finance team would accept: named seats, scoped tokens,
  a read-only ERP account, code with no ERP write path, and a log the platform writes, not the agent.
- Hundreds of offline tests and live checks against scratch databases, and fresh-context review
  rounds on the changes to money, routing and permissions.

## What we learned

- Agents are good at reading a messy change request and explaining a forecast. Code should
  compute every number they report.
- A recommendation people act on has to follow a rule they can read, or it drifts between runs.
- Giving Fern no way to write to the ERP made the trust story one sentence a reviewer can check
  in the code.

## What's next for Fern

- The full assessment on demand: research agents, an adversarial reviewer and a blind checker,
  published as Levels 2 and 3.
- A person's own agent, such as Claude Code on an engineer's laptop, connecting over MCP and
  acting within the stricter of that person's and the company's limits.
- Comparing each forecast with what actually happened once the change is on the line.

## Built with

TypeScript, Node.js, SpacetimeDB, Claude Agent SDK, Claude Code, Claude Haiku, Model Context
Protocol, React, Primer, Vite, ERPNext, Frappe, Docker
