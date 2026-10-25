// Unit tests: tokens, nornMcpFor, the .env helpers and the key script. No database, no model.
//   npm run test:unit -w @norn/mcp
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { jobTokenFile, nornMcpFor, nornTools, READ_TOOLS, WRITE_TOOLS } from '../src/client.ts';
import { readEnvValue } from '../src/env.ts';
import { securePrivateDir, windowsAcl } from '../src/fsutil.ts';
import { connectErrorText, maxLevelFor } from '../src/norn.ts';
import { MAX_TTL_SECONDS, TokenError, signToken, verifyToken, type NewClaims } from '../src/token.ts';
import { TOOL_NAMES, registerTools } from '../src/tools.ts';

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
  assert.equal(code(() => verifyToken(`${p}.${body}.AAAA`, KEY)), 'malformed');
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
  const entry = nornMcpFor(identity, { jobId: 'job-9', role: 'level1-writeup', ecrs: ['BWM-ECR-0417'], url: 'http://127.0.0.1:1234/mcp', signingKey: KEY, ttlSeconds: 120, delivery: 'header' });
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

test('a signature must be canonical base64url: padding, stray characters and unused low bits are refused', () => {
  const t = mint();
  const [p, body, sig] = t.split('.');
  assert.equal(verifyToken(t, KEY).jobId, 'job-1');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = sig!.at(-1)!;
  const i = alphabet.indexOf(last);
  const sibling = alphabet[(i & ~3) | ((i + 1) & 3)]!; // same top four bits: a lenient decoder reads the same bytes
  const edited = `${sig!.slice(0, -1)}${sibling}`;
  assert.notEqual(edited, sig);
  assert.deepEqual(Buffer.from(edited, 'base64url'), Buffer.from(sig!, 'base64url'));
  assert.equal(code(() => verifyToken(`${p}.${body}.${edited}`, KEY)), 'bad_signature');
  for (const bad of [`${sig}=`, `${sig}==`, `${sig}!`, `${sig!.slice(0, -1)}!`, sig!.slice(0, -1), `${sig}A`])
    assert.equal(code(() => verifyToken(`${p}.${body}.${bad}`, KEY)), 'malformed', bad.slice(-4));
  assert.equal(code(() => verifyToken(`${p}.${body}=.${sig}`, KEY)), 'malformed');
});

test('claims use a strict character set and no unknown fields', () => {
  assert.throws(() => mint({ actor: 'agent:"x"' }), /actor/);
  assert.throws(() => mint({ actor: 'agent:norn/<script>' }), /actor/);
  assert.throws(() => mint({ ecrs: ['BWM ECR'] }), /ecrs/);
  assert.doesNotThrow(() => mint({ actor: 'agent:norn/level1/BWM-ECR-0417/job-1', onBehalfOf: 'person:jeff', ecrs: ['BWM-ECR-0417'] }));
  const t = mint();
  const [p, body] = t.split('.');
  const extra = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), admin: true })).toString('base64url');
  // an extra field is refused even when properly signed
  const signed = `${p}.${extra}`;
  const sig = createHmac('sha256', KEY).update(signed).digest('base64url');
  assert.equal(code(() => verifyToken(`${signed}.${sig}`, KEY)), 'invalid_claims');
});

test('maxLevelFor: a level<N> job role posts up to N, other jobs none, a person\'s agent never Level 3', () => {
  assert.equal(maxLevelFor({ kind: 'job', role: 'level1-writeup' }), 1);
  assert.equal(maxLevelFor({ kind: 'job', role: 'level2-research' }), 2);
  assert.equal(maxLevelFor({ kind: 'job', role: 'level3-verdict' }), 3);
  assert.equal(maxLevelFor({ kind: 'job', role: 'researcher' }), 0);
  assert.equal(maxLevelFor({ kind: 'job', role: 'level4-x' }), 0);
  assert.equal(maxLevelFor({ kind: 'person_agent', role: 'level3-verdict' }), 2);
  assert.equal(maxLevelFor({ kind: 'person_agent', role: 'person-agent' }), 2);
});

test('connect errors say something even when the SDK says nothing', () => {
  assert.match(connectErrorText(new Error(''), 'ws://127.0.0.1:3000', 'norn'), /no reason given.*database 'norn' at ws:\/\/127\.0\.0\.1:3000/);
  assert.match(connectErrorText(new Error('connection refused'), 'ws://h', 'd'), /^connection refused \(database 'd'/);
  assert.match(connectErrorText(undefined, 'ws://h', 'd'), /no reason given/);
});

test('minting a person token again keeps its job id; another label gets another; the token is not printed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norn-mint-'));
  const out = join(dir, 't.token');
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'mint-person-token.ts');
  const tsx = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const run = (label: string) => {
    const stdout = execFileSync(process.execPath, [tsx, script, '--person', 'jeff', '--label', label, '--ecr', 'BWM-ECR-0417', '--out', out], { env: { ...process.env, NORN_MCP_SIGNING_KEY: KEY }, encoding: 'utf8' });
    const token = readFileSync(out, 'utf8');
    assert.ok(!stdout.includes(token), 'the script printed the token');
    return verifyToken(token, KEY);
  };
  const a = run('laptop');
  const b = run('laptop');
  const c = run('desktop');
  assert.equal(a.jobId, b.jobId);
  assert.notEqual(a.jobId, c.jobId);
  assert.deepEqual([a.kind, a.actor, a.onBehalfOf, a.spawnedBy, a.ecrs], ['person_agent', 'agent:jeff/laptop', 'person:jeff', 'person:jeff', ['BWM-ECR-0417']]);
});

