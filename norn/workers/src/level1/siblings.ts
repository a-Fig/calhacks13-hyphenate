// Which timeline (s3) and supply (s4) run a Level 1 statement rests on (#120, #123, and the settle rule below). Pure: runs in, the answer out.
//
// The statement is written from an s2_cost run (`impact_statement.checkRunId`). s3 and s4 are its siblings: all
// three read the same s1 run (`inputs.upstream.s1_bom_delta`) on the same change-request revision, and the module
// queues them in one transaction (`reconcile`). But they do not stay put: every ECR filed afterwards re-runs the
// supply check of the ECRs it shares a supplier with (s4 compares peers), so an ECR in a batch can have its s4 re-run
// several times within seconds of s2 finishing. A rule that binds the s4 made together with s2 binds a run that went
// stale before the session even started, and the live s4 is "later" than s2 and so excluded (the supply section then
// read "unavailable" on five of ten ECRs in a live rerun). So the statement binds a snapshot, not the s2 run's moment.
//
// The snapshot. The dispatcher starts a session only once supply has settled (below), and at that moment records
// `snapshotUs`: the newest database time it has seen on the ECR's s2 run and on its s3 and s4 runs for this s1 hash and
// revision (`siblingSnapshotUs`, microseconds, a database timestamp: no clock of the dispatcher's is involved). It
//   - writes the session's prompt from it,
//   - signs it into the session's credential (`spawnedBy`, ":snap:<us>", read by the module's `parseSessionSpawn`), from
//     where the post guard reads it and the module stores it on the statement (`impact_statement.snapshotUs`), and
//   - the publisher reads it from the statement.
// All three then call `siblingOf` with the same runs and the same `atUs`, so the numbers and sentences the session
// was given are the table the PLM shows, however many times s4 is re-run afterwards.
//
// A sibling is, for one stage, the newest run (by id) that
//   - names the same s1 hash and the same change-request revision as the s2 run,
//   - is not cancelled, and
//   - was created no later than `atUs`.
// Its state comes from facts that never change after the fact:
//   - done or stale: when it completed. A stale run's `finishedAt` is overwritten when it goes stale (core.ts
//     `reconcile`), so completion is read from its results, which are written in the same transaction as the
//     completion and never edited (`completedUs`). A run that completed by `atUs` is ready, even if it has gone stale
//     since: its results are what the session was told.
//   - failed: its `finishedAt`; blocked: blocked.
// A run that had not completed by `atUs` is unavailable, however soon it finishes afterwards. The snapshot time is
// the newest time the dispatcher saw on those runs, so a run it could not see yet (the client cache lags the
// database) was created after `atUs` and is excluded everywhere, which is why no clock comparison, and no wait for
// the cache, is needed to make the three agree.
//
// A statement with no snapshot (posted outside a session, or by an older credential) binds at `siblingCutoffUs`: the s2
// run's completion plus a fixed wait, a function of the s2 run alone.
//
// Settling (the dispatcher's wait). `siblingsUnsettled`: while an s3 or s4 run of the ECR on its current change-request
// revision is queued or running, or the newest is stale (its replacement is about to be queued), or a stage has no
// run to bind, the dispatcher does not start the session. It goes ahead anyway once `settleCapUs` (the s2 run's
// completion plus `SETTLE_WAIT_MS`) plus a short cache grace has strictly passed, so a hung check cannot hold Level 1
// back; the section then says unavailable. The grace: the dispatcher reads its client cache, which lags the database
// by milliseconds, so at the cap it gives a run that just finished 2 s to arrive.
//
// Every time here is a SpacetimeDB timestamp at full precision: bigint microseconds, never milliseconds (see `RunRow`).
import type { RunRow } from './recommendation.ts';

export const SIBLING_STAGES = ['s3_timeline', 's4_supply'] as const;
export type SiblingStage = (typeof SIBLING_STAGES)[number];

/**
 * How long after the cost check completed a statement with no snapshot still counts a timeline or supply run as
 * finished (`siblingCutoffUs`). Measured on Bowman's data (norn-seed-1, 10,000 draws): s3 takes 0.06 to 0.13 s and s4
 * 0.10 to 0.47 s, against 0.5 to 1.0 s for s2. A constant: it decides which runs such a statement counts as having had.
 */
export const SIBLING_WAIT_MS = 30_000;
export const SIBLING_WAIT_US = BigInt(SIBLING_WAIT_MS) * 1000n;

/**
 * How long after the cost check completed the dispatcher waits for supply to settle, at most. A batch of ECRs filed
 * within seconds re-runs each other's supply checks for a while (every filing re-runs its peers'), so this is longer
 * than the first run's own time. Set with NORN_L1_SETTLE_MS (settings.ts).
 */
export const SETTLE_WAIT_MS = 180_000;
export const SETTLE_WAIT_US = BigInt(SETTLE_WAIT_MS) * 1000n;

/** How long past the cap the dispatcher still waits: the client cache lags the database by milliseconds, so 2 s is ample. */
export const SIBLING_CACHE_GRACE_US = 2_000_000n;

