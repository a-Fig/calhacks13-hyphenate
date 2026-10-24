// Offline tests for the ECO write-back: planEcoRelease and applyEcoRelease against a small in-memory ERPNext (no network).
// The fixture is a three-level product: top T-1 (aircraft group) > A (make: 3 of P, 1 of Q, one operation) > P and Q (buy).
// The release reprices P from 10 to 12, which versions A's BOM, replaces it in T-1's, and retires the old one.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { EcoApplyError, EcoPlanError, applyEcoRelease, formatPlan, planEcoRelease } from '../src/index.ts';
import type { EcoRelease, ErpnextConnection, ErpnextSettings } from '../src/index.ts';

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
  write: { accounts: { scrapExpense: '51900 - Shrink - CO', reserve: '11420 - Reserve - CO', accrued: '21210 - Accrued - CO', stock: '11410 - Inventory - CO' } },
};
const release: EcoRelease = {
  eco: 'ECO-9', ecr: 'ECR-9', decision: { id: 'DEC-9', url: 'https://norn.test/decisions/DEC-9' }, effectiveDate: '2026-01-01',
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
  'BOM Update Log': [],
});

// ---- a miniature ERPNext ---------------------------------------------------------------------------------------------

let db: Db;
let calls: { method: string; path: string; body?: any }[];
let failNext: ((method: string, path: string) => boolean) | undefined;

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
const refused = (message: string) => json(417, { exc_type: 'ValidationError', _server_messages: JSON.stringify([JSON.stringify({ message })]) });
const nextName = (prefix: string) => `${prefix}-${String(Object.values(db).flat().length + 1000 + calls.length)}`;

function doc(name: string, row: Row): Row {
  if (name !== 'BOM') return row;
  return { ...row, items: db['BOM Item'].filter((i) => i.parent === row.name), operations: db['BOM Operation'].filter((o) => o.parent === row.name) };
}

const realFetch = globalThis.fetch;
function fakeErp() {
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: decodeURIComponent(url.pathname), body });
    if (failNext?.(method, url.pathname)) { failNext = undefined; return refused('forced failure'); }
    const [, , kind, rawDoctype, rawName] = url.pathname.split('/');
    if (kind === 'method') {
      // enqueue_replace_bom: point every BOM Item at the new BOM, and say it completed.
      const { current_bom, new_bom } = body.boms;
      for (const l of db['BOM Item']) if (l.bom_no === current_bom) l.bom_no = new_bom;
      const name = `LOG-${db['BOM Update Log'].length + 1}`;
      db['BOM Update Log'].push({ name, status: 'Completed' });
      return json(200, { message: { name } });
    }
    const doctype = decodeURIComponent(rawDoctype);
    const table = (db[doctype] ??= []);
    if (method === 'GET' && !rawName) {
      const filters: any[] = JSON.parse(url.searchParams.get('filters') ?? '[]');
      const rows = table.filter((r) => filters.every((f) => test1({ docstatus: doctype === 'Journal Entry' ? 0 : 1, ...r }, f)));
      return json(200, { data: rows.map((r) => ({ docstatus: doctype === 'Journal Entry' ? 0 : 1, ...r })) });
    }
    const name = rawName && decodeURIComponent(rawName);
    if (method === 'GET') {
      const row = table.find((r) => r.name === name);
      return row ? json(200, { data: doc(doctype, row) }) : json(404, {});
    }
    if (method === 'PUT') {
      const row = table.find((r) => r.name === name)!;
      if (doctype === 'BOM' && body.is_active === 0 && db['BOM Item'].some((l) => l.bom_no === name && db.BOM.find((b) => b.name === l.parent)?.is_active)) {
        return refused('Cannot deactivate or cancel BOM as it is linked with other BOMs');
      }
      Object.assign(row, body);
      return json(200, { data: row });
    }
    // POST: create
    const row: Row = { ...body, name: nextName(doctype.replace(/\W/g, '').slice(0, 4).toUpperCase()), docstatus: body.docstatus ?? 0, creation: `2026-06-01 ${String(table.length).padStart(2, '0')}` };
    if (doctype === 'BOM') {
      const { items = [], operations = [], ...head } = row;
      Object.assign(row, head);
      const price = (code: string) => db['Item Price'].filter((p) => p.item_code === code && p.price_list === head.buying_price_list && (!p.valid_upto || p.valid_upto >= '2026-06-01') && p.valid_from <= '2026-06-01').at(-1)?.price_list_rate ?? 0;
      let raw = 0;
      items.forEach((l: Row, i: number) => {
        const rate = l.bom_no ? db.BOM.find((b) => b.name === l.bom_no)!.total_cost : price(l.item_code);
        raw += l.qty * rate;
        db['BOM Item'].push({ ...l, parent: row.name, idx: i + 1, rate, stock_qty: l.qty, docstatus: 1 });
      });
      for (const o of operations) db['BOM Operation'].push({ ...o, parent: row.name });
      Object.assign(row, { raw_material_cost: raw, operating_cost: operations.length ? 40 : 0, total_cost: raw + (operations.length ? 40 : 0) });
      if (row.docstatus === 1 && row.is_default) for (const b of table) if (b.item === row.item) b.is_default = 0;
    }
    if (doctype === 'Journal Entry') {
      row.total_debit = body.accounts.reduce((s: number, a: Row) => s + (a.debit_in_account_currency ?? 0), 0);
      row.total_credit = body.accounts.reduce((s: number, a: Row) => s + (a.credit_in_account_currency ?? 0), 0);
    }
    table.push(row);
    return json(200, { data: row });
  }) as typeof fetch;
}

