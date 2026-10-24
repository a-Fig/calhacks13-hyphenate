// Norn compute worker. Subscribes to queued check runs, claims the ones it can do, keeps the lease
// alive, streams progress, writes results. Run several to see claims race and leases recover:
//   WORKER_NAME=w1 npm run worker        (from norn/)
// s1 and s2 run Norn's impact checks (impact.ts) on ECRs the PLM has sent a change request for, on
// the ERP baseline (baseline.ts); every other stage, and an ECR with no change request, is mock
// compute (stages.ts), and the logs and results say so.
//   NORN_ERP_SETTINGS=<module exporting erpnext>   the company's ERPNext settings; the connection comes from the .env
//   NORN_BASELINE_FILE=<baseline.json>             a test baseline instead of the ERP
//   NORN_BASELINE_POLL_MS                          how often to re-read the baseline (default 60000)
//   NORN_COMPANY_CONFIG=<file>                     the company's Norn configuration, validated at start-up and stored (config.ts)
import { BaselineStore, baselineSourceFromEnv } from './baseline.ts';
import { classify, connect, subscribe, withRetry } from './connect.ts';
import { applyStartupConfig, loadStartupConfig, refusalLines } from './config.ts';
import { CHECKS_CODE_VERSION } from '../../checks/src/index.ts';
import { REAL_STAGES, impactHandlers } from './impact.ts';
import { sleep } from './sim.ts';
import { AbortedError, FatalRunError, HANDLERS as MOCK_HANDLERS, type Result, type RunCtx } from './stages.ts';

const name = process.env.WORKER_NAME ?? `worker-${process.pid}`;
const handled = (process.env.NORN_STAGES?.split(',') ?? Object.keys(MOCK_HANDLERS)).map(s => s.trim());
const concurrency = Number(process.env.NORN_CONCURRENCY ?? 2);
const leaseMs = Number(process.env.NORN_LEASE_MS ?? 10_000);

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${name}] ${msg}`);

// The company config (#59, config.ts) is read and validated before anything connects, so a malformed
// file stops Norn with the validator's problems and nothing changed. NORN_COMPANY_CONFIG=<file>
const startupConfig = await loadStartupConfig();
if (startupConfig.kind === 'invalid') {
  for (const line of refusalLines(startupConfig)) console.error(`[${name}] ${line}`);
  process.exit(1);
}

const client = await connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' });
const { conn, identity, R } = client;
const baselines = new BaselineStore(await baselineSourceFromEnv(), r =>
  withRetry(
    () => R.recordBaseline({ hash: r.hash, asOf: r.asOf, source: r.source, countsJson: JSON.stringify(r.counts), warningsJson: JSON.stringify(r.warnings.slice(0, 50)) }),
    { idempotent: true, label: 'record_baseline' }
  ).then(() => undefined)
);
const HANDLERS: Record<string, (ctx: RunCtx) => Promise<Result[]>> = { ...MOCK_HANDLERS, ...impactHandlers(conn, baselines) };
log(
  `connected as ${identity.toHexString().slice(0, 12)}; stages ${handled.join(',')}; s1 and s2 are Norn's impact checks on ECRs with a change request, ` +
    `baseline from ${baselines.source?.describe ?? 'nowhere (no source configured: those runs will fail)'}; everything else is MOCK compute`
);

// Queued runs to pick from, plus running ones: a claimed run leaves the first query the moment it
// becomes 'running', and we need our attempt number from the server. (claimed_by is an Option
// column and SQL subscriptions cannot compare it to a literal, so we filter on identity here.)
await subscribe(conn, [
  "SELECT * FROM check_run WHERE status = 'queued'",
  "SELECT * FROM check_run WHERE status = 'running'",
  // What the real checks read: the change requests, the assumptions a run names, the baselines recorded.
  'SELECT * FROM ecr_revision',
  'SELECT * FROM assumption',
  'SELECT * FROM baseline_snapshot',
  'SELECT * FROM norn_config',
]);
// Store the config if it differs from what the module holds (norn_config is in the cache now).
await applyStartupConfig(client, startupConfig, log).catch(e => {
  console.error(`[${name}] Norn did not start: ${e instanceof Error ? e.message : String(e)}`);
  client.close();
  process.exit(1);
});
const configured = conn.db.nornConfig.key.find('code_version')?.value ?? 'checks-0.2.0';
if (configured !== CHECKS_CODE_VERSION)
  log(`WARNING: norn_config code_version is '${configured}' but the checks library is '${CHECKS_CODE_VERSION}': results of the old library still count as current. Set code_version to '${CHECKS_CODE_VERSION}'.`);

