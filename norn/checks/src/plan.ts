// The schedule model that the timeline (S3) and supply (S4) checks share: when the board decides,
// when each changed part can be in the building, and when the change can reach the line. A
// qualification slot at a supplier delays an order until the next slot that opens after the decision,
// and one slot takes one lot, so two changes that need the same slot compete for it.
//
// Same conventions as the cost check (cost.ts): uncertain inputs are named variables drawn once per
// run from per-input streams under one seed, correlated 0.3 inside a group (a supplier, the board);
// every number carries a trace; a run that misses the convergence tolerance doubles its draws.

import { applyOverlay, type HeadState } from './bom.ts';
import { COST_DEFAULTS } from './defaults.ts';
import { type Dist, lognormal, lognormalFromQuantiles, pert, pointOf } from './dist.ts';
import { type Draws, type Variable, drawAll, summarize, type Summary } from './sim.ts';
import { type SerialTable, addMonthsToDay, dateOf, dayOf, dayOfSerial, serialAtDay, serialTable } from './time.ts';
import type {
  AssumptionOverride, Baseline, ChangeRequest, Flag, InputRecord, ItemCode, ProgramId, Source, SupplierConstraint,
  SupplierId, Trace, TraceUse,
} from './types.ts';
import { lastBuiltSerial, serialsByMonth } from './volume.ts';
import { implementationTasks, type PlannedTask } from './implementation.ts';

// ---------------------------------------------------------------- defaults

export interface Triple {
  min: number;
  mode: number;
  max: number;
}

export interface PlanDefaults {
  /** Weeks from filing to the board's decision, by the ECR's priority. */
  decisionWeeks: { routine: Triple; urgent: Triple };
  /** Log-space spread of a quoted lead time when the baseline has no range for that part. */
  quotedLeadSigma: { firm: number; budgetary: number };
  /** Log-space spread of a lead time that nobody has stated, taken from the other parts' median. */
  unsourcedLeadSigma: number;
  /** The share of a part's price that a raw-material price break applies to. */
  rawMaterialShare: Triple;
  /** Months between qualification slots when the constraint does not say. */
  slotCadenceMonths: number;
  /** A part with no sourcing record: its forward price as multiples of its quoted price (the cost check's default). */
  newItemPrice: { p10: number; p90: number };
  /** Log-space spread of a budgetary quote's price, on top of the market (the cost check's default). */
  budgetaryQuoteSpread: number;
}

export const PLAN_DEFAULTS: PlanDefaults = {
  decisionWeeks: { routine: { min: 3, mode: 4, max: 7 }, urgent: { min: 1.5, mode: 3, max: 5 } },
  quotedLeadSigma: { firm: 0.15, budgetary: 0.25 },
  unsourcedLeadSigma: 0.25,
  rawMaterialShare: { min: 0.4, mode: 0.6, max: 0.8 },
  slotCadenceMonths: 3,
  newItemPrice: COST_DEFAULTS.newItemPrice,
  budgetaryQuoteSpread: COST_DEFAULTS.spread.budgetary_quote,
};

export const mergePlanDefaults = (d?: Partial<PlanDefaults>): PlanDefaults => ({
  ...PLAN_DEFAULTS,
  ...d,
  decisionWeeks: { ...PLAN_DEFAULTS.decisionWeeks, ...d?.decisionWeeks },
  quotedLeadSigma: { ...PLAN_DEFAULTS.quotedLeadSigma, ...d?.quotedLeadSigma },
});

const DEFAULT_WHY: Record<string, string> = {
  'decisionWeeks:routine':
    'Weeks from filing to the board\'s decision, PERT(3, 4, 7). Set from the nine board decisions in Bowman\'s change history: 3.0 to 6.4 weeks, median 4.1 (Fern default).',
  'decisionWeeks:urgent':
    'An urgent change is decided faster: PERT(1.5, 3, 5), about one week under a routine one (Fern default; the history has no urgent label to check it against).',
  'quotedLeadSigma:firm': 'A firm quote\'s lead time with no range in the baseline: log-space spread 0.15 (Fern default).',
  'quotedLeadSigma:budgetary': 'A budgetary quote\'s lead time with no range in the baseline: log-space spread 0.25 (Fern default).',
  unsourcedLeadSigma: 'A part with no quote and no sourcing record: the median lead time of every sourced part, log-space spread 0.25 (Fern default).',
  rawMaterialShare:
    'The share of a part\'s price that a raw-material price break applies to, PERT(40%, 60%, 80%). Nobody has stated it, so it needs an estimate (Fern default).',
  slotCadenceMonths: 'The constraint does not say how often a qualification slot opens: one per quarter (Fern default).',
  newItemPrice: 'A part with no sourcing record: forward price p10 0.95 and p90 1.08 times its quoted price (the cost check\'s default).',
  budgetaryQuoteSpread: 'A budgetary quote ("plus or minus 20%"): log-space spread 0.15 on top of the market range (the cost check\'s default).',
};

export interface PlanOptions {
  /** The run's seed. Use the deployment's configured seed. */
  seed: string;
  /** Where the baseline and the change request came from, as the trace names them. */
  provenance?: { baseline?: string; changeRequest?: string };
  draws?: number;
  /** The most draws a run may double up to: 4 x draws unless set. */
  maxDraws?: number;
  correlation?: number;
  convergenceTolerance?: number;
  assumptions?: AssumptionOverride[];
  defaults?: Partial<PlanDefaults>;
}

