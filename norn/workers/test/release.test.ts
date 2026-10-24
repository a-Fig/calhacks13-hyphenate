// Offline test for the ECO release (src/release.ts): a change the assessment costs but the ERP change package cannot
// carry out is named in the release, never reported as "nothing to enter". Assessed on Bowman's dataset.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck } from '../../checks/src/index.ts';
import type { ChangeRequest } from '../../checks/src/index.ts';
import { releaseOf } from '../src/release.ts';

const baseline = Object.fromEntries(['programs', 'workCenters', 'items', 'bom', 'sourcing', 'stock', 'volumePlan', 'builtAircraft'].map((k) => [k, (bowman as any)[k]])) as any;
const ctx = { eco: 'ECO-L', decision: { id: 'DEC-L', url: 'https://norn.test/ecr/ECR-L' }, releasedOn: '2026-10-24' };

describe('a labor-hours change', () => {
  const made = baseline.items.find((i: any) => i.makeBuy === 'make' && (i.laborHours ?? 0) > 0 && i.workCenter && baseline.bom.some((l: any) => l.child === i.code));
  const cr: ChangeRequest = {
    id: 'ECR-L', program: bowman.programs[0].id, filedOn: '2026-10-01', bomChanges: [], supplierQuotes: [], inventoryProposal: [],
    itemChanges: [{ item: made.code, op: 'revise', changes: [{ field: 'labor_hours', from: made.laborHours, to: made.laborHours + 1 }] }],
    effectivity: { production: { basis: 'date', from: '2026-10-01' }, interchangeable: true },
    costPage: { production: [], retrofit: [], logisticsSupport: [], other: [] },
  } as any;

  it('is costed by the assessment, and the release names it instead of calling itself empty', () => {
    const result = costCheck(baseline, cr, { seed: 'release-test' });
    assert.equal(result.bomDelta.ok, true);
    assert.ok(Math.abs(result.unitCost[0].delta.point) > 0, 'the assessment prices the extra hour');
    const { release, notes } = releaseOf(cr, result, ctx);
    assert.equal(release.items.length, 0);
    assert.equal(release.bomChanges, undefined);
    assert.equal(release.unsupported?.length, 1);
    assert.match(release.unsupported![0], new RegExp(`^${made.code} labor hours ${made.laborHours} -> ${made.laborHours + 1}: `));
    assert.ok(notes.some((n) => /^Not in the package: /.test(n)));
    assert.equal(notes.some((n) => /nothing to enter/.test(n)), false, 'not "nothing to enter"');
  });
});

describe('an assessed price of zero', () => {
  // Two bought items on a BOM, each at its primary supplier's price.
  const buy = baseline.sourcing
    .filter((s: any) => s.primary && baseline.bom.some((l: any) => l.child === s.item))
    .map((s: any) => ({ code: s.item as string, price: s.unitPrice.p50 as number }));
  const [zeroed, repriced] = buy;
  const cr: ChangeRequest = {
    id: 'ECR-Z', program: bowman.programs[0].id, filedOn: '2026-10-01', bomChanges: [], supplierQuotes: [], inventoryProposal: [],
    itemChanges: [
      { item: zeroed.code, op: 'revise', changes: [{ field: 'unit_price_usd', from: zeroed.price, to: 0 }] },
      { item: repriced.code, op: 'revise', changes: [{ field: 'unit_price_usd', from: repriced.price, to: repriced.price + 1 }] },
    ],
    effectivity: { production: { basis: 'date', from: '2026-10-01' }, interchangeable: true },
    costPage: { production: [], retrofit: [], logisticsSupport: [], other: [] },
  } as any;

  it('is left out of the release and named as not in the package, so one item cannot sink the rest', () => {
    const result = costCheck(baseline, cr, { seed: 'release-test' });
    assert.equal(result.bomDelta.ok, true);
    const { release, notes } = releaseOf(cr, result, ctx);
    assert.deepEqual(release.items.map((i) => i.item), [repriced.code], 'the other repricing is still released');
    assert.ok(release.items.every((i) => i.standardCost > 0), 'the connector refuses a cost of zero or less');
    assert.equal(release.unsupported?.length, 1);
    assert.match(release.unsupported![0], new RegExp(`^${zeroed.code} standard cost `));
    assert.ok(notes.some((n) => /^Not in the package: /.test(n)));
  });
});
