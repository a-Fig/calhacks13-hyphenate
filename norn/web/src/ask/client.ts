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
    const body = (await r.json()) as AskResponse;
    if (body && typeof body === 'object' && 'ok' in body) return body;
    return { ok: false, kind: 'failed', message: 'Ask Norn sent a reply the page cannot read.' };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') return { ok: false, kind: 'failed', message: 'Norn took too long to answer. Try a narrower question.' };
    return SERVER_DOWN;
  }
}

export type { AskAnswer as Answer };
