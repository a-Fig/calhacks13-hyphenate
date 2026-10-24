# Engineering change terminology: CMII, Teamcenter, SAP and Archer

Researched 2026-10-24 by a Sonnet research agent; access limits are noted inline.

**Bottom line: switch Bowman to the Archer/Teamcenter/CMII spine: NCR → Change Request (CR) → Change Review Board (CRB) → Change Notice (CN). That means dropping the CCB, ECO and ECN terms in `GLOSSARY.md`.**

I could not reach Siemens' own docs (docs.sw.siemens.com is script-rendered) or the modern help.sap.com pages. Teamcenter and SAP specifics below come from Siemens PDFs, SAP Learning and old SAP Help pages, plus search summaries where I say so. I did not read the CMII standard, EIA-649 or MIL-HDBK-61 themselves. "(inferred)" marks my own reasoning.

## Findings

**1. CMII.** The pages I read are from ICM, "Institute of Configuration Management, The Home of CMII". The brief said Institute for Process Excellence, and I didn't verify a rename.
- **Order:** problem report → ECR → business decision → ECN → work authorizations.
- **Problem Report (PR):** "used when there is a problem and the solution is unknown."
- **ECR:** "provide[s] a recommended solution and define[s] its costs versus benefits."
- **ECN:** "provides the authority to create and release new documents and/or upgrade documents already released." It carries the effectivity ("The effectivity for each ECN is provided").
- **CMII's ECN is an authorization, not a notification.** That is the opposite of the classic meaning.
- **CRB:** high-risk changes go to it, and "75 to 85% of all changes are processed on a fast-track basis" without it.
- **CIB:** I did not find it in the ICM papers. It appears only in third-party Windchill tutorials as the board that reviews the ECN's implementation plan.
- **Three change-administrator roles:** CAI, CAII, CAIII, per Aras and Windchill material.

**2. Teamcenter.**
- **CMII basis:** Siemens says its process follows "the industry-standard CMII closed-loop change model".
- **Objects:** the Siemens PDF names problem reports, change requests, strategies and change notices. A training-course listing, seen only through search results, names four predefined objects: Problem Report, Enterprise Change Request, Deviation Request and Enterprise Change Notice. I could not confirm Deviation Request anywhere else.
- **Board:** the Siemens fact sheet supports a "change review board" with a fast-track option. I found no CIB.
- **States:** I found no official Teamcenter states. The PR/ECR/ECN state lists I found are from Aras's CMII implementation (Insitu deck), not Teamcenter.
- **Effectivity:** the only source is a third-party Teamcenter site: "End item effectivity... can be a date or a unit number", and the CN can state it. Archer's posting says "unit, serial number, and date-based."

**3. SAP.**
- **Change number:** "Each change number is valid from a particular validity date," and "A change number takes priority over the key date" (SAP Help, 4.7 spec-management page). Using a change number splits the validity period into adjoining periods.
- **ECR to ECO:** a legacy ECR "controls the change processes for chosen change objects" (BOMs, routings, documents). You cannot process the document until the ECR is converted to an ECO (SAP Help, 4.6C).
- **S/4HANA:** search summaries say Change Record (the "Manage Change Records" app) is the newer front end and the change master still carries the object changes. I did not read the official S/4 page, so treat that as secondary.
- **BOM link:** the BOM and material-master pages I read show revision levels and valid-from dates tied to a change number. I did not confirm the exact BOM link in S/4.
- **Cost update:** standard cost is a two-step mark and release (SAP Learning, "Understanding Mark and Release"). Marking sets a future planned price with no revaluation. Releasing makes it current and revalues inventory, posting a "Profit from revaluation." The material ledger needs the standard price. Actual costing (CKMLCP) is a separate period-end revaluation.
- **Costing explodes the BOM valid at the costing date (inferred):** I did not verify this.

**4. EIA-649 and defense terms.**
- **EIA-649:** version C is dated 2019. Per SAE and its defense companion EIA-649-1 (via search results), its five functions are planning and management, identification, change management, status accounting, and verification and audit. It does not prescribe ECR/ECO names (inferred).
- **ECP:** the Engineering Change Proposal is the defense equivalent of an ECR, classed I or II (secondary sources only).
- **RFD:** a Request for Deviation is "a specific written authorization to depart from a particular requirement" for set units or time. It does not change the configuration documents.
- **RFW:** a Request for Waiver covers an item already built or inspected that departs from the requirement.
- **MIL-HDBK-61A:** per Wikipedia, it retired "waiver" because RFW and RFD rules are identical.

