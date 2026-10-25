// Apply what passed, re-run the checks, and say what moved. Pure and deterministic: the checks are
// run through an injected function (the CLI wires costCheck and timelineCheck with the run's seed),
// and the same seed gives the same numbers, so the report of a run is a function of its inputs.
//
// Only accepted proposals become assumptions. Each is an AssumptionOverride with source
// 'agent_estimated', so the check marks the input as an agent's estimate and widens nothing by
// itself: the spread is the proposal's own. Code computes every number in the report; the agent
// supplied inputs only.

import { quantileOf, type AssumptionOverride, type CostCheckResult, type Range3, type TimelineResult } from '../../checks/src/index.ts';
import { holdingFlags, type Flag, type Reason, type Status, type Target, type Verdict } from './types.ts';

export interface CheckRun {
  cost: CostCheckResult;
  timeline?: TimelineResult;
}
export type RunChecks = (assumptions: AssumptionOverride[]) => CheckRun;

export type Mode = 'RECORDED' | 'LIVE';

export interface Mover {
  /** The target key (T1...) and its generic label. */
  targetKey: string;
  label: string;
  /** Change in the p50 when only this assumption is applied. */
  deltaP50: number;
}

export interface Change {
  key: string;
  label: string;
  unit: 'USD' | 'weeks';
  before: Range3;
  after: Range3;
  movedBy: Mover[];
}

export interface ProposalLine {
  index: number;
  targetKey: string | null;
  label: string | null;
  status: Status;
  reasons: Reason[];
  flags: Flag[];
  /** What the proposal stands for, as quantiles (set whenever it was well-formed). */
  proposed?: Range3;
  /** The page the quote was found on. Set only when the quote verified. */
  source?: { url: string; retrievedAt: string };
  /** The rationale the check will carry, for accepted proposals. */
  rationale?: string;
}

/** What the agent said about a target it could not answer, as it said it (control characters removed, clipped). */
export interface UnresolvedLine {
  /** The target key the agent named. */
  targetKey: string;
  /** The target's generic label; null when the agent named a key that is not one of the targets. */
  label: string | null;
  reason: string;
}

export interface ResearchReport {
  mode: Mode;
  ecr: string;
  seed: string;
  /** What is real and what is not, in words, for the reader and for the demo. */
  provenance: string[];
  targets: { key: string; label: string; inputId: string; swing: number | null; swingBasis: Target['swingBasis'] }[];
  proposals: ProposalLine[];
  /** Targets the agent declared unresolved, with its reason. */
  unresolved: UnresolvedLine[];
  /** Targets that got no answer at all: no proposal (accepted, held or rejected) and no unresolved entry. */
  unanswered: { key: string; label: string }[];
  changes: Change[];
  unchangedHeadlines: number;
  notApplied: { targetKey: string; message: string }[];
  convergence: { before: boolean; after: boolean };
}

/** Text from the agent, safe to print: control characters (terminal escapes) become spaces, length clipped. */
const cleanText = (s: unknown) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const range = (m: { p10: number; p50: number; p90: number }): Range3 => ({ p10: r2(m.p10), p50: r2(m.p50), p90: r2(m.p90) });

interface Headline { key: string; label: string; unit: 'USD' | 'weeks'; value: Range3 }

export function headlines(run: CheckRun): Headline[] {
  const h = run.cost.headline;
  const out: Headline[] = [];
  for (const u of h.unitCostDelta) out.push({ key: `unitCostDelta:${u.program}`, label: `Unit cost change, ${u.program}, per unit`, unit: 'USD', value: range(u.perUnit) });
  out.push({ key: 'oneTimeTotal', label: 'One-time total', unit: 'USD', value: range(h.oneTimeTotal) });
  out.push({ key: 'recurringWindow', label: `Recurring, ${run.cost.window.months} months from the cut-in`, unit: 'USD', value: range(h.recurringWindow) });
  out.push({ key: 'windowTotal', label: 'Net total, year one', unit: 'USD', value: range(h.windowTotal) });
  out.push({ key: 'planTotal', label: 'Net total, whole volume plan', unit: 'USD', value: range(h.planTotal) });
  const w = run.timeline?.cutIn.weeksFromFiling;
  if (w) out.push({ key: 'cutInWeeks', label: 'Weeks from filing to the line', unit: 'weeks', value: range(w) });
  return out;
}

const same = (a: Range3, b: Range3) => a.p10 === b.p10 && a.p50 === b.p50 && a.p90 === b.p90;

