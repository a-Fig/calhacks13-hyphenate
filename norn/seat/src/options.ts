// The cost engineer seat's "find the best option" duty (#157). An ECR hides decisions: what happens
// to the old stock, which serial the change starts on, whether built aircraft are retrofitted, and
// whether to qualify together with another ECR that needs the same supplier slot. This file lists
// those options, runs the checks on each with one seed so they are paired, screens them for safety
// and policy in code, and recommends the cheapest one that passes.
//
// Hard rules kept here: an option is a set of decisions, never a typed dollar amount, so every number
// comes out of costCheck, timelineCheck or supplyCheck. The screen and the recommendation text are
// code, and an optional narration (not built) may not change a number.
import { costCheck, supplyCheck, timelineCheck } from '../../checks/src/index.ts';
import type { AssumptionOverride, Baseline, ChangeRequest, Disposition, StockLocation } from '../../checks/src/types.ts';

// ---------------------------------------------------------------- types

export type DispositionMode = 'filed' | 'scrap_all' | 'use_up_all';
export type RetrofitMode = 'filed' | 'none';

/** One decision inside an option. Decisions carry no money. */
export type Decision =
  | { kind: 'disposition'; mode: DispositionMode }
  | { kind: 'retrofit'; mode: RetrofitMode }
  | { kind: 'cut_in'; mode: 'after_use_up'; serial: number }
  | { kind: 'bundle'; with: string; constraint: string };

export interface Range { p10: number; p50: number; p90: number }
export interface Evidence { source: string; quote: string }
export interface Exclusion { rule: string; reason: string; evidence: Evidence[] }

export interface OptionResult {
  id: string;
  label: string;
  decisions: Decision[];
  /** The assumption overrides passed to the checks (a cut-in serial). Never a money value. */
  overrides: AssumptionOverride[];
  oneTime: Range;
  window12: Range;
  plan: Range;
  cutIn: { serial: number | null; date: string | null; placed: boolean };
  /** Weeks after the stated cut-in; null when the ECR states none the plan can place. */
  weeksLate: number | null;
  /** Difference against the ECR as filed, p50. */
  vsFiled: { oneTime: number; window12: number; plan: number; weeksLate: number | null };
  /** What bundling is worth, and what it does to the peer ECR, from the supply check. */
  bundle?: { peer: string; saving: Range; peerShiftWeeks: number | null; note: string };
  asFiled: boolean;
  eligible: boolean;
  exclusions: Exclusion[];
  notes: string[];
}

export interface OptionsReport {
  ecr: string;
  title: string;
  seed: string;
  draws: number;
  computedAt: string | null;
  basis: string;
  options: OptionResult[];
  recommended: string | null;
  recommendation: { text: string; tradeoffs: string[] } | null;
}

export interface OptionsOptions {
  seed: string;
  draws?: number;
  /** Other open ECRs, for bundling. Default: none. */
  peers?: ChangeRequest[];
  /** Ncr records, for the safety screen. */
  ncrs?: NcrLike[];
  computedAt?: string;
  /** Policy rules; defaults to DEFAULT_RULES. */
  rules?: PolicyRule[];
}

/** The free-text fields an ECR record may carry beyond the checks' ChangeRequest; read for the safety screen. */
export type EcrFacts = ChangeRequest & { title?: string; need?: string; failureData?: string; originatingNcr?: string };

export interface NcrLike { id: string; description: string; mrbDisposition?: string; item?: string }

// ---------------------------------------------------------------- policy rules (data)

export interface RuleContext {
  ecr: EcrFacts;
  ncr: NcrLike | undefined;
  /** What the option does. */
  keepsOldDesign: boolean;
  dropsRetrofit: boolean;
  texts: { source: string; text: string }[];
}

