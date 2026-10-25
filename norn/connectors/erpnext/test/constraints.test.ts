// Offline tests: supplier constraints read from a custom doctype (stubbed REST API), and the check's comparison with a reference dataset.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { diffSupplierConstraints, expectedSupplierConstraints, readBaseline } from '../src/index.ts';
import type { ErpnextOptions, SupplierConstraintSource } from '../src/index.ts';

// Two buy items quoted by 'Supplier S'; everything else is empty.
const base: Record<string, any[]> = {
  Item: [
    { name: 'P', item_name: 'Part', item_group: 'Parts', disabled: 0, is_stock_item: 1 },
    { name: 'A', item_name: 'Other part', item_group: 'Parts', disabled: 0, is_stock_item: 1 },
  ],
  'Item Price': [
    { name: 'c1', item_code: 'P', price_list: 'Cost', price_list_rate: 10, valid_from: '2025-01-01' },
    { name: 'c2', item_code: 'A', price_list: 'Cost', price_list_rate: 20, valid_from: '2025-01-01' },
    { name: 'q1', item_code: 'P', price_list: 'Quotes', supplier: 'Supplier S', price_list_rate: 10, lead_time_days: 28, valid_from: '2026-01-01' },
    { name: 'q2', item_code: 'A', price_list: 'Quotes', supplier: 'Supplier S', price_list_rate: 20, lead_time_days: 28, valid_from: '2026-01-01' },
  ],
};
const opts: ErpnextOptions = {
  url: 'http://erp.test', apiKey: 'k', apiSecret: 's', company: 'Co', asOf: '2026-06-01',
  standardCostPriceList: 'Cost', supplierPriceList: 'Quotes', programItemGroup: 'Aircraft', warehouses: {},
};
const source: SupplierConstraintSource = {
  doctype: 'Supplier Constraint',
  items: { doctype: 'Supplier Constraint Item', itemField: 'item_code' },
  fields: {
    id: 'constraint_id', supplier: 'supplier', kind: 'kind', capacityPerYear: 'cap', windowFrom: 'w_from', windowTo: 'w_to', description: 'descr',
    slotCadenceMonths: 'cadence', bundleWithinWeeks: 'b_weeks', bundleSecondQualificationDiscount: 'b_disc', bundlePriceBreak: 'b_break',
  },
};
// Frappe leaves out null fields and returns 0 for an unset number.
const constraintTables: Record<string, any[]> = {
  'Supplier Constraint': [
    { name: 'C-SLOT', constraint_id: 'C-SLOT', supplier: 'Supplier S', kind: 'qualification_slot', descr: 'One lot a quarter.', w_from: '2027-04-01', w_to: '2027-09-30', cap: 0, cadence: 3, b_weeks: 26, b_disc: 0.4, b_break: 0.06 },
    { name: 'C-CAP', constraint_id: 'C-CAP', supplier: 'Supplier S', kind: 'capacity', cap: 1200, cadence: 0, b_weeks: 0, b_disc: 0, b_break: 0 },
  ],
  'Supplier Constraint Item': [
    { parent: 'C-SLOT', item_code: 'P', idx: 2 }, { parent: 'C-SLOT', item_code: 'A', idx: 1 }, { parent: 'C-CAP', item_code: 'P', idx: 1 },
  ],
};

