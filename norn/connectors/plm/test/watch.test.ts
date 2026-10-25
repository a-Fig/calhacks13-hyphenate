// Offline tests: listEcrs and the poller, against an in-memory stand-in for the PLM's ECR list endpoint.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { EcrWatcher, listEcrs, shiftStamp, watchEcrs } from '../src/index.ts';
import type { EcrListing } from '../src/index.ts';
import { ecrDoc, opts } from './fixture.ts';

interface Row { name: string; title: string; workflow_state: string; modified: string; modified_by: string; extra?: Record<string, unknown> }
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const NORN = opts.nornUser;
const PERSON = 'ann@acme.test';
const t = (s: string) => `2026-10-24 12:00:${s}`; // t('05.100000')

/**
 * A PLM whose ECR list answers `filters`, `order_by`, `limit_page_length` and `fields` like Frappe's, and
 * whose ECR documents (for the read the poller makes of each change) are the fixture's with the row's
 * title, state, stamp, modifier and `extra` fields (an edit to a cost, Norn's impact fields) laid over it.
 */
function plm(initial: Row[] = []) {
  const rows = [...initial];
  const requests: URLSearchParams[] = [];
  const reads: string[] = [];
  let failNext = 0;
  let failReads = 0;
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    if (path === '/api/resource/ECO') return new Response(JSON.stringify({ data: [] }), { status: 200 });
    const doc = /^\/api\/resource\/ECR\/(.+)$/.exec(path);
    if (doc) {
      reads.push(doc[1]);
      if (failReads > 0) { failReads--; return new Response(JSON.stringify({ exc_type: 'ServiceUnavailable' }), { status: 503 }); }
      const r = rows.find((x) => x.name === doc[1]);
      if (!r) return new Response(JSON.stringify({ exc_type: 'DoesNotExistError' }), { status: 404 });
      return new Response(JSON.stringify({ data: { ...ecrDoc(), name: r.name, title: r.title, workflow_state: r.workflow_state, modified: r.modified, modified_by: r.modified_by, ...r.extra } }), { status: 200 });
    }
    requests.push(url.searchParams);
    if (failNext > 0) { failNext--; return new Response(JSON.stringify({ exc_type: 'OperationalError' }), { status: 500 }); }
    assert.equal(path, '/api/resource/ECR');
    let out = [...rows];
    for (const [f, op, v] of JSON.parse(url.searchParams.get('filters') ?? '[]')) {
      assert.equal(f, 'modified');
      assert.equal(op, '>');
      out = out.filter((r) => r.modified > v);
    }
    const order = url.searchParams.get('order_by') ?? 'modified asc';
    out.sort((a, b) => (order === 'modified desc' ? (a.modified < b.modified ? 1 : -1) : a.modified < b.modified ? -1 : 1));
    const limit = Number(url.searchParams.get('limit_page_length') ?? 0);
    if (limit) out = out.slice(0, limit);
    const fields: string[] = JSON.parse(url.searchParams.get('fields') ?? '[]');
    return new Response(JSON.stringify({ data: out.map((r) => Object.fromEntries(fields.map((f) => [f, (r as any)[f]]))) }), { status: 200 });
  }) as typeof fetch;
  return {
    requests,
    reads,
    /** Save a change request. `extra` fields stay on it for later saves, so an edit is kept when Norn writes next. */
    set(name: string, modified: string, by = PERSON, state = 'Submitted', extra: Record<string, unknown> = {}) {
      const i = rows.findIndex((r) => r.name === name);
      const row = { name, title: `Title of ${name}`, workflow_state: state, modified, modified_by: by, extra: { ...rows[i]?.extra, ...extra } };
      if (i >= 0) rows[i] = row; else rows.push(row);
    },
    failNext(n = 1) { failNext = n; },
    /** The next n reads of a request's document answer 503. */
    failReads(n = 1) { failReads = n; },
  };
}
const seed = (): Row[] => [
  { name: 'ECR-0001', title: 'Old', workflow_state: 'Approved', modified: t('01.000001'), modified_by: PERSON },
  { name: 'ECR-0002', title: 'Newest', workflow_state: 'Submitted', modified: t('09.500000'), modified_by: PERSON },
];
const quiet = { onError: () => {} };

test('listEcrs: everything, or only what changed after a stamp, oldest first, with who changed it', async () => {
  const p = plm(seed());
  const all = await listEcrs(opts);
  assert.deepEqual(all.map((r) => r.name), ['ECR-0001', 'ECR-0002']);
  assert.deepEqual(all[1], { name: 'ECR-0002', title: 'Newest', workflowState: 'Submitted', modified: t('09.500000'), modifiedBy: PERSON });
  assert.equal(p.requests[0].get('filters'), null);
  const some = await listEcrs(opts, { since: t('01.000001') });
  assert.deepEqual(some.map((r) => r.name), ['ECR-0002']);
  assert.equal(p.requests[1].get('filters'), JSON.stringify([['modified', '>', t('01.000001')]]));
  assert.equal(p.requests.length, 2, 'one request each');
});

