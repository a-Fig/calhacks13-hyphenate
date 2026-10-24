// Offline tests for the ERP change package: buildErpChangePackage against a small in-memory ERPNext that answers GET and
// refuses everything else (no network). The fixture is a three-level product: top T-1 (aircraft group) > A (make: 3 of P,
// 1 of Q, one operation) > P and Q (buy). The release reprices P from 10 to 12, which means a new BOM for A, its
// replacement in T-1's BOM, and the retirement of the old one. A person's entries are simulated by editing the fake's data.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { ErpnextClient } from '../src/client.ts';
import * as connector from '../src/index.ts';
import { buildErpChangePackage, formatErpChangePackage } from '../src/index.ts';
import type { EcoRelease, ErpChangePackage, ErpnextConnection, ErpnextSettings } from '../src/index.ts';

type Row = Record<string, any>;
type Db = Record<string, Row[]>;

const conn: ErpnextConnection = { url: 'http://erp.test', apiKey: 'k', apiSecret: 's' };
const settings: ErpnextSettings = {
  company: 'Co', standardCostPriceList: 'Cost', supplierPriceList: 'Quotes', programItemGroup: 'Aircraft', warehouses: {},
  customFields: {
    bom: { changeOrder: 'eco', releasedOn: 'released_on', decision: 'decision' },
    itemPrice: { changeOrder: 'eco', decision: 'decision' },
    journalEntry: { changeOrder: 'eco', entry: 'entry', decision: 'decision' },
  },
  changePackage: { accounts: { scrapExpense: '51900 - Shrink - CO', reserve: '11420 - Reserve - CO', accrued: '21210 - Accrued - CO', stock: '11410 - Inventory - CO' } },
};
const DECISION = 'https://norn.test/decisions/DEC-9';
const release: EcoRelease = {
  eco: 'ECO-9', ecr: 'ECR-9', decision: { id: 'DEC-9', url: DECISION }, effectiveDate: '2026-01-01',
  items: [{ item: 'P', rev: 'C', standardCost: 12 }],
  journals: [
    { key: 'scrap', title: 'Write down old stock', lines: [
      { amount: 100.5, debit: 'scrapExpense', credit: 'reserve', memo: 'Stores 5' }, { amount: 40, debit: 'scrapExpense', credit: 'reserve', memo: 'WIP 2' },
    ] },
    { key: 'cancel', title: 'Cancellation charge', lines: [{ amount: 18.64, debit: 'scrapExpense', credit: 'accrued', memo: '60 pcs' }] },
  ],
};

const fixture = (): Db => ({
  Item: ['T-1', 'A', 'P', 'Q'].map((name) => ({ name, item_name: name, item_group: name === 'T-1' ? 'Aircraft' : 'Parts', disabled: 0, is_stock_item: 1, stock_uom: 'Nos' })),
  'Item Price': [
    { name: 'ip-p', item_code: 'P', price_list: 'Cost', price_list_rate: 10, valid_from: '2025-01-01', uom: 'Nos', currency: 'USD' },
    { name: 'ip-q', item_code: 'Q', price_list: 'Cost', price_list_rate: 5, valid_from: '2025-01-01', uom: 'Nos', currency: 'USD' },
    { name: 'ip-a', item_code: 'A', price_list: 'Cost', price_list_rate: 75, valid_from: '2025-01-01', uom: 'Nos', currency: 'USD' },
    { name: 'ip-t', item_code: 'T-1', price_list: 'Cost', price_list_rate: 75, valid_from: '2025-01-01', uom: 'Nos', currency: 'USD' },
  ],
  BOM: [
    { name: 'BOM-T', item: 'T-1', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 75, operating_cost: 0, total_cost: 75, creation: '2025-01-01', uom: 'Nos', currency: 'USD' },
    { name: 'BOM-A', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 35, operating_cost: 40, total_cost: 75, creation: '2025-01-01', uom: 'Nos', currency: 'USD', with_operations: 1 },
  ],
  'BOM Item': [
    { parent: 'BOM-T', item_code: 'A', qty: 1, stock_qty: 1, rate: 75, bom_no: 'BOM-A', idx: 1, uom: 'Nos', docstatus: 1 },
    { parent: 'BOM-A', item_code: 'P', qty: 3, stock_qty: 3, rate: 10, idx: 1, uom: 'Nos', docstatus: 1 },
    { parent: 'BOM-A', item_code: 'Q', qty: 1, stock_qty: 1, rate: 5, idx: 2, uom: 'Nos', docstatus: 1 },
  ],
  'BOM Operation': [{ parent: 'BOM-A', operation: 'Bench', workstation: 'Bench', time_in_mins: 60, idx: 1 }],
  Workstation: [{ name: 'Bench', hour_rate: 40 }],
  Account: [
    { name: '51900 - Shrink - CO', company: 'Co', is_group: 0, disabled: 0, account_type: 'Stock Adjustment' },
    { name: '11420 - Reserve - CO', company: 'Co', is_group: 0, disabled: 0, account_type: '' },
    { name: '21210 - Accrued - CO', company: 'Co', is_group: 0, disabled: 0, account_type: '' },
    { name: '11410 - Inventory - CO', company: 'Co', is_group: 0, disabled: 0, account_type: 'Stock' },
  ],
  'Journal Entry': [],
});

// ---- a miniature ERPNext that only answers GET ---------------------------------------------------------------------

let db: Db;
let calls: { method: string; path: string; hasBody: boolean }[];

const test1 = (r: Row, [field, op, value]: [string, string, any]) => {
  const v = r[field];
  switch (op) {
    case '=': return v === value;
    case '!=': return v !== value;
    case 'in': return (value as any[]).includes(v);
    case 'not in': return !(value as any[]).includes(v);
    case '<': return v < value;
    case '>': return v > value;
    default: throw new Error(`fake ERPNext: filter ${op}`);
  }
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const realFetch = globalThis.fetch;
function fakeErp() {
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: String(init?.method), path: decodeURIComponent(url.pathname), hasBody: init?.body !== undefined });
    // Norn never writes to the ERP: anything but an explicit GET without a body fails the test that triggered it.
    if (init?.method !== 'GET' || init.body !== undefined) throw new Error(`the connector sent ${init?.method} ${url.pathname}: Norn never writes to the ERP`);
    const [, , , rawDoctype] = url.pathname.split('/');
    const doctype = decodeURIComponent(rawDoctype);
    const defaultStatus = doctype === 'Journal Entry' ? 0 : 1;
    const filters: any[] = JSON.parse(url.searchParams.get('filters') ?? '[]');
    const rows = (db[doctype] ?? []).filter((r) => filters.every((f) => test1({ docstatus: defaultStatus, ...r }, f)));
    return json(200, { data: rows.map((r) => ({ docstatus: defaultStatus, ...r })) });
  }) as typeof fetch;
}

beforeEach(() => { db = fixture(); calls = []; fakeErp(); });
afterEach(() => { globalThis.fetch = realFetch; });

