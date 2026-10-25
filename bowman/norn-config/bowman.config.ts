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
// act on, class tests, roles, limits. Each policy entry is found by what it says, not by its
// position in a list, and the file refuses to load if one is missing or doubled, so a reordered or
// reworded source cannot silently swap one rule for another.
//
// Provenance (`prov`) follows the dataset: `sourced` traces to docs/IN-PRACTICE.md or the research,
// `invented` is Bowman's own choice. Every number under autonomy and materiality is invented. They
// are a starting point to tune against forecasts and overrides, not research findings.
//
// Amounts are in the company currency (USD).

import type { CompanyConfig } from '../../norn/config/src/schema.ts';
import { findOne } from '../../norn/config/src/pick.ts';
import { company, people as staff } from '../data/company.ts';
import { INV, PRACTICE, inv, src } from '../data/prov.ts';

const policy = company.changeControl;

// ---------------------------------------------------------------- guards against drift
// The structure below is typed here; the policy text and numbers come from the data. These checks
// fail loudly if the data no longer has the shape this file maps onto.

function expectShape(ok: boolean, what: string): void {
  if (!ok) throw new Error(`bowman.config.ts no longer matches bowman/data/company.ts: ${what}. Update both together.`);
}
// Counts catch an entry added or dropped; the lookups below catch one reworded or replaced.
expectShape(policy.approvalTiers.length === 3, 'expected 3 approval tiers');
expectShape(policy.fastTrackCriteria.length === 4, 'expected 4 fast-track criteria');
expectShape(policy.neverFastTrack.length === 5, 'expected 5 never-fast-track rules');
expectShape(staff.filter((p) => p.ccbRole === 'chair').length === 1, 'expected exactly one CCB chair');

const tierOf = (name: string) => findOne(policy.approvalTiers, name, 'bowman/data/company.ts changeControl.approvalTiers', (t) => t.approver);
const trcTier = tierOf('Technical Review Committee');
const ccbTier = tierOf('Change Control Board');
const pmcTier = tierOf('Program Management Committee');
expectShape(pmcTier.approver.includes('CFO'), 'the Program Management Committee should be chaired by the CFO');

// Three facts below are read from the policy text rather than restated, so rewording the text stops
// the file from loading instead of leaving the old fact in place.

// "...; also reviews everything above": the committee also sees the changes the tiers above decide.
const TRC_ALSO_REVIEWS_ABOVE = 'also reviews everything above';
findOne([trcTier.approver], TRC_ALSO_REVIEWS_ABOVE, 'bowman/data/company.ts changeControl.approvalTiers[Technical Review Committee]');

// "Change Control Board (chaired by the Vesper program manager)": the person whose title says so.
const chairedBy = /chaired by the ([^)]+)/.exec(ccbTier.approver)?.[1];
expectShape(chairedBy !== undefined, 'the Change Control Board tier should say who chairs it ("chaired by the ...")');
const ccbChair = findOne(
  staff,
  chairedBy!.toLowerCase().split(/\s+/),
  `bowman/data/company.ts people: the one whose title matches the board chair "${chairedBy}"`,
  (p) => p.title.toLowerCase()
);
expectShape(ccbChair.ccbRole === 'chair', `${ccbChair.name}, whom the tier text names as chair, should have ccbRole "chair" in people`);

// "The CM analyst and the owning design engineer, without convening the board": who must sign.
const APPROVER_FOR_PHRASE: Record<string, { role: string; mustOwnTheChange?: true }> = {
  'CM analyst': { role: 'cm_analyst' },
  'owning design engineer': { role: 'design_engineer', mustOwnTheChange: true },
};
const fastTrackApprovers = policy.fastTrackApprover
  .split(', without ')[0]!
  .replace(/^The /, '')
  .split(/ and the | and |, the |, /)
  .map((phrase) => {
    const approver = APPROVER_FOR_PHRASE[phrase.trim()];
    expectShape(approver !== undefined, `the fast-track approvers include "${phrase.trim()}", which this file has no role for`);
    return approver!;
  });

/** The never-fast-track rule that mentions `word`. */
const neverFastTrackRule = (word: string): string => findOne(policy.neverFastTrack, word, 'bowman/data/company.ts changeControl.neverFastTrack');
/** The fast-track criterion that mentions every one of `words`. */
const fastTrackCriterion = (...words: string[]): string => findOne(policy.fastTrackCriteria, words, 'bowman/data/company.ts changeControl.fastTrackCriteria');

