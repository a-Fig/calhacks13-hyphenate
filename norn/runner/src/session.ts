import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedJob } from './config.ts';

// ---- Environment ----------------------------------------------------------------------------

/**
 * The only variables a session's Claude Code process receives from the runner's own environment:
 * what it needs to start, find its files and reach the network, and the two ways to log in. All
 * names are compared in upper case. Everything else is dropped, which is the point: provider keys,
 * `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, cloud credentials and parent-session variables
 * never reach a session or the subprocesses it starts.
 */
const ENV_ALLOW = new Set([
  // process basics
  'PATH', 'PATHEXT', 'OS', 'TZ', 'TERM', 'LANG', 'LANGUAGE', 'SHELL',
  // temp and home
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USER', 'LOGNAME', 'USERNAME', 'USERDOMAIN', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // Windows system locations
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PUBLIC',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432',
  'COMPUTERNAME', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'NUMBER_OF_PROCESSORS',
  // how Claude Code logs in: the config directory (the laptop's login) and the OAuth token (the server's)
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN',
  // Claude Code's own location settings
  'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_TMPDIR',
  // network: proxy and certificate settings, where a machine needs them to reach Anthropic
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);
const ENV_ALLOW_PREFIX = ['LC_'];

/** Variables the runner sets itself. They override anything inherited. */
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
  // Strip credentials (by name and by shape) from the subprocesses Claude Code starts: Bash,
  // hooks, stdio MCP servers.
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
  // Start stdio MCP servers with a safe baseline plus the `env` their own spec names, not with
  // the session's environment.
  CLAUDE_CODE_MCP_ALLOWLIST_ENV: '1',
  CLAUDE_AGENT_SDK_CLIENT_APP: 'norn-runner/0.0.1',
};

/**
 * The environment a session's Claude Code process gets: the allowlisted part of the caller's own
 * plus the runner's switches. The walk is over names, so the value of a variable that is not
 * allowed is never read.
 */
export function buildSessionEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of Object.keys(base)) {
    const name = key.toUpperCase();
    if (ENV_ALLOW.has(name) || ENV_ALLOW_PREFIX.some((p) => name.startsWith(p))) env[key] = base[key];
  }
  return { ...env, ...FORCED_ENV };
}

/** The names (never the values) of the variables a session gets, sorted. */
export function envNames(env: Record<string, string | undefined>): string[] {
  return Object.keys(env)
    .filter((k) => env[k] !== undefined)
    .sort();
}

// ---- Settings -------------------------------------------------------------------------------

type SessionSettings = Exclude<Options['settings'], string | undefined>;

/**
 * Settings handed to the session inline (the `--settings` layer, which no settings file in the
 * user's home can override).
 */
export function buildSessionSettings(): SessionSettings {
  return {
    // Other sessions on this machine can message a running `claude -p` session through its inbox
    // socket; with no value set, a dontAsk session counts as "prompting" and takes them. Refuse
    // them, and take away the tools that would send them.
    crossSessionInbound: 'refuse',
    permissions: {
      deny: ['SendMessage', 'ListAgents'],
      // Read-only commands like `cat` and the file tools run without a prompt anywhere on disk
      // unless this is set.
      blockReadsOutsideWorkingDirectories: true,
    },
    // AGENTS.md is read by a built-in plugin, from the working directory and every directory
    // above it, whatever `settingSources` says. `managed-only` leaves every AGENTS.md and
    // CLAUDE.md out.
    pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'managed-only' } } },
  };
}

// ---- Options --------------------------------------------------------------------------------

/** The built-in tools named in an allowlist (`Bash(ls *)` counts as `Bash`). */
export function builtinToolsOf(allowedTools: readonly string[]): string[] {
  const names = allowedTools.filter((t) => !t.startsWith('mcp__')).map((t) => t.split('(')[0]!.trim());
  return [...new Set(names)];
}

export interface SessionContext {
  cwd: string;
  abortController: AbortController;
  env: Record<string, string | undefined>;
  hooks?: Options['hooks'];
  spawnClaudeCodeProcess?: Options['spawnClaudeCodeProcess'];
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
    settings: buildSessionSettings(),

    // Tools: built-ins not on the list are not in the model's context at all. Allowed MCP tools
    // are pre-approved. Anything else that reaches the permission check is denied, never asked.
    tools: builtinToolsOf(job.allowedTools),
    allowedTools: job.allowedTools,
    disallowedTools: ['SendMessage', 'ListAgents'],
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',

    // Nothing is written under ~/.claude: Norn's action log is the record of a session.
    persistSession: false,
  };
  if (job.mcpServers && Object.keys(job.mcpServers).length > 0) options.mcpServers = job.mcpServers;
  if (job.systemPrompt) options.systemPrompt = job.systemPrompt;
  if (job.effort) options.effort = job.effort;
  if (ctx.hooks) options.hooks = ctx.hooks;
  if (ctx.spawnClaudeCodeProcess) options.spawnClaudeCodeProcess = ctx.spawnClaudeCodeProcess;
  return options;
}
