// Offline tests: readBaseline against a stubbed REST API (no ERPNext needed). The fixture is a three-level
// product: top T-1 (aircraft group) > A (make, 2 h at 100/h, 3 of P) > P (buy, 10 each).
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { canonicalJson, explodeQty, hashOf, readBaseline, validOn } from '../src/index.ts';
import type { ErpnextOptions } from '../src/index.ts';

const data: Record<string, any[]> = {
  Item: [
    { name: 'T-1', item_name: 'Alpha one air vehicle', item_group: 'Aircraft', disabled: 0, is_stock_item: 1, rev: 'A', st: 'released', prog: 'alpha' },
    { name: 'A', item_name: 'Assembly', item_group: 'Assemblies', disabled: 0, is_stock_item: 1, rev: 'B', st: 'released', prog: 'alpha' },
    { name: 'P', item_name: 'Part', item_group: 'Parts', disabled: 0, is_stock_item: 1, rev: 'C', st: 'released', prog: 'alpha' },
    { name: 'X', item_name: 'Proposed part', item_group: 'Parts', disabled: 1, is_stock_item: 1, rev: 'A', st: 'proposed', prog: '' },
  ],
  'Item Default': [{ parent: 'P', company: 'Co', default_supplier: 'Supplier S' }, { parent: 'P', company: 'Other', default_supplier: 'Nope' }],
  BOM: [{ name: 'BOM-T', item: 'T-1', quantity: 1 }, { name: 'BOM-A', item: 'A', quantity: 2 }],
  'BOM Item': [
    { parent: 'BOM-T', item_code: 'A', stock_qty: 1, qty: 1, idx: 1 },
    { parent: 'BOM-A', item_code: 'P', stock_qty: 6, qty: 6, idx: 1 }, // 6 P per 2 A: 3 per A
    { parent: 'BOM-OLD', item_code: 'P', stock_qty: 99, qty: 99, idx: 1 }, // a superseded version: ignored
  ],
  'BOM Operation': [{ parent: 'BOM-A', workstation: 'Bench', time_in_mins: 240, idx: 1 }], // 4 h per 2 A: 2 h per A
  Workstation: [{ name: 'Bench', hour_rate: 100 }],
  'Item Price': [
    { name: 'ip1', item_code: 'P', price_list: 'Cost', price_list_rate: 8, valid_from: '2025-01-01', valid_upto: '2026-01-01' },
    { name: 'ip2', item_code: 'P', price_list: 'Cost', price_list_rate: 10, valid_from: '2026-01-02' },
    { name: 'ip3', item_code: 'A', price_list: 'Cost', price_list_rate: 230, valid_from: '2025-01-01' },
    { name: 'ip6', item_code: 'T-1', price_list: 'Cost', price_list_rate: 700, valid_from: '2025-01-01' },
    { name: 'ip4', item_code: 'P', price_list: 'Quotes', supplier: 'Supplier S', price_list_rate: 10, lead_time_days: 28, valid_from: '2026-01-01', valid_upto: '2027-01-01', p10: 9, p90: 12, w10: 3, w90: 6, q: 1 },
    { name: 'ip5', item_code: 'P', price_list: 'Quotes', supplier: 'Expired', price_list_rate: 7, lead_time_days: 7, valid_from: '2024-01-01', valid_upto: '2025-01-01' },
  ],
  Bin: [
    { item_code: 'P', warehouse: 'Main', actual_qty: 5, ordered_qty: 10 },
    { item_code: 'P', warehouse: 'Vendor', actual_qty: 2, ordered_qty: 0 },
    { item_code: 'P', warehouse: 'Transit', actual_qty: 9, ordered_qty: 0 }, // not mapped: ignored
  ],
  'Serial No': [{ name: 'ALPHA-001', serial_no: 'ALPHA-001', item_code: 'T-1', posting_date: '2026-03-01' }],
  'Master Production Schedule': [{ name: 'MPS-1' }],
  'Master Production Schedule Item': [
    { item_code: 'T-1', delivery_date: '2026-11-30', planned_qty: 1 }, { item_code: 'T-1', delivery_date: '2026-11-15', planned_qty: 1 },
    { item_code: 'A', delivery_date: '2026-11-30', planned_qty: 7 }, // not a program item: ignored
  ],
};

const opts: ErpnextOptions = {
  url: 'http://erp.test', apiKey: 'k', apiSecret: 's', company: 'Co', asOf: '2026-06-01',
  standardCostPriceList: 'Cost', supplierPriceList: 'Quotes', programItemGroup: 'Aircraft',
  warehouses: { Main: 'stores', Vendor: 'supplierFinished' },
  supplierFinishedOnOpenOrders: true,
  programName: (n) => n.replace(/ air vehicle$/, ''),
  customFields: {
    item: { revision: 'rev', status: 'st', programs: 'prog' },
    quote: { priceP10: 'p10', priceP90: 'p90', leadWeeksP10: 'w10', leadWeeksP90: 'w90', qualified: 'q' },
  },
};

