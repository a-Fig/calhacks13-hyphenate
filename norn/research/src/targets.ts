// Which assumptions are worth a researcher's time. A pure function of a finished check result.
//
// Candidates are the inputs the check filled in itself: a Norn default with a distribution
// (source 'default'), or a cost-page row left blank (needsEstimate, counted as $0 until someone
// estimates it). They are ranked by their swing on the year-one total, the sensitivity the cost
// check already computes (`drivers`: the total with that input at its p10 and at its p90, all
// others at their stated value). The check keeps only its top 8 drivers, so a candidate outside
// them can be measured with the optional `rerun` callback, which does the same one-at-a-time
// swing by running the check again. A blank row has no spread to move, so its swing is unmeasured:
// it ranks after every measured input, in the cost page's block order (production, retrofit, logistics support, other).
//
// Questions are phrased in generic terms: a quantity and the kind of part, never a part number, a
// supplier, a person, a program or the company's name. Part numbers appear in input ids, so the
// agent sees an opaque key (T1, T2, ...) instead.

import { quantileOf, type Dist, type InputRecord } from '../../checks/src/index.ts';
import type { CostCheckResult, TimelineResult } from '../../checks/src/index.ts';
import { findLeaks, type Identifier } from './leak.ts';
import { UNIT_OF, type Target, type TargetKind } from './types.ts';

export interface TargetContext {
  /** The material of the parts that would be scrapped, e.g. '7075 aluminum alloy'. Generic. */
  material?: string;
  massKg?: number;
}

