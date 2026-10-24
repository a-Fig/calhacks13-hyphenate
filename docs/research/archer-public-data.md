# Archer Aviation: public data for modelling Bowman

Researched 2026-10-24 by a Sonnet research agent from SEC filings, Archer releases, FAA documents and job postings. Figures are as of the source dates given.

"(press)" marks a figure I did not verify against a primary document. Archer's filings contain no battery kWh, empty weight, wingspan, unit cost, production rate or count of aircraft built.

**Three things to know first**
- **Aircraft, production and unit-cost numbers:** Archer's filings contain **no** battery kWh, empty weight, wingspan, unit cost, production rate or count of aircraft built. I searched the FY2025 10-K and every letter for "kWh", "per year", "per month" and "conforming". The only per-aircraft price is an "indicative $5M" in a footnote.
- **Production targets were dropped:** The FY2024 10-K (2025-02-28) stated a 350,000 sq ft Covington plant, 650 aircraft per year, and 2,000+ per year after expansion. The FY2025 10-K (2026-03-02) dropped all of those numbers.
- **Archer has no production aircraft:** Midnight is still pre-type-certification. Archer's only revenue is airport revenue from Hawthorne, so "an aircraft in production" has to be fictional.

## 1. Aircraft

**Midnight (piloted air taxi, in certification)**
- **Seats and weight:** Pilot plus 4 passengers. Maximum gross takeoff weight is 6,500 lb. The layout is high wing, V-tail and fixed tricycle gear. Structure and propellers are composite. The source is the FAA final airworthiness criteria for model M001, [Federal Register 2024-11192](https://public-inspection.federalregister.gov/2024-11192.pdf) (published 2024-05-24, effective 2024-06-24). Intended use is Part 91/135, single pilot, VFR.
- **Motors:** 12 electric motors, the "12-tilt-6" layout. Six forward motors tilt and drive 5-blade variable-pitch propellers. Six aft motors are fixed, provide lift only, and are shut off and faired in cruise (same FAA document).
- **A real design change:** The FAA text describes the aft propellers as 2-bladed. The Q4 2025 shareholder letter ([SEC exhibit, 2026-03-02](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000017/archerlettertoshareholde.htm)) says Archer evaluated 2-, 3- and 4-blade options and "chose four blades". Two blades needed dampers (weight) and four added drag. I infer this is a post-G-1 design change. It is a ready-made ECR story.
- **Payload, range, speed, mission:**
  - Payload is over 1,000 lb, range up to 100 miles, and the mission is back-to-back ~20-mile legs with ~10-minute charging ([Q2 2022 letter](https://www.sec.gov/Archives/edgar/data/1824502/000162828022022210/q22022exhibit991.htm)).
  - Flights since then reached over 50 miles, over 30 minutes, over 10,000 ft and 150 mph ([Q4 2025 letter](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000017/archerlettertoshareholde.htm)). The Q1 2026 letter widened the mission to ~20-50 miles.
- **Battery:**
  - Lithium-ion, with Molicel cells under a [Nov 2022 MOU](https://investors.archer.com/news/news-details/2022/Archer-Selects-Molicel-to-Supply-Battery-Cells-for-its-Production-Midnight-Aircraft/default.aspx). The pack line is in San Jose.
  - **Capacity is not disclosed by Archer.** An aggregator, [ev.motorwatt.com](https://ev.motorwatt.com/ev-database/flying-electric-vehicles/archer-midnight), gives 142 kWh across 6 packs (press). [Airforce-technology](https://www.airforce-technology.com/projects/midnight-evtol-aircraft-us/) gives "Olympus", 800 V, 1,300 kW, 6 packs each powering a pair of motors, and over 3,000 cycles (press). Treat both as unverified.
- **Certification-basis simplicity:** The Q4 2025 letter says Midnight needs "17 issue papers", 13 industry-standard and 4 unique to the design and battery pack. It also says Midnight is "as close to a Part 23 airplane as possible" and that Archer vertically integrated only the powertrain and flight-control software.
- **Maker:** The earlier demonstrator. Old [AOPA profile (2023-02)](https://www.aopa.org/news-and-media/all-news/2023/february/pilot/future-flight-archer-aviation) figures are ~40 ft span, ~3,325 lb and ~75 kWh (press, old).

**Halo / Thunder (hybrid-electric, autonomous, development)**
- **What it is:** Clean-sheet Group 5 VTOL with Anduril. It was unveiled at Farnborough in July 2026. Thunder is the defense variant (loyal wingman for attack helicopters) and Halo is the commercial one (cargo and rescue). They share airframe, hybrid powertrain and core systems ([Q2 2026 letter](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000056/archerlettertoshareholde.htm), 2026-08-10).
- **Timeline:** A summary of the Q2 call ([Motley Fool, 2026-08-17](https://www.fool.com/earnings/call-transcripts/2026/08/17/archer-aviation-achr-q2-2026-earnings-call-transcript/)) says first flight next year, customer deliveries in 2029 and scaling in 2030 (press; I did not read the full transcript).
- **Earlier framing:** The FY2024 10-K called it a "hybrid-propulsion, Midnight-like" aircraft. It reuses commercial parts and supply chains.
- **Acquired IP:** Overair patents and a Karem tiltrotor license (FY2025 10-K), plus Lilium's patents for $21M (Q3 2025 letter, 2025-11-06).

**Other products**
- Archer's powertrain was chosen for Anduril and EDGE's Omen drone (Nov 2025, FY2025 10-K).
- ZEE is an aviation AI model, not an aircraft.

## 2. Production

**Facilities**
- **Silicon Valley:** The "golden manufacturing line" does final assembly of early Midnights. It also makes the electric powertrain and battery packs. The HQ address on recent 8-K covers is [190 W Tasman Dr, San Jose](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000078/achr-20260929.htm).
- **Covington, Georgia ("ARC"):**
  - Construction was completed in December 2024 and production started in Q1 2025 ([Q2 2025 10-Q](https://www.sec.gov/Archives/edgar/data/1824502/000162828025039622/achr-20250630.htm)).
  - The FY2024 10-K said 350,000 sq ft, designed for up to 650 aircraft per year, expandable to ~900,000 sq ft for 2,000+ per year ([10-K, 2025-02-28](https://www.sec.gov/Archives/edgar/data/1824502/000162828025008823/achr-20241231.htm)).
  - The state's 2022 announcement was $118M invested and 1,000 jobs over 10 years ([georgia.org, 2022-11-14](https://georgia.org/press-release/electric-vertical-aircraft-manufacturing-company-archer-create-1000-jobs-covington)).
  - Financing is a $65M Synovus loan at SOFR plus 2.0%, fully drawn, interest-only until Oct 2026 ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000019/achr-20251231.htm)).
  - A 2024 press report says the fuselage is built in Georgia and finished in California (press; not verified).
- **Other sites:** Salinas (flight test) and Hawthorne Airport (LA hub, acquired Dec 2025 for ~$126M; the FBO option was exercised 2026-04-01 for $25M).

**Stellantis (changed in 2026)**
- **The 2024 plan:** An MOU effective 2024-11-01 had Stellantis committing up to ~$400M, made up of ~$372M manufacturing labor and up to ~$20M initial capex. The goal was 650 aircraft per year by 2030, paid back in Archer shares at 90% of VWAP ([8-K, 2024-11-04](https://www.sec.gov/Archives/edgar/data/1824502/000162828024045021/achr-20241101.htm)).
- **The August 2026 reset:** Per the [Q2 2026 10-Q](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000059/achr-20260630.htm), the MOU framework was superseded on 2026-08-09. Stellantis now continues "certain manufacturing support resources… for a specified period".
  - The December 2024 subscription agreement was terminated.
  - Stellantis got a fully vested 1,539,154-share penny warrant for services provided since Feb 2025.
  - Its lock-up was extended.
- **Earlier funding:** The $150M forward purchase agreement was fully issued by July 2024.

**Actual output**
- The only count is from the Q2 2025 release ([2025-08-11](https://investors.archer.com/news/news-details/2025/Archer-Announces-Second-Quarter-Results-Highlighting-Manufacturing-Ramp-Of-Midnight-Aircraft-Ahead-Of-Early-Commercial-Deployments/default.aspx)): "six Midnight aircraft in production, including three in final assembly".
- Feb 2024: construction of three conforming aircraft was underway ([Q4 2023 release](https://s206.q4cdn.com/823642595/files/doc_news/Archer-Announces-Fourth-Quarter-and-Full-Year-2023-Results-Now-In-Final-Phase-of-Midnights-Certification-Program-as-it-Readies-for-La-XWSTV.pdf)).
- A first Midnight went to the UAE in summer 2025.
- Q4 2025 letter: "several aircraft in various stages of completion across… Georgia and California".
- Q2 2026 call: more than 150 piloted test flights (press).
- No production rate is given anywhere after the FY2024 10-K. The "2 per month" ramp figure is from older press.

## 3. Suppliers

I found nothing in an Archer filing that names suppliers. These come from press releases, dated:
- **Garmin:** G3000 integrated flight deck ([2022-11-15](https://investors.archer.com/news/news-details/2022/Archer-Enters-Into-Agreement-for-Garmin-to-Supply-Key-Avionic-Systems-for-Archers-Production-Aircraft-Midnight/default.aspx)).
- **Safran Electronics & Defense:** UCAP flight control computer (Archer's airframe has four) and SkyNaute navigation. Collaboration since 2021, announced [2023-06-21](https://www.safran-group.com/pressroom/safran-and-archer-collaboration-produces-cutting-edge-avionics-technology-archer-s-midnight-evtol-2023-06-21).
- **Honeywell:** actuators, climate and thermal management. **FACC:** "key fuselage and wing elements". Both from the [Q2 2022 letter](https://www.sec.gov/Archives/edgar/data/1824502/000162828022022210/q22022exhibit991.htm), which also says over 50% of bill-of-materials suppliers were selected by cost.
- **Hexcel:** carbon fiber prepreg, but only a **letter of intent** from [April 2022](https://investors.archer.com/news/news-details/2022/Archer-Aviation-Plans-to-Work-With-Hexcel-to-Advance-Production-Capabilities/default.aspx). I found no definitive contract.
- **Molicel (E-One Moli):** battery cells, MOU only, [2022-11-16](https://investors.archer.com/news/news-details/2022/Archer-Selects-Molicel-to-Supply-Battery-Cells-for-its-Production-Midnight-Aircraft/default.aspx).
- **Seats, landing gear, motor magnets:** nothing found.
- **Mix of in-house and bought:**
  - Archer says ~80% of subsystems and components come from aerospace suppliers with certification heritage (Q4 2023 release, Feb 2024).
  - The 10-K says it relies on single-source and custom manufacturers.
  - In-house items are the powertrain (motors and battery packs), flight-control software and composites.
  - Key raw materials are aluminum and composites.
- **Software and AI partners:** Palantir (Foundry/AIP for manufacturing, [2025-03-13](https://www.businesswire.com/news/home/20250313910163/en/Archer-and-Palantir-to-Build-the-AI-Foundation-for-the-Future-of-Next-Gen-Aviation-Technologies); press summary only), NVIDIA (IGX Thor), Starlink, Etihad Aviation Training.

## 4. Costs and economics

**Spending (all from filings)**

| Item | Figure | Source |
|---|---|---|
| R&D, FY2025 | $493.9M (2024: $357.7M; 2023: $276.4M) | [FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1824502/000182450226000019/achr-20251231.htm) |
| G&A, FY2025 | $235.4M (2024: $152.0M) | same |
| Stock comp, FY2025 | $223.5M | same |
| Net loss, FY2025 | $618.2M | same |
| Operating cash burn, FY2025 | $432.9M | same |
| Capex, FY2025 | $78.8M (2024: $82.0M; 2023: $44.3M) | same |
| Q2 2026 R&D | $186.0M | [Q2 2026 release](https://www.sec.gov/Archives/edgar/data/0001824502/000182450226000056/archerq226earningspressr.htm), 2026-08-10 |
| Q2 2026 G&A | $93.9M | same |
| Q2 2026 capex | $37.1M | same |
| Q2 2026 adjusted EBITDA | -$177.1M | same |
| Q3 2026 adjusted EBITDA guide | -$170M to -$200M | same |
| Cash and short-term investments | $1,964.7M at 2025-12-31, $1,560.6M at 2026-06-30 | 10-K and Q2 2026 release |

- **Workforce:** 1,660 people at 2025-12-31, made up of 1,160 full-time employees and 500 contingent workers.
- **Q2 2026 revenue:** $5.0M with $4.3M cost, all from Hawthorne Airport.

**Price and orders**
- **Unit price:** The Q4 2025 letter footnote says the order book is Archer's estimate "based on an indicative $5M per aircraft price", and that orders are conditional. This is the only price signal.
- **United:** A conditional purchase of up to 200 aircraft plus an option for 100 more (up to $1.0B plus $0.5B).
  - Payment depends on FAA certification and further negotiation of specifications, warranties, escalation, delivery periods and other terms.
  - The 10-K says a **$10.0M pre-delivery payment** covers 100 aircraft (Aug 2022). Airforce-technology's "$100m" is wrong or a typo.
- **Other orders, all conditional:**
  - Future Flight Global, up to 116 aircraft for up to $580M ([2024-08-13](https://investors.archer.com/news/news-details/2024/Future-Flight-Global-Announces-Planned-Purchase-of-up-to-116-Archer-Midnight-Aircraft-Worth-up-to-580M/default.aspx)).
  - Air Chateau, up to 100 aircraft for ~$500M (Nov 2023, press).
  - Korean Air, up to 100 aircraft (Oct 2025), and PT IKN of Indonesia, up to 50 aircraft (Jun 2025), both from the [Q3 2025 letter](https://www.sec.gov/Archives/edgar/data/1824502/000182450225000007/exhibit991shareholderlet.htm).
  - Abu Dhabi Aviation and the Abu Dhabi Investment Office have definitive Launch Edition agreements with first payments received (Q3 2025 letter).
  - Also Saudi PIF/Red Sea Global, and Japan Airlines/Sumitomo's JV Soracle.
  - Archer states the order book only as "in the billions".
- **Unit cost and gross margin:** Not disclosed. I checked the FY2025 10-K Item 1, Item 7 and the notes, the Q2 2026 10-Q, and all letters from Q3 2025 to Q2 2026.
- **Battery cost:** Not disclosed. Industry numbers are in section 8.
- **Pricing-clause language:** The 10-K says aircraft contracts use fixed amounts plus escalation formulas indexed to labor and commodities.

**Recent corporate changes**
- **Boeing deal:** Signed 2026-08-09 to buy Wisk, Insitu and SkyGrid for ~19.75% of Archer's shares plus two $100M warrants at $13.00 and $17.88. The Hart-Scott-Rodino waiting period expired 2026-09-24, and closing is expected by year-end. Insitu has $200M+ revenue and ~4,100 aircraft produced (Q2 2026 letter).
- **Public warrants:** Expired 2026-09-16.
- **Joby litigation:** Archer filed an ITC complaint against Joby on 2026-03-09. A court ruling on 2026-09-29 narrowed Joby's claims against Archer and dismissed Archer's counterclaims.

## 5. Certification

- **Application and basis:** Applied 2022-03-30 as a "special class" aircraft under 14 CFR 21.17(b). The G-1 issue paper was finalized June 2024.
- **Means of compliance (MoC):** FAA accepted all 797 MoC items by Q4 2025 (letter, 2026-03-02). The 10-K says the same, as of January 2026.
- **Phase 3:** Archer says it closed Phase 3 in April 2026, "first" among eVTOL makers, "based on information available to Archer" ([Q1 2026 release](https://s206.q4cdn.com/823642595/files/doc_news/Archer-Announces-First-Quarter-2026-Results-Highlighting-Record-FAA-Certification-Progress-With-Initial-US-Operations-Expected-In-2026-2026.pdf), 2026-05-11).
- **Phase 4:** The 10-K (2026-03-02) says ~15% of compliance verification documents were received and Archer was "preparing for formal TIA testing".
  - **TIA status:** No document I read says Type Inspection Authorization (TIA, the FAA's formal for-credit testing) has started. The Q4 2025 letter says "as soon as this year". Joby's first conforming aircraft started its own TIA flights 2026-03-11.
- **Conforming aircraft:** No count of Archer conforming aircraft is disclosed after the Feb 2024 note that three were under construction.
- **Production certificate:** The FAA is already inspecting manufacturing operations. Archer targets the production certificate "shortly following" the type certificate.
- **Other certificates held:** Part 135 air carrier, Part 145 repair station (Feb 2024), Part 141 pilot training.
- **UAE:** Restricted Type Certification pathway with the GCAA; additional aircraft are to be delivered in 2026.
- **U.S. operations:** The eIPP (the White House eVTOL pilot program) is expected to start in late 2026; Archer was selected in 3 winning applications covering 8 states.
- **Does certification gate design changes?** This is my reading, not an Archer statement.
  - A change to type design is "minor" or "major" under [14 CFR 21.93](https://www.law.cornell.edu/cfr/text/14/21.93). Major changes need FAA approval.
  - [14 CFR 21.101](https://www.law.cornell.edu/cfr/text/14/21.101) says the FAA treats a change as "significant" if the general configuration or the assumptions used for certification stop being valid.
  - Changes to anything covered by an accepted certification plan (SSCP) or MoC item would need FAA re-agreement, and test results already obtained for a changed part may have to be repeated. That makes certification a schedule gate for any change touching propulsion, flight controls, structure or the battery.

## 6. Organization and roles

Archer's Greenhouse board ([job-boards.greenhouse.io/archer56](https://job-boards.greenhouse.io/archer56)) listed 104 openings on 2026-10-24. Pages show no posting dates unless noted. I re-checked the first posting below myself.

**Titles and wording**
- **Configuration and Data Management Specialist (San Jose):** "Review Change Notices for completeness, accuracy, and compliance with CM standards before **Change Review Board** presentation." It also names "Teamcenter PLM or similar" and JIRA ([posting](https://job-boards.greenhouse.io/archer56/jobs/7593784003)). Pay is $110k-145k.
- **Configuration Management Specialist, Powertrain:** "engineering change processes (CRs, CNs, ECOs, ECNs)". It lists "Teamcenter, Windchill, Enovia, or equivalent" and prefers hands-on Teamcenter ([posting](https://job-boards.greenhouse.io/archer56/jobs/7741010003)). Pay is $126.7k-158.4k.
- **Design Data Integrity Engineer:** NX, CATIA, CREO, Teamcenter ([posting](https://job-boards.greenhouse.io/archer56/jobs/7593841003)).
- **Cost Analyst (Cost Accountant):** "Develop, implement, and maintain standard costs in SAP" and analyze "Budgets vs. Standards vs. Actuals" ([posting](https://job-boards.greenhouse.io/archer56/jobs/7766564003)).
- **Other titles seen:**
  - Sr. Financial Analyst (Adaptive Planning, SAP).
  - Sr. Buyer ("SAP MRP").
  - Strategic Procurement Manager, Electric Propulsion.
  - Supply Chain Planner.
  - Lead Supply Chain Manager.
  - Sr. Product Quality Engineer, Powertrain (Teamcenter, SAP).
  - Manager, Manufacturing Design Engineering, Electric Motor.
  - Sr. Industrialization & Scheduling Manager and Sr. Manufacturing Engineer, Fuselage, both in Covington.

**Tools named in postings**
- **PLM:** Siemens Teamcenter (with NX) is the confirmed one. A Senior Application Engineer, PLM/Teamcenter posting describes Teamcenter code management with Bitbucket, Jira and TeamCity ([Built In LA](https://www.builtinla.com/job/senior-application-engineer-plm/10196878)).
- **ERP:** SAP S/4HANA, with PP/PP-PEO, MM, ePP/DS, MRP Live and QM modules. Postings: [Staff Manufacturing Systems Analyst](https://job-boards.greenhouse.io/archer56/jobs/7247106003) and [Staff Supply Chain System Analyst](https://job-boards.greenhouse.io/archer56/jobs/7631484003). A Principal Solution Architect posting adds IBP, Ariba, Palantir, BTP, Workato and Mendix ([posting](https://job-boards.greenhouse.io/archer56/jobs/6292277003)).
- **MES and shop floor:** A Manufacturing Systems Integration Engineer (Santa Clara, ~Dec 2025) pairs Teamcenter with SAP and Ignition SCADA ([copy](https://workingreen.jobs/offers/manufacturing-systems-integration-engineer-at-archer-santa-clara-california-united-states)). An MES Solution Engineer posting lists Wonderware, Siemens Opcenter and Rockwell FactoryTalk, but its page header says "Archer Technologies" and the list may be a candidate wish-list ([copy](https://jobs.alleycorp.com/companies/archer-technologies/jobs/57769998-mes-solution-engineer)).
- **Palantir:** Foundry/AIP for manufacturing (press, 2025-03-13).

**Not found**
- Any press release where Archer picks a PLM, ERP or MES vendor.
- A "should-cost" or cost-engineering title (closest are Strategic Procurement Manager, which mentions "cost modeling strategies", and Supply Chain Cost Analyst).
- A program-finance title.
- Use of NetSuite, Oracle, Dassault, Windchill or Opcenter as Archer's own systems. They appear only in "or equivalent" lists.
- Archer's own wording is "Change Review Board" and "Change Notice". I found no ECR/CCB in Archer postings.

I did not use LinkedIn or Glassdoor.

## 7. Comparables

**Joby Aviation** ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1819848/000181984826000160/joby-20251231.htm), filed 2026-02-27; [Q2 2026 release](https://ir.jobyaviation.com/news-events/press-releases/detail/187/joby-reports-second-quarter-2026-financial-results), 2026-08-05; the subagent also read the 10-Q)
- **Aircraft:** Pilot plus 4 passengers, 1,000 lb payload, 200 mph, target range up to 100 miles. Six propellers, each driven by two motors, fed by four batteries.
- **Production:**
  - Marina CA has 130,000 sq ft plus a 226,000 sq ft building completed in 2025.
  - It bought a 728,000 sq ft Dayton-area site in Jan 2026.
  - Target is to "double production to four aircraft per month in 2027".
- **Status as of 2026-08-05:** 5 aircraft flying and 12 in production. First conforming aircraft began TIA flights 2026-03-11 (company release, per subagent).
- **Spending and cash:**
  - R&D was $581.1M and SG&A $162.6M in 2025. Cash was $2.26B at 2026-06-30.
  - Toyota has invested nearly $650M. Joby also owns Blade, so it has revenue ($38.6M in Q2 2026).
- **Unit cost:** Only a 2021 SPAC-era management case, "$1.3MM fully loaded manufacturing cost per aircraft" in 2026E ([SEC memo](https://www.sec.gov/Archives/edgar/data/1819848/000119312521210407/d46602d425.htm)). Old and not current.
- **Suppliers:** Garmin G3000 is the only confirmed one.

**Beta Technologies** ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1784570/000162828026015838/bta-20251231.htm); IPO on NYSE in Nov 2025)
- **CX300 (conventional takeoff):** 6 passengers or 200 cu ft cargo plus 2 crew, ~215 nm range, 225 kWh onboard (five 45 kWh packs). The H500A motor is 165 lb and 573 hp.
- **Vertical-takeoff A250:** Certification targeted ~12 months after the CX300. The CX300 is targeted ~12 months after motor certification.
- **Production and backlog:**
  - Vermont final assembly is ~188,000 sq ft, designed for 300+ aircraft per year at maturity.
  - Backlog at 2025-12-31 was 891 aircraft worth $3.47B (289 firm, 602 options).
  - That is ~$3.9M per aircraft by my arithmetic.
- **Spending and supply:** 2025 revenue was $35.6M, R&D $259.9M and G&A $138.5M. Garmin supplies avionics, Sensata sidesticks and Volz servos. Only one lithium-ion cell supplier is qualified.

**Eve Holding** ([FY2025 10-K](https://www.sec.gov/Archives/edgar/data/1823652/000155485526000300/evex-20251231.htm); the 10-K and Q2 2026 call details come from the subagent, who read them only partly)
- **Aircraft:** Lift-plus-cruise with 8 lift rotors and a pusher; pilot plus 4 passengers. Embraer-backed.
- **Production:** Taubaté, Brazil, four modules of 120 per year each (480 per year).
- **Backlog:** ~2,700 aircraft, ~$13.5-14B, non-binding.
- **Timeline:** Full-scale prototype first flew 2025-12-19. Six conforming prototypes are planned for 2027. Certification is now "expected for 2028" (automated call transcript, press).
- **Spending:** 2025 R&D was $194.7M and SG&A $30.7M.
- **Named suppliers (press, pages 403'd at source):** Garmin, Nidec, BAE Systems, Thales, Liebherr, DUC Hélices, and Beta for pusher motors (up to $1B over 10 years).

## 8. BOM-level data

Public component-level cost data is sparse. No company filing I read gives $/kW for motors or inverters, avionics cost, composite shares or part counts.
- **Cost split:** BofA says power, energy and avionics systems are over 70% of eVTOL BOM cost, avionics alone ~20% ([BofA Institute, 2025-06-03](https://institute.bankofamerica.com/content/dam/transformation/low-altitude-economy.pdf); analyst view, press). An unsourced blog says battery 25-30% and motors/propulsion 15-20% ([evtol.travel](https://evtol.travel/evtol-price)); weak (press).
- **Battery $/kWh:** Academic papers assume $200/kWh ([Cheng et al., J. Air Transportation 2025](https://chrismi.sdsu.edu/publications/227.pdf)) or €115/kWh ([Imperial College, arXiv 2412.18078](https://arxiv.org/html/2412.18078v3)). A China Daily piece (May 2025, press) says eVTOL batteries cost 3-5x automotive.
- **Pack sizes:**
  - Beta CX300 is 225 kWh (primary).
  - Joby is unconfirmed: 150-200 kWh by various estimates (press).
  - Archer is 142 kWh from an aggregator (press).
- **Aircraft price anchors:** Archer ~$5M (indicative), Beta ~$4M (S-1), Eve ~$5M (implied). Joby's $1.3M is a 2021 cost case.
- **Battery cost inconsistency:** The sources disagree by 5-10x (a 140 kWh pack at $200-400/kWh is only ~$30-60k, but "battery 25-30% of cost" would imply hundreds of thousands). Bowman will have to pick one and label it an assumption.
- **Nothing found:** part counts, composite cost shares, NASA or consulting-firm component cost breakdowns, and Archer pack unit cost.

## Suggested basis for Bowman (my proposal, not sourced fact)

**Borrow directly (rename only)**
- Archer's structure:
  - 12-tilt-6 air taxi, pilot plus 4, MTOW 6,500 lb, >1,000 lb payload, ~100 mi range, 150 mph.
  - Composite structure, with the powertrain and flight-control software in-house.
  - Tier-1 suppliers for avionics, actuators and fuselage elements.
- The 797 MoC items and 17 issue papers (13 standard and 4 unique).
- The aft-propeller 2-blade to 4-blade change, as a headline ECR.
- Archer's role names: Change Review Board, Change Notice, "CRs, CNs, ECOs, ECNs".
- Tool stack: Teamcenter for PLM and change, SAP S/4HANA for ERP (PP, MM, QM), Ignition on the shop floor, Palantir Foundry as the analytics layer.
- Facility and finance story: a California pilot line, a Georgia-style high-rate plant ($118M, 1,000 jobs), a contract-manufacturer deal paid in stock, a $65M term loan, ~$5M indicative price with conditional orders and small pre-delivery payments.
- Cost scale: R&D ~$190M per quarter, G&A ~$90M per quarter, Q3 EBITDA guide -$170M to -$200M.

**Program A: "Vesper V4", in production (proposal; Archer has no real analog)**
- **Configuration:** Midnight-like 12-tilt-6 air taxi, pilot plus 4, MTOW 6,500 lb. The Type Certificate is held and the production certificate is held. Ramp is 2/month in 2027, 6/month in 2028, and a Georgia design rate of 650/year reached around 2030.
- **Price and cost:** List price $5M. Standard cost at launch $2.8M, target $1.8M at rate (invented; a single design change should move this by a few percent).
- **Cost shares (invented, loosely anchored to BofA):**

  | Group | Share of standard cost |
  |---|---|
  | Avionics and flight computers | ~20% |
  | Motors, inverters and propellers (12 each) | ~22% |
  | Battery (6 packs, ~140 kWh, Molicel-style cylindrical cells) | ~15% |
  | Composite airframe | ~20% |
  | Actuators and thermal | ~10% |
  | Other | ~13% |

- **Part counts:** ~300 BOM lines at the assembly level, ~12 sourced suppliers with 3 single-source (invented).
- **Lead-time ranges (invented):**

  | Item | Lead time |
  |---|---|
  | Cells | 16-24 weeks |
  | Motor magnets and rotors | 20-30 weeks |
  | Prepreg | 12-20 weeks |
  | Avionics | 26-40 weeks |

- **Design-change cost mechanics (invented):** A change to a major part triggers requalification of 6-12 months, with the FAA classification (minor vs major) driving effectivity.

**Program B: "Meridian M6", in development (proposal; modeled on Halo and Beta CX300)**
- **Configuration:** Hybrid-electric, 6-passenger-equivalent cargo/medevac VTOL, MTOW ~12,000 lb, 800 lb mission payload (invented).
- **Stage:** Type-certification Phase 2 closed, MoC in negotiation, first flight 2027, first deliveries 2029, 24 aircraft per year by 2030 (invented).
- **Cost:** Target unit price $9M, standard cost $5M at launch (invented), development spend ~$60M per quarter (invented).
- **Shared parts:** Reuses ~40% of Vesper's powertrain parts. This gives the shared-supplier interaction that ARCHITECTURE §12 wants: a motor-magnet or cell supplier constraint hits both programs.
- **Sourcing:** Hybrid turbogenerator is the single-source sub-system (invented; Beta's GE Aerospace hybrid work is the real analog).
