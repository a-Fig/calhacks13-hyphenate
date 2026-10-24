# How cost, schedule and supply-chain risk simulations are done in practice

Researched 2026-10-24 by a Sonnet research agent.

Source tags: **[P]** primary document I opened and read (page or section given). **[S]** secondary or search-result summary only, not opened by me. **[V]** vendor marketing. **[I]** my inference or my own computation. Access dates are 2026-10-24 for every URL. The publication date follows each source.

## Bottom line

1. **Cost and schedule risk analysis has a settled recipe, and it is simple.** Each WBS element or task gets a three-point or lognormal distribution. Related elements get a modest correlation (the DoD/NASA handbook default is 0.3). A Monte Carlo run of about 10,000 trials sums them. The output is an S-curve plus a percentile table, a tornado chart, and a statement of the form "X% confident at $Y". Contingency is the percentile estimate minus the point estimate. [P] GAO-20-195G ch. 12; Joint Agency handbook ch. 2-4.
2. **The point estimate sits low.** In GAO's worked UAV example the point estimate ($2.47B) is only about the 15th percentile. P50 is $2.61B and P80 is $2.79B. Norn's "baseline sum vs p50" gap is exactly what real analysts show. [P]
3. **Ignoring correlation is the classic error.** The handbook shows a 0.3 correlation across five elements raises the total standard deviation by 46% compared with independence. My own 10-item run (below) doubles it. This matters at p80/p90 and barely at p50. [P], [I]
4. **"Supply-chain simulation" means two different things in practice.**
   - (a) Stochastic simulation of lead time, demand and inventory (anyLogistix, inventory optimisation, academic Monte Carlo).
   - (b) Deterministic disruption stress tests with no probabilities, such as Ford's time-to-recover (TTR) and time-to-survive (TTS) model. [P] Simchi-Levi et al. 2015.
   - Planning suites (SAP IBP, Kinaxis) are mainly versioned what-if on deterministic plans. I found no primary documentation of Monte Carlo in them. [S]
5. **Disruption events are kept out of the baseline uncertainty on purpose.** The Joint Agency handbook says natural disasters, bankruptcies and similar events "should generally be excluded" from the uncertainty model and shown as separate sensitivity cases (§1.3.4). Ford's method deliberately skips event probabilities and asks "what if this node is down for N weeks". Norn should show disruption results as conditional scenarios next to the baseline distribution, not blended into one headline p90. [I], grounded in [P]
6. **Excel plus add-ins is the documented norm in DoD cost estimating.** The handbook names Crystal Ball and @RISK (Excel-based) and ACE. I found no neutral data on mid-size manufacturers. Vendor-sponsored surveys put spreadsheet use in supply planning at 35-78%. [P], [S]
7. **Recommendation:** copy PERT or lognormal marginals, a 0.3 default correlation, 5,000-10,000 paired draws, and the fixed output set (S-curve, tornado, percentile table, "70% confident" sentence). See §7.

---

## 1. Probabilistic cost and schedule analysis in aerospace and defense

### 1.1 NASA JCL

- **Policy.** NASA Science Mission Directorate SPD-19 (approved 2010-06-18) quotes NM 7120-81 (the NPR 7120.5D interim directive):
  - §2.1.8.5(a): programs are "baselined or rebaselined and budgeted at a confidence level of 70 percent or the level approved by the decision authority".
  - §2.1.8.5(c): projects are funded "as a minimum" at the 50 percent level.
  - Joint cost and schedule confidence levels (JCLs) are developed at the life-cycle baseline. [P] https://discovery.larc.nasa.gov/PDF_FILES/SPD-19_PI-ledmissions_70JCL.pdf (2010)
- **Current text.** NPR 7120.5E reportedly carries the 70% target and a 2019 memo tightened JCL requirements for projects over $1B. I did not open the NPR itself. [S] The NASA JCL page and search summaries do not confirm which revision is current. I did not check NODIS.
- **Definition.** JCL is the probability that cost is at or below target and finish is at or before target. A NASA HQ cost analyst and a Tecolote director explain this in an AIAA paper (undated PDF, cites 2011 sources). [P] https://ntrs.nasa.gov/api/citations/20250002084/downloads/UnderstandingResultsIntegratedCostScheduleRisk_JKJ.pdf
  - The JCL is "the total percent of results" falling in the quadrant at or below both the cost and schedule targets.
  - The paper's Figure 2 example has a point-estimate JCL of 6.2%.
  - The "frontier curve" is the set of cost/date pairs that give a target JCL, such as 70%.
