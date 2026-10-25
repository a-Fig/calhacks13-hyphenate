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
type Cite = [id: string, refId: string, value: string];
const guardOn = (rs: ToolResultText[]) => (answer: string, cites: Cite[]) => guardAnswer({ answer, citations: cites.map(([id, refId, value]) => ({ id, refId, value })) }, rs);
const guard = guardOn(results);

test('numbers are read at the precision shown', () => {
  const n = findNumbers('It is $304,745, about $305k, or 10% of 18.64 and $1.6M.');
  assert.deepEqual(n.map(x => x.nominal), [304745, 305000, 10, 18.64, 1_600_000]);
  assert.equal(n[2]!.percent, true);
});

test('identifiers and list markers are not quantities', () => {
  const t = '1. See ECR-0417 and BW-5120-210 (Q-HAL-26-1187#1) at P50 for S2.';
  assert.deepEqual(findNumbers(t), []);
});

test('an id the session did not read is not an identifier, it is a number nobody can check', () => {
  const known = 'ecr-0417 bw-5120-210';
  assert.deepEqual(findNumbers('See ECR-0417, BW-5120-210 and P50.', { known }), []);
  const odd = findNumbers('See BW-5120-999 and BW5120.', { known });
  assert.deepEqual(odd.map(f => [f.text, f.parsed]), [['BW-5120-999', false], ['BW5120', false]]);
});

test('an answer quoted from the cited result passes', () => {
  const g = guard('The cancellation charge is 10% [c1] of the price, 18.64 [c1] per unit on the 60 [c1] on order (quote line 6 [c1]). It sits in the $60,439 [c2] inventory line, which is scrap 324 [c2] and cancel 60 [c2].', [
    ['c1', 'in:cancel:BW-5120-210', '10%'],
    ['c2', 's2_cost.line:inventory:BW-5120-210', '$60,439'],
  ]);
  assert.deepEqual(g.unverifiedNumbers, []);
  assert.ok(g.citations.every(c => c.verified));
  assert.ok(g.segments.every(s => !s.unverified));
});

test('markers are removed from the text and become the numbers\' references', () => {
  const g = guard('One-time cost is $304,745 [c1], or $305k [c1]. Scrap recovery is 1.5% [c2].', [
    ['c1', 'one_time_total', '$304,745'],
    ['c2', 'scrap_recovery', '1.5%'],
  ]);
  assert.equal(g.text, 'One-time cost is $304,745, or $305k. Scrap recovery is 1.5%.');
  assert.equal(g.segments.map(s => s.text).join(''), g.text);
  assert.deepEqual(g.segments.filter(s => s.cites).map(s => [s.text, s.cites]), [['304,745', ['c1']], ['305k', ['c1']], ['1.5%', ['c2']]]);
  assert.deepEqual(g.unverifiedNumbers, []);
});

test('rounding to the shown precision passes, other rounding does not', () => {
  const ok = guard('One-time cost is $304,745 [c1], or $305k [c1].', [['c1', 'one_time_total', '$304,745']]);
  assert.deepEqual(ok.unverifiedNumbers, []);
  const bad = guard('One-time cost is about $148k [c1], and $304k [c1].', [['c1', 'one_time_total', '$304,745']]);
  assert.deepEqual(bad.unverifiedNumbers, ['148k', '304k']);
  assert.deepEqual(bad.segments.filter(s => s.unverified).map(s => s.text), ['148k', '304k']);
});

test('a percent matches a fraction', () => {
  const g = guard('Scrap recovery is assumed at 1.5% [c1].', [['c1', 'scrap_recovery', '1.5%']]);
  assert.deepEqual(g.unverifiedNumbers, []);
  assert.deepEqual(guard('Scrap recovery is assumed at 15% [c1].', [['c1', 'scrap_recovery', '15%']]).unverifiedNumbers, ['15%']);
});

test('a number is checked against the citation it names, not the others', () => {
  const g = guard('One-time cost is $304,745 [c1] and the inventory line is $60,439 [c1].', [['c1', 'one_time_total', '$304,745']]);
  assert.deepEqual(g.unverifiedNumbers, ['60,439']);
});

test('a citation whose id is in no tool result is unverified and backs nothing', () => {
  const g = guard('The charge is $60,439 [c1].', [['c1', 'in:made-up', '$60,439']]);
  assert.equal(g.citations[0]!.verified, false);
  assert.deepEqual(g.unverifiedNumbers, ['60,439']);
});

