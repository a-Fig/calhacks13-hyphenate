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

export interface RuleInput {
  /** The statement's s2_cost `detail` row, parsed. Undefined when the run has none: nothing can be assessed. */
  detail: RuleDetail | undefined;
  /** Checks whose latest run failed or is blocked, by stage (`s0_extract`, `s1_bom_delta`, `s2_cost`). */
  failedChecks?: string[];
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
  for (const f of flags) {
    if (f.severity !== 'warn' || BLOCKING_KINDS.has(f.kind)) continue;
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

/** Whether a stage's latest non-cancelled run failed or is blocked. `runs` are one ECR's check runs, oldest first. */
export function failedChecksOf(runs: readonly { stage: string; status: string }[]): string[] {
  const out: string[] = [];
  for (const stage of ['s0_extract', 's1_bom_delta', 's2_cost']) {
    const latest = runs.filter(r => r.stage === stage && r.status !== 'cancelled').at(-1);
    if (latest && (latest.status === 'failed' || latest.status === 'blocked')) out.push(stage);
  }
  return out;
}

/** The rule's input from the stored result rows of one s2_cost run. */
export function ruleInputOf(rows: readonly { key: string; detailJson: string }[], failedChecks: string[]): RuleInput {
  const row = rows.find(r => r.key === 'detail');
  let detail: RuleDetail | undefined;
  try {
    const v = row ? JSON.parse(row.detailJson) : undefined;
    if (typeof v === 'object' && v !== null) detail = v as RuleDetail;
  } catch {
    detail = undefined;
  }
  return { detail, failedChecks };
}