const build = (r: EcoRelease = release, s: ErpnextSettings = settings) => buildErpChangePackage(conn, s, r);
const line = (pkg: ErpChangePackage, id: string) => {
  const l = pkg.lines.find((x) => x.id === id);
  assert.ok(l, `no line ${id} in ${pkg.lines.map((x) => x.id).join(', ')}`);
  return l;
};
const statuses = (pkg: ErpChangePackage) => Object.fromEntries(pkg.lines.map((l) => [l.id, l.status]));
const values = (l: { fields: { field: string; value: unknown }[] }) => Object.fromEntries(l.fields.map((f) => [f.field, f.value]));

// ---- what a person enters, simulated -------------------------------------------------------------------------------

const enterCostChange = () => {
  db['Item Price'].find((p) => p.name === 'ip-p')!.valid_upto = '2025-12-31';
  db['Item Price'].push({ name: 'ip-p2', item_code: 'P', price_list: 'Cost', price_list_rate: 12, valid_from: '2026-01-01', eco: 'ECO-9', decision: DECISION });
};
const enterBom = (docstatus = 1) => {
  // Submitting the new BOM makes it the default and unsets the old one; a draft changes nothing yet.
  if (docstatus === 1) db.BOM.find((b) => b.name === 'BOM-A')!.is_default = 0;
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus, is_active: 1, is_default: docstatus, quantity: 1, raw_material_cost: 41, operating_cost: 40, total_cost: 81, creation: '2026-06-01', eco: 'ECO-9', released_on: '2026-01-01', decision: DECISION });
  db['BOM Item'].push(
    { parent: 'BOM-A2', item_code: 'P', qty: 3, stock_qty: 3, rate: 12, idx: 1, uom: 'Nos', docstatus: 1 },
    { parent: 'BOM-A2', item_code: 'Q', qty: 1, stock_qty: 1, rate: 5, idx: 2, uom: 'Nos', docstatus: 1 },
  );
};
const enterReplace = () => { db['BOM Item'].find((l) => l.parent === 'BOM-T')!.bom_no = 'BOM-A2'; };
const enterRetire = () => { db.BOM.find((b) => b.name === 'BOM-A')!.is_active = 0; };
const enterJournals = (docstatus = 1) => {
  db['Journal Entry'].push(
    { name: 'ACC-JV-1', docstatus, eco: 'ECO-9', entry: 'scrap', total_debit: 140.5, posting_date: '2026-01-01' },
    { name: 'ACC-JV-2', docstatus, eco: 'ECO-9', entry: 'cancel', total_debit: 18.64, posting_date: '2026-01-01' },
  );
  const dr = (parent: string, account: string, amount: number) => ({ parent, account, debit_in_account_currency: amount, credit_in_account_currency: 0 });
  const cr = (parent: string, account: string, amount: number) => ({ parent, account, debit_in_account_currency: 0, credit_in_account_currency: amount });
  db['Journal Entry Account'] = [
    dr('ACC-JV-1', '51900 - Shrink - CO', 100.5), cr('ACC-JV-1', '11420 - Reserve - CO', 100.5), dr('ACC-JV-1', '51900 - Shrink - CO', 40), cr('ACC-JV-1', '11420 - Reserve - CO', 40),
    dr('ACC-JV-2', '51900 - Shrink - CO', 18.64), cr('ACC-JV-2', '21210 - Accrued - CO', 18.64),
  ];
};
const enterAll = () => { enterCostChange(); enterBom(); enterReplace(); enterRetire(); enterJournals(); };

// ---- tests ---------------------------------------------------------------------------------------------------------

test('the package lists every line a person enters, in the verified order, with the exact values', async () => {
  const pkg = await build();
  assert.deepEqual(pkg.problems, []);
  assert.deepEqual(pkg.lines.map((l) => l.id), [
    'standard-cost-close:P', 'standard-cost:P', 'bom:A', 'bom-replace:A', 'bom-retire:A', 'journal-entry:scrap', 'journal-entry:cancel',
  ]);
  assert.ok(pkg.lines.every((l) => l.status === 'to-enter'));
  assert.deepEqual(pkg.counts, { total: 7, entered: 0, toEnter: 7, conflict: 0 });
  assert.deepEqual(pkg.lines.map((l) => l.enteredBy), ['cost accountant', 'cost accountant', 'manufacturing engineer', 'manufacturing engineer', 'manufacturing engineer', 'cost accountant', 'cost accountant']);
  for (const l of pkg.lines) assert.deepEqual(l.trace, { eco: 'ECO-9', ecr: 'ECR-9', decisionId: 'DEC-9', decisionUrl: DECISION });
  assert.equal(pkg.erpUrl, 'http://erp.test');

  const close = line(pkg, 'standard-cost-close:P');
  assert.deepEqual([close.doctype, close.mode, close.document, close.path], ['Item Price', 'edit', { doctype: 'Item Price', name: 'ip-p' }, '/app/item-price/ip-p']);
  assert.deepEqual(values(close), { valid_upto: '2025-12-31' });

  const price = line(pkg, 'standard-cost:P');
  assert.deepEqual([price.doctype, price.mode, price.document, price.path], ['Item Price', 'new', undefined, '/app/item-price/new']);
  assert.deepEqual(values(price), {
    item_code: 'P', price_list: 'Cost', price_list_rate: 12, valid_from: '2026-01-01', uom: 'Nos', currency: 'USD',
    note: 'ECO-9 (ECR-9); Norn decision DEC-9: https://norn.test/decisions/DEC-9. P Rev C standard cost 12.00 from 2026-01-01, was 10.00.',
    eco: 'ECO-9', decision: DECISION,
  });
  assert.deepEqual(price.amounts, { to: 12, from: 10, change: 2 });
  assert.match(price.instruction, /P Rev C on Cost: 12\.00 from 2026-01-01 \(was 10\.00, \+2\.00\)/);

  // A's BOM: 3 P go from 10 to 12, so raw material 35 -> 41 and total 75 -> 81.
  const bom = line(pkg, 'bom:A');
  assert.deepEqual([bom.doctype, bom.mode, bom.document, bom.path], ['BOM', 'duplicate', { doctype: 'BOM', name: 'BOM-A' }, '/app/bom/BOM-A']);
  assert.deepEqual(bom.amounts, { rawBefore: 35, totalBefore: 75, rawAfter: 41, totalAfter: 81 });
  assert.deepEqual(values(bom), {
    item: 'A', quantity: 1, company: 'Co', is_active: 1, is_default: 1, rm_cost_as_per: 'Price List', buying_price_list: 'Cost',
    eco: 'ECO-9', released_on: '2026-01-01', decision: DECISION,
  });
  assert.deepEqual(bom.tables.map((t) => [t.table, t.rows.map((r) => values({ fields: r }))]), [['items', [
    { item_code: 'P', qty: 3, uom: 'Nos' }, { item_code: 'Q', qty: 1, uom: 'Nos' },
  ]]]);
  assert.match(bom.instruction, /open BOM-A, choose Duplicate/);

  const replace = line(pkg, 'bom-replace:A');
  assert.deepEqual([replace.doctype, replace.mode, replace.document], ['BOM Update Tool', 'tool', undefined]);
  assert.deepEqual(replace.fields, [
    { field: 'current_bom', label: 'Current BOM', value: 'BOM-A' }, { field: 'new_bom', label: 'New BOM', value: null, from: 'bom:A' },
  ]);
  assert.match(replace.instruction, /replace BOM-A with the new A BOM in 1 parent BOM \(T-1\)/);

  const retire = line(pkg, 'bom-retire:A');
  assert.deepEqual([retire.document, values(retire)], [{ doctype: 'BOM', name: 'BOM-A' }, { is_active: 0 }]);

  const scrap = line(pkg, 'journal-entry:scrap');
  assert.deepEqual(scrap.amounts, { debit: 140.5, credit: 140.5 });
  assert.match(scrap.instruction, /140\.50 Dr 51900 \/ Cr 11420 \(2 lines\)/, 'accounts by number, the two lines added up');
  assert.deepEqual(values(scrap), {
    voucher_type: 'Journal Entry', company: 'Co', posting_date: '2026-01-01', eco: 'ECO-9', entry: 'scrap', decision: DECISION,
  });
  assert.deepEqual(scrap.tables[0].rows.map((r) => values({ fields: r })), [
    { account: '51900 - Shrink - CO', debit_in_account_currency: 100.5, user_remark: 'Stores 5' },
    { account: '11420 - Reserve - CO', credit_in_account_currency: 100.5, user_remark: 'Stores 5' },
    { account: '51900 - Shrink - CO', debit_in_account_currency: 40, user_remark: 'WIP 2' },
    { account: '11420 - Reserve - CO', credit_in_account_currency: 40, user_remark: 'WIP 2' },
  ]);
  assert.equal(line(pkg, 'journal-entry:cancel').amounts.debit, 18.64);

  // T-1 holds 3 P: its unit cost rises by 3 x 2.
  assert.deepEqual(pkg.effects.map((e) => [e.topItem, e.costDelta]), [['T-1', 6]]);
  assert.deepEqual(JSON.parse(JSON.stringify(pkg)), pkg, 'plain data: nothing is lost in JSON');
});

