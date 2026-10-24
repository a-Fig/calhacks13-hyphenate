// A small read-only ERPNext REST client: token auth, list reads in one request each.
// Never logs or throws headers, keys or secrets.

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

  async get<T>(path: string, query: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(this.#base + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    this.requests++;
    const r = await fetch(url, { headers: { Authorization: this.#auth, Accept: 'application/json' }, signal: AbortSignal.timeout(this.#timeout) });
    const text = await r.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (!r.ok) {
      const kind = body?.exc_type ? String(body.exc_type) : '';
      // Frappe puts the human message in _server_messages, a JSON string of JSON strings.
      let msg = '';
      try { msg = JSON.parse(body._server_messages).map((m: string) => JSON.parse(m).message).join(' | ').replace(/<[^>]+>/g, ''); } catch { /* no message */ }
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
