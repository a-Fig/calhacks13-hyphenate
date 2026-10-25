// When to start a Level 1 session. Pure: it reads a snapshot of one ECR and answers dispatch or
// skip, so the rules can be tested without a database, a runner or a model.
//
// The rule (#42): an ECR whose current change-request revision has a completed, current s2_cost run
// and no Level 1 statement for that revision gets exactly one session. Three things keep it to one:
//   - the marker. Every runner event is stored in agent_event (the ECR page's live timeline), and a
//     session's job id names its ECR revision and attempt, so the events that exist are the record of
//     what was started, across restarts. No extra table.
//   - the revision. The key is the change request's revision, not the ECR's own counter, which also
//     moves when the ERP baseline or an assumption changes. A baseline-only re-check starts nothing.
//   - the attempt cap. A session that failed, or ended without a statement, may be tried again later,
//     up to a limit, under a new job id (so the actor name and the events never collide).

/** One session, as the stored events describe it. */
export interface JobRecord {
  jobId: string;
  revision: number;
  attempt: number;
  /** The ECR's own revision (`pull_request.revision`) the session was started on; absent in older job ids. */
  ecrRevision?: number;
  firstEventMs: number;
  lastEventMs: number;
  /** Set once a job_finished event exists. */
  finished?: { status: string; atMs: number; retryable: boolean; resetsAtMs: number | null };
}

export interface EcrFacts {
  number: string;
  /** draft | review | approved | merged | closed */
  status: string;
  /** The current change-request revision (ecr_revision.seq), or null when the ECR has none (mock numbers). */
  crSeq: number | null;
  /** When that revision was recorded. */
  crCreatedMs: number | null;
  /**
   * The ECR's own revision counter (`pull_request.revision`), which a text edit moves while the change request,
   * and so `crSeq`, stays. A session signed for an earlier one is refused by the module, so the attempt cap counts
   * only the sessions started on this one (and older job ids, which do not say).
   */
  ecrRevision?: number;
  /** s2_cost runs with status `done` (not stale, not cancelled), oldest first. */
  s2Done: { id: number; inputsRevision: number | null; mock: boolean }[];
  /**
   * Impact statements of any level. `crSeq` is the change-request revision of the check run a
   * statement was written from (the module records the run), or null when it rests on no run.
   */
  statements: { level: number; createdMs: number; crSeq: number | null }[];
  jobs: JobRecord[];
}

export interface DecideOptions {
  nowMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  /** A session with no event for this long, that this process is not running, counts as dead. */
  orphanMs: number;
  /** Job ids this process has started and not seen finish, including ones with no events stored yet. */
  running: ReadonlySet<string>;
}

export type Decision = { action: 'dispatch'; revision: number; attempt: number; s2RunId: number } | { action: 'skip'; reason: string };

const OPEN = ['draft', 'review'];

/**
 * `l1-<ecr>-r<revision>-e<ecrRevision>-a<attempt>` (`-e` left out when not given): letters, digits, `.`, `_` and `-`
 * only, and short enough for an actor name (64 characters).
 */
export function jobIdFor(ecrNumber: string, revision: number, attempt: number, ecrRevision?: number): string {
  const tail = `-r${revision}${ecrRevision === undefined ? '' : `-e${ecrRevision}`}-a${attempt}`;
  const slug = ecrNumber.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 46 - 3 - tail.length);
  return `l1-${slug}${tail}`;
}

/** Whether a job id is one of this ECR's sessions (the id carries the ECR's number, made filename-safe). */
export function jobIsFor(jobId: string, ecrNumber: string): boolean {
  const p = parseJobId(jobId);
  return !!p && jobId === jobIdFor(ecrNumber, p.revision, p.attempt, p.ecrRevision);
}

/**
 * Whether a statement is the answer for change-request revision `rev`: it was written from a check
 * run of that revision, however late it was posted. A statement that rests on no run (crSeq null:
 * judgment only, or posted outside a session) is never one, and never stops a session: it says
 * nothing about which numbers were read.
 */
export function statementIsFor(s: { crSeq: number | null }, rev: number): boolean {
  return s.crSeq === rev;
}

export function parseJobId(jobId: string): { revision: number; attempt: number; ecrRevision?: number } | null {
  const m = /^l1-.+-r(\d+)(?:-e(\d+))?-a(\d+)$/.exec(jobId);
  if (!m) return null;
  return m[2] === undefined ? { revision: Number(m[1]), attempt: Number(m[3]) } : { revision: Number(m[1]), attempt: Number(m[3]), ecrRevision: Number(m[2]) };
}

/** The actor name a session writes under (the runner identity and the MCP token carry the same). */
export const actorFor = (jobId: string) => `agent:norn/level1/${jobId}`;

/** What started the session: Norn, automatically, because a cost check finished, on the ECR's own revision counter (`pull_request.revision`, which a text edit bumps too). The MCP token takes no spaces in this field. */
export const spawnedByFor = (checkRunId: number, revision: number) => `norn:check_run:${checkRunId}:revision:${revision}`;

