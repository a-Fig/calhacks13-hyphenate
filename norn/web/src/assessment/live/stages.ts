// The timeline (S3) and supply (S4) checks' stored rows, as the report's view-model. Pure, like build.ts.
//
// Real rows are the checks' timelineRows() / supplyCheckRows() (norn/checks/src/rows.ts), stored unchanged; the
// mock stages (workers/src/stages.ts) write their own keys, marked `mock`, and are read apart at the bottom.
// Every number is a row or a stat inside the `detail` row, and carries the trace the checks gave it.
import type { Flag, InputRecord } from '../../../../checks/src/types.ts';
import { describeInput, inputTraceOf } from '../adapter.ts';
import { likelihoodWord } from '../fit.ts';
import type {
  CutIn, Evidence, Figure, Likelihood, Readiness, Supply, SupplyDetail, SupplyPart, TimelineStep, TimelineView, Trace, Unit,
} from '../types.ts';
import { dateLong } from '../../ui/fmt.ts';

export interface StageRow { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string; mock?: boolean }

const DAY = 86_400_000;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

interface StatLike { p10: number; p50: number; p90: number; mean?: number; point?: number; trace?: { formula?: string; uses?: { id: string; source: string }[] } }
type FlagLike = Pick<Flag, 'severity' | 'message'>;

/** What a reader needs of a check run to place its numbers: who ran it, on what, and when. */
interface Source { check: string; actor: string; at: string; note: string }

/** Builds the traces of one stage's numbers: each opens its formula and the inputs it used, with their sources. */
class Tracer {
  private inputs: Map<string, InputRecord>;
  private traces: Record<string, Trace>;
  private prefix: string;
  private src: Source;
  constructor(traces: Record<string, Trace>, inputs: InputRecord[], prefix: string, src: Source) {
    this.traces = traces;
    this.prefix = prefix;
    this.src = src;
    this.inputs = new Map(inputs.map(i => [i.id, i]));
  }

  private input(id: string): string {
    const tid = `${this.prefix}in:${id}`;
    if (!this.traces[tid]) this.traces[tid] = inputTraceOf(tid, id, this.inputs.get(id));
    return tid;
  }

  add(id: string, title: string, summary: string, trace: StatLike['trace'], value?: Trace['value'], evidence: Evidence = 'computation'): void {
    const uses = trace?.uses ?? [];
    this.traces[id] = {
      id, title, evidence, summary, value,
      inputs: uses.map(u => {
        const rec = this.inputs.get(u.id);
        return { label: rec?.label ?? u.id, display: rec ? describeInput(rec).text : '', evidence: u.source === 'given' ? 'fact' : 'assumption', traceId: this.input(u.id) };
      }),
      assumptions: uses.flatMap(u => {
        const rec = this.inputs.get(u.id);
        if (!rec || rec.source === 'given' || !rec.rationale) return [];
        const d = describeInput(rec);
        return [{ label: rec.label, display: d.text + (d.range ? ` (${d.range})` : ''), origin: rec.source, source: rec.rationale }];
      }),
      formula: trace?.formula ? { expression: trace.formula } : undefined,
      producedBy: { check: this.src.check, actor: this.src.actor, at: this.src.at, note: this.src.note },
    };
  }
}

const exact = (s: { p10: number; p90: number }) => s.p10 === s.p90;

/**
 * A day scalar is fractional inside the simulation; the checks name its calendar day by rounding (time.ts dateOf), so a
 * date figure rounds the same way. Without it a median of day 20500.6 shows as the 15th while the check says the 16th.
 */
function figureOf(id: string, unit: Unit, s: StatLike, scale = 1, evidence: Evidence = 'computation'): Figure {
  const at = (v: number) => (unit === 'date' ? Math.round(v) : v) * scale;
  return {
    id, unit, p50: at(s.p50), ...(exact(s) ? {} : { p10: at(s.p10), p90: at(s.p90) }),
    ...(s.point !== undefined ? { point: at(s.point) } : {}), ...(s.mean !== undefined ? { mean: at(s.mean) } : {}), evidence,
  };
}

