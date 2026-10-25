// The view-model for Norn's ECR screens.
//
// Screens read only these types. Live results come from the checks library (norn/checks, S1 and S2,
// stored as CheckResultRow[] in check_result) and are adapted into them by fromChecks() in
// ./adapter.ts. The parts the checks do not produce yet (the timeline range, supply risk, the
// change class and approval route, the recommendation, the agent timeline) are narrative: mock
// fixtures, optional here, and named in `ImpactAssessment.mock` so the screens can label each one.

import type { GateView } from './live/gate.ts';

/** How a number or claim is known (docs/GLOSSARY.md, "How Norn marks evidence"). */
export type Evidence = 'fact' | 'assumption' | 'computation' | 'judgment';

/** Where an assumption came from: the checks' `Source`. */
export type Origin = 'given' | 'default' | 'agent_estimated';

/** `date` figures hold milliseconds since the epoch. */
export type Unit = 'usd' | 'date' | 'weeks' | 'count' | 'percent';

export type ReportLevel = 1 | 2 | 3;

/** A number on screen. Clicking it opens `assessment.traces[id]`. */
export interface Figure {
  id: string;
  unit: Unit;
  p50: number;
  /** Absent when the number is exact (a quote, a count). */
  p10?: number;
  p90?: number;
  /** Every input at its stated value. Adds up across rows exactly; the table shows it. */
  point?: number;
  /** Adds up across rows exactly, too. */
  mean?: number;
  evidence: Evidence;
}

/** Same names as the checks' `CostBlock`. */
export type CostBlock = 'production' | 'retrofit' | 'logisticsSupport' | 'other';

/** One line of the ECP cost page (MIL-HDBK-61A App. B). Savings are negative. */
export interface CostRow {
  id: string;
  block: CostBlock;
  label: string;
  /**
   * From the row, not guessed: ongoing production cost per unit built after the cut-in. It says what the row
   * is, not which column an amount sits in: a retrofit kit is unit cost × quantity, which the source cost
   * page calls extended, but it is not ongoing production.
   */
  recurring: boolean;
  /** The cost page's nonrecurring amount for this line (DD 1692 Block 50). A line can have this and a unit cost. */
  nonrecurring?: Figure;
  /** Per-unit amount and units: per part built for a recurring row, per kit or unit otherwise. */
  unitCost?: Figure;
  quantity?: number;
  /** Unit cost × quantity: the cost page's extended amount. Absent when the line has no unit cost. */
  extended?: Figure;
  /** The line's total over the window: nonrecurring plus extended. */
  total: Figure;
  note?: string;
  /** Left blank on the ECR and counted as $0 until someone estimates it. */
  needsEstimate?: boolean;
  /** Who stated it: a supplier quote, an engineer's estimate, an agent's estimate, a default. */
  basis?: string;
}

export interface BlockSubtotal {
  block: CostBlock;
  total: Figure;
}

export type RiskLevel = 'low' | 'moderate' | 'high';

/** ICD 203 words (docs/GLOSSARY.md). */
export type LikelihoodWord =
  | 'almost no chance'
  | 'very unlikely'
  | 'unlikely'
  | 'roughly even'
  | 'likely'
  | 'very likely'
  | 'almost certain';

export interface Likelihood {
  word: LikelihoodWord;
  /** The event, e.g. "under $450k". */
  event: string;
  probability: number;
}

export interface Headline {
  /** Cost change per unit built, per program the change reaches. */
  unitCost: { program: string; figure: Figure; note?: string }[];
  /** Net cost of the window: the rollout budget plus ongoing production. */
  year1: Figure;
  /** From the quantiles the checks give, fitted. Absent when there is no range. */
  year1Likelihood?: Likelihood;
}

