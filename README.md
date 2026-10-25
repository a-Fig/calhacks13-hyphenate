# Cal Hacks 13.0 - Hyphenate Track

Our team's repo for Cal Hacks 13.0 (Oct 23-25, 2026, Palace of Fine Arts, San Francisco), entering the Hyphenate track "The Hyphenated Enterprise: Autonomous Systems for Finance". The docs folder holds short summaries, and the sources folder holds the original material they come from.

## Key deadlines (all times PT)

| When | What |
|---|---|
| Fri Oct 23, 18:00 | Hacking starts |
| Fri Oct 23, 19:00-20:00 | Hyphenate workshop "Beyond Agentic Harnesses: Engineering the Autonomous Enterprise" |
| Sat Oct 24, 14:00-15:30 | Hyphenate Mixer, Gate 6 |
| Sat Oct 24, night | Cal Hacks recommends a first Devpost draft by Saturday night |
| Sun Oct 25, 08:00 | Be at the venue (Devpost requirements) |
| Sun Oct 25, 09:00 | Devpost submission deadline (hard) |
| Sun Oct 25, 10:30-12:30 | Judging, whole team at the assigned table |
| Sun Oct 25, 14:00-16:00 | Closing ceremony, winners announced |

## What Hyphenate wants to see

- A demo video that opens with "the moment"
- A live demo at judging, running for real (they may hand us their own scenario)
- One line on which finance seats the system fills
- Proof it works: what's real, what's simulated, and how we know

Prizes are $8,000, $5,000 and $3,000 for the top 3 teams, plus an expedited interview process for the top 5 teams. Summary in [docs/hyphenate-track.md](docs/hyphenate-track.md), full brief in [sources/hyphenate/track-brief.md](sources/hyphenate/track-brief.md).

## Team

- Tyler Darisme ([a-Fig](https://github.com/a-Fig))
- Ankit

## Our idea: Fern

Every design change at an aircraft maker changes what the aircraft costs to build, when the change reaches the production line, and how exposed the supply chain is. Today a cost engineer, a buyer, a planner and a cost accountant each work that out by hand before the Change Control Board can decide, and a change can wait months for a few hours of real work.

Fern does that impact assessment. It reads the engineering change request (ECR) from the company's PLM, and costs, suppliers, stock and history from its ERP. It returns unit cost, one-time cost, cut-in date and supply risk as ranges, and posts them on the ECR where engineers and the board already work. When the change order is released, the new cost lands in the ERP. Its agents approve the small changes the company allows them to, and every number traces back to its source.

We demo Fern deployed at Bowman Aviation, a fictional aircraft maker built from public data, running a stand-in PLM and ERPNext. The plan is [docs/PLAN.md](docs/PLAN.md). This section describes what we are building; it becomes a description of what works as the pieces land.

## Repo layout

- [norn/](norn/README.md) - our product
- [bowman/](bowman/README.md) - Bowman Aviation: its data, its PLM, its ERP (ERPNext) and its configuration of Fern
- [docs/](docs/PLAN.md) - the plan, glossary, research and hackathon notes
- [sources/](sources/README.md) - original material, verbatim

## Docs

Short summaries, each linking to the source behind every fact.

- [docs/PLAN.md](docs/PLAN.md) - what we're building and in what order
- [docs/hyphenate-track.md](docs/hyphenate-track.md) - prizes, judging, what to bring, Hyphenate events
- [docs/hyphenate-company.md](docs/hyphenate-company.md) - who Hyphenate is and what they build
- [docs/hackathon-logistics.md](docs/hackathon-logistics.md) - schedule, deadlines, submission rules
- [docs/sources.md](docs/sources.md) - every source URL

## Sources

[sources/](sources/README.md) holds the original material, verbatim, each file headed with its URL and fetch date.

- [sources/calhacks/](sources/calhacks/) - live schedule, prizes, FAQ and resources JSON, the Hacker Guide, Devpost pages, and Cal Hacks emails
- [sources/hyphenate/](sources/hyphenate/) - track brief, workshop, LinkedIn About, the hyphenate.ai site (product pages, blog, careers), and press on the seed round and the rename
