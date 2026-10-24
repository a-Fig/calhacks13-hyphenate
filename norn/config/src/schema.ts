// Norn's company-config schema: everything that tunes Norn to one company (#34, #39).
//
// A company's configuration is one file that default-exports an object of type CompanyConfig.
// The types below are inferred from the same definitions the loader validates against, so a file
// that typechecks and a file that loads cannot disagree about shape. Rules that span fields or
// sections (a tier's body must exist, a role must be allowed to do what it is asked to do) are in
// rules.ts.
//
// Norn is general: nothing here names a company. Plain functions and types only (erasable
// syntax), so Node 24 runs the .ts files directly.

import { arr, bool, date, id, type Infer, type InferShape, nullable, num, obj, oneOf, opt, str } from './kit.ts';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- what Norn knows how to do
// These lists are Norn's own: the code asks the policy gate about exactly these actions, applies
// exactly these levels and checks exactly these standards. A company chooses among them; it does
// not add to them.

/** Kinds of action the policy gate decides on, for people and for agents alike. */
export const ACTIONS = {
  file_ecr: 'File an ECR, or revise a draft',
  review_ecr: 'Record concurrence or non-concurrence on an ECR',
  set_company_class: 'Set the company change class on an ECR',
  set_regulatory_class: 'Set the regulatory change class (such as FAA major or minor) on an ECR',
  post_impact_statement: 'Post an impact statement on an ECR',
  approve_fast_track_ecr: 'Approve an ECR on the fast track, without convening a board',
  approve_ecr_at_tier: 'Decide an ECR as the chair of the approval body for its cost tier',
  release_eco: 'Release the ECO for an approved ECR',
  write_bom: 'Write the new bill of materials into the ERP',
  update_standard_cost: 'Update a standard cost in the ERP',
  draft_journal_entry: 'Draft a journal entry in the ERP, such as scrap or revaluation',
  post_journal_entry: 'Post a drafted journal entry to the ledger',
} as const;
export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

/** What an agent may do with an action (#24). Ordered from most to least autonomous. */
export const AUTONOMY_LEVELS = {
  approve: 'The agent acts. Nobody checks first.',
  approve_sampled: 'The agent acts. A sample of its actions wait for a blind second check first.',
  recommend: 'The agent files a recommendation with its reasoning. A person decides.',
  escalate: 'The agent does not recommend. It hands the matter, with the work done, to a named role.',
} as const;
export type AutonomyLevel = keyof typeof AUTONOMY_LEVELS;
export const LEVEL_IDS = Object.keys(AUTONOMY_LEVELS) as AutonomyLevel[];
/** How much an agent decides alone. A fallback level may not exceed the level it falls back from. */
export const LEVEL_RANK: Record<AutonomyLevel, number> = { approve: 3, approve_sampled: 2, recommend: 1, escalate: 0 };

/** Named conditions Norn detects on an ECR. A rule can list the ones that take an action out of the agent's hands. */
export const TRIGGERS = {
  safety_part: 'The change touches a safety or flight-safety part',
  new_supplier: 'The change brings in a supplier not yet used for the item',
  conflicting_open_ecr: 'Another open ECR edits the same item or field',
  shared_supplier_exposure: 'Another open ECR draws on the same constrained supplier',
  linchpin_assumption_agent_estimated: 'The headline number rests on an assumption an agent estimated',
  sources_conflict: 'Two sources for the same input disagree',
  stale_data: 'An input is older than its source says it should be',
  checker_disagrees: 'The blind checker reached a different view',
} as const;
export type TriggerId = keyof typeof TRIGGERS;
export const TRIGGER_IDS = Object.keys(TRIGGERS) as TriggerId[];

/** What a field on the ECR form holds. The specific kinds are ones Norn reads; the rest are for people. */
export const FIELD_KINDS = {
  text: 'One line of text',
  longText: 'Several lines of text',
  date: 'A date',
  number: 'A number',
  choice: 'One of the listed options',
  program: 'The program the change belongs to',
  ncr: 'The nonconformance report that prompted the change',
  affectedItems: 'The parts and assemblies the change touches, with their redlines',
  priority: 'The ECR priority',
  justificationCode: 'The reason for the change',
  companyClass: 'The company change class',
  regulatoryClass: 'The regulatory change class',
  effectivity: 'Where the change cuts in on the line, and for retrofit',
  inventoryDisposition: 'What happens to stock of the old part, by location',
  costPage: 'The cost page: production, retrofit, logistics support and other',
} as const;
export type FieldKind = keyof typeof FIELD_KINDS;
export const FIELD_KIND_IDS = Object.keys(FIELD_KINDS) as FieldKind[];
/** Kinds the ECR form must hold at least once, because Norn's checks read them. */
export const REQUIRED_FIELD_KINDS: FieldKind[] = ['affectedItems', 'priority', 'justificationCode', 'companyClass', 'regulatoryClass', 'effectivity', 'costPage'];

