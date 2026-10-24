// The PLM's webhooks, the production path (the poller is the demo path). The PLM POSTs a JSON body with a
// header X-Frappe-Webhook-Signature: the base64 HMAC-SHA256 of the raw body under a shared secret.
// The body names the event ('ecr.inserted', 'ecr.updated', 'ncr.inserted', 'ncr.updated', 'eco.released').
//
//   http.createServer(createWebhookHandler(secret, (event) => ...)).listen(port)

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlmDoc } from './schema.ts';

export interface WebhookEvent {
  /** 'ecr.inserted', 'ecr.updated', 'ncr.inserted', 'ncr.updated' or 'eco.released'. */
  event: string;
  doctype: string;
  name: string;
  modified?: string;
  modified_by?: string;
  workflow_state?: string;
  /** The whole document with its child tables; `mapEcr` turns an ECR's into the checks' shape. */
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
  /** Header that also names the event. When present it must agree with the body (the body is the signed one). */
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

/**
 * A `node:http` request handler for the PLM's webhooks. It answers 200 once `onEvent` has finished, so the
 * PLM retries (it tries three times) when `onEvent` throws (500). 401 for a missing or wrong signature,
 * 405 for anything but POST, 413 for a body over the limit, 400 for a body that is not an event.
 */
export function createWebhookHandler(
  secret: string,
  onEvent: (event: WebhookEvent) => void | Promise<void>,
  o: WebhookHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  if (!secret) throw new Error('createWebhookHandler needs the webhook secret');
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  const onError = o.onError ?? ((e) => console.error(`webhook handler: ${e instanceof Error ? e.message : String(e)}`));
  const eventHeader = o.eventHeader?.toLowerCase();

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
        try {
          await onEvent(body as WebhookEvent);
        } catch (e) {
          onError(e);
          return reply(res, 500, { error: 'handler failed' });
        }
        reply(res, 200, { ok: true });
      })();
    });
  };
}
