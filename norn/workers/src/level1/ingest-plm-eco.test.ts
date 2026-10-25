// A decided ECR has to reach Norn (#72): the PLM is the system of record for the decision, and its release automation links the
// ECO to the ECR a moment after the approval, in the Approved state. Replays Submitted, Approved, Approved with `released_eco`
// (and Rejected) through the real watcher, `onChange`, `readItem` and `ingestOnce`, against a fake PLM that answers GET only.
// The constraint: a decided ECR records its decision and its ECO release and nothing else: no ingest_ecr (so no revision bump,
// no re-check, no Level 1 agent or dispatch, all of which start from it).
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { SenderError } from 'spacetimedb';
import { EcrWatcher } from '../../../connectors/plm/src/index.ts';
import { ecrDoc, opts } from '../../../connectors/plm/test/fixture.ts';
import { ingestOnce, itemOf } from '../ingest.ts';
import { DECIDED_STATES, DecisionNotFollowed, RetryQueue, ecrLock, followedFrom, onChange, plmIngestOptionsFromEnv, readItem, recordDecided, recoverEcos, retryDue, routed, startupWanted, takeIn, wanted, type Followed } from './ingest-plm.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function plm(first: Record<string, any>) {
  const s = { doc: first, ecos: [] as Record<string, any>[], failReads: 0 };
  globalThis.fetch = (async (input: any, init: any) => {
    assert.equal(init.method, 'GET');
    const path = decodeURIComponent(new URL(String(input)).pathname);
    const d = s.doc;
    if (path === '/api/resource/ECR') return new Response(JSON.stringify({ data: [{ name: d.name, title: d.title, workflow_state: d.workflow_state, modified: d.modified, modified_by: d.modified_by }] }));
    if (path === `/api/resource/ECR/${d.name}`) {
      if (s.failReads > 0) { s.failReads--; return new Response(JSON.stringify({ exc_type: 'ServiceUnavailable' }), { status: 503 }); }
      return new Response(JSON.stringify({ data: d }));
    }
    if (path === '/api/resource/ECO') return new Response(JSON.stringify({ data: s.ecos }));
    throw new Error(`unexpected fake PLM path ${path}`);
  }) as typeof fetch;
  return s;
}

/** What the real runPlmIngest wires: the real `onChange`, `ingestOnce` for undecided ECRs, `recordEcoOnly` for decided ones. */
function harness(followed?: Followed) {
  const calls: { method: string; plmEcrNumber: string; ecoNumber?: string; decision?: string; decidedBy?: string; decidedOn?: string; source?: string; changeRequestJson?: string }[] = [];
  // Anything but these two would be a dispatch or a re-check the decided ECR must not cause.
  const R = new Proxy({} as any, {
    get: (_t, method: string) => async (a: any) => { assert.ok(['ingestEcr', 'recordEcoRelease', 'recordPlmDecision'].includes(method), `unexpected call ${method}`); calls.push({ method, ...a }); },
  });
  const o = plmIngestOptionsFromEnv({});
  const sent = new Map<string, string>();
  const read = (name: string) => readItem(opts, name, itemOf);
  const report = async (item: any) => { await ingestOnce(R, { name: 'plm', list: async () => [item] }, sent, () => {}); };
  const d = { read, report, recordEco: (item: any) => recordDecided(R, item, sent, () => {}, followed), lock: ecrLock(), retry: new RetryQueue() };
  return { calls, R, sent, d, watcher: () => new EcrWatcher(opts, change => onChange(o, change, d), { since: '2026-01-01 00:00:00' }) };
}

