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
 */
export function toRecordAssumption(prId: bigint, v: Verdict, target: Target, existing: readonly AssumptionRow[], agentHex: string): Mapped {
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
    },
  };
}

/** The current assumption row that is exactly what the call asked for, written by this agent; undefined when there is none. */
export function appliedRow(args: RecordAssumptionArgs, rows: readonly AssumptionRow[], agentHex: string): AssumptionRow | undefined {
  return rows.find((r) => r.prId === args.prId && r.key === args.key && r.current && r.source === args.source && r.distJson === args.distJson && r.createdBy === agentHex);
}
