// Turning an accepted proposal into the arguments of the module's `record_assumption` reducer, and
// checking afterwards that the assumption is really there.
//
// The mapping is pure. The argument shape is typed against the generated bindings, so a change to the
// reducer breaks the typecheck here instead of a run.

import type { DbConnection } from '@norn/bindings';
import type { Dist } from '../../../checks/src/index.ts';
import type { Target, Verdict } from '../types.ts';

type Reducers = DbConnection['reducers'];
/** What record_assumption takes, without the call metadata the worker's client fills in. */
export type RecordAssumptionArgs = Omit<Parameters<Reducers['recordAssumption']>[0], 'meta'>;
export type AddCommentArgs = Omit<Parameters<Reducers['addComment']>[0], 'meta'>;

/** An assumption row as the worker's cache has it. `createdBy` is the identity's hex string. */
export interface AssumptionRow {
  id: bigint;
  prId: bigint;
  key: string;
  rev: number;
  source: string;
  current: boolean;
  distJson: string;
  createdBy: string;
  rationale: string;
  affects: string[];
}

/**
 * A distribution in the shapes the worker reads (workers/src/impact.ts `toOverride`): lognormal with
 * a median and a spread each side, PERT or triangular with min, mode and max, a fixed value.
 */
export function distToJson(d: Dist): string {
  switch (d.kind) {
    case 'lognormal':
      return JSON.stringify({ kind: 'lognormal', median: d.median, sigmaLow: d.sigmaLow, sigmaHigh: d.sigmaHigh });
    case 'pert':
    case 'triangular':
      return JSON.stringify({ kind: d.kind, min: d.min, mode: d.mode, max: d.max });
    case 'point':
      return JSON.stringify({ kind: 'fixed', value: d.value });
    default:
      throw new Error(`no stored form for a ${(d as { kind: string }).kind} distribution`);
  }
}

/**
 * The stages that read the input. Cost-page rows and recovery and cancellation shares are read by the
 * cost check only (the timeline check would report them as unused); a lead time is the timeline's.
 */
export function affectsFor(inputId: string): string[] {
  return /:lead$/.test(inputId) ? ['s3_timeline'] : ['s2_cost'];
}

export type Mapped = { ok: true; args: RecordAssumptionArgs; targetKey: string } | { ok: false; targetKey: string; why: string };

/**
 * One accepted verdict as a record_assumption call, or why it is not recorded.
 *
 * `existing` are the ECR's assumptions. A current one on the same key that this agent wrote itself is
 * replaced (its revision is the call's expectedRev); one anyone else wrote is left alone. A target is
 * an input the check filled in itself, so this is a race and not the usual case.
 *
 * `crRev` is the change-request revision the proposal was researched against. It goes to the module as
 * `expectedCrRev`, which refuses the write, in the same transaction, when the ECR has moved to another one. The
 * worker's own freshness check cannot do that: it reads a cache, and the ECR can change between the check and the call.
 */
export function toRecordAssumption(prId: bigint, v: Verdict, target: Target, existing: readonly AssumptionRow[], agentHex: string, crRev?: number): Mapped {
  if (v.status !== 'accepted' || !v.override || !v.dist) return { ok: false, targetKey: target.key, why: 'the proposal was not accepted' };
  const cur = existing.find((a) => a.prId === prId && a.key === target.inputId && a.current);
  if (cur && !(cur.source === 'agent_estimated' && cur.createdBy === agentHex)) {
    return { ok: false, targetKey: target.key, why: `${target.inputId} already has a current assumption (${cur.source}, revision ${cur.rev}) that another actor wrote` };
  }
  const flags = v.flags.length ? ` Flagged for a person to read: ${v.flags.map((f) => f.message).join(' ')}` : '';
  return {
    ok: true,
    targetKey: target.key,
    args: {
      prId,
      key: target.inputId,
      distJson: distToJson(v.dist),
      source: 'agent_estimated',
      rationale: `${v.override.rationale}${flags}`,
      affects: affectsFor(target.inputId),
      expectedRev: cur?.rev ?? 0,
      ...(crRev !== undefined ? { expectedCrRev: crRev } : {}),
    },
  };
}

