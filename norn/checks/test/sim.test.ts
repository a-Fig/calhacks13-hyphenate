import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lognormal, lognormalFromQuantiles, pert, point, quantileOf, triangular } from '../src/dist.ts';
import { invNorm, normals } from '../src/random.ts';
import { drawAll, evaluate, pairedDelta, quantileSorted, summarize } from '../src/sim.ts';

const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);

function pearson(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] / n;
    mb += b[i] / n;
  }
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

test('a lognormal through stated p10, p50 and p90 meets all three, for a cost and for a saving', () => {
  const d = lognormalFromQuantiles(212, 221, 236);
  close(quantileOf(d, 0.1), 212, 1e-6, 'p10');
  close(quantileOf(d, 0.5), 221, 1e-9, 'p50');
  close(quantileOf(d, 0.9), 236, 1e-6, 'p90');
  const s = lognormalFromQuantiles(-15, -11.4, -9);
  close(quantileOf(s, 0.1), -15, 1e-6, 'saving p10');
  close(quantileOf(s, 0.9), -9, 1e-6, 'saving p90');
});

test('PERT and triangular stay inside their bounds and peak at the mode', () => {
  for (const d of [pert(0, 0.0153, 0.05), triangular(0, 0.0153, 0.05)]) {
    const q = [0.001, 0.1, 0.5, 0.9, 0.999].map((p) => quantileOf(d, p));
    assert.ok(q.every((x) => x >= 0 && x <= 0.05), `${d.kind} in bounds: ${q}`);
    assert.ok(q.every((x, i) => i === 0 || x >= q[i - 1]), `${d.kind} increasing`);
  }
  // PERT mean is (min + 4 mode + max) / 6.
  const v = { id: 'r', dist: pert(0, 0.0153, 0.05), groups: [] };
  const m = summarize(drawAll([v], 's', 20000).values.get('r')!).mean;
  close(m, (0 + 4 * 0.0153 + 0.05) / 6, 3e-4, 'PERT mean');
});

test('draws are a function of the seed and the input\'s own id only', () => {
  const a = { id: 'price:A', dist: lognormal(1, 0.1), groups: ['supplier:S'] };
  const b = { id: 'price:B', dist: lognormal(1, 0.1), groups: ['supplier:S'] };
  const c = { id: 'cost:C', dist: lognormal(1000, 0.2), groups: ['labor:internal'] };
  const one = drawAll([a, b], 'seed-1', 1000).values.get('price:A')!;
  const two = drawAll([c, b, a], 'seed-1', 1000).values.get('price:A')!;
  assert.deepEqual([...one], [...two], 'adding or reordering other inputs leaves price:A unchanged');
  const other = drawAll([a], 'seed-2', 1000).values.get('price:A')!;
  assert.notDeepEqual([...one], [...other], 'another seed gives other draws');
});

test('inputs in one group correlate about 0.3, inputs in no common group are independent', () => {
  const vars = [
    { id: 'a', dist: lognormal(1, 0.05), groups: ['supplier:S'] },
    { id: 'b', dist: lognormal(1, 0.05), groups: ['supplier:S'] },
    { id: 'c', dist: lognormal(1, 0.05), groups: ['supplier:T'] },
  ];
  const d = drawAll(vars, 'corr', 40000, 0.3);
  close(pearson(d.values.get('a')!, d.values.get('b')!), 0.3, 0.02, 'same supplier');
  close(pearson(d.values.get('a')!, d.values.get('c')!), 0, 0.02, 'different suppliers');
  assert.throws(() => drawAll([{ id: 'x', dist: lognormal(1, 0.1), groups: ['g1', 'g2', 'g3', 'g4'] }], 's', 10), /groups/);
});

test('a paired delta is the percentiles of the per-draw difference, not the difference of percentiles', () => {
  const vars = [
    { id: 'x', dist: lognormal(100, 0.6), groups: [] },
    { id: 'y', dist: lognormal(50, 1.0), groups: [] },
  ];
  const d = drawAll(vars, 'paired', 20000);
  const base = evaluate([{ coef: 1, vars: ['x'] }], d);
  const head = evaluate([{ coef: 1, vars: ['x'] }, { coef: 1, vars: ['y'] }], d);
  const delta = pairedDelta(head, base);
  const y = summarize(evaluate([{ coef: 1, vars: ['y'] }], d));
  close(delta.p50, y.p50, 1e-9, 'delta is exactly the added term, draw by draw');
  const naive = summarize(head).p50 - summarize(base).p50;
  assert.ok(Math.abs(naive - delta.p50) > 10, `p50(head) - p50(base) = ${naive.toFixed(1)} differs from the paired p50 ${delta.p50.toFixed(1)}`);
  const sorted = Float64Array.from(head.map((h, i) => h - base[i])).sort();
  close(delta.p90, quantileSorted(sorted, 0.9), 1e-9, 'p90 of the differences');
});

test('a fixed input takes no draws', () => {
  const d = drawAll([{ id: 'p', dist: point(18.64), groups: ['supplier:S'] }], 's', 5);
  assert.deepEqual([...d.values.get('p')!], [18.64, 18.64, 18.64, 18.64, 18.64]);
});

test('each input\'s draws are Latin hypercube sampled: one in each of n equal-probability strata', () => {
  const n = 1000;
  const z = [...normals('s', 'price:X', n)].sort((a, b) => a - b);
  for (let k = 1; k < n - 1; k++) {
    assert.ok(z[k] >= invNorm(k / n) - 1e-9 && z[k] <= invNorm((k + 1) / n) + 1e-9, `draw ${k} is in stratum ${k}`);
  }
  assert.notDeepEqual([...normals('s', 'price:X', 50)], [...normals('s', 'price:X', 50)].sort((a, b) => a - b), 'in a shuffled order, not sorted');
});

test('a run with more draws starts with the same draws: runs of different lengths are paired on the draws they share', () => {
  const vars = [
    { id: 'a', dist: lognormal(100, 0.2), groups: ['supplier:S'] },
    { id: 'b', dist: pert(0, 0.1, 0.5), groups: ['supplier:S', 'labor:internal'] },
  ];
  const short = drawAll(vars, 's', 1000, 0.3, 1000);
  const long = drawAll(vars, 's', 4000, 0.3, 1000);
  for (const id of ['a', 'b']) {
    assert.deepEqual([...long.values.get(id)!.subarray(0, 1000)], [...short.values.get(id)!], id);
  }
  const z = [...normals('s', 'price:X', 3000, 1000).subarray(1000, 2000)].sort((x, y) => x - y);
  for (let k = 1; k < 999; k++) assert.ok(z[k] >= invNorm(k / 1000) - 1e-9 && z[k] <= invNorm((k + 1) / 1000) + 1e-9, `block 2, draw ${k}`);
});
