import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedJob } from './config.ts';

/**
 * Credentials that would override the subscription login. Norn runs on the subscription and no
 * Anthropic API key exists, so these never reach a session. They are dropped by name; their
 * values are never read.
 */
const DROPPED_ENV = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);

/**
 * Variables a Claude Code session exports to its children: its id, its cross-session messaging
 * socket and token, its entrypoint. When the runner is launched from inside a Claude Code session
 * (a developer's terminal in T3 Code, say), passing them on would tie each agent to that session.
 * `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR` are not on this list: they are how the agents
 * log in.
 */
const PARENT_SESSION_ENV =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(MESSAGING_\w+|SESSION_\w+|CHILD_SESSION|ENTRYPOINT|EXECPATH))$/i;

/** Variables that keep the user's personal Claude setup out of a session. */
const FORCED_ENV: Record<string, string> = {
  // `~/.claude/projects/<project>/memory/` is loaded into the system prompt whatever
  // `settingSources` says.
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  // No CLAUDE.md of any kind (user, project, auto memory).
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  // claude.ai connectors (Gmail, Drive, ...) load whenever the session uses a claude.ai login,
  // which is the laptop's login. `strictMcpConfig` covers them too; this is the second lock.
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  // The CLI's own bundled skills (deep-research, loop, ...). Not personal, but with no Skill tool
  // they would only be noise.
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
  CLAUDE_AGENT_SDK_CLIENT_APP: 'norn-runner/0.0.1',
};

/**
 * The environment a session's Claude Code process gets: the caller's own, minus API-key
 * variables and any parent Claude Code session's, plus the isolation switches. `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR`
 * pass through untouched, which is how the home server and the laptop each authenticate.
 */
export function buildSessionEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) {
    if (!DROPPED_ENV.has(key.toUpperCase()) && !PARENT_SESSION_ENV.test(key)) env[key] = value;
  }
  return { ...env, ...FORCED_ENV };
}

/** The built-in tools named in an allowlist (`Bash(ls *)` counts as `Bash`). */
export function builtinToolsOf(allowedTools: readonly string[]): string[] {
  const names = allowedTools.filter((t) => !t.startsWith('mcp__')).map((t) => t.split('(')[0]!.trim());
  return [...new Set(names)];
}

export interface SessionContext {
  cwd: string;
  abortController: AbortController;
  env: Record<string, string | undefined>;
  stderr?: (data: string) => void;
}

/**
 * The Agent SDK options for one job. Each line is an isolation or permission decision; see
 * NOTES.md for why.
 */
export function buildSdkOptions(job: ResolvedJob, ctx: SessionContext): Options {
  const options: Options = {
    cwd: ctx.cwd,
    abortController: ctx.abortController,
    env: ctx.env,
    model: job.model,
    maxTurns: job.maxTurns,

    // Personal configuration: none of user, project or local settings, skills, plugins, or
    // claude.ai connectors. Only what the job spec names is attached.
    settingSources: [],
    skills: [],
    plugins: [],
    strictMcpConfig: true,

    // Tools: built-ins not on the list are not in the model's context at all. Allowed MCP tools
    // are pre-approved. Anything else that reaches the permission check is denied, never asked.
    tools: builtinToolsOf(job.allowedTools),
    allowedTools: job.allowedTools,
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',

    // Nothing is written under ~/.claude: Norn's action log is the record of a session.
    persistSession: false,
  };
  if (job.mcpServers && Object.keys(job.mcpServers).length > 0) options.mcpServers = job.mcpServers;
  if (job.systemPrompt) options.systemPrompt = job.systemPrompt;
  if (job.effort) options.effort = job.effort;
  if (ctx.stderr) options.stderr = ctx.stderr;
  return options;
}
