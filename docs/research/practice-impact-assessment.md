# How engineering change impact assessments are done in practice

Researched 2026-10-24 by a Sonnet research agent.

All sources were retrieved 2026-10-24; the date shown with each is the document's own date. Tags: **[P]** primary (standard, form, charter, regulation, supplier contract clause), **[A]** academic or practitioner write-up, **[V]** vendor marketing, **[2]** secondhand (cited by another document, or seen only in a search excerpt, not opened), **[I]** my inference. Source list at the end (S1..S34).

## Bottom line

1. **The canonical impact assessment is a fixed-factor cost table plus a narrative of effects.** The DoD ECP (DD 1692 / DI-SESS-80639D) and its Appendix B cost spreadsheet split cost into production, retrofit, logistics support (ILS) and other, each as non-recurring plus unit x quantity recurring, with savings in parentheses (S1). Our S2 cost stage maps to "production"; retrofit and ILS exist for us only as the 48-part test-fleet retrofit and spares/manual updates.
2. **Effectivity is a planner's trade-off, not a field.** MIL-HDBK-61A names five inputs: urgency, inventory (use to depletion vs scrap), configurations in service, lead times, timing (S1). Real forms carry a per-location inventory table (stores, WIP, finished goods, in field, on order) with a disposition code (S4).
3. **Cost numbers come from the supplier.** The supplier forms we found require a firm quote and a before/after breakdown for any piece-cost change, plus tooling cost and a ship-date effect (S4, S5). Should-cost and learning curves are cross-checks on that quote, not substitutes [I].
4. **No one measures hours per assessment.** The one study that tried (Ascom, 2013) found it too costly to collect. It did record about 2.5 h of value-adding time inside a 144-day average change-request lead time (S13). I found no aerospace hours-per-assessment figure.
5. **Most changes are small and bypass the board.** CMII-style material puts 75-85% of changes on a fast track approved by individuals (S25, S26; both secondhand or vendor). One published dollar threshold exists: $150,000 and $2,000,000 tiers for the NOAA/FAA/USAF WSR-88D radar (S11).
6. **Correction to our DER assumption.** Under FAA Order 8110.37G, the design approval holder decides major vs minor and the FAA can reject it; this cannot be delegated to a DER. DERs "do not approve data for minor changes", except with prior project-office authorization (S21). Certification should be a classification and test-effort field, not a DER sign-off step.
7. **"Rule of 10" is real but soft.** It is cited to VDI 2247 and Fricke (S14, secondhand). NASA JSC measured relative error-fix cost as 1 (requirements), 3-8 (design), 7-16 (build), 21-78 (integration and test), 29 to over 1,500 (operations) (S17). Do not state it as a law.
8. **Archer runs Teamcenter** (job postings, S28). Bowman's single PLM is therefore realistic as Teamcenter. I found no survey quantifying Excel use; evidence is anecdotal (S13, S29).

## 1. Forms and fields

### 1a. Defense ECP: DD Form 1692 and MIL-HDBK-61A (2001), the richest published template
The DD 1692 instruction PDFs returned HTTP 403 to automated fetch (S3). Field content below is from MIL-HDBK-61A Table 6-6 (S1), which defines the ECP DID elements. DD 1692 block numbers appear only in search excerpts of the 01/2018 instructions (S3, [2]): Block 50 = Estimated Net Total Cost Impact (50a production, 50b retrofit, 50c IPS), Block 51 = cost summary of related ECPs, Block 55 = milestone chart. A NASA copy of the form numbers them differently, so verify against the official PDF before citing block numbers.