test('a citation with a wrong value is unverified', () => {
  const g = guard('One-time cost is $304,745 [c1].', [['c1', 'one_time_total', '$148,000']]);
  assert.equal(g.citations[0]!.verified, false);
});

test('a stage prefix on the id is optional', () => {
  const g = guard('One-time cost is $304,745 [c1].', [['c1', 's2_cost.one_time_total', '$304,745']]);
  assert.equal(g.citations[0]!.verified, true);
  assert.deepEqual(g.unverifiedNumbers, []);
});

test('an ECR number cannot be cited to vouch for every number', () => {
  const g = guard('The total is $304,745 [c1].', [['c1', 'BWM-ECR-0417', '']]);
  assert.equal(g.citations[0]!.verified, false);
  assert.deepEqual(g.unverifiedNumbers, ['304,745']);
});

test('an answer with no numbers needs none', () => {
  assert.deepEqual(guard('Norn has no record of that. Ask the cost accountant.', []).unverifiedNumbers, []);
});

test('mock results are reported', () => {
  const mocked: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'k', p50: 5, mock: true }] }) }];
  assert.equal(guardOn(mocked)('It is 5 [c1].', [['c1', 'k', '5']]).mock, true);
  assert.equal(guard('It is $304,745 [c1].', [['c1', 'one_time_total', '$304,745']]).mock, false);
});

test('a tool result that is not JSON backs nothing', () => {
  const g = guardOn([{ tool: 'x', content: 'Norn hit an internal error' }])('It is 5 [c1].', [['c1', 'k', '5']]);
  assert.deepEqual(g.unverifiedNumbers, ['5']);
});

test('the agent output is parsed, with or without a fence, and citations are named c1, c2 by place unless they say otherwise', () => {
  const body = '{"answer":"Ask the buyer.","citations":[{"label":"a","refId":"b","value":"c"},{"label":"no id"},{"id":"C7","refId":"d","value":"e"}]}';
  for (const t of [body, '```json\n' + body + '\n```', 'Here: ' + body]) {
    const p = parseAgentAnswer(t);
    assert.equal(p?.answer, 'Ask the buyer.');
    assert.deepEqual(p?.citations.map(c => [c.id, c.refId, c.value]), [['c1', 'b', 'c'], ['c7', 'd', 'e']]);
  }
  assert.equal(parseAgentAnswer('not json'), null);
  assert.equal(parseAgentAnswer('{"answer":""}'), null);
  assert.equal(parseAgentAnswer(null), null);
});

// ---- Earlier review (PR #149): each case is a probe that used to pass wrongly or fail wrongly.

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
const g2 = guardOn(signed);

test('a saving stated as a cost is not found, and the right direction is', () => {
  const unit: Cite = ['c1', 's2_cost.unit_delta:vesper', '-9.2'];
  assert.deepEqual(g2('It adds $9.20 [c1] per unit.', [unit]).unverifiedNumbers, ['9.20']);
  assert.deepEqual(g2('It saves $9.20 [c1] per unit.', [unit]).unverifiedNumbers, []);
  assert.deepEqual(g2('The unit cost changes by -$9.20 [c1].', [unit]).unverifiedNumbers, []);
});

test('a percent matches a share only times 100', () => {
  const share: Cite = ['c1', 'scrap_recovery', '0.015'];
  assert.deepEqual(g2('Scrap recovery is 0.015% [c1].', [share]).unverifiedNumbers, ['0.015%']);
  assert.deepEqual(g2('Scrap recovery is 1.5% [c1].', [share]).unverifiedNumbers, []);
});

test('an empty citation value is not verified', () => {
  const r = g2('See the total.', [['c1', 's2_cost.one_time_total', '']]);
  assert.equal(r.citations[0]!.verified, false);
});

test('citing the whole detail row is too broad to count as evidence', () => {
  const r = g2('The rate is 37.5 [c1].', [['c1', 'detail', '37.5']]);
  assert.equal(r.citations[0]!.verified, false);
  assert.deepEqual(r.unverifiedNumbers, ['37.5']);
});

test('dates and serial numbers are not read as quantities', () => {
  const r = g2('The cut-in is 2026-11-05 at S/N 011-014, and the total is $148,521 [c1].', [['c1', 's2_cost.one_time_total', '148,521']]);
  assert.deepEqual(r.unverifiedNumbers, []);
});

