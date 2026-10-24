Source: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/download.php?spec=MIL-HDBK-61A.015177.PDF
(catalogue page: https://everyspec.com/MIL-HDBK/MIL-HDBK-0001-0099/MIL-HDBK-61A_15177/)
Document: MIL-HDBK-61A(SE), Configuration Management Guidance, 7 Feb 2001. Public-domain US government work.
Retrieved: 2026-10-24. Text extracted from the PDF with `pdftotext -layout`; page footers ("Downloaded from https://www.everyspec.com", running header) removed and runs of blank lines collapsed. Otherwise verbatim; the original's hard line wraps are kept. Notes labelled [EXTRACTOR NOTE] are mine.

# MIL-HDBK-61A Section 6.2 - Engineering Change Proposal (concepts, classification, codes, types, priorities, content)

Contents: glossary definitions (engineering change, ECP, interchangeable / replacement / substitute item, retrofit, CCB, CCBD); section 6.2 prose (6.2.1 to 6.2.2); Table 6-2 (Class I / Class II criteria); Table 6-3 (justification codes); Table 6-4 (ECP types); Table 6-5 (priorities); Table 6-6 (ECP content); Table 6-7 (review and disposition). Table 6-8 (implementation actions) is not extracted; see the PDF, handbook pages 6-26 to 6-29.

## Glossary definitions (verbatim)

```text
Engineering change. (1) A change to the current approved configuration documentation of a configuration
item. (2) Any alteration to a product or its released configuration documentation. Effecting an engineering
change may involve modification of the product, product information and associated interfacing products.

Engineering Change Directive (ECD). An internal performing activity document that indicates the approval
of, and direction to incorporate or implement engineering change.

Engineering Change Proposal (ECP). The documentation by which a proposed engineering change is
described, justified, and submitted to (a) the current document change authority for approval or disapproval of

                                                           Page 3-6

the design change in the documentation and (b) to the procuring activity for approval or disapproval of
implementing the design change in units to be delivered or retrofit into assets already delivered.

Interchangeable item. A product which possess such functional and physical attributes as to be equivalent in
performance to another product of similar or identical purposes; and is capable of being exchanged for the
other product without selection for fit or performance, and without alteration of the products themselves or of
adjoining products, except for adjustment.

Replacement item. One which is interchangeable with another item, but which differs physically from the
original item in that the installation of the replacement item requires operations such as drilling, reaming,
cutting, filing, shimming, etc., in addition to the normal application and methods of attachment.

Substitute item. An item that possesses such functional and physical characteristics as to be capable of being
exchanged for another item only under specified conditions or in particular applications and without alteration
of the items themselves or of adjoining items.

Retrofit. The incorporation of new design parts or software code, resulting from an approved engineering
change, to a product's current approved product configuration documentation and into products already
delivered to and accepted by customers.

Configuration Control Board (CCB). A board composed of technical and administrative representatives
who recommend approval or disapproval of proposed engineering changes to, and proposed deviations from, a
CI’s current approved configuration documentation.

Configuration Control Board Directive (CCBD). The document that records the Engineering Change
Proposal (ECP) approval (or disapproval) decision of the CCB and that provides the direction to the
contracting activity either to incorporate the ECP into the contract for performing activity implementation or to
communicate the disapproval to the performing activity.
```

## 6.2 prose (verbatim)

```text
     6.2 Engineering Change Proposal

An Engineering Change Proposal (ECP) is the management tool used to propose a configuration change to a CI and
its Government-baselined performance requirements and configuration documentation during acquisition (and during
post-acquisition if the Government is the CDCA for the configuration documentation).

     6.2.1 ECP Concepts and Principles

The following paragraphs define uniform concepts and principles by which the processing of ECPs is conducted.
These standard ground rules are necessary to assure that there is a consistency and orderly process that can be
expeditiously accomplished by all parties.

The concepts in this section apply to class I ECPs, except where specifically identified as applicable to class II ECPs.

       6.2.1.1 ECP Initiation. The initiation of an ECP begins at the government's request unless for one or
more of the reasons cited in paragraph b. below. Since most ECPs occur in a sole source environment, the initiation
of an ECP should be a well-planned and coordinated effort between the government and contractor. A clear mutual
understanding of the ECP objective, technical scope and the Government’s performance, cost and schedule
constraints shortens the lead-time for ECP preparation. It also results in a complete and comprehensive proposal to
facilitate timely and effective implementation. As with most processes, the three C’s: Communication, Cooperation
and Coordination are the keys to assuring successful change processing.

The "ECP Management Guide," [Detail: Appendix D] has been developed to assist both the Government and
contractor during the request, preparation, approval and implementing phases of an ECP. It provides checklists to aid
in the timely identification and coordination of essential technical information required for decision making in all
three stages of the ECP process. It also fosters the integrated product and process team concept.

      a. Solicited ECPS. Whenever the government identifies a need or requirement to change a CI and its
configuration documentation a Class I ECP is formally requested from the contractor. A request for an ECP is
coordinated with the applicable government Contracting Officer prior to being released to the contractor. [Refer to:
Check List (A) of Appendix D]

      b. Unsolicited ECPs. As a general rule, unsolicited Class I ECPs are discouraged. However, at the
discretion of the procuring activity, a preliminary ECP may be submitted to allow evaluation of the desirability of
expending resources to fully document a proposed change. Changes that impact the following areas are instances
where unsolicited ECPs may be justified:

          • Safety
          • Compatibility.
          • Correction of Defects.
          • Survivability.
          • Security.
          • Product improvement(s) that may significantly reduce life cycle costs, including Value Engineering

                Change Proposals (VECP) consistent with the DFAR Value Engineering clause of the applicable
                contract
          • Technology improvements

6.2.1.2 ECP Preparation and Submittal. Formal and preliminary ECPs are prepared and submitted to the
Government in accordance with the configuration management requirements of the applicable contract SOW and
associated Contract Data Requirements List (CDRL), DD Form 1423 citing the latest approved Data Item
Description (DID) for submittal of ECP data. The contract CDRL should provide information on submittal and
distribution of ECPs for Government review and processing.

The contractor (ECP Originator) should notify the Government immediately by electronic message (e.g. E-mail, Fax)
when the need for an emergency or urgent priority ECP is determined. Follow-up to a message ECP should be in the
form of a formal ECP submittal, within 30 days. However when this is impracticable, a preliminary ECP may be

                                                                 Page 6-12

used as an interim measure. Both the preliminary ECP (if used) and the final ECP resulting from a message ECP
would be identified as revisions of the initial message ECP. [Detail: Activity Guide: Tables 6-3 and 6-4]

      a. Automated Processing of ECPs. If the Government has established a Government Configuration
      Management Automated Information System (CM AIS) the contract data requirement for ECPs should request
      either the digital submittal of ECP data, population of the DoD data base directly by the contractor, or access to
      the ECP via the world wide web. All ECP fields of information will be defined in the EIA Standard 836 data
      dictionary and its related XML ECP Business Object. To use MEARS13 as a standalone system, software must
      be provided to the contractor

      b. ECP Content by Program Life Cycle Phase. Pertinent data fields of information (ECP data elements)
that are to be provided by an ECP should be identified as described in the data item description and EIA-836. Only
data fields that are populated need be provided with the ECP. Using the XML data field tags will enable
Government and the various commercial configuration management information systems to store and coherently
display the ECP data. A significant advantage of using electronic commerce over paper forms is that each topic may
be addressed in its entirety without having to meet paper form block limitations.
Obviously those key data fields that identify and describe the change are mandatory in any ECP. Common sense and
the current context and environment of the program for which the ECP is being submitted dictate the fields to be
populated. The typical content of an ECP may vary considerably during the CI’s life cycle, and because DoD
Directive 5000.1 gives Government Program Managers latitude in identifying the phases that they will employ, no
two programs will necessarily be the same. The content guidance provided herein [Detail: Activity Guide: Table
6-6] reflects the general variability of ECP content that can be expected.

      6.2.1.3 ECP Supporting Data. Supporting data should include, where necessary, supplementary
information to support the change description and justify the need for change. Test data, analyses and other technical
documentation providing supporting rationale for assertions made in the ECP, and upon which the configuration
control authority can base its acceptance of the proposed change, can be included to the extent that the originator
feels is necessary. In many cases, the proposed change or its justification will be easier to understand if "marked-up"
copies or draft revisions of the TDP element (such as a "redlined" copy of a portion of a specification or an interface
drawing, or a draft table providing new values to be included in a data base) are also provided as a part of the ECP
package.

      6.2.1.4 Review and Dispositioning ECPs. In order to facilitate dispositioning ECPs affecting documents
for which the Government is CDCA, contracts should identify the government representative(s) responsible for
dispositioning both Class I and Class II ECPs. Where the Government is an Application Activity (AA), or in a
performance based acquisition, where the Government is not CDCA for the design documentation, contracts should
clearly specify Government and contractor responsibilities for Class I ECPs and RFDs affecting Government
baselined performance specifications. This can be accomplished by incorporating a special configuration control
clause in the contract similar to the example in the box below. Guides for the dispositioning of Class I and Class II
changes are provided in 6.2.2. [Detail: Activity Guide: Table 6-7] Key aspects of this process are highlighted, as
follows:

13 The OPR for MEARS is Commander, US Army MICOM, Attention: AMSMI-MMC-LS-SA (Mr. Mark Moe)
Redstone Arsenal, Alabama, 35898-5238, DSN 746-9513

                                                                 Page 6-13

Example:

CONFIGURATION CONTROL PROCEDURES FOR ENGINEERING CHANGE PROPOSALS, AND DEVIATIONS -
(STATEMENT OF WORK) (date)

      (a) Any Engineering Change Proposal (ECP) or any Request for Deviation affecting an item being acquired under this
contract shall be in accordance with attachment ( ), contract statement of work (SOW) paragraph(s) ______________.
Quantities and distribution, or electronic delivery/access, shall be as stated on DD form 1423 (Contract Data Requirements List)
or distribution list attached hereto.

      (b) No Class I engineering change shall be implemented until authorized by the Contracting Officer (CO).
      (c) Each Class II engineering change shall be submitted to the cognizant Administrative Contracting Officer (ACO), or in
the absence of such ACO, by (Insert applicable CFA, etc.) for concurrence in classification.

                                                           - or -
          Each Class II engineering change shall be dispositioned by the Contractor.
      (d) No major or critical deviation shall be effective until authorized in writing by the CO.
      (e) Minor deviations, requested prior to manufacture, shall be authorized (or disapproved) by the ACO, or in the absence of
such ACO, by (Insert applicable CFA, etc.).

                                                          - or -
          Minor deviations, requested prior to manufacture, shall be dispositioned by the contractor
      (f) Minor deviations to manufactured items shall be granted (or disapproved) by the local Material Review Board (MRB)
when properly constituted, or in the absence of such ACO by ______________.

(As used in paragraphs (b) and (d) of the foregoing clause, the term “Contracting Officer (CO)” means the “Procurement
Contracting Officer (PCO)” or the “Administrative Contracting Officer (ACO)” if the contract provides that orders may be issued
and priced by the ACO. The PCO or ACO may authorize only Class I engineering changes and major deviations which have
been approved by the Procuring Activity Change Control Board (CCB). The PCO and ACO may authorize only critical deviations
involving safety that have been approved by Procuring Activity Change Control Board (CCB) and by the Commander,
_________Systems Command.

      a. Dispositioning Class I ECPs. Class I ECPs must be dispositioned (approved or disapproved) for
implementation by a properly constituted Government Configuration Control Board (CCB).[See 6.1.1.3.a.]
After the CCB direction is issued, it is important to proceed expeditiously with the "definitization" process
(obtaining a pricing proposal, auditing, fact finding, and negotiating the final price) for this change and issuing a
supplemental agreement. Until the contract modification is received and bi-laterally agreed to by the Government
and the contractor, the contractor is not authorized to proceed with the implementation of the proposed change.

The contractual approval or disapproval of an ECP should not be confused with the acceptance and approval of the
ECP as a data deliverable. Approval of the ECP data delivery required by CDRL/DD Form 1423 signifies only that
the ECP satisfies the requirements of the ECP DID and is considered acceptable for government processing.
Acceptance of the data deliverable does not signify "technical approval" of the change proposed by the ECP and
should not be interpreted as authorizing the performing activity(s) to proceed with the work proposed by the ECP.

All ECPs should be dispositioned by the Government as expeditiously as possible. The ECP indicates a date by
which contractual authorization is required. This date should normally be proposed by the contractor to allow
sufficient processing time by the Government. In some cases, expedited processing may be necessary in order to
minimize the cost of the change or to enable it to be incorporated in time to satisfy an operational need. Since certain
critical factors (such as safety or national defense preparedness) may be involved, it is important that the
Government proceed with all due speed, but it is also important to ensure that proper priorities and need dates are
being specified.

Because there is considerable urgency involved in effecting the changes proposed in urgent and emergency ECPs,
the contractor normally specifies an authorization suspense date that is very close to the submittal date (e.g. 48 hours
to make the technical decision on an emergency ECP and 30 calendar days to make the decision on an urgent ECP).
[Detail: Activity Guide: Table 6-5.]

                                                                 Page 6-14

When the urgent or emergency priority is properly used, the contractor must be authorized to proceed with
implementing the change as quickly as possible. Under these circumstances, it is often necessary to utilize a
unilateral change order to the contract (or contracting officer letter) to provide official authorization to proceed. If
the change order is to be used, a "not-to-exceed" price quotation (a "not-less-than" price for cost reduction ECPs)
would be required to set a limitation on the price impact of the change activities to be accomplished. After the
change order is issued, it is important to proceed as expeditiously as possible with the normal "definitization"
process to minimize the risk of related price increase (or to maximize the related savings) resulting from the change.

VECPs are subject to essentially the same CCB process as other ECPs. Under the FAR clause, the Government is
entitled to reimbursement of expenses incurred in processing an approved VECP before any cost savings are shared
out to the contractor. Therefore, the tasking activity must develop auditable government cost information so that the
complete monetary impact of the VECP can be evaluated. Any delays in VECP processing will typically reduce the
savings benefit.

b. Dispositioning Class II ECPs.  Unless otherwise specified by contract (e.g., as part of the Single

Process Initiative), the government administrative contracting officer or plant representative serves as the

dispositioning authority for Class II ECPs.. The default action required on Class II changes is concurrence/non-

concurrence in classification only, unless the contract requires approval/disapproval. Government concurrence in

Class II ECP classification normally allows the contractor to incorporate the change in the applicable CI and update

its configuration documentation without any further government action or authorization being required. A non-

concurrence in classification will normally result in the Class II ECP being canceled or reclassified to a Class I ECP.

The government should require approval/disapproval of class II ECPS only when the Government is the CDCA for
the original drawings, or data files, and compliance with the specific detailed design is a requirement of the contract.
If there is a government ACO or plant representative available, the Government tasking activity may elect to have the
ACO or representative review the proposed class II changes for concurrence in classification before they are
submitted to the government tasking/procuring activity (that is the CDCA) for approval [Details: Activity Guide:
Table 6-7]

      6.2.1.5 Implementing Class I ECPs. When ECPs are approved, change implementation to a CI being
produced under contract is usually a straightforward contractual incorporation of the ECP as approved by the
government CCB. CCB approval action is not to be considered authority for the contractor or tasking activity to
proceed with the change.

      • A CCB directive must be prepared, published and distributed. The CCB directive is identified by the CCB
            identifier and the change identifier. The date of the CCB directive and disposition are recorded.
            Distribution should be limited to those parties required to take action to implement the change

      • If implementation of the approved change is the responsibility of the contractor under the terms of a
            contract, the CCB approval action directs the procurement contracting officer to initiate instructions to the
            contractor

      • If Contractor-initiated change proposals are involved, the receipt of a formal contract change for example,
            Standard Form 30, "Amendment of Solicitation/Modification of contract" or PCO letter (pending receipt of
            an amendment) shall constitute sole authority for the contractor to proceed.

      • If the initiator is government activity acting in the capacity of a contractor, the receipt of the directive/order
            (including funding authorizations) shall constitute sole authority to proceed with the change.

Change implementation to a CI in the inventory or operational forces will normally require the coordination of
additional requirements of an implementing CCB directive (or tasking order).

      • Necessary instructions and funding authorizations must be issued for the scheduled implementation of the
            change

      • Change accomplishment reporting is directed. [Details: Activity Guide: Table 6-8]

The incorporation of approved changes should be planned so that optimum acquisition, production, tests, evaluation
and operational advantages can be derived from the modified configuration. The change is effectively coordinated to

                                  Page 6-15

ensure that the earliest possible availability and support of the CI is provided with minimum disruptive effect on
planned operating cycles.

Changes shall be incorporated only after the Contract modification/PCO letter or implementing directive/order is
published and logistic support is available, unless safety or critical mission requirements dictate otherwise.
Unofficial or preliminary technical documents shall not be used as authority to incorporate changes.

The implementation of approved changes to a CI must always include the proposed incorporation of new and revised
technical documentation. Provisions for change documentation should always be addressed by the change proposal,
contract modification and/or CCB implementing directive/order. Change documentation may include such types of
data as specifications, drawings, provisioning documentation, technical manuals, diagrams, sketches, parts lists,
master configuration lists, computer program documentation, and test and evaluation procedures. Requirements for
such change documentation may vary depending on the life-cycle phase, type and complexity of each CI and the
change/modification. However, the documentation prepared for any change will normally include the following
three categories:

      • The documentation package (including the CCB implementing directive/order) forwarded to the change
            installing activities to install the change.

      • The documentation required by the technical, training, maintenance, and supply management organizations
            to properly control and support the change.

      • The documentation (e.g., technical manuals) required by the user activities to properly operate and
            maintain the CI after the change is installed.

     6.2.2 ECP Activity Guides

The following ECP Activity Guides provide information concerning change classification, the justification for Class
I ECPs, the types of ECPs, ECP priorities, ECP content, and the ECP dispositioning actions that may apply.
ECPs are prepared and submitted to the government in accordance with the configuration requirements of the
applicable contract SOW and CDRL/DD Form 1423. If the Government has established a CM AIS, the data
requirement for ECPs should request digital submittal of ECP data, population of the DoD database directly by the
contractor.]
```

## Table 6-2. Activity Guide: Change Classification (verbatim)

```text
                    Table 6-2. Activity Guide: Change Classification

Class I Criteria: :

      An ECP proposing a change to approved configuration documentation for which the Government is the CDCA or that
      has been included in the contract or statement of work by the tasking activity, and:
       (1) affects any physical or functional requirement in approved functional or allocated
       configuration documentation, or
       (2) affects any approved functional, allocated or product configuration documentation, and cost,
       warranties or contract milestones, or
       (3) affects approved product configuration documentation and one or more of the following:

             (a) Government furnished equipment,
             (b) safety,
             (c) compatibility, interoperability, or logistic support,
             (d) delivered technical manuals for which changes are not funded,
             (e) will require retrofit of delivered units,
             (f) preset adjustments or schedules affecting operating limits or performance to the extent that a new

                  identification number is required,
             (g) interchangeability, substitutability, or replaceability of any item down to non-repairable subassemblies,
             (h) sources on a source control drawing,

          (i) skills, manning, training, biomedical factors or human engineering design.

                                                                 Page 6-16

                    Table 6-2. Activity Guide: Change Classification

Class II Criteria:
      An ECP proposing a change to approved configuration documentation for which the Government is the CDCA or that
      has been included in the contract or statement of work by the tasking activity, and which is not class I.

Guidance:
1. The first criteria for ECP (both class I and class II) is that it is an engineering change; it must affect approved

     configuration documentation.
2. Furthermore an ECP is limited to a change to approved configuration documentation that is under Government

     configuration control; it must require a change to a document for which the Government (tasking activity) is the current
     document control authority (CDCA) or which is cited in a contract.
      a. The Government becomes the CDCA in several ways:

             • Provide the document as a Government document with Government CAGE code identification
             • Approve a contractor document and assume control by transferring CDCA and adding a Government CAGE

                  code to the document.
      b. The Government cites a configuration document in the contract in several ways:

             • Specifically addressing it, as in “Provide the system in accordance with Specification Performance
                  Specification number ______.”

             • Defining in the SOW or CDRL, that the system performance specification, allocated performance
                  specifications for specific CIs, and where applicable (e.g., in a design based acquisition) the product
                  configuration documentation, shall be submitted for Government approval and configuration control.

             • Adding specific documents to the SOW by contract modification
3. Items (1), (2), and (3) amplify the criteria by providing specific evaluation factors to use in judging whether a proposed

     change to any document must be processed as a Class I or Class II ECP
      a. Item (1) - Since there are both contractor-approved and Government approved configuration documents, any

          change to contractor approved requirements must be examined to determine if it also impacts Government
          approved (CDCA or contractually cited) configuration documentation.
      b. Item (2) - This item concerns a change to Government controlled configuration documents, which if it did not
          impact cost, warranties, or milestones would not otherwise be class I. A change to contractor-controlled
          configuration documentation which might also affect cost, warranties or milestones, does not require a class I ECP
          because it is not a Government configuration control issue. — it is treated like a commercial item, i.e., the
          contractor is obligated to the contract provisions but can change the design of the product so long as it meets the
          specified performance requirements. If the contractor’s design change makes the end product more or less costly,
          the contractor either absorbs the increase or benefits from the savings. The contractor must initiate contractual
          change action, outside the scope of configuration control, in order to change the contract cost, warranties or
          milestones.
      c. Item (3) provides some factors to evaluate when examining a proposed change to Government-controlled product
          configuration documentation. Many of these factors are specified by requirements in functional and allocated
          configuration documentation, covered by Item (1). A proposed change to PCD must be examined to see it impacts
          functional or allocated requirements.

                                                                 Page 6-17
```

## Table 6-3. Activity Guide: ECP Justification Codes (text verbatim, table alignment reconstructed)

[EXTRACTOR NOTE] In the PDF this three-column table extracts with the columns separated (all codes, then all titles, then all criteria paragraphs in order). The pairing below follows that order and the content (for example "Correction of a deficiency that is a hazardous condition" is plainly Safety). The wording is the source's; the row alignment is mine. The unmodified extraction follows the table, for checking.

| Code | Title | Criteria for Assignment |
|---|---|---|
| B | Interface | Proposed to eliminate a deficiency consisting of an incompatibility between CIs. |
| C | Compatibility | 1. To correct a deficiency discovered during system or item functional checks or during installation and checkout and the proposed change is necessary to make the system/item work<br>2. Except for Government caused changes (e.g., a deficiency in GFE or GFI), the contractor agrees that effort to accomplish the change is within the scope of the existing contract; and the contract price will not be increased as a result of the formal documentation of the engineering change and corrective action in production, and to delivered in-warranty items (or as stipulated in the contract).<br>3. Accepting the conditions of 1. and 2. enables the contractor to expeditiously correct the specific system/item in the location where the deficiency was discovered.<br>4. The contractor must also notify the Government within 48 hours after determining that a compatibility change is necessary. The contractor's message must define the need, identify factors that are impacted, and provide a preliminary estimate of cost and schedule. A formal ECP is required 30 days after the initial message.<br>5. Where further procurement or manufacturing action is necessary due to lead-time considerations prior to approval of a Code C ECP, the contractor may proceed at his own risk (except where the Government caused the deficiency), after notifying the Government of the additional systems/items to be corrected. |
| D | Correction of Deficiency | To eliminate a deficiency. Code D is used if a more descriptive code (such as S, B, or C) does not apply. |
| O | Operational or Logistic Support | To make a significant effectiveness or performance change in operational capability or logistic support. Commonly known as an improvement change. |
| P | Production Stoppage | To prevent slippage in an approved production schedule, where delivery to current configuration documentation is impractical or cannot be accomplished without delay. |
| R | Cost Reduction | To provide net total life cycle cost savings to the Government and not pursuant to a contract VE clause. Code R ECPs include cost and price of the current contract(s), plus costs resulting from associated changes in delivered items (retrofit), and life cycle logistic support. |
| S | Safety | Correction of a deficiency that is a hazardous condition |
| V | Value Engineering | To effect a net life cycle cost reduction, and the VECP is being submitted pursuant to the Value Engineering (VE) clause of the contract:<br>1. VECPs are prepared and submitted in accordance with the Federal Acquisition Regulation (FAR) "Part 48 Value Engineering" and the Defense Federal Acquisition Regulation Supplement (DFAR) "Part 248 Value Engineering" when specified in the contract.<br>2. Under the incentive clause normally contracts over $100K include either the voluntary (incentive) clause or the mandatory (program clause).<br>3. The effort required to develop the design change proposed by the VECP, and the effort to generate the VECP package, is accomplished entirely at the contractor's risk; only if the government approves the VECP does the contractor get reimbursed for the effort.<br>4. With cost reduction (R code) ECPs, or VECPs under the mandatory program, the contractor is funded by the government for the development of the design and the ECP, normally based on a preliminary change document and is reimbursed for the effort whether the ECP is approved or disapproved. |

Note: Both cost reduction ECPs and VECPs result in cost savings to the government on current contracts; they may also result in life cycle cost savings. For both the cost reduction ECP and VECP, the contractor will share in the cost savings on current contracts based on predetermined share ratio; however, since the contractor assumed the risk in undertaking the change development, the contractor's share of the saving is much larger when VECPs are involved. Also with the VECP, the contractor may be entitled to a share of the cost savings for future contracts and for related programs according to conditions set forth in the FAR clauses.

Unmodified layout extraction of Table 6-3:

```text
             Table 6-3. Activity Guide: ECP Justification Codes

Code  Title              Criteria for Assignment
  B
  C   Interface          Proposed to eliminate a deficiency consisting of an incompatibility between CIs.
      Compatibility      1. To correct a deficiency discovered during system or item functional checks or during installation and
  D
  O   Correction of            checkout and the proposed change is necessary to make the system/item work
  P   Deficiency         2. Except for Government caused changes (e.g., a deficiency in GFE or GFI), the contractor agrees that
  R   Operational or
  S   Logistic Support         effort to accomplish the change is within the scope of the existing contract; and the contract price will not
  V   Production               be increased as a result of the formal documentation of the engineering change and corrective action in
      Stoppage                 production, and to delivered in-warranty items (or as stipulated in the contract).
      Cost Reduction     3. Accepting the conditions of 1. and 2. enables the contractor to expeditiously correct the specific
      Safety                   system/item in the location where the deficiency was discovered.
      Value Engineering  4. The contractor must also notify the Government within 48 hours after determining that a compatibility
                               change is necessary. The contractor’s message must define the need, identify factors that are impacted,
                               and provide a preliminary estimate of cost and schedule. A formal ECP is required 30 days after the
                               initial message.
                         5. Where further procurement or manufacturing action is necessary due to lead-time considerations prior to
                               approval of a Code C ECP, the contractor may proceed at his own risk (except where the Government
                               caused the deficiency), after notifying the Government of the additional systems/items to be corrected.
                         To eliminate a deficiency. Code D is used if a more descriptive code (such as S, B, or C) does not apply.

                         To make a significant effectiveness or performance change in operational capability or logistic support.
                         Commonly known as an improvement change.
                         To prevent slippage in an approved production schedule, where delivery to current configuration
                         documentation is impractical or cannot be accomplished without delay.
                         To provide net total life cycle cost savings to the Government and not pursuant to a contract VE clause. Code
                         R ECPs include cost and price of the current contract(s), plus costs resulting from associated changes in
                         delivered items (retrofit), and life cycle logistic support.
                         Correction of a deficiency that is a hazardous condition
                         To effect a net life cycle cost reduction, and the VECP is being submitted pursuant to the Value Engineering
                         (VE) clause of the contract:
                         1. VECPs are prepared and submitted in accordance with the Federal Acquisition Regulation (FAR) "Part

                               48 Value Engineering" and the Defense Federal Acquisition Regulation Supplement (DFAR) "Part 248
                               Value Engineering" when specified in the contract.
                         2. Under the incentive clause normally contracts over $100K include either the voluntary (incentive) clause
                               or the mandatory (program clause).
                         3. The effort required to develop the design change proposed by the VECP, and the effort to generate the
                               VECP package, is accomplished entirely at the contractor's risk; only if the government approves the
                               VECP does the contractor get reimbursed for the effort.
                         4. With cost reduction (R code) ECPs, or VECPs under the mandatory program, the contractor is funded by
                               the government for the development of the design and the ECP, normally based on a preliminary
                               change document and is reimbursed for the effort whether the ECP is approved or disapproved.

                         Note: Both cost reduction ECPs and VECPs result in cost savings to the government on current contracts;
                         they may also result in life cycle cost savings. For both the cost reduction ECP and VECP, the contractor will
                         share in the cost savings on current contracts based on predetermined share ratio; however, since the
                         contractor assumed the risk in undertaking the change development, the contractor's share of the saving is
                         much larger when VECPs are involved. Also with the VECP, the contractor may be entitled to a share of the
                         cost savings for future contracts and for related programs according to conditions set forth in the FAR clauses.

                         Page 6-18
```

## Table 6-4. Activity Guide: Class I ECP Types and Their Function (verbatim)

```text
         Table 6-4. Activity Guide: Class I ECP Types and Their Function

All types of Class I ECPS may be submitted to the Government electronically, the type categorization relates not to
format but to give a quick indication of the intent of the ECP

         Type of ECP                 Function

Message                Although not formally considered a type of ECP, Engineering changes with an
                       emergency priority are often submitted in a message that provides less detail
                       than a preliminary ECP; urgent priority ECPs sometimes are also initially
                       documented in messages, as are notifications of compatibility changes [See
                       table 6-3]. They should be followed up by a complete ECP package within 30
                       days (or a PECP, see below, if that is not practical) because they normally do not
                       include sufficient detail for the government to determine the full impact on
                       program requirements.

Preliminary, (Type P)  Preliminary ECPs are used to address the impact of proposed changes in
                       general terms sufficient enough for the government to determine if final ECPs
                       are warranted. They are the used by program managers when:

                       • The complexity of a proposed change may require extensive funding,
                           development or engineering.

                       • A choice of alternative proposals is appropriate; especially if a solicitation or
                           contracting requirement is being competed between two or more contractors.

                       • Authority is required to expend resources to fully develop a change proposal.
                       • The government wishes to restrict configuration change activity.

                             • Approval is required to proceed with software engineering
                                   development.

                             • As follow-up to a message ECP when it is impractical to submit a
                                   complete Formal ECP within 30 days. This preliminary ECP would
                                   provide additional detail information supplementing the message ECP
                                   to provide the Government with a more considered analysis of the
                                   impacts and scope of the proposed change. In many cases such as
                                   Emergency, Urgent, Compatibility, the Government may have already
                                   authorized the contractor to proceed with the work based on the initial
                                   message.

Formal (Type F)        A formal ECP is the type which provides engineering information and other data
                       sufficient to support formal CCB approval and contractual implementation by the
                       Government

                       Page 6-19
```

## Table 6-5. Activity Guide: ECP Priorities (verbatim)

```text
               Table 6-5. Activity Guide: ECP Priorities

One of the following priorities shall be assigned to each Class I ECP by the originator to indicate the urgency with which the
ECP is to be reviewed, evaluated, ordered, and implemented. (The proposed priority as assigned and will stand unless the
tasking activity has a valid reason for changing the priority.)

Priority Code  Criteria

Emergency      An emergency priority is assigned to an ECP for any of the following reasons:
                 (1) To effect a change in operational characteristics which, if not accomplished without delay, may

               seriously compromise national security;
                 (2) To correct a hazardous condition which may result in fatal or serious injury to personnel or

               in extensive damage or destruction of equipment. (A hazardous condition usually will require
               withdrawing the item from service temporarily, or suspension of the item operation, or
               discontinuance of further testing or development pending resolution of the condition); or

                 (3) To correct a system halt (abnormal termination) in the production environment such that
               CSCI mission accomplishment is prohibited.

Urgent         An urgent priority is assigned to an ECP for any of the following reasons:
                 (1) To effect a change which, if not accomplished expeditiously, may seriously compromise the

               mission effectiveness of deployed equipment, software, or forces
                 (2) To correct a potentially hazardous condition, the un-corrected existence of which could result

               in injury to personnel or damage to equipment. (A potentially hazardous condition compromises
               safety and embodies risk, but within reasonable limits, permits continued use of the affected item
               provided the operator has been informed of the hazard and appropriate precautions have been
               defined and distributed to the user.)

                 (3) To meet significant contractual requirements (for example, when lead time will necessitate
               slipping approved production or deployment schedules if the change was not incorporated)

                 (4) To effect an interface change which, if delayed, would cause a schedule slippage or increase
               cost

                 (5) To effect a significant net life cycle cost savings to the tasking activity, as defined in the
               contract, where expedited processing of the change will be a major factor in realizing lower costs

                 (6) To correct a condition causing unusable output information that is critical to mission
               accomplishment

                 (7) To correct critical CI files that are being degraded
                 (8) To effect a change in operational characteristics to implement a new or changed regulatory
               requirement with stringent completion date requirements issued by an authority higher than that of
               the functional proponent.

Routine        A routine priority is assigned to an ECP when emergency or urgent implementation is not
               applicable, required or justifiable.

               Page 6-20
```

## Table 6-6. Activity Guide: ECP Content (text verbatim, rebuilt as a two-column table)

[EXTRACTOR NOTE] Rebuilt with PyMuPDF table detection from PDF pages 135 to 138 (handbook pages 6-21 to 6-24). Rows in bold are the table's sub-headings. In the source, an asterisk on an element means it also applies to a Class II ECP ("If Class II, only the ECP elements indicated with a symbol, and the following minimum information content, are applicable"); the asterisks are kept where they extracted. List bullets (a symbol font) are shown as "- ". The first row of handbook page 6-22 ("Consequences of Disapproval") is the last bullet of the "Need For Change" row, which spans the page break. Handbook page 6-23 has no Element header row; its table continues from the previous page.

| Element | Definition |
|---|---|
| **ECP Identification And Administrative Attributes** | |
| Date* | Submittal date of the ECP or ECP Revision |
| Originator name and address* | Name and address of the activity submitting The ECP |
| CAGE code* | CAGE code for the activity originating the ECP |
| ECP designation |  |
| Model/Type* | Model or type designation, or identifier of the CI or CSCI for which proposal is being submitted. |
| System designation* | The system or top-level CI designation or nomenclature |
| Procuring Activity Number (PAN) & PAN Year | Used when provided by Procuring Activity (Army only) |
| ECP Number* | ECP Identifier assigned by the originator. The ECP number is unique for any CAGE Code identified activity; once assigned, the ECP Number is retained for subsequent submissions. The same ECP number may be used for a related ECP by adding a dash number to the basic identifier. |
| Revision* | Identifier for an ECP Revision |
| Title of change* | Brief descriptive title for the engineering change proposal |
| ECP Classification* | See Table 6-2 If Class II, only the ECP elements indicated with a ∗ symbol, and the following minimum information content, are applicable:<br>- Name and part number of item affected<br>- Name and part number of next higher assembly<br>- Description of the engineering change<br>- Need (reason) for making the engineering change |
| ECP Justification Code | See Table 6-3 |
| ECP Type | See Table 6-4 |
| ECP Priority | See Table 6-5 |
| **Contract Information** | |
| Contract Number/ Contract Mod* | Number(s) of currently active contract(s) at the originator’s activity that are affected by the engineering change. |
| Contract Line Item | Contract line item number(s) to which the engineering change relates |
| Procuring contracting officer | Procuring Contracting Officer's name, code, and telephone number |
| Date Contractual Authority Needed for Production, Retrofit | Date contractual authority is required in order to maintain the established production schedule, and date contractual authority is needed to accomplish retrofit as proposed |
| **Description of Proposed Change** | |
| Configuration Item Nomenclature | Name and type designation, CSCI name and number, or other authorized name and number of all CI(s) affected by the ECP |
| Is the CI in production? | If "yes", provide information as to whether deliveries have been completed on the contract(s). This data is not always applicable to software |
| Description Of Change* | Description of the proposed change phrased in definitive language such that, if it is repeated in the contractual document authorizing the change, it will provide the authorization desired. Including the purpose and sufficient detail to describe what is to be accomplished. If the proposed change is an interim solution, it shall be so stated. |
| Need For Change * | Explanation of the need, identifying the benefit of the change, and as applicable:<br>- Correspondence such as a request for ECP or Government direction<br>- Quantitative improvements in performance characteristics (range, speed, performance, endurance, striking power, and defensive or offensive capabilities)<br>- Nature of a defect, failure, incident, malfunction; available failure data.<br>- Maintenance/ logistics problems corrected<br>- Identification and summary of testing accomplished<br>- Supporting data as necessary<br>- Consequences of Disapproval |
| Baseline Affected | Indicate whether Functional, Allocated or Product baseline(s) is affected |
| Developmental requirements and status. | If proposed engineering change requires a major revision of the development program, status of current program and details of the revision. When applicable, recommendations for additional tests, trials, installations, prototypes, fit checks, etc. Include the test objective and test vehicle(s) to be used. Indicate the development status of major items of to be used in and its availability in terms of the estimated production incorporation point. |
| Trade-Offs And Alternative Solutions. | Summary of the various solutions considered and reasons for adopting the solution proposed by the ECP. When analysis addresses new concepts or new technology, supporting data may be presented with the proposal to authenticate the trade-off analysis. |
| Production Effectivity by Serial Number | Proposed end item CI production effectivity for the production items including serial numbers, or other item identification (e.g., block or lot numbers). For CSCI's, the CSCI version number into which the change will be incorporated, if known, and the proposed effectivity of the end item CI (vehicle, aircraft, tank, ship, etc.) into which the capability represented by the new version of the software is proposed to be incorporated. |
| Proposed Delivery Schedule | Estimated delivery schedule of items incorporating the change, either in terms of days after contractual approval, or by specific dates contingent upon contractual approval by a specified date. (Indicate If there will be no effect on the delivery schedule.) |
| Retrofit |  |
| Recommendations for Retrofit | When applicable, description of recommendations for retrofit of the engineering change into accepted items (including applicable substantiating data or discussion of implications). If retrofit is not recommended, explanation/reason for the recommendation. |
| Recommended Retrofit Effectivity | Quantities and serial (or lot) numbers of accepted items in which the change is proposed for incorporated by retrofit with retrofit recommendations for items in production (at the time of the ECP) based on an estimated ECP approval date*. |
| Ship/Vehicle Class | When the delivered CI is installed in one or more ship/vehicle classes, enter the identification of such classes* |
| Locations or ship/vehicles numbers affected | The location(s) where retrofit is proposed to be accomplished. The ship hull numbers or vehicle numbers, if retrofit is to be accomplished in ships or vehicles*. |
| Estimated Retrofit Kit Delivery Schedule | Estimated kit delivery schedule by quantity and date. Dates of availability for any special tools, jigs, or test equipment required in conjunction with the kits*. |
| Order of Implementation | Identification of the ECPs and order of implementation, where this change must be accomplished before, with, or after other previously approved retrofit ECPs*. |
| Work Hours To Install And Test Retrofit Kits | - Work-hours per unit that must be programmed for to install the retrofit kit, test the system or the item following installation of the retrofit kit, and conduct system tests in all proposed installation environments, including where applicable, when weapon system is undergoing overhaul.<br>- Are contractor field service engineering or other supporting organizations required on site? If "yes" attach proposed requirements for participation.<br>- Estimate the total time period from removal of the equipment from operational service until equipment will be returned to operational status after being retrofitted.<br>- Estimate the out of service time from removal of the equipment from operational service until equipment will be returned to operational status after being retrofitted |
| *Apply to CSCI changes that are to be incorporated as part of a hardware or equipment change; and implemented per a hardware retrofit schedule, or where the fielded version of the software is to be replaced. |  |
| **Effects of the Proposed Change** | |
| Specifications affected | Identity specifications cited in the contract that are affected by the ECP, by the CAGE code of the design activity, document number and revision letter, and if applicable, the number of the NOR being submitted with the ECP. |
| Effect On Performance Allocations And Interfaces | The changes in performance and in functional/physical interfaces |
| Effects on employment, logistic support, training, operational effectiveness, or software | - Effects of the proposed change on operational employment, deployment, logistics, and/or personnel and training requirements specified in the approved system and/or CI specifications, including any changes or effects on operability and survivability. Quantitative values shall be used whenever practicable and are required when reliability and service life are impacted. Survivability includes nuclear survivability.<br>- Effect on interoperability.<br>- Effect on operational software. For CSCIs, as applicable:  Required changes to database parameters, values, or management procedures;  Anticipated effects on acceptable computer operating time and cycle-time utilization;  Estimate of the net effect on computer software storage; and,  Other relevant impact of the proposed change on utilization of the system. |
| Effect On Acquisition Logistic Support Elements | The following shall be covered, as applicable:<br>- Effects on schedule and content of the ALS plan.<br>- Effect on maintenance concept and plans for the levels of maintenance and procedures.<br>- System and/or CI logistics support analysis (LSA) tasks to be accomplished and LSA data requiring update (MIL-PRF-49506)<br>- Extension/revision of the interim support plan.<br>- Spares and repair parts that are changed, modified, obsolete, or added, including detailed supply data for interim support spares<br>- Revised or new technical manuals.<br>- Revised or new facilities requirements and site activation plan.<br>- New, revised, obsolete or additional support equipment (SE), test procedures and software.<br>- Description of the proposed change(s) to SE and trainers and reference to related ECPs.<br>- Effect on maintenance or training software<br>- Qualitative and quantitative personnel requirements data identifying additions or deletions to operator or maintenance manpower requirements in terms of personnel skill levels, knowledge and numbers required to support the modified CI.<br>- New operator and maintenance training requirements in terms of training equipment, trainers and training software for operator and maintenance courses. This information should include identification of specific courses, equipment, technical manuals, personnel, etc. required to set up the course at either the contractor or Government facility.<br>- Effect on contract maintenance that increases the scope or dollar limitation established in the contract.<br>- Effects on packaging, handling, storage, and transportability resulting from changes in materials, dimensions, fragility, inherent environmental or operating conditions. |
| Other considerations | The effects of the proposed engineering change on the following shall be identified:<br>- Interfaces having an effect on adjacent or related items (output, input, size, mating connections, etc.).<br>- GFE or Government Furnished Data (GFD) changed, modified or obsolete.<br>- Physical constraints. Removal or repositioning of items, structural rework, increase or decrease in overall dimensions.<br>- Software (other than operational, maintenance, and training software) requiring a change to existing code and/or, resources, or addition of new software.<br>- Rework required on other equipment not included previously which will effect the existing operational configuration.<br>- Additional or modified system test procedures required.<br>- Any new or additional changes having an effect on existing warranties or guarantees.<br>- Changes or updates to the parts control program.<br>- Effects on life cycle cost projections for the configuration item or program, including projections of operation and support costs/savings for the item(s) affected over the contractually defined life and projections of the costs/savings to be realized in planned future production and spares buys of the item(s) affected. |
| Lower level items affected. | Identifier of lower level CI, CSCI, or parts affected, and the quantity and NSN of each part, where applicable. |
| Other systems/ Configuration Items affected? | Identify other systems affected by the proposed change that are outside the purview of the originator. Indicate whether the effect on other systems or CIs requires the submittal of related Class I ECPs. |
| Other activities affected? | Identify other contractors or Government activities that will be affected by this engineering change. |
| Effect On Product Configuration Documentation. | If drawings or other product configuration documents that are ordered, or provided by the government are affected by the ECP, their identity by the CAGE code of the design activity, document number, revision letter, and, if applicable, the NOR number of the NOR being submitted with the ECP. |
| **Estimated Net Total Cost Impact (See Appendix B for Cost Spreadsheet Template)** | |
| Production Costs/(Savings) | Estimated costs/savings applicable to production of the item resulting from the change. Includes the costs of redesign of the CIs or components thereof, of factory test equipment, of special factory tooling, of scrap, of engineering design, of engineering data revision, of revision of test procedures, and of testing and verification of performance of new items. |
| Retrofit Costs | Estimated costs applicable to retrofit of the item including installation and testing costs. Includes retrofit-specific engineering data revision, prototype testing, kit proof testing, purchase of retrofit kits for operational systems, preparation of modification instructions, design and manufacture of special tooling for retrofit, installation of kits by contractor personnel, installation of kits by government personnel, testing after retrofit and modification, and testing and verification of performance of Government Furnished Equipment/Property (GFE/GFP). |
| Logistics Support Costs/(Savings) | Estimated costs/savings of the various elements of logistics support applicable to the item. Includes spares/repair parts rework, new spares and repair parts, supply/provisioning data, support equipment, retrofit kit for spares, operator training courses, maintenance training courses, revision of technical manuals, new technical manuals, training/trainers, interim support, maintenance manpower, and computer programs/documentation. |
| Other Costs/Savings | Includes estimated costs of interface changes accomplished by other contractor activities. (Do not include costs if the changes are covered by related ECPs by other contractors. Also includes estimated costs of interface changes accomplished by the Government for changes which must be accomplished in previously delivered items (aircraft, ships, facilities, etc.), other interfacing products, and/or retrofit of GFE/GFP, to the extent that such costs are not covered under production, retrofit, or logistics support. |
| Estimated Net Total Costs (Savings) | Total of all the costs (savings) under contract and from other costs (savings) |
| **Implementation Milestones** | |
| Milestones | ECP implementation milestones that show the time phasing of the various deliveries of items, support equipment, training equipment, and documentation incorporating the basic and related ECPs. Enter symbols and notations to show the initiation or termination of significant actions. Base all dates upon months after contractual approval of the basic ECPs. |

## Table 6-7. Activity Guide: ECP Review and Disposition Actions (verbatim, column layout approximate)

```text
                Table 6-7. Activity Guide: ECP Review and Disposition Actions

ECP Type &      Disposition By                                     Governing Criteria
   Action
                Government CCB       1. CCB decision does not mean that the contractor is authorized to proceed with the
Class I ECP                              performance of the change activity.
Approval
                                     2. Additional government actions, e.g., preparation of required funding documents and
                                         authorizations are usually necessary before the contractor or Government can be told
                                         to officially proceed with the change.
                                           • A formal contract modification is processed by the program manager through
                                                 the Contracting Officer (CO) to effect a Contractor ECP.
                                           • An approval letter from the program manager (or other representative identified
                                                 in the applicable tasking directive) is required to effect a performing
                                                 Government activity ECP.

CLASS I ECP     Government.          1. When Class I ECPs are disapproved, the only government action normally required is
Disapproval/    Program office or        preparation of a disapproval letter to be transmitted by the CO or other representative
Rejection       CCB                      identified in the contract.

                                     2. DoD policy requires that, as a courtesy, the ECP disapproval letters should provide the
                                         rationale for disapproval.

                                     3. The notification of rejection may include direction to revise and resubmit the ECP.

Class II ECP14  Government Plant     1. Government concurrence in Class II ECP classification, when required by contract,
Concurrence     Representative           signifies that the proposed change does not impact any of the Class I ECP criteria
or Non-         Office or other          [Table 6-3].
concurrence     Designated
                Government           2. Government concurrence normally allows the contractor to incorporate the change in
Class II ECP    Activity                 the applicable CI and update its configuration documentation without any further
Approval or     (On rare occasions,      Government CCB action, authorization, or contract modifications being required.
Disapproval     the issue of
                concurrence in       3. A non-concurrence in classification may result in the Class II ECP being:
                classification is          • Revised, reclassified and re-submitted as a Class I ECP for approval
                deferred to the            • Withdrawn if the proposed change is not desired. (Non-concurrence has the
                Procuring Activity               same effect as disapproval because it does not allow the contractor to
                for disposition)                 incorporate the change)

                Designated           1. Required only when unique program requirements deem it necessary, e.g.
                Government               Government approval of Class II ECPs may be required when approval/disapproval
                Activity                 authority is assigned to a Government activity different than the Government Plant
                                         Representative Office or the procuring activity.

                                     2. Government Plant Representative Office concurrence in classification may be required
                                         prior to submittal.

14 Under a performance based procurement, Class IIs need not be submitted for concurrence/approval if documentation affected
is under contractor’s control

                                                                 Page 6-25
```
