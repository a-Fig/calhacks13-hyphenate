// The checks on the agent's words (prose.ts), offline: what counts as "nothing was found", and which dollar figures match a number.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanWording, figuresIn, numbersIn, unknownAmounts } from './prose.ts';

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