// ---- Second review (PR #149). Each of these is a reviewer's repro: it passed before and must not now.

test('P1.1 an amount with no citation is not verified, however it is written', () => {
  for (const [text, shown] of [
    ['It costs nine million dollars.', 'nine million'],
    ['It costs USD999999.', '999999'],
    ['It costs 999,999 dollars.', '999,999'],
    ['It costs $2 billion.', '2 billion'],
    ['It costs a million dollars.', 'a million'],
    ['It costs half a million.', 'half a million'],
    ['It costs two and a half million.', 'two and a half million'],
    ['It costs twelve thousand five hundred.', 'twelve thousand five hundred'],
    ['It costs 1 000 000.', '1 000 000'],
    ['It costs 1e6.', '1e6'],
    ['A change of .1% only.', '.1%'],
  ] as const) {
    assert.deepEqual(guard(text, []).unverifiedNumbers, [shown], text);
  }
});

test('P1.1 an amount in other words or other magnitudes is not matched to a stored number that is smaller', () => {
  const two: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'two', p50: 2 }, { key: 'tenth', value: 0.01 }] }) }];
  const g = guardOn(two);
  assert.deepEqual(g('It is $2 billion [c1].', [['c1', 'two', '2']]).unverifiedNumbers, ['2 billion']);
  assert.deepEqual(g('It is $2 million [c1].', [['c1', 'two', '2']]).unverifiedNumbers, ['2 million']);
  assert.deepEqual(g('It is two million dollars [c1].', [['c1', 'two', '2']]).unverifiedNumbers, ['two million']);
  assert.deepEqual(g('It is $2m [c1] and 2k [c1].', [['c1', 'two', '2']]).unverifiedNumbers, ['2m', '2k']);
  assert.deepEqual(g('It is 200 cents [c1].', [['c1', 'two', '2']]).unverifiedNumbers, []); // 200 cents is $2
  assert.deepEqual(g('It is $2 [c1], two dollars [c1].', [['c1', 'two', '2']]).unverifiedNumbers, []);
  // .1% is a tenth of a percent; the stored 0.01 is one percent
  assert.deepEqual(g('It is .1% [c1].', [['c1', 'tenth', '0.01']]).unverifiedNumbers, ['.1%']);
  assert.deepEqual(g('It is 0.1% [c1].', [['c1', 'tenth', '0.01']]).unverifiedNumbers, ['0.1%']);
  assert.deepEqual(g('It is 1% [c1].', [['c1', 'tenth', '0.01']]).unverifiedNumbers, []);
});

test('P1.1 amounts written as a currency code, in words or with a leading decimal point are read and then checked', () => {
  const big: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'big', p50: 9_000_000 }, { key: 'code', p50: 999999 }, { key: 'half', value: 0.1 }] }) }];
  const g = guardOn(big);
  assert.deepEqual(g('It costs nine million dollars [c1].', [['c1', 'big', '9000000']]).unverifiedNumbers, []);
  assert.deepEqual(g('It costs $9m [c1].', [['c1', 'big', '9000000']]).unverifiedNumbers, []);
  assert.deepEqual(g('It costs USD999999 [c1].', [['c1', 'code', '999999']]).unverifiedNumbers, []);
  assert.deepEqual(g('It costs 999,999 dollars [c1].', [['c1', 'code', '999999']]).unverifiedNumbers, []);
  assert.deepEqual(g('It costs USD999999 [c1].', [['c1', 'big', '9000000']]).unverifiedNumbers, ['999999']);
  assert.deepEqual(g('The share is .1 [c1].', [['c1', 'half', '0.1']]).unverifiedNumbers, []);
});

test('P1.1 anything that looks numeric but cannot be read is unverified, even with a citation to the same digits', () => {
  const digits: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'k', p50: 123456, note: 'BW-5120-210' }] }) }];
  const g = guardOn(digits);
  for (const [text, shown] of [
    ['It is 1.2.3 [c1].', '1.2.3'],
    ['It is 1,2,3 [c1].', '1,2,3'],
    ['It is 12,34 [c1].', '12,34'],
    ['It is ABC123456 [c1].', 'ABC123456'],
    ['It is Total-123456 [c1].', 'Total-123456'],
    ['It is 0x1E240 [c1].', '0x1E240'],
    ['It is １２３ [c1].', '１２３'],
    ['It is ½ [c1].', '½'],
    ['It is BW-5120-999 [c1].', 'BW-5120-999'],
  ] as const) {
    assert.deepEqual(g(text, [['c1', 'k', '123456']]).unverifiedNumbers, [shown], text);
  }
  // an id the session read is still an id
  assert.deepEqual(g('The part BW-5120-210 costs 123456 [c1].', [['c1', 'k', '123456']]).unverifiedNumbers, []);
});