| ECP element (S1 Table 6-6) | What it asks for |
|---|---|
| Identification | Date, originator and CAGE code, ECP number and revision, title, classification (I/II), justification code, type (Message / Preliminary / Formal), priority (Emergency / Urgent / Routine) |
| Justification codes (Table 6-3) | B interface, C compatibility, D deficiency, O operational/logistic, P production stoppage, R cost reduction, S safety, V value engineering |
| Contract | Contract and line item numbers, contracting officer, "date contractual authority needed" for production and for retrofit |
| Description and need | Items affected, in production?, wording that could be repeated in the contract mod, consequences of disapproval, failure data |
| Baseline, alternatives | Which baseline is affected; trade-offs and alternative solutions considered; development status, extra tests |
| Effectivity and schedule | Production effectivity by serial/lot, delivery schedule "days after contractual approval", retrofit recommendation, retrofit serials/lots, kit delivery schedule, order of implementation relative to other ECPs, work-hours to install and test, out-of-service time |
| Effects | Specifications and drawings affected; interfaces; spares, manuals, training, support equipment, packaging/handling/storage; GFE; warranties; parts control; life-cycle cost over contract life |
| Cost (S1 App. B) | (a) Production: item, factory test equipment, special tooling, scrap, engineering and data revision, test procedure revision, qualification. (b) Retrofit: 11 named items (kits, special tooling, installation by contractor/government, testing). (c) ILS: 17 items (spares, provisioning, training, manuals, interim support, O&S cost change). (d) Other. (e) Subtotal. (f) Net total. Columns: non-recurring, recurring unit, quantity, total recurring, total, other costs to government |
| Milestones | Time-phased deliveries in months after contractual approval |

Class II ECPs need only: item name and number, next higher assembly, description of change, need (S1 Table 6-6). Class I triggers (Table 6-2) include any change to a physical or functional requirement, cost/warranty/milestones on controlled documents, safety, retrofit of delivered units, interchangeability, sources on a source control drawing, and GFE.

FAR 15.408 Table 15-2 (S23) is the pricing format behind the cost page: materials and services (with subcontract analyses), direct labor (time-phased hours and rates), indirect costs, other costs (special tooling), and a change-order format with a "Net Cost of Change" column. "Learning curve" does not appear in it; the nearest term is "improvement curves."

### 1b. Supplier-side change forms (real, published)
- **Crane Aerospace & Electronics, Supplier Change Request Form 104-209 Rev 0, 17 Apr 2015** (S4). Fields: Crane P/N and control drawing revision, supplier P/N, description and reason of change, priority (Emergency "line stopper now" / Urgent "potential line stoppage within 30 days" / Routine), part status (development or production), recommended disposition by supplier, a table per part number of quantities In Stores / WIP / Finished Goods / In Field / On Order, cost box (check "no cost implications" or "will impact product cost", which "will require firm quote, before/after breakdown and approval from Crane Supplier Liaison"), and estimated timing in weeks. Disposition codes: use as is until inventory depleted; mandatory install in stores/WIP/finished goods/field/on order; rework/retest; scrap. Crane-only block: engineering and supply chain concurrence signatures, cost approval, SECO number.
- **Summit Aviation 8400-QSP-FORM-001 Rev 0, 20 Feb 2020** (S5). Fields: minor vs significant ("significant alters form, fit, or function"), permanent vs temporary with affected PO numbers, "Tooling or facility changes? If yes, cost?", "Is piece cost affected? Cost per piece?", interchangeability of assembly and of components, shipping schedule effect and new ship date, customer approval required, sample piece or full FAI.
- **PPAP change notice (automotive).** Accuride Form P100 Rev A 12/12 (S6) lists the AIAG PPAP 4th edition Table 3.1 triggers: other construction or material; new or modified tooling; production after tooling upgrade or rearrangement; tooling moved to another plant; change of supplier for parts or non-equivalent materials/services (heat treat, plating); tooling inactive 12 months or more; new test method; new raw-material source; change after an 8-D corrective action; customer engineering change. The supplier proposes a PPAP submission level (1-5) and a date; the OEM's quality engineer states "expected time required for PPAP approval." The AIAG manual is paywalled; I did not read it.
- **Aerospace equivalent: AS9102 first article.** Lockheed Martin Aeronautics Q2A Rev 12 (6 Oct 2015) (S7) requires a full or partial FAI for a design change affecting fit, form or function, a change of manufacturing source, process, location, tooling or materials, and a production lapse over two years. The seller gives the buyer's SQE written notice at least five business days before starting a change.
- **Supplier-notice clauses.** Boeing D520 (15 Nov 2013) (S9): seller-initiated design, form, fit, function, material, process or location changes need written approval; buyer responds within 15 days. Sikorsky SA1963 Rev 3 (7 Jan 2020) (S8): before any engineering change the supplier submits an Engineering Change Submission Questionnaire plus SA Form 1359 or 1360 as directed, receives acceptance, and delivers final data 30 days before the delivery date; "Buyer shall have absolute discretion" on classification. Century Fasteners/Parker clause (S10): Class I (fit, form, function, reliability, maintainability, safety) needs prior written approval; Class II is notified before first delivery. The EN 9116 Notice of Change standard exists for this (S33 search excerpt only; text not read).