const realFetch = globalThis.fetch;
let asked: string[] = [];
/** Answers a list request with the table for its doctype, and remembers which doctypes were asked for. */
function stub(tables: Record<string, any[]> = {}) {
  asked = [];
  globalThis.fetch = (async (input: URL | string) => {
    const doctype = decodeURIComponent(new URL(String(input)).pathname.split('/').pop()!);
    asked.push(doctype);
    return new Response(JSON.stringify({ data: tables[doctype] ?? base[doctype] ?? [] }), { status: 200 });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; });

test('without the setting the baseline has no supplierConstraints and the constraint doctypes are not requested', async () => {
  stub(constraintTables);
  const r = await readBaseline(opts);
  assert.equal('supplierConstraints' in r.baseline, false);
  assert.equal('supplierConstraints' in r.meta.counts, false);
  assert.equal(asked.some((d) => d.startsWith('Supplier Constraint')), false);
  stub();
  assert.equal((await readBaseline(opts)).hash, r.hash, 'rows the settings do not name change nothing');
});

test('reads supplier constraints sorted, in the checks library shape, with the supplier named as sourcing names it', async () => {
  stub(constraintTables);
  const withC = { ...opts, supplierConstraints: source };
  const r = await readBaseline(withC);
  assert.deepEqual(r.baseline.supplierConstraints, [
    { id: 'C-CAP', supplier: 'Supplier S', kind: 'capacity', items: ['P'], capacityPerYear: 1200 },
    {
      id: 'C-SLOT', supplier: 'Supplier S', kind: 'qualification_slot', items: ['A', 'P'], description: 'One lot a quarter.',
      window: { from: '2027-04-01', to: '2027-09-30' }, slotCadenceMonths: 3, bundle: { withinWeeks: 26, secondQualificationDiscount: 0.4, priceBreak: 0.06 },
    },
  ]);
  assert.equal(r.meta.counts.supplierConstraints, 2);
  // The supply check matches a constraint to the sourcing rows by this exact string.
  const sourcing = new Set(r.baseline.sourcing.map((s) => s.supplier));
  assert.ok(r.baseline.supplierConstraints!.every((c) => sourcing.has(c.supplier)));
  assert.equal(r.meta.warnings.some((w) => w.startsWith('supplier constraint')), false);
  // The same rows in another order are the same baseline; the constraints are part of the hash.
  stub({ 'Supplier Constraint': [...constraintTables['Supplier Constraint']].reverse(), 'Supplier Constraint Item': [...constraintTables['Supplier Constraint Item']].reverse() });
  assert.equal((await readBaseline(withC)).hash, r.hash);
  stub();
  assert.notEqual((await readBaseline(withC)).hash, (await readBaseline(opts)).hash);
});

test('skips a malformed constraint and warns about a supplier no sourcing row names', async () => {
  stub({
    'Supplier Constraint': [
      { name: 'C-1', constraint_id: 'C-1', supplier: 'Nobody Ltd', kind: 'capacity', cap: 5 },
      { name: 'C-2', constraint_id: 'C-2', supplier: 'Supplier S', kind: 'other' },
      { name: 'C-3', constraint_id: 'C-3', supplier: 'Supplier S', kind: 'capacity' },
    ],
    'Supplier Constraint Item': [{ parent: 'C-1', item_code: 'P', idx: 1 }, { parent: 'C-2', item_code: 'P', idx: 1 }],
  });
  const r = await readBaseline({ ...opts, supplierConstraints: source });
  assert.deepEqual(r.baseline.supplierConstraints?.map((c) => c.id), ['C-1']);
  assert.ok(r.meta.warnings.includes('supplier constraint C-1: no sourcing row names its supplier Nobody Ltd'));
  assert.equal(r.meta.warnings.filter((w) => w.includes('skipped')).length, 2);
});

test('the check maps dataset supplier ids to ERPNext names and compares constraint by constraint', () => {
  const names = new Map([['SUP-ORRIN', 'Orrin Magnetics'], ['SUP-VANTAGE', 'Vantage Cells']]);
  const sup = (id: string) => names.get(id) ?? id;
  const ref = [
    { id: 'CON-B', supplier: 'SUP-VANTAGE', kind: 'capacity' as const, description: 'Cells.', items: ['Z', 'Y'], capacityPerYear: 180000, window: { from: '2027-01-01', to: '2027-12-31' }, prov: { basis: 'invented' } },
    { id: 'CON-A', supplier: 'SUP-ORRIN', kind: 'qualification_slot' as const, description: 'Slots.', items: ['Q'], prov: { basis: 'invented' } },
  ];
  const want = expectedSupplierConstraints(ref, sup);
  assert.deepEqual(want, [
    { id: 'CON-A', supplier: 'Orrin Magnetics', kind: 'qualification_slot', description: 'Slots.', items: ['Q'] },
    { id: 'CON-B', supplier: 'Vantage Cells', kind: 'capacity', description: 'Cells.', items: ['Y', 'Z'], capacityPerYear: 180000, window: { from: '2027-01-01', to: '2027-12-31' } },
  ]);
  assert.deepEqual(diffSupplierConstraints(structuredClone(want), want), []);
  // A dataset id left where the name belongs, a changed number, a missing and an extra constraint are each reported.
  const have = structuredClone(want);
  have[0].supplier = 'SUP-ORRIN';
  have[1].capacityPerYear = 1;
  assert.deepEqual(diffSupplierConstraints(have, want), ['CON-A differs in supplier', 'CON-B differs in capacityPerYear']);
  assert.deepEqual(
    diffSupplierConstraints([have[0], { id: 'CON-X', supplier: 'S', kind: 'capacity', items: ['Q'] }], want),
    ['CON-A differs in supplier', 'CON-B missing', 'CON-X is not in the reference'],
  );
});
