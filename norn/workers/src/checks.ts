// Logic checks for the module's rules, run against a live database through the SDK:
// identity, the action log, review tiers, approval, release, cancellation, edit conflicts.
// Creates its own ECRs and does not need a reset. Do not run it next to a real worker (the
// worker would claim the runs this script drives by hand).
//   npm run check:module -w @norn/workers     (from norn/)
import { classify, connect, subscribe } from './connect.ts';
import { sleep } from './sim.ts';

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};
const rejects = async (p: Promise<unknown>) => p.then(() => null, e => classify(e));

const who = (name: string) => connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const A = await who('check-a');
for (const q of [['SELECT * FROM pull_request', 'SELECT * FROM check_run', 'SELECT * FROM check_result', 'SELECT * FROM action_log', 'SELECT * FROM main_version', 'SELECT * FROM norn_config', 'SELECT * FROM assumption']])
  await subscribe(A.conn, q);
const db = A.conn.db;
const R = A.conn.reducers;

async function until<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await sleep(15);
  }
}
async function newPr(title: string) {
  const before = new Set([...db.pullRequest.iter()].map(p => p.id));
  await R.createPr({ title, description: 'check' });
  return until(() => [...db.pullRequest.iter()].find(p => !before.has(p.id) && p.title === title));
}
const runs = (prId: bigint, stage?: string) => [...db.checkRun.iter()].filter(r => r.prId === prId && (!stage || r.stage === stage)).sort((a, b) => Number(a.id - b.id));
const live = (prId: bigint, stage: string) => runs(prId, stage).filter(r => ['queued', 'running', 'done'].includes(r.status));
const pr = (id: bigint) => db.pullRequest.id.find(id)!;
const result = (key: string) => ({ key, label: key, unit: 'x', p10: 1, p50: 2, p90: 3, detailJson: '{"mock":true}' });
const logs = (reducerName: string) => [...db.actionLog.iter()].filter(l => l.reducer === reducerName);

/** Play the worker for one stage: claim, complete. */
async function work(prId: bigint, stage: string) {
  const run = await until(() => live(prId, stage).find(r => r.status === 'queued'));
  await R.claimCheck({ checkRunId: run.id, leaseMs: 30000 });
  const claimed = await until(() => db.checkRun.id.find(run.id)?.status === 'running' && db.checkRun.id.find(run.id)!);
  await R.completeCheck({ checkRunId: run.id, attempt: claimed.attempts, results: [result(stage)] });
  await until(() => db.checkRun.id.find(run.id)?.status === 'done');
}
async function allCodeDone(prId: bigint) {
  for (const s of ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply']) await work(prId, s);
}

// ---- identity
const bad1 = await rejects(R.registerActor({ kind: 'person', name: 'x', origin: 'norn', onBehalfOf: undefined, spawnedBy: 'web' }));
const bad2 = await rejects(R.registerActor({ kind: 'agent', name: 'x', origin: 'external', onBehalfOf: undefined, spawnedBy: 'mcp' }));
check('register_actor refuses a person who is not human, and an outside agent that names nobody it acts for', bad1?.name === 'SenderError' && bad2?.name === 'SenderError', `${bad1?.message} | ${bad2?.message}`);
await R.registerActor({ kind: 'agent', name: 'tylers-agent', origin: 'external', onBehalfOf: 'Tyler', spawnedBy: 'external:mcp' });
const P1 = await newPr('check one');
await R.addComment({ prId: P1.id, anchor: '', body: 'from an outside agent' });
const lg = [...db.actionLog.iter()].filter(l => l.reducer === 'add_comment' && l.prId === P1.id).at(-1)!;
check('the action log records actor, on-behalf-of, origin, what spawned it and the policy', lg.actorName === 'tylers-agent' && lg.actorKind === 'agent' && lg.actorOrigin === 'external' && lg.onBehalfOf === 'Tyler' && lg.spawnedBy === 'external:mcp' && lg.policy === 'allow (no rules yet)', JSON.stringify({ a: lg.actorName, k: lg.actorKind, o: lg.actorOrigin, f: lg.onBehalfOf, s: lg.spawnedBy, p: lg.policy }));
await R.registerActor({ kind: 'agent', name: 'check-a', origin: 'norn', onBehalfOf: undefined, spawnedBy: 'Norn' });

// ---- review tiers
const deepAuto = await rejects(R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'automatic' }));
check('a deep stage cannot be enqueued automatically while config says on_request', deepAuto?.name === 'SenderError', deepAuto?.message);
check('creating an ECR enqueued only the cheap stages automatically', runs(P1.id).every(r => r.tier === 'code' && r.trigger === 'automatic') && runs(P1.id).length === 4, runs(P1.id).map(r => r.stage).join(','));
await R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'requested' });
await until(() => live(P1.id, 's5_card').length === 1);
await R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'requested' });
await sleep(150);
check('asking again for the same deep stage on the same inputs does nothing', live(P1.id, 's5_card').length === 1);
const early = await rejects(R.claimCheck({ checkRunId: live(P1.id, 's5_card')[0]!.id, leaseMs: 5000 }));
check('a deep stage cannot be claimed before the stages it reads have finished', early?.message.includes('waiting for') === true, early?.message);

