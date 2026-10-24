// The seam for change class and approval route (#75). It calls routeEcr (norn/config/src/route.ts), a
// pure function over the company's configuration and the numbers; nothing in this folder computes a
// class or a tier itself.
//
// Both the dispatcher (to tell the agent what it must not guess) and the publisher (to fill the PLM's
// class and route fields) call routeFor with the same inputs, so the agent is told what the PLM will
// say. Without a company configuration it returns nothing: a Level 1 statement then carries only what
// its own agent proposed, a class marked judgment, and the route "Pending Norn's routing".
//
// What routing decides here, and what it does not:
// - The route is the approval body the cost points to, with the reason. The cost is the headline of
//   Norn's cost check, which is an estimate (routeEcr's `basis` says so), so it places the change and
//   Norn acts on nothing here.
// - The class is returned only when the ECR was given one that routing used. A class that is only the
//   configuration's `whenUnsure` fallback is not a decision, so it is left to the agent's proposal.

import {
  costForecastFromCheck,
  routeEcr,
  validateConfig,
  type CompanyConfig,
  type CostCheckHeadline,
  type CostForecast,
  type Range,
  type Route,
} from '../../../config/src/index.ts';

export interface EcrRef {
  /** The ECR number as Norn holds it, e.g. ECR-0417. */
  number: string;
  title: string;
  /** The change-request revision the numbers are for. */
  revision: number;
  /**
   * The class on each axis (a config class id such as `I` or `minor`), when the ECR has one that routing
   * should use. No caller sets this yet: Norn's database holds the change request but not the class the
   * originator filed in the PLM. Until one does, routing returns no class.
   */
  classes?: { company?: string; regulatory?: string };
}

export interface AssessmentRef {
  /** The headline check results by key (`unit_cost_delta:vesper`, `one_time_total`, `net_total_year_one`). */
  numbers: Record<string, { p10: number; p50: number; p90: number; unit: string }>;
  /**
   * The cost check's headline with its rows, from `costCheckOf`. With it the spend and the saving can be told
   * apart, which a company whose cost measure does not let savings offset spend (Bowman's) needs to place the
   * change. Without it the headline `numbers` alone are used.
   */
  costCheck?: CostCheckHeadline;
}

export interface Routing {
  /** The change class, as the PLM spells it (`Class I` or `Class II`). */
  class?: string;
  /** The approval route, as text. */
  route?: string;
}

/** The longest route the PLM's field holds: `impact_approval_route` is a Frappe Data field, 140 characters. */
export const ROUTE_MAX = 140;

// ---------------------------------------------------------------- the configuration

/** The part of the client cache that holds the stored configuration. */
interface ConfigStore {
  nornConfig: { key: { find(key: string): { value: string } | null | undefined } };
}

const COMPANY_CONFIG_KEY = 'company_config';
let lastText: string | undefined;
let lastConfig: CompanyConfig | undefined;

/**
 * The company configuration the module holds (`norn_config`, key `company_config`), checked and ready for
 * routing, or undefined when none is stored or the stored one does not validate. Both processes subscribe
 * to norn_config, so they read the same stored text. A text that does not validate is logged once and
 * treated as no configuration, so Level 1 keeps working without routing.
 */
export function storedCompanyConfig(db: ConfigStore, warn: (m: string) => void = m => console.warn(m)): CompanyConfig | undefined {
  const text = db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value;
  if (text === undefined) return undefined;
  if (text === lastText) return lastConfig;
  lastText = text;
  lastConfig = undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    warn(`routing: norn_config ${COMPANY_CONFIG_KEY} is not JSON; routing is off`);
    return undefined;
  }
  const result = validateConfig(parsed);
  if (!result.ok) {
    warn(`routing: norn_config ${COMPANY_CONFIG_KEY} does not validate (${result.issues.length} problems, first: ${result.issues[0]!.path}: ${result.issues[0]!.message}); routing is off`);
    return undefined;
  }
  lastConfig = result.config;
  return lastConfig;
}

// ---------------------------------------------------------------- the cost

interface ResultRow {
  key: string;
  p10: number;
  p50: number;
  p90: number;
  detailJson: string;
}

const isRange = (x: unknown): x is Range => {
  const r = x as Range | null;
  return typeof r === 'object' && r !== null && [r.p10, r.p50, r.p90].every(Number.isFinite);
};
const range = (x: Range): Range => ({ p10: x.p10, p50: x.p50, p90: x.p90 });
const jsonOr = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * The cost check's headline and rows, rebuilt from the stored result rows of one s2_cost run (the rows
 * `costCheckRows` wrote). Undefined when the run lacks a headline row or the `detail` row, which holds the
 * window and the stock dispositions: nothing is filled in for what is missing.
 *
 * Each `line:` row stores its one-time Money, its unit cost Money and its quantity; the extended amount is
 * the unit cost times the quantity, which is how the check works it out (checks/src/cost.ts).
 */
