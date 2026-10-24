// What the read tools return: JSON-friendly views over the mirror. Nothing here writes.
import type { Assumption, CheckResult, CheckRun, ImpactStatement, Part, PullRequest } from '@norn/bindings/types';
import type { Timestamp } from 'spacetimedb';
import type { Norn } from './norn.ts';

const iso = (t: Timestamp) => t.toDate().toISOString();
const num = (n: bigint) => Number(n);

function json(s: string): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Parsed JSON, or when it would be longer than `max` characters, a marker with the start of it. */
function bounded(s: string, max: number): unknown {
  if (s.length <= max) return json(s);
  return { truncated: true, chars: s.length, start: s.slice(0, max), howToSeeAll: 'pass key to get_impact to get this trace in full' };
}

/** The four classes (docs/GLOSSARY.md). An assumption's source maps onto them as shown. */
export const EVIDENCE_OF_SOURCE: Record<string, string> = { given: 'fact', default: 'assumption', agent_estimated: 'assumption' };

// The forecast stages in dependency order (module/src/core.ts STAGE_ORDER) and which are cheap code.
const STAGES = [
  { stage: 's0_extract', code: false },
  { stage: 's1_bom_delta', code: true },
  { stage: 's2_cost', code: true },
  { stage: 's3_timeline', code: true },
  { stage: 's4_supply', code: true },
  { stage: 's5_card', code: false },
];

// ---------------------------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------------------------

/** The assumptions an ECR sees: the baseline's current rows, with the ECR's own on top. */
export function effectiveAssumptions(norn: Norn, prId: bigint): (Assumption & { scope: 'baseline' | 'ecr'; overridesBaseline: boolean })[] {
  const byKey = new Map<string, Assumption & { scope: 'baseline' | 'ecr'; overridesBaseline: boolean }>();
  for (const a of norn.db.assumption.prId.filter(0n)) if (a.current) byKey.set(a.key, { ...a, scope: 'baseline', overridesBaseline: false });
  if (prId !== 0n)
    for (const a of norn.db.assumption.prId.filter(prId)) if (a.current) byKey.set(a.key, { ...a, scope: 'ecr', overridesBaseline: byKey.has(a.key) });
  return [...byKey.values()].sort((x, y) => (x.key < y.key ? -1 : 1));
}

export function assumptionView(norn: Norn, a: Assumption & { scope?: string; overridesBaseline?: boolean }) {
  return {
    key: a.key,
    value: json(a.distJson),
    source: a.source,
    evidence: EVIDENCE_OF_SOURCE[a.source] ?? 'assumption',
    rationale: a.rationale,
    revision: a.rev,
    scope: a.scope ?? (a.prId === 0n ? 'baseline' : 'ecr'),
    overridesBaseline: a.overridesBaseline ?? false,
    affectsStages: a.affects.length ? a.affects : 'all',
    setBy: norn.nameOf(a.createdBy).name,
    at: iso(a.createdAt),
  };
}

// ---------------------------------------------------------------------------------------------
// Impact: the latest check results, with the trace behind each number
// ---------------------------------------------------------------------------------------------

/** The newest result with this key that comes from a finished (current) run. */
export function currentResult(norn: Norn, prId: bigint, key: string): CheckResult | undefined {
  let best: CheckResult | undefined;
  for (const r of norn.db.checkResult.prId.filter(prId)) {
    if (r.key !== key || norn.db.checkRun.id.find(r.checkRunId)?.status !== 'done') continue;
    if (!best || r.id > best.id) best = r;
  }
  return best;
}

function resultView(r: CheckResult, traceChars: number, onlyKey?: string) {
  return {
    key: r.key,
    label: r.label,
    unit: r.unit,
    p10: r.p10,
    p50: r.p50,
    p90: r.p90,
    evidence: 'computation',
    mock: r.mock,
    trace: bounded(r.detailJson, onlyKey ? 1_000_000 : traceChars),
  };
}