test('after a person enters every line as packaged, every line reads as entered', async () => {
  enterAll();
  const pkg = await build();
  assert.deepEqual(pkg.problems, []);
  assert.ok(pkg.lines.every((l) => l.status === 'entered'), JSON.stringify(statuses(pkg)));
  assert.deepEqual(pkg.counts, { total: 7, entered: 7, toEnter: 0, conflict: 0 });
  assert.deepEqual(line(pkg, 'standard-cost:P').found, { doctype: 'Item Price', name: 'ip-p2' });
  assert.deepEqual(line(pkg, 'bom:A').found, { doctype: 'BOM', name: 'BOM-A2' });
  assert.deepEqual(line(pkg, 'bom-replace:A').fields[1], { field: 'new_bom', label: 'New BOM', value: 'BOM-A2', from: 'bom:A' }, 'the new BOM is named once it exists');
  assert.deepEqual(line(pkg, 'journal-entry:scrap').found, { doctype: 'Journal Entry', name: 'ACC-JV-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(pkg)), pkg);
});

test('a line is entered one at a time, in the order the package gives', async () => {
  enterCostChange();
  assert.deepEqual(statuses(await build()), {
    'standard-cost-close:P': 'entered', 'standard-cost:P': 'entered', 'bom:A': 'to-enter', 'bom-replace:A': 'to-enter', 'bom-retire:A': 'to-enter',
    'journal-entry:scrap': 'to-enter', 'journal-entry:cancel': 'to-enter',
  });
  enterBom();
  const afterBom = await build();
  assert.equal(line(afterBom, 'bom:A').status, 'entered');
  assert.equal(line(afterBom, 'bom-replace:A').status, 'to-enter', 'the parent BOM still uses the old one');
  assert.equal(line(afterBom, 'bom-replace:A').fields[1].value, 'BOM-A2');
  enterReplace();
  const afterReplace = await build();
  assert.equal(line(afterReplace, 'bom-replace:A').status, 'entered');
  assert.equal(line(afterReplace, 'bom-retire:A').status, 'to-enter');
  enterRetire();
  assert.equal(line(await build(), 'bom-retire:A').status, 'entered');
});

test('what is entered but differs, or is not finished, is a conflict or still to enter', async () => {
  // The new price is in but the old row is still open, at the wrong rate and from the wrong day.
  enterCostChange();
  db['Item Price'].find((p) => p.name === 'ip-p')!.valid_upto = undefined;
  let pkg = await build();
  assert.equal(line(pkg, 'standard-cost-close:P').status, 'to-enter');
  const wrong = db['Item Price'].find((p) => p.eco === 'ECO-9')!;
  wrong.price_list_rate = 11;
  wrong.valid_from = '2026-02-01';
  pkg = await build();
  assert.equal(line(pkg, 'standard-cost:P').status, 'conflict');
  assert.equal(line(pkg, 'standard-cost:P').note, 'ip-p2 has 11.00 where the release says 12.00 and starts 2026-02-01 where the release says 2026-01-01');
  db['Item Price'].find((p) => p.name === 'ip-p')!.valid_upto = '2025-06-30';
  assert.equal(line(await build(), 'standard-cost-close:P').status, 'conflict', 'closed before the day the new cost starts');

  // A BOM that is saved but not submitted has not landed, and the parent BOM still uses the old one.
  enterBom(0);
  pkg = await build();
  assert.equal(line(pkg, 'bom:A').status, 'to-enter');
  assert.match(line(pkg, 'bom:A').note!, /BOM-A2 is saved but not submitted/);
  assert.deepEqual(line(pkg, 'bom:A').found, { doctype: 'BOM', name: 'BOM-A2' });

  // Journal entries: a draft is not posted; a different amount or date is a conflict.
  enterJournals(0);
  pkg = await build();
  assert.deepEqual([line(pkg, 'journal-entry:scrap').status, line(pkg, 'journal-entry:scrap').note], ['to-enter', 'ACC-JV-1 is saved as a draft; submit it to post']);
  db['Journal Entry'][0].total_debit = 99;
  db['Journal Entry'][1].posting_date = '2026-01-05';
  db['Journal Entry'][1].docstatus = 1;
  pkg = await build();
  assert.deepEqual([line(pkg, 'journal-entry:scrap').status, line(pkg, 'journal-entry:scrap').note], ['conflict', 'ACC-JV-1 is for 99.00 where the release says 140.50']);
  assert.deepEqual([line(pkg, 'journal-entry:cancel').status, line(pkg, 'journal-entry:cancel').note], ['conflict', 'ACC-JV-2 is dated 2026-01-05 where the release says 2026-01-01']);
  assert.equal(pkg.counts.conflict, 4, "the old price row, the new price row and both journals");
  assert.deepEqual(pkg.problems, [], 'a conflict sits on its line; problems are for what stops the package being followed');
});

test('a BOM entered with other lines than the package is a conflict, whether saved or submitted', async () => {
  enterCostChange();
  enterBom();
  const lines = () => db['BOM Item'].filter((l) => l.parent === 'BOM-A2');
  assert.equal(line(await build(), 'bom:A').status, 'entered');
  lines().find((l) => l.item_code === 'Q')!.qty = 2;
  let pkg = await build();
  assert.deepEqual([line(pkg, 'bom:A').status, line(pkg, 'bom:A').note], ['conflict', 'BOM-A2 has Q x2 where the release says x1']);
  db['BOM Item'].splice(db['BOM Item'].indexOf(lines().find((l) => l.item_code === 'P')!), 1);
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'Z', qty: 1, idx: 3, docstatus: 1 });
  pkg = await build();
  assert.equal(line(pkg, 'bom:A').note, 'BOM-A2 has no line for P and has Q x2 where the release says x1 and has a line for Z that the release does not');
  // Two lines for one item add up: 1 + 2 of P is not the 3 the package asks for in one line, but it is the same 3.
  db['BOM Item'].splice(db['BOM Item'].indexOf(lines().find((l) => l.item_code === 'Z')!), 1);
  lines().find((l) => l.item_code === 'Q')!.qty = 1;
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 1, idx: 3, docstatus: 1 }, { parent: 'BOM-A2', item_code: 'P', qty: 2, idx: 4, docstatus: 1 });
  assert.equal(line(await build(), 'bom:A').status, 'entered');
  assert.equal(pkg.problems.length, 0);
});

