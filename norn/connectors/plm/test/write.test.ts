// Offline tests: the two writes Norn may make, and the refusal of everything else, against a stubbed REST API.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { IMPACT_FIELDS, postComment, writeImpact } from '../src/index.ts';
import { opts } from './fixture.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Call { method: string; path: string; body: any; auth: string | null }
function stub(respond: (c: Call) => { status?: number; body: unknown } = () => ({ body: { data: {} } })) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', path: decodeURIComponent(new URL(String(input)).pathname), body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('Authorization') };
    calls.push(call);
    const r = respond(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

test('writeImpact sends only the fields given, as strings, to the one ECR', async () => {
  const calls = stub(() => ({ body: { data: { name: 'ECR-0417', modified: '2026-10-24 12:00:00.000001', impact_report_level: '1', impact_recommendation: 'Approve', impact_updated_on: '2026-10-24 12:00:00', title: 'ignored' } } }));
  const r = await writeImpact(opts, 'ECR-0417', { impact_report_level: 1, impact_recommendation: 'Approve', impact_statement: '<p>hi</p>', impact_approval_route: null, impact_norn_url: undefined });
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [['PUT', '/api/resource/ECR/ECR-0417']]);
  assert.deepEqual(calls[0].body, { impact_report_level: '1', impact_recommendation: 'Approve', impact_statement: '<p>hi</p>', impact_approval_route: null });
  assert.equal(calls[0].auth, 'token test-key:test-secret');
  assert.deepEqual(r, { impact: { impact_report_level: '1', impact_recommendation: 'Approve', impact_updated_on: '2026-10-24 12:00:00' }, modified: '2026-10-24 12:00:00.000001' });
});

test('writeImpact accepts each of the seven fields and clears them with null', async () => {
  const calls = stub();
  await writeImpact(opts, 'ECR-0417', Object.fromEntries(IMPACT_FIELDS.map((f) => [f, null])));
  assert.deepEqual(Object.keys(calls[0].body), [...IMPACT_FIELDS]);
  assert.ok(Object.values(calls[0].body).every((v) => v === null));
  assert.equal(IMPACT_FIELDS.length, 7);
});

test('writeImpact refuses anything outside the seven fields before any request is made', async () => {
  const calls = stub();
  for (const bad of ['description', 'priority', 'workflow_state', 'cost_production', 'title', 'name', 'modified', 'docstatus', 'impact_report_level_x', 'ccb_meeting', 'decision_note', '__proto__', 'IMPACT_REPORT_LEVEL']) {
    const fields = JSON.parse(`{"impact_report_level":"1","${bad}":"x"}`);
    await assert.rejects(writeImpact(opts, 'ECR-0417', fields), (e: Error) => e instanceof RangeError && e.message.includes(bad), bad);
  }
  await assert.rejects(writeImpact(opts, 'ECR-0417', {}), /at least one field/);
  await assert.rejects(writeImpact(opts, 'ECR-0417', { impact_statement: undefined }), /at least one field/);
  await assert.rejects(writeImpact(opts, 'ECR-0417', { impact_statement: { html: 1 } } as any), TypeError);
  await assert.rejects(writeImpact(opts, 'ECR-0417/../Part/BW-1', { impact_report_level: '1' }), /not an ECR number/);
  await assert.rejects(writeImpact(opts, '', { impact_report_level: '1' }), /not an ECR number/);
  assert.equal(calls.length, 0, 'not one request went out');
});

test('postComment posts a Comment about the ECR, and refuses empty text or a path in the ECR number', async () => {
  const calls = stub(() => ({ body: { data: { name: 'abc123' } } }));
  const r = await postComment(opts, 'ECR-0417', '<p>Level 1 posted.</p>');
  assert.deepEqual(r, { name: 'abc123' });
  assert.deepEqual([calls[0].method, calls[0].path], ['POST', '/api/resource/Comment']);
  assert.deepEqual(calls[0].body, { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'ECR', reference_name: 'ECR-0417', content: '<p>Level 1 posted.</p>' });
  await assert.rejects(postComment(opts, 'ECR-0417', '  '), /some text/);
  await assert.rejects(postComment(opts, 'ECR-0417?x=1', 'hi'), /not an ECR number/);
  assert.equal(calls.length, 1);
});

test('a refusal from the PLM comes back as an error with the status, not the token', async () => {
  stub(() => ({ status: 403, body: { exc_type: 'PermissionError', _server_messages: JSON.stringify([JSON.stringify({ message: 'Norn may write only the impact assessment fields' })]) } }));
  await assert.rejects(writeImpact(opts, 'ECR-0417', { impact_report_level: '1' }), (e: any) => e.name === 'PlmError' && e.status === 403
    && e.message.includes('impact assessment') && !e.message.includes('test-secret'));
});
