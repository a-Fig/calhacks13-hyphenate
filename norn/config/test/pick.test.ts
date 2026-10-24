import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findOne } from '../src/pick.ts';

const rules = ['Anything touching safety or a flight-safety part', 'Interchangeability or interface changes', 'Retrofit of built or delivered aircraft'];

describe('findOne', () => {
  it('finds an entry by what it says', () => {
    assert.equal(findOne(rules, 'safety', 'rules'), rules[0]);
    assert.equal(findOne(rules, 'Retrofit', 'rules'), rules[2]);
  });

  it('still resolves when the source is reordered', () => {
    const swapped = [rules[2]!, rules[1]!, rules[0]!];
    assert.equal(findOne(swapped, 'safety', 'rules'), rules[0]);
    assert.equal(findOne(swapped, 'Interchangeability', 'rules'), rules[1]);
    assert.equal(findOne(swapped, 'Retrofit', 'rules'), rules[2]);
  });

  it('throws, naming what was looked for and what there was, when no entry matches', () => {
    assert.throws(
      () => findOne(rules, 'tooling', 'neverFastTrack'),
      (e: Error) => e.message.startsWith('neverFastTrack: expected exactly one entry containing "tooling", found none among 3: ') && e.message.includes('"Retrofit of built or delivered aircraft"')
    );
    assert.throws(() => findOne([], 'safety', 'rules'), /found none among 0/);
  });

  it('throws when more than one entry matches', () => {
    assert.throws(() => findOne([...rules, 'A second safety rule'], 'safety', 'rules'), /expected exactly one entry containing "safety", found 2 among 4/);
  });

  it('with several needles, an entry must contain all of them', () => {
    assert.equal(findOne(rules, ['Interchangeability', 'interface'], 'rules'), rules[1]);
    assert.throws(() => findOne(rules, ['Interchangeability', 'safety'], 'rules'), /containing "Interchangeability" and "safety", found none/);
  });

  it('is case-sensitive, so a source that changes its wording is noticed', () => {
    assert.throws(() => findOne(rules, 'retrofit', 'rules'), /found none/);
  });

  it('searches the text that textOf gives, for entries that are not strings', () => {
    const tiers = [{ limit: 1, approver: 'Technical Review Committee' }, { limit: 2, approver: 'Change Control Board' }];
    assert.equal(findOne(tiers, 'Board', 'tiers', (t) => t.approver).limit, 2);
  });

  it('refuses an empty needle, which would match everything', () => {
    assert.throws(() => findOne(rules, '', 'rules'), /expected a non-empty text/);
    assert.throws(() => findOne(rules, [], 'rules'), /expected a non-empty text/);
  });
});
