import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findNumbers, guardAnswer, parseAgentAnswer, type ToolResultText } from './guard.ts';

const impact = {
  ecr: 'BWM-ECR-0417',
  results: [
    {
      key: 's2_cost.line:inventory:BW-5120-210',
      label: 'Inventory disposition, BW-5120-210 Rev B: scrap 324, cancel 60',
      unit: 'usd',
      p10: 59624.55,
      p50: 60438.57,
      p90: 61091.57,
      mock: false,
      trace: { inputs: [{ id: 'in:cancel:BW-5120-210', display: '10%', summary: 'The supplier quotes 18.64 per unit for the 60 on order: 10% of 186.4 (quote Q-HAL-26-1187 line 6).' }] },
    },
    { key: 's2_cost.one_time_total', label: 'One-time cost', unit: 'usd', p10: 256940.22, p50: 304745.32, p90: 374317.37, mock: false },
    { key: 'scrap_recovery', value: 0.015 },
  ],
};
const results: ToolResultText[] = [{ tool: 'mcp__norn__get_impact', content: JSON.stringify(impact) }];
const guard = (answer: string, cites: [string, string, string][]) =>
  guardAnswer({ answer, citations: cites.map(([label, refId, value]) => ({ label, refId, value })) }, results);

test('numbers are read at the precision shown', () => {
  const n = findNumbers('It is $304,745, about $305k, or 10% of 18.64 and $1.6M.');
  assert.deepEqual(n.map(x => x.nominal), [304745, 305000, 10, 18.64, 1_600_000]);
  assert.equal(n[2]!.percent, true);
});

test('identifiers and list markers are not quantities', () => {
  const t = '1. See ECR-0417 and BW-5120-210 (Q-HAL-26-1187#1) at P50 for S2.';
  assert.deepEqual(findNumbers(t), []);
});

test('an answer quoted from the cited result passes', () => {
  const g = guard('The cancellation charge is 10% of the price, 18.64 per unit on the 60 on order (quote line 6). It sits in the $60,439 inventory line, which is scrap 324 and cancel 60.', [
    ['Cancellation charge', 'in:cancel:BW-5120-210', '10%'],
    ['Inventory disposition', 's2_cost.line:inventory:BW-5120-210', '$60,439'],
  ]);
  assert.deepEqual(g.unverifiedNumbers, []);
  assert.ok(g.citations.every(c => c.verified));
  assert.ok(g.segments.every(s => !s.unverified));
});

test('rounding to the shown precision passes, other rounding does not', () => {
  const ok = guard('One-time cost is $304,745, or $305k.', [['One-time cost', 'one_time_total', '$304,745']]);
  assert.deepEqual(ok.unverifiedNumbers, []);
  const bad = guard('One-time cost is about $148k, and $304k.', [['One-time cost', 'one_time_total', '$304,745']]);
  assert.deepEqual(bad.unverifiedNumbers, ['148k', '304k']);
  assert.deepEqual(bad.segments.filter(s => s.unverified).map(s => s.text), ['148k', '304k']);
});

test('a percent matches a fraction', () => {
  const g = guard('Scrap recovery is assumed at 1.5%.', [['Scrap recovery', 'scrap_recovery', '1.5%']]);
  assert.deepEqual(g.unverifiedNumbers, []);
  assert.deepEqual(guard('Scrap recovery is assumed at 15%.', [['Scrap recovery', 'scrap_recovery', '15%']]).unverifiedNumbers, ['15%']);
});

test('a number is checked against the cited results only', () => {
  const g = guard('One-time cost is $304,745 and the inventory line is $60,439.', [['One-time cost', 'one_time_total', '$304,745']]);
  assert.deepEqual(g.unverifiedNumbers, ['60,439']);
});

test('a citation whose id is in no tool result is unverified and backs nothing', () => {
  const g = guard('The charge is $60,439.', [['Charge', 'in:made-up', '$60,439']]);
  assert.equal(g.citations[0]!.verified, false);
  assert.deepEqual(g.unverifiedNumbers, ['60,439']);
});

test('a citation with a wrong value is unverified', () => {
  const g = guard('One-time cost is $304,745.', [['One-time cost', 'one_time_total', '$148,000']]);
  assert.equal(g.citations[0]!.verified, false);
});

test('a stage prefix on the id is optional', () => {
  const g = guard('One-time cost is $304,745.', [['One-time cost', 's2_cost.one_time_total', '$304,745']]);
  assert.equal(g.citations[0]!.verified, true);
  assert.deepEqual(g.unverifiedNumbers, []);
});

test('an ECR number cannot be cited to vouch for every number', () => {
  const g = guard('The total is $304,745.', [['ECR', 'BWM-ECR-0417', '']]);
  assert.equal(g.citations[0]!.verified, false);
  assert.deepEqual(g.unverifiedNumbers, ['304,745']);
});

