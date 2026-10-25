// The Level 1 recommendation, derived from what the agent reads through Norn's tools. Pure: no database,
// no network. Two runs on identical inputs must not give different recommendations (they once did on
// ECR-0417: "Approve with conditions", then "Send back", on the same three blank cost lines), so the
// rule is written down in the system prompt (prompt.ts), worked out here from the cost check's stored
// `detail` row, told to the agent in the job prompt (dispatcher.ts), and applied again by the publisher
// (format.ts) so the PLM never shows a recommendation the rule would not give.
//
//   Rule 1, Send back: the change request cannot be assessed as filed. A BOM conflict with the baseline,
//     an error flag, a cost check that did not converge, or a check (the redline read, the BOM delta, the
//     cost check) that failed or is blocked.
//   Rule 2, Approve with conditions: the assessment stands but has stated gaps (a blank cost line counted
//     as $0, an unestimated item, an undecided stock disposition, a price change with no quote, any other
//     warning; a timeline or supply check that is not available or could not assess something, #120). The
//     conditions name exactly those gaps. A missed need date (the cut-in slips past the stated effectivity by more
//     than 14 days) and a slot or capacity conflict with another open ECR are conditions too, in short fixed wording
//     with the date, serial and ECR from the bound s3 and s4 rows: the CCB must answer them, but they never make it
//     Send back. A single source is a finding the statement shows and no more.
//   Rule 3, Approve: no blocker and no gap.
//   Never Reject: that is a human call.
//
// Info flags (cross-checks, defaults, budgetary quotes) are neither: they are not gaps.

import { MATERIALITY } from './prompt.ts';

export const DERIVED_RECOMMENDATIONS = ['Send back', 'Approve with conditions', 'Approve'] as const;
export type DerivedRecommendation = (typeof DERIVED_RECOMMENDATIONS)[number];

/** The parts of the s2_cost `detail` row the rule reads. */
export interface RuleDetail {
  flags?: { kind: string; severity: string; message: string; ref?: string }[];
  inputs?: { id: string; label?: string; source?: string; needsEstimate?: boolean }[];
  bomDelta?: { ok: boolean; conflicts: number };
}

/** One cost-page line as the cost check stored it (the `line:cost:...` rows). */
export interface RuleLine {
  id: string;
  label: string;
  basis?: string;
  /** The line's one-time and per-unit amounts; null or absent when the line has none. */
  oneTime?: unknown;
  unitCost?: unknown;
}

/**
 * What the rule reads of the timeline (s3) or supply (s4) check: whether its result is available as of the statement's
 * snapshot (siblings.ts), and its flags. `ready` has stored rows; the rest say why it has none.
 */
export interface SiblingCheck {
  state: 'ready' | 'failed' | 'blocked' | 'pending' | 'mock';
  flags?: { kind: string; severity: string; message: string; ref?: string }[];
  /** Timeline: the median and P90 cut-in as ISO dates and first serials, the stated need, and how late at P90 (weeks), from the bound rows. */
  cutIn?: { date?: string; serial?: number; dateP90?: string; stated?: string; lateWeeksP90?: number };
  /** Supply: the other open ECRs that share a supplier with this one, from the interaction the check stored. */
  peers?: string[];
}

export interface RuleInput {
  /** The statement's s2_cost `detail` row, parsed. Undefined when the run has none: nothing can be assessed. */
  detail: RuleDetail | undefined;
  /** Checks that failed or are blocked, by stage (`s0_extract`, `s1_bom_delta`, `s2_cost`), as of the statement's own input snapshot (`failedChecksOf`). */
  failedChecks?: string[];
  /** The stored cost-page lines, so an amount missing on a line's own basis is seen whatever the check flagged. */
  lines?: RuleLine[];
  /**
   * The timeline (s3) and supply (s4) checks as of the statement's snapshot. Absent for a caller that has none
   * (the rule then says nothing about them); the dispatcher and the publisher always give them.
   */
  timeline?: SiblingCheck;
  supply?: SiblingCheck;
}

