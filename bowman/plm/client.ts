// Minimal REST client for Bowman's PLM (a Frappe site), shared by setup.ts, seed.ts and verify.ts.
// Node 24 runs this file directly (TypeScript with erasable syntax only). No dependencies.
// Never logs headers, passwords, keys or secrets.
import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = process.env.ENV_FILE ?? resolve(here, '../../.env');

export function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

let backedUp = false;
/** Set KEY=value in .env, keeping every other line. Backs the file up once per run (`.env.*` is gitignored). */
export function setEnv(key: string, value: string): void {
  let lines: string[] = [];
  if (existsSync(ENV_FILE)) {
    if (!backedUp) {
      copyFileSync(ENV_FILE, `${ENV_FILE}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
      backedUp = true;
    }
    lines = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => l !== '');
  }
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n') + '\n');
  try { chmodSync(ENV_FILE, 0o600); } catch { /* not supported on this filesystem */ }
}

export class PlmError extends Error {
  status: number;
  constructor(status: number, method: string, path: string, body: any) {
    let detail = '';
    try {
      const msgs: string[] = body._server_messages ? JSON.parse(body._server_messages).map((m: string) => JSON.parse(m).message) : [];
      detail = [body.exc_type, ...msgs].filter(Boolean).join(' | ');
      if (!detail && body.exception) detail = String(body.exception);
    } catch { /* keep the status only */ }
    super(`${method} ${path} -> ${status} ${detail}`.slice(0, 700));
    this.status = status;
    Object.defineProperty(this, 'body', { value: body, enumerable: false }); // keeps response bodies out of crash dumps
  }
}

export interface Res { status: number; body: any }

export class Plm {
  base: string;
  token?: string;
  cookie = '';
  csrf = '';
  /** auth: {token: 'key:secret'} or {} and then call login(). */
  constructor(baseUrl: string, auth: { token?: string } = {}) {
    this.base = baseUrl.replace(/\/$/, '');
    this.token = auth.token;
  }

  async login(user: string, password: string): Promise<void> {
    const r = await fetch(`${this.base}/api/method/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usr: user, pwd: password }),
    });
    if (!r.ok) throw new Error(`login failed for ${user}: ${r.status}`);
    this.cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    // Cookie-authenticated writes need the CSRF token that the desk page embeds.
    const html = await (await fetch(`${this.base}/desk`, { headers: { Cookie: this.cookie } })).text();
    this.csrf = html.match(/csrf_token\s*=\s*"([^"]+)"/)?.[1] ?? '';
  }

  /** Returns {status, body}. Throws PlmError on a non-2xx status unless allow is true. */
  async req(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown; allow?: boolean; form?: FormData } = {}): Promise<Res> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `token ${this.token}`;
    else {
      headers.Cookie = this.cookie;
      if (this.csrf) headers['X-Frappe-CSRF-Token'] = this.csrf;
    }
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, { method, headers, body });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (!r.ok && !opts.allow) throw new PlmError(r.status, method, path, json);
    return { status: r.status, body: json };
  }

  get = (path: string, query?: Record<string, unknown>, o: { allow?: boolean } = {}) => this.req('GET', path, { query, ...o });
  post = (path: string, body?: unknown, o: { allow?: boolean } = {}) => this.req('POST', path, { body, ...o });
  put = (path: string, body?: unknown, o: { allow?: boolean } = {}) => this.req('PUT', path, { body, ...o });
  del = (path: string, o: { allow?: boolean } = {}) => this.req('DELETE', path, o);

  async exists(doctype: string, name: string): Promise<boolean> {
    return (await this.get(`/api/resource/${enc(doctype)}/${enc(name)}`, undefined, { allow: true })).status === 200;
  }

  /** Create the document if absent, otherwise update it with `doc` (idempotent). Returns 'created' | 'updated'. */
  async upsert(doctype: string, name: string, doc: Record<string, unknown>): Promise<'created' | 'updated'> {
    if (await this.exists(doctype, name)) {
      await this.put(`/api/resource/${enc(doctype)}/${enc(name)}`, doc);
      return 'updated';
    }
    await this.post(`/api/resource/${enc(doctype)}`, { doctype, name, ...doc });
    return 'created';
  }

  /** Run a whitelisted method with a JSON body, return its `message`. */
  async call(method: string, args: Record<string, unknown> = {}): Promise<any> {
    return (await this.post(`/api/method/${method}`, args)).body.message;
  }

  /** All rows of a list query (no paging cap). */
  async list(doctype: string, query: { fields?: string[]; filters?: unknown[]; order_by?: string } = {}): Promise<any[]> {
    return (await this.get(`/api/resource/${enc(doctype)}`, { limit_page_length: 0, ...query })).body.data;
  }
}

export const enc = encodeURIComponent;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
