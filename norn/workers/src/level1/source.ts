// Which check run a statement was written from, and what that run's inputs say. The module records
// the run in impact_statement.checkRunId (post_impact_statement: the run that started the session, or
// the run its first computation number was copied from), so the change-request revision and the ERP
// baseline of a statement are read from that run, never inferred from matching numbers.
import type { DbConnection } from '@norn/bindings';
import type { Inputs } from '../impact.ts';
import { failedChecksOf, type RunRow } from './recommendation.ts';
import { SIBLING_STAGES, siblingOf, type SiblingStage } from './siblings.ts';
import type { SiblingView } from './timeline-supply.ts';

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
  return failedChecksOf(runRowsOf(db, prId), toRunRow(run), runInputs(db, checkRunId)?.upstream?.s1_bom_delta);
}

type RunRecord = ReturnType<Db['checkRun']['id']['find']> & object;

/** A stored check run as the rules read it: times in milliseconds, and the s1 hash and revision its inputs name. */
export function toRunRow(r: RunRecord): RunRow {
  const inputs = jsonOr<Inputs>(r.inputsJson, {});
  return {
    id: r.id,
    stage: r.stage,
    status: r.status,
    inputHash: r.inputHash,
    createdMs: r.createdAt ? Number(r.createdAt.microsSinceUnixEpoch / 1000n) : 0,
    startedMs: r.startedAt ? Number(r.startedAt.microsSinceUnixEpoch / 1000n) : null,
    finishedMs: r.finishedAt ? Number(r.finishedAt.microsSinceUnixEpoch / 1000n) : null,
    ...(typeof inputs.upstream?.s1_bom_delta === 'string' ? { upstreamS1: inputs.upstream.s1_bom_delta } : {}),
    ...(typeof inputs.revision === 'number' ? { revision: inputs.revision } : {}),
  };
}

/** All of an ECR's check runs, oldest first. */
export function runRowsOf(db: Db, prId: bigint): RunRow[] {
  return [...db.checkRun.prId.filter(prId)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(toRunRow);
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
  const own = toRunRow(s2);
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