await R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{"kind":"fixed","value":1}', source: 'given', rationale: 'check', affects: [], expectedRev: 0 });
await until(() => pr(P1.id).revision === 2);
check('an assumption that feeds every stage makes the requested deep run outdated and does not re-request it', runs(P1.id, 's5_card').every(r => r.status === 'stale') && live(P1.id, 's5_card').length === 0, runs(P1.id, 's5_card').map(r => r.status).join(','));
check('the cheap stages were replaced automatically in the same step', ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'].every(s => live(P1.id, s).length === 1 && live(P1.id, s)[0]!.inputHash !== runs(P1.id, s)[0]!.inputHash));
await R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'requested' });
await until(() => live(P1.id, 's5_card').length === 1);
await R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{"kind":"fixed","value":2}', source: 'given', rationale: 'check', affects: [], expectedRev: 1 });
await until(() => pr(P1.id).revision === 3);
const third = await rejects(R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'requested' }));
await R.enqueueCheck({ prId: P1.id, stage: 's5_card', trigger: 'requested' }).catch(() => {});
check('a deep stage can be requested at most deep_review_limit (2) times per ECR', runs(P1.id, 's5_card').length === 2 && third?.name === 'SenderError', `${runs(P1.id, 's5_card').length} runs; ${third?.message}`);

