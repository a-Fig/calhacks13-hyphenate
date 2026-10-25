// End to end, for #42, on a scratch database (never `norn`, `norn-test`, `norn-mcp` or `norn-live`):
// ECR-0417 is read from the real PLM, checked against the real ERP baseline (read only), a real Level 1
// agent session writes the statement, and the publisher puts it on the ECR in the PLM. Every step is
// timed. Then it proves the publisher and the dispatcher write and start nothing twice, takes a
// screenshot of the ECR's Impact assessment tab, and clears the seven fields again.
//
//   npm run level1:e2e -w @norn/workers -- [--model claude-haiku-5-5] [--no-clear] [--shot path.png]
//
// Needs: SpacetimeDB on 127.0.0.1:3000, the PLM tunnel (PLM_URL), the ERP tunnel (ERPNEXT_URL), the
// Claude login on this machine (one real session), and the .env of the main checkout (or ENV_FILE).
// It rebuilds the database `norn-l1` (wiping it), and refuses to start if ECR-0417 already carries
// an impact assessment, so it never overwrites a real one.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFileCandidates } from '../../../mcp/src/env.ts';

const DB = 'norn-l1'; // a literal on purpose: this script must never be able to reach another database
process.env.NORN_DB = DB;
const ECR = process.env.NORN_E2E_ECR ?? 'ECR-0417';
const MCP_PORT = 3927;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = arg('--model') ?? process.env.NORN_L1_MODEL ?? 'claude-haiku-5-5';
const clear = !process.argv.includes('--no-clear');

