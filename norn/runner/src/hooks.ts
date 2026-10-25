import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { clip } from './events.ts';
import type { JobEmitter } from './events.ts';
import { webFetchGuard, type Resolver } from './fetch-guard.ts';
import type { ToolInputGuard, ToolInputVerdict } from './types.ts';

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

/**
 * A PreToolUse hook that runs a job's own guards (`JobSpec.toolInputGuards`) on the arguments of
 * the tools they are named for, before the tool is called. Other tools pass untouched. Fails
 * closed: a guard that throws, or returns anything but `{ allow: true }`, denies the call.
 */
export function toolInputGuardHook(
  guards: Record<string, ToolInputGuard>,
  onDeny: (toolUseId: string | undefined, reason: string) => void,
): HookCallback {
  return async (input, toolUseId) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const guard = Object.hasOwn(guards, input.tool_name) ? guards[input.tool_name] : undefined;
    if (!guard) return {};
    let verdict: ToolInputVerdict;
    try {
      verdict = await guard(input.tool_input, { tool: input.tool_name, ...(toolUseId ? { toolUseId } : {}) });
    } catch (err) {
      verdict = { allow: false, reason: `the check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (verdict?.allow === true) return {};
    const why = verdict?.allow === false && typeof verdict.reason === 'string' ? verdict.reason : 'the check gave no answer';
    const reason = `${input.tool_name} refused by Norn: ${why}`;
    onDeny(toolUseId, reason);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  };
}

export interface JobHooksContext {
  emitter: JobEmitter;
  jobPrompt: string;
  maxChars: number;
  /** Called when the WebFetch guard refuses a call (the SDK does not report hook denials itself). */
  onFetchDenied: (toolUseId: string | undefined, reason: string) => void;
  /** The job's own tool-input guards (`JobSpec.toolInputGuards`). */
  toolInputGuards?: Record<string, ToolInputGuard> | undefined;
  /** Called when one of them refuses a call. Default: `onFetchDenied`, which records any hook denial. */
  onToolDenied?: (toolUseId: string | undefined, reason: string) => void;
  /** The name resolver of the WebFetch address guard. Default: the system's. For tests. */
  resolve?: Resolver;
}

/** The hooks every job runs with. */
export function buildJobHooks(ctx: JobHooksContext): NonNullable<Options['hooks']> {
  const guards = ctx.toolInputGuards ?? {};
  const addressGuard = webFetchGuard(ctx.onFetchDenied, ctx.resolve);
  const pre: NonNullable<Options['hooks']>['PreToolUse'] = [{ matcher: 'WebFetch', timeout: 20, hooks: [addressGuard] }];
  if (Object.keys(guards).length > 0) {
    // One hook, in order, because hooks that match the same call may run side by side: the job's own guards (the identifier
    // checks) first, and the guard that resolves the host (a lookup that tells the name server what is being fetched) only
    // when they allow the call. A name that carries an identifier is therefore never looked up. No matcher: it answers only
    // for the names it has a guard for, and the address guard answers only for WebFetch.
    const own = toolInputGuardHook(guards, ctx.onToolDenied ?? ctx.onFetchDenied);
    pre.length = 0;
    pre.push({
      timeout: 20,
      hooks: [
        async (input, toolUseId, options) => {
          const first = await own(input, toolUseId, options);
          if ('hookSpecificOutput' in first && (first.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny') return first;
          return addressGuard(input, toolUseId, options);
        },
      ],
    });
  }
  return {
    PreToolUse: pre,
    UserPromptSubmit: [{ hooks: [promptRecorder(ctx.emitter, ctx.jobPrompt, ctx.maxChars)] }],
  };
}
