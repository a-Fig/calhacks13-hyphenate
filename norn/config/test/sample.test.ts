import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatIssue, loadConfigFile, type CompanyConfig } from '../src/index.ts';
import { hash32, isSampled, sampleValue } from '../src/sample.ts';

const BOWMAN = fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url));
/** The state-layer module's forecast `seed` default (CONFIG_DEFAULTS.seed in norn/module/src/core.ts). Sampling must not use it. */
const FORECAST_SEED = 'norn-seed-1';
/** Bowman's `autonomy.sampleSeed`. */
const SAMPLE_SEED = 'norn-sample-1';
const ecrId = (n: number): string => 'ECR-' + String(n).padStart(4, '0');

describe('sampling is a pure function of sampleSeed, ECR id and action', () => {
  it('gives the same answer every time, in any order', () => {
    const keys = [1, 2, 3, 417, 423].map((n) => ({ sampleSeed: SAMPLE_SEED, ecrId: ecrId(n), action: 'write_bom' }));
    const first = keys.map((k) => sampleValue(k));
    const again = [...keys].reverse().map((k) => sampleValue(k)).reverse();
    assert.deepEqual(again, first);
    for (const k of keys) assert.equal(isSampled({ ...k, rate: 0.5 }), isSampled({ ...k, rate: 0.5 }));
  });

  it('is pinned, so another implementation can be checked against it', () => {
    assert.equal(hash32(''), 2872998923);
    assert.equal(hash32('a'), 444641715);
    assert.equal(hash32('ECR-0417'), 591752485);
    assert.equal(sampleValue({ sampleSeed: 'norn-seed-1', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' }), 0.9692706791684031);
    assert.equal(sampleValue({ sampleSeed: 'norn-seed-1', ecrId: 'ECR-0417', action: 'write_bom' }), 0.2501482837833464);
    assert.equal(sampleValue({ sampleSeed: 'norn-seed-2', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' }), 0.5151446971576661);
    assert.equal(sampleValue({ sampleSeed: 'norn-sample-1', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' }), 0.5386328629683703);
    assert.equal(sampleValue({ sampleSeed: 'norn-sample-1', ecrId: 'ECR-0417', action: 'write_bom' }), 0.7476300676353276);
    assert.equal(sampleValue({ sampleSeed: 'norn-sample-1', ecrId: 'ECR-0409', action: 'set_company_class' }), 0.18520728405565023);
  });

  it('gives a number from 0 up to but not including 1', () => {
    for (let n = 1; n <= 2000; n++) {
      const v = sampleValue({ sampleSeed: 's', ecrId: ecrId(n), action: 'a' });
      assert.ok(v >= 0 && v < 1, String(v));
    }
  });

  it('depends on each of the sample seed, the ECR and the action', () => {
    const base = { sampleSeed: 'norn-seed-1', ecrId: 'ECR-0423', action: 'approve_fast_track_ecr' };
    const value = sampleValue(base);
    assert.notEqual(sampleValue({ ...base, sampleSeed: 'norn-seed-2' }), value);
    assert.notEqual(sampleValue({ ...base, ecrId: 'ECR-0424' }), value);
    assert.notEqual(sampleValue({ ...base, action: 'write_bom' }), value);
  });

  it('does not confuse where one part ends and the next begins', () => {
    assert.notEqual(sampleValue({ sampleSeed: 'a', ecrId: 'bc', action: 'd' }), sampleValue({ sampleSeed: 'ab', ecrId: 'c', action: 'd' }));
  });

  it('samples a share close to the rate, over many ECRs', () => {
    const N = 20_000;
    for (const rate of [0.05, 0.2, 0.5]) {
      let sampled = 0;
      for (let n = 1; n <= N; n++) if (isSampled({ sampleSeed: SAMPLE_SEED, ecrId: ecrId(n), action: 'approve_fast_track_ecr', rate })) sampled++;
      assert.ok(Math.abs(sampled / N - rate) < 0.01, `rate ${rate}: sampled ${sampled / N}`);
    }
  });

  it('chooses different ECRs for different actions, not the same ones', () => {
    const N = 5000;
    let both = 0;
    let first = 0;
    for (let n = 1; n <= N; n++) {
      const a = isSampled({ sampleSeed: SAMPLE_SEED, ecrId: ecrId(n), action: 'write_bom', rate: 0.5 });
      const b = isSampled({ sampleSeed: SAMPLE_SEED, ecrId: ecrId(n), action: 'update_standard_cost', rate: 0.5 });
      if (a) first++;
      if (a && b) both++;
    }
    // Independent draws at 0.5 overlap on about half of the first action's ECRs.
    assert.ok(Math.abs(both / first - 0.5) < 0.05, `overlap ${both / first}`);
  });

  it('samples nothing at rate 0 and everything at rate 1', () => {
    for (let n = 1; n <= 500; n++) {
      assert.equal(isSampled({ sampleSeed: 's', ecrId: ecrId(n), action: 'a', rate: 0 }), false);
      assert.equal(isSampled({ sampleSeed: 's', ecrId: ecrId(n), action: 'a', rate: 1 }), true);
    }
  });

  it('refuses a rate outside 0 to 1', () => {
    for (const rate of [-0.1, 1.1, NaN]) assert.throws(() => isSampled({ sampleSeed: 's', ecrId: 'ECR-0001', action: 'a', rate }), RangeError);
  });
});

describe("where Bowman's ECRs fall at Bowman's rates and Bowman's sample seed", () => {
  let config: CompanyConfig;
  before(async () => {
    const loaded = await loadConfigFile(BOWMAN);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map(formatIssue).join('\n'));
    config = loaded.config;
  });
  const sampled = (id: string, action: string): boolean => {
    const rule = config.autonomy.actions.find((a) => a.action === action)!;
    return isSampled({ sampleSeed: config.autonomy.sampleSeed, ecrId: id, action, rate: rule.sampleRate! });
  };

  it("has its own seed, apart from the module's forecast seed", () => {
    assert.equal(config.autonomy.sampleSeed, SAMPLE_SEED);
    assert.notEqual(config.autonomy.sampleSeed, FORECAST_SEED);
  });

  // Every draw for the four demo ECRs at norn-sample-1 and Bowman's rates, for the two actions that are
  // sampled. A draw under its rate is sampled. Pinned so that a change to the seed, the rates or the
  // algorithm shows up here, and so that the demo script can say what will happen to each ECR before
  // anyone runs it. The ERP actions are not here: they are recommend-only (#71), so nothing is drawn.
  const DRAWS: Array<{ ecr: string; action: string; rate: number; value: number; sampled: boolean }> = [
    { ecr: 'ECR-0423', action: 'set_company_class', rate: 0.25, value: 0.8392148073762655, sampled: false },
    { ecr: 'ECR-0423', action: 'approve_fast_track_ecr', rate: 0.2, value: 0.5386328629683703, sampled: false },
    { ecr: 'ECR-0417', action: 'set_company_class', rate: 0.25, value: 0.6571187830995768, sampled: false },
    { ecr: 'ECR-0417', action: 'approve_fast_track_ecr', rate: 0.2, value: 0.28841888601891696, sampled: false },
    { ecr: 'ECR-0409', action: 'set_company_class', rate: 0.25, value: 0.18520728405565023, sampled: true },
    { ecr: 'ECR-0409', action: 'approve_fast_track_ecr', rate: 0.2, value: 0.4529122475069016, sampled: false },
    { ecr: 'ECR-0415', action: 'set_company_class', rate: 0.25, value: 0.16507800621911883, sampled: true },
    { ecr: 'ECR-0415', action: 'approve_fast_track_ecr', rate: 0.2, value: 0.2095401156693697, sampled: false },
  ];
  const SAMPLED_ACTIONS = ['set_company_class', 'approve_fast_track_ecr'];

  it('samples exactly the two actions the draws below are pinned for, at their rates', () => {
    const sampledRules = config.autonomy.actions.filter((a) => a.level === 'approve_sampled' || a.otherwise === 'approve_sampled');
    assert.deepEqual(sampledRules.map((a) => a.action).sort(), [...SAMPLED_ACTIONS].sort());
    for (const { action, rate } of DRAWS) {
      assert.equal(config.autonomy.actions.find((a) => a.action === action)!.sampleRate, rate, action);
    }
  });

  it('draws nothing for the ERP actions, which are recommend-only', () => {
    for (const action of ['write_bom', 'update_standard_cost', 'draft_journal_entry', 'post_journal_entry']) {
      const rule = config.autonomy.actions.find((a) => a.action === action)!;
      assert.equal(rule.level, 'recommend', action);
      assert.equal(rule.sampleRate, undefined, action);
    }
  });

  for (const { ecr, action, rate, value, sampled: expected } of DRAWS) {
    it(`${ecr} ${action}: ${value.toFixed(4)} against ${rate}, so ${expected ? 'sampled' : 'not sampled'}`, () => {
      assert.equal(sampleValue({ sampleSeed: config.autonomy.sampleSeed, ecrId: ecr, action }), value);
      assert.equal(sampled(ecr, action), expected);
    });
  }

  const waitsOn = (ecr: string): string[] => SAMPLED_ACTIONS.filter((a) => sampled(ecr, a));

  it('ECR-0423 is sampled for nothing, so its fast track and class call go straight through', () => {
    assert.deepEqual(waitsOn('ECR-0423'), []);
  });

  it('ECR-0417 is sampled for nothing', () => {
    assert.deepEqual(waitsOn('ECR-0417'), []);
  });

  it('ECR-0409 is sampled for the class call, but not the fast track', () => {
    assert.deepEqual(waitsOn('ECR-0409'), ['set_company_class']);
  });

  it('ECR-0415 is sampled for the class call, and misses the fast-track sample by 0.0095', () => {
    assert.deepEqual(waitsOn('ECR-0415'), ['set_company_class']);
  });
});