test('an approved ECR records the PLM decision, and the later link to its ECO the ECO release, and nothing else', async () => {
  const p = plm(ecrDoc());
  const h = harness();
  const w = h.watcher();
  await w.tick(); // Submitted
  p.doc = { ...p.doc, workflow_state: 'Approved', modified: '2026-10-02 10:30:16.250000', modified_by: 'rafael@acme.test', decided_on: '2026-10-02 10:30:16.000000' };
  await w.tick(); // Approved by Rafael, the ECO not linked yet
  p.doc = { ...p.doc, released_eco: 'ECO-0001', modified: '2026-10-02 10:30:17.250000', modified_by: 'eco-release@acme.test' };
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02', released_by: 'rafael@acme.test' }];
  await w.tick(); // Approved, released_eco set: the bot touched the ECR, the ECO names the approver
  await w.tick(); // nothing new

  assert.deepEqual(h.calls.map((c) => [c.method, c.plmEcrNumber, c.ecoNumber, c.decision, c.decidedBy]), [
    ['ingestEcr', 'ECR-0001', undefined, undefined, undefined],
    ['recordPlmDecision', 'ECR-0001', undefined, 'approved', 'rafael@acme.test'],
    ['recordEcoRelease', 'ECR-0001', 'ECO-0001', undefined, undefined],
  ], 'ingest_ecr once, for the Submitted ECR; the approval records the decision (once it is followed, it is not sent again); the ECO link adds the release');
  assert.equal(h.calls[1]!.decidedOn, '2026-10-02 10:30:16.000000');
  assert.equal(h.calls[1]!.source, 'plm');
});

test("the approver is the ECO's releaser, not the release bot that last touched the ECR", async () => {
  const p = plm({ ...ecrDoc(), workflow_state: 'Approved', released_eco: 'ECO-0001', modified_by: 'eco-release@acme.test' });
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02', released_by: 'rafael@acme.test' }];
  const item = await readItem(opts, 'ECR-0001', itemOf);
  assert.deepEqual(item.decision, { decision: 'approved', decidedBy: 'rafael@acme.test', decidedOn: '2026-10-02 10:30:15.250000' });
});

test('a rejected ECR records the decision and nothing else', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Rejected', modified_by: 'rafael@acme.test' });
  const h = harness();
  await h.watcher().tick();
  assert.deepEqual(h.calls.map((c) => [c.method, c.decision, c.decidedBy]), [['recordPlmDecision', 'rejected', 'rafael@acme.test']]);
});

test('an undecided ECR carries no decision', async () => {
  plm(ecrDoc());
  assert.equal((await readItem(opts, 'ECR-0001', itemOf)).decision, undefined);
});

test('a decision the module refuses for good is logged and not sent again on every poll', async () => {
  const item = { plmEcrNumber: 'ECR-1', sourceRef: 'x', decision: { decision: 'approved', decidedBy: 'a@b', decidedOn: 'now' } } as any;
  const logs: string[] = [];
  const sent = new Map<string, string>();
  let n = 0;
  const refused = { recordPlmDecision: async () => { n++; throw new SenderError('Fern has no ECR ECR-1'); }, recordEcoRelease: async () => {} } as any;
  await recordDecided(refused, item, sent, (m) => logs.push(m)).catch(() => {});
  await recordDecided(refused, item, sent, (m) => logs.push(m)).catch(() => {});
  assert.ok(logs.some((l) => l.includes('could not record ECR-1') && l.includes('approved')), logs.join(' | '));
  assert.equal(n, 1, 'remembered, not sent every poll');
});

test('a decided ECR is never reported to ingest_ecr, even when it is the first Fern sees of it or its text changed', async () => {
  const p = plm({ ...ecrDoc(), workflow_state: 'Approved', released_eco: 'ECO-0001', title: 'Edited after the approval' });
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02' }];
  const h = harness();
  await h.watcher().tick();
  assert.deepEqual(h.calls.map((c) => c.method), ['recordPlmDecision', 'recordEcoRelease']);
});

test('an approved ECR whose ECO is not linked yet records its decision only', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Approved' });
  const h = harness();
  await h.watcher().tick();
  assert.deepEqual(h.calls.map((c) => c.method), ['recordPlmDecision']);
});