- **Handbook figure.** In the Joint Agency handbook's FICSM example (1,500 trials), 0.8% of trials fall under both the point-estimate cost and finish date. At 60% cost and 60% date the JCL is 43.4%. The handbook says these scatter plots "are seldom used when reporting to management" and are for analyst validation (App. B §B.6.2). [P]
- **Lognormal basis.** The AIAA paper notes the Aerospace Corporation and MITRE showed in the 1990s that lognormals can represent cost and schedule, and that convolving them gave the first joint analyses (footnote 3). [P]

### 1.2 Joint Agency Cost Schedule Risk and Uncertainty Handbook (DoD and NASA, 2014-03-12)

PDF copy: https://mosaicprojects.com.au/PDF-Gen/CSRUH.pdf. The date comes from the GAO citation. I did not find the official host. [P]

- **Distributions (§2.3.3, Table 2-2).**
  - Lognormal is the default "in the absence of better information", since an analysis of 1,400 fits found it dominant.
  - If the distribution is known to be left-skewed, use betaPERT.
  - Triangular is listed next, "due to its simplicity and popularity".
  - Uniform was never the best fit. Normal rarely was.
- **Expert bounds (§2.5.2-2.5.3).** Treat SME min/max as the 70% interval, meaning the 15th and 85th percentiles for symmetric shapes, unless told otherwise. GAO says expert opinion captures only 60-85% of the true range (fn. 34, p. 146). [P] Implication for Norn: p10/p90 from an agent or human should not be used as the absolute min/max of a triangular.
- **Last-resort dispersion (Table 2-9).** Lognormal log-space standard error of 0.15 (low), 0.25 (medium), 0.35 (high), 0.45 (extreme). [P]
- **Risk register events (§2.7.2).**
  - Few events: show them as separate what-if cases, not expected value. "Funding at the expected value... is not recommended."
  - Many events: model each as Yes/No (Bernoulli) times an impact distribution. The worked example has a 30% occurrence probability that is itself a betaPERT, and a lognormal impact with a $50K median.
  - Apply uncertainty to both likelihood and impact. [P]
- **Correlation (ch. 3.3).**
  - First measure the correlation the model already has from functional relationships, then add more.
  - Default 0.3, with a table of 0.0 / 0.3 / 0.5 / 0.9. "Perfect correlation of +/-1.0 is discouraged."
  - Earlier references suggested 0.25, 0.45 or 0.63.
  - Spearman rank correlation is used (§A.11.6). Tools differ on empty matrix cells (Crystal Ball fills them, @RISK needs all cells, ACE treats blanks as zero).
  - With five elements at 0.3 correlation, the summed standard deviation is 106.7 against 73.0 if independent, an understatement of 46%. [P]
- **Trials (§3.4.3).** 10,000 is the recommended default unless a convergence test shows fewer are acceptable. In the example, 5,000 trials were needed for convergence but 500 gave a decent picture. Latin Hypercube sampling is recommended, and @RISK and ACE fix the partitions to the trial count. [P]
- **Tools (§1.4.1).** Crystal Ball and @RISK (Excel-based) and ACE (DoD-funded) for cost models. Primavera Risk Analysis, @RISK for Project, Risky Project, ACEIT/JACS, Acumen Fuse and Polaris for schedule-integrated models. The handbook says it does not recommend any specific tool. [P]
- **Output set (ch. 4.1).** Minimum presentation: distribution parameters, S-curves per uncertainty group, cost-vs-schedule scatter, Pareto of top WBS elements, tornado, sensitivity chart. [P]

### 1.3 GAO Cost Estimating and Assessment Guide, GAO-20-195G (March 2020)

Read from the DOE-hosted copy: https://www.energy.gov/sites/default/files/2024-08/gao-20-195g.pdf [P]

- **Method (ch. 12, p. 144).** Assign distributions to WBS elements or risk drivers, draw, sum, repeat "thousands of times". The total "tends to be a lognormal distribution because many of the underlying distributions tend to be skewed to the right".
- **Three-point method (p. 146-148).** Min / most likely / max per WBS element, "typically represented as triangular distributions".
  - UAV example: 32 air vehicles, $77M each, $2.47B point estimate.
  - P50 = $2.61B ($140M over the point estimate). P80 = $2.79B (about $320M over). The point estimate is about the 15th percentile.
  - GAO warns three-point ranges cannot be attributed to individual risks.
