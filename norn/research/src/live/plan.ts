// What starts a research run, and what stops a second one. Pure: the caller reads the database and
// passes plain facts, so the rules are tested without SpacetimeDB.
//
// The record of what has happened is the agent_event table, as for the Level 1 dispatcher: a run
// that started has a `job_started` event under its job id, and one that finished with a result has a
// `research_result` event under the same job id. A restart reads those and starts nothing twice.
// The unit of work is one change-request revision of one ECR, keyed `<ECR number>@<digest>`.

export const ROLE = 'researcher';
/** Stored under the run's own job id, after the runner's events, so the ECR page's timeline still ends on job_finished. */
export const RESULT_EVENT = 'research_result';
export const RESULT_SEQ = 1_000_000;

/** The ECR statuses research may write to. An approved ECR is left alone: changing an assumption would withdraw the approval. */
export const RESEARCHABLE = ['draft', 'review'] as const;

export interface RunRow {
  id: bigint;
  stage: string;
  status: string;
  inputsJson: string;
}
export interface ResultRow {
  checkRunId: bigint;
  key: string;
  mock: boolean;
  detailJson: string;
}
export interface RevisionRow {
  seq: number;
  digest: string;
  current: boolean;
  changeRequestJson: string;
}
export interface EventRow {
  jobId: string;
  eventType: string;
  tsMs: number;
}

/** The s2 cost run a research run is based on. */
export interface CostRun {
  id: bigint;
  /** What the run names: the baseline hash it computed on, the seed, the assumptions. */
  inputsJson: string;
  /** The `detail` row's JSON: the check's inputs, drivers and inventory. Null when the run stored none. */
  detailJson: string | null;
  mock: boolean;
}

export interface EcrFacts {
  prId: bigint;
  number: string;
  status: string;
  revision: { seq: number; digest: string } | null;
  /** The newest finished s2_cost run on the current change-request revision; null when there is none yet. */
  costRun: CostRun | null;
}

const jsonOr = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/**
 * The ECR's current change-request revision and the newest finished cost run on it. A run that is
 * `done` and not `stale` is current (workers/README.md, "For whatever waits on the numbers"): the
 * module makes every run stale the moment any input changes. The run must also name this revision,
 * because the run of an earlier revision can still be `done` for a moment after a new one arrives.
 */
export function factsFor(pr: { id: bigint; plmEcrNumber: string; status: string }, revisions: RevisionRow[], runs: RunRow[], results: ResultRow[]): EcrFacts {
  const cur = revisions.find((r) => r.current) ?? null;
  const base: EcrFacts = { prId: pr.id, number: pr.plmEcrNumber, status: pr.status, revision: cur ? { seq: cur.seq, digest: cur.digest } : null, costRun: null };
  if (!cur) return base;
  const done = runs
    .filter((r) => r.stage === 's2_cost' && r.status === 'done')
    .filter((r) => {
      const i = jsonOr<{ revision?: number; overlay?: string }>(r.inputsJson, {});
      return i.revision === cur.seq && i.overlay === cur.digest;
    })
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const run = done[0];
  if (!run) return base;
  const rows = results.filter((x) => x.checkRunId === run.id);
  return {
    ...base,
    costRun: { id: run.id, inputsJson: run.inputsJson, detailJson: rows.find((x) => x.key === 'detail')?.detailJson ?? null, mock: rows.some((x) => x.mock) },
  };
}

// ---------------------------------------------------------------- keys and job ids

export const keyOf = (number: string, digest: string) => `${number}@${digest}`;
export const jobPrefix = (number: string, seq: number, digest: string) => `research-${number}-r${seq}-${digest.slice(0, 8)}-a`;
export const jobIdFor = (number: string, seq: number, digest: string, attempt: number) => `${jobPrefix(number, seq, digest)}${attempt}`;

// ---------------------------------------------------------------- the decision

export interface PlanContext {
  nowMs: number;
  maxPerHour: number;
  maxAttempts: number;
  retryDelayMs: number;
  /** Job ids this process started that the database may not show yet (the cache lags a little), with when. */
  startedHere: ReadonlyMap<string, number>;
  /** Keys of runs in progress in this process. */
  running: ReadonlySet<string>;
  /** Only these ECR numbers; empty: all. */
  ecrs: readonly string[];
}

export type Decision =
  | { action: 'skip'; why: string }
  | { action: 'research'; key: string; jobId: string; attempt: number; seq: number; digest: string; costRun: CostRun }
  /** Not now: the earliest time to look again, and why. */
  | { action: 'wait'; why: string; untilMs: number };

const HOUR = 3_600_000;

export function decide(f: EcrFacts, events: EventRow[], ctx: PlanContext): Decision {
  if (ctx.ecrs.length && !ctx.ecrs.includes(f.number)) return { action: 'skip', why: 'not one of the ECRs this worker was limited to' };
  if (!(RESEARCHABLE as readonly string[]).includes(f.status)) return { action: 'skip', why: `${f.number} is ${f.status}; research changes assumptions, which would withdraw an approval or edit a frozen ECR` };
  if (!f.revision) return { action: 'skip', why: 'no change request yet' };
  if (!f.costRun) return { action: 'skip', why: 'waiting for the cost check on the current revision' };
  if (f.costRun.mock) return { action: 'skip', why: 'the cost run is mock compute, not the real check' };
  if (!f.costRun.detailJson) return { action: 'skip', why: "the cost run has no detail row to read the check's inputs from" };

  const { seq, digest } = f.revision;
  const key = keyOf(f.number, digest);
  if (ctx.running.has(key)) return { action: 'skip', why: 'a run is in progress' };

  const prefix = jobPrefix(f.number, seq, digest);
  const mine = events.filter((e) => e.jobId.startsWith(prefix));
  if (mine.some((e) => e.eventType === RESULT_EVENT)) return { action: 'skip', why: 'already researched' };

  const started = new Map<string, number>();
  for (const e of mine) if (e.eventType === 'job_started') started.set(e.jobId, e.tsMs);
  for (const [id, ms] of ctx.startedHere) if (id.startsWith(prefix) && !started.has(id)) started.set(id, ms);
  if (started.size >= ctx.maxAttempts) return { action: 'skip', why: `${started.size} attempt(s) made, none finished with a result; not trying again` };
  const last = Math.max(0, ...started.values());
  if (started.size && ctx.nowMs - last < ctx.retryDelayMs) return { action: 'wait', why: 'waiting to retry after a failed attempt', untilMs: last + ctx.retryDelayMs };

  // The cap on runs per hour counts every research job, from the stored events and this process's own.
  const hour = new Map<string, number>();
  for (const e of events) if (e.eventType === 'job_started' && e.jobId.startsWith('research-') && ctx.nowMs - e.tsMs < HOUR) hour.set(e.jobId, e.tsMs);
  for (const [id, ms] of ctx.startedHere) if (ctx.nowMs - ms < HOUR) hour.set(id, ms);
  if (hour.size >= ctx.maxPerHour) return { action: 'wait', why: `${hour.size} research run(s) in the last hour; the cap is ${ctx.maxPerHour}`, untilMs: Math.min(...hour.values()) + HOUR };

  return { action: 'research', key, jobId: jobIdFor(f.number, seq, digest, started.size + 1), attempt: started.size + 1, seq, digest, costRun: f.costRun };
}
