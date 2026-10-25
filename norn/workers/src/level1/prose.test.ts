// The checks on the agent's words (prose.ts), offline: what counts as "nothing was found", and which dollar figures match a number.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanClaims, cleanWording, figuresIn, numbersIn, piecesOf, unknownAmounts, type Prose } from './prose.ts';

test('wording that says nothing was found is caught; wording that is specific, or about the cost bars, is not', () => {
  for (const t of ['Checks are clean.', 'The assessment is clean', 'All clear.', 'There are no issues.', 'No flags worth raising', 'We found no gaps.', 'Nothing to flag here.', 'It goes through without any concerns.', 'No further conditions.'])
    assert.ok(cleanWording(t), t);
  for (const t of [
    'Nothing here needs more than a routine look.',
    'No supplier conflict with another ECR.',
    'The cut-in is 2027-02-16 at the median.',
    'Three cost lines are blank and count as $0.',
    'Recommendation: Approve with conditions. Rule 2.',
    'Cleaning up the old stock costs $2,000.',
  ])
    assert.equal(cleanWording(t), null, t);
});

test('dollar figures: plain, thousands separators, k and million, with the rounding the figure shows', () => {
  const f = (s: string) => figuresIn(s).map(x => [x.value, x.tolerance]);
  assert.deepEqual(f('$1,234'), [[1234, 1]]);
  assert.deepEqual(f('$154k'), [[154_000, 500]]);
  assert.deepEqual(f('about $1.2 million'), [[1_200_000, 50_000]]);
  assert.deepEqual(f('($3,200) to $4,100.'), [[3200, 1], [4100, 1]]);
  assert.deepEqual(f('no figure, 12 weeks, 5%'), []);
});

test('a figure matches a known amount within its own rounding, in either sign; $0 always; anything else is named', () => {
  const known = [153_999.6, -2_480.2, 1_203_000];
  const bad = (text: string) => unknownAmounts({ headline: text, drivers: [], claims: [] }, known).map(x => x.figure);
  assert.deepEqual(bad('$154,000 or $154k or $154K; saving of ($2,480); $1.2 million; $0'), []);
  assert.deepEqual(bad('$999,999'), ['$999,999']);
  assert.deepEqual(bad('$155k'), ['$155k'], 'one thousand off is more than $154k rounds to');
  assert.deepEqual(bad('between $153,000 and $154,001'), ['$153,000', '$154,001'], 'a plain dollar figure is within a dollar, not a thousand');
  assert.equal(unknownAmounts({ headline: 'ok', drivers: [{ text: 'drives $7,777' }], claims: [{ text: 'and $154k' }] }, known)[0]!.where, 'driver 1');
});

test('every number inside a stored detail is known, and so is a figure in a message', () => {
  assert.deepEqual(numbersIn({ a: 1, b: [2, { c: 3.5 }], s: 'quote of $1,200 and 5 weeks', n: null }).sort((x, y) => x - y), [1, 2, 3.5, 1200]);
});

// ---- #123 round 3 ------------------------------------------------------------------------------------

test('negated wording is not "clean": "not clean" and "isn\'t clean" pass, an unscoped "clean" beside it is still caught', () => {
  for (const t of ['The checks are not clean.', "The assessment isn't clean.", 'The checks are not entirely clean: three cost lines are blank.', "They aren't all clear yet.", 'It is never clean on this part.'])
    assert.equal(cleanWording(t), null, t);
  assert.ok(cleanWording('Not clean overall, but the rest is clean.'), 'a second, positive "clean" is still caught');
  assert.ok(cleanWording('Checks are clean.'));
});

test('a scoped "X check is clean" is allowed when check X has no findings, and refused when it has; an unscoped one is refused either way', () => {
  const none = { cost: [], timeline: ['the slip'], supply: [] };
  const costBad = { cost: ['a blank line'], timeline: [], supply: [] };
  for (const t of ['The cost check is clean but the cut-in slips.', 'The supply check came back clean.', 'Cost and supply checks are clean; the timeline check found a slip.', 'The cost check looks clean.']) {
    assert.equal(cleanWording(t, none), null, t);
  }
  assert.ok(cleanWording('The cost check is clean but the cut-in slips.', costBad), 'cost has a finding');
  assert.ok(cleanWording('The timeline check is clean.', none), 'timeline has a finding');
  assert.ok(cleanWording('Cost and timeline checks are clean.', none), 'one of the two named has a finding');
  for (const t of ['Checks are clean.', 'The checks are clean, no issues.', 'There are no issues.', 'The cost check is fine, and everything else is clean.']) assert.ok(cleanWording(t, none), t);
  assert.ok(cleanWording('The cost check is clean.'), 'without the per-check findings a scoped claim cannot be vouched for');
});