- **Risk-driver method (p. 149).** Each risk has a probability and a multiplicative impact factor (min / most likely / max) assigned to several WBS elements. If it fires in an iteration it fires on all of them, which creates correlation without a pairwise matrix. The example gave a wider spread than three-point.
- **Correlation (p. 155-158).**
  - The 90% correlation example moved P80 by only $24M and P50 by $1M.
  - GAO says to model dependencies structurally first, for example training cost as a factor of hardware cost.
  - "Correlation should never be ignored."
  - It cites 0.3 as the handbook default.
- **Confidence level (p. 158).** No level is a best practice. "Budgeting to the mean of the S curve is a common practice." For high-risk programs 70-80% is suggested, with a warning that budgeting every portfolio project at a high level becomes unaffordable.
- **Contingency.** Contingency is the percentile estimate minus the point estimate (p. 158). The S-curve illustration reads: P70 = $1,096,000, which is $271,000 above the point estimate, and P50 = $908,000 (p. 145).
- **Distribution table (App. X, Table 48).** Triangular, lognormal, beta, uniform, normal. Triangular is "also used to determine schedule uncertainty". [P]
- **Sensitivity (ch. 11, Fig. 12).** The tornado chart "shows which parameters have the greatest effect" on the estimate. Figure 11's what-if shows that using an 88% learning curve instead of 91% cuts the estimate by $60M while a materials-quality change adds $1.668M. [P]

### 1.4 AFCAA