**5. NCR vs Problem Report.** They are distinct but overlapping.
- **NCR:** a quality-system record that a product, part or process does not meet its requirements. The MRB (Material Review Board) dispositions it as use-as-is, rework, repair or scrap.
- **Problem Report:** a design-side record that something is wrong and the fix is unknown.
- **Where they connect:** use-as-is and repair need engineering justification. AS9100 8.7.1 requires customer approval for aerospace (secondary forum and guide sources). A recurring or design-caused NCR should spawn a CR (inferred, standard practice).
- **FAA:** one source says an MRB disposition that is a major change to FAA-approved data needs FAA approval.
- **Archer:** I could not read Archer's own supplier-quality page (script-rendered). Postings like Sr. Product Quality Engineer and Liaison Engineering Focal mention MRB; I saw those only through search summaries.

**6. Archer's quotes**, checked verbatim against the Greenhouse API:
- **7593784003, Configuration and Data Management Specialist:**
  - "Review Change Notices for completeness, accuracy, and compliance with CM standards before Change Review Board presentation."
  - "Verify effectivity assignments are correct and properly implemented in the PLM system."
  - "Experience with Teamcenter PLM or similar systems."
- **7741010003, Configuration Management - Specialist - Powertrain:**
  - "Familiarity with engineering change processes (CRs, CNs, ECOs, ECNs) from initiation through release and close"
  - "Knowledge of configuration management standards (CMII, EIA-649)"
  - "Hands-on experience with Siemens Teamcenter"
  - "the quality of change packages entering the Change Review Board"
  - "Understanding of effectivity methods — unit, serial number, and date-based"
- **Why the mix (inferred):** CR, CN and CRB are Teamcenter/CMII naming. ECO and ECN are the SAP and classic names. Archer is a Teamcenter plus SAP shop, so the list reads like a vocabulary spanning both systems, not one process.
- **Single-stage flow (inferred):** a Change Notice goes to the CRB, which suggests a single-stage flow. Siemens' fact sheet describes the same pattern: a single change request that goes through a CRB or fast-track approval.
- **No Problem Report, NCR or ECR in Archer's change vocabulary:** none of the postings I read use them. The repo research file also found no ECR or CCB in Archer postings.

## Concept table

| Concept | CMII | Teamcenter | SAP | Classic | Archer |
|---|---|---|---|---|---|
| Problem found, fix unknown | Problem Report (PR) | Problem Report | None in ECM; QM quality notification is the nearest | Discrepancy report / NCR (part-level) | Not found |
| Part fails spec | Out of scope | Not confirmed | QM quality notification | NCR, then MRB | MRB in postings |
| Change proposed and justified | Enterprise Change Request (ECR) | Change Request (CR) | Engineering Change Request (legacy ECM) | ECR | "CRs" |
| Board decides | CRB; fast track skips it | "Change review board"; fast-track option | No board object; status and workflow | CCB | "Change Review Board" |
| Authorizes and releases change, with effectivity | Enterprise Change Notice (ECN) | Change Notice (CN) | Change number / change master; ECO after ECR conversion | ECO | "Change Notices", "ECOs" |
| Tells downstream | The ECN itself | CN; documents auto-distributed | Change documents; release | ECN | "ECNs" |
| Plan review | Change Implementation Board (CIB) | Not found | None | None | None |
| Effectivity | Per ECN | Date or unit | Valid-from date on the change number | On the ECO | Unit, serial, date |
| Temporary departure | Not in the ICM papers read | Deviation Request (unconfirmed) | None | RFD / RFW | Not found |
| Cost follow-through | Out of scope | Out of scope | Mark and release standard cost; material ledger | Accounting does it | "Standard costs in SAP" (repo notes) |

## Recommended Bowman vocabulary

| Step | Term | Abbrev |
|---|---|---|
| 1 | Nonconformance report, with the MRB | NCR |
| 2 | Change Request | CR |
| 3 | Change Review Board | CRB |
| 4 | Change Notice (released, effectivity-bearing, SAP change number created) | CN |
| 5 | Superseding Change Notice replaces a released one | none |

**Reasons**
1. Bowman models Archer, Archer's PLM is Teamcenter, and Teamcenter implements CMII. CR, CRB and CN are the terms in both the posting and the tool.
2. ECN is unusable. CMII's ECN means "authorization", the classic ECN means "notification", and Archer lists both. Pick CN and never write ECN.
3. ECO and CCB drop out. Say once in the glossary that SAP and classic shops call the CN an ECO.
4. NCR stays as the upstream object because it is real aerospace quality vocabulary. It also lets us skip "Problem Report" and its PR collision.
5. Skip the CIB. I found no Siemens or Archer use of it. Fold implementation planning into the CN, as Archer's "change packages" and "cut-in points" language does.