export type SiblingRunState = 'ready' | 'failed' | 'blocked' | 'pending';

export interface SiblingRun {
  state: SiblingRunState;
  /** The eligible run that answers (ready, failed or blocked). Absent while pending with no run at all; present, but unavailable, when it had not completed by the snapshot. */
  run?: RunRow;
}

const byId = (a: RunRow, b: RunRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** When a run completed, from facts that never change: the time its results were written, else (a run that is not stale) its `finishedAt`. */
const completedAt = (r: RunRow): bigint | null => r.completedUs ?? (r.status === 'stale' ? null : r.finishedUs);

/** The runs of a stage that read the same s1 run and change-request revision as the s2 run, whatever their state (but not cancelled). */
const ofSnapshot = (runs: readonly RunRow[], s2: RunRow, stage: SiblingStage) => runs.filter(r => r.stage === stage && r.status !== 'cancelled' && r.upstreamS1 === s2.upstreamS1 && r.revision === s2.revision);

/** The moment after which a statement with no snapshot no longer counts a sibling as finished (and the one it binds at). */
export const siblingCutoffUs = (s2: RunRow): bigint => (completedAt(s2) ?? s2.createdUs) + SIBLING_WAIT_US;

/** The moment after which the dispatcher stops waiting for supply to settle (before the cache grace). */
export const settleCapUs = (s2: RunRow, waitUs: bigint = SETTLE_WAIT_US): bigint => (completedAt(s2) ?? s2.createdUs) + waitUs;

/**
 * The time a session's snapshot is taken at: the newest database time on the s2 run and on the s3 and s4 runs of its
 * s1 hash and revision (when they were created, and when they completed). Everything the cache holds of them is at or
 * before it, and anything the cache does not hold yet is after it.
 */
export function siblingSnapshotUs(runs: readonly RunRow[], s2: RunRow): bigint {
  let at = max(s2.createdUs, completedAt(s2) ?? 0n);
  for (const stage of SIBLING_STAGES) for (const r of ofSnapshot(runs, s2, stage)) at = max(at, max(r.createdUs, completedAt(r) ?? 0n));
  return at;
}

/**
 * The s3 or s4 run the statement on `s2` rests on, and how it ended, as of `atUs` (the session's snapshot; the cutoff
 * when there is none). `pending` means unavailable: it had not completed by `atUs` (queued, running, completed
 * late), or there is no eligible run at all.
 */
export function siblingOf(runs: readonly RunRow[], s2: RunRow, stage: SiblingStage, atUs: bigint = siblingCutoffUs(s2)): SiblingRun {
  if (s2.upstreamS1 === undefined || s2.revision === undefined) return { state: 'pending' };
  const run = ofSnapshot(runs, s2, stage)
    .filter(r => r.createdUs <= atUs)
    .sort(byId)
    .at(-1);
  if (!run) return { state: 'pending' };
  if (run.status === 'blocked') return { state: 'blocked', run };
  if (run.status === 'failed') return (run.finishedUs ?? run.createdUs) <= atUs ? { state: 'failed', run } : { state: 'pending', run };
  if (run.status === 'done' || run.status === 'stale') {
    const at = completedAt(run);
    return at !== null && at <= atUs ? { state: 'ready', run } : { state: 'pending', run };
  }
  return { state: 'pending', run }; // queued, running
}

/**
 * Whether supply has not settled for this s2 run: an s3 or s4 run of the ECR on its change-request revision (any s1
 * hash) is queued or running, or the newest of a stage is stale (the module queues the replacement in the same
 * transaction, but the cache may show one before the other), or the snapshot would have no answer for a stage.
 * Failed and blocked runs are settled.
 */
export function siblingsUnsettled(runs: readonly RunRow[], s2: RunRow): boolean {
  if (s2.upstreamS1 === undefined || s2.revision === undefined) return true;
  const at = siblingSnapshotUs(runs, s2);
  return SIBLING_STAGES.some(stage => {
    const own = runs.filter(r => r.stage === stage && r.status !== 'cancelled' && r.revision === s2.revision).sort(byId);
    if (own.some(r => r.status === 'queued' || r.status === 'running')) return true;
    if (own.at(-1)?.status === 'stale') return true;
    return siblingOf(runs, s2, stage, at).state === 'pending';
  });
}

/**
 * Whether the dispatcher should still wait: supply has not settled and the cap plus the grace has not strictly passed.
 * After that it goes ahead whatever the state, and the statement says what is missing. `nowUs` is the clock in
 * microseconds; a clock read in whole milliseconds is never ahead of the true time, so it only errs towards waiting.
 */
export function waitingForSiblings(runs: readonly RunRow[], s2: RunRow, nowUs: bigint, waitUs: bigint = SETTLE_WAIT_US): boolean {
  if (nowUs > settleCapUs(s2, waitUs) + SIBLING_CACHE_GRACE_US) return false;
  return siblingsUnsettled(runs, s2);
}