## 2. Who does what, and the board

No OEM publishes its internal function-by-function ECR procedure. What exists are government and contractor processes, a federal CCB charter and one academic case study. Together they give this picture.

| Step | Owner | Needs as input | Duration (source) |
|---|---|---|---|
| Trigger: NCR or deficiency | Production, test, MRB | Failure data | Emergency ECP: authorization decision in 48 h; urgent: 30 days (S1 6.2.1.4) |
| Draft ECR / ECP | Originating design engineer | Failure data, redlines | Message ECP to formal ECP within 30 days (S1) |
| Log, classify, route | Configuration manager (WSR-88D: the ROC CM team lead makes final classification) | Class I/II criteria | Not stated |
| Technical definition | Program engineering | Analyses, drawings | |
| Estimate and price | Pricing manager, proposal manager, contracts manager (S1 App. D attendee list) | Supplier quotes, labor hours, rates | Contractor milestones: request, IPT technical definition complete, estimating and pricing complete, CCB, submittal (S1 metric 4-3) |
| Logistics, planning | Program logistics manager | Spares, manuals, inventory | |
| CCB | Chair is the program manager; members from logistics, training, engineering, production, contracting, CM (S1 6.1.1.3) | Complete ECP with all technical, support, schedule and cost impacts | Monthly in WSR-88D (S11) |
| Release and implement | Chair signs CCB directive; contracts issue mod | Approved ECP | Government acknowledges ECP receipt within about one month (S1 Table D-1) |

- **Government-contractor coordination.** MIL-HDBK-61A Appendix D gives timing examples "for illustration only": informal advance notice four months before an ECP request, status every two months during preparation, decision status monthly after receipt. A coordination meeting every other month, with a contractor PM, engineering, logistics, proposal, contracts and pricing, and government PM, finance, engineering, logistics, PCO and ACO (S1 Table D-2).
- **What the board sees.** The CCB secretariat schedules meetings, circulates agendas, records decisions and distributes minutes. Members must have the ECP before the meeting and record concurrence or non-concurrence before the decision; the chair approves a CCB directive (S1 6.1.1.3; S12). In WSR-88D the secretariat is the ROC CM team lead; decisions are by consensus, else the ROC Director decides (S11). Ordinary outcomes: approve, disapprove with rationale, or return to revise and resubmit (S1 Table 6-7). Approval is not authority to proceed; funding and a contract modification follow (S1 6.2.1.5).
- **Three-tier example, 7 Mar 2024 (S11).** Tier 1 CCB approves $150,000 to $2,000,000; above that goes to the Program Management Committee. Tier 2, the ROC Technical Review Committee, approves up to $150,000 and reviews everything above it. Tier 3, the project team, implements and handles Class II through the change-request process.
- **Industrial case with timings (Ascom Wireless Solutions, Sweden, 2013, S13).** Reviewers get three weeks. A change expected to need over 40 work hours is escalated to the product line. A second studied company escalates anything over 80 hours to a management meeting. Fixed release windows exist: cost-reduction changes are batched four times a year at one company, and price-list-affecting changes twice a year at another (these were two percent of changes). The TRC (Time, Risk, Cost) sheet existed, but reviewed requests "often lacked" it. Value-added time was 2.5 h per change request across a 144-day average and 87-day median lead time; for change orders 1.9 h across 72 days average and 27 days median. Waiting was in the investigation step: 106 days average, 63 median.
- **Congestion, not work, drives lead time.** Terwiesch and Loch found actual processing time rarely exceeds two weeks while lead times run weeks to over a year, caused by approval complexity, snowballing changes and capacity congestion (S24).

## 3. How the research actually happens

