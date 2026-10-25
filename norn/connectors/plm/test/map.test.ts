// Offline tests: the PLM document to the checks' ChangeRequest, through the company's settings.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { bowman } from '../../../../bowman/data/index.ts';
import { bomDelta } from '../../../checks/src/bom.ts';
import { PlmMappingError, mapEcr, parseFieldValue, parseNumericValue, readChangeRequest } from '../src/index.ts';
import { ecrDoc, opts, settings } from './fixture.ts';

test('maps the whole document', () => {
  const { change, record, modified } = mapEcr(settings, ecrDoc());
  assert.equal(modified, '2026-10-02 10:30:15.250000');
  assert.deepEqual(change.itemChanges, [
    { item: 'P-100', op: 'revise', fromRev: 'B', toRev: 'C', changes: [
      { field: 'plate_thickness_in', from: 1, to: 1.25 }, { field: 'finish', from: 'anodised', to: 'chromate' }, { field: 'dampers', from: 2, to: 0 } ] },
    { item: 'P-200', op: 'add', toRev: 'A', changes: [{ field: 'supplier', from: null, to: 'Tarn Co' }] },
  ]);
  assert.deepEqual(change.bomChanges, [
    { op: 'add', parent: 'A-1', child: 'P-200', qtyTo: 2 },
    { op: 'remove', parent: 'A-1', child: 'P-300', qtyFrom: 4 },
    { op: 'set_qty', parent: 'A-1', child: 'P-100', qtyFrom: 12, qtyTo: 8 },
  ]);
  assert.deepEqual(change.effectivity, {
    production: { basis: 'serial', from: '11', note: 'S/N 011 on.' },
    retrofit: { basis: 'serial', from: '1', to: '10', note: 'Swap on S/N 001-010.' },
    interchangeable: true,
  });
  assert.deepEqual(change.inventoryProposal, [
    { item: 'P-100', location: 'stores', disposition: 'scrap', note: 'Quarantined.' },
    { item: 'P-100', location: 'supplier_finished', disposition: 'cancel' },
  ]);
  assert.equal(change.id, 'ECR-0001');
  assert.equal(change.program, 'falcon');
  assert.equal(change.filedOn, '2026-10-01');
  assert.equal('eco' in change, false);
  assert.deepEqual(record.warnings, []);
  assert.deepEqual([record.priority, record.companyClass, record.faaClass, record.workflowState, record.originator], ['urgent', 'I', 'minor', 'Submitted', 'ann@acme.test']);
  assert.deepEqual(record.routedTo, ['buyer', 'Quality'], 'a function the settings do not name keeps the PLM label');
  assert.equal(record.originatingNcr, 'NCR-0007');
  assert.equal(record.text.failureData, undefined, 'a blank prose field is absent');
  assert.equal(record.text.description, 'Thicker plate.');
});

test('a quote is one group of rows; a supplier goes through the settings; zero means not given', () => {
  const { change, record } = mapEcr(settings, ecrDoc());
  assert.deepEqual(change.supplierQuotes, [
    {
      id: 'Q-1', supplier: 'Tarn Composites', item: 'P-100', leadTimeWeeks: 14, firmness: 'firm', note: 'Plate in 6 weeks.',
      lines: [{ description: 'Steady state', unitPrice: 221 }, { description: 'First lot', unitPrice: 239.5, qty: 25 }, { description: 'Fixture', oneTime: 6800 }],
    },
    { id: 'Q-2', supplier: 'Other Co', item: 'P-200', firmness: 'budgetary', lines: [{ description: 'Unit', unitPrice: 12.5 }] },
  ]);
  assert.deepEqual(record.quotes, [{ id: 'Q-1', receivedOn: '2026-10-16', validUntil: '2027-01-15' }, { id: 'Q-2', receivedOn: '2026-10-17' }]);
  const asFunction = mapEcr({ ...settings, supplier: (n) => n.toUpperCase() }, ecrDoc());
  assert.deepEqual(asFunction.change.supplierQuotes.map((q) => q.supplier), ['TARN CO', 'OTHER CO']);
  const noMap = mapEcr({ ...settings, supplier: undefined }, ecrDoc());
  assert.deepEqual(noMap.change.supplierQuotes.map((q) => q.supplier), ['Tarn Co', 'Other Co'], 'default: the PLM name as is');
});

