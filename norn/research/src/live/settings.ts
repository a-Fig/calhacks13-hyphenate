// What the research worker is told by its environment, and what it needs before it may start.
// Pure: the caller passes the environment and the file-system probe, so tests run without either.
//
// Every variable is read by name. Values of secrets (the Bright Data token, a Claude token) are
// never returned in a message: the messages below name the variable and nothing else.

import { DEFAULT_TOKEN_ENV } from '../job.ts';

export interface Settings {
  /** Most research jobs started per rolling hour, across restarts (counted from the stored job_started events). */
  maxPerHour: number;
  /** Per-run budget: model turns. A turn is about one web search or one page read, so this is also the tool budget. */
  maxTurns: number;
  /** Per-run budget: wall-clock milliseconds. */
  timeoutMs: number;
  /** How many questions one run asks (the targets with the most swing on the year-one total). */
  targets: number;
  /** A revision whose runs failed is tried again until it has had this many. */
  maxAttempts: number;
  /** Wait this long after a failed attempt before the next one. */
  retryDelayMs: number;
  /** How often to look for work when nothing in the database has changed. */
  pollMs: number;
  model?: string;
  /** Only these ECR numbers (NORN_RESEARCH_ECRS, comma separated). Empty: every open ECR. */
  ecrs: string[];
}

export const DEFAULTS = {
  maxPerHour: 4,
  maxTurns: 16,
  timeoutMs: 5 * 60_000,
  targets: 3,
  maxAttempts: 2,
  retryDelayMs: 2 * 60_000,
  pollMs: 30_000,
} as const;

export class SettingsError extends Error {}

type Env = Record<string, string | undefined>;

function whole(env: Env, name: string, dflt: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new SettingsError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function settingsFromEnv(env: Env = process.env): Settings {
  const model = env.NORN_RESEARCH_MODEL?.trim();
  return {
    maxPerHour: whole(env, 'NORN_RESEARCH_MAX_PER_HOUR', DEFAULTS.maxPerHour, 1, 60),
    maxTurns: whole(env, 'NORN_RESEARCH_MAX_TURNS', DEFAULTS.maxTurns, 2, 60),
    timeoutMs: whole(env, 'NORN_RESEARCH_TIMEOUT_MS', DEFAULTS.timeoutMs, 30_000, 30 * 60_000),
    targets: whole(env, 'NORN_RESEARCH_TARGETS', DEFAULTS.targets, 1, 5),
    maxAttempts: whole(env, 'NORN_RESEARCH_MAX_ATTEMPTS', DEFAULTS.maxAttempts, 1, 5),
    retryDelayMs: whole(env, 'NORN_RESEARCH_RETRY_DELAY_MS', DEFAULTS.retryDelayMs, 0, 3_600_000),
    pollMs: whole(env, 'NORN_RESEARCH_POLL_MS', DEFAULTS.pollMs, 1_000, 3_600_000),
    ...(model ? { model } : {}),
    ecrs: (env.NORN_RESEARCH_ECRS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export interface Probe {
  /** Whether a file exists. */
  exists: (path: string) => boolean;
  /** The user's home directory. */
  home: string;
  platform: string;
}

/**
 * What a live run cannot start without, as messages that name the missing piece. Empty: nothing is
 * missing. A Claude login is the OAuth token variable or the login file in Claude Code's config
 * directory. On macOS the login lives in the keychain, which this cannot look in: a login that is
 * not there then shows up as an `auth` failure of the first job, which stops the worker.
 */
export function missingForLive(env: Env, probe: Probe, tokenFound: boolean): string[] {
  const missing: string[] = [];
  if (!tokenFound) missing.push(`${DEFAULT_TOKEN_ENV} is not set (in the environment or the .env file): the research agent needs a Bright Data API token`);
  const hasOauth = !!env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || `${probe.home.replace(/[\\/]$/, '')}/.claude`;
  const hasLoginFile = probe.exists(`${dir}/.credentials.json`) || probe.exists(`${dir}\\.credentials.json`);
  if (!hasOauth && !hasLoginFile && probe.platform !== 'darwin') {
    missing.push(`no Claude login: CLAUDE_CODE_OAUTH_TOKEN is not set and ${dir} has no login (run \`claude\` and /login once on this machine)`);
  }
  return missing;
}