export interface CostSection {
  rows: CostRow[];
  subtotals: BlockSubtotal[];
  net: Figure;
  /**
   * The rollout budget: every line except ongoing production, retrofit and support unit-extended amounts
   * included. It is not the sum of the lines' nonrecurring column.
   */
  oneTime: Figure;
  /** Ongoing production cost over the window: per-unit change × units built after the cut-in. */
  recurring: Figure;
  /** The checks' year-one window: months from the cut-in, e.g. "Nov 2026 to Oct 2027". */
  window: { from: string | null; months: number; label: string };
  /** Lines counted as $0 until estimated. */
  needsEstimate: { label: string; rowId: string }[];
  /** How it was produced, for the footer: draws, seed, code version. */
  run: { draws: number; seed: string; codeVersion: string; correlation: number };
  /** The requested and forecast implementation scenarios, when the checks cost both. Every figure above is the requested one. */
  scenarios?: CostScenarios;
}

/**
 * Every figure on the cost page assumes the effectivity the ECR requests. The checks may cost a second scenario at
 * the forecast serial. It is conditional on that one serial, not a joint simulation of cost and date.
 */
export interface CostScenarios {
  /** What the cost page assumes, in words: "Requested effectivity: S/N 11, Nov 2026". */
  requested: string;
  readiness?: Readiness;
  forecast?: { placed: boolean; date?: { p10: string; p50: string; p90: string }; serial?: { p10: number; p50: number; p90: number } };
  alternative?: {
    label: string;
    window: { from: string | null; months: number; label: string };
    net: Figure;
    recurring: Figure;
    flags: { severity: 'info' | 'warn'; message: string }[];
  };
  /** Why there is no forecast scenario. */
  unavailable?: string;
  note?: string;
}

/**
 * What the timeline's date stands for. `materials_only`: some qualification, release or retrofit work has not been
 * assessed, so the date is when the parts and the assessed work allow it, a lower bound on implementation.
 */
export type Readiness = 'implementation' | 'materials_only';

/** One step on the way to the line: the board's decision, a part arriving, a prerequisite, the old stock. */
export interface TimelineStep {
  id: string;
  kind: 'decision' | 'parts' | 'stock' | 'prerequisite';
  label: string;
  /** Null for old stock that runs past the volume plan. */
  date?: Figure;
  /** Share of draws in which this step sets the cut-in. */
  criticalShare: number;
  supplier?: string;
  owner?: string;
  status?: string;
  evidence?: string;
  appliesTo?: string;
  downtimeHoursPerUnit?: number;
}

/** The timeline check (S3) in full, for the Time to the line page. */
export interface TimelineView {
  readiness?: Readiness;
  /** False when using up the old stock needs serials past the volume plan: no date can be placed. */
  placed: boolean;
  stated: { label: string; date: string | null; serial: number | null };
  decision?: Figure;
  weeksFromFiling?: Figure;
  /** The first serial that can take the change. */
  serial?: Figure;
  /** When the assessed retrofit work completes, separate from the production cut-in. */
  retrofit?: Figure;
  late?: { weeks: Figure; likelihood: Likelihood };
  steps: TimelineStep[];
  flags: { severity: 'info' | 'warn'; message: string }[];
  /** The numbers are from a run an input change has replaced. */
  stale?: 'rechecking' | 'failed';
}

/** Where the change reaches the line. The checks give one fixed month; a range needs the timeline check (S3). */
export interface CutIn {
  program: string;
  /** 'YYYY-MM', from the ECR's stated effectivity or a default. */
  month: string;
  serial: number;
  source: Origin;
  rationale: string;
  /** Norn's agent's own range, once it has made one. Not a check result. */
  estimate?: {
    figure: Figure;
    note: string;
    likelihood?: Likelihood;
    /** What the date is: "Reaches the line", or "Material readiness" when unassessed prerequisites may make it later. */
    label?: string;
  };
  /** The timeline check in full, when a real one ran. */
  timeline?: TimelineView;
}

export interface SupplyPart {
  item: string;
  name: string;
  supplier: string | null;
  sources: string[];
  singleSource: boolean;
  /** Where the lead time came from: a quote, the part record, or a default. */
  leadFrom: string;
  leadWeeks: Figure;
}

type Flags = { severity: 'info' | 'warn'; message: string }[];