test('an answer with no numbers needs none', () => {
  assert.deepEqual(guard('Norn has no record of that. Ask the cost accountant.', []).unverifiedNumbers, []);
});

test('mock results are reported', () => {
  const mocked: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'k', p50: 5, mock: true }] }) }];
  assert.equal(guardAnswer({ answer: 'It is 5.', citations: [{ label: 'k', refId: 'k', value: '5' }] }, mocked).mock, true);
  assert.equal(guard('It is $304,745.', [['One-time cost', 'one_time_total', '$304,745']]).mock, false);
});

test('a tool result that is not JSON backs nothing', () => {
  const g = guardAnswer({ answer: 'It is 5.', citations: [{ label: 'k', refId: 'k', value: '5' }] }, [{ tool: 'x', content: 'Norn hit an internal error' }]);
  assert.deepEqual(g.unverifiedNumbers, ['5']);
});

test('the agent output is parsed, with or without a fence', () => {
  const body = '{"answer":"Ask the buyer.","citations":[{"label":"a","refId":"b","value":"c"},{"label":"no id"}]}';
  for (const t of [body, '```json\n' + body + '\n```', 'Here: ' + body]) {
    const p = parseAgentAnswer(t);
    assert.equal(p?.answer, 'Ask the buyer.');
    assert.deepEqual(p?.citations, [{ label: 'a', refId: 'b', value: 'c' }]);
  }
  assert.equal(parseAgentAnswer('not json'), null);
  assert.equal(parseAgentAnswer('{"answer":""}'), null);
  assert.equal(parseAgentAnswer(null), null);
});

// ---- Review fixes (PR #149): each case is a probe that used to pass wrongly or fail wrongly.

const signed: ToolResultText[] = [
  {
    tool: 'mcp__norn__get_impact',
    content: JSON.stringify({
      results: [
        { key: 's2_cost.unit_delta:vesper', label: 'Unit cost change, Vesper', unit: 'usd', p50: -9.2 },
        { key: 'scrap_recovery', label: 'Scrap recovery share', value: 0.015 },
        { key: 's2_cost.one_time_total', label: 'One-time total', unit: 'usd', p50: 148521 },
        { key: 's2_cost.line:inventory', label: 'Inventory disposition', unit: 'usd', p50: 60439 },
        { key: 'detail', label: 'detail', value: Array.from({ length: 400 }, (_, i) => ({ id: `in:x:${i}`, v: i + 0.5 })) },
      ],
    }),
  },
];
const g2 = (answer: string, cites: [string, string, string][]) =>
  guardAnswer({ answer, citations: cites.map(([label, refId, value]) => ({ label, refId, value })) }, signed);

test('a saving stated as a cost is not found, and the right direction is', () => {
  const unit: [string, string, string] = ['Unit cost change, Vesper', 's2_cost.unit_delta:vesper', '-9.2'];
  assert.deepEqual(g2('It adds $9.20 per unit.', [unit]).unverifiedNumbers, ['9.20']);
  assert.deepEqual(g2('It saves $9.20 per unit.', [unit]).unverifiedNumbers, []);
  assert.deepEqual(g2('The unit cost changes by -$9.20.', [unit]).unverifiedNumbers, []);
});

test('a percent matches a share only times 100', () => {
  const share: [string, string, string] = ['Scrap recovery share', 'scrap_recovery', '0.015'];
  assert.deepEqual(g2('Scrap recovery is 0.015%.', [share]).unverifiedNumbers, ['0.015%']);
  assert.deepEqual(g2('Scrap recovery is 1.5%.', [share]).unverifiedNumbers, []);
});

test('an empty citation value is not verified', () => {
  const r = g2('See the total.', [['One-time total', 's2_cost.one_time_total', '']]);
  assert.equal(r.citations[0]!.verified, false);
});

test('citing the whole detail row is too broad to count as evidence', () => {
  const r = g2('The rate is 37.5.', [['detail', 'detail', '37.5']]);
  assert.equal(r.citations[0]!.verified, false);
  assert.deepEqual(r.unverifiedNumbers, ['37.5']);
});

test('a number is checked against the citation its sentence names', () => {
  const cites: [string, string, string][] = [
    ['One-time total', 's2_cost.one_time_total', '148,521'],
    ['Inventory disposition', 's2_cost.line:inventory', '60,439'],
  ];
  assert.deepEqual(g2('The one-time cost is $60,439.', cites).unverifiedNumbers, ['60,439']);
  assert.deepEqual(g2('The one-time cost is $148,521. Inventory disposition is $60,439.', cites).unverifiedNumbers, []);
});

test('dates and serial numbers are not read as quantities', () => {
  const r = g2('The cut-in is 2026-11-05 at S/N 011-014, and the total is $148,521.', [['One-time total', 's2_cost.one_time_total', '148,521']]);
  assert.deepEqual(r.unverifiedNumbers, []);
});
