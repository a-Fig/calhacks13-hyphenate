// What a Level 1 statement says about timing and supply (#120), worked out from the stored s3 and s4 rows.
// Pure: rows in, plain facts out. The dispatcher turns them into the job prompt, the publisher into the rule's
// input and the PLM text, and both read the same rows (siblings.ts picks them), so the agent is told what the
// PLM will show.
//
// Bowman's materiality bars (prompt.ts MATERIALITY) decide what is worth a headline number or a sentence: a
// cut-in slip of more than 14 days, and a saving of more than the one-time-cost bar. Nothing is raised that does
// not clear them.
import { LIKELIHOOD_WORDS, MATERIALITY } from './prompt.ts';
import type { SiblingCheck } from './recommendation.ts';

/** One stored result row, as far as this file reads it. */
export interface StoredRow {
  key: string;
  label: string;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  detailJson: string;
  mock?: boolean;
}

export type SiblingViewState = SiblingCheck['state'];

/** The timeline or supply check as a statement sees it: how it ended, the run, and its rows. */
export interface SiblingView {
  state: SiblingViewState;
  runId?: number;
  rows: StoredRow[];
}

export const ABSENT: SiblingView = { state: 'pending', rows: [] };

// ---- which result keys are the timeline's and the supply's ------------------------------------------

const TIMELINE_KEYS = new Set(['cut_in_date', 'cut_in_weeks', 'cut_in_serial', 'decision_date', 'late_weeks', 'p_late']);
const SUPPLY_KEYS = new Set([
  'p_miss_effectivity',
  'single_source_items',
  'spend_year_one',
  'spend_year_one_single_source',
  'peer_cut_in_shift_weeks',
  'p_cut_in_later_with_peers',
  'p_miss_effectivity_with_peers',
]);
const SUPPLY_PREFIXES = ['lead_weeks:', 'capacity_utilization:', 'capacity_utilization_with_peers:', 'bundle_saving:', 'pair_bundle_saving:'];

export const isTimelineKey = (key: string): boolean => TIMELINE_KEYS.has(key);
export const isSupplyKey = (key: string): boolean => SUPPLY_KEYS.has(key) || SUPPLY_PREFIXES.some(p => key.startsWith(p));
/** A number of the timeline or supply check: the statement shows it in its own section, not with the cost. */
export const isTimelineSupplyKey = (key: string): boolean => isTimelineKey(key) || isSupplyKey(key);

// ---- reading rows -----------------------------------------------------------------------------------

const jsonOr = (s: string): Record<string, any> => {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
};
const row = (v: SiblingView, key: string) => v.rows.find(r => r.key === key);
const rowsWith = (v: SiblingView, prefix: string) => v.rows.filter(r => r.key.startsWith(prefix));
const detailOf = (v: SiblingView): Record<string, any> => jsonOr(row(v, 'detail')?.detailJson ?? '{}');

/** The check's flags, as the rule reads them. */
export function flagsOf(v: SiblingView): NonNullable<SiblingCheck['flags']> {
  const f = detailOf(v).flags;
  return Array.isArray(f) ? f.filter(x => x && typeof x.kind === 'string' && typeof x.severity === 'string' && typeof x.message === 'string') : [];
}

/**
 * The rule's view of a check: its state and flags, and what the conditions quote, all from the bound rows. The
 * timeline gives the median cut-in date and serial, the stated need and how late at P90; the supply check gives the
 * other open ECRs it shares a supplier with.
 */
export function ruleCheckOf(v: SiblingView): SiblingCheck {
  if (v.state !== 'ready') return { state: v.state };
  const out: SiblingCheck = { state: 'ready', flags: flagsOf(v) };
  const d = detailOf(v);
  const date = jsonOr(row(v, 'cut_in_date')?.detailJson ?? '{}').date?.p50;
  const serial = row(v, 'cut_in_serial')?.p50;
  const late = row(v, 'late_weeks');
  if (date !== undefined || serial !== undefined || late || d.stated?.label)
    out.cutIn = {
      ...(typeof date === 'string' ? { date } : {}),
      ...(typeof serial === 'number' ? { serial: Math.round(serial) } : {}),
      ...(typeof d.stated?.label === 'string' ? { stated: d.stated.label } : {}),
      ...(late ? { lateWeeksP90: late.p90 } : {}),
    };
  const peers = d.interaction?.peers;
  if (Array.isArray(peers)) out.peers = peers.map((p: { ecr?: unknown }) => String(p.ecr)).filter(x => x && x !== 'undefined');
  return out;
}

/** A number of the timeline or supply check as the statement's table shows it, from the bound rows. */
export interface TableNumber {
  key: string;
  label: string;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  evidence: 'computation';
  resultKey: string;
}