type RunRow = NonNullable<ReturnType<typeof conn.db.checkRun.id.find>>;
const active = new Map<bigint, number>(); // run id -> attempt we hold (0 while claiming)
const skipUntil = new Map<bigint, number>();
let pumping = false;
let dirty = false;

// A real check needs the baseline its run names. A worker that cannot produce it leaves the run
// for one that can, instead of failing it for everyone.
function canServe(r: RunRow): boolean {
  if (!REAL_STAGES.includes(r.stage)) return true;
  const inputs = JSON.parse(r.inputsJson) as { revision?: number; erpBaseline?: string };
  if (inputs.revision === undefined) return true; // no change request: the mock handler
  return baselines.canProvide(inputs.erpBaseline);
}

function candidates() {
  const now = Date.now();
  return [...conn.db.checkRun.iter()]
    .filter(r => r.status === 'queued' && handled.includes(r.stage) && !active.has(r.id) && (skipUntil.get(r.id) ?? 0) <= now && canServe(r))
    // requested (a person is waiting) before automatic; then oldest first
    .sort((a, b) => Number(a.trigger !== 'requested') - Number(b.trigger !== 'requested') || Number(a.id - b.id));
}

async function waitForClaim(id: bigint): Promise<RunRow> {
  const t0 = Date.now();
  for (;;) {
    const r = conn.db.checkRun.id.find(id);
    if (r && r.status === 'running' && r.claimedBy?.isEqual(identity)) return r;
    if (Date.now() - t0 > 3000) throw new Error(`claimed run ${id} never showed up in the local cache`);
    await sleep(15);
  }
}

// We hold the run on the server. Find out our attempt number and start working. If the row does not
// show up in our cache we cannot fence our calls, so we leave the run alone: its lease expires,
// the reaper requeues it, and someone (maybe us) takes it again.
async function adopt(id: bigint) {
  let run: RunRow;
  try {
    run = await waitForClaim(id);
  } catch (e) {
    active.delete(id);
    skipUntil.set(id, Date.now() + leaseMs);
    log(`gave up on run ${id}: ${(e as Error).message}; its lease will expire and it will be requeued`);
    return;
  }
  active.set(id, run.attempts);
  log(`claimed run ${id} ${run.stage} (pr ${run.prId}, ${run.trigger}), attempt ${run.attempts}/${run.maxAttempts}`);
  void execute(run);
}

async function tryClaim(id: bigint) {
  active.set(id, 0);
  try {
    await withRetry(() => R.claimCheck({ checkRunId: id, leaseMs }), { label: `claim_check ${id}` });
  } catch (e) {
    const c = classify(e);
    if (c.name === 'UnknownCallResultError') {
      // The connection dropped mid-call: the claim may have landed. Ask the cache before giving up,
      // otherwise the lease would sit unused until it expires.
      await sleep(500);
      const r = conn.db.checkRun.id.find(id);
      if (r?.status === 'running' && r.claimedBy?.isEqual(identity)) {
        log(`claim of run ${id} had landed despite ${c.name}`);
        await adopt(id);
        return;
      }
    }
    active.delete(id);
    // Lost the race, or waiting on a dependency stage: look again later, quietly.
    skipUntil.set(id, Date.now() + (c.message.includes('waiting for') ? 1500 : 5000));
    log(`did not get run ${id}: ${c.name}: ${c.message}`);
    return;
  }
  await adopt(id);
}