// ---------------------------------------------------------------- numbers a check returns

/** A forecast number: a range from the draws, its point estimate (every input at its stated value) and its trace. */
export interface Stat {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  point: number;
  trace: Trace;
}

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
export const WEEK = 7;

// ---------------------------------------------------------------- inputs and assumptions

const budgetary = (q: ChangeRequest['supplierQuotes'][number]) =>
  q.firmness ? q.firmness === 'budgetary' : /budgetary|indicative|plus or minus|±/i.test(q.note ?? '');

/** The inputs a check registers and the assumptions that replace them. Same rules as the cost check's. */
export class Book {
  readonly reg = new Map<string, InputRecord>();
  readonly vars = new Map<string, Variable>();
  readonly flags: Flag[] = [];
  private readonly overrides: Map<string, AssumptionOverride>;
  private readonly used = new Set<string>();

  readonly assumptions: AssumptionOverride[];
  readonly D: PlanDefaults;

  constructor(assumptions: AssumptionOverride[], D: PlanDefaults) {
    this.assumptions = assumptions;
    this.D = D;
    this.overrides = new Map(assumptions.map((a) => [a.id, a]));
  }

  input(rec: InputRecord): string {
    if (!this.reg.has(rec.id)) this.reg.set(rec.id, rec);
    return rec.id;
  }

  defaultInput(key: string, label: string, value: number | string): string {
    return this.input({ id: `default:${key}`, label, source: 'default', value, rationale: DEFAULT_WHY[key] });
  }

  /** An uncertain input. An assumption with the same id replaces its distribution: always a default, a stated number only with `replacesGiven`. */
  variable(v: { id: string; label: string; dist: Dist; groups?: string[]; source: Source; ref?: string; rationale?: string; needsEstimate?: boolean }): string {
    if (this.vars.has(v.id)) return v.id;
    let ov = this.overrides.get(v.id);
    if (ov?.dist && v.source === 'given' && !ov.replacesGiven) {
      this.used.add(v.id);
      this.flags.push({ kind: 'assumption_not_applied', severity: 'warn', ref: v.id, message: `An assumption for ${v.id} would replace a stated number ("${v.label}"). Recorded but not applied: set replacesGiven to replace it.` });
      ov = undefined;
    }
    if (ov && !ov.dist) ov = undefined; // reported as unused at the end: a distribution is needed here
    if (ov) this.used.add(v.id);
    const dist = ov?.dist ?? v.dist;
    this.reg.set(v.id, {
      id: v.id, label: v.label, source: ov?.dist ? ov.source : v.source, value: r2(pointOf(dist)), dist, groups: v.groups ?? [],
      ...(v.ref ? { ref: v.ref } : {}),
      rationale: ov?.dist ? `${ov.rationale}${ov.by ? ` (${ov.by})` : ''}` : v.rationale,
      ...(v.needsEstimate && !ov?.dist ? { needsEstimate: true } : {}),
    });
    this.vars.set(v.id, { id: v.id, dist, groups: v.groups ?? [] });
    return v.id;
  }

  /** Whether an assumption with this id was applied, or recorded and refused, by an input of this book. */
  wasUsed(id: string): boolean {
    return this.used.has(id);
  }

  /** Assumptions that matched nothing, as flags. */
  unusedFlags(): Flag[] {
    const out: Flag[] = [];
    for (const a of this.assumptions) {
      if (this.used.has(a.id)) continue;
      const why = this.vars.has(a.id)
        ? 'it has no distribution, and this input needs one'
        : this.reg.has(a.id)
          ? 'it names a record the check reads, not an input it draws; change the record, or the default through options.defaults'
          : 'no input of this check has that id';
      out.push({ kind: 'unused_assumption', severity: 'warn', ref: a.id, message: `Assumption ${a.id} was not applied: ${why}.` });
    }
    return out;
  }

  trace(formula: string, ids: string[]): Trace {
    const named = [...new Set(ids)];
    const missing = named.filter((id) => !this.reg.has(id));
    if (missing.length) throw new Error(`trace of "${formula}" names ids that are not inputs: ${missing.join(', ')}`);
    const uses: TraceUse[] = named.map((id) => ({ id, source: this.reg.get(id)!.source }));
    return { formula, uses, evidence: 'computation' };
  }

  /** The variables as draws at their stated values: one draw, no uncertainty. */
  pointDraws(): Draws {
    const values = new Map<string, Float64Array>();
    for (const v of this.vars.values()) values.set(v.id, Float64Array.of(pointOf(v.dist)));
    return { n: 1, seed: 'point', values };
  }

  stat(samples: Float64Array, at: number, formula: string, ids: string[], digits: 0 | 2 | 4 = 2): Stat {
    const s = summarize(samples);
    const r = (x: number) => (digits === 0 ? Math.round(x) : digits === 4 ? r4(x) : r2(x));
    return { p10: r(s.p10), p50: r(s.p50), p90: r(s.p90), mean: r(s.mean), point: r(at), trace: this.trace(formula, ids) };
  }
}

// ---------------------------------------------------------------- supplier constraints

export interface SlotTerms {
  cadenceMonths: number;
  cadenceSource: Source;
  bundle?: { withinWeeks: number; secondQualificationDiscount: number; priceBreak: number };
  /** True when the terms were read from the constraint's description rather than structured fields. */
  fromText: boolean;
}

const CADENCE_WORDS: Record<string, number> = { month: 1, quarter: 3, year: 12 };

