// Routing an ECR and deciding an action, from the company's configuration (#75, for the policy gate #43).
//
// Two pure functions over a validated CompanyConfig and the facts about one ECR:
//
//   routeEcr(config, facts)       where the ECR goes: its class on each axis, the approval tier and body its
//                                 cost points to, and whether it can take the fast track.
//   decideAction(config, input)   whether an actor may take an action on the ECR, and at what level: approve,
//                                 approve_sampled, recommend, escalate, or deny.
//
// Nothing here reads a database, a clock or a random number generator, and nothing names a company: the
// rules come from the configuration, and the same facts always give the same answer. Every answer carries
// the rule that decided it (a path or id in the configuration) and the reasons in plain words, so the gate
// can record why next to what it did.
//
// Unknown facts are read against the actor, never for them: a test nobody answered, a cost nobody
// measured and a slip nobody forecast all count as not satisfied. The design calls are listed in
// norn/config/README.md.

import { isSampled, sampleValue } from './sample.ts';
import {
  ACTION_IDS,
  ERP_ACTIONS,
  type ActionId,
  type ActionRule,
  type AutonomyLevel,
  type CompanyConfig,
  type Person,
  type Role,
  type TriggerId,
} from './schema.ts';

// ---------------------------------------------------------------- the facts

/** A forecast number as the impact checks give it. The same shape as the checks' `Money`, which carries more. */
export interface Range {
  p10: number;
  p50: number;
  p90: number;
}

/**
 * The cost of a change as Norn's cost check gives it (`costCheck`'s `headline`), in the company currency.
 * Savings are negative. The recurring figure covers `windowMonths` months of production from the cut-in.
 */
export interface CostForecast {
  windowMonths: number;
  /** The one-time total, `headline.oneTimeTotal`. */
  oneTime: Range;
  /** The recurring change over the window, `headline.recurringWindow`. */
  recurringWindow: Range;
  /** One-time plus recurring over the window, `headline.windowTotal`. */
  windowTotal: Range;
  /**
   * The spend and the saving over the window, each as a range of positive amounts, kept apart. A company whose
   * cost measure does not let savings offset spend (`savingsOffset` false) needs these: the net totals above
   * cannot say how large either was (+200,000 of tooling and a 190,000 credit net to 10,000). Give them only
   * when they are known, for example when every cost row has the same sign, so one of the two is zero.
   */
  gross?: { spend: Range; saving: Range };
  /**
   * The size of the change's cost by the company's cost measure, already worked out for each draw of the
   * forecast. The exact figure: it wins over the estimate made from the other fields. The checks do not give
   * it yet. It counts only when `windowMonths` is the horizon the configuration names.
   */
  measured?: { p50: number; p90: number };
}

/** The part of `costCheck`'s result that `costForecastFromCheck` reads. */
export interface CostCheckHeadline {
  window: { months: number };
  headline: { oneTimeTotal: Range; recurringWindow: Range; windowTotal: Range };
  /** The cost rows by block. Optional: with them, `gross` is filled in when every row has the same sign. */
  blocks?: Record<string, { total: Range }[]>;
}

/**
 * The cost facts for a route, from a `costCheck` result. The check gives ranges of signed totals and no gross
 * spend or saving, so `gross` is set only when every cost row is at or above zero at its p10 (all spend) or at
 * or below zero at its p90 (all saving): then the window total is the spend, or minus the saving. A mix of the
 * two leaves it out, and a company that does not net savings then has an unmeasured cost. To measure those, the
 * checks would have to expose either `measured` (the cost measure's p50 and p90 per draw) or the per-draw
 * gross spend and gross saving over the window.
 */
export function costForecastFromCheck(result: CostCheckHeadline): CostForecast {
  const { oneTimeTotal, recurringWindow, windowTotal } = result.headline;
  const range = ({ p10, p50, p90 }: Range): Range => ({ p10, p50, p90 });
  const forecast: CostForecast = { windowMonths: result.window.months, oneTime: range(oneTimeTotal), recurringWindow: range(recurringWindow), windowTotal: range(windowTotal) };
  const rows = Object.values(result.blocks ?? {}).flat();
  const zero: Range = { p10: 0, p50: 0, p90: 0 };
  if (rows.length > 0) {
    if (rows.every((r) => r.total.p10 >= 0)) forecast.gross = { spend: range(windowTotal), saving: zero };
    else if (rows.every((r) => r.total.p90 <= 0)) forecast.gross = { spend: zero, saving: { p10: -windowTotal.p90, p50: -windowTotal.p50, p90: -windowTotal.p10 } };
  }
  return forecast;
}