**Tradeoff.** ECR/ECO/CCB is more widely known to a general manufacturing judge. CR/CN/CRB is more faithful to Archer and Teamcenter. I recommend fidelity. If judges' recognition matters more, keep ECR/ECO/CCB, but use that set everywhere and mention "Archer says CR/CN" once.

## Abbreviation collisions

- **PR:** Problem Report vs Git pull request vs SAP purchase requisition. Never use Problem Report or PR as a product term. Keep "repo PR" for Git only (already in `GLOSSARY.md`).
- **CR:** debit/credit "CR" in accounting views, which matters for a finance-facing product. Spell out Change Request in the UI.
- **CN:** credit note in accounting. Spell out Change Notice in finance screens.
- **ECN:** CMII meaning vs classic meaning. Ban it.
- **CRB vs CCB:** pick CRB only.
- **CIB:** skip it.
- **ECO:** Siemens-trained readers may hear "Engineering Order". Avoid it.

Rule: abbreviations only in dev docs and the architecture. UI, demo and pitch spell out the full term. NCR and CRB are safe to abbreviate everywhere.

## Sources
- ICM, "Change Management" white paper (Vince Guess, 2006, on Siemens' site): https://www.plm.automation.siemens.com/ko_kr/Images/Change_Management-Mar-22-2006_tcm72-50181.pdf
- ICM, "Configuration Management Plans, Traditional CM to CMII": https://aras.com/wp-content/uploads/2024/03/cmii-configuration-management-systems-aras-plm-software.pdf
- Siemens, Teamcenter Change Management fact sheet (2010): https://www.plm.automation.siemens.com/en_gb/Images/3320_tcm642-4722.pdf
- Siemens, Teamcenter fact sheets (2007 and 2025): https://media.plm.automation.siemens.com/teamcenter/Teamcenter2008_Web_English/PublishFolder/collateral/EPM_ChangeMgt_FS.pdf and https://blogs.sw.siemens.com/wp-content/uploads/sites/14/2023/11/Siemens-SW-Teamcenter-Change-Management-Fact-Sheet.pdf
- Siemens training listing (the four-object list was seen only in search results): https://training.plm.automation.siemens.com/ilt/iltdescription.cfm?pID=TRCT2495______TC___10.1___B10
- Teamcenter effectivity and EO/CN (third party): https://www.swooshtech.com/2021/10/29/teamcenter-engineering-change-process-and-workflows/
- Aras, CMII Change Management docs: https://docs.aras.com/cmii-change-management-37
- Insitu/Boeing CMII conference deck: https://aras.com/wp-content/uploads/2024/03/boeing-insitu-cmii-engineering-change-management-aras-plm.pdf
- CMII CRB/CIB tutorial (Windchill, third party): http://www.datajett.com/windchill/CMII_Tut/CMII_Tut3.htm
- SAP Help, ECR: https://help.sap.com/saphelp_46C/helpdata/EN/c1/1c2b3143c711d1893e0000e8323c4f/content.htm
- SAP Help, change numbers: https://help.sap.com/saphelp_470/helpdata/en/a7/286cc20a6c11d28a220000e829fbbd/content.htm
- SAP Help, revision levels: https://help.sap.com/saphelp_470/helpdata/en/ea/e9bbd14c7211d189520000e829fbbd/content.htm
- SAP Learning, mark and release: https://learning.sap.com/courses/product-cost-planning-in-sap-s-4hana/understanding-mark-and-release
- SAP Help, Manage Change Records (search snippet only): https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9c4986bda35f4840ae438960ffbef64d/d1c63dbe742b45ad98efa0e726da74a5.html
- SAP, Material Ledger and actual costing: https://blog.sap-press.com/the-material-ledger-and-actual-costing-with-sap-s4hana
- SAE EIA-649C: https://saemobilus.sae.org/standards/eia649c-configuration-management-standard
- RFD/RFW and MIL-HDBK-61A: https://en.wikipedia.org/wiki/Request_for_waiver
- NCR and MRB dispositions: https://tessl.io/registry/skills/github/affaan-m/ECC/quality-nonconformance
- Archer postings: https://job-boards.greenhouse.io/archer56/jobs/7593784003 and https://job-boards.greenhouse.io/archer56/jobs/7741010003
- Archer supplier quality (unreadable): https://archer.com/legal/supplier-quality-requirements