test('the connector only reads: every request is an explicit GET without a body', async () => {
  enterAll();
  await build();
  await build({ ...release, journals: [] });
  assert.ok(calls.length > 10, `${calls.length} requests`);
  assert.deepEqual([...new Set(calls.map((c) => c.method))], ['GET']);
  assert.ok(calls.every((c) => !c.hasBody));
});

test('nothing in the connector can write: the client has two methods, and the exports name no write', async () => {
  assert.deepEqual(Object.getOwnPropertyNames(ErpnextClient.prototype).sort(), ['constructor', 'get', 'list']);
  assert.deepEqual(Object.keys(connector).filter((k) => /apply|write|post|put|submit|save/i.test(k)), []);
  assert.deepEqual(Object.keys(connector.connect({ ...conn, ...settings })).filter((k) => /apply|write|post|put|submit|save/i.test(k)), []);
  // No source file names an HTTP method other than GET.
  const dir = new URL('../src/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /method\s*:\s*['"`](?!GET\b)/, `${f} sets a method other than GET`);
    assert.doesNotMatch(src, /['"`](POST|PUT|PATCH|DELETE)['"`]/, `${f} names a write method`);
  }
});

test('BOM line changes go into the new version', async () => {
  const r: EcoRelease = { ...release, journals: [], items: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'Q', qty: 2 }, { parent: 'A', op: 'add', child: 'T-1', qty: 1 }] };
  // `add` of an item the BOM does not hold is fine; it takes the item's stock UOM.
  const pkg = await build(r);
  assert.deepEqual(pkg.problems, []);
  assert.deepEqual(pkg.lines.map((l) => l.id), ['bom:A', 'bom-replace:A', 'bom-retire:A']);
  const bom = line(pkg, 'bom:A');
  assert.match(bom.instruction, /set_qty Q x2, add T-1 x1/);
  assert.deepEqual(bom.tables[0].rows.map((row) => values({ fields: row })), [
    { item_code: 'P', qty: 3, uom: 'Nos' }, { item_code: 'Q', qty: 2, uom: 'Nos' }, { item_code: 'T-1', qty: 1, uom: 'Nos' },
  ]);
  assert.equal('rawAfter' in bom.amounts, false, 'an added line has no known cost until ERPNext costs it');
  const bad = await build({ ...r, bomChanges: [{ parent: 'A', op: 'remove', child: 'Z' }, { parent: 'A', op: 'add', child: 'P', qty: 1 }, { parent: 'A', op: 'add', child: 'NOPE', qty: 1 }] });
  assert.deepEqual(bad.problems, [
    "item NOPE does not exist in ERPNext", "A's BOM BOM-A has no line for Z to remove", "A's BOM BOM-A already has a line for P",
  ]);
});

test('a parent BOM that is also versioned points its line at the sub-assembly BOM made before it', async () => {
  db.Item.push({ name: 'R', item_name: 'R', item_group: 'Parts', disabled: 0, is_stock_item: 1, stock_uom: 'Nos' });
  db['Item Price'].push({ name: 'ip-r', item_code: 'R', price_list: 'Cost', price_list_rate: 4, valid_from: '2025-01-01' });
  db['BOM Item'].push({ parent: 'BOM-T', item_code: 'R', qty: 2, stock_qty: 2, rate: 4, idx: 2, uom: 'Nos', docstatus: 1 });
  const r: EcoRelease = { ...release, journals: [], items: [{ item: 'P', standardCost: 12 }, { item: 'R', standardCost: 5 }] };
  let pkg = await build(r);
  assert.deepEqual(pkg.lines.map((l) => l.id), [
    'standard-cost-close:P', 'standard-cost:P', 'standard-cost-close:R', 'standard-cost:R', 'bom:A', 'bom-replace:A', 'bom-retire:A', 'bom:T-1', 'bom-retire:T-1',
  ]);
  const top = line(pkg, 'bom:T-1');
  assert.deepEqual(top.tables[0].rows[0], [
    { field: 'item_code', label: 'Item Code', value: 'A' }, { field: 'qty', label: 'Quantity', value: 1 }, { field: 'uom', label: 'UOM', value: 'Nos' },
    { field: 'bom_no', label: 'BOM No', value: null, from: 'bom:A' },
  ]);
  assert.equal(top.amounts.totalAfter, 3 * 12 + 5 + 40 + 2 * 5 + 0, 'A at its new cost (81) plus 2 R at 5: T-1 has no operations');
  assert.equal(top.amounts.totalAfter, 91);
  // No parent BOM uses T-1's BOM, so there is nothing to replace and no replace line.
  assert.equal(pkg.lines.some((l) => l.id === 'bom-replace:T-1'), false);
  // Once A's new BOM exists, the sub-assembly line names it.
  enterBom();
  pkg = await build(r);
  assert.equal(line(pkg, 'bom:T-1').tables[0].rows[0][3].value, 'BOM-A2');
});