/** What a qualification-slot constraint says about slot spacing and the bundle terms: its structured fields, else its description. */
export function slotTerms(c: SupplierConstraint, D: PlanDefaults): SlotTerms {
  const text = c.description ?? '';
  let cadenceMonths = c.slotCadenceMonths;
  let cadenceSource: Source = 'given';
  let fromText = false;
  if (cadenceMonths === undefined) {
    const m = /(?:one|a|per)\s+(?:qualification\s+)?lot\s+per\s+(month|quarter|year)|slots?\s+are\s+(monthly|quarterly|yearly)/i.exec(text);
    const word = m?.[1] ?? { monthly: 'month', quarterly: 'quarter', yearly: 'year' }[(m?.[2] ?? '').toLowerCase()];
    if (word) {
      cadenceMonths = CADENCE_WORDS[word.toLowerCase()];
      fromText = true;
    } else {
      cadenceMonths = D.slotCadenceMonths;
      cadenceSource = 'default';
    }
  }
  let bundle = c.bundle && { withinWeeks: c.bundle.withinWeeks, secondQualificationDiscount: c.bundle.secondQualificationDiscount ?? 0, priceBreak: c.bundle.priceBreak ?? 0 };
  if (!bundle) {
    const within = /within\s+(\d+)\s+weeks?|(\d+)-week\s+window/i.exec(text);
    const discount = /(\d+(?:\.\d+)?)%\s+less/i.exec(text);
    const brk = /(\d+(?:\.\d+)?)%[^.]*price break/i.exec(text);
    const weeks = Number(within?.[1] ?? within?.[2]);
    if (Number.isFinite(weeks) && (discount || brk)) {
      bundle = { withinWeeks: weeks, secondQualificationDiscount: discount ? Number(discount[1]) / 100 : 0, priceBreak: brk ? Number(brk[1]) / 100 : 0 };
      fromText = true;
    }
  }
  return { cadenceMonths, cadenceSource, ...(bundle ? { bundle } : {}), fromText };
}

export interface Slot {
  constraintId: string;
  supplier: SupplierId;
  /** Day each slot opens, the published ones (inside the window) first, then the same cadence on. */
  starts: Float64Array;
  published: number;
  terms: SlotTerms;
}

const SLOTS_AHEAD = 40;

function slotOf(c: SupplierConstraint, D: PlanDefaults): Slot | null {
  if (c.kind !== 'qualification_slot' || !c.window) return null;
  const terms = slotTerms(c, D);
  const from = dayOf(c.window.from);
  const to = dayOf(c.window.to);
  const starts: number[] = [];
  let published = 0;
  for (let k = 0; k < SLOTS_AHEAD; k++) {
    const d = addMonthsToDay(from, k * terms.cadenceMonths);
    starts.push(d);
    if (d <= to) published++;
  }
  return { constraintId: c.id, supplier: c.supplier, starts: Float64Array.from(starts), published, terms };
}

// ---------------------------------------------------------------- one ECR's schedule

export interface SupplyItem {
  item: ItemCode;
  name: string;
  supplier?: SupplierId;
  /** The suppliers that could supply this revision: qualified sourcing records and quoting suppliers. */
  sources: SupplierId[];
  leadVar: string;
  leadFrom: 'quote' | 'sourcing' | 'default';
  quoteId?: string;
  /** Head unit price: the quote line that names this part, else the item master's. And the parts per finished unit of the ECR's program (at head). */
  price: number | null;
  /** The quote line the price is from, when it is. */
  priceQuote?: { quoteId: string; line: number; budgetary: boolean };
  /** The supplier the price range is looked up under, as the cost check does. */
  priceSupplier?: SupplierId;
  /** Ids of the draws that scale the price (the market range, and a budgetary quote's own spread). Filled by `registerPriceVars`. */
  priceVars?: string[];
  perUnit: number;
  slot: Slot | null;
}

export interface Schedule {
  ecr: ChangeRequest;
  program: ProgramId;
  filedDay: number;
  decisionVar: string;
  tasks: PlannedTask[];
  implementationComplete: boolean;
  items: SupplyItem[];
  table: SerialTable;
  firstUnbuilt: number;
  /**
   * Old stock the proposal uses up first: the change cannot start before this serial. `day` is when
   * the serial before it is planned to complete (-Infinity: already built). `beyondPlan` is true when
   * that serial is past the end of the volume plan, so no date can be placed.
   */
  floor: { serial: number; id: string; why: string; day: number; beyondPlan: boolean } | null;
  stated: { basis: string; label: string; day: number | null; serial: number | null; id: string };
  /** One-time qualification cost from the quote lines, by item. */
  qualification: Map<ItemCode, number>;
  /** Input ids behind the cut-in of this ECR. */
  uses: string[];
}

const FIELD = { stores: 'stores', wip: 'wip', finished_goods: 'finishedGoods', supplier_finished: 'supplierFinished', on_order: 'onOrder' } as const;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

const okRange = (p: { p10: number; p50: number; p90: number } | undefined) =>
  !!p && [p.p10, p.p50, p.p90].every(Number.isFinite) && p.p10 > 0 && p.p10 <= p.p50 && p.p50 <= p.p90;