/**
 * What is known about one ECR. Everything but the id is optional, because an ECR is routed as soon as it is
 * filed and the rest arrives as the checks and the classifier finish; what is missing counts against the actor.
 */
export interface EcrFacts {
  /**
   * The ECR's number in the PLM, such as ECR-0417. An ECR Norn opened before the PLM numbered it is held
   * under a placeholder (NORN-<id>), which is not a number: nothing is sampled under it.
   */
  ecrId: string;
  /** Norn's cost assessment. Missing: the cost is unmeasured. */
  cost?: CostForecast;
  /** The p90 slip of the cut-in date in days, from the timeline check. Missing: unknown. */
  slipP90Days?: number;
  /** The level of the report the decision rests on (#26). Missing: unknown. */
  reportLevel?: 1 | 2 | 3;
  /** The class on each axis, if one has been set or proposed. Missing: the axis's `whenUnsure` class. */
  classes?: { company?: string; regulatory?: string };
  /**
   * The answers to the configuration's tests (`approval.neverFastTrack`, `fastTrack.requireAll` and
   * `fastTrack.requireOneOf`), by test id: true if the test's text is true of this ECR. A test with a
   * `whenClass` is answered by the class and needs none. A test with no answer is unanswered.
   */
  answers?: Record<string, boolean>;
  /** The named conditions Norn has detected on the ECR (`TRIGGERS`). */
  triggers?: readonly TriggerId[];
  /** The person who owns the changed item. A fast-track approver that "must own the change" has to be this person. */
  ownerId?: string;
  /** How the ECR was approved, once it has been: on the fast track, or by the approval body with this id. */
  approvedBy?: 'fast_track' | (string & {});
}

// ---------------------------------------------------------------- the route

/** One line of an answer: the rule in the configuration that it rests on, and what it says, in plain words. */
export interface Reason {
  rule: string;
  text: string;
}

export interface ClassPlacement {
  axis: 'company' | 'regulatory';
  value: string;
  label: string;
  /** 'set': the facts give this class. 'when_unsure': none was given (or it was not one of the axis's classes). */
  source: 'set' | 'when_unsure';
  rule: string;
  why: string;
}

export interface CostMeasurement {
  /** The size of the change's cost by `approval.costMeasure`, in the company currency. Null: unmeasured. */
  size: number | null;
  percentile: 'p50' | 'p90';
  horizonMonths: number;
  /**
   * 'measured': given by the checks per draw. 'estimated': worked out from the ranges, a figure to rely on if
   * the draws stay on one side of zero. 'lower_bound': the true size is at least this, so it can route a change
   * but cannot show it is within a limit. 'unmeasured': no figure.
   */
  basis: 'measured' | 'estimated' | 'lower_bound' | 'unmeasured';
  rule: string;
  why: string;
}

export interface TierPlacement {
  tierId: string;
  /** Position in `approval.tiers`, from 0 (the cheapest). */
  tierIndex: number;
  upTo: number | null;
  bodyId: string;
  bodyName: string;
  chairRole: string;
  /** The bodies of the tiers below that also review this change (`alsoReviewsAbove`). */
  alsoReviewedBy: { id: string; name: string }[];
  rule: string;
  why: string;
}

export interface TestResult {
  id: string;
  text: string;
  list: 'neverFastTrack' | 'requireAll' | 'requireOneOf';
  /** Whether the test's text is true of the ECR; null when nobody has answered. */
  holds: boolean | null;
  basis: 'class' | 'answered' | 'unanswered';
}

export interface FastTrackEligibility {
  eligible: boolean;
  /** Never-fast-track tests that hold. */
  blockedBy: TestResult[];
  /** Criteria that do not hold: a `requireAll` test, or all of `requireOneOf` when none holds. */
  unmet: TestResult[];
  /** Tests nobody has answered, on which eligibility cannot be shown. */
  unanswered: TestResult[];
  tests: TestResult[];
  rule: string;
  why: string;
}