export function costCheckOf(rows: readonly ResultRow[]): CostCheckHeadline | undefined {
  const byKey = (k: string) => rows.find(r => r.key === k);
  const oneTime = byKey('one_time_total');
  const recurring = byKey('recurring_year_one');
  const net = byKey('net_total_year_one');
  const detailRow = byKey('detail');
  if (!oneTime || !recurring || !net || !detailRow) return undefined;
  const detail = jsonOr(detailRow.detailJson);
  const months = (detail.window as { months?: unknown } | undefined)?.months;
  if (typeof months !== 'number' || !Number.isFinite(months)) return undefined;

  const blocks: NonNullable<CostCheckHeadline['blocks']> = {};
  for (const r of rows) {
    if (!r.key.startsWith('line:')) continue;
    const d = jsonOr(r.detailJson);
    if (typeof d.block !== 'string') return undefined;
    const unit = isRange(d.unitCost) ? d.unitCost : null;
    const q = typeof d.quantity === 'number' ? d.quantity : 0;
    const extended = unit ? (q >= 0 ? { p10: unit.p10 * q, p50: unit.p50 * q, p90: unit.p90 * q } : { p10: unit.p90 * q, p50: unit.p50 * q, p90: unit.p10 * q }) : null;
    (blocks[d.block] ??= []).push({ id: r.key.slice('line:'.length), oneTime: isRange(d.oneTime) ? range(d.oneTime) : null, extended });
  }
  const inventory = Array.isArray(detail.inventory)
    ? (detail.inventory as { rowId?: unknown; rows?: { cost?: unknown }[] }[]).map(l => ({
        rowId: String(l.rowId),
        rows: (l.rows ?? []).map(d => d.cost).filter(isRange).map(cost => ({ cost: range(cost) })),
      }))
    : [];
  return { window: { months }, headline: { oneTimeTotal: range(oneTime), recurringWindow: range(recurring), windowTotal: range(net) }, blocks, inventory };
}

/**
 * The cost facts for routing: the cost check's rows when the caller has them, else the three headline rows.
 * Undefined if neither is there, and routeEcr then reads the cost as unmeasured. The headline alone gives only
 * net totals. The key names say year one, which the cost check fixes at 12 months.
 */
export function costForecastOf(a: AssessmentRef): CostForecast | undefined {
  if (a.costCheck) return costForecastFromCheck(a.costCheck);
  const { one_time_total: oneTime, recurring_year_one: recurring, net_total_year_one: net } = a.numbers;
  if (!oneTime || !recurring || !net || ![oneTime, recurring, net].every(isRange)) return undefined;
  return { windowMonths: 12, oneTime: range(oneTime), recurringWindow: range(recurring), windowTotal: range(net) };
}

// ---------------------------------------------------------------- the route

const num = (config: CompanyConfig, n: number) => `${Math.round(n).toLocaleString('en-US')} ${config.company.currency}`;

/** The approval body in words, with the other bodies that review and the cost against the tier's limit. */
export function routeText(config: CompanyConfig, route: Route): string {
  const { tier, cost } = route;
  const tiers = config.approval.tiers;
  const lower = tier.tierIndex > 0 ? tiers[tier.tierIndex - 1]!.upTo : null;
  const alone = tier.bodyName;
  const also = tier.alsoReviewedBy.length ? `${alone}, with ${tier.alsoReviewedBy.map(b => b.name).join(' and ')} review` : alone;

  let reason: string;
  if (cost.size === null) reason = `cost not measured, so the top tier`;
  else {
    const size = `${cost.percentile} cost ${cost.basis === 'lower_bound' ? 'at least ' : cost.basis === 'estimated' ? 'about ' : ''}${num(config, cost.size)}`;
    const limit = lower !== null ? `above ${num(config, lower)}` : tier.upTo !== null ? `within ${num(config, tier.upTo)}` : '';
    reason = limit ? `${size}, ${limit}` : size;
  }
  // The field is short. If the long form does not fit, drop the other bodies, then the reason: the body is the route.
  return [`${also} (${reason})`, `${alone} (${reason})`, alone].find(t => t.length <= ROUTE_MAX) ?? alone;
}

/**
 * What Norn's routing says about this ECR, or nothing: with no company configuration it returns `{}`.
 * The same arguments always give the same answer.
 */
export function routeFor(ecr: EcrRef, assessment: AssessmentRef, config?: CompanyConfig): Routing {
  if (!config) return {};
  const route = routeEcr(config, { ecrId: ecr.number, cost: costForecastOf(assessment), classes: ecr.classes });
  const company = route.classes.company;
  return { ...(company.source === 'set' ? { class: company.label } : {}), route: routeText(config, route) };
}

/** What the agent writes as the route when routing has not decided one. */
export const ROUTE_PENDING = "Pending Norn's routing";