export interface Derived {
  recommendation: DerivedRecommendation;
  rule: 1 | 2 | 3;
  /** Why it cannot be assessed as filed (rule 1). */
  blockers: string[];
  /** The stated gaps, which are the conditions (rule 2). */
  conditions: string[];
  /** One or two sentences naming the rule and what fired it. */
  reasoning: string;
}

const CHECK_NAME: Record<string, string> = {
  s0_extract: 'the redline read (s0_extract)',
  s1_bom_delta: 'the BOM delta (s1_bom_delta)',
  s2_cost: 'the cost check (s2_cost)',
};

/** Gaps whatever severity the check gave them: the rule says an undecided disposition is one. */
const GAP_KINDS = new Set(['no_disposition']);
const STATED_BASES = new Set(['engineer_estimate', 'supplier_quote', 'budgetary_quote']);
const isRange = (x: unknown): boolean => {
  const r = x as { p10?: unknown; p50?: unknown; p90?: unknown } | null;
  return typeof r === 'object' && r !== null && [r.p10, r.p50, r.p90].every(v => typeof v === 'number' && Number.isFinite(v));
};
const BLOCKING_KINDS = new Set(['conflict', 'not_converged']);
const short = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * How the timeline and supply checks' warn flags enter the rule.
 *  - `single_source` is a finding: shown in the statement, never a condition.
 *  - `likely_late`, `slot_contention` and `capacity_exceeded` are findings the CCB must answer, so each becomes one
 *    condition (below), whose date and serial come from the bound s3 rows and whose peers come from the s4
 *    interaction. They are conditions, never blockers: the assessment stands, and the board decides.
 *  - Every other warn flag says the check could not assess something (no date placed, a peer ECR unreadable, a
 *    price missing, an assumption not applied) and is a gap, as a warn flag of the cost check is.
 */
const NOT_GAPS = new Set(['single_source', 'likely_late', 'slot_contention', 'capacity_exceeded']);

const UNAVAILABLE: Record<Exclude<SiblingCheck['state'], 'ready'>, string> = {
  failed: 'failed',
  blocked: 'is blocked',
  pending: 'had not finished when this assessment was made',
  mock: 'has only placeholder numbers',
};

/** Short, fixed wording for a gap the timeline or supply check named, so the conditions stay short enough for a statement's claim (600 characters). */
function siblingGap(f: { kind: string; message: string; ref?: string }): string {
  const at = f.ref ? ` (${f.ref})` : '';
  switch (f.kind) {
    case 'stock_beyond_plan':
      return `No cut-in date can be placed${at}: using up the old stock runs past the end of the volume plan`;
    case 'cut_in_beyond_plan':
      return 'The median cut-in falls after the end of the volume plan, so no serial is planned to take the change by then';
    case 'beyond_published_slots':
      return `${f.ref ?? 'A part'}: the order may wait for a supplier slot nobody has announced`;
    case 'unreadable_peer':
      return `Another open ECR${at} could not be read, so supplier conflicts with it are not checked`;
    case 'no_price':
      return `${f.ref ?? 'A part'}: no quote or item master price, so its spend is left out`;
    default:
      return short(f.message);
  }
}

