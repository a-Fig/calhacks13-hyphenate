import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { classifyFailure, overageStopError, scrub } from './classify.ts';
import { resolveConfig, resolveJob } from './config.ts';
import { JobEmitter, MessageTranslator, SinkError, usageOf } from './events.ts';
import { webFetchGuard } from './fetch-guard.ts';
import { ProcessTracker } from './process.ts';
import { buildSdkOptions, buildSessionEnv, builtinToolsOf, envNames } from './session.ts';
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
 * Closes the in-process MCP servers of a job. That ends their transport, which aborts the signal
 * of any tool handler still running (`extra.signal`), and releases the server instance.
 */
function closeInProcessServers(servers: Record<string, McpServerConfig> | undefined): void {
  for (const server of Object.values(servers ?? {})) {
    if (server && 'instance' in server && server.instance) void server.instance.close().catch(() => {});
  }
}

/**
 * Runs one job as one Claude Code session and returns how it went. It resolves for every outcome
 * a session can have (success, failure, usage limit, timeout, cancellation, a hung sink); it
 * throws only for a spec that can't run (`JobSpecError`).
 */
export async function runJob(spec: JobSpec, opts: RunJobOptions): Promise<JobResult> {
  const config = resolveConfig(opts.config);
  const job = resolveJob(spec, config);
  const emitter = opts.emitter ?? (opts.sink ? new JobEmitter(job.id, job.role, job.identity, opts.sink, config.sinkTimeoutMs) : null);
  if (!emitter) throw new Error('runJob needs a sink or an emitter');
  const queryFn: QueryFn = opts.queryFn ?? ((params) => sdkQuery(params));

  const startedAt = new Date();
  const abort = new AbortController();
  const translator = new MessageTranslator(config.maxEventFieldChars);
  let stderrTail = '';
  const tracker = new ProcessTracker((chunk) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  let stopReason: 'timeout' | 'cancelled' | 'overage' | null = null;
  let q: QueryLike | null = null;
  let stopNotice!: () => void;
  const stopped = new Promise<void>((resolve) => (stopNotice = resolve));
  /**
   * Ends the session. Aborting the controller is not enough: it interrupts the tool call in
   * flight, and the session then carries on (the model reads "interrupted" and tries again, at
   * the subscription's expense). Closing the query is what terminates the Claude Code process.
   */
  const stopSession = (reason: 'timeout' | 'cancelled' | 'overage') => {
    stopReason ??= reason;
    abort.abort();
    try {
      q?.close?.();
    } catch {
      // The process may already be gone.
    }
    closeInProcessServers(job.mcpServers);
    stopNotice();
  };
  // The clock starts before anything else can block, including the first event.
  const timer = setTimeout(() => stopSession('timeout'), job.timeoutMs);
  const cancel = () => stopSession('cancelled');
  if (opts.signal?.aborted) cancel();
  else opts.signal?.addEventListener('abort', cancel, { once: true });

  let cwd = '';
  let thrown: unknown = null;

  const body = (async () => {
    await mkdir(config.workRoot, { recursive: true });
    cwd = await mkdtemp(join(config.workRoot, `${job.id}-`));
    const options: Options = {
      ...buildSdkOptions(job, {
        cwd,
        abortController: abort,
        env: buildSessionEnv(opts.env ?? process.env),
        spawnClaudeCodeProcess: tracker.spawner,
        hooks: {
          PreToolUse: [
            { matcher: 'WebFetch', timeout: 20, hooks: [webFetchGuard((id, reason) => translator.noteHookDenial(id, reason))] },
          ],
        },
      }),
      ...opts.sdkOptionsOverride,
    };
    await emitter.emit({
      type: 'job_started',
      model: job.model,
      cwd,
      prompt: job.prompt,
      systemPrompt: job.systemPrompt ?? null,
      allowedTools: job.allowedTools,
      builtinTools: builtinToolsOf(job.allowedTools),
      mcpServers: Object.keys(job.mcpServers ?? {}),
      envNames: envNames(options.env ?? {}),
      maxTurns: job.maxTurns,
      timeoutMs: job.timeoutMs,
      effort: job.effort ?? null,
    });
    if (stopReason) return;
    q = queryFn({ prompt: job.prompt, options });
    for await (const message of q) {
      // Nothing the session says after it was told to stop belongs in the log of what it did.
      if (stopReason) break;
      const bodies = translator.translate(message);
      emitter.sessionId = translator.sessionId;
      for (const b of bodies) await emitter.emit(b);
      if (translator.seen.overage && !job.allowOverage) stopSession('overage');
    }
  })();
  body.catch(() => {}); // its failure is picked up below

  // The loop can sit inside a sink call or a stuck query. After a stop, give it `stopGraceMs` and
  // then settle anyway.
  let graceTimer: NodeJS.Timeout | undefined;
  const abandoned = stopped.then(
    () =>
      new Promise<never>((_, reject) => {
        graceTimer = setTimeout(() => reject(new Error(`the session loop did not stop within ${config.stopGraceMs} ms`)), config.stopGraceMs);
      }),
  );
  abandoned.catch(() => {});
  try {
    await Promise.race([body, abandoned]);
  } catch (err) {
    thrown = err;
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
    opts.signal?.removeEventListener('abort', cancel);
    try {
      (q as QueryLike | null)?.close?.();
    } catch {
      // The process may already be gone.
    }
    closeInProcessServers(job.mcpServers);
  }

  // The process must be gone before the job is reported finished: wait, then kill, bounded.
  const exit = await tracker.waitForExit(config.processExitMs);
  if (exit === 'leaked') process.stderr.write(`norn-runner: job ${job.id}: Claude Code process ${tracker.pid} did not exit after a kill\n`);

  // Work out the outcome. A result message beats a later throw: a single-shot query() throws
  // after it yields an error result.
  const { result } = translator.seen;
  let status: JobStatus;
  let error: JobError | null = null;
  if (thrown instanceof SinkError || emitter.sinkError) {
    status = 'failed';
    error = { kind: 'sink_failed', message: (emitter.sinkError ?? (thrown as SinkError)).message, retryable: false, resetsAt: null };
  } else if (stopReason === 'timeout') {
    status = 'timed_out';
    error = { kind: 'timeout', message: `Session exceeded ${job.timeoutMs} ms and was stopped`, retryable: true, resetsAt: null };
  } else if (stopReason === 'overage' && translator.seen.overage) {
    status = 'failed';
    error = overageStopError(translator.seen.overage);
  } else if (stopReason === 'cancelled') {
    status = 'cancelled';
  } else if (result && result.subtype === 'success' && !result.is_error) {
    status = 'succeeded';
  } else {
    status = 'failed';
    error = classifyFailure(translator.seen, thrown ?? undefined, stderrTail);
  }

  const finishedAt = new Date();
  // A call that was made and never answered: say so, since what it did is unknown. These events
  // queue behind any sink call still in flight, so they are bounded too.
  const recordEnd = (async () => {
    for (const call of translator.openCalls()) {
      await emitter.emit({
        type: 'tool_abandoned',
        toolUseId: call.toolUseId,
        tool: call.tool,
        reason: `the job ended (${status}) while this call was in flight; whether it completed is not known`,
      });
    }
    await emitter.emit({
      type: 'job_finished',
      status,
      error,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      numTurns: result?.num_turns ?? 0,
    });
  })();
  recordEnd.catch(() => {});
  let endTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      recordEnd,
      new Promise<never>((_, reject) => {
        endTimer = setTimeout(() => reject(new Error(`the sink did not take the final events within ${config.stopGraceMs} ms`)), config.stopGraceMs);
      }),
    ]);
  } catch (err) {
    process.stderr.write(`norn-runner: job ${job.id}: could not record the end of the job: ${scrub(err instanceof Error ? err.message : String(err))}\n`);
  } finally {
    clearTimeout(endTimer);
  }
  emitter.closed = true;
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
    usedOverage: translator.seen.overageUsed || (job.allowOverage === true && translator.seen.overage !== null),
    permissionDenials: (result?.permission_denials ?? []).map((d) => ({ tool: d.tool_name, toolUseId: d.tool_use_id, input: d.tool_input })),
    eventCount: emitter.count,
  };
}