test('P1.1 a list number cannot hide an amount, and a date is not an amount', () => {
  assert.deepEqual(guard('Total:\n9000000) dollars', []).unverifiedNumbers, ['9000000']);
  assert.deepEqual(guard('1. First point.\n2) Second point.', []).unverifiedNumbers, []);
  assert.deepEqual(guard('Cut in on 2026-11-05 and 11/05/2026.', []).unverifiedNumbers, []);
});

test('P1.1 "one" is a number only where an amount is meant', () => {
  assert.deepEqual(guard('The one-time cost is one of the quotes; no one knows.', []).unverifiedNumbers, []);
  assert.deepEqual(guard('It is one million dollars, or one percent.', []).unverifiedNumbers, ['one million', 'one percent']);
});

test('P1.1 chips show the stored data\'s own label and value, never the agent\'s wording or numbers', () => {
  const g = g2('The total is $148,521 [c1].', [['c1', 's2_cost.one_time_total', '$148,521']]);
  assert.equal(g.citations[0]!.label, 'One-time total');
  // a label the agent chose is not carried at all
  const named = guardAnswer({ answer: 'x [c1]', citations: [{ id: 'c1', label: 'One-time total $9,999,999', refId: 's2_cost.line:inventory', value: '$60,439' }] }, signed);
  assert.equal(named.citations[0]!.label, 'Inventory disposition');
  assert.equal(named.citations[0]!.value, '$60,439');
  // a value with a number the stored data does not hold is not shown; the stored value's own display is
  const wrong = guardAnswer({ answer: 'x [c1]', citations: [{ id: 'c1', refId: 's2_cost.line:inventory', value: '$9,999,999' }] }, signed);
  assert.equal(wrong.citations[0]!.verified, false);
  assert.equal(wrong.citations[0]!.value, '$60,439');
  // nothing stored, nothing shown
  const none = guardAnswer({ answer: 'x [c1]', citations: [{ id: 'c1', label: 'Charge $5,000,000', refId: 'in:made-up', value: '$5,000,000' }] }, signed);
  assert.deepEqual([none.citations[0]!.verified, none.citations[0]!.value, none.citations[0]!.label], [false, '', 'in:made-up']);
});

test('P2.2 an explicit plus, or a word that says higher, does not pass against a negative value', () => {
  const charge: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'charge', label: 'Charge', unit: 'usd', p50: -9.2 }] }) }];
  const g = guardOn(charge);
  const c: Cite = ['c1', 'charge', '-9.2'];
  for (const text of ['The charge is +$9.20 [c1].', 'The charge is $9.20 [c1] higher.', 'The charge rose by $9.20 [c1].', 'It is an increase of $9.20 [c1].', 'It costs $9.20 [c1] more.', 'It is $9.20 [c1] extra.', 'It adds $9.20 [c1].', 'The charge is +9.2 [c1].'])
    assert.deepEqual(g(text, [c]).unverifiedNumbers, [/9\.2\d*/.exec(text)![0]], text);
  for (const text of ['The charge is -$9.20 [c1].', 'The charge is −$9.20 [c1].', 'The charge is ($9.20 [c1]).', 'The charge is $9.20 [c1] lower.', 'It is a saving of $9.20 [c1].', 'It saves $9.20 [c1].', 'It is a decrease of $9.20 [c1].', 'It costs $9.20 [c1] less.', 'It is $9.20 [c1] cheaper.'])
    assert.deepEqual(g(text, [c]).unverifiedNumbers, [], text);
  // and the other way round: a stored increase is not a stated saving
  const up: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'up', p50: 9.2 }] }) }];
  assert.deepEqual(guardOn(up)('It saves $9.20 [c1].', [['c1', 'up', '9.2']]).unverifiedNumbers, ['9.20']);
  assert.deepEqual(guardOn(up)('It is +$9.20 [c1] and $9.20 [c1] higher.', [['c1', 'up', '9.2']]).unverifiedNumbers, []);
});