The Air Force Cost Risk and Uncertainty Analysis Handbook (CRUH, 2007) is the DoD ancestor. I checked only its EverySpec listing (https://everyspec.com/USAF/USAF-General/USAF_COST_RISK_UNCERTAINTY_HDBK_2007_30554) and did not open the PDF. The 2014 Joint Agency handbook says "the AFCAA CRUH recommend[s] lognormal should be the default distribution". [S] for the CRUH itself, [P] for the quote.

## 2. Schedule risk analysis

- **Method.** Put three-point durations on tasks. Each trial draws all durations, recomputes the critical path (CPM), and records the finish date. After thousands of trials the output is a finish-date S-curve and a criticality index per task. GAO's Schedule Assessment Guide (GAO-16-89G, 2015-12-22) says the accepted way to get the distribution of total duration is "a Monte Carlo simulation of the schedule with uncertainty and risk applied". Source: https://www.gao.gov/products/gao-16-89g [S] (landing page opened; the PDF returned Access Denied).
- **Merge bias.** At a merge point, finish time is the latest of the incoming paths. The expected finish of a merge is therefore later than any single path's, and the effect grows with the number of parallel paths. GAO's example: two parallel paths each 60% likely on time give 36% for the milestone. https://gaoinnovations.gov/schedule-guide/merge-bias-and-schedule-underestimation.html [S] (search summary; page fetch returned 403).
  - My own check [I]: two paths, each four tasks of triangular(8, 10, 16) days. The path mean is 45.3 days. P50 of one path is 45.2 and P50 of the merged finish is 47.1. The chance the merge finishes by one path's P50 is 25%, not 50%. P80 moves from 48.2 to 49.7.
  - A deterministic CPM using modes (40 days) is met 0.2% of the time.
- **Criticality and sensitivity outputs** (NASA AIAA paper, §III.B). [P]
  - Criticality Index: the share of trials in which a task has total float of 0 or less.
  - Duration Sensitivity: the correlation between a task's duration and total duration.
  - Cost Sensitivity: the correlation between task cost and total cost.
  - Duration-to-Cost Sensitivity: the correlation between a task's duration and total cost.
  - Discrete Risk Criticality: how often a risk event is on the critical path when it occurs.
  - The paper warns that a one-day task can show a 100% criticality index yet hardly move the finish date. A criticality index is not an impact measure. A search summary of Wikipedia says the same, so also report duration sensitivity.
- **Tools.**
  - Primavera Risk Analysis (formerly Pertmaster), Safran Risk, @RISK for Project, Acumen Fuse, Polaris. I found no Oracle documentation, only third-party mentions. [S]
  - Safran Risk lists Monte Carlo cost and schedule, risk registers, P6 and MS Project import, and risk correlation. All vendor or reseller claims. [V] https://www.proadvise.com/en/products/safran-risk
  - @RISK Schedule Risk Analysis imports MS Project or P6 schedules into Excel, with "probabilistic Gantt chart views" and integrated cost and schedule. [V] https://help-risk.lumivero.com/v8_3/en/@RISK/6-Schedule/About-Schedule-Risk-Analysis.htm
- **Integrated cost and schedule.** AACE RP 57R-09 (Hulett and others) runs Monte Carlo on a resource-loaded CPM schedule with risk drivers so that schedule slip raises cost. A 2025 AACE abstract criticises its handling of confidence levels. [S] Not opened.

## 3. Supply-chain risk and simulation in practice

### 3.1 Planning suites: what they actually run
- **SAP IBP.** Versions are long-lived plans. Scenarios are on-the-fly copies within a version. Simulations are unsaved calculations that can be promoted to a scenario. Planners change capacity, cost or demand and rerun heuristics. [S] SAP Learning https://learning.sap.com/courses/mastering-sap-ibp-for-response-and-supply-order-based-planning/versions-and-scenarios (my fetch returned 404; I rely on the search summary) and https://blog.sap-press.com/sap-ibp-supply-planning-how-to-run-supply-simulations. IBP Inventory Optimization computes multi-echelon safety stock from demand and supply variability, apparently with analytical normal and gamma formulas. I could not confirm whether it uses Monte Carlo. [S][V]
- **Kinaxis RapidResponse.** Concurrent what-if scenarios: change a supplier lead time, capacity or demand and see shortages across the network. The Deere deployment report describes simulating component shortages and adjusting schedules. [S] https://www.controleng.com/john-deere-starts-up-five-plant-response-management-deployment/. I found no step-by-step documentation. These are deterministic scenario engines, not stochastic. [I]
- **Coupa Supply Chain Design (ex-LLamasoft) and anyLogistix/AnyLogic.**
  - Coupa pitches a "digital twin" with scenarios and simulation [V]. I could not confirm Monte Carlo features.
  - anyLogistix's help lists a "SIM Risk Analysis" example with "special events" for predicted disruptions in a simulation scenario. [S] https://anylogistix.help/examples/sim-risk-analysis.html (blocked by Cloudflare for me, so this comes from a search summary).
  - A review aggregator says the experiment framework includes Monte Carlo and sensitivity runs. [V]
- **o9.** Not searched. No claim made.
- **Baseline MRP is deterministic.** Course notes and ERP docs describe fixed planned lead times, with variability hidden by padding lead times and safety stock. [S] https://ocw.mit.edu/courses/2-854-introduction-to-manufacturing-systems-fall-2016/4eec617bb52d64f4ea1bed6d9905bc00_MIT2_854F16_MatrialRequire.pdf; https://docs.infor.com/csi/10.x/en-us/csbiolh/inventory_user_cl_sl/lsm1454144399363.html

### 3.2 Inputs
- **Lead-time distributions.** A 1980s Air Force study found procurement lead times fit lognormal, gamma, normal or Weibull. Tadikamalla (1984) found normal and logistic inadequate when the coefficient of variation is large. [S] https://core.ac.uk/works/3118066, https://apps.dtic.mil/sti/pdfs/ADA089184.pdf
- **Safety stock** is textbook: variance of demand during lead time is about L̄σ_d² + d̄²σ_L². This is my recollection and was not in the sources. [I]
- **Supplier capacity, disruption probabilities.** I found no primary source giving typical values. Resilinc, Interos and Everstream publish risk scores and event alerts rather than distributions. The sources are vendor pages and reviews. [V] Interos's "i-Score" is described as a composite across finance, cyber, ESG, restrictions, geopolitical and catastrophic risk. https://erpresearch.com/erp-add-ons/supplier-management/interos. Resilinc EventWatch is described as event tracking with multi-tier mapping. https://resilinc.ai/?p=25452. Everstream's score format was not documented in anything I found.

### 3.3 Single-source exposure, TTR, TTS (Simchi-Levi)
Primary source: Simchi-Levi, Schmidt, Wei, Zhang, Combs, Ge, Gusikhin, Sanders, Zhang, "Identifying Risks and Mitigating Disruptions in the Automotive Supply Chain", Interfaces 45(5), Oct 2015, pp. 375-390. Open author manuscript: https://dspace.mit.edu/server/api/core/bitstreams/a69665fc-6dbb-43b5-933e-d6658d8acdcc/content [P]

- **Scale.** Ford has over 50 plants, 35 billion parts a year, up to 10 supplier tiers, and 1,400 Tier 1 companies across 4,400 sites. The 2011 Thailand floods hit a second-tier supplier and idled a profitable line.
- **No probabilities by design.** The model "defers the need to estimate the probability associated with any specific risk". The impact "often does not depend on the cause of the disruption but rather on its duration".
- **TTR model.** The supply chain is a graph of nodes (a part or process at a facility) with inventory and unit-profit inputs. The model "iterates over each node", disrupts it for its TTR, then solves a linear program for the best response (reallocate inventory, redirect supply, idle plants). The output is a performance impact (PI), such as lost units or lost profit. The risk-exposure index (REI) is each scenario's PI divided by the maximum PI over all scenarios.
- **TTS** is "the maximum amount of time the system can function without performance loss if a particular node is disrupted", computed by optimisation. Suppliers tend to give optimistic TTRs, so Ford asks for TTR detail where TTS is short. If TTS far exceeds TTR, the TTR estimate matters little. Many suppliers had TTS under a week (Fig. 1). Nodes with very high TTS suggest wasteful buffers.
- **Finding.** The largest exposures sat in cheap commodity parts (MIT News, 2022-06-15, notes components costing about 10 cents). High-spend strategic suppliers had moderate exposure. A plot of PI against spend segmented suppliers into mitigation groups. Typically a strategic component has a single strategic supplier. [P] https://news.mit.edu/2022/companies-use-mit-research-identify-respond-supply-chain-risks-0615
- **Other users.** Schneider Electric uses TTR and TTS to decide where to add inventory and develop second sources (quote from its North America CEO, MIT News). [P]
- **HBR 2014.** I did not open the HBR article. Conference Board and Purdue pages summarise it. [S] https://conference-board.org/blog/postdetail.cfm?post=3746. A Purdue page reports a 10-day outage at a wafer plant could mean 6-12 months of recovery. https://business.purdue.edu/news/features/2026/from-ttr-tts-to-ai-driven-supply-chains-david-simchi-levi.php [S]
- **Aerospace Monte Carlo.** An MIT thesis ran a stochastic simulation of a space-vehicle supply chain, with late-supplier-part scenarios and confidence percentiles on total duration. I saw only the abstract. https://dspace.mit.edu/handle/1721.1/61189 [S]

## 4. Production cost forecasting

- **Learning curve (GAO ch. 10, App. VII).** Unit formulation Y = A·X^b, with b = log(slope)/log 2. A 90% slope with 1,000 hours for unit 1 gives 900 for unit 2, then each doubling cuts by the slope. Slope comes from historical lots, company history, analogous programs or industry (aircraft, electronics, shipbuilding). The guide covers the cumulative-average (Wright) alternative and says unit theory suits a well-prepared production start, while cumulative-average smooths early noise with prototype tooling or an immature supplier base. It also says learning applies only to recurring cost. [P]
- **Rate effect.** Y = A·X^b·Q^r, where Q is the production rate and r the rate coefficient. Costs fall as rate rises, until nominal capacity is exceeded and overtime or hiring raises them. Production breaks add cost. This is the Anderlohr method in App. VII. [P]
- **EVM estimate at completion (GAO ch. 19, pp. 265-266).** EAC = ACWP + (BAC - BCWP) / efficiency index. The index is cumulative CPI (assumes the same efficiency to the end, "typically forecasts the lowest possible EAC"), 3/6/12-month average CPI, CPI x SPI, or a weighted CPI/SPI mix. The cited studies find no single best index. A 50/50 CPI/SPI weighting is "statistically the most accurate" in the middle of a program. Best practice is to compute a range of EACs. [P]
- **Standard cost roll-up.** In SAP (CK11N), a standard cost estimate with quantity structure explodes the BOM and routing, then values components and activities by a price strategy. Only BOMs and routings with the 'Release for Costing' status are costed. [S] https://help.sap.com/doc/saphelp_470/4.7/en-US/90/ba6124446711d189420000e829fbbd/content.htm (SAP 4.7 help, old), https://blogs.sap.com/2014/01/19/sap-product-costing-overview/
- **Where it meets risk.** The handbook says to model dependencies functionally (hours x rate, scrap x material) before adding correlation, and treats production quantity as discrete what-if cases, not a distribution (§1.3.5). [P]

## 5. Excel reality

What I checked: the Joint Agency handbook, Palisade/Lumivero pages, and search for supply-planning surveys.

- **DoD and NASA cost community.** The handbook names Crystal Ball and @RISK as "Excel-based general-purpose commercial risk and uncertainty modeling tools", plus ACE. These are "in common use and widely accepted". It also says the schedule-integrated tools are add-ins or stand-alone importers. [P]
- **@RISK reach.** Lumivero's 2022 brochure claims over 150,000 users, including aerospace. [V] https://palisade.lumivero.com/wp-content/uploads/Palisade_Overview_Brochure_2022.pdf. I found no independent adoption data.
- **Spreadsheets in supply planning.** All of the following came from search summaries (not opened) and are from vendor or sponsored surveys:
  - Plex/Rockwell (2022, 300+ leaders): 70% use planning systems relying on spreadsheets and manual processes.
  - Supply Chain Insights for AIMMS: 65% use spreadsheets for network design.
  - Kinaxis cites unnamed surveys at roughly 50-78%.
  - CEL: 35% on Excel versus 30% on dedicated planning software.
  - [S][V] https://www.supplychain247.com/article/isnt_it_time_to_finally_retire_your_supply_chain_spreadsheets (page returned 403 to me), https://www.kinaxis.com/en/node/3699, https://news.lokad.com/posts/38. The Rockwell page I opened did not contain the quoted statistic.
- **Not found:** any neutral survey on Excel versus dedicated tools for risk simulation at mid-size manufacturers. Treat "mostly Excel" as plausible [I], not demonstrated.

## 6. What a good output looks like

Per Joint Agency handbook ch. 4 and GAO ch. 12 [P]:

| Artifact | What it shows | Real example |
|---|---|---|
| S-curve (cumulative distribution) | Confidence vs total cost, with the point estimate marked on it | GAO Fig. 15: point estimate $2.47B is at about 15%; $2.61B at 50%; $2.79B at 80% |
| Confidence statement | "X% likelihood cost is $Y or less" | GAO: a manager wanting 80% confidence would budget $2.79B, about $320M over the point estimate |
| Contingency | Percentile estimate minus point estimate | GAO: P70 $1,096K, i.e. $271K over the point estimate |
| Tornado | One input at a time at its P10 and P90, others fixed, ranked by swing | Handbook §4.1.5. The handbook says a tornado alone is insufficient (inputs vary one at a time) and suggests pairing it with sensitivity or Pareto charts |
| Cost vs date scatter | One dot per trial, crosshairs at the targets, a JCL percentage, optional 70% frontier | NASA AIAA paper Fig. 2 |
| Pareto of elements | Biggest cost elements | Handbook Fig. 4-3 |
| Criticality index | Share of trials a task is on the critical path | NASA AIAA paper Fig. 4 |
| Distribution table | Each input with shape and parameters | Handbook Table 2-10 |

- **Contingency read-out.** Management picks the confidence level (GAO p. 158). The analyst's job is to report the full S-curve and the cumulative probability of the point estimate.
- **Finance-reader phrasing** in the sources is plain: "the likelihood is about 15 percent that the program will cost $2.47 billion or less". Norn's card should use this form.

## 7. Implications for Norn (my recommendations)

Current plan (ARCHITECTURE §3, §5): p10/p50/p90 per line item, a critical path for effectivity, and a paired Monte Carlo supply simulation. This is close to practice. Suggested adjustments, each labelled [I] unless cited:

1. **Distribution per input.** Use triangular(min, mode, max) or PERT for bounded engineering items, and lognormal for open-ended cost and lead-time items. The handbook's default is lognormal. PERT is for left-skew. Triangular is the one finance readers recognise. My run for (10, 12, 24): triangular P10/P50/P90 = 11.7 / 14.8 / 19.9 with mean 15.3; PERT = 10.9 / 13.3 / 17.0 with mean 13.7. PERT is tighter and lower.
   - A small PERT warning: PERT with shape 4 understates tails for wide, skewed ranges. Vose's modified PERT uses shape other than 4. [S] https://en.wikipedia.org/wiki/PERT_distribution
2. **Do not read p10/p90 as hard bounds.** The handbook treats SME bounds as 15th/85th percentiles. If agents produce p10/p90, fit a lognormal or PERT to those quantiles instead of using them as min and max.
3. **Mark `agent_estimated` inputs as such and show a wider range** (the handbook's Table 2-9 "last resort" dispersion: 0.25 log-space for medium). This matches the plan to flag low-confidence assumptions.
4. **Correlation: default 0.3 within groups.** Same-supplier items, same-material price drivers, and shared labour productivity get 0.3 to 0.5. Cross-group stays at 0. Better still, model structurally (labour hours x rate x learning slope), which creates correlation for free (GAO p. 157). Run a rank-correlation transform such as Iman-Conover ([S] https://casact.org/pubs/forum/06wforum/06w107.PDF says @RISK uses it) or a one-factor Gaussian copula.
   - My 10-item run of triangular(10, 12, 24), sum, 20,000 trials:

     | Correlation | P10 | P50 | P80 | P90 | SD |
     |---|---|---|---|---|---|
     | 0 | 141.0 | 153.1 | 161.7 | 166.2 | 9.8 |
     | 0.3 | 130.1 | 152.1 | 169.3 | 178.7 | 18.7 |
     | 0.6 | 123.2 | 150.9 | 175.1 | 188.3 | 24.5 |

     The sum of the 10 modes is 120, which sits below the independent P10 of 141.
5. **Draws.** 5,000-10,000 trials with Latin Hypercube sampling is the documented standard. The browser or worker can do 10,000 draws over a few hundred inputs in well under a second [I]. Check convergence of P80/P90 across two seeds and show it on the card.
6. **Paired draws for forecast diffs.** Your design already does this. The handbook has no explicit paired-difference method; the nearest practice is running scenario and baseline from the same model and seed. Keep it, and report the P(delta > 0) too. [I]
7. **Schedule.** Model effectivity as a small network (requalification, tooling, supplier lead time, old-inventory burn-down) with three-point durations. Take max at merges (this is where merge bias appears), report the effectivity date S-curve, and list a criticality index per step. Report duration sensitivity beside it, since criticality alone misleads.
8. **Disruptions.** Follow both the Joint Agency handbook and Ford:
   - Keep disruption events out of the headline distribution. Show "if supplier X is down N weeks, the effectivity date moves to ..." as named scenarios.
   - If you must use probabilities, use a Yes/No risk event with uncertain likelihood and impact (handbook §2.7.2).
   - Add a TTS-vs-TTR line per sole-source part: inventory cover (weeks) against supplier recovery estimate. It is cheap, grounded, and explainable to a finance reader.
9. **Lead times.** Lognormal or gamma, fitted from receipts if you have them. For the fake data, document the assumed coefficient of variation.
10. **Outputs to copy.** S-curve for cost delta and for effectivity date, tornado at P10/P90 (the two to four biggest drivers), a percentile table, and sentences of the form "70% confident the per-unit cost increase is under $X; 15% chance it is zero or negative". Add the contingency line: P70 minus the point estimate. A cost-vs-date scatter with a JCL percentage is a good optional extra.
11. **What not to claim.** Do not say Norn replicates JCL unless you do a cost-loaded schedule with duration-driven cost. Say "JCL-style".
12. **Learning curve and rate.** Use Y = A·X^b with a stated slope as an uncertain input (slope itself gets a distribution; 88% vs 91% was a $60M swing in GAO's example). Add a rate term only if the volume plan changes capacity.

## Gaps (what I checked and could not confirm)
- NPR 7120.5 (current revision) text: not opened. Used SPD-19's quotation of NM 7120-81.
- GAO-16-89G (Schedule Guide): full PDF blocked (Access Denied / 403). Merge bias and Monte Carlo statements come from search summaries of the GAO web edition. The "80 percent" confidence-level language in best practice 6 is not verified.
- Oracle Primavera Risk Analysis, Safran Risk, Kinaxis and anyLogistix documentation: not retrieved or blocked. Features listed are vendor or reseller claims.
- o9 and Coupa Monte Carlo capability: not confirmed.
- AFCAA CRUH 2007: not opened.
- HBR 2014 article text: not opened.
- Neutral evidence on Excel versus dedicated tools in mid-size manufacturers: none found.
- Disruption-probability and supplier-capacity input values: no primary source found.