/** Gather one ECR's schedule: register its inputs and uncertain variables in the book. */
export function gatherSchedule(book: Book, baseline: Baseline, ecr: ChangeRequest, where: { baseline: string; changeRequest: string }): Schedule {
  const D = book.D;
  const s: HeadState = applyOverlay(baseline, ecr);
  const program = ecr.program;
  const uses: string[] = [];
  const use = (id: string) => (uses.push(id), id);

  const filedId = book.input({ id: `ecr:${ecr.id}:filed`, label: `${ecr.id} filing date`, source: 'given', value: ecr.filedOn, ref: `${where.changeRequest}: filedOn` });
  use(filedId);
  const priority = ecr.priority === 'urgent' ? 'urgent' : 'routine';
  const T = D.decisionWeeks[priority];
  const decisionVar = book.variable({
    id: `decision:${ecr.id}`, label: `${ecr.id}: weeks from filing to the board's decision`, dist: pert(T.min, T.mode, T.max), groups: ['decision:board'], source: 'default',
    ref: book.defaultInput(`decisionWeeks:${priority}`, `Weeks to a board decision, ${priority}`, `${T.min} to ${T.max}, most likely ${T.mode}`),
    rationale: DEFAULT_WHY[`decisionWeeks:${priority}`],
  });
  use(decisionVar);

  // The parts the change brings in: a revised or added buy item, or a buy item the BOM change adds new.
  const explodedHead = s.explodedHead.get(program) ?? new Map<ItemCode, number>();
  const explodedBase = s.explodedBase.get(program) ?? new Map<ItemCode, number>();
  const candidates = new Set<ItemCode>(ecr.itemChanges.filter((c) => c.op !== 'remove').map((c) => c.item));
  for (const b of ecr.bomChanges) if (b.op === 'add' && (explodedBase.get(b.child) ?? 0) === 0) candidates.add(b.child);
  // A part the change needs more of, wherever in the BOM the quantity rises (a set_qty, or a changed assembly above it).
  for (const [code, qty] of explodedHead) if (qty > (explodedBase.get(code) ?? 0) + 1e-9) candidates.add(code);
  // A quote line prices the part whose code its description names, else the quote's own item (the cost check's rule).
  const knownCodes = [...new Set([...s.head.keys(), ...s.base.keys()])].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const lineItem = (q: ChangeRequest['supplierQuotes'][number], description: string) => knownCodes.find((c) => description.includes(c)) ?? q.item;
  // The one rule for which quotes apply to a part, for its price, its lead time and its sources alike: a
  // quote is for the part if it is the quote's own item or one of its lines names the part. The quotes
  // for the part's own item come first, then the others in the order filed.
  const quotesFor = (code: ItemCode) =>
    ecr.supplierQuotes
      .filter((q) => q.item === code || q.lines.some((l) => lineItem(q, l.description) === code))
      .sort((a, b) => Number(b.item === code) - Number(a.item === code));
  const sourcingOf = (code: ItemCode) => baseline.sourcing.filter((x) => x.item === code);
  const allLeads = baseline.sourcing.map((x) => x.leadTimeWeeks?.p50).filter((x): x is number => Number.isFinite(x) && x > 0);
  const constraints = (baseline.supplierConstraints ?? []).filter((c) => c.kind === 'qualification_slot');
  const items: SupplyItem[] = [];
  const qualification = new Map<ItemCode, number>();
  let sawMake = false;

  for (const code of [...candidates].sort()) {
    const h = s.head.get(code);
    if (!h || (explodedHead.get(code) ?? 0) <= 0) continue;
    if (h.makeBuy !== 'buy') {
      sawMake = true;
      continue;
    }
    const recs = sourcingOf(code);
    const src = recs.find((x) => x.primary) ?? recs[0];
    const forPart = quotesFor(code);
    const quote = forPart.find((q) => (q.leadTimeWeeks ?? 0) > 0);
    const supplier = quote?.supplier ?? src?.supplier ?? h.supplier;
    const groups = supplier ? [`supplier:${supplier}`] : [];
    const sources = [...new Set([...recs.filter((x) => x.qualified).map((x) => x.supplier), ...forPart.map((q) => q.supplier)])].sort();
    const id = `lead:${ecr.id}:${code}`;
    let leadVar: string;
    let leadFrom: SupplyItem['leadFrom'];
    if (quote) {
      const m = quote.leadTimeWeeks!;
      const qid = book.input({ id: `quote:${quote.id}:lead`, label: `${quote.id}: quoted lead time for ${code}`, source: 'given', value: m, ref: `${where.changeRequest}: supplier quote ${quote.id} (${quote.supplier}), ${m} weeks` });
      use(qid);
      leadFrom = 'quote';
      if (okRange(src?.leadTimeWeeks)) {
        const p = src!.leadTimeWeeks;
        leadVar = book.variable({
          id, label: `${code}: weeks from order to parts in`, groups, source: 'given', ref: qid,
          dist: lognormalFromQuantiles((m * p.p10) / p.p50, m, (m * p.p90) / p.p50),
          rationale: `The quoted ${m} weeks as the median, spread by the supplier's own record for this part: p10 ${p.p10}, p50 ${p.p50}, p90 ${p.p90} weeks, as ratios to the median. Lognormal.`,
        });
        use(book.input({ id: `sourcing:${code}:lead`, label: `${code}: sourced lead time`, source: 'given', ref: `${where.baseline}: sourcing ${code} ${src!.supplier}: p10 ${p.p10}, p50 ${p.p50}, p90 ${p.p90} weeks` }));
      } else {
        const kind = budgetary(quote) ? 'budgetary' : 'firm';
        const sigma = D.quotedLeadSigma[kind];
        leadVar = book.variable({
          id, label: `${code}: weeks from order to parts in`, groups, source: 'given', dist: lognormal(m, sigma),
          ref: book.defaultInput(`quotedLeadSigma:${kind}`, `Spread of a ${kind} quote's lead time`, sigma),
          rationale: `The quoted ${m} weeks as the median, with a default log-space spread of ${sigma}: the baseline has no lead-time range for ${code}.`,
        });
      }
    } else if (okRange(src?.leadTimeWeeks)) {
      const p = src!.leadTimeWeeks;
      leadFrom = 'sourcing';
      leadVar = book.variable({
        id, label: `${code}: weeks from order to parts in`, groups, source: 'given', dist: lognormalFromQuantiles(p.p10, p.p50, p.p90),
        ref: book.input({ id: `sourcing:${code}:lead`, label: `${code}: sourced lead time`, source: 'given', ref: `${where.baseline}: sourcing ${code} ${src!.supplier}: p10 ${p.p10}, p50 ${p.p50}, p90 ${p.p90} weeks` }),
        rationale: 'No quote states a lead time: the supplier\'s record for this part, lognormal through its p10, p50 and p90.',
      });
    } else {
      const m = allLeads.length ? median(allLeads) : 12;
      leadFrom = 'default';
      leadVar = book.variable({
        id, label: `${code}: weeks from order to parts in`, groups, source: 'default', dist: lognormal(m, D.unsourcedLeadSigma), needsEstimate: true,
        ref: book.defaultInput('unsourcedLeadSigma', 'Spread of a lead time nobody has stated', D.unsourcedLeadSigma),
        rationale: `No quote and no sourcing record gives a lead time for ${code}: the median of every sourced part (${m} weeks).`,
      });
      book.flags.push({ kind: 'lead_time_default', severity: 'warn', ref: code, message: `${code}: no quote or sourcing record states a lead time. A median of ${m} weeks stands in until a buyer estimates it.` });
    }
    use(leadVar);

    // A qualification slot at this part's supplier: the order waits for the next slot.
    let slot: Slot | null = null;
    const c = constraints.find((x) => x.items.includes(code) && (!supplier || x.supplier === supplier));
    if (c) {
      slot = slotOf(c, D);
      if (slot) {
        const cid = book.input({ id: `constraint:${c.id}`, label: `${c.id}: qualification slots at ${c.supplier}`, source: 'given', ref: `${where.baseline}: supplier constraint ${c.id}, window ${c.window!.from} to ${c.window!.to}` });
        use(cid);
        book.input({
          id: `constraint:${c.id}:terms`, label: `${c.id}: slot spacing and bundle terms`, source: slot.terms.cadenceSource === 'default' ? 'default' : 'given',
          value: `a slot every ${slot.terms.cadenceMonths} months${slot.terms.bundle ? `; a second part number within ${slot.terms.bundle.withinWeeks} weeks: ${slot.terms.bundle.secondQualificationDiscount * 100}% off its qualification, ${slot.terms.bundle.priceBreak * 100}% raw-material price break` : ''}`,
          ref: slot.terms.fromText ? `read from the description of ${c.id}` : `${c.id} structured fields`,
          rationale: slot.terms.cadenceSource === 'default' ? DEFAULT_WHY.slotCadenceMonths : undefined,
        });
        use(`constraint:${c.id}:terms`);
        if (slot.terms.fromText && !book.flags.some((f) => f.kind === 'terms_from_text' && f.ref === c.id)) book.flags.push({ kind: 'terms_from_text', severity: 'info', ref: c.id, message: `${c.id}: the slot terms were read from its description, not from structured fields.` });
      }
    }
    // The qualification lot's cost, from the quote lines that name it, for the second-part-number discount.
    if (slot) {
      let q = 0;
      for (const qq of forPart) for (const l of qq.lines) if (lineItem(qq, l.description) === code && l.oneTime !== undefined && /qualif/i.test(l.description)) q += l.oneTime;
      if (q > 0) qualification.set(code, q);
    }
    // The price is the quote line that names this part (a quote can price several parts), else the item master's.
    let priceQuote: SupplyItem['priceQuote'];
    let price: number | null = h.unitPrice ?? null;
    outer: for (const qq of forPart) {
      for (let li = 0; li < qq.lines.length; li++) {
        const l = qq.lines[li];
        if (lineItem(qq, l.description) !== code || l.unitPrice === undefined || l.oneTime !== undefined || /first lot|cancel/i.test(l.description)) continue;
        price = l.unitPrice;
        priceQuote = { quoteId: qq.id, line: li + 1, budgetary: budgetary(qq) };
        break outer;
      }
    }
    items.push({
      item: code, name: h.name, ...(supplier ? { supplier } : {}), sources, leadVar, leadFrom, ...(quote ? { quoteId: quote.id } : {}), price, ...(priceQuote ? { priceQuote } : {}),
      priceSupplier: src?.supplier ?? h.supplier ?? s.base.get(code)?.supplier, perUnit: explodedHead.get(code) ?? 0, slot,
    });
  }
  if (items.length === 0) {
    book.flags.push({
      kind: 'no_supply_path', severity: 'info',
      message: sawMake
        ? `${ecr.id}: the changed items are made in house, so no supplier lead time sits on the path. The cut-in waits only for the board's decision.`
        : `${ecr.id}: the change brings in no new bought part, so no supplier lead time sits on the path. The cut-in waits only for the board's decision.`,
    });
  }

  // The line: serials by month, built units, and the old stock the proposal uses up first.
  const sm = serialsByMonth(baseline.volumePlan, baseline.builtAircraft, program);
  const table = serialTable(sm);
  use(book.input({ id: `volume:${program}`, label: `${program} volume plan and built units`, source: 'given', ref: `${where.baseline}: volume plan and built units` }));
  const firstUnbuilt = lastBuiltSerial(baseline.builtAircraft, program) + 1;
  let floor: Schedule['floor'] = null;
  const stockOf = new Map(baseline.stock.map((x) => [x.item, x]));
  for (const u of ecr.inventoryProposal.filter((x) => x.disposition === 'use_until_depleted')) {
    const qty = explodedBase.get(u.item) ?? 0;
    const st = stockOf.get(u.item);
    if (!qty || !st) continue;
    const gone = new Set(ecr.inventoryProposal.filter((x) => x.item === u.item && (x.disposition === 'scrap' || x.disposition === 'cancel')).map((x) => x.location));
    const onHand = (Object.keys(FIELD) as (keyof typeof FIELD)[]).filter((l) => !gone.has(l)).reduce((a, l) => a + (st[FIELD[l]] as number), 0);
    const serial = firstUnbuilt + Math.floor(onHand / qty);
    if (!floor || serial > floor.serial) {
      const prev = dayOfSerial(table, serial - 1);
      floor = {
        serial, id: `stock-floor:${ecr.id}:${u.item}`,
        why: `Use up ${onHand} ${u.item} on hand and on order at ${qty} per unit: ${Math.floor(onHand / qty)} units, so the change starts at S/N ${serial}.`,
        day: prev !== undefined ? prev + 0.5 : -Infinity,
        beyondPlan: prev === undefined && serial - 1 >= table.first + table.days.length,
      };
    }
  }
  if (floor) {
    use(book.input({ id: floor.id, label: `${ecr.id}: old stock used up first`, source: 'given', value: floor.serial, ref: `${where.changeRequest}: inventoryProposal and ${where.baseline}: stock`, rationale: floor.why }));
    if (floor.beyondPlan) {
      book.flags.push({ kind: 'stock_beyond_plan', severity: 'warn', ref: floor.id, message: `${ecr.id}: using up the old stock means starting at S/N ${floor.serial}, but the volume plan ends at S/N ${table.first + table.days.length - 1}. No date can be placed for it; the plan would need to run further.` });
    }
  }

  // What the ECR states as its effectivity, to compare the feasible date with.
  const ep = ecr.effectivity.production;
  let stated: Schedule['stated'];
  const statedId = `stated:${ecr.id}`;
  if (ep.basis === 'serial' && Number.isFinite(Number(ep.from)) && ep.from.trim() !== '') {
    const serial = Number(ep.from);
    const day = dayOfSerial(table, serial) ?? null;
    stated = { basis: 'serial', label: `S/N ${serial} and subsequent`, day, serial, id: statedId };
    if (day === null) book.flags.push({ kind: 'stated_outside_plan', severity: 'info', ref: statedId, message: `${ecr.id} states S/N ${serial}, which the volume plan does not place (built already, or past the plan). Lateness against it is not computed.` });
  } else if (ep.basis === 'date' && /^\d{4}-\d{2}-\d{2}/.test(ep.from)) {
    const day = dayOf(ep.from);
    stated = { basis: 'date', label: `from ${ep.from.slice(0, 10)}`, day, serial: serialAtDay(table, day), id: statedId };
  } else {
    stated = { basis: ep.basis, label: `not stated (${ep.basis})`, day: null, serial: null, id: statedId };
    book.flags.push({ kind: 'no_stated_effectivity', severity: 'info', ref: statedId, message: `${ecr.id} states no production effectivity by serial or date, so the feasible cut-in is shown without a deadline to miss.` });
  }
  book.input({ id: statedId, label: `${ecr.id} production effectivity`, source: 'given', value: stated.label, ref: `${where.changeRequest}: effectivity.production` });
  const implementation = implementationTasks(book, ecr);
  for (const task of implementation.tasks) uses.push(task.input, task.duration);
  return { ecr, program, filedDay: dayOf(ecr.filedOn), decisionVar, tasks: implementation.tasks, implementationComplete: implementation.complete, items, table, firstUnbuilt, floor, stated, qualification, uses: [...new Set(uses)] };
}

