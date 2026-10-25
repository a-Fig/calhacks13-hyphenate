import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ASK_NORN_TOOLS, verifyToken } from '../../../mcp/src/index.ts';
import type { JobResult, JobSpec, NornEvent } from '../../../runner/src/index.ts';
import { ASK_ROLE, ASK_SYSTEM_PROMPT, ASK_TOOLS, ask, validateRequest, type AskDeps } from './ask.ts';
import type { AskResponse } from './protocol.ts';
import { realDeps, startAskServer, takeQuestion } from './server.ts';

const impact = { results: [{ key: 'one_time_total', label: 'One-time cost', unit: 'usd', p10: 256940.22, p50: 304745.32, p90: 374317.37, mock: false }] };

interface FakeOptions {
  answer: string;
  calls?: { tool: string; input: unknown; content?: string; isError?: boolean }[];
  status?: JobResult['status'];
  errorKind?: string;
  /** Wait, like a job queued behind others, until cancelled. */
  hang?: boolean;
}

function fakeRun(opts: FakeOptions): { deps: AskDeps; specs: JobSpec[]; signals: AbortSignal[] } {
  const specs: JobSpec[] = [];
  const signals: AbortSignal[] = [];
  const calls = opts.calls ?? [{ tool: 'mcp__norn__get_impact', input: { ecr: 'ECR-0417' }, content: JSON.stringify(impact) }];
  const deps: AskDeps = {
    settings: { model: 'test-model', maxTurns: 3, timeoutMs: 1000, tokenTtlSeconds: 60 },
    newId: () => 'x1',
    mcpFor: () => ({ norn: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }),
    run: async (spec, sink, signal) => {
      specs.push(spec);
      signals.push(signal);
      const base = { seq: 0, ts: '', jobId: spec.id, role: spec.role, identity: spec.identity, sessionId: null };
      if (opts.hang) {
        await new Promise<void>(r => (signal.aborted ? r() : signal.addEventListener('abort', () => r(), { once: true })));
        return { jobId: spec.id, role: spec.role, identity: spec.identity, status: 'cancelled', result: null, error: null, model: 'test-model', durationMs: 5, numTurns: 0 } as unknown as JobResult;
      }
      for (const [i, c] of calls.entries()) {
        await sink({ ...base, type: 'tool_call', toolUseId: `t${i}`, tool: c.tool, input: c.input, parentToolUseId: null } as NornEvent);
        await sink({ ...base, type: 'tool_result', toolUseId: `t${i}`, tool: null, isError: c.isError ?? false, content: c.content ?? '', truncated: false, parentToolUseId: null } as NornEvent);
      }
      return {
        jobId: spec.id, role: spec.role, identity: spec.identity, status: opts.status ?? 'succeeded', result: opts.answer,
        error: opts.errorKind ? { kind: opts.errorKind, message: 'x', retryable: false, resetsAt: null } : null,
        model: 'test-model', durationMs: 5, numTurns: 2,
      } as unknown as JobResult;
    },
  };
  return { deps, specs, signals };
}
const req = { ecr: 'ECR-0417', question: 'Why is the one-time cost what it is?' };
const reply = (answer: string, citations: unknown[]) => JSON.stringify({ answer, citations });
const total = reply('The one-time cost is $304,745 [c1].', [{ id: 'c1', refId: 'one_time_total', value: '$304,745' }]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('the job gets only the read tools, no web, and the question as a question', async () => {
  const { deps, specs } = fakeRun({ answer: reply('Norn has no record of that.', []) });
  await ask(req, deps);
  const spec = specs[0]!;
  assert.deepEqual(spec.allowedTools, ASK_TOOLS.map(t => `mcp__norn__${t}`));
  assert.ok(!spec.allowedTools.some(t => /Web|add_comment|propose|post_impact|list_ecrs|Bash/.test(t)));
  assert.equal(spec.systemPrompt, ASK_SYSTEM_PROMPT);
  assert.match(spec.prompt, /Why is the one-time cost/);
  assert.equal(spec.identity.onBehalfOf, null);
});

test('the credential is an ask-norn token for this one ECR, and the allowlist is the list norn/mcp holds for that role', async () => {
  assert.deepEqual(ASK_TOOLS, [...ASK_NORN_TOOLS]);
  const saved = { key: process.env.NORN_MCP_SIGNING_KEY, dir: process.env.NORN_MCP_STATE_DIR };
  const key = 'k'.repeat(48);
  process.env.NORN_MCP_SIGNING_KEY = key;
  process.env.NORN_MCP_STATE_DIR = mkdtempSync(join(tmpdir(), 'norn-ask-'));
  try {
    const { deps, specs } = fakeRun({ answer: reply('x', []) });
    delete deps.mcpFor; // the real builder
    await ask(req, deps);
    const entry = specs[0]!.mcpServers?.norn as unknown as { headersHelper: string };
    const file = /"([^"]+\.token)"/.exec(entry.headersHelper)![1]!;
    const claims = verifyToken(readFileSync(file, 'utf8').trim(), key);
    assert.deepEqual([claims.role, claims.kind, claims.ecrs, claims.onBehalfOf], [ASK_ROLE, 'job', ['ECR-0417'], null]);
    assert.equal(ASK_ROLE, 'ask-norn');
  } finally {
    if (saved.key === undefined) delete process.env.NORN_MCP_SIGNING_KEY;
    else process.env.NORN_MCP_SIGNING_KEY = saved.key;
    if (saved.dir === undefined) delete process.env.NORN_MCP_STATE_DIR;
    else process.env.NORN_MCP_STATE_DIR = saved.dir;
  }
});