/** The supply check (S4) in full, for the Supply page. */
export interface SupplyDetail {
  stated: string;
  /** False when the cut-in cannot be placed: spend and capacity are not stated. */
  cutInPlaced: boolean;
  miss?: { likelihood: Likelihood; weeksLate?: Figure };
  /** The same, with the other open ECRs that share a supplier. */
  missWithPeers?: { likelihood: Likelihood; weeksLate?: Figure };
  parts: SupplyPart[];
  spend?: { yearOne: Figure; singleSource: Figure };
  capacity: { constraint: string; supplier: string; perYear: number; utilization: Figure; withPeers?: Figure }[];
  peers: { ecr: string; sharedSuppliers: string[] }[];
  peerCutInShift?: { weeks: Figure; later: Likelihood };
  bundles: { constraint: string; withinWeeks: number; bundled: Likelihood; ownSaving: Figure; pairSaving: Figure }[];
  /** Open ECRs that share no supplier with this one. */
  unrelatedPeers: string[];
  flags: Flags;
  /** The numbers are from a run an input change has replaced. */
  stale?: 'rechecking' | 'failed';
}

export interface Supply {
  id: string;
  level: RiskLevel;
  evidence: Evidence;
  note: string;
  likelihood?: Likelihood;
  /** The real supply check's numbers. Absent for a mock run. */
  detail?: SupplyDetail;
}

export interface SCurve {
  p10: number;
  p50: number;
  p90: number;
  point: number;
  mean: number;
  /** Cumulative probability points, when there are more than the three quantiles. Otherwise the chart fits a curve. */
  points?: { x: number; y: number }[];
}

export interface Driver {
  id: string;
  label: string;
  kind: 'input' | 'decision';
  evidence: Evidence;
  /** Window total with the input at its P10, or the first alternative of a decision. */
  low: number;
  /** Window total with the input at its P90, or the second alternative. */
  high: number;
  /** The input as shown at its P10 and P90, or the alternatives' names. */
  lowLabel?: string;
  highLabel?: string;
}

export interface Scenario {
  label: string;
  effect: string;
}

export interface ChangeClass {
  company: 'I' | 'II';
  companyWhy: string;
  faa: 'major' | 'minor';
  faaWhy: string;
  evidence: Evidence;
  traceId: string;
}

export type StepState = 'approved' | 'pending' | 'waiting' | 'not_required';

export interface RouteStep {
  role: string;
  person?: string;
  state: StepState;
  when?: string;
  /** Who approved, if not a person. */
  by?: string;
  /** What the record says or does not: "No review recorded", "Approved on Rev B; the ECR is now at Rev C". */
  note?: string;
  /** The revision an approval was given on. */
  revision?: string;
}

export interface Recommendation {
  /** `none`: no impact statement yet, or one that gives no verdict. */
  verdict: 'approve' | 'approve_with_conditions' | 'wait' | 'reject' | 'none';
  headline: string;
  reasons: { text: string; evidence: Evidence; traceId?: string }[];
  traceId: string;
}

export interface Needed {
  text: string;
  owner?: string;
  done?: boolean;
}

export type ActorKind = 'norn' | 'person' | 'person_agent' | 'system';

/** What kind of timeline entry an event is, so the page can pick GitHub's icon and wording. */
export type EventKind =
  | 'filed'
  | 'ran_checks'
  | 'report'
  | 'label'
  | 'review_requested'
  | 'approved'
  | 'changes_requested'
  | 'comment'
  | 'research'
  | 'policy';

export interface ActivityEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  actor: string;
  /** The stored name, when `actor` is a readable form of it (shown as a tooltip). */
  actorRaw?: string;
  actorKind: ActorKind;
  /** Whom the actor acted for: "Jeff's agent, for Jeff". Absent when it acted on its own account. */
  onBehalfOf?: string;
  /** What spawned it: "Norn, for Jeff Hargrove". */
  spawnedBy?: string;
  kind?: EventKind;
  /** A comment's anchor, when it has one: the seat's conversation is read from it. */
  anchor?: string;
  text: string;
  detail?: string;
  /** A report that was published by this step. */
  level?: ReportLevel;
  state?: 'done' | 'running';
  /** A Norn agent's live steps, shown like a build log while it runs. */
  run?: AgentRun;
  /** Labelled "reported by agent" until Norn can fetch the source itself. */
  reportedByAgent?: boolean;
  /** A recommendation made on an earlier revision of the ECR than the one it is on now. */
  superseded?: boolean;
}