- **Supplier quote first.** Supplier forms demand a firm quote with a before/after breakdown and tooling cost (S4, S5). NASA's build-up method, also called grassroots, estimates each work package's labor and material separately, adds overheads (ODCs, G&A, material burden, fee), and has an engineer plus a cost analyst review it (S18). Analogy and parametric are the alternatives; parametric tools named in the NASA handbook are SEER-H, PRICE TruePlanning and PRICE Estimation Suite (S18).
- **Learning curves.** NASA's training deck gives Y = kx^n with n = log(slope)/log 2, "usually 85% for aerospace" and "85-90%" for aerospace systems (S19). A 2017 paper cites Wright's airframe estimate of about 80% (beta = -0.322) and military aircraft at 80-85%; it estimates 85-86% for the F-22 and Super Hornet and 91% for the F-35A (S20). Two formulations exist: Wright's cumulative-average and Crawford's unit theory; the GAO guide's example is a 90% slope taking a $100 average over 10 units to $90 at 20 units (S34, search excerpt only; the GAO page returned 403).
- **Should-cost and teardown.** Vendor material describes should-cost tools (aPriori, Teamcenter Product Cost Management) that refresh a BOM cost when the structure changes (S29, S30; both [V]/[2]). I found no primary source on teardown practice, and no independent evidence of how cost engineers use these tools inside an ECR.
- **Historical actuals.** Not documented in anything primary I found. I searched for ERP actuals in ECP pricing; FAR 15.408 asks for cost or pricing data and "information explaining the estimating process" (S23) but names no data system.
- **Effectivity and inventory.** MIL-HDBK-61A: effectivity must weigh urgency (a safety deficiency "may override all other considerations"), inventory ("use existing materials to depletion, or to scrap current inventory", decided on cost and operational trade-offs), configurations to support, lead times and timing. It also notes retrofit costs both assemblies plus disassembly (S1 6.1.1.4). SAP ECM: a change is effective from a valid-from date by default; optional parameter effectivity supports date and serial-number intervals, only for BOMs (S31, 4.6C/4.7 docs and a 2019 blog; not re-verified on S/4HANA).
- **Certification.** 14 CFR 21.93(a): a minor change "has no appreciable effect on the weight, balance, structural strength, reliability, operational characteristics, or other characteristics affecting the airworthiness of the product"; all others are major (S22). Minor changes are approved "under a method acceptable to the FAA" before data is submitted (21.95); major changes need substantiating data, a compliance showing and a certification statement (21.97). A 2009 draft AC 21.93-1 exists; I found no final (S33). [I] Subpart D covers changes to a type certificate, so before Bowman holds a TC these changes would be handled inside the certification project, not under 21.93; confirm against Order 8110.4C.

## 4. Tools in real use
- Teamcenter at Archer: job postings for a Teamcenter PLM application engineer and configuration managers who maintain BOMs in "Teamcenter, Windchill, Enovia, or equivalent" (S28; Greenhouse board titles confirmed, descriptions seen only via search excerpts).
- PLM change modules implement the same shape: Windchill has change requests with fast and full tracks, a Change Review Board, and a Change Implementation Board; cost threshold for fast track "typically set by company policy" (S27).
- Excel: Ascom collected process data by hand into Excel; its PLM sent routing e-mails that some people checked weekly (S13). aPriori's own case says a customer's earlier state was "Excel on demand," about 1,000 parts a year vs 10,000+ after (S29, [V]). I could not find a survey of Excel use in impact assessment. Excel is the likely default for the cost page [I], not a measured fact.
- Hand-moved data [I, from the forms]: supplier quote PDFs into the cost sheet; inventory counts from the ERP into the disposition table; effectivity from the planner into the ECO.

## 5. Numbers

| Quantity | Value | Source |
|---|---|---|
| C-17 design changes | more than 5,000 per year for three years, more than 1,000 "major" per year | S16 (Boeing/USAF briefing, 27 Oct 2005) |
| Aero-engine change reports | 1,510 over 8 years (about 190 per year); 8% in development, 76% in manufacture/build/test, 16% in service (two years) | S14 (unnamed manufacturer, 2007) |
| Class I ECPs, three USAF aircraft programs | 118 ECPs examined, 54 interviews | S32 [2] (Hsu, MIT 1999; PDF fetch failed, HTTP 429) |
| Automotive average | 425 changes per month | S15 [2] (cites Deubzer 2005; not verified) |
| Lead time | weeks to over a year; touch time under about 2 weeks | S24 |
| Lead time, Ascom | CR 144 d avg / 87 d median; CO 72 d avg / 27 d median | S13 |
| Fast-track share | 75-85% (CMII); Windchill benchmark 80%; Boeing Insitu went "from zero to over 60%" | S25 [2], S26 [V], S27 [V], Insitu via search excerpt [V] |
| Cost of change by phase | 1, 3-8, 7-16, 21-78, 29 to >1,500 (error fix, relative) | S17 (NASA JSC, 2004; spacecraft, military aircraft, comms satellite) |
| Effort per assessment | no aerospace figure; 2.5 h value-added (electronics); escalation at 40 h and 80 h | S13 |
| Share of changes caused by errors | 56%, of which 39% avoidable | S15 [2] (Deubzer 2005) |