test('the cost page keeps the four blocks, with the PLM row name as each row id', () => {
  const { change } = mapEcr(settings, ecrDoc());
  assert.deepEqual(change.costPage.production, [
    { id: 'cp1', label: 'Bracket unit cost', basis: 'supplier_quote', unitCost: 34.6, quantity: 12, note: 'per aircraft' },
    { id: 'cp2', label: 'Tooling', basis: 'supplier_quote', oneTime: 6800 },
    { id: 'cp3', label: 'Write-off', basis: 'not_provided' },
  ]);
  assert.deepEqual(change.costPage.retrofit, [{ id: 'cr1', label: 'Retrofit kits', basis: 'engineer_estimate', unitCost: 221, quantity: 120 }]);
  assert.deepEqual(change.costPage.logisticsSupport, []);
  assert.deepEqual(change.costPage.other, [{ id: 'co1', label: 'Delay', basis: 'not_provided', note: 'Planner to estimate.' }]);
});

test('a row keeps its id when the rows are reordered; an id is a name, not a position', () => {
  const doc = ecrDoc();
  doc.cost_production.reverse();
  const { change } = mapEcr(settings, doc);
  assert.deepEqual(change.costPage.production.map((r) => [r.id, r.label]), [['cp3', 'Write-off'], ['cp2', 'Tooling'], ['cp1', 'Bracket unit cost']]);
});

test('an unmapped spelling stops the read and names the ECR, the field and the value', () => {
  for (const [field, value, what] of [['priority', 'Soonish', 'priority'], ['program', 'Eagle 9', 'program'], ['company_class', 'Class 1', 'company class']] as const) {
    const doc = ecrDoc();
    doc[field] = value;
    assert.throws(() => mapEcr(settings, doc), (e: Error) => e instanceof PlmMappingError && e.message.includes('ECR-0001') && e.message.includes(what) && e.message.includes(value));
  }
  const doc = ecrDoc();
  doc.inventory[0].location = 'Shed';
  assert.throws(() => mapEcr(settings, doc), /inventory location "Shed"/);
  const bom = ecrDoc();
  bom.bom_changes[0].op = 'Swap';
  assert.throws(() => mapEcr(settings, bom), /BOM change "Swap"/);
});

test('quote firmness goes through the settings; one budgetary row makes the quote budgetary; absent means unset', () => {
  const doc = ecrDoc();
  assert.deepEqual(mapEcr(settings, doc).change.supplierQuotes.map((q) => q.firmness), ['firm', 'budgetary']);
  doc.supplier_quotes[2].firmness = 'Provisional';
  assert.equal(mapEcr(settings, doc).change.supplierQuotes[0].firmness, 'budgetary');
  for (const q of doc.supplier_quotes) q.firmness = '';
  assert.equal('firmness' in mapEcr(settings, doc).change.supplierQuotes[0], false, 'a blank firmness stays unset, so the checks read the note');
  const noField = mapEcr({ ...settings, firmness: undefined }, ecrDoc());
  assert.equal('firmness' in noField.change.supplierQuotes[0], false, 'settings without a firmness map leave it unset');
  const odd = ecrDoc();
  odd.supplier_quotes[0].firmness = 'Maybe';
  assert.throws(() => mapEcr(settings, odd), /quote firmness "Maybe"/);
});

test("the ECO comes from the ECR's own released_eco when no ECO is passed in", () => {
  const doc = ecrDoc();
  doc.released_eco = 'ECO-0009';
  const { change, record } = mapEcr(settings, doc);
  assert.deepEqual([change.eco, record.eco], ['ECO-0009', 'ECO-0009']);
  assert.equal(mapEcr(settings, doc, { name: 'ECO-0010', released_on: '2026-10-30' }).change.eco, 'ECO-0010', 'a passed-in ECO wins');
  assert.equal('eco' in mapEcr(settings, { ...doc, released_eco: '' }).change, false, 'a blank link is no ECO');
});

test('no retrofit when its basis is blank; a draft without a cut-in reads as to be decided, with a warning', () => {
  const doc = ecrDoc();
  Object.assign(doc, { retrofit_basis: '', retrofit_from: '', retrofit_to: '', retrofit_note: '', production_basis: '', production_from: '', production_note: '', interchangeable: 0 });
  const { change, record } = mapEcr(settings, doc);
  assert.deepEqual(change.effectivity, { production: { basis: 'tbd', from: '' }, interchangeable: false });
  assert.deepEqual(record.warnings, ['production effectivity is not set']);
});

test('a redline on a part that is not an affected item is not lost silently', () => {
  const doc = ecrDoc();
  doc.field_changes.push({ name: 'fcx', part: 'P-999', field: 'mass', from_value: '1', to_value: '2' });
  const { change, record } = mapEcr(settings, doc);
  assert.equal(change.itemChanges.length, 2);
  assert.deepEqual(record.warnings, ['1 characteristic change(s) on P-999, which is not an affected item']);
});

