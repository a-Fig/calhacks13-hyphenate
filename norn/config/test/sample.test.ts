import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatIssue, loadConfigFile, type CompanyConfig } from '../src/index.ts';
import { hash32, isSampled, sampleValue } from '../src/sample.ts';

const BOWMAN = fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url));
/** The state-layer module's default `seed` setting (CONFIG_DEFAULTS.seed in norn/module/src/core.ts). */
const MODULE_DEFAULT_SEED = 'norn-seed-1';
const ecrId = (n: number): string => 'ECR-' + String(n).padStart(4, '0');

describe('sampling is a pure function of seed, ECR id and action', () => {
  it('gives the same answer every time, in any order', () => {
    const keys = [1, 2, 3, 417, 423].map((n) => ({ seed: MODULE_DEFAULT_SEED, ecrId: ecrId(n), action: 'write_bom' }));
    const first = keys.map((k) => sampleValue(k));
    const again = [...keys].reverse().map((k) => sampleValue(k)).reverse();
    assert.deepEqual(again, first);
    for (const k of keys) assert.equal(isSampled({ ...k, rate: 0.5 }), isSampled({ ...k, rate: 0.5 }));
  });

  it('is pinned, so another implementation can be checked against it', () => {
    assert.equal(hash32(''), 2872998923);
    assert.equal(hash32('a'), 444641715);
    assert.equal(hash32('ECR-0417'), 591752485);
    assert.equal(sampleValue({ seed: 'norn-seed-1', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' }), 0.9692706791684031);
    assert.equal(sampleValue({ seed: 'norn-seed-1', ecrId: 'ECR-0417', action: 'write_bom' }), 0.2501482837833464);
    assert.equal(sampleValue({ seed: 'norn-seed-2', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' }), 0.5151446971576661);
  });

  it('gives a number from 0 up to but not including 1', () => {
    for (let n = 1; n <= 2000; n++) {
      const v = sampleValue({ seed: 's', ecrId: ecrId(n), action: 'a' });
      assert.ok(v >= 0 && v < 1, String(v));
    }
  });

  it('depends on each of the seed, the ECR and the action', () => {
    const base = { seed: 'norn-seed-1', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' };
    const value = sampleValue(base);
    assert.notEqual(sampleValue({ ...base, seed: 'norn-seed-2' }), value);
    assert.notEqual(sampleValue({ ...base, ecrId: 'ECR-0424' }), value);
    assert.notEqual(sampleValue({ ...base, action: 'write_bom' }), value);
  });

  it('does not confuse where one part ends and the next begins', () => {
    assert.notEqual(sampleValue({ seed: 'a', ecrId: 'bc', action: 'd' }), sampleValue({ seed: 'ab', ecrId: 'c', action: 'd' }));
  });

  it('samples a share close to the rate, over many ECRs', () => {
    const N = 20_000;
    for (const rate of [0.05, 0.2, 0.5]) {
      let sampled = 0;
      for (let n = 1; n <= N; n++) if (isSampled({ seed: MODULE_DEFAULT_SEED, ecrId: ecrId(n), action: 'approve_fast_track_ecr', rate })) sampled++;
      assert.ok(Math.abs(sampled / N - rate) < 0.01, `rate ${rate}: sampled ${sampled / N}`);
    }
  });

  it('chooses different ECRs for different actions, not the same ones', () => {
    const N = 5000;
    let both = 0;
    let first = 0;
    for (let n = 1; n <= N; n++) {
      const a = isSampled({ seed: MODULE_DEFAULT_SEED, ecrId: ecrId(n), action: 'write_bom', rate: 0.5 });
      const b = isSampled({ seed: MODULE_DEFAULT_SEED, ecrId: ecrId(n), action: 'update_standard_cost', rate: 0.5 });
      if (a) first++;
      if (a && b) both++;
    }
    // Independent draws at 0.5 overlap on about half of the first action's ECRs.
    assert.ok(Math.abs(both / first - 0.5) < 0.05, `overlap ${both / first}`);
  });

  it('samples nothing at rate 0 and everything at rate 1', () => {
    for (let n = 1; n <= 500; n++) {
      assert.equal(isSampled({ seed: 's', ecrId: ecrId(n), action: 'a', rate: 0 }), false);
      assert.equal(isSampled({ seed: 's', ecrId: ecrId(n), action: 'a', rate: 1 }), true);
    }
  });

  it('refuses a rate outside 0 to 1', () => {
    for (const rate of [-0.1, 1.1, NaN]) assert.throws(() => isSampled({ seed: 's', ecrId: 'ECR-0001', action: 'a', rate }), RangeError);
  });
});

describe("where Bowman's ECRs fall at Bowman's rates, with the module's default seed", () => {
  let config: CompanyConfig;
  before(async () => {
    const loaded = await loadConfigFile(BOWMAN);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map(formatIssue).join('\n'));
    config = loaded.config;
  });
  const sampled = (id: string, action: string): boolean => {
    const rule = config.autonomy.actions.find((a) => a.action === action)!;
    return isSampled({ seed: MODULE_DEFAULT_SEED, ecrId: id, action, rate: rule.sampleRate! });
  };

  it('ECR-0423 is not sampled for approve_fast_track_ecr, so the fast track goes straight through', () => {
    assert.equal(config.autonomy.actions.find((a) => a.action === 'approve_fast_track_ecr')!.sampleRate, 0.2);
    assert.equal(sampled('ECR-0423', 'approve_fast_track_ecr'), false);
  });

  it('ECR-0417 is sampled for write_bom but not for update_standard_cost', () => {
    assert.equal(sampled('ECR-0417', 'write_bom'), true);
    assert.equal(sampled('ECR-0417', 'update_standard_cost'), false);
  });
});