/**
 * Register the draws that scale a changed part's price, as the cost check draws them: the market range
 * for the next 12 months (the sourcing record's p10, p50 and p90 as ratios to the p50, else the default
 * range for a part with no record), and a budgetary quote's own spread on top. The ids are the cost
 * check's (`price:<item>`, `quote:<item>`), so on the same seed both checks draw the same numbers.
 */
export function registerPriceVars(book: Book, baseline: Baseline, it: SupplyItem, where: { baseline: string }): string[] {
  if (it.priceVars) return it.priceVars;
  const recs = baseline.sourcing.filter((x) => x.item === it.item);
  const src = recs.find((x) => x.primary) ?? recs[0];
  const groups = it.priceSupplier ? [`supplier:${it.priceSupplier}`] : [];
  const ids: string[] = [];
  const id = `price:${it.item}`;
  if (src && !okRange(src.unitPrice)) {
    book.flags.push({ kind: 'bad_sourcing', severity: 'warn', ref: it.item, message: `${it.item}: the sourcing price range (p10 ${src.unitPrice.p10}, p50 ${src.unitPrice.p50}, p90 ${src.unitPrice.p90}) is not positive and in order, so the default range is used.` });
  }
  if (src && okRange(src.unitPrice)) {
    const p = src.unitPrice;
    ids.push(book.variable({
      id, label: `${it.item} price index (next 12 months)`, groups, source: 'given', dist: lognormalFromQuantiles(p.p10 / p.p50, 1, p.p90 / p.p50),
      ref: `${where.baseline}: sourcing ${it.item} ${src.supplier}: p10 ${p.p10}, p50 ${p.p50}, p90 ${p.p90}`,
      rationale: 'The supplier price range for the next 12 months, as a multiplier on the unit price. Lognormal through the stated p10, p50 and p90.',
    }));
  } else {
    const D = book.D;
    ids.push(book.variable({
      id, label: `${it.item} price index (no sourcing record)`, groups, source: 'default', dist: lognormalFromQuantiles(D.newItemPrice.p10, 1, D.newItemPrice.p90),
      ref: book.defaultInput('newItemPrice', 'Price range for an item with no sourcing record', `${D.newItemPrice.p10} to ${D.newItemPrice.p90}`), rationale: DEFAULT_WHY.newItemPrice,
    }));
  }
  if (it.priceQuote?.budgetary) {
    const D = book.D;
    ids.push(book.variable({
      id: `quote:${it.item}`, label: `${it.item}: budgetary quote moves`, dist: lognormal(1, D.budgetaryQuoteSpread), groups: [], source: 'default',
      ref: book.defaultInput('budgetaryQuoteSpread', 'Spread of a budgetary supplier quote', D.budgetaryQuoteSpread),
      rationale: `The price is from budgetary quote ${it.priceQuote.quoteId}. ${DEFAULT_WHY.budgetaryQuoteSpread}`,
    }));
  }
  it.priceVars = ids;
  return ids;
}