export interface Route {
  ecrId: string;
  classes: { company: ClassPlacement; regulatory: ClassPlacement };
  cost: CostMeasurement;
  tier: TierPlacement;
  fastTrack: FastTrackEligibility;
  /** Every answer's reason, in order, for a log line or a card. */
  reasons: Reason[];
}

const money = (config: CompanyConfig, n: number): string => `${Math.round(n).toLocaleString('en-US')} ${config.company.currency}`;

function placeClass(config: CompanyConfig, axis: 'company' | 'regulatory', given: string | undefined): ClassPlacement {
  const a = config.changeClasses[axis];
  const known = a.values.find((v) => v.id === given);
  if (known) {
    return { axis, value: known.id, label: known.label, source: 'set', rule: `changeClasses.${axis}.values[${known.id}]`, why: `The ${a.label.toLowerCase()} on the ECR is ${known.label}.` };
  }
  const fallback = a.values.find((v) => v.id === a.whenUnsure)!;
  const because = given === undefined ? 'None has been set' : `${JSON.stringify(given)} is not one of this axis's classes`;
  return {
    axis,
    value: fallback.id,
    label: fallback.label,
    source: 'when_unsure',
    rule: `changeClasses.${axis}.whenUnsure`,
    why: `${because}, so the ${a.label.toLowerCase()} is ${fallback.label}, the class the configuration uses when Norn cannot tell.`,
  };
}

/**
 * The size of the change's cost by `approval.costMeasure`, in the company currency.
 *
 * The configuration defines it per draw of the forecast: the larger of the spend and the saving (or the size of
 * their difference), taken at a percentile across the draws. The checks give ranges, not draws, so this is exact
 * only when the facts carry the figure (`CostForecast.measured`). Otherwise it is an estimate, and an estimate
 * can be wrong in either direction, so the rules below refuse one rather than guess:
 * - the assessment must cover the configured horizon, `measured` included;
 * - `savingsOffset` true: the size is |net total|. At p90 that is the larger end of the window total's p10 and
 *   p90 when both lie on the same side of zero. If the range straddles zero the p90 of |net| can be larger than
 *   either end (triangular(-40000, 0, 40000) has ends of about 22,111 and a p90 of |x| of 27,351), so the cost
 *   is unmeasured. At p50 the larger end is an upper bound whichever side the range falls on.
 *   Even on one side, the figure assumes the tails beyond p10 and p90 do not cross zero;
 * - `savingsOffset` false: the size is the larger of the gross spend and the gross saving, which net totals
 *   cannot give. Without `gross` the cost is unmeasured. When one of the two is zero, the other is the size.
 *   When both are positive the larger is only a lower bound.
 */
export function measureCost(config: CompanyConfig, cost: CostForecast | undefined): CostMeasurement {
  const m = config.approval.costMeasure;
  const base = { percentile: m.percentile, horizonMonths: m.horizonMonths, rule: 'approval.costMeasure' };
  const unmeasured = (why: string): CostMeasurement => ({ ...base, size: null, basis: 'unmeasured', why });
  if (!cost) return unmeasured('There is no cost assessment yet, so the cost is unmeasured.');
  if (cost.windowMonths !== m.horizonMonths) {
    return unmeasured(`The assessment covers ${cost.windowMonths} months of production and the cost measure needs ${m.horizonMonths}, so the cost is unmeasured.`);
  }
  if (cost.measured) {
    const size = cost.measured[m.percentile];
    return { ...base, size, basis: 'measured', why: `The ${m.percentile} size of the change over ${m.horizonMonths} months is ${money(config, size)}, as worked out per draw of the forecast.` };
  }
  const where = `The ${m.percentile} size of the change over ${m.horizonMonths} months`;
  if (m.savingsOffset) {
    const net = cost.windowTotal;
    const sameSide = net.p10 >= 0 || net.p90 <= 0;
    if (m.percentile === 'p90' && !sameSide) {
      return unmeasured(
        `The net cost over ${m.horizonMonths} months runs from ${money(config, net.p10)} to ${money(config, net.p90)}, across zero, and the forecast's ranges cannot give the p90 size of a change that crosses zero, so the cost is unmeasured.`,
      );
    }
    const size = m.percentile === 'p50' && sameSide ? Math.abs(net.p50) : Math.max(Math.abs(net.p10), Math.abs(net.p90));
    return { ...base, size, basis: 'estimated', why: `${where} is ${money(config, size)}, estimated from the net cost's range (${money(config, net.p10)} to ${money(config, net.p90)}).` };
  }
  if (!cost.gross) {
    return unmeasured(
      "The company's cost measure does not let savings offset spend, and the assessment gives only net totals, which cannot show how large the spend or the saving is on its own, so the cost is unmeasured.",
    );
  }
  const { spend, saving } = cost.gross;
  const at = (r: Range): number => (m.percentile === 'p90' ? r.p90 : r.p50);
  const isZero = (r: Range): boolean => r.p10 === 0 && r.p50 === 0 && r.p90 === 0;
  const spent = at(spend);
  const saved = at(saving);
  const size = Math.max(spent, saved);
  const detail = `the larger of the spend (${money(config, spent)}) and the saving (${money(config, saved)})`;
  if (isZero(spend) || isZero(saving)) {
    return { ...base, size, basis: 'estimated', why: `${where} is ${money(config, size)}: ${detail}, estimated from the forecast's ranges.` };
  }
  return {
    ...base,
    size,
    basis: 'lower_bound',
    why: `${where} is at least ${money(config, size)}: ${detail}. The change has both a spend and a saving, and their ranges cannot show how the larger of the two behaves draw by draw, so the true size can be higher.`,
  };
}

