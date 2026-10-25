// Tests for the review fixes of 2026-10-24: environment allowlist, inbound messages, a hung sink,
// allowlist entries, log completeness, WebFetch to local addresses, paid overage, process exit.
// No model and no login needed. `npm run test:unit` runs this and unit.ts.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { overageStopError } from '../src/classify.ts';
import { defaultConfig, resolveJob } from '../src/config.ts';
import { MessageTranslator } from '../src/events.ts';
import { checkFetchUrl, isNonPublicAddress, webFetchGuard } from '../src/fetch-guard.ts';
import { ProcessTracker } from '../src/process.ts';
import { buildJobHooks, promptRecorder, toolInputGuardHook } from '../src/hooks.ts';
import { JobEmitter } from '../src/events.ts';
import { Runner } from '../src/runner.ts';
import { runJob } from '../src/run-job.ts';
import type { QueryFn } from '../src/run-job.ts';
import { buildSdkOptions, buildSessionEnv, buildSessionSettings, envNames } from '../src/session.ts';
import { memorySink } from '../src/sinks.ts';
import type { NornEvent } from '../src/types.ts';
import { assistant, baseSpec, fakeQuery, hangingQuery, init, resultErr, resultOk, sid, stream, tmpRoot, toolResult } from './fixtures.ts';

describe('environment allowlist', () => {
  const planted: Record<string, string> = {
    PATH: '/bin', USERPROFILE: 'C:\\Users\\x', HOME: '/h', TEMP: '/t', LC_ALL: 'C', CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth', HTTPS_PROXY: 'http://proxy:3128',
    OPENAI_API_KEY: 'fake', AWS_SECRET_ACCESS_KEY: 'fake', AWS_ACCESS_KEY_ID: 'fake', GITHUB_TOKEN: 'fake', GH_TOKEN: 'fake', ANTHROPIC_BASE_URL: 'http://evil.invalid',
    ANTHROPIC_API_KEY: 'fake', ANTHROPIC_AUTH_TOKEN: 'fake', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', NODE_OPTIONS: '--require x', DATABASE_URL: 'postgres://u:p@h/db',
    CLAUDE_CODE_SESSION_ID: 'abc', NORN_SECRET_CANARY: 'fake',
  };

  it('passes only what Claude Code needs to run and log in', () => {
    const env = buildSessionEnv(planted);
    for (const kept of ['PATH', 'USERPROFILE', 'HOME', 'TEMP', 'LC_ALL', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'HTTPS_PROXY']) assert.ok(kept in env, `${kept} should pass`);
    for (const dropped of ['OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'GITHUB_TOKEN', 'GH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'NODE_OPTIONS', 'DATABASE_URL', 'CLAUDE_CODE_SESSION_ID', 'NORN_SECRET_CANARY']) {
      assert.equal(dropped in env, false, `${dropped} should not pass`);
    }
  });

  it('sets the scrub and the MCP allowlist, and reports names only', () => {
    const env = buildSessionEnv(planted);
    assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
    assert.equal(env.CLAUDE_CODE_MCP_ALLOWLIST_ENV, '1');
    const names = envNames(env);
    assert.ok(names.includes('CLAUDE_CODE_OAUTH_TOKEN'));
    assert.ok(!names.some((n) => Object.values(planted).includes(n)), 'values must not appear among the names');
    assert.ok(names.every((n) => /^[A-Za-z0-9_()]+$/.test(n)));
  });

  it('does not read the value of a variable it drops', () => {
    let read = false;
    const base = new Proxy({ PATH: '/bin' } as Record<string, string>, {
      ownKeys: () => ['PATH', 'ANTHROPIC_API_KEY'],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: 'x' }),
      get: (_t, key) => {
        if (key === 'ANTHROPIC_API_KEY') read = true;
        return key === 'PATH' ? '/bin' : 'x';
      },
    });
    buildSessionEnv(base as NodeJS.ProcessEnv);
    assert.equal(read, false);
  });
});