export interface PolicyRule {
  id: string;
  /** Which option behaviour the rule screens. */
  screens: 'keeps_old_design' | 'drops_retrofit';
  /** Words that say the change is a fix for a failure, or that the retrofit is mandatory. */
  triggers: RegExp;
  /** Words that lift the exclusion because the data shows the use-up was accepted. */
  accepted?: RegExp;
  /** Words that cancel an acceptance ("use as is" next to "not acceptable for flight"). */
  rejected?: RegExp;
  reason: string;
}

export const DEFAULT_RULES: PolicyRule[] = [
  {
    id: 'no-old-design-after-failure',
    screens: 'keeps_old_design',
    triggers: /crack|fatigue|fail(?:ure|ed|s)?\b|safety|non-?conform|flux loss|not acceptable for flight/i,
    accepted: /use as is|accepted for use|use-?up (?:is )?(?:accepted|approved)/i,
    rejected: /not acceptable|no flight|quarantin|rejected|scrap/i,
    reason: 'This change fixes a failure, so building or fitting more of the old design is not allowed unless certification accepted it.',
  },
  {
    id: 'retrofit-is-mandatory',
    screens: 'drops_retrofit',
    triggers: /mandatory|required|must be|no flight|flight restricted|until retrofit|not acceptable for flight|replace Rev/i,
    reason: 'The ECR or its non-conformance record makes the retrofit of built aircraft mandatory.',
  },
];

const sentenceWith = (text: string, re: RegExp): string | null => {
  const m = re.exec(text);
  if (!m) return null;
  const prev = text.lastIndexOf('. ', m.index);
  const start = prev === -1 ? 0 : prev + 2;
  const endAt = text.indexOf('. ', m.index);
  const s = text.slice(start, endAt === -1 ? undefined : endAt + 1).trim();
  return s.length > 260 ? `${s.slice(0, 257)}...` : s;
};

function screen(rules: PolicyRule[], ctx: RuleContext): { exclusions: Exclusion[]; allowed: string[] } {
  const out: Exclusion[] = [];
  const allowed: string[] = [];
  for (const r of rules) {
    if (r.screens === 'keeps_old_design' && !ctx.keepsOldDesign) continue;
    if (r.screens === 'drops_retrofit' && !ctx.dropsRetrofit) continue;
    const evidence: Evidence[] = [];
    for (const t of ctx.texts) {
      const q = sentenceWith(t.text, r.triggers);
      if (q) evidence.push({ source: t.source, quote: q });
    }
    if (ctx.ecr.originatingNcr && r.screens === 'keeps_old_design') evidence.unshift({ source: `${ctx.ecr.id} originatingNcr`, quote: `Filed after ${ctx.ecr.originatingNcr}, a non-conformance record.` });
    if (!evidence.length) continue;
    if (r.accepted) {
      // Certification's acceptance lives in the non-conformance disposition, and an explicit rejection beside it wins.
      const mrb = ctx.ncr?.mrbDisposition ?? '';
      const ok = r.accepted.test(mrb) && !(r.rejected?.test(mrb) ?? false);
      if (ok) { allowed.push(`Keeping the old design is allowed: ${ctx.ncr!.id} disposition: "${sentenceWith(mrb, r.accepted)}"`); continue; }
      const rej = r.rejected ? sentenceWith(mrb, r.rejected) : null;
      if (rej && ctx.ncr) evidence.unshift({ source: `${ctx.ncr.id} disposition`, quote: rej });
    }
    out.push({ rule: r.id, reason: r.reason, evidence: evidence.slice(0, 4) });
  }
  return { exclusions: out, allowed };
}

// ---------------------------------------------------------------- applying decisions

const STOCK: Record<Exclude<StockLocation, 'in_field'>, 'stores' | 'wip' | 'finishedGoods' | 'supplierFinished' | 'onOrder'> = {
  stores: 'stores', wip: 'wip', finished_goods: 'finishedGoods', supplier_finished: 'supplierFinished', on_order: 'onOrder',
};
const SITES = Object.keys(STOCK) as (keyof typeof STOCK)[];

