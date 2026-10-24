import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { clip } from './events.ts';
import type { JobEmitter } from './events.ts';
import { webFetchGuard } from './fetch-guard.ts';

/**
 * The prompts a session receives after its own first one: a message from another session, a
 * channel, a queued command. The SDK stream does not carry their text (it shows only a
 * `command_lifecycle` frame), but Claude Code runs this hook before the text reaches the model,
 * so the record is written first. If the record can't be written, the message is blocked.
 */
export function promptRecorder(emitter: JobEmitter, jobPrompt: string, maxChars: number): HookCallback {
  let firstSeen = false;
  return async (input) => {
    if (input.hook_event_name !== 'UserPromptSubmit') return {};
    const prompt = typeof (input as { prompt?: unknown }).prompt === 'string' ? (input as { prompt: string }).prompt : '';
    if (!firstSeen && prompt.trim() === jobPrompt.trim()) {
      firstSeen = true; // the job's own prompt is already in job_started
      return {};
    }
    const { text, truncated } = clip(prompt, maxChars);
    try {
      await emitter.emit({ type: 'user_message', text, truncated, origin: null, from: null, synthetic: false, source: 'prompt_hook' });
    } catch {
      return { decision: 'block', reason: 'Norn could not record this message, so it was not delivered' };
    }
    return {};
  };
}

export interface JobHooksContext {
  emitter: JobEmitter;
  jobPrompt: string;
  maxChars: number;
  /** Called when the WebFetch guard refuses a call (the SDK does not report hook denials itself). */
  onFetchDenied: (toolUseId: string | undefined, reason: string) => void;
}

/** The hooks every job runs with. */
export function buildJobHooks(ctx: JobHooksContext): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [{ matcher: 'WebFetch', timeout: 20, hooks: [webFetchGuard(ctx.onFetchDenied)] }],
    UserPromptSubmit: [{ hooks: [promptRecorder(ctx.emitter, ctx.jobPrompt, ctx.maxChars)] }],
  };
}