describe('session settings', () => {
  it('refuses inbound cross-session messages and the tools around them, reads outside the work dir, and AGENTS.md', () => {
    const s = buildSessionSettings() as {
      crossSessionInbound?: string;
      permissions?: { deny?: string[]; blockReadsOutsideWorkingDirectories?: boolean };
      pluginConfigs?: Record<string, { options?: Record<string, unknown> }>;
    };
    assert.equal(s.crossSessionInbound, 'refuse');
    assert.deepEqual(s.permissions?.deny, ['SendMessage', 'ListAgents']);
    assert.equal(s.permissions?.blockReadsOutsideWorkingDirectories, true);
    assert.equal(s.pluginConfigs?.['cc-plugin-agents-md@builtin']?.options?.instructionFiles, 'claude-md');
    const job = resolveJob(baseSpec(), defaultConfig());
    const o = buildSdkOptions(job, { cwd: '/w', abortController: new AbortController(), env: {} });
    assert.deepEqual(o.settings, s);
    assert.deepEqual(o.disallowedTools, ['SendMessage', 'ListAgents']);
  });
});

describe('allowlist entries', () => {
  it('rejects a specifier on Bash, PowerShell and Monitor, which would expose the whole tool', () => {
    for (const entry of ['Bash(git status)', 'Bash (ls *)', 'PowerShell(Get-ChildItem)', 'Monitor(tail -f x)']) {
      assert.throws(() => resolveJob(baseSpec({ allowedTools: [entry] }), defaultConfig()), /does not limit it/, entry);
    }
    assert.doesNotThrow(() => resolveJob(baseSpec({ allowedTools: ['Bash'] }), defaultConfig()));
    assert.doesNotThrow(() => resolveJob(baseSpec({ allowedTools: ['WebFetch(domain:example.com)', 'Read'] }), defaultConfig()));
  });
});

describe('WebFetch guard', () => {
  const resolver = (table: Record<string, string[]>) => async (host: string) => {
    const answer = table[host];
    if (!answer) throw new Error('ENOTFOUND');
    return answer;
  };
  const check = (url: unknown, table: Record<string, string[]> = {}) => checkFetchUrl(url, resolver(table));

  it('classifies addresses', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.100.100.100', '100.127.255.255', '0.0.0.0',
      '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd7a:115c:a1e0::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
      '64:ff9b::a00:1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    ]) {
      assert.equal(isNonPublicAddress(ip), true, ip);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(isNonPublicAddress(ip), false, ip);
    }
    assert.equal(isNonPublicAddress('not an ip'), true);
  });

  it('denies private, loopback, link-local and Tailscale hosts, however they are written', async () => {
    for (const url of [
      'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://[::1]:8080/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.5:8000/api',
      'http://192.168.0.10/', 'http://169.254.169.254/latest/meta-data/', 'http://100.101.102.103/', 'http://[fd7a:115c:a1e0::5]/',
      'http://localhost/', 'http://LOCALHOST./', 'http://erpnext/', 'http://plm.local/', 'http://nas.lan/', 'http://mac.tail1234.ts.net/', 'http://api.localhost/',
    ]) {
      assert.equal((await check(url)).allowed, false, url);
    }
  });

  it('denies a public-looking name that resolves to a private address, even if only one answer is private', async () => {
    assert.equal((await check('https://innocent.example.org/', { 'innocent.example.org': ['93.184.216.34', '10.0.0.7'] })).allowed, false);
    assert.equal((await check('https://rebind.example.org/', { 'rebind.example.org': ['::ffff:192.168.1.1'] })).allowed, false);
    assert.equal((await check('https://ts.example.org/', { 'ts.example.org': ['100.64.1.2'] })).allowed, false);
  });

  it('fails closed on a name that does not resolve, an empty answer, bad urls, odd schemes and credentials', async () => {
    assert.equal((await check('https://nxdomain.example.org/')).allowed, false);
    assert.equal((await check('https://empty.example.org/', { 'empty.example.org': [] })).allowed, false);
    for (const url of ['not a url', 'file:///etc/passwd', 'ftp://example.org/', 'https://user:pw@example.org/', undefined, 42]) {
      assert.equal((await check(url, { 'example.org': ['93.184.216.34'] })).allowed, false, String(url));
    }
  });

  it('allows a public name and a public address', async () => {
    assert.equal((await check('https://example.org/page?q=1', { 'example.org': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] })).allowed, true);
    assert.equal((await check('http://1.1.1.1/')).allowed, true);
  });

  it('as a hook: denies with a reason, reports it, and ignores other tools', async () => {
    const denied: [string | undefined, string][] = [];
    const hook = webFetchGuard((id, reason) => denied.push([id, reason]), resolver({ 'example.org': ['93.184.216.34'] }));
    const call = (tool: string, url: string) =>
      hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { url } } as never, 'tu1', { signal: new AbortController().signal });
    const bad = (await call('WebFetch', 'http://127.0.0.1:8000/')) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    assert.equal(bad.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(bad.hookSpecificOutput?.permissionDecisionReason ?? '', /not a public internet address/);
    assert.equal(denied.length, 1);
    assert.equal(denied[0]![0], 'tu1');
    assert.deepEqual(await call('WebFetch', 'https://example.org/'), {});
    assert.deepEqual(await call('WebSearch', 'http://127.0.0.1/'), {});
    assert.equal(denied.length, 1);
  });
});