function placeTier(config: CompanyConfig, cost: CostMeasurement): TierPlacement {
  const { tiers, bodies } = config.approval;
  let index = tiers.length - 1;
  if (cost.size !== null) {
    const found = tiers.findIndex((t) => t.upTo === null || cost.size! <= t.upTo);
    if (found >= 0) index = found;
  }
  const tier = tiers[index]!;
  const body = bodies.find((b) => b.id === tier.body)!;
  const alsoReviewedBy = tiers
    .slice(0, index)
    .filter((t) => t.alsoReviewsAbove)
    .map((t) => bodies.find((b) => b.id === t.body)!)
    .map((b) => ({ id: b.id, name: b.name }));
  const lower = index > 0 ? tiers[index - 1]!.upTo : null;
  let why: string;
  if (cost.size === null) {
    why = `The cost is unmeasured, so the change goes to the top tier, the ${body.name}.`;
  } else if (tier.upTo === null) {
    why = `At ${money(config, cost.size)} the change is above ${money(config, lower!)}, so the ${body.name} decides it.`;
  } else if (lower === null) {
    why = `At ${money(config, cost.size)} the change is within ${money(config, tier.upTo)}, so the ${body.name} decides it.`;
  } else {
    why = `At ${money(config, cost.size)} the change is above ${money(config, lower)} and within ${money(config, tier.upTo)}, so the ${body.name} decides it.`;
  }
  if (alsoReviewedBy.length > 0) why += ` The ${alsoReviewedBy.map((b) => b.name).join(' and ')} also reviews it.`;
  return {
    tierId: tier.id,
    tierIndex: index,
    upTo: tier.upTo,
    bodyId: body.id,
    bodyName: body.name,
    chairRole: body.chairRole,
    alsoReviewedBy,
    rule: `approval.tiers[${tier.id}]`,
    why,
  };
}

function evaluateTests(
  config: CompanyConfig,
  classes: { company: ClassPlacement; regulatory: ClassPlacement },
  answers: Record<string, boolean>
): TestResult[] {
  const { approval } = config;
  const lists = [
    ['neverFastTrack', approval.neverFastTrack],
    ['requireAll', approval.fastTrack.requireAll],
    ['requireOneOf', approval.fastTrack.requireOneOf],
  ] as const;
  return lists.flatMap(([list, tests]) =>
    tests.map((t): TestResult => {
      if (t.whenClass) return { id: t.id, text: t.text, list, holds: classes[t.whenClass.axis].value === t.whenClass.value, basis: 'class' };
      const answer = answers[t.id];
      return answer === undefined ? { id: t.id, text: t.text, list, holds: null, basis: 'unanswered' } : { id: t.id, text: t.text, list, holds: answer, basis: 'answered' };
    })
  );
}

const pathOf = (t: TestResult): string => (t.list === 'neverFastTrack' ? `approval.neverFastTrack[${t.id}]` : `approval.fastTrack.${t.list}[${t.id}]`);