test('a decided ECR is never reported to ingest_ecr even when NORN_PLM_STATES asks for its state', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Approved' });
  const o = plmIngestOptionsFromEnv({ NORN_PLM_STATES: 'Submitted,Approved,Rejected' });
  const calls: string[] = [];
  const R = new Proxy({} as any, { get: (_t, m: string) => async () => { calls.push(m); } });
  const sent = new Map<string, string>();
  const d = { read: (name: string) => readItem(opts, name, itemOf), report: async () => { calls.push('report'); }, recordEco: (item: any) => recordDecided(R, item, sent, () => {}), lock: ecrLock(), retry: new RetryQueue() };
  await onChange(o, { name: 'ECR-0001', workflowState: 'Approved' }, d);
  assert.deepEqual(calls, ['recordPlmDecision']);
});

test('the first listing still takes in only undecided ECRs, not the PLM\'s approved history', () => {
  const o = plmIngestOptionsFromEnv({});
  assert.deepEqual(DECIDED_STATES, ['Approved', 'Rejected']);
  assert.equal(wanted(o, { name: 'ECR-1', workflowState: 'Approved' }), true);
  assert.equal(startupWanted(o, { name: 'ECR-1', workflowState: 'Approved' }), false);
  assert.equal(wanted(o, { name: 'ECR-1', workflowState: 'Rejected' }), true);
  assert.equal(startupWanted(o, { name: 'ECR-1', workflowState: 'Rejected' }), false);
  assert.equal(startupWanted(o, { name: 'ECR-1', workflowState: 'CCB Review' }), true);
  assert.equal(wanted(o, { name: 'ECR-1', workflowState: 'Sent Back' }), false);
  assert.equal(wanted(plmIngestOptionsFromEnv({ NORN_PLM_ECRS: 'ECR-2' }), { name: 'ECR-1', workflowState: 'Approved' }), false, 'NORN_PLM_ECRS still narrows');
  assert.equal(startupWanted(plmIngestOptionsFromEnv({ NORN_PLM_STATES: 'Approved' }), { name: 'ECR-1', workflowState: 'Approved' }), false, 'even if Approved is asked for: a decided ECR is only recorded');
});

test('at start-up, a decision or an ECO from while the process was down is recorded, and one failure does not stop the others', async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const items: Record<string, any> = { 'ECR-1': { plmEcrNumber: 'ECR-1', eco: 'ECO-1' }, 'ECR-3': { plmEcrNumber: 'ECR-3' }, 'ECR-4': { plmEcrNumber: 'ECR-4', eco: 'ECO-4' }, 'ECR-5': { plmEcrNumber: 'ECR-5', decision: { decision: 'rejected' } } };
  const read = async (name: string) => { if (name === 'ECR-2') throw new Error('PLM 500'); return items[name]; };
  const failed = await recoverEcos(['ECR-1', 'ECR-2', 'ECR-3', 'ECR-4', 'ECR-5'], read, async (item) => { calls.push(`${item.plmEcrNumber}:${item.eco}`); }, ecrLock(), (m) => logs.push(m));
  assert.deepEqual(calls, ['ECR-1:ECO-1', 'ECR-4:ECO-4', 'ECR-5:undefined'], 'only ECRs with an ECO or a decision, and past the one that failed');
  assert.ok(logs.some((l) => l.includes('ECR-2') && l.includes('PLM 500')), logs.join(' | '));
  assert.deepEqual(failed, ['ECR-2'], 'the failed one is handed back to be tried again');
});

// ---- what the review of #129 found ------------------------------------------------------------------------------

const decidedItem = (extra: Record<string, any> = {}) => ({ plmEcrNumber: 'ECR-1', title: 't', description: '', changeRequest: { id: 'ECR-1', qty: 2 }, sourceRef: 'x', decision: { decision: 'approved', decidedBy: 'a@b', decidedOn: 'now' }, ...extra }) as any;

