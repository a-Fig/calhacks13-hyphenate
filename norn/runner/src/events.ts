import type { SDKMessage, SDKResultMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { EventBody, EventSink, Identity, NornEvent, PermissionDenial, TokenUsage } from './types.ts';

/** Thrown by `JobEmitter.emit` when the sink failed or hung. The job is stopped rather than left unlogged. */
export class SinkError extends Error {
  constructor(cause: unknown) {
    super(`event sink failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'SinkError';
  }
}

/**
 * Stamps a job's events with their tags and a sequence number, and hands them to the sink one at
 * a time, in order. The runner awaits each emit, so a slow sink slows the job down rather than
 * reordering or dropping anything. One sink call may take `sinkTimeoutMs`; after that the emit
 * fails with `SinkError`, so a hung sink cannot hold a job (or the Runner slot under it) forever.
 */
export class JobEmitter {
  readonly jobId: string;
  readonly role: string;
  readonly identity: Identity;
  sessionId: string | null = null;
  count = 0;
  sinkError: SinkError | null = null;
  /** Set once the job has been finalised; later emits (from an abandoned loop) are refused. */
  closed = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly sink: EventSink;
  private readonly sinkTimeoutMs: number;

  constructor(jobId: string, role: string, identity: Identity, sink: EventSink, sinkTimeoutMs = 30_000) {
    this.jobId = jobId;
    this.role = role;
    this.identity = identity;
    this.sink = sink;
    this.sinkTimeoutMs = sinkTimeoutMs;
  }

  emit(body: EventBody): Promise<void> {
    if (this.closed) return Promise.reject(new Error(`job ${this.jobId} is finished; event refused`));
    const event = {
      seq: this.count++,
      ts: new Date().toISOString(),
      jobId: this.jobId,
      role: this.role,
      identity: this.identity,
      sessionId: this.sessionId,
      ...body,
    } as NornEvent;
    const turn = this.chain.then(async () => {
      if (this.sinkError) throw this.sinkError;
      let timer: NodeJS.Timeout | undefined;
      try {
        const slow = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`sink did not return within ${this.sinkTimeoutMs} ms`)), this.sinkTimeoutMs);
        });
        await Promise.race([Promise.resolve().then(() => this.sink(event)), slow]);
      } catch (cause) {
        this.sinkError = new SinkError(cause);
        throw this.sinkError;
      } finally {
        clearTimeout(timer);
      }
    });
    this.chain = turn.catch(() => {});
    return turn;
  }
}

// ---- Reading the SDK's message stream -------------------------------------------------------

/** What the stream said about how the session is going, for classifying a failure afterwards. */
export interface Observations {
  result: SDKResultMessage | null;
  /** Last `error` field seen on an assistant message (e.g. `rate_limit`, `authentication_failed`). */
  assistantError: string | null;
  assistantErrorText: string | null;
  /** A rate-limit report that blocks the session outright (rejected, and no paid overage to fall back on). */
  rejectedRateLimit: SDKRateLimitInfo | null;
  /** The latest report that says the session is on, or would continue on, paid overage. */
  overage: SDKRateLimitInfo | null;
  /** True once a report said the session is running on paid overage (not merely that it could). */
  overageUsed: boolean;
  initSeen: boolean;
}

/** Whether a rate-limit report means the session is on, or would go on, paid overage. */
export function overageInPlay(info: SDKRateLimitInfo): boolean {
  return info.isUsingOverage === true || info.overageInUse === true || (info.status === 'rejected' && info.overageStatus === 'allowed');
}

export function clip(value: string, max: number): { text: string; truncated: boolean } {
  return value.length <= max ? { text: value, truncated: false } : { text: value.slice(0, max), truncated: true };
}

function clipInput(input: unknown, max: number): unknown {
  let json: string;
  try {
    json = JSON.stringify(input) ?? 'null';
  } catch {
    return { _unserializable: true };
  }
  return json.length <= max ? input : { _truncated: true, preview: json.slice(0, max) };
}

export function resetsAtIso(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // The SDK reports epoch seconds; accept milliseconds too.
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

/** A block of a user-role message, as far as the translator reads it. */
type ContentBlock = { type: string; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content
    .map((block) => {
      if (block && typeof block === 'object' && 'type' in block) {
        if (block.type === 'text' && 'text' in block) return String(block.text);
        return `[${String(block.type)}]`;
      }
      return String(block);
    })
    .join('\n');
}

export function usageOf(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Turns the SDK's messages into Norn events, one pass, in order. It keeps just enough state to
 * name the tool behind each tool result, to know which calls are still open, and to remember what
 * a failure looked like.
 */
export class MessageTranslator {
  readonly seen: Observations = {
    result: null,
    assistantError: null,
    assistantErrorText: null,
    rejectedRateLimit: null,
    overage: null,
    overageUsed: false,
    initSeen: false,
  };
  sessionId: string | null = null;
  private readonly open = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly hookDenials = new Map<string, string>();
  private lastRateLimitKey = '';
  private readonly maxChars: number;

  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }

  /**
   * A PreToolUse hook refused this call. The SDK does not report hook denials as permission
   * denials, so the runner records them here and the matching tool result is preceded by a
   * `permission_denied` event.
   */
  noteHookDenial(toolUseId: string | undefined, reason: string): void {
    if (toolUseId) this.hookDenials.set(toolUseId, reason);
  }

  /** Calls that were made and never answered. */
  openCalls(): { toolUseId: string; tool: string }[] {
    return [...this.open].map(([toolUseId, tool]) => ({ toolUseId, tool }));
  }

  translate(msg: SDKMessage): EventBody[] {
    if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) this.sessionId = msg.session_id;
    const out: EventBody[] = [];
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          this.seen.initSeen = true;
          out.push({
            type: 'session_init',
            claudeCodeVersion: msg.claude_code_version,
            model: msg.model,
            permissionMode: msg.permissionMode,
            apiKeySource: msg.apiKeySource,
            tools: msg.tools,
            mcpServers: msg.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
            skills: msg.skills,
            plugins: msg.plugins.map((p) => p.name),
            slashCommands: msg.slash_commands,
          });
        } else if (msg.subtype === 'api_retry') {
          out.push({
            type: 'api_retry',
            attempt: msg.attempt,
            maxRetries: msg.max_retries,
            delayMs: msg.retry_delay_ms,
            errorStatus: msg.error_status,
            error: msg.error,
          });
        } else if (msg.subtype === 'permission_denied') {
          out.push({
            type: 'permission_denied',
            tool: msg.tool_name,
            toolUseId: msg.tool_use_id,
            reasonType: msg.decision_reason_type ?? null,
            reason: msg.decision_reason ?? null,
          });
        } else if (msg.subtype !== 'thinking_tokens') {
          // thinking_tokens is accounting for reasoning the log deliberately leaves out; its
          // totals arrive in the result event's usage.
          out.push({ type: 'sdk_notice', messageType: 'system', subtype: msg.subtype });
        }
        break;
      }
      case 'assistant': {
        const parent = msg.parent_tool_use_id;
        const error = msg.error ?? null;
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            const { text, truncated } = clip(block.text, this.maxChars);
            out.push({ type: 'assistant_text', text, truncated, parentToolUseId: parent, error });
            if (error) {
              this.seen.assistantError = error;
              this.seen.assistantErrorText = block.text.slice(0, 500);
            }
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
            this.names.set(block.id, block.name);
            this.open.set(block.id, block.name);
            out.push({
              type: 'tool_call',
              toolUseId: block.id,
              tool: block.name,
              input: clipInput(block.input, this.maxChars),
              parentToolUseId: parent,
            });
          }
          // Thinking blocks are not logged: the platform's record is what the agent did, not its
          // own account of why.
        }
        if (error && !out.some((e) => e.type === 'assistant_text')) this.seen.assistantError = error;
        break;
      }
      case 'user': {
        const content = msg.message.content;
        const blocks = (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []) as ContentBlock[];
        const texts: string[] = [];
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string') {
            texts.push(block.text);
          } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const denial = this.hookDenials.get(block.tool_use_id);
            if (denial !== undefined) {
              out.push({
                type: 'permission_denied',
                tool: this.names.get(block.tool_use_id) ?? 'unknown',
                toolUseId: block.tool_use_id,
                reasonType: 'hook',
                reason: denial,
              });
              this.hookDenials.delete(block.tool_use_id);
            }
            this.open.delete(block.tool_use_id);
            const { text, truncated } = clip(textOfContent(block.content), this.maxChars);
            out.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              tool: this.names.get(block.tool_use_id) ?? null,
              isError: block.is_error === true,
              content: text,
              truncated,
              parentToolUseId: msg.parent_tool_use_id,
            });
          }
        }
        // Text that arrives from outside the session's own tool loop (another session's message, a
        // channel, the CLI) is part of what the agent was told, so it is logged. A session started
        // with a string prompt does not echo that prompt back, so this is never the job's own prompt.
        if (texts.length > 0) {
          const { text, truncated } = clip(texts.join('\n'), this.maxChars);
          const origin = msg.origin;
          out.push({
            type: 'user_message',
            text,
            truncated,
            origin: origin?.kind ?? null,
            from: origin?.kind === 'peer' ? (origin.name ?? origin.from) : origin?.kind === 'channel' ? origin.server : null,
            synthetic: msg.isSynthetic === true,
          });
        }
        break;
      }
      case 'rate_limit_event': {
        const info = msg.rate_limit_info;
        // Hard-blocked: rejected with no paid overage to carry on with.
        if (info.status === 'rejected' && info.overageStatus !== 'allowed') this.seen.rejectedRateLimit = info;
        if (overageInPlay(info)) {
          this.seen.overage = info;
          // "Would carry on with overage" is not yet spending; only these two say it is.
          if (info.isUsingOverage === true || info.overageInUse === true) this.seen.overageUsed = true;
        }
        // The CLI repeats an unchanged report after most API calls.
        const key = JSON.stringify(info);
        if (key === this.lastRateLimitKey) break;
        this.lastRateLimitKey = key;
        out.push({
          type: 'rate_limit',
          status: info.status,
          rateLimitType: info.rateLimitType ?? null,
          resetsAt: resetsAtIso(info.resetsAt),
          utilization: info.utilization ?? null,
          errorCode: info.errorCode ?? null,
          overageStatus: info.overageStatus ?? null,
          overageResetsAt: resetsAtIso(info.overageResetsAt),
          overageDisabledReason: info.overageDisabledReason ?? null,
          isUsingOverage: info.isUsingOverage ?? null,
          overageInUse: info.overageInUse ?? null,
          overageEnabled: info.overageEnabled ?? null,
          surpassedThreshold: info.surpassedThreshold ?? null,
          limitScope: info.limitScope ?? null,
        });
        break;
      }
      case 'result': {
        this.seen.result = msg;
        const denials: PermissionDenial[] = (msg.permission_denials ?? []).map((d) => ({
          tool: d.tool_name,
          toolUseId: d.tool_use_id,
          input: clipInput(d.tool_input, this.maxChars),
        }));
        const clipped = msg.subtype === 'success' ? clip(msg.result, this.maxChars) : null;
        out.push({
          type: 'result',
          subtype: msg.subtype,
          isError: msg.is_error,
          text: clipped?.text ?? null,
          textTruncated: clipped?.truncated ?? false,
          errors: msg.subtype === 'success' ? [] : msg.errors,
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          durationApiMs: msg.duration_api_ms,
          stopReason: msg.stop_reason,
          terminalReason: msg.terminal_reason ?? null,
          apiErrorStatus: ('api_error_status' in msg ? msg.api_error_status : null) ?? null,
          estimatedCostUsd: msg.total_cost_usd,
          usage: usageOf(msg.usage),
          permissionDenials: denials,
        });
        break;
      }
      default:
        out.push({ type: 'sdk_notice', messageType: msg.type, subtype: 'subtype' in msg ? String(msg.subtype) : null });
    }
    return out;
  }
}