export interface PickOptions {
  /** How many targets to return. Default 3. */
  n?: number;
  context?: TargetContext;
  /** The timeline check's result; its defaulted lead times become weeks targets. */
  timeline?: TimelineResult;
  /** Swing of the year-one total for a candidate the cost result's top-8 drivers lack: run the check with the input at q and return the total. */
  rerun?: (inputId: string, dist: Dist, q: number) => number;
  /** When given, a question that would name any of them falls back to a plain wording. */
  identifiers?: Identifier[];
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const money = (x: number) => `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (x: number) => `${(Math.round(x * 10000) / 100).toString()}%`;

/** 'Delay cost of holding S/N 011-014 at the station (x)' -> 'Delay cost of holding at the station'. */
export function genericLabel(label: string): string {
  return label
    .replace(/\bS\/N\s*\d+(?:\s*(?:-|–|to|and|,)\s*\d+)*/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function blockOf(id: string): string | null {
  const m = /^cost:[^:]+:([A-Za-z]+):/.exec(id);
  return m ? m[1]! : null;
}

const BLOCK_WORDS: Record<string, string> = {
  production: 'a production change', retrofit: 'retrofitting aircraft already built', logisticsSupport: 'logistics support (spares, manuals, training)', other: 'an engineering change',
};

function kindOf(rec: InputRecord): TargetKind | null {
  if (rec.needsEstimate) return 'usd';
  if (rec.source !== 'default' || !rec.dist || rec.dist.kind === 'point') return null;
  if (/^(recovery|cancel):/.test(rec.id)) return 'share';
  return null;
}

function questionFor(rec: InputRecord, kind: TargetKind, ctx: TargetContext, unitPrice: number | null): { label: string; question: string } {
  if (/^recovery:/.test(rec.id)) {
    const part = [ctx.material ? `a machined ${ctx.material} part` : 'a machined metal part', ctx.massKg ? `weighing about ${ctx.massKg} kg` : '', unitPrice ? `bought at about ${money(unitPrice)} each` : ''].filter(Boolean).join(' ');
    return {
      label: 'Share of the purchase price recovered when scrapped parts are sold',
      question: `An aircraft maker scraps ${part}. What share of the purchase price is typically recovered by selling the scrapped parts (as scrap metal or any other resale)? Give a fraction between 0 and 1. Look for current scrap prices per kilogram or pound for this material and for typical resale or return terms for scrapped aerospace parts.`,
    };
  }
  if (/^cancel:/.test(rec.id)) {
    return {
      label: 'Charge for cancelling an open purchase order, as a share of price',
      question: 'An aircraft maker cancels an open purchase order for machined parts that the supplier has not started. What cancellation charge, as a fraction of the part price, do suppliers typically ask in aerospace? Give a fraction between 0 and 1.',
    };
  }
  if (rec.needsEstimate) {
    const label = genericLabel(rec.label);
    const block = blockOf(rec.id);
    const where = block && BLOCK_WORDS[block] ? ` This is part of the cost of ${BLOCK_WORDS[block]}.` : '';
    return {
      label,
      question: `What is a realistic one-time cost in US dollars for: ${label.charAt(0).toLowerCase()}${label.slice(1)}?${where} If the cost depends on quantities you do not know, research the unit rates or typical durations that would let a person scale it, and say so.`,
    };
  }
  return { label: genericLabel(rec.label), question: `What is a realistic value for: ${genericLabel(rec.label)}?` };
}

function weeksQuestion(): { label: string; question: string } {
  return {
    label: 'Supplier lead time, in weeks',
    question: 'How many weeks do aerospace suppliers typically quote from purchase order to delivery for a small machined aluminum part, first lot after a drawing revision? Give weeks.',
  };
}

export function pickTargets(cost: CostCheckResult, opts: PickOptions = {}): Target[] {
  const n = opts.n ?? 3;
  const ctx = opts.context ?? {};
  const driverSwing = new Map(cost.drivers.map((d) => [d.id, d.swing]));
  const unitPrice = cost.inventory[0]?.rows[0]?.unitValue ?? null;

  interface Cand { rec: InputRecord; kind: TargetKind; swing: number | null; basis: Target['swingBasis']; order: number }
  const cands: Cand[] = [];
  cost.inputs.forEach((rec, order) => {
    const kind = kindOf(rec);
    if (!kind) return;
    let swing: number | null = null;
    let basis: Target['swingBasis'] = 'unmeasured';
    if (driverSwing.has(rec.id)) {
      swing = driverSwing.get(rec.id)!;
      basis = 'driver';
    } else if (opts.rerun && rec.dist && rec.dist.kind !== 'point') {
      const lo = opts.rerun(rec.id, rec.dist, 0.1);
      const hi = opts.rerun(rec.id, rec.dist, 0.9);
      swing = Math.round(Math.abs(hi - lo) * 100) / 100;
      basis = 'rerun';
    }
    cands.push({ rec, kind, swing, basis, order });
  });
  // Weeks targets from the timeline check: defaulted lead times only. The timeline result carries no per-input swing.
  for (const rec of opts.timeline?.inputs ?? []) {
    if (rec.source === 'default' && rec.dist && rec.dist.kind !== 'point' && /:lead$/.test(rec.id)) {
      cands.push({ rec, kind: 'weeks', swing: null, basis: 'unmeasured', order: cost.inputs.length + cands.length });
    }
  }

  const blockRank = (id: string) => ['production', 'retrofit', 'logisticsSupport', 'other'].indexOf(blockOf(id) ?? '') >>> 0;
  cands.sort((a, b) => (b.swing ?? -1) - (a.swing ?? -1) || blockRank(a.rec.id) - blockRank(b.rec.id) || a.order - b.order);

  return cands.slice(0, n).map((c, i): Target => {
    const q = c.kind === 'weeks' ? weeksQuestion() : questionFor(c.rec, c.kind, ctx, unitPrice);
    let { label, question } = q;
    if (opts.identifiers && findLeaks(`${label} ${question}`, opts.identifiers).length > 0) {
      label = c.kind === 'share' ? 'A recovery or charge share' : c.kind === 'weeks' ? 'A lead time' : 'A one-time cost';
      question = `What is a realistic ${c.kind === 'share' ? 'share (a fraction between 0 and 1)' : c.kind === 'weeks' ? 'number of weeks' : 'one-time cost in US dollars'} for an aircraft maker's engineering change? Say what it depends on.`;
    }
    const d = c.rec.dist;
    const blank = c.rec.needsEstimate || !d || d.kind === 'point';
    return {
      key: `T${i + 1}`,
      inputId: c.rec.id,
      kind: c.kind,
      unit: UNIT_OF[c.kind],
      label,
      question,
      current: blank ? { blank: true } : { p10: r4(quantileOf(d!, 0.1)), p50: r4(quantileOf(d!, 0.5)), p90: r4(quantileOf(d!, 0.9)) },
      currentNote: c.rec.needsEstimate
        ? 'Left blank on the cost page; counted as $0 until estimated.'
        : `A Norn default${d && d.kind === 'pert' ? `, PERT(${pct(d.min)}, ${pct(d.mode)}, ${pct(d.max)})` : ''}.`,
      swing: c.swing,
      swingBasis: c.basis,
    };
  });
}