test('an approval Fern has not followed is not remembered as delivered: it is sent again, and remembered once it is followed', async () => {
  const sent = new Map<string, string>();
  const calls: string[] = [];
  const R = { recordPlmDecision: async () => { calls.push('decision'); }, recordEcoRelease: async () => { calls.push('eco'); } } as any;
  let merged = false; // the checks finish between the tries
  const followed: Followed = async () => merged;
  const item = decidedItem({ eco: 'ECO-1' });
  await assert.rejects(recordDecided(R, item, sent, () => {}, followed), DecisionNotFollowed);
  assert.equal(sent.has('decision:ECR-1'), false, 'not cached');
  assert.equal(sent.get('eco:ECR-1'), 'ECO-1', 'the ECO number the PLM issued is still recorded');
  await assert.rejects(recordDecided(R, item, sent, () => {}, followed), DecisionNotFollowed);
  merged = true;
  await recordDecided(R, item, sent, () => {}, followed);
  assert.equal(sent.get('decision:ECR-1'), 'approved');
  await recordDecided(R, item, sent, () => {}, followed);
  assert.deepEqual(calls, ['decision', 'eco', 'decision', 'decision'], 'sent on every try until followed, then not again; the ECO once');
});

test('the watcher queues an unfollowed approval for retry instead of failing, and the retry delivers it once Fern follows', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Approved', modified_by: 'rafael@acme.test' });
  let merged = false;
  const h = harness(async () => merged);
  await onChange(plmIngestOptionsFromEnv({}), { name: 'ECR-0001', workflowState: 'Approved' }, { ...h.d, now: () => 0 });
  assert.equal(h.d.retry.has('ECR-0001'), true, 'queued');
  assert.deepEqual(h.calls.map((c) => c.method), ['recordPlmDecision']);
  const read = (name: string) => readItem(opts, name, itemOf);
  const deliver = routed({ report: h.d.report, recordEco: h.d.recordEco });
  const early = await retryDue(h.d.retry, read, deliver, () => {}, () => 10_000, h.d.lock);
  assert.deepEqual(early.retrying, ['ECR-0001'], 'still not followed: stays queued');
  merged = true;
  const late = await retryDue(h.d.retry, read, deliver, () => {}, () => 100_000, h.d.lock);
  assert.deepEqual(late.taken, ['ECR-0001']);
  assert.equal(h.d.retry.has('ECR-0001'), false);
  assert.deepEqual(h.calls.map((c) => c.method), ['recordPlmDecision', 'recordPlmDecision', 'recordPlmDecision'], 'sent on every try until followed; never ingest_ecr');
});

test('followedFrom: an approval is followed when the ECR is merged, a rejection when it is closed, and it waits for the table to catch up', async () => {
  let status: string | undefined = 'draft';
  const followed = followedFrom(() => status, 200, 10);
  assert.equal(await followed('ECR-1', 'approved'), false);
  assert.equal(await followed('ECR-1', 'rejected'), false);
  setTimeout(() => (status = 'merged'), 40);
  assert.equal(await followed('ECR-1', 'approved'), true, 'a status that lands a moment after the reducer returns');
  assert.equal(await followed('ECR-1', 'rejected'), false);
  status = 'closed';
  assert.equal(await followed('ECR-1', 'rejected'), true);
});

test('the decision carries the change request Fern would have stored for the PLM content, so an unseen edit cannot ride on an approval', async () => {
  const h = harness();
  const seen = plm(ecrDoc());
  const submitted = await readItem(opts, 'ECR-0001', itemOf);
  const approvedSame: Record<string, any> = { ...seen.doc, workflow_state: 'Approved', modified: '2026-10-24 21:01:00.000000', modified_by: 'rafael@acme.test' };
  seen.doc = approvedSame;
  const same = await readItem(opts, 'ECR-0001', itemOf);
  assert.equal(JSON.stringify(same.changeRequest), JSON.stringify(submitted.changeRequest), 'approving changes nothing the checks read, so the digest matches the one ingest_ecr stored');
  const edited = structuredClone(approvedSame);
  edited.bom_changes[0].qty_to = 200;
  seen.doc = edited;
  const changed = await readItem(opts, 'ECR-0001', itemOf);
  await recordDecided(h.R, same, new Map(), () => {});
  await recordDecided(h.R, changed, new Map(), () => {});
  const sentJson = h.calls.filter((c) => c.method === 'recordPlmDecision').map((c) => c.changeRequestJson);
  assert.equal(sentJson[0], JSON.stringify(submitted.changeRequest));
  assert.notEqual(sentJson[1], sentJson[0], 'the edit shows in what the module compares');
});

