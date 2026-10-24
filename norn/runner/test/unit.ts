// Tests that need no model and no login: translation of SDK messages, failure classification,
// option building, the queue, timeouts and cancellation. `npm run test:unit`.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { classifyFailure } from '../src/classify.ts';
import { JobSpecError, defaultConfig, resolveJob } from '../src/config.ts';
import { JobEmitter, MessageTranslator, SinkError } from '../src/events.ts';
import { Runner } from '../src/runner.ts';
import { runJob } from '../src/run-job.ts';
import type { QueryFn } from '../src/run-job.ts';
import { buildSdkOptions, buildSessionEnv } from '../src/session.ts';
import { jsonlFileSink, memorySink, readJsonl } from '../src/sinks.ts';
import type { JobResult, JobSpec, NornEvent } from '../src/types.ts';

import { identity, baseSpec, usage, sid, init, assistant, toolResult, resultOk, resultErr, stream, fakeQuery, hangingQuery, tmpRoot } from './fixtures.ts';

// ---- tests ----------------------------------------------------------------------------------

describe('session environment and options', () => {
  it('drops API-key variables by name, keeps the OAuth token and config dir, and sets the isolation switches', () => {
    const env = buildSessionEnv({
      Anthropic_Api_Key: 'fake-key', ANTHROPIC_AUTH_TOKEN: 'fake-token', CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth',
      CLAUDE_CONFIG_DIR: '/cfg', PATH: '/bin',
    });
    assert.equal(Object.keys(env).some((k) => k.toUpperCase() === 'ANTHROPIC_API_KEY'), false);
    assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'fake-oauth');
    assert.equal(env.CLAUDE_CONFIG_DIR, '/cfg');
    assert.equal(env.PATH, '/bin');
    assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
    assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  });

  it('does not pass a parent Claude Code session on to the agents', () => {
    const env = buildSessionEnv({
      CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc', CLAUDE_CODE_MESSAGING_TOKEN: 'fake', CLAUDE_CODE_MESSAGING_SOCKET: '/s',
      CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_EFFORT: 'max', CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth', HOME: '/h',
    });
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_EFFORT']) {
      assert.equal(k in env, false, k);
    }
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'fake-oauth');
    assert.equal(env.HOME, '/h');
  });

  it('builds locked-down SDK options', () => {
    const job = resolveJob(baseSpec({ allowedTools: ['WebSearch', 'WebFetch(domain:example.com)', 'mcp__norn__get_bom'] }), defaultConfig());
    const ac = new AbortController();
    const o: Options = buildSdkOptions(job, { cwd: '/w', abortController: ac, env: {} });
    assert.deepEqual(o.settingSources, []);
    assert.equal(o.strictMcpConfig, true);
    assert.deepEqual(o.tools, ['WebSearch', 'WebFetch']);
    assert.deepEqual(o.allowedTools, ['WebSearch', 'WebFetch(domain:example.com)', 'mcp__norn__get_bom']);
    assert.equal(o.permissionMode, 'dontAsk');
    assert.equal(o.permissionPrompts, 'none');
    assert.equal(o.persistSession, false);
    assert.equal(o.canUseTool, undefined);
    assert.equal(o.allowDangerouslySkipPermissions, undefined);
    assert.equal(o.model, 'claude-sonnet-5-5');
    assert.equal(o.cwd, '/w');
  });

  it('gives no built-in tools when the role allows only MCP tools', () => {
    const job = resolveJob(baseSpec({ allowedTools: ['mcp__norn__*'] }), defaultConfig());
    assert.deepEqual(buildSdkOptions(job, { cwd: '/w', abortController: new AbortController(), env: {} }).tools, []);
  });
});

describe('job spec', () => {
  it('applies model precedence: spec, then role override, then default', () => {
    const config = { ...defaultConfig(), roleModels: { researcher: 'claude-opus-5-5' } };
    assert.equal(resolveJob(baseSpec(), config).model, 'claude-opus-5-5');
    assert.equal(resolveJob(baseSpec({ model: 'claude-haiku-5-5' }), config).model, 'claude-haiku-5-5');
    assert.equal(resolveJob(baseSpec({ role: 'post-check' }), config).model, 'claude-sonnet-5-5');
  });

  it('rejects specs that cannot run', () => {
    const c = defaultConfig();
    assert.throws(() => resolveJob(baseSpec({ id: '../evil' }), c), JobSpecError);
    assert.throws(() => resolveJob(baseSpec({ prompt: '  ' }), c), JobSpecError);
    assert.throws(() => resolveJob(baseSpec({ allowedTools: ['*'] }), c), /wildcards/);
    assert.throws(() => resolveJob(baseSpec({ allowedTools: ['mcp__*'] }), c), /wildcards/);
    assert.throws(() => resolveJob(baseSpec({ identity: undefined as never }), c), /identity/);
    assert.throws(() => resolveJob(baseSpec({ timeoutMs: 5 }), c), /timeoutMs/);
    assert.doesNotThrow(() => resolveJob(baseSpec({ allowedTools: [] }), c));
  });
});