/** The conditions the timeline and supply checks add: the check's own absence, then each gap flag once. */
function siblingConditions(name: string, c: SiblingCheck | undefined): string[] {
  if (!c) return [];
  if (c.state !== 'ready') return [`The ${name} check ${UNAVAILABLE[c.state]}, so it is not assessed`];
  const out: string[] = [];
  const add = (text: string) => {
    if (!out.includes(text)) out.push(text);
  };
  const flags = (c.flags ?? []).filter(f => f.severity === 'warn');
  for (const f of flags) if (!NOT_GAPS.has(f.kind)) add(siblingGap(f));
  // A missed need date: only the timeline check's own flag (the supply check's version of it is the same fact), and
  // only a slip over Bowman's 14-day bar.
  if (name === 'timeline' && flags.some(f => f.kind === 'likely_late') && (c.cutIn?.lateWeeksP90 === undefined || c.cutIn.lateWeeksP90 * 7 > MATERIALITY.cutInSlipDays)) {
    // The bar is read at P90, so the median can slip less than 14 days and still need a condition: quote both, and say which crosses.
    const at = (date?: string, serial?: number) => (date ? `${date}${serial !== undefined ? ` (S/N ${serial})` : ''}` : '');
    const median = at(c.cutIn?.date, c.cutIn?.serial);
    const tail = c.cutIn?.dateP90;
    const bar = `${MATERIALITY.cutInSlipDays} days`;
    const how = median && tail ? ` to ${median} at the median, ${tail} at P90 (tail past ${bar}),` : median ? ` to ${median} at the median, with the P90 tail crossing ${bar},` : `, whose P90 tail crosses ${bar},`;
    add(`CCB to accept the cut-in slip${how} against the stated need${c.cutIn?.stated ? ` (${c.cutIn.stated})` : ''}, or expedite`);
  }
  // An unresolved conflict with another open ECR over a supplier's slot or capacity. Capacity counts only when it
  // is the interaction with a named peer that exceeds it.
  if (name === 'supply' && c.peers?.length) {
    const kinds = [flags.some(f => f.kind === 'slot_contention') ? 'slot' : '', flags.some(f => f.kind === 'capacity_exceeded') ? 'capacity' : ''].filter(Boolean);
    if (kinds.length) add(`Resolve the supplier ${kinds.join(' and ')} conflict with ${c.peers.join(', ')}`);
  }
  return out;
}

export function deriveRecommendation(input: RuleInput): Derived {
  const flags = input.detail?.flags ?? [];
  const blockers: string[] = [];
  for (const c of input.failedChecks ?? []) blockers.push(`${CHECK_NAME[c] ?? c} failed or is blocked`);
  if (!input.detail) blockers.push('the cost check left no detail, so nothing can be assessed');
  const conflicts = flags.filter(f => f.kind === 'conflict');
  if (input.detail?.bomDelta && !input.detail.bomDelta.ok && conflicts.length === 0) blockers.push(`the BOM change conflicts with the baseline (${input.detail.bomDelta.conflicts})`);
  for (const f of flags) {
    if (f.kind === 'conflict') blockers.push(`BOM conflict with the baseline: ${short(f.message)}`);
    else if (f.kind === 'not_converged') blockers.push(`the cost forecast did not converge: ${short(f.message)}`);
    else if (f.severity === 'error') blockers.push(short(f.message));
  }

  // Gaps: blank lines first (named by their label), then every other warning that is not a blocker.
  const conditions: string[] = [];
  const named = new Set<string>();
  for (const i of input.detail?.inputs ?? []) {
    if (!i.needsEstimate) continue;
    named.add(i.id);
    conditions.push(`"${i.label ?? i.id}" is blank or unestimated and counts as $0`);
  }
  // A line that says it rests on an engineer's estimate or a quote but states no amount counts as $0 and the
  // check does not flag it, so look at the line itself rather than at the flags.
  for (const l of input.lines ?? []) {
    if (!l.basis || !STATED_BASES.has(l.basis) || isRange(l.oneTime) || isRange(l.unitCost)) continue;
    named.add(l.id);
    conditions.push(`"${l.label}" is marked as ${l.basis.replace('_', ' ')} but states no amount and counts as $0`);
  }
  for (const f of flags) {
    if (BLOCKING_KINDS.has(f.kind) || (f.severity !== 'warn' && !GAP_KINDS.has(f.kind))) continue;
    if (f.kind === 'needs_estimate' && f.ref && named.has(f.ref)) continue;
    conditions.push(short(f.message));
  }
  // The timeline and supply checks: a check that is not available, or could not assess something, is a stated gap
  // (never a blocker: the cost assessment stands, and sending it back would ask the engineer to fix Norn).
  for (const c of [...siblingConditions('timeline', input.timeline), ...siblingConditions('supply', input.supply)]) if (!conditions.includes(c)) conditions.push(c);

  if (blockers.length) {
    return { recommendation: 'Send back', rule: 1, blockers, conditions, reasoning: `Rule 1 (cannot be assessed as filed): ${blockers.join('; ')}.` };
  }
  if (conditions.length) {
    return {
      recommendation: 'Approve with conditions',
      rule: 2,
      blockers,
      conditions,
      reasoning: `Rule 2 (the assessment stands with stated gaps), conditions: ${conditions.map((c, i) => `(${i + 1}) ${c}`).join('; ')}.`,
    };
  }
  return { recommendation: 'Approve', rule: 3, blockers, conditions, reasoning: 'Rule 3 (no flags and no gaps).' };
}

