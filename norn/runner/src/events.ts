import type { SDKMessage, SDKResultMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { EventBody, EventSink, Identity, NornEvent, PermissionDenial, TokenUsage } from './types.ts';

/** Thrown by `JobEmitter.emit` when the sink failed. The job is stopped rather than left unlogged. */
export class SinkError extends Error {
  constructor(cause: unknown) {
    super(`event sink failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'SinkError';
  }
}

/**
 * Stamps a job's events with their tags and a sequence number, and hands them to the sink one at
 * a time, in order. The runner awaits each emit, so a slow sink slows the job down rather than
 * reordering or dropping anything.
 */
export class JobEmitter {
  readonly jobId: string;
  readonly role: string;
  readonly identity: Identity;
  sessionId: string | null = null;
  count = 0;
  sinkError: SinkError | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly sink: EventSink;

  constructor(jobId: string, role: string, identity: Identity, sink: EventSink) {
    this.jobId = jobId;
    this.role = role;
    this.identity = identity;
    this.sink = sink;
  }

  emit(body: EventBody): Promise<void> {
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
      try {
        await this.sink(event);
      } catch (cause) {
        this.sinkError = new SinkError(cause);
        throw this.sinkError;
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
  rejectedRateLimit: SDKRateLimitInfo | null;
  initSeen: boolean;
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

function resetsAtIso(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // The SDK reports epoch seconds; accept milliseconds too.
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

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
 * name the tool behind each tool result and to remember what a failure looked like.
 */
export class MessageTranslator {
  readonly seen: Observations = {
    result: null,
    assistantError: null,
    assistantErrorText: null,
    rejectedRateLimit: null,
    initSeen: false,
  };
  sessionId: string | null = null;
  private readonly toolNames = new Map<string, string>();
  private lastRateLimitKey = '';
  private readonly maxChars: number;

  constructor(maxChars: number) {
    this.maxChars = maxChars;
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
            const { text } = clip(block.text, this.maxChars);
            out.push({ type: 'assistant_text', text, parentToolUseId: parent, error });
            if (error) {
              this.seen.assistantError = error;
              this.seen.assistantErrorText = block.text.slice(0, 500);
            }
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
            this.toolNames.set(block.id, block.name);
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
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type !== 'tool_result') continue;
            const { text, truncated } = clip(textOfContent(block.content), this.maxChars);
            out.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              tool: this.toolNames.get(block.tool_use_id) ?? null,
              isError: block.is_error === true,
              content: text,
              truncated,
              parentToolUseId: msg.parent_tool_use_id,
            });
          }
        }
        break;
      }
      case 'rate_limit_event': {
        const info = msg.rate_limit_info;
        if (info.status === 'rejected') this.seen.rejectedRateLimit = info;
        // The CLI repeats an unchanged "allowed" report after most API calls.
        const key = JSON.stringify([info.status, info.rateLimitType, info.resetsAt, info.utilization, info.errorCode]);
        if (key === this.lastRateLimitKey) break;
        this.lastRateLimitKey = key;
        out.push({
          type: 'rate_limit',
          status: info.status,
          rateLimitType: info.rateLimitType ?? null,
          resetsAt: resetsAtIso(info.resetsAt),
          utilization: info.utilization ?? null,
          errorCode: info.errorCode ?? null,
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
        out.push({
          type: 'result',
          subtype: msg.subtype,
          isError: msg.is_error,
          text: msg.subtype === 'success' ? clip(msg.result, this.maxChars).text : null,
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
