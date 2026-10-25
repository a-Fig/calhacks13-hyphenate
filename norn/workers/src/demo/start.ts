// Norn's live demo stack, from one command (docs/DEMO.md). It checks what the demo needs, then starts,
// on one database (default `norn`, the demo instance):
//   the MCP server, the worker (ERPNext baseline, read only, Bowman's company config), the PLM ingest,
//   the Level 1 dispatcher and publisher, and the web screens (live).
// Every process's output is printed with its name in front, and Ctrl-C stops them all.
//
//   npm run demo -w @norn/workers -- [--db norn] [--ecrs ECR-0417,ECR-0423] [--web-port 5180] [--check] [--research]
//
// --research also starts the research worker (norn/research, #148): it researches the cost check's own
// assumptions on the public web through Bright Data and records the ones that pass its guardrails as
// agent estimates. Off by default, because it spends Bright Data credits and a Claude session per ECR
// revision; it needs BRIGHT_DATA_API_TOKEN in the environment or the .env. See norn/research/README.md.
// With it, the Level 1 dispatcher is told to wait for each revision's research result before its first session
// (NORN_L1_WAIT_FOR_RESEARCH, at most 10 minutes after the cost run finished), so the statement is written on the
// researched numbers. Without it the dispatcher behaves as it always did.
//
// --ecrs limits the PLM ingest and the publisher to those ECRs (NORN_PLM_ECRS, NORN_PUBLISH_ECRS);
// without it every open ECR in the PLM is taken in and gets a statement. --check runs the checks only.
// What it writes: Norn's database; in the PLM only the seven impact_* fields of each ECR (the publisher).
// It never writes to the ERP. Level 1 starts one Claude session per ECR revision on this machine's login.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFileCandidates, readEnvValue } from '../../../mcp/src/env.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DB = arg('--db') ?? 'norn';
const ECRS = (arg('--ecrs') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const WEB_PORT = Number(arg('--web-port') ?? 5180);
const MCP_PORT = Number(process.env.NORN_MCP_PORT ?? 3917);
const CHECK_ONLY = process.argv.includes('--check');
const RESEARCH = process.argv.includes('--research');

const here = dirname(fileURLToPath(import.meta.url));
const workers = resolve(here, '..', '..');
const norn = resolve(workers, '..');
const repo = resolve(norn, '..');
const tsxCli = join(norn, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = join(norn, 'node_modules', 'vite', 'bin', 'vite.js');
const say = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// ---- checks -------------------------------------------------------------------------------------
const problems: string[] = [];
const fine = (m: string) => say(`  ok    ${m}`);
const bad = (m: string) => {
  problems.push(m);
  say(`  FAIL  ${m}`);
};

const reachable = (host: string, port: number, ms = 3000) =>
  new Promise<boolean>(done => {
    const s = createConnection({ host, port });
    const end = (v: boolean) => {
      s.destroy();
      done(v);
    };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
const hostPort = (url: string): [string, number] => {
  const u = new URL(url);
  return [u.hostname, Number(u.port || (u.protocol === 'https:' ? 443 : 80))];
};

say(`checking what the demo needs (database '${DB}'${ECRS.length ? `, ECRs ${ECRS.join(', ')}` : ', every open ECR'})`);
const envFile = [process.env.ENV_FILE, ...envFileCandidates()].find(f => f && existsSync(f));
if (envFile) fine(`.env found (${envFile.split(/[\\/]/).slice(-2).join('/')})`);
else bad('no .env: set ENV_FILE to the main checkout\'s .env');
const env = (k: string) => process.env[k] ?? (envFile ? readEnvValue(envFile, k) : undefined);

if (await reachable('127.0.0.1', 3000)) fine('SpacetimeDB on 127.0.0.1:3000');
else bad('SpacetimeDB is not running on 127.0.0.1:3000 (npm run db:start, from norn/)');
const spacetime = process.env.LOCALAPPDATA && existsSync(join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe')) ? join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe') : 'spacetime';
try {
  execFileSync(spacetime, ['sql', DB, 'SELECT * FROM norn_config', '--server', 'local'], { stdio: 'ignore', timeout: 15_000 });
  fine(`database '${DB}' is published`);
} catch {
  bad(`database '${DB}' is not published (npm run db:publish, from norn/, for 'norn')`);
}

for (const [name, key] of [['PLM', 'PLM_URL'], ['ERP', 'ERPNEXT_URL']] as const) {
  const url = env(key);
  if (!url) {
    bad(`${key} is not set in .env`);
    continue;
  }
  const [h, p] = hostPort(url);
  if (await reachable(h, p)) fine(`${name} reachable at ${h}:${p}`);
  else bad(`${name} is not reachable at ${h}:${p}: is the SSH tunnel up? (docs/DEMO.md, "Tunnels")`);
}
for (const key of ['PLM_API_KEY', 'PLM_API_SECRET', 'ERPNEXT_API_KEY', 'ERPNEXT_API_SECRET', 'NORN_MCP_SIGNING_KEY']) {
  if (env(key)) fine(`${key} is set`);
  else bad(`${key} is not set in .env`);
}

if (RESEARCH) {
  if (env('BRIGHT_DATA_API_TOKEN')) fine('BRIGHT_DATA_API_TOKEN is set (for --research)');
  else bad('BRIGHT_DATA_API_TOKEN is not set in .env or the environment (needed by --research)');
}

// The Level 1 sessions use this machine's Claude Code login (norn/runner): its config directory, or a token.
const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) fine('Claude login: CLAUDE_CODE_OAUTH_TOKEN is set');
else if (existsSync(join(claudeDir, '.credentials.json'))) fine(`Claude login: credentials in ${claudeDir}`);
else bad(`no Claude login found in ${claudeDir}: run \`claude\` and /login once`);

for (const [port, what] of [[WEB_PORT, 'the web screens'], [MCP_PORT, 'the MCP server']] as const) {
  if (await reachable('127.0.0.1', port, 500)) bad(`port ${port} (${what}) is already in use: stop what holds it, or pass --web-port`);
  else fine(`port ${port} is free for ${what}`);
}

if (problems.length) {
  say(`${problems.length} problem(s); nothing started.`);
  process.exit(1);
}
if (CHECK_ONLY) {
  say('all checks passed (--check: nothing started)');
  process.exit(0);
}

// ---- processes ----------------------------------------------------------------------------------
const stateDir = join(norn, '.demo');
mkdirSync(stateDir, { recursive: true });
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NORN_DB: DB,
  ENV_FILE: envFile,
  NORN_MCP_PORT: String(MCP_PORT),
  NORN_MCP_URL: `http://127.0.0.1:${MCP_PORT}/mcp`,
  NORN_ERP_SETTINGS: join(repo, 'bowman', 'norn-config', 'erpnext.ts'),
  NORN_COMPANY_CONFIG: join(repo, 'bowman', 'norn-config', 'bowman.config.ts'),
  NORN_WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
  NORN_INGEST_SOURCE: 'plm',
  ...(ECRS.length ? { NORN_PLM_ECRS: ECRS.join(','), NORN_PUBLISH_ECRS: ECRS.join(',') } : {}),
};
const children: { name: string; p: ChildProcess }[] = [];
const seen = new Map<string, string[]>();
const width = 10;
function start(name: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) {
  const p = spawn(process.execPath, args, { cwd, env: { ...childEnv, WORKER_NAME: `demo-${name}`, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines: string[] = [];
  seen.set(name, lines);
  for (const s of [p.stdout!, p.stderr!])
    s.on('data', d => {
      for (const l of String(d).split(/\r?\n/).filter(Boolean)) {
        lines.push(l);
        if (lines.length > 200) lines.shift();
        console.log(`${name.padEnd(width)}| ${l}`);
      }
    });
  p.on('exit', code => say(`${name} exited (${code ?? 'signal'})`));
  children.push({ name, p });
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function ready(name: string, pattern: RegExp, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (seen.get(name)!.some(l => pattern.test(l))) return;
    await sleep(250);
  }
  throw new Error(`${name} did not become ready in ${ms / 1000} s`);
}
function stopAll() {
  for (const { p } of children) {
    if (!p.pid || p.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill('SIGTERM');
    } catch {}
  }
}
process.on('SIGINT', () => {
  say('stopping everything');
  stopAll();
  process.exit(0);
});

try {
  start('mcp', [tsxCli, 'mcp/src/main.ts'], norn, { NORN_MCP_STATE_DIR: join(stateDir, 'mcp-state') });
  await ready('mcp', /serving http/);
  start('worker', [tsxCli, 'src/worker.ts'], workers);
  await ready('worker', /read the baseline from ERPNext/);
  start('ingest', [tsxCli, 'src/ingest.ts'], workers);
  start('dispatch', [tsxCli, 'src/level1/dispatcher.ts'], workers, RESEARCH ? { NORN_L1_WAIT_FOR_RESEARCH: '1', ...(ECRS.length ? { NORN_L1_RESEARCH_ECRS: ECRS.join(',') } : {}) } : {});
  start('publish', [tsxCli, 'src/level1/publisher.ts'], workers);
  if (RESEARCH) start('research', [tsxCli, 'src/worker.ts'], join(norn, 'research'), ECRS.length ? { NORN_RESEARCH_ECRS: ECRS.join(',') } : {});
  start('web', [viteCli, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], join(norn, 'web'), { VITE_NORN_SOURCE: 'live', VITE_NORN_DB: DB });
  await Promise.all([ready('ingest', /watching the PLM/), ready('dispatch', /watching '/), ready('publish', /publishing Level 1/), ready('web', /ready in/), ...(RESEARCH ? [ready('research', /watching '/)] : [])]);
  say(`Norn is up on '${DB}'. Screens: http://127.0.0.1:${WEB_PORT}  (Ctrl-C stops everything)`);
} catch (e) {
  say(`start-up failed: ${(e as Error).message}`);
  stopAll();
  process.exit(1);
}
await new Promise<never>(() => {});