async function execute(run: RunRow) {
  const attempt = run.attempts;
  const abort = new AbortController();
  let lastTouch = Date.now(); // the last call that extended the lease

  const stop = (c: ReturnType<typeof classify>) => {
    // The server says the run is no longer ours or its inputs changed: stop working on it.
    if (c.code === 'stale' || c.code === 'lost') abort.abort();
  };
  const ctx: RunCtx = {
    runId: run.id,
    prId: run.prId,
    stage: run.stage,
    inputHash: run.inputHash,
    inputsJson: run.inputsJson,
    signal: abort.signal,
    log,
    progress: async p => {
      try {
        await withRetry(() => R.reportProgress({ checkRunId: run.id, attempt, ...p, leaseMs }), { idempotent: true, tries: 3, label: `report_progress ${run.id}` });
        lastTouch = Date.now();
      } catch (e) {
        stop(classify(e));
        throw e;
      }
    },
  };

  // A stage that does not report progress (an agent) still has to keep its lease: the real ones
  // outlive it. Beat when nothing else has touched the lease for a third of its length.
  const beat = setInterval(() => {
    if (Date.now() - lastTouch < leaseMs / 3) return;
    R.heartbeatCheck({ checkRunId: run.id, attempt, leaseMs })
      .then(() => {
        lastTouch = Date.now();
      })
      .catch(e => {
        const c = classify(e);
        stop(c);
        if (c.code !== 'stale' && c.code !== 'lost') log(`heartbeat for run ${run.id} failed (${c.name}): ${c.message}`);
      });
  }, Math.max(500, leaseMs / 3 / 2));

  try {
    const results = await HANDLERS[run.stage]!(ctx);
    if (abort.signal.aborted) throw new AbortedError();
    await withRetry(() => R.completeCheck({ checkRunId: run.id, attempt, results }), { idempotent: true, label: `complete_check ${run.id}` });
    log(`finished run ${run.id} ${run.stage}: ${results.length} result(s)`);
  } catch (e) {
    const c = classify(e);
    if (e instanceof AbortedError || c.code === 'stale' || c.code === 'lost') {
      // Stale inputs, re-claimed after a lease expiry, or cancelled: the server has already moved
      // on, there is nothing to report.
      log(`abandoned run ${run.id}: ${c.message}`);
    } else if (e instanceof FatalRunError) {
      log(`run ${run.id} cannot succeed: ${e.message}`);
      await R.failCheck({ checkRunId: run.id, attempt, error: e.message, retryable: false }).catch(err => log(`could not fail run ${run.id}: ${classify(err).message}`));
    } else if (c.code === 'invalid') {
      // Our own result was refused. Running it again would produce the same result, so fail the
      // run for good with the reason; that also tells whatever waits on it.
      log(`run ${run.id} produced an invalid result: ${c.message}`);
      await R.failCheck({ checkRunId: run.id, attempt, error: c.message, retryable: false }).catch(err => log(`could not fail run ${run.id}: ${classify(err).message}`));
    } else {
      log(`run ${run.id} failed (${c.name}): ${c.message}`);
      await R.failCheck({ checkRunId: run.id, attempt, error: `${c.name}: ${c.message}`, retryable: true }).catch(() => {});
    }
  } finally {
    clearInterval(beat);
    active.delete(run.id);
    void pump();
  }
}

async function pump() {
  if (pumping) {
    dirty = true;
    return;
  }
  pumping = true;
  try {
    do {
      dirty = false;
      while (active.size < concurrency) {
        const next = candidates()[0];
        if (!next) break;
        await tryClaim(next.id);
      }
    } while (dirty);
  } catch (e) {
    log(`pump error: ${(e as Error).message}`);
  } finally {
    pumping = false;
  }
}

conn.db.checkRun.onInsert(() => void pump());
conn.db.checkRun.onUpdate(() => void pump());
setInterval(() => void pump(), 1000); // dependencies finishing do not touch a queued row
void pump();

// Keep Norn's record of the ERP baseline current: a change in the ERP re-checks every open ECR.
if (baselines.source) {
  const poll = () => baselines.refresh(log).catch(e => log(`baseline read failed: ${(e as Error).message}`));
  void poll();
  setInterval(poll, Number(process.env.NORN_BASELINE_POLL_MS ?? 60_000));
}

// A bug in one run must not take the worker, and every other run it holds, down with it.
process.on('unhandledRejection', e => log(`unhandled rejection: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));

async function shutdown() {
  log('shutting down: returning my runs to the queue');
  await Promise.all(
    [...active].filter(([, attempt]) => attempt > 0).map(([id, attempt]) =>
      R.failCheck({ checkRunId: id, attempt, error: 'worker shutting down', retryable: true }).catch(() => {})
    )
  );
  client.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