Checked and not found: effort-hours per ECP in any aerospace source (searched MIT DSpace, DTIC, NASA, DAU, design-society papers); ECR counts per program per year for a commercial aircraft program; the share fast-tracked at a named aerospace OEM. The GAO 1990 drawing-change count surfaced only in a search excerpt and is omitted.

## 6. Worked example (all numbers illustrative; structure follows S1 App. B and S4/S5)
**Bowman ECR-0417, motor-controller bracket BW-5120-210 Rev B to Rev C.** Trigger: NCR, vibration crack at the fillet 8.2 h into a 20 h endurance profile.

| Field | Content |
|---|---|
| Classification | Company: Class I (cost, retrofit on 4 test aircraft). FAA: proposed minor (secondary structure, Rev C strictly stiffer, same envelope and interfaces); classification is Bowman's call, FAA may reject (S21) |
| Change | Plate stock 1.0 in to 1.25 in, web 5 to 8 mm, larger fillet radius; interchangeable at assembly |
| Quantity | 12 per aircraft; 480 per year at 40 aircraft per year |
| Should-cost Rev B / Rev C | Material 1.9 kg to 2.6 kg at $11/kg: $20.90 to $28.60. Machining 62 to 71 min at $95/h: $98.17 to $112.42. Setup (lot 25): $11.40 to $13.30. Inspection $7.50 to $10.00. Anodize $9.50. Scrap 3%, markup 22%: **$185.31 to $218.42** (+17.9%) |
| Supplier quote | $186.40 current standard; Rev C $221.00 steady state, $239.50 for lot 1 (25 pcs) |
| Learning check | T1 = 1.6 x 71 min, 90% slope (b = -0.152): reaches 71 min at unit 23; excess 4.0 h = about $477 vs lot-1 premium $462.50 |
| Non-recurring | Supplier fixture and CMM programs $6,800, NC programming $4,200, delta FAI (S7) $2,600; Bowman vibration re-qualification $18,500; engineering 106 h at $145 = $15,370 (stress 60, drawing 12, other 34) |
| Inventory | Stores 96, WIP kits 48, supplier finished 60, supplier not started 60, installed on test aircraft S/N 001-004: 48. Use-up rejected: Rev B failed fatigue, so no flight use. Scrap 252 x $186.40 = $46,973 less salvage $718; cancel 60 at 10% = $1,118 |
| Effectivity | Retrofit S/N 001-004 (48 Rev C at $221 = $10,608, labor 4 x 12 h x $110 = $5,280); production cut-in S/N 009 and subsequent, re-planned by MRP |
| Supply chain | Single source (Supplier A); open PO revised; plate lead time 6 weeks; PPV: lot-1 $239.50 vs old standard +$53.10, vs new standard +$18.50 |
| Certification | Stress report supplement; vibration re-test; no FAA project if minor [I] |
| Year-1 total | Recurring +$16,608 (480 x $34.60); one-time $111,194; **about $127,800**. Steady state +$415 per aircraft |
| Ranges (illustrative) | Piece price p10 $212, p50 $221, p90 $236; the scrap decision (use-up vs scrap, $37k) is the largest swing |

## 7. Fast-track changes