test('shiftStamp moves a PLM stamp back by milliseconds, across seconds, minutes and midnight', () => {
  assert.equal(shiftStamp('2026-10-24 12:00:05.100000', 5000), '2026-10-24 12:00:00.100000');
  assert.equal(shiftStamp('2026-10-24 12:00:02.500000', 5000), '2026-10-24 11:59:57.500000');
  assert.equal(shiftStamp('2026-10-24 00:00:01', 2000), '2026-10-23 23:59:59.000000');
  assert.equal(shiftStamp('2026-01-01 00:00:00.000100', 1), '2025-12-31 23:59:59.999100');
  assert.throws(() => shiftStamp('yesterday', 1), /not a PLM timestamp/);
});

test('the watcher starts at the newest change: nothing that already exists is replayed', async () => {
  const p = plm(seed());
  const got: EcrListing[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(c); });
  assert.deepEqual(await w.tick(), []);
  assert.equal(w.highWater(), t('09.500000'));
  p.set('ECR-0003', t('11.250000'), PERSON, 'Draft');
  assert.deepEqual((await w.tick()).map((c) => [c.name, c.workflowState, c.modifiedBy]), [['ECR-0003', 'Draft', PERSON]]);
  assert.equal(w.highWater(), t('11.250000'));
  assert.deepEqual(await w.tick(), [], 'delivered once');
  assert.deepEqual(got.map((c) => c.name), ['ECR-0003']);
});

test('the high-water mark moves with each change and is what a restart resumes from', async () => {
  const p = plm(seed());
  const first: string[] = [];
  const a = new EcrWatcher(opts, (c) => { first.push(`${c.name}@${c.modified}`); });
  await a.tick();
  p.set('ECR-0003', t('12.000000'));
  p.set('ECR-0002', t('13.000000'));
  await a.tick();
  assert.deepEqual(first, [`ECR-0003@${t('12.000000')}`, `ECR-0002@${t('13.000000')}`], 'oldest first');
  const mark = a.highWater()!;
  assert.equal(mark, t('13.000000'));
  p.set('ECR-0004', t('15.000000'));
  const second: string[] = [];
  const b = new EcrWatcher(opts, (c) => { second.push(c.name); }, { since: mark });
  await b.tick();
  assert.deepEqual(second, ['ECR-0004'], 'a restart from the mark replays nothing before it');
  // and with an explicit old stamp, everything after it
  const c: string[] = [];
  await new EcrWatcher(opts, (x) => { c.push(x.name); }, { since: '1970-01-01 00:00:00' }).tick();
  assert.deepEqual(c, ['ECR-0001', 'ECR-0003', 'ECR-0002', 'ECR-0004'], 'by the time each was last modified');
});

test('the mark survives a restart in a state file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plm-watch-'));
  try {
    const stateFile = join(dir, 'mark');
    const p = plm(seed());
    const a = new EcrWatcher(opts, () => {}, { stateFile });
    await a.tick();
    p.set('ECR-0003', t('12.000000'));
    await a.tick();
    assert.equal(readFileSync(stateFile, 'utf8').trim(), t('12.000000'));
    p.set('ECR-0004', t('14.000000')); // arrives while Norn is down
    const got: string[] = [];
    const b = new EcrWatcher(opts, (c) => { got.push(c.name); }, { stateFile });
    await b.tick();
    assert.deepEqual(got, ['ECR-0004'], 'what happened while it was down is delivered, and nothing older');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** What Norn writes on an ECR: only the impact fields. */
const impact = (n: number) => ({ impact_report_level: '1', impact_recommendation: 'Approve', impact_statement: `<p>assessment ${n}</p>` });
/** A person's edit to the ECR's costs. */
const edit = (unitCost: number) => ({ cost_production: [{ name: 'cp1', label: 'Bracket unit cost', basis: 'Quote', unit_cost: unitCost, quantity: 12 }] });

test('Fern\'s own writes are not delivered, but the mark moves past them; a person\'s edit after one is', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(`${c.name}@${c.modified}`); });
  await w.tick();
  p.set('ECR-0002', t('12.000000'), PERSON, 'Submitted', edit(34.6));
  await w.tick();
  p.set('ECR-0002', t('13.000000'), NORN, 'Submitted', impact(1)); // Norn's assessment of that edit
  assert.deepEqual(await w.tick(), []);
  assert.equal(w.highWater(), t('13.000000'), 'moved past Fern\'s write');
  p.set('ECR-0002', t('14.000000'), PERSON, 'Submitted', edit(40));
  await w.tick();
  p.set('ECR-0002', t('16.000000'), NORN, 'Submitted', impact(2));
  await w.tick();
  p.set('ECR-0002', t('17.000000'), NORN, 'Submitted', { impact_statement: '<p>assessment 3</p>' }); // Norn rewrites its own text
  await w.tick();
  assert.deepEqual(got, [`ECR-0002@${t('12.000000')}`, `ECR-0002@${t('14.000000')}`]);
});