test('the prompt asks for a marker after each number and ids on the citations, and no label', () => {
  assert.match(ASK_SYSTEM_PROMPT, /right after it/);
  assert.match(ASK_SYSTEM_PROMPT, /\[c1\]/);
  assert.match(ASK_SYSTEM_PROMPT, /"citations": \[\{"id": "c1", "refId"/);
  assert.doesNotMatch(ASK_SYSTEM_PROMPT, /"label"/);
  // the words a reader sees are business words
  assert.doesNotMatch(ASK_SYSTEM_PROMPT, /\b(?:pull request|PR|branch|merge|commit)\b/);
});

test('a quoted answer comes back verified, with its markers removed', async () => {
  const { deps } = fakeRun({ answer: total });
  const r = (await ask(req, deps)) as Extract<AskResponse, { ok: true }>;
  assert.equal(r.ok, true);
  assert.deepEqual(r.unverifiedNumbers, []);
  assert.equal(r.citations[0]!.verified, true);
  assert.equal(r.citations[0]!.label, 'One-time cost');
  assert.equal(r.answer, 'The one-time cost is $304,745.');
  assert.deepEqual(r.segments.find(s => s.cites)?.cites, ['c1']);
});

test('a number the session did not read is marked, not dropped', async () => {
  const { deps } = fakeRun({ answer: reply('The one-time cost is $148,000 [c1].', [{ id: 'c1', refId: 'one_time_total', value: '$304,745' }]) });
  const r = (await ask(req, deps)) as Extract<AskResponse, { ok: true }>;
  assert.deepEqual(r.unverifiedNumbers, ['148,000']);
  assert.equal(r.segments.find(s => s.unverified)?.text, '148,000');
});

test('a number with no marker is marked even when its digits are in a result the answer cites', async () => {
  const { deps } = fakeRun({ answer: reply('The one-time cost is $304,745.', [{ id: 'c1', refId: 'one_time_total', value: '$304,745' }]) });
  const r = (await ask(req, deps)) as Extract<AskResponse, { ok: true }>;
  assert.deepEqual(r.unverifiedNumbers, ['304,745']);
});

test('an answer from a session that read nothing is refused', async () => {
  const { deps } = fakeRun({ answer: reply('It is $304,745.', []), calls: [] });
  const r = await ask(req, deps);
  assert.equal(r.ok, false);
});

test('a session that read another ECR is refused', async () => {
  const { deps } = fakeRun({ answer: reply('x', []), calls: [{ tool: 'mcp__norn__get_impact', input: { ecr: 'ECR-0409' }, content: '{}' }] });
  const r = await ask(req, deps);
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /ECR-0417 only/);
});

test('a login problem says unavailable, an unreadable answer is not shown', async () => {
  const a = await ask(req, fakeRun({ answer: '', status: 'failed', errorKind: 'auth' }).deps);
  assert.deepEqual([a.ok, (a as { kind: string }).kind], [false, 'unavailable']);
  const b = await ask(req, fakeRun({ answer: 'just prose, $5' }).deps);
  assert.equal(b.ok, false);
});

test('requests are validated', () => {
  assert.equal(validateRequest({ ecr: 'ECR-0417', question: '  hi ' }).ok, true);
  for (const bad of [null, {}, { ecr: 'ECR 0417', question: 'x' }, { ecr: '../x', question: 'x' }, { ecr: 'ECR-0417', question: '   ' }, { ecr: 'ECR-0417', question: 'x'.repeat(501) }]) {
    assert.equal(validateRequest(bad).ok, false, JSON.stringify(bad));
  }
});

// ---- Review (PR #149): time and spend.

test("time spent waiting for a free session counts against the question's limit, and the job is cancelled", async () => {
  const { deps, signals } = fakeRun({ answer: '', hang: true });
  deps.settings = { ...deps.settings, timeoutMs: 120 };
  const t0 = Date.now();
  // it came in 90 ms ago and has been queued since: 30 ms are left
  const r = await ask(req, deps, { startedAt: t0 - 90 });
  const took = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /took too long/);
  assert.ok(took < 100, `waited ${took} ms`);
  assert.equal(signals[0]!.aborted, true);
  // already out of time when it reaches the runner: stopped at once
  const late = fakeRun({ answer: '', hang: true });
  late.deps.settings = { ...late.deps.settings, timeoutMs: 120 };
  const t1 = Date.now();
  const r2 = await ask(req, late.deps, { startedAt: t1 - 500 });
  assert.equal(r2.ok, false);
  assert.ok(Date.now() - t1 < 80);
});

