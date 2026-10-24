// What the publisher (and the PLM ingest source) need from the PLM, over Norn's PLM connector
// (norn/connectors/plm): `readChangeRequest` for what the ECR holds now, `writeImpact` for the seven
// impact fields, `postComment` for a comment. `PlmApi` is the narrow interface the publisher is
// written against, so its tests give it a fake instead of a PLM.
//
// Credentials: PLM_URL, PLM_API_KEY, PLM_API_SECRET (the Norn integration user, never Administrator),
// from the environment, ENV_FILE, or the main checkout's .env (a git worktree has none of its own).
// Nothing here prints them.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envFileCandidates } from '../../../mcp/src/env.ts';
import { IMPACT_FIELDS, connectionFromEnv, loadEnvFile, postComment, readChangeRequest, writeImpact } from '../../../connectors/plm/src/index.ts';
import type { ImpactField, ImpactState, PlmOptions, PlmSettings } from '../../../connectors/plm/src/index.ts';

export { IMPACT_FIELDS };
export type { ImpactField, ImpactState, PlmOptions };
/** Values for the seven impact fields under the PLM's names; null clears a field. */
export type ImpactFields = { [K in ImpactField]?: string | number | null };

/** What the publisher needs from a PLM. */
export interface PlmApi {
  /** The ECR's impact fields as the PLM holds them, or null when the PLM has no such ECR. */
  readImpact(ecr: string): Promise<ImpactState | null>;
  writeImpact(ecr: string, fields: ImpactFields): Promise<ImpactState>;
  postComment(ecr: string, html: string): Promise<{ name: string }>;
}

export function plmFromConnector(opts: PlmOptions): PlmApi {
  return {
    async readImpact(ecr) {
      try {
        return (await readChangeRequest(opts, ecr)).record.impact;
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    writeImpact: async (ecr, fields) => (await writeImpact(opts, ecr, fields)).impact,
    postComment: (ecr, html) => postComment(opts, ecr, html),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..', '..', '..');

/** Read the .env that has the PLM keys into the environment (without overriding what is set). */
export function loadPlmEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const f of [env.ENV_FILE, ...envFileCandidates()]) {
    if (f && existsSync(f)) {
      loadEnvFile(f);
      if (env.PLM_API_KEY) return;
    }
  }
}

/**
 * The connector's options: Bowman's PLM spellings (NORN_PLM_SETTINGS, a module exporting `plm`;
 * default bowman/norn-config/plm.ts) and the connection from the environment.
 */
export async function plmOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PlmOptions> {
  loadPlmEnv(env);
  const file = resolve(env.NORN_PLM_SETTINGS || resolve(REPO, 'bowman', 'norn-config', 'plm.ts'));
  const mod = await import(pathToFileURL(file).href);
  const settings = (mod.plm ?? mod.default) as PlmSettings | undefined;
  if (!settings?.nornUser) throw new Error(`${file} exports no PLM settings (expected \`plm\`)`);
  return { ...settings, ...connectionFromEnv(env) };
}

/** A user's login password, for the screenshot only: PLM_USER_PASSWORD. */
export function userPasswordFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  loadPlmEnv(env);
  const v = env.PLM_USER_PASSWORD;
  if (!v) throw new Error('PLM_USER_PASSWORD is not in the environment or the .env');
  return v;
}