test('on Windows the private directory is closed to other users', { skip: process.platform !== 'win32' }, () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.state');
  const dir = join(root, `acl-test-${Date.now().toString(36)}`);
  try {
    securePrivateDir(dir);
    writeFileSync(join(dir, 'a.token'), 'x');
    const me = execFileSync('whoami', { encoding: 'utf8' }).trim().toLowerCase();
    for (const path of [dir, join(dir, 'a.token')]) {
      const acl = windowsAcl(path);
      assert.ok(acl.toLowerCase().includes(me), `${path} should name ${me}`);
      assert.ok(!/BUILTIN\Users|Authenticated Users|Everyone/i.test(acl), `${path} is open to other users:\n${acl}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the default nornMcpFor entry keeps the token out of the config: a headers helper reads a private file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norn-state-'));
  const saved = process.env.NORN_MCP_STATE_DIR;
  process.env.NORN_MCP_STATE_DIR = dir;
  try {
    const identity = { actor: 'agent:norn/level1/BWM-ECR-0417/job-h', onBehalfOf: null, spawnedBy: 'norn' };
    const entry = nornMcpFor(identity, { jobId: 'job-h', role: 'level1-writeup', ecrs: ['BWM-ECR-0417'], url: 'http://127.0.0.1:1/mcp', signingKey: KEY });
    const file = jobTokenFile('job-h');
    const token = readFileSync(file, 'utf8');
    assert.equal(entry.type, 'http');
    assert.ok(!('headers' in entry));
    assert.ok(!JSON.stringify(entry).includes(token), 'the token is in the entry');
    assert.ok(entry.headersHelper.includes(file));
    assert.equal(verifyToken(token, KEY).actor, identity.actor);
    const out = execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'headers-helper.mjs'), file], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), { Authorization: `Bearer ${token}` });
  } finally {
    if (saved === undefined) delete process.env.NORN_MCP_STATE_DIR;
    else process.env.NORN_MCP_STATE_DIR = saved;
  }
});

test('post_impact_statement hands the statement guard every agent-written field the PLM and the web page show, not just the ones its schema names for prose', async () => {
  let seen: any;
  const handlers = new Map<string, (a: any) => Promise<{ isError?: boolean; content: { text: string }[] }>>();
  const server = { registerTool: (name: string, _def: unknown, handler: any) => void handlers.set(name, handler) } as any;
  const pr = { id: 5n, plmEcrNumber: 'ECR-0417', revision: 1 } as any;
  const ctx = {
    norn: { findEcr: () => ({ pr, known: ['ECR-0417'] }) } as any,
    claims: { spawnedBy: 'norn:check_run:3', actor: 'agent:test', jobId: 'j' } as any,
    actor: {} as any,
    log: () => {},
    statementGuard: (_pr: unknown, _spawnedBy: string, statement: unknown) => ((seen = statement), 'refused for the test'),
  };
  registerTools(server, ctx as any);
  const args = {
    ecr: 'ECR-0417', level: 1, changeClass: 'Class I', route: 'CCB', headline: 'H',
    numbers: [{ key: 'k', evidence: 'judgment', label: 'L', unit: 'U', p10: 1, p50: 2, p90: 3 }],
    drivers: [{ text: 'D', evidence: 'judgment' }],
    assumptions: [{ key: 'a', note: 'N' }],
    claims: [{ text: 'C', evidence: 'judgment' }],
  };
  const r = await handlers.get('post_impact_statement')!(args);
  assert.equal(r.isError, true);
  assert.equal(r.content[0]!.text, 'refused for the test');
  assert.equal(seen.headline, 'H');
  assert.equal(seen.changeClass, 'Class I');
  assert.equal(seen.route, 'CCB');
  assert.deepEqual(seen.numbers.map((n: { key: string; label: string; unit: string; evidence: string }) => [n.key, n.label, n.unit, n.evidence]), [['k', 'L', 'U', 'judgment']]);
  assert.deepEqual(seen.drivers.map((d: { text: string }) => d.text), ['D']);
  assert.deepEqual(seen.assumptions.map((a: { note: string }) => a.note), ['N']);
  assert.deepEqual(seen.claims.map((c: { text: string }) => c.text), ['C']);
});