test('missing, group, disabled and stock accounts are problems the package reports', async () => {
  const bad: EcoRelease = { ...release, journals: [{ key: 'x', title: 'x', lines: [{ amount: 1, debit: 'scrapExpense', credit: 'nowhere', memo: '' }, { amount: 1, debit: 'scrapExpense', credit: 'stock', memo: '' }] }] };
  const pkg = await build(bad);
  assert.equal(pkg.problems.length, 2);
  assert.match(pkg.problems[0], /no account for the role 'nowhere'/);
  assert.match(pkg.problems[1], /is a stock account/);
  db.Account[0].disabled = 1;
  assert.match((await build(bad)).problems.join('|'), /'51900 - Shrink - CO' \(role scrapExpense\) is disabled/);
  assert.match(formatErpChangePackage(pkg), /## Problems[\s\S]*no account for the role 'nowhere'/);
});

test('warnings: a future effective date; a price that is already the cost; an ECO entry that is not in the release', async () => {
  const future = await build({ ...release, effectiveDate: '2999-01-01' });
  assert.match(future.warnings[0], /after today/);
  const same = await build({ ...release, items: [{ item: 'P', standardCost: 10 }], journals: [] });
  assert.match(same.warnings.join('|'), /P already costs 10\.00/);
  assert.equal(same.lines.some((l) => l.kind === 'standard-cost'), false);
  db['Journal Entry'].push({ name: 'ACC-JV-9', docstatus: 1, eco: 'ECO-9', entry: 'other', total_debit: 5, posting_date: '2026-01-01' });
  assert.match((await build()).warnings.join('|'), /ACC-JV-9 carries ECO-9 but is not in this release \(entry 'other'\)/);
});

test('a price row that starts after the effective date is a problem', async () => {
  db['Item Price'].push({ name: 'ip-later', item_code: 'P', price_list: 'Cost', price_list_rate: 11, valid_from: '2026-03-01' });
  const pkg = await build({ ...release, effectiveDate: '2026-01-01', journals: [] });
  assert.match(pkg.problems[0], /already has a Cost row starting 2026-03-01/);
  assert.equal(pkg.lines.some((l) => l.kind === 'standard-cost'), false);
});

test('a malformed release or settings is refused outright', async () => {
  await assert.rejects(build({ ...release, eco: '' }), /eco is empty/);
  await assert.rejects(build({ ...release, effectiveDate: '01/01/2026' }), /effectiveDate/);
  await assert.rejects(build({ ...release, items: [{ item: 'P', standardCost: 0 }] }), /standardCost above zero/);
  await assert.rejects(build({ ...release, journals: [{ key: 'a b', title: 't', lines: [{ amount: 1, debit: 'x', credit: 'y', memo: '' }] }] }), /journal key/);
  await assert.rejects(build(release, { ...settings, customFields: {} }), /customFields\.bom\.changeOrder/);
  assert.equal(calls.length, 0);
});

test('the markdown reads as a to-do list for a person, in business words', async () => {
  const text = formatErpChangePackage(await build());
  assert.match(text, /^# ERP change package for ECO-9\n/);
  assert.match(text, /ECO-9 came from ECR-9 and Norn decision DEC-9 \(https:\/\/norn\.test\/decisions\/DEC-9\)\. New standard costs apply from 2026-01-01/);
  assert.match(text, /0 of 7 lines entered, 7 to enter, 0 in conflict\./);
  assert.match(text, /## 1\. Close P's current standard cost\n\nTo enter\. Cost accountant\. Open Item Price ip-p: http:\/\/erp\.test\/app\/item-price\/ip-p/);
  assert.match(text, /\| Rate \(price_list_rate\) \| 12\.00 \|/);
  assert.match(text, /\| Released by ECO \(eco\) \| ECO-9 \|/);
  assert.match(text, /## 4\. Replace BOM-A in its parent BOMs[\s\S]*\| New BOM \(new_bom\) \| the new BOM from step 3 \|/);
  assert.match(text, /Accounting Entries \(accounts\):\n\n\| Account \| Debit \| Credit \| Remark \|\n\|---\|---\|---\|---\|\n\| 51900 - Shrink - CO \| 100\.50 \|  \| Stores 5 \|/);
  assert.match(text, /Amounts: raw before 35\.00, total before 75\.00, raw after 41\.00, total after 81\.00\./);
  assert.match(text, /Trace: ECO-9, ECR-9, Norn decision DEC-9 \(https:\/\/norn\.test\/decisions\/DEC-9\)\./);
  assert.match(text, /## Estimated change in unit cost\n\n- T-1 \(T-1\): \+6\.00, from 3 x 2\.00 \(P\)/);
  assert.doesNotMatch(text, new RegExp(String.fromCharCode(0x2014)), 'no em dashes');
  enterAll();
  const done = formatErpChangePackage(await build());
  assert.match(done, /7 of 7 lines entered, 0 to enter, 0 in conflict\./);
  assert.match(done, /Entered\. Manufacturing engineer\. Open BOM BOM-A: /);
  assert.match(done, /Found in ERPNext: Item Price ip-p2\./);
  assert.match(done, /\| New BOM \(new_bom\) \| BOM-A2 \|/);
});

// ---- review fixes: the journal's accounts, the BOM's output, the quantity basis, hidden fields -------------------------

const resetJournals = () => { db['Journal Entry'] = []; db['Journal Entry Account'] = []; enterJournals(); };

test('a journal posted to the wrong accounts is a conflict, though its total and date match', async () => {
  enterJournals();
  assert.equal(line(await build(), 'journal-entry:scrap').status, 'entered');
  // Debit and credit swapped: the same total on the same date, the money going the other way.
  for (const r of db['Journal Entry Account'].filter((x) => x.parent === 'ACC-JV-1')) [r.debit_in_account_currency, r.credit_in_account_currency] = [r.credit_in_account_currency, r.debit_in_account_currency];
  let pkg = await build();
  const swapped = line(pkg, 'journal-entry:scrap');
  assert.equal(swapped.status, 'conflict');
  assert.equal(swapped.note, 'ACC-JV-1 has no debit of 140.50 on 51900 - Shrink - CO and has no credit of 140.50 on 11420 - Reserve - CO'
    + ' and has a credit of 140.50 on 51900 - Shrink - CO that the release does not and has a debit of 140.50 on 11420 - Reserve - CO that the release does not');
  assert.equal(line(pkg, 'journal-entry:cancel').status, 'entered');
  assert.ok(calls.some((c) => c.path.endsWith('/Journal Entry Account')), 'the accounting rows are read');

  // The right side on a wrong account, and a wrong amount on a right one.
  resetJournals();
  db['Journal Entry Account'].find((x) => x.parent === 'ACC-JV-2' && x.credit_in_account_currency)!.account = '11420 - Reserve - CO';
  pkg = await build();
  assert.equal(line(pkg, 'journal-entry:cancel').status, 'conflict');
  assert.equal(line(pkg, 'journal-entry:cancel').note, 'ACC-JV-2 has no credit of 18.64 on 21210 - Accrued - CO and has a credit of 18.64 on 11420 - Reserve - CO that the release does not');
  resetJournals();
  db['Journal Entry Account'].find((x) => x.parent === 'ACC-JV-2' && x.debit_in_account_currency)!.debit_in_account_currency = 17.64;
  assert.equal(line(await build(), 'journal-entry:cancel').note, 'ACC-JV-2 has a debit of 17.64 on 51900 - Shrink - CO where the release says 18.64');

  // Layout and rounding are not differences: two lines on one account entered as one row, and noise under half a cent.
  resetJournals();
  db['Journal Entry Account'].splice(0, 4,
    { parent: 'ACC-JV-1', account: '51900 - Shrink - CO', debit_in_account_currency: 140.5000001, credit_in_account_currency: 0 },
    { parent: 'ACC-JV-1', account: '11420 - Reserve - CO', debit_in_account_currency: 0, credit_in_account_currency: 140.5 });
  assert.equal(line(await build(), 'journal-entry:scrap').status, 'entered');
});

test('a BOM entered with another output quantity, or another sub-assembly BOM, is a conflict', async () => {
  enterCostChange();
  enterBom();
  db.BOM.find((b) => b.name === 'BOM-A2')!.quantity = 2;
  let pkg = await build();
  assert.deepEqual([line(pkg, 'bom:A').status, line(pkg, 'bom:A').note], ['conflict', 'BOM-A2 makes 2 where the release says 1']);
  db.BOM.find((b) => b.name === 'BOM-A2')!.quantity = 1;
  assert.equal(line(await build(), 'bom:A').status, 'entered');

  // T-1's BOM holds A, which this release also versions: that line has to point at A's new BOM, not the old one.
  const r: EcoRelease = { ...release, journals: [], bomChanges: [{ parent: 'T-1', op: 'set_qty', child: 'A', qty: 1 }] };
  db.BOM.push({ name: 'BOM-T2', item: 'T-1', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 81, operating_cost: 0, total_cost: 81, creation: '2026-06-02', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-T2', item_code: 'A', qty: 1, bom_no: 'BOM-A', idx: 1, docstatus: 1 });
  pkg = await build(r);
  assert.deepEqual([line(pkg, 'bom:T-1').status, line(pkg, 'bom:T-1').note], ['conflict', 'BOM-T2 has A on BOM BOM-A where the release says BOM-A2']);
  db['BOM Item'].find((l) => l.parent === 'BOM-T2')!.bom_no = 'BOM-A2';
  assert.equal(line(await build(r), 'bom:T-1').status, 'entered');
});

test('BomLineChange.qty is per one unit of the parent: a BOM that makes 10 is entered and compared at 10 times', async () => {
  Object.assign(db.BOM.find((b) => b.name === 'BOM-A')!, { quantity: 10, raw_material_cost: 350, total_cost: 390 });
  for (const l of db['BOM Item'].filter((x) => x.parent === 'BOM-A')) { l.qty *= 10; l.stock_qty *= 10; }
  const set: EcoRelease = { ...release, journals: [], items: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  const both: EcoRelease = { ...set, bomChanges: [...set.bomChanges!, { parent: 'A', op: 'add', child: 'T-1', qty: 0.5 }] };
  const pkg = await build(both);
  assert.deepEqual(pkg.problems, []);
  const bom = line(pkg, 'bom:A');
  assert.equal(values(bom).quantity, 10);
  assert.deepEqual(bom.tables[0].rows.map((row) => values({ fields: row })), [
    { item_code: 'P', qty: 40, uom: 'Nos' }, { item_code: 'Q', qty: 10, uom: 'Nos' }, { item_code: 'T-1', qty: 5, uom: 'Nos' },
  ]);
  assert.match(bom.instruction, /set_qty P x4 per unit \(x40 for 10\), add T-1 x0\.5 per unit \(x5 for 10\)/);
  // The estimate scales too: 40 P at 10 and 10 Q at 5 make 450 raw, plus the 40 of operations.
  assert.deepEqual(line(await build(set), 'bom:A').amounts, { rawBefore: 350, totalBefore: 390, rawAfter: 450, totalAfter: 490 });
  // Entered at 40 it matches; entered at the per-unit 4 it does not.
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 10, raw_material_cost: 450, operating_cost: 40, total_cost: 490, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 40, idx: 1, docstatus: 1 }, { parent: 'BOM-A2', item_code: 'Q', qty: 10, idx: 2, docstatus: 1 });
  assert.equal(line(await build(set), 'bom:A').status, 'entered');
  db['BOM Item'].find((l) => l.parent === 'BOM-A2' && l.item_code === 'P')!.qty = 4;
  assert.equal(line(await build(set), 'bom:A').note, 'BOM-A2 has P x4 where the release says x40');
});

test('the journal form asks for no hidden field: no Title, and no matching depends on one', async () => {
  const pkg = await build();
  for (const l of pkg.lines.filter((x) => x.kind === 'journal-entry')) {
    assert.deepEqual(l.fields.map((f) => f.field), ['voucher_type', 'company', 'posting_date', 'eco', 'entry', 'decision']);
    assert.match(l.instruction, /Enter the journal entry '(Write down old stock|Cancellation charge)'/, 'the title still reads in the instruction');
  }
  assert.doesNotMatch(formatErpChangePackage(pkg), /\(title\)/);
  // Entered with no title at all, the entries read as entered.
  enterJournals();
  assert.ok((await build()).lines.filter((x) => x.kind === 'journal-entry').every((l) => l.status === 'entered'));
});

// ---- review round 2: superseded ECOs, repeated rows, UOMs, missing child BOMs, duplicate journals ----------------------

test('rechecking an ECO that a later ECO has superseded keeps its own source BOM and never says to undo the later one', async () => {
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  // ECO-9 entered in full: BOM-A2 (4 P, 1 Q) replaces BOM-A and BOM-A is retired.
  db.BOM.find((b) => b.name === 'BOM-A')!.is_default = 0;
  db.BOM.find((b) => b.name === 'BOM-A')!.is_active = 0;
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 45, operating_cost: 40, total_cost: 85, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 4, stock_qty: 4, uom: 'Nos', docstatus: 1 }, { parent: 'BOM-A2', item_code: 'Q', qty: 1, stock_qty: 1, uom: 'Nos', docstatus: 1 });
  db['BOM Item'].find((l) => l.parent === 'BOM-T')!.bom_no = 'BOM-A2';
  let pkg = await build(r);
  assert.deepEqual(statuses(pkg), { 'bom:A': 'entered', 'bom-replace:A': 'entered', 'bom-retire:A': 'entered' });
  assert.equal(line(pkg, 'bom:A').note, undefined);

  // ECO-10 then makes BOM-A3 from BOM-A2 and replaces it in the parent BOM.
  db.BOM.find((b) => b.name === 'BOM-A2')!.is_default = 0;
  db.BOM.find((b) => b.name === 'BOM-A2')!.is_active = 0;
  db.BOM.push({ name: 'BOM-A3', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 50, operating_cost: 40, total_cost: 90, creation: '2026-07-01', eco: 'ECO-10' });
  db['BOM Item'].push({ parent: 'BOM-A3', item_code: 'P', qty: 4, stock_qty: 4, uom: 'Nos', docstatus: 1 }, { parent: 'BOM-A3', item_code: 'Q', qty: 2, stock_qty: 2, uom: 'Nos', docstatus: 1 });
  db['BOM Item'].find((l) => l.parent === 'BOM-T')!.bom_no = 'BOM-A3';
  pkg = await build(r);
  assert.deepEqual(pkg.problems, []);
  assert.deepEqual(statuses(pkg), { 'bom:A': 'entered', 'bom-replace:A': 'entered', 'bom-retire:A': 'entered' });
  assert.deepEqual(line(pkg, 'bom:A').document, { doctype: 'BOM', name: 'BOM-A' }, 'still duplicated from the ECO\'s own source');
  assert.deepEqual(line(pkg, 'bom:A').found, { doctype: 'BOM', name: 'BOM-A2' });
  assert.equal(line(pkg, 'bom:A').note, 'BOM-A2 is superseded by BOM-A3 (ECO-10); nothing to undo');
  assert.deepEqual(values(line(pkg, 'bom-replace:A')), { current_bom: 'BOM-A', new_bom: 'BOM-A2' });
  assert.match(line(pkg, 'bom-replace:A').note!, /superseded/);
  assert.deepEqual(line(pkg, 'bom-retire:A').document, { doctype: 'BOM', name: 'BOM-A' });
  assert.equal(pkg.lines.some((l) => l.document?.name === 'BOM-A3' || values(l).current_bom === 'BOM-A2'), false, 'nothing touches the later ECO\'s BOM');
});

test('set_qty is a total: repeated rows of the component become one row at the target', async () => {
  db['BOM Item'].find((l) => l.parent === 'BOM-A' && l.item_code === 'P')!.qty = 1;
  db['BOM Item'].find((l) => l.parent === 'BOM-A' && l.item_code === 'P')!.stock_qty = 1;
  db['BOM Item'].push({ parent: 'BOM-A', item_code: 'P', qty: 2, stock_qty: 2, uom: 'Nos', rate: 10, docstatus: 1, idx: 3 });
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  const pkg = await build(r);
  const rows = line(pkg, 'bom:A').tables[0].rows.map((row) => values({ fields: row }));
  assert.deepEqual(rows.map((x) => [x.item_code, x.qty]), [['P', 4], ['Q', 1]]);
  assert.deepEqual(line(pkg, 'bom:A').amounts, { rawBefore: 35, totalBefore: 75, rawAfter: 45, totalAfter: 85 });
  // Entered as one row of 4, or as 1 + 3, it is the same total.
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 45, operating_cost: 40, total_cost: 85, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 1, docstatus: 1 }, { parent: 'BOM-A2', item_code: 'P', qty: 3, docstatus: 1 }, { parent: 'BOM-A2', item_code: 'Q', qty: 1, docstatus: 1 });
  assert.equal(line(await build(r), 'bom:A').status, 'entered');
});

test('quantities are stock units whatever UOM a BOM row uses: written, compared and costed alike', async () => {
  // Three Box of 10 units each: 30 units. Bought at 10 a Box, so 1 a unit.
  Object.assign(db['BOM Item'].find((l) => l.parent === 'BOM-A' && l.item_code === 'P')!, { qty: 3, stock_qty: 30, uom: 'Box', conversion_factor: 10 });
  const change: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  let pkg = await build(change);
  assert.deepEqual(line(pkg, 'bom:A').tables[0].rows.map((row) => values({ fields: row })).slice(0, 1), [{ item_code: 'P', qty: 4, uom: 'Nos' }], '4 units, not 4 Box');
  assert.equal(line(pkg, 'bom:A').amounts.rawAfter, 4 * 1 + 5);

  // A row nobody changes keeps its Box; its cost and comparison are per unit.
  const reprice: EcoRelease = { ...release, items: [{ item: 'Q', standardCost: 6 }], journals: [] };
  pkg = await build(reprice);
  assert.deepEqual(line(pkg, 'bom:A').tables[0].rows.map((row) => values({ fields: row })), [{ item_code: 'P', qty: 3, uom: 'Box' }, { item_code: 'Q', qty: 1, uom: 'Nos' }]);
  assert.equal(line(pkg, 'bom:A').amounts.rawAfter, 30 * 1 + 6);
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 36, operating_cost: 40, total_cost: 76, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 30, uom: 'Nos', docstatus: 1 }, { parent: 'BOM-A2', item_code: 'Q', qty: 1, docstatus: 1 });
  assert.equal(line(await build(reprice), 'bom:A').status, 'entered', '30 units is 3 Box');
  const p = db['BOM Item'].find((l) => l.parent === 'BOM-A2' && l.item_code === 'P')!;
  Object.assign(p, { qty: 3, uom: 'Box', conversion_factor: 10 });
  assert.equal(line(await build(reprice), 'bom:A').status, 'entered');
  Object.assign(p, { qty: 3, uom: 'Nos', conversion_factor: 1 });
  assert.equal(line(await build(reprice), 'bom:A').note, 'BOM-A2 has P x3 where the release says x30');
});

