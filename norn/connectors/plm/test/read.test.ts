// Offline test: readChangeRequest takes the ECO from the ECR's released_eco and falls back to a lookup by ecr.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readChangeRequest } from '../src/index.ts';
import { ecrDoc, opts } from './fixture.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function plm(ecr: Record<string, any>, ecos: Record<string, any>[]) {
  const seen: { path: string; filters: unknown }[] = [];
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(String(input));
    const path = decodeURIComponent(url.pathname);
    seen.push({ path, filters: url.searchParams.get('filters') });
    return new Response(JSON.stringify(path.startsWith('/api/resource/ECO') ? { data: ecos } : { data: ecr }), { status: 200 });
  }) as typeof fetch;
  return seen;
}

test('a linked ECR names its ECO: one lookup of that ECO by name, for its release date', async () => {
  const seen = plm({ ...ecrDoc(), released_eco: 'ECO-0009' }, [{ name: 'ECO-0009', released_on: '2026-10-30' }]);
  const r = await readChangeRequest(opts, 'ECR-0001');
  assert.deepEqual([r.change.eco, r.record.eco, r.record.ecoReleasedOn], ['ECO-0009', 'ECO-0009', '2026-10-30']);
  assert.equal(seen[1].filters, JSON.stringify([['name', '=', 'ECO-0009']]));
});

test('an approved ECR whose link is not there yet falls back to the ECO whose ecr is this request', async () => {
  const seen = plm(ecrDoc(), [{ name: 'ECO-0011', released_on: '2026-10-31' }]);
  const r = await readChangeRequest(opts, 'ECR-0001');
  assert.equal(r.change.eco, 'ECO-0011');
  assert.equal(seen[1].filters, JSON.stringify([['ecr', '=', 'ECR-0001']]));
});

test('a link to an ECO the lookup cannot find still names it', async () => {
  plm({ ...ecrDoc(), released_eco: 'ECO-0012' }, []);
  assert.equal((await readChangeRequest(opts, 'ECR-0001')).change.eco, 'ECO-0012');
});

test('an open ECR has no ECO', async () => {
  plm(ecrDoc(), []);
  const r = await readChangeRequest(opts, 'ECR-0001');
  assert.equal('eco' in r.change, false);
});
