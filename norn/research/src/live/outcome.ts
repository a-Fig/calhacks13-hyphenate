// What a research run leaves behind, built from the agent's output and the guardrails' verdicts:
// the record_assumption calls for the accepted proposals, one stored result with every proposal and
// why it was or was not used, and a comment for the people on the ECR. Pure.
//
// Where a person finds what was not used:
//   - the comment on the ECR (add_comment), for anything held, rejected, flagged or not found;
//   - the `research_result` event under the run's job id in agent_event, with the full record;
//   - a JSON copy under norn/research/logs/ on the machine that ran it.

import { quantileOf, type Range3 } from '../../../checks/src/index.ts';
import type { AgentOutput, Flag, Reason, Status, Target, Unit, Verdict } from '../types.ts';
import { toRecordAssumption, type AddCommentArgs, type AssumptionRow, type RecordAssumptionArgs } from './assumptions.ts';
import { distToJson } from './assumptions.ts';

export type Mode = 'LIVE' | 'RECORDED';

export interface ProposalRecord {
  index: number;
  targetKey: string | null;
  label: string | null;
  inputId: string | null;
  status: Status;
  reasons: Reason[];
  flags: Flag[];
  unit: Unit | null;
  /** What the proposal stands for, as quantiles. Set when it was well-formed. */
  proposed?: Range3;
  /** The distribution as the call would store it. Set when it was well-formed: a person can record it by hand. */
  distJson?: string;
  /** What the agent said, as far as it was well-formed. */
  sourceUrl?: string;
  quote?: string;
  /** The date the source states for itself (publication or "prices as of"); absent when the agent gave none. */
  sourceDate?: string;
  retrievedAt?: string;
  confidence?: string;
  rationale?: string;
  /** Whether the quote was found on the page the guardrails fetched themselves. */
  quoteVerified: boolean;
  /** How the guardrails read the page the quote was checked on: a plain HTTPS fetch, or Bright Data when that failed. */
  verifiedVia?: 'fetch' | 'brightdata' | 'recorded';
}

export interface Outcome {
  kind: 'norn-research-result';
  version: 1;
  /** RECORDED: nothing here was researched live. */
  mode: Mode;
  key: string;
  ecr: string;
  revision: number;
  digest: string;
  s2RunId: number;
  jobId: string;
  sessionId: string | null;
  model: string | null;
  at: string;
  targets: { key: string; label: string; inputId: string; swing: number | null }[];
  proposals: ProposalRecord[];
  unresolved: { targetKey: string; reason: string }[];
  /** Questions that got no answer at all: no proposal (used, held or rejected) and no unresolved entry. */
  unanswered: { targetKey: string; label: string }[];
  /** Accepted but not recorded, with why. */
  notRecorded: { targetKey: string; why: string }[];
  /** record_assumption calls the worker made, filled in by the worker after it has checked each took effect. */
  recorded: { targetKey: string; key: string; rev: number; assumptionId: number }[];
  /** Calls that did not take effect, with what the module said or that the worker could not see the assumption afterwards. */
  failed: { targetKey: string; key: string; why: string }[];
  /** Set when the ECR moved on while the agent worked, so nothing was recorded. */
  superseded: string | null;
  /** Set when no agent was run: there was nothing to ask. The result is stored all the same, as the record that research is over for the revision. */
  skipped?: string;
}