test('a parent BOM entered before the new BOM of its sub-assembly exists is not entered', async () => {
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }, { parent: 'T-1', op: 'set_qty', child: 'A', qty: 1 }] };
  db.BOM.find((b) => b.name === 'BOM-T')!.is_default = 0;
  db.BOM.push({ name: 'BOM-T2', item: 'T-1', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 85, operating_cost: 0, total_cost: 85, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-T2', item_code: 'A', qty: 1, stock_qty: 1, uom: 'Nos', docstatus: 1 });
  let pkg = await build(r);
  assert.equal(line(pkg, 'bom:A').status, 'to-enter');
  assert.equal(line(pkg, 'bom:T-1').status, 'conflict');
  assert.equal(line(pkg, 'bom:T-1').note, 'BOM-T2 has A with no BOM but the new A BOM is not entered yet');
  // Once the sub-assembly's BOM exists and the parent line names it, the parent reads entered.
  enterBom();
  db['BOM Item'].find((l) => l.parent === 'BOM-T2')!.bom_no = 'BOM-A2';
  pkg = await build(r);
  assert.equal(line(pkg, 'bom:T-1').status, 'entered');
});

test('two entries with the same ECO and key are a conflict, not an entry', async () => {
  const one: EcoRelease = { ...release, items: [], journals: release.journals!.slice(0, 1) };
  for (const name of ['JV-1', 'JV-2']) {
    db['Journal Entry'].push({ name, docstatus: 1, eco: 'ECO-9', entry: 'scrap', total_debit: 140.5, posting_date: '2026-01-01' });
    (db['Journal Entry Account'] ??= []).push(
      { parent: name, account: '51900 - Shrink - CO', debit_in_account_currency: 140.5 }, { parent: name, account: '11420 - Reserve - CO', credit_in_account_currency: 140.5 });
  }
  const pkg = await build(one);
  assert.equal(line(pkg, 'journal-entry:scrap').status, 'conflict');
  assert.match(line(pkg, 'journal-entry:scrap').note!, /^JV-1 and JV-2 all carry ECO-9 entry 'scrap' where the release has one entry/);
  assert.equal(pkg.counts.conflict, 1);
  // One of them gone, the other reads as entered.
  db['Journal Entry'].pop();
  assert.equal(line(await build(one), 'journal-entry:scrap').status, 'entered');
});