/**
 * The numbers the PLM text's "Timeline and supply" table shows, in order: the headline rows of the bound runs. The
 * agent posts none of them, so they cannot fail the module's check against a newer run; they are the stored rows of
 * the very runs the statement rests on.
 */
export function tableNumbers(timeline: SiblingView, supply: SiblingView): TableNumber[] {
  const rows = [...timeline.rows, ...supply.rows];
  return headlineNumbers(timeline, supply, 12).map(h => {
    const r = rows.find(x => x.key === h.resultKey)!;
    return { key: h.resultKey.replace(/[^A-Za-z0-9_]/g, '_'), label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, evidence: 'computation' as const, resultKey: r.key };
  });
}

// ---- words ------------------------------------------------------------------------------------------

/**
 * The ICD 203 words for a probability the simulation gives (a share of its draws, 0 to 1), from the scale the
 * system prompt states. Values past the ends of the scale take its nearest word.
 */
export function likelihoodWord(p: number): string {
  const edges = [0.05, 0.2, 0.45, 0.55, 0.8, 0.95];
  const i = edges.findIndex(e => p < e);
  return LIKELIHOOD_WORDS[i === -1 ? LIKELIHOOD_WORDS.length - 1 : i]!;
}

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const wk = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const range = (a: number, b: number, f: (n: number) => string) => (f(a) === f(b) ? f(a) : `${f(a)} to ${f(b)}`);
/** "SUP-HALDEN" as a person reads it. The checks carry supplier codes, not names; this is a presentation guess, not a lookup. */
export const supplierName = (code: string): string => code.replace(/^SUP-/, '').toLowerCase().replace(/(^|[-_ ])(\w)/g, (_m, sep: string, c: string) => `${sep === '' ? '' : ' '}${c.toUpperCase()}`);
const days = (iso: unknown): string => (typeof iso === 'string' ? iso : '?');

// ---- what to post and what to say -------------------------------------------------------------------

export interface TsNumber {
  /** The check result's key. */
  resultKey: string;
  label: string;
}

/**
 * The headline numbers of the timeline and supply checks worth posting, in order. Each is one of the check's own
 * rows, so the module copies its digits. `room` caps how many fit under the statement's 12 numbers.
 */
export function headlineNumbers(timeline: SiblingView, supply: SiblingView, room: number): TsNumber[] {
  const out: TsNumber[] = [];
  const add = (v: SiblingView, key: string) => {
    const r = row(v, key);
    if (r) out.push({ resultKey: r.key, label: r.label });
  };
  if (timeline.state === 'ready') {
    add(timeline, 'cut_in_date');
    add(timeline, 'cut_in_serial');
    const late = row(timeline, 'late_weeks');
    if (late && late.p90 * 7 > MATERIALITY.cutInSlipDays) add(timeline, 'late_weeks');
  }
  if (supply.state === 'ready') {
    const single = row(supply, 'single_source_items');
    if (single && single.p50 > 0) add(supply, 'single_source_items');
    const shift = row(supply, 'peer_cut_in_shift_weeks');
    if (shift && shift.p90 * 7 > MATERIALITY.cutInSlipDays) add(supply, 'peer_cut_in_shift_weeks');
    const bundle = rowsWith(supply, 'bundle_saving:').find(r => r.p50 > MATERIALITY.oneTimeCostUsd);
    if (bundle) add(supply, bundle.key);
  }
  return out.slice(0, Math.max(0, room));
}

export interface TimelineSupplyFacts {
  /** The sentences the agent may use for its "Timeline:" claim: what the timeline check found. */
  timeline: string[];
  /** The sentences for its "Supply:" claim. */
  supply: string[];
  /** What is missing, in words, for each check that is not available. */
  unavailable: { check: 'timeline' | 'supply'; why: string }[];
}

const WHY: Record<Exclude<SiblingViewState, 'ready'>, string> = {
  failed: 'it failed',
  blocked: 'it is blocked by a check it depends on',
  pending: 'it had not finished in time',
  mock: 'it has only placeholder numbers',
};

