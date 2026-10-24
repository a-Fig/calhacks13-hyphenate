// S2, cost (ARCHITECTURE.md §5), laid out like the ECP cost page (MIL-HDBK-61A App. B,
// docs/IN-PRACTICE.md §1 and §8): four blocks (production, retrofit, logistics support, other),
// each row split into one-time cost and unit cost times quantity, savings negative (shown in
// parentheses). Production recurring cost is the per-unit change from the BOM delta times the
// units the volume plan builds after the cut-in. Old stock's disposition is its own line.
//
// Every number is a range from one paired Monte Carlo run (base and head on the same draws) and
// carries a trace: the formula, and each input and assumption it used with its source.

import { applyOverlay, changedRows, type HeadState } from './bom.ts';
import { type Dist, isFixed, lognormal, lognormalFromQuantiles, pert, point, pointOf } from './dist.ts';
import {
  type Draws, type Expr, type Summary, type Variable, constant, drawAll, evaluate, evaluateAt, pairedDelta,
  quantileOfVariable, scale, sum, summarize, varsOf,
} from './sim.ts';
import {
  type AssumptionOverride, type Baseline, type ChangeRequest, type CostBlock, type CostPageRow, type Disposition,
  type Flag, type InputRecord, type ItemCode, type MonthStr, type Program, type ProgramId, type Source,
  type StockLocation, type StockRow, type Trace, type TraceUse, CHECKS_CODE_VERSION, COST_BLOCKS,
} from './types.ts';
import { addMonths, firstSerialFrom, lastBuiltSerial, monthOfSerial, serialsByMonth, unitsAfterCutIn } from './volume.ts';

// ---------------------------------------------------------------- defaults

export interface CostDefaults {
  /** Log-space spread around a stated cost, by who stated it (Joint Agency handbook Table 2-9). */
  spread: Record<'supplier_quote' | 'budgetary_quote' | 'engineer_estimate' | 'agent_estimated', number>;
  /** Forward price range for an item with no sourcing record, as multipliers on its price. */
  newItemPrice: { p10: number; p90: number };
  /** Share of a scrapped unit's value that is recovered: resale, reuse elsewhere, or metal value (#32). */
  scrapRecovery: { min: number; mode: number; max: number };
  /** Charge for cancelling units on order and not started, as a share of their price. */
  cancellation: { min: number; mode: number; max: number };
}

export const COST_DEFAULTS: CostDefaults = {
  spread: { supplier_quote: 0.05, budgetary_quote: 0.15, engineer_estimate: 0.15, agent_estimated: 0.25 },
  newItemPrice: { p10: 0.95, p90: 1.08 },
  scrapRecovery: { min: 0, mode: 0.0153, max: 0.05 },
  cancellation: { min: 0.05, mode: 0.1, max: 0.3 },
};

const DEFAULT_WHY: Record<string, string> = {
  'spread:supplier_quote': 'A firm supplier quote moves little: change orders only. Log-space spread 0.05 (Norn default).',
  'spread:budgetary_quote': 'A budgetary quote ("plus or minus 20%"): log-space spread 0.15, so p10 and p90 sit about 18% either side (Norn default).',
  'spread:engineer_estimate': 'An engineer\'s estimate: log-space spread 0.15, "low" in Joint Agency handbook Table 2-9 (docs/IN-PRACTICE.md §5).',
  'spread:agent_estimated': 'An agent\'s estimate: log-space spread 0.25, wider than a person\'s (docs/IN-PRACTICE.md §8, recommendation 6).',
  newItemPrice: 'An item with no sourcing record: forward price p10 0.95 and p90 1.08 times its quoted price (Norn default).',
  scrapRecovery:
    'Share of a scrapped unit\'s value recovered. Default PERT(0, 1.53%, 5%): metal value only, as in the worked example ' +
    '($718 salvage on 252 brackets of $186.40, docs/IN-PRACTICE.md §1). An agent\'s estimate of resale or reuse replaces it (#32).',
  cancellation: 'Charge for cancelling units on order, as a share of price, when no quote states it. Default PERT(5%, 10%, 30%).',
};

/** A blank production row with one of these words is the scrap line, filled by the inventory disposition. */
const SCRAP_ROW = /scrap|write[- ]?off|disposition|obsolete/i;

// ---------------------------------------------------------------- results

export interface Money {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  /** Every input at its stated value: the point estimate. */
  point: number;
  trace: Trace;
}

export type RowBasis = 'supplier_quote' | 'engineer_estimate' | 'computed' | Source;

export interface CostRow {
  id: string;
  block: CostBlock;
  label: string;
  /** Production cost per unit built after the cut-in. Everything else is one-time in nature. */
  recurring: boolean;
  basis: RowBasis;
  /** The cost page's non-recurring column. */
  oneTime: Money | null;
  /** Unit cost and quantity: per unit built for a recurring row, per kit or unit otherwise. */
  unitCost: Money | null;
  quantity: number | null;
  extended: Money | null;
  total: Money;
  needsEstimate?: boolean;
  ref?: string;
  note?: string;
}

export interface DispositionRow {
  location: StockLocation;
  disposition: Disposition;
  qty: number;
  unitValue: number;
  cost: Money;
  note?: string;
}

export interface InventoryLine {
  item: ItemCode;
  rowId: string;
  rows: DispositionRow[];
  total: Money;
  /** Units on hand that the proposal does not mention, by location. */
  unlisted: { location: StockLocation; qty: number }[];
  /** The decision's own swing: scrap everything versus use everything up. */
  alternatives: { scrapAll: Money; useUpAll: number };
}

export interface EffectivityResult {
  id: string;
  program: ProgramId;
  basis: 'serial' | 'date' | 'use_up' | 'lead_time' | 'first_unbuilt' | 'override';
  cutInSerial: number;
  cutInMonth: MonthStr | null;
  source: Source;
  rationale: string;
}

export interface BlockTotal {
  oneTime: Money;
  extended: Money;
  total: Money;
}

export interface Driver {
  id: string;
  label: string;
  kind: 'input' | 'decision';
  /** The window total with this input at its p10 and p90 (a decision: each alternative), others at their stated value. */
  low: number;
  high: number;
  swing: number;
}

export interface CostCheckResult {
  check: 's2_cost';
  codeVersion: string;
  ecr: string;
  program: ProgramId;
  currency: 'USD';
  seed: string;
  draws: number;
  correlation: number;
  /** The year-one window: months from the cut-in on the ECR's program. */
  window: { from: MonthStr | null; months: number };
  effectivity: EffectivityResult[];
  blocks: Record<CostBlock, CostRow[]>;
  blockTotals: Record<CostBlock, BlockTotal>;
  inventory: InventoryLine[];
  headline: {
    unitCostDelta: { program: ProgramId; perUnit: Money }[];
    oneTimeTotal: Money;
    recurringWindow: Money;
    windowTotal: Money;
    recurringPlan: Money;
    planTotal: Money;
  };
  unitCost: { program: ProgramId; base: Money; head: Money; delta: Money }[];
  piecePrices: { item: ItemCode; base: Money | null; head: Money | null }[];
  periods: { period: string; program: ProgramId; units: number; recurring: Money }[];
  drivers: Driver[];
  convergence: {
    seeds: [string, string];
    tolerance: number;
    converged: boolean;
    metrics: { key: string; p80: [number, number]; p90: [number, number]; relDiff: number }[];
  };
  bomDelta: { ok: boolean; conflicts: number };
  flags: Flag[];
  inputs: InputRecord[];
}

