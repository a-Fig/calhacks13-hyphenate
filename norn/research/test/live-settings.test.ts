import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildResearchJob } from '../src/job.ts';
import { targets } from './helpers.ts';
import { DEFAULTS, missingForLive, settingsFromEnv, SettingsError } from '../src/live/settings.ts';

const linux = (files: string[] = []) => ({ exists: (p: string) => files.includes(p), home: '/home/t', platform: 'linux' });

describe('settings', () => {
  it('has small defaults', () => {
    const s = settingsFromEnv({});
    assert.equal(s.maxPerHour, DEFAULTS.maxPerHour);
    assert.ok(s.maxPerHour <= 6 && s.maxTurns <= 20 && s.timeoutMs <= 10 * 60_000 && s.targets <= 3);
    assert.deepEqual(s.ecrs, []);
    assert.equal(s.model, undefined);
  });
  it('reads the budgets from the environment, by name', () => {
    const s = settingsFromEnv({ NORN_RESEARCH_MAX_PER_HOUR: '2', NORN_RESEARCH_MAX_TURNS: '8', NORN_RESEARCH_TIMEOUT_MS: '90000', NORN_RESEARCH_TARGETS: '2', NORN_RESEARCH_ECRS: 'ECR-0417, ECR-0423', NORN_RESEARCH_MODEL: 'claude-sonnet-5-5' });
    assert.deepEqual([s.maxPerHour, s.maxTurns, s.timeoutMs, s.targets], [2, 8, 90_000, 2]);
    assert.deepEqual(s.ecrs, ['ECR-0417', 'ECR-0423']);
    assert.equal(s.model, 'claude-sonnet-5-5');
  });
  it('refuses a value that is not a whole number in range, naming the variable', () => {
    assert.throws(() => settingsFromEnv({ NORN_RESEARCH_MAX_PER_HOUR: '0' }), (e: Error) => e instanceof SettingsError && /NORN_RESEARCH_MAX_PER_HOUR/.test(e.message));
    assert.throws(() => settingsFromEnv({ NORN_RESEARCH_MAX_TURNS: 'many' }), /NORN_RESEARCH_MAX_TURNS/);
    assert.throws(() => settingsFromEnv({ NORN_RESEARCH_TIMEOUT_MS: '5' }), /NORN_RESEARCH_TIMEOUT_MS/);
  });
});

describe('what a live run needs before it starts', () => {
  it('names the Bright Data variable when the token is missing, and the Claude login when that is missing', () => {
    const m = missingForLive({}, linux(), false);
    assert.equal(m.length, 2);
    assert.match(m[0]!, /BRIGHT_DATA_API_TOKEN/);
    assert.match(m[1]!, /Claude login/);
  });
  it('is satisfied by the token and an OAuth token variable, or a login file in the config directory', () => {
    assert.deepEqual(missingForLive({ CLAUDE_CODE_OAUTH_TOKEN: 'x' }, linux(), true), []);
    assert.deepEqual(missingForLive({}, linux(['/home/t/.claude/.credentials.json']), true), []);
    assert.deepEqual(missingForLive({ CLAUDE_CONFIG_DIR: '/cfg' }, linux(['/cfg/.credentials.json']), true), []);
    assert.equal(missingForLive({ CLAUDE_CONFIG_DIR: '/cfg' }, linux(['/home/t/.claude/.credentials.json']), true).length, 1);
  });
  it('cannot look in the macOS keychain, so it does not refuse on that platform for a missing login file', () => {
    assert.deepEqual(missingForLive({}, { ...linux(), platform: 'darwin' }, true), []);
  });
  it('never puts a secret value in a message', () => {
    const secret = 'sk-secret-value-123';
    const all = [missingForLive({ CLAUDE_CODE_OAUTH_TOKEN: secret }, linux(), false), missingForLive({ BRIGHT_DATA_API_TOKEN: secret }, linux(), false)].flat().join('\n');
    assert.ok(!all.includes(secret));
  });
});

describe('the per-run budget reaches the job', () => {
  const env = { BRIGHT_DATA_API_TOKEN: 'not-a-real-token' };
  it('sets the runner turn and time limits from the settings, and keeps the old defaults without them', () => {
    const s = settingsFromEnv({ NORN_RESEARCH_MAX_TURNS: '8', NORN_RESEARCH_TIMEOUT_MS: '90000' });
    const job = buildResearchJob(targets.slice(0, 1), { jobId: 'j', ecr: 'E', env, maxTurns: s.maxTurns, timeoutMs: s.timeoutMs });
    assert.deepEqual([job.maxTurns, job.timeoutMs], [8, 90_000]);
    const dflt = buildResearchJob(targets.slice(0, 1), { jobId: 'j', ecr: 'E', env });
    assert.deepEqual([dflt.maxTurns, dflt.timeoutMs], [30, 600_000]);
  });
});