// ---------------------------------------------------------------- evaluating schedules on draws

export interface Timing {
  /** Day the board decides. */
  decision: Float64Array;
  /** Day every changed part is in. */
  parts: Float64Array;
  tasks: Float64Array[];
  retrofit: Float64Array;
  /** Day the change reaches the line: the parts are in and the old stock is used up. */
  cutIn: Float64Array;
  /** The first serial that takes the change. */
  serial: Float64Array;
  /** Index of the last part to arrive, or -1 when there are no parts. */
  critical: Int16Array;
  /** 1 where using up old stock, not the parts, sets the cut-in. */
  floored: Uint8Array;
  /** Per item: day its order is placed (the slot start, or the decision), and the slot index taken (-1: none). */
  placed: Float64Array[];
  slotIndex: Int16Array[];
}

const byFiling = (a: Schedule, b: Schedule) => (a.ecr.filedOn < b.ecr.filedOn ? -1 : a.ecr.filedOn > b.ecr.filedOn ? 1 : a.ecr.id < b.ecr.id ? -1 : a.ecr.id > b.ecr.id ? 1 : 0);

/**
 * Evaluate schedules on shared draws. With `contend`, one slot takes one lot: ECRs in the order they
 * were filed each take the first slot that opens after their decision and that no earlier one took, in
 * every draw. Without it, each schedule is alone, and still only its own lots exclude each other.
 */
