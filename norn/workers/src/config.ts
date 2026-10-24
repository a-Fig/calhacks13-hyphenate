// The company configuration at start-up (#59). The worker calls loadStartupConfig() first, before it
// connects to anything: NORN_COMPANY_CONFIG names the file, and a malformed one stops Norn with the
// validator's problem list and nothing changed. Once connected, applyStartupConfig() stores the config
// through the module's set_config, but only the pairs that differ from what is stored.
//
//   NORN_COMPANY_CONFIG=<file>   a module that default-exports the configuration, or a .json file.
//                                A relative path is relative to where the worker is started
//                                (norn/workers for `npm run worker`).
//
// Unset (or blank): the worker warns and keeps the config already stored, if any. It does not refuse,
// so a database that was set up before this existed keeps running. Set but unusable (missing file,
// malformed, a config the validator rejects): the worker refuses to start.
import { resolve } from 'node:path';
import {
  COMPANY_CONFIG_KEY,
  configEntries,
  configHash,
  formatIssue,
  loadConfigFile,
  type CompanyConfig,
  type ConfigEntry,
  type Issue,
} from '../../config/src/index.ts';
import { withRetry, type Client } from './connect.ts';

export const COMPANY_CONFIG_ENV = 'NORN_COMPANY_CONFIG';

export type StartupConfig =
  | { kind: 'unset' }
  | { kind: 'loaded'; file: string; config: CompanyConfig; entries: ConfigEntry[]; hash: string; bytes: number }
  | { kind: 'invalid'; file: string; issues: Issue[] };

export async function loadStartupConfig(env: Record<string, string | undefined> = process.env): Promise<StartupConfig> {
  const given = env[COMPANY_CONFIG_ENV]?.trim();
  if (!given) return { kind: 'unset' };
  const file = resolve(given); // absolute, so a "no such file" message says where it looked
  const result = await loadConfigFile(file);
  if (!result.ok) return { kind: 'invalid', file, issues: result.issues };
  const entries = configEntries(result.config);
  const text = entries.find((e) => e.key === COMPANY_CONFIG_KEY)!.value;
  return { kind: 'loaded', file, config: result.config, entries, hash: configHash(text), bytes: Buffer.byteLength(text) };
}

/** What the worker prints, one line each, when it refuses to start. */
export function refusalLines(c: Extract<StartupConfig, { kind: 'invalid' }>): string[] {
  const n = c.issues.length;
  return [
    `${COMPANY_CONFIG_ENV}=${c.file}: ${n} ${n === 1 ? 'problem' : 'problems'}`,
    ...c.issues.map((i) => `  ${formatIssue(i)}`),
    'Norn did not start: fix the file, or unset the variable to keep the stored configuration.',
  ];
}

/** The pairs whose value differs from what is stored. `stored` gives the stored text for a key. */
export function changedEntries(entries: ConfigEntry[], stored: (key: string) => string | undefined): ConfigEntry[] {
  return entries.filter((e) => stored(e.key) !== e.value);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Stores what differs, or warns when there is no config file. Needs the connection to have
 * subscribed to norn_config. Throws if the module refuses a pair; the worker then does not start,
 * because the configuration it was told to run on is not the one stored.
 */
export async function applyStartupConfig(
  client: Client,
  startup: Exclude<StartupConfig, { kind: 'invalid' }>,
  log: (msg: string) => void
): Promise<{ stored: string[] }> {
  const rows = client.conn.db.nornConfig;
  const stored = (key: string) => rows.key.find(key)?.value;

  if (startup.kind === 'unset') {
    const text = stored(COMPANY_CONFIG_KEY);
    log(
      text === undefined
        ? `WARNING: ${COMPANY_CONFIG_ENV} is not set and no company config is stored; Norn runs on the module's built-in defaults`
        : `WARNING: ${COMPANY_CONFIG_ENV} is not set; keeping the stored company config (${configHash(text)}, ${kb(Buffer.byteLength(text))})`
    );
    return { stored: [] };
  }

  const todo = changedEntries(startup.entries, stored);
  const before = new Map(todo.map((e) => [e.key, stored(e.key)])); // the cache may catch up with our own writes
  for (const e of todo) {
    try {
      await withRetry(() => client.R.setConfig({ key: e.key, value: e.value }), { idempotent: true, label: `set_config ${e.key}` });
    } catch (err) {
      throw new Error(`the module refused ${e.key} from ${startup.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const what = `company config ${startup.config.company.name} (${startup.hash}, ${kb(startup.bytes)}) from ${startup.file}`;
  if (todo.length === 0) log(`${what}: already stored, nothing to change`);
  else {
    const changes = todo.map((e) => {
      const old = before.get(e.key);
      if (e.key === COMPANY_CONFIG_KEY) return `${e.key} ${old === undefined ? 'none' : configHash(old)} -> ${startup.hash}`;
      return `${e.key} ${old ?? 'unset'} -> ${e.value}`;
    });
    log(`${what}: stored ${changes.join(', ')}`);
  }
  return { stored: todo.map((e) => e.key) };
}