// The first criterion is restated below as two class tests, and the third as four kinds of change.
// Finding them here proves the data still says what those restatements say.
fastTrackCriterion('Class II', 'FAA minor');
fastTrackCriterion('pre-authorized', 'obsolescence', 'documentation');

// The Technical Review Committee is named in the tier-1 approver text, in brackets, as seats:
// "Technical Review Committee (engineering director, quality, certification, CM analyst); ...".
// The data names no chair. This file makes it the director of engineering, and refuses to load if the
// data stops listing that seat.
const TRC_CHAIR = 'engineering_director';
const SEAT_FOR_PHRASE: Record<string, string> = {
  'engineering director': 'engineering_director',
  quality: 'quality',
  certification: 'certification',
  'CM analyst': 'cm_analyst',
};
const trcSeats: string[] = (/\(([^)]*)\)/.exec(trcTier.approver)?.[1] ?? '').split(',').map((phrase) => {
  const seat = SEAT_FOR_PHRASE[phrase.trim()];
  expectShape(seat !== undefined, `the Technical Review Committee lists "${phrase.trim()}", which this file has no role for`);
  return seat!;
});
expectShape(trcSeats.length >= 2, 'the Technical Review Committee should list a chair and members in brackets');
expectShape(trcSeats.includes(TRC_CHAIR), `the Technical Review Committee should list the ${TRC_CHAIR} seat, which this file makes its chair`);

/** The data stores "no upper limit" as the largest safe integer. The config says null. */
const limit = (usd: number): number | null => (usd >= Number.MAX_SAFE_INTEGER ? null : usd);

// ---------------------------------------------------------------- roles
// A role is a seat in the data. `can` is what people in the seat may do; an agent acting for one of
// them may do no more (#34). Approval bodies below can only name roles that hold the matching action.
// The seats are the dataset's; the permissions are Bowman's own model, since the dataset describes
// each seat's duties in prose, not as permissions.

const PERMISSIONS = inv('Which seat may do which gated action is invented for Bowman. The dataset records each seat\'s responsibilities in prose, not as permissions.');

const roleRows: Omit<CompanyConfig['roles'][number], 'prov'>[] = [
  { id: 'design_engineer', label: 'Design engineer', can: ['file_ecr', 'approve_fast_track_ecr'] },
  { id: 'cm_analyst', label: 'Configuration management analyst', can: ['review_ecr', 'set_company_class', 'post_impact_statement', 'approve_fast_track_ecr', 'release_eco'] },
  { id: 'ccb_chair', label: 'CCB chair (program manager)', can: ['file_ecr', 'review_ecr', 'approve_ecr_at_tier', 'release_eco'] },
  { id: 'engineering_director', label: 'Director of engineering', can: ['review_ecr', 'approve_ecr_at_tier'] },
  { id: 'cost_engineer', label: 'Product cost engineer', can: ['file_ecr', 'review_ecr', 'post_impact_statement'] },
  { id: 'buyer', label: 'Strategic procurement manager', can: ['review_ecr', 'post_impact_statement'] },
  { id: 'production_planner', label: 'Production planner', can: ['review_ecr', 'post_impact_statement'] },
  { id: 'cost_accountant', label: 'Cost accountant', can: ['review_ecr', 'post_impact_statement', 'update_standard_cost', 'draft_journal_entry', 'post_journal_entry'] },
  { id: 'quality', label: 'Quality engineer', can: ['file_ecr', 'review_ecr'] },
  { id: 'certification', label: 'Chief engineer and certification lead', can: ['review_ecr', 'set_regulatory_class'] },
  { id: 'manufacturing_engineer', label: 'Manufacturing engineer', can: ['review_ecr', 'write_bom'] },
  { id: 'program_manager', label: 'Program manager', can: ['file_ecr', 'review_ecr'] },
  { id: 'operations_vp', label: 'VP operations and supply chain', can: ['review_ecr'] },
  { id: 'cfo', label: 'Chief financial officer', can: ['review_ecr', 'approve_ecr_at_tier'] },
];
const roles: CompanyConfig['roles'] = roleRows.map((row) => ({ ...row, prov: PERMISSIONS }));

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
    ...(p.ccbRole ? { ccbRole: p.ccbRole } : {}),
  }));

