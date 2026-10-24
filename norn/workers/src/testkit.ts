// Helpers shared by the module checks: a tiny assertion recorder, waiting on the client cache, and
// "play the worker" steps (claim, complete) so a check can drive runs by hand.
import { classify, type Client } from './connect.ts';
import { sleep } from './sim.ts';

export function recorder() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  return {
    checks,
    check(name: string, ok: boolean, detail = '') {
      checks.push({ name, ok, detail });
      console.log(ok ? 'PASS' : 'FAIL', name, detail);
    },
    finish() {
      const failed = checks.filter(c => !c.ok).length;
      console.log(failed ? `${failed} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
      return failed === 0;
    },
  };
}

/** What a rejected call looked like, or null if it was accepted. */
export const rejects = (p: Promise<unknown>) => p.then(() => null, e => classify(e));

export const TABLES = [
  'SELECT * FROM pull_request',
  'SELECT * FROM check_run',
  'SELECT * FROM check_result',
  'SELECT * FROM action_log',
  'SELECT * FROM main_version',
  'SELECT * FROM norn_config',
  'SELECT * FROM assumption',
  'SELECT * FROM comment',
  'SELECT * FROM principal',
  'SELECT * FROM agent_event',
  'SELECT * FROM part',
];

export const fixed = (value: number) => JSON.stringify({ kind: 'fixed', value });
export const result = (key: string) => ({ key, label: key, unit: 'x', p10: 1, p50: 2, p90: 3, detailJson: '{"mock":true}' });
export const CODE = ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'];

export function kit(A: Client) {
  const db = A.conn.db;
  const R = A.R;

  async function until<T>(fn: () => T | undefined | false, ms = 5000, what = 'a condition'): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await sleep(15);
    }
  }
  /** Whether a condition becomes true within `ms`; a check that must fail before a fix reports false instead of throwing. */
  const holds = (fn: () => unknown, ms = 3000) => until(() => fn() || undefined, ms).then(() => true, () => false);
  const pr = (id: bigint) => db.pullRequest.id.find(id)!;
  const runs = (prId: bigint, stage?: string) =>
    [...db.checkRun.iter()].filter(r => r.prId === prId && (!stage || r.stage === stage)).sort((a, b) => Number(a.id - b.id));
  /** Runs that still stand for the ECR's inputs (not stale, not cancelled). */
  const standing = (prId: bigint, stage: string) => runs(prId, stage).filter(r => ['queued', 'running', 'done', 'blocked', 'failed'].includes(r.status));
  const current = (prId: bigint, stage: string) => standing(prId, stage).at(-1);
  const run = (id: bigint) => db.checkRun.id.find(id)!;
  const logs = (filter: (l: ReturnType<typeof db.actionLog.iter> extends Iterable<infer L> ? L : never) => boolean) =>
    [...db.actionLog.iter()].filter(filter).sort((a, b) => Number(a.id - b.id));
  const mainNow = () => [...db.mainVersion.iter()].sort((a, b) => b.version - a.version)[0]!;

  async function newPr(title: string, plmEcrNumber = '', description = 'check') {
    const before = new Set([...db.pullRequest.iter()].map(p => p.id));
    await R.createPr({ plmEcrNumber, title, description });
    return until(() => [...db.pullRequest.iter()].find(p => !before.has(p.id) && p.title === title), 5000, `ECR '${title}'`);
  }

  /** Play the worker for one stage: claim the current queued run and complete it. */
  async function work(prId: bigint, stage: string) {
    const queued = await until(() => current(prId, stage)?.status === 'queued' && current(prId, stage)!, 5000, `${stage} to be queued`);
    await R.claimCheck({ checkRunId: queued.id, leaseMs: 30000 });
    const claimed = await until(() => run(queued.id).status === 'running' && run(queued.id), 5000, `${stage} to show as running`);
    await R.completeCheck({ checkRunId: queued.id, attempt: claimed.attempts, results: [result(stage)] });
    await until(() => run(queued.id).status === 'done', 5000, `${stage} to show as done`);
    return queued.id;
  }
  async function allCodeDone(prId: bigint) {
    for (const s of CODE) await work(prId, s);
  }
  /** Claim the current run of a stage and fail it for good. */
  async function failStage(prId: bigint, stage: string, error = 'check: induced failure') {
    const queued = await until(() => current(prId, stage)?.status === 'queued' && current(prId, stage)!, 5000, `${stage} to be queued`);
    await R.claimCheck({ checkRunId: queued.id, leaseMs: 30000 });
    const claimed = await until(() => run(queued.id).status === 'running' && run(queued.id), 5000, `${stage} to show as running`);
    await R.failCheck({ checkRunId: queued.id, attempt: claimed.attempts, error, retryable: false });
    await until(() => run(queued.id).status === 'failed', 5000, `${stage} to show as failed`);
    return queued.id;
  }
  async function edit(prId: bigint, key: string, value: number, affects: string[], expectedRev?: number) {
    const cur = [...db.assumption.iter()].find(a => a.prId === prId && a.key === key && a.current);
    await R.recordAssumption({ prId, key, distJson: fixed(value), source: 'given', rationale: 'check', affects, expectedRev: expectedRev ?? cur?.rev ?? 0 });
  }
  /** A merged-ready ECR: all cheap checks done, approved. */
  async function approve(prId: bigint) {
    await allCodeDone(prId);
    if (pr(prId).status === 'draft') await R.setPrStatus({ prId, status: 'review' });
    await R.setPrStatus({ prId, status: 'approved' });
    await until(() => pr(prId).status === 'approved', 5000, `ECR ${prId} to be approved`);
  }

  return { db, R, until, holds, pr, runs, standing, current, run, logs, mainNow, newPr, work, allCodeDone, failStage, edit, approve };
}
