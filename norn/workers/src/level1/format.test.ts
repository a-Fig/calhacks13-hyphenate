// The statement-to-PLM-fields formatting (format.ts) and the routing seam (routing.ts), offline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alreadyPublished, money, parseClassProposal, parseRecommendation, parseTag, statementToPlmFields, type Provenance, type StatementDoc } from './format.ts';
import { ROUTE_PENDING, routeFor } from './routing.ts';

const num = (key: string, label: string, p10: number, p50: number, p90: number) => ({ key, label, unit: 'USD', p10, p50, p90, evidence: 'computation', resultKey: key });
const statement = (over: Partial<StatementDoc> = {}): StatementDoc => ({
  id: 12,
  level: 1,
  prRevision: 3,
  createdAtIso: '2026-10-24T20:42:11.000Z',
  changeClass: 'Class I',
  route: ROUTE_PENDING,
  headline: 'ECR-0417 adds $407 to $432 to each Vesper aircraft and $142,083 to $155,795 one time; I recommend approval with conditions.',
  numbers: [
    num('unit_cost_delta:vesper', 'Unit cost change per unit, vesper', 407.2, 415.1, 431.9),
    num('one_time_total', 'One-time cost', 142083, 148521, 155795),
    num('net_total_year_one', 'Net cost, year one', 150665, 157150, 164489),
  ],
  drivers: [{ text: 'BW-5120-210: use up the old stock or scrap it moves the 12-month net cost between $96,233 and $156,821.', evidence: 'computation' }],
  assumptions: [{ key: 'baseline:scrap', source: 'default', note: 'Recovery of scrapped stock.' }],
  claims: [
    { text: 'Recommendation: Approve with conditions. The cost is within the range Vesper absorbs; three cost-page lines are still blank.', evidence: 'judgment' },
    { text: 'Proposed change class: Class I. It changes the bracket revision on a flight-safety part.', evidence: 'judgment' },
    { text: '[needs estimate] "Re-inspection and test after retrofit" was left blank and counts as $0.', evidence: 'assumption' },
    { text: '[default] Scrap recovery is 0% to 5% of value; the numbers lean on the metal value only.', evidence: 'assumption' },
    { text: 'The bracket cracked at 8.2 hours of a 20-hour vibration test (source: PLM, NCR-0119, as of 2026-10-24).', evidence: 'fact' },
  ],
  ...over,
});
const prov = (over: Partial<Provenance> = {}): Provenance => ({
  baseline: 'ERPNext baseline 2c02958e, as of 2026-10-24',
  changeRequest: 'change request rev 1 from the PLM',
  codeVersion: 'checks-0.2.0',
  draws: 10000,
  s2RunId: 7,
  formulas: { one_time_total: 'Σ every row that is not production recurring' },
  mock: false,
  ...over,
});
const ecr = { number: 'ECR-0417', title: 'Motor-controller mounting bracket', revision: 1 };
const opts = { nornBaseUrl: 'http://127.0.0.1:5173/' };

test('the seven fields: level, recommendation, class, route, link and the statement; the date is left to the PLM', () => {
  const { fields, recommendation } = statementToPlmFields(statement(), ecr, prov(), opts);
  assert.equal(fields.impact_report_level, '1');
  assert.equal(fields.impact_recommendation, 'Approve with conditions');
  assert.equal(recommendation, 'Approve with conditions');
  assert.equal(fields.impact_change_class, 'Class I');
  assert.equal(fields.impact_approval_route, ROUTE_PENDING);
  assert.equal(fields.impact_norn_url, 'http://127.0.0.1:5173/ecr/ECR-0417');
  assert.equal('impact_updated_on' in fields, false, 'the PLM stamps impact_updated_on itself');
  assert.equal(typeof fields.impact_statement, 'string');
  const allowed = new Set(['impact_report_level', 'impact_recommendation', 'impact_change_class', 'impact_approval_route', 'impact_norn_url', 'impact_updated_on', 'impact_statement']);
  for (const k of Object.keys(fields)) assert.ok(allowed.has(k), k);
});

test('the HTML leads with the bottom line and holds the table of numbers with ranges, drivers, flagged assumptions, the recommendation and the sources', () => {
  const html = statementToPlmFields(statement(), ecr, prov(), opts).fields.impact_statement as string;
  assert.ok(html.indexOf('Bottom line.') < html.indexOf('Headline numbers'), 'bottom line first');
  assert.ok(html.includes('<table'), 'a table');
  assert.match(html, /Low \(p10\)[\s\S]*Median \(p50\)[\s\S]*High \(p90\)/);
  // The unit-cost row: dollars to the dollar, low, median, high
  assert.match(html, /Unit cost change per unit, vesper[\s\S]*?\$407[\s\S]*?\$415[\s\S]*?\$432/);
  assert.match(html, /\$142,083[\s\S]*?\$148,521[\s\S]*?\$155,795/);
  assert.ok(html.includes('Recommendation: Approve with conditions'));
  assert.ok(html.includes('What moves the numbers') && html.includes('use up the old stock or scrap it'));
  // assumptions carry their source
  assert.match(html, /Re-inspection and test after retrofit[\s\S]*?Needs an estimate/);
  assert.match(html, /Scrap recovery is 0% to 5%[\s\S]*?Default/);
  assert.match(html, /baseline:scrap[\s\S]*?Default/);
  // sources: where each number comes from
  assert.ok(html.includes('ERPNext baseline 2c02958e, as of 2026-10-24'));
  assert.ok(html.includes('change request rev 1 from the PLM'));
  assert.ok(html.includes("Norn's check one_time_total: Σ every row that is not production recurring"));
  assert.ok(html.includes('The ERP was only read.'));
  assert.ok(html.includes('href="http://127.0.0.1:5173/ecr/ECR-0417"'));
  // the claims are shown once: the recommendation and the class proposal are not repeated under "Also noted"
  assert.equal(html.split('Recommendation: Approve with conditions').length - 1, 1);
  assert.ok(html.includes('Also noted') && html.includes('NCR-0119'));
  // evidence classes are visible
  for (const label of ['[Computation]', '[Judgment]', '[Assumption]', '[Fact]']) assert.ok(html.includes(label), label);
});