- **Criteria, as published.** No universal threshold exists. Class II = not Class I (S1 Table 6-2); Class II examples: documentation only (errors, clarifying notes), substitution of an approved alternate material, drawing changes that do not affect a baseline or interface (S12). WSR-88D: documentation or internal-database changes not affecting form, fit, function or logistics; obsolescence/reliability changes limited to purchase-card spend; software changes with no external-user impact, no budget impact and no hardware change are delegated to the TRC (S11). Summit: "significant" = alters form, fit or function (S5). Windchill: low impact and cost, threshold by company policy (S27). Dollar and hour thresholds found: $150,000 and $2,000,000 (S11); 40 h and 80 h (S13).
- **Typical fast-track.** (1) Drawing note or typo corrections. (2) Substitution from an authorized equivalents list (Boeing drawing 1G50100 pre-authorizes listed superseding standards and equivalent materials, S9). (3) Obsolescence replacements with no form-fit-function change. (4) Minor supplier changes notified, not approved (S10). (5) Software infrastructure changes with no user or budget effect (S11).
- **Never fast-track.** (1) Anything touching safety or a flight-safety part (S8). (2) Interchangeability or interface changes. (3) Retrofit of delivered units. (4) GFE, source-control-drawing sources, warranties (S1 Table 6-2). (5) Supplier process, location or tooling changes needing FAI or PPAP (S6, S7, S9). (6) FAA-major changes (S22).
- **Approval and speed.** Sources describe approval "by creator" or "by individuals" for the basic tier, a standing management board for 15-20%, and a special board with top management for 0-5% (S26 [V]). Government practice: a plant representative or ACO normally concurs on classification only, and concurrence lets the contractor proceed without further CCB action (S1 Table 6-7). Speed: no published number for fast-track; Boeing's 15-day supplier response (S9) and Lockheed's five-business-day notice (S7) are the nearest.
- **FAA overlap.** Company "Class II" and FAA "minor" are different tests and can disagree: a change can be Class I for cost and FAA-minor for airworthiness. The DAH classifies; no FAA project is needed for a minor change; DERs "do not approve data for minor changes in type design" unless the DAH determines approval is needed and the project office authorizes an appropriately rated DER (S21 section 6.a). Sikorsky's supplier forms are named "Class II / FAA Minor ECP" (SA 1360) and "Class I / FAA Major ECP" (SA 1359), which conflates the two (S33, search excerpt; the form files are no longer at their URLs).