test('a person\'s edit that Fern\'s write lands on before the next pass is still delivered', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(`${c.name}:${c.modifiedBy === NORN ? 'norn' : 'person'}`); });
  await w.tick();
  p.set('ECR-0002', t('12.000000'), PERSON, 'Submitted', edit(25));
  await w.tick(); // delivered: Norn starts assessing a cost of 25
  // A person raises the cost, and Norn's publisher then writes the assessment of the old cost, before the next pass.
  p.set('ECR-0002', t('14.000000'), PERSON, 'Submitted', edit(34.6));
  p.set('ECR-0002', t('14.800000'), NORN, 'Submitted', impact(1));
  const delivered = await w.tick();
  assert.deepEqual(delivered.map((c) => [c.name, c.modifiedBy]), [['ECR-0002', NORN]], 'the row\'s last modifier is Fern, but its inputs changed');
  assert.equal(w.highWater(), t('14.800000'));
  // Norn assesses 34.6 and writes it: that is an echo of a delivered state
  p.set('ECR-0002', t('16.000000'), NORN, 'Submitted', impact(2));
  assert.deepEqual(await w.tick(), []);
  assert.deepEqual(got, ['ECR-0002:person', 'ECR-0002:norn']);
});

test('a save that changes nothing an assessment is made from is not delivered; a change of state or text is', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(`${c.workflowState}@${c.modified}`); });
  await w.tick();
  p.set('ECR-0002', t('12.000000'), PERSON, 'Submitted');
  p.set('ECR-0003', t('12.500000'), PERSON, 'Draft');
  await w.tick();
  p.set('ECR-0002', t('14.000000'), PERSON, 'Submitted'); // saved again, same content
  await w.tick();
  p.set('ECR-0002', t('16.000000'), PERSON, 'In CM Review');
  p.set('ECR-0003', t('17.000000'), PERSON, 'Draft', { description: 'Thicker plate, now with a shot-peen.' });
  await w.tick();
  assert.deepEqual(got, [`Submitted@${t('12.000000')}`, `Draft@${t('12.500000')}`, `In CM Review@${t('16.000000')}`, `Draft@${t('17.000000')}`]);
});

test('a request that cannot be read is offered again and then given up on like a failed delivery', async () => {
  const p = plm(seed());
  const errors: string[] = [];
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(c.name); }, { maxAttempts: 2, onError: (e) => errors.push((e as Error).message) });
  await w.tick();
  p.set('ECR-0003', t('12.000000'), PERSON, 'Submitted', { priority: 'Not a priority' }); // the settings do not map it
  await w.tick();
  assert.equal(w.highWater(), t('09.500000'), 'held behind the unreadable one for now');
  p.set('ECR-0004', t('13.000000'));
  await w.tick();
  assert.deepEqual(got, ['ECR-0004']);
  assert.ok(errors.some((e) => e.includes('giving up on ECR-0003')));
  assert.equal(w.highWater(), t('13.000000'));
});

test('a change that commits late, with an older stamp than one already delivered, is still delivered, once', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(c.name); }, { overlapMs: 5000 });
  await w.tick();
  p.set('ECR-0010', t('20.000000'));
  await w.tick();
  p.set('ECR-0009', t('18.500000')); // saved before ECR-0010, committed after it
  await w.tick();
  await w.tick();
  await w.tick();
  assert.deepEqual(got, ['ECR-0010', 'ECR-0009']);
  assert.equal(w.highWater(), t('20.000000'));
});

test('an onChange that throws is offered again; after maxAttempts it is given up on and the rest proceed', async () => {
  const p = plm(seed());
  const errors: string[] = [];
  const attempts: string[] = [];
  const delivered: string[] = [];
  const w = new EcrWatcher(opts, (c) => {
    attempts.push(c.name);
    if (c.name === 'ECR-0003') throw new Error('bad request');
    delivered.push(c.name);
  }, { maxAttempts: 3, onError: (e) => errors.push((e as Error).message) });
  await w.tick();
  p.set('ECR-0003', t('12.000000'));
  p.set('ECR-0004', t('13.000000'));
  await w.tick();
  assert.deepEqual(attempts, ['ECR-0003'], 'a failure holds back the later ones for now');
  assert.equal(w.highWater(), t('09.500000'));
  await w.tick();
  assert.deepEqual(delivered, []);
  await w.tick(); // third failure: given up on
  assert.deepEqual(delivered, ['ECR-0004']);
  assert.equal(attempts.filter((n) => n === 'ECR-0003').length, 3);
  assert.ok(errors.some((e) => e.includes('giving up on ECR-0003')));
  assert.equal(w.highWater(), t('13.000000'));
  await w.tick();
  assert.equal(attempts.filter((n) => n === 'ECR-0003').length, 3, 'not offered again');
});

