// Minimal ERPNext REST client shared by bootstrap.mjs and verify.mjs. Node 20+, no dependencies.
// Never logs headers, passwords, keys or secrets.
import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = process.env.ENV_FILE ?? resolve(here, "../../.env");

export function readEnv() {
  const out = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

let backedUp = false;
/** Set KEY=value in .env, keeping every other line. Backs the file up once per run (.env.* is gitignored). */
export function setEnv(key, value) {
  let lines = [];
  if (existsSync(ENV_FILE)) {
    if (!backedUp) {
      copyFileSync(ENV_FILE, `${ENV_FILE}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
      backedUp = true;
    }
    lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/).filter((l) => l !== "");
  }
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  try { chmodSync(ENV_FILE, 0o600); } catch {}
}

export class ErpError extends Error {
  constructor(status, method, path, body) {
    let detail = "";
    try {
      const msgs = body._server_messages ? JSON.parse(body._server_messages).map((m) => JSON.parse(m).message) : [];
      detail = [body.exc_type, ...msgs].filter(Boolean).join(" | ");
    } catch {}
    super(`${method} ${path} -> ${status} ${detail}`.slice(0, 600));
    this.status = status;
    Object.defineProperty(this, "body", { value: body, enumerable: false }); // keeps response bodies out of crash dumps
  }
}

export class Erp {
  /** auth: {token: "key:secret"} or {session: true} (call login() with a password). */
  constructor(baseUrl, auth = {}) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = auth.token;
    this.cookie = "";
    this.csrf = "";
  }

  async login(user, password) {
    const r = await fetch(`${this.base}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: user, pwd: password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status}`);
    this.cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    // Cookie-authenticated POST/PUT/DELETE need the CSRF token that the desk page embeds.
    const html = await (await fetch(`${this.base}/app`, { headers: { Cookie: this.cookie } })).text();
    this.csrf = html.match(/csrf_token\s*=\s*"([^"]+)"/)?.[1] ?? "";
  }

  /** Returns {status, body}. Throws ErpError on non-2xx unless allow is true. */
  async req(method, path, { query, body, allow = false } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const headers = { Accept: "application/json" };
    if (this.token) headers.Authorization = `token ${this.token}`;
    else {
      headers.Cookie = this.cookie;
      if (this.csrf) headers["X-Frappe-CSRF-Token"] = this.csrf;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (!r.ok && !allow) throw new ErpError(r.status, method, path, json);
    return { status: r.status, body: json };
  }

  get = (path, query, o) => this.req("GET", path, { query, ...o });
  post = (path, body, o) => this.req("POST", path, { body, ...o });
  put = (path, body, o) => this.req("PUT", path, { body, ...o });
  del = (path, o) => this.req("DELETE", path, o);
}

export const enc = encodeURIComponent;
