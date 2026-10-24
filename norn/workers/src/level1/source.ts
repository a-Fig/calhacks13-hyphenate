// Which check run a statement was written from, and what that run's inputs say. The module records
// the run in impact_statement.checkRunId (post_impact_statement: the run that started the session, or
// the run its first computation number was copied from), so the change-request revision and the ERP
// baseline of a statement are read from that run, never inferred from matching numbers.
import type { DbConnection } from '@norn/bindings';
import type { Inputs } from '../impact.ts';

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