describe('job tool-input guards', () => {
  type Out = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  const pre = (hook: ReturnType<typeof toolInputGuardHook>, tool: string, input: unknown, id = 'tu1') =>
    hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never, id, { signal: new AbortController().signal }) as Promise<Out>;

  it('denies a call its guard refuses, reports it, and leaves other tools and allowed calls alone', async () => {
    const denied: [string | undefined, string][] = [];
    const seen: unknown[] = [];
    const hook = toolInputGuardHook(
      { mcp__x__search: (input) => { seen.push(input); return (input as { q: string }).q.includes('secret') ? { allow: false, reason: 'the query leaks' } : { allow: true }; } },
      (id, reason) => denied.push([id, reason]),
    );
    const bad = await pre(hook, 'mcp__x__search', { q: 'a secret thing' });
    assert.equal(bad.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(bad.hookSpecificOutput?.permissionDecisionReason ?? '', /mcp__x__search refused by Norn: the query leaks/);
    assert.deepEqual(denied, [['tu1', 'mcp__x__search refused by Norn: the query leaks']]);
    assert.deepEqual(await pre(hook, 'mcp__x__search', { q: 'fine' }), {});
    assert.deepEqual(await pre(hook, 'mcp__x__other', { q: 'a secret thing' }), {});
    assert.deepEqual(await pre(hook, 'toString', { q: 'a secret thing' }), {});
    assert.deepEqual(seen, [{ q: 'a secret thing' }, { q: 'fine' }]);
    assert.equal(denied.length, 1);
  });

  it('fails closed: a guard that throws, or answers with nothing usable, denies', async () => {
    const hook = toolInputGuardHook(
      { a: () => { throw new Error('boom'); }, b: (() => undefined) as never, c: (() => ({ allow: 'yes' })) as never },
      () => {},
    );
    for (const tool of ['a', 'b', 'c']) assert.equal((await pre(hook, tool, {})).hookSpecificOutput?.permissionDecision, 'deny', tool);
    assert.match((await pre(hook, 'a', {})).hookSpecificOutput?.permissionDecisionReason ?? '', /the check failed: boom/);
  });

  it('a job without guards gets the WebFetch guard alone; a job with guards gets one hook that runs its guards first', () => {
    const ctx = { emitter: new JobEmitter('j', 'r', { actor: 'a', onBehalfOf: null, spawnedBy: 'norn' }, () => {}), jobPrompt: 'p', maxChars: 100, onFetchDenied: () => {} };
    const plain = buildJobHooks(ctx);
    assert.deepEqual(plain.PreToolUse!.map((m) => m.matcher), ['WebFetch']);
    const guarded = buildJobHooks({ ...ctx, toolInputGuards: { t: () => ({ allow: true }) } });
    assert.equal(guarded.PreToolUse!.length, 1, 'one hook, because hooks that match one call may run side by side');
    assert.equal(guarded.PreToolUse![0]!.hooks.length, 1);
  });

  it('runs the job\'s guards before the guard that resolves the host, and resolves only when they allow the call', async () => {
    const asked: string[] = [];
    const resolve = async (host: string) => (asked.push(host), ['93.184.216.34']);
    const hooks = buildJobHooks({
      emitter: new JobEmitter('j', 'r', { actor: 'a', onBehalfOf: null, spawnedBy: 'norn' }, () => {}), jobPrompt: 'p', maxChars: 100, onFetchDenied: () => {},
      toolInputGuards: { WebFetch: (i) => (/secret/i.test(JSON.stringify(i)) ? { allow: false, reason: 'carries an identifier' } : { allow: true }) },
      resolve,
    });
    const run = async (url: string) => {
      const out = (await hooks.PreToolUse![0]!.hooks[0]!({ hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url, prompt: 'x' } } as never, 't', { signal: new AbortController().signal })) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
      return out.hookSpecificOutput;
    };
    const denied = await run('https://secret-name.example/p');
    assert.equal(denied?.permissionDecision, 'deny');
    assert.match(denied?.permissionDecisionReason ?? '', /carries an identifier/);
    assert.deepEqual(asked, [], 'the host name was not looked up');
    assert.equal(await run('https://ok.example/p'), undefined);
    assert.deepEqual(asked, ['ok.example']);
  });

  it('runJob gives the session the guards of its spec, and a denied call is logged as a hook denial', async () => {
    const root = await tmpRoot();
    const sink = memorySink();
    let hooks: Options['hooks'];
    const spec = baseSpec({ allowedTools: ['mcp__x__search'], toolInputGuards: { mcp__x__search: (i) => ((i as { q: string }).q === 'leak' ? { allow: false, reason: 'leaks' } : { allow: true }) } });
    const res = await runJob(spec, {
      sink, config: { workRoot: root },
      queryFn: ({ options }) => {
        hooks = options?.hooks;
        return stream([
          init,
          assistant([{ type: 'tool_use', id: 'tu9', name: 'mcp__x__search', input: { q: 'leak' } }]),
          toolResult('tu9', 'refused', true),
          resultOk(),
        ]);
      },
    });
    assert.equal(res.status, 'succeeded');
    const matchers = hooks!.PreToolUse!;
    const run = async (q: string) => {
      for (const m of matchers) for (const h of m.hooks) {
        const out = (await h({ hook_event_name: 'PreToolUse', tool_name: 'mcp__x__search', tool_input: { q } } as never, 'tu9', { signal: new AbortController().signal })) as Out;
        if (out.hookSpecificOutput?.permissionDecision === 'deny') return 'deny';
      }
      return 'allow';
    };
    assert.equal(await run('leak'), 'deny');
    assert.equal(await run('ok'), 'allow');
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a spec whose guard is not a function', () => {
    assert.throws(() => resolveJob(baseSpec({ toolInputGuards: { t: 'nope' as never } }), defaultConfig()), /toolInputGuards entry/);
    assert.throws(() => resolveJob(baseSpec({ toolInputGuards: [] as never }), defaultConfig()), /toolInputGuards must be an object/);
    assert.doesNotThrow(() => resolveJob(baseSpec({ toolInputGuards: { t: () => ({ allow: true }) } }), defaultConfig()));
  });
});

