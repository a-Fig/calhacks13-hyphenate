// Bowman Aviation's configuration of Norn (#39).
//
// Norn is general; this file is the one place that makes it Bowman's. A deployment team reviews it,
// and a change to Bowman's setup is a reviewed change to this file. There is no settings screen.
//
//   node norn/config/src/cli.ts bowman/norn-config/bowman.config.ts          check it
//   node norn/config/src/cli.ts bowman/norn-config/bowman.config.ts --json   what Norn's state layer would store
//
// One source of truth: the change-control policy (approval tiers, CCB dates, fast-track and
// never-fast-track rules, target days) and the people live in bowman/data/company.ts, which also
// seeds the PLM and ERPNext. This file imports them and adds what only Norn needs: ids Norn can
// act on, class tests, roles, limits. If the policy there changes shape, the checks below stop the
// file from loading rather than let the two drift apart.
//
// Provenance (`prov`) follows the dataset: `sourced` traces to docs/IN-PRACTICE.md or the research,
// `invented` is Bowman's own choice. Every number under autonomy and materiality is invented. They
// are a starting point to tune against forecasts and overrides, not research findings.

import type { CompanyConfig } from '../../norn/config/src/schema.ts';
import { company, people as staff } from '../data/company.ts';
import { INV, PRACTICE, inv, src } from '../data/prov.ts';

const policy = company.changeControl;

// ---------------------------------------------------------------- guards against drift
// The structure below is typed here; the policy text and numbers come from the data. These checks
// fail loudly if the data no longer has the shape this file maps onto.

function expectShape(ok: boolean, what: string): void {
  if (!ok) throw new Error(`bowman.config.ts no longer matches bowman/data/company.ts: ${what}. Update both together.`);
}
expectShape(policy.approvalTiers.length === 3, 'expected 3 approval tiers');
expectShape(policy.approvalTiers[0]!.approver.startsWith('Technical Review Committee'), 'tier 1 should be the Technical Review Committee');
expectShape(policy.approvalTiers[1]!.approver.startsWith('Change Control Board'), 'tier 2 should be the Change Control Board');
expectShape(policy.approvalTiers[2]!.approver.startsWith('Program Management Committee'), 'tier 3 should be the Program Management Committee');
expectShape(policy.fastTrackCriteria.length === 4, 'expected 4 fast-track criteria');
expectShape(policy.neverFastTrack.length === 5, 'expected 5 never-fast-track rules');
expectShape(staff.filter((p) => p.ccbRole === 'chair').length === 1, 'expected exactly one CCB chair');

/** The data stores "no upper limit" as the largest safe integer. The config says null. */
const limit = (usd: number): number | null => (usd >= Number.MAX_SAFE_INTEGER ? null : usd);

// ---------------------------------------------------------------- roles
// A role is a seat in the data. `can` is what people in the seat may do; an agent acting for one of
// them may do no more (#34). Approval bodies below can only name roles that hold the matching action.

const roles: CompanyConfig['roles'] = [
  { id: 'design_engineer', label: 'Design engineer', can: ['file_ecr', 'approve_fast_track_ecr'] },
  { id: 'cm_analyst', label: 'Configuration management analyst', can: ['review_ecr', 'set_company_class', 'post_impact_statement', 'approve_fast_track_ecr', 'release_eco', 'write_bom'] },
  { id: 'ccb_chair', label: 'CCB chair (program manager)', can: ['file_ecr', 'review_ecr', 'approve_ecr_at_tier', 'release_eco'] },
  { id: 'engineering_director', label: 'Director of engineering', can: ['review_ecr', 'approve_ecr_at_tier'] },
  { id: 'cost_engineer', label: 'Product cost engineer', can: ['file_ecr', 'review_ecr', 'post_impact_statement'] },
  { id: 'buyer', label: 'Strategic procurement manager', can: ['review_ecr', 'post_impact_statement'] },
  { id: 'production_planner', label: 'Production planner', can: ['review_ecr', 'post_impact_statement'] },
  { id: 'cost_accountant', label: 'Cost accountant', can: ['review_ecr', 'post_impact_statement', 'update_standard_cost', 'draft_journal_entry', 'post_journal_entry'] },
  { id: 'quality', label: 'Quality engineer', can: ['file_ecr', 'review_ecr'] },
  { id: 'certification', label: 'Chief engineer and certification lead', can: ['review_ecr', 'set_regulatory_class'] },
  { id: 'manufacturing_engineer', label: 'Manufacturing engineer', can: ['review_ecr'] },
  { id: 'program_manager', label: 'Program manager', can: ['file_ecr', 'review_ecr'] },
  { id: 'operations_vp', label: 'VP operations and supply chain', can: ['review_ecr'] },
  { id: 'cfo', label: 'Chief financial officer', can: ['review_ecr', 'approve_ecr_at_tier'] },
];