test('P1.3 an amount is checked against the citation its own marker names, not every citation', () => {
  const two: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'one_time_total', label: 'One-time total', unit: 'usd', p50: 148521 }, { key: 'other', label: 'Other', unit: 'usd', p50: 9.2 }] }) }];
  const g = guardOn(two);
  const cites: Cite[] = [['c1', 'one_time_total', '148,521'], ['c2', 'other', '9.2']];
  // the reviewer's repro: both cited, and the total stated as the other number
  assert.deepEqual(g('The one-time total is $9.20.', cites).unverifiedNumbers, ['9.20']);
  assert.deepEqual(g('The one-time total is $9.20 [c1].', cites).unverifiedNumbers, ['9.20']);
  assert.deepEqual(g('The one-time total is $148,521 [c2].', cites).unverifiedNumbers, ['148,521']);
  assert.deepEqual(g('The one-time total is $148,521 [c1]. The other is $9.20 [c2].', cites).unverifiedNumbers, []);
  assert.deepEqual(g('The one-time total is $148,521 [c1] and $9.20 [c1, c2].', cites).unverifiedNumbers, []);
});

test('P1.3 no marker, a marker for a citation that does not exist, or a marker away from the number is not verified', () => {
  const cites: Cite[] = [['c1', 's2_cost.one_time_total', '148,521']];
  assert.deepEqual(g2('The total is $148,521.', cites).unverifiedNumbers, ['148,521']);
  assert.deepEqual(g2('The total is $148,521 [c9].', cites).unverifiedNumbers, ['148,521']);
  assert.deepEqual(g2('The total is $148,521 as quoted [c1].', cites).unverifiedNumbers, ['148,521']);
  assert.deepEqual(g2('The total [c1] is $148,521.', cites).unverifiedNumbers, ['148,521']);
  assert.deepEqual(g2('The total is $148,521[c1].', cites).unverifiedNumbers, []);
  assert.deepEqual(g2('The total is $148,521 dollars [c1].', cites).unverifiedNumbers, []);
  assert.deepEqual(g2('The total is 148,521 [C1].', cites).unverifiedNumbers, []);
});

test('P1.3 a marker cannot be placed inside a number to split it', () => {
  assert.deepEqual(g2('The total is 1[c1]48521.', [['c1', 's2_cost.one_time_total', '148,521']]).unverifiedNumbers, ['148521']);
});

test('P1.3 a label the agent chose cannot make a number pass as something it is not', () => {
  // the inventory line is cited under the label "One-time total"; $60,439 is the inventory line, and the chip says so
  const g = g2('The one-time total is $60,439 [c1].', [['c1', 's2_cost.line:inventory', '$60,439']]);
  assert.equal(g.citations[0]!.label, 'Inventory disposition');
  const mislabelled = guardAnswer({ answer: 'The one-time total is $60,439 [c1].', citations: [{ id: 'c1', label: 'One-time total', refId: 's2_cost.line:inventory', value: '$60,439' }] }, signed);
  assert.equal(mislabelled.citations[0]!.label, 'Inventory disposition');
  assert.equal(mislabelled.text, 'The one-time total is $60,439.');
});

test('P2.7 a nested input inside a mock result makes the answer mock', () => {
  const nested: ToolResultText[] = [
    {
      tool: 'mcp__norn__get_impact',
      content: JSON.stringify({
        mock: false,
        results: [
          { key: 'cost', label: 'Cost', p50: 5, mock: true, trace: { inputs: [{ id: 'in:rate', display: '12%', value: 0.12 }] } },
          { key: 'real', label: 'Real', p50: 7, mock: false, trace: { inputs: [{ id: 'in:other', value: 0.3 }] } },
        ],
      }),
    },
  ];
  const g = guardOn(nested);
  assert.equal(g('The rate is 12% [c1].', [['c1', 'in:rate', '12%']]).mock, true);
  assert.equal(g('The cost is 5 [c1].', [['c1', 'cost', '5']]).mock, true);
  assert.equal(g('The share is 30% [c1].', [['c1', 'in:other', '0.3']]).mock, false);
});