export interface CostCheckOptions {
  /** The run's seed. Use the deployment's configured seed, never a hash of the head's inputs (README). */
  seed: string;
  draws?: number;
  /** Length of the year-one window, in months from the cut-in. */
  windowMonths?: number;
  correlation?: number;
  convergenceTolerance?: number;
  /** Assumptions recorded on the ECR or the baseline, replacing defaults by id. */
  assumptions?: AssumptionOverride[];
  defaults?: Partial<CostDefaults>;
}

// ---------------------------------------------------------------- helpers

const r2 = (x: number) => Math.round(x * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const FIELD: Record<StockLocation, keyof StockRow> = {
  stores: 'stores', wip: 'wip', finished_goods: 'finishedGoods', supplier_finished: 'supplierFinished', on_order: 'onOrder', in_field: 'inField',
};
const LOCATIONS = Object.keys(FIELD) as StockLocation[];
/** 'NC programming (Halden)' -> 'nc-programming-halden'. Whole words, at most 48 characters. */
export function slug(label: string): string {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 48) break;
    out = next;
  }
  return out || (words[0] ?? 'row').slice(0, 48);
}
const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

interface Pending {
  key: string;
  expr: Expr;
  formula: string;
  uses: string[];
}

interface RowDraft {
  id: string;
  block: CostBlock;
  label: string;
  recurring: boolean;
  basis: RowBasis;
  oneTime: Expr | null;
  unit: Expr | null;
  quantity: number | null;
  formula: string;
  uses: string[];
  needsEstimate?: boolean;
  ref?: string;
  note?: string;
}