test('"999,999 USD" is a dollar figure like "$999,999"', () => {
  const f = (s: string) => figuresIn(s).map(x => [x.value, x.tolerance]);
  assert.deepEqual(f('costs 999,999 USD a year'), [[999_999, 1]]);
  assert.deepEqual(f('USD 1,234'), [[1234, 1]]);
  assert.deepEqual(f('about 154k USD and 1.2 million USD'), [[154_000, 500], [1_200_000, 50_000]]);
  assert.deepEqual(f('$154,000 USD'), [[154_000, 1]], 'one figure, not two');
  assert.deepEqual(f('12 weeks, 5%, 10,000 draws, a USD-denominated quote'), []);
  const bad = unknownAmounts({ headline: 'The change costs 999,999 USD.', drivers: [], claims: [] }, [153_999.6]).map(x => x.figure);
  assert.deepEqual(bad, ['999,999 USD']);
  assert.deepEqual(unknownAmounts({ headline: 'It costs 154,000 USD.', drivers: [], claims: [] }, [153_999.6]), []);
});

test('the checked pieces are every agent-written field that is displayed, named for the message', () => {
  const p: Prose = {
    headline: 'H', changeClass: 'CC', route: 'R',
    numbers: [{ key: 'k1', evidence: 'computation', label: 'ignored', unit: 'ignored' }, { key: 'k2', evidence: 'judgment', label: 'L', unit: 'U' }, { key: 'k3', evidence: 'judgment', unit: '' }],
    drivers: [{ text: 'D' }], assumptions: [{ key: 'a', note: 'N' }], claims: [{ text: 'C' }],
  };
  assert.deepEqual(
    piecesOf(p).map(x => `${x.where}=${x.text}`),
    ['headline=H', 'change class=CC', 'approval route=R', 'number 2 label=L', 'number 2 unit=U', 'number 3 label=k3', 'driver 1=D', 'assumption 1 note=N', 'claim 1=C'],
    "a computation number's label and unit are Norn's, not the agent's; a number with no label is shown under its key"
  );
  // a statement as stored (no change class etc. on an older caller) still works
  assert.deepEqual(piecesOf({ headline: 'H', drivers: [], claims: [] }).map(x => x.where), ['headline']);
});

test("each displayed field is held to the clean-wording and dollar-figure checks, Sol's case first", () => {
  const findings = ['a blank line'];
  const base = (): Prose => ({ headline: 'ok', changeClass: 'Class I', route: 'CCB', numbers: [{ key: 'k', evidence: 'judgment', label: 'Cost', unit: 'USD' }], drivers: [{ text: 'ok' }], assumptions: [{ key: 'a', note: 'ok' }], claims: [{ text: 'ok' }] });
  assert.deepEqual(cleanClaims(base(), findings), []);
  assert.deepEqual(unknownAmounts(base(), []), []);
  const set: Record<string, (p: Prose, t: string) => Prose> = {
    headline: (p, t) => ({ ...p, headline: t }),
    'change class': (p, t) => ({ ...p, changeClass: t }),
    'approval route': (p, t) => ({ ...p, route: t }),
    'number 1 label': (p, t) => ({ ...p, numbers: [{ ...p.numbers![0]!, label: t }] }),
    'number 1 unit': (p, t) => ({ ...p, numbers: [{ ...p.numbers![0]!, unit: t }] }),
    'driver 1': (p, t) => ({ ...p, drivers: [{ text: t }] }),
    'assumption 1 note': (p, t) => ({ ...p, assumptions: [{ key: 'a', note: t }] }),
    'claim 1': (p, t) => ({ ...p, claims: [{ text: t }] }),
  };
  for (const [where, put] of Object.entries(set)) {
    assert.deepEqual(cleanClaims(put(base(), 'Checks are clean.'), findings), [{ where, phrase: 'clean' }], where);
    assert.deepEqual(unknownAmounts(put(base(), 'Costs $999,999 a year.'), [1]), [{ where, figure: '$999,999' }], where);
    assert.deepEqual(unknownAmounts(put(base(), 'Costs 999,999 USD a year.'), [1]), [{ where, figure: '999,999 USD' }], where);
  }
  // an unlabelled number is shown under its key
  const keyed: Prose = { ...base(), numbers: [{ key: 'No issues here', evidence: 'judgment' }] };
  assert.deepEqual(cleanClaims(keyed, findings).map(c => c.where), ['number 1 label']);
  // a computation number's label is Norn's and is not read
  const comp: Prose = { ...base(), numbers: [{ key: 'k', evidence: 'computation', label: 'clean $999,999' }] };
  assert.deepEqual(cleanClaims(comp, findings), []);
});