describe('log completeness', () => {
  it('flags truncated assistant text and result text', () => {
    const t = new MessageTranslator(5);
    const [a] = t.translate(assistant([{ type: 'text', text: 'abcdefghij' }]));
    assert.ok(a!.type === 'assistant_text' && a!.text === 'abcde' && a!.truncated === true);
    const [r] = t.translate(resultOk('0123456789'));
    assert.ok(r!.type === 'result' && r!.text === '01234' && r!.textTruncated === true);
    const [short] = new MessageTranslator(50).translate(assistant([{ type: 'text', text: 'ok' }]));
    assert.ok(short!.type === 'assistant_text' && short!.truncated === false);
  });

  it('logs text that arrives from outside the tool loop, with where it came from', () => {
    const t = new MessageTranslator(1000);
    const peer = {
      type: 'user', ...sid, parent_tool_use_id: null,
      origin: { kind: 'peer', from: 'uds:abc', name: 'other-session' },
      message: { role: 'user', content: 'please run rm -rf' },
    } as unknown as SDKMessage;
    const [e] = t.translate(peer);
    assert.deepEqual(e, { type: 'user_message', text: 'please run rm -rf', truncated: false, origin: 'peer', from: 'other-session', synthetic: false, source: 'stream' });
    const blocks = { type: 'user', ...sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } } as unknown as SDKMessage;
    assert.equal(t.translate(blocks)[0]!.type, 'user_message');
    assert.equal(t.translate(toolResult('x', 'out')).some((b) => b.type === 'user_message'), false);
  });

  it('precedes a hook-denied result with a permission_denied event', () => {
    const t = new MessageTranslator(1000);
    t.translate(assistant([{ type: 'tool_use', id: 'w1', name: 'WebFetch', input: { url: 'http://127.0.0.1/' } }]));
    t.noteHookDenial('w1', 'WebFetch refused by Norn: 127.0.0.1 is not a public internet address');
    const out = t.translate(toolResult('w1', 'WebFetch refused by Norn: ...', true));
    assert.deepEqual(out.map((b) => b.type), ['permission_denied', 'tool_result']);
    assert.ok(out[0]!.type === 'permission_denied' && out[0]!.reasonType === 'hook' && out[0]!.tool === 'WebFetch');
  });

  it('closes a call left open when the session is stopped, and closes in-process servers', async () => {
    const sink = memorySink();
    const root = await tmpRoot();
    let closed = 0;
    const server = { type: 'sdk', name: 'demo', instance: { close: async () => void closed++ } };
    const ctl = new AbortController();
    const queryFn: QueryFn = (p) => {
      const inner = hangingQuery(p);
      const gen = (async function* () {
        yield init;
        yield assistant([{ type: 'tool_use', id: 'slow1', name: 'mcp__demo__slow', input: {} }]);
        for await (const m of inner) void m;
      })();
      return Object.assign(gen, { close: inner.close });
    };
    setTimeout(() => ctl.abort(), 150);
    const res = await runJob(baseSpec({ mcpServers: { demo: server as never }, allowedTools: ['mcp__demo__slow'] }), {
      sink, config: { workRoot: root }, signal: ctl.signal, queryFn,
    });
    assert.equal(res.status, 'cancelled');
    assert.deepEqual(sink.events.map((e) => e.type).slice(-3), ['tool_call', 'tool_abandoned', 'job_finished']);
    const abandoned = sink.events.find((e) => e.type === 'tool_abandoned');
    assert.ok(abandoned && abandoned.type === 'tool_abandoned' && abandoned.toolUseId === 'slow1' && abandoned.tool === 'mcp__demo__slow');
    assert.ok(closed >= 1, 'the in-process server was closed');
    await rm(root, { recursive: true, force: true });
  });
});