/** Run S2 on one ECR. Pure and deterministic in (baseline, ecr, options). */
export function costCheck(baseline: Baseline, ecr: ChangeRequest, options: CostCheckOptions): CostCheckResult {
  const n = options.draws ?? 10_000;
  const windowMonths = options.windowMonths ?? 12;
  const rho = options.correlation ?? 0.3;
  const tol = options.convergenceTolerance ?? 0.01;
  const D: CostDefaults = { ...COST_DEFAULTS, ...options.defaults, spread: { ...COST_DEFAULTS.spread, ...options.defaults?.spread } };
  if (!options.seed) throw new Error('costCheck needs a seed: the deployment\'s configured seed (see README)');

  const s: HeadState = applyOverlay(baseline, ecr);
  const reg = new Map<string, InputRecord>();
  const vars = new Map<string, Variable>();
  const overrides = new Map((options.assumptions ?? []).map((a) => [a.id, a]));
  const flags: Flag[] = [];
  const pending = new Map<string, Pending>();
  const usedOverrides = new Set<string>();
  /** Ids with a known reason an assumption can't apply there, for the unused-assumption flag. */
  const noVariable = new Map<string, string>();

  const input = (rec: InputRecord): string => {
    if (!reg.has(rec.id)) reg.set(rec.id, rec);
    return rec.id;
  };
  const defaultInput = (key: keyof typeof DEFAULT_WHY | string, label: string, value: number | string) =>
    input({ id: `default:${key}`, label, source: 'default', value, rationale: DEFAULT_WHY[key] });

  /**
   * An uncertain input. An assumption with the same id replaces its distribution and source: always
   * for a default, and for a number someone stated (a quote, an estimate) only with `replacesGiven`.
   */
  const variable = (v: { id: string; label: string; dist: Dist; groups?: string[]; source: Source; ref?: string; rationale?: string; needsEstimate?: boolean }): string => {
    if (vars.has(v.id)) return v.id;
    let ov = overrides.get(v.id);
    if (ov?.dist && v.source === 'given' && !ov.replacesGiven) {
      usedOverrides.add(v.id);
      flags.push({ kind: 'assumption_not_applied', severity: 'warn', ref: v.id, message: `An assumption for ${v.id} would replace a stated number ("${v.label}"). Recorded but not applied: set replacesGiven to replace it.` });
      ov = undefined;
    }
    if (ov && !ov.dist) ov = undefined; // reported as unused at the end: a distribution is needed here
    if (ov) usedOverrides.add(v.id);
    const dist = ov?.dist ?? v.dist;
    const rec: InputRecord = {
      id: v.id, label: v.label, source: ov?.dist ? ov.source : v.source, value: r2(pointOf(dist)), dist, groups: v.groups ?? [],
      ...(v.ref ? { ref: v.ref } : {}),
      rationale: ov?.dist ? `${ov.rationale}${ov.by ? ` (${ov.by})` : ''}` : v.rationale,
      ...(v.needsEstimate && !ov?.dist ? { needsEstimate: true } : {}),
    };
    reg.set(v.id, rec);
    vars.set(v.id, { id: v.id, dist, groups: v.groups ?? [] });
    return v.id;
  };

  const track = (key: string, expr: Expr, formula: string, uses: string[] = []) => {
    pending.set(key, { key, expr, formula, uses });
    return key;
  };

  // ---------------------------------------------------------------- the baseline facts used
  input({ id: 'baseline:items', label: 'Items, revisions and standard costs', source: 'given', ref: 'ERP and PLM item master' });
  input({ id: 'baseline:bom', label: 'Bills of materials', source: 'given', ref: 'PLM engineering BOM' });
  input({ id: `ecr:${ecr.id}:overlay`, label: `${ecr.id} item and BOM changes`, source: 'given', ref: `${ecr.id} itemChanges, bomChanges` });
  const rate = new Map(baseline.workCenters.map((w) => [w.id, w.laborRatePerHour]));
  const sourcingOf = (code: ItemCode) => baseline.sourcing.find((x) => x.item === code && x.primary) ?? baseline.sourcing.find((x) => x.item === code);
  const itemCodes = new Set([...s.base.keys(), ...s.head.keys()]);

  const priceVar = (code: ItemCode): string => {
    const id = `price:${code}`;
    if (vars.has(id)) return id;
    const src = sourcingOf(code);
    const supplier = src?.supplier ?? s.head.get(code)?.supplier ?? s.base.get(code)?.supplier;
    const groups = supplier ? [`supplier:${supplier}`] : [];
    const okRange = (p: { p10: number; p50: number; p90: number }) => [p.p10, p.p50, p.p90].every(Number.isFinite) && p.p10 > 0 && p.p10 <= p.p50 && p.p50 <= p.p90;
    if (src && !okRange(src.unitPrice)) {
      flags.push({ kind: 'bad_sourcing', severity: 'warn', ref: code, message: `${code}: the sourcing price range (p10 ${src.unitPrice.p10}, p50 ${src.unitPrice.p50}, p90 ${src.unitPrice.p90}) is not positive and in order, so the default range is used.` });
    }
    if (src && okRange(src.unitPrice)) {
      const p = src.unitPrice;
      return variable({
        id, label: `${code} price index (next 12 months)`, groups, source: 'given',
        dist: lognormalFromQuantiles(p.p10 / p.p50, 1, p.p90 / p.p50),
        ref: `sourcing ${code} ${src.supplier}: p10 ${p.p10}, p50 ${p.p50}, p90 ${p.p90}`,
        rationale: 'The supplier price range for the next 12 months, as a multiplier on the unit price. Lognormal through the stated p10, p50 and p90.',
      });
    }
    const k = defaultInput('newItemPrice', 'Price range for an item with no sourcing record', `${D.newItemPrice.p10} to ${D.newItemPrice.p90}`);
    return variable({
      id, label: `${code} price index (no sourcing record)`, groups, source: 'default',
      dist: lognormalFromQuantiles(D.newItemPrice.p10, 1, D.newItemPrice.p90), ref: k, rationale: DEFAULT_WHY.newItemPrice,
    });
  };

  // A budgetary quote's price can move on its own, beyond the market: its head price gets a second multiplier.
  const budgetary = (q: ChangeRequest['supplierQuotes'][number]) =>
    q.firmness ? q.firmness === 'budgetary' : /budgetary|indicative|plus or minus|±/i.test(q.note ?? '');
  const budgetaryItems = new Map<ItemCode, string>(); // item -> quote id, filled from the price evidence below
  const quoteVar = (code: ItemCode): string => {
    const k = defaultInput('spread:budgetary_quote', 'Spread of a budgetary supplier quote', D.spread.budgetary_quote);
    return variable({ id: `quote:${code}`, label: `${code}: budgetary quote moves`, dist: lognormal(1, D.spread.budgetary_quote), groups: [], source: 'default', ref: k, rationale: `The new price comes from budgetary quote ${budgetaryItems.get(code)}. ${DEFAULT_WHY['spread:budgetary_quote']}` });
  };
  /** The inputs that scale an item's price at head. */
  const headVars = (code: ItemCode): string[] => (budgetaryItems.has(code) ? [priceVar(code), quoteVar(code)] : [priceVar(code)]);

  // ---------------------------------------------------------------- unit cost at base and head, per program
  const unitCostExpr = (program: ProgramId, side: 'base' | 'head'): Expr => {
    const q = (side === 'base' ? s.explodedBase : s.explodedHead).get(program) ?? new Map<ItemCode, number>();
    const items = side === 'base' ? s.base : s.head;
    const e: Expr = [];
    for (const [code, qty] of q) {
      const it = items.get(code);
      if (!it) continue;
      if (it.makeBuy === 'buy') e.push({ coef: qty * (it.unitPrice ?? 0), vars: side === 'head' ? headVars(code) : [priceVar(code)] });
      else {
        const labor = qty * (it.laborHours ?? 0) * (rate.get(it.workCenter ?? '') ?? 0);
        if (labor) e.push({ coef: labor, vars: [] });
      }
    }
    return e;
  };
  const deltaExpr = (program: ProgramId): Expr => {
    const e: Expr = [];
    for (const r of changedRows(s, program)) {
      if (r.makeBuy === 'buy') {
        const h = r.qtyHead * (r.priceHead ?? 0);
        const b = r.qtyBase * (r.priceBase ?? 0);
        if (budgetaryItems.has(r.item)) {
          if (h !== 0) e.push({ coef: h, vars: headVars(r.item) });
          if (b !== 0) e.push({ coef: -b, vars: [priceVar(r.item)] });
        } else if (h - b !== 0) e.push({ coef: h - b, vars: [priceVar(r.item)] });
      } else {
        const wc = s.head.get(r.item)?.workCenter ?? s.base.get(r.item)?.workCenter ?? '';
        const c = (r.qtyHead * (r.hoursHead ?? 0) - r.qtyBase * (r.hoursBase ?? 0)) * (rate.get(wc) ?? 0);
        if (c !== 0) e.push({ coef: c, vars: [] });
      }
    }
    return e;
  };

  const programs: Program[] = baseline.programs
    .filter((p) => changedRows(s, p.id).length > 0)
    .sort((a, b) => (a.id === ecr.program ? -1 : b.id === ecr.program ? 1 : 0));
  if (!programs.some((p) => p.id === ecr.program)) {
    const own = baseline.programs.find((p) => p.id === ecr.program);
    if (own) programs.unshift(own);
  }

  // ---------------------------------------------------------------- quotes as evidence
  const knownCodes = [...itemCodes].sort((a, b) => b.length - a.length); // longest first, so no code matches inside another
  /** Which item a quote line prices: the item code it names, else the quote's own item. */
  const lineItem = (q: ChangeRequest['supplierQuotes'][number], description: string) => knownCodes.find((c) => description.includes(c)) ?? q.item;
  const quoteLineId = (qid: string, li: number) => `quote:${qid}#${li}`;
  ecr.supplierQuotes.forEach((q) =>
    q.lines.forEach((l, li) =>
      input({
        id: quoteLineId(q.id, li), label: `${q.id}: ${l.description}`, source: 'given',
        value: l.oneTime ?? l.unitPrice ?? '', ref: `supplier quote ${q.id} (${q.supplier}) line ${li + 1}${l.qty ? `, qty ${l.qty}` : ''}`,
      }),
    ),
  );
  const priceEvidence = new Map<ItemCode, string[]>();
  for (const p of programs) {
    for (const r of changedRows(s, p.id)) {
      if (r.makeBuy !== 'buy' || r.priceHead === null || priceEvidence.has(r.item)) continue;
      const priced = r.priceBase === null || !near(r.priceBase, r.priceHead) || r.qtyBase === 0;
      if (!priced) continue;
      const ev: string[] = [];
      let covered = false;
      for (const q of ecr.supplierQuotes) {
        q.lines.forEach((l, li) => {
          if (lineItem(q, l.description) !== r.item) return;
          covered = true;
          if (l.unitPrice !== undefined && l.oneTime === undefined && near(l.unitPrice, r.priceHead!)) {
            ev.push(quoteLineId(q.id, li));
            if (budgetary(q)) budgetaryItems.set(r.item, q.id);
          }
        });
      }
      priceEvidence.set(r.item, ev);
      if (budgetaryItems.has(r.item)) {
        flags.push({ kind: 'budgetary_quote', severity: 'info', ref: r.item, message: `${r.item}: the new price is from budgetary quote ${budgetaryItems.get(r.item)}, so it carries an extra spread of ${D.spread.budgetary_quote}.` });
      }
      if (!covered) {
        flags.push({ kind: 'no_quote', severity: 'warn', message: `${r.item}: the unit cost changes (${r.priceBase ?? 'new'} to ${r.priceHead}) but no supplier quote covers it. A piece-cost change needs a firm quote (docs/IN-PRACTICE.md §8, recommendation 3).`, ref: r.item });
      } else if (ev.length === 0) {
        flags.push({ kind: 'quote_mismatch', severity: 'warn', message: `${r.item}: no quote line states the new unit price of ${r.priceHead}.`, ref: r.item });
      }
    }
  }

  // ---------------------------------------------------------------- effectivity per program
  const stockOf = new Map(baseline.stock.map((x) => [x.item, x]));
  const effectivity = new Map<ProgramId, EffectivityResult>();
  const serials = new Map(programs.map((p) => [p.id, serialsByMonth(baseline.volumePlan, baseline.builtAircraft, p.id)]));
  for (const p of programs) {
    const sm = serials.get(p.id)!;
    const id = `effectivity:${ecr.id}:${p.id}`;
    const firstUnbuilt = lastBuiltSerial(baseline.builtAircraft, p.id) + 1;
    const beyond = (sm.at(-1)?.last ?? firstUnbuilt - 1) + 1;
    const ov = overrides.get(id);
    let e: Omit<EffectivityResult, 'cutInMonth'>;
    if (ov?.value !== undefined) {
      usedOverrides.add(id);
      const serial = typeof ov.value === 'number' ? ov.value : (firstSerialFrom(sm, String(ov.value).slice(0, 7)) ?? beyond);
      e = { id, program: p.id, basis: 'override', cutInSerial: serial, source: ov.source, rationale: ov.rationale };
    } else if (p.id === ecr.program) {
      const ep = ecr.effectivity.production;
      if (ep.basis === 'serial' && Number.isFinite(Number(ep.from))) {
        e = { id, program: p.id, basis: 'serial', cutInSerial: Number(ep.from), source: 'given', rationale: `Stated on the ECR: S/N ${Number(ep.from)} and subsequent.` };
      } else if (ep.basis === 'date' && /^\d{4}-\d{2}/.test(ep.from)) {
        const month = ep.from.slice(0, 7);
        e = { id, program: p.id, basis: 'date', cutInSerial: firstSerialFrom(sm, month) ?? beyond, source: 'given', rationale: `Stated on the ECR: from ${ep.from}.` };
      } else {
        // Lot or to-be-decided: a default until the timeline check (S3) sets it.
        const useUp = ecr.inventoryProposal.filter((x) => x.disposition === 'use_until_depleted');
        let best: { serial: number; why: string } | undefined;
        for (const u of useUp) {
          const qty = s.explodedBase.get(p.id)?.get(u.item) ?? 0;
          const st = stockOf.get(u.item);
          if (!qty || !st) continue;
          const gone = new Set(ecr.inventoryProposal.filter((x) => x.item === u.item && (x.disposition === 'scrap' || x.disposition === 'cancel')).map((x) => x.location));
          const onHand = LOCATIONS.filter((l) => l !== 'in_field' && !gone.has(l)).reduce((a, l) => a + (st[FIELD[l]] as number), 0);
          const covered = Math.floor(onHand / qty);
          const serial = firstUnbuilt + covered;
          if (!best || serial > best.serial) best = { serial, why: `Use up ${onHand} ${u.item} on hand and on order at ${qty} per unit: ${covered} units, so the change starts at S/N ${serial}.` };
        }
        if (best) {
          e = { id, program: p.id, basis: 'use_up', cutInSerial: best.serial, source: 'default', rationale: `${best.why} Default until the timeline check sets the cut-in.` };
        } else {
          const weeks = Math.max(0, ...ecr.supplierQuotes.map((q) => q.leadTimeWeeks ?? 0));
          const month = addDays(ecr.filedOn, Math.round(weeks * 7)).slice(0, 7);
          e = { id, program: p.id, basis: 'lead_time', cutInSerial: firstSerialFrom(sm, month) ?? beyond, source: 'default', rationale: `Filed ${ecr.filedOn} plus the longest quoted lead time (${weeks} weeks): ${month}. Default until the timeline check sets the cut-in.` };
        }
      }
    } else {
      e = { id, program: p.id, basis: 'first_unbuilt', cutInSerial: firstUnbuilt, source: 'default', rationale: `${p.name} is not the ECR's program; every unit not yet built (S/N ${firstUnbuilt} on) takes the change.` };
    }
    const res: EffectivityResult = { ...e, cutInMonth: monthOfSerial(sm, e.cutInSerial) ?? null };
    effectivity.set(p.id, res);
    input({ id, label: `Cut-in on ${p.name}`, source: res.source, value: res.cutInSerial, rationale: res.rationale, ...(res.basis === 'serial' || res.basis === 'date' ? { ref: `${ecr.id} effectivity.production` } : {}) });
    input({ id: `volume:${p.id}`, label: `${p.name} volume plan`, source: 'given', ref: 'volume plan and built units' });
    if (res.source === 'default') flags.push({ kind: 'effectivity_default', severity: 'info', message: `${p.name} cut-in S/N ${res.cutInSerial}: ${res.rationale}`, ref: id });
  }

  const own = effectivity.get(ecr.program);
  const windowFrom = own?.cutInMonth ?? null;
  if (own && !own.cutInMonth) {
    flags.push({ kind: 'cut_in_beyond_plan', severity: 'warn', ref: own.id, message: `The cut-in (S/N ${own.cutInSerial}) is beyond the volume plan, so no recurring cost falls in the year-one window.` });
  }
  const counts = new Map(
    programs.map((p) => [p.id, unitsAfterCutIn(serials.get(p.id)!, { serial: effectivity.get(p.id)!.cutInSerial }, windowFrom ? { from: windowFrom, months: windowMonths } : undefined)]),
  );

  // ---------------------------------------------------------------- the rows
  const rows: RowDraft[] = [];
  const spreadId = (basis: 'supplier_quote' | 'budgetary_quote' | 'engineer_estimate') =>
    defaultInput(`spread:${basis}`, `Spread of a cost stated by ${basis === 'engineer_estimate' ? 'an engineer' : basis === 'budgetary_quote' ? 'a budgetary supplier quote' : 'a supplier quote'}`, D.spread[basis]);

  // Production recurring: one row per affected program.
  for (const p of programs) {
    const unit = deltaExpr(p.id);
    const c = counts.get(p.id)!;
    const eff = effectivity.get(p.id)!;
    const ev = changedRows(s, p.id).flatMap((r) => priceEvidence.get(r.item) ?? []);
    rows.push({
      id: `recurring:${p.id}`, block: 'production', recurring: true, basis: 'computed',
      label: `Unit cost change, ${p.name}, per unit built from S/N ${eff.cutInSerial}`,
      oneTime: null, unit, quantity: c.inWindow,
      formula: 'per unit: Σ items (qty per unit × unit price at head − qty per unit × unit price at base) × price index; × units built after the cut-in in the year-one window',
      uses: ['baseline:items', 'baseline:bom', `ecr:${ecr.id}:overlay`, ...ev, eff.id, `volume:${p.id}`],
    });
  }

  // The originator's cost page.
  let engineerRecurring = 0;
  const engineerRecurringRefs: string[] = [];
  const blankScrapRows: string[] = [];
  const affectedBuyHeadPrice = new Map<ItemCode, number>();
  for (const p of programs) for (const r of changedRows(s, p.id)) if (r.makeBuy === 'buy' && r.priceHead !== null) affectedBuyHeadPrice.set(r.item, r.priceHead);
  const quoteSupplier = [...new Set(ecr.supplierQuotes.map((q) => q.supplier))];

  for (const block of COST_BLOCKS) {
    const taken = new Set<string>();
    ecr.costPage[block].forEach((row: CostPageRow, i: number) => {
      // Ids survive rows being added or reordered: the PLM's row id, else a slug of the label.
      const stem = row.id ?? slug(row.label);
      let key = stem;
      for (let k = 2; taken.has(key); k++) key = `${stem}-${k}`;
      taken.add(key);
      const ref = `${ecr.id} costPage.${block}[${i}]`;
      const id = `cost:${ecr.id}:${block}:${key}`;
      const rowInput = `row:${ecr.id}:${block}:${key}`;
      input({ id: rowInput, label: row.label, source: 'given', ref, value: row.basis, ...(row.note ? { rationale: row.note } : {}) });
      if (row.basis === 'not_provided') {
        if (block === 'production' && SCRAP_ROW.test(row.label)) {
          blankScrapRows.push(row.label);
          noVariable.set(id, `"${row.label}" is filled by the inventory disposition line; record a recovery share (recovery:<item>) instead`);
          return;
        }
        const v = variable({
          id, label: row.label, dist: point(0), source: 'default', ref, needsEstimate: true,
          rationale: `Left blank on the cost page${row.note ? ` (${row.note})` : ''}. Counted as $0 until an agent or a person estimates it.`,
        });
        const rec = reg.get(v)!;
        if (rec.needsEstimate) flags.push({ kind: 'needs_estimate', severity: 'warn', message: `"${row.label}" was left blank and is counted as $0 until estimated.`, ref: id });
        rows.push({
          id, block, label: row.label, recurring: false, basis: rec.source, oneTime: [{ coef: 1, vars: [v] }], unit: null, quantity: null,
          formula: rec.needsEstimate ? 'blank on the cost page: $0, to be estimated' : 'estimate recorded for a blank cost-page row',
          uses: [rowInput, v], needsEstimate: rec.needsEstimate, ref, note: row.note,
        });
        return;
      }
      if (block === 'production' && row.unitCost !== undefined) {
        // The originator's per-unit figure. Norn computes it from the BOM delta; this is the cross-check.
        engineerRecurring += row.unitCost * (row.quantity ?? 1);
        engineerRecurringRefs.push(ref);
        if (!row.oneTime) return;
      }
      const basis = row.basis;
      let spreadKey: 'supplier_quote' | 'budgetary_quote' | 'engineer_estimate' = basis;
      const quoteRefs: string[] = [];
      let supplier: string | undefined;
      if (basis === 'supplier_quote') {
        for (const q of ecr.supplierQuotes) {
          q.lines.forEach((l, li) => {
            const hit = (row.oneTime !== undefined && l.oneTime !== undefined && near(l.oneTime, row.oneTime)) || (row.unitCost !== undefined && l.unitPrice !== undefined && near(l.unitPrice, row.unitCost));
            if (hit) {
              quoteRefs.push(quoteLineId(q.id, li));
              supplier ??= q.supplier;
            }
          });
        }
        if (quoteRefs.length === 0 && row.oneTime !== undefined) {
          // One cost-page row can sum several one-time lines of one quote (a mould set plus its forging tooling).
          for (const q of ecr.supplierQuotes) {
            const lines = q.lines.map((l, li) => [l, li] as const).filter(([l]) => l.oneTime !== undefined);
            if (lines.length > 1 && near(lines.reduce((a, [l]) => a + l.oneTime!, 0), row.oneTime)) {
              quoteRefs.push(...lines.map(([, li]) => quoteLineId(q.id, li)));
              supplier ??= q.supplier;
            }
          }
        }
        supplier ??= quoteSupplier.length === 1 ? quoteSupplier[0] : undefined;
        const fromBudgetary = ecr.supplierQuotes.some((q) => budgetary(q) && quoteRefs.some((x) => x.startsWith(`quote:${q.id}#`)));
        if (fromBudgetary) {
          spreadKey = 'budgetary_quote';
          flags.push({ kind: 'budgetary_quote', severity: 'info', ref, message: `"${row.label}" is from a budgetary quote, so it carries a spread of ${D.spread.budgetary_quote} rather than ${D.spread.supplier_quote}.` });
        }
        if (quoteRefs.length === 0) flags.push({ kind: 'quote_unmatched', severity: 'info', message: `"${row.label}" is marked as a supplier quote, but no quote line on the ECR states ${row.oneTime ?? row.unitCost}.`, ref });
      }
      const groups = basis === 'supplier_quote' ? (supplier ? [`supplier:${supplier}`] : []) : ['labor:internal'];
      const why = basis === 'supplier_quote' ? 'Stated on the cost page from a supplier quote.' : 'Stated on the cost page as an engineer\'s estimate.';
      let oneTime: Expr | null = null;
      let unit: Expr | null = null;
      const spread = spreadId(spreadKey);
      const sigma = D.spread[spreadKey];
      const uses = [rowInput, spread, ...quoteRefs];
      if (row.oneTime !== undefined) {
        const v = variable({ id, label: row.label, dist: lognormal(row.oneTime, sigma), groups, source: 'given', ref, rationale: `${why} Lognormal around it, spread ${sigma}.` });
        oneTime = [{ coef: 1, vars: [v] }];
        uses.push(v);
      }
      if (row.unitCost !== undefined && block !== 'production') {
        const linked = basis === 'supplier_quote' ? [...affectedBuyHeadPrice].find(([, price]) => near(price, row.unitCost!))?.[0] : undefined;
        if (linked) {
          // A kit of the changed part costs what the part costs: it moves with the part's price index.
          unit = [{ coef: row.unitCost, vars: headVars(linked) }];
          uses.push(...headVars(linked));
        } else {
          const v = variable({ id: `${id}:unit`, label: `${row.label} (unit cost)`, dist: lognormal(row.unitCost, sigma), groups, source: 'given', ref, rationale: `${why} Lognormal around it, spread ${sigma}.` });
          unit = [{ coef: 1, vars: [v] }];
          uses.push(v);
        }
      }
      rows.push({
        id, block, label: row.label, recurring: false, basis, oneTime, unit, quantity: unit ? (row.quantity ?? 1) : null,
        formula: unit ? 'unit cost × quantity, each at its stated value with an estimate spread' : 'stated one-time cost with an estimate spread',
        uses, ref, note: row.note,
      });
    });
  }

  // Cross-checks of the originator's figures.
  if (engineerRecurringRefs.length && own) {
    const computed = evaluateAt(deltaExpr(ecr.program), () => 1);
    const ok = Math.abs(computed - engineerRecurring) <= Math.max(0.01, 0.005 * Math.abs(computed));
    flags.push({
      kind: 'cross_check', severity: ok ? 'info' : 'warn', ref: engineerRecurringRefs.join(', '),
      message: ok
        ? `The cost page's per-unit change (${r2(engineerRecurring)}) matches the BOM delta (${r2(computed)}).`
        : `The cost page says ${r2(engineerRecurring)} per unit; the BOM delta gives ${r2(computed)}. Norn uses the BOM delta.`,
    });
  }
  const retro = ecr.effectivity.retrofit;
  if (retro?.basis === 'serial' && retro.to !== undefined) {
    const units = Number(retro.to) - Number(retro.from) + 1;
    for (const r of rows.filter((x) => x.block === 'retrofit' && x.unit && x.basis === 'supplier_quote')) {
      const linked = varsOf(r.unit!).find((v) => v.startsWith('price:'))?.slice('price:'.length);
      if (!linked) continue;
      const perUnit = s.explodedBase.get(ecr.program)?.get(linked) ?? 0;
      const expect = units * perUnit;
      if (expect && r.quantity !== expect) flags.push({ kind: 'cross_check', severity: 'warn', ref: r.ref, message: `"${r.label}": ${r.quantity} on the cost page, but S/N ${retro.from}-${retro.to} at ${perUnit} per unit is ${expect}.` });
      else if (expect) flags.push({ kind: 'cross_check', severity: 'info', ref: r.ref, message: `"${r.label}": ${expect} = ${units} built units × ${perUnit} per unit, as the cost page says.` });
    }
  }

  // Early-lot prices above the steady-state price, from the quote.
  for (const q of ecr.supplierQuotes) {
    q.lines.forEach((l, li) => {
      const code = lineItem(q, l.description);
      const steady = s.head.get(code)?.unitPrice;
      if (steady === undefined || l.unitPrice === undefined || !l.qty || l.oneTime !== undefined) return;
      if (l.unitPrice <= steady + 0.005) return;
      const premium = (l.unitPrice - steady) * l.qty;
      const listed = COST_BLOCKS.flatMap((b) => ecr.costPage[b]).find((x) => x.oneTime !== undefined && near(x.oneTime, premium));
      if (listed) {
        flags.push({ kind: 'read_from_quote', severity: 'info', ref: `supplier quote ${q.id} line ${li + 1}`, message: `The first-lot premium on quote ${q.id} (${r2(premium)}) is already on the cost page as "${listed.label}", so it is not added again.` });
        return;
      }
      rows.push({
        id: `premium:${q.id}#${li}`, block: 'production', recurring: false, basis: 'supplier_quote',
        label: 'First-lot price premium (booked as PPV)',
        oneTime: constant(premium), unit: null, quantity: null,
        formula: '(first-lot unit price − steady-state unit price) × lot quantity, both from the quote',
        uses: [quoteLineId(q.id, li), `ecr:${ecr.id}:overlay`],
        ref: `supplier quote ${q.id} line ${li + 1}`,
        note: `${code}: ${l.qty} at ${l.unitPrice} against the new standard of ${steady}. Cash this change causes; the books show it as a purchase price variance against the new standard.`,
      });
      flags.push({
        kind: 'read_from_quote', severity: 'info', ref: `premium:${q.id}#${li}`,
        message: `Quote ${q.id} line ${li + 1} ("${l.description}") is read as a first-lot premium: (${l.unitPrice} − ${steady}) × ${l.qty} = ${r2(premium)}. If those units are extra hardware rather than production parts, the cost is ${r2(l.unitPrice * l.qty)}.`,
      });
    });
  }

  // Inventory disposition of the old stock, one line per item.
  const inventory: { item: ItemCode; rowId: string; parts: { location: StockLocation; disposition: Disposition; qty: number; unitValue: number; expr: Expr; note?: string }[]; unlisted: { location: StockLocation; qty: number }[]; scrapAll: Expr }[] = [];
  const recoveryVar = (code: ItemCode) => {
    const k = defaultInput('scrapRecovery', 'Share of scrapped value recovered', `PERT(${D.scrapRecovery.min}, ${D.scrapRecovery.mode}, ${D.scrapRecovery.max})`);
    return variable({ id: `recovery:${code}`, label: `${code}: share of scrapped value recovered`, dist: pert(D.scrapRecovery.min, D.scrapRecovery.mode, D.scrapRecovery.max), groups: [], source: 'default', ref: k, rationale: DEFAULT_WHY.scrapRecovery });
  };
  const cancelVar = (code: ItemCode, onOrder: number, price: number) => {
    const id = `cancel:${code}`;
    if (vars.has(id)) return id;
    for (const q of ecr.supplierQuotes) {
      const li = q.lines.findIndex((l) => lineItem(q, l.description) === code && l.qty === onOrder && l.unitPrice !== undefined && l.unitPrice < price && l.oneTime === undefined);
      if (li >= 0) {
        const charge = q.lines[li].unitPrice!;
        return variable({ id, label: `${code}: cancellation charge, share of price`, dist: point(charge / price), source: 'given', ref: `supplier quote ${q.id} line ${li + 1}`, rationale: `The supplier quotes ${charge} per unit for the ${onOrder} on order: ${r2((100 * charge) / price)}% of ${price}.` });
      }
    }
    const k = defaultInput('cancellation', 'Cancellation charge, share of price', `PERT(${D.cancellation.min}, ${D.cancellation.mode}, ${D.cancellation.max})`);
    return variable({ id, label: `${code}: cancellation charge, share of price`, dist: pert(D.cancellation.min, D.cancellation.mode, D.cancellation.max), source: 'default', ref: k, rationale: DEFAULT_WHY.cancellation });
  };
  const disposed = [...new Set(ecr.inventoryProposal.map((x) => x.item))];
  for (const code of disposed) {
    const st = stockOf.get(code);
    const value = s.base.get(code)?.unitPrice ?? baseline.items.find((i) => i.code === code)?.standardCost ?? 0;
    if (!st) {
      flags.push({ kind: 'no_stock', severity: 'warn', message: `${code}: a disposition is proposed but the ERP has no stock row for it.`, ref: code });
      continue;
    }
    for (const l of LOCATIONS) input({ id: `stock:${code}:${l}`, label: `${code} ${l.replace('_', ' ')}`, source: 'given', value: st[FIELD[l]] as number, ref: 'ERP stock' });
    const parts: (typeof inventory)[number]['parts'] = [];
    for (const pr of ecr.inventoryProposal.filter((x) => x.item === code)) {
      const qty = st[FIELD[pr.location]] as number;
      let expr: Expr = [];
      if (pr.disposition === 'scrap' || pr.disposition === 'mandatory_install') {
        // An installed unit replaced by retrofit is scrapped too; fitting the new one is a retrofit row.
        expr = [{ coef: qty * value, vars: [] }, { coef: -qty * value, vars: [recoveryVar(code)] }];
      } else if (pr.disposition === 'cancel') {
        expr = [{ coef: qty * value, vars: [cancelVar(code, qty, value)] }];
      } else if (pr.disposition === 'rework') {
        const v = variable({ id: `rework:${ecr.id}:${code}:${pr.location}`, label: `Rework of ${qty} ${code} (${pr.location})`, dist: point(0), source: 'default', needsEstimate: true, rationale: 'Rework is proposed but not costed. Counted as $0 until estimated.' });
        expr = [{ coef: 1, vars: [v] }];
        if (reg.get(v)!.needsEstimate) flags.push({ kind: 'needs_estimate', severity: 'warn', message: `Rework of ${qty} ${code} (${pr.location}) is not costed.`, ref: v });
      } else if (pr.disposition === 'tbd') {
        const what = pr.location === 'on_order'
          ? `cancelling them would cost about ${r2(qty * value * pointOf(vars.get(cancelVar(code, qty, value))!.dist))}`
          : `scrapping them would cost ${r2(qty * value)} before recovery`;
        flags.push({ kind: 'disposition_tbd', severity: 'warn', message: `${qty} ${code} (${pr.location.replace('_', ' ')}): disposition not decided. Counted as used up; ${what}.`, ref: code });
      }
      parts.push({ location: pr.location, disposition: pr.disposition, qty, unitValue: value, expr, ...(pr.note ? { note: pr.note } : {}) });
    }
    const listed = new Set(parts.map((x) => x.location));
    const unlisted = LOCATIONS.filter((l) => !listed.has(l) && (st[FIELD[l]] as number) > 0).map((l) => ({ location: l, qty: st[FIELD[l]] as number }));
    // Installed units count only where the ECR replaces them (a retrofit); otherwise the decision is about stock.
    const scrapQty = LOCATIONS.filter((l) => l !== 'on_order' && (l !== 'in_field' || listed.has('in_field'))).reduce((a, l) => a + (st[FIELD[l]] as number), 0);
    const scrapAll: Expr = [
      { coef: scrapQty * value, vars: [] },
      { coef: -scrapQty * value, vars: [recoveryVar(code)] },
      ...(st.onOrder > 0 ? [{ coef: st.onOrder * value, vars: [cancelVar(code, st.onOrder, value)] }] : []),
    ];
    inventory.push({ item: code, rowId: `inventory:${code}`, parts, unlisted, scrapAll });
    const tally = new Map<string, number>();
    for (const x of parts) {
      const k = x.disposition === 'mandatory_install' ? 'scrap' : x.disposition.replace(/_/g, ' ');
      tally.set(k, (tally.get(k) ?? 0) + x.qty);
    }
    const what = [...tally].map(([k, q]) => `${k} ${q}`).join(', ');
    const rev = s.base.get(code)?.rev;
    rows.push({
      id: `inventory:${code}`, block: 'production', recurring: false, basis: 'computed',
      label: `Inventory disposition, ${code}${rev ? ` Rev ${rev}` : ''}: ${what}`,
      oneTime: sum(...parts.map((x) => x.expr)), unit: null, quantity: null,
      formula: 'Σ locations: scrap = qty × standard cost × (1 − recovery share); cancel = qty × price × cancellation share; use up = 0',
      uses: [...LOCATIONS.map((l) => `stock:${code}:${l}`), 'baseline:items', `row:${ecr.id}:inventory`],
      note: blankScrapRows.length ? `Fills the blank cost-page row "${blankScrapRows.join('", "')}".` : undefined,
    });
  }
  if (ecr.inventoryProposal.length) input({ id: `row:${ecr.id}:inventory`, label: `${ecr.id} inventory proposal`, source: 'given', ref: `${ecr.id} inventoryProposal` });
  if (blankScrapRows.length && inventory.length === 0) {
    for (const label of blankScrapRows) {
      const id = `cost:${ecr.id}:scrap`;
      const v = variable({ id, label, dist: point(0), source: 'default', needsEstimate: true, rationale: 'Left blank, and the ECR proposes no disposition to compute it from. Counted as $0 until estimated.' });
      rows.push({ id, block: 'production', label, recurring: false, basis: reg.get(v)!.source, oneTime: [{ coef: 1, vars: [v] }], unit: null, quantity: null, formula: 'blank on the cost page: $0, to be estimated', uses: [v], needsEstimate: true });
      flags.push({ kind: 'needs_estimate', severity: 'warn', message: `"${label}" was left blank and no disposition is proposed.`, ref: id });
    }
  }
  for (const p of programs) {
    for (const r of changedRows(s, p.id)) {
      if (disposed.includes(r.item) || r.qtyBase === 0) continue;
      const st = stockOf.get(r.item);
      const onHand = st ? LOCATIONS.filter((l) => l !== 'in_field').reduce((a, l) => a + (st[FIELD[l]] as number), 0) : 0;
      if (onHand > 0 && !flags.some((f) => f.kind === 'no_disposition' && f.ref === r.item)) {
        flags.push({ kind: 'no_disposition', severity: 'info', message: `${r.item}: ${onHand} on hand or on order and no disposition proposed. Counted as used up.`, ref: r.item });
      }
    }
  }

  // ---------------------------------------------------------------- expressions to summarise
  const rowTotal = (r: RowDraft): Expr => sum(r.oneTime ?? [], r.unit ? scale(r.unit, r.quantity ?? 0) : []);
  for (const r of rows) {
    if (r.oneTime) track(`${r.id}/oneTime`, r.oneTime, r.recurring ? '' : r.formula, r.uses);
    if (r.unit) {
      track(`${r.id}/unit`, r.unit, r.recurring ? 'per unit: Σ items (qty × price at head − qty × price at base) × price index' : 'unit cost at its stated value with an estimate spread', r.uses);
      track(`${r.id}/extended`, scale(r.unit, r.quantity ?? 0), `unit cost × ${r.quantity}`, r.uses);
    }
    track(`${r.id}/total`, rowTotal(r), r.formula, r.uses);
  }
  const blockRows = (b: CostBlock) => rows.filter((r) => r.block === b);
  for (const b of COST_BLOCKS) {
    const rs = blockRows(b);
    const uses = rs.flatMap((r) => r.uses);
    track(`block:${b}/oneTime`, sum(...rs.map((r) => r.oneTime ?? [])), `Σ one-time column of the ${b} block`, uses);
    track(`block:${b}/extended`, sum(...rs.map((r) => (r.unit ? scale(r.unit, r.quantity ?? 0) : []))), `Σ unit cost × quantity of the ${b} block`, uses);
    track(`block:${b}/total`, sum(...rs.map(rowTotal)), `Σ rows of the ${b} block`, uses);
  }
  const nonRecurring = rows.filter((r) => !r.recurring);
  const recurringRows = rows.filter((r) => r.recurring);
  const oneTimeTotal = sum(...nonRecurring.map(rowTotal));
  const recurringWindow = sum(...recurringRows.map(rowTotal));
  const allUses = rows.flatMap((r) => r.uses);
  track('oneTimeTotal', oneTimeTotal, 'Σ every row that is not production recurring', nonRecurring.flatMap((r) => r.uses));
  track('recurringWindow', recurringWindow, `Σ programs: per-unit change × units built after the cut-in, ${windowMonths} months from ${windowFrom ?? 'the cut-in'}`, recurringRows.flatMap((r) => r.uses));
  track('windowTotal', sum(oneTimeTotal, recurringWindow), 'one-time total + recurring in the year-one window', allUses);
  const recurringPlan = sum(...programs.map((p) => scale(deltaExpr(p.id), counts.get(p.id)!.total)));
  track('recurringPlan', recurringPlan, 'Σ programs: per-unit change × every planned unit after the cut-in', recurringRows.flatMap((r) => r.uses));
  track('planTotal', sum(oneTimeTotal, recurringPlan), 'one-time total + recurring over the whole volume plan', allUses);
  for (const p of programs) {
    const uses = ['baseline:items', 'baseline:bom', `ecr:${ecr.id}:overlay`];
    track(`unitCost:${p.id}/base`, unitCostExpr(p.id, 'base'), 'Σ items qty per unit × unit price × price index, plus labour hours × rate, at base', uses);
    track(`unitCost:${p.id}/head`, unitCostExpr(p.id, 'head'), 'the same at head', uses);
    track(`unitCost:${p.id}/delta`, deltaExpr(p.id), 'per draw, unit cost at head − unit cost at base', [...uses, ...(recurringRows.find((r) => r.id === `recurring:${p.id}`)?.uses ?? [])]);
    const c = counts.get(p.id)!;
    for (const [year, units] of [...c.byYear].sort()) {
      track(`period:${p.id}:${year}`, scale(deltaExpr(p.id), units), `per-unit change × ${units} units built after the cut-in in ${year}`, [...uses, effectivity.get(p.id)!.id, `volume:${p.id}`]);
    }
  }
  const pieceItems = [...affectedBuyHeadPrice.keys()].sort();
  for (const code of pieceItems) {
    const b = s.base.get(code);
    const h = s.head.get(code);
    if (b?.unitPrice !== undefined && b.status === 'released') track(`piece:${code}/base`, [{ coef: b.unitPrice, vars: [priceVar(code)] }], 'unit price at base × price index', ['baseline:items']);
    const usedAtHead = [...s.explodedHead.values()].some((q) => (q.get(code) ?? 0) > 0);
    if (h?.unitPrice !== undefined && usedAtHead) track(`piece:${code}/head`, [{ coef: h.unitPrice, vars: headVars(code) }], 'unit price at head × price index', [`ecr:${ecr.id}:overlay`, ...(priceEvidence.get(code) ?? [])]);
  }
  for (const inv of inventory) {
    inv.parts.forEach((x, k) => track(`inventory:${inv.item}/part${k}`, x.expr, x.disposition === 'cancel' ? 'qty × price × cancellation share' : x.disposition === 'scrap' || x.disposition === 'mandatory_install' ? 'qty × standard cost × (1 − recovery share)' : x.disposition === 'rework' ? 'rework estimate' : 'used up: no write-off', [`stock:${inv.item}:${x.location}`, 'baseline:items', `row:${ecr.id}:inventory`]));
    track(`inventory:${inv.item}/total`, sum(...inv.parts.map((x) => x.expr)), 'Σ locations', [`row:${ecr.id}:inventory`]);
    track(`inventory:${inv.item}/scrapAll`, inv.scrapAll, 'every unit in stock scrapped and every unit on order cancelled, less recovery; installed units only where the ECR replaces them', LOCATIONS.map((l) => `stock:${inv.item}:${l}`));
  }

  // ---------------------------------------------------------------- simulate
  const varList = [...vars.values()];
  const runOnce = (seed: string) => {
    const d = drawAll(varList, seed, n, rho);
    const out = new Map<string, Summary>();
    const arrays = new Map<string, Float64Array>();
    for (const [key, p] of pending) {
      const a = evaluate(p.expr, d);
      arrays.set(key, a);
      out.set(key, summarize(a));
    }
    return { d, out, arrays };
  };
  const run1 = runOnce(options.seed);
  const seed2 = `${options.seed}:convergence`;
  const run2 = runOnce(seed2);

  const pointOfVar = (id: string) => pointOf(vars.get(id)!.dist);
  const trace = (p: Pending): Trace => {
    const ids = [...new Set([...p.uses, ...varsOf(p.expr)])];
    const missing = ids.filter((id) => !reg.has(id));
    if (missing.length) throw new Error(`trace of ${p.key} names ids that are not inputs: ${missing.join(', ')}`);
    const uses: TraceUse[] = ids.map((id) => ({ id, source: reg.get(id)!.source }));
    return { formula: p.formula, uses, evidence: 'computation' };
  };
  const money = (key: string, sumOverride?: Summary): Money => {
    const p = pending.get(key);
    if (!p) throw new Error(`no metric ${key}`);
    const sm = sumOverride ?? run1.out.get(key)!;
    return { p10: r2(sm.p10), p50: r2(sm.p50), p90: r2(sm.p90), mean: r2(sm.mean), point: r2(evaluateAt(p.expr, pointOfVar)), trace: trace(p) };
  };
  const maybe = (key: string) => (pending.has(key) ? money(key) : null);

  const toRow = (r: RowDraft): CostRow => ({
    id: r.id, block: r.block, label: r.label, recurring: r.recurring, basis: r.basis,
    oneTime: maybe(`${r.id}/oneTime`), unitCost: maybe(`${r.id}/unit`), quantity: r.quantity,
    extended: maybe(`${r.id}/extended`), total: money(`${r.id}/total`),
    ...(r.needsEstimate ? { needsEstimate: true } : {}), ...(r.ref ? { ref: r.ref } : {}), ...(r.note ? { note: r.note } : {}),
  });
  const blocks = Object.fromEntries(COST_BLOCKS.map((b) => [b, blockRows(b).map(toRow)])) as Record<CostBlock, CostRow[]>;
  const blockTotals = Object.fromEntries(
    COST_BLOCKS.map((b) => [b, { oneTime: money(`block:${b}/oneTime`), extended: money(`block:${b}/extended`), total: money(`block:${b}/total`) }]),
  ) as Record<CostBlock, BlockTotal>;

  const unitCost = programs.map((p) => {
    // The delta is the per-draw difference of head and base: paired, never a difference of percentiles.
    const paired = pairedDelta(run1.arrays.get(`unitCost:${p.id}/head`)!, run1.arrays.get(`unitCost:${p.id}/base`)!);
    return { program: p.id, base: money(`unitCost:${p.id}/base`), head: money(`unitCost:${p.id}/head`), delta: money(`unitCost:${p.id}/delta`, paired) };
  });

  // One-at-a-time swings of the year-one total, and each disposition decision.
  const windowExpr = pending.get('windowTotal')!.expr;
  const base0 = evaluateAt(windowExpr, pointOfVar);
  const drivers: Driver[] = [];
  for (const id of varsOf(windowExpr)) {
    const v = vars.get(id)!;
    if (isFixed(v.dist)) continue;
    const at = (q: number) => evaluateAt(windowExpr, (x) => (x === id ? quantileOfVariable(v, q) : pointOfVar(x)));
    const lo = at(0.1);
    const hi = at(0.9);
    drivers.push({ id, label: reg.get(id)!.label, kind: 'input', low: r2(Math.min(lo, hi)), high: r2(Math.max(lo, hi)), swing: r2(Math.abs(hi - lo)) });
  }
  for (const inv of inventory) {
    const chosen = evaluateAt(sum(...inv.parts.map((x) => x.expr)), pointOfVar);
    const scrapAll = evaluateAt(inv.scrapAll, pointOfVar);
    const lo = base0 - chosen;
    const hi = base0 - chosen + scrapAll;
    drivers.push({ id: `decision:inventory:${inv.item}`, label: `${inv.item}: use up the old stock or scrap it`, kind: 'decision', low: r2(lo), high: r2(hi), swing: r2(hi - lo) });
  }
  drivers.sort((a, b) => b.swing - a.swing);

  // Convergence of P80 and P90 across two seeds (docs/IN-PRACTICE.md §8, recommendation 8).
  const convKeys = ['oneTimeTotal', 'recurringWindow', 'windowTotal', 'recurringPlan', ...programs.map((p) => `unitCost:${p.id}/delta`)];
  const metrics = convKeys.map((key) => {
    const a = run1.out.get(key)!;
    const b = run2.out.get(key)!;
    const scaleOf = Math.max(Math.abs(a.p50), a.p90 - a.p10, 1e-9);
    const rel = Math.max(Math.abs(a.p80 - b.p80), Math.abs(a.p90 - b.p90)) / scaleOf;
    return { key, p80: [r2(a.p80), r2(b.p80)] as [number, number], p90: [r2(a.p90), r2(b.p90)] as [number, number], relDiff: Math.round(rel * 1e6) / 1e6 };
  });
  const converged = metrics.every((m) => m.relDiff <= tol);
  if (!converged) flags.push({ kind: 'not_converged', severity: 'warn', message: `P80/P90 moved by more than ${tol * 100}% between seeds; raise the number of draws.` });

  const periods = programs.flatMap((p) =>
    [...counts.get(p.id)!.byYear].sort().map(([year, units]) => ({ period: year, program: p.id, units, recurring: money(`period:${p.id}:${year}`) })),
  );

  for (const c of s.conflicts) flags.push({ kind: 'conflict', severity: 'warn', message: c.message, ref: c.change });
  for (const a of options.assumptions ?? []) {
    if (usedOverrides.has(a.id)) continue;
    const why = noVariable.get(a.id)
      ?? (vars.has(a.id) && !a.dist ? 'it has no distribution, and this input needs one' : 'no input of this check has that id');
    flags.push({ kind: 'unused_assumption', severity: 'warn', ref: a.id, message: `Assumption ${a.id} was not applied: ${why}.` });
  }

  return {
    check: 's2_cost',
    codeVersion: CHECKS_CODE_VERSION,
    ecr: ecr.id,
    program: ecr.program,
    currency: 'USD',
    seed: options.seed,
    draws: n,
    correlation: rho,
    window: { from: windowFrom, months: windowMonths },
    effectivity: [...effectivity.values()],
    blocks,
    blockTotals,
    inventory: inventory.map((inv) => ({
      item: inv.item,
      rowId: inv.rowId,
      rows: inv.parts.map((x, k) => ({ location: x.location, disposition: x.disposition, qty: x.qty, unitValue: x.unitValue, cost: money(`inventory:${inv.item}/part${k}`), ...(x.note ? { note: x.note } : {}) })),
      total: money(`inventory:${inv.item}/total`),
      unlisted: inv.unlisted,
      alternatives: { scrapAll: money(`inventory:${inv.item}/scrapAll`), useUpAll: 0 },
    })),
    headline: {
      unitCostDelta: programs.map((p) => ({ program: p.id, perUnit: money(`recurring:${p.id}/unit`) })),
      oneTimeTotal: money('oneTimeTotal'),
      recurringWindow: money('recurringWindow'),
      windowTotal: money('windowTotal'),
      recurringPlan: money('recurringPlan'),
      planTotal: money('planTotal'),
    },
    unitCost,
    piecePrices: pieceItems.map((code) => ({ item: code, base: maybe(`piece:${code}/base`), head: maybe(`piece:${code}/head`) })),
    periods,
    drivers: drivers.slice(0, 8),
    convergence: { seeds: [options.seed, seed2], tolerance: tol, converged, metrics },
    bomDelta: { ok: s.conflicts.length === 0, conflicts: s.conflicts.length },
    flags,
    inputs: [...reg.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** For tests and callers that need the draws themselves. */
export type { Draws };
