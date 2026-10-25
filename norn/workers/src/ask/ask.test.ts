import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobResult, JobSpec, NornEvent } from '../../../runner/src/index.ts';
import { ASK_SYSTEM_PROMPT, ASK_TOOLS, ask, validateRequest, type AskDeps } from './ask.ts';
import type { AskResponse } from './protocol.ts';
import { startAskServer } from './server.ts';

const impact = { results: [{ key: 'one_time_total', label: 'One-time cost', unit: 'usd', p10: 256940.22, p50: 304745.32, p90: 374317.37, mock: false }] };

function fakeRun(opts: { answer: string; calls?: { tool: string; input: unknown; content?: string; isError?: boolean }[]; status?: JobResult['status']; errorKind?: string }): { deps: AskDeps; specs: JobSpec[] } {
  const specs: JobSpec[] = [];
  const calls = opts.calls ?? [{ tool: 'mcp__norn__get_impact', input: { ecr: 'ECR-0417' }, content: JSON.stringify(impact) }];
  const deps: AskDeps = {
    settings: { model: 'test-model', maxTurns: 3, timeoutMs: 1000, tokenTtlSeconds: 60 },
    newId: () => 'x1',
    mcpFor: () => ({ norn: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }),
    run: async (spec, sink) => {
      specs.push(spec);
      for (const [i, c] of calls.entries()) {
        const base = { seq: 0, ts: '', jobId: spec.id, role: spec.role, identity: spec.identity, sessionId: null };
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
  return { deps, specs };
}
const req = { ecr: 'ECR-0417', question: 'Why is the one-time cost what it is?' };
const reply = (answer: string, citations: unknown[]) => JSON.stringify({ answer, citations });

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

test('a quoted answer comes back verified', async () => {
  const { deps } = fakeRun({ answer: reply('The one-time cost is $304,745.', [{ label: 'One-time cost', refId: 'one_time_total', value: '$304,745' }]) });
  const r = (await ask(req, deps)) as Extract<AskResponse, { ok: true }>;
  assert.equal(r.ok, true);
  assert.deepEqual(r.unverifiedNumbers, []);
  assert.equal(r.citations[0]!.verified, true);
});

test('a number the session did not read is marked, not dropped', async () => {
  const { deps } = fakeRun({ answer: reply('The one-time cost is $148,000.', [{ label: 'One-time cost', refId: 'one_time_total', value: '$304,745' }]) });
  const r = (await ask(req, deps)) as Extract<AskResponse, { ok: true }>;
  assert.deepEqual(r.unverifiedNumbers, ['148,000']);
  assert.equal(r.segments.find(s => s.unverified)?.text, '148,000');
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

test('the server reports status, refuses when unavailable and answers when available', async () => {
  const { deps } = fakeRun({ answer: reply('The one-time cost is $304,745.', [{ label: 'One-time cost', refId: 'one_time_total', value: '$304,745' }]) });
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
