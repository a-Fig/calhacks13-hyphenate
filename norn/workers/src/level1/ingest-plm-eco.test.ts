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
import { DECIDED_STATES, RetryQueue, ecrLock, onChange, plmIngestOptionsFromEnv, readItem, recordDecided, recoverEcos, startupWanted, wanted } from './ingest-plm.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function plm(first: Record<string, any>) {
  const s = { doc: first, ecos: [] as Record<string, any>[] };
  globalThis.fetch = (async (input: any, init: any) => {
    assert.equal(init.method, 'GET');
    const path = decodeURIComponent(new URL(String(input)).pathname);
    const d = s.doc;
    if (path === '/api/resource/ECR') return new Response(JSON.stringify({ data: [{ name: d.name, title: d.title, workflow_state: d.workflow_state, modified: d.modified, modified_by: d.modified_by }] }));
    if (path === `/api/resource/ECR/${d.name}`) return new Response(JSON.stringify({ data: d }));
    if (path === '/api/resource/ECO') return new Response(JSON.stringify({ data: s.ecos }));
    throw new Error(`unexpected fake PLM path ${path}`);
  }) as typeof fetch;
  return s;
}

/** What the real runPlmIngest wires: the real `onChange`, `ingestOnce` for undecided ECRs, `recordEcoOnly` for decided ones. */
function harness() {
  const calls: { method: string; plmEcrNumber: string; ecoNumber?: string; decision?: string; decidedBy?: string; decidedOn?: string; source?: string }[] = [];
  // Anything but these two would be a dispatch or a re-check the decided ECR must not cause.
  const R = new Proxy({} as any, {
    get: (_t, method: string) => async (a: any) => { assert.ok(['ingestEcr', 'recordEcoRelease', 'recordPlmDecision'].includes(method), `unexpected call ${method}`); calls.push({ method, ...a }); },
  });
  const o = plmIngestOptionsFromEnv({});
  const sent = new Map<string, string>();
  const read = (name: string) => readItem(opts, name, itemOf);
  const report = async (item: any) => { await ingestOnce(R, { name: 'plm', list: async () => [item] }, sent, () => {}); };
  const d = { read, report, recordEco: (item: any) => recordDecided(R, item, sent, () => {}), lock: ecrLock(), retry: new RetryQueue() };
  return { calls, watcher: () => new EcrWatcher(opts, change => onChange(o, change, d), { since: '2026-01-01 00:00:00' }) };
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
    ['recordPlmDecision', 'ECR-0001', undefined, 'approved', 'rafael@acme.test'],
    ['recordEcoRelease', 'ECR-0001', 'ECO-0001', undefined, undefined],
  ], 'ingest_ecr once, for the Submitted ECR; the approval records the decision; the ECO link repeats it (a no-op for the module, and the retry for a decision Norn could not follow) and adds the release');
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
  const refused = { recordPlmDecision: async () => { n++; throw new SenderError('Norn has no ECR ECR-1'); }, recordEcoRelease: async () => {} } as any;
  await recordDecided(refused, item, sent, (m) => logs.push(m)).catch(() => {});
  await recordDecided(refused, item, sent, (m) => logs.push(m)).catch(() => {});
  assert.ok(logs.some((l) => l.includes('could not record ECR-1') && l.includes('approved')), logs.join(' | '));
  assert.equal(n, 1, 'remembered, not sent every poll');
});

test('a decided ECR is never reported to ingest_ecr, even when it is the first Norn sees of it or its text changed', async () => {
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