/** A Norn agent's session: the steps the runner reports, from agent_event rows. */
export interface AgentRun {
  id: string;
  title: string;
  actor: string;
  onBehalfOf?: string;
  startedAt: string;
  state: 'running' | 'done' | 'failed';
  lines: { at: string; kind: 'start' | 'text' | 'tool' | 'result' | 'end'; text: string; error?: boolean }[];
}

export type SourceSystem = 'PLM' | 'ERP' | 'Quote' | 'Fern' | 'Policy' | 'History';

export interface TraceSource {
  system: SourceSystem;
  ref: string;
  detail?: string;
}

export interface TraceInput {
  label: string;
  display: string;
  evidence: Evidence;
  /** Another trace, so the panel can drill into it. */
  traceId?: string;
}

export interface TraceAssumption {
  label: string;
  display: string;
  origin: Origin;
  source: string;
}

/**
 * The "why" behind one number. The checks give a formula and the inputs it used with their sources;
 * the rest is optional and shown when present.
 */
export interface Trace {
  id: string;
  title: string;
  evidence: Evidence;
  summary: string;
  /** The number as the panel shows it, for traces that are not one of the assessment's figures. */
  value?: { text: string; range?: string };
  sources?: TraceSource[];
  inputs: TraceInput[];
  assumptions: TraceAssumption[];
  formula?: { expression: string; worked?: string };
  producedBy?: { check: string; actor: string; onBehalfOf?: string; at?: string; note?: string };
}

/** One impact check, as GitHub's Checks tab lists it. */
export interface Check {
  id: 'bom' | 'cost' | 'timeline' | 'supply' | 'class';
  name: string;
  /** `pending`: the check does not exist yet or has not run; `queued`: it is waiting for a worker. */
  state: 'passed' | 'attention' | 'running' | 'queued' | 'pending' | 'skipped';
  /** This check's result is a mock stand-in, not Norn's real check. */
  mock?: boolean;
  summary: string;
  took?: string;
  by?: string;
}

/** One line of a diff. */
export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
  /** A trailing remark, shown muted. */
  remark?: string;
}

/** One block of the Changes tab: an item, a supplier record, a stock position. */
export interface ChangedItem {
  id: string;
  title: string;
  subtitle?: string;
  /** What it does to the cost, in the block header: "+$415.20 per aircraft". */
  impact?: string;
  lines: DiffLine[];
}

/** One edit of the request itself (the Revisions tab). */
export interface Revision {
  id: string;
  message: string;
  author: string;
  at: string;
}

export interface LinkedRecord {
  kind: 'NCR' | 'ECO' | 'ECR' | 'Quote';
  ref: string;
  title: string;
  state: 'open' | 'closed' | 'released' | 'valid';
}

/** The CCB meeting that decides, shown like a milestone. */
export interface Meeting {
  label: string;
  /** ISO date. */
  date: string;
}

/**
 * What Norn hands a person when an ECO is released: the lines to enter in the ERP. Norn never writes
 * to the ERP; a person does, and ticks each line off.
 */
export interface ErpPackage {
  system: string;
  lines: {
    kind: 'MBOM' | 'Standard cost' | 'Journal entry';
    title: string;
    /** Diff-style lines: what the ERP has, what it should have. */
    diff: DiffLine[];
    status: 'To enter in ERPNext' | 'Entered';
  }[];
}

/** Parts of an assessment that are mock fixtures today, so the screens can label each one. */
export type MockSection =
  | 'narrative' // the ECR text, the timeline of events, the approvals
  | 'class'
  | 'route'
  | 'recommendation'
  | 'supply'
  | 'cutInEstimate'
  | 'agentEstimates'
  | 'erp';