describe('prompt recorder hook', () => {
  const submit = (hook: ReturnType<typeof promptRecorder>, prompt: string) =>
    hook({ hook_event_name: 'UserPromptSubmit', prompt } as never, undefined, { signal: new AbortController().signal });

  it('skips the job\'s own prompt and records every later one before it reaches the model', async () => {
    const sink = memorySink();
    const hook = promptRecorder(new JobEmitter('j', 'r', { actor: 'a', onBehalfOf: null, spawnedBy: 'norn' }, sink), 'the job prompt', 1000);
    assert.deepEqual(await submit(hook, 'the job prompt'), {});
    assert.equal(sink.events.length, 0);
    assert.deepEqual(await submit(hook, 'a message from another session'), {});
    assert.deepEqual(await submit(hook, 'the job prompt'), {}); // the same words again are a new message
    assert.deepEqual(sink.events.map((e) => e.type === 'user_message' && [e.text, e.source]), [
      ['a message from another session', 'prompt_hook'],
      ['the job prompt', 'prompt_hook'],
    ]);
  });

  it('blocks a message it cannot record', async () => {
    const hook = promptRecorder(
      new JobEmitter('j', 'r', { actor: 'a', onBehalfOf: null, spawnedBy: 'norn' }, () => {
        throw new Error('disk full');
      }),
      'p',
      1000,
    );
    const out = (await submit(hook, 'something else')) as { decision?: string };
    assert.equal(out.decision, 'block');
  });
});