/** Kinds of post an agent can make (#35). */
export const POST_KINDS = {
  impact_statement: 'An impact statement at any level',
  recommendation: 'A recommendation to approve, reject or send back',
  escalation: 'A matter handed to a named role',
  comment: 'Any other comment on an ECR',
} as const;
export type PostKind = keyof typeof POST_KINDS;
export const POST_KIND_IDS = Object.keys(POST_KINDS) as PostKind[];

/** Checks the post check can run before an agent's post goes up (#35). */
export const POST_CHECKS = {
  cite_sources: 'Every claim of fact names the source it was read from, with the system, record and as-of date',
  quote_matches_source: 'Every quotation appears word for word in the source it cites',
  evidence_class: 'Every number and claim is marked fact, assumption, computation or judgment',
  numbers_are_ranges: 'Every forecast number is a range, not a point',
  numbers_from_computation: 'Every figure in the narration is one of Norn\'s computed values',
  likelihood_words: 'Probabilities are stated in the company\'s likelihood words, and likelihood and confidence are never in one sentence',
  flag_assumptions: 'Every assumption an agent estimated is marked, with its rationale',
  label_outside_evidence: 'Evidence an outside agent brought in is labelled as reported by that agent until Norn can fetch the source',
  company_vocabulary: 'The post uses the company\'s words and none of the words it avoids',
  bottom_line_first: 'The post opens with the bottom line',
  sbar_escalation: 'An escalation states situation, background, assessment and recommendation',
} as const;
export type PostCheckId = keyof typeof POST_CHECKS;
export const POST_CHECK_IDS = Object.keys(POST_CHECKS) as PostCheckId[];

/** The four classes of evidence (`docs/GLOSSARY.md`). A company names them; it does not add or drop one. */
export const EVIDENCE_CLASS_IDS = ['fact', 'assumption', 'computation', 'judgment'] as const;

// ---------------------------------------------------------------- shared pieces

/** Where a setting came from, in the dataset's style: traced to a source, or chosen for this company. */
export const provenance = obj({
  basis: oneOf(['sourced', 'invented']),
  ref: opt(str()),
  note: opt(str()),
});
export type Provenance = Infer<typeof provenance>;

/** A value of one of the two change-class axes, such as company Class II. */
export const classRef = obj({
  axis: oneOf(['company', 'regulatory']),
  value: id(),
});
export type ClassRef = Infer<typeof classRef>;

/**
 * A plain-language test that Norn answers yes or no for each ECR, with its evidence. When `whenClass`
 * is set the test is a class check and Norn needs no judgment to answer it.
 */
export const test = obj({
  id: id(),
  text: str(),
  whenClass: opt(classRef),
});
export type Test = Infer<typeof test>;

// ---------------------------------------------------------------- company and vocabulary

const company = obj({
  name: str(),
  shortName: str(),
  currency: str({ pattern: /^[A-Z]{3}$/, expected: 'a three-letter currency code such as USD' }),
});

const term = obj({
  name: str(),
  abbreviation: opt(str()),
});

