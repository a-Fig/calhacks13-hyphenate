// Dummy compute for the skeleton. Every number from here is MOCK: it exercises the pipeline
// (claims, leases, streaming progress, results) and says nothing about a real aircraft.
// Output is deterministic in the run's input hash, as ARCHITECTURE.md section 8 requires.

export function seedFrom(hash: string): number {
  return Number.parseInt(hash.slice(0, 8), 16) >>> 0;
}

/** mulberry32: a small seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function quantile(sorted: Float64Array | number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export const PERCENTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

/** A dummy "cost at risk per unit" draw: a lognormal base plus rare disruption jumps. */
export function drawCostAtRisk(rand: () => number): number {
  const base = Math.exp(Math.log(1200) + 0.18 * normal(rand));
  const disrupted = rand() < 0.07 ? 400 + 600 * rand() : 0;
  return base + disrupted;
}

export function histogram(sorted: Float64Array, bins: number, lo: number, hi: number): number[] {
  const out = new Array<number>(bins).fill(0);
  const w = (hi - lo) / bins;
  for (const x of sorted) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)));
    out[i]!++;
  }
  return out;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
