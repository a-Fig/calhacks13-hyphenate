// The Monte Carlo engine. A forecast is a set of expressions over named uncertain inputs; each
// expression is a sum of terms, coefficient times a product of inputs. Inputs are drawn once per
// run and shared by every expression, so base, head and any line item see the same draws.
//
// Correlation (docs/IN-PRACTICE.md §8, recommendation 7): inputs in the same group (same
// supplier, same material, shared labour) are correlated 0.3, inputs in no common group are
// independent. One shared normal factor per group carries the correlation: an input in k groups
// gets sqrt(rho) of each group's factor plus sqrt(1 - k rho) of its own noise.

import { normals } from './random.ts';
import { type Dist, isFixed, pointOf, quantileOf, sampler } from './dist.ts';

export interface Variable {
  id: string;
  dist: Dist;
  /** Correlation groups, e.g. 'supplier:SUP-X', 'labor:internal'. At most three. */
  groups: string[];
}

/** coef * product of the named inputs. No inputs means a constant. */
export interface Term {
  coef: number;
  vars: string[];
}
export type Expr = Term[];

export const constant = (c: number): Expr => (c === 0 ? [] : [{ coef: c, vars: [] }]);
export const scale = (e: Expr, k: number): Expr => (k === 0 ? [] : e.map((t) => ({ coef: t.coef * k, vars: t.vars })));
export const sum = (...es: Expr[]): Expr => es.flat();
export const negate = (e: Expr): Expr => scale(e, -1);

/** The ids an expression reads, in first-use order. */
export function varsOf(e: Expr): string[] {
  const seen = new Set<string>();
  for (const t of e) for (const v of t.vars) seen.add(v);
  return [...seen];
}

export interface Draws {
  n: number;
  seed: string;
  values: Map<string, Float64Array>;
}

/** Draw every variable n times under one seed. */
export function drawAll(vars: Variable[], seed: string, n: number, rho = 0.3): Draws {
  const factors = new Map<string, Float64Array>();
  const factor = (g: string) => {
    let f = factors.get(g);
    if (!f) {
      f = normals(seed, `group:${g}`, n);
      factors.set(g, f);
    }
    return f;
  };
  const values = new Map<string, Float64Array>();
  for (const v of vars) {
    if (values.has(v.id)) throw new Error(`variable ${v.id} defined twice`);
    const out = new Float64Array(n);
    if (isFixed(v.dist)) {
      out.fill(pointOf(v.dist));
      values.set(v.id, out);
      continue;
    }
    const groups = [...new Set(v.groups)];
    const own = 1 - groups.length * rho;
    if (own < 0) throw new Error(`variable ${v.id} is in ${groups.length} groups; at rho ${rho} the most is ${Math.floor(1 / rho)}`);
    const e = normals(seed, `var:${v.id}`, n);
    const fs = groups.map(factor);
    const a = Math.sqrt(rho);
    const b = Math.sqrt(own);
    const f = sampler(v.dist);
    for (let i = 0; i < n; i++) {
      let z = b * e[i];
      for (const g of fs) z += a * g[i];
      out[i] = f(z);
    }
    values.set(v.id, out);
  }
  return { n, seed, values };
}

/** Evaluate an expression on every draw. */
export function evaluate(e: Expr, d: Draws): Float64Array {
  const out = new Float64Array(d.n);
  for (const t of e) {
    if (t.coef === 0) continue;
    const arrays = t.vars.map((v) => {
      const a = d.values.get(v);
      if (!a) throw new Error(`expression reads ${v}, which was never drawn`);
      return a;
    });
    if (arrays.length === 0) {
      for (let i = 0; i < d.n; i++) out[i] += t.coef;
    } else if (arrays.length === 1) {
      const a = arrays[0];
      for (let i = 0; i < d.n; i++) out[i] += t.coef * a[i];
    } else {
      for (let i = 0; i < d.n; i++) {
        let p = t.coef;
        for (const a of arrays) p *= a[i];
        out[i] += p;
      }
    }
  }
  return out;
}

/** Evaluate an expression at one assignment of values. */
export function evaluateAt(e: Expr, value: (id: string) => number): number {
  let s = 0;
  for (const t of e) {
    let p = t.coef;
    for (const v of t.vars) p *= value(v);
    s += p;
  }
  return s;
}

/** Type-7 quantile of sorted data (linear interpolation), as in the skeleton worker. */
export function quantileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Summary {
  p10: number;
  p50: number;
  p80: number;
  p90: number;
  mean: number;
}

export function summarize(samples: Float64Array): Summary {
  const s = Float64Array.from(samples).sort();
  let total = 0;
  for (const x of s) total += x;
  return {
    p10: quantileSorted(s, 0.1),
    p50: quantileSorted(s, 0.5),
    p80: quantileSorted(s, 0.8),
    p90: quantileSorted(s, 0.9),
    mean: s.length ? total / s.length : 0,
  };
}

/**
 * The percentiles of a change between two forecasts on the same draws: the per-draw difference,
 * never p50(head) - p50(base) (ARCHITECTURE.md §5).
 */
export function pairedDelta(head: Float64Array, base: Float64Array): Summary {
  if (head.length !== base.length) throw new Error('paired delta needs the same number of draws on both sides');
  const d = new Float64Array(head.length);
  for (let i = 0; i < d.length; i++) d[i] = head[i] - base[i];
  return summarize(d);
}

/** Value of one variable at a probability, the others untouched: for one-at-a-time swings. */
export function quantileOfVariable(v: Variable, p: number): number {
  return quantileOf(v.dist, p);
}