const here = dirname(fileURLToPath(import.meta.url));
const workers = resolve(here, '..', '..');
const norn = resolve(workers, '..');
const repo = resolve(norn, '..');
const tsxCli = join(norn, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const shot = resolve(arg('--shot') ?? join(here, 'screenshots', `${ECR.toLowerCase()}-impact-${model.includes('sonnet') ? 'sonnet' : 'haiku'}.png`));
const tmp = mkdtempSync(join(tmpdir(), 'norn-l1-'));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const say = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`);

const envFile = [process.env.ENV_FILE, ...envFileCandidates()].find(f => f && existsSync(f));
if (!envFile) throw new Error('no .env found: set ENV_FILE to the main checkout\'s .env');
const { plmFromConnector, plmOptionsFromEnv } = await import('./plm.ts');
process.env.ENV_FILE = envFile;
const plm = plmFromConnector(await plmOptionsFromEnv());
const { clearImpact } = await import('./plm-impact.ts');

// ---- before: the demo record must be clean -----------------------------------------------------------
const before = await plm.readImpact(ECR);
if (!before) throw new Error(`the PLM has no ${ECR}`);
if (Object.keys(before).length) throw new Error(`${ECR} already has an impact assessment in the PLM (${Object.keys(before).join(', ')}); not overwriting it. Clear it first with plm-impact.ts clear.`);

// ---- processes ------------------------------------------------------------------------------------
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NORN_DB: DB,
  ENV_FILE: envFile,
  NORN_MCP_PORT: String(MCP_PORT),
  NORN_MCP_URL: `http://127.0.0.1:${MCP_PORT}/mcp`,
  NORN_MCP_STATE_DIR: join(tmp, 'mcp-state'),
  NORN_BASELINE_CACHE_DIR: join(tmp, 'baselines'),
  NORN_ERP_SETTINGS: join(repo, 'bowman', 'norn-config', 'erpnext.ts'),
  NORN_L1_MODEL: model,
  NORN_PUBLISH_ECRS: ECR,
  NORN_PLM_ECRS: ECR,
  NORN_INGEST_SOURCE: 'plm',
};
const children: ChildProcess[] = [];
const procs: Record<string, ChildProcess> = {};
const logs = new Map<string, string[]>();
function start(name: string, script: string, cwd: string, extra: NodeJS.ProcessEnv = {}) {
  const p = spawn(process.execPath, [tsxCli, script], { cwd, env: { ...childEnv, WORKER_NAME: name, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines: string[] = [];
  logs.set(name, lines);
  for (const s of [p.stdout!, p.stderr!]) s.on('data', d => lines.push(...String(d).split(/\r?\n/).filter(Boolean)));
  children.push(p);
  procs[name] = p;
  return p;
}
function killTree(p: ChildProcess) {
  if (!p.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  } catch {}
}
async function ready(name: string, pattern: RegExp, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (logs.get(name)!.some(l => pattern.test(l))) return;
    await sleep(200);
  }
  throw new Error(`${name} did not become ready in ${ms / 1000} s; its last lines:\n${logs.get(name)!.slice(-8).join('\n')}`);
}
const spacetime = process.env.LOCALAPPDATA && existsSync(join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe')) ? join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe') : 'spacetime';

let ok = false;
const marks = new Map<string, number>();
const mark = (name: string, t = Date.now()) => {
  if (!marks.has(name)) {
    marks.set(name, t);
    say(`  [${name}]`);
  }
};

try {
  say(`publishing the module as '${DB}' (wiped)`);
  execFileSync(spacetime, ['publish', 'norn-l1', '--no-config', '--module-path', 'module', '--server', 'local', '--delete-data=always', '--yes'], { cwd: norn, stdio: 'ignore' });

  start('mcp', 'mcp/src/main.ts', norn);
  start('worker', 'src/worker.ts', workers);
  start('dispatcher', 'src/level1/dispatcher.ts', workers);
  start('publisher', 'src/level1/publisher.ts', workers);
  await ready('mcp', /serving http/);
  await ready('worker', /read the baseline from ERPNext/);
  await ready('dispatcher', /watching 'norn-l1'/);
  await ready('publisher', /publishing Level 1/);
  say(`up: MCP server, worker (ERPNext baseline, read only), dispatcher (${model}), publisher`);

  // ---- watch the database -----------------------------------------------------------------------------
  const { connect, subscribe } = await import('../connect.ts');
  const A = await connect({ kind: 'agent', name: 'level1-e2e', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
  await subscribe(A.conn, ['SELECT * FROM pull_request', 'SELECT * FROM check_run', 'SELECT * FROM impact_statement', 'SELECT * FROM agent_event', 'SELECT * FROM check_result', 'SELECT * FROM ecr_revision', 'SELECT * FROM principal']);
  const db = A.conn.db;
  db.pullRequest.onInsert((_c, r) => r.plmEcrNumber === ECR && mark('ECR in Norn'));
  db.checkRun.onUpdate((_c, _o, r) => {
    if (r.status !== 'done') return;
    if (r.stage === 's1_bom_delta') mark('s1 BOM delta done');
    if (r.stage === 's2_cost') mark('s2 cost done');
  });
  db.agentEvent.onInsert((_c, e) => {
    if (!e.role.startsWith('level1-')) return;
    if (e.eventType === 'job_queued') mark('session queued');
    if (e.eventType === 'job_started') mark('session started');
    if (e.eventType === 'tool_call') mark('first tool call');
    if (e.eventType === 'job_finished') mark('session finished');
  });
  db.impactStatement.onInsert(() => mark('statement in Norn'));

  // ---- ingest from the real PLM ------------------------------------------------------------------------
  say(`starting the PLM ingest for ${ECR}`);
  mark('ingest started');
  start('ingest', 'src/ingest.ts', workers);
  await ready('ingest', /watching the PLM/);

  // ---- wait for the statement in the PLM -------------------------------------------------------------------
  const deadline = Date.now() + 8 * 60_000;
  let written: Awaited<ReturnType<typeof plm.readImpact>> = null;
  for (;;) {
    const s = await plm.readImpact(ECR);
    if (s?.impact_statement?.includes('Ref ')) {
      written = s;
      mark('statement in PLM');
      break;
    }
    if (Date.now() > deadline) throw new Error(`no statement in the PLM after 8 minutes. Dispatcher:\n${logs.get('dispatcher')!.slice(-8).join('\n')}\nPublisher:\n${logs.get('publisher')!.slice(-5).join('\n')}`);
    await sleep(300);
  }
  const stamp1 = written!.impact_updated_on;

  // The screenshot first, while the statement is certainly there: other sessions use the same demo ECR.
  const { shootImpactTab } = await import('./screenshot.ts');
  let shotPath = '';
  try {
    shotPath = await shootImpactTab({ ecr: ECR, out: shot, expect: 'Bottom line' });
    say(`screenshot saved`);
  } catch (e) {
    say(`screenshot failed: ${(e as Error).message}`);
  }
  writeFileSync(join(tmp, 'plm-statement.html'), written!.impact_statement ?? '');

  // ---- what was posted, from Norn's own record ---------------------------------------------------------------
  const pr = [...db.pullRequest.iter()].find(p => p.plmEcrNumber === ECR)!;
  const st = [...db.impactStatement.prId.filter(pr.id)].sort((a, b) => Number(b.id - a.id))[0]!;
  const principal = [...db.principal.iter()].find(p => p.identity.isEqual(st.author));
  const events = [...db.agentEvent.iter()].filter(e => e.role.startsWith('level1-'));
  const toolCalls = events.filter(e => e.eventType === 'tool_call').map(e => (JSON.parse(e.payloadJson).tool as string).replace('mcp__norn__', ''));
  const fin = events.find(e => e.eventType === 'job_finished');
  const finP = fin ? JSON.parse(fin.payloadJson) : {};
  const result = events.find(e => e.eventType === 'result');
  const resP = result ? JSON.parse(result.payloadJson) : {};

  // ---- idempotency: nothing written or started twice -----------------------------------------------------------
  say('checking that nothing is written or started twice (restarting the publisher and the dispatcher)...');
  const jobIds = () => new Set([...db.agentEvent.iter()].filter(e => e.role.startsWith('level1-')).map(e => e.jobId));
  const jobsBefore = jobIds().size;
  killTree(procs.dispatcher!);
  killTree(procs.publisher!);
  await sleep(1000);
  start('dispatcher2', 'src/level1/dispatcher.ts', workers, { WORKER_NAME: 'level1-dispatcher' });
  start('publisher2', 'src/level1/publisher.ts', workers, { WORKER_NAME: 'level1-publisher' });
  await ready('dispatcher2', /watching 'norn-l1'/);
  await ready('publisher2', /publishing Level 1/);
  await sleep(10_000);
  const after = await plm.readImpact(ECR);
  const restartedDispatched = logs.get('dispatcher2')!.some(l => /starting l1-/.test(l));
  const publisherWrote = logs.get('publisher2')!.some(l => /wrote Level/.test(l));
  const idem = {
    plmStampUnchanged: after?.impact_updated_on === stamp1,
    plmStillHoldsOurRef: (after?.impact_statement ?? '').includes(`Ref ${written!.impact_statement!.match(/Ref ([^<\s]+)</)?.[1]}`),
    secondPublisherWrote: publisherWrote,
    dispatcherStartedAgain: restartedDispatched,
    sessionsBefore: jobsBefore,
    sessionsAfter: jobIds().size,
  };

  // ---- put the record back ------------------------------------------------------------------------------------------

  let cleared = 'left in place (--no-clear)';
  if (clear) {
    const c = await clearImpact(plm, ECR);
    const again = await plm.readImpact(ECR);
    cleared = Object.keys(c).length === 0 && Object.keys(again ?? {}).length === 0 ? 'all seven fields empty again' : `NOT clean: ${Object.keys(again ?? {}).join(', ')}`;
  }

  // ---- the report ---------------------------------------------------------------------------------------------------
  const t0 = marks.get('ECR in Norn')!;
  console.log('\n==== timings (from the ECR reaching Norn) ====');
  for (const [name, t] of [...marks.entries()].sort((a, b) => a[1] - b[1])) console.log(`${((t - t0) / 1000).toFixed(2).padStart(8)} s  ${name}`);
  const t = (n: string) => marks.get(n);
  const span = (a: string, b: string) => (t(a) !== undefined && t(b) !== undefined ? `${((t(b)! - t(a)!) / 1000).toFixed(1)} s` : 'n/a');
  console.log(`\nECR in Norn to s2 done: ${span('ECR in Norn', 's2 cost done')}; s2 done to session started: ${span('s2 cost done', 'session started')}; session: ${span('session started', 'session finished')}; statement in Norn to PLM: ${span('statement in Norn', 'statement in PLM')}`);
  console.log(`ECR in Norn to statement in PLM: ${span('ECR in Norn', 'statement in PLM')}`);
  console.log(`\nsession: ${model}, ${finP.status ?? '?'} in ${finP.durationMs ? (finP.durationMs / 1000).toFixed(1) : '?'} s, ${finP.numTurns ?? '?'} turns, tools: ${toolCalls.join(', ')}; usage ${JSON.stringify(resP.usage ?? {})}`);
  console.log(`actor ${principal?.name ?? '(see action_log)'}; statement id ${st.id}, Level ${st.level}, written at ECR revision ${st.prRevision}`);
  console.log('\n==== idempotency ====');
  console.log(JSON.stringify(idem));
  console.log('\n==== the statement as posted ====');
  console.log(`class: ${st.changeClass}   route: ${st.route}\nheadline: ${st.headline}`);
  for (const n of st.numbers) console.log(`number [${n.evidence}] ${n.label}: ${n.p10} / ${n.p50} / ${n.p90} ${n.unit}  (${n.resultKey})`);
  for (const d of st.drivers) console.log(`driver [${d.evidence}] ${d.text}`);
  for (const a of st.assumptions) console.log(`assumption ${a.key} (${a.source}): ${a.note}`);
  for (const c of st.claims) console.log(`claim [${c.evidence}] ${c.text}`);
  console.log('\n==== the PLM ====');
  for (const [k, v] of Object.entries(written!)) console.log(`${k}: ${k === 'impact_statement' ? `${v!.length} characters of HTML (saved to ${join(tmp, 'plm-statement.html')})` : v}`);
  console.log(`\nscreenshot: ${shotPath || '(none)'}\nafter: ${cleared}`);
  // If the stamp moved and our ref is gone, another session wrote to the demo ECR in between (not the publisher: its log shows no write).
  const pass = (idem.plmStampUnchanged || !idem.plmStillHoldsOurRef) && !idem.secondPublisherWrote && !idem.dispatcherStartedAgain && idem.sessionsBefore === idem.sessionsAfter && (!clear || cleared.startsWith('all seven'));
  console.log(pass ? '\nPASS' : '\nFAIL: see the idempotency and cleanup lines above');
  ok = pass;
  A.close();
} catch (e) {
  console.error(`\nFAILED: ${(e as Error).message}`);
  for (const [name, lines] of logs) console.error(`--- ${name}\n${lines.slice(-6).join('\n')}`);
} finally {
  // Stop the publisher first: it sweeps every 15 s and would write the statement again after the clear.
  for (const c of children) killTree(c);
  await sleep(1_000);
  // Whatever happened, do not leave the demo ECR carrying a test statement unless asked.
  if (clear) {
    try {
      const s = await plm.readImpact(ECR);
      if (s && Object.keys(s).length) {
        await clearImpact(plm, ECR);
        say(`cleared the impact fields of ${ECR} again`);
      }
    } catch (e) {
      console.error(`COULD NOT CLEAR ${ECR}: ${(e as Error).message}. Run: npx tsx src/level1/plm-impact.ts clear ${ECR}`);
    }
  }
  mkdirSync(tmp, { recursive: true });
  for (const [name, lines] of logs) writeFileSync(join(tmp, `${name}.log`), lines.join('\n'));
  console.log(`process logs: ${tmp}`);
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}