test('P1.1 more ways to write an amount: hundreds, basis points, mil, a hyphen or capitals', () => {
  const n = (t: string) => findNumbers(t).map(f => [f.text, f.nominal, f.percent]);
  assert.deepEqual(n('9 hundred thousand dollars'), [['9 hundred thousand', 900_000, false]]);
  assert.deepEqual(n('25 bps'), [['25 bps', 0.25, true]]);
  assert.deepEqual(n('5 mil'), [['5 mil', 5_000_000, false]]);
  assert.deepEqual(n('NINE-MILLION'), [['NINE-MILLION', 9_000_000, false]]);
  assert.deepEqual(n('nine hundred ninety-nine thousand'), [['nine hundred ninety-nine thousand', 999_000, false]]);
  assert.deepEqual(n('a dozen and half a dozen'), [['a dozen', 12, false], ['half a dozen', 6, false]]);
});

test('direction: the nearest word wins, and a comparison with another figure gives none', () => {
  const sign = (t: string) => findNumbers(t).map(f => f.sign);
  assert.deepEqual(sign('It saves $5 and costs $7 elsewhere.'), [-1, 1]);
  assert.deepEqual(sign('It costs $7 but saves $5.'), [1, -1]);
  assert.deepEqual(sign('That is lower than the one-time total of $304,745.'), [0]);
  assert.deepEqual(sign('That is more than $5.'), [0]);
  assert.deepEqual(sign('That is $5 less than last year.'), [-1]);
  assert.deepEqual(sign('A change of -5, +5, −5 and (5).'), [-1, 1, -1, -1]);
  assert.deepEqual(sign('Between 5-7 units.'), [0, 0]);
});

test('P1.1 no spelling of a different amount passes against a stored 2, and the spellings of 2 itself do', () => {
  const stored: ToolResultText[] = [{ tool: 'x', content: JSON.stringify({ results: [{ key: 'amount', label: 'Amount', unit: 'usd', p50: 2 }] }) }];
  const g = guardOn(stored);
  const unverified = (written: string) => g(`It is ${written} [c1].`, [['c1', 'amount', '2']]).unverifiedNumbers;
  for (const other of ['2,000', 'two thousand', '2 thousand', '2K', '2 k', '2e3', '$2 000', "2'000", '2_000', '2 hundred', 'two-hundred', '0.002 million', '2 Mio', '2 bln', '2 lakh', '2 crore', '2 millions', '$2 m', '$2 b', '2 bps', '2,00', '2.00.0', '２', '20/10'])
    assert.notDeepEqual(unverified(other), [], other);
  for (const same of ['2', '2.0', '$2.00', 'two', 'USD2', '2 dollars', 'two dollars', '200 cents', '+2'])
    assert.deepEqual(unverified(same), [], same);
});

// The 2026-10-25 rerun on ECR-0417: "What moves the 12-month net cost most, and by how much?"
const netRows = { ecr: 'BWM-ECR-0417', state: 'current', mock: false, stages: [{ stage: 's3_cost', results: [{ key: 'net_total_year_one', label: 'Net cost, year one', unit: 'usd', p10: 150682.41, p50: 156821.28, p90: 164556.34, mock: false }] }] };
const statements = {
  ecr: 'BWM-ECR-0417',
  statements: [
    {
      id: 12,
      level: 1,
      drivers: [
        { text: 'BW-5120-210: use up the old stock or scrap it moves the 12-month net cost between $96,233 and $156,821, a swing of $60,588.', evidence: 'computation' },
        { text: 'The vibration re-test on the endurance rig is the largest forecast driver, $7,157.', evidence: 'computation' },
        { text: 'Engineering hours come next, $5,946.', evidence: 'computation' },
      ],
    },
  ],
};
const rerun = guardOn([
  { tool: 'mcp__norn__get_impact', content: JSON.stringify(netRows) },
  { tool: 'mcp__norn__get_ecr', content: JSON.stringify(statements) },
]);
const rerunAnswer =
  "The biggest mover is the choice for the old BW-5120-210 bracket stock: use it up or scrap it. Norn's driver statement says this moves the 12-month net cost between $96,233 [c1] and $156,821 [c1], a swing of $60,588 [c1]. Those three figures come from the driver text. The upper end matches the point estimate of $156,821 [c2]. The overall forecast range is $150,682 [c3] to $164,556 [c4]. The vibration re-test swings the cost by $7,157 [c5], and engineering hours come next at $5,946 [c6]. The totals leave out several items that are counted as $0 until someone estimates them.";
const rerunCites: Cite[] = [
  ['c1', 'driver:12.1', '$60,588'],
  ['c2', 'net_total_year_one', '$156,821'],
  ['c3', 'net_total_year_one', '$150,682'],
  ['c4', 'net_total_year_one', '$164,556'],
  ['c5', 'driver:12.2', '$7,157'],
  ['c6', 'driver:12.3', '$5,946'],
];

