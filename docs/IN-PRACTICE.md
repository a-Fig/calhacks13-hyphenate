# How this work is done today

Compiled 2026-10-24 from the two research reports in `docs/research/` (`practice-impact-assessment.md`, `practice-simulation.md`), which hold the sources and URLs.

Labels used below, carried over from those reports: **illustrative** (made-up numbers), **inferred** (the researcher's reasoning, not a source), **secondary** (seen only through another document or a search excerpt), **vendor** (marketing material).

## The short version

- **An impact assessment is a fixed cost table plus a short narrative of effects.** The DoD template splits cost into production, retrofit, logistics support and other, each as one-time cost plus unit cost x quantity (MIL-HDBK-61A App. B). Norn's cost output should take that shape.
- **Cost numbers start with a supplier quote.** Real supplier forms demand a firm quote with a before/after breakdown and tooling cost. Should-cost and learning curves are cross-checks on the quote, not substitutes (Crane 104-209; Summit 8400-QSP-FORM-001).
- **Inventory disposition can outweigh the piece price.** In the worked bracket example, use-up vs scrap was a $37k swing, bigger than any price range (illustrative).
- **Most changes never reach the CCB.** Roughly 75-85% go on a fast track approved by individuals (secondary, vendor). Published dollar tiers exist: $150,000 and $2,000,000 (WSR-88D CCB charter).
- **Bowman, not a DER, decides FAA major vs minor.** Certification belongs in Norn as a classification and test-effort field, not a DER sign-off step (FAA Order 8110.37G).
- **Cost and schedule risk analysis has a settled recipe.** One distribution per element, 0.3 correlation, about 10,000 Monte Carlo trials, then an S-curve, a tornado chart and an "X% confident" sentence (GAO-20-195G; Joint Agency handbook).
- **Supply disruptions are shown as separate what-if scenarios,** not blended into the headline range. Ford's method asks "what if this node is down N weeks", with no probabilities (Simchi-Levi 2015).
- **Lead time is waiting, not work.** One study measured 2.5 h of value-adding time inside a 144-day average ECR lead time (Ascom study, Chalmers 2013).

## 1. What an impact assessment actually contains

**Term mapping.** The richest public template is the DoD **ECP** (engineering change proposal): a contractor's ECR to the government, with its impact assessment attached. Read ECP as ECR. Its "CCB directive" is the board's recorded decision; at Bowman that decision releases the ECO.

### The ECP (DD Form 1692, defined in MIL-HDBK-61A Table 6-6)

| Element | What it asks for |
|---|---|
| Identification | ECP number and revision, originator, class (I or II), justification code, priority (Emergency / Urgent / Routine) |
| Justification codes | B interface, C compatibility, D deficiency, O operational, P production stoppage, R cost reduction, S safety, V value engineering |
| Description and need | Items affected, whether in production, consequences of disapproval, failure data, alternatives considered |
| Effectivity and schedule | Production effectivity by serial or lot, delivery in "days after contractual approval", retrofit serials, work-hours to install, out-of-service time, milestones in months after approval |
| Effects | Drawings, interfaces, spares, manuals, training, support equipment, warranties, life-cycle cost |

**The cost page (MIL-HDBK-61A App. B).** Four blocks, each split into non-recurring, recurring unit cost, quantity and total, with savings in parentheses:
- **Production:** item cost, factory test equipment, special tooling, scrap, engineering and data revision, test procedure revision, qualification.
- **Retrofit:** 11 named items (kits, tooling, installation, testing). **Logistics support:** 17 items (spares, training, manuals, support cost).
- **Other**, then subtotal and **net total**.

DD 1692 block numbers (Block 50 net cost impact, 50a production, 50b retrofit, 50c support; Block 55 milestone chart) are secondary: the official PDF returned 403, and a NASA copy numbers them differently.

**Class I vs Class II.** Class I covers any change to a physical or functional requirement, cost or milestones, safety, retrofit of delivered units, interchangeability, or sources on a source-control drawing. Class II is everything else, and needs only item name and number, next higher assembly, description and need (MIL-HDBK-61A Tables 6-2, 6-6).

### Supplier change forms (real, published)

- **Crane Aerospace Form 104-209 Rev 0 (2015).** Priority (Emergency "line stopper now" / Urgent "within 30 days" / Routine). An inventory table per part: **In Stores / WIP / Finished Goods / In Field / On Order**. Disposition codes: use until depleted, mandatory install, rework/retest, scrap. A cost box: any piece-cost change "will require firm quote, before/after breakdown and approval".
- **Summit Aviation 8400-QSP-FORM-001 (2020).** "Tooling or facility changes? If yes, cost?", "Is piece cost affected? Cost per piece?", interchangeability, new ship date, sample piece or full first-article inspection.
- **Automotive PPAP (Accuride Form P100).** Lists triggers such as new tooling, tooling moved to another plant, new raw-material source, tooling idle 12+ months. The supplier proposes a submission level (1-5).
- **Aerospace first article (Lockheed Martin Q2A Rev 12).** Full or partial first-article inspection (AS9102) for any form-fit-function, source, process, tooling or material change. Five business days' notice before the supplier starts.
- **Notice clauses.** Boeing D520: buyer responds within 15 days. Sikorsky SA1963: final data 30 days before delivery, and the buyer has "absolute discretion" on classification.

### Worked example: Bowman ECR-0417 (all numbers illustrative)

Motor-controller bracket BW-5120-210, Rev B to Rev C, after an NCR for a vibration crack at 8.2 h of a 20 h endurance test.

| Field | Content |
|---|---|
| Classification | Company Class I (cost, retrofit on 4 test aircraft); FAA proposed minor (secondary structure, stiffer, same envelope) |
| Change | Plate 1.0 to 1.25 in, web 5 to 8 mm, larger fillet; interchangeable |
| Volume | 12 per aircraft, 480 per year at 40 aircraft |
| Should-cost | $185.31 to $218.42 (+17.9%), built from material, machining, setup, inspection, anodize, scrap, markup |
| Supplier quote | $186.40 today; Rev C $221.00 steady state, $239.50 for the first lot of 25 |
| Learning check | 90% slope reaches standard time at unit 23; excess about $477 vs the $462.50 lot-1 premium |
| One-time | Supplier tooling and programs $13,600; Bowman re-qualification $18,500; engineering 106 h = $15,370 |
| Inventory | 252 Rev B parts scrapped (failed fatigue, so no use-up): $46,973 less $718 salvage; 60 cancelled at 10% = $1,118 |
| Effectivity | Retrofit S/N 001-004 ($10,608 parts, $5,280 labor); production cut-in at S/N 009 |
| Supply chain | Single source; plate lead time 6 weeks; purchase price variance on lot 1 +$18.50 vs new standard |
| Year-1 total | Recurring +$16,608, one-time $111,194, **about $127,800**; steady state +$415 per aircraft |
| Ranges | Piece price p10 $212, p50 $221, p90 $236; use-up vs scrap ($37k) is the largest swing |

## 2. Who does what, and what the CCB decides

No aircraft maker publishes its internal ECR procedure. The picture below combines DoD guidance, a federal CCB charter and one industrial case study.

| Step | Owner | Duration (source) |
|---|---|---|
| NCR or deficiency found | Production, test, MRB | Emergency: decision in 48 h; urgent: 30 days (MIL-HDBK-61A 6.2.1.4) |
| Draft ECR | Design engineer who owns the part | Message ECP to formal ECP within 30 days (MIL-HDBK-61A) |
| Log, classify, route | Configuration manager | Not stated |
| Estimate and price | Pricing, proposal and contracts managers | Not stated |
| Logistics and planning | Logistics manager, planner | Not stated |
| CCB | Chair is the program manager; members from engineering, production, logistics, contracts, CM | Monthly (WSR-88D charter) |
| Release | Chair signs the decision; contracts follow | About one month to acknowledge receipt (MIL-HDBK-61A Table D-1) |

**What the board sees.** A secretariat circulates the complete ECR with all cost, schedule and support impacts before the meeting. Members record concurrence or non-concurrence in advance. Outcomes: approve, disapprove with rationale, or return for revision (MIL-HDBK-61A 6.1.1.3, Table 6-7). In the government case, approval is not yet permission to spend; funding and a contract change follow.

**Approval tiers (WSR-88D CCB charter, 7 Mar 2024).**

| Tier | Body | Authority |
|---|---|---|
| Above $2,000,000 | Program Management Committee | Final approval |
| $150,000 to $2,000,000 | CCB | Approves |
| Up to $150,000 | Technical Review Committee | Approves; also reviews everything above |
| Class II | Project team | Handles through the change-request process |

**Industrial timings (Ascom Wireless, Sweden; Chalmers 2013).** The study's "change request" is our ECR and "change order" our ECO.
- Reviewers get three weeks. Changes expected to need over 40 work hours go up to the product line; a second company escalates over 80 hours. One company batches cost-reduction changes four times a year.
- A Time-Risk-Cost sheet existed, but reviewed requests "often lacked" it.
- ECR lead time 144 days average (87 median); ECO lead time 72 days average (27 median). Most waiting was in investigation: 106 days average.
- Terwiesch and Loch (1999) found the same pattern: processing rarely exceeds two weeks, but lead times run weeks to over a year, driven by congestion and approval complexity.

## 3. How the research happens: where each number comes from

| Number | Where it comes from |
|---|---|
| New piece price | Supplier's firm quote with before/after breakdown (Crane 104-209, Summit) |
| Piece price cross-check | Should-cost build-up: labor and material per work package, plus overheads, reviewed by an engineer and a cost analyst (NASA Cost Estimating Handbook). Parametric tools: SEER-H, PRICE TruePlanning |
| Early-lot premium | Learning curve Y = kx^n; "usually 85% for aerospace" (NASA cost module); F-35A estimated at 91% (2017 paper) |
| Tooling and programs | Supplier form box "Tooling or facility changes? If yes, cost?" (Summit) |
| Inventory on hand | Per-location counts from ERP into the disposition table (Crane 104-209); moving them by hand is inferred |
| Effectivity | Planner's trade-off of five inputs: urgency, inventory (use up or scrap), configurations in service, lead times, timing. A safety deficiency "may override all other considerations" (MIL-HDBK-61A 6.1.1.4) |
| Certification class | 14 CFR 21.93(a): minor = "no appreciable effect" on weight, balance, strength, reliability or airworthiness; all else is major |
| Historical actuals | Not documented in any primary source found |

**Tools in use.** Archer runs Teamcenter, per its job postings (secondary), so Teamcenter is a realistic choice for Bowman's PLM. Should-cost tools such as aPriori and Teamcenter Product Cost Management refresh a BOM cost when the structure changes (vendor). Excel is the likely default for the cost page (inferred; no survey found). Risk analysts mostly use Excel add-ins (Crystal Ball, @RISK) or DoD's ACE for cost, and Primavera Risk Analysis or Safran Risk for schedule (Joint Agency handbook §1.4.1).

## 4. Fast track

**Criteria as published.** No universal threshold exists. The common rule is "Class II = not Class I". Published examples:
- Documentation-only changes, approved alternate materials, drawing changes not touching a baseline or interface (NASA STEREO CM plan).
- Changes that leave form, fit, function and logistics alone; software with no user, budget or hardware effect (WSR-88D charter).
- Windchill: low impact and cost, threshold set by company policy (PTC docs, vendor). Benchmarks: Windchill 80%; Boeing Insitu "from zero to over 60%" (vendor).

| Qualifies | Never qualifies |
|---|---|
| Drawing note or typo fixes | Anything touching safety or a flight-safety part (Sikorsky SA1963) |
| Swaps from a pre-authorized equivalents list (Boeing drawing 1G50100) | Interchangeability or interface changes |
| Obsolescence replacements with no form-fit-function change | Retrofit of delivered units |
| Minor supplier changes notified, not approved (Parker clause) | Supplier process, location or tooling changes needing first-article or PPAP |
| Internal software with no user or budget effect | FAA-major changes (14 CFR 21.93) |

**Who approves.** The basic tier is approved "by creator" or "by individuals"; a standing management board takes 15-20%, a top-management board 0-5% (Aras slides, vendor). In DoD practice, the government plant representative concurs on classification only, and that lets the contractor proceed without CCB action (MIL-HDBK-61A Table 6-7). No published speed figure exists for fast-track changes.

**How it differs from the FAA's minor class.** Company Class II and FAA minor are different tests and can disagree. The bracket is Class I for cost and retrofit, yet FAA-minor for airworthiness. Sikorsky's supplier forms pair "Class II / FAA Minor" and "Class I / FAA Major", which conflates the two (secondary).

**The DER correction.** Our earlier assumption had a DER (FAA-designated engineering representative) signing off minor changes. That is wrong. Under FAA Order 8110.37G (effective 17 Sep 2026):
- The design approval holder (Bowman) decides major vs minor; the FAA can reject the call; this cannot be delegated to a DER.
- No FAA project is needed for a minor change.
- DERs "do not approve data for minor changes", unless the project office has authorized it in advance.

## 5. How cost and schedule risk is simulated

**The recipe (GAO-20-195G ch. 12; Joint Agency handbook ch. 2-4).** Give each cost element or task a distribution, add correlation between related elements, then draw and sum about 10,000 times (Latin Hypercube sampling recommended). Report an S-curve, a percentile table, a tornado chart and a confidence statement.

**Distributions.**
- Lognormal is the default "in the absence of better information"; it won most of 1,400 fits. BetaPERT is for left skew. Triangular is listed "due to its simplicity and popularity" (Joint Agency handbook Table 2-2).
- Expert min/max should be read as the 15th and 85th percentiles, not hard bounds. GAO says experts capture only 60-85% of the true range (GAO-20-195G p. 146).
- Last-resort spread when nothing is known: lognormal log-space error 0.15 / 0.25 / 0.35 / 0.45 for low to extreme (Joint Agency handbook Table 2-9).

**S-curves and the low point estimate.** In GAO's drone example (32 aircraft at $77M each), the point estimate of $2.47B is only about the 15th percentile. P50 is $2.61B; P80 is $2.79B (GAO-20-195G p. 146-148). Contingency is the chosen percentile minus the point estimate.

**Confidence statements.** No level is a best practice. "Budgeting to the mean of the S curve is a common practice"; 70-80% is suggested for high-risk programs (GAO-20-195G p. 158). NASA budgets programs at 70% joint cost-and-schedule confidence (JCL) and projects at a minimum of 50% (NASA SPD-19).

**Correlation.** Default 0.3; perfect correlation is discouraged (Joint Agency handbook ch. 3.3). With five elements at 0.3, ignoring correlation understates the total spread by 46%. It matters at P80/P90 and barely at P50. Better still, model dependencies directly (hours x rate x learning slope), which creates correlation for free (GAO-20-195G p. 157).

**Risk events.** With few events, show them as separate what-if cases; "funding at the expected value... is not recommended". With many, model each as yes/no times an impact distribution (Joint Agency handbook §2.7.2).

**Tornado charts.** Each input is moved alone to its P10 and P90, others fixed, ranked by swing. Example: an 88% learning curve instead of 91% cut GAO's estimate by $60M (GAO-20-195G Fig. 11). A tornado alone is insufficient; pair it with a sensitivity or Pareto chart.

**Schedule and merge bias.** Each trial draws task durations and recomputes the critical path. Where parallel paths merge, the finish is the latest path, so the milestone slips: two paths each 60% likely on time give 36% (GAO schedule guide, secondary). The researcher's own run: the chance a two-path merge finishes by one path's P50 is 25%, not 50% (inferred).
- **Criticality index:** share of trials where a task is on the critical path. **Duration sensitivity:** correlation of task duration with total duration. A one-day task can be 100% critical yet barely move the finish, so report both (NASA AIAA paper).

## 6. How supply-chain risk is really assessed

"Supply-chain simulation" means two different things in practice: **stochastic** models that draw lead time, demand and inventory from distributions (anyLogistix, inventory optimisation, academic Monte Carlo), and **deterministic stress tests** that ask "what if this node is down" with no probabilities, as at Ford.

**Ford's TTR/TTS model (Simchi-Levi et al., Interfaces 2015).**
- Scale: over 50 plants, 1,400 Tier 1 suppliers at 4,400 sites, up to 10 tiers.
- **TTR (time to recover):** how long a node (a part at a facility) takes to come back. The model knocks out each node for its TTR and solves for the best response: shift inventory, redirect supply, idle plants. Output: lost units or profit. No event probabilities are needed, since impact "often does not depend on the cause of the disruption but rather on its duration".
- **TTS (time to survive):** how long the system runs with no loss if that node goes down.
- If TTS far exceeds TTR, the TTR estimate barely matters. Many suppliers had TTS under a week.
- Finding: the biggest exposures sat in cheap commodity parts (about 10 cents), not high-spend strategic suppliers. Schneider Electric uses the same method to place inventory and second sources (MIT News 2022).

**The what-if engines.** SAP IBP and Kinaxis RapidResponse run versioned what-if on deterministic plans: change a lead time or capacity, see shortages across the network (secondary). No Monte Carlo was documented in either. Baseline MRP uses fixed lead times, with variability hidden in padding and safety stock (MIT course notes).

**Inputs.** Procurement lead times fit lognormal, gamma, normal or Weibull, but normal fails when variation is large (Air Force study; Tadikamalla 1984; both secondary). Risk vendors (Resilinc, Interos, Everstream) sell scores and event alerts, not distributions (vendor). No primary source gives typical disruption probabilities.

**Disruptions as separate scenarios.** Natural disasters, bankruptcies and similar events "should generally be excluded" from the uncertainty model and shown as separate cases (Joint Agency handbook §1.3.4).

## 7. What the outputs look like to a finance reader

| Output | What it shows | Real example |
|---|---|---|
| Cost page | Net total by production, retrofit, support; savings in parentheses | MIL-HDBK-61A App. B |
| S-curve | Confidence vs total cost, point estimate marked | Point estimate $2.47B at about 15% (GAO Fig. 15) |
| Confidence sentence | "X% likelihood cost is $Y or less" | 80% confidence means budgeting $2.79B, about $320M over (GAO) |
| Contingency | Percentile minus point estimate | P70 $1,096K, $271K over (GAO p. 145) |
| Tornado | Biggest drivers by swing | Learning slope 88% vs 91% = $60M (GAO Fig. 11) |
| Cost vs date scatter | One dot per trial with a JCL percentage | NASA AIAA paper Fig. 2; "seldom used when reporting to management" |

The phrasing in the sources is plain: "the likelihood is about 15 percent that the program will cost $2.47 billion or less". Management picks the confidence level; the analyst reports the full curve and where the point estimate sits on it (GAO-20-195G p. 158).

## 8. What this means for Norn (recommendations)

These are recommendations drawn from the sections above, not decisions. Stage names refer to `ARCHITECTURE.md` §5.

1. **Shape S2 like the ECP cost page:** rows for production, retrofit and support; columns for one-time vs recurring unit x quantity; savings in parentheses. (§1)
2. **Add an inventory disposition table** with the five locations (stores, WIP, finished goods, in field, on order) and disposition codes. Treat use-up vs scrap as a decision with its own cost swing on the tornado. (§1, §3)
3. **Treat the supplier quote as a `given` input** and should-cost and learning as cross-checks. Flag an ECR with a piece-cost change but no quote. (§3)
4. **Model certification as two classification fields plus test effort:** company Class I/II and FAA major/minor, set separately. No DER step. (§4)
5. **Let the impact screen propose a fast-track route** using the published "never fast-track" list as hard rules. Make the dollar tiers configurable, defaulting to $150,000 and $2,000,000. (§2, §4)
6. **Fit p10/p90 as quantiles, not bounds.** Lognormal for open-ended costs and lead times; PERT or triangular for bounded items; a wider default spread (0.25 log-space) for `agent_estimated` inputs. (§5)
7. **Correlation:** 0.3 within groups (same supplier, same material, shared labor), 0 across; prefer structural models where possible. (§5)
8. **10,000 paired draws** with a convergence check on P80/P90 across two seeds. (§5)
9. **S3 effectivity as a small network** with max at merges, an effectivity-date S-curve, and criticality plus duration sensitivity per step. (§5)
10. **Keep disruptions out of the headline range.** Show named scenarios ("if Supplier A is down 6 weeks, cut-in moves to ...") and a TTS-vs-TTR line per single-source part. (§6)
11. **Card outputs:** S-curve with the point estimate's percentile marked, a tornado of the top 2-4 drivers, a percentile table, a confidence sentence and a contingency line. (§7)
12. **Say "JCL-style", not JCL,** unless cost is driven by schedule duration. (§5)
13. **Pitch the waiting, not the hours.** No source measures analyst hours per assessment; the measured problem is months of queueing and stitching. (§2)

## 9. Gaps and what we couldn't verify

- **Hours per assessment:** no aerospace figure anywhere; Ascom found it too costly to collect.
- **Internal OEM procedures:** none published; the step table is built from government sources and one case study. DD 1692 block numbers are unconfirmed (PDF blocked, copies conflict).
- **Fast-track share:** 75-85% comes from secondary and vendor sources only; no named aerospace OEM figure.
- **"Rule of 10" for cost of change:** cited secondhand to VDI 2247. NASA JSC measured 1 (requirements) to 21-78 (integration and test) to over 1,500 (operations). Don't state it as a law.
- **Excel use:** plausible, not demonstrated; supply-planning surveys (35-78%) are vendor-sponsored.
- **Historical actuals in pricing:** no primary source on how they are pulled. Same for disruption probabilities and supplier capacity values.
- **Planning-suite internals:** SAP IBP, Kinaxis, Coupa, anyLogistix features are secondary or vendor; o9 not checked.
- **Blocked documents:** current NPR 7120.5 text, GAO schedule guide PDF (merge-bias figures are secondary), AFCAA 2007 handbook, the HBR 2014 TTR article, the AIAG PPAP manual.
- **Pre-certification changes:** whether 21.93 applies before Bowman holds a type certificate is inferred; check Order 8110.4C.