export interface ApplyInput {
  mode: Mode;
  ecr: string;
  seed: string;
  provenance: string[];
  targets: Target[];
  /** Total proposals the agent made, with their verdicts (same order). */
  verdicts: Verdict[];
  /** What the agent said it could not answer. */
  unresolved?: { targetId: string; reason: string }[];
  run: RunChecks;
}

export function applyAndReport(input: ApplyInput): ResearchReport {
  const byKey = new Map(input.targets.map((t) => [t.key, t]));
  // Only an accepted proposal with no holding flag is applied (the guardrails hold a flagged one; this is the second lock).
  const accepted = input.verdicts.filter((v) => v.status === 'accepted' && holdingFlags(v.flags).length === 0 && v.override && v.targetId);
  const overrides = accepted.map((v) => v.override!);

  const before = input.run([]);
  const after = input.run(overrides);
  const hb = headlines(before);
  const ha = new Map(headlines(after).map((h) => [h.key, h]));

  // Which assumption moved which number: apply each alone, same seed.
  const alone = accepted.map((v) => ({ v, heads: new Map(headlines(input.run([v.override!])).map((h) => [h.key, h])) }));

  const changes: Change[] = [];
  let unchanged = 0;
  for (const b of hb) {
    const a = ha.get(b.key);
    if (!a || same(b.value, a.value)) {
      unchanged++;
      continue;
    }
    const movedBy: Mover[] = [];
    for (const { v, heads } of alone) {
      const h = heads.get(b.key);
      if (!h) continue;
      const d = r2(h.value.p50 - b.value.p50);
      if (!same(h.value, b.value)) movedBy.push({ targetKey: v.targetId!, label: byKey.get(v.targetId!)?.label ?? v.targetId!, deltaP50: d });
    }
    changes.push({ key: b.key, label: b.label, unit: b.unit, before: b.value, after: a.value, movedBy });
  }

  // An accepted assumption that no check applied (no input of that id, or a shape it cannot take).
  // The timeline check reports every cost-only assumption as unused, so one counts as not applied
  // only when every check that ran said so.
  const notApplied: ResearchReport['notApplied'] = [];
  const results = [after.cost.flags, ...(after.timeline ? [after.timeline.flags] : [])];
  const unused = (flags: typeof after.cost.flags, id: string) => flags.find((f) => (f.kind === 'unused_assumption' || f.kind === 'assumption_not_applied') && f.ref === id);
  for (const v of accepted) {
    const hits = results.map((fl) => unused(fl, v.override!.id));
    if (hits.every((h) => h !== undefined)) notApplied.push({ targetKey: v.targetId!, message: hits[0]!.message });
  }

  const proposals: ProposalLine[] = input.verdicts.map((v) => {
    const t = v.targetId ? byKey.get(v.targetId) : undefined;
    const line: ProposalLine = { index: v.index, targetKey: v.targetId, label: t?.label ?? null, status: v.status, reasons: v.reasons, flags: v.flags };
    if (v.dist) line.proposed = { p10: r4(quantileOf(v.dist, 0.1)), p50: r4(quantileOf(v.dist, 0.5)), p90: r4(quantileOf(v.dist, 0.9)) };
    if (v.verifiedAgainst) line.source = v.verifiedAgainst;
    if (v.override) line.rationale = v.override.rationale;
    return line;
  });

  const unresolved: UnresolvedLine[] = (input.unresolved ?? []).map((u) => ({ targetKey: cleanText(u.targetId), label: byKey.get(u.targetId)?.label ?? null, reason: cleanText(u.reason) }));
  const answered = new Set<string>([...input.verdicts.map((v) => v.targetId), ...(input.unresolved ?? []).map((u) => u.targetId)].filter((k): k is string => k !== null));
  const unanswered = input.targets.filter((t) => !answered.has(t.key)).map((t) => ({ key: t.key, label: t.label }));

  return {
    mode: input.mode,
    ecr: input.ecr,
    seed: input.seed,
    provenance: input.provenance,
    targets: input.targets.map((t) => ({ key: t.key, label: t.label, inputId: t.inputId, swing: t.swing, swingBasis: t.swingBasis })),
    proposals,
    unresolved,
    unanswered,
    changes,
    unchangedHeadlines: unchanged,
    notApplied,
    convergence: { before: before.cost.convergence.converged, after: after.cost.convergence.converged },
  };
}
