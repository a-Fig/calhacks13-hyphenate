// Offline tests: webhook signature verification and the node:http handler, with payloads signed here in the
// PLM's format (base64 HMAC-SHA256 of the raw body, header X-Frappe-Webhook-Signature).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { createWebhookHandler, verifyWebhook } from '../src/index.ts';
import type { ReadResult, WebhookEvent } from '../src/index.ts';
import { ecrDoc, opts } from './fixture.ts';

const SECRET = 'a-shared-secret';
const sign = (body: string | Buffer, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');
const payload = (event = 'ecr.updated') => JSON.stringify({ event, doctype: 'ECR', name: 'ECR-0001', modified: '2026-10-02 10:30:15.250000', modified_by: 'ann@acme.test', workflow_state: 'Submitted', doc: ecrDoc() });
/** An event for ECR-0001 as it was at `modified`, with that state and title on its document. */
const eventAt = (modified: string, state = 'Submitted', event = 'ecr.updated') => JSON.stringify({
  event, doctype: 'ECR', name: 'ECR-0001', modified, modified_by: 'ann@acme.test', workflow_state: state, doc: { ...ecrDoc(), modified, workflow_state: state, title: `Title at ${modified}` },
});

test('verifyWebhook: a known HMAC-SHA256 vector, base64', () => {
  // RFC-style published vector: key "key", message "The quick brown fox jumps over the lazy dog".
  const hex = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
  const body = 'The quick brown fox jumps over the lazy dog';
  assert.equal(verifyWebhook(body, Buffer.from(hex, 'hex').toString('base64'), 'key'), true);
  assert.equal(verifyWebhook(Buffer.from(body), Buffer.from(hex, 'hex').toString('base64'), 'key'), true);
});

test('verifyWebhook: good, wrong secret, missing, empty, tampered, truncated, and a list of headers', () => {
  const body = payload();
  assert.equal(verifyWebhook(body, sign(body), SECRET), true);
  assert.equal(verifyWebhook(body, sign(body, 'other'), SECRET), false, 'signed with another secret');
  assert.equal(verifyWebhook(body, undefined, SECRET), false, 'no header');
  assert.equal(verifyWebhook(body, '', SECRET), false, 'empty header');
  assert.equal(verifyWebhook(body + ' ', sign(body), SECRET), false, 'a byte added');
  assert.equal(verifyWebhook(body.replace('Submitted', 'Approved'), sign(body), SECRET), false, 'a value changed');
  assert.equal(verifyWebhook(body, sign(body).slice(0, -2), SECRET), false, 'truncated signature');
  assert.equal(verifyWebhook(body, sign(body) + 'A', SECRET), false, 'longer signature');
  assert.equal(verifyWebhook(body, [sign(body)], SECRET), false, 'a repeated header');
  assert.equal(verifyWebhook(body, sign(body, ''), ''), false, 'an empty secret never verifies, even for a body signed with it');
  assert.equal(verifyWebhook(body, Buffer.from(sign(body)).toString('hex'), SECRET), false, 'hex is not base64');
});

test('verifyWebhook signs the bytes, not a re-encoding of them', () => {
  const raw = Buffer.from('{"a":"café"}\n', 'utf8');
  assert.equal(verifyWebhook(raw, sign(raw), SECRET), true);
  assert.equal(verifyWebhook(Buffer.from(raw.toString('latin1'), 'utf8'), sign(raw), SECRET), false);
});

let server: Server | undefined;
const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = undefined;
});

/** The PLM as it is now: what a read by name returns, and the names read. Requests to the receiver itself pass through. */
function plmNow(doc: Record<string, any> = { ...ecrDoc(), modified: '2026-10-09 09:00:00.000000', workflow_state: 'Approved', title: 'Current title' }) {
  const reads: string[] = [];
  let fail = false;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'plm.test') return realFetch(input, init);
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/resource/ECO') return new Response(JSON.stringify({ data: [] }), { status: 200 });
    reads.push(path.split('/').pop()!);
    if (fail) return new Response(JSON.stringify({ exc_type: 'OperationalError' }), { status: 500 });
    return new Response(JSON.stringify({ data: doc }), { status: 200 });
  }) as typeof fetch;
  return { reads, failReads(v = true) { fail = v; } };
}

async function serve(onEvent: (e: WebhookEvent, current?: ReadResult) => void | Promise<void>, o: Partial<Parameters<typeof createWebhookHandler>[2]> = { eventHeader: 'X-Acme-Event', onError: () => {} }) {
  if (globalThis.fetch === realFetch) plmNow(); // a test that does not set the PLM up gets the default one, never the network
  server = createServer(createWebhookHandler(SECRET, onEvent, { plm: opts, ...o }));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  const send = async (body: string | Buffer, headers: Record<string, string> = {}, method = 'POST') => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? body : undefined });
    return { status: r.status, json: await r.json().catch(() => undefined) };
  };
  return { send };
}

