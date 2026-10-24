// Shared statistics for the screens: a curve fitted through the three quantiles the checks give,
// and the ICD 203 likelihood words. Pure, no mock data in here.
import type { LikelihoodWord } from './types.ts';

export const Z90 = 1.2815515655446004; // standard normal 90th percentile

/** Standard normal quantile (Acklam's rational approximation, relative error about 1e-9). */
export function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -invNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Standard normal CDF (Abramowitz and Stegun 26.2.17). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export interface Fit {
  quantile: (p: number) => number;
  cdf: (x: number) => number;
}

/**
 * A smooth distribution through P10, P50 and P90, two-piece lognormal like the checks use for
 * costs (a negative one mirrored), or two-piece normal when the three straddle zero. It is a fit to
 * three numbers, not the checks' draws, and the charts say so.
 */
export function fitQuantiles(p10: number, p50: number, p90: number): Fit {
  const lognormalOk = p10 * p50 > 0 && p90 * p50 > 0;
  if (lognormalOk) {
    const sign = p50 < 0 ? -1 : 1;
    const [a, m, b] = [p10 * sign, p50 * sign, p90 * sign].sort((x, y) => x - y);
    const sLow = Math.max(1e-9, Math.log(m / a) / Z90);
    const sHigh = Math.max(1e-9, Math.log(b / m) / Z90);
    const quantile = (p: number) => {
      const z = invNorm(p);
      return sign * m * Math.exp((z < 0 ? sLow : sHigh) * z) * 1;
    };
    // For a negative quantity the order flips: its P10 is the most negative.
    const q = sign === 1 ? quantile : (p: number) => -(m * Math.exp((invNorm(1 - p) < 0 ? sLow : sHigh) * invNorm(1 - p)));
    const cdf = (x: number) => {
      const y = sign * x;
      if (y <= 0) return sign === 1 ? 0 : 1;
      const z = Math.log(y / m) / (Math.log(y / m) < 0 ? sLow : sHigh);
      return sign === 1 ? normCdf(z) : 1 - normCdf(z);
    };
    return { quantile: q, cdf };
  }
  const sLow = Math.max(1e-9, (p50 - p10) / Z90);
  const sHigh = Math.max(1e-9, (p90 - p50) / Z90);
  return {
    quantile: p => {
      const z = invNorm(p);
      return p50 + (z < 0 ? sLow : sHigh) * z;
    },
    cdf: x => normCdf((x - p50) / (x < p50 ? sLow : sHigh)),
  };
}

/** ICD 203 words by probability (docs/GLOSSARY.md). */
export function likelihoodWord(p: number): LikelihoodWord {
  if (p < 0.05) return 'almost no chance';
  if (p < 0.2) return 'very unlikely';
  if (p < 0.45) return 'unlikely';
  if (p < 0.55) return 'roughly even';
  if (p < 0.8) return 'likely';
  if (p < 0.95) return 'very likely';
  return 'almost certain';
}
