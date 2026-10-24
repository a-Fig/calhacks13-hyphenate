// The pure half of the company gate (#43): what the policy rule in gate.ts decides, as functions of
// plain values. Nothing here touches a database or SpacetimeDB, so it runs in plain Node and is
// tested there (norn/workers/test/gate.test.ts). gate.ts reads the tables, calls these, and records.
//
// Everything company-specific comes from the stored configuration through @norn/config's
// decideAction and routeEcr (config/src/route.ts); this file only translates between the module's
// vocabulary (reducers, actors, check-result rows) and the configuration's (actions, people, facts).
import { decideAction, routeEcr, type ActionDecision, type CostForecast, type EcrFacts, type LimitCheck, type Range, type Reason, type Route, type SampleDraw } from '../../config/src/route';
import { TRIGGER_IDS, type ActionId, type CompanyConfig, type TriggerId } from '../../config/src/schema';
import { formatIssue, validateConfig } from '../../config/src/validate';
import { configHash } from '../../config/src/stored';

// ---------------------------------------------------------------------------------------------
// The stored configuration
// ---------------------------------------------------------------------------------------------

/** 'none': no configuration is stored. 'unreadable': one is stored but does not validate. */
export type LoadedConfig = { state: 'none' } | { state: 'unreadable'; why: string } | { state: 'ok'; config: CompanyConfig; hash: string };

/**
 * Reads the text stored under `company_config`. The module only checks that the text is canonical
 * JSON (company-config.ts), so the schema and the rules between fields are checked here, where it
 * is used: the gate must not act on a configuration that would not have passed the loader.
 */
export function readCompanyConfig(text: string | undefined): LoadedConfig {
  if (text === undefined) return { state: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'unreadable', why: 'the stored configuration is not valid JSON' };
  }
  const checked = validateConfig(parsed);
  if (!checked.ok) {
    const first = checked.issues.slice(0, 3).map(formatIssue).join('; ');
    return { state: 'unreadable', why: `the stored configuration does not validate (${checked.issues.length} problem(s): ${first})` };
  }
  return { state: 'ok', config: checked.config, hash: configHash(text) };
}

// ---------------------------------------------------------------------------------------------
// Which write is which of the company's actions
// ---------------------------------------------------------------------------------------------

/**
 * The company action a write reducer carries out, if the configuration has one for it. Writes that
 * are not the company's decisions (a check run's bookkeeping, a comment, an assumption) return null
 * and stay allowed, with a reason that says so. `set_config` is among them: see the PR for that gap.
 */