/** The words the company's people see. Everything a user reads uses these. */
const vocabulary = obj({
  terms: obj({
    problemReport: term,
    changeRequest: term,
    changeOrder: term,
    board: term,
    impactAssessment: term,
    impactStatement: term,
    impactScreen: term,
    fullImpactAssessment: term,
    productionBaseline: term,
  }),
  /** Words Norn never shows to this company's people. */
  avoid: arr(str()),
  note: opt(str()),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- the ECR form (#6)

const priority = obj({
  id: id(),
  label: str(),
  meaning: str(),
  /** Target days from filing to a decision. */
  decisionWithinDays: num({ min: 1, integer: true }),
});

const justificationCode = obj({
  code: id(),
  label: str(),
});

const formField = obj({
  id: id(),
  label: str(),
  kind: oneOf(FIELD_KIND_IDS),
  /** The stage the field must be filled by: to save a draft, to submit for review, or never. */
  required: oneOf(['draft', 'submit', 'optional']),
  help: opt(str()),
  /** Only for kind 'choice'. */
  options: opt(arr(obj({ value: id(), label: str() }), { min: 2, uniqueBy: 'value' })),
  /** Company class ids the field is asked for. Omit to ask for every class. */
  askedFor: opt(arr(id(), { min: 1, unique: true })),
});

const costBlock = obj({
  id: id(),
  label: str(),
  covers: str(),
});

const ecrForm = obj({
  /** ECR numbers look like ECR-0417: this prefix, a dash, and the number padded to `idDigits`. */
  idPrefix: str({ pattern: /^[A-Z][A-Z0-9]*$/, expected: 'capital letters and digits, such as "ECR"' }),
  idDigits: num({ min: 1, max: 9, integer: true }),
  priorities: arr(priority, { min: 1, uniqueBy: 'id' }),
  justificationCodes: arr(justificationCode, { min: 1, uniqueBy: 'code' }),
  sections: arr(
    obj({
      id: id(),
      title: str(),
      fields: arr(formField, { min: 1, uniqueBy: 'id' }),
    }),
    { min: 1, uniqueBy: 'id' }
  ),
  costPage: obj({
    blocks: arr(costBlock, { min: 1, uniqueBy: 'id' }),
    oneTimeLabel: str(),
    recurringLabel: str(),
    savingsNotation: oneOf(['parentheses', 'minus']),
  }),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- change classes (#33)

const classValue = obj({
  id: id(),
  label: str(),
  meaning: str(),
  /** The tests that put a change in this class, for the agent that classifies and the person who checks. */
  triggers: opt(arr(str(), { min: 1 })),
});

const classAxis = obj({
  label: str(),
  values: arr(classValue, { min: 2, uniqueBy: 'id' }),
  /** The class used when Norn cannot tell. Choose the stricter one. */
  whenUnsure: id(),
  /** Who puts a class on an ECR first. The role below decides. */
  proposedBy: arr(oneOf(['originator', 'norn']), { min: 1 }),
  decidedBy: id(),
  note: opt(str()),
});

const changeClasses = obj({
  /** The company's own split, such as Class I and Class II. */
  company: classAxis,
  /** The regulator's split, such as FAA major and minor. Set separately: the two can disagree. */
  regulatory: classAxis,
  prov: opt(provenance),
});

// ---------------------------------------------------------------- approval (#22)

const approvalBody = obj({
  id: id(),
  name: str(),
  chairRole: id(),
  memberRoles: arr(id(), { unique: true }),
  secretaryRole: opt(id()),
  /** How often it meets, in words, if it meets on a schedule. */
  cadence: opt(str()),
  /** Meeting dates, if known. */
  meetings: opt(arr(date())),
});

const approvalTier = obj({
  id: id(),
  /** The tier takes changes up to this cost. `null` means no upper limit, and only the last tier may have it. */
  upToUsd: nullable(num({ min: 0 })),
  body: id(),
  /** The body also reviews every change in the tiers above this one. */
  alsoReviewsAbove: opt(bool()),
});

const approval = obj({
  /** The cost that picks the tier: the one-time cost plus recurring cost over the next `horizonMonths`, at this percentile. */
  routedOn: obj({
    percentile: oneOf(['p50', 'p90']),
    horizonMonths: num({ min: 1, integer: true }),
  }),
  bodies: arr(approvalBody, { min: 1, uniqueBy: 'id' }),
  /** In ascending order of cost. The last tier has no limit. */
  tiers: arr(approvalTier, { min: 1, uniqueBy: 'id' }),
  fastTrack: obj({
    /** Everyone listed must sign. */
    approvers: arr(obj({ role: id(), mustOwnTheChange: opt(bool()) }), { min: 1 }),
    /** All of these hold. */
    requireAll: arr(test),
    /** At least one of these holds (the kinds of change the fast track is for). */
    requireOneOf: arr(test),
  }),
  /** If any of these holds, the ECR never takes the fast track, whatever its class. */
  neverFastTrack: arr(test, { min: 1, uniqueBy: 'id' }),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- roles and people

const role = obj({
  id: id(),
  label: str(),
  /** What people in this role may do. An agent acting for one of them can do no more. */
  can: arr(oneOf(ACTION_IDS), { unique: true }),
});

const person = obj({
  id: id(),
  name: str(),
  title: str(),
  role: id(),
  reportsTo: opt(id()),
  /** Their seat at the approval bodies, if any. */
  boardRole: opt(oneOf(['chair', 'secretary', 'member'])),
});

// ---------------------------------------------------------------- agent autonomy (#22, #24)

const limits = obj({
  /** The agent holds its level only while the p90 net cost of the change stays at or under this. */
  maxP90CostUsd: opt(num({ min: 0 })),
  /** ... and the p90 slip of the cut-in date stays at or under this many days. */
  maxP90SlipDays: opt(num({ min: 0, integer: true })),
  /** ... and the report it rests on is at least this level (#26: whether Level 1 is enough is still open). */
  minReportLevel: opt(oneOf([1, 2, 3])),
});

const actionRule = obj({
  action: oneOf(ACTION_IDS),
  level: oneOf(LEVEL_IDS),
  limits: opt(limits),
  /** The level once a limit is passed. Defaults to 'recommend'. Only with `limits`. */
  otherwise: opt(oneOf(LEVEL_IDS)),
  /** If any of these is detected, the action goes to `escalateTo` instead. */
  escalateOn: opt(arr(oneOf(TRIGGER_IDS), { min: 1, unique: true })),
  escalateTo: opt(id()),
  /** The share of actions that wait for a blind second check, from just above 0 to 1. For approve_sampled. */
  sampleRate: opt(num({ above: 0, max: 1 })),
  /** Why the company set it this way, in a line. */
  why: str(),
  prov: opt(provenance),
});

const autonomy = obj({
  /** The rule when an agent acts for a person (#34). 'stricter' is the only rule: the person's limits and the company's both apply. */
  actingFor: oneOf(['stricter']),
  /** One rule for every action in ACTIONS. */
  actions: arr(actionRule, { uniqueBy: 'action' }),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- review depth (#10, #26)

const reviewDepth = obj({
  deepReview: obj({
    /** 'on_request' waits until someone asks. 'auto' starts a deep review when an ECR is filed. */
    mode: oneOf(['on_request', 'auto']),
    /** Kinds of change that start a deep review on their own even when the mode is 'on_request'. */
    autoFor: opt(arr(classRef, { min: 1 })),
    /** The most deep passes one ECR may use. */
    maxPasses: num({ min: 1, max: 10, integer: true }),
    mayRequest: arr(id(), { min: 1, unique: true }),
  }),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- materiality (#30)

const materiality = obj({
  /** A change to the cost of one unit is raised when it clears either bar. Relative means a share of the unit's standard cost. */
  unitCost: obj({ absoluteUsd: num({ above: 0 }), relativePct: num({ above: 0, max: 100 }) }),
  oneTimeCostUsd: num({ above: 0 }),
  cutInSlipDays: num({ above: 0, integer: true }),
  /** The difference between dispositions of old stock, such as use up versus scrap. */
  dispositionSwingUsd: num({ above: 0 }),
  /** A driver is named only if it explains at least this share of the spread of the forecast. */
  driverMinSharePct: num({ above: 0, max: 100 }),
  /** At most this many flags on one statement. */
  maxFlagsPerStatement: num({ min: 1, integer: true }),
  /** What the statement opens with when nothing clears the bars. */
  whenNothingMaterial: str(),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- posting standards (#35)

const likelihoodWord = obj({
  word: str(),
  fromPct: num({ min: 0, max: 100 }),
  toPct: num({ min: 0, max: 100 }),
});

const postingStandards = obj({
  /** Whose posts are checked. */
  agents: arr(oneOf(['norn', 'outside']), { min: 1 }),
  requirements: arr(
    obj({
      check: oneOf(POST_CHECK_IDS),
      appliesTo: arr(oneOf(POST_KIND_IDS), { min: 1 }),
      /** 'block' keeps the post down until it is fixed. 'warn' lets it through and marks it. */
      enforcement: oneOf(['block', 'warn']),
      /** What the posting agent is told when it fails: "this can't be posted because ...". */
      reason: str(),
    }),
    { uniqueBy: 'check' }
  ),
  evidenceClasses: arr(
    obj({ id: oneOf(EVIDENCE_CLASS_IDS), label: str(), meaning: str() }),
    { uniqueBy: 'id' }
  ),
  /** Words for probabilities, in ascending order, each starting where the one before ends. */
  likelihoodScale: arr(likelihoodWord, { min: 2 }),
  /** After this many failed fixes the post goes to a person. */
  maxFixAttempts: num({ min: 1, max: 10, integer: true }),
  prov: opt(provenance),
});

// ---------------------------------------------------------------- the whole file

export const configShape = {
  schemaVersion: oneOf([SCHEMA_VERSION]),
  company,
  vocabulary,
  ecrForm,
  changeClasses,
  approval,
  roles: arr(role, { min: 1, uniqueBy: 'id' }),
  people: arr(person, { min: 1, uniqueBy: 'id' }),
  autonomy,
  reviewDepth,
  materiality,
  postingStandards,
};
export type SectionName = keyof typeof configShape;
export const SECTION_NAMES = Object.keys(configShape) as SectionName[];

export type CompanyConfig = InferShape<typeof configShape>;
export type Role = CompanyConfig['roles'][number];
export type Person = CompanyConfig['people'][number];
export type EcrForm = CompanyConfig['ecrForm'];
export type ChangeClasses = CompanyConfig['changeClasses'];
export type Approval = CompanyConfig['approval'];
export type Autonomy = CompanyConfig['autonomy'];
export type ActionRule = CompanyConfig['autonomy']['actions'][number];
export type ReviewDepth = CompanyConfig['reviewDepth'];
export type Materiality = CompanyConfig['materiality'];
export type PostingStandards = CompanyConfig['postingStandards'];
