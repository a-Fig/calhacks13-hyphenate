import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck, point, quantileOf, type CostCheckResult, type Dist } from '../../checks/src/index.ts';
import { collectIdentifiers, findLeaks } from '../src/leak.ts';
import { genericLabel, pickTargets } from '../src/targets.ts';
import { contextFromEcr } from '../src/run.ts';

const ecr = bowman.ecrs.find((e) => e.id === 'ECR-0417')!;
const cost = costCheck(bowman, ecr, { seed: 'norn-seed-1' });
const ids = collectIdentifiers(bowman);

describe('pickTargets on ECR-0417', () => {
  const t = pickTargets(cost, { n: 4, context: contextFromEcr(ecr as never), identifiers: ids });
  it('ranks the measured default first, then the blank rows in cost-page order', () => {
    assert.deepEqual(t.map((x) => x.inputId.split(':')[0] + ':' + (x.inputId.split(':')[2] ?? '')), ['recovery:', 'cost:retrofit', 'cost:logisticsSupport', 'cost:other']);
    assert.equal(t[0]!.swing, cost.drivers.find((d) => d.id === t[0]!.inputId)!.swing);
    assert.equal(t[0]!.swingBasis, 'driver');
    assert.ok(t.slice(1).every((x) => x.swing === null && 'blank' in x.current));
  });
  it('leaves out inputs that are not defaults or blank: given quotes, estimates, the cancellation charge the supplier stated', () => {
    const picked = pickTargets(cost, { n: 99 }).map((x) => x.inputId);
    assert.ok(!picked.some((id) => id.startsWith('cancel:') || id.startsWith('price:') || id.includes('qualification')));
    assert.equal(picked.length, 4);
  });
  it('uses opaque keys and generic questions: nothing from the dataset appears in what the agent sees', () => {
    assert.deepEqual(t.map((x) => x.key), ['T1', 'T2', 'T3', 'T4']);
    for (const x of t) assert.deepEqual(findLeaks(`${x.label} ${x.question} ${x.currentNote}`, ids), [], x.key);
    assert.match(t[0]!.question, /7075-series aluminum alloy part weighing about 0.41 kg/);
  });
  it('states the current value as quantiles', () => {
    const c = t[0]!.current as { p10: number; p50: number; p90: number };
    assert.ok(c.p10 < c.p50 && c.p50 < c.p90);
  });
  it('respects n and is a pure function of the result', () => {
    assert.equal(pickTargets(cost, { n: 1 }).length, 1);
    assert.deepEqual(pickTargets(cost, { n: 4 }), pickTargets(cost, { n: 4 }));
  });
  it('measures a candidate the top-8 drivers lack by re-running the check, and ranks it by that swing', () => {
    const noDrivers: CostCheckResult = { ...cost, drivers: [] };
    const rerun = (id: string, dist: Dist, q: number) => {
      const probe = costCheck(bowman, ecr, { seed: 'norn-seed-1', draws: 1000, maxDraws: 1000, assumptions: [{ id, source: 'agent_estimated', rationale: 'probe', dist: point(quantileOf(dist, q)) }] });
      return probe.headline.windowTotal.point;
    };
    const t2 = pickTargets(noDrivers, { n: 1, rerun });
    assert.equal(t2[0]!.swingBasis, 'rerun');
    assert.ok(t2[0]!.swing! > 1000 && t2[0]!.swing! < 2000);
  });
  it('rewords a blank row\'s label without serials or parentheses', () => {
    assert.equal(genericLabel('Delay cost of holding S/N 011-014 at the controller-install station'), 'Delay cost of holding at the controller-install station');
    assert.equal(genericLabel('NC programming (Halden)'), 'NC programming');
  });
});