describe('a sink that hangs', () => {
  const hang = () => new Promise<void>(() => {});

  it('fails the job as sink_failed instead of holding it', async () => {
    const root = await tmpRoot();
    let started = false;
    const t0 = Date.now();
    const res = await runJob(baseSpec(), {
      sink: hang, config: { workRoot: root, sinkTimeoutMs: 300 },
      queryFn: () => {
        started = true;
        return stream([init, resultOk()]);
      },
    });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'sink_failed');
    assert.equal(started, false, 'the session was never started unlogged');
    assert.ok(Date.now() - t0 < 4000);
    await rm(root, { recursive: true, force: true });
  });

  it('still honours the job timeout when the sink hangs on the very first event', async () => {
    const root = await tmpRoot();
    const t0 = Date.now();
    const res = await runJob(baseSpec({ timeoutMs: 1000 }), { sink: hang, config: { workRoot: root, sinkTimeoutMs: 20_000, stopGraceMs: 500 }, queryFn: hangingQuery });
    assert.equal(res.status, 'timed_out');
    assert.ok(Date.now() - t0 < 4000, `settled in ${Date.now() - t0} ms`);
    await rm(root, { recursive: true, force: true });
  });

  it('releases the Runner slot, so the next job runs', async () => {
    const root = await tmpRoot();
    const sink = (e: NornEvent) => (e.jobId === 'stuck' ? hang() : undefined);
    const runner = new Runner({ sink, config: { concurrency: 1, workRoot: root, sinkTimeoutMs: 300 }, queryFn: fakeQuery([init, resultOk()]) });
    const stuck = runner.submit(baseSpec({ id: 'stuck' }));
    const next = runner.submit(baseSpec({ id: 'next' }));
    assert.equal((await stuck.result).error?.kind, 'sink_failed');
    assert.equal((await next.result).status, 'succeeded');
    await rm(root, { recursive: true, force: true });
  });
});