// A decided ECR is routed by the state of the read that delivers it, whichever path read it.
function racing() {
  const calls: string[] = [];
  const decided = decidedItem({ decision: { decision: 'rejected', decidedBy: 'a@b', decidedOn: 'now' } });
  const report = async () => void calls.push('ingestEcr');
  const recordEco = async () => void calls.push('recordDecided');
  return { calls, decided, report, recordEco, deliver: routed({ report, recordEco }) };
}

test('start-up take-in: an ECR listed as undecided but read as decided is only recorded', async () => {
  const r = racing();
  await takeIn(['ECR-1'], async () => r.decided, r.deliver, () => {});
  assert.deepEqual(r.calls, ['recordDecided']);
});

test('a queued retry whose fresh read says decided is only recorded', async () => {
  const r = racing();
  const retry = new RetryQueue(1);
  retry.fail('ECR-1', 0);
  await retryDue(retry, async () => r.decided, r.deliver, () => {}, () => 5, ecrLock());
  assert.deepEqual(r.calls, ['recordDecided']);
});

test('the watcher: a Submitted listing whose read says Rejected is only recorded', async () => {
  const r = racing();
  await onChange(plmIngestOptionsFromEnv({}), { name: 'ECR-1', workflowState: 'Submitted' }, { read: async () => r.decided, report: r.report, recordEco: r.recordEco, lock: ecrLock(), retry: new RetryQueue() });
  assert.deepEqual(r.calls, ['recordDecided']);
});

test('an undecided read is still reported, by every path', async () => {
  const calls: string[] = [];
  const open = decidedItem({ decision: undefined });
  const report = async () => void calls.push('ingestEcr');
  const recordEco = async () => void calls.push('recordDecided');
  await takeIn(['ECR-1'], async () => open, routed({ report, recordEco }), () => {});
  await onChange(plmIngestOptionsFromEnv({}), { name: 'ECR-1', workflowState: 'Submitted' }, { read: async () => open, report, recordEco, lock: ecrLock(), retry: new RetryQueue() });
  assert.deepEqual(calls, ['ingestEcr', 'ingestEcr']);
});

// ---- round 3 of the review of #129 -------------------------------------------------------------------------------

test('the decision carries the ECR title and description as read, so a text edit in the PLM is visible to the module', async () => {
  const h = harness();
  const seen = plm({ ...ecrDoc(), workflow_state: 'Approved', modified_by: 'rafael@acme.test' });
  const before = await readItem(opts, 'ECR-0001', itemOf);
  seen.doc = { ...seen.doc, title: 'NEW: mandatory fleet grounding until replaced', description: 'cancel the old proposal' } as any;
  const after = await readItem(opts, 'ECR-0001', itemOf);
  await recordDecided(h.R, before, new Map(), () => {});
  await recordDecided(h.R, after, new Map(), () => {});
  const sent = h.calls.filter((c) => c.method === 'recordPlmDecision') as any[];
  assert.equal(sent[0].title, before.title);
  assert.equal(sent[0].description, before.description);
  assert.equal(sent[1].title, 'NEW: mandatory fleet grounding until replaced');
  assert.equal(sent[1].description, 'cancel the old proposal');
  assert.equal(sent[0].changeRequestJson, sent[1].changeRequestJson, 'only the narrative differs: the change request digest alone would not see it');
});

