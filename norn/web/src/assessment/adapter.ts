// The adapter seam: the checks' stored rows in, the screens' view-model out.
//
// `rows` is what the state layer keeps in `check_result` for an ECR: the CheckResultRow[] that
// costCheckRows() in norn/checks/src/rows.ts makes (one row per number with p10/p50/p90, the point
// estimate, mean and trace in `detailJson`, and a `detail` row with the inputs, flags, drivers and
// effectivity). Nothing here invents a number: every Figure is a row, and what the checks do not
// give (a cut-in range, supply risk, the change class) is left to the narrative layer in ./mock.
//
// The live path is: read the rows from SpacetimeDB, call fromChecks(), and compose the result with
// the narrative parts. The mock fixtures run through the same function: they are the real checks'
// output on Bowman's dataset, saved by web/scripts/make-fixtures.ts.
import type { Dist } from '../../../checks/src/dist.ts';
import type { CheckResultRow } from '../../../checks/src/rows.ts';
import type { Flag, InputRecord, MonthStr } from '../../../checks/src/types.ts';
import { fitQuantiles, likelihoodWord, Z90 } from './fit.ts';
import type {
  CostBlock, CostRow, CostSection, CutIn, Driver, Evidence, Figure, Headline, Origin, SCurve, Trace, TraceInput,
  TraceSource,
} from './types.ts';
import { unitText, usdK } from '../ui/fmt.ts';

/** What fromChecks gives back: everything the checks can say. */
export interface ChecksView {
  headline: Headline;
  cost: CostSection;
  cutIn: CutIn;
  sCurve: SCurve | undefined;
  /** Every driver the checks found, the widest swing first. */
  drivers: Driver[];
  traces: Record<string, Trace>;
  flags: Flag[];
  /** The ECR's own row for a given cost-page line: its id, so a later level can name it. */
  rowIds: string[];
}

interface Money {
  p10: number; p50: number; p90: number; mean: number; point: number;
  trace: { formula: string; uses: { id: string; source: Origin }[]; evidence: 'computation' };
}
interface LineDetail {
  point: number; mean: number; trace: Money['trace'];
  block: CostBlock; recurring: boolean; basis: string; quantity: number | null;
  oneTime: Money | null; unitCost: Money | null; needsEstimate?: boolean;
}
interface DriverDetail { id: string; label: string; kind: 'input' | 'decision'; low: number; high: number; swing: number }
interface Detail {
  codeVersion: string; seed: string; draws: number; correlation: number;
  window: { from: MonthStr | null; months: number };
  inputs: InputRecord[]; flags: Flag[]; drivers: DriverDetail[];
  effectivity: { id: string; program: string; basis: string; cutInSerial: number; cutInMonth: MonthStr | null; source: Origin; rationale: string }[];
}

