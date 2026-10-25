// The browser's side of Ask Norn: ask the local Ask Norn server (norn/workers/src/ask/server.ts).
// The page never starts a Claude session or holds a key; it only sends the question.
import type { AskAnswer, AskRefusal, AskResponse, AskStatus } from '../../../workers/src/ask/protocol.ts';

export type { AskAnswer, AskCitation, AskRefusal, AskResponse, AskSegment, AskStatus } from '../../../workers/src/ask/protocol.ts';

const DEFAULT_URL = 'http://127.0.0.1:3918';

export function askBaseUrl(): string {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_NORN_ASK_URL;
  return (v || DEFAULT_URL).replace(/\/$/, '');
}

const SERVER_DOWN: AskRefusal = { ok: false, kind: 'unavailable', message: 'Ask Norn is unavailable: its server is not running here.' };
const UNREADABLE: AskRefusal = { ok: false, kind: 'unavailable', message: 'Ask Norn is unavailable: its server sent a reply the page cannot read.' };

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string');
const KINDS = new Set(['unavailable', 'busy', 'limited', 'failed', 'bad_request']);

/**
 * The server's reply if it has the shape the page needs, else null. The page reads the answer's lists and
 * text straight away, so a reply that says ok but lacks them must not get that far.
 */
export function readAskResponse(body: unknown): AskResponse | null {
  if (!isObject(body)) return null;
  if (body.ok === false) return typeof body.kind === 'string' && KINDS.has(body.kind) && typeof body.message === 'string' ? (body as unknown as AskRefusal) : null;
  if (body.ok !== true) return null;
  const segmentsOk = Array.isArray(body.segments) && body.segments.every(s => isObject(s) && typeof s.text === 'string' && (s.unverified === undefined || typeof s.unverified === 'boolean') && (s.cites === undefined || isStrings(s.cites)));
  const citationsOk =
    Array.isArray(body.citations) &&
    body.citations.every(c => isObject(c) && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.refId === 'string' && typeof c.value === 'string' && (c.verified === undefined || typeof c.verified === 'boolean'));
  if (typeof body.answer !== 'string' || !segmentsOk || !citationsOk || !isStrings(body.unverifiedNumbers) || typeof body.mock !== 'boolean') return null;
  return body as unknown as AskAnswer;
}

export async function askStatus(f: typeof fetch = fetch, base = askBaseUrl()): Promise<AskStatus> {
  try {
    const r = await f(`${base}/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { available: false, reason: SERVER_DOWN.message };
    const s = (await r.json()) as AskStatus;
    return s.available ? { available: true } : { available: false, reason: s.reason ?? SERVER_DOWN.message };
  } catch {
    return { available: false, reason: SERVER_DOWN.message };
  }
}

/** Never throws: a dead server, a bad reply or a timeout comes back as a refusal the panel can show. */
export async function askNorn(ecr: string, question: string, f: typeof fetch = fetch, base = askBaseUrl(), timeoutMs = 150_000): Promise<AskResponse> {
  try {
    const r = await f(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ecr, question }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return readAskResponse(await r.json()) ?? UNREADABLE;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') return { ok: false, kind: 'failed', message: 'Norn took too long to answer. Try a narrower question.' };
    return SERVER_DOWN;
  }
}

export type { AskAnswer as Answer };