beforeEach(() => { db = fixture(); calls = []; failNext = undefined; fakeErp(); });
afterEach(() => { globalThis.fetch = realFetch; });

const writes = () => calls.filter((c) => c.method !== 'GET');
const fastApply = { pollMs: 1, waitMs: 1000 };

test('the plan reads ERPNext, writes nothing, and lists every write in the verified order', async () => {
  const plan = await planEcoRelease(conn, settings, release);
  assert.equal(writes().length, 0);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.steps.map((s) => s.id), ['price-close:P', 'price:P', 'bom:A', 'bom-replace:A', 'bom-retire:A', 'journal:scrap', 'journal:cancel']);
  assert.ok(plan.steps.every((s) => s.status === 'todo'));
  const [close, price, bom, replace, retire, scrap, cancel] = plan.steps;
  assert.equal(close.args.upto, '2025-12-31');
  assert.deepEqual(price.amounts, { from: 10, to: 12, change: 2 });
  assert.match(price.summary, /P Rev C standard cost to 12\.00 from 2026-01-01 \(was 10\.00, \+2\.00\)/);
  // A's BOM: 3 P go from 10 to 12, so raw material 35 -> 41 and total 75 -> 81.
  assert.deepEqual(bom.amounts, { rawBefore: 35, totalBefore: 75, rawAfter: 41, totalAfter: 81 });
  assert.deepEqual(replace.args.parents, ['BOM-T']);
  assert.equal(retire.args.oldBom, 'BOM-A');
  assert.deepEqual(scrap.amounts, { debit: 140.5, credit: 140.5, lines: 2 });
  assert.match(scrap.summary, /140\.50 Dr 51900 \/ Cr 11420 \(2 lines\)/, 'accounts by number, the two lines added up');
  assert.equal(cancel.amounts.debit, 18.64);
  // T-1 holds 3 P: its unit cost rises by 3 x 2.
  assert.deepEqual(plan.effects.map((e) => [e.topItem, e.costDelta]), [['T-1', 6]]);
  assert.match(formatPlan(plan), /1\. \[todo {4}\] Item Price {4}Close P's current standard cost 10\.00/);
});