describe('paid overage', () => {
  const limit = (over: object) =>
    ({ type: 'rate_limit_event', ...sid, rate_limit_info: { rateLimitType: 'five_hour', resetsAt: 1_900_000_000, ...over } }) as unknown as SDKMessage;
  const rejectedOnOverage = limit({ status: 'rejected', overageStatus: 'allowed' });

  it('records the overage fields and does not call a rejection that overage covers a hard block', () => {
    const t = new MessageTranslator(1000);
    const [e] = t.translate(limit({ status: 'rejected', overageStatus: 'allowed', overageResetsAt: 1_900_100_000, isUsingOverage: false, surpassedThreshold: 1 }));
    assert.ok(e!.type === 'rate_limit' && e!.overageStatus === 'allowed' && e!.surpassedThreshold === 1 && e!.overageResetsAt !== null);
    assert.equal(t.seen.rejectedRateLimit, null);
    assert.ok(t.seen.overage);
    const hard = new MessageTranslator(1000);
    hard.translate(limit({ status: 'rejected', overageStatus: 'rejected' }));
    assert.ok(hard.seen.rejectedRateLimit);
    assert.equal(hard.seen.overage, null);
  });

  it('stops the job by default rather than spend, and labels it a usage limit', async () => {
    const sink = memorySink();
    const root = await tmpRoot();
    const res = await runJob(baseSpec(), {
      sink, config: { workRoot: root },
      queryFn: fakeQuery([init, rejectedOnOverage, assistant([{ type: 'text', text: 'carrying on, spending money' }]), resultOk('done')]),
    });
    assert.equal(res.status, 'failed');
    assert.equal(res.error?.kind, 'usage_limit');
    assert.match(res.error?.message ?? '', /overage/);
    assert.equal(res.error?.retryable, true);
    assert.ok(res.error?.resetsAt);
    assert.equal(res.usedOverage, false);
    assert.ok(!sink.events.some((e) => e.type === 'assistant_text'), 'nothing after the stop is logged');
    assert.equal(sink.events.filter((e) => e.type === 'rate_limit').length, 1);
    await rm(root, { recursive: true, force: true });
  });

  it('carries on when the job allows overage, and says it used it', async () => {
    const root = await tmpRoot();
    const res = await runJob(baseSpec({ allowOverage: true }), { sink: memorySink(), config: { workRoot: root }, queryFn: fakeQuery([init, rejectedOnOverage, resultOk('done')]) });
    assert.equal(res.status, 'succeeded');
    assert.equal(res.usedOverage, true);
    await rm(root, { recursive: true, force: true });
  });

  it('stops when the session is already running on overage', async () => {
    const root = await tmpRoot();
    const res = await runJob(baseSpec(), {
      sink: memorySink(), config: { workRoot: root },
      queryFn: fakeQuery([init, limit({ status: 'allowed_warning', isUsingOverage: true }), resultOk()]),
    });
    assert.equal(res.error?.kind, 'usage_limit');
    await rm(root, { recursive: true, force: true });
  });

  it('does not blame a later, unrelated failure on a limit the session got past', async () => {
    const root = await tmpRoot();
    const res = await runJob(baseSpec({ allowOverage: true }), {
      sink: memorySink(), config: { workRoot: root },
      queryFn: fakeQuery([init, rejectedOnOverage, resultErr('error_max_turns')]),
    });
    assert.equal(res.error?.kind, 'max_turns');
    assert.equal(res.usedOverage, true);
    await rm(root, { recursive: true, force: true });
  });

  it('words the stop error with the window and the reset', () => {
    const e = overageStopError({ status: 'rejected', overageStatus: 'allowed', rateLimitType: 'seven_day', resetsAt: 1_900_000_000 });
    assert.match(e.message, /seven_day/);
    assert.equal(e.resetsAt, new Date(1_900_000_000_000).toISOString());
  });
});

describe('process exit', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const start = (tracker: ProcessTracker, code: string) =>
    tracker.spawner({ command: process.execPath, args: ['-e', code], env: { PATH: process.env.PATH ?? '' }, signal: new AbortController().signal });

  it('waits for a process that exits by itself', async () => {
    const tracker = new ProcessTracker();
    start(tracker, 'setTimeout(()=>{}, 200)');
    assert.equal(await tracker.waitForExit(5000), 'exited');
    assert.equal(alive(tracker.pid!), false);
  });

  it('kills a process that will not exit, within a bound', async () => {
    const tracker = new ProcessTracker();
    start(tracker, 'setInterval(()=>{}, 1000)');
    const t0 = Date.now();
    assert.equal(await tracker.waitForExit(300, 5000), 'killed');
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(alive(tracker.pid!), false);
  });

  it('has nothing to wait for before anything was spawned', async () => {
    assert.equal(await new ProcessTracker().waitForExit(10), 'none');
  });
});
