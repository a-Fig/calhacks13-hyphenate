// Connection settings from the environment, for scripts and the worker. Reads ENV_FILE (default: the .env at
// the repository root) without overriding variables that are already set. Never prints a value.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlmConnection } from './options.ts';

export function loadEnvFile(file = process.env.ENV_FILE ?? resolve(import.meta.dirname, '../../../../.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/** PLM_URL, PLM_API_KEY and PLM_API_SECRET: the integration user's token, never Administrator. */
export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): PlmConnection {
  const { PLM_URL: url, PLM_API_KEY: apiKey, PLM_API_SECRET: apiSecret } = env;
  const missing = [['PLM_URL', url], ['PLM_API_KEY', apiKey], ['PLM_API_SECRET', apiSecret]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing in the environment: ${missing.join(', ')}`);
  return { url: url!, apiKey: apiKey!, apiSecret: apiSecret! };
}

/** PLM_WEBHOOK_SECRET: the key the PLM signs its webhook bodies with. */
export function webhookSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.PLM_WEBHOOK_SECRET) throw new Error('missing in the environment: PLM_WEBHOOK_SECRET');
  return env.PLM_WEBHOOK_SECRET;
}