test('apply writes in the verified order, as tagged documents that link back to the decision', async () => {
  const result = await applyEcoRelease(conn, settings, await planEcoRelease(conn, settings, release), fastApply);
  const w = writes().map((c) => `${c.method} ${c.path.replace('/api/resource/', '').replace('/api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.', '')}`);
  assert.deepEqual(w, ['PUT Item Price/ip-p', 'POST Item Price', 'POST BOM', 'POST enqueue_replace_bom', 'PUT BOM/BOM-A', 'POST Journal Entry', 'POST Journal Entry']);
  assert.deepEqual(result.written.map((x) => [x.doctype, x.action]), [
    ['Item Price', 'updated'], ['Item Price', 'created'], ['BOM', 'created'], ['BOM Update Log', 'created'], ['BOM', 'updated'], ['Journal Entry', 'created'], ['Journal Entry', 'created'],
  ]);
  assert.match(result.written[2].link, /^http:\/\/erp\.test\/app\/bom\/BOM-/);

  const newPrice = db['Item Price'].find((p) => p.eco === 'ECO-9')!;
  assert.deepEqual([newPrice.price_list_rate, newPrice.valid_from, newPrice.decision], [12, '2026-01-01', 'https://norn.test/decisions/DEC-9']);
  assert.match(newPrice.note, /ECO-9 \(ECR-9\); Norn decision DEC-9: https:\/\/norn\.test\/decisions\/DEC-9/);
  assert.equal(db['Item Price'].find((p) => p.name === 'ip-p')!.valid_upto, '2025-12-31');

  const newBom = db.BOM.find((b) => b.eco === 'ECO-9')!;
  assert.deepEqual([newBom.item, newBom.is_active, newBom.is_default, newBom.docstatus, newBom.released_on, newBom.decision], ['A', 1, 1, 1, '2026-01-01', 'https://norn.test/decisions/DEC-9']);
  assert.deepEqual(db['BOM Item'].filter((l) => l.parent === newBom.name).map((l) => [l.item_code, l.qty]), [['P', 3], ['Q', 1]]);
  assert.equal(newBom.total_cost, 81, 'costed from the new price');
  assert.equal(db['BOM Item'].find((l) => l.parent === 'BOM-T')!.bom_no, newBom.name, 'replaced in the parent');
  assert.deepEqual(db.BOM.filter((b) => b.item === 'A').map((b) => [b.name === 'BOM-A', b.is_active, b.is_default]), [[true, 0, 0], [false, 1, 1]]);

  const [scrap, cancel] = db['Journal Entry'];
  assert.equal(scrap.docstatus, 0, 'drafts: Norn never submits');
  assert.deepEqual([scrap.eco, scrap.entry, scrap.decision, scrap.total_debit, scrap.posting_date], ['ECO-9', 'scrap', 'https://norn.test/decisions/DEC-9', 140.5, '2026-01-01']);
  assert.match(scrap.user_remark, /ECO-9 \(ECR-9\): Write down old stock\. Drafted by Norn from decision DEC-9: https:\/\/norn\.test/);
  assert.deepEqual(scrap.accounts.map((a: Row) => [a.account, a.debit_in_account_currency, a.credit_in_account_currency]), [
    ['51900 - Shrink - CO', 100.5, undefined], ['11420 - Reserve - CO', undefined, 100.5], ['51900 - Shrink - CO', 40, undefined], ['11420 - Reserve - CO', undefined, 40],
  ]);
  assert.equal(scrap.accounts[0].user_remark, 'Stores 5');
  assert.equal(cancel.total_credit, 18.64);
});

test('applying the same ECO again finds its own writes and writes nothing', async () => {
  await applyEcoRelease(conn, settings, await planEcoRelease(conn, settings, release), fastApply);
  const sizes = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length]));
  calls = [];
  const again = await planEcoRelease(conn, settings, release);
  assert.ok(again.steps.every((s) => s.status === 'done'), again.steps.map((s) => `${s.id} ${s.status}`).join(', '));
  assert.deepEqual(again.problems, []);
  const second = await applyEcoRelease(conn, settings, again, fastApply);
  assert.equal(writes().length, 0);
  assert.ok(second.written.every((x) => x.action === 'existing'));
  assert.deepEqual(Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])), sizes);
});

test('a plan made before the first apply cannot duplicate on a second apply', async () => {
  const stale = await planEcoRelease(conn, settings, release);
  await applyEcoRelease(conn, settings, stale, fastApply);
  const sizes = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length]));
  calls = [];
  const second = await applyEcoRelease(conn, settings, stale, fastApply);
  assert.equal(writes().length, 0);
  assert.ok(second.written.every((x) => x.action === 'existing'));
  assert.deepEqual(Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])), sizes);
});

test('a failure part way keeps what was written, and the retry continues without repeating it', async () => {
  const plan = await planEcoRelease(conn, settings, release);
  failNext = (method, path) => method === 'POST' && path.endsWith('/BOM');
  await assert.rejects(applyEcoRelease(conn, settings, plan, fastApply), (e: unknown) => {
    assert.ok(e instanceof EcoApplyError);
    assert.equal(e.step, 'bom:A');
    assert.deepEqual(e.written.map((w) => w.doctype), ['Item Price', 'Item Price']);
    assert.match(e.message, /forced failure/);
    return true;
  });
  assert.equal(db['Item Price'].filter((p) => p.eco === 'ECO-9').length, 1);
  const retry = await applyEcoRelease(conn, settings, await planEcoRelease(conn, settings, release), fastApply);
  assert.deepEqual(retry.written.map((w) => w.action), ['existing', 'created', 'created', 'updated', 'created', 'created']);
  assert.equal(db['Item Price'].filter((p) => p.eco === 'ECO-9').length, 1);
  assert.equal(db['Journal Entry'].length, 2);
});

test('the old BOM is retired only after it is replaced in its parents', async () => {
  // The fake refuses to deactivate a BOM an active parent still uses, as ERPNext does (417).
  await applyEcoRelease(conn, settings, await planEcoRelease(conn, settings, release), fastApply);
  const order = writes().map((c) => c.path);
  assert.ok(order.findIndex((p) => p.includes('enqueue_replace_bom')) < order.findIndex((p) => p.endsWith('/BOM/BOM-A')));
});

