// Which timeline (s3) and supply (s4) run a Level 1 statement rests on (#120). Pure: runs in, the answer out.
//
// The statement is written from an s2_cost run (`impact_statement.checkRunId`). s3 and s4 are its siblings:
// all three read the same s1 run (`inputs.upstream.s1_bom_delta`), so a run of s3 or s4 belongs to the
// statement's snapshot when it names the same s1 hash and the same change-request revision. Among those,
// the statement's own is the newest that had settled (finished, failed or been blocked) by a cutoff that is a
// function of the s2 run alone: when it finished plus a bounded wait. Never a newer run, whenever the
// dispatcher or the publisher happens to look: a re-run of s4 because another ECR was filed, or an
// assumption was recorded, comes after the statement and does not change it.
//
// The cutoff doubles as the dispatcher's patience. It starts the session as soon as s3 and s4 have settled,
// and at the cutoff at the latest, so a hung check cannot hold Level 1 back. Because the dispatcher and the
// publisher read the same cutoff, the agent is told exactly what the PLM will say about each check.
import type { RunRow } from './recommendation.ts';

export const SIBLING_STAGES = ['s3_timeline', 's4_supply'] as const;
export type SiblingStage = (typeof SIBLING_STAGES)[number];

/**
 * How long after the cost check finished Level 1 waits for the timeline and supply checks. Measured on Bowman's data
 * (norn-seed-1, 10,000 draws): s3 takes 0.06 to 0.13 s and s4 0.10 to 0.47 s, against 0.5 to 1.0 s for s2, and the
 * module queues all three at once, so they normally finish within a second or two of each other. 30 s is for a
 * busy worker. A constant, not a setting: the dispatcher and the publisher must agree on it, because it decides
 * which runs a statement counts as having had.
 */
export const SIBLING_WAIT_MS = 30_000;

export type SiblingRunState = 'ready' | 'failed' | 'blocked' | 'pending';

export interface SiblingRun {
  state: SiblingRunState;
  /** The run that answers (ready, failed or blocked). Absent while pending. */
  run?: RunRow;
}

/** The moment after which a statement on this s2 run no longer counts later s3 or s4 runs. */
export const siblingCutoffMs = (s2: RunRow): number => (s2.finishedMs ?? s2.createdMs) + SIBLING_WAIT_MS;

/**
 * The s3 or s4 run the statement on `s2` rests on, and how it ended. `pending`: none had settled by the cutoff
 * (queued, running, or never made). Runs of other revisions or other s1 inputs, and cancelled ones, are not
 * this snapshot's. A stale run counts: it finished on this snapshot's inputs and was only made stale by a later change.
 */
export function siblingOf(runs: readonly RunRow[], s2: RunRow, stage: SiblingStage, cutoffMs: number = siblingCutoffMs(s2)): SiblingRun {
  if (s2.upstreamS1 === undefined || s2.revision === undefined) return { state: 'pending' };
  const mine = runs.filter(r => r.stage === stage && r.status !== 'cancelled' && r.upstreamS1 === s2.upstreamS1 && r.revision === s2.revision);
  const settled = (r: RunRow): boolean => {
    if (r.status === 'done' || r.status === 'stale') return r.finishedMs !== null && r.finishedMs <= cutoffMs;
    if (r.status === 'failed') return (r.finishedMs ?? r.createdMs) <= cutoffMs;
    if (r.status === 'blocked') return r.createdMs <= cutoffMs;
    return false; // queued, running
  };
  const run = mine.filter(settled).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1);
  if (!run) return { state: 'pending' };
  return { state: run.status === 'failed' ? 'failed' : run.status === 'blocked' ? 'blocked' : 'ready', run };
}

/**
 * Whether the dispatcher should still wait: a sibling has not settled and the cutoff has not come. At the
 * cutoff it goes ahead whatever the state, and the statement says what is missing.
 */
export function waitingForSiblings(runs: readonly RunRow[], s2: RunRow, nowMs: number): boolean {
  if (nowMs >= siblingCutoffMs(s2)) return false;
  return SIBLING_STAGES.some(stage => siblingOf(runs, s2, stage).state === 'pending');
}
