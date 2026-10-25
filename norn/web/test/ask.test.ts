// Ask Norn in the browser: the client never throws, and the recorded example is labelled and really checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askNorn, askStatus } from '../src/ask/client.ts';
import { RECORDED_AGENT_ANSWER, recordedAnswer } from '../src/ask/recorded.ts';
import { resolveTraceId } from '../src/ask/trace-id.ts';

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const down = (async () => {
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;

test('the recorded example passes the guardrail and is labelled recorded', () => {
  const a = recordedAnswer();
  assert.equal(a.recorded, true);
  assert.deepEqual(a.unverifiedNumbers, []);
  assert.ok(a.citations.length === 2 && a.citations.every(c => c.verified));
});

test('the recorded example fails the guardrail when a number is changed', () => {
  const a = recordedAnswer({ ...RECORDED_AGENT_ANSWER, answer: RECORDED_AGENT_ANSWER.answer.replace('$60,439', '$148,000') });
  assert.deepEqual(a.unverifiedNumbers, ['148,000']);
});

test('a dead server is "unavailable", not an exception and not an answer', async () => {
  assert.equal((await askStatus(down)).available, false);
  const r = await askNorn('ECR-0417', 'why?', down);
  assert.deepEqual([r.ok, !r.ok && r.kind], [false, 'unavailable']);
});

test('the server\'s status and refusals pass through', async () => {
  assert.deepEqual(await askStatus(json({ available: true }) as unknown as typeof fetch), { available: true });
  assert.equal((await askStatus(json({ available: false, reason: 'No login.' }) as unknown as typeof fetch)).reason, 'No login.');
  const refusal = { ok: false, kind: 'busy', message: 'Try again.' };
  assert.deepEqual(await askNorn('ECR-0417', 'x', json(refusal) as unknown as typeof fetch), refusal);
  const junk = await askNorn('ECR-0417', 'x', (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch);
  assert.equal(junk.ok, false);
});

test('a citation opens the trace page under the id the page uses', () => {
  const traces = { 'line:inventory:BW-5120-210': {}, 'in:cancel:BW-5120-210': {}, one_time_total: {} };
  assert.equal(resolveTraceId('line:inventory:BW-5120-210', traces), 'line:inventory:BW-5120-210');
  assert.equal(resolveTraceId('cancel:BW-5120-210', traces), 'in:cancel:BW-5120-210');
  assert.equal(resolveTraceId('s2_cost.one_time_total', traces), 'one_time_total');
  assert.equal(resolveTraceId('made-up', traces), null);
});
