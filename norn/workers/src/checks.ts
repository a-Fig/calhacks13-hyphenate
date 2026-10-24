// Logic checks for the module's rules, run against a live database through the SDK:
// hashing and invalidation, review tiers, the deep-review cap, approval and release, reopening,
// blocked stages, identity, the action log, the baseline history, the event stream.
// Creates its own ECRs and closes them again; it does not need a reset. Do not run it next to a
// real worker (the worker would claim the runs this script drives by hand).
//   npm run check:module              (from norn/, against the database "norn")
//   NORN_DB=norn-test npm run check:module   (the same checks against the test module)
import { Timestamp } from 'spacetimedb';
import { connect, subscribe, DB } from './connect.ts';
import { sleep } from './sim.ts';
import { CODE, TABLES, kit, recorder, rejects, result } from './testkit.ts';

const { check, finish } = recorder();
const A = await connect({ kind: 'agent', name: 'check-a', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const C = await connect({ kind: 'agent', name: 'tylers-agent', origin: 'external', onBehalfOf: 'Tyler', spawnedBy: 'external:mcp' }, { persistToken: false, quiet: true });
const P = await connect({ kind: 'person', name: 'check-person', origin: 'human', spawnedBy: 'web' }, { persistToken: false, quiet: true });
await subscribe(A.conn, TABLES);
const K = kit(A);
const { R, db, until, holds, pr, runs, run, current, logs, newPr, work, allCodeDone, failStage, edit, approve, mainNow } = K;
console.log(`checking database '${DB}'`);

const created: bigint[] = [];
const file = async (title: string, plm = '') => {
  const p = await newPr(title, plm);
  created.push(p.id);
  return p;
};
const stamp = Date.now().toString(36);

// ---- identity ---------------------------------------------------------------------------------
const bad1 = await rejects(P.R.registerActor({ kind: 'person', name: 'x', origin: 'norn' }));
const bad2 = await rejects(P.R.registerActor({ kind: 'agent', name: 'x', origin: 'external' }));
check('register_actor refuses a person who is not human, and an outside agent that names nobody it acts for', bad1?.name === 'SenderError' && bad2?.name === 'SenderError', `${bad1?.message} | ${bad2?.message}`);
const swap1 = await rejects(P.R.registerActor({ kind: 'agent', name: 'check-person', origin: 'norn' }));
const swap2 = await rejects(A.R.registerActor({ kind: 'person', name: 'check-a', origin: 'human' }));
check('kind and origin are fixed at first registration: a person cannot become an agent or the reverse', swap1?.message.includes('cannot change') === true && swap2?.message.includes('cannot change') === true && db.principal.identity.find(A.identity)?.kind === 'agent', `${swap1?.message}`);
await A.R.registerActor({ kind: 'agent', name: 'check-a-renamed', origin: 'norn' });
check('a name can still change', await holds(() => db.principal.identity.find(A.identity)?.name === 'check-a-renamed'));
await A.R.registerActor({ kind: 'agent', name: 'check-a', origin: 'norn' });

const E1 = await file('check: hash chain');
await C.R.addComment({ prId: E1.id, anchor: '', body: 'from an outside agent', meta: { requestId: `req-${stamp}-1` } });
await C.R.addComment({ prId: E1.id, anchor: '', body: 'from a sub-agent', meta: { requestId: `req-${stamp}-2`, spawnedBy: 'parent-job-9' } });
const l1 = await until(() => logs(l => l.requestId === `req-${stamp}-1`)[0], 3000, 'the first comment in the log');
const l2 = await until(() => logs(l => l.requestId === `req-${stamp}-2`)[0], 3000, 'the second comment in the log');
check('the action log records actor, on-behalf-of, origin, spawned-by and policy, and the caller\'s request id', l1.actorName === 'tylers-agent' && l1.actorKind === 'agent' && l1.actorOrigin === 'external' && l1.onBehalfOf === 'Tyler' && l1.spawnedBy === 'external:mcp' && l1.policy === 'allow (no rules yet)' && l1.outcome === 'applied', JSON.stringify({ a: l1.actorName, o: l1.actorOrigin, f: l1.onBehalfOf, s: l1.spawnedBy, p: l1.policy, q: l1.requestId }));
check('spawnedBy comes with each call, not with the connection', l2.spawnedBy === 'parent-job-9' && l1.spawnedBy === 'external:mcp', `${l1.spawnedBy} then ${l2.spawnedBy} from the same connection`);
const cmt = [...db.comment.iter()].find(c => c.prId === E1.id)!;
check('comments and ECRs store who wrote them as an identity, not a name', cmt.author.isEqual(C.identity) && pr(E1.id).createdBy.isEqual(A.identity), 'comment.author and pull_request.created_by are identities');
check('a Norn-originated ECR gets a NORN-<id> key and kind ecr', pr(E1.id).plmEcrNumber === `NORN-${E1.id}` && pr(E1.id).kind === 'ecr', `${pr(E1.id).plmEcrNumber}, ${pr(E1.id).kind}`);

// ---- defect 1: a stage's hash includes the stages it reads ---------------------------------------
const s1a = await work(E1.id, 's1_bom_delta');
const s2a = await work(E1.id, 's2_cost');
const s3q = current(E1.id, 's3_timeline')!;
const oldS2Hash = run(s2a).inputHash;
await edit(E1.id, 'chk_s1_only', 1, ['s1_bom_delta']);
const s2Stale = await holds(() => run(s2a).status === 'stale');
check('an edit only stage 1 reads also makes the finished stage 2 stale (it was computed from the old stage 1)', s1a !== undefined && run(s1a).status === 'stale' && s2Stale, `s1 ${run(s1a).status}, s2 ${run(s2a).status}`);
const s2b = current(E1.id, 's2_cost')!;
check('...and the queued stages 3 and 4 are replaced, not left on the old stage 1', run(s3q.id).status === 'stale' && current(E1.id, 's3_timeline')!.id !== s3q.id && s2b.inputHash !== oldS2Hash, `new s2 hash ${s2b.inputHash}`);
const inputs = JSON.parse(s2b.inputsJson);
const s1Inputs = JSON.parse(current(E1.id, 's1_bom_delta')!.inputsJson);
check('a run stores its inputs: base version, code version, seed, assumption ids and revisions, upstream hashes', inputs.baseVersion === pr(E1.id).baseVersion && inputs.codeVersion === db.nornConfig.key.find('code_version')?.value && inputs.seed === db.nornConfig.key.find('seed')?.value && inputs.upstream?.s1_bom_delta === current(E1.id, 's1_bom_delta')!.inputHash && s1Inputs.assumptions?.some((a: { key: string; id: string; rev: number }) => a.key === 'chk_s1_only' && a.rev === 1 && typeof a.id === 'string'), `s1 reads ${JSON.stringify(s1Inputs.assumptions?.map((a: { key: string; rev: number }) => `${a.key}@${a.rev}`))}`);

const E2 = await file('check: card chain');
await R.enqueueCheck({ prId: E2.id, stage: 's5_card', trigger: 'requested' });
await allCodeDone(E2.id);
const s5 = await work(E2.id, 's5_card');
const s2c = current(E2.id, 's2_cost')!.id;
const s4c = current(E2.id, 's4_supply')!.id;
await edit(E2.id, 'chk_s3_only', 1, ['s3_timeline']);
check('an edit only stage 3 reads makes the finished stage 5 (which reads 2 to 4) stale', await holds(() => run(s5).status === 'stale'), `s5 ${run(s5).status}`);
check('...while the finished stages 2 and 4, which do not read it, stay done', run(s2c).status === 'done' && run(s4c).status === 'done', `s2 ${run(s2c).status}, s4 ${run(s4c).status}`);

// ---- defect 3: the deep-review cap, and what a deep stage reads -----------------------------------
const E3 = await file('check: deep cap');
for (let i = 1; i <= 3; i++) {
  const refused = await rejects(R.enqueueCheck({ prId: E3.id, stage: 's0_extract', trigger: 'requested' }));
  if (refused) break;
  await until(() => current(E3.id, 's0_extract')?.status === 'queued', 3000, 'the S0 run');
  if (i < 3) {
    await R.editPrText({ prId: E3.id, description: `check text v${i}` });
    await holds(() => current(E3.id, 's0_extract') === undefined, 3000); // the run is now stale
  }
}
check('three deep requests, each after the ECR text changed, all succeed: stale runs do not use up the cap', runs(E3.id, 's0_extract').length === 3 && runs(E3.id, 's0_extract').filter(r => r.status === 'stale').length === 2, runs(E3.id, 's0_extract').map(r => r.status).join(','));
const x3 = current(E3.id, 's0_extract')!;
await R.claimCheck({ checkRunId: x3.id, leaseMs: 30000 });
await until(() => run(x3.id).status === 'running');
await R.failCheck({ checkRunId: x3.id, attempt: 1, error: 'check: induced', retryable: false });
await until(() => run(x3.id).status === 'failed');
const retry1 = await rejects(R.enqueueCheck({ prId: E3.id, stage: 's0_extract', trigger: 'requested' }));
const x4 = await until(() => current(E3.id, 's0_extract')?.status === 'queued' && current(E3.id, 's0_extract')!, 3000, 'a retry of S0');
await R.claimCheck({ checkRunId: x4.id, leaseMs: 30000 });
await until(() => run(x4.id).status === 'running');
await R.failCheck({ checkRunId: x4.id, attempt: 1, error: 'check: induced', retryable: false });
await until(() => run(x4.id).status === 'failed');
const retry2 = await rejects(R.enqueueCheck({ prId: E3.id, stage: 's0_extract', trigger: 'requested' }));
check('on the same inputs a failed deep run can be retried once, and the third request is refused (cap 2)', retry1 === null && retry2?.name === 'SenderError' && retry2.message.includes('limit 2'), retry2?.message ?? 'not refused');

const E7 = await file('check: s0 narrow');
await R.enqueueCheck({ prId: E7.id, stage: 's0_extract', trigger: 'requested' });
const x0 = (await until(() => current(E7.id, 's0_extract'), 3000, 'S0 run')).id;
const E4 = await file('check: merge me');
const bomBefore = JSON.parse(current(E4.id, 's1_bom_delta')!.inputsJson).bomVersion;
const E5 = await file('check: approved bystander');
const E6 = await file('check: close then reopen');
await R.setPrStatus({ prId: E6.id, status: 'closed' });
const v0 = mainNow().version;

// baseline assumption edit that feeds every stage
await edit(0n, 'chk_baseline', 1, []);
await until(() => mainNow().version === v0 + 1, 3000, 'the baseline to move');
check('a baseline assumption edit appends a history row (cause assumption, parent, version +1)', mainNow().cause === 'assumption' && mainNow().parent === v0 && mainNow().version === v0 + 1, `v${v0} -> v${mainNow().version}, ${mainNow().cause}, ${mainNow().note}`);
await until(() => pr(E7.id).baseVersion === v0 + 1, 3000, 'E7 to follow the baseline');
check('an extraction (S0) reads only the ECR text: a baseline edit that feeds every other stage leaves it current', run(x0).status === 'queued' && current(E7.id, 's0_extract')!.id === x0, `S0 run ${run(x0).status}`);
check('a baseline edit leaves a log row on each open ECR it changed', logs(l => l.prId === E7.id && l.reducer === 'record_assumption' && l.summary.includes('baseline assumption chk_baseline')).length >= 1 && logs(l => l.prId === E4.id && l.reducer === 'record_assumption' && l.summary.includes('baseline assumption chk_baseline')).length >= 1, 'rows with prId of two open ECRs');
check('stage 1 keys on the BOM version, not the baseline version: an assumption-only baseline move leaves it unchanged', JSON.parse(current(E4.id, 's1_bom_delta')!.inputsJson).bomVersion === bomBefore && pr(E4.id).baseVersion === v0 + 1, `bomVersion ${bomBefore} while the baseline is at v${mainNow().version}`);

// ---- approval, release, audit, reopen ------------------------------------------------------------
const early = await rejects(R.setPrStatus({ prId: E4.id, status: 'approved' }));
check('an ECR cannot go straight from draft to approved', early?.name === 'SenderError', early?.message);
await R.setPrStatus({ prId: E4.id, status: 'review' });
const notReady = await rejects(R.setPrStatus({ prId: E4.id, status: 'approved' }));
check('approval is refused until every cheap stage has finished on the current inputs', notReady?.message.includes('s1_bom_delta') === true, notReady?.message);
await approve(E4.id);
await approve(E5.id);
const revE5 = pr(E5.id).revision;
const v1 = mainNow().version;
await R.setPrStatus({ prId: E4.id, status: 'merged' });
await until(() => pr(E4.id).status === 'merged', 3000, 'E4 to be released');
const m = mainNow();
check('releasing an ECO appends a history row (cause eco, the ECR, its parent) and records the version on the ECR', m.version === v1 + 1 && m.cause === 'eco' && m.mergedPrId === E4.id && m.parent === v1 && pr(E4.id).mergedVersion === m.version, `v${v1} -> v${m.version} by ECR ${m.mergedPrId}`);
await until(() => pr(E5.id).status === 'review', 3000, 'E5 to lose its approval');
check('the other approved ECR is re-baselined: approval withdrawn, revision bumped, checks replaced', pr(E5.id).revision === revE5 + 1 && pr(E5.id).baseVersion === m.version && CODE.every(s => current(E5.id, s)?.status === 'queued'), `status ${pr(E5.id).status}, revision ${revE5} -> ${pr(E5.id).revision}`);
check('...and its own log shows why (a row on that ECR naming the approval withdrawal)', logs(l => l.prId === E5.id && l.reducer === 'set_pr_status' && l.summary.includes('approval withdrawn')).length === 1, 'one set_pr_status row with prId of the bystander');
check('S0 is still current after another ECR was released', run(x0).status === 'queued', `S0 run ${run(x0).status}`);
check('a released ECR keeps its forecast (finished runs stay done)', runs(E4.id).filter(r => r.status === 'done').length >= 4);
const frozen = await rejects(edit(E4.id, 'chk_frozen', 3, []));
check('the assumptions of a released ECR are frozen', frozen?.name === 'SenderError', frozen?.message);

check('reopening a closed ECR moves it onto the current baseline', (await rejects(R.setPrStatus({ prId: E6.id, status: 'draft' }))) === null && (await holds(() => pr(E6.id).status === 'draft' && pr(E6.id).baseVersion === mainNow().version)), `base v${pr(E6.id).baseVersion}, baseline v${mainNow().version}`);
check('...and its checks are on the new baseline (stage 1 keys on the new BOM version)', JSON.parse(current(E6.id, 's1_bom_delta')!.inputsJson).bomVersion === m.version && JSON.parse(current(E6.id, 's1_bom_delta')!.inputsJson).baseVersion === m.version);

await R.editPrText({ prId: E7.id, description: 'the text changed' });
check('an edit to the ECR text makes the finished extraction stale', await holds(() => run(x0).status === 'stale'), `S0 run ${run(x0).status}`);
check('closing an ECR cancels its queued runs, and a cancelled run cannot be claimed', await (async () => {
  await R.setPrStatus({ prId: E5.id, status: 'closed' });
  await until(() => pr(E5.id).status === 'closed');
  const cancelled = runs(E5.id).find(r => r.status === 'cancelled');
  const refused = cancelled ? await rejects(R.claimCheck({ checkRunId: cancelled.id, leaseMs: 5000 })) : null;
  return !!cancelled && refused?.name === 'SenderError' && runs(E5.id).every(r => r.status !== 'queued' && r.status !== 'running');
})());

// ---- defect 5: a failed stage blocks what reads it -----------------------------------------------
const E8 = await file('check: blocked chain');
await failStage(E8.id, 's1_bom_delta', 'induced: bad BOM');
const blockedNow = await holds(() => ['s2_cost', 's3_timeline', 's4_supply'].every(s => current(E8.id, s)?.status === 'blocked'));
check('when stage 1 fails for good, stages 2 to 4 are marked blocked, with the reason', blockedNow && current(E8.id, 's2_cost')!.note.includes('s1_bom_delta failed'), `${current(E8.id, 's2_cost')?.status}: ${current(E8.id, 's2_cost')?.note}`);
await R.enqueueCheck({ prId: E8.id, stage: 's5_card', trigger: 'requested' });
check('a requested stage 5 behind them is blocked too', await holds(() => current(E8.id, 's5_card')?.status === 'blocked'), `${current(E8.id, 's5_card')?.status}: ${current(E8.id, 's5_card')?.note}`);
const claimBlocked = await rejects(R.claimCheck({ checkRunId: current(E8.id, 's2_cost')!.id, leaseMs: 5000 }));
check('a blocked run cannot be claimed and says why', claimBlocked?.message.includes('blocked') === true, claimBlocked?.message);
await R.enqueueCheck({ prId: E8.id, stage: 's1_bom_delta', trigger: 'requested' });
check('requesting the failed stage again releases everything behind it', await holds(() => ['s2_cost', 's3_timeline', 's4_supply', 's5_card'].every(s => current(E8.id, s)?.status === 'queued')), ['s2_cost', 's5_card'].map(s => current(E8.id, s)?.status).join(','));
await work(E8.id, 's1_bom_delta');
check('...and the work can then go ahead (stage 2 claims and finishes)', (await rejects(work(E8.id, 's2_cost'))) === null);

// ---- config: automatic deep review happens once, when an ECR is filed ----------------------------
await R.setConfig({ key: 'deep_review_mode', value: 'auto' });
await new Promise(r => setTimeout(r, 300));
check('switching deep review to automatic queues nothing on ECRs already filed', runs(E1.id, 's0_extract').length === 0 && runs(E1.id, 's5_card').length === 0);
const autoRefused = await rejects(R.enqueueCheck({ prId: E1.id, stage: 's5_card', trigger: 'automatic' }));
check('a deep stage can never be enqueued as automatic, even in automatic mode', autoRefused?.name === 'SenderError', autoRefused?.message);
const E9 = await file('check: auto deep');
check('in automatic mode a new ECR gets each deep stage queued once, as requested by config, counted towards the cap', runs(E9.id, 's0_extract').length === 1 && runs(E9.id, 's5_card').length === 1 && runs(E9.id, 's5_card')[0]!.trigger === 'requested' && runs(E9.id, 's5_card')[0]!.requestedBy.isEqual(A.identity), runs(E9.id).filter(r => r.tier === 'deep').map(r => `${r.stage}/${r.trigger}`).join(' '));
await edit(E9.id, 'chk_auto', 1, []);
await holds(() => runs(E9.id, 's5_card')[0]?.status === 'stale');
await edit(E9.id, 'chk_auto', 2, []);
await new Promise(r => setTimeout(r, 300));
check('...and edits afterwards make the deep runs stale but queue no new ones', runs(E9.id, 's5_card').length === 1 && runs(E9.id, 's0_extract').length === 1 && runs(E9.id, 's5_card')[0]!.status === 'stale', runs(E9.id).filter(r => r.tier === 'deep').map(r => `${r.stage}:${r.status}`).join(' '));
await R.setConfig({ key: 'deep_review_mode', value: 'on_request' });

// ---- edit conflicts and no-op edits ----------------------------------------------------------------
const E10 = await file('check: edits');
await edit(E10.id, 'chk_key', 1, []);
await until(() => pr(E10.id).revision === 2);
const conflict = await rejects(R.recordAssumption({ prId: E10.id, key: 'chk_key', distJson: '{"kind":"fixed","value":9}', source: 'given', rationale: 'check', affects: [], expectedRev: 0 }));
check('an edit made on an out-of-date revision is refused with the current revision in the message', conflict?.message.includes('revision 1') === true, conflict?.message);
const revBefore = pr(E10.id).revision;
await edit(E10.id, 'chk_key', 1, [], 1);
await new Promise(r => setTimeout(r, 200));
check('saving an identical value changes nothing (no new revision, no new runs)', pr(E10.id).revision === revBefore);
const badJson = await rejects(R.recordAssumption({ prId: E10.id, key: 'chk_key', distJson: '{oops', source: 'given', rationale: '', affects: [], expectedRev: 1 }));
check('an assumption that is not valid JSON is refused', badJson?.name === 'SenderError', badJson?.message);
check('an assumption row stores who wrote it as an identity', [...db.assumption.iter()].find(a => a.prId === E10.id && a.key === 'chk_key')!.createdBy.isEqual(A.identity));

// ---- external keys, parts, event stream ------------------------------------------------------------
const plm = `BWM-TEST-${stamp}`;
const E11 = await file('check: plm number', plm);
const dup = await rejects(R.createPr({ plmEcrNumber: plm, title: 'check: plm duplicate', description: '' }));
check('a PLM ECR number is stored and is unique', pr(E11.id).plmEcrNumber === plm && dup?.message.includes(plm) === true, dup?.message);
const partNo = `CHK-${stamp}`;
await R.upsertPart({ partNumber: partNo, name: 'first name', category: 'check', specJson: '{}' });
await until(() => [...db.part.iter()].some(p => p.partNumber === partNo));
await R.upsertPart({ partNumber: partNo, name: 'second name', category: 'check', specJson: '{}' });
await holds(() => [...db.part.iter()].find(p => p.partNumber === partNo)?.name === 'second name');
check('a part number is a unique key: a second upsert updates the row', [...db.part.iter()].filter(p => p.partNumber === partNo).length === 1 && [...db.part.iter()].find(p => p.partNumber === partNo)!.name === 'second name');

const target = current(E1.id, 's1_bom_delta')!;
const job = `check_run:${target.id}`;
const ev = (seq: number, type: string) => ({
  jobId: job, seq, ts: Timestamp.fromDate(new Date()), role: 'level1-writeup',
  actor: 'agent:norn/level1/ECR-0417', onBehalfOf: 'Tyler', spawnedBy: 'norn', sessionId: 'session-1', eventType: type,
  payloadJson: JSON.stringify({ text: `event ${seq}` }),
});
await R.recordAgentEvents({ checkRunId: target.id, events: [ev(2, 'tool_result'), ev(0, 'job_started'), ev(1, 'tool_call')] });
await R.recordAgentEvents({ checkRunId: target.id, events: [ev(1, 'tool_call'), ev(2, 'tool_result'), ev(3, 'result')] });
await holds(() => [...db.agentEvent.iter()].filter(e => e.jobId === job).length >= 4);
const got = [...db.agentEvent.iter()].filter(e => e.jobId === job).sort((a, b) => a.seq - b.seq);
check('agent events are keyed by (job, seq): out-of-order batches are stored once each, a resent batch adds nothing', got.map(e => e.seq).join(',') === '0,1,2,3' && got.every(e => e.eventKey === `${job}#${e.seq}` && e.prId === E1.id && e.checkRunId === target.id && e.actor === 'agent:norn/level1/ECR-0417' && e.spawnedBy === 'norn' && e.sender.isEqual(A.identity)), got.map(e => e.eventKey).join(' '));

// ---- impact statements: the run they were written from, and the publication lease (#80) --------------------
await subscribe(A.conn, ['SELECT * FROM impact_statement', 'SELECT * FROM publication_claim']);
const L1 = await connect({ kind: 'agent', name: `check-l1-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const E12 = await file('check: statement source');
const E13 = await file('check: other ECR');
await L1.R.grantScope({ jobId: `check-l1-job-${stamp}`, anyEcr: false, prIds: [E12.id], maxLevel: 2, expiresAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)) });
await until(() => db.actorScope.identity.find(L1.identity), 3000, 'the job scope').catch(() => undefined);
const stmts = (prId: bigint) => [...db.impactStatement.iter()].filter(s => s.prId === prId);
const lastLog = () => logs(l => l.reducer === 'post_impact_statement' && l.actorName === `check-l1-${stamp}`).at(-1);
const body = (spawnedBy: string, over: Record<string, unknown> = {}) => ({
  prId: E12.id, level: 1, changeClass: 'Class I', route: 'CCB', headline: `statement ${stamp}`, drivers: [], assumptions: [], claims: [],
  numbers: [{ key: 'net', label: 's2_cost', unit: 'x', p10: 1, p50: 2, p90: 3, evidence: 'computation', resultKey: 's2_cost' }],
  meta: { requestId: `st-${stamp}-${Math.random().toString(36).slice(2, 6)}`, spawnedBy }, ...over,
});
await work(E12.id, 's1_bom_delta');
const s2first = await work(E12.id, 's2_cost');
await work(E13.id, 's1_bom_delta');
const s2other = await work(E13.id, 's2_cost');

await L1.R.postImpactStatement(body(`norn:check_run:${s2first}`));
const first = await until(() => stmts(E12.id).at(0), 3000, 'the first statement');
check('a statement posted by a session started by a check run records that run', first.checkRunId === s2first, `checkRunId ${first.checkRunId}, run ${s2first}`);

await L1.R.postImpactStatement(body(`norn:check_run:${s2other}`));
await sleep(300);
check("...a session started by another ECR's check run is refused", stmts(E12.id).length === 1 && lastLog()?.outcome === 'rejected' && /not a check run of/.test(lastLog()?.summary ?? ''), lastLog()?.summary);

await edit(E12.id, 'chk_stmt_source', 1, ['s1_bom_delta']); // the inputs change: the first s2 run goes stale
await holds(() => run(s2first).status === 'stale');
await L1.R.postImpactStatement(body(`norn:check_run:${s2first}`, { headline: `late ${stamp}` }));
await sleep(300);
check('...and a session whose check run has gone stale (a newer revision or baseline arrived) cannot post, even with its numbers unchanged', stmts(E12.id).length === 1 && lastLog()?.outcome === 'rejected' && /is stale/.test(lastLog()?.summary ?? '') && /Post nothing/.test(lastLog()?.summary ?? ''), lastLog()?.summary);

await work(E12.id, 's1_bom_delta');
const s2second = await work(E12.id, 's2_cost');
await L1.R.postImpactStatement(body(`norn:check_run:${s2second}`, { headline: `second ${stamp}` }));
const second = await until(() => stmts(E12.id).find(s => s.headline === `second ${stamp}`), 3000, 'the statement from the new run');
check('...the new run\'s session posts, and the statement names the new run', second.checkRunId === s2second && second.checkRunId !== first.checkRunId, `${second.checkRunId}`);

const norun = await rejects(A.R.postImpactStatement({ ...body('Norn'), headline: `no session ${stamp}` }));
const noRunStmt = await holds(() => stmts(E12.id).some(s => s.headline === `no session ${stamp}`));
check('a statement posted outside a session records the run its computation number was copied from', norun === null && noRunStmt && stmts(E12.id).find(s => s.headline === `no session ${stamp}`)!.checkRunId === s2second, String(norun?.message));
await A.R.postImpactStatement({ ...body('Norn'), headline: `judgment ${stamp}`, numbers: [{ key: 'j', label: 'Effort', unit: 'h', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }] });
check('...and records 0 when it rests on no run at all', await holds(() => stmts(E12.id).find(s => s.headline === `judgment ${stamp}`)?.checkRunId === 0n));

// a scoped agent whose spawnedBy is not a check run: judgment only, so no run; the module records the revision it saw
await L1.R.postImpactStatement(body('Norn', { headline: `scoped judgment ${stamp}`, numbers: [{ key: 'j', label: 'Effort', unit: 'h', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }] }));
const scopedJ = await until(() => stmts(E12.id).find(s => s.headline === `scoped judgment ${stamp}`), 3000, 'the scoped judgment statement');
check('a scoped agent\'s judgment-only statement records no run and the ECR revision the module saw when it was posted', scopedJ.checkRunId === 0n && scopedJ.prRevision === pr(E12.id).revision, `checkRunId ${scopedJ.checkRunId}, prRevision ${scopedJ.prRevision}, ECR at ${pr(E12.id).revision}`);

// the publication lease: held by a connection's identity, for Norn's own agents only
const A2 = await connect({ kind: 'agent', name: `check-a2-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const claimAs = (who: { R: any }, processId: string, ms = 60_000) => rejects(who.R.claimPublication({ prId: E12.id, statementId: second.id, processId, leaseMs: ms }));
const held = () => db.publicationClaim.prId.find(E12.id);
const c1 = await claimAs(A, 'p1');
const c2 = await claimAs(A, 'p2');
const c1b = await claimAs(A, 'p1');
check('claim_publication: one holder at a time, even two processes of one identity; the second is refused with [held], the first may renew', c1 === null && c2?.message.includes('[held]') === true && c1b === null, `${c2?.message}`);
check('...and the claim is a row naming the connection\'s identity and the statement', held()?.holder.isEqual(A.identity) === true && held()?.processId === 'p1' && held()?.statementId === second.id);
const c3 = await claimAs(A2, 'p1');
check('...another Norn agent, even using the same process id, is refused while the lease stands', c3?.message.includes('[held]') === true, c3?.message);
const cExt = await claimAs(C, 'x');
const cPerson = await claimAs(P, 'x');
check('...a person and an outside agent may not claim a lease at all', cExt?.message.includes('[forbidden]') === true && cPerson?.message.includes('[forbidden]') === true, `${cExt?.message} | ${cPerson?.message}`);
await A2.R.releasePublication({ prId: E12.id, processId: 'p1' });
await C.R.releasePublication({ prId: E12.id, processId: 'p1' });
await A.R.releasePublication({ prId: E12.id, processId: 'p2' });
await sleep(200);
check('...copying the holder text does not release it: not another identity, not the same identity\'s other process', held()?.holder.isEqual(A.identity) === true && held()?.processId === 'p1');
await A.R.releasePublication({ prId: E12.id, processId: 'p1' });
check('...the holder releases it, and then another can claim', await holds(() => !held()) && (await claimAs(A2, 'q1')) === null);
await A2.R.releasePublication({ prId: E12.id, processId: 'q1' });
await claimAs(A, 'p1', 1000);
await sleep(1300);
check('a lease that is not released ends by itself: another Norn agent may claim over it', (await claimAs(A2, 'q1')) === null && (await holds(() => held()?.holder.isEqual(A2.identity))));
await A2.R.releasePublication({ prId: E12.id, processId: 'q1' });
await claimAs(A, 'p1', 1000);
await sleep(1300);
await A2.R.releasePublication({ prId: E12.id, processId: 'whatever' });
check('...or clear it', await holds(() => !held()));
const bad = await rejects(A.R.claimPublication({ prId: E12.id, statementId: 999999n, processId: 'x', leaseMs: 1000 }));
check('claiming for a statement that does not exist is refused', bad?.message.includes('does not exist') === true, bad?.message);
A2.close();
L1.close();

// ---- every write left a log row ---------------------------------------------------------------------
const names = ['register_actor', 'create_pr', 'edit_pr_text', 'add_comment', 'enqueue_check', 'record_assumption', 'set_pr_status', 'claim_check', 'complete_check', 'fail_check', 'set_config', 'upsert_part'];
const missing = names.filter(n => !logs(l => l.reducer === n && (l.actorName === 'check-a' || l.actorName === 'tylers-agent' || l.actorName === 'check-person')).length);
check('every write reducer left an action-log row naming who did it', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : names.join(', '));
const claimLog = logs(l => l.reducer === 'claim_check' && l.entity === `check_run:${s1a}`)[0];
check('a worker\'s calls on a run say they were spawned by that run', claimLog?.spawnedBy === `check_run:${s1a}` && logs(l => l.reducer === 'complete_check' && l.entity === `check_run:${s1a}`)[0]?.spawnedBy === `check_run:${s1a}`, claimLog?.spawnedBy);

// ---- tidy up: close what this run filed -------------------------------------------------------------
for (const id of created) {
  const status = pr(id).status;
  if (status !== 'merged' && status !== 'closed') await R.setPrStatus({ prId: id, status: 'closed' }).catch(() => {});
}
void result;
A.close();
C.close();
P.close();
process.exit(finish() ? 0 : 1);