export function evaluateSchedules(scheds: Schedule[], d: Draws, contend: boolean): Timing[] {
  const order = scheds.map((_, i) => i).sort((a, b) => byFiling(scheds[a], scheds[b]));
  const out: Timing[] = scheds.map((s) => ({
    decision: new Float64Array(d.n), parts: new Float64Array(d.n), cutIn: new Float64Array(d.n), serial: new Float64Array(d.n),
    tasks: s.tasks.map(() => new Float64Array(d.n)), retrofit: new Float64Array(d.n),
    critical: new Int16Array(d.n).fill(-1), floored: new Uint8Array(d.n),
    placed: s.items.map(() => new Float64Array(d.n)), slotIndex: s.items.map(() => new Int16Array(d.n).fill(-1)),
  }));
  const lag = scheds.map((s) => d.values.get(s.decisionVar)!);
  const lead = scheds.map((s) => s.items.map((it) => d.values.get(it.leadVar)!));
  for (let i = 0; i < d.n; i++) {
    const shared = new Map<string, Set<number>>();
    for (const si of order) {
      const s = scheds[si];
      const t = out[si];
      // A slot takes one lot. Within one ECR its lots never share a slot; with `contend`, nor do different ECRs.
      const taken = contend ? shared : new Map<string, Set<number>>();
      const decision = s.filedDay + WEEK * lag[si][i];
      t.decision[i] = decision;
      let parts = decision;
      let latest = -Infinity;
      s.items.forEach((it, k) => {
        let placed = decision;
        if (it.slot) {
          const starts = it.slot.starts;
          let j = 0;
          while (j < starts.length - 1 && starts[j] < decision) j++;
          let used = taken.get(it.slot.constraintId);
          if (!used) taken.set(it.slot.constraintId, (used = new Set()));
          while (j < starts.length - 1 && used.has(j)) j++;
          used.add(j);
          t.slotIndex[k][i] = j;
          placed = starts[j];
        }
        t.placed[k][i] = placed;
        const arrives = placed + WEEK * lead[si][k][i];
        if (arrives > latest) {
          latest = arrives;
          t.critical[i] = k;
        }
        parts = Math.max(parts, arrives);
      });
      t.parts[i] = parts;
      let cutIn = parts;
      const completion = new Map<string, number>([['decision', decision], ['parts', parts]]);
      // Retrofit follows its own declared dependencies; unrelated production parts cannot delay it.
      let retrofit = s.filedDay;
      s.tasks.forEach((task, k) => {
        const starts = Math.max(s.filedDay, ...task.after.map(id => completion.get(id)!));
        const finish = task.completedDay ?? (starts + WEEK * d.values.get(task.duration)![i]);
        completion.set(task.task.id, finish);
        t.tasks[k][i] = finish;
        if (task.task.appliesTo !== 'retrofit') cutIn = Math.max(cutIn, finish);
        if (task.task.appliesTo !== 'production') retrofit = Math.max(retrofit, finish);
      });
      t.retrofit[i] = retrofit;
      // Old stock used up: the change starts at the floor's serial. If that serial is past the plan, no
      // day can be placed: the cut-in is infinitely late (a stock-bound unit count of zero follows).
      if (s.floor && (s.floor.beyondPlan || s.floor.day > cutIn)) {
        cutIn = s.floor.beyondPlan ? Infinity : s.floor.day;
        t.floored[i] = 1;
      }
      t.cutIn[i] = cutIn;
      t.serial[i] = Math.max(cutIn === Infinity ? 0 : serialAtDay(s.table, cutIn), s.firstUnbuilt, s.floor?.serial ?? 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------- units on the line

/**
 * Planned units completed by a day, interpolated between planned completion days so it is continuous
 * (a count that jumps by a whole unit would keep the spend and capacity quantiles from converging).
 * Before the first planned unit it ramps up over the gap to the second.
 */
export function cumulativeUnits(t: SerialTable, day: number): number {
  const n = t.days.length;
  if (n === 0) return 0;
  if (day <= t.days[0]) {
    const gap = n > 1 ? t.days[1] - t.days[0] : 30;
    return Math.max(0, 1 - (t.days[0] - day) / gap);
  }
  if (day >= t.days[n - 1]) return n;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.days[mid] <= day) lo = mid;
    else hi = mid;
  }
  return lo + 1 + (day - t.days[lo]) / (t.days[hi] - t.days[lo]);
}

/** Planned units completed in the 365 days from a day. */
export const unitsNextYear = (t: SerialTable, day: number) => cumulativeUnits(t, day + 365) - cumulativeUnits(t, day);

// ---------------------------------------------------------------- simulate until converged

export interface Convergence {
  seeds: [string, string];
  tolerance: number;
  converged: boolean;
  metrics: { key: string; p80: [number, number]; p90: [number, number]; relDiff: number }[];
}

/**
 * Run `compute` on draws under the run's seed and under a second seed, and double the draws until the
 * P80 and P90 of every metric agree within the tolerance (docs/IN-PRACTICE.md section 8, recommendation 8),
 * up to `maxDraws`. Metrics are continuous quantities only: a count of serials moves in steps and cannot
 * converge to a percentage.
 */
export function simulate<T>(
  book: Book,
  o: { seed: string; n0: number; maxDraws: number; rho: number; tol: number },
  compute: (d: Draws) => T,
  metricsOf: (t: T) => Record<string, Float64Array>,
): { n: number; result: T; convergence: Convergence } {
  const varList = [...book.vars.values()];
  const seed2 = `${o.seed}:convergence`;
  const summaries = (m: Record<string, Float64Array>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, summarize(v)])) as Record<string, Summary>;
  const compare = (a: Record<string, Summary>, b: Record<string, Summary>) =>
    Object.keys(a).map((key) => {
      const x = a[key];
      const y = b[key];
      const scaleOf = Math.max(Math.abs(x.p50), x.p90 - x.p10, 1e-9);
      const rel = Math.max(Math.abs(x.p80 - y.p80), Math.abs(x.p90 - y.p90)) / scaleOf;
      return { key, p80: [r2(x.p80), r2(y.p80)] as [number, number], p90: [r2(x.p90), r2(y.p90)] as [number, number], relDiff: Math.round(rel * 1e6) / 1e6 };
    });
  const run = (seed: string, n: number) => {
    const t = compute(drawAll(varList, seed, n, o.rho, o.n0));
    return { t, m: summaries(metricsOf(t)) };
  };
  let n = o.n0;
  let r1 = run(o.seed, n);
  let metrics = compare(r1.m, run(seed2, n).m);
  while (!metrics.every((m) => m.relDiff <= o.tol) && n * 2 <= o.maxDraws) {
    n *= 2;
    r1 = run(o.seed, n);
    metrics = compare(r1.m, run(seed2, n).m);
  }
  const converged = metrics.every((m) => m.relDiff <= o.tol);
  if (!converged) book.flags.push({ kind: 'not_converged', severity: 'warn', message: `P80/P90 moved by more than ${o.tol * 100}% between seeds at ${n.toLocaleString('en-US')} draws, the most allowed; raise maxDraws.` });
  return { n, result: r1.t, convergence: { seeds: [o.seed, seed2], tolerance: o.tol, converged, metrics } };
}

export const isoRange = (s: { p10: number; p50: number; p90: number }) => ({ p10: dateOf(s.p10), p50: dateOf(s.p50), p90: dateOf(s.p90) });