test('only what the PLM keeps: no scripts, styles blocks or classes, and agent text is escaped', () => {
  const html = statementToPlmFields(statement({ headline: 'Costs <script>alert(1)</script> & "more"', claims: [{ text: '<img src=x onerror=1> note', evidence: 'fact' }] }), ecr, prov(), opts).fields.impact_statement as string;
  assert.ok(!html.includes('<script') && !html.includes('<img') && !html.includes('<style') && !html.includes('class='));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&amp;'));
});

test('the class is written only when the statement has one the PLM accepts, and is shown as a proposal', () => {
  const none = statementToPlmFields(statement({ changeClass: 'Unclassified', claims: [] }), ecr, prov(), opts);
  assert.equal(none.fields.impact_change_class, null);
  assert.equal(none.fields.impact_recommendation, null, 'no recommendation claim, no recommendation field');
  assert.ok((none.fields.impact_statement as string).includes('none proposed'));
  const two = statementToPlmFields(statement({ changeClass: 'Class II' }), ecr, prov(), opts);
  assert.equal(two.fields.impact_change_class, 'Class II');
  const html = two.fields.impact_statement as string;
  assert.ok(html.includes("proposed by Norn's Level 1 agent; the CM analyst decides"));
  assert.ok(!statementToPlmFields(statement({ changeClass: 'Class 1' }), ecr, prov(), opts).fields.impact_change_class, 'a class the PLM would refuse is not sent');
});

test('the route is written as given, and says it is not decided yet', () => {
  const f = statementToPlmFields(statement({ route: '' }), ecr, prov(), opts);
  assert.equal(f.fields.impact_approval_route, ROUTE_PENDING);
  assert.ok((f.fields.impact_statement as string).includes('not yet decided'));
});

test('the routing seam decides nothing yet', () => {
  assert.deepEqual(routeFor(ecr, { numbers: {} }), {});
});

test('the ref changes with the content and not with anything else, and alreadyPublished reads it back', () => {
  const a = statementToPlmFields(statement(), ecr, prov(), opts);
  const b = statementToPlmFields(statement(), ecr, prov(), opts);
  assert.equal(a.ref, b.ref, 'the same statement, the same ref');
  assert.ok(a.ref.startsWith('12.'));
  const c = statementToPlmFields(statement({ headline: 'A different bottom line.' }), ecr, prov(), opts);
  assert.notEqual(a.ref, c.ref);
  const d = statementToPlmFields(statement({ id: 13 }), ecr, prov(), opts);
  assert.notEqual(a.ref, d.ref);
  // what the PLM holds after a write of `a`
  const held = Object.fromEntries(Object.entries(a.fields).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]));
  assert.equal(alreadyPublished(held, a), true);
  assert.equal(alreadyPublished(held, c), false);
  assert.equal(alreadyPublished(null, a), false);
  assert.equal(alreadyPublished({ ...held, impact_recommendation: 'Reject' }, a), false, 'a person changed a plain field: write again');
  assert.equal(alreadyPublished({}, a), false);
});

test('mock numbers are labelled mock in the text', () => {
  const html = statementToPlmFields(statement(), ecr, prov({ mock: true }), opts).fields.impact_statement as string;
  assert.ok(html.includes('MOCK numbers'));
});

test('the agent\'s conventions are read back strictly', () => {
  assert.equal(parseRecommendation([{ text: 'Recommendation: Send back. Blank lines.', evidence: 'judgment' }])?.value, 'Send back');
  assert.equal(parseRecommendation([{ text: 'recommendation - approve with conditions: x', evidence: 'judgment' }])?.value, 'Approve with conditions');
  assert.equal(parseRecommendation([{ text: 'Recommendation: Approve.', evidence: 'judgment' }])?.value, 'Approve');
  assert.equal(parseRecommendation([{ text: 'Recommendation: Escalate to the board', evidence: 'judgment' }]), null, 'not one of the four');
  assert.equal(parseRecommendation([{ text: 'I recommend approval.', evidence: 'judgment' }]), null);
  assert.deepEqual(parseClassProposal([{ text: 'Proposed change class: Class II. Documentation only.', evidence: 'judgment' }]), { cls: 'Class II', reason: 'Documentation only.' });
  assert.deepEqual(parseTag('[Agent estimate] x'), { tag: 'agent estimate', body: 'x' });
  assert.deepEqual(parseTag('[needs_estimate] y'), { tag: 'needs estimate', body: 'y' });
  assert.deepEqual(parseTag('plain'), { tag: null, body: 'plain' });
  assert.equal(money(-1234.4), '($1,234)');
  assert.equal(money(415.2), '$415');
});
