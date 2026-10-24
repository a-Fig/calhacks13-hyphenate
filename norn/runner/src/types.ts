import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/** Who is acting. Every event and every result carries this. */
export interface Identity {
  /** The actor, e.g. `agent:norn/level1/ECR-0417`. */
  actor: string;
  /** The person this job acts for (a person id), or null when Norn acts on its own. */
  onBehalfOf: string | null;
  /** What started the job: `norn` for the platform, or the id of the parent job. */
  spawnedBy: string;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** One unit of agent work, run as one Claude Code session. */
export interface JobSpec {
  /** Unique among jobs running at the same time. Used in log file names and the work directory. */
  id: string;
  /** What the agent is for: `level1-writeup`, `researcher`, `adversarial-reviewer`, `blind-checker`, `post-check`. */
  role: string;
  /** The task, sent as the first user message. */
  prompt: string;
  /** Role instructions. Replaces the SDK's minimal default system prompt when set. */
  systemPrompt?: string;
  /** Model id. Default: `RunnerConfig.roleModels[role]`, then `RunnerConfig.defaultModel`. */
  model?: string;
  effort?: EffortLevel;
  /** Hard cap on agent turns. Default: `RunnerConfig.defaultMaxTurns`. */
  maxTurns?: number;
  /** Wall-clock limit for the whole session. Default: `RunnerConfig.defaultTimeoutMs`. */
  timeoutMs?: number;
  /**
   * MCP servers to attach, keyed by server name. A tool is `mcp__<name>__<tool>`. Stdio, http and
   * sse servers can come from a JSON job file; in-process servers (`createSdkMcpServer`) only
   * from code.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Whether the session may carry on when the subscription's included usage is used up and the
   * account has paid overage switched on. Default false: the runner stops the job instead of
   * spending money.
   */
  allowOverage?: boolean;
  /**
   * Exactly the tools this role may use; everything else is denied without asking. Built-ins by
   * name (`WebSearch`, `WebFetch`, `Read`), MCP tools as `mcp__<server>__<tool>` or
   * `mcp__<server>__*`. A bare `*` is not accepted.
   */
  allowedTools: string[];
  identity: Identity;
}

export interface RunnerConfig {
  /** Default model for jobs that name none. */
  defaultModel: string;
  /** Per-role model overrides, e.g. `{ 'level1-writeup': 'claude-haiku-5-5' }`. */
  roleModels: Record<string, string>;
  defaultMaxTurns: number;
  defaultTimeoutMs: number;
  /** Sessions running at once; further jobs wait in a FIFO queue. */
  concurrency: number;
  /** Parent of the per-job empty working directories. */
  workRoot: string;
  /** Keep each job's working directory after it finishes (for debugging). */
  keepWorkDirs: boolean;
  /** Longer text fields in events are cut to this many characters and flagged. */
  maxEventFieldChars: number;
  /** One sink call may take this long; a slower one fails the job as `sink_failed`. */
  sinkTimeoutMs: number;
  /** After a session is stopped, how long to wait for its process to exit before killing it. */
  processExitMs: number;
  /** After a stop, how long `runJob` waits for its own loop before settling without it. */
  stopGraceMs: number;
}

// ---- Events -------------------------------------------------------------------------------

export interface EventBase {
  /** 0-based, strictly increasing within a job. Defines the order of the job's events. */
  seq: number;
  /** When the runner observed the event (ISO 8601). */
  ts: string;
  jobId: string;
  role: string;
  identity: Identity;
  /** The Claude Code session id, once known (null before `session_init`). */
  sessionId: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface PermissionDenial {
  tool: string;
  toolUseId: string;
  input: unknown;
}

export type EventBody =
  | { type: 'job_queued' }
  | {
      type: 'job_started';
      model: string;
      cwd: string;
      prompt: string;
      systemPrompt: string | null;
      allowedTools: string[];
      builtinTools: string[];
      mcpServers: string[];
      /** Names (never values) of the environment variables the session's process received. */
      envNames: string[];
      maxTurns: number;
      timeoutMs: number;
      effort: EffortLevel | null;
    }
  | {
      type: 'session_init';
      claudeCodeVersion: string;
      model: string;
      permissionMode: string;
      /** `none` means no API key: the session runs on the subscription login or the OAuth token. */
      apiKeySource: string;
      tools: string[];
      mcpServers: { name: string; status: string }[];
      skills: string[];
      plugins: string[];
      slashCommands: string[];
    }
  | { type: 'assistant_text'; text: string; truncated: boolean; parentToolUseId: string | null; error: string | null }
  /**
   * A user-role message that arrived mid-session and is not a tool result: a message from another
   * session, a channel, or the CLI itself. The job's own prompt is in `job_started`, not here.
   */
  | {
      type: 'user_message';
      text: string;
      truncated: boolean;
      origin: string | null;
      from: string | null;
      synthetic: boolean;
      /** `stream`: the SDK message stream carried it. `prompt_hook`: recorded just before it reached the model. */
      source: 'stream' | 'prompt_hook';
    }
  | { type: 'tool_call'; toolUseId: string; tool: string; input: unknown; parentToolUseId: string | null }
  | {
      type: 'tool_result';
      toolUseId: string;
      tool: string | null;
      isError: boolean;
      content: string;
      truncated: boolean;
      parentToolUseId: string | null;
    }
  | {
      type: 'rate_limit';
      status: string;
      rateLimitType: string | null;
      resetsAt: string | null;
      utilization: number | null;
      errorCode: string | null;
      /** Paid extra usage. `status: 'rejected'` with `overageStatus: 'allowed'` means it would be spent. */
      overageStatus: string | null;
      overageResetsAt: string | null;
      overageDisabledReason: string | null;
      isUsingOverage: boolean | null;
      overageInUse: boolean | null;
      overageEnabled: boolean | null;
      surpassedThreshold: number | null;
      limitScope: string | null;
    }
  /** A call that was still open when the job ended; what it did, if anything, is unknown. */
  | { type: 'tool_abandoned'; toolUseId: string; tool: string; reason: string }
  /** A tool call refused without asking anyone (the role's allowlist, not a person, decided). */
  | { type: 'permission_denied'; tool: string; toolUseId: string; reasonType: string | null; reason: string | null }
  | { type: 'api_retry'; attempt: number; maxRetries: number; delayMs: number; errorStatus: number | null; error: string }
  /** Any other SDK message, kept so the log has no silent gaps. */
  | { type: 'sdk_notice'; messageType: string; subtype: string | null }
  | {
      type: 'result';
      subtype: string;
      isError: boolean;
      text: string | null;
      textTruncated: boolean;
      errors: string[];
      numTurns: number;
      durationMs: number;
      durationApiMs: number;
      stopReason: string | null;
      terminalReason: string | null;
      apiErrorStatus: number | null;
      /** The SDK's own estimate. A subscription is not billed per token; use `usage` for quota. */
      estimatedCostUsd: number;
      usage: TokenUsage;
      permissionDenials: PermissionDenial[];
    }
  | {
      type: 'job_finished';
      status: JobStatus;
      error: JobError | null;
      durationMs: number;
      numTurns: number;
      /** Whether the Claude Code process had exited when the job was reported finished, or had to be killed. */
      processExit: ProcessExit;
      pid: number | null;
    };

export type NornEvent = EventBase & EventBody;
export type EventType = EventBody['type'];

/** What became of the Claude Code process: never started, exited by itself, had to be killed, or survived a kill. */
export type ProcessExit = 'none' | 'exited' | 'killed' | 'leaked';

/** Receives every event of every job, in order. May be async; the runner waits for it. */
export type EventSink = (event: NornEvent) => void | Promise<void>;

// ---- Results ------------------------------------------------------------------------------

export type JobStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export type JobErrorKind =
  /**
   * The subscription's usage window is used up (or the job was stopped rather than spend paid
   * overage). Retry after `resetsAt`.
   */
  | 'usage_limit'
  /** A transient 429 or an overloaded API that outlasted the SDK's own retries. */
  | 'rate_limited'
  | 'overloaded'
  /** Login expired or rejected. On the laptop: `claude auth login`. On the server: a new OAuth token. */
  | 'auth'
  | 'account'
  | 'model_unavailable'
  | 'max_turns'
  | 'timeout'
  | 'session_error'
  /** The Claude Code process failed to start or died without a result. */
  | 'process_error'
  /** The event sink threw, so the job was stopped rather than run unlogged. */
  | 'sink_failed';

export interface JobError {
  kind: JobErrorKind;
  message: string;
  /** Whether running the same job again later could succeed. */
  retryable: boolean;
  /** ISO time when a `usage_limit` ends, if the SDK said. */
  resetsAt: string | null;
}

export interface JobResult {
  jobId: string;
  role: string;
  identity: Identity;
  status: JobStatus;
  /** The agent's final text answer, for succeeded jobs. */
  result: string | null;
  error: JobError | null;
  sessionId: string | null;
  model: string;
  numTurns: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
  /** True if any part of the session ran on paid overage (only possible when `allowOverage` is set). */
  usedOverage: boolean;
  permissionDenials: PermissionDenial[];
  eventCount: number;
  processExit: ProcessExit;
  pid: number | null;
}