const text = (unit: Unit, v: number) => (unit === 'date' ? dateLong(v) : unit === 'weeks' ? `${Math.round(v * 10) / 10} wk` : unit === 'usd' ? `$${Math.round(v).toLocaleString('en-US')}` : unit === 'percent' ? pct(v) : String(Math.round(v * 100) / 100));
const valueOf = (f: Figure): Trace['value'] => ({ text: text(f.unit, f.p50), ...(f.p10 !== undefined && f.p90 !== undefined ? { range: `${text(f.unit, f.p10)} – ${text(f.unit, f.p90)}` } : {}) });

const parse = (s: string): any => JSON.parse(s);
/** The check's flags, each message once; `omit` drops kinds the page already states as a figure. */
const flagsOf = (d: any, omit: string[] = []): FlagLike[] => {
  const seen = new Set<string>();
  return (Array.isArray(d?.flags) ? d.flags : []).filter((f: Flag) => !omit.includes(f.kind) && !seen.has(String(f.message)) && seen.add(String(f.message)))
    .map((f: Flag) => ({ severity: f.severity === 'warn' ? 'warn' as const : 'info' as const, message: String(f.message) }));
};
/** The summary only counts warnings; the page lists each once, under the summary. */
const warnLine = (flags: FlagLike[]) => {
  const n = new Set(flags.filter(f => f.severity === 'warn').map(f => f.message)).size;
  return n ? ` ${plural(n, 'warning')} below.` : '';
};

export interface StageRead<V> {
  view: V;
  /** One sentence for the check list. */
  summary: string;
  /** The check should be marked as needing attention although it finished. */
  attention: boolean;
}

// ---------------------------------------------------------------- S3

export interface TimelineRead extends StageRead<TimelineView> {
  estimate?: NonNullable<CutIn['estimate']>;
}

