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
//     warning). The conditions name exactly those gaps.
//   Rule 3, Approve: no blocker and no gap.
//   Never Reject: that is a human call.
//
// Info flags (cross-checks, defaults, budgetary quotes) are neither: they are not gaps.

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

export interface RuleInput {
  /** The statement's s2_cost `detail` row, parsed. Undefined when the run has none: nothing can be assessed. */
  detail: RuleDetail | undefined;
  /** Checks that failed or are blocked, by stage (`s0_extract`, `s1_bom_delta`, `s2_cost`), as of the statement's own input snapshot (`failedChecksOf`). */
  failedChecks?: string[];
  /** The stored cost-page lines, so an amount missing on a line's own basis is seen whatever the check flagged. */
  lines?: RuleLine[];
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

/** A check run, as far as the rule needs it. The times are null while they have not happened. */
export interface RunRow {
  id: bigint;
  stage: string;
  status: string;
  inputHash: string;
  createdMs: number;
  startedMs: number | null;
  finishedMs: number | null;
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
  if (s0 && bad(s0.status) && (s0.status === 'blocked' || (s0.finishedMs !== null && run.finishedMs !== null && s0.finishedMs <= run.finishedMs))) out.push('s0_extract');
  const began = run.startedMs ?? run.createdMs;
  const s1 =
    upstreamS1 === undefined
      ? undefined
      : live.filter(r => r.stage === 's1_bom_delta' && r.inputHash === upstreamS1 && r.createdMs <= began && r.finishedMs !== null && run.finishedMs !== null && r.finishedMs <= run.finishedMs).at(-1);
  if (s1 && bad(s1.status)) out.push('s1_bom_delta');
  if (bad(run.status)) out.push('s2_cost');
  return out;
}

/** The rule's input from the stored result rows of one s2_cost run. */
export function ruleInputOf(rows: readonly { key: string; label?: string; detailJson: string }[], failedChecks: string[]): RuleInput {
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
  return { detail: row ? (parse(row.detailJson) as RuleDetail | undefined) : undefined, failedChecks, lines };
}