export interface OutcomeInput {
  mode: Mode;
  key: string;
  ecr: string;
  prId: bigint;
  revision: number;
  digest: string;
  s2RunId: bigint;
  jobId: string;
  sessionId?: string | undefined;
  model?: string | undefined;
  now: string;
  targets: Target[];
  agentOutput: AgentOutput;
  verdicts: Verdict[];
  existing: readonly AssumptionRow[];
  agentHex: string;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
/** Agent text that goes on the ECR page: no control characters, one line, bounded (the same cleaning as the report's). */
const clean = (s: unknown) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

export function buildOutcome(i: OutcomeInput): { outcome: Outcome; calls: { targetKey: string; args: RecordAssumptionArgs }[] } {
  const byKey = new Map(i.targets.map((t) => [t.key, t]));
  const proposals: ProposalRecord[] = i.verdicts.map((v) => {
    const t = v.targetId ? byKey.get(v.targetId) : undefined;
    const raw = (i.agentOutput.proposals[v.index] ?? {}) as Record<string, unknown>;
    const rec: ProposalRecord = {
      index: v.index,
      targetKey: v.targetId,
      label: t?.label ?? null,
      inputId: t?.inputId ?? null,
      status: v.status,
      reasons: v.reasons,
      flags: v.flags,
      unit: t?.unit ?? null,
      quoteVerified: v.verifiedAgainst !== undefined,
      ...(v.verifiedAgainst?.via ? { verifiedVia: v.verifiedAgainst.via } : {}),
    };
    if (v.dist) {
      rec.proposed = { p10: r4(quantileOf(v.dist, 0.1)), p50: r4(quantileOf(v.dist, 0.5)), p90: r4(quantileOf(v.dist, 0.9)) };
      rec.distJson = distToJson(v.dist);
    }
    for (const [k, f] of [['sourceUrl', 'sourceUrl'], ['quote', 'quote'], ['sourceDate', 'sourceDate'], ['retrievedAt', 'retrievedAt'], ['confidence', 'confidence'], ['rationale', 'rationale']] as const) {
      const s = str(raw[f]);
      if (s !== undefined) (rec as unknown as Record<string, unknown>)[k] = s.slice(0, 1200);
    }
    return rec;
  });

  const calls: { targetKey: string; args: RecordAssumptionArgs }[] = [];
  const notRecorded: Outcome['notRecorded'] = [];
  // In target order, which is the order of swing on the year-one total.
  const order = new Map(i.targets.map((t, n) => [t.key, n]));
  const accepted = i.verdicts.filter((v) => v.status === 'accepted' && v.targetId && byKey.has(v.targetId)).sort((a, b) => (order.get(a.targetId!) ?? 0) - (order.get(b.targetId!) ?? 0));
  for (const v of accepted) {
    const m = toRecordAssumption(i.prId, v, byKey.get(v.targetId!)!, i.existing, i.agentHex, i.revision > 0 ? i.revision : undefined);
    if (m.ok) calls.push({ targetKey: m.targetKey, args: m.args });
    else notRecorded.push({ targetKey: m.targetKey, why: m.why });
  }

  const outcome: Outcome = {
    kind: 'norn-research-result',
    version: 1,
    mode: i.mode,
    key: i.key,
    ecr: i.ecr,
    revision: i.revision,
    digest: i.digest,
    s2RunId: Number(i.s2RunId),
    jobId: i.jobId,
    sessionId: i.sessionId ?? null,
    model: i.model ?? null,
    at: i.now,
    targets: i.targets.map((t) => ({ key: t.key, label: t.label, inputId: t.inputId, swing: t.swing })),
    proposals,
    unresolved: (i.agentOutput.unresolved ?? []).map((u) => ({ targetKey: clean(u.targetId), reason: clean(u.reason) })),
    unanswered: i.targets
      .filter((t) => !new Set<string>([...i.verdicts.map((v) => v.targetId), ...(i.agentOutput.unresolved ?? []).map((u) => u.targetId)].filter((k): k is string => k !== null)).has(t.key))
      .map((t) => ({ targetKey: t.key, label: t.label })),
    notRecorded,
    recorded: [],
    failed: [],
    superseded: null,
  };
  return { outcome, calls };
}

// ---------------------------------------------------------------- the comment

const MAX_COMMENT = 3900;
const num = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : String(r4(x)));
const range = (p: Range3 | undefined, unit: Unit | null) => (p ? `${num(p.p50)} (p10 ${num(p.p10)}, p90 ${num(p.p90)}) ${unit === 'usd' ? 'USD' : unit === 'weeks' ? 'weeks' : 'as a share'}` : 'no usable value');
/** Several messages as sentences: each ends in a full stop, so they do not run into one another on the page. */
const sentences = (xs: string[]) => xs.map((x) => (/[.!?]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`)).join(' ');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function source(p: ProposalRecord): string {
  if (!p.sourceUrl) return 'no source given';
  const q = p.quote ? ` "${cut(p.quote, 240)}"` : '';
  return `${p.sourceUrl}${q}, source dated ${p.sourceDate ?? 'unknown (the agent gave none)'}, retrieved ${p.retrievedAt?.slice(0, 10) ?? 'on an unknown date'}, confidence ${p.confidence ?? 'unstated'}${p.quoteVerified ? '' : ', quote not verified'}`;
}

/**
 * The comment for the people on the ECR, or null when everything was used without a flag and there is
 * nothing to read. Business words only: this is shown on the ECR page.
 */
export function commentFor(o: Outcome): string | null {
  const used = (p: ProposalRecord) => o.recorded.some((r) => r.targetKey === p.targetKey);
  const flagged = o.proposals.filter((p) => p.status === 'accepted' && p.flags.length);
  const held = o.proposals.filter((p) => p.status === 'needs_person');
  const rejected = o.proposals.filter((p) => p.status === 'rejected');
  const lines: string[] = [];
  if (!held.length && !rejected.length && !flagged.length && !o.unresolved.length && !o.unanswered.length && !o.notRecorded.length && !o.failed.length && !o.superseded) return null;
  const recordedNow = o.recorded.length;
  lines.push(`Research agent (cost engineer), ${o.mode === 'RECORDED' ? 'RECORDED run, not researched live' : `public sources through Bright Data`}. ${o.targets.length} question(s)${o.revision > 0 ? ` on change request revision ${o.revision}` : ''}; ${recordedNow} used as agent estimate(s).`);
  if (o.superseded) lines.push(`Not used: ${o.superseded}`);
  if (flagged.length) {
    lines.push('', `Used, and worth a read (${flagged.length}):`);
    for (const p of flagged) lines.push(`- ${p.label}: ${range(p.proposed, p.unit)}${used(p) ? '' : ' (not recorded)'}. ${source(p)}. ${p.flags.map((f) => f.message).join(' ')}`);
  }
  if (held.length) {
    lines.push('', `Held for a person (${held.length}). Not used in the forecast:`);
    for (const p of held) {
      lines.push(`- ${p.label ?? 'a question'}: ${range(p.proposed, p.unit)}. ${source(p)}. Why held: ${sentences([...p.reasons.map((r) => r.message), ...p.flags.map((f) => f.message)])}`);
      if (p.distJson && p.inputId) lines.push(`  To use it, record an assumption on ${p.inputId} with ${p.distJson}`);
    }
  }
  if (rejected.length) {
    lines.push('', `Rejected (${rejected.length}):`);
    for (const p of rejected) lines.push(`- ${p.label ?? `proposal ${p.index + 1}`}: ${sentences(p.reasons.map((r) => r.message))}`);
  }
  if (o.unresolved.length) {
    lines.push('', `Not found (${o.unresolved.length}):`);
    for (const u of o.unresolved) lines.push(`- ${o.targets.find((t) => t.key === u.targetKey)?.label ?? u.targetKey}: ${u.reason}`);
  }
  if (o.unanswered.length) {
    lines.push('', `No answer (${o.unanswered.length}): the agent made no proposal and did not say it was unresolved:`);
    for (const u of o.unanswered) lines.push(`- ${u.label}`);
  }
  if (o.notRecorded.length || o.failed.length) {
    lines.push('', 'Accepted but not recorded:');
    for (const n of o.notRecorded) lines.push(`- ${o.targets.find((t) => t.key === n.targetKey)?.label ?? n.targetKey}: ${n.why}`);
    for (const n of o.failed) lines.push(`- ${o.targets.find((t) => t.key === n.targetKey)?.label ?? n.targetKey}: ${n.why}`);
  }
  if (o.mode === 'LIVE') lines.push('', `Full record: the research_result event of job ${o.jobId}.`);
  const text = lines.join('\n');
  return text.length <= MAX_COMMENT ? text : `${text.slice(0, MAX_COMMENT - 80)}\n… (cut; the full record is the research_result event of job ${o.jobId})`;
}

export function commentArgs(o: Outcome, prId: bigint): AddCommentArgs | null {
  const body = commentFor(o);
  return body ? { prId, anchor: `check_run:${o.s2RunId}`, body } : null;
}