test('the rerun: driver numbers verify when their driver is cited, words are not numbers, a bare $0 stays unverified', () => {
  const g = rerun(rerunAnswer, rerunCites);
  assert.deepEqual(g.unverifiedNumbers, ['0']);
  assert.ok(g.citations.every(c => c.verified));
  assert.equal(g.citations[0]!.label.startsWith('BW-5120-210: use up the old stock'), true);
  const shown = (t: string) => g.segments.find(s => s.text === t);
  for (const n of ['96,233', '156,821', '60,588', '7,157', '5,946']) assert.equal(shown(n)?.unverified, undefined, n);
  assert.deepEqual(shown('60,588')?.cites, ['c1']);
  // "12-month" and "three" are in the text and are not numbers
  assert.ok(!g.segments.some(s => s.text === '12' || s.text === 'three'));
  assert.equal(g.segments.map(s => s.text).join(''), g.text);
});

test('the rerun: a driver number stays unverified unless that driver is cited and holds it', () => {
  // the same figures with no citation, the wrong driver, a driver that does not exist, and the ECR id
  assert.deepEqual(rerun('The swing is $60,588.', []).unverifiedNumbers, ['60,588']);
  assert.deepEqual(rerun('The swing is $60,588 [c1].', [['c1', 'driver:12.2', '$60,588']]).unverifiedNumbers, ['60,588']);
  assert.deepEqual(rerun('The swing is $60,588 [c1].', [['c1', 'driver:12.9', '$60,588']]).unverifiedNumbers, ['60,588']);
  assert.deepEqual(rerun('The swing is $60,588 [c1].', [['c1', 'driver:99.1', '$60,588']]).unverifiedNumbers, ['60,588']);
  assert.deepEqual(rerun('The swing is $60,588 [c1].', [['c1', 'BWM-ECR-0417', '$60,588']]).unverifiedNumbers, ['60,588']);
  // a number no tool result holds, even with a driver cited
  assert.deepEqual(rerun('The swing is $61,000 [c1].', [['c1', 'driver:12.1', '$61,000']]).unverifiedNumbers, ['61,000']);
  assert.deepEqual(rerun('The swing is $60,589 [c1] and about $60k [c1].', [['c1', 'driver:12.1', '$60,588']]).unverifiedNumbers, ['60,589', '60k']);
  // rounding stays as it was: the shown precision, no coarser
  assert.deepEqual(rerun('The swing is $60,588 [c1] or $60.588k [c1].', [['c1', 'driver:12.1', '$60,588']]).unverifiedNumbers, []);
});

test('a driver also verifies where drivers sit under another result', () => {
  const g = guardOn([{ tool: 'mcp__norn__get_impact', content: JSON.stringify({ ecr: 'X', statements: statements.statements }) }]);
  assert.deepEqual(g('The swing is $5,946 [c1].', [['c1', 'driver:12.3', '$5,946']]).unverifiedNumbers, []);
});

test('a number glued into a word with a hyphen is part of the word', () => {
  const t = (s: string) => findNumbers(s).map(f => f.text);
  assert.deepEqual(t('The 12-month net cost and a three-way match, a 30-day window.'), []);
  assert.deepEqual(t('Serial S/N 011-014 and 5-7 units.'), ['5', '7']);
  // amounts keep their magnitude, percent and currency words, with or without the hyphen
  assert.deepEqual(t('A $12-month charge, 10-percent, nine-million, 5-k'), ['12', '10', 'nine-million', '5']);
  assert.deepEqual(t('It is 12-month [c1]'), []);
});

test('a small count written as a word is not marked unless a citation marker follows it', () => {
  assert.deepEqual(guard('Three quotes and two suppliers, ten lines.', []).unverifiedNumbers, []);
  assert.deepEqual(guard('Three [c1] quotes.', [['c1', 'one_time_total', '3']]).unverifiedNumbers, ['Three']);
  assert.deepEqual(guard('There are three quotes at ten percent, or eleven.', []).unverifiedNumbers, ['ten percent', 'eleven']);
  assert.deepEqual(guard('It is two dollars, three million.', []).unverifiedNumbers, ['two', 'three million']);
  assert.equal(guard('Three quotes.', []).segments.map(s => s.text).join(''), 'Three quotes.');
});