test('a failed pass is reported and the next one carries on from the same mark', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(c.name); }, quiet);
  await w.tick();
  p.set('ECR-0003', t('12.000000'));
  p.failNext();
  await assert.rejects(w.tick(), (e: any) => e.name === 'PlmError' && e.status === 500);
  assert.equal(w.highWater(), t('09.500000'));
  assert.deepEqual(await w.tick(), [{ name: 'ECR-0003', title: 'Title of ECR-0003', workflowState: 'Submitted', modified: t('12.000000'), modifiedBy: PERSON }]);
  assert.deepEqual(got, ['ECR-0003']);
});

test('watchEcrs polls on its own, reports a pass that fails, and stops when told', async () => {
  const p = plm(seed());
  const got: string[] = [];
  const errors: unknown[] = [];
  const w = watchEcrs(opts, (c) => { got.push(c.name); }, { intervalMs: 20, onError: (e) => errors.push(e) });
  try {
  await w.ready();
  p.set('ECR-0003', t('12.000000'));
  const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };
  await until(() => got.length === 1);
  assert.deepEqual(got, ['ECR-0003']);
  p.failNext(2);
  await until(() => errors.length >= 2);
  assert.ok(errors.length >= 2, 'failed passes are reported, not thrown');
  p.set('ECR-0004', t('14.000000'));
  await until(() => got.length === 2);
  assert.deepEqual(got, ['ECR-0003', 'ECR-0004'], 'it recovered');
  } finally {
    await w.stop(); // a failed assertion must not leave the poller running
  }
  const n = p.requests.length;
  p.set('ECR-0005', t('16.000000'));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(p.requests.length, n, 'no more requests after stop');
  assert.deepEqual(got, ['ECR-0003', 'ECR-0004']);
});

test('each pass is one request that asks only for what is newer than the mark, less the look-back', async () => {
  const p = plm(seed());
  const w = new EcrWatcher(opts, () => {}, { ...quiet, overlapMs: 5000 });
  await w.tick(); // the starting mark, then a pass
  const filter = (i: number) => JSON.parse(p.requests[i].get('filters') ?? '[]')[0]?.[2];
  assert.equal(p.requests[0].get('order_by'), 'modified desc', 'the first request finds the newest stamp');
  assert.equal(filter(1), t('09.500000'), 'never earlier than where it started');
  p.set('ECR-0003', t('30.000000'));
  await w.tick();
  await w.tick();
  assert.equal(filter(2), t('09.500000'));
  assert.equal(filter(3), '2026-10-24 12:00:25.000000', 'five seconds behind the mark');
  assert.equal(p.requests.length, 4);
});

test('a read of the request that fails for the PLM, not the ECR, is not a failed delivery: the request is delivered, never given up on, and the mark moves on', async () => {
  const p = plm(seed());
  const errors: string[] = [];
  const got: string[] = [];
  const w = new EcrWatcher(opts, (c) => { got.push(c.name); }, { maxAttempts: 2, onError: (e) => errors.push((e as Error).message) });
  await w.tick();
  p.set('ECR-0003', t('12.000000'));
  p.failReads(5); // the watcher's own read of the request fails, as would any other in this pass
  await w.tick();
  assert.deepEqual(got, ['ECR-0003'], 'delivered without a fingerprint: the handler reads it again and owns the retry');
  assert.equal(errors.some((e) => e.includes('giving up')), false, errors.join(' | '));
  assert.equal(w.highWater(), t('12.000000'));
});

test('a read that fails on the PLM side is not counted toward giving up on a request whose handler keeps failing for its own reasons only', async () => {
  const p = plm(seed());
  const errors: string[] = [];
  const attempts: string[] = [];
  const w = new EcrWatcher(opts, (c) => { attempts.push(c.name); if (attempts.length < 3) throw new Error('Fern unreachable'); }, { maxAttempts: 3, onError: (e) => errors.push((e as Error).message) });
  await w.tick();
  p.set('ECR-0003', t('12.000000'));
  p.failReads(2);
  await w.tick(); // read fails (not counted), handler fails: failure 1
  await w.tick(); // read fails (not counted), handler fails: failure 2
  await w.tick(); // read works, handler works
  assert.deepEqual(attempts, ['ECR-0003', 'ECR-0003', 'ECR-0003']);
  assert.equal(errors.some((e) => e.includes('giving up')), false, errors.join(' | '));
});