/** Distinct seats of the people who hold a seat on the CCB, in the data's order. */
const ccbSeats = (ccbRole: 'chair' | 'secretary' | 'member'): string[] => [...new Set(staff.filter((p) => p.ccbRole === ccbRole).map((p) => p.seat))];

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
    // The vocabulary check blocks a post that uses one of these, so ordinary business words stay off the
    // list: "Halden can commit to 6 weeks" is fine, though "commit" is also a git word.
    avoid: ['ECN', 'change notice', 'branch', 'merge', 'pull request'],
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
          { id: 'company_class', label: 'Company class', kind: 'companyClass', required: 'submit', help: 'Fern proposes a class; the CM analyst has the final say.' },
          { id: 'regulatory_class', label: 'FAA class', kind: 'regulatoryClass', required: 'submit', help: 'Your proposal. The certification lead has the final say.' },
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
        fields: [{ id: 'cost_page', label: 'Cost page', kind: 'costPage', required: 'submit', askedFor: ['I'], help: 'Fill what you know. Fern fills the rest and marks which is which.' }],
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
            'Changes unit cost, one-time cost or a schedule milestone by more than the materiality thresholds',
            'Touches safety or a flight-safety part',
            'Retrofits aircraft already built or delivered',
            'Changes interchangeability',
          ],
        },
        {
          id: 'II',
          label: 'Class II',
          meaning: 'Everything that is not Class I: documentation fixes, approved alternates, and internal changes that leave form, fit and function alone and move cost and schedule by less than the materiality thresholds.',
        },
      ],
      whenUnsure: 'I',
      proposedBy: ['originator', 'norn'],
      decidedBy: 'cm_analyst',
      note: 'Fern proposes a class and the CM analyst has the final say, and can change it at any time. Whether Fern\'s class takes effect before the CM analyst has seen it is the autonomy level of set_company_class.',
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
      note: 'The originator proposes and Fern reviews. The certification lead has the final say, as the design approval holder, and the class does not take effect until the lead has set it (set_regulatory_class is recommend only).',
    },
    prov: src(`${PRACTICE} §4`, 'Company Class I/II after MIL-HDBK-61A Table 6-2; FAA major/minor from 14 CFR 21.93 and Order 8110.37G.'),
  },

  // -------------------------------------------------------------- approval (#22)
  // The tiers, CCB dates and the fast-track and never-fast-track rules come from the dataset.
  approval: {
    // One measure of what a change costs, used to pick the tier below and to bound every autonomy
    // limit, by its size: the absolute value. The upper tail of the forecast over the first year of
    // production, so a change that might cost more than a limit goes to the body above it. Savings do
    // not net off spend: the size is the larger of the spend and the saving. A change with 1.8M of
    // tooling that saves 1M routes as 1.8M, one that saves 3M routes as 3M, and no agent limit sees
    // either as small.
    // Proposed, for Tyler to confirm. Kept out of `prov`, which is stored with the config.
    costMeasure: {
      percentile: 'p90',
      horizonMonths: 12,
      savingsOffset: false,
      prov: inv('Invented for Bowman: the dataset gives dollar tiers but not how a change\'s cost is measured against them.'),
    },
    bodies: [
      {
        id: 'trc',
        name: 'Technical Review Committee',
        chairRole: TRC_CHAIR,
        memberRoles: trcSeats.filter((seat) => seat !== TRC_CHAIR),
        prov: src('bowman/data/company.ts changeControl.approvalTiers', 'The members are the seats the dataset lists for the committee. It names no chair; this file takes the director of engineering as chair.'),
      },
      {
        id: 'ccb',
        name: 'Change Control Board',
        chairRole: ccbChair.seat,
        memberRoles: ccbSeats('member'),
        secretaryRole: ccbSeats('secretary')[0]!,
        cadence: policy.ccbCadence,
        meetings: policy.ccbMeetings,
        prov: src(`${PRACTICE} §2`, 'Chair, members and secretary are the dataset\'s board seats (people.ccbRole). The cadence and dates are the dataset\'s invented schedule.'),
      },
      {
        id: 'pmc',
        name: 'Program Management Committee',
        chairRole: 'cfo',
        memberRoles: ['operations_vp', 'certification'],
        prov: inv('The dataset names the CFO and "the executive team". Which executives sit on the committee is invented.'),
      },
    ],
    tiers: [
      { id: 'technical_review', upTo: limit(trcTier.upToUsd), body: 'trc', alsoReviewsAbove: true }, // guarded by TRC_ALSO_REVIEWS_ABOVE above
      { id: 'board', upTo: limit(ccbTier.upToUsd), body: 'ccb' },
      { id: 'program_management', upTo: limit(pmcTier.upToUsd), body: 'pmc' },
    ],
    fastTrack: {
      // Who signs is read from the dataset's fastTrackApprover text, above.
      approvers: fastTrackApprovers,
      requireAll: [
        // The first criterion in the data, "Company Class II and FAA minor", as two class checks.
        { id: 'company_class_ii', text: 'Company Class II', whenClass: { axis: 'company', value: 'II' } },
        { id: 'faa_minor', text: 'FAA minor', whenClass: { axis: 'regulatory', value: 'minor' } },
        { id: 'no_form_fit_function_change', text: fastTrackCriterion('form, fit, function') },
        { id: 'same_supplier_no_tooling', text: fastTrackCriterion('first-article') },
      ],
      // The dataset lists these kinds as one criterion: "Swaps from the pre-authorized equivalents
      // list, obsolescence replacements and documentation fixes". docs/IN-PRACTICE.md §4 also lists
      // minor supplier changes notified, not approved; the dataset does not, so this file does not.
      requireOneOf: [
        { id: 'authorized_equivalent', text: 'A swap from the pre-authorized equivalents list' },
        { id: 'obsolescence_replacement', text: 'An obsolescence replacement' },
        { id: 'documentation_fix', text: 'A documentation fix' },
      ],
    },
    neverFastTrack: [
      { id: 'safety_part', text: neverFastTrackRule('safety') },
      { id: 'interchangeability_or_interface', text: neverFastTrackRule('Interchangeability') },
      { id: 'retrofit_of_delivered_units', text: neverFastTrackRule('Retrofit') },
      { id: 'supplier_process_or_tooling', text: neverFastTrackRule('first-article') },
      { id: 'faa_major', text: neverFastTrackRule('FAA-major'), whenClass: { axis: 'regulatory', value: 'major' } },
    ],
    prov: policy.prov,
  },

  roles,
  people,

  // -------------------------------------------------------------- agent autonomy (#22, #24)
  // One rule per action. An agent acting for a person is also held to that person's role (`can`
  // above), and the stricter of the two applies (#34). Defaults are conservative on money and
  // certification and open on routine work; widen a rule when forecast-versus-actual results and
  // override rates support it. Every maxCost below is measured by approval.costMeasure.
  //
  // approve_sampled: a second agent recomputes blind, and the sample is drawn from the ECR's PLM number,
  // the action and sampleSeed. recommend: the roles that hold the action receive it. The never-fast-track
  // rules above are checked first, so they win over the escalation triggers on approve_fast_track_ecr.
  // Norn never writes to the ERP (#71), so the four ERP actions can only be recommended: each is a line
  // of the ERP change package on the released ECO (#72), for the role that holds it to enter.
  autonomy: {
    actingFor: 'stricter',
    // Bowman's own seed, apart from the forecast `seed` in the state layer, so re-seeding forecasts
    // does not re-draw the samples. Changing this string is a governance change.
    sampleSeed: 'norn-sample-1',
    actions: [
      {
        action: 'file_ecr',
        level: 'recommend',
        why: 'Fern can draft an ECR from an NCR or from prose. A person files it.',
      },
      {
        action: 'review_ecr',
        level: 'recommend',
        why: 'Concurrence is a board member\'s signature. Fern\'s view comes as the impact statement and its recommendation.',
      },
      {
        action: 'set_company_class',
        level: 'approve_sampled',
        sampleRate: 0.25,
        escalateOn: ['safety_part'],
        escalateTo: 'cm_analyst',
        why: 'Classing is routine and checkable, so Fern does it and a quarter get a blind second read. A safety part goes to the CM analyst, because a filing can claim Class II on one.',
      },
      {
        action: 'set_regulatory_class',
        level: 'recommend',
        why: 'Bowman is the design approval holder, so the certification lead decides FAA major or minor. Fern recommends with its reasoning.',
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
        limits: { maxCost: 25_000, maxP90SlipDays: 14, minReportLevel: 1 },
        otherwise: 'recommend',
        escalateOn: ['safety_part', 'new_supplier', 'conflicting_open_ecr', 'shared_supplier_exposure', 'linchpin_assumption_agent_estimated', 'sources_conflict', 'stale_data', 'checker_disagrees'],
        escalateTo: 'cm_analyst',
        why: 'Most changes are small and CMII fast-tracks 75 to 85 percent of them. Within the limits Fern approves and a fifth get a blind second read. Past a limit it recommends; on any named trigger the CM analyst gets it with the work done.',
      },
      {
        action: 'approve_ecr_at_tier',
        level: 'recommend',
        why: 'The approval bodies decide. Fern files its recommendation first, so the body opens a finished package.',
      },
      {
        action: 'release_eco',
        level: 'approve',
        limits: { maxCost: 25_000 },
        otherwise: 'recommend',
        // Proposed, for Tyler to confirm: once a body has approved the ECR, releasing the ECO in the PLM is
        // carrying out its decision, so Norn releases whatever the change costs, for as long as that body's
        // tier still covers the change at today's cost. If a re-quote lifts it past the tier, the limits
        // apply again.
        carriesOutApproval: true,
        why: 'Releasing carries out an approval that already had authority. While the body that approved the ECR still covers the change at today\'s cost, Fern releases at any cost. If the ECR was approved another way, as on the fast track, or a re-quote has lifted the cost past that body\'s tier, it releases within 25,000 and the CM analyst does above.',
      },
      {
        action: 'write_bom',
        level: 'recommend',
        why: 'The ERP change package lists the BOM lines to change. The manufacturing engineer enters them in the ERP; Fern never writes there (#71).',
      },
      {
        action: 'update_standard_cost',
        level: 'recommend',
        why: 'Standard cost drives the books. The package gives each item\'s new standard cost and its trace, and the cost accountant enters it (#71, #72).',
      },
      {
        action: 'draft_journal_entry',
        level: 'recommend',
        why: 'The package lists the journal entry lines: the scrap write-off, the purchase price variance on the first lot and the cancellation charge. The cost accountant enters them, because Fern saves no drafts in the ERP (#71).',
      },
      {
        action: 'post_journal_entry',
        level: 'recommend',
        why: 'Posting touches the ledger. The cost accountant posts, with the decision and the package behind it ready.',
      },
    ],
    prov: inv('Starting point for Bowman, set by the principle in #24. Every limit and sample rate here is invented.'),
  },

  // -------------------------------------------------------------- review depth (#10, #26)
  // The cheap tier (the impact screen) always runs. The deep tier waits until someone asks, except for
  // the kinds of change known to need it. A deep stage may be requested at most twice on the same
  // inputs, failed runs included; revised inputs start a fresh count.
  reviewDepth: {
    deepReview: {
      mode: 'on_request',
      autoFor: [{ axis: 'regulatory', value: 'major' }],
      maxPasses: 2,
      mayRequest: ['design_engineer', 'cm_analyst', 'ccb_chair', 'engineering_director', 'cost_engineer', 'buyer', 'production_planner', 'cost_accountant', 'cfo', 'certification', 'program_manager'],
    },
    prov: src('docs/PLAN.md §3', '"Ideally once per ECR, and at most twice" (#10). The FAA-major trigger is Bowman\'s choice.'),
  },

  // -------------------------------------------------------------- materiality (#30)
  // The restraint of a good analyst in front of the CFO: no nitpicks, no inflating. The relative
  // bar is a share of the end item's standard cost, never the changed part's. A finished Vesper
  // aircraft is about $2.8M, so 0.01 percent is $280. A Meridian is $5M, so it is $500. Either bar
  // raises a change, so the $250 absolute bar is the one that binds for both aircraft. ECR-0423's saving
  // of $11.40 an aircraft is well under it.
  materiality: {
    unitCost: { absolute: 250, relativePct: 0.01 },
    oneTimeCost: 10_000,
    cutInSlipDays: 14,
    dispositionSwing: 10_000,
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
      { check: 'numbers_from_computation', appliesTo: ['impact_statement', 'recommendation'], enforcement: 'block', reason: 'a figure in the text is not one of Fern\'s computed values' },
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
