// Spike 4: kill a worker in the middle of a Monte Carlo run. Its lease must expire and another
// worker must pick the run up and finish it, with no duplicate results.
//   npx tsx workers/src/spike/s4-crash.ts      (from norn/; SpacetimeDB running, module published)
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, connect, subscribe } from '../connect.ts';
import { sleep } from '../sim.ts';

const WORKERS = join(import.meta.dirname, '..', '..');
const OUT = join(WORKERS, '..', 'spike-out');
mkdirSync(OUT, { recursive: true });

// Start from an empty database: leftover queued runs from other spikes would compete for workers.
const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
const cliEnv = { ...process.env, [pathKey]: `${process.env[pathKey]};${join(process.env.LOCALAPPDATA ?? '', 'SpacetimeDB')}` };
execSync('npm run db:reset', { cwd: join(WORKERS, '..'), env: cliEnv, stdio: 'ignore' });

const procs = new Map<string, ChildProcess>();
function start(name: string, extra: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    cwd: WORKERS,
    env: { ...process.env, WORKER_NAME: name, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(OUT, `${name}.log`));
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  procs.set(name, child);
}
const kill = (name: string) => procs.get(name)?.kill('SIGKILL'); // TerminateProcess: nothing in the worker gets to clean up
const stopAll = () => [...procs.keys()].forEach(kill);

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};
const out: Record<string, unknown> = {};

