// What the PLM's form says about an ECR reaches the change request Norn stores (#146): who filed it, where it is routed, when
// it is needed and why. The ECR page reads them from the stored change request, as it does for the dataset and the stub feed.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ecrDoc, opts } from '../../../connectors/plm/test/fixture.ts';
import { itemOf } from '../ingest.ts';
import { readItem } from './ingest-plm.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function plm(doc: Record<string, any>) {
  globalThis.fetch = (async (input: any) => {
    const path = decodeURIComponent(new URL(String(input)).pathname);
    if (path === `/api/resource/ECR/${doc.name}`) return new Response(JSON.stringify({ data: doc }));
    if (path === '/api/resource/ECO') return new Response(JSON.stringify({ data: [] }));
    throw new Error(`unexpected fake PLM path ${path}`);
  }) as typeof fetch;
}

test("the stored change request carries the form's originator, routing, need date and prose, beside the checks' structure", async () => {
  plm(ecrDoc());
  const item = await readItem(opts, 'ECR-0001', itemOf);
  const cr = item.changeRequest as Record<string, unknown>;
  assert.equal(cr.originator, 'ann@acme.test', 'the PLM login, as the form names it; the screens find the person');
  assert.deepEqual(cr.routedTo, ['buyer', 'Quality'], "through the settings' review functions; one the settings do not name stays as the PLM spells it");
  assert.equal(cr.neededBy, '2026-11-12');
  assert.equal(cr.originatingNcr, 'NCR-0007');
  assert.equal(cr.priority, 'urgent');
  assert.equal(cr.companyClass, 'I');
  assert.equal(cr.faaClass, 'minor');
  assert.equal(cr.justificationCode, 'D');
  assert.equal(cr.need, 'It cracked.');
  assert.equal(cr.consequencesIfDisapproved, 'No flights.');
  assert.equal(cr.alternativesConsidered, 'Shot-peen.');
  assert.equal(cr.faaRationale, 'Secondary structure.');
  assert.ok(!('failureData' in cr), 'a blank field is left out, not stored as empty');
  // The checks' structure is untouched, and the title and description still travel beside it.
  assert.equal(cr.id, 'ECR-0001');
  assert.equal(cr.filedOn, '2026-10-01');
  assert.ok(Array.isArray(cr.itemChanges) && Array.isArray(cr.bomChanges));
  assert.equal(item.title, 'Bracket rev B to C');
  assert.equal(item.description, 'Thicker plate.');
  assert.ok(!('description' in cr) && !('title' in cr));
});

test('a form with no need date, NCR or routing stores none of them', async () => {
  plm({ ...ecrDoc(), needed_by: null, originating_ncr: null, routed_to: [] });
  const cr = (await readItem(opts, 'ECR-0001', itemOf)).changeRequest as Record<string, unknown>;
  assert.ok(!('neededBy' in cr) && !('originatingNcr' in cr));
  assert.deepEqual(cr.routedTo, []);
});