const realFetch = globalThis.fetch;
/** Answers every list request with the whole fixture table for its doctype (the connector re-filters what matters). */
function stub(overrides: Record<string, any[]> = {}) {
  globalThis.fetch = (async (input: URL | string) => {
    const doctype = decodeURIComponent(new URL(String(input)).pathname.split('/').pop()!);
    return new Response(JSON.stringify({ data: overrides[doctype] ?? data[doctype] ?? [] }), { status: 200 });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; });

test('maps ERPNext rows to the baseline', async () => {
  stub();
  const { baseline: b, meta, asOf } = await readBaseline(opts);
  assert.equal(asOf, '2026-06-01');
  assert.deepEqual(b.programs, [{ id: 'alpha', name: 'Alpha one', topItem: 'T-1' }]);
  assert.deepEqual(b.bom.map((l) => [l.parent, l.child, l.qty]), [['A', 'P', 3], ['T-1', 'A', 1]]);
  const [a, p, x] = ['A', 'P', 'X'].map((c) => b.items.find((i) => i.code === c)!);
  assert.deepEqual([a.makeBuy, a.laborHours, a.workCenter, a.standardCost, a.rev], ['make', 2, 'Bench', 230, 'B']);
  assert.deepEqual([p.makeBuy, p.standardCost, p.defaultSupplier], ['buy', 10, 'Supplier S']);
  assert.equal(x.status, 'proposed');
  assert.deepEqual(b.sourcing, [{ item: 'P', supplier: 'Supplier S', primary: true, allocation: 1, unitPrice: { p10: 9, p50: 10, p90: 12 }, leadTimeWeeks: { p10: 3, p50: 4, p90: 6 }, qualified: true }]);
  assert.deepEqual(b.workCenters, [{ id: 'Bench', laborRatePerHour: 100 }]);
  // 5 at stores, 2 at the supplier; 10 ordered, of which the 2 already finished at the supplier are not counted again; 1 built aircraft x 3 P.
  assert.deepEqual(b.stock.find((s) => s.item === 'P'), { item: 'P', stores: 5, wip: 0, finishedGoods: 0, supplierFinished: 2, onOrder: 8, inField: 3 });
  assert.equal(b.stock.some((s) => s.item === 'X'), false, 'disabled items hold no stock row');
  assert.deepEqual(b.builtAircraft, [{ program: 'alpha', serial: 1, completed: '2026-03-01' }]);
  assert.deepEqual(b.volumePlan, [{ month: '2026-11', program: 'alpha', units: 2 }], 'rows of one month sum; non-program items ignored');
  assert.deepEqual(meta.sources, { volumePlan: 'erpnext', builtAircraft: 'erpnext' });
  assert.deepEqual(meta.warnings, ['X has no Cost price valid on 2026-06-01']);
});

test('uses the fallback only when ERPNext has no rows', async () => {
  stub({ 'Serial No': [], 'Master Production Schedule': [] });
  const fallback = { volumePlan: [{ month: '2027-01', program: 'alpha', units: 4 }], builtAircraft: [{ program: 'alpha', serial: 7, completed: '2026-01-01' }] };
  const r = await readBaseline({ ...opts, fallback });
  assert.deepEqual(r.baseline.volumePlan, fallback.volumePlan);
  assert.deepEqual(r.baseline.builtAircraft, fallback.builtAircraft);
  assert.deepEqual(r.meta.sources, { volumePlan: 'fallback', builtAircraft: 'fallback' });
  const none = await readBaseline(opts);
  assert.deepEqual(none.meta.sources, { volumePlan: 'none', builtAircraft: 'none' });
  assert.equal(none.meta.warnings.filter((w) => w.startsWith('no ')).length, 2);
});

test('the hash follows content, not row order or read time', async () => {
  stub();
  const one = await readBaseline(opts);
  stub(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, [...v].reverse()])));
  const two = await readBaseline(opts);
  assert.equal(one.hash, two.hash);
  stub({ 'Item Price': data['Item Price'].map((r) => (r.name === 'ip2' ? { ...r, price_list_rate: 11 } : r)) });
  assert.notEqual((await readBaseline(opts)).hash, one.hash);
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(hashOf(one.baseline), one.hash);
});

test('helpers', () => {
  assert.equal(validOn({ valid_from: '2026-01-01' }, '2026-06-01'), true);
  assert.equal(validOn({ valid_from: '2026-01-01', valid_upto: '2026-05-31' }, '2026-06-01'), false);
  assert.equal(validOn({}, '2026-06-01'), true);
  const lines = [{ parent: 'T', child: 'A', qty: 2 }, { parent: 'A', child: 'P', qty: 3 }, { parent: 'T', child: 'P', qty: 1 }];
  assert.deepEqual([...explodeQty(lines, 'T')], [['A', 2], ['P', 7]]);
  assert.throws(() => explodeQty([{ parent: 'A', child: 'B', qty: 1 }, { parent: 'B', child: 'A', qty: 1 }], 'A'), /cycle/);
});