const O = await connect({ kind: 'agent', name: 'spike-observer', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(O.conn, ['SELECT * FROM check_run', 'SELECT * FROM check_progress', 'SELECT * FROM check_result', 'SELECT * FROM pull_request']);

// Row changes with the time we saw them. Polling would miss a state that lasts a few milliseconds
// (a requeued run is claimed again almost at once).
const events: { t: number; run: bigint; status: string; attempts: number; by: string | undefined; note: string }[] = [];
const rec = (r: { id: bigint; status: string; attempts: number; claimedByName?: string | undefined; note: string }) =>
  events.push({ t: Date.now(), run: r.id, status: r.status, attempts: r.attempts, by: r.claimedByName ?? undefined, note: r.note });
O.conn.db.checkRun.onInsert((_c, r) => rec(r));
O.conn.db.checkRun.onUpdate((_c, _o, r) => rec(r));

async function newPr(title: string) {
  const before = new Set([...O.conn.db.pullRequest.iter()].map(p => p.id));
  await O.conn.reducers.createPr({ title, description: 'spike' });
  for (let i = 0; i < 100; i++) {
    const pr = [...O.conn.db.pullRequest.iter()].find(p => !before.has(p.id) && p.title === title);
    if (pr) return pr;
    await sleep(20);
  }
  throw new Error('no ECR');
}
const s4 = (prId: bigint) => [...O.conn.db.checkRun.iter()].find(r => r.prId === prId && r.stage === 's4_supply' && r.status !== 'stale');
async function until<T>(what: string, fn: () => T | undefined | false, ms = 90000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

try {
  const LEASE = '4000';
  // z does the cheap stages; x and y both can run the Monte Carlo stage
  start('crash-z', { NORN_STAGES: 's1_bom_delta,s2_cost,s3_timeline' });
  start('crash-x', { NORN_STAGES: 's4_supply', NORN_LEASE_MS: LEASE });
  await sleep(3000);

  // ---- A. kill the worker holding the run; another takes over
  const pr = await newPr('spike crash recovery');
  const first = await until('x to claim the Monte Carlo run', () => { const r = s4(pr.id); return r?.status === 'running' && r; });
  start('crash-y', { NORN_STAGES: 's4_supply', NORN_LEASE_MS: LEASE });
  const prog = await until('progress to pass 25%', () => { const p = O.conn.db.checkProgress.checkRunId.find(first.id); return p && p.done >= 5000 && p; });
  const killedAtDone = prog ? prog.done : 0;
  const tKill = Date.now();
  kill('crash-x');
  console.log(`killed crash-x at ${killedAtDone}/20000 draws, attempt ${first.attempts}, lease was ${LEASE} ms`);

  const requeuedEv = await until('the lease to expire and the run to return to the queue', () => events.find(e => e.run === first.id && e.status === 'queued' && e.t >= tKill));
  const tRequeued = requeuedEv.t;
  const requeued = { status: requeuedEv.status, note: requeuedEv.note };
  const reclaimedEv = await until('another worker to claim it', () => events.find(e => e.run === first.id && e.status === 'running' && e.attempts === 2));
  const tReclaimed = reclaimedEv.t;
  const reclaimed = { claimedByName: reclaimedEv.by };
  const done = await until('the run to finish', () => { const r = s4(pr.id); return r?.status === 'done' && r; }, 120000);
  const tDone = Date.now();
  const results = [...O.conn.db.checkResult.iter()].filter(r => r.checkRunId === first.id);
  const leftoverProgress = O.conn.db.checkProgress.checkRunId.find(first.id);
  const sameRun = first.id === done.id;
  out.crash = {
    killedAtDraws: killedAtDone,
    leaseMs: Number(LEASE),
    killToRequeueMs: tRequeued - tKill,
    requeueToReclaimMs: tReclaimed - tRequeued,
    reclaimToDoneMs: tDone - tReclaimed,
    requeueNote: requeued.note,
    attemptsAtEnd: done.attempts,
    reclaimedByDifferentIdentity: reclaimed.claimedByName !== 'crash-x',
    reclaimedByName: reclaimed.claimedByName,
    resultRows: results.map(r => r.key),
  };
  console.log(JSON.stringify(out.crash, null, 2));
  check('killed worker: its lease expired and the run went back to the queue', requeued.status === 'queued' && requeued.note.includes('lease expired'), `${tRequeued - tKill} ms after the kill (lease ${LEASE} ms, reaper every 5 s); note: ${requeued.note}`);
  check('a different worker claimed the same run (attempt 2) and finished it', sameRun && done.attempts === 2 && reclaimed.claimedByName !== 'crash-x', `claimed by ${reclaimed.claimedByName} ${tReclaimed - tRequeued} ms after the requeue; finished ${tDone - tReclaimed} ms later`);
  check('exactly one set of results, no leftover progress row from the dead worker', results.length === 2 && !leftoverProgress, `result rows: ${results.map(r => r.key).join(', ')}`);

  // ---- B. attempts used up: the run fails instead of looping
  kill('crash-y');
  await O.conn.reducers.setConfig({ key: 'max_attempts', value: '1' });
  start('crash-x2', { NORN_STAGES: 's4_supply', NORN_LEASE_MS: LEASE });
  await sleep(3000);
  const pr2 = await newPr('spike attempts exhausted');
  const r2 = await until('x2 to claim', () => { const r = s4(pr2.id); return r?.status === 'running' && r; });
  await until('some progress', () => O.conn.db.checkProgress.checkRunId.find(r2.id));
  const tKill2 = Date.now();
  kill('crash-x2');
  const failed = await until('the run to be given up on', () => { const r = s4(pr2.id); return r?.status === 'failed' && r; });
  const failedEv = events.find(e => e.run === r2.id && e.status === 'failed')!;
  out.exhausted = { killToFailedMs: failedEv.t - tKill2, note: failed.note, attempts: failed.attempts, maxAttempts: failed.maxAttempts };
  check('with max_attempts=1 a killed worker\'s run ends as failed (not requeued forever)', failed.attempts === 1 && failed.note.includes('giving up'), `${failedEv.t - tKill2} ms after the kill; ${failed.note}`);
  await O.conn.reducers.setConfig({ key: 'max_attempts', value: '3' });

  // ---- C. the action log names the reaper, not a person
  await sleep(300);
} catch (e) {
  check('script ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  stopAll();
  O.close();
  writeFileSync(join(OUT, 's4.json'), JSON.stringify({ checks, ...out }, null, 2));
  console.log(checks.every(c => c.ok) ? 'ALL CHECKS PASSED' : `${checks.filter(c => !c.ok).length} CHECK(S) FAILED`);
  process.exit(checks.every(c => c.ok) ? 0 : 1);
}
void classify;
