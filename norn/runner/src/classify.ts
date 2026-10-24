import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { resetsAtIso } from './events.ts';
import type { Observations } from './events.ts';
import type { JobError, JobErrorKind } from './types.ts';

/**
 * Wording of the CLI's usage-limit messages ("You've hit your session limit", "5-hour limit
 * reached", "Usage credits required", ...). Matched loosely and only against error text, never
 * against what the agent wrote. Not verified against a live limit (none was hit while building).
 */
const LIMIT_TEXT =
  /hit your (?:[a-z]+ )?limit|usage limit|limit reached|usage credits required|credits? (?:balance )?(?:is )?(?:too low|required)|spend limit|out of (?:extra )?usage/i;
const AUTH_TEXT = /login expired|please run \/login|failed to authenticate|oauth (?:session|token)|invalid (?:api key|bearer|token)|not logged in|unauthorized/i;

const RETRYABLE: Record<JobErrorKind, boolean> = {
  usage_limit: true,
  rate_limited: true,
  overloaded: true,
  auth: false,
  account: false,
  model_unavailable: false,
  max_turns: false,
  timeout: true,
  session_error: false,
  process_error: false,
  sink_failed: false,
};

function error(kind: JobErrorKind, message: string, resetsAt: string | null = null): JobError {
  return { kind, message: message.slice(0, 2000), retryable: RETRYABLE[kind], resetsAt };
}

function resetsAtOf(obs: Observations): string | null {
  return resetsAtIso(obs.rejectedRateLimit?.resetsAt);
}

/**
 * The job was stopped because the subscription's included usage ran out and the account would have
 * carried on with paid overage, which this job does not allow. The agent did not fail; the runner
 * chose not to spend.
 */
export function overageStopError(info: SDKRateLimitInfo): JobError {
  const window = info.rateLimitType ?? 'usage';
  return error(
    'usage_limit',
    `The subscription's ${window} limit is used up and the account would carry on with paid overage; the job was stopped because it does not allow overage`,
    resetsAtIso(info.resetsAt),
  );
}

/** Credentials never belong in an error message, whatever the CLI printed. */
export function scrub(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}

/**
 * Names why a session did not succeed. Usage limits are told apart from other failures because
 * they will happen (the subscription is shared with the team's build agents) and the right
 * response is to wait for the reset, not to retry at once.
 */
export function classifyFailure(obs: Observations, thrown?: unknown, stderrTail?: string): JobError {
  const result = obs.result;
  const thrownText = thrown instanceof Error ? thrown.message : thrown == null ? '' : String(thrown);
  const resultText = result ? (result.subtype === 'success' ? result.result : result.errors.join('; ')) : '';
  // Only error text, never the agent's ordinary words. The CLI reports one failure up to three
  // times (the assistant message, the result, the thrown error); keep each distinct part once.
  const parts: string[] = [];
  for (const part of [obs.assistantErrorText ?? '', result?.is_error ? resultText : '', thrownText]) {
    if (part && !parts.some((seen) => seen.includes(part) || part.includes(seen))) parts.push(part);
  }
  const errorText = scrub(parts.join(' | '));
  const status = result && 'api_error_status' in result ? result.api_error_status : null;

  // Only a report that blocks the session outright counts. A rejection the account got past on paid
  // overage is not why a later failure happened.
  if (obs.rejectedRateLimit) {
    const limit = obs.rejectedRateLimit.rateLimitType ?? 'usage';
    return error('usage_limit', errorText || `Subscription ${limit} limit reached`, resetsAtOf(obs));
  }
  if (obs.assistantError === 'rate_limit' || status === 429) {
    return LIMIT_TEXT.test(errorText) ? error('usage_limit', errorText, resetsAtOf(obs)) : error('rate_limited', errorText || 'Rate limited (429)');
  }
  if (obs.assistantError === 'overloaded' || status === 529) return error('overloaded', errorText || 'API overloaded');
  if (obs.assistantError === 'billing_error' || obs.assistantError === 'account_on_hold') {
    return LIMIT_TEXT.test(errorText) ? error('usage_limit', errorText, resetsAtOf(obs)) : error('account', errorText || obs.assistantError);
  }
  if (['authentication_failed', 'oauth_org_not_allowed', 'verification_required'].includes(obs.assistantError ?? '')) {
    return error('auth', errorText || obs.assistantError!);
  }
  if (obs.assistantError === 'model_not_found') return error('model_unavailable', errorText || 'Model not found');

  if (LIMIT_TEXT.test(errorText)) return error('usage_limit', errorText, resetsAtOf(obs));
  if (AUTH_TEXT.test(errorText)) return error('auth', errorText);

  if (result?.subtype === 'error_max_turns') return error('max_turns', `Stopped after ${result.num_turns} turns without finishing`);
  if (result) return error('session_error', errorText || `Session ended with ${result.subtype}`);

  const tail = stderrTail ? ` (stderr: ${scrub(stderrTail).slice(-500)})` : '';
  return error('process_error', (errorText || 'Claude Code ended without a result') + tail);
}