export function actionFor(reducer: string, args: { status?: unknown }): ActionId | null {
  if (reducer === 'set_pr_status') {
    if (args.status === 'approved') return 'approve_ecr_at_tier';
    if (args.status === 'merged') return 'release_eco';
    return null;
  }
  if (reducer === 'post_impact_statement') return 'post_impact_statement';
  if (reducer === 'request_fast_track_approval') return 'approve_fast_track_ecr';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Who is acting
// ---------------------------------------------------------------------------------------------

export type ConfigActor = { kind: 'person'; id: string } | { kind: 'agent'; actingFor?: string };

/** The module's view of the caller (core.ts `Actor`), without the scope. */
export type CallerView = { kind: 'person' | 'agent' | 'unknown'; name: string; onBehalfOf: string | null };

/**
 * A person is named by the configuration's person id or by name (case does not matter). A name that
 * matches nobody is passed on as it is, so the decision says "not a person in this configuration"
 * rather than the gate guessing.
 */
export function personRef(config: CompanyConfig, who: string): string {
  const w = who.trim().toLowerCase();
  const p = config.people.find((x) => x.id.toLowerCase() === w) ?? config.people.find((x) => x.name.toLowerCase() === w);
  return p ? p.id : who.trim();
}

/** Null for a connection that has not said whether it is a person or an agent. */
export function configActor(config: CompanyConfig, who: CallerView): ConfigActor | null {
  if (who.kind === 'person') return { kind: 'person', id: personRef(config, who.name) };
  if (who.kind === 'agent') return who.onBehalfOf ? { kind: 'agent', actingFor: personRef(config, who.onBehalfOf) } : { kind: 'agent' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// The agent's fast-track request
// ---------------------------------------------------------------------------------------------

export interface TestAnswerIn {
  testId: string;
  holds: boolean;
  evidence: string;
}

/** What the agent said, validated against the configuration, as it is stored with the decision. */
export interface FastTrackRequest {
  answers: TestAnswerIn[];
  /** The classes the agent proposes. '' for an axis it proposed none for. */
  classes: { company: string; regulatory: string };
  triggers: TriggerId[];
}

const MAX_EVIDENCE = 400;

/** The ids of the tests a person or agent answers: every test that is not settled by the ECR's class. */
export function answerableTests(config: CompanyConfig): string[] {
  const { approval } = config;
  return [...approval.neverFastTrack, ...approval.fastTrack.requireAll, ...approval.fastTrack.requireOneOf].filter((t) => !t.whenClass).map((t) => t.id);
}

/**
 * Checks an agent's request against the configuration. Refused (with the reason) when it answers a
 * test the configuration does not have, answers one twice, answers one that the ECR's class settles,
 * gives an answer with no evidence, proposes a class the axis does not have, or names an unknown trigger.
 * Unanswered tests are not refused here: the decision counts them against the agent.
 */
export function readFastTrackRequest(
  config: CompanyConfig,
  args: { answers: readonly TestAnswerIn[]; companyClass: string; regulatoryClass: string; triggers: readonly string[] },
): { ok: true; request: FastTrackRequest } | { ok: false; why: string } {
  const known = new Set(answerableTests(config));
  const settledByClass = new Set(
    [...config.approval.neverFastTrack, ...config.approval.fastTrack.requireAll, ...config.approval.fastTrack.requireOneOf].filter((t) => t.whenClass).map((t) => t.id),
  );
  const seen = new Set<string>();
  const answers: TestAnswerIn[] = [];
  for (const a of args.answers) {
    const id = a.testId.trim();
    if (settledByClass.has(id)) return { ok: false, why: `test '${id}' is settled by the ECR's class, not by an answer` };
    if (!known.has(id)) return { ok: false, why: `'${id}' is not one of the configuration's fast-track tests (${[...known].join(', ')})` };
    if (seen.has(id)) return { ok: false, why: `test '${id}' is answered twice` };
    const evidence = a.evidence.trim();
    if (!evidence) return { ok: false, why: `the answer to '${id}' has no evidence` };
    if (evidence.length > MAX_EVIDENCE) return { ok: false, why: `the evidence for '${id}' is too long (max ${MAX_EVIDENCE} characters)` };
    seen.add(id);
    answers.push({ testId: id, holds: a.holds, evidence });
  }
  const classes = { company: args.companyClass.trim(), regulatory: args.regulatoryClass.trim() };
  for (const axis of ['company', 'regulatory'] as const) {
    const ids = config.changeClasses[axis].values.map((v) => v.id);
    if (classes[axis] !== '' && !ids.includes(classes[axis])) return { ok: false, why: `'${classes[axis]}' is not a ${axis} class (${ids.join(', ')})` };
  }
  const triggers: TriggerId[] = [];
  for (const raw of args.triggers) {
    const trig = raw.trim();
    if (!(TRIGGER_IDS as string[]).includes(trig)) return { ok: false, why: `'${trig}' is not a trigger in the configuration (${TRIGGER_IDS.join(', ')})` };
    if (!triggers.includes(trig as TriggerId)) triggers.push(trig as TriggerId);
  }
  return { ok: true, request: { answers, classes, triggers } };
}

// ---------------------------------------------------------------------------------------------
// The cost, from the stored check results
// ---------------------------------------------------------------------------------------------

/** A stored check result, as the gate needs it. */
export interface ResultRow {
  key: string;
  p10: number;
  p50: number;
  p90: number;
  detailJson: string;
  mock: boolean;
}

const range = (r: ResultRow): Range => ({ p10: r.p10, p50: r.p50, p90: r.p90 });
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function detailOf(r: ResultRow): Record<string, any> | undefined {
  try {
    const d = JSON.parse(r.detailJson);
    return d && typeof d === 'object' ? d : undefined;
  } catch {
    return undefined;
  }
}

/** The key of the row that holds a cost measure. The row's p50 and p90 are the measure's; its p10 repeats p50. */
export const costMeasureKey = (horizonMonths: number, savingsOffset: boolean): string => `cost_measure:${horizonMonths}:${savingsOffset ? 'net' : 'larger'}`;

/**
 * The cost facts from the rows of an ECR's finished cost check on its current inputs. Mock rows (a
 * stand-in worker's) are never read: without real rows the cost is unmeasured. The exact measure is
 * attached only when the row is the one the configuration asks for.
 */
export function costFromRows(rows: readonly ResultRow[], config: CompanyConfig): CostForecast | undefined {
  const real = rows.filter((r) => !r.mock);
  const oneTime = real.find((r) => r.key === 'one_time_total');
  const recurring = real.find((r) => r.key === 'recurring_year_one');
  const net = real.find((r) => r.key === 'net_total_year_one');
  if (!oneTime || !recurring || !net) return undefined;
  const months = detailOf(net)?.window?.months;
  if (!Number.isInteger(months)) return undefined;
  const forecast: CostForecast = { windowMonths: months, oneTime: range(oneTime), recurringWindow: range(recurring), windowTotal: range(net) };
  const wanted = config.approval.costMeasure;
  const row = real.find((r) => r.key === costMeasureKey(wanted.horizonMonths, wanted.savingsOffset));
  const m = row && detailOf(row);
  if (m && m.source === 'exact' && m.horizonMonths === wanted.horizonMonths && m.savingsOffset === wanted.savingsOffset && isNum(m.p50) && isNum(m.p90)) {
    forecast.measured = { source: 'exact', horizonMonths: m.horizonMonths, savingsOffset: m.savingsOffset, p50: m.p50, p90: m.p90 };
  }
  return forecast;
}

/**
 * The p90 slip of the cut-in, in days, from the timeline check's real rows, or undefined. It is the
 * check's `late_weeks` row (weeks after the stated effectivity; negative is early) at p90, times 7,
 * and never below zero. Stand-in (mock) rows are never read.
 *
 * An ECR that states no production effectivity by serial or date (a lot-based "after the old stock is
 * used up") has no deadline to slip against: when the check placed its cut-in and says exactly that
 * (`no_stated_effectivity`, and no lateness), the slip is 0. Anything else without a `late_weeks` row,
 * such as a cut-in that cannot be placed in the plan, or no timeline run at all, is unknown, and a
 * limit on slip counts as not held.
 */
export function slipFromRows(rows: readonly ResultRow[]): number | undefined {
  const r = rows.find((x) => !x.mock && x.key === 'late_weeks');
  if (r) return isNum(r.p90) ? Math.max(0, r.p90 * 7) : undefined;
  const detailRow = rows.find((x) => !x.mock && x.key === 'detail');
  const d = detailRow && detailOf(detailRow);
  const placed = rows.some((x) => !x.mock && x.key === 'cut_in_date' && isNum(x.p90));
  const flags: { kind?: unknown }[] = Array.isArray(d?.flags) ? d!.flags : [];
  const kinds = new Set(flags.map((f) => f?.kind));
  return placed && d && d.late === null && kinds.has('no_stated_effectivity') && !kinds.has('stock_beyond_plan') ? 0 : undefined;
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

export type GateEffect = 'allow' | 'deny' | 'downgrade';

/** Where the ECR lands and how its cost was measured: what an approval is later compared with. */
export interface RouteSummary {
  tierId: string;
  tierIndex: number;
  bodyId: string;
  bodyName: string;
  costSize: number | null;
  costBasis: Route['cost']['basis'];
  percentile: 'p50' | 'p90';
  horizonMonths: number;
}

/** What the gate found, as it is written to the action log (under `gate`) and to the approval and recommendation rows. */
export interface GateDetail {
  /** The action the decision is about. For a fast-track request that cannot take the fast track, the ordinary approval. */
  action: ActionId;
  /** The action the caller asked for, when that was refused and the ordinary route was decided instead. */
  requestedAction?: ActionId;
  ecrId: string;
  actor: ConfigActor;
  outcome: ActionDecision['outcome'];
  decidedBy: string;
  reasons: Reason[];
  limits?: LimitCheck[];
  sample?: SampleDraw;
  recipients: string[];
  escalatedFor?: TriggerId[];
  waitsForPlmNumber?: boolean;
  /** Drawn for the blind second check: the agent's approval waits for it. */
  awaitingSecondCheck: boolean;
  route: RouteSummary;
  /** The hash of the configuration this was decided under. */
  config: string;
  request?: FastTrackRequest;
}

export interface GateVerdict {
  effect: GateEffect;
  reason: string;
  downgradeTo?: string;
  detail: GateDetail;
}

export function summarizeRoute(route: Route): RouteSummary {
  return {
    tierId: route.tier.tierId,
    tierIndex: route.tier.tierIndex,
    bodyId: route.tier.bodyId,
    bodyName: route.tier.bodyName,
    costSize: route.cost.size,
    costBasis: route.cost.basis,
    percentile: route.cost.percentile,
    horizonMonths: route.cost.horizonMonths,
  };
}

/**
 * The company's decision on one action, as a policy verdict. An approval the company allows is
 * 'allow'. A recommendation, an escalation, or an approval drawn for the blind second check is
 * 'downgrade': the actor may do the weaker thing (file the recommendation) and not the approval. A
 * refusal is 'deny'. A fast-track request refused because the ECR cannot take the fast track becomes
 * the same actor's decision on the ordinary route when that is a recommendation or an escalation, so
 * the people who decide still get the work done; otherwise it stays refused.
 */
export function judge(config: CompanyConfig, configHashOf: string, input: { action: ActionId; actor: ConfigActor; facts: EcrFacts; request?: FastTrackRequest }): GateVerdict {
  const first = decideAction(config, { action: input.action, actor: input.actor, facts: input.facts });
  const route = routeEcr(config, input.facts);
  let used: ActionDecision = first;
  let rerouted = false;
  if (first.outcome === 'deny' && first.reroute && (first.reroute.outcome === 'recommend' || first.reroute.outcome === 'escalate')) {
    used = { ...first.reroute, reasons: [...first.reasons, ...first.reroute.reasons] };
    rerouted = true;
  }
  const sampled = used.outcome === 'approve_sampled' && used.sample?.sampled === true;
  const effect: GateEffect =
    used.outcome === 'approve' || (used.outcome === 'approve_sampled' && !sampled) ? 'allow' : used.outcome === 'deny' ? 'deny' : 'downgrade';
  const downgradeTo = sampled ? 'a recommendation held for the blind second check' : used.outcome === 'escalate' ? 'an escalation' : 'a recommendation';
  const detail: GateDetail = {
    action: used.action as ActionId,
    ...(rerouted ? { requestedAction: input.action } : {}),
    ecrId: input.facts.ecrId,
    actor: input.actor,
    outcome: used.outcome,
    decidedBy: used.decidedBy,
    reasons: used.reasons,
    ...(used.limits ? { limits: used.limits } : {}),
    ...(used.sample ? { sample: used.sample } : {}),
    recipients: used.recipients ?? [],
    ...(used.escalatedFor ? { escalatedFor: used.escalatedFor } : {}),
    ...(used.waitsForPlmNumber ? { waitsForPlmNumber: true } : {}),
    awaitingSecondCheck: sampled,
    route: summarizeRoute(route),
    config: configHashOf,
    ...(input.request ? { request: input.request } : {}),
  };
  return {
    effect,
    reason: `${used.outcome} (${used.decidedBy}): ${used.reasons.map((r) => r.text).join(' ')}`,
    ...(effect === 'downgrade' ? { downgradeTo } : {}),
    detail,
  };
}

// ---------------------------------------------------------------------------------------------
// An approval that stands while the checks are repeated
// ---------------------------------------------------------------------------------------------

/**
 * What an approval recorded about the tier it was given at. A tier's identity is its id and the body
 * that decides it, never its position in the configuration: a configuration can put another tier, or
 * another body, in the same place. `bodyId` is absent when the approval did not record one.
 */
export interface ApprovedAt {
  tierId: string;
  tierIndex: number;
  bodyId?: string;
}

export type TierVerdict =
  /** The re-checked, exactly measured numbers still point to the tier and body the approval was given by. */
  | { verdict: 'stands'; route: RouteSummary }
  /** They point elsewhere, or the tier or body is no longer what it was: the approval ends, for this reason. */
  | { verdict: 'withdraw'; route: RouteSummary; reason: string }
  /** The cost is not measured exactly, so the numbers cannot confirm the tier: the approval stays pending its re-check. */
  | { verdict: 'unconfirmed'; route: RouteSummary; reason: string };

/**
 * Once an approved ECR's checks have finished again: does the approval still stand?
 * - The tier it was given at must still exist in the configuration with the same id and the same
 *   deciding body; if not it is withdrawn, whatever the cost.
 * - It is confirmed only on an exact cost measure that points to that tier. An unmeasured cost routes
 *   to the top tier, which would "confirm" a top-tier approval by default, so without an exact
 *   measure the answer is "unconfirmed" and the approval stays pending.
 * - An exact measure that points to another tier withdraws it.
 */
export function tierVerdict(config: CompanyConfig, facts: EcrFacts, approvedAt: ApprovedAt): TierVerdict {
  const route = routeEcr(config, facts);
  const summary = summarizeRoute(route);
  const tier = config.approval.tiers.find((t) => t.id === approvedAt.tierId);
  if (!tier) {
    return { verdict: 'withdraw', route: summary, reason: `the ${approvedAt.tierId} tier it was approved at is no longer in the company configuration` };
  }
  if (approvedAt.bodyId !== undefined && tier.body !== approvedAt.bodyId) {
    return { verdict: 'withdraw', route: summary, reason: `the ${approvedAt.tierId} tier is now decided by the ${tier.body} body, not the ${approvedAt.bodyId} body that approved it` };
  }
  if (route.cost.basis !== 'measured') {
    return { verdict: 'unconfirmed', route: summary, reason: `the cost is not measured exactly on the current inputs (${route.cost.why}), so the ${approvedAt.tierId} tier cannot be confirmed` };
  }
  if (route.tier.tierId === approvedAt.tierId) return { verdict: 'stands', route: summary };
  return {
    verdict: 'withdraw',
    route: summary,
    reason: `the re-checked numbers move the ECR from the ${approvedAt.tierId} tier to the ${route.tier.tierId} tier. ${route.tier.why}`,
  };
}