export interface EcrSummary {
  id: string;
  title: string;
  program: 'Vesper' | 'Meridian';
  partNumber?: string;
  companyClass: 'I' | 'II';
  faa: 'major' | 'minor';
  priority: 'Routine' | 'Urgent' | 'Emergency';
  status: 'Draft' | 'Submitted' | 'In review' | 'Approved' | 'ECO released' | 'Rejected';
  /** Reviewers and how far they got, for the list's avatars and the "Review required" text. */
  reviewers?: { name: string; state: 'approved' | 'pending' }[];
  /** Status of the impact checks, for the list's check icon. */
  checks?: 'passed' | 'attention' | 'running';
  comments?: number;
  /** What the ECR changes, for the subline: "BW-5120-210 from Rev B to Rev C". */
  change?: string;
  /** Net cost of the checks' year-one window with its range; negative is a saving. Absent until the checks have run. */
  cost?: { p10: number; p50: number; p90: number; point?: number; from?: string | null };
  level?: ReportLevel;
  lastActivity: string;
  lastActivityBy: string;
  originator: string;
  filedOn: string;
  /** One short flag the backlog list can show, e.g. "Conflicts with ECR-0415". */
  flag?: string;
  /**
   * The cost numbers are the previous revision's: `rechecking` while Norn checks the changed ECR again,
   * `failed` when the replacement run failed and nothing newer exists. Absent when they are current.
   */
  staleCost?: 'rechecking' | 'failed';
  /** Why there is no cost page for this ECR although a cost check finished (live only). */
  costNote?: string;
  hasAssessment: boolean;
}

/** An impact statement as posted: the agent narrates, and every number is marked with how it is known. */
export interface StatementView {
  id: string;
  level: ReportLevel;
  at: string;
  author: string;
  /** The stored name, when `author` is a readable form of it (shown as a tooltip). */
  authorRaw?: string;
  authorKind: ActorKind;
  headline: string;
  changeClass: string;
  route: string;
  numbers: { key: string; label: string; unit: string; p10: number; p50: number; p90: number; evidence: Evidence; traceId?: string }[];
  drivers: { text: string; evidence: Evidence; traceId?: string }[];
  claims: { text: string; evidence: Evidence; traceId?: string }[];
  assumptions: { key: string; label: string; source: Origin; note: string; traceId?: string }[];
  /** Written against an older revision of the ECR than the current one. */
  outdated: boolean;
  /** Said under the numbers table when a number cannot be opened, or is not from the newest cost run. */
  numbersNote?: string;
}

/** The impact assessment a CFO or CCB member reads. */
export interface ImpactAssessment {
  ecr: EcrSummary;
  /** Where the numbers come from: a saved run of the checks, or Norn's live database. */
  source: 'saved' | 'live';
  /** The level of the newest impact statement; absent until there is one. */
  level?: ReportLevel;
  /** The newest impact statement, when the ECR has one; it becomes Norn's bot comment. */
  statement?: StatementView;
  headline: Headline;
  cost: CostSection;
  cutIn: CutIn;
  /** Absent until the supply check (S4) exists. */
  supply?: Supply;
  /** Absent when there is no range to draw. */
  sCurve?: SCurve;
  drivers: Driver[];
  scenarios: Scenario[];
  changeClass: ChangeClass;
  route: { steps: RouteStep[]; tier: string };
  recommendation: Recommendation;
  needed: Needed[];
  activity: ActivityEvent[];
  /** The ECR text, as the opening comment. */
  body: { heading: string; text: string }[];
  checks: Check[];
  changes: ChangedItem[];
  revisions: Revision[];
  linked: LinkedRecord[];
  meeting: Meeting;
  erpPackage?: ErpPackage;
  /** Live only: the company gate's approvals and recommendations, and the real ERP change package (./live/gate.ts). */
  gate?: GateView;
  mock: MockSection[];
  traces: Record<string, Trace>;
}