function applyDisposition(baseline: Baseline, ecr: ChangeRequest, mode: DispositionMode): ChangeRequest {
  if (mode === 'filed') return ecr;
  const items = [...new Set(ecr.inventoryProposal.map((p) => p.item))];
  const keep = ecr.inventoryProposal.filter((p) => p.location === 'in_field');
  const rows: ChangeRequest['inventoryProposal'] = [...keep];
  for (const item of items) {
    const st = baseline.stock.find((s) => s.item === item);
    if (!st) continue;
    for (const loc of SITES) {
      if (!(st[STOCK[loc]] > 0)) continue;
      const d: Disposition = mode === 'use_up_all' ? 'use_until_depleted' : loc === 'on_order' ? 'cancel' : 'scrap';
      rows.push({ item, location: loc, disposition: d, note: mode === 'use_up_all' ? 'Option: use up the old stock.' : 'Option: scrap the old stock.' });
    }
  }
  return { ...ecr, inventoryProposal: rows };
}

function applyRetrofit(ecr: ChangeRequest, mode: RetrofitMode): ChangeRequest {
  if (mode === 'filed') return ecr;
  const { retrofit: _r, ...eff } = ecr.effectivity;
  return {
    ...ecr,
    effectivity: eff,
    inventoryProposal: ecr.inventoryProposal.filter((p) => p.location !== 'in_field'),
    costPage: { ...ecr.costPage, retrofit: [] },
  };
}

/**
 * What the proposal does with every location that holds stock, so two proposals that behave the same
 * compare equal. An undecided or unlisted location is counted as used up, as the cost check does.
 */
const effectiveKey = (baseline: Baseline, ecr: ChangeRequest) => {
  const out: string[] = [];
  for (const item of new Set(ecr.inventoryProposal.map((p) => p.item))) {
    const st = baseline.stock.find((x) => x.item === item);
    for (const loc of SITES) {
      if (!st || !(st[STOCK[loc]] > 0)) continue;
      const d = ecr.inventoryProposal.find((p) => p.item === item && p.location === loc)?.disposition;
      out.push(`${item}:${loc}:${d === 'scrap' || d === 'cancel' ? 'remove' : d === 'rework' ? 'rework' : 'use'}`);
    }
    if (ecr.inventoryProposal.some((p) => p.item === item && p.location === 'in_field')) out.push(`${item}:in_field`);
  }
  return out.sort().join('|');
};

const usesUp = (baseline: Baseline, ecr: ChangeRequest) => effectiveKey(baseline, ecr).includes(':use');

const hasRetrofit = (ecr: ChangeRequest) =>
  ecr.costPage.retrofit.length > 0 || ecr.inventoryProposal.some((p) => p.location === 'in_field' && p.disposition === 'mandatory_install');

// ---------------------------------------------------------------- numbers

const r2 = (x: number) => Math.round(x * 100) / 100;
const rng = (m: { p10: number; p50: number; p90: number }): Range => ({ p10: r2(m.p10), p50: r2(m.p50), p90: r2(m.p90) });
/** A range less a saving range, the two taken as independent (spreads add in quadrature). */
const minus = (a: Range, s: Range): Range => {
  const p50 = a.p50 - s.p50;
  return { p10: r2(p50 - Math.hypot(a.p50 - a.p10, s.p90 - s.p50)), p50: r2(p50), p90: r2(p50 + Math.hypot(a.p90 - a.p50, s.p50 - s.p10)) };
};
const weeks = (w: number) => (Math.abs(w) < 0.5 ? 'on the date stated' : `about ${Math.abs(Math.round(w))} week${Math.abs(Math.round(w)) === 1 ? '' : 's'} ${w > 0 ? 'after' : 'before'} the date stated`);
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

// ---------------------------------------------------------------- enumerate and run

interface Candidate { disposition: DispositionMode; retrofit: RetrofitMode; bundle: { peer: string; constraint: string } | null }

const DISP_LABEL: Record<DispositionMode, string> = { filed: 'Old stock as filed', scrap_all: 'Scrap all the old stock', use_up_all: 'Use up the old stock' };