describe('message translation', () => {
  it('turns a session into ordered events and names the tool behind each result', () => {
    const t = new MessageTranslator(1000);
    const bodies = [
      init,
      assistant([{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 'tu1', name: 'mcp__norn__get_bom', input: { ecr: 'ECR-0417' } }]),
      toolResult('tu1', [{ type: 'text', text: 'bom data' }]),
      resultOk('final answer'),
    ].flatMap((m) => t.translate(m));
    assert.deepEqual(bodies.map((b) => b.type), ['session_init', 'assistant_text', 'tool_call', 'tool_result', 'result']);
    const call = bodies[2]!;
    const res = bodies[3]!;
    assert.ok(call.type === 'tool_call' && call.tool === 'mcp__norn__get_bom' && (call.input as { ecr: string }).ecr === 'ECR-0417');
    assert.ok(res.type === 'tool_result' && res.tool === 'mcp__norn__get_bom' && res.content === 'bom data' && !res.isError);
    const last = bodies[4]!;
    assert.ok(last.type === 'result' && last.text === 'final answer' && last.usage.outputTokens === 5);
    assert.equal(t.sessionId, 's-1');
  });

  it('clips long tool output and flags it', () => {
    const t = new MessageTranslator(10);
    t.translate(assistant([{ type: 'tool_use', id: 'a', name: 'x', input: {} }]));
    const [r] = t.translate(toolResult('a', 'y'.repeat(50)));
    assert.ok(r!.type === 'tool_result' && r!.content.length === 10 && r!.truncated);
  });

  it('reports a denied tool call as its own event', () => {
    const t = new MessageTranslator(1000);
    const [e] = t.translate({
      type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu9', decision_reason_type: 'mode',
      decision_reason: "don't ask mode", message: 'denied', ...sid,
    } as unknown as SDKMessage);
    assert.deepEqual(e, { type: 'permission_denied', tool: 'Bash', toolUseId: 'tu9', reasonType: 'mode', reason: "don't ask mode" });
  });

  it('logs a rate-limit report once while it is unchanged, and drops thinking-token accounting', () => {
    const t = new MessageTranslator(1000);
    const report = (status: string) =>
      ({ type: 'rate_limit_event', ...sid, rate_limit_info: { status, rateLimitType: 'five_hour', resetsAt: 1_900_000_000 } }) as unknown as SDKMessage;
    assert.equal(t.translate(report('allowed')).length, 1);
    assert.equal(t.translate(report('allowed')).length, 0);
    assert.equal(t.translate(report('allowed_warning')).length, 1);
    assert.equal(t.translate({ type: 'system', subtype: 'thinking_tokens', ...sid } as unknown as SDKMessage).length, 0);
  });

  it('does not log thinking blocks and keeps unknown messages as notices', () => {
    const t = new MessageTranslator(1000);
    assert.deepEqual(t.translate(assistant([{ type: 'thinking', thinking: 'secret reasoning' }])), []);
    const [n] = t.translate({ type: 'tool_progress', ...sid } as unknown as SDKMessage);
    assert.deepEqual(n, { type: 'sdk_notice', messageType: 'tool_progress', subtype: null });
  });
});

