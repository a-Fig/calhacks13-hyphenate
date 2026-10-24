// The mock compute behind the fixtures: a small seeded Monte Carlo, so that every range on screen
// comes from the same draws. Rows, totals, the S-curve and the tornado agree with each other, and a
// total is not a sum of percentiles, as in a real cost-risk run (GAO-20-195G ch. 12).
//
// This stands in for the checks library (#41). Nothing on screen reads it directly: it builds the
// ImpactAssessment pieces in ./types.ts, and the live adapter will build the same pieces.
import type {
  BlockSubtotal, CostBlock, CostRow, Driver, Evidence, Figure, LikelihoodWord, SCurve, Trace,
  TraceAssumption, TraceInput, TraceSource, Unit,
} from './types.ts';

export type X = Record<string, number>;

/** Quantile points of an input. lo and hi are the 0th and 100th percentile; defaults extend the tails. */
export interface Q { p10: number; p50: number; p90: number; lo?: number; hi?: number }

export interface TraceBody {
  summary: string;
  sources: TraceSource[];
  inputs?: TraceInput[];
  assumptions?: TraceAssumption[];
  formula?: { expression: string; worked?: string };
  value?: { text: string; range?: string };
  check?: string;
  actor?: string;
  onBehalfOf?: string;
  note?: string;
}

export interface InputDef {
  key: string;
  label: string;
  q: Q;
  unit: Unit;
  evidence: Evidence;
  fmt: (v: number) => string;
  trace: TraceBody;
}

export interface RowDef {
  id: string;
  block: CostBlock;
  label: string;
  note?: string;
  evidence: Evidence;
  /** Year-1 total of the line, from one draw of the inputs. */
  value: (x: X) => number;
  /** Per-unit amount and units, for lines priced per unit. */
  unit?: { value: (x: X) => number; qty: number; evidence: Evidence; traceId?: string };
  /** Show the amount in the One-time column. */
  oneTime?: boolean;
  /** Rounding step for the row's percentiles in USD; default 10. */
  step?: number;
  trace: TraceBody;
}

