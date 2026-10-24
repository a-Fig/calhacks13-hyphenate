// Offline tests: webhook signature verification and the node:http handler, with payloads signed here in the
// PLM's format (base64 HMAC-SHA256 of the raw body, header X-Frappe-Webhook-Signature).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { createWebhookHandler, verifyWebhook } from '../src/index.ts';
import type { WebhookEvent } from '../src/index.ts';
import { ecrDoc } from './fixture.ts';

const SECRET = 'a-shared-secret';
const sign = (body: string | Buffer, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');
const payload = (event = 'ecr.updated') => JSON.stringify({ event, doctype: 'ECR', name: 'ECR-0001', modified: '2026-10-02 10:30:15.250000', modified_by: 'ann@acme.test', workflow_state: 'Submitted', doc: ecrDoc() });

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
afterEach(async () => { await new Promise((r) => (server ? server.close(r) : r(undefined))); server = undefined; });

async function serve(onEvent: (e: WebhookEvent) => void | Promise<void>, o: Parameters<typeof createWebhookHandler>[2] = { eventHeader: 'X-Acme-Event', onError: () => {} }) {
  server = createServer(createWebhookHandler(SECRET, onEvent, o));
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
  assert.equal((await send(body, sig)).status, 200);
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

test('createWebhookHandler will not be built without a secret', () => {
  assert.throws(() => createWebhookHandler('', () => {}), /secret/);
});