## Sources
- S1 MIL-HDBK-61A(SE), 7 Feb 2001, full text read: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/MIL-HDBK-61A_15177/
- S2 DI-SESS-80639D, 7 Apr 2015 (summary page only): https://everyspec.com/DATA-ITEM-DESC-DIDs/DI-SESS/DI-SESS-80639D_52391/
- S3 DD Form 1692 Jan 2018 and instructions (403 on fetch; search excerpts only): https://www.esd.whs.mil/Directives/forms/dd1500_1999/DD1692/ and https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/DD1692-InstComplete.pdf
- S4 Crane Supplier Change Request Form 104-209 Rev 0, 17 Apr 2015: https://www.craneae.com/sites/default/files/scm/Supplier_CRF_104-209.pdf
- S5 Summit Aviation 8400-QSP-FORM-001, 20 Feb 2020: https://summit-aviation.com/wp-content/uploads/2021/04/8400-QSP-FORM-001_Supplier_Engineering_Change_Request.pdf
- S6 Accuride Form P100 Rev A, 12/2012 (AIAG PPAP Table 3.1): https://www.accuridecorp.com/sites/default/files/inline-files/Form-P100-Product-Process-Change-Notification1.pdf
- S7 Lockheed Martin Aeronautics Q2A Rev 12, 6 Oct 2015: https://www.lockheedmartin.com/content/dam/lockheed-martin/aero/documents/scm/Quality-Requirements/Clauses/q2a_rev12.pdf
- S8 Sikorsky SA1963 Rev 3, 7 Jan 2020: https://sustainability.lockheedmartin.com/content/dam/lockheed-martin/eo/documents/suppliers/rms/sa1963-012020.pdf
- S9 Boeing BDS clause D520, 15 Nov 2013: https://www.boeingsuppliers.com/idscommon/clauses/DXXX/D520_20131115.pdf
- S10 Century Fasteners/Parker supplier terms, 2024 upload: https://www.centuryfasteners.com/wp-content/uploads/2024/03/01000-SQ-PKRTC-9.pdf
- S11 WSR-88D CCB Charter ROCPLN-PGM-06, 7 Mar 2024: https://www.roc.noaa.gov/public-documents/wsr88d/ccbchrt.pdf
- S12 NASA STEREO/IMPACT CM Plan rev C, 2002: https://stereo-ssc.nascom.nasa.gov/instruments/documentation/impact/dwc/Plans/IMPACTCMPlan_C.pdf
- S13 Lundqvist and Månsson, Chalmers E2013:028 (Ascom), 2013: https://publications.lib.chalmers.se/records/fulltext/178105/178105.pdf
- S14 Ahmed and Kanike, ICED'07, Aug 2007: https://designsociety.org/download-publication/25649/engineering_change_during_a_
- S15 Chucholowski et al., ICED13, Aug 2013: https://designsociety.org/download-publication/34827/Comparison+of+engineering+change+cause+analysis+in+literature+and+industrial+practice
- S16 Sanger, Slye, Joubert-Honacki, C-17 NDIA briefing, 27 Oct 2005: https://ndia.dtic.mil/wp-content/uploads/2005/systems/thursday/sanger.pdf
- S17 Stecklein et al., Error Cost Escalation, NASA JSC, 2004: https://ntrs.nasa.gov/api/citations/20100036670/downloads/20100036670.pdf
- S18 NASA Cost Estimating Handbook v4.0, Feb 2015: https://www.nasa.gov/wp-content/uploads/2020/11/263676main_2008-nasa-cost-handbook-final_v6.pdf
- S19 NASA SSRI Cost Estimating Module v1.0 (training deck): https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/18.%20Cost_Module_V1.0.pdf
- S20 Learning and forgetting in the jet fighter aircraft industry, 2017: https://pmc.ncbi.nlm.nih.gov/articles/PMC5619757/
- S21 FAA Order 8110.37G, effective 17 Sep 2026: https://www.faa.gov/documentLibrary/media/Order/Order_8110.37G.pdf
- S22 14 CFR 21.93, 21.95, 21.97: https://www.law.cornell.edu/cfr/text/14/21.93 (also /21.95, /21.97)
- S23 FAR 15.408 Table 15-2: https://www.acquisition.gov/far/15.408
- S24 Terwiesch and Loch, J. Product Innovation Mgmt 16(2), 1999 (abstract) and companion paper: https://repository.upenn.edu/handle/20.500.14332/42219 and https://repository.upenn.edu/oid_papers/33/
- S25 Wichmann, CMII slides, joint ILC-XFEL meeting, 24 Aug 2007 (secondhand claim): https://agenda.linearcollider.org/event/1875/contributions/5009/attachments/3887/6597/riko_cmii_aug2k7.pdf
- S26 Aras change-management slides, undated [V]: https://www.slideshare.net/slideshow/08-aras-change-management/27913846
- S27 PTC Windchill Help r12.1 (fast track benchmark, undated) [V]: https://support.ptc.com/help/wnc/r12.1.0.0/en/Windchill_Help_Center/changemonitor/ChgMonChartInfoRef.html and https://support.ptc.com/help/wnc/r12.1.0.0/en/Windchill_Help_Center/changemanagement/ChgMgmtFastFullTrackDetermine.html
- S28 Archer postings: https://job-boards.greenhouse.io/archer56/jobs/7805485003 and https://ev.careers/jobs/663833434-configuration-management-specialist-powertrain (undated)
- S29 aPriori case pages [V]: https://www.apriori.com/?p=54244 (403; search excerpt only)
- S30 Siemens Teamcenter Product Cost Management [V]: https://www.siemens.com/et-ee/products/teamcenter/solutions/product-cost-management (search excerpt only)
- S31 SAP ECM: https://help.sap.com/saphelp_470/helpdata/en/ea/e9ba654c7211d189520000e829fbbd/content.htm and https://blogs.sap.com/2019/09/30/engineering-change-management-parameter-effectivity/ (search excerpt only)
- S32 Hsu, Causes and impacts of Class One engineering changes, MIT 1999 (record only): https://dspace.mit.edu/handle/1721.1/47898
- S33 Draft AC 21.93-1 (2009): https://www.aviationsuppliers.org/ASA/files/ccLibraryFiles/Filename/000000000266/2009-10-09%20Draft%20AC%2021%2093%20as%20modified%20by%20ASA.pdf; EN 9116: https://standards.globalspec.com/std/14518411/nen-en-9116; Sikorsky SA1359/1360: https://www.lockheedmartin.com/content/dam/lockheed-martin/eo/documents/suppliers/rms/sa1360.doc (404 now; search excerpt only)
- S34 GAO Cost Estimating and Assessment Guide, cumulative average page (403; search excerpt only): https://gaoinnovations.gov/cost-guide/cumulative-average-formulation.html
