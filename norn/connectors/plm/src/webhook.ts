// The PLM's webhooks, the production path (the poller is the demo path). The PLM POSTs a JSON body with a
// header X-Frappe-Webhook-Signature: the base64 HMAC-SHA256 of the raw body under a shared secret.
// The body names the event ('ecr.inserted', 'ecr.updated', 'ncr.inserted', 'ncr.updated', 'eco.released').
//
//   http.createServer(createWebhookHandler(secret, (event, current) => ..., { plm })).listen(port)
//
// The PLM signs the body but sends no timestamp or nonce, so anyone who has seen a request can send the same
// bytes again later and the signature still verifies. The payload is therefore a prompt, not a source of
// truth: the handler reads the request's current state from the PLM and hands that to `onEvent`. A replay
// costs a repeat read, never an obsolete assessment; consumers stay idempotent on the request's content.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlmDoc } from './schema.ts';
import { readChangeRequest } from './read.ts';
import type { ReadResult } from './map.ts';
import type { PlmOptions } from './options.ts';

export interface WebhookEvent {
  /** 'ecr.inserted', 'ecr.updated', 'ncr.inserted', 'ncr.updated' or 'eco.released'. */
  event: string;
  doctype: string;
  name: string;
  modified?: string;
  modified_by?: string;
  workflow_state?: string;
  /**
   * The whole document with its child tables, as it was when the PLM sent the event. Signed, but possibly old
   * (a captured request can be sent again), so do not assess from it: use the `current` the handler passes.
   */
  doc: PlmDoc;
}

export const SIGNATURE_HEADER = 'x-frappe-webhook-signature';

/**
 * True when `signatureHeader` is the base64 HMAC-SHA256 of the raw body under `secret`. The comparison takes
 * the same time wherever the two differ. A missing or empty signature, or an empty secret, is never valid.
 */
export function verifyWebhook(rawBody: Buffer | string, signatureHeader: string | string[] | undefined, secret: string): boolean {
  if (!secret || typeof signatureHeader !== 'string' || !signatureHeader) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('base64'));
  const given = Buffer.from(signatureHeader);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WebhookHandlerOptions {
  /**
   * The PLM connection. For an ECR event (and an ECO's release) the handler reads the ECR from it by name
   * before calling `onEvent`, so a replayed old body cannot show Norn an obsolete request. The read is given
   * 4 s unless `timeoutMs` is set, inside the PLM's own wait for an answer.
   */
  plm: PlmOptions;
  /** Header that also names the event. When present it must agree with the body (the body is the signed one). Default: the PLM settings' `webhook.eventHeader`. */
  eventHeader?: string;
  /** Largest body accepted. Default 5 MB. */
  maxBytes?: number;
  /** Called when `onEvent` throws. Default: a one-line message on stderr. */
  onError?: (err: unknown) => void;
}

function reply(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** The ECR an event is about: the document itself for an ECR event, the ECO's `ecr` for an ECO. Others (NCRs) have none. */
function ecrOf(e: WebhookEvent): string | undefined {
  if (e.doctype === 'ECR') return e.name;
  return e.doctype === 'ECO' && typeof e.doc.ecr === 'string' && e.doc.ecr !== '' ? e.doc.ecr : undefined;
}

/**
 * A `node:http` request handler for the PLM's webhooks. It answers 200 once `onEvent` has finished, so the
 * PLM retries (it tries three times) when `onEvent` throws (500) or the read of the current ECR fails.
 * 401 for a missing or wrong signature, 405 for anything but POST, 413 for a body over the limit, 400 for a
 * body that is not an event.
 *
 * Replays: a signed body can be sent again by anyone who captured it, and carries a document that may be
 * long out of date. So `onEvent(event, current)` gets, for an ECR or ECO event, `current`: the request as the
 * PLM holds it now, read by name. A replay therefore only makes the consumer look at the current request
 * again, which an idempotent consumer (Norn's ingest keys on the request's content) ignores. There is no
 * "already seen" memory: one keyed on `modified` drops a real update that shares a timestamp, and races
 * between concurrent requests. Consumers should assess `current`, never `event.doc`; an NCR event has no
 * `current` and is only a hint to look.
 */
export function createWebhookHandler(
  secret: string,
  onEvent: (event: WebhookEvent, current?: ReadResult) => void | Promise<void>,
  o: WebhookHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  if (!secret) throw new Error('createWebhookHandler needs the webhook secret');
  if (!o?.plm) throw new Error('createWebhookHandler needs the PLM connection, to read the current request');
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  const onError = o.onError ?? ((e) => console.error(`webhook handler: ${e instanceof Error ? e.message : String(e)}`));
  const eventHeader = (o.eventHeader ?? o.plm.webhook?.eventHeader)?.toLowerCase();
  const plm: PlmOptions = { ...o.plm, timeoutMs: o.plm.timeoutMs ?? 4000 };

  return (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' }, { Allow: 'POST' });
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (tooBig) return;
      if (size > maxBytes) {
        tooBig = true;
        res.once('finish', () => req.destroy());
        reply(res, 413, { error: 'body too large' }, { Connection: 'close' });
        return;
      }
      chunks.push(c);
    });
    req.on('error', () => { /* the client went away */ });
    req.on('end', () => {
      if (tooBig) return;
      void (async () => {
        const raw = Buffer.concat(chunks);
        if (!verifyWebhook(raw, req.headers[SIGNATURE_HEADER], secret)) return reply(res, 401, { error: 'signature missing or wrong' });
        let body: any;
        try { body = JSON.parse(raw.toString('utf8')); } catch { return reply(res, 400, { error: 'body is not JSON' }); }
        if (!body || typeof body.event !== 'string' || typeof body.name !== 'string' || typeof body.doc !== 'object' || body.doc === null) {
          return reply(res, 400, { error: 'body is not a PLM event' });
        }
        const header = eventHeader ? req.headers[eventHeader] : undefined;
        if (header !== undefined && header !== body.event) return reply(res, 400, { error: 'event header and body disagree' });
        const event = body as WebhookEvent;
        try {
          const ecr = ecrOf(event);
          await onEvent(event, ecr ? await readChangeRequest(plm, ecr) : undefined);
        } catch (e) {
          onError(e);
          return reply(res, 500, { error: 'handler failed' });
        }
        reply(res, 200, { ok: true });
      })();
    });
  };
}
