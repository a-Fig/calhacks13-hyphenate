// Spike 1: a TypeScript worker claims a check run, writes results, hits reducer errors. Is the
// error behaviour reliable enough to build retries on? Plays the worker itself with two
// SDK clients so every step can be checked against the database.
//   npx tsx workers/src/spike/s1-errors.ts      (from norn/, with no real worker running)
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { classify, connect, subscribe, withRetry, type Client } from '../connect.ts';
import { sleep } from '../sim.ts';

const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${process.env[pathKey]};${join(process.env.LOCALAPPDATA ?? '', 'SpacetimeDB')}` };
const sql = (q: string) =>
  execSync(`spacetime sql norn "${q}" --no-config --server local`, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const count = (q: string) => Number(sql(q).split('\n').filter(l => /^\s*\d+\s*$/.test(l))[0]);

const out: Record<string, unknown> = {};
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};
const percentile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;

const mk = (name: string) => connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const A = await mk('spike-a');
const B = await mk('spike-b');
const C = await mk('spike-c');
const ALL = ['SELECT * FROM check_run', 'SELECT * FROM pull_request', 'SELECT * FROM assumption'];
for (const c of [A, B, C]) await subscribe(c.conn, ALL);

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: unknown }> {
  const t = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - t, value };
  } catch (error) {
    return { ms: performance.now() - t, error };
  }
}

async function newPr(c: Client, title: string) {
  const before = new Set([...c.conn.db.pullRequest.iter()].map(p => p.id));
  await c.conn.reducers.createPr({ title, description: 'spike' });
  for (let i = 0; i < 100; i++) {
    const pr = [...c.conn.db.pullRequest.iter()].find(p => !before.has(p.id) && p.title === title);
    if (pr) return pr;
    await sleep(20);
  }
  throw new Error('new ECR never showed up');
}
async function runOf(c: Client, prId: bigint, stage: string) {
  for (let i = 0; i < 100; i++) {
    const r = [...c.conn.db.checkRun.iter()].find(r => r.prId === prId && r.stage === stage && r.status !== 'stale');
    if (r) return r;
    await sleep(20);
  }
  throw new Error(`no ${stage} run for ECR ${prId}`);
}

// ---- 1. what each kind of failure looks like to the caller, and whether its writes are undone
const taxonomy: Record<string, unknown>[] = [];
const warm = await timed(() => A.conn.reducers.spikeFail({ mode: 'warmup-ok' })); // unknown mode: acts like ok
void warm;
const baseline: number[] = [];
for (let i = 0; i < 20; i++) baseline.push((await timed(() => A.conn.reducers.spikeFail({ mode: 'ok' }))).ms);
for (const mode of ['sender', 'internal', 'type']) {
  const logBefore = count(`select count(*) as n from action_log where summary = 'spike_fail mode=${mode} (this row must exist only when mode=ok)'`);
  const r = await timed(() => A.conn.reducers.spikeFail({ mode }));
  const next = await timed(() => A.conn.reducers.spikeFail({ mode: 'ok' }));
  const logAfter = count(`select count(*) as n from action_log where summary = 'spike_fail mode=${mode} (this row must exist only when mode=ok)'`);
  const c = classify(r.error);
  taxonomy.push({ mode, clientError: c.name, message: c.message, retry: c.retry, writeRolledBack: logAfter === logBefore, callMs: +r.ms.toFixed(1), nextCallMs: +next.ms.toFixed(1) });
}
out.taxonomy = taxonomy;
out.okCallMs = { p50: +percentile(baseline, 0.5).toFixed(1), p95: +percentile(baseline, 0.95).toFixed(1) };
console.table(taxonomy);
check('a SenderError reaches the caller as SenderError with the module\'s message', taxonomy[0]!.clientError === 'SenderError' && String(taxonomy[0]!.message).includes('SenderError after a write'));
check('a plain Error or TypeError in the module reaches the caller as InternalError with a generic message', taxonomy[1]!.clientError === 'InternalError' && taxonomy[2]!.clientError === 'InternalError', JSON.stringify([taxonomy[1]!.message, taxonomy[2]!.message]));
check('every failing reducer rolled back its earlier writes in the same call', taxonomy.every(t => t.writeRolledBack));
check('the module keeps serving normally right after an uncaught exception', taxonomy.every(t => (t.nextCallMs as number) < 100), `next call ms: ${taxonomy.map(t => t.nextCallMs).join(', ')}; normal p50 ${out.okCallMs && (out.okCallMs as { p50: number }).p50} ms`);

// ---- 2. claim races: many ECRs, two workers race for the same run
const RACES = 20;
const wins = { a: 0, b: 0, none: 0, both: 0 };
const loserMessages = new Set<string>();
const raceRuns: bigint[] = [];
for (let i = 0; i < RACES; i++) {
  const pr = await newPr(A, `spike race ${i}`);
  const run = await runOf(A, pr.id, 's1_bom_delta');
  raceRuns.push(run.id);
  const [ra, rb] = await Promise.allSettled([A.conn.reducers.claimCheck({ checkRunId: run.id, leaseMs: 30000 }), B.conn.reducers.claimCheck({ checkRunId: run.id, leaseMs: 30000 })]);
  if (ra.status === 'fulfilled' && rb.status === 'fulfilled') wins.both++;
  else if (ra.status === 'fulfilled') { wins.a++; loserMessages.add(classify((rb as PromiseRejectedResult).reason).name + ': ' + classify((rb as PromiseRejectedResult).reason).message.replace(/\d+/g, 'N')); }
  else if (rb.status === 'fulfilled') { wins.b++; loserMessages.add(classify((ra as PromiseRejectedResult).reason).name + ': ' + classify((ra as PromiseRejectedResult).reason).message.replace(/\d+/g, 'N')); }
  else wins.none++;
}
await sleep(300);
const claimedOnce = raceRuns.every(id => A.conn.db.checkRun.id.find(id)?.attempts === 1);
out.race = { RACES, ...wins, loserMessages: [...loserMessages] };
check(`${RACES} simultaneous claims by two workers: exactly one winner each time`, wins.both === 0 && wins.none === 0 && wins.a + wins.b === RACES && claimedOnce, `${JSON.stringify(wins)}; every run has attempts=1: ${claimedOnce}; loser sees: ${[...loserMessages].join(' | ')}`);

// ---- 3. write results, hit a validation error halfway, nothing is half-written
const prW = await newPr(A, 'spike results');
const runW = await runOf(A, prW.id, 's1_bom_delta');
await A.conn.reducers.claimCheck({ checkRunId: runW.id, leaseMs: 30000 });
await sleep(150);
const attempt = A.conn.db.checkRun.id.find(runW.id)!.attempts;
const good = (key: string) => ({ key, label: key, unit: 'x', p10: 1, p50: 2, p90: 3, detailJson: '{"mock":true}' });
const bad = { ...good('bad'), p10: 5, p50: 2, p90: 3 };
const logBefore = count(`select count(*) as n from action_log where entity = 'check_run:${runW.id}'`);
const fail = await timed(() => A.conn.reducers.completeCheck({ checkRunId: runW.id, attempt, results: [good('r1'), good('r2'), bad] }));
const leftover = count(`select count(*) as n from check_result where check_run_id = ${runW.id}`);
const statusAfterFail = sql(`select status from check_run where id = ${runW.id}`).includes('running');
const logAfter = count(`select count(*) as n from action_log where entity = 'check_run:${runW.id}'`);
check('complete_check with a bad third result is rejected and leaves no partial results, the run stays running, and no log row is left', classify(fail.error).name === 'SenderError' && leftover === 0 && statusAfterFail && logAfter === logBefore, `error: ${classify(fail.error).message}; result rows left: ${leftover}; log rows added: ${logAfter - logBefore}`);
const okRes = await timed(() => A.conn.reducers.completeCheck({ checkRunId: runW.id, attempt, results: [good('r1'), good('r2'), good('r3')] }));
const saved = count(`select count(*) as n from check_result where check_run_id = ${runW.id}`);
check('the corrected complete_check stores all three results and marks the run done', okRes.error === undefined && saved === 3 && sql(`select status from check_run where id = ${runW.id}`).includes('done'), `${okRes.ms.toFixed(1)} ms`);

// ---- 4. fencing: wrong worker, wrong attempt, already finished
const again = await timed(() => A.conn.reducers.completeCheck({ checkRunId: runW.id, attempt, results: [good('r1')] }));
const prF = await newPr(A, 'spike fencing');
const runF = await runOf(A, prF.id, 's1_bom_delta');
await A.conn.reducers.claimCheck({ checkRunId: runF.id, leaseMs: 30000 });
await sleep(150);
const attF = A.conn.db.checkRun.id.find(runF.id)!.attempts;
const byB = await timed(() => B.conn.reducers.completeCheck({ checkRunId: runF.id, attempt: attF, results: [good('x')] }));
const wrongAttempt = await timed(() => A.conn.reducers.completeCheck({ checkRunId: runF.id, attempt: attF + 5, results: [good('x')] }));
out.fencing = { alreadyDone: classify(again.error).message, otherWorker: classify(byB.error).message, wrongAttempt: classify(wrongAttempt.error).message };
check('a finished run, another worker, and a wrong attempt number are each rejected with a SenderError', [again, byB, wrongAttempt].every(r => classify(r.error).name === 'SenderError'), JSON.stringify(out.fencing));

// ---- 5. inputs change while a worker holds the run: its result is refused as stale
const staleKey = 'spike_stale_key';
await C.conn.reducers.recordAssumption({ prId: prF.id, key: staleKey, distJson: '{"kind":"fixed","value":1}', source: 'given', rationale: 'spike', affects: ['s1_bom_delta'], expectedRev: 0 });
await sleep(150);
const staleTry = await timed(() => A.conn.reducers.completeCheck({ checkRunId: runF.id, attempt: attF, results: [good('x')] }));
const staleProgress = await timed(() => A.conn.reducers.reportProgress({ checkRunId: runF.id, attempt: attF, done: 1, total: 2, percentiles: [1], histogram: [1], histMin: 0, histMax: 1, leaseMs: 5000 }));
check('after someone edits an input, the holder\'s complete_check and report_progress are refused with a "stale" message', classify(staleTry.error).message.includes('stale') && classify(staleProgress.error).message.includes('stale'), `${classify(staleTry.error).message}`);

// ---- 6. what the SDK says when the connection is gone, and what the retry helper does with each class
const D = await mk('spike-d');
D.conn.disconnect();
await sleep(200);
const afterClose = await timed(() => D.conn.reducers.createPr({ title: 'spike after close', description: '' }));
const E = await mk('spike-e');
const inflight = E.conn.reducers.createPr({ title: 'spike in flight', description: '' });
E.conn.disconnect();
const inflightRes = await inflight.then(() => ({ resolved: true } as const), e => ({ resolved: false, cls: classify(e) }));
await sleep(500);
const inflightCreated = count(`select count(*) as n from pull_request where title = 'spike in flight'`);
out.disconnect = { afterClose: classify(afterClose.error), inflight: inflightRes, inflightCreated };
console.log('after disconnect:', JSON.stringify(out.disconnect));
check('a call made after disconnect fails with DisconnectedError (never sent: safe to retry after reconnect)', classify(afterClose.error).name === 'DisconnectedError', classify(afterClose.error).message);

let tries = 0;
const t0 = Date.now();
const rInternal = await withRetry(() => { tries++; return A.conn.reducers.spikeFail({ mode: 'internal' }); }, { tries: 3, label: 'spike_fail internal' }).catch(e => classify(e));
const internalTries = tries;
tries = 0;
await withRetry(() => { tries++; return A.conn.reducers.claimCheck({ checkRunId: 999999n, leaseMs: 1000 }); }, { tries: 3, label: 'claim_check' }).catch(() => {});
out.retryPolicy = { internalErrorAttempts: internalTries, internalElapsedMs: Date.now() - t0, senderErrorAttempts: tries };
check('retry helper: InternalError is retried up to the limit, SenderError is never retried', internalTries === 3 && tries === 1, JSON.stringify(out.retryPolicy));

// ---- 7. do callbacks see a whole transaction? (the base of "atomic on every screen")
const prT = await newPr(A, 'spike atomic');
const runsT = await Promise.all(['s1_bom_delta', 's2_cost'].map(s => runOf(A, prT.id, s)));
void runsT;
const seen: { table: string; revision: number; stale: number; queued: number; assumptions: number }[] = [];
const snap = (table: string) => () => {
  const runs = [...A.conn.db.checkRun.iter()].filter(r => r.prId === prT.id && r.stage === 's2_cost');
  seen.push({
    table,
    revision: A.conn.db.pullRequest.id.find(prT.id)!.revision,
    stale: runs.filter(r => r.status === 'stale').length,
    queued: runs.filter(r => r.status === 'queued').length,
    assumptions: [...A.conn.db.assumption.iter()].filter(a => a.prId === prT.id).length,
  });
};
const rev0 = A.conn.db.pullRequest.id.find(prT.id)!.revision;
A.conn.db.assumption.onInsert(snap('assumption.insert'));
A.conn.db.checkRun.onInsert(snap('check_run.insert'));
A.conn.db.checkRun.onUpdate(snap('check_run.update'));
A.conn.db.pullRequest.onUpdate(snap('pull_request.update'));
await C.conn.reducers.recordAssumption({ prId: prT.id, key: 'spike_atomic_key', distJson: '{"kind":"fixed","value":2}', source: 'given', rationale: 'spike', affects: ['s2_cost'], expectedRev: 0 });
await sleep(400);
out.callbackSnapshots = seen;
console.table(seen);
const whole = seen.length >= 4 && seen.every(s => s.revision === rev0 + 1 && s.stale === 1 && s.queued === 1 && s.assumptions === 1);
check('inside every row callback of one edit, the cache already holds the whole transaction (new revision, old run stale, new run queued, new assumption)', whole, `${seen.length} callbacks`);

for (const c of [A, B, C, E]) c.close();
console.log(checks.every(c => c.ok) ? 'ALL CHECKS PASSED' : `${checks.filter(c => !c.ok).length} CHECK(S) FAILED`);
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync(new URL('../../../spike-out', import.meta.url), { recursive: true });
writeFileSync(new URL('../../../spike-out/s1.json', import.meta.url), JSON.stringify({ checks, ...out }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
process.exit(checks.every(c => c.ok) ? 0 : 1);