/** The real timeline check. Throws when the rows are not the checks' output; the caller says so on the page. */
export function readTimeline(rows: StageRow[], traces: Record<string, Trace>, src: Source, stale?: TimelineView['stale']): TimelineRead {
  const by = new Map(rows.map(r => [r.key, r]));
  const detailRow = by.get('detail');
  if (!detailRow) throw new Error('the timeline rows have no `detail` row');
  const d = parse(detailRow.detailJson);
  const T = new Tracer(traces, d.inputs ?? [], 's3:', src);
  const detailOf = (key: string) => parse(by.get(key)!.detailJson);

  const stat = (key: string, id: string, unit: Unit, scale: number, title: string, summary: string): Figure | undefined => {
    const r = by.get(key);
    if (!r) return undefined;
    const dd = detailOf(key);
    const f = figureOf(id, unit, { p10: r.p10, p50: r.p50, p90: r.p90, mean: dd.mean, point: dd.point }, scale);
    T.add(id, title, summary, dd.trace, valueOf(f));
    return f;
  };

  const readiness: Readiness | undefined = d.readiness === 'materials_only' || d.readiness === 'implementation' ? d.readiness : undefined;
  const placed = d.cutIn?.placed !== false && !!by.get('cut_in_date');
  const flags = flagsOf(d, by.has('p_late') ? ['likely_late'] : []);
  const materialsOnly = readiness === 'materials_only';

  const cutInDate = stat('cut_in_date', 's3:cut_in_date', 'date', DAY, materialsOnly ? 'Material readiness date' : 'Earliest cut-in date',
    materialsOnly
      ? 'The day the parts and the assessed work allow the change on the line. Qualification, release or retrofit work that is not assessed is not in it, so implementation may be later.'
      : 'The latest of the board’s decision, every changed part arriving, the assessed prerequisites completing, and the old stock being used up.');
  const weeks = stat('cut_in_weeks', 's3:cut_in_weeks', 'weeks', 1, 'Weeks from filing to cut-in', 'The same day, counted in weeks from the date the ECR was filed.');
  const serial = stat('cut_in_serial', 's3:cut_in_serial', 'count', 1, 'First serial that can take the change', 'The first aircraft serial built after the cut-in day, or, when the old stock runs past the volume plan, the first serial it allows.');
  const decision = stat('decision_date', 's3:decision_date', 'date', DAY, 'Board decision date', 'The filing date plus the weeks the board takes to decide, from the company’s decision-time range.');
  const retrofit = stat('retrofit_completion_date', 's3:retrofit_completion_date', 'date', DAY, 'Assessed retrofit completion date', 'When the assessed retrofit work completes. It is separate from the production cut-in.');

  const stated = { label: String(d.stated?.label ?? ''), date: (d.stated?.date ?? null) as string | null, serial: (d.stated?.serial ?? null) as number | null };
  let late: TimelineView['late'];
  const lateWeeks = stat('late_weeks', 's3:late_weeks', 'weeks', 1, `Weeks after the stated effectivity (${stated.label})`, 'How many weeks after the effectivity the ECR states the change can first reach the line. Zero when it makes it.');
  const pLate = by.get('p_late');
  if (lateWeeks && pLate) {
    const probability = pLate.p50;
    const likelihood: Likelihood = { word: likelihoodWord(probability), event: 'of landing after the stated effectivity', probability };
    T.add('s3:p_late', 'Chance of reaching the line after the stated effectivity', 'The share of draws in which the change reaches the line after the effectivity the ECR states.', detailOf('p_late').trace, { text: pct(probability) });
    late = { weeks: lateWeeks, likelihood };
  }

  const steps: TimelineStep[] = (Array.isArray(d.paths) ? d.paths : []).map((p: any): TimelineStep => {
    const id = `s3:path:${p.id}`;
    let date: Figure | undefined;
    if (p.day) {
      date = figureOf(id, 'date', p.day, DAY);
      const who = [p.owner, p.status, p.evidence].filter(Boolean).join('; ');
      T.add(id, p.label, p.kind === 'prerequisite' ? `A release prerequisite${who ? `: ${who}` : ''}.` : p.kind === 'decision' ? 'The board’s decision.' : p.kind === 'stock' ? 'The old stock the proposal uses up, built into aircraft before the change.' : 'The day the part is in the building.', p.day.trace, valueOf(date));
    }
    return {
      id: String(p.id), kind: p.kind, label: String(p.label), ...(date ? { date } : {}), criticalShare: Number(p.criticalShare) || 0,
      ...(p.supplier ? { supplier: String(p.supplier) } : {}),
      ...(p.owner ? { owner: String(p.owner) } : {}), ...(p.status ? { status: String(p.status) } : {}), ...(p.evidence ? { evidence: String(p.evidence) } : {}),
      ...(p.appliesTo ? { appliesTo: String(p.appliesTo) } : {}),
      ...(typeof p.downtimeHoursPerUnit === 'number' ? { downtimeHoursPerUnit: p.downtimeHoursPerUnit } : {}),
    };
  });

  const view: TimelineView = {
    ...(readiness ? { readiness } : {}), placed, stated,
    ...(decision ? { decision } : {}), ...(weeks ? { weeksFromFiling: weeks } : {}), ...(serial ? { serial } : {}), ...(retrofit ? { retrofit } : {}),
    ...(late ? { late } : {}), steps, flags, ...(stale ? { stale } : {}),
  };

  let summary: string;
  if (placed && cutInDate) {
    const when = `${dateLong(cutInDate.p50)}${cutInDate.p10 !== undefined && cutInDate.p90 !== undefined ? ` (${dateLong(cutInDate.p10)} – ${dateLong(cutInDate.p90)})` : ''}`;
    summary = `${materialsOnly ? 'Material readiness' : 'Reaches the line'} ${when}${serial ? `, from S/N ${Math.round(serial.p50)}` : ''}`;
    if (late) summary += `; ${pct(late.likelihood.probability)} chance of landing after the stated effectivity`;
  } else {
    summary = `The change cannot be placed on a date: the old stock runs past the end of the volume plan${serial ? `. The first serial it allows is S/N ${Math.round(serial.p50)}` : ''}`;
  }
  summary += `.${warnLine(flags)}`;

  const attention = flags.some(f => f.severity === 'warn') || materialsOnly || !placed;
  const estimate: TimelineRead['estimate'] = placed && cutInDate ? {
    figure: cutInDate,
    note: materialsOnly ? 'When the parts and the assessed work allow it; unassessed prerequisites are not in the date' : 'Earliest the change can reach the line, from the timeline check',
    ...(late ? { likelihood: late.likelihood } : {}),
    label: materialsOnly ? 'Material readiness' : 'Reaches the line',
  } : undefined;
  return { view, summary, attention, estimate };
}