/** An `action_log` row as the worker's cache has it (every write reducer leaves one; `requestId` is the caller's own id for the call). */
export interface LogRow {
  id: bigint;
  prId: bigint;
  requestId: string;
  reducer: string;
  /** applied | denied | downgraded | rejected */
  outcome: string;
  /** For an applied `record_assumption`: `assumption:<id>`. */
  entity: string;
  summary: string;
}

export type CallResult =
  /** The module applied this call and wrote this row. */
  | { state: 'applied'; row: AssumptionRow }
  /**
   * No outcome for this call in the action log, but an identical current row of this agent is in the table. The module
   * logs nothing for a call that changes nothing, so this may be that; it may also be a log row that never arrived. Not
   * counted as recorded: the worker reports it as unconfirmed.
   */
  | { state: 'unconfirmed'; row: AssumptionRow; why: string }
  /** The module refused the call, or its outcome is not what was asked for. */
  | { state: 'refused'; why: string }
  /** No outcome for this call yet. */
  | { state: 'pending' };

/**
 * What became of one `record_assumption` call, from that call's own outcome and nothing else.
 *
 * A scoped agent's refusal returns normally, so the call itself says nothing. The module logs every call under
 * the caller's `requestId` (`applied` with the row it wrote, or `denied`/`rejected` with the reason), so that row
 * is the answer, and the assumption it names must be the one asked for at the revision the call produced
 * (`expectedRev + 1`). A look at the assumption table alone cannot tell a refused call from an older row that
 * happens to match, which is how a refusal used to be counted as a success.
 *
 * The one call that leaves no log row is one that changes nothing (the module returns early when the stored
 * assumption already has the same value, source, rationale and stages). With `final` set and no log row, an identical
 * current row of this agent at the revision the call expected is `unconfirmed`, not applied: the table cannot say
 * whether this call did nothing or its log row is missing, and a success has to rest on the call's own outcome.
 */
export function callResult(args: RecordAssumptionArgs, requestId: string, log: readonly LogRow[], rows: readonly AssumptionRow[], agentHex: string, final = false): CallResult {
  const mine = log.filter((l) => l.requestId === requestId && l.reducer === 'record_assumption').sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
  if (mine) {
    if (mine.outcome !== 'applied') return { state: 'refused', why: mine.summary };
    const id = /^assumption:(\d+)$/.exec(mine.entity)?.[1];
    const row = id ? rows.find((r) => r.id === BigInt(id)) : undefined;
    if (!row) return { state: 'pending' }; // the log row can arrive before the assumption row in the cache
    if (row.prId !== args.prId || row.key !== args.key || row.source !== args.source || row.distJson !== args.distJson || row.createdBy !== agentHex || row.rev !== args.expectedRev + 1)
      return { state: 'refused', why: `the module logged this call as applied, but the assumption it names is ${row.key} rev ${row.rev} (${row.source}), not ${args.key} rev ${args.expectedRev + 1} with this value from this agent` };
    return { state: 'applied', row };
  }
  if (!final) return { state: 'pending' };
  const same = rows.find((r) => r.prId === args.prId && r.key === args.key && r.current && r.createdBy === agentHex && r.source === args.source && r.distJson === args.distJson && r.rev === args.expectedRev && args.expectedRev > 0 && r.rationale === args.rationale && r.affects.join() === args.affects.join());
  if (same) return { state: 'unconfirmed', row: same, why: `unconfirmed: an identical assumption (${same.key} revision ${same.rev}) is in the table, but the module logged no outcome for this call; it may have changed nothing, or the log row has not arrived. Not counted as recorded; see the action log` };
  return { state: 'refused', why: 'the module logged no outcome for this call; see the action log' };
}