test('a transient failure delivering a decision from the watcher is queued for retry, not lost to the watcher giving up', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Approved', modified_by: 'rafael@acme.test' });
  const calls: string[] = [];
  let failing = 3;
  const R = { recordPlmDecision: async () => { calls.push('decision'); if (failing-- > 0) throw new Error('Fern unreachable'); }, recordEcoRelease: async () => {} } as any;
  const sent = new Map<string, string>();
  const retry = new RetryQueue(1);
  const lock = ecrLock();
  const logs: string[] = [];
  const errors: string[] = [];
  const o = plmIngestOptionsFromEnv({});
  const d = { read: (name: string) => readItem(opts, name, itemOf), report: async () => { calls.push('ingestEcr'); }, recordEco: (item: any) => recordDecided(R, item, sent, () => {}, async () => true), lock, retry, now: () => 0, log: (m: string) => logs.push(m) };
  const w = new EcrWatcher(opts, (change) => onChange(o, change, d), { since: '2026-01-01 00:00:00', onError: (e) => errors.push((e as Error).message) });
  for (let i = 0; i < 4; i++) await w.tick();
  assert.equal(errors.some((e) => e.includes('giving up')), false, errors.join(' | '));
  assert.equal(retry.has('ECR-0001'), true, 'in the retry queue');
  assert.ok(logs.some((l) => l.includes('ECR-0001') && l.includes('will retry') && l.includes('Fern unreachable')), logs.join(' | '));
  assert.equal(sent.has('decision:ECR-0001'), false, 'not remembered as delivered');
  // Norn comes back: the queue sends it again, with a fresh read, and the decision goes through.
  const read = (name: string) => readItem(opts, name, itemOf);
  let n = 0;
  while (retry.has('ECR-0001') && n++ < 10) await retryDue(retry, read, routed({ report: d.report, recordEco: d.recordEco }), () => {}, () => 1_000_000 + n * 100_000, lock);
  assert.equal(retry.has('ECR-0001'), false);
  assert.equal(sent.get('decision:ECR-0001'), 'approved');
  assert.equal(calls.includes('ingestEcr'), false);
});

test('a transient failure reading the ECR from the watcher is queued too, and a mapping error is still left to the watcher', async () => {
  const retry = new RetryQueue(1);
  const o = plmIngestOptionsFromEnv({});
  const base = { report: async () => {}, recordEco: async () => {}, lock: ecrLock(), retry, now: () => 0, log: () => {} };
  await onChange(o, { name: 'ECR-1', workflowState: 'Submitted' }, { ...base, read: async () => { throw new Error('PLM 503'); } });
  assert.equal(retry.has('ECR-1'), true);
  const { PlmMappingError } = await import('../../../connectors/plm/src/index.ts');
  await assert.rejects(onChange(o, { name: 'ECR-2', workflowState: 'Submitted' }, { ...base, read: async () => { throw new PlmMappingError('bad field'); } }), /bad field/);
  assert.equal(retry.has('ECR-2'), false, 'the ECR is at fault: the watcher offers it again once someone fixes it');
});

test('three HTTP 503s on an approved ECR, then recovery: the decision is delivered, and nothing is given up on', async () => {
  const p = plm({ ...ecrDoc(), workflow_state: 'Approved', released_eco: 'ECO-0001', modified_by: 'eco-release@acme.test' });
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02', released_by: 'rafael@acme.test' }];
  p.failReads = 3;
  const calls: string[] = [];
  const R = { recordPlmDecision: async () => void calls.push('decision'), recordEcoRelease: async () => void calls.push('eco') } as any;
  const sent = new Map<string, string>();
  const retry = new RetryQueue(1);
  const lock = ecrLock();
  const errors: string[] = [];
  const o = plmIngestOptionsFromEnv({});
  const read = (name: string) => readItem(opts, name, itemOf);
  const recordEco = (item: any) => recordDecided(R, item, sent, () => {}, async () => true);
  const d = { read, report: async () => void calls.push('ingestEcr'), recordEco, lock, retry, now: () => 0, log: () => {} };
  const w = new EcrWatcher(opts, (change) => onChange(o, change, d), { since: '2026-01-01 00:00:00', onError: (e) => errors.push((e as Error).message) });
  for (let i = 0; i < 6; i++) await w.tick(); // five healthy polls follow the failures
  let n = 0;
  while (retry.has('ECR-0001') && n++ < 10) await retryDue(retry, read, routed({ report: d.report, recordEco }), () => {}, () => 1_000_000 + n * 100_000, lock);
  assert.equal(errors.some((e) => e.includes('giving up')), false, errors.join(' | '));
  assert.equal(retry.has('ECR-0001'), false);
  assert.deepEqual(calls, ['decision', 'eco'], 'delivered once, and no ingest_ecr');
  assert.equal(sent.get('decision:ECR-0001'), 'approved');
});