test('BOM line changes go into the new version', async () => {
  const r: EcoRelease = { ...release, journals: [], items: [], bomChanges: [{ parent: 'A', op: 'set_qty', child: 'Q', qty: 2 }, { parent: 'A', op: 'add', child: 'T-1', qty: 1 }] };
  // `add` of an item the BOM does not hold is fine; it takes the item's stock UOM.
  const plan = await planEcoRelease(conn, settings, r);
  assert.deepEqual(plan.problems, []);
  assert.match(plan.steps[0].summary, /set_qty Q x2, add T-1 x1/);
  await applyEcoRelease(conn, settings, plan, fastApply);
  const nb = db.BOM.find((b) => b.eco === 'ECO-9')!;
  assert.deepEqual(db['BOM Item'].filter((l) => l.parent === nb.name).map((l) => [l.item_code, l.qty, l.uom]), [['P', 3, 'Nos'], ['Q', 2, 'Nos'], ['T-1', 1, 'Nos']]);
  assert.equal(db.BOM.find((b) => b.name === 'BOM-A')!.is_active, 0);
});

test('missing, group, disabled and stock accounts stop apply before anything is written', async () => {
  const bad: EcoRelease = { ...release, journals: [{ key: 'x', title: 'x', lines: [{ amount: 1, debit: 'scrapExpense', credit: 'nowhere', memo: '' }, { amount: 1, debit: 'scrapExpense', credit: 'stock', memo: '' }] }] };
  const plan = await planEcoRelease(conn, settings, bad);
  assert.equal(plan.problems.length, 2);
  assert.match(plan.problems[0], /no account for the role 'nowhere'/);
  assert.match(plan.problems[1], /is a stock account/);
  db.Account[0].disabled = 1;
  assert.match((await planEcoRelease(conn, settings, bad)).problems.join('|'), /'51900 - Shrink - CO' \(role scrapExpense\) is disabled/);
  calls = [];
  await assert.rejects(applyEcoRelease(conn, settings, plan, fastApply), EcoPlanError);
  assert.equal(writes().length, 0);
});

test('a journal entry already written for another amount is a conflict, not a duplicate', async () => {
  await applyEcoRelease(conn, settings, await planEcoRelease(conn, settings, release), fastApply);
  const changed: EcoRelease = { ...release, journals: [{ ...release.journals![0], lines: [{ amount: 99, debit: 'scrapExpense', credit: 'reserve', memo: '' }] }, release.journals![1]] };
  const plan = await planEcoRelease(conn, settings, changed);
  assert.equal(plan.steps.find((s) => s.id === 'journal:scrap')!.status, 'conflict');
  assert.match(plan.problems[0], /cannot edit a journal entry/);
  await assert.rejects(applyEcoRelease(conn, settings, plan, fastApply), EcoPlanError);
});

test('warnings: a future effective date; a price that is already the cost', async () => {
  const future = await planEcoRelease(conn, settings, { ...release, effectiveDate: '2999-01-01' });
  assert.match(future.warnings[0], /after today/);
  const same = await planEcoRelease(conn, settings, { ...release, items: [{ item: 'P', standardCost: 10 }], journals: [] });
  assert.match(same.warnings.join('|'), /P already costs 10\.00/);
  assert.equal(same.steps.some((s) => s.kind === 'price'), false);
});

test('a price row that starts after the effective date is a problem', async () => {
  db['Item Price'].push({ name: 'ip-later', item_code: 'P', price_list: 'Cost', price_list_rate: 11, valid_from: '2026-03-01' });
  const plan = await planEcoRelease(conn, settings, { ...release, effectiveDate: '2026-01-01', journals: [] });
  assert.match(plan.problems[0], /already has a Cost row starting 2026-03-01/);
});

test('a malformed release or settings is refused outright', async () => {
  await assert.rejects(planEcoRelease(conn, settings, { ...release, eco: '' }), /eco is empty/);
  await assert.rejects(planEcoRelease(conn, settings, { ...release, effectiveDate: '01/01/2026' }), /effectiveDate/);
  await assert.rejects(planEcoRelease(conn, settings, { ...release, items: [{ item: 'P', standardCost: 0 }] }), /standardCost above zero/);
  await assert.rejects(planEcoRelease(conn, settings, { ...release, journals: [{ key: 'a b', title: 't', lines: [{ amount: 1, debit: 'x', credit: 'y', memo: '' }] }] }), /journal key/);
  await assert.rejects(planEcoRelease(conn, { ...settings, customFields: {} }, release), /customFields\.bom\.changeOrder/);
  assert.equal(calls.length, 0);
});
