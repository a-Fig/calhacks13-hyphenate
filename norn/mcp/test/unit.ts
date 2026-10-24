// Unit tests: tokens, nornMcpFor, the .env helpers and the key script. No database, no model.
//   npm run test:unit -w @norn/mcp
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nornMcpFor, nornTools, READ_TOOLS, WRITE_TOOLS } from '../src/client.ts';
import { readEnvValue } from '../src/env.ts';
import { MAX_TTL_SECONDS, TokenError, signToken, verifyToken, type NewClaims } from '../src/token.ts';
import { TOOL_NAMES } from '../src/tools.ts';

const KEY = 'k'.repeat(48);
const base: NewClaims = { kind: 'job', jobId: 'job-1', role: 'level1-writeup', actor: 'agent:norn/level1/BWM-ECR-0417', onBehalfOf: 'person:jeff', spawnedBy: 'norn', ecrs: ['BWM-ECR-0417'] };
const mint = (over: Partial<NewClaims> = {}, ttlSeconds = 600, now = Date.now()) => signToken({ ...base, ...over, ttlSeconds }, KEY, now);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof TokenError ? e.code : `other:${(e as Error).message}`;
  }
  return 'none';
};

test('a token carries exactly the claims it was minted with', () => {
  const now = 1_700_000_000_000;
  const c = verifyToken(mint({}, 600, now), KEY, now + 1000);
  assert.deepEqual({ ...c, iat: 0, exp: 0 }, { v: 1, ...base, iat: 0, exp: 0 });
  assert.equal(c.exp - c.iat, 600);
});

test('a token fails with a clear code when it was signed with another key, edited, expired or malformed', () => {
  const t = mint();
  assert.equal(code(() => verifyToken(t, 'z'.repeat(48))), 'bad_signature');
  const [p, body, sig] = t.split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), actor: 'agent:norn/other' })).toString('base64url');
  assert.equal(code(() => verifyToken(`${p}.${edited}.${sig}`, KEY)), 'bad_signature');
  assert.equal(code(() => verifyToken(mint({}, 60, Date.now() - 3_600_000), KEY)), 'expired');
  assert.equal(code(() => verifyToken(mint({}, 60, Date.now() + 3_600_000), KEY)), 'not_yet_valid');
  assert.equal(code(() => verifyToken('not-a-token', KEY)), 'malformed');
  assert.equal(code(() => verifyToken(`${p}.${body}`, KEY)), 'malformed');
  assert.equal(code(() => verifyToken(t, undefined)), 'invalid_claims');
  assert.equal(code(() => verifyToken(t, 'short')), 'invalid_claims');
});

test('a signature that is the wrong length is refused, not compared', () => {
  const [p, body] = mint().split('.');
  assert.equal(code(() => verifyToken(`${p}.${body}.AAAA`, KEY)), 'bad_signature');
});

test('claim rules: lifetimes, person agents and the any-ECR wildcard', () => {
  assert.throws(() => mint({}, MAX_TTL_SECONDS.job + 1), /may live at most/);
  assert.doesNotThrow(() => mint({}, MAX_TTL_SECONDS.job));
  assert.throws(() => mint({ kind: 'person_agent', onBehalfOf: null }), /must name the person/);
  assert.doesNotThrow(() => mint({ kind: 'person_agent', ecrs: ['*'] }, MAX_TTL_SECONDS.person_agent));
  assert.throws(() => mint({ kind: 'job', ecrs: ['*'] }), /only for a person_agent/);
  assert.throws(() => mint({ kind: 'person_agent', ecrs: ['*', 'BWM-ECR-0417'] }), /only for a person_agent/);
  assert.throws(() => mint({ actor: 'has space' }), /actor/);
  assert.throws(() => mint({ actor: 'x'.repeat(65) }), /actor/);
  assert.throws(() => mint({ jobId: '' }), /jobId/);
  assert.throws(() => mint({ ecrs: Array.from({ length: 51 }, (_, i) => `E-${i}`) }), /at most 50/);
  assert.equal(mint({ ecrs: ['A', 'A', 'B'] }).length > 0, true);
  assert.deepEqual(verifyToken(mint({ ecrs: ['A', 'A', 'B'] }), KEY).ecrs, ['A', 'B']);
});

test('nornMcpFor returns an http entry whose bearer token carries the job identity and scope', () => {
  const identity = { actor: 'agent:norn/level1/BWM-ECR-0417', onBehalfOf: null, spawnedBy: 'norn' };
  const entry = nornMcpFor(identity, { jobId: 'job-9', role: 'level1-writeup', ecrs: ['BWM-ECR-0417'], url: 'http://127.0.0.1:1234/mcp', signingKey: KEY, ttlSeconds: 120 });
  assert.equal(entry.type, 'http');
  assert.equal(entry.url, 'http://127.0.0.1:1234/mcp');
  assert.match(entry.headers.Authorization, /^Bearer nmt1\.[\w-]+\.[\w-]+$/);
  const c = verifyToken(entry.headers.Authorization.slice('Bearer '.length), KEY);
  assert.deepEqual([c.kind, c.jobId, c.role, c.actor, c.onBehalfOf, c.spawnedBy, c.ecrs, c.exp - c.iat], ['job', 'job-9', 'level1-writeup', identity.actor, null, 'norn', ['BWM-ECR-0417'], 120]);
  assert.throws(() => nornMcpFor(identity, { jobId: 'j', role: 'r', ecrs: [], signingKey: '' , url: 'x' }), /NORN_MCP_SIGNING_KEY|signing key/);
});

test('nornTools builds the allowlist names the runner expects, and covers every tool the server registers', () => {
  assert.deepEqual(nornTools('get_ecr', 'add_comment'), ['mcp__norn__get_ecr', 'mcp__norn__add_comment']);
  assert.equal(nornTools('read').length, READ_TOOLS.length);
  assert.deepEqual([...nornTools('read', 'write')].sort(), TOOL_NAMES.map(n => `mcp__norn__${n}`).sort());
  assert.equal(READ_TOOLS.length + WRITE_TOOLS.length, TOOL_NAMES.length);
});

test('readEnvValue reads one KEY=value line and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norn-env-'));
  const f = join(dir, '.env');
  writeFileSync(f, 'A=1\r\nexport NORN_MCP_SIGNING_KEY="abc123"\r\nB=2\n');
  assert.equal(readEnvValue(f, 'NORN_MCP_SIGNING_KEY'), 'abc123');
  assert.equal(readEnvValue(f, 'MISSING'), undefined);
  assert.equal(readEnvValue(join(dir, 'nope'), 'A'), undefined);
});

test('the key script appends once, keeps what was there, and never prints the key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norn-key-'));
  const f = join(dir, '.env');
  writeFileSync(f, 'ANTHROPIC_PLACEHOLDER=keep-me'); // no trailing newline on purpose
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ensure-key.mjs');
  const run = () => execFileSync(process.execPath, [script], { env: { ...process.env, NORN_ENV_FILE: f }, encoding: 'utf8' });
  const first = run();
  const key = readEnvValue(f, 'NORN_MCP_SIGNING_KEY')!;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!first.includes(key), 'the script printed the key');
  assert.match(readFileSync(f, 'utf8'), /^ANTHROPIC_PLACEHOLDER=keep-me\nNORN_MCP_SIGNING_KEY=/);
  const second = run();
  assert.match(second, /already set/);
  assert.equal(readEnvValue(f, 'NORN_MCP_SIGNING_KEY'), key);
  assert.equal(readFileSync(f, 'utf8').split('NORN_MCP_SIGNING_KEY').length, 2);
});