// ---------------------------------------------------------------- S4

export interface SupplyRead extends StageRead<Supply> {}

/** The real supply check. Throws when the rows are not the checks' output. */
export function readSupply(rows: StageRow[], traces: Record<string, Trace>, src: Source, stale?: SupplyDetail['stale']): SupplyRead {
  const by = new Map(rows.map(r => [r.key, r]));
  const detailRow = by.get('detail');
  if (!detailRow) throw new Error('the supply rows have no `detail` row');
  const d = parse(detailRow.detailJson);
  const T = new Tracer(traces, d.inputs ?? [], 's4:', src);
  const stated = String(d.stated?.label ?? '');
  const flags = flagsOf(d);

  const fig = (id: string, unit: Unit, s: StatLike | null | undefined, title: string, summary: string, scale = 1): Figure | undefined => {
    if (!s) return undefined;
    const f = figureOf(id, unit, s, scale);
    T.add(id, title, summary, s.trace, valueOf(f));
    return f;
  };
  const chance = (id: string, p: number, title: string, event: string, summary: string, trace?: StatLike['trace']): Likelihood => {
    T.add(id, title, summary, trace, { text: pct(p) });
    return { word: likelihoodWord(p), event, probability: p };
  };

  const miss = d.missEffectivity ?? null;
  const missCan = !!miss;
  const missWeeks = missCan ? fig('s4:miss_weeks', 'weeks', miss.weeks, 'Weeks the supply misses the stated effectivity by', 'How many weeks after the stated effectivity the changed parts can be on the line. Zero when they make it.') : undefined;
  const missLikelihood = missCan
    ? chance('s4:p_miss', miss.probability, 'Chance the supply misses the stated effectivity', 'of missing the stated effectivity', 'The share of draws in which the changed parts are not in the building by the stated effectivity.', miss.weeks?.trace)
    : undefined;

  const I = d.interaction ?? null;
  const missPeers = I?.late
    ? { likelihood: chance('s4:p_miss_peers', I.late.probability, 'Chance the supply misses the stated effectivity, with the other open ECRs', 'of missing the stated effectivity, with the other open ECRs', 'The same chance when the open ECRs that share a supplier also compete for its qualification slot and capacity.', I.late.weeks?.trace),
        weeksLate: fig('s4:miss_weeks_peers', 'weeks', I.late.weeks, 'Weeks the supply misses the stated effectivity by, with the other open ECRs', 'As above, with the other open ECRs.') }
    : undefined;

  const parts: SupplyPart[] = (Array.isArray(d.parts) ? d.parts : []).map((p: any): SupplyPart => ({
    item: String(p.item), name: String(p.name ?? p.item), supplier: p.supplier ?? null, sources: Array.isArray(p.sources) ? p.sources.map(String) : [], singleSource: !!p.singleSource,
    leadFrom: String(p.leadFrom ?? ''),
    leadWeeks: fig(`s4:lead:${p.item}`, 'weeks', p.leadWeeks, `${p.item}: weeks from order to parts in`, `From the order being placed to the part in the building${p.leadFrom ? `. Source: ${p.leadFrom}` : ''}.`)!,
  }));

  const spend = d.spend?.yearOne
    ? { yearOne: fig('s4:spend', 'usd', d.spend.yearOne, 'Spend on the changed parts, first year after the cut-in', 'A year of production of the changed parts, at the quoted prices and the market range for them.')!,
        singleSource: fig('s4:spend_single', 'usd', d.spend.singleSourceYearOne, 'Of which on parts with one qualified source', 'The part of that spend that goes to parts with a single qualified source.')! }
    : undefined;

  const capacity = (Array.isArray(d.capacity) ? d.capacity : []).map((c: any) => ({
    constraint: String(c.constraint), supplier: String(c.supplier), perYear: Number(c.capacityPerYear) || 0,
    utilization: fig(`s4:cap:${c.constraint}`, 'percent', c.utilization, `Share of ${c.supplier}’s yearly capacity (${c.constraint})`, 'This ECR’s demand in the 12 months from the cut-in, as a share of a year’s capacity.')!,
    ...(c.utilizationWithPeers ? { withPeers: fig(`s4:cap_peers:${c.constraint}`, 'percent', c.utilizationWithPeers, `Share of ${c.supplier}’s yearly capacity, with the other open ECRs (${c.constraint})`, 'The same share with the other open ECRs’ demand on the same supplier added.') } : {}),
  }));

  const peers = (I?.peers ?? []).map((p: any) => ({ ecr: String(p.ecr), sharedSuppliers: Array.isArray(p.sharedSuppliers) ? p.sharedSuppliers.map(String) : [] }));
  const shift = I?.cutIn
    ? { weeks: fig('s4:peer_shift', 'weeks', I.cutIn.shiftWeeks, 'Weeks the cut-in moves because of the other open ECRs', 'The difference between the cut-in with and without the other open ECRs that compete for the same qualification slots.')!,
        later: chance('s4:p_later', I.cutIn.probabilityLater, 'Chance the other open ECRs push the cut-in later', 'that the other open ECRs push the cut-in later', 'The share of draws in which the competing ECRs delay this change’s cut-in.', I.cutIn.shiftWeeks?.trace) }
    : undefined;
  const bundles = (I?.bundles ?? []).map((b: any) => ({
    constraint: String(b.constraint), withinWeeks: Number(b.withinWeeks) || 0,
    bundled: chance(`s4:p_bundle:${b.constraint}`, b.probabilityBundled, `Chance this ECR is bundled (${b.constraint})`, `that this ECR is qualified within ${b.withinWeeks} weeks of another’s`, 'The share of draws in which the bundle terms apply.'),
    ownSaving: fig(`s4:bundle:${b.constraint}`, 'usd', b.ownSaving, `Saving from the bundle terms, this ECR (${b.constraint})`, 'What this ECR gains if the bundle terms apply.')!,
    pairSaving: fig(`s4:bundle_pair:${b.constraint}`, 'usd', b.pairSaving, 'Saving from the bundle terms, every ECR in the bundle', 'What every ECR in the bundle gains together.')!,
  }));

  const detail: SupplyDetail = {
    stated, cutInPlaced: d.cutInPlaced !== false,
    ...(missLikelihood ? { miss: { likelihood: missLikelihood, ...(missWeeks ? { weeksLate: missWeeks } : {}) } } : {}),
    ...(missPeers ? { missWithPeers: { likelihood: missPeers.likelihood, ...(missPeers.weeksLate ? { weeksLate: missPeers.weeksLate } : {}) } } : {}),
    parts, ...(spend ? { spend } : {}), capacity, peers, ...(shift ? { peerCutInShift: shift } : {}), bundles,
    unrelatedPeers: Array.isArray(d.unrelatedPeers) ? d.unrelatedPeers.map(String) : [], flags, ...(stale ? { stale } : {}),
  };

  // The level is a reading of the checks' numbers, not a number the checks give: the worst chance of missing the
  // effectivity (alone or with the peers), then single sourcing. The trace says so.
  const worst = Math.max(miss?.probability ?? 0, I?.late?.probability ?? 0);
  const single = parts.filter(p => p.singleSource);
  let level: Supply['level'] = !detail.cutInPlaced || worst >= 0.3 ? 'high' : worst >= 0.1 ? 'moderate' : 'low';
  if (level === 'low' && single.length) level = 'moderate';

  const bits: string[] = [];
  if (!detail.cutInPlaced) bits.push('The old stock runs past the volume plan, so the cut-in cannot be placed and spend and capacity are not stated');
  if (missLikelihood) bits.push(`${pct(missLikelihood.probability)} chance of missing the stated effectivity`);
  else if (detail.cutInPlaced) bits.push('The ECR states no effectivity the plan can place, so there is no chance of missing it');
  if (missPeers) bits.push(`${pct(missPeers.likelihood.probability)} with the other open ECRs`);
  if (single.length) bits.push(`${plural(single.length, 'part')} with one qualified source`);
  const note = bits.join('; ');

  T.add('supply', 'Supply risk', `${cap(level)}: the worst chance of missing the stated effectivity${I?.late ? ' (alone or with the other open ECRs)' : ''} is ${pct(worst)}; below 10% is low, below 30% moderate, above that high. A part with one qualified source is at least moderate, and a cut-in that cannot be placed is high. The level is Norn’s reading of the checks’ numbers.`, undefined, { text: cap(level), range: note });

  const view: Supply = {
    id: 'supply', level, evidence: 'computation', note,
    ...(missLikelihood ? { likelihood: missLikelihood } : {}), detail,
  };
  const attention = level !== 'low' || flags.some(f => f.severity === 'warn');
  return { view, summary: `${cap(level)} supply risk${note ? `: ${note}` : ''}.${warnLine(flags)}`, attention };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- the mock stages

const mockProducedBy = (check: string, at: string) => ({ check, actor: 'Norn worker', at });

/** The mock timeline stage's one row: weeks until the change reaches the line. Made-up numbers, labelled so. */
export function readMockTimeline(r: StageRow, traces: Record<string, Trace>, at: string): NonNullable<CutIn['estimate']> {
  const f: Figure = { id: 'x:effectivity_weeks', unit: 'weeks', p10: r.p10, p50: r.p50, p90: r.p90, evidence: 'computation' };
  traces[f.id] = {
    id: f.id, title: 'Weeks until the change reaches the line', evidence: 'computation',
    summary: 'Mock compute: this timeline run is a stand-in, and its numbers are made up.',
    value: { text: `${Math.round(r.p50)} wk`, range: `${Math.round(r.p10)} – ${Math.round(r.p90)} wk` }, inputs: [], assumptions: [],
    producedBy: mockProducedBy('Time to the line (S3, mock)', at),
  };
  return { figure: f, note: 'Weeks until the change reaches the line, from the timeline stage (mock compute)' };
}

/** The mock supply stage: the chance of missing the effectivity and a cost at risk. Made-up numbers, labelled so. */
export function readMockSupply(pMiss: StageRow, atRisk: StageRow | undefined, traces: Record<string, Trace>, at: string): Supply {
  const supply: Supply = {
    id: 'supply', level: pMiss.p50 < 0.1 ? 'low' : pMiss.p50 < 0.3 ? 'moderate' : 'high', evidence: 'computation',
    note: atRisk ? `Cost at risk about $${Math.round(atRisk.p50).toLocaleString('en-US')} per unit` : 'Supply risk (mock compute)',
    likelihood: { word: likelihoodWord(pMiss.p50), event: 'of missing the effectivity date', probability: pMiss.p50 },
  };
  traces.supply = {
    id: 'supply', title: 'Supply risk', evidence: 'computation',
    summary: 'Mock compute: this supply run is a stand-in, and its numbers are made up.',
    value: { text: cap(supply.level), range: supply.note }, inputs: [], assumptions: [],
    producedBy: mockProducedBy('Supply risk (S4, mock)', at),
  };
  return supply;
}
