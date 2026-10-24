// Finding the signing key without ever printing it. The key is NORN_MCP_SIGNING_KEY: in the
// process environment, or in the untracked root `.env` of the main checkout. A git worktree has no
// `.env` of its own, so the main checkout is found through `git rev-parse --git-common-dir`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KEY_NAME = 'NORN_MCP_SIGNING_KEY';

const here = dirname(fileURLToPath(import.meta.url));
/** The checkout this file is in (norn/mcp/src -> repo root). */
export const repoRoot = resolve(here, '..', '..', '..');

function mainCheckout(): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return common ? dirname(common) : undefined;
  } catch {
    return undefined;
  }
}

/** The `.env` files to look in, most specific first. The main checkout's is the one that exists in a worktree. */
export function envFileCandidates(): string[] {
  const files = [process.env.NORN_ENV_FILE, join(repoRoot, '.env'), (() => { const m = mainCheckout(); return m ? join(m, '.env') : undefined; })()];
  return [...new Set(files.filter((f): f is string => !!f))];
}

/** The value of one KEY=value line in a dotenv file, or undefined. Quotes are stripped; nothing else is parsed. */
export function readEnvValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*?)\\s*$`).exec(line);
    if (!m) continue;
    const v = m[1]!.replace(/^(['"])(.*)\1$/, '$2');
    if (v) return v;
  }
  return undefined;
}

/** The signing key from the environment or a `.env` file, or undefined. The caller must never print it. */
export function loadSigningKey(): string | undefined {
  const fromEnv = process.env[KEY_NAME]?.trim();
  if (fromEnv) return fromEnv;
  for (const f of envFileCandidates()) {
    const v = readEnvValue(f, KEY_NAME);
    if (v) return v;
  }
  return undefined;
}
