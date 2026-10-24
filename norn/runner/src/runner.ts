import { resolveConfig, resolveJob, JobSpecError } from './config.ts';
import { JobEmitter } from './events.ts';
import { runJob } from './run-job.ts';
import type { QueryFn, RunJobOptions } from './run-job.ts';
import type { EventSink, JobResult, JobSpec, RunnerConfig } from './types.ts';

export interface JobHandle {
  jobId: string;
  /** Resolves with the outcome of the job, whatever it was. Never rejects. */
  result: Promise<JobResult>;
  /** Stops the job: removes it from the queue, or aborts its session. Safe to call twice. */
  cancel(): void;
}

export interface RunnerOptions {
  sink: EventSink;
  config?: Partial<RunnerConfig>;
  env?: NodeJS.ProcessEnv;
  /** Replaces the SDK's `query()`. For tests. */
  queryFn?: QueryFn;
  /** Replaces `runJob`. For tests of the queue itself. */
  execute?: (spec: JobSpec, opts: RunJobOptions) => Promise<JobResult>;
}

interface Entry {
  spec: JobSpec;
  model: string;
  emitter: JobEmitter;
  abort: AbortController;
  settle: (result: JobResult) => void;
}

/**
 * Runs jobs with a cap on how many Claude Code sessions are live at once. Jobs beyond the cap
 * wait in submission order.
 */
export class Runner {
  readonly config: RunnerConfig;
  private readonly opts: RunnerOptions;
  private readonly queue: Entry[] = [];
  private readonly active = new Map<string, Entry>();
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(opts: RunnerOptions) {
    this.opts = opts;
    this.config = resolveConfig(opts.config);
  }

  get runningCount(): number {
    return this.running;
  }
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Queues a job. Throws `JobSpecError` at once for a spec that can't run or an id already in use. */
  submit(spec: JobSpec): JobHandle {
    const job = resolveJob(spec, this.config);
    if (this.active.has(job.id)) throw new JobSpecError(`job ${JSON.stringify(job.id)}: a job with this id is already queued or running`);

    const emitter = new JobEmitter(job.id, job.role, job.identity, this.opts.sink, this.config.sinkTimeoutMs);
    let settle!: (result: JobResult) => void;
    const result = new Promise<JobResult>((resolve) => (settle = resolve));
    const entry: Entry = { spec, model: job.model, emitter, abort: new AbortController(), settle };
    this.active.set(job.id, entry);
    this.queue.push(entry);
    emitter.emit({ type: 'job_queued' }).catch(() => {}); // a failing sink is picked up by the job itself
    this.pump();
    return { jobId: job.id, result, cancel: () => this.cancel(job.id) };
  }

  /** Submits a job and waits for its result. */
  run(spec: JobSpec): Promise<JobResult> {
    return this.submit(spec).result;
  }

  cancel(jobId: string): boolean {
    const entry = this.active.get(jobId);
    if (!entry) return false;
    const queued = this.queue.indexOf(entry);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      void this.finishUnstarted(entry);
    } else {
      entry.abort.abort();
    }
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.running++;
      void this.start(entry);
    }
  }

  private async start(entry: Entry): Promise<void> {
    const execute = this.opts.execute ?? runJob;
    let result: JobResult;
    try {
      result = await execute(entry.spec, {
        emitter: entry.emitter,
        config: this.config,
        signal: entry.abort.signal,
        env: this.opts.env,
        queryFn: this.opts.queryFn,
      });
    } catch (err) {
      // runJob resolves for every session outcome, so this is a bug in the runner, not in the job.
      result = this.failedResult(entry, err instanceof Error ? err.message : String(err));
    }
    this.active.delete(entry.spec.id);
    this.running--;
    entry.settle(result);
    this.pump();
    if (this.running === 0 && this.queue.length === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private async finishUnstarted(entry: Entry): Promise<void> {
    const now = new Date().toISOString();
    try {
      await entry.emitter.emit({ type: 'job_finished', status: 'cancelled', error: null, durationMs: 0, numTurns: 0 });
    } catch {
      // The sink is failing; the cancelled result still goes back to the caller.
    }
    this.active.delete(entry.spec.id);
    entry.settle({
      jobId: entry.spec.id,
      role: entry.spec.role,
      identity: entry.spec.identity,
      status: 'cancelled',
      result: null,
      error: null,
      sessionId: null,
      model: entry.model,
      numTurns: 0,
      durationMs: 0,
      startedAt: now,
      finishedAt: now,
      usage: null,
      estimatedCostUsd: null,
      usedOverage: false,
      permissionDenials: [],
      eventCount: entry.emitter.count,
    });
    if (this.running === 0 && this.queue.length === 0) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private failedResult(entry: Entry, message: string): JobResult {
    const now = new Date().toISOString();
    return {
      jobId: entry.spec.id,
      role: entry.spec.role,
      identity: entry.spec.identity,
      status: 'failed',
      result: null,
      error: { kind: 'process_error', message, retryable: false, resetsAt: null },
      sessionId: null,
      model: entry.model,
      numTurns: 0,
      durationMs: 0,
      startedAt: now,
      finishedAt: now,
      usage: null,
      estimatedCostUsd: null,
      usedOverage: false,
      permissionDenials: [],
      eventCount: entry.emitter.count,
    };
  }
}
