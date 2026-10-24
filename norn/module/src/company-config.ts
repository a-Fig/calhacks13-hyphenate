// What the module checks when a company configuration is stored under the key `company_config`
// (set_config in reducers.ts), and how the action log names the change.
//
// The value is the whole validated configuration as canonical JSON, about 20 KB for Bowman's. The
// log row names it by fingerprint and size and lists the top-level sections that changed. It never
// holds the old or the new text: the text is in the norn_config table.
//
// The module checks what it can without knowing the schema: the size, that the text is JSON, that
// it is an object with a `schemaVersion`, and that it is in canonical form, so two equal
// configurations are the same text and "has it changed" is a string comparison. The schema and the
// rules between fields (@norn/config's validator) are left to the loader, which runs before the
// worker sends anything. The module cannot import the validator: its TypeScript settings and its
// runtime differ from the config package's. So a caller that skips the loader can store a config
// that passes these checks and fails the schema. Whoever reads the config must not assume it was
// validated here.
//
// This file imports nothing from SpacetimeDB so that it can be tested in plain Node.
import { COMPANY_CONFIG_KEY, canonicalJson, configHash } from '../../config/src/stored';

export { COMPANY_CONFIG_KEY };

/** The largest company_config the module takes, in UTF-8 bytes. Bowman's is about 20 KB. */
export const COMPANY_CONFIG_MAX_BYTES = 262_144;

/** Names listed in a summary before it says "and N more". */
const MAX_NAMES = 8;
/** Names kept in the log row's detail, which is bounded too. */
const MAX_LISTED = 50;

export type CompanyConfigCheck =
  | { ok: false; error: string }
  | { ok: true; unchanged: true }
  | { ok: true; unchanged: false; summary: string; detail: CompanyConfigChange };

export interface CompanyConfigChange {
  key: typeof COMPANY_CONFIG_KEY;
  from: { hash: string; bytes: number } | null;
  to: { hash: string; bytes: number };
  /** Top-level sections whose content differs, were added, or were removed. */
  changed: string[];
  added: string[];
  removed: string[];
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

function names(list: string[]): string {
  const shown = list.slice(0, MAX_NAMES).map((n) => clip(n, 40));
  return list.length > MAX_NAMES ? `${shown.join(', ')} and ${list.length - MAX_NAMES} more` : shown.join(', ');
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks a value offered for `company_config` and, when it differs from what is `stored`, says how
 * for the action log. `stored` is the text now in the table, or undefined when there is none.
 */
export function checkCompanyConfig(value: string, stored: string | undefined): CompanyConfigCheck {
  const fail = (error: string): CompanyConfigCheck => ({ ok: false, error: `${COMPANY_CONFIG_KEY}: ${error}` });
  if (value.trim() === '') return fail('is empty; send the configuration as canonical JSON');
  const bytes = utf8Length(value);
  if (bytes > COMPANY_CONFIG_MAX_BYTES) return fail(`is ${kb(bytes)}, over the limit of ${kb(COMPANY_CONFIG_MAX_BYTES)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    return fail(`is not valid JSON (${clip(e instanceof Error ? e.message : String(e), 120)})`);
  }
  if (!isRecord(parsed)) return fail('must be a JSON object holding the whole configuration');
  const version = parsed.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return fail('has no schemaVersion (a whole number from 1); send what the config loader produced');
  if (canonicalJson(parsed) !== value)
    return fail('must be canonical JSON (keys sorted, no whitespace), as the config loader writes it');

  if (stored === value) return { ok: true, unchanged: true };

  const to = { hash: configHash(value), bytes };
  const previous = stored === undefined ? undefined : parseObject(stored);
  const from = stored === undefined ? null : { hash: configHash(stored), bytes: utf8Length(stored) };
  const sections = Object.keys(parsed).sort();

  if (!previous) {
    const detail: CompanyConfigChange = { key: COMPANY_CONFIG_KEY, from, to, changed: [], added: sections.slice(0, MAX_LISTED), removed: [] };
    const was = from ? `${from.hash} (not readable as a configuration)` : 'none';
    return { ok: true, unchanged: false, summary: `${COMPANY_CONFIG_KEY}: ${was} -> ${to.hash} (${kb(bytes)}); ${sections.length} sections: ${names(sections)}`, detail };
  }

  const before = Object.keys(previous);
  const changed = sections.filter((k) => k in previous && canonicalJson(previous[k]) !== canonicalJson(parsed[k]));
  const added = sections.filter((k) => !(k in previous));
  const removed = before.filter((k) => !(k in parsed)).sort();
  const parts = [changed.length ? `changed: ${names(changed)}` : '', added.length ? `added: ${names(added)}` : '', removed.length ? `removed: ${names(removed)}` : ''].filter(Boolean);
  const detail: CompanyConfigChange = { key: COMPANY_CONFIG_KEY, from, to, changed: changed.slice(0, MAX_LISTED), added: added.slice(0, MAX_LISTED), removed: removed.slice(0, MAX_LISTED) };
  return {
    ok: true,
    unchanged: false,
    summary: `${COMPANY_CONFIG_KEY}: ${from!.hash} -> ${to.hash} (${kb(from!.bytes)} -> ${kb(bytes)}); ${parts.length ? parts.join('; ') : 'formatting only'}`,
    detail,
  };
}