export interface ModelDef {
  seed: number;
  draws: number;
  at: string;
  inputs: InputDef[];
  rows: RowDef[];
  /** Extra quantities worth reading per draw, e.g. the cut-in date. */
  extras: Record<string, (x: X) => number>;
  /** Inputs the tornado may show, by key. */
  driverKeys: string[];
  /** Trace text for the subtotals and the net total. */
  netTrace: TraceBody;
  subtotalTrace: (block: CostBlock) => TraceBody;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise-linear inverse CDF through the given quantile points. */
function quantileFn(q: Q): (u: number) => number {
  const lo = q.lo ?? q.p10 - 0.6 * (q.p50 - q.p10);
  const hi = q.hi ?? q.p90 + 0.6 * (q.p90 - q.p50);
  const pts: [number, number][] = [[0, lo], [0.1, q.p10], [0.5, q.p50], [0.9, q.p90], [1, hi]];
  return u => {
    for (let i = 1; i < pts.length; i++) {
      if (u <= pts[i][0]) {
        const [u0, x0] = pts[i - 1];
        const [u1, x1] = pts[i];
        return x0 + ((u - u0) / (u1 - u0)) * (x1 - x0);
      }
    }
    return hi;
  };
}

function pct(sorted: Float64Array, p: number): number {
  const i = p * (sorted.length - 1);
  const a = Math.floor(i);
  const b = Math.min(sorted.length - 1, a + 1);
  return sorted[a] + (i - a) * (sorted[b] - sorted[a]);
}

function round(unit: Unit, v: number, step: number): number {
  if (unit === 'date') return Math.round(v / 86400000) * 86400000;
  if (Math.abs(v) < 1000) return Math.round(v * 100) / 100;
  return Math.round(v / step) * step;
}

export interface Quantity { p10: number; p50: number; p90: number }

export interface ModelResult {
  rows: CostRow[];
  subtotals: BlockSubtotal[];
  net: Figure;
  sCurve: SCurve;
  /** The tornado inputs, widest swing first. */
  drivers: Driver[];
  traces: Record<string, Trace>;
  /** Percentiles of an extra quantity, as a figure. */
  extra: (name: string, unit: Unit, evidence?: Evidence) => Figure;
  /** Share of draws where the predicate holds. */
  prob: (pred: (extras: Record<string, number>) => boolean) => number;
  /** The inputs at their p50. */
  base: X;
  /** Year-1 total with some inputs moved and the rest at their p50. */
  totalAt: (over?: X) => number;
  /** A trace built the same way as the model's own, for numbers the fixture computes outside it. */
  makeTrace: (id: string, title: string, ev: Evidence, b: TraceBody) => Trace;
}

export function runModel(def: ModelDef): ModelResult {
  const rng = mulberry32(def.seed);
  const qf = def.inputs.map(i => [i.key, quantileFn(i.q)] as const);
  const base: X = Object.fromEntries(def.inputs.map(i => [i.key, i.q.p50]));
  const n = def.draws;

  // Latin hypercube: each input's n draws are spread evenly over its distribution, so the medians
  // land on the inputs' medians and 10,000 draws are enough to quote to the dollar.
  const strata = def.inputs.map(() => {
    const p = new Uint32Array(n).map((_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  });

  const rowVals = def.rows.map(() => new Float64Array(n));
  const unitVals = def.rows.map(r => (r.unit ? new Float64Array(n) : null));
  const total = new Float64Array(n);
  const blockVals: Partial<Record<CostBlock, Float64Array>> = {};
  const extraVals: Record<string, Float64Array> = Object.fromEntries(
    Object.keys(def.extras).map(k => [k, new Float64Array(n)])
  );

  for (let d = 0; d < n; d++) {
    const x: X = {};
    qf.forEach(([k, f], i) => { x[k] = f((strata[i][d] + rng()) / n); });
    let t = 0;
    def.rows.forEach((r, i) => {
      const v = r.value(x);
      rowVals[i][d] = v;
      if (r.unit) unitVals[i]![d] = r.unit.value(x);
      t += v;
      (blockVals[r.block] ??= new Float64Array(n))[d] += v;
    });
    total[d] = t;
    for (const [k, f] of Object.entries(def.extras)) extraVals[k][d] = f(x);
  }

  const q3 = (arr: Float64Array): Quantity => {
    const s = Float64Array.from(arr).sort();
    return { p10: pct(s, 0.1), p50: pct(s, 0.5), p90: pct(s, 0.9) };
  };
  const fig = (id: string, unit: Unit, ev: Evidence, q: Quantity, step: number): Figure => {
    const exact = Math.abs(q.p90 - q.p10) < 1e-6;
    // Rows and totals round to their step (whole dollars at least); per-unit amounts and exact quotes keep cents when small.
    const rd = (v: number) =>
      unit !== 'usd' ? round(unit, v, step)
        : step >= 10 ? Math.round(v / step) * step
        : exact || Math.abs(v) < 100 ? Math.round(v * 100) / 100
        : Math.round(v);
    const p10 = rd(q.p10), p50 = rd(q.p50), p90 = rd(q.p90);
    return p10 === p50 && p50 === p90 ? { id, unit, p50, evidence: ev } : { id, unit, p10, p50, p90, evidence: ev };
  };
  const traces: Record<string, Trace> = {};
  const addTrace = (id: string, title: string, ev: Evidence, b: TraceBody, check: string) => {
    traces[id] = {
      id, title, evidence: ev, summary: b.summary, value: b.value, sources: b.sources, inputs: b.inputs ?? [],
      assumptions: b.assumptions ?? [], formula: b.formula,
      producedBy: {
        check: b.check ?? check,
        actor: b.actor ?? 'Cost check',
        onBehalfOf: b.onBehalfOf ?? 'Norn, automatically',
        at: def.at,
        note: b.note ?? `Mock compute: ${n.toLocaleString('en-US')} draws, seed ${def.seed}`,
      },
    };
  };

  // Rows.
  const rows: CostRow[] = def.rows.map((r, i) => {
    const tot = fig(r.id, 'usd', r.evidence, q3(rowVals[i]), r.step ?? 10);
    addTrace(r.id, r.label, r.evidence, r.trace, 'Cost (S2)');
    const row: CostRow = { id: r.id, block: r.block, label: r.label, note: r.note, total: tot };
    if (r.oneTime) row.oneTime = tot;
    if (r.unit) {
      row.unitCost = fig(r.unit.traceId ?? r.id, 'usd', r.unit.evidence, q3(unitVals[i]!), 1);
      row.quantity = r.unit.qty;
    }
    return row;
  });

  // Subtotals and net.
  const subtotals: BlockSubtotal[] = (['production', 'retrofit', 'logistics', 'other'] as CostBlock[])
    .filter(b => blockVals[b])
    .map(b => {
      const id = `sub.${b}`;
      const f = fig(id, 'usd', 'computation', q3(blockVals[b]!), 100);
      const body = def.subtotalTrace(b);
      const rowIns: TraceInput[] = def.rows.filter(r => r.block === b).map(r => {
        const row = rows.find(z => z.id === r.id)!;
        return { label: r.label, display: row.total.p50 === 0 ? '$0' : usd(row.total.p50), evidence: r.evidence, traceId: r.id };
      });
      addTrace(id, `${b[0].toUpperCase()}${b.slice(1)} subtotal`, 'computation', { ...body, inputs: [...(body.inputs ?? []), ...rowIns] }, 'Cost (S2)');
      return { block: b, total: f };
    });
  const net = fig('net', 'usd', 'computation', q3(total), 100);
  addTrace('net', 'Year-1 total', 'computation', {
    ...def.netTrace,
    inputs: [...(def.netTrace.inputs ?? []), ...subtotals.map(s => ({
      label: `${s.block[0].toUpperCase()}${s.block.slice(1)}`, display: usd(s.total.p50), evidence: 'computation' as Evidence, traceId: s.total.id,
    }))],
  }, 'Cost (S2)');

  // Inputs (their own traces).
  for (const i of def.inputs) {
    const q = i.q;
    addTrace(`in.${i.key}`, i.label, i.evidence, {
      ...i.trace,
      value: i.trace.value ?? { text: i.fmt(q.p50), range: q.p10 !== q.p90 ? `${i.fmt(q.p10)} – ${i.fmt(q.p90)}` : undefined },
    }, 'Inputs');
  }

  // S-curve.
  const sorted = Float64Array.from(total).sort();
  const points: { x: number; y: number }[] = [];
  for (let k = 1; k <= 99; k++) points.push({ x: round('usd', pct(sorted, k / 100), 10), y: k / 100 });
  const sum = (x: X) => def.rows.reduce((s, r) => s + r.value(x), 0);
  const pe = sum(base);
  let below = 0;
  for (let d = 0; d < n; d++) if (total[d] <= pe) below++;
  const sCurve: SCurve = {
    points,
    pointEstimate: { x: round('usd', pe, 10), y: below / n },
    p10: net.p10 ?? net.p50, p50: net.p50, p90: net.p90 ?? net.p50, draws: n,
  };

  // Tornado: each input alone at its p10 and p90, the others at their p50.
  const drivers: Driver[] = def.driverKeys.map(k => {
    const i = def.inputs.find(z => z.key === k)!;
    return {
      id: `in.${k}`, label: i.label, evidence: i.evidence,
      lowLabel: i.fmt(i.q.p10), highLabel: i.fmt(i.q.p90),
      low: round('usd', sum({ ...base, [k]: i.q.p10 }), 10),
      high: round('usd', sum({ ...base, [k]: i.q.p90 }), 10),
    };
  }).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));

  const extra = (name: string, unit: Unit, evidence: Evidence = 'computation') =>
    fig(`x.${name}`, unit, evidence, q3(extraVals[name]), 1);
  const prob = (pred: (e: Record<string, number>) => boolean) => {
    let c = 0;
    for (let d = 0; d < n; d++) {
      const e: Record<string, number> = {};
      for (const k of Object.keys(extraVals)) e[k] = extraVals[k][d];
      if (pred(e)) c++;
    }
    return c / n;
  };

  const makeTrace = (id: string, title: string, ev: Evidence, b: TraceBody) => {
    addTrace(id, title, ev, b, b.check ?? 'Impact statement (S5)');
    return traces[id];
  };
  return { rows, subtotals, net, sCurve, drivers, traces, extra, prob, base, totalAt: (o = {}) => sum({ ...base, ...o }), makeTrace };
}

const usd = (v: number) =>
  (v < 0 ? '(' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (v < 0 ? ')' : '');

/** ICD 203 words by probability (docs/GLOSSARY.md). */
export function likelihoodWord(p: number): LikelihoodWord {
  if (p < 0.05) return 'almost no chance';
  if (p < 0.2) return 'very unlikely';
  if (p < 0.45) return 'unlikely';
  if (p < 0.55) return 'roughly even';
  if (p < 0.8) return 'likely';
  if (p < 0.95) return 'very likely';
  return 'almost certain';
}