function judgeFastTrack(tests: TestResult[]): FastTrackEligibility {
  const never = tests.filter((t) => t.list === 'neverFastTrack');
  const all = tests.filter((t) => t.list === 'requireAll');
  const oneOf = tests.filter((t) => t.list === 'requireOneOf');
  const blockedBy = never.filter((t) => t.holds === true);
  const unmet = all.filter((t) => t.holds === false);
  const unanswered = [...never, ...all].filter((t) => t.holds === null);
  if (!oneOf.some((t) => t.holds === true)) {
    // No kind of change is shown yet: unmet if every one is answered no, unanswered if some are still open.
    if (oneOf.some((t) => t.holds === null)) unanswered.push(...oneOf.filter((t) => t.holds === null));
    else unmet.push(...oneOf);
  }
  const eligible = blockedBy.length === 0 && unmet.length === 0 && unanswered.length === 0;
  const lines: string[] = [];
  for (const t of blockedBy) lines.push(`Never on the fast track: ${t.text}.`);
  for (const t of unmet) lines.push(t.list === 'requireOneOf' ? `The fast track is for certain kinds of change, and this is not: ${t.text}.` : `Fast-track condition not met: ${t.text}.`);
  if (unanswered.length > 0) lines.push(`Not yet answered, so the fast track cannot be shown to apply: ${unanswered.map((t) => t.text).join('; ')}.`);
  const decisive = blockedBy[0] ?? unmet[0] ?? unanswered[0];
  return {
    eligible,
    blockedBy,
    unmet,
    unanswered,
    tests,
    rule: decisive ? pathOf(decisive) : 'approval.fastTrack',
    why: eligible ? `Eligible for the fast track: none of the ${never.length} never-fast-track rules applies and every condition holds.` : lines.join(' '),
  };
}

/** Where an ECR goes: its class on each axis, the approval tier and body its cost points to, and whether it can take the fast track. */
export function routeEcr(config: CompanyConfig, facts: EcrFacts): Route {
  const classes = {
    company: placeClass(config, 'company', facts.classes?.company),
    regulatory: placeClass(config, 'regulatory', facts.classes?.regulatory),
  };
  const cost = measureCost(config, facts.cost);
  const tier = placeTier(config, cost);
  const fastTrack = judgeFastTrack(evaluateTests(config, classes, facts.answers ?? {}));
  const reasons: Reason[] = [
    { rule: classes.company.rule, text: classes.company.why },
    { rule: classes.regulatory.rule, text: classes.regulatory.why },
    { rule: cost.rule, text: cost.why },
    { rule: tier.rule, text: tier.why },
    { rule: fastTrack.rule, text: fastTrack.why },
  ];
  return { ecrId: facts.ecrId, classes, cost, tier, fastTrack, reasons };
}

// ---------------------------------------------------------------- the decision

/**
 * Who is acting. A person acts as themselves. An agent is Norn's own unless `actingFor` names the person it
 * works for, and then it gets the stricter of that person's limits and the company's agent limits (#34).
 */
export type Actor = { kind: 'person'; id: string } | { kind: 'agent'; actingFor?: string };

export type Outcome = AutonomyLevel | 'deny';

export interface LimitCheck {
  limit: 'maxCost' | 'maxP90SlipDays' | 'minReportLevel';
  held: boolean;
  /** What the facts say; null when they say nothing. */
  actual: number | null;
  allowed: number;
  text: string;
}

export interface SampleDraw {
  rate: number;
  /** Where this ECR and action fell in [0, 1). Sampled when under the rate. */
  value: number;
  sampled: boolean;
}

export interface ActionDecision {
  action: string;
  ecrId: string;
  actor: Actor;
  outcome: Outcome;
  /** True when the action may be taken now: approved, or approved and not drawn for the second check. */
  actsNow: boolean;
  /** The rule that decided the outcome. */
  decidedBy: string;
  reasons: Reason[];
  /** The limits that were checked, when a rule had them and was not waived. */
  limits?: LimitCheck[];
  /** The draw, when the outcome is approve_sampled. */
  sample?: SampleDraw;
  /** The ECR has no PLM number, so the draw waits: the outcome is a recommendation until it has one. */
  waitsForPlmNumber?: boolean;
  /** Escalation triggers that applied. */
  escalatedFor?: TriggerId[];
  /** The roles that get the recommendation or the escalation. */
  recipients?: string[];
  /** For a fast-track action refused because the ECR cannot take the fast track: the same actor's decision on the ordinary route, to the body of the cost tier. */
  reroute?: ActionDecision;
}