/**
 * A check run, as far as the rule needs it. The times are SpacetimeDB timestamps at full precision: bigint microseconds
 * since the epoch (`microsSinceUnixEpoch`), never milliseconds. Rows made in one transaction share a timestamp, and a
 * run created a few hundred microseconds later is a different moment that a millisecond value would call the same.
 * A time is null while it has not happened.
 */
export interface RunRow {
  id: bigint;
  stage: string;
  status: string;
  inputHash: string;
  createdUs: bigint;
  startedUs: bigint | null;
  finishedUs: bigint | null;
  /** The s1 run's input hash this run names as its upstream (`inputs.upstream.s1_bom_delta`), for the code stages that read s1. */
  upstreamS1?: string;
  /** The change-request revision the run's inputs name. */
  revision?: number;
  /**
   * When the run completed, read from its results (written in the transaction that completes it, never edited). A run's
   * `finishedAt` is overwritten when it goes stale, so it cannot say when a stale run finished.
   */
  completedUs?: bigint;
}

/**
 * The checks that failed or are blocked, as of the statement's own input snapshot, never the ECR's latest runs:
 * a later failure of a re-run must not turn an unchanged statement's recommendation into Send back.
 *  - s2_cost: the statement's own run.
 *  - s1_bom_delta: the run with the input hash the s2 run names as its upstream (`inputs.upstream.s1_bom_delta`) that
 *    existed and had finished when the s2 run ran: created before it started and finished before it finished, the
 *    newest such. The hash alone is not enough: if the inputs change and then revert, a later run with the same
 *    hash is not what this statement was computed on.
 *  - s0_extract reads the ECR's text and nothing names it, so it counts as of the moment the s2 run finished: its
 *    latest run created before the s2 run, and only if it had already failed by then.
 */
export function failedChecksOf(runs: readonly RunRow[], run: RunRow, upstreamS1: string | undefined): string[] {
  const bad = (st: string) => st === 'failed' || st === 'blocked';
  const live = runs.filter(r => r.status !== 'cancelled');
  const out: string[] = [];
  const s0 = live.filter(r => r.stage === 's0_extract' && r.id < run.id).at(-1);
  if (s0 && bad(s0.status) && (s0.status === 'blocked' || (s0.finishedUs !== null && run.finishedUs !== null && s0.finishedUs <= run.finishedUs))) out.push('s0_extract');
  const began = run.startedUs ?? run.createdUs;
  const s1 =
    upstreamS1 === undefined
      ? undefined
      : live.filter(r => r.stage === 's1_bom_delta' && r.inputHash === upstreamS1 && r.createdUs <= began && r.finishedUs !== null && run.finishedUs !== null && r.finishedUs <= run.finishedUs).at(-1);
  if (s1 && bad(s1.status)) out.push('s1_bom_delta');
  if (bad(run.status)) out.push('s2_cost');
  return out;
}

/** The rule's input from the stored result rows of one s2_cost run. */
export function ruleInputOf(rows: readonly { key: string; label?: string; detailJson: string }[], failedChecks: string[], siblings: { timeline?: SiblingCheck; supply?: SiblingCheck } = {}): RuleInput {
  const parse = (j: string): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(j);
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const row = rows.find(r => r.key === 'detail');
  const lines: RuleLine[] = [];
  for (const r of rows) {
    if (!r.key.startsWith('line:cost:')) continue;
    const d = parse(r.detailJson);
    if (d) lines.push({ id: r.key.slice('line:'.length), label: r.label ?? r.key, basis: typeof d.basis === 'string' ? d.basis : undefined, oneTime: d.oneTime, unitCost: d.unitCost });
  }
  return { detail: row ? (parse(row.detailJson) as RuleDetail | undefined) : undefined, failedChecks, lines, ...siblings };
}