test('the handler: a signed event reaches onEvent once, and is answered 200 after onEvent finishes', async () => {
  const got: WebhookEvent[] = [];
  let finished = false;
  const { send } = await serve(async (e) => { await new Promise((r) => setTimeout(r, 30)); got.push(e); finished = true; });
  const body = payload();
  const r = await send(body, { 'X-Frappe-Webhook-Signature': sign(body), 'X-Acme-Event': 'ecr.updated' });
  assert.equal(r.status, 200);
  assert.equal(finished, true);
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].event, got[0].name, got[0].doctype, got[0].workflow_state, got[0].doc.title], ['ecr.updated', 'ECR-0001', 'ECR', 'Submitted', 'Bracket rev B to C']);
});

test('the handler refuses a missing, wrong or tampered signature with 401 and calls nobody', async () => {
  const got: WebhookEvent[] = [];
  const { send } = await serve((e) => { got.push(e); });
  const body = payload();
  assert.equal((await send(body)).status, 401, 'missing');
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': '' })).status, 401, 'empty');
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': sign(body, 'other') })).status, 401, 'wrong secret');
  assert.equal((await send(body.replace('ECR-0001', 'ECR-0002'), { 'X-Frappe-Webhook-Signature': sign(body) })).status, 401, 'tampered body');
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': 'not base64 at all' })).status, 401, 'garbage');
  assert.equal(got.length, 0);
});

test('the handler: only POST; a signed body that is not JSON or not an event is 400', async () => {
  const got: WebhookEvent[] = [];
  const { send } = await serve((e) => { got.push(e); });
  assert.equal((await send('', {}, 'GET')).status, 405);
  assert.equal((await send('{', { 'X-Frappe-Webhook-Signature': sign('{') })).status, 400);
  const notEvent = JSON.stringify({ hello: 'world' });
  assert.equal((await send(notEvent, { 'X-Frappe-Webhook-Signature': sign(notEvent) })).status, 400);
  const noDoc = JSON.stringify({ event: 'ecr.updated', name: 'ECR-1' });
  assert.equal((await send(noDoc, { 'X-Frappe-Webhook-Signature': sign(noDoc) })).status, 400);
  assert.equal(got.length, 0);
});

test('the event header must agree with the signed body; without the header the body decides', async () => {
  const got: string[] = [];
  const { send } = await serve((e) => { got.push(e.event); });
  const body = payload('eco.released');
  const sig = { 'X-Frappe-Webhook-Signature': sign(body) };
  assert.equal((await send(body, { ...sig, 'X-Acme-Event': 'ecr.updated' })).status, 400);
  assert.equal((await send(body, { ...sig, 'X-Acme-Event': 'eco.released' })).status, 200);
  const later = eventAt('2026-10-03 10:30:15.250000', 'Submitted', 'eco.released'); // a repeat of the same event would be ignored
  assert.equal((await send(later, { 'X-Frappe-Webhook-Signature': sign(later) })).status, 200);
  assert.deepEqual(got, ['eco.released', 'eco.released']);
});

test('the handler answers 500 when onEvent throws, so the PLM retries', async () => {
  const errors: unknown[] = [];
  const { send } = await serve(() => { throw new Error('boom'); }, { onError: (e) => errors.push(e) });
  const body = payload();
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': sign(body) })).status, 500);
  assert.equal(errors.length, 1);
});

