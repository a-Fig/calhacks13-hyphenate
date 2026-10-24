// The first listing's per-ECR error handling (ingest-plm.ts), offline:
//   npm run test:level1 -w @norn/workers
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlmMappingError } from '../../../connectors/plm/src/index.ts';
import type { IngestItem } from '../ingest.ts';
import { RetryQueue, ecrLock, retryDue, takeIn } from './ingest-plm.ts';

const item = (name: string) => ({ plmEcrNumber: name }) as unknown as IngestItem;

test('one malformed ECR in the first listing is logged by name and the rest are still taken in', async () => {
  const reported: string[] = [];
  const logs: string[] = [];
  const read = async (name: string) => {
    if (name === 'ECR-0002') throw new PlmMappingError('ECR-0002: the BOM line has no quantity');
    return item(name);
  };
  const r = await takeIn(['ECR-0001', 'ECR-0002', 'ECR-0003'], read, async i => void reported.push((i as any).plmEcrNumber), m => logs.push(m));
  assert.deepEqual(reported, ['ECR-0001', 'ECR-0003']);
  assert.deepEqual(r, { taken: ['ECR-0001', 'ECR-0003'], skipped: ['ECR-0002'], retrying: [] });
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /ECR-0002/);
  assert.match(logs[0]!, /no quantity/);
});

test('a transient failure at start-up is taken in on a later tick, with a growing wait', async () => {
  const logs: string[] = [];
  const reported: string[] = [];
  let clock = 0;
  const now = () => clock;
  let failures = 2; // ECR-0001 fails twice (PLM 503), then reads fine
  const read = async (name: string) => {
    if (name === 'ECR-0001' && failures-- > 0) throw new Error('PLM answered 503');
    return item(name);
  };
  const report = async (i: IngestItem) => void reported.push((i as any).plmEcrNumber);
  const retry = new RetryQueue(1000, 60_000);

  const first = await takeIn(['ECR-0001', 'ECR-0002'], read, report, m => logs.push(m), retry, now);
  assert.deepEqual(first, { taken: ['ECR-0002'], skipped: [], retrying: ['ECR-0001'] });
  assert.deepEqual(retry.names, ['ECR-0001']);
  assert.match(logs[0]!, /ECR-0001.*503/);

  clock = 500; // too early
  assert.deepEqual((await retryDue(retry, read, report, m => logs.push(m), now)).retrying, []);
  assert.deepEqual(reported, ['ECR-0002']);

  clock = 1000; // due: fails again, the wait doubles
  assert.deepEqual((await retryDue(retry, read, report, m => logs.push(m), now)).retrying, ['ECR-0001']);
  clock = 2500; // 1000 + 2000 = 3000 not reached
  assert.deepEqual(retry.due(now()), []);
  clock = 3000;
  assert.deepEqual(retry.due(now()), ['ECR-0001']);
  assert.deepEqual((await retryDue(retry, read, report, m => logs.push(m), now)).taken, ['ECR-0001']);
  assert.deepEqual(reported, ['ECR-0002', 'ECR-0001']);
  assert.deepEqual(retry.names, [], 'once taken in, it is not retried again');
});

test('a failed report is retried too, and a malformed ECR never is', async () => {
  const logs: string[] = [];
  let reportFails = true;
  const retry = new RetryQueue();
  const read = async (n: string) => {
    if (n === 'ECR-0009') throw new PlmMappingError('ECR-0009: bad');
    return item(n);
  };
  const report = async (i: IngestItem) => {
    if ((i as any).plmEcrNumber === 'ECR-0001' && reportFails) throw new Error('could not report ECR-0001');
  };
  const r = await takeIn(['ECR-0001', 'ECR-0009', 'ECR-0002'], read, report, m => logs.push(m), retry, () => 0);
  assert.deepEqual(r, { taken: ['ECR-0002'], skipped: ['ECR-0009'], retrying: ['ECR-0001'] });
  assert.deepEqual(retry.names, ['ECR-0001'], 'the malformed ECR waits for the watcher to deliver it after a fix');
  reportFails = false;
  assert.deepEqual((await retryDue(retry, read, report, m => logs.push(m), () => 5000)).taken, ['ECR-0001']);
});

test('a retry and the watcher never report one ECR out of order', async () => {
  // Sol's round-4 case: the retry's read is slow and sees old content; the watcher sees newer content meanwhile.
  const lock = ecrLock();
  const retry = new RetryQueue(10);
  retry.fail('ECR-0001', 0);
  let plm = 'old';
  let release!: () => void;
  const held = new Promise<void>(r => (release = r));
  const reported: string[] = [];
  const report = async (i: IngestItem) => void reported.push((i as any).content);
  const slowRead = async () => { const seen = plm; await held; return { plmEcrNumber: 'ECR-0001', content: seen } as unknown as IngestItem; };
  const retrying = retryDue(retry, slowRead, report, () => {}, () => 1_000, lock);
  await new Promise(r => setTimeout(r, 5));
  plm = 'new';
  const watcher = lock('ECR-0001', async () => { await report({ plmEcrNumber: 'ECR-0001', content: plm } as unknown as IngestItem); retry.done('ECR-0001'); });
  release();
  await Promise.all([retrying, watcher]);
  assert.deepEqual(reported, ['old', 'new'], 'the watcher waits for the retry, so the newest is reported last');

  // And when the watcher gets there first, the retry finds nothing left to do.
  const r2 = new RetryQueue(10);
  r2.fail('ECR-0002', 0);
  const seen: string[] = [];
  await lock('ECR-0002', async () => { seen.push('watcher'); r2.done('ECR-0002'); });
  const out = await retryDue(r2, async () => { seen.push('retry read'); return item('ECR-0002'); }, async () => {}, () => {}, () => 1_000, lock);
  assert.deepEqual(seen, ['watcher']);
  assert.deepEqual(out.taken, []);
});
