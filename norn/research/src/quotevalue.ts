// Does the quote state the number that was proposed? A quote can be on the page and say nothing
// about the amount the agent proposes (a recycler's price per pound under a $400,000 estimate).
// This reads the figures in the quote, with their unit and scale, and compares them with the
// proposed value. Pure.

import type { Unit } from './types.ts';
import { stripInvisible } from './text.ts';

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

// A number: optional currency sign, digits with optional thousands commas, optional decimals.
// Not preceded by a digit, a point or a comma (so the tail of a longer number is not read as one).
const NUMBER = /(?<![\d.,])(\p{Sc}\s?|usd\s?|us\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/giu;

/**
 * The values a quote states, in the unit asked for:
 * - usd: a figure with a currency sign or "USD"/"dollars", times its scale (k, thousand, million,
 *   billion); "cents" divided by 100;
 * - fraction: a figure followed by % or "percent", divided by 100; or a plain decimal from 0 to 1;
 * - weeks: a figure followed by weeks, days (/7), months (x 52/12) or years (x 52).
 * A figure whose unit is not there states nothing, so "75 per lb" is not a number of dollars.
 */
export function quotedValues(quote: string, unit: Unit): number[] {
  const text = stripInvisible(quote).toLowerCase();
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const base = Number(`${m[2]!.replace(/,/g, '')}${m[3] ?? ''}`);
    if (!Number.isFinite(base)) continue;
    const before = m[1];
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const word = /^\s?([a-z%¢]+|%)/.exec(rest)?.[1];
    if (unit === 'usd') {
      const scale = word !== undefined && word in SCALE ? SCALE[word]! : 1;
      const currencyAfter = word === 'usd' || word === 'dollar' || word === 'dollars';
      if (word === 'cent' || word === 'cents' || word === '¢') out.push(base / 100);
      else if (before !== undefined) out.push(base * scale);
      else if (currencyAfter) out.push(base);
      else if (scale !== 1 && /^\s?[a-z]+\s+(usd|dollars?)\b/.test(rest)) out.push(base * scale);
    } else if (unit === 'fraction') {
      if (word === '%' || word === 'percent') out.push(base / 100);
      else if (before === undefined && base <= 1 && (word === undefined || !/^(percent|%|per)/.test(word))) out.push(base);
    } else {
      if (word === 'week' || word === 'weeks' || word === 'wk' || word === 'wks') out.push(base);
      else if (word === 'day' || word === 'days') out.push(base / 7);
      else if (word === 'month' || word === 'months') out.push((base * 52) / 12);
      else if (word === 'year' || word === 'years') out.push(base * 52);
    }
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 + 1e-6 * Math.abs(b);

/** True when one of the values the quote states equals `value`. */
export function quoteStates(quote: string, value: number, unit: Unit): boolean {
  return quotedValues(quote, unit).some((v) => close(v, value));
}
