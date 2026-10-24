// A small PLM REST client: token auth, JSON in and out. It reads, and it makes the two writes Norn is
// allowed (a PUT of the impact fields, a POST of a comment); there is deliberately no DELETE.
// Never logs or throws headers, keys or secrets.

import type { PlmConnection } from './options.ts';

export class PlmError extends Error {
  status: number;
  constructor(status: number, method: string, path: string, detail: string) {
    super(`PLM ${status} on ${method} ${path}${detail ? `: ${detail}` : ''}`.slice(0, 600));
    this.name = 'PlmError';
    this.status = status;
  }
}

export type Filter = [field: string, op: string, value: unknown];

export interface ListQuery {
  fields: string[];
  filters?: Filter[];
  orderBy?: string;
  /** Default 0: all rows. */
  limit?: number;
}

export const enc = encodeURIComponent;

export class PlmClient {
  requests = 0;
  #base: string;
  #auth: string;
  #timeout: number;

  constructor(c: PlmConnection) {
    if (!c.url || !c.apiKey || !c.apiSecret) throw new Error('PLM connection needs url, apiKey and apiSecret');
    this.#base = c.url.replace(/\/+$/, '');
    this.#auth = `token ${c.apiKey}:${c.apiSecret}`;
    this.#timeout = c.timeoutMs ?? 30_000;
  }

  async #request<T>(method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, unknown> = {}, body?: unknown): Promise<T> {
    const url = new URL(this.#base + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const headers: Record<string, string> = { Authorization: this.#auth, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    this.requests++;
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.#timeout) });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    if (!r.ok) {
      const kind = json?.exc_type ? String(json.exc_type) : '';
      // Frappe puts the human message in _server_messages, a JSON string of JSON strings.
      let msg = '';
      try { msg = JSON.parse(json._server_messages).map((m: string) => JSON.parse(m).message).join(' | ').replace(/<[^>]+>/g, ''); } catch { /* no message */ }
      throw new PlmError(r.status, method, decodeURIComponent(url.pathname), [kind, msg].filter(Boolean).join(' - '));
    }
    return json as T;
  }

  get<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.#request<T>('GET', path, query);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.#request<T>('PUT', path, {}, body);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.#request<T>('POST', path, {}, body);
  }

  /** One request: every row of a doctype with the given fields. */
  async list<T = Record<string, any>>(doctype: string, q: ListQuery): Promise<T[]> {
    const body = await this.get<{ data: T[] }>(`/api/resource/${enc(doctype)}`, {
      fields: q.fields,
      filters: q.filters,
      order_by: q.orderBy,
      limit_page_length: q.limit ?? 0,
    });
    return body.data;
  }
}