// ---- review round 3: sequential redlines, drafts, added sub-assemblies, inactive replacements, unsupported changes -------

test('redlines on one line apply in order: P changed 3 to 4 to 5 is a BOM with 5 P', async () => {
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }, { parent: 'A', op: 'set_qty', child: 'P', qty: 5 }] };
  const pkg = await build(r);
  assert.deepEqual(line(pkg, 'bom:A').tables[0].rows.map((row) => values({ fields: row }).qty), [5, 1]);
  assert.match(line(pkg, 'bom:A').instruction, /set_qty P x5/);
  // The first redline alone is not what was released.
  db.BOM.push({ name: 'BOM-A2', item: 'A', company: 'Co', docstatus: 1, is_active: 1, is_default: 1, quantity: 1, raw_material_cost: 55, operating_cost: 40, total_cost: 95, creation: '2026-06-01', eco: 'ECO-9' });
  db['BOM Item'].push({ parent: 'BOM-A2', item_code: 'P', qty: 4, docstatus: 1 }, { parent: 'BOM-A2', item_code: 'Q', qty: 1, docstatus: 1 });
  assert.equal(line(await build(r), 'bom:A').note, 'BOM-A2 has P x4 where the release says x5');
  db['BOM Item'].find((l) => l.parent === 'BOM-A2' && l.item_code === 'P')!.qty = 5;
  assert.equal(line(await build(r), 'bom:A').status, 'entered');
  // Add then change is an add at the last quantity; add then remove is nothing; remove then add is a change.
  const mixed = await build({ ...r, bomChanges: [{ parent: 'A', op: 'add', child: 'T-1', qty: 1 }, { parent: 'A', op: 'set_qty', child: 'T-1', qty: 2 }, { parent: 'A', op: 'remove', child: 'Q' }, { parent: 'A', op: 'add', child: 'Q', qty: 3 }] });
  assert.deepEqual(line(mixed, 'bom:A').tables[0].rows.map((row) => values({ fields: row })).map((x) => [x.item_code, x.qty]), [['P', 3], ['Q', 3], ['T-1', 2]]);
  const gone = await build({ ...r, bomChanges: [{ parent: 'A', op: 'add', child: 'T-1', qty: 1 }, { parent: 'A', op: 'remove', child: 'T-1' }] });
  assert.deepEqual(line(gone, 'bom:A').tables[0].rows.map((row) => values({ fields: row }).item_code), ['P', 'Q']);
});

