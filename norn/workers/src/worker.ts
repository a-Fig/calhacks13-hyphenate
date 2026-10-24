// Norn compute worker. Subscribes to queued check runs, claims the ones it can do, streams
// progress, writes results. Run several to see claims race and leases recover:
//   WORKER_NAME=w1 npm run worker        (from norn/)
// Stage handlers are mock compute (see stages.ts); the logs say so.
import { classify, connect, subscribe, withRetry } from './connect.ts';
import { sleep } from './sim.ts';
import { HANDLERS, type RunCtx } from './stages.ts';

const name = process.env.WORKER_NAME ?? `worker-${process.pid}`;
const handled = (process.env.NORN_STAGES?.split(',') ?? Object.keys(HANDLERS)).map(s => s.trim());
const concurrency = Number(process.env.NORN_CONCURRENCY ?? 2);
const leaseMs = Number(process.env.NORN_LEASE_MS ?? 10_000);

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${name}] ${msg}`);

const client = await connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' });
const { conn, identity } = client;
log(`connected as ${identity.toHexString().slice(0, 12)}; stages ${handled.join(',')}; MOCK compute, no real model`);

// Queued runs to pick from, plus running ones: a claimed run leaves the first query the moment it
// becomes 'running', and we need our attempt number from the server. (claimed_by is an Option
// column and SQL subscriptions cannot compare it to a literal, so we filter on identity here.)
await subscribe(conn, ["SELECT * FROM check_run WHERE status = 'queued'", "SELECT * FROM check_run WHERE status = 'running'"]);

const active = new Map<bigint, number>(); // run id -> attempt we hold (0 while claiming)
const skipUntil = new Map<bigint, number>();
let pumping = false;
let dirty = false;

function candidates() {
  const now = Date.now();
  return [...conn.db.checkRun.iter()]
    .filter(r => r.status === 'queued' && handled.includes(r.stage) && !active.has(r.id) && (skipUntil.get(r.id) ?? 0) <= now)
    // requested (a person is waiting) before automatic; then oldest first
    .sort((a, b) => Number(a.trigger !== 'requested') - Number(b.trigger !== 'requested') || Number(a.id - b.id));
}

async function waitForClaim(id: bigint) {
  const t0 = Date.now();
  for (;;) {
    const r = conn.db.checkRun.id.find(id);
    if (r && r.status === 'running' && r.claimedBy?.isEqual(identity)) return r;
    if (Date.now() - t0 > 3000) throw new Error(`claimed run ${id} never showed up in the local cache`);
    await sleep(15);
  }
}

async function tryClaim(id: bigint) {
  active.set(id, 0);
  try {
    await withRetry(() => conn.reducers.claimCheck({ checkRunId: id, leaseMs }), { label: `claim_check ${id}` });
  } catch (e) {
    const c = classify(e);
    if (c.name === 'UnknownCallResultError') {
      // The connection dropped mid-call: the claim may have landed. Ask the cache before giving up,
      // otherwise the lease would sit unused until it expires.
      await sleep(500);
      const r = conn.db.checkRun.id.find(id);
      if (r?.status === 'running' && r.claimedBy?.isEqual(identity)) {
        log(`claim of run ${id} had landed despite ${c.name}`);
        const run = await waitForClaim(id);
        active.set(id, run.attempts);
        void execute(run);
        return;
      }
    }
    active.delete(id);
    // Lost the race, or waiting on a dependency stage: look again later, quietly.
    skipUntil.set(id, Date.now() + (c.message.includes('waiting for') ? 1500 : 5000));
    log(`did not get run ${id}: ${c.name}: ${c.message}`);
    return;
  }
  const run = await waitForClaim(id);
  active.set(id, run.attempts);
  log(`claimed run ${id} ${run.stage} (pr ${run.prId}, ${run.trigger}), attempt ${run.attempts}/${run.maxAttempts}`);
  void execute(run);
}

async function execute(run: NonNullable<ReturnType<typeof conn.db.checkRun.id.find>>) {
  const attempt = run.attempts;
  const ctx: RunCtx = {
    runId: run.id,
    prId: run.prId,
    stage: run.stage,
    inputHash: run.inputHash,
    log,
    progress: p =>
      withRetry(() => conn.reducers.reportProgress({ checkRunId: run.id, attempt, ...p, leaseMs }), {
        idempotent: true,
        tries: 3,
        label: `report_progress ${run.id}`,
      }),
  };
  try {
    const results = await HANDLERS[run.stage]!(ctx);
    await withRetry(() => conn.reducers.completeCheck({ checkRunId: run.id, attempt, results }), {
      idempotent: true,
      label: `complete_check ${run.id}`,
    });
    log(`finished run ${run.id} ${run.stage}: ${results.length} result(s)`);
  } catch (e) {
    const c = classify(e);
    if (c.name === 'SenderError') {
      // The server refused: stale inputs, re-claimed after a lease expiry, cancelled, or our
      // results were invalid. Retrying the same call cannot help.
      log(`abandoned run ${run.id}: ${c.message}`);
    } else {
      log(`run ${run.id} failed (${c.name}): ${c.message}`);
      await conn.reducers
        .failCheck({ checkRunId: run.id, attempt, error: `${c.name}: ${c.message}`, retryable: true })
        .catch(() => {});
    }
  } finally {
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
  } finally {
    pumping = false;
  }
}

conn.db.checkRun.onInsert(() => void pump());
conn.db.checkRun.onUpdate(() => void pump());
setInterval(() => void pump(), 1000); // dependencies finishing do not touch a queued row
void pump();

async function shutdown() {
  log('shutting down: returning my runs to the queue');
  await Promise.all(
    [...active].filter(([, attempt]) => attempt > 0).map(([id, attempt]) =>
      conn.reducers.failCheck({ checkRunId: id, attempt, error: 'worker shutting down', retryable: true }).catch(() => {})
    )
  );
  client.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