test('a reader who goes away cancels the job', async () => {
  const { deps, signals } = fakeRun({ answer: '', hang: true });
  const gone = new AbortController();
  const pending = ask(req, deps, { signal: gone.signal });
  await sleep(15);
  assert.equal(signals[0]!.aborted, false);
  gone.abort();
  const r = await pending;
  assert.equal(signals[0]!.aborted, true);
  assert.equal(r.ok, false);
});

test('with the real runner, a question still waiting for a free session is cancelled when its reader goes, and never starts', async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const done = (spec: JobSpec) => ({ jobId: spec.id, role: spec.role, identity: spec.identity, status: 'succeeded', result: total, error: null, model: 'm', durationMs: 1, numTurns: 1 }) as unknown as JobResult;
  const real = realDeps({
    concurrency: 1,
    execute: async spec => {
      started.push(spec.id);
      await gate;
      return done(spec);
    },
  });
  const deps = (id: string): AskDeps => ({ ...real, settings: { model: 'm', maxTurns: 2, timeoutMs: 5000, tokenTtlSeconds: 60 }, mcpFor: () => ({ norn: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }), newId: () => id });
  // the first question takes the only session; its job reads a result so the answer can be checked
  const first = ask(req, { ...deps('first'), run: (spec, sink, signal) => real.run(spec, sink, signal) });
  await sleep(30);
  const gone = new AbortController();
  const second = ask(req, deps('second'), { signal: gone.signal });
  await sleep(30);
  assert.deepEqual(started, ['ask-ECR-0417-first']);
  gone.abort();
  const r2 = await second;
  assert.equal(r2.ok, false);
  release();
  await first;
  assert.deepEqual(started, ['ask-ECR-0417-first']); // the second never started
});

