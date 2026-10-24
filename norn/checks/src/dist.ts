// Distributions for uncertain inputs, following docs/IN-PRACTICE.md §8 (recommendation 6): a
// lognormal for open-ended costs and lead times, PERT or triangular for bounded ones, and a stated
// p10/p90 read as quantiles, never as bounds. Each distribution maps a standard normal draw to a
// value, so correlation can be set on the normals (a Gaussian copula) whatever the shape.

import { invNorm, normCdf } from './random.ts';

export const Z90 = 1.2815515655446004; // standard normal 90th percentile

export type Dist =
  /** A fixed value: a given fact, or a default with no spread. */
  | { kind: 'point'; value: number }
  /**
   * Two-piece lognormal around `median`, with its own log-space spread below and above the median,
   * so a stated p10 / p50 / p90 is met exactly. A negative median mirrors it (a saving).
   */
  | { kind: 'lognormal'; median: number; sigmaLow: number; sigmaHigh: number }
  /** BetaPERT on [min, max] with the given mode. */
  | { kind: 'pert'; min: number; mode: number; max: number }
  | { kind: 'triangular'; min: number; mode: number; max: number };

export const point = (value: number): Dist => ({ kind: 'point', value });

/** Lognormal with one log-space spread (Joint Agency handbook Table 2-9 uses 0.15 to 0.45). */
export const lognormal = (median: number, sigma: number): Dist => ({ kind: 'lognormal', median, sigmaLow: sigma, sigmaHigh: sigma });

/** Lognormal through a stated p10, p50 and p90 (all of one sign, p10 <= p50 <= p90). */
export function lognormalFromQuantiles(p10: number, p50: number, p90: number): Dist {
  if (p50 === 0) return point(0);
  if (!(p10 <= p50 && p50 <= p90 && p10 * p50 > 0 && p90 * p50 > 0)) {
    throw new Error(`lognormal needs p10 <= p50 <= p90, all of one sign, got ${p10}, ${p50}, ${p90}`);
  }
  // sigmaLow shapes the side below the median, sigmaHigh the side above, for either sign.
  return { kind: 'lognormal', median: p50, sigmaLow: Math.abs(Math.log(p10 / p50)) / Z90, sigmaHigh: Math.abs(Math.log(p90 / p50)) / Z90 };
}

export const pert = (min: number, mode: number, max: number): Dist => ({ kind: 'pert', min, mode, max });
export const triangular = (min: number, mode: number, max: number): Dist => ({ kind: 'triangular', min, mode, max });

/** The value used for the point estimate: the stated value (median of a lognormal, mode of a PERT). */
export function pointOf(d: Dist): number {
  switch (d.kind) {
    case 'point':
      return d.value;
    case 'lognormal':
      return d.median;
    case 'pert':
    case 'triangular':
      return d.mode;
  }
}

export function isFixed(d: Dist): boolean {
  if (d.kind === 'point') return true;
  if (d.kind === 'lognormal') return d.median === 0 || (d.sigmaLow === 0 && d.sigmaHigh === 0);
  return d.min === d.max;
}

function validate(d: Dist): void {
  const bad = (m: string) => {
    throw new Error(`invalid ${d.kind} distribution: ${m} (${JSON.stringify(d)})`);
  };
  const finite = Object.values(d).every((v) => typeof v === 'string' || Number.isFinite(v));
  if (!finite) bad('non-finite parameter');
  if (d.kind === 'lognormal' && (d.sigmaLow < 0 || d.sigmaHigh < 0)) bad('negative spread');
  if ((d.kind === 'pert' || d.kind === 'triangular') && !(d.min <= d.mode && d.mode <= d.max)) bad('needs min <= mode <= max');
}

// ---------------------------------------------------------------- the beta function, for PERT

function lgamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

const TABLE = 2048;
const pertTables = new Map<string, Float64Array>();

/** Inverse CDF of Beta(a, b) on a fixed grid of probabilities, by bisection. Cached per shape. */
function betaInverseTable(a: number, b: number): Float64Array {
  const key = `${a}|${b}`;
  const hit = pertTables.get(key);
  if (hit) return hit;
  const t = new Float64Array(TABLE + 1);
  t[0] = 0;
  t[TABLE] = 1;
  for (let i = 1; i < TABLE; i++) {
    const p = i / TABLE;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (betaCdf(mid, a, b) < p) lo = mid;
      else hi = mid;
    }
    t[i] = (lo + hi) / 2;
  }
  pertTables.set(key, t);
  return t;
}

function pertShape(d: { min: number; mode: number; max: number }): [number, number] {
  const r = d.max - d.min;
  return [1 + (4 * (d.mode - d.min)) / r, 1 + (4 * (d.max - d.mode)) / r];
}

/** Quantile function: the value at probability p. */
export function quantileOf(d: Dist, p: number): number {
  validate(d);
  switch (d.kind) {
    case 'point':
      return d.value;
    case 'lognormal':
      return fromNormal(d, invNorm(p));
    case 'triangular': {
      const { min: a, mode: c, max: b } = d;
      if (a === b) return a;
      const fc = (c - a) / (b - a);
      return p < fc ? a + Math.sqrt(p * (b - a) * (c - a)) : b - Math.sqrt((1 - p) * (b - a) * (b - c));
    }
    case 'pert': {
      if (d.min === d.max) return d.min;
      const [a, b] = pertShape(d);
      const t = betaInverseTable(a, b);
      const pos = p * TABLE;
      const i = Math.min(TABLE - 1, Math.floor(pos));
      const f = pos - i;
      return d.min + (d.max - d.min) * (t[i] + (t[i + 1] - t[i]) * f);
    }
  }
}

/** Map one standard normal draw to a value of the distribution. Increasing in z for every shape. */
export function fromNormal(d: Dist, z: number): number {
  switch (d.kind) {
    case 'point':
      return d.value;
    case 'lognormal': {
      // For a negative median the magnitude shrinks as z grows, so the value still increases.
      const s = z < 0 ? d.sigmaLow : d.sigmaHigh;
      return d.median * Math.exp(Math.sign(d.median) * s * z);
    }
    case 'triangular':
    case 'pert':
      return quantileOf(d, normCdf(z));
  }
}

/** Prepare a distribution for many draws: validates once and returns a fast z -> value map. */
export function sampler(d: Dist): (z: number) => number {
  validate(d);
  if (d.kind === 'pert' && d.min !== d.max) {
    const [a, b] = pertShape(d);
    const t = betaInverseTable(a, b);
    const { min, max } = d;
    return (z) => {
      const pos = normCdf(z) * TABLE;
      const i = Math.min(TABLE - 1, Math.floor(pos));
      const f = pos - i;
      return min + (max - min) * (t[i] + (t[i + 1] - t[i]) * f);
    };
  }
  return (z) => fromNormal(d, z);
}
