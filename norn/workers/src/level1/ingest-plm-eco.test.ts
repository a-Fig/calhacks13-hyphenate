// An approved ECR still has to deliver its ECO number (#72): the PLM links the ECO to the ECR a moment after the approval, in
// the Approved state, and the default ingest states leave Approved out. Replays Submitted, Approved, Approved with
// `released_eco` through the real watcher, `onChange`, `readItem` and `ingestOnce`, against a fake PLM that answers GET only.
// The lead's constraint: for a decided ECR the `released_eco` link records the ECO release and nothing else: no ingest_ecr (so
// no revision bump, no re-check, no Level 1 agent or dispatch, all of which start from it).
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { EcrWatcher } from '../../../connectors/plm/src/index.ts';
import { ecrDoc, opts } from '../../../connectors/plm/test/fixture.ts';
import { ingestOnce, itemOf } from '../ingest.ts';
import { ECO_STATES, RetryQueue, ecrLock, onChange, plmIngestOptionsFromEnv, readItem, recordEcoOnly, startupWanted, wanted } from './ingest-plm.ts';

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
  const calls: { method: string; plmEcrNumber: string; ecoNumber?: string }[] = [];
  // Anything but these two would be a dispatch or a re-check the decided ECR must not cause.
  const R = new Proxy({} as any, {
    get: (_t, method: string) => async (a: any) => { assert.ok(['ingestEcr', 'recordEcoRelease'].includes(method), `unexpected call ${method}`); calls.push({ method, ...a }); },
  });
  const o = plmIngestOptionsFromEnv({});
  const sent = new Map<string, string>();
  const read = (name: string) => readItem(opts, name, itemOf);
  const report = async (item: any) => { await ingestOnce(R, { name: 'plm', list: async () => [item] }, sent, () => {}); };
  const d = { read, report, recordEco: (item: any) => recordEcoOnly(R, item, sent, () => {}), lock: ecrLock(), retry: new RetryQueue() };
  return { calls, watcher: () => new EcrWatcher(opts, change => onChange(o, change, d), { since: '2026-01-01 00:00:00' }) };
}

test('an approved ECR, and the later link to its ECO, record the ECO release and nothing else', async () => {
  const p = plm(ecrDoc());
  const h = harness();
  const w = h.watcher();
  await w.tick(); // Submitted
  p.doc = { ...p.doc, workflow_state: 'Approved', modified: '2026-10-02 10:30:16.250000' };
  await w.tick(); // Approved, the ECO not linked yet
  p.doc = { ...p.doc, released_eco: 'ECO-0001', modified: '2026-10-02 10:30:17.250000' };
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02' }];
  await w.tick(); // Approved, released_eco set
  await w.tick(); // nothing new

  assert.deepEqual(h.calls.map((c) => [c.method, c.plmEcrNumber, c.ecoNumber]), [['ingestEcr', 'ECR-0001', undefined], ['recordEcoRelease', 'ECR-0001', 'ECO-0001']],
    'ingest_ecr once, for the Submitted ECR; the approval and the ECO link add the release and no second ingest_ecr');
});

test('a decided ECR is never reported to ingest_ecr, even when it is the first Norn sees of it or its text changed', async () => {
  const p = plm({ ...ecrDoc(), workflow_state: 'Approved', released_eco: 'ECO-0001', title: 'Edited after the approval' });
  p.ecos = [{ name: 'ECO-0001', released_on: '2026-10-02' }];
  const h = harness();
  await h.watcher().tick();
  assert.deepEqual(h.calls.map((c) => c.method), ['recordEcoRelease']);
});

test('an approved ECR whose ECO is not linked yet does nothing', async () => {
  plm({ ...ecrDoc(), workflow_state: 'Approved' });
  const h = harness();
  await h.watcher().tick();
  assert.deepEqual(h.calls, []);
});

test('the first listing still takes in only undecided ECRs, not the PLM\'s approved history', () => {
  const o = plmIngestOptionsFromEnv({});
  assert.deepEqual(ECO_STATES, ['Approved']);
  assert.equal(wanted(o, { name: 'ECR-1', workflowState: 'Approved' }), true);
  assert.equal(startupWanted(o, { name: 'ECR-1', workflowState: 'Approved' }), false);
  assert.equal(startupWanted(o, { name: 'ECR-1', workflowState: 'CCB Review' }), true);
  assert.equal(wanted(o, { name: 'ECR-1', workflowState: 'Rejected' }), false);
  assert.equal(wanted(plmIngestOptionsFromEnv({ NORN_PLM_ECRS: 'ECR-2' }), { name: 'ECR-1', workflowState: 'Approved' }), false, 'NORN_PLM_ECRS still narrows');
  assert.equal(startupWanted(plmIngestOptionsFromEnv({ NORN_PLM_STATES: 'Approved' }), { name: 'ECR-1', workflowState: 'Approved' }), true, 'unless Approved is asked for');
});