test('redline values come back from text', () => {
  assert.deepEqual(['1.25', '12', '0', '-3.5', '', null, undefined, 'true', 'false', 'B', '1.0', '007', '1e3', ' 5', 'anodised'].map(parseFieldValue),
    [1.25, 12, 0, -3.5, null, null, null, true, false, 'B', '1.0', '007', '1e3', ' 5', 'anodised']);
});

// ---- numeric characteristics: the checks apply a price or hours change only when it is a number

const redline = (part: string, field: string, from: unknown, to: unknown) => ({ name: `fc-${field}`, parent: 'ECR-0001', parentfield: 'field_changes', doctype: 'x', part, field, from_value: from, to_value: to });
const withRedlines = (...r: ReturnType<typeof redline>[]) => { const doc = ecrDoc(); doc.field_changes = r; return doc; };

test('the unit price and labour hours are numbers however the PLM spells them', () => {
  const doc = withRedlines(
    redline('P-100', 'unit_price_usd', '186.40', '34.60'),
    redline('P-100', 'labor_hours', ' 2.50 ', '3'),
    redline('P-100', 'finish', '1.0', '2.50'), // not one the checks compute with: carried as written
  );
  assert.deepEqual(mapEcr(settings, doc).change.itemChanges[0].changes, [
    { field: 'unit_price_usd', from: 186.4, to: 34.6 },
    { field: 'labor_hours', from: 2.5, to: 3 },
    { field: 'finish', from: '1.0', to: '2.50' },
  ]);
  // blank is "no value", as for any redline; JSON numbers pass
  assert.deepEqual(mapEcr(settings, withRedlines(redline('P-100', 'unit_price_usd', '', 221), redline('P-100', 'labor_hours', null, '0'))).change.itemChanges[0].changes,
    [{ field: 'unit_price_usd', from: null, to: 221 }, { field: 'labor_hours', from: null, to: 0 }]);
});

test('a price the checks cannot read as a number is refused, naming the ECR, item and field', () => {
  for (const bad of ['$34.60', 'TBD', '1,200', '34.60 USD', '1e', '--2', 'NaN', 'Infinity', true, {}]) {
    assert.throws(() => mapEcr(settings, withRedlines(redline('P-100', 'unit_price_usd', '25', bad))),
      (e: any) => e instanceof PlmMappingError && e.message.startsWith('ECR-0001: P-100.unit_price_usd to value') && e.message.includes('is not a number'), String(bad));
  }
  assert.throws(() => mapEcr(settings, withRedlines(redline('P-100', 'labor_hours', 'about 2', '3'))), /ECR-0001: P-100\.labor_hours from value "about 2" is not a number/);
  assert.equal(parseNumericValue('+.5', 'x'), 0.5);
  assert.equal(parseNumericValue('1e3', 'x'), 1000);
});

test('extra numeric characteristics come from the settings; a near-miss spelling is warned about', () => {
  const doc = withRedlines(redline('P-100', 'mass_kg', '1.50', '1.20'), redline('P-100', 'Unit_Price_USD', '25', '34.60'));
  const plain = mapEcr(settings, doc);
  assert.deepEqual(plain.change.itemChanges[0].changes.map((c) => c.to), ['1.20', '34.60'], 'text unless named');
  assert.equal(plain.record.warnings.length, 1);
  assert.match(plain.record.warnings[0], /P-100: "Unit_Price_USD" looks like a numeric characteristic/);
  const named = mapEcr({ ...settings, numericFields: ['mass_kg'] }, doc);
  assert.deepEqual(named.change.itemChanges[0].changes.map((c) => c.to), [1.2, '34.60']);
  assert.throws(() => mapEcr({ ...settings, numericFields: ['mass_kg'] }, withRedlines(redline('P-100', 'mass_kg', '1', 'light'))), PlmMappingError);
});

test('a price change written as "34.60" reaches the assessed head item (it was left at the old price as text)', () => {
  // ECR-0417 on the dataset: the bracket BW-5120-210 goes from 186.40 to 221.00. The PLM stores both as text.
  const doc = ecrDoc();
  Object.assign(doc, { name: 'ECR-0417', program: 'Falcon 1' });
  doc.affected_items = [{ name: 'ai1', part: 'BW-5120-210', change_type: 'Revise', from_revision: 'B', to_revision: 'C' }];
  doc.bom_changes = [];
  doc.inventory = [];
  doc.field_changes = [redline('BW-5120-210', 'unit_price_usd', '186.40', '221.00')];
  const { change } = mapEcr(settings, doc);
  const r = bomDelta(bowman, { ...change, program: 'vesper' });
  const head = r.head.items.find((i) => i.code === 'BW-5120-210')!;
  assert.equal(head.unitPrice, 221);
  assert.equal(r.items[0].fields[0].status, 'ok', 'the "from" is a number too, so it matches the baseline price');
  assert.deepEqual(r.conflicts, []);
});

