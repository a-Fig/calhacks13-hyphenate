// The view-model for Norn's ECR screens.
//
// Screens read only these types. Mock data (./mock) builds them today; live results from the checks
// library (#41: ECP-shaped rows with p10/p50/p90 and a per-number trace) get adapted into them in
// ./adapter.ts. Nothing under src/screens knows where an ImpactAssessment came from.

/** How a number or claim is known (docs/GLOSSARY.md, "How Norn marks evidence"). */
export type Evidence = 'fact' | 'assumption' | 'computation' | 'judgment';

/** Where an assumption came from (norn/ARCHITECTURE.md section 5). */
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
  evidence: Evidence;
}

export type CostBlock = 'production' | 'retrofit' | 'logistics' | 'other';

/** One line of the ECP cost page (MIL-HDBK-61A App. B). Savings are negative. */
export interface CostRow {
  id: string;
  block: CostBlock;
  label: string;
  /** One-time (non-recurring) amount. */
  oneTime?: Figure;
  /** Per-unit cost and how many units. Recurring, or priced per unit. */
  unitCost?: Figure;
  quantity?: number;
  /** Year-1 total of the line. */
  total: Figure;
  note?: string;
  /** Norn has not costed this line yet (Level 1). Shown as such, and left out of the totals. */
  notAssessed?: boolean;
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
  /** The event, e.g. "cut-in by 15 Mar 2027". */
  event: string;
  probability: number;
}

export interface Headline {
  /** Cost change per aircraft, recurring. */
  unitCost: Figure;
  unitCostNote: string;
  /** Net cost of the first year: one-time plus recurring. */
  year1: Figure;
  year1Likelihood: Likelihood;
  cutIn: Figure;
  cutInNote: string;
  cutInLikelihood: Likelihood;
  supply: {
    id: string;
    level: RiskLevel;
    evidence: Evidence;
    note: string;
    likelihood: Likelihood;
  };
}

export interface SCurve {
  /** Cumulative probability of the year-1 total: x = USD, y = 0..1. */
  points: { x: number; y: number }[];
  pointEstimate: { x: number; y: number };
  p10: number;
  p50: number;
  p90: number;
  draws: number;
}

export interface Driver {
  id: string;
  label: string;
  evidence: Evidence;
  /** The input as shown at its p10 and p90, e.g. "13 wk" and "20 wk". */
  lowLabel: string;
  highLabel: string;
  /** Year-1 total with the input at its p10 and at its p90, the others at their p50. */
  low: number;
  high: number;
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
}

export interface Recommendation {
  verdict: 'approve' | 'approve_with_conditions' | 'wait' | 'reject';
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

export interface ActivityEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  actor: string;
  actorKind: ActorKind;
  /** Whom the actor acted for: "Jeff's agent, for Jeff". Absent when it acted on its own account. */
  onBehalfOf?: string;
  /** What spawned it: "Norn, automatically". */
  spawnedBy?: string;
  text: string;
  detail?: string;
  /** A report that was published by this step. */
  level?: ReportLevel;
  state?: 'done' | 'running';
  /** Labelled "reported by agent" until Norn can fetch the source itself. */
  reportedByAgent?: boolean;
}

export type SourceSystem = 'PLM' | 'ERP' | 'Quote' | 'Norn' | 'Policy' | 'History';

export interface TraceSource {
  system: SourceSystem;
  ref: string;
  detail?: string;
}

export interface TraceInput {
  label: string;
  display: string;
  evidence: Evidence;
  /** Another trace, so the drawer can drill into it. */
  traceId?: string;
}

export interface TraceAssumption {
  label: string;
  display: string;
  origin: Origin;
  source: string;
}

/** The "why" behind one number. */
export interface Trace {
  id: string;
  title: string;
  evidence: Evidence;
  summary: string;
  /** The number as the drawer shows it, for traces that are not one of the assessment's figures. */
  value?: { text: string; range?: string };
  sources: TraceSource[];
  inputs: TraceInput[];
  assumptions: TraceAssumption[];
  formula?: { expression: string; worked?: string };
  producedBy: { check: string; actor: string; onBehalfOf: string; at: string; note?: string };
}

export interface EcrSummary {
  id: string;
  title: string;
  program: 'Vesper' | 'Meridian';
  partNumber?: string;
  companyClass: 'I' | 'II';
  faa: 'major' | 'minor';
  priority: 'Routine' | 'Urgent' | 'Emergency';
  status: 'Draft' | 'Submitted' | 'In review' | 'Approved' | 'ECO released';
  /** Year-1 cost change with its range; negative is a saving. Absent until Norn has run. */
  cost?: { p10: number; p50: number; p90: number };
  level?: ReportLevel;
  lastActivity: string;
  lastActivityBy: string;
  originator: string;
  filedOn: string;
  /** One short flag the backlog list can show, e.g. "Conflicts with ECR-0415". */
  flag?: string;
  hasAssessment: boolean;
}

/** The impact assessment a CFO or CCB member reads. */
export interface ImpactAssessment {
  ecr: EcrSummary;
  level: ReportLevel;
  headline: Headline;
  cost: {
    rows: CostRow[];
    subtotals: BlockSubtotal[];
    net: Figure;
    /** What "year 1" means, e.g. "2027". */
    yearLabel: string;
  };
  sCurve: SCurve;
  drivers: Driver[];
  scenarios: Scenario[];
  changeClass: ChangeClass;
  route: { steps: RouteStep[]; tier: string };
  recommendation: Recommendation;
  needed: Needed[];
  activity: ActivityEvent[];
  traces: Record<string, Trace>;
}