test('an unrelated draft BOM is never the source of a recheck', async () => {
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  db.BOM.push({ name: 'UNRELATED-DRAFT', item: 'A', company: 'Co', docstatus: 0, is_active: 0, is_default: 0, quantity: 1, creation: '2026-05-01' });
  db['BOM Item'].push({ parent: 'UNRELATED-DRAFT', item_code: 'P', qty: 99, docstatus: 0 });
  enterBom();
  db.BOM.find((b) => b.name === 'BOM-A')!.is_active = 0;
  const pkg = await build(r);
  assert.deepEqual(line(pkg, 'bom:A').document, { doctype: 'BOM', name: 'BOM-A' });
  assert.deepEqual(line(pkg, 'bom-retire:A').document, { doctype: 'BOM', name: 'BOM-A' });
  assert.equal(pkg.lines.some((l) => l.document?.name === 'UNRELATED-DRAFT' || values(l).current_bom === 'UNRELATED-DRAFT'), false);
});

test('a sub-assembly added to a parent is entered before the parent', async () => {
  db['BOM Item'] = db['BOM Item'].filter((l) => l.parent !== 'BOM-T');
  db['BOM Item'].push({ parent: 'BOM-T', item_code: 'Q', qty: 1, stock_qty: 1, rate: 5, uom: 'Nos', docstatus: 1, idx: 1 });
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'T-1', op: 'add', child: 'A', qty: 1 }, { parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  const pkg = await build(r);
  assert.deepEqual(pkg.problems, []);
  assert.deepEqual(pkg.lines.map((l) => l.id), ['bom:A', 'bom-retire:A', 'bom:T-1', 'bom-retire:T-1']);
  const added = line(pkg, 'bom:T-1').tables[0].rows.at(-1)!;
  assert.deepEqual(values({ fields: added }), { item_code: 'A', qty: 1, uom: 'Nos', bom_no: null }, 'the new A BOM, made first');
  assert.equal(added.find((f) => f.field === 'bom_no')!.from, 'bom:A');
});

test('a replacement BOM that is inactive or not the default is not entered', async () => {
  const r: EcoRelease = { ...release, items: [], journals: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'P', qty: 4 }] };
  enterBom();
  db['BOM Item'].find((l) => l.parent === 'BOM-T')!.bom_no = 'BOM-A2';
  db.BOM.find((b) => b.name === 'BOM-A')!.is_active = 0;
  db['BOM Item'].filter((l) => l.parent === 'BOM-A2' && l.item_code === 'P').forEach((l) => { l.qty = 4; });
  assert.equal((await build(r)).counts.entered, 3, 'as entered, with nothing wrong, all of it reads entered');
  const a2 = db.BOM.find((b) => b.name === 'BOM-A2')!;
  a2.is_default = 0; a2.is_active = 0;
  let pkg = await build(r);
  assert.deepEqual([line(pkg, 'bom:A').status, line(pkg, 'bom:A').note], ['conflict', 'BOM-A2 is not active where the release says Is Active']);
  assert.notEqual(pkg.counts.entered, pkg.counts.total);
  a2.is_active = 1;
  pkg = await build(r);
  assert.deepEqual([line(pkg, 'bom:A').status, line(pkg, 'bom:A').note], ['conflict', 'BOM-A2 is not the default BOM where the release says Is Default']);
});

test('a change the package cannot carry out is a problem, never "nothing to enter"', async () => {
  const unsupported = ['A labor hours 1 -> 2: ERPNext holds labor as BOM operation time, which this package does not enter.'];
  const pkg = await build({ ...release, items: [], journals: [], unsupported });
  assert.equal(pkg.lines.length, 0);
  assert.deepEqual(pkg.problems, [`not in this package: ${unsupported[0]}`]);
  assert.match(formatErpChangePackage(pkg), /## Problems[\s\S]*not in this package: A labor hours 1 -> 2/);
  await assert.rejects(build({ ...release, items: [], journals: [] }), /the release changes nothing/);
});