export function evaluateOptions(baseline: Baseline, ecr: ChangeRequest, o: OptionsOptions): OptionsReport {
  const draws = o.draws ?? 10_000;
  const base = { seed: o.seed, draws };
  const rules = o.rules ?? DEFAULT_RULES;
  const ncr = o.ncrs?.find((n) => n.id === (ecr as EcrFacts).originatingNcr);
  const peers = (o.peers ?? []).filter((p) => p.id !== ecr.id);

  // Which peer shares a supplier slot, from the supply check itself.
  const baseSupply = peers.length ? supplyCheck(baseline, ecr, { ...base, peers }) : null;
  const bundleDef = baseSupply?.interaction?.bundles[0];
  const peerId = baseSupply?.interaction?.peers.find((p) => p.sharedSuppliers.length > 0)?.ecr;

  // Candidates: disposition x retrofit x bundle, with duplicates (same effective dispositions) removed.
  const seen = new Set<string>();
  const cands: Candidate[] = [];
  const retro: RetrofitMode[] = hasRetrofit(ecr) ? ['filed', 'none'] : ['filed'];
  const bundles: Candidate['bundle'][] = bundleDef && peerId ? [null, { peer: peerId, constraint: bundleDef.constraint }] : [null];
  for (const b of bundles) for (const retrofit of retro) for (const disposition of ['filed', 'scrap_all', 'use_up_all'] as DispositionMode[]) {
    const e = applyRetrofit(applyDisposition(baseline, ecr, disposition), retrofit);
    const key = effectiveKey(baseline, e) + retrofit + (b?.peer ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({ disposition, retrofit, bundle: b });
  }

  const results: OptionResult[] = cands.map((c) => {
    let e = applyRetrofit(applyDisposition(baseline, ecr, c.disposition), c.retrofit);
    const decisions: Decision[] = [];
    const overrides: AssumptionOverride[] = [];
    const notes: string[] = [];
    const tl = timelineCheck(baseline, e, base);
    const keepsOld = usesUp(baseline, e);
    if (c.disposition !== 'filed') decisions.push({ kind: 'disposition', mode: c.disposition });
    if (c.retrofit !== 'filed') decisions.push({ kind: 'retrofit', mode: c.retrofit });
    // Using the old stock up moves the cut-in to after it is built into aircraft: the timeline says which serial.
    const changedStock = effectiveKey(baseline, e) !== effectiveKey(baseline, ecr);
    if (keepsOld && changedStock && tl.cutIn.placed) {
      const serial = Math.round(tl.cutIn.serial.p50);
      decisions.push({ kind: 'cut_in', mode: 'after_use_up', serial });
      overrides.push({ id: `effectivity:${ecr.id}:${ecr.program}`, source: 'agent_estimated', value: serial, replacesGiven: true, rationale: `Option: cut in at S/N ${serial}, the first serial after the old stock is used up (timeline check).` });
    } else if (keepsOld && changedStock) {
      notes.push('Using the old stock up needs serials past the end of the volume plan, so no cut-in can be placed.');
    }
    const cost = costCheck(baseline, e, { ...base, assumptions: overrides });
    let oneTime = rng(cost.headline.oneTimeTotal);
    let window12 = rng(cost.headline.windowTotal);
    let plan = rng(cost.headline.planTotal);
    let late = tl.late?.weeks.p50 ?? null;
    let bundle: OptionResult['bundle'];
    if (c.bundle && bundleDef) {
      const s = rng(bundleDef.ownSaving);
      oneTime = minus(oneTime, s); window12 = minus(window12, s); plan = minus(plan, s);
      const peer = peers.find((p) => p.id === c.bundle!.peer)!;
      const back = supplyCheck(baseline, peer, { ...base, peers: [e] });
      const shift = back.interaction?.cutIn?.shiftWeeks.p50 ?? null;
      decisions.push({ kind: 'bundle', with: peer.id, constraint: c.bundle.constraint });
      bundle = { peer: peer.id, saving: s, peerShiftWeeks: shift, note: `Qualify with ${peer.id} in one lot of ${c.bundle.constraint}.${shift ? ` ${peer.id} then starts ${Math.round(shift)} weeks later than alone.` : ''}` };
      const withPeers = supplyCheck(baseline, e, { ...base, peers: [peer] }).interaction?.late?.weeks.p50;
      if (withPeers !== undefined) late = withPeers;
    }
    const f = ecr as EcrFacts;
    const ctx: RuleContext = {
      ecr: f, ncr, keepsOldDesign: keepsOld, dropsRetrofit: c.retrofit === 'none',
      texts: [
        { source: `${ecr.id} need`, text: f.need ?? '' },
        { source: `${ecr.id} failure data`, text: f.failureData ?? '' },
        ...(ncr ? [{ source: `${ncr.id} description`, text: ncr.description }, { source: `${ncr.id} disposition`, text: ncr.mrbDisposition ?? '' }] : []),
        ...ecr.inventoryProposal.filter((p) => p.location === 'in_field' && p.note).map((p) => ({ source: `${ecr.id} in-field proposal`, text: p.note! })),
        ...(ecr.effectivity.retrofit?.note ? [{ source: `${ecr.id} retrofit effectivity`, text: ecr.effectivity.retrofit.note }] : []),
      ],
    };
    const { exclusions, allowed } = screen(rules, ctx);
    notes.push(...allowed);
    const cutSerial = overrides[0] ? (overrides[0].value as number) : tl.cutIn.placed ? Math.round(tl.cutIn.serial.p50) : tl.cutIn.serial ? Math.round(tl.cutIn.serial.p50) : null;
    const label = [
      c.disposition === 'filed' && c.retrofit === 'filed' && !c.bundle ? 'As filed' : null,
      c.disposition !== 'filed' ? DISP_LABEL[c.disposition] : null,
      c.retrofit === 'none' ? 'Do not retrofit built aircraft' : null,
      c.bundle ? `Qualify with ${c.bundle.peer}` : null,
    ].filter(Boolean).join(', ');
    return {
      id: decisions.length ? decisions.map((d) => (d.kind === 'bundle' ? `bundle-${d.with}` : `${d.kind}-${'mode' in d ? d.mode : ''}`)).join('+') : 'as-filed',
      label, decisions, overrides, oneTime, window12, plan,
      cutIn: { serial: cutSerial, date: tl.cutIn.date?.p50 ?? null, placed: tl.cutIn.placed },
      weeksLate: late === null ? null : r2(late),
      vsFiled: { oneTime: 0, window12: 0, plan: 0, weeksLate: null },
      ...(bundle ? { bundle } : {}),
      asFiled: decisions.length === 0, eligible: exclusions.length === 0, exclusions, notes,
    };
  });

  const filed = results.find((r) => r.asFiled)!;
  for (const r of results) {
    r.vsFiled = {
      oneTime: r2(r.oneTime.p50 - filed.oneTime.p50), window12: r2(r.window12.p50 - filed.window12.p50), plan: r2(r.plan.p50 - filed.plan.p50),
      weeksLate: r.weeksLate !== null && filed.weeksLate !== null ? r2(r.weeksLate - filed.weeksLate) : null,
    };
  }
  // As filed first, then by 12-month total.
  results.sort((a, b) => Number(b.asFiled) - Number(a.asFiled) || a.window12.p50 - b.window12.p50);
  const eligible = results.filter((r) => r.eligible);
  const best = [...eligible].sort((a, b) => a.window12.p50 - b.window12.p50 || Number(b.asFiled) - Number(a.asFiled))[0] ?? null;
  return {
    ecr: ecr.id, title: (ecr as EcrFacts).title ?? ecr.id, seed: o.seed, draws, computedAt: o.computedAt ?? null,
    basis: 'Options are decisions on the ECR run through the same cost, timeline and supply checks with one seed. Ranked on the 12-month total at p50.',
    options: results, recommended: best?.id ?? null,
    recommendation: best ? recommend(best, filed, results) : null,
  };
}

// ---------------------------------------------------------------- the recommendation, from a template

function recommend(best: OptionResult, filed: OptionResult, all: OptionResult[]): { text: string; tradeoffs: string[] } {
  const excluded = all.filter((r) => !r.eligible);
  const cheaperExcluded = excluded.filter((r) => r.window12.p50 < best.window12.p50).sort((a, b) => a.window12.p50 - b.window12.p50)[0];
  const tradeoffs: string[] = [];
  if (best.asFiled) tradeoffs.push(`No eligible option is cheaper than the ECR as filed: ${usd(best.oneTime.p50)} one-time at p50 (${usd(best.oneTime.p10)} to ${usd(best.oneTime.p90)}), ${usd(best.window12.p50)} over 12 months.`);
  else tradeoffs.push(`Cost: "${best.label}" costs ${usd(Math.abs(best.vsFiled.window12))} ${best.vsFiled.window12 < 0 ? 'less' : 'more'} over 12 months than the ECR as filed (${usd(best.window12.p50)} against ${usd(filed.window12.p50)} at p50).`);
  if (best.weeksLate !== null) {
    const d = best.vsFiled.weeksLate;
    tradeoffs.push(`Schedule: the change reaches the line ${weeks(best.weeksLate)}${d ? `, ${Math.abs(Math.round(d))} weeks ${d < 0 ? 'sooner' : 'later'} than as filed` : ''}.`);
  }
  if (best.bundle?.peerShiftWeeks) tradeoffs.push(`Risk: ${best.bundle.peer} starts ${Math.round(best.bundle.peerShiftWeeks)} weeks later because the two share one qualification slot.`);
  if (cheaperExcluded) tradeoffs.push(`Cheaper but not allowed: "${cheaperExcluded.label}" would save ${usd(best.window12.p50 - cheaperExcluded.window12.p50)} over 12 months; ${cheaperExcluded.exclusions[0].reason.toLowerCase()}`);
  return { text: `Recommended: ${best.asFiled ? 'the ECR as filed' : best.label}. ${tradeoffs.join(' ')}`, tradeoffs };
}

/** The options as a plain-text table, for the CLI. */
export function renderOptions(r: OptionsReport): string {
  const lines = [`${r.ecr}: ${r.title}`, `seed ${r.seed}, ${r.draws} draws${r.computedAt ? `, computed ${r.computedAt}` : ''}`, ''];
  for (const o of r.options) {
    const tag = o.id === r.recommended ? 'RECOMMENDED' : o.eligible ? 'eligible' : 'EXCLUDED';
    lines.push(`[${tag}] ${o.label}`);
    lines.push(`  one-time ${usd(o.oneTime.p50)} (${usd(o.oneTime.p10)} to ${usd(o.oneTime.p90)}), 12 months ${usd(o.window12.p50)}, plan ${usd(o.plan.p50)}`);
    lines.push(`  vs filed: one-time ${usd(o.vsFiled.oneTime)}, 12 months ${usd(o.vsFiled.window12)}, plan ${usd(o.vsFiled.plan)}`);
    lines.push(`  cut-in S/N ${o.cutIn.serial ?? '?'}${o.cutIn.date ? ` about ${o.cutIn.date}` : ''}${o.weeksLate !== null ? `, ${weeks(o.weeksLate)}` : ''}`);
    for (const x of o.exclusions) { lines.push(`  excluded by ${x.rule}: ${x.reason}`); for (const e of x.evidence) lines.push(`    ${e.source}: "${e.quote}"`); }
    for (const n of [...o.notes, ...(o.bundle ? [o.bundle.note] : [])]) lines.push(`  note: ${n}`);
  }
  if (r.recommendation) lines.push('', r.recommendation.text);
  return lines.join('\n');
}