export interface EventRow {
  jobId: string;
  eventType: string;
  tsMs: number;
  payloadJson: string;
}

/** Sessions from stored events. Only job ids this module made are read; other jobs' events are ignored. */
export function jobsFromEvents(rows: Iterable<EventRow>): JobRecord[] {
  const jobs = new Map<string, JobRecord>();
  for (const e of rows) {
    const id = parseJobId(e.jobId);
    if (!id) continue;
    let j = jobs.get(e.jobId);
    if (!j) jobs.set(e.jobId, (j = { jobId: e.jobId, revision: id.revision, attempt: id.attempt, ...(id.ecrRevision === undefined ? {} : { ecrRevision: id.ecrRevision }), firstEventMs: e.tsMs, lastEventMs: e.tsMs }));
    j.firstEventMs = Math.min(j.firstEventMs, e.tsMs);
    j.lastEventMs = Math.max(j.lastEventMs, e.tsMs);
    if (e.eventType === 'job_finished') {
      let p: any = {};
      try {
        p = JSON.parse(e.payloadJson);
      } catch {}
      const resets = p?.error?.resetsAt ? Date.parse(p.error.resetsAt) : NaN;
      j.finished = { status: String(p?.status ?? 'failed'), atMs: e.tsMs, retryable: p?.error?.retryable !== false, resetsAtMs: Number.isFinite(resets) ? resets : null };
    }
  }
  return [...jobs.values()].sort((a, b) => a.revision - b.revision || a.attempt - b.attempt);
}

export function decide(e: EcrFacts, o: DecideOptions): Decision {
  const skip = (reason: string): Decision => ({ action: 'skip', reason });
  if (!OPEN.includes(e.status)) return skip(`the ECR is ${e.status}`);
  if (e.crSeq === null || e.crCreatedMs === null) return skip('the ECR has no change request, so its numbers are mock');
  const rev = e.crSeq;

  // The numbers: a finished s2_cost run on this revision's change request, and not mock.
  const run = [...e.s2Done].reverse().find(r => r.inputsRevision === rev);
  if (!run) return skip(`no finished s2_cost run on change-request revision ${rev} yet`);
  if (run.mock) return skip('the s2_cost run is mock compute');

  // A statement written from this revision's check run is this revision's statement (any level: a
  // Level 2 or 3 supersedes Level 1). One written for an earlier revision, however late it was posted, is not.
  if (e.statements.some(s => statementIsFor(s, rev))) return skip(`revision ${rev} already has a statement`);

  // Sessions already started for this ECR's revision (not another ECR's: ids name the ECR).
  const mine = e.jobs.filter(j => j.revision === rev && jobIsFor(j.jobId, e.number));
  const runningHere = [...o.running].filter(id => jobIsFor(id, e.number)).map(id => ({ id, p: parseJobId(id)! })).filter(x => x.p.revision === rev);
  const live = (j: JobRecord) => !j.finished && (o.running.has(j.jobId) || o.nowMs - j.lastEventMs < o.orphanMs);
  if (runningHere.length || mine.some(live)) return skip(`a session is running for revision ${rev}`);

  // Attempt numbers keep counting up, so job ids never repeat; the cap counts the sessions that could still be
  // accepted: those started on the ECR's current revision, and older ids that do not name one.
  const attempts = Math.max(0, ...mine.map(j => j.attempt), ...runningHere.map(x => x.p.attempt));
  const used = e.ecrRevision === undefined ? mine.length : mine.filter(j => j.ecrRevision === undefined || j.ecrRevision === e.ecrRevision).length;
  if (used >= o.maxAttempts) return skip(`revision ${rev} has used its ${o.maxAttempts} attempt(s) without a statement`);

  // A retry waits: out of usage until the window resets, otherwise a fixed delay.
  const last = mine.at(-1);
  if (last) {
    const f = last.finished;
    const readyAt = f ? Math.max(f.atMs + o.retryDelayMs, f.resetsAtMs ?? 0) : last.lastEventMs + o.orphanMs; // no job_finished: it died with the process
    if (o.nowMs < readyAt) return skip(`attempt ${last.attempt} ended; the next waits until ${new Date(readyAt).toISOString()}`);
  }
  return { action: 'dispatch', revision: rev, attempt: attempts + 1, s2RunId: run.id };
}

/**
 * Running sessions of this ECR that are for an earlier change-request revision than the current one:
 * their numbers and prompt are out of date, so the dispatcher stops them. (The module would refuse
 * their statement anyway; this saves the tokens.)
 */
export function supersededJobs(e: Pick<EcrFacts, 'number' | 'crSeq'>, running: Iterable<string>): string[] {
  if (e.crSeq === null) return [];
  return [...running].filter(id => jobIsFor(id, e.number) && parseJobId(id)!.revision < e.crSeq!);
}
