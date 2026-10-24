import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { date } from '../src/kit.ts';

describe('date', () => {
  const check = (value: unknown) => {
    const issues: { path: string; message: string }[] = [];
    const ok = date().check(value, 'when', issues);
    return { ok, issues };
  };

  it('accepts real dates, including a leap day', () => {
    assert.equal(check('2026-11-12').ok, true);
    assert.equal(check('2028-02-29').ok, true);
  });

  it('rejects a month or day out of range with a message, instead of throwing', () => {
    for (const bad of ['2026-13-12', '2026-00-10', '2026-02-30', '2027-02-29', '2026-04-31', '2026-01-00']) {
      const { ok, issues } = check(bad);
      assert.equal(ok, false, bad);
      assert.deepEqual(issues, [{ path: 'when', message: `expected a date as YYYY-MM-DD, got "${bad}"` }]);
    }
  });

  it('rejects text that is not shaped like a date', () => {
    for (const bad of ['12/11/2026', '2026-1-1', '', 20261112, null]) assert.equal(check(bad).ok, false);
  });
});
