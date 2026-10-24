// A small ERPNext REST client: token auth, list reads in one request each, and the POST and PUT the
// ECO write-back (write.ts) uses. Never logs or throws headers, keys or secrets.

import type { ErpnextConnection } from './options.ts';

export class ErpnextError extends Error {
  status: number;
  constructor(status: number, path: string, detail: string) {
    super(`ERPNext ${status} on ${path}${detail ? `: ${detail}` : ''}`.slice(0, 600));
    this.name = 'ErpnextError';
    this.status = status;
  }
}

type Filter = [field: string, op: string, value: unknown] | [doctype: string, field: string, op: string, value: unknown];

export interface ListQuery {
  fields: string[];
  filters?: Filter[];
  /** Child doctypes (BOM Item, Item Default, ...) must name their parent doctype. */
  parent?: string;
  orderBy?: string;
  /** Default 0: all rows. */
  limit?: number;
}

export class ErpnextClient {
  requests = 0;
  #base: string;
  #auth: string;
  #timeout: number;

  constructor(c: ErpnextConnection) {
    if (!c.url || !c.apiKey || !c.apiSecret) throw new Error('ERPNext connection needs url, apiKey and apiSecret');
    this.#base = c.url.replace(/\/+$/, '');
    this.#auth = `token ${c.apiKey}:${c.apiSecret}`;
    this.#timeout = c.timeoutMs ?? 30_000;
  }

  get<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('GET', path, query);
  }

  /** Creates or calls a method. `body` is JSON. */
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, {}, body);
  }

  /** Updates a document with the fields in `body`. */
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, {}, body);
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, unknown> = {}, payload?: unknown): Promise<T> {
    const url = new URL(this.#base + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    this.requests++;
    const headers: Record<string, string> = { Authorization: this.#auth, Accept: 'application/json' };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(this.#timeout) });
    const text = await r.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (!r.ok) {
      const kind = body?.exc_type ? String(body.exc_type) : '';
      // Frappe puts the human message in _server_messages, a JSON string of JSON strings.
      let msg = '';
      try { msg = JSON.parse(body._server_messages).map((m: string) => JSON.parse(m).message).join(' | ').replace(/<[^>]+>/g, ''); } catch { /* no message */ }
      if (!msg && typeof body?.exception === 'string') msg = body.exception.split(': ').slice(1).join(': ');
      throw new ErpnextError(r.status, decodeURIComponent(url.pathname), [kind, msg].filter(Boolean).join(' - '));
    }
    return body as T;
  }

  /** One request: every row of a doctype with the given fields. */
  async list<T = Record<string, any>>(doctype: string, q: ListQuery): Promise<T[]> {
    const body = await this.get<{ data: T[] }>(`/api/resource/${encodeURIComponent(doctype)}`, {
      fields: q.fields,
      filters: q.filters,
      parent: q.parent,
      order_by: q.orderBy,
      limit_page_length: q.limit ?? 0,
    });
    return body.data;
  }
}
