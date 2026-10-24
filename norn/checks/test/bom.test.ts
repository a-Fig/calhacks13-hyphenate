import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { bomDelta } from '../src/bom.ts';
import type { ChangeRequest } from '../src/types.ts';

const ecr = (id: string): ChangeRequest => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return structuredClone(e);
};

test('every ECR in the dataset applies cleanly to the baseline', () => {
  for (const e of bowman.ecrs) {
    const r = bomDelta(bowman, e);
    assert.equal(r.ok, true, `${e.id}: ${r.conflicts.map((c) => c.message).join('; ')}`);
  }
});

test('ECR-0417: the bracket moves to Rev C at $221.00, twelve per Vesper and eight per Meridian', () => {
  const r = bomDelta(bowman, ecr('ECR-0417'));
  assert.equal(r.bom.length, 0, 'no BOM line changes');
  assert.deepEqual(r.affected.programs, ['vesper', 'meridian']);
  assert.deepEqual(r.affected.suppliers, ['SUP-HALDEN']);
  const head = r.head.items.find((i) => i.code === 'BW-5120-210')!;
  assert.equal(head.rev, 'C');
  assert.equal(head.unitPrice, 221);
  assert.equal(head.spec.plate_thickness_in, 1.25);
  const price = r.items[0].fields.find((f) => f.field === 'unit_price_usd')!;
  assert.equal(price.status, 'ok', 'the ECR saw the baseline price of 186.40');
  assert.equal(r.items[0].fields.find((f) => f.field === 'web_thickness_mm')!.status, 'unverified', 'the baseline holds no spec fields');
  const row = (p: string) => r.programs.find((x) => x.program === p)!.rows.find((x) => x.item === 'BW-5120-210')!;
  assert.deepEqual([row('vesper').qtyBase, row('vesper').qtyHead, row('vesper').priceBase, row('vesper').priceHead], [12, 12, 186.4, 221]);
  assert.deepEqual([row('meridian').qtyBase, row('meridian').qtyHead], [8, 8]);
  assert.ok(r.affected.assemblies.includes('BW-5120-000') && r.affected.assemblies.includes('BW-0001-000'), 'where-used up to the aircraft');
});

test('ECR-0409: four lines removed and three added; the new blade is 24 per aircraft', () => {
  const r = bomDelta(bowman, ecr('ECR-0409'));
  assert.equal(r.bom.filter((d) => d.op === 'removed').length, 4);
  assert.equal(r.bom.filter((d) => d.op === 'added').length, 3);
  const rows = r.programs.find((p) => p.program === 'vesper')!.rows;
  assert.equal(rows.find((x) => x.item === 'BW-4220-200')!.qtyHead, 24);
  assert.equal(rows.find((x) => x.item === 'BW-4220-100')!.qtyHead, 0);
  assert.ok(r.head.bom.some((l) => l.parent === 'BW-4200-000' && l.child === 'BW-4210-200' && l.qty === 1));
  assert.ok(!r.head.bom.some((l) => l.child === 'BW-4230-100'), 'the dampers are gone');
});

test('ECR-0410: a quantity change on one assembly moves only that program', () => {
  const r = bomDelta(bowman, ecr('ECR-0410'));
  assert.deepEqual(r.bom, [{ op: 'qty_changed', parent: 'BW-9100-000', child: 'BW-9130-100', qtyBase: 2, qtyHead: 1, change: 'ECR-0410 bomChanges[0]' }]);
  assert.deepEqual(r.affected.programs, ['vesper']);
});

test('a change written against values the baseline no longer has is a conflict, not a silent overwrite', () => {
  const e = ecr('ECR-0417');
  e.itemChanges[0].fromRev = 'A';
  e.itemChanges[0].changes.find((c) => c.field === 'unit_price_usd')!.from = 175.2;
  const r = bomDelta(bowman, e);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts.map((c) => c.kind).sort(), ['stale_rev', 'stale_value']);
  assert.match(r.conflicts.find((c) => c.kind === 'stale_value')!.message, /expects 175\.2, the baseline has 186\.4/);

  const q = ecr('ECR-0410');
  q.bomChanges[0].qtyFrom = 3;
  assert.deepEqual(bomDelta(bowman, q).conflicts.map((c) => c.kind), ['stale_value']);
  q.bomChanges[0] = { op: 'remove', parent: 'BW-9100-000', child: 'BW-0000-000' };
  assert.deepEqual(bomDelta(bowman, q).conflicts.map((c) => c.kind), ['missing_line']);
});

test('the overlay is pure: the baseline and the ECR are not modified', () => {
  const before = JSON.stringify({ items: bowman.items, bom: bowman.bom, sourcing: bowman.sourcing });
  const e = ecr('ECR-0409');
  const ecrBefore = JSON.stringify(e);
  bomDelta(bowman, e);
  assert.equal(JSON.stringify({ items: bowman.items, bom: bowman.bom, sourcing: bowman.sourcing }), before);
  assert.equal(JSON.stringify(e), ecrBefore);
});
