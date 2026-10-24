import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { classifyFailure, scrub } from './classify.ts';
import { resolveConfig, resolveJob } from './config.ts';
import { JobEmitter, MessageTranslator, SinkError, usageOf } from './events.ts';
import { buildSdkOptions, buildSessionEnv, builtinToolsOf } from './session.ts';
import type { EventSink, JobError, JobResult, JobSpec, JobStatus, RunnerConfig } from './types.ts';

/** What `runJob` needs from the SDK's `query()`. Replaceable so tests can run with no model. */
export type QueryLike = AsyncIterable<SDKMessage> & { close?: () => void };
export type QueryFn = (params: { prompt: string; options?: Options }) => QueryLike;

export interface RunJobOptions {
  /** Receives the job's events. Ignored when `emitter` is given. */
  sink?: EventSink;
  config?: Partial<RunnerConfig>;
  /** Aborting it cancels the job. */
  signal?: AbortSignal;
  /** Used by `Runner`, which has already emitted `job_queued` on it. */
  emitter?: JobEmitter;
  /** Environment to derive the session's from. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Replaces the SDK's `query()`. For tests. */
  queryFn?: QueryFn;
  /** Merged over the options built from the spec. For tests that need a looser session; never for real jobs. */
  sdkOptionsOverride?: Partial<Options>;
}

async function removeDir(dir: string): Promise<void> {
  try {
    // On Windows the directory stays locked until the Claude Code process has fully exited.
    await rm(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  } catch (err) {
    process.stderr.write(`norn-runner: could not remove work dir ${dir}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * Runs one job as one Claude Code session and returns how it went. It resolves for every outcome
 * a session can have (success, failure, usage limit, timeout, cancellation); it throws only for a
 * spec that can't run (`JobSpecError`).
 */
export async function runJob(spec: JobSpec, opts: RunJobOptions): Promise<JobResult> {
  const config = resolveConfig(opts.config);
  const job = resolveJob(spec, config);
  const emitter = opts.emitter ?? (opts.sink ? new JobEmitter(job.id, job.role, job.identity, opts.sink) : null);
  if (!emitter) throw new Error('runJob needs a sink or an emitter');
  const queryFn: QueryFn = opts.queryFn ?? ((params) => sdkQuery(params));

  const startedAt = new Date();
  const abort = new AbortController();
  let abortReason: 'timeout' | 'cancelled' | null = null;
  let q: QueryLike | null = null;
  /**
   * Ends the session. Aborting the controller is not enough: it interrupts the tool call in
   * flight, and the session then carries on (the model reads "interrupted" and tries again, at
   * the subscription's expense). Closing the query is what terminates the Claude Code process.
   */
  const stopSession = (reason: 'timeout' | 'cancelled') => {
    abortReason ??= reason;
    abort.abort();
    try {
      q?.close?.();
    } catch {
      // The process may already be gone.
    }
  };
  const cancel = () => stopSession('cancelled');
  if (opts.signal?.aborted) cancel();
  else opts.signal?.addEventListener('abort', cancel, { once: true });

  const translator = new MessageTranslator(config.maxEventFieldChars);
  let stderrTail = '';
  let cwd = '';
  let thrown: unknown = null;
  let timer: NodeJS.Timeout | undefined;

  try {
    await mkdir(config.workRoot, { recursive: true });
    cwd = await mkdtemp(join(config.workRoot, `${job.id}-`));
    await emitter.emit({
      type: 'job_started',
      model: job.model,
      cwd,
      prompt: job.prompt,
      systemPrompt: job.systemPrompt ?? null,
      allowedTools: job.allowedTools,
      builtinTools: builtinToolsOf(job.allowedTools),
      mcpServers: Object.keys(job.mcpServers ?? {}),
      maxTurns: job.maxTurns,
      timeoutMs: job.timeoutMs,
      effort: job.effort ?? null,
    });

    if (!abortReason) {
      timer = setTimeout(() => stopSession('timeout'), job.timeoutMs);
      const options: Options = {
        ...buildSdkOptions(job, {
          cwd,
          abortController: abort,
          env: buildSessionEnv(opts.env ?? process.env),
          stderr: (data) => {
            stderrTail = (stderrTail + data).slice(-4000);
          },
        }),
        ...opts.sdkOptionsOverride,
      };
      q = queryFn({ prompt: job.prompt, options });
      for await (const message of q) {
        // Nothing the session says after it was told to stop belongs in the log of what it did.
        if (abortReason) break;
        const bodies = translator.translate(message);
        emitter.sessionId = translator.sessionId;
        for (const body of bodies) await emitter.emit(body);
      }
    }
  } catch (err) {
    thrown = err;
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', cancel);
    try {
      q?.close?.();
    } catch {
      // The process may already be gone.
    }
  }

  // Work out the outcome. A result message beats a later throw: a single-shot query() throws
  // after it yields an error result.
  const { result } = translator.seen;
  let status: JobStatus;
  let error: JobError | null = null;
  if (thrown instanceof SinkError || emitter.sinkError) {
    status = 'failed';
    error = { kind: 'sink_failed', message: (emitter.sinkError ?? (thrown as SinkError)).message, retryable: false, resetsAt: null };
  } else if (abortReason === 'timeout') {
    status = 'timed_out';
    error = { kind: 'timeout', message: `Session exceeded ${job.timeoutMs} ms and was stopped`, retryable: true, resetsAt: null };
  } else if (abortReason === 'cancelled') {
    status = 'cancelled';
  } else if (result && result.subtype === 'success' && !result.is_error) {
    status = 'succeeded';
  } else {
    status = 'failed';
    error = classifyFailure(translator.seen, thrown ?? undefined, stderrTail);
  }

  const finishedAt = new Date();
  try {
    await emitter.emit({
      type: 'job_finished',
      status,
      error,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      numTurns: result?.num_turns ?? 0,
    });
  } catch (err) {
    process.stderr.write(`norn-runner: job ${job.id}: could not record job_finished: ${scrub(err instanceof Error ? err.message : String(err))}\n`);
  }
  if (cwd && !config.keepWorkDirs) await removeDir(cwd);

  return {
    jobId: job.id,
    role: job.role,
    identity: job.identity,
    status,
    result: status === 'succeeded' && result?.subtype === 'success' ? result.result : null,
    error,
    sessionId: translator.sessionId,
    model: job.model,
    numTurns: result?.num_turns ?? 0,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    usage: result ? usageOf(result.usage) : null,
    estimatedCostUsd: result?.total_cost_usd ?? null,
    permissionDenials: (result?.permission_denials ?? []).map((d) => ({ tool: d.tool_name, toolUseId: d.tool_use_id, input: d.tool_input })),
    eventCount: emitter.count,
  };
}
