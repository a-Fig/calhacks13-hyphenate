import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobSpec, RunnerConfig } from './types.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** For smoke tests and other throwaway runs. */
export const CHEAP_MODEL = 'claude-haiku-5-5';

/** Web access for research roles. Agents may use the web as a person would. */
export const WEB_TOOLS: readonly string[] = ['WebSearch', 'WebFetch'];

export function defaultConfig(): RunnerConfig {
  return {
    defaultModel: DEFAULT_MODEL,
    roleModels: {},
    defaultMaxTurns: 25,
    defaultTimeoutMs: 10 * 60 * 1000,
    concurrency: 2,
    workRoot: join(tmpdir(), 'norn-runner'),
    keepWorkDirs: false,
    maxEventFieldChars: 100_000,
  };
}

export function resolveConfig(partial?: Partial<RunnerConfig>): RunnerConfig {
  const config = { ...defaultConfig(), ...partial };
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new JobSpecError(`concurrency must be a positive integer, got ${config.concurrency}`);
  }
  return config;
}

export class JobSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobSpecError';
  }
}

/** A spec with every default applied. */
export interface ResolvedJob extends JobSpec {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Checks a spec and applies defaults. Throws `JobSpecError` for a spec that can't run. */
export function resolveJob(spec: JobSpec, config: RunnerConfig): ResolvedJob {
  const fail = (msg: string): never => {
    throw new JobSpecError(`job ${JSON.stringify(spec?.id)}: ${msg}`);
  };
  if (typeof spec?.id !== 'string' || !SAFE_ID.test(spec.id)) {
    fail('id must be 1-100 characters of letters, digits, ".", "_" or "-", starting with a letter or digit');
  }
  if (typeof spec.role !== 'string' || spec.role.trim() === '') fail('role is required');
  if (typeof spec.prompt !== 'string' || spec.prompt.trim() === '') fail('prompt is required');
  if (!Array.isArray(spec.allowedTools) || spec.allowedTools.some((t) => typeof t !== 'string' || t.trim() === '')) {
    fail('allowedTools must be an array of tool names (use [] to allow none)');
  }
  for (const tool of spec.allowedTools) {
    // The SDK ignores unanchored wildcards, which would read as "allow nothing" while looking
    // like "allow everything". Refuse them.
    if (tool === '*' || tool === 'mcp__*' || /^mcp__[^_]*\*/.test(tool)) {
      fail(`allowedTools entry ${JSON.stringify(tool)}: wildcards are only accepted after a literal mcp__<server>__ prefix`);
    }
  }
  const id = spec.identity;
  if (!id || typeof id.actor !== 'string' || !id.actor || typeof id.spawnedBy !== 'string' || !id.spawnedBy) {
    fail('identity needs actor and spawnedBy');
  }
  if (id.onBehalfOf !== null && typeof id.onBehalfOf !== 'string') fail('identity.onBehalfOf must be a string or null');
  for (const [name, server] of Object.entries(spec.mcpServers ?? {})) {
    if (/^claude[._ ]?ai/i.test(name)) fail(`mcp server name ${JSON.stringify(name)} is reserved`);
    if (!server || typeof server !== 'object') fail(`mcp server ${JSON.stringify(name)} is not a config object`);
  }
  for (const [key, min] of [['maxTurns', 1], ['timeoutMs', 1000]] as const) {
    const value = spec[key];
    if (value !== undefined && (!Number.isFinite(value) || value < min)) fail(`${key} must be a number >= ${min}`);
  }
  return {
    ...spec,
    model: spec.model ?? config.roleModels[spec.role] ?? config.defaultModel,
    maxTurns: spec.maxTurns ?? config.defaultMaxTurns,
    timeoutMs: spec.timeoutMs ?? config.defaultTimeoutMs,
  };
}