export interface DecideInput {
  /** An action id from `ACTIONS`. Anything else is denied. */
  action: string;
  actor: Actor;
  facts: EcrFacts;
}

/** Actions that follow a decision: each needs an approved ECR before anyone, person or agent, can take it (`ACTIONS`). */
const FOLLOW_ON: readonly ActionId[] = ['release_eco', ...ERP_ACTIONS];

const isAction = (id: string): id is ActionId => (ACTION_IDS as string[]).includes(id);

const list = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function hasPlmNumber(config: CompanyConfig, ecrId: string): boolean {
  const { idPrefix, idDigits } = config.ecrForm;
  return new RegExp(`^${idPrefix}-\\d{${idDigits},}$`).test(ecrId);
}

function checkLimits(config: CompanyConfig, rule: ActionRule, facts: EcrFacts, route: Route): LimitCheck[] {
  const limits = rule.limits!;
  const checks: LimitCheck[] = [];
  if (limits.maxCost !== undefined) {
    const actual = route.cost.size;
    const lower = route.cost.basis === 'lower_bound';
    const held = actual !== null && !lower && actual <= limits.maxCost;
    checks.push({
      limit: 'maxCost',
      held,
      actual,
      allowed: limits.maxCost,
      text:
        actual === null
          ? `The cost is unmeasured and the limit is ${money(config, limits.maxCost)}.`
          : lower
            ? `The change is at least ${money(config, actual)}, and it cannot be shown to be within the limit of ${money(config, limits.maxCost)} because the true size can be higher.`
            : `The change is ${money(config, actual)} against a limit of ${money(config, limits.maxCost)}.`,
    });
  }
  if (limits.maxP90SlipDays !== undefined) {
    const actual = facts.slipP90Days ?? null;
    const held = actual !== null && actual <= limits.maxP90SlipDays;
    checks.push({
      limit: 'maxP90SlipDays',
      held,
      actual,
      allowed: limits.maxP90SlipDays,
      text: actual === null ? `The cut-in slip is not forecast and the limit is ${limits.maxP90SlipDays} days.` : `The p90 slip is ${actual} days against a limit of ${limits.maxP90SlipDays}.`,
    });
  }
  if (limits.minReportLevel !== undefined) {
    const actual = facts.reportLevel ?? null;
    const held = actual !== null && actual >= limits.minReportLevel;
    checks.push({
      limit: 'minReportLevel',
      held,
      actual,
      allowed: limits.minReportLevel,
      text: actual === null ? `There is no report yet and the decision needs at least Level ${limits.minReportLevel}.` : `The report is Level ${actual} and the decision needs at least Level ${limits.minReportLevel}.`,
    });
  }
  return checks;
}

/** Whether the body that approved the ECR still covers it: its tier is the tier of today's cost or one above. */
function approvalCovers(config: CompanyConfig, facts: EcrFacts, route: Route): boolean {
  if (!facts.approvedBy || facts.approvedBy === 'fast_track' || route.cost.size === null || route.cost.basis === 'lower_bound') return false;
  const index = config.approval.tiers.findIndex((t) => t.body === facts.approvedBy);
  return index >= route.tier.tierIndex;
}

function roleLabel(config: CompanyConfig, roleId: string): string {
  return config.roles.find((r) => r.id === roleId)?.label ?? roleId;
}

/** The recipients of a recommendation. The decision on a tier goes to the chair of the body of the tier; the rest go to the roles that hold the action. */
function recommendTo(config: CompanyConfig, action: ActionId, route: Route): string[] {
  if (action === 'approve_ecr_at_tier') return [route.tier.chairRole];
  return config.roles.filter((r) => r.can.includes(action)).map((r) => r.id);
}

