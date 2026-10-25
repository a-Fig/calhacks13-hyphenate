// Which timeline (s3) and supply (s4) run a Level 1 statement rests on (#120). Pure: runs in, the answer out.
//
// The statement is written from an s2_cost run (`impact_statement.checkRunId`). s3 and s4 are its siblings: all
// three read the same s1 run (`inputs.upstream.s1_bom_delta`), and the module queues them in one transaction
// (`reconcile`, one timestamp, ids in stage order). So a sibling of the statement is the s3 or s4 run that
//   - names the same s1 hash and the same change-request revision as the s2 run, and
//   - was created no later than the s2 run itself.
// The last rule is what freezes the snapshot without storing anything: a run made afterwards (s4 re-run because
// another ECR was filed or an assumption was recorded) is never eligible, however soon it finishes, so the
// dispatcher and the publisher resolve the same run whenever either looks. Among the eligible runs, the newest by id.
//
// Its state comes from facts that never change after the fact:
//   - done or stale: when it completed. A stale run's `finishedAt` is overwritten when it goes stale (core.ts
//     `reconcile`), so completion is read from its results, which are written in the same transaction as the
//     completion and never edited (`completedMs`).
//   - failed: its `finishedAt`; blocked: blocked.
// A run that had not completed by the cutoff (the s2 run's completion plus a bounded wait) is unavailable, however
// late it finishes afterwards. The cutoff doubles as the dispatcher's patience: it starts the session as soon as
// both have settled, and at the cutoff at the latest, so a hung check cannot hold Level 1 back.
import type { RunRow } from './recommendation.ts';

export const SIBLING_STAGES = ['s3_timeline', 's4_supply'] as const;
export type SiblingStage = (typeof SIBLING_STAGES)[number];

/**
 * How long after the cost check completed Level 1 waits for the timeline and supply checks. Measured on Bowman's data
 * (norn-seed-1, 10,000 draws): s3 takes 0.06 to 0.13 s and s4 0.10 to 0.47 s, against 0.5 to 1.0 s for s2, and the
 * module queues all three at once, so they normally finish within a second or two of each other. 30 s is for a
 * busy worker. A constant, not a setting: the dispatcher and the publisher must agree on it, because it decides
 * which runs a statement counts as having had.
 */
export const SIBLING_WAIT_MS = 30_000;

export type SiblingRunState = 'ready' | 'failed' | 'blocked' | 'pending';

export interface SiblingRun {
  state: SiblingRunState;
  /** The eligible run that answers (ready, failed or blocked). Absent while pending with no run at all; present, but unavailable, when it had not completed by the cutoff. */
  run?: RunRow;
}

/** When a run completed, from facts that never change: the time its results were written, else (a run that is not stale) its `finishedAt`. */
const completedAt = (r: RunRow): number | null => r.completedMs ?? (r.status === 'stale' ? null : r.finishedMs);

/** The moment after which a statement on this s2 run no longer counts a sibling as finished. */
export const siblingCutoffMs = (s2: RunRow): number => (completedAt(s2) ?? s2.createdMs) + SIBLING_WAIT_MS;

/**
 * The s3 or s4 run the statement on `s2` rests on, and how it ended. `pending` means unavailable: it had not completed
 * by the cutoff (queued, running, completed late), or there is no eligible run at all.
 */
export function siblingOf(runs: readonly RunRow[], s2: RunRow, stage: SiblingStage, cutoffMs: number = siblingCutoffMs(s2)): SiblingRun {
  if (s2.upstreamS1 === undefined || s2.revision === undefined) return { state: 'pending' };
  const eligible = runs.filter(r => r.stage === stage && r.status !== 'cancelled' && r.upstreamS1 === s2.upstreamS1 && r.revision === s2.revision && r.createdMs <= s2.createdMs);
  const run = eligible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1);
  if (!run) return { state: 'pending' };
  if (run.status === 'blocked') return { state: 'blocked', run };
  if (run.status === 'failed') return (run.finishedMs ?? run.createdMs) <= cutoffMs ? { state: 'failed', run } : { state: 'pending', run };
  if (run.status === 'done' || run.status === 'stale') {
    const at = completedAt(run);
    return at !== null && at <= cutoffMs ? { state: 'ready', run } : { state: 'pending', run };
  }
  return { state: 'pending', run }; // queued, running
}

/**
 * Whether the dispatcher should still wait: a sibling is not available yet and the cutoff has not come. At the
 * cutoff it goes ahead whatever the state, and the statement says what is missing.
 */
export function waitingForSiblings(runs: readonly RunRow[], s2: RunRow, nowMs: number): boolean {
  if (nowMs >= siblingCutoffMs(s2)) return false;
  return SIBLING_STAGES.some(stage => siblingOf(runs, s2, stage).state === 'pending');
}
