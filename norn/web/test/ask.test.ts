// Ask Norn in the browser: the client never throws, and the recorded example is labelled and really checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askNorn, askStatus, readAskResponse } from '../src/ask/client.ts';
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

test('the markers in the recorded example become references and chips with the stored labels, and none is left in the text', () => {
  const a = recordedAnswer();
  assert.ok(!/\[c\d+\]/.test(a.answer));
  assert.deepEqual(a.citations.map(c => c.id), ['c1', 'c2']);
  assert.equal(a.citations[0]!.label, 'BW-5120-210: cancellation charge, share of price');
  assert.match(a.citations[1]!.label, /^Inventory disposition, BW-5120-210/);
  assert.ok(a.segments.filter(x => x.cites).length >= 6);
  assert.deepEqual(a.segments.find(x => x.text === '60,439')?.cites, ['c2']);
});

test('the recorded example fails the guardrail when a number is cited to the wrong source', () => {
  const swapped = recordedAnswer({ ...RECORDED_AGENT_ANSWER, answer: RECORDED_AGENT_ANSWER.answer.replace('$60,439 [c2]', '$60,439 [c1]') });
  assert.deepEqual(swapped.unverifiedNumbers, ['60,439']);
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

const answer = {
  ok: true, answer: 'It is $5.', segments: [{ text: 'It is $' }, { text: '5', cites: ['c1'] }, { text: '.' }],
  citations: [{ id: 'c1', label: 'Five', refId: 'five', value: '$5', verified: true }], unverifiedNumbers: [], mock: false, model: 'm', durationMs: 1,
};

test('a reply with the right shape is passed on', async () => {
  assert.deepEqual(await askNorn('ECR-0417', 'x', json(answer) as unknown as typeof fetch), answer);
});

test('a reply that says ok but is not an answer is "unavailable", not a crash in the page', async () => {
  const bad: unknown[] = [
    { ok: true },
    { ok: true, answer: 'x' },
    { ...answer, segments: undefined },
    { ...answer, segments: [{ unverified: true }] },
    { ...answer, citations: 'none' },
    { ...answer, citations: [{ id: 'c1' }] },
    { ...answer, unverifiedNumbers: undefined },
    { ...answer, unverifiedNumbers: [5] },
    { ...answer, mock: 'no' },
    { ok: false },
    { ok: false, kind: 'exploded', message: 'x' },
    { ok: false, kind: 'failed' },
    { ok: 'yes' },
    [],
    null,
    'text',
    7,
  ];
  for (const body of bad) {
    const r = await askNorn('ECR-0417', 'x', json(body) as unknown as typeof fetch);
    assert.deepEqual([r.ok, !r.ok && r.kind], [false, 'unavailable'], JSON.stringify(body));
    assert.equal(readAskResponse(body), null, JSON.stringify(body));
  }
});

test('every refusal kind the server sends is read', () => {
  for (const kind of ['unavailable', 'busy', 'limited', 'failed', 'bad_request'])
    assert.deepEqual(readAskResponse({ ok: false, kind, message: 'm' }), { ok: false, kind, message: 'm' });
});

test('a citation opens the trace page under the id the page uses', () => {
  const traces = { 'line:inventory:BW-5120-210': {}, 'in:cancel:BW-5120-210': {}, one_time_total: {} };
  assert.equal(resolveTraceId('line:inventory:BW-5120-210', traces), 'line:inventory:BW-5120-210');
  assert.equal(resolveTraceId('cancel:BW-5120-210', traces), 'in:cancel:BW-5120-210');
  assert.equal(resolveTraceId('s2_cost.one_time_total', traces), 'one_time_total');
  assert.equal(resolveTraceId('made-up', traces), null);
});
