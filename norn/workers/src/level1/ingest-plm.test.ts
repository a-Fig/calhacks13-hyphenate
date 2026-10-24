// The first listing's per-ECR error handling (ingest-plm.ts), offline:
//   npm run test:level1 -w @norn/workers
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlmMappingError } from '../../../connectors/plm/src/index.ts';
import type { IngestItem } from '../ingest.ts';
import { takeIn } from './ingest-plm.ts';

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
  assert.deepEqual(r, { taken: ['ECR-0001', 'ECR-0003'], skipped: ['ECR-0002'] });
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /ECR-0002/);
  assert.match(logs[0]!, /no quantity/);
});

test('a report that fails is only that ECR to skip', async () => {
  const logs: string[] = [];
  const r = await takeIn(
    ['ECR-0001', 'ECR-0002'],
    async n => item(n),
    async i => {
      if ((i as any).plmEcrNumber === 'ECR-0001') throw new Error('could not report ECR-0001');
    },
    m => logs.push(m)
  );
  assert.deepEqual(r, { taken: ['ECR-0002'], skipped: ['ECR-0001'] });
  assert.match(logs[0]!, /ECR-0001/);
});
