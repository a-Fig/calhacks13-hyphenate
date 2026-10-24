// Fixtures shared by the unit tests: canned SDK messages and scripted sessions.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from '../src/run-job.ts';
import type { JobSpec } from '../src/types.ts';

export const identity = { actor: 'agent:norn/test', onBehalfOf: null, spawnedBy: 'norn' };
export const baseSpec = (over: Partial<JobSpec> = {}): JobSpec => ({
  id: 'job-1',
  role: 'researcher',
  prompt: 'do the thing',
  allowedTools: ['mcp__norn__*', 'WebSearch'],
  identity,
  ...over,
});

// ---- canned SDK messages ------------------------------------------------------------------

export const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 };
export const sid = { session_id: 's-1', uuid: 'u-1' };
export const init = {
  type: 'system', subtype: 'init', ...sid, claude_code_version: '2.1.310', model: 'm', permissionMode: 'dontAsk',
  apiKeySource: 'none', tools: ['mcp__norn__get_bom'], mcp_servers: [{ name: 'norn', status: 'connected' }],
  skills: [], plugins: [], slash_commands: [], cwd: '/x', output_style: 'default', agents: [],
} as unknown as SDKMessage;
export const assistant = (content: unknown[], extra: object = {}) =>
  ({ type: 'assistant', ...sid, parent_tool_use_id: null, message: { content, role: 'assistant' }, ...extra }) as unknown as SDKMessage;
export const toolResult = (id: string, content: unknown, isError = false) =>
  ({ type: 'user', ...sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } }) as unknown as SDKMessage;
export const resultOk = (text = 'done') =>
  ({ type: 'result', subtype: 'success', ...sid, is_error: false, result: text, num_turns: 2, duration_ms: 50, duration_api_ms: 40,
     stop_reason: 'end_turn', total_cost_usd: 0.001, usage, modelUsage: {}, permission_denials: [] }) as unknown as SDKMessage;
export const resultErr = (subtype: string, over: object = {}) =>
  ({ type: 'result', subtype, ...sid, is_error: true, num_turns: 1, duration_ms: 5, duration_api_ms: 4, stop_reason: null,
     total_cost_usd: 0, usage, modelUsage: {}, permission_denials: [], errors: ['boom'], ...over }) as unknown as SDKMessage;

export async function* stream(messages: SDKMessage[], thenThrow?: Error): AsyncGenerator<SDKMessage> {
  for (const m of messages) yield m;
  if (thenThrow) throw thenThrow;
}
export const fakeQuery = (messages: SDKMessage[], thenThrow?: Error): QueryFn => () => stream(messages, thenThrow);
/**
 * A session that runs until the query is closed, like a long agent turn. Like the real SDK, it
 * ignores the abort signal: only close() ends it.
 */
export const hangingQuery: QueryFn = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const session = (async function* (): AsyncGenerator<SDKMessage> {
    yield init;
    await gate;
    yield assistant([{ type: 'text', text: 'carrying on after the stop' }]);
    yield resultOk('should never be logged');
  })();
  return Object.assign(session, { close: () => release() });
};

export const tmpRoot = () => mkdtemp(join(tmpdir(), 'norn-unit-'));