// ---- edit conflicts and no-op edits
const conflict = await rejects(R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{"kind":"fixed","value":9}', source: 'given', rationale: 'check', affects: [], expectedRev: 1 }));
check('an edit made on an out-of-date revision is refused with the current revision in the message', conflict?.message.includes('revision 2') === true, conflict?.message);
const revBefore = pr(P1.id).revision;
await R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{"kind":"fixed","value":2}', source: 'given', rationale: 'check', affects: [], expectedRev: 2 });
await sleep(150);
check('saving an identical value changes nothing (no new revision, no new runs)', pr(P1.id).revision === revBefore);
const badJson = await rejects(R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{oops', source: 'given', rationale: '', affects: [], expectedRev: 2 }));
check('an assumption that is not valid JSON is refused', badJson?.name === 'SenderError', badJson?.message);

// ---- approval and release
const P2 = await newPr('check two');
const early2 = await rejects(R.setPrStatus({ prId: P2.id, status: 'approved' }));
check('an ECR cannot go straight from draft to approved', early2?.name === 'SenderError', early2?.message);
await R.setPrStatus({ prId: P2.id, status: 'review' });
const notReady = await rejects(R.setPrStatus({ prId: P2.id, status: 'approved' }));
check('approval is refused until every cheap stage has finished on the current inputs', notReady?.message.includes('s1_bom_delta') === true, notReady?.message);
await allCodeDone(P2.id);
await R.setPrStatus({ prId: P2.id, status: 'approved' });
await allCodeDone(P1.id);
await R.setPrStatus({ prId: P1.id, status: 'review' });
await R.setPrStatus({ prId: P1.id, status: 'approved' });
await until(() => pr(P1.id).status === 'approved' && pr(P2.id).status === 'approved');
const v0 = [...db.mainVersion.iter()][0]!.version;
const revP2 = pr(P2.id).revision;
await R.setPrStatus({ prId: P1.id, status: 'merged' });
await until(() => pr(P1.id).status === 'merged');
await sleep(150);
const v1 = [...db.mainVersion.iter()][0]!.version;
check('releasing an ECO bumps the production baseline version and records it on the ECR', v1 === v0 + 1 && pr(P1.id).mergedVersion === v1, `v${v0} -> v${v1}`);
check('the other approved ECR is re-baselined: approval withdrawn, revision bumped, its checks replaced', pr(P2.id).status === 'review' && pr(P2.id).revision === revP2 + 1 && pr(P2.id).baseVersion === v1 && live(P2.id, 's2_cost').every(r => r.status === 'queued'), `status ${pr(P2.id).status}, revision ${revP2} -> ${pr(P2.id).revision}`);
const frozen = await rejects(R.recordAssumption({ prId: P1.id, key: 'check_key', distJson: '{"kind":"fixed","value":3}', source: 'given', rationale: '', affects: [], expectedRev: 2 }));
check('the assumptions of a released ECR are frozen', frozen?.name === 'SenderError', frozen?.message);
check('a released ECR keeps its finished forecast (nothing re-queued, nothing deleted)', runs(P1.id).filter(r => r.status === 'done').length >= 4 && !runs(P1.id).some(r => r.status === 'queued' && r.createdAt.microsSinceUnixEpoch > pr(P1.id).updatedAt.microsSinceUnixEpoch));

// ---- closing cancels outstanding work
await R.setPrStatus({ prId: P2.id, status: 'closed' });
await until(() => pr(P2.id).status === 'closed');
check('closing an ECR cancels its queued runs', runs(P2.id).every(r => r.status !== 'queued' && r.status !== 'running'), runs(P2.id).map(r => r.status).join(','));
const claimClosed = await rejects(R.claimCheck({ checkRunId: runs(P2.id).find(r => r.status === 'cancelled')!.id, leaseMs: 5000 }));
check('a cancelled run cannot be claimed', claimClosed?.name === 'SenderError', claimClosed?.message);

// ---- Bowman's config: automatic deep review
await R.setConfig({ key: 'deep_review_mode', value: 'auto' });
const P3 = await newPr('check three');
check('with deep_review_mode=auto a new ECR also gets the deep stages automatically', live(P3.id, 's0_extract').length === 1 && live(P3.id, 's5_card').length === 1 && live(P3.id, 's5_card')[0]!.trigger === 'automatic', runs(P3.id).map(r => `${r.stage}/${r.trigger}`).join(' '));
await R.setConfig({ key: 'deep_review_mode', value: 'on_request' });
await R.setPrStatus({ prId: P3.id, status: 'closed' });
const badCfg = await rejects(R.setConfig({ key: 'nope', value: '1' }));
check('an unknown config key is refused', badCfg?.name === 'SenderError', badCfg?.message);

// ---- every write left a log row
const expectLogged = ['register_actor', 'create_pr', 'add_comment', 'enqueue_check', 'record_assumption', 'set_pr_status', 'claim_check', 'complete_check', 'set_config'];
const missing = expectLogged.filter(n => !logs(n).some(l => l.actorName === 'check-a' || l.actorName === 'tylers-agent'));
check('every write reducer left an action-log row naming who did it', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : expectLogged.join(', '));

A.close();
const failed = checks.filter(c => !c.ok).length;
console.log(failed ? `${failed} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
process.exit(failed ? 1 : 0);