describe('failure classification', () => {
  const observe = (messages: SDKMessage[]) => {
    const t = new MessageTranslator(1000);
    for (const m of messages) t.translate(m);
    return t.seen;
  };

  it('reports a rejected rate limit as a usage limit with its reset time', () => {
    const seen = observe([
      { type: 'rate_limit_event', ...sid, rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_900_000_000 } } as unknown as SDKMessage,
      resultErr('success', { result: "You've hit your session limit", errors: undefined, api_error_status: 429 }),
    ]);
    const e = classifyFailure(seen);
    assert.equal(e.kind, 'usage_limit');
    assert.equal(e.retryable, true);
    assert.equal(e.resetsAt, new Date(1_900_000_000_000).toISOString());
  });

  it('reports limit wording on a 429 as a usage limit, and a bare 429 as a throttle', () => {
    const limited = observe([assistant([{ type: 'text', text: "You've hit your weekly limit · resets Fri" }], { error: 'rate_limit' }), resultErr('success', { result: 'x', api_error_status: 429 })]);
    assert.equal(classifyFailure(limited).kind, 'usage_limit');
    const throttled = observe([assistant([{ type: 'text', text: 'Server is temporarily limiting requests' }], { error: 'rate_limit' })]);
    assert.equal(classifyFailure(throttled).kind, 'rate_limited');
  });

  it('separates auth, overload, max turns and plain session errors', () => {
    assert.equal(classifyFailure(observe([assistant([{ type: 'text', text: 'Login expired · Please run /login' }], { error: 'authentication_failed' })])).kind, 'auth');
    assert.equal(classifyFailure(observe([assistant([{ type: 'text', text: 'busy' }], { error: 'overloaded' })])).kind, 'overloaded');
    assert.equal(classifyFailure(observe([resultErr('error_max_turns')])).kind, 'max_turns');
    assert.equal(classifyFailure(observe([resultErr('error_during_execution')])).kind, 'session_error');
  });

  it('classifies the error shapes Claude Code 2.1.310 really produced (bad token, bad model)', () => {
    // Captured on 2026-10-24: an assistant message with an error field, a result that says
    // "success" but is_error, then a throw.
    const auth = observe([
      assistant([{ type: 'text', text: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' }], { error: 'authentication_failed' }),
      resultErr('success', { result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.', errors: undefined, api_error_status: 401, terminal_reason: 'api_error' }),
    ]);
    const e = classifyFailure(auth, new Error('Claude Code returned an error result: Failed to authenticate. API Error: 401 OAuth access token is invalid.'));
    assert.equal(e.kind, 'auth');
    assert.equal(e.message.match(/Failed to authenticate/g)?.length, 1, 'one failure is reported once');
    const model = observe([
      assistant([{ type: 'text', text: "There's an issue with the selected model (x). It may not exist or you may not have access to it." }], { error: 'model_not_found' }),
      resultErr('success', { result: "There's an issue with the selected model (x).", errors: undefined, api_error_status: 404 }),
    ]);
    assert.equal(classifyFailure(model).kind, 'model_unavailable');
  });

  it('does not mistake the agent\'s own words for a limit', () => {
    const seen = observe([assistant([{ type: 'text', text: 'The usage limit on the bracket is 40 hours.' }]), resultErr('error_during_execution')]);
    assert.equal(classifyFailure(seen).kind, 'session_error');
  });

  it('reports a process that died without a result, scrubbing credentials', () => {
    const e = classifyFailure(observe([]), new Error('exited with code 1'), 'token sk-ant-abc123 Bearer xyz.789');
    assert.equal(e.kind, 'process_error');
    assert.ok(!e.message.includes('abc123') && !e.message.includes('xyz.789'));
  });
});

describe('event emitter', () => {
  it('keeps order and sequence numbers even with a slow async sink', async () => {
    const seen: number[] = [];
    const emitter = new JobEmitter('j', 'r', identity, async (e) => {
      await new Promise((r) => setTimeout(r, e.seq === 0 ? 30 : 1));
      seen.push(e.seq);
    });
    await Promise.all([emitter.emit({ type: 'job_queued' }), emitter.emit({ type: 'job_queued' }), emitter.emit({ type: 'job_queued' })]);
    assert.deepEqual(seen, [0, 1, 2]);
  });

  it('turns a sink failure into SinkError and refuses later events', async () => {
    const emitter = new JobEmitter('j', 'r', identity, () => {
      throw new Error('disk full');
    });
    await assert.rejects(emitter.emit({ type: 'job_queued' }), SinkError);
    await assert.rejects(emitter.emit({ type: 'job_queued' }), SinkError);
  });
});

describe('runJob with a scripted session', () => {
  const config = async () => ({ workRoot: await tmpRoot() });

  it('succeeds, tags every event, and removes the work directory', async () => {
    const sink = memorySink();
    const cfg = await config();
    const spec = baseSpec({ identity: { actor: 'agent:norn/level1/ECR-0417', onBehalfOf: 'person:jeff', spawnedBy: 'norn' } });
    const res = await runJob(spec, {
      sink, config: cfg,
      queryFn: fakeQuery([init, assistant([{ type: 'text', text: 'hi' }]), resultOk('42')]),
    });
    assert.equal(res.status, 'succeeded');
    assert.equal(res.result, '42');
    assert.equal(res.usage?.inputTokens, 10);
    const types = sink.events.map((e) => e.type);
    assert.deepEqual(types, ['job_started', 'session_init', 'assistant_text', 'result', 'job_finished']);
    assert.deepEqual(sink.events.map((e) => e.seq), [0, 1, 2, 3, 4]);
    for (const e of sink.events) {
      assert.equal(e.jobId, 'job-1');
      assert.deepEqual(e.identity, spec.identity);
    }
    assert.equal(sink.events[1]!.sessionId, 's-1');
    const started = sink.events[0]!;
    assert.ok(started.type === 'job_started');
    await assert.rejects(access(started.cwd));
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('prefers the error result over the exception a single-shot query throws after it', async () => {
    const sink = memorySink();
    const cfg = await config();
    const res = await runJob(baseSpec(), {
      sink, config: cfg,
      queryFn: fakeQuery([init, resultErr('error_during_execution')], new Error('Claude Code process exited with code 1')),
    });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'session_error');
    assert.equal(sink.events.at(-1)!.type, 'job_finished');
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('reports a usage limit distinctly', async () => {
    const sink = memorySink();
    const cfg = await config();
    const res = await runJob(baseSpec(), {
      sink, config: cfg,
      queryFn: fakeQuery([
        init,
        { type: 'rate_limit_event', ...sid, rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_900_000_000 } } as unknown as SDKMessage,
        resultErr('success', { result: "You've hit your session limit", errors: undefined, api_error_status: 429 }),
      ]),
    });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'usage_limit');
    assert.equal(res.error?.retryable, true);
    assert.ok(res.error?.resetsAt);
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('times out a session that does not finish', async () => {
    const sink = memorySink();
    const cfg = await config();
    const res = await runJob(baseSpec({ timeoutMs: 1000 }), { sink, config: cfg, queryFn: hangingQuery });
    assert.equal(res.status, 'timed_out');
    assert.equal(res.error?.kind, 'timeout');
    assert.ok(!sink.events.some((e) => e.type === 'assistant_text' || e.type === 'result'), 'nothing after the stop is logged');
    assert.ok(res.durationMs >= 900 && res.durationMs < 5000);
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('cancels a running session when its signal aborts', async () => {
    const sink = memorySink();
    const cfg = await config();
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const res = await runJob(baseSpec(), { sink, config: cfg, signal: ctl.signal, queryFn: hangingQuery });
    assert.equal(res.status, 'cancelled');
    assert.equal(res.error, null);
    assert.ok(!sink.events.some((e) => e.type === 'assistant_text' || e.type === 'result'), 'nothing after the stop is logged');
    const finished = sink.events.at(-1)!;
    assert.ok(finished.type === 'job_finished' && finished.status === 'cancelled');
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('stops the job when the sink fails, rather than running it unlogged', async () => {
    const cfg = await config();
    let n = 0;
    const res = await runJob(baseSpec(), {
      config: cfg,
      sink: () => {
        if (++n > 2) throw new Error('disk full');
      },
      queryFn: fakeQuery([init, assistant([{ type: 'text', text: 'a' }]), assistant([{ type: 'text', text: 'b' }]), resultOk()]),
    });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'sink_failed');
    await rm(cfg.workRoot, { recursive: true, force: true });
  });

  it('reports a process that never produced a result as a process error', async () => {
    const cfg = await config();
    const res = await runJob(baseSpec(), { sink: memorySink(), config: cfg, queryFn: fakeQuery([], new Error('spawn claude ENOENT')) });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'process_error');
    await rm(cfg.workRoot, { recursive: true, force: true });
  });
});

describe('Runner queue', () => {
  const fakeResult = (spec: JobSpec): JobResult => ({
    jobId: spec.id, role: spec.role, identity: spec.identity, status: 'succeeded', result: 'ok', error: null, sessionId: null,
    model: 'm', numTurns: 1, durationMs: 1, startedAt: '', finishedAt: '', usage: null, estimatedCostUsd: null, usedOverage: false, permissionDenials: [], eventCount: 0, processExit: 'none', pid: null,
  });

  it('never runs more sessions than the limit, and starts them in submission order', async () => {
    let live = 0;
    let peak = 0;
    const startOrder: string[] = [];
    const runner = new Runner({
      sink: () => {},
      config: { concurrency: 2 },
      execute: async (spec) => {
        live++;
        peak = Math.max(peak, live);
        startOrder.push(spec.id);
        await new Promise((r) => setTimeout(r, 40));
        live--;
        return fakeResult(spec);
      },
    });
    const handles = ['a', 'b', 'c', 'd', 'e'].map((id) => runner.submit(baseSpec({ id })));
    assert.equal(runner.runningCount, 2);
    assert.equal(runner.queuedCount, 3);
    const results = await Promise.all(handles.map((h) => h.result));
    assert.equal(peak, 2);
    assert.deepEqual(startOrder, ['a', 'b', 'c', 'd', 'e']);
    assert.ok(results.every((r) => r.status === 'succeeded'));
    await runner.idle();
  });

  it('cancels a queued job without starting it, and aborts a running one', async () => {
    const sink = memorySink();
    const started: string[] = [];
    const runner = new Runner({
      sink,
      config: { concurrency: 1 },
      execute: (spec, opts) =>
        new Promise((resolve) => {
          started.push(spec.id);
          opts.signal!.addEventListener('abort', () => resolve({ ...fakeResult(spec), status: 'cancelled' }));
        }),
    });
    const a = runner.submit(baseSpec({ id: 'a' }));
    const b = runner.submit(baseSpec({ id: 'b' }));
    b.cancel();
    assert.equal((await b.result).status, 'cancelled');
    assert.deepEqual(started, ['a']);
    a.cancel();
    assert.equal((await a.result).status, 'cancelled');
    const bEvents = sink.events.filter((e: NornEvent) => e.jobId === 'b').map((e) => e.type);
    assert.deepEqual(bEvents, ['job_queued', 'job_finished']);
    assert.equal(runner.cancel('nope'), false);
  });

  it('refuses a duplicate id while the first is active', async () => {
    const runner = new Runner({ sink: () => {}, execute: async (s) => fakeResult(s) });
    const first = runner.submit(baseSpec({ id: 'dup' }));
    assert.throws(() => runner.submit(baseSpec({ id: 'dup' })), /already queued or running/);
    await first.result;
    assert.doesNotThrow(() => runner.submit(baseSpec({ id: 'dup' })));
    await runner.idle();
  });

  it('runs through the real runJob path with scripted sessions and tags each job separately', async () => {
    const sink = memorySink();
    const root = await tmpRoot();
    const runner = new Runner({ sink, config: { concurrency: 2, workRoot: root }, queryFn: fakeQuery([init, resultOk()]) });
    const [x, y] = await Promise.all([
      runner.run(baseSpec({ id: 'x', identity: { ...identity, actor: 'agent:x' } })),
      runner.run(baseSpec({ id: 'y', identity: { ...identity, actor: 'agent:y' } })),
    ]);
    assert.equal(x.status, 'succeeded');
    assert.equal(y.status, 'succeeded');
    for (const id of ['x', 'y']) {
      const mine = sink.events.filter((e) => e.jobId === id);
      assert.deepEqual(mine.map((e) => e.type), ['job_queued', 'job_started', 'session_init', 'result', 'job_finished']);
      assert.ok(mine.every((e) => e.identity.actor === `agent:${id}`));
    }
    await rm(root, { recursive: true, force: true });
  });
});

describe('JSONL sink', () => {
  it('keeps every line and each job order when jobs write at once', async () => {
    const dir = await tmpRoot();
    const path = join(dir, 'shared.jsonl');
    const sink = jsonlFileSink(path);
    const a = new JobEmitter('a', 'r', identity, sink);
    const b = new JobEmitter('b', 'r', identity, sink);
    const feed = async (e: JobEmitter) => {
      for (let i = 0; i < 25; i++) await e.emit({ type: 'sdk_notice', messageType: 'x', subtype: String(i) });
    };
    await Promise.all([feed(a), feed(b)]);
    await sink.close();
    const events = await readJsonl(path);
    assert.equal(events.length, 50);
    for (const id of ['a', 'b']) assert.deepEqual(events.filter((e) => e.jobId === id).map((e) => e.seq), Array.from({ length: 25 }, (_, i) => i));
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one parseable line per event, in order', async () => {
    const dir = await tmpRoot();
    const path = join(dir, 'sub', 'log.jsonl');
    const sink = jsonlFileSink(path);
    const emitter = new JobEmitter('j', 'r', identity, sink);
    await emitter.emit({ type: 'job_queued' });
    await emitter.emit({ type: 'sdk_notice', messageType: 'x', subtype: null });
    await sink.close();
    assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 2);
    const events = await readJsonl(path);
    assert.deepEqual(events.map((e) => e.seq), [0, 1]);
    assert.equal(events[0]!.identity.actor, 'agent:norn/test');
    await rm(dir, { recursive: true, force: true });
  });
});