function timelineFacts(v: SiblingView): string[] {
  const out: string[] = [];
  const d = detailOf(v);
  const date = row(v, 'cut_in_date');
  const serial = row(v, 'cut_in_serial');
  const dates = jsonOr(date?.detailJson ?? '{}').date ?? {};
  if (date) {
    const spread = dates.p10 === dates.p90 ? '' : ` (P10 ${days(dates.p10)}, P90 ${days(dates.p90)})`;
    const from = serial ? `, from serial ${serial.p50}${serial.p10 === serial.p90 ? '' : ` (${Math.round(serial.p10)} to ${Math.round(serial.p90)})`}` : '';
    out.push(`The change can first reach the line on ${days(dates.p50)}${spread}${from}.`);
  } else if (serial) {
    out.push(`No cut-in date can be placed: using up the old stock runs past the end of the volume plan. The first serial that can take the change is ${serial.p50}.`);
  }
  const late = row(v, 'late_weeks');
  const pLate = row(v, 'p_late');
  if (late && late.p90 * 7 > MATERIALITY.cutInSlipDays) {
    const stated = d.stated?.label ? `${d.stated.label}${d.stated.date ? `, planned for ${d.stated.date}` : ''}` : 'the stated effectivity';
    out.push(`That is ${range(late.p10, late.p90, wk)} weeks after the stated effectivity (${stated}), ${wk(late.p50)} at the median; likelihood it is late: ${pLate ? likelihoodWord(pLate.p50) : 'not given'}.`);
  } else if (!late && (d.flags ?? []).some((f: { kind: string }) => f.kind === 'no_stated_effectivity')) {
    out.push('The ECR states no effectivity, so there is no deadline to miss.');
  }
  return out;
}

function supplyFacts(v: SiblingView): string[] {
  const out: string[] = [];
  const d = detailOf(v);
  const singles: { item: string; supplier?: string }[] = jsonOr(row(v, 'single_source_items')?.detailJson ?? '{}').parts ?? [];
  for (const s of singles.slice(0, 2)) {
    const lead = row(v, `lead_weeks:${s.item}`);
    out.push(`${s.item}${s.supplier ? ` (${supplierName(s.supplier)})` : ''} has one qualified source${lead ? `; its lead time is ${wk(lead.p50)} weeks (P10 ${wk(lead.p10)}, P90 ${wk(lead.p90)})` : ''}, and a second source would need its own qualification.`);
  }
  const shift = row(v, 'peer_cut_in_shift_weeks');
  const later = row(v, 'p_cut_in_later_with_peers');
  const peers: { ecr: string; sharedSuppliers?: string[] }[] = jsonOr(later?.detailJson ?? '{}').peers ?? [];
  const names = peers.map(p => p.ecr).join(', ');
  const shared = [...new Set(peers.flatMap(p => p.sharedSuppliers ?? []))].map(supplierName).join(', ');
  if (shift && shift.p90 * 7 > MATERIALITY.cutInSlipDays) {
    const withLate = jsonOr(row(v, 'p_miss_effectivity_with_peers')?.detailJson ?? '{}').weeksLate;
    out.push(`With ${names || 'the other open ECRs'} ahead of it at ${shared || 'a shared supplier'}, the cut-in moves ${range(shift.p10, shift.p90, wk)} weeks later (${wk(shift.p50)} at the median); likelihood it moves: ${later ? likelihoodWord(later.p50) : 'not given'}${withLate && typeof withLate.p50 === 'number' ? `. It then reaches the line ${wk(withLate.p50)} weeks after the stated effectivity at the median` : ''}.`);
  } else if (peers.length) {
    out.push(`It shares ${shared || 'a supplier'} with ${names}${shift ? `; any shift of its cut-in is below the reporting threshold (${MATERIALITY.cutInSlipDays} days)` : ''}.`);
  }
  const bundle = rowsWith(v, 'bundle_saving:').find(r => r.p50 > MATERIALITY.oneTimeCostUsd);
  if (bundle) {
    const pair = row(v, bundle.key.replace('bundle_saving:', 'pair_bundle_saving:'));
    out.push(`Ordering together on the supplier's bundle terms would save this ECR ${range(bundle.p10, bundle.p90, usd)} (${usd(bundle.p50)} at the median)${pair ? `, and ${usd(pair.p50)} across every ECR in the bundle` : ''}.`);
  }
  const over = (d.flags ?? []).find((f: { kind: string }) => f.kind === 'capacity_exceeded');
  if (over) out.push(String(over.message));
  return out;
}

/** The facts for the job prompt, worked out from the two checks as the statement's snapshot has them. */
export function timelineSupplyFacts(timeline: SiblingView, supply: SiblingView): TimelineSupplyFacts {
  const unavailable: TimelineSupplyFacts['unavailable'] = [];
  if (timeline.state !== 'ready') unavailable.push({ check: 'timeline', why: WHY[timeline.state] });
  if (supply.state !== 'ready') unavailable.push({ check: 'supply', why: WHY[supply.state] });
  return { timeline: timeline.state === 'ready' ? timelineFacts(timeline) : [], supply: supply.state === 'ready' ? supplyFacts(supply) : [], unavailable };
}

