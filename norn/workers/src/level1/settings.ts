// Settings for the Level 1 dispatcher and publisher, from the environment. Everything has a default
// that works on a laptop next to a local SpacetimeDB.

export interface Level1Settings {
  /** The runner role and the `role` of every agent_event row these jobs write. Norn's gate lets a job post statements only up to the level its role name starts with (`level1-`). */
  role: string;
  /** The model for Level 1 sessions. */
  model: string;
  maxTurns: number;
  timeoutMs: number;
  /** Sessions started at once. */
  concurrency: number;
  /** Sessions allowed per (ECR, revision), counting failed ones. */
  maxAttempts: number;
  /** How long after a failed session before the next attempt. */
  retryDelayMs: number;
  /** A session with no event for this long, that nobody here is running, is treated as dead. */
  orphanMs: number;
  /** How often the dispatcher looks again, besides on every change. */
  pollMs: number;
  /** Lifetime of the job's MCP token. */
  tokenTtlSeconds: number;
  /** Where Norn's pages are, for the link written onto the ECR in the PLM. */
  webBaseUrl: string;
  /** Post a short comment on the ECR when a statement is written (off: comments cannot be taken back). */
  publishComment: boolean;
  /**
   * The research worker (norn/research, #148) runs next to this dispatcher: the first session for a revision waits
   * for the revision's research result. Off unless NORN_L1_WAIT_FOR_RESEARCH=1 (`npm run demo -- --research` sets it).
   */
  waitForResearch: boolean;
  /** How long after the cost run finished the wait ends anyway (research failed, out of budget, or not running). */
  researchWaitMs: number;
  /** Only these ECRs are researched (the research worker's own limit, NORN_L1_RESEARCH_ECRS); empty: all. */
  researchEcrs: string[];
}

const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Level1Settings {
  const timeoutMs = num(env.NORN_L1_TIMEOUT_MS, 240_000);
  return {
    role: 'level1-statement',
    model: env.NORN_L1_MODEL || 'claude-haiku-5-5',
    maxTurns: num(env.NORN_L1_MAX_TURNS, 12),
    timeoutMs,
    concurrency: num(env.NORN_L1_CONCURRENCY, 1),
    maxAttempts: num(env.NORN_L1_MAX_ATTEMPTS, 2),
    retryDelayMs: num(env.NORN_L1_RETRY_DELAY_MS, 60_000),
    orphanMs: num(env.NORN_L1_ORPHAN_MS, timeoutMs + 90_000),
    pollMs: num(env.NORN_L1_POLL_MS, 3_000),
    tokenTtlSeconds: num(env.NORN_L1_TOKEN_TTL_S, 900),
    webBaseUrl: (env.NORN_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, ''),
    publishComment: env.NORN_PUBLISH_COMMENT === '1',
    waitForResearch: env.NORN_L1_WAIT_FOR_RESEARCH === '1',
    researchWaitMs: num(env.NORN_L1_RESEARCH_WAIT_MS, 600_000),
    researchEcrs: (env.NORN_L1_RESEARCH_ECRS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  };
}
