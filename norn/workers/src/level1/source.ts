// Which check run a statement was written from, and what that run's inputs say. The module records
// the run in impact_statement.checkRunId (post_impact_statement: the run that started the session, or
// the run its first computation number was copied from), so the change-request revision and the ERP
// baseline of a statement are read from that run, never inferred from matching numbers.
import type { DbConnection } from '@norn/bindings';
import type { Inputs } from '../impact.ts';
import { failedChecksOf, ruleInputOf, type RuleInput, type RunRow, type SiblingCheck } from './recommendation.ts';
import { SIBLING_STAGES, siblingOf, type SiblingStage } from './siblings.ts';
import { ruleCheckOf, type SiblingView } from './timeline-supply.ts';

type Db = DbConnection['db'];

export function jsonOr<T>(s: string, d: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
}

/** The inputs of a check run, or undefined when there is no such run (checkRunId 0, or not in the cache). */
export function runInputs(db: Db, checkRunId: bigint): Inputs | undefined {
  const run = checkRunId === 0n ? undefined : db.checkRun.id.find(checkRunId);
  return run ? jsonOr<Inputs>(run.inputsJson, {}) : undefined;
}

/** The change-request revision (ecr_revision.seq) the run's numbers are for, or null when unknown (no run, or mock numbers). */
export function crSeqOfRun(db: Db, checkRunId: bigint): number | null {
  const r = runInputs(db, checkRunId)?.revision;
  return typeof r === 'number' ? r : null;
}

/**
 * The checks that failed or are blocked as of a statement's own run (see `failedChecksOf`), read from the cache.
 * The dispatcher and the publisher both call it with the same run, so the agent is told what the PLM will say
 * and a later failure on the ECR does not change an existing statement's recommendation.
 */
export function failedChecksForRun(db: Db, prId: bigint, checkRunId: bigint): string[] {
  const run = checkRunId === 0n ? undefined : db.checkRun.id.find(checkRunId);
  if (!run) return [];
  const runs = [...db.checkRun.prId.filter(prId)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => toRunRow(r));
  return failedChecksOf(runs, toRunRow(run), runInputs(db, checkRunId)?.upstream?.s1_bom_delta);
}

type RunRecord = ReturnType<Db['checkRun']['id']['find']> & object;

/** A stored check run as the rules read it: times at full precision (bigint microseconds, see `RunRow`), and the s1 hash and revision its inputs name. */
export function toRunRow(r: RunRecord, completedUs?: bigint): RunRow {
  const inputs = jsonOr<Inputs>(r.inputsJson, {});
  return {
    id: r.id,
    stage: r.stage,
    status: r.status,
    inputHash: r.inputHash,
    createdUs: r.createdAt ? r.createdAt.microsSinceUnixEpoch : 0n,
    startedUs: r.startedAt ? r.startedAt.microsSinceUnixEpoch : null,
    finishedUs: r.finishedAt ? r.finishedAt.microsSinceUnixEpoch : null,
    ...(typeof inputs.upstream?.s1_bom_delta === 'string' ? { upstreamS1: inputs.upstream.s1_bom_delta } : {}),
    ...(typeof inputs.revision === 'number' ? { revision: inputs.revision } : {}),
    ...(completedUs !== undefined ? { completedUs } : {}),
  };
}

/** All of an ECR's check runs, oldest first. */
export function runRowsOf(db: Db, prId: bigint): RunRow[] {
  // When a run completed: its results are written in that transaction and never edited, unlike its `finishedAt` (reset when it goes stale).
  const completed = new Map<bigint, bigint>();
  for (const x of db.checkResult.prId.filter(prId)) {
    const at = x.createdAt?.microsSinceUnixEpoch;
    const seen = completed.get(x.checkRunId);
    if (at !== undefined && (seen === undefined || seen > at)) completed.set(x.checkRunId, at);
  }
  return [...db.checkRun.prId.filter(prId)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => toRunRow(r, completed.get(r.id)));
}

/**
 * The timeline and supply checks a statement on this s2 run rests on (siblings.ts), with their stored rows. A run that
 * is not an s2_cost run, or is not in the cache, binds nothing: undefined, and the rule then says nothing about them. Read the same
 * way by the dispatcher (what the agent is told) and the publisher (what the PLM shows).
 */
export function siblingsForRun(db: Db, prId: bigint, s2RunId: bigint): { timeline: SiblingView; supply: SiblingView } | undefined {
  const s2 = s2RunId === 0n ? undefined : db.checkRun.id.find(s2RunId);
  if (!s2 || s2.stage !== 's2_cost') return undefined;
  const runs = runRowsOf(db, prId);
  const own = runs.find(r => r.id === s2RunId) ?? toRunRow(s2);
  const results = [...db.checkResult.prId.filter(prId)];
  const view = (stage: SiblingStage): SiblingView => {
    const s = siblingOf(runs, own, stage);
    if (!s.run) return { state: 'pending', rows: [] };
    if (s.state !== 'ready') return { state: s.state, runId: Number(s.run.id), rows: [] };
    const rows = results.filter(r => r.checkRunId === s.run!.id).sort((a, b) => Number(a.id - b.id));
    if (rows.some(r => r.mock)) return { state: 'mock', runId: Number(s.run.id), rows: [] };
    return { state: 'ready', runId: Number(s.run.id), rows };
  };
  const [timeline, supply] = SIBLING_STAGES.map(view) as [SiblingView, SiblingView];
  return { timeline, supply };
}

/**
 * The timeline and supply checks as the rule reads them for `ecr` (the statement's ECR number): a peer ECR's flags in
 * the supply check are not this ECR's gaps. The one place the three callers (dispatcher, publisher, guard) build them.
 */
export function ruleSiblingsOf(siblings: { timeline: SiblingView; supply: SiblingView } | undefined, ecr: string): { timeline?: SiblingCheck; supply?: SiblingCheck } {
  return siblings ? { timeline: ruleCheckOf(siblings.timeline, ecr), supply: ruleCheckOf(siblings.supply, ecr) } : {};
}

/**
 * What the recommendation rule reads for a statement written from this s2 run: its own results, the checks that failed
 * as of its snapshot, and the timeline and supply checks bound to it. The dispatcher and the publisher assemble the same
 * input; the post tool's guard (guard.ts) uses this to check a statement's words against it before it is saved.
 */
export function ruleInputForRun(db: Db, prId: bigint, s2RunId: bigint, ecr: string): { input: RuleInput; results: { p10: number; p50: number; p90: number; detailJson: string }[] } | undefined {
  const run = s2RunId === 0n ? undefined : db.checkRun.id.find(s2RunId);
  if (!run || run.stage !== 's2_cost') return undefined;
  const rows = [...db.checkResult.prId.filter(prId)].filter(r => r.checkRunId === run.id);
  const siblings = siblingsForRun(db, prId, run.id);
  const input = ruleInputOf(rows, failedChecksForRun(db, prId, run.id), ruleSiblingsOf(siblings, ecr));
  return { input, results: [...rows, ...(siblings ? [...siblings.timeline.rows, ...siblings.supply.rows] : [])] };
}