const BLOCKS: CostBlock[] = ['production', 'retrofit', 'logisticsSupport', 'other'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' as "Nov 2026". */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const addMonths = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** The class a row's number belongs to: quotes are facts, estimates and defaults assumptions, code a computation. */
function evidenceOfBasis(basis: string, needsEstimate?: boolean): Evidence {
  if (needsEstimate) return 'assumption';
  if (basis === 'supplier_quote' || basis === 'given') return 'fact';
  if (basis === 'computed') return 'computation';
  return 'assumption'; // engineer_estimate, agent_estimated, default
}

const BASIS_TEXT: Record<string, string> = {
  supplier_quote: 'From the supplier’s quote',
  engineer_estimate: 'The originator’s estimate',
  agent_estimated: 'Norn’s agent estimate',
  default: 'A default',
  given: 'Given',
  computed: 'Computed from the BOM delta and the volume plan',
};

function figure(r: CheckResultRow, id: string, evidence: Evidence): Figure {
  const d = JSON.parse(r.detailJson) as { point?: number; mean?: number };
  return makeFigure(id, r, d.point, d.mean, evidence);
}
function makeFigure(id: string, m: { p10: number; p50: number; p90: number }, point: number | undefined, mean: number | undefined, evidence: Evidence): Figure {
  const exact = m.p10 === m.p90;
  return { id, unit: 'usd', p50: m.p50, ...(exact ? {} : { p10: m.p10, p90: m.p90 }), ...(point !== undefined ? { point } : {}), ...(mean !== undefined ? { mean } : {}), evidence };
}

// ---------------------------------------------------------------- inputs, as the panel shows them

const money = (v: number) => unitText('usd', v, 'full');
const pctText = (v: number) => `${Math.round(v * 1000) / 10}%`;

function distRange(d: Dist): { mid: number; lo: number; hi: number } | null {
  switch (d.kind) {
    case 'point': return null;
    case 'lognormal': return { mid: d.median, lo: d.median * Math.exp(-Z90 * d.sigmaLow), hi: d.median * Math.exp(Z90 * d.sigmaHigh) };
    default: return { mid: d.mode, lo: d.min, hi: d.max };
  }
}

/** An input record as the panel shows it: its value, and its range when it has one. */
export function describeInput(rec: InputRecord): { text: string; range?: string } {
  const kind = rec.id.split(':')[0];
  const isMultiplier = rec.dist ? Math.abs((distRange(rec.dist)?.mid ?? 0) - 1) < 1e-9 : false;
  const fmt = (v: number) =>
    isMultiplier ? `×${v.toFixed(2)}`
    : kind === 'cost' || kind === 'quote' ? money(v)
    : kind === 'recovery' || kind === 'cancel' ? pctText(v)
    : kind === 'price' ? `×${v.toFixed(3)}`
    : kind === 'effectivity' ? `S/N ${v}`
    : Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
  const r = rec.dist ? distRange(rec.dist) : null;
  if (r) return { text: fmt(r.mid), range: `${fmt(r.lo)} – ${fmt(r.hi)}` };
  if (typeof rec.value === 'number') return { text: fmt(rec.value) };
  if (rec.value === 'not_provided') return { text: 'Left blank' };
  return { text: rec.value ?? '' };
}

const sourceSystem = (ref = ''): TraceSource['system'] =>
  /quote|^Q-/i.test(ref) ? 'Quote' : /^ECR|^NCR/.test(ref) ? 'PLM' : /baseline|dataset|ERP|sourcing|stock|volume/i.test(ref) ? 'ERP' : /default/i.test(ref) ? 'Policy' : 'Norn';

// ---------------------------------------------------------------- the adapter

export function fromChecks(rows: CheckResultRow[]): ChecksView {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const detailRow = byKey.get('detail');
  if (!detailRow) throw new Error('fromChecks: the rows have no `detail` row');
  const detail = JSON.parse(detailRow.detailJson) as Detail;
  const inputs = new Map(detail.inputs.map(i => [i.id, i]));
  const need = (k: string) => {
    const r = byKey.get(k);
    if (!r) throw new Error(`fromChecks: no ${k} row`);
    return r;
  };

  const traces: Record<string, Trace> = {};
  const flagFor = new Map(detail.flags.filter(f => f.ref).map(f => [f.ref!, f]));

  // An input's own trace, so the panel can drill from a formula into what it used.
  const inputTrace = (id: string): string => {
    const tid = `in:${id}`;
    if (traces[tid]) return tid;
    const rec = inputs.get(id);
    const d = rec ? describeInput(rec) : { text: '' };
    const evidence: Evidence = rec?.source === 'given' ? 'fact' : 'assumption';
    traces[tid] = {
      id: tid,
      title: (rec?.label ?? id) + (id.startsWith('row:') ? ', as filed' : ''),
      evidence,
      summary: rec?.rationale ?? (rec?.ref ? `Read from ${rec.ref}.` : ''),
      value: { text: d.text, ...(d.range ? { range: d.range } : {}) },
      sources: rec?.ref ? [{ system: sourceSystem(rec.ref), ref: rec.ref }] : undefined,
      inputs: [],
      assumptions: rec && rec.source !== 'given'
        ? [{ label: rec.label, display: d.text + (d.range ? ` (${d.range})` : ''), origin: rec.source, source: rec.rationale ?? rec.ref ?? 'Norn configuration' }]
        : [],
    };
    return tid;
  };

  const traceOf = (id: string, title: string, evidence: Evidence, m: Money | undefined, summary: string, extra: Partial<Trace> = {}): void => {
    const uses: TraceInput[] = (m?.trace.uses ?? []).map(u => {
      const rec = inputs.get(u.id);
      const d = rec ? describeInput(rec) : { text: '' };
      return { label: (rec?.label ?? u.id) + (u.id.startsWith('row:') ? ', as filed' : ''), display: d.text, evidence: u.source === 'given' ? 'fact' : 'assumption', traceId: inputTrace(u.id) };
    });
    const assumptions = (m?.trace.uses ?? []).flatMap(u => {
      const rec = inputs.get(u.id);
      if (!rec || rec.source === 'given' || !rec.rationale) return [];
      const d = describeInput(rec);
      return [{ label: rec.label, display: d.text + (d.range ? ` (${d.range})` : ''), origin: rec.source, source: rec.rationale }];
    });
    traces[id] = {
      id, title, evidence, summary, inputs: uses, assumptions, formula: m ? { expression: m.trace.formula } : undefined,
      producedBy: { check: 'Cost check (S2)', actor: 'Norn cost check', onBehalfOf: 'Norn, for the ECR', note: `${detail.draws.toLocaleString('en-US')} paired draws, seed ${detail.seed}, ${detail.codeVersion}` },
      ...extra,
    };
  };

  // ---- the cost page
  const costRows: CostRow[] = [];
  const subtotals: CostSection['subtotals'] = [];
  const needsEstimate: CostSection['needsEstimate'] = [];
  const rowIds: string[] = [];
  for (const b of BLOCKS) {
    for (const r of rows.filter(x => x.key.startsWith('line:') && (JSON.parse(x.detailJson) as LineDetail).block === b)) {
      const d = JSON.parse(r.detailJson) as LineDetail;
      const rowId = r.key.slice(5);
      rowIds.push(rowId);
      const ev = evidenceOfBasis(d.basis, d.needsEstimate);
      const row: CostRow = {
        id: r.key, block: b, label: r.label, recurring: d.recurring, total: makeFigure(r.key, r, d.point, d.mean, ev),
        basis: BASIS_TEXT[d.basis] ?? d.basis,
        ...(d.needsEstimate ? { needsEstimate: true } : {}),
      };
      if (d.unitCost && d.quantity !== null) {
        row.unitCost = makeFigure(`${r.key}#unit`, d.unitCost, d.unitCost.point, d.unitCost.mean, ev === 'fact' ? 'fact' : 'computation');
        row.quantity = d.quantity;
        traceOf(`${r.key}#unit`, `${r.label}, per unit`, row.unitCost.evidence, d.unitCost, 'The amount per unit.');
      }
      costRows.push(row);
      if (d.needsEstimate) needsEstimate.push({ label: r.label, rowId: r.key });
      const flag = flagFor.get(rowId);
      traceOf(r.key, r.label, ev, d.trace && { ...d, trace: d.trace } as unknown as Money,
        d.needsEstimate
          ? 'Left blank on the cost page. Counted as $0 until someone estimates it.'
          : `${BASIS_TEXT[d.basis] ?? d.basis}.${flag ? ` ${flag.message}` : ''}`);
    }
    const sub = need(`block:${b}`);
    const sd = JSON.parse(sub.detailJson) as { point: number; mean: number; trace: Money['trace'] };
    subtotals.push({ block: b, total: makeFigure(sub.key, sub, sd.point, sd.mean, 'computation') });
    traceOf(sub.key, sub.label, 'computation', { ...sub, ...sd } as unknown as Money, `The ${b === 'logisticsSupport' ? 'logistics support' : b} lines, summed on the same draws.`);
  }

  const total = (k: string, title: string, summary: string) => {
    const r = need(k);
    const f = figure(r, k, 'computation');
    const d = JSON.parse(r.detailJson) as { trace: Money['trace'] } & Money;
    traceOf(k, title, 'computation', { ...r, ...d } as unknown as Money, summary);
    return f;
  };
  const net = total('net_total_year_one', 'Net cost, first 12 months', 'Every line summed on the same paired draws, so the range is the range of the total, not a sum of the lines’ ranges.');
  const oneTime = total('one_time_total', 'One-time cost', 'The one-time column of the cost page, summed on the same draws.');
  const recurring = total('recurring_year_one', 'Recurring cost, first 12 months', 'Per-unit change times the units built after the cut-in in the window.');

  const from = detail.window.from;
  const window = { from, months: detail.window.months, label: from ? `${monthLabel(from)} to ${monthLabel(addMonths(from, detail.window.months - 1))}` : 'the first 12 months' };

  // ---- headline
  const unitCost = rows.filter(r => r.key.startsWith('unit_cost_delta:')).map(r => {
    const program = r.key.split(':')[1];
    const id = r.key;
    const f = figure(r, id, 'computation');
    const d = JSON.parse(r.detailJson) as Money;
    traceOf(id, `Unit cost change per unit, ${cap(program)}`, 'computation', d, 'What each unit costs more (or less) to build once the change is in.');
    return { program: cap(program), figure: f };
  });

  const fit = fitQuantiles(net.p10 ?? net.p50, net.p50, net.p90 ?? net.p50);
  const threshold = Math.round((net.p90 ?? net.p50) / 25_000) * 25_000;
  const sc: SCurve | undefined = net.p10 !== undefined
    ? { p10: net.p10, p50: net.p50, p90: net.p90!, point: net.point ?? net.p50, mean: net.mean ?? net.p50 }
    : undefined;
  const pUnder = fit.cdf(threshold);
  const year1Likelihood = needsEstimate.length > 0 ? undefined : net.p10 !== undefined && net.p50 > 0
    ? { word: likelihoodWord(pUnder), event: `under ${usdK(threshold)}`, probability: pUnder }
    : net.p10 !== undefined && net.p90! < 0
      ? { word: likelihoodWord(1 - fit.cdf(0)), event: 'a net saving', probability: 1 - fit.cdf(0) }
      : undefined;

  // ---- cut-in: one fixed month from the ECR's stated effectivity, no range until the timeline check exists
  const e0 = detail.effectivity[0];
  const cutIn: CutIn = {
    program: cap(e0.program), month: e0.cutInMonth ?? '', serial: e0.cutInSerial, source: e0.source, rationale: e0.rationale,
  };
  traces['cutin'] = {
    id: 'cutin', title: `Cut-in on ${cap(e0.program)}`, evidence: e0.source === 'given' ? 'fact' : 'assumption',
    summary: e0.rationale,
    value: { text: e0.cutInMonth ? `${monthLabel(e0.cutInMonth)}, S/N ${e0.cutInSerial}` : `S/N ${e0.cutInSerial}` },
    inputs: [], assumptions: e0.source === 'given' ? [] : [{ label: 'Cut-in', display: `S/N ${e0.cutInSerial}`, origin: e0.source, source: e0.rationale }],
    sources: e0.source === 'given' ? [{ system: 'PLM', ref: `${e0.id.split(':')[1]} effectivity` }] : undefined,
  };

  // ---- drivers
  const drivers: Driver[] = [...detail.drivers].sort((a, b) => b.swing - a.swing).map(dv => {
    const lineKey = `line:${dv.id}`;
    const line = byKey.get(lineKey);
    const lineBasis = line ? (JSON.parse(line.detailJson) as LineDetail).basis : undefined;
    const rec = inputs.get(dv.id);
    const evidence: Evidence = dv.kind === 'decision' ? 'judgment' : lineBasis ? evidenceOfBasis(lineBasis) : 'assumption';
    let lowLabel: string | undefined, highLabel: string | undefined;
    if (dv.kind === 'decision') {
      lowLabel = 'Use up the old stock';
      highLabel = 'Scrap it';
    } else if (rec?.dist) {
      const r = distRange(rec.dist);
      if (r) {
        const fmtv = (v: number) => (Math.abs(r.mid - 1) < 1e-9 ? `×${v.toFixed(2)}` : money(v));
        lowLabel = fmtv(r.lo);
        highLabel = fmtv(r.hi);
      }
    }
    // A decision's own trace, so a click on its bar opens something.
    if (dv.kind === 'decision') {
      traces[dv.id] = {
        id: dv.id, title: dv.label, evidence: 'judgment',
        summary: 'A decision, not an input: the window total if the old stock is used up, against scrapping it. Rev B failed fatigue, so the proposal scraps it.',
        value: { text: usdK(Math.abs(dv.high - dv.low)), range: 'swing in the window total' },
        inputs: [], assumptions: [],
      };
    } else if (!traces[dv.id]) {
      // An input driver points at the row or input that holds its value.
      const target = traces[lineKey] ? lineKey : inputTrace(dv.id);
      traces[dv.id] = { ...traces[target], id: dv.id };
    }
    return { id: dv.id, label: dv.label, kind: dv.kind, evidence, low: dv.low, high: dv.high, ...(lowLabel ? { lowLabel } : {}), ...(highLabel ? { highLabel } : {}) };
  });

  return {
    headline: { unitCost, year1: net, ...(year1Likelihood ? { year1Likelihood } : {}) },
    cost: {
      rows: costRows, subtotals, net, oneTime, recurring, window, needsEstimate,
      run: { draws: detail.draws, seed: detail.seed, codeVersion: detail.codeVersion, correlation: detail.correlation },
    },
    cutIn, sCurve: sc, drivers, traces, flags: detail.flags, rowIds,
  };
}