// ---------------------------------------------------------------- people
// Straight from the dataset, so the PLM, ERPNext and Norn agree on who is who. Email addresses are
// left out: Norn has no use for them.

const people: CompanyConfig['people'] = [...staff]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    role: p.seat,
    ...(p.reportsTo ? { reportsTo: p.reportsTo } : {}),
    ...(p.ccbRole ? { boardRole: p.ccbRole } : {}),
  }));

/** Distinct seats of the people who hold a seat on the CCB, in the data's order. */
const ccbSeats = (boardRole: 'chair' | 'secretary' | 'member'): string[] => [...new Set(staff.filter((p) => p.ccbRole === boardRole).map((p) => p.seat))];

// ---------------------------------------------------------------- the configuration

const config = {
  schemaVersion: 1,

  company: {
    name: company.name,
    shortName: company.short,
    currency: company.currency,
  },

  // -------------------------------------------------------------- vocabulary
  // Bowman keeps the classic, widely known terms (Tyler, 2026-10-24). Releasing the ECO is what
  // tells planning, purchasing and accounting; there is no separate change notice (ECN).
  vocabulary: {
    terms: {
      problemReport: { name: 'Nonconformance report', abbreviation: 'NCR' },
      changeRequest: { name: 'Engineering change request', abbreviation: 'ECR' },
      changeOrder: { name: 'Engineering change order', abbreviation: 'ECO' },
      board: { name: 'Change Control Board', abbreviation: 'CCB' },
      impactAssessment: { name: 'Impact assessment' },
      impactStatement: { name: 'Change impact statement' },
      impactScreen: { name: 'Impact screen' },
      fullImpactAssessment: { name: 'Full impact assessment' },
      productionBaseline: { name: 'Production baseline' },
    },
    avoid: ['ECN', 'change notice', 'branch', 'merge', 'pull request', 'commit'],
    note: company.vocabulary,
    prov: src('docs/GLOSSARY.md', 'Two vocabularies: git words are for building, business words for everything a person sees.'),
  },

  // -------------------------------------------------------------- the ECR form (#6)
  // Modelled on the defense engineering change proposal: MIL-HDBK-61A Table 6-6 and Appendix B,
  // DD Form 1692. The FAA's major/minor class replaces government approval, and Bowman's own CCB is
  // the approving body. Class II asks for less: item, description and need (MIL-HDBK-61A Table 6-6).
  ecrForm: {
    idPrefix: 'ECR',
    idDigits: 4,
    priorities: [
      { id: 'emergency', label: 'Emergency', meaning: 'A line stopper now.', decisionWithinDays: policy.targetDays.emergency },
      { id: 'urgent', label: 'Urgent', meaning: 'Potential line stoppage within 30 days.', decisionWithinDays: policy.targetDays.urgent },
      { id: 'routine', label: 'Routine', meaning: 'Everything else.', decisionWithinDays: policy.targetDays.routine },
    ],
    justificationCodes: [
      { code: 'B', label: 'Interface' },
      { code: 'C', label: 'Compatibility' },
      { code: 'D', label: 'Correction of a deficiency' },
      { code: 'O', label: 'Operational or logistics support' },
      { code: 'P', label: 'Production stoppage' },
      { code: 'R', label: 'Cost reduction' },
      { code: 'S', label: 'Safety' },
      { code: 'V', label: 'Value engineering' },
    ],
    sections: [
      {
        id: 'identification',
        title: 'Identification',
        fields: [
          { id: 'title', label: 'Title', kind: 'text', required: 'draft' },
          { id: 'program', label: 'Program', kind: 'program', required: 'draft' },
          { id: 'priority', label: 'Priority', kind: 'priority', required: 'submit' },
          { id: 'justification', label: 'Justification code', kind: 'justificationCode', required: 'submit' },
          { id: 'company_class', label: 'Company class', kind: 'companyClass', required: 'submit', help: 'Norn proposes a class on every ECR; the CM analyst decides.' },
          { id: 'regulatory_class', label: 'FAA class', kind: 'regulatoryClass', required: 'submit', help: 'Your proposal. The certification lead decides.' },
          { id: 'ncr', label: 'Originating NCR', kind: 'ncr', required: 'optional' },
          { id: 'needed_by', label: 'Needed by', kind: 'date', required: 'optional' },
        ],
      },
      {
        id: 'change',
        title: 'The change',
        fields: [
          { id: 'description', label: 'Description of the change', kind: 'longText', required: 'draft' },
          { id: 'need', label: 'Need for the change', kind: 'longText', required: 'submit' },
          { id: 'consequences', label: 'Consequences if disapproved', kind: 'longText', required: 'submit', askedFor: ['I'] },
          { id: 'alternatives', label: 'Alternatives considered', kind: 'longText', required: 'submit', askedFor: ['I'] },
          { id: 'failure_data', label: 'Failure data', kind: 'longText', required: 'optional', askedFor: ['I'] },
          { id: 'faa_rationale', label: 'Why this FAA class', kind: 'longText', required: 'submit' },
          { id: 'test_and_qualification', label: 'Testing and requalification expected', kind: 'longText', required: 'submit', askedFor: ['I'] },
        ],
      },
      {
        id: 'items',
        title: 'Affected items',
        fields: [
          { id: 'affected_items', label: 'Affected items and their redlines', kind: 'affectedItems', required: 'draft' },
          { id: 'inventory', label: 'Old stock: what happens to it', kind: 'inventoryDisposition', required: 'submit', askedFor: ['I'], help: 'Stores, work in progress, finished goods, supplier, on order, in the field.' },
        ],
      },
      {
        id: 'effectivity',
        title: 'Effectivity',
        fields: [{ id: 'effectivity', label: 'Production cut-in and retrofit', kind: 'effectivity', required: 'submit' }],
      },
      {
        id: 'cost',
        title: 'Cost page',
        fields: [{ id: 'cost_page', label: 'Cost page', kind: 'costPage', required: 'submit', askedFor: ['I'], help: 'Fill what you know. Norn fills the rest and marks which is which.' }],
      },
    ],
    costPage: {
      blocks: [
        { id: 'production', label: 'Production', covers: 'Unit cost of the changed item, factory test equipment, special tooling, scrap, engineering and data revision, test procedures, qualification.' },
        { id: 'retrofit', label: 'Retrofit', covers: 'Kits, special tooling, installation and testing on aircraft already built.' },
        { id: 'logistics_support', label: 'Logistics support', covers: 'Spares, provisioning, training, manuals, support equipment, interim support.' },
        { id: 'other', label: 'Other', covers: 'Anything the three blocks above do not cover.' },
      ],
      oneTimeLabel: 'One-time (non-recurring)',
      recurringLabel: 'Recurring (unit cost x quantity)',
      savingsNotation: 'parentheses',
    },
    prov: src(`${PRACTICE} §1 and §8`, 'ECP fields from MIL-HDBK-61A Table 6-6, justification codes from Table 6-3, cost blocks from Appendix B. Target days are the dataset\'s policy.'),
  },

  // -------------------------------------------------------------- change classes (#33)
  // Two separate calls that can disagree: an ECR can be Class I for cost and FAA minor for
  // airworthiness. There is no DER step. Bowman is the design approval holder and decides major or
  // minor itself (FAA Order 8110.37G); a DER does not approve data for minor changes.
  changeClasses: {
    company: {
      label: 'Company class',
      values: [
        {
          id: 'I',
          label: 'Class I',
          meaning: 'Needs formal approval.',
          triggers: [
            'Changes form, fit or function',
            'Changes cost or schedule',
            'Touches safety or a flight-safety part',
            'Retrofits aircraft already built or delivered',
            'Changes interchangeability',
          ],
        },
        {
          id: 'II',
          label: 'Class II',
          meaning: 'Everything that is not Class I: documentation fixes, approved alternates, internal changes that leave form, fit, function, cost and schedule alone.',
        },
      ],
      whenUnsure: 'I',
      proposedBy: ['originator', 'norn'],
      decidedBy: 'cm_analyst',
      note: 'The CM analyst makes the final classification.',
    },
    regulatory: {
      label: 'FAA class',
      values: [
        { id: 'minor', label: 'Minor', meaning: 'No appreciable effect on weight, balance, structural strength, reliability, operational characteristics or other airworthiness qualities (14 CFR 21.93).' },
        { id: 'major', label: 'Major', meaning: 'Any change that is not minor. Can mean new testing and approval, often the largest schedule risk.' },
      ],
      whenUnsure: 'major',
      proposedBy: ['originator', 'norn'],
      decidedBy: 'certification',
      note: 'The originator proposes and Norn reviews. The certification lead decides, as the design approval holder.',
    },
    prov: src(`${PRACTICE} §4`, 'Company Class I/II after MIL-HDBK-61A Table 6-2; FAA major/minor from 14 CFR 21.93 and Order 8110.37G.'),
  },

  // -------------------------------------------------------------- approval (#22)
  // The tiers, CCB dates and the fast-track and never-fast-track rules come from the dataset.
  approval: {
    // Tiers use the upper tail of the forecast over the first year of production, so a change that
    // might cost more than a limit goes to the body above it.
    routedOn: { percentile: 'p90', horizonMonths: 12 },
    bodies: [
      {
        id: 'trc',
        name: 'Technical Review Committee',
        chairRole: 'engineering_director',
        memberRoles: ['quality', 'certification', 'cm_analyst'],
      },
      {
        id: 'ccb',
        name: 'Change Control Board',
        chairRole: ccbSeats('chair')[0]!,
        memberRoles: ccbSeats('member'),
        secretaryRole: ccbSeats('secretary')[0]!,
        cadence: policy.ccbCadence,
        meetings: policy.ccbMeetings,
      },
      {
        id: 'pmc',
        name: 'Program Management Committee',
        chairRole: 'cfo',
        memberRoles: ['operations_vp', 'certification'],
      },
    ],
    tiers: [
      { id: 'technical_review', upToUsd: limit(policy.approvalTiers[0]!.upToUsd), body: 'trc', alsoReviewsAbove: true },
      { id: 'board', upToUsd: limit(policy.approvalTiers[1]!.upToUsd), body: 'ccb' },
      { id: 'program_management', upToUsd: limit(policy.approvalTiers[2]!.upToUsd), body: 'pmc' },
    ],
    fastTrack: {
      // "The CM analyst and the owning design engineer, without convening the board."
      approvers: [{ role: 'cm_analyst' }, { role: 'design_engineer', mustOwnTheChange: true }],
      requireAll: [
        { id: 'company_class_ii', text: 'Company Class II', whenClass: { axis: 'company', value: 'II' } },
        { id: 'faa_minor', text: 'FAA minor', whenClass: { axis: 'regulatory', value: 'minor' } },
        { id: 'no_form_fit_function_change', text: policy.fastTrackCriteria[1]! },
        { id: 'same_supplier_no_tooling', text: policy.fastTrackCriteria[3]! },
      ],
      // The dataset lists these kinds as one criterion: "Swaps from the pre-authorized equivalents
      // list, obsolescence replacements and documentation fixes". The supplier-notified change is
      // added from docs/IN-PRACTICE.md §4 ("Minor supplier changes notified, not approved").
      requireOneOf: [
        { id: 'authorized_equivalent', text: 'A swap from the pre-authorized equivalents list' },
        { id: 'obsolescence_replacement', text: 'An obsolescence replacement' },
        { id: 'documentation_fix', text: 'A documentation fix' },
        { id: 'supplier_notified_change', text: 'A minor supplier change that is notified, not approved' },
      ],
    },
    neverFastTrack: [
      { id: 'safety_part', text: policy.neverFastTrack[0]! },
      { id: 'interchangeability_or_interface', text: policy.neverFastTrack[1]! },
      { id: 'retrofit_of_delivered_units', text: policy.neverFastTrack[2]! },
      { id: 'supplier_process_or_tooling', text: policy.neverFastTrack[3]! },
      { id: 'faa_major', text: policy.neverFastTrack[4]!, whenClass: { axis: 'regulatory', value: 'major' } },
    ],
    prov: policy.prov,
  },

  roles,
  people,

  // -------------------------------------------------------------- agent autonomy (#22, #24)
  // One rule per action. An agent acting for a person is also held to that person's role (`can`
  // above), and the stricter of the two applies (#34). Defaults are conservative on money and
  // certification and open on routine work; widen a rule when forecast-versus-actual results and
  // override rates support it.
  autonomy: {
    actingFor: 'stricter',
    actions: [
      {
        action: 'file_ecr',
        level: 'recommend',
        why: 'Norn can draft an ECR from an NCR or from prose. A person files it.',
      },
      {
        action: 'review_ecr',
        level: 'recommend',
        why: 'Concurrence is a board member\'s signature. Norn\'s view comes as the impact statement and its recommendation.',
      },
      {
        action: 'set_company_class',
        level: 'approve_sampled',
        sampleRate: 0.25,
        escalateOn: ['safety_part'],
        escalateTo: 'cm_analyst',
        why: 'Classing is routine and checkable, so Norn does it and a quarter get a blind second read. A safety part goes to the CM analyst, because a filing can claim Class II on one.',
      },
      {
        action: 'set_regulatory_class',
        level: 'recommend',
        why: 'Bowman is the design approval holder, so the certification lead decides FAA major or minor. Norn recommends with its reasoning.',
      },
      {
        action: 'post_impact_statement',
        level: 'approve',
        why: 'Every post passes the post check (#35) before it goes up, so the check is the control.',
      },
      {
        action: 'approve_fast_track_ecr',
        level: 'approve_sampled',
        sampleRate: 0.2,
        // #26 is open: whether a Level 1 report is enough to approve on, or only Level 3. Set to 1
        // so the fast track works before the deep review exists; raise to 3 to require the final verdict.
        limits: { maxP90CostUsd: 25_000, maxP90SlipDays: 14, minReportLevel: 1 },
        otherwise: 'recommend',
        escalateOn: ['safety_part', 'new_supplier', 'conflicting_open_ecr', 'shared_supplier_exposure', 'linchpin_assumption_agent_estimated', 'sources_conflict', 'stale_data', 'checker_disagrees'],
        escalateTo: 'cm_analyst',
        why: 'Most changes are small and CMII fast-tracks 75 to 85 percent of them. Within the limits Norn approves and a fifth get a blind second read. Past a limit it recommends; on any named trigger the CM analyst gets it with the work done.',
      },
      {
        action: 'approve_ecr_at_tier',
        level: 'recommend',
        why: 'The approval bodies decide. Norn files its recommendation first, so the body opens a finished package.',
      },
      {
        action: 'release_eco',
        level: 'approve',
        limits: { maxP90CostUsd: 25_000 },
        otherwise: 'recommend',
        why: 'Releasing follows an approval that already carried authority. Within the fast-track limit Norn releases; above it the CM analyst does.',
      },
      {
        action: 'write_bom',
        level: 'approve_sampled',
        sampleRate: 0.5,
        why: 'A mechanical copy of a released ECO\'s redlines. A blind recompute of the BOM difference on half of them catches a bad mapping.',
      },
      {
        action: 'update_standard_cost',
        level: 'approve_sampled',
        sampleRate: 0.5,
        limits: { maxP90CostUsd: 150_000 },
        otherwise: 'recommend',
        why: 'Standard cost drives the books. Below the first approval tier Norn updates it and half get a blind recompute. Above it the cost accountant decides.',
      },
      {
        action: 'draft_journal_entry',
        level: 'approve',
        why: 'A draft moves no balance, and the cost accountant sees every draft before it posts.',
      },
      {
        action: 'post_journal_entry',
        level: 'recommend',
        why: 'Posting touches the ledger. The cost accountant posts, with Norn\'s draft and the decision behind it ready.',
      },
    ],
    prov: inv('Starting point for Bowman, set by the principle in #24. Every limit and sample rate here is invented.'),
  },

  // -------------------------------------------------------------- review depth (#10, #26)
  // The cheap tier (the impact screen) always runs. The deep tier waits until someone asks, once
  // or at most twice per ECR, except for the kinds of change known to need it.
  reviewDepth: {
    deepReview: {
      mode: 'on_request',
      autoFor: [{ axis: 'regulatory', value: 'major' }],
      maxPasses: 2,
      mayRequest: ['design_engineer', 'cm_analyst', 'ccb_chair', 'engineering_director', 'cost_engineer', 'buyer', 'production_planner', 'cost_accountant', 'cfo'],
    },
    prov: src('docs/PLAN.md §3', '"Ideally once per ECR, and at most twice" (#10). The FAA-major trigger is Bowman\'s choice.'),
  },

  // -------------------------------------------------------------- materiality (#30)
  // The restraint of a good analyst in front of the CFO: no nitpicks, no inflating. The relative
  // bar is a share of the unit's current standard cost (about $2.8M for Vesper), so 0.01 percent is
  // about $280 per aircraft.
  materiality: {
    unitCost: { absoluteUsd: 250, relativePct: 0.01 },
    oneTimeCostUsd: 10_000,
    cutInSlipDays: 14,
    dispositionSwingUsd: 10_000,
    driverMinSharePct: 10,
    maxFlagsPerStatement: 3,
    whenNothingMaterial: 'Nothing here needs more than a routine look.',
    prov: INV,
  },

  // -------------------------------------------------------------- posting standards (#35)
  // What every agent post must satisfy before it goes up. Each requirement is a check Norn runs;
  // `reason` completes the sentence "This can't be posted because ..." for the posting agent.
  postingStandards: {
    agents: ['norn', 'outside'],
    requirements: [
      { check: 'cite_sources', appliesTo: ['impact_statement', 'recommendation', 'escalation'], enforcement: 'block', reason: 'it states a fact without naming where it was read: give the system, the record and the as-of date' },
      { check: 'quote_matches_source', appliesTo: ['impact_statement', 'recommendation', 'escalation'], enforcement: 'block', reason: 'a quotation does not appear word for word in the source it cites' },
      { check: 'evidence_class', appliesTo: ['impact_statement', 'recommendation', 'escalation'], enforcement: 'block', reason: 'a number or claim is not marked fact, assumption, computation or judgment' },
      { check: 'numbers_are_ranges', appliesTo: ['impact_statement'], enforcement: 'block', reason: 'a forecast number is a single point: give it as a range' },
      { check: 'numbers_from_computation', appliesTo: ['impact_statement', 'recommendation'], enforcement: 'block', reason: 'a figure in the text is not one of Norn\'s computed values' },
      { check: 'likelihood_words', appliesTo: ['impact_statement', 'recommendation', 'escalation'], enforcement: 'block', reason: 'a probability is not stated in the likelihood scale\'s words, or likelihood and confidence share a sentence' },
      { check: 'flag_assumptions', appliesTo: ['impact_statement'], enforcement: 'block', reason: 'an assumption an agent estimated is not marked as one, with its rationale' },
      { check: 'label_outside_evidence', appliesTo: ['impact_statement', 'recommendation', 'comment'], enforcement: 'block', reason: 'evidence from an outside agent is not marked as reported by that agent' },
      { check: 'company_vocabulary', appliesTo: ['impact_statement', 'recommendation', 'escalation', 'comment'], enforcement: 'block', reason: 'it uses a word the company avoids' },
      { check: 'bottom_line_first', appliesTo: ['impact_statement', 'recommendation', 'escalation'], enforcement: 'warn', reason: 'it does not open with the bottom line' },
      { check: 'sbar_escalation', appliesTo: ['escalation'], enforcement: 'block', reason: 'it does not state situation, background, assessment and recommendation' },
    ],
    evidenceClasses: [
      { id: 'fact', label: 'Fact', meaning: 'Read from a source such as the ERP, the PLM or a quote.' },
      { id: 'assumption', label: 'Assumption', meaning: 'Supposed, in order to frame or support the analysis.' },
      { id: 'computation', label: 'Computation', meaning: 'Calculated by code from other values.' },
      { id: 'judgment', label: 'Judgment', meaning: 'The agent\'s conclusion.' },
    ],
    // The intelligence community's fixed scale (ODNI ICD 203). Likelihood and confidence are stated apart.
    likelihoodScale: [
      { word: 'almost no chance', fromPct: 1, toPct: 5 },
      { word: 'very unlikely', fromPct: 5, toPct: 20 },
      { word: 'unlikely', fromPct: 20, toPct: 45 },
      { word: 'roughly even', fromPct: 45, toPct: 55 },
      { word: 'likely', fromPct: 55, toPct: 80 },
      { word: 'very likely', fromPct: 80, toPct: 95 },
      { word: 'almost certain', fromPct: 95, toPct: 99 },
    ],
    maxFixAttempts: 2,
    prov: src('docs/GLOSSARY.md', 'Evidence classes and ICD 203 likelihood words (Tyler, 2026-10-24). Which checks block and the fix limit are Bowman\'s choice.'),
  },
} satisfies CompanyConfig;

export default config;