function runView(norn: Norn, run: CheckRun) {
  const inputs = json(run.inputsJson) as { assumptions?: { id: string; key: string; rev: number }[] } | null;
  const used = (inputs?.assumptions ?? []).map(x => {
    const a = norn.db.assumption.id.find(BigInt(x.id));
    return { key: x.key, revision: x.rev, source: a?.source ?? 'unknown', value: a ? json(a.distJson) : null };
  });
  return {
    runId: num(run.id),
    status: run.status,
    attempts: run.attempts,
    finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
    note: run.note || undefined,
    inputHash: run.inputHash,
    readOf: { baseVersion: (inputs as any)?.baseVersion, codeVersion: (inputs as any)?.codeVersion, seed: (inputs as any)?.seed, upstream: (inputs as any)?.upstream },
    assumptionsUsed: used,
  };
}

export type ImpactState = 'no_results' | 'current' | 'partial' | 'stale';

export function impactOf(norn: Norn, pr: PullRequest, opts: { key?: string; traceChars?: number } = {}) {
  const runs = [...norn.db.checkRun.prId.filter(pr.id)].sort((a, b) => Number(a.id - b.id));
  const results = [...norn.db.checkResult.prId.filter(pr.id)];
  const stages = STAGES.map(({ stage, code }) => {
    const mine = runs.filter(r => r.stage === stage && r.status !== 'cancelled');
    const done = [...mine].reverse().find(r => r.status === 'done');
    const stale = [...mine].reverse().find(r => r.status === 'stale' && results.some(x => x.checkRunId === r.id));
    const latest = mine.at(-1);
    const shown = done ?? stale;
    const rows = shown ? results.filter(x => x.checkRunId === shown.id && (!opts.key || x.key === opts.key)) : [];
    const state = done ? 'current' : stale ? 'stale' : latest ? (latest.status === 'queued' || latest.status === 'running' ? 'pending' : latest.status) : 'not_run';
    return {
      stage,
      kind: code ? 'code' : 'deep',
      state, // current | stale | pending | failed | blocked | not_run
      ...(shown ? { run: runView(norn, shown) } : {}),
      ...(state === 'stale' && latest && latest !== shown ? { refresh: latest.status } : {}),
      ...(!shown && latest ? { latestRun: { runId: num(latest.id), status: latest.status, note: latest.note || undefined } } : {}),
      results: rows.map(r => resultView(r, opts.traceChars ?? 1500, opts.key)),
    };
  }).filter(s => s.kind === 'code' || s.results.length > 0 || s.state !== 'not_run');

  const code = stages.filter(s => s.kind === 'code');
  const total = stages.reduce((n, s) => n + s.results.length, 0);
  const everything = results.length;
  const state: ImpactState = everything === 0 ? 'no_results' : code.some(s => s.state === 'stale') ? 'stale' : code.every(s => s.state === 'current') ? 'current' : 'partial';
  const hint: Record<ImpactState, string> = {
    no_results: 'No check results yet. The checks are queued or running; say the impact is not available yet rather than estimating it.',
    current: 'All cheap checks have finished on the ECR\'s current inputs.',
    partial: 'Some checks have finished and others are still pending, failed or blocked. Report only what is current and name what is missing.',
    stale: 'The ECR\'s inputs changed after these numbers were computed. Fresh runs are queued. Do not present stale numbers as current.',
  };
  void total;
  return { state, hint: hint[state], mock: results.some(r => r.mock), stages };
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export function partView(p: Part) {
  return { partNumber: p.partNumber, name: p.name, category: p.category, spec: json(p.specJson), updatedAt: iso(p.updatedAt) };
}

/** Parts named in the ECR text or in a current check result. The ECR overlay (explicit part changes) is not built yet. */
export function affectedParts(norn: Norn, pr: PullRequest) {
  const haystacks: { where: string; text: string }[] = [{ where: 'ecr_text', text: `${pr.title}\n${pr.description}`.toLowerCase() }];
  const runIds = new Set([...norn.db.checkRun.prId.filter(pr.id)].filter(r => r.status === 'done').map(r => r.id));
  for (const r of norn.db.checkResult.prId.filter(pr.id)) if (runIds.has(r.checkRunId)) haystacks.push({ where: 'check_result', text: r.detailJson.toLowerCase() });
  const out: { partNumber: string; name: string; foundIn: string }[] = [];
  for (const p of norn.db.part.iter()) {
    const needle = p.partNumber.toLowerCase();
    const hit = haystacks.find(h => h.text.includes(needle));
    if (hit) out.push({ partNumber: p.partNumber, name: p.name, foundIn: hit.where });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// ECRs, statements, history
// ---------------------------------------------------------------------------------------------

export function statementView(norn: Norn, s: ImpactStatement, pr: PullRequest) {
  return {
    id: num(s.id),
    level: s.level,
    postedBy: norn.nameOf(s.author),
    postedAt: iso(s.createdAt),
    writtenAtRevision: s.prRevision,
    current: s.prRevision === pr.revision,
    changeClass: s.changeClass,
    route: s.route,
    headline: s.headline,
    numbers: s.numbers.map(n => ({ key: n.key, label: n.label, unit: n.unit, p10: n.p10, p50: n.p50, p90: n.p90, evidence: n.evidence, resultKey: n.resultKey || undefined })),
    drivers: s.drivers,
    assumptions: s.assumptions,
    claims: s.claims,
  };
}

/** The newest statement of each level. */
export function latestStatements(norn: Norn, pr: PullRequest) {
  const byLevel = new Map<number, ImpactStatement>();
  for (const s of norn.db.impactStatement.prId.filter(pr.id)) {
    const seen = byLevel.get(s.level);
    if (!seen || s.id > seen.id) byLevel.set(s.level, s);
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level).map(s => statementView(norn, s, pr));
}

export function ecrSummary(norn: Norn, pr: PullRequest) {
  const impact = impactOf(norn, pr, { traceChars: 0 });
  return {
    ecr: pr.plmEcrNumber,
    title: pr.title,
    status: pr.status,
    revision: pr.revision,
    updatedAt: iso(pr.updatedAt),
    impactState: impact.state,
    statements: [...new Set([...norn.db.impactStatement.prId.filter(pr.id)].map(s => s.level))].sort(),
  };
}

export function ecrView(norn: Norn, pr: PullRequest) {
  const impact = impactOf(norn, pr, { traceChars: 0 });
  return {
    ecr: pr.plmEcrNumber,
    title: pr.title,
    status: pr.status,
    text: pr.description,
    revision: pr.revision,
    baseVersion: pr.baseVersion,
    mergedVersion: pr.mergedVersion ?? null,
    filedBy: norn.nameOf(pr.createdBy).name,
    createdAt: iso(pr.createdAt),
    updatedAt: iso(pr.updatedAt),
    affectedParts: affectedParts(norn, pr),
    affectedPartsNote: 'Found by part number in the ECR text and in current check details; the ECR overlay (explicit part changes) is not built yet, so this can miss parts.',
    impact: { state: impact.state, hint: impact.hint, mock: impact.mock, seeAlso: 'get_impact has the numbers and their traces' },
    statements: latestStatements(norn, pr),
  };
}

export function historyOf(norn: Norn, pr: PullRequest, limit: number) {
  type Item = { at: string; ms: number; [k: string]: unknown };
  const items: Item[] = [];
  const stamp = (t: Timestamp) => ({ at: iso(t), ms: Number(t.microsSinceUnixEpoch / 1000n) });
  for (const c of norn.db.comment.prId.filter(pr.id)) {
    const who = norn.nameOf(c.author);
    items.push({ ...stamp(c.createdAt), type: 'comment', id: num(c.id), by: who.name, onBehalfOf: who.onBehalfOf, anchor: c.anchor || undefined, body: c.body });
  }
  for (const a of norn.db.actionLog.prId.filter(pr.id)) {
    const applied = a.outcome === 'applied';
    items.push({
      ...stamp(a.at),
      type: 'action',
      id: num(a.id),
      outcome: a.outcome,
      reducer: a.reducer,
      summary: a.summary,
      by: a.actorName,
      onBehalfOf: a.onBehalfOf ?? null,
      spawnedBy: a.spawnedBy,
      ...(applied ? {} : { policy: a.policy }),
    });
  }
  items.sort((x, y) => x.ms - y.ms || (x.type === y.type ? 0 : x.type === 'comment' ? -1 : 1));
  const shown = items.slice(-limit).map(({ ms: _ms, ...rest }) => rest);
  return { ecr: pr.plmEcrNumber, total: items.length, shown: shown.length, entries: shown };
}