test('the handler refuses a body over the limit with 413', async () => {
  const got: WebhookEvent[] = [];
  const { send } = await serve((e) => { got.push(e); }, { maxBytes: 1000, onError: () => {} });
  const body = payload();
  assert.ok(body.length > 1000);
  const r = await send(body, { 'X-Frappe-Webhook-Signature': sign(body) }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
  assert.equal(got.length, 0);
});

test('createWebhookHandler will not be built without a secret or the PLM connection', () => {
  assert.throws(() => createWebhookHandler('', () => {}, { plm: opts }), /secret/);
  assert.throws(() => createWebhookHandler(SECRET, () => {}, {} as any), /PLM connection/);
});

// ---- replays: the PLM sends no timestamp, so signed bytes captured once verify forever

test('an event gets the request as the PLM holds it now, not the document in the body', async () => {
  const plm = plmNow();
  const got: { doc: string; current?: ReadResult }[] = [];
  const { send } = await serve((e, current) => { got.push({ doc: e.doc.title, current }); });
  const body = eventAt('2026-10-02 10:30:15.250000');
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': sign(body) })).status, 200);
  assert.deepEqual(plm.reads, ['ECR-0001']);
  assert.equal(got[0].doc, 'Title at 2026-10-02 10:30:15.250000');
  assert.equal(got[0].current?.record.title, 'Current title');
  assert.equal(got[0].current?.record.workflowState, 'Approved');
  assert.equal(got[0].current?.modified, '2026-10-09 09:00:00.000000');
});

test('a replayed old event is not handled again, and one handled after a restart still sees only the current state', async () => {
  const plm = plmNow();
  const got: { event: string; state: string; current: string | undefined }[] = [];
  const handle = (e: WebhookEvent, current?: ReadResult) => { got.push({ event: e.modified!, state: e.workflow_state!, current: current?.record.workflowState }); };
  const { send } = await serve(handle);
  const old = eventAt('2026-10-02 10:30:15.250000', 'Submitted');
  const newer = eventAt('2026-10-05 08:00:00.000000', 'In CM Review');
  const h = (b: string) => ({ 'X-Frappe-Webhook-Signature': sign(b), 'X-Acme-Event': 'ecr.updated' });
  assert.equal((await send(newer, h(newer))).status, 200);
  const replay = await send(old, h(old));
  assert.equal(replay.status, 200, 'acknowledged, so the sender sees nothing to retry');
  assert.equal((replay.json as any).ignored !== undefined, true);
  assert.equal((await send(newer, h(newer))).status, 200, 'the same event again (a lost 200 and a retry)');
  assert.equal(got.length, 1, 'neither reached onEvent');
  assert.equal(plm.reads.length, 1, 'and neither cost a read');
  // the same replay against a handler that has never seen the document: handled, but with the current state
  await new Promise((r) => server!.close(r));
  const second = await serve(handle);
  assert.equal((await second.send(old, h(old))).status, 200);
  assert.deepEqual(got[1], { event: '2026-10-02 10:30:15.250000', state: 'Submitted', current: 'Approved' }, 'the body says Submitted; the PLM says Approved');
});

test('an event is handled again after a failure, and a different event on the same document is its own', async () => {
  const plm = plmNow();
  const got: string[] = [];
  let failures = 1;
  const { send } = await serve((e) => { if (failures-- > 0) throw new Error('boom'); got.push(e.event); }, { onError: () => {} });
  const body = eventAt('2026-10-02 10:30:15.250000', 'Submitted', 'ecr.inserted');
  const sig = { 'X-Frappe-Webhook-Signature': sign(body) };
  assert.equal((await send(body, sig)).status, 500);
  assert.equal((await send(body, sig)).status, 200, 'the retry is handled: the first try did not finish');
  const updated = eventAt('2026-10-02 10:30:15.250000', 'Submitted', 'ecr.updated'); // an insert fires both events with one stamp
  assert.equal((await send(updated, { 'X-Frappe-Webhook-Signature': sign(updated) })).status, 200);
  assert.deepEqual(got, ['ecr.inserted', 'ecr.updated']);
  assert.equal(plm.reads.length, 3);
});

test('when the current request cannot be read the PLM is told to retry, and onEvent is not called', async () => {
  const plm = plmNow();
  plm.failReads();
  const got: WebhookEvent[] = [];
  const errors: unknown[] = [];
  const { send } = await serve((e) => { got.push(e); }, { onError: (e) => errors.push(e) });
  const body = eventAt('2026-10-02 10:30:15.250000');
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': sign(body) })).status, 500);
  assert.equal(got.length, 0);
  assert.equal(errors.length, 1);
  plm.failReads(false);
  assert.equal((await send(body, { 'X-Frappe-Webhook-Signature': sign(body) })).status, 200);
  assert.equal(got.length, 1);
});

test('an ECO release reads its ECR; an NCR event reads nothing', async () => {
  const plm = plmNow();
  const got: (ReadResult | undefined)[] = [];
  const { send } = await serve((_e, current) => { got.push(current); });
  const eco = JSON.stringify({ event: 'eco.released', doctype: 'ECO', name: 'ECO-0007', modified: '2026-10-09 09:00:01.000000', doc: { name: 'ECO-0007', ecr: 'ECR-0001' } });
  assert.equal((await send(eco, { 'X-Frappe-Webhook-Signature': sign(eco) })).status, 200);
  const ncr = JSON.stringify({ event: 'ncr.updated', doctype: 'NCR', name: 'NCR-0007', modified: '2026-10-09 09:00:02.000000', doc: { name: 'NCR-0007' } });
  assert.equal((await send(ncr, { 'X-Frappe-Webhook-Signature': sign(ncr) })).status, 200);
  assert.deepEqual(plm.reads, ['ECR-0001']);
  assert.equal(got[0]?.change.id, 'ECR-0001');
  assert.equal(got[1], undefined);
});
