// A thin adapter to the PLM's REST API, for the publisher only: read the seven impact fields of an
// ECR, write them, and add a comment. It stands in for the PLM connector (norn/connectors/plm, branch
// claude/plm-connector), which was not merged when this was written (2026-10-24). The function names
// and request shapes are the connector's: swap this file's three functions for the connector's
// `writeImpact(opts, ecr, fields)` and `postComment(opts, ecr, html)` once it is on this branch;
// `readImpact` has no connector twin and stays a plain GET of the ECR's seven fields.
//
// Request shapes are from bowman/plm/NOTES.md ("The Norn user and its permissions"): token auth as
// the Norn integration user, `PUT /api/resource/ECR/<name>` with only the impact fields, and
// `POST /api/resource/Comment`. The PLM refuses anything else from this user, and so does this file.
// It never logs headers, keys or secrets.
import { existsSync, readFileSync } from 'node:fs';
import { envFileCandidates } from '../../../mcp/src/env.ts';

/** The only ECR fields Norn may write. */
export const IMPACT_FIELDS = [
  'impact_report_level',
  'impact_recommendation',
  'impact_change_class',
  'impact_approval_route',
  'impact_norn_url',
  'impact_updated_on',
  'impact_statement',
] as const;
export type ImpactField = (typeof IMPACT_FIELDS)[number];

/** Values under the PLM's field names; null clears a field. */
export type ImpactFields = { [K in ImpactField]?: string | number | null };
/** What the PLM holds now. A field that is empty is absent. */
export type ImpactState = { [K in ImpactField]?: string };

export interface PlmConnection {
  /** Base URL of the PLM, e.g. http://127.0.0.1:8082. */
  url: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs?: number;
}

/** What the publisher needs from a PLM. Tests give it a fake. */
export interface PlmApi {
  /** The ECR's impact fields, or null when the PLM has no such ECR. */
  readImpact(ecr: string): Promise<ImpactState | null>;
  writeImpact(ecr: string, fields: ImpactFields): Promise<ImpactState>;
  postComment(ecr: string, html: string): Promise<{ name: string }>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const allowed = new Set<string>(IMPACT_FIELDS);

function stateOf(doc: Record<string, unknown>): ImpactState {
  const out: ImpactState = {};
  for (const f of IMPACT_FIELDS) {
    const v = doc[f];
    if (v !== undefined && v !== null && v !== '') out[f] = String(v);
  }
  return out;
}

export class PlmHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PlmHttpError';
  }
}

export function plmFromConnection(c: PlmConnection): PlmApi {
  const base = c.url.replace(/\/+$/, '');
  async function call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; json: any }> {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `token ${c.apiKey}:${c.apiSecret}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(c.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      let detail = '';
      try {
        const msgs: string[] = json._server_messages ? JSON.parse(json._server_messages).map((m: string) => JSON.parse(m).message) : [];
        detail = [json.exc_type, ...msgs].filter(Boolean).join(' | ');
      } catch {}
      throw new PlmHttpError(res.status, `${method} ${path} -> ${res.status} ${detail}`.slice(0, 400));
    }
    return { status: res.status, json };
  }
  const ecrPath = (ecr: string) => {
    if (!NAME.test(ecr)) throw new RangeError(`not an ECR number: ${ecr}`);
    return `/api/resource/ECR/${encodeURIComponent(ecr)}`;
  };
  return {
    async readImpact(ecr) {
      const r = await call('GET', ecrPath(ecr), undefined, [404]);
      return r.status === 404 ? null : stateOf(r.json.data ?? {});
    },
    async writeImpact(ecr, fields) {
      const body: Record<string, string | null> = {};
      const refused = Object.keys(fields).filter(k => !allowed.has(k));
      if (refused.length) throw new RangeError(`writeImpact writes only ${IMPACT_FIELDS.join(', ')}; refused: ${refused.join(', ')}`);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v === null ? null : String(v);
      if (!Object.keys(body).length) throw new RangeError('writeImpact needs at least one field');
      const r = await call('PUT', ecrPath(ecr), body);
      return stateOf(r.json.data ?? {});
    },
    async postComment(ecr, html) {
      if (!html.trim()) throw new RangeError('postComment needs some text');
      if (!NAME.test(ecr)) throw new RangeError(`not an ECR number: ${ecr}`);
      const r = await call('POST', '/api/resource/Comment', { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'ECR', reference_name: ecr, content: html });
      return { name: String(r.json.data?.name ?? '') };
    },
  };
}

/** The first `KEY=value` line for each key in the first .env that has it. Values are never printed. */
function envValues(keys: string[], env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const files = [env.ENV_FILE, ...envFileCandidates()].filter((f): f is string => !!f && existsSync(f));
  for (const k of keys) {
    out[k] = env[k]?.trim() || undefined;
    for (const f of files) {
      if (out[k]) break;
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=\\s*(.*?)\\s*$`).exec(line);
        const v = m?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
        if (v) {
          out[k] = v;
          break;
        }
      }
    }
  }
  return out;
}

/** PLM_URL, PLM_API_KEY and PLM_API_SECRET (the Norn integration user's token, never Administrator), from the environment, ENV_FILE or the main checkout's .env. */
export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): PlmConnection {
  const v = envValues(['PLM_URL', 'PLM_API_KEY', 'PLM_API_SECRET'], env);
  const missing = Object.entries(v).filter(([, x]) => !x).map(([k]) => k);
  if (missing.length) throw new Error(`missing from the environment and the .env: ${missing.join(', ')}`);
  return { url: v.PLM_URL!, apiKey: v.PLM_API_KEY!, apiSecret: v.PLM_API_SECRET! };
}

/** A user's login password for the screenshot only: PLM_USER_PASSWORD. */
export function userPasswordFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const v = envValues(['PLM_USER_PASSWORD'], env).PLM_USER_PASSWORD;
  if (!v) throw new Error('PLM_USER_PASSWORD is not in the environment or the .env');
  return v;
}