test('a number column that holds text is refused, not dropped as "not given"', () => {
  const doc = ecrDoc();
  doc.cost_production[0].unit_cost = 'a lot';
  assert.throws(() => mapEcr(settings, doc), /ECR-0001: production cost "Bracket unit cost" unit cost "a lot" is not a number/);
  const quote = ecrDoc();
  quote.supplier_quotes[0].lead_time_weeks = '14 weeks';
  assert.throws(() => mapEcr(settings, quote), /quote Q-1 lead time "14 weeks" is not a number/);
  const bom = ecrDoc();
  bom.bom_changes[0].qty_to = 'two';
  assert.throws(() => mapEcr(settings, bom), /A-1\/P-200 quantity to "two" is not a number/);
});

test('the ECO that released the request is carried on the change and the record', () => {
  const { change, record } = mapEcr(settings, ecrDoc(), { name: 'ECO-0319', released_on: '2026-10-30' });
  assert.equal(change.eco, 'ECO-0319');
  assert.deepEqual([record.eco, record.ecoReleasedOn], ['ECO-0319', '2026-10-30']);
});

test('what Norn has posted is read back under the PLM field names', () => {
  const doc = ecrDoc();
  Object.assign(doc, { impact_report_level: '1', impact_recommendation: 'Approve', impact_statement: '<p>x</p>', impact_approval_route: '' });
  assert.deepEqual(mapEcr(settings, doc).record.impact, { impact_report_level: '1', impact_recommendation: 'Approve', impact_statement: '<p>x</p>' });
});

test('a webhook body maps the same as the REST read: the document survives JSON', () => {
  const doc = ecrDoc();
  assert.deepEqual(mapEcr(settings, JSON.parse(JSON.stringify(doc))), mapEcr(settings, doc));
  // numbers that arrive as text still map
  const text = ecrDoc();
  text.cost_production[0].unit_cost = '34.6';
  text.cost_production[0].quantity = '12';
  assert.deepEqual(mapEcr(settings, text).change.costPage.production[0], mapEcr(settings, ecrDoc()).change.costPage.production[0]);
});

// ---- readChangeRequest against a stubbed REST API

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('readChangeRequest makes two requests, with the token, and attaches the ECO', async () => {
  const seen: { path: string; query: URLSearchParams; auth: string | null }[] = [];
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ path: decodeURIComponent(url.pathname), query: url.searchParams, auth: new Headers(init?.headers).get('Authorization') });
    const body = url.pathname.endsWith('/ECO') ? { data: [{ name: 'ECO-0319', released_on: '2026-10-30' }] } : { data: ecrDoc() };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const r = await readChangeRequest(opts, 'ECR-0001');
  assert.equal(r.change.eco, 'ECO-0319');
  assert.equal(r.change.id, 'ECR-0001');
  assert.deepEqual(seen.map((s) => s.path).sort(), ['/api/resource/ECO', '/api/resource/ECR/ECR-0001']);
  assert.ok(seen.every((s) => s.auth === 'token test-key:test-secret'));
  assert.equal(seen.find((s) => s.path.endsWith('/ECO'))!.query.get('filters'), JSON.stringify([['ecr', '=', 'ECR-0001']]));
});

test('an error from the PLM names the status and the path, and never the token', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ exc_type: 'DoesNotExistError', _server_messages: JSON.stringify([JSON.stringify({ message: 'ECR <b>ECR-9</b> not found' })]) }), { status: 404 })) as typeof fetch;
  await assert.rejects(readChangeRequest(opts, 'ECR-9'), (e: any) => e.name === 'PlmError' && e.status === 404
    && e.message.includes('/api/resource/ECR/ECR-9') && e.message.includes('not found') && !e.message.includes('test-secret') && !e.message.includes('test-key'));
});

test('the priority is in the change request itself, not only the record: the timeline check decides an urgent change faster', () => {
  const urgent = mapEcr(settings, ecrDoc());
  assert.equal(urgent.record.priority, 'urgent');
  assert.equal(urgent.change.priority, 'urgent', 'Rush in the PLM');
  const routine = mapEcr(settings, { ...ecrDoc(), priority: 'Normal' });
  assert.equal(routine.change.priority, 'routine');
  const emergency = mapEcr(settings, { ...ecrDoc(), priority: 'Critical' });
  assert.equal(emergency.change.priority, 'emergency');
});