function decide(config: CompanyConfig, input: DecideInput, route: Route, mayReroute: boolean): ActionDecision {
  const { actor, facts } = input;
  const reasons: Reason[] = [];
  const result = (outcome: Outcome, decidedBy: string, extra: Partial<ActionDecision> = {}): ActionDecision => ({
    action: input.action,
    ecrId: facts.ecrId,
    actor,
    outcome,
    actsNow: outcome === 'approve' || (outcome === 'approve_sampled' && extra.sample?.sampled === false),
    decidedBy,
    reasons,
    ...extra,
  });
  const deny = (rule: string, text: string): ActionDecision => {
    reasons.push({ rule, text });
    return result('deny', rule);
  };

  if (!isAction(input.action)) return deny('autonomy.actions', `${JSON.stringify(input.action)} is not an action this configuration knows.`);
  const action = input.action;

  // Whose limits apply: the person's, if the actor is one or acts for one.
  const personId = actor.kind === 'person' ? actor.id : actor.actingFor;
  let person: Person | undefined;
  let role: Role | undefined;
  if (personId !== undefined) {
    person = config.people.find((p) => p.id === personId);
    if (!person) return deny('people', `${JSON.stringify(personId)} is not a person in this configuration${actor.kind === 'agent' ? ', so an agent cannot act for them' : ''}.`);
    role = config.roles.find((r) => r.id === person!.role)!;
    const who = actor.kind === 'agent' ? `The agent acts for ${person.name} (${role.label}), who` : `${person.name} (${role.label})`;
    if (!role.can.includes(action)) {
      return deny(`roles[${role.id}].can`, actor.kind === 'agent' ? `${who} cannot ${action}, and an agent acting for someone can do no more than they can.` : `${who} cannot ${action}.`);
    }
    reasons.push({ rule: `roles[${role.id}].can`, text: actor.kind === 'agent' ? `${who} may ${action}, so the company's agent limits decide.` : `${who} may ${action}.` });
    if (action === 'approve_ecr_at_tier') {
      const covering = config.approval.bodies.filter((b) => b.chairRole === role!.id && config.approval.tiers.findIndex((t) => t.body === b.id) >= route.tier.tierIndex);
      if (covering.length === 0) {
        return deny(route.tier.rule, `${person.name} does not chair a body that decides this change: it goes to the ${route.tier.bodyName}, chaired by ${roleLabel(config, route.tier.chairRole)}.`);
      }
    }
    if (action === 'approve_fast_track_ecr' && config.approval.fastTrack.approvers.some((a) => a.role === role!.id && a.mustOwnTheChange) && facts.ownerId !== person.id) {
      return deny('approval.fastTrack.approvers', `${person.name} must own the changed item to approve on the fast track${facts.ownerId === undefined ? ', and nobody is recorded as its owner' : ''}.`);
    }
  }

  // The action must be available for this ECR, whoever takes it.
  if (action === 'approve_fast_track_ecr' && !route.fastTrack.eligible) {
    reasons.push({ rule: route.fastTrack.rule, text: route.fastTrack.why });
    reasons.push({ rule: route.tier.rule, text: `So the ECR goes the ordinary way, to the ${route.tier.bodyName}.` });
    const denied = result('deny', route.fastTrack.rule);
    if (mayReroute) denied.reroute = decide(config, { ...input, action: 'approve_ecr_at_tier' }, route, false);
    return denied;
  }
  if (FOLLOW_ON.includes(action) && !facts.approvedBy) {
    return deny('ACTIONS', `${action} follows a decision, and this ECR has not been approved by a body or on the fast track.`);
  }
  if (FOLLOW_ON.includes(action) && facts.approvedBy !== 'fast_track' && !config.approval.bodies.some((b) => b.id === facts.approvedBy)) {
    return deny('approval.bodies', `${action} follows a decision, and ${JSON.stringify(facts.approvedBy)} is neither the fast track nor an approval body in the configuration, so the ECR has not been approved.`);
  }

  // A person acting as themselves does what their role allows.
  if (actor.kind === 'person') {
    if (action === 'approve_fast_track_ecr') {
      const others = config.approval.fastTrack.approvers.filter((a) => a.role !== role!.id).map((a) => roleLabel(config, a.role));
      if (others.length > 0) reasons.push({ rule: 'approval.fastTrack.approvers', text: `The fast track also needs the signature of ${list(others)}.` });
    }
    return result('approve', `roles[${role!.id}].can`);
  }

  // An agent: the company's rule for the action.
  const rule = config.autonomy.actions.find((r) => r.action === action)!;
  const rulePath = `autonomy.actions[${action}]`;
  let level: AutonomyLevel = rule.level;
  let decidedBy = `${rulePath}.level`;
  reasons.push({ rule: decidedBy, text: `The company sets ${action} to ${level} for agents: ${rule.why}` });

  const hit = (rule.escalateOn ?? []).filter((t) => facts.triggers?.includes(t));
  if (hit.length > 0) {
    reasons.push({ rule: `${rulePath}.escalateOn`, text: `${list(hit)} detected, so the matter goes to ${roleLabel(config, rule.escalateTo!)} with the work done.` });
    return result('escalate', `${rulePath}.escalateOn`, { escalatedFor: hit, recipients: [rule.escalateTo!] });
  }

  let limits: LimitCheck[] | undefined;
  if (rule.limits && (level === 'approve' || level === 'approve_sampled')) {
    if (rule.carriesOutApproval && approvalCovers(config, facts, route)) {
      const body = config.approval.bodies.find((b) => b.id === facts.approvedBy)!;
      reasons.push({ rule: `${rulePath}.carriesOutApproval`, text: `The ${body.name} approved the ECR and its tier still covers the change at today's cost, so this only carries out its decision and the limits are waived.` });
    } else {
      limits = checkLimits(config, rule, facts, route);
      const failed = limits.filter((l) => !l.held);
      if (failed.length > 0) {
        level = rule.otherwise ?? 'recommend';
        decidedBy = `${rulePath}.limits`;
        for (const l of failed) reasons.push({ rule: `${rulePath}.limits.${l.limit}`, text: `${l.text} Past a limit the agent ${level === 'recommend' ? 'recommends' : `is set to ${level}`}.` });
      } else {
        reasons.push({ rule: `${rulePath}.limits`, text: `Within every limit: ${limits.map((l) => l.text).join(' ')}` });
      }
    }
  }
  const withLimits = limits ? { limits } : {};

  if (level === 'escalate') {
    reasons.push({ rule: decidedBy, text: `The agent hands the matter to ${roleLabel(config, rule.escalateTo!)}.` });
    return result('escalate', decidedBy, { ...withLimits, recipients: rule.escalateTo ? [rule.escalateTo] : [] });
  }
  if (level === 'approve_sampled') {
    if (!hasPlmNumber(config, facts.ecrId)) {
      reasons.push({
        rule: 'autonomy.sampleSeed',
        text: `${JSON.stringify(facts.ecrId)} is not a ${config.ecrForm.idPrefix} number from the PLM, so nothing can be drawn for the second check yet. The agent recommends, and the action is decided again once the PLM has numbered the ECR.`,
      });
      return result('recommend', 'autonomy.sampleSeed', { ...withLimits, waitsForPlmNumber: true, recipients: recommendTo(config, action, route) });
    }
    const key = { sampleSeed: config.autonomy.sampleSeed, ecrId: facts.ecrId, action };
    const draw: SampleDraw = { rate: rule.sampleRate!, value: sampleValue(key), sampled: isSampled({ ...key, rate: rule.sampleRate! }) };
    reasons.push({
      rule: `${rulePath}.sampleRate`,
      text: draw.sampled
        ? `Drawn for the blind second check (${draw.value.toFixed(4)} is under ${draw.rate}), so the action waits for it.`
        : `Not drawn for the blind second check (${draw.value.toFixed(4)} is not under ${draw.rate}), so the agent acts.`,
    });
    return result('approve_sampled', decidedBy, { ...withLimits, sample: draw });
  }
  if (level === 'approve') {
    reasons.push({ rule: decidedBy, text: 'The agent acts without a check first.' });
    return result('approve', decidedBy, withLimits);
  }
  reasons.push({ rule: decidedBy, text: 'The agent files a recommendation with its reasoning and a person decides.' });
  return result('recommend', decidedBy, { ...withLimits, recipients: recommendTo(config, action, route) });
}

/**
 * May this actor take this action on this ECR, and at what level? Never throws on a bad id or a missing fact:
 * the answer is a denial that says what was wrong. An agent acting for a person is refused if the person's role
 * lacks the action, and otherwise decided by the company's rule, which is the stricter of the two because a
 * person's side only ever allows or refuses (roles carry no limits).
 */
export function decideAction(config: CompanyConfig, input: DecideInput): ActionDecision {
  // Always worked out here from this call's facts. A route kept from earlier describes the cost it was made at.
  return decide(config, input, routeEcr(config, input.facts), true);
}