test('the question count: each window on its own, with the wait until one more is allowed', () => {
  const limits = { per10Minutes: 2, perHour: 3 };
  const times: number[] = [];
  const at = (min: number) => takeQuestion(times, limits, min * 60_000);
  assert.deepEqual([at(0).ok, at(1).ok], [true, true]);
  const third = at(2);
  assert.equal(third.ok, false);
  assert.equal((third as { retryAfterMs: number }).retryAfterMs, 8 * 60_000); // the first one leaves the window at minute 10
  assert.equal(at(10).ok, true); // minute 0 left the ten-minute window; 1 and 10 are in it
  assert.equal(at(11).ok, false);
  assert.equal(at(20).ok, false); // three in the hour (0, 1, 10)
  const hour = at(30);
  assert.deepEqual([hour.ok, (hour as { retryAfterMs: number }).retryAfterMs], [false, 30 * 60_000]);
  assert.equal(at(61).ok, true);
});

test('the server turns away questions over the limit with a clear reply, and takes them again as time passes', async () => {
  const { deps } = fakeRun({ answer: total });
  let clock = 1_000_000;
  const s = await startAskServer({ port: 0, deps, status: async () => ({ available: true }), limits: { per10Minutes: 2, perHour: 100 }, now: () => clock });
  const post = () => fetch(`http://127.0.0.1:${s.port}/ask`, { method: 'POST', body: JSON.stringify(req) });
  try {
    assert.equal(((await (await post()).json()) as AskResponse).ok, true);
    clock += 1000;
    assert.equal(((await (await post()).json()) as AskResponse).ok, true);
    clock += 1000;
    const third = await post();
    const body = (await third.json()) as { ok: boolean; kind: string; message: string };
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) > 0);
    assert.deepEqual([body.ok, body.kind], [false, 'limited']);
    assert.match(body.message, /Too many questions/);
    assert.match(body.message, /2 every 10 minutes/);
    assert.doesNotMatch(body.message, /\b(?:PR|branch|merge|commit)\b/);
    clock += 10 * 60_000;
    assert.equal(((await (await post()).json()) as AskResponse).ok, true);
  } finally {
    await s.close();
  }
});

test('a question that is turned away is not run', async () => {
  const { deps, specs } = fakeRun({ answer: total });
  const s = await startAskServer({ port: 0, deps, status: async () => ({ available: true }), limits: { per10Minutes: 1, perHour: 1 } });
  const post = () => fetch(`http://127.0.0.1:${s.port}/ask`, { method: 'POST', body: JSON.stringify(req) });
  try {
    await post();
    await post();
    await post();
    assert.equal(specs.length, 1);
  } finally {
    await s.close();
  }
});

test('the browser giving up cancels the question', async () => {
  const { deps, signals } = fakeRun({ answer: '', hang: true });
  const s = await startAskServer({ port: 0, deps, status: async () => ({ available: true }) });
  const browser = new AbortController();
  const sent = fetch(`http://127.0.0.1:${s.port}/ask`, { method: 'POST', body: JSON.stringify(req), signal: browser.signal }).catch(() => null);
  try {
    for (let i = 0; i < 100 && signals.length === 0; i++) await sleep(10);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]!.aborted, false);
    browser.abort();
    await sent;
    for (let i = 0; i < 100 && !signals[0]!.aborted; i++) await sleep(10);
    assert.equal(signals[0]!.aborted, true);
  } finally {
    await s.close();
  }
});

test('the server reports status, refuses when unavailable and answers when available', async () => {
  const { deps } = fakeRun({ answer: total });
  let available = false;
  const s = await startAskServer({ port: 0, deps, status: async () => (available ? { available: true } : { available: false, reason: 'Ask Norn is unavailable: test.' }) });
  const base = `http://127.0.0.1:${s.port}`;
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/ask`, { method: 'POST', body: JSON.stringify(body), headers });
  try {
    assert.deepEqual(await (await fetch(`${base}/status`)).json(), { available: false, reason: 'Ask Norn is unavailable: test.' });
    const down = (await (await post(req)).json()) as AskResponse;
    assert.deepEqual([down.ok, (down as { kind: string }).kind], [false, 'unavailable']);
    available = true;
    const up = (await (await post(req)).json()) as AskResponse;
    assert.equal(up.ok, true);
    assert.equal((await post({ ecr: 'ECR-0417', question: '' })).status, 400);
    assert.equal((await post(req, { origin: 'http://evil.example' })).status, 403);
    const cors = await post(req, { origin: 'http://127.0.0.1:5173' });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  } finally {
    await s.close();
  }
});
