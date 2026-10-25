// Reading a person's reply into a number the checks can use. Deterministic on purpose: a reply with
// one clear figure, a range or an explicit zero is recorded; anything else gets a follow-up question,
// so the seat never guesses what someone meant.
import { lognormal, lognormalFromQuantiles, pert, point, type Dist } from '../../checks/src/dist.ts';
import type { AskRule } from './types.ts';

export type Parsed =
  | { ok: true; dist: Dist; value: number; low?: number; high?: number; quote: string }
  | { ok: false; reason: string };

const MONEY = /(?:\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?(?![\w%])|(\d[\d,]*(?:\.\d+)?)\s?([kKmM])(?![\w%])|(\d[\d,]*(?:\.\d+)?)\s?(?:USD|dollars)\b)/g;
const PERCENT = /(\d+(?:\.\d+)?)\s?(?:%|percent\b)/g;
const ZERO = /\b(?:none(?! of)|zero|no cost(?!\s+(?:estimate|figure|quote|number|data|info))|not needed|n\/a|nothing|no work)\b/i;
/** Words that say the figure is not known yet. They beat a zero word: "no cost estimate yet" is not $0. */
const UNKNOWN = /\b(?:yet|tbd|tba|to be determined|unknown|unsure|not sure|(?:don'?t|do not|doesn'?t|does not) (?:know|have)|dunno|no (?:idea|clue|estimate|figure|number|quote|answer|info)|not available|pending|waiting|(?:have|need) to (?:check|ask|find out)|can'?t say|haven'?t (?:got|had|heard|received))\b/i;
const isExplicitZero = (text: string) => ZERO.test(text) && !UNKNOWN.test(text);
const RANGE_JOIN = /^\s*(?:to|-|–|and|or)\s*$/i;

/** A single person's estimate with no range gets the spread Norn uses for an engineer's estimate. */
const ESTIMATE_SPREAD = 0.15;

function money(m: RegExpMatchArray): number {
  const raw = (m[1] ?? m[3] ?? m[5])!.replace(/,/g, '');
  const suf = (m[2] ?? m[4] ?? '').toLowerCase();
  return Number(raw) * (suf === 'k' ? 1e3 : suf === 'm' ? 1e6 : 1);
}

/** The sentence a figure came from, so the recorded rationale quotes the person exactly. */
function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('\n', at - 1)) + 1;
  const endDot = text.indexOf('.', at);
  const end = endDot < 0 ? text.length : endDot + 1;
  return text.slice(start, end).trim();
}

// A dollar range: "$3,000 to 5,000", "3,000-5,000", "$3k–$5k", "between 3000 and 5000". Each end may carry its own $ or k/m.
const AMT = String.raw`(\$\s?)?(\d[\d,]*(?:\.\d+)?)\s?([kKmM](?![a-zA-Z]))?`;
const NOT_A_UNIT = String.raw`(?![\w%])(?!\s?(?:days?|weeks?|hours?|hrs?|months?|years?|units?|pieces?|pcs|each|ea|percent)\b)`;
const RANGE = new RegExp(String.raw`${AMT}\s*(?:\bto\b|\bthrough\b|\band\b|\bor\b|-|–|—)\s*${AMT}${NOT_A_UNIT}`, 'gi');

interface Span { index: number; end: number; lo: number; hi: number; marked: boolean }

function moneyRanges(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(RANGE)) {
    const [, d1, n1, k1, d2, n2, k2] = m;
    const c1 = n1.replace(/,/g, ''), c2 = n2.replace(/,/g, '');
    const x = Number(c1), y = Number(c2);
    const mult = (k: string | undefined) => { const c = (k ?? '').toLowerCase(); return c === 'k' ? 1e3 : c === 'm' ? 1e6 : 1; };
    // "$3 to 5k" and "3-5k" share the suffix; "$3,000 to 5k" does not.
    const k = k1 ?? (k2 && x < y ? k2 : undefined);
    const marked = Boolean(d1 || d2 || k1 || k2);
    // Bare numbers are a range of money only when both are plain amounts of three digits or more ("S/N 001-010" is not).
    if (!marked && !(/^[1-9]/.test(c1) && /^[1-9]/.test(c2) && c1.length >= 3 && c2.length >= 3)) continue;
    out.push({ index: m.index!, end: m.index! + m[0].length, lo: x * mult(k), hi: y * mult(k2), marked });
  }
  return out;
}

export function parseReply(text: string, unit: AskRule['unit']): Parsed {
  if (unit === 'share') {
    const ps = [...text.matchAll(PERCENT)];
    if (ps.length === 1) {
      const v = Number(ps[0][1]) / 100;
      if (!(v >= 0 && v <= 1)) return { ok: false, reason: 'a share must be between 0% and 100%' };
      return { ok: true, value: v, dist: v === 0 ? point(0) : pert(Math.max(0, v * 0.7), v, Math.min(1, v * 1.3)), quote: sentenceAround(text, ps[0].index!) };
    }
    if (ps.length === 2 && RANGE_JOIN.test(text.slice(ps[0].index! + ps[0][0].length, ps[1].index!))) {
      const lo = Number(ps[0][1]) / 100, hi = Number(ps[1][1]) / 100;
      if (!(lo >= 0 && hi <= 1 && lo < hi)) return { ok: false, reason: 'the range must be two shares, low then high' };
      return { ok: true, value: (lo + hi) / 2, low: lo, high: hi, dist: pert(lo, (lo + hi) / 2, hi), quote: sentenceAround(text, ps[0].index!) };
    }
    if (ps.length === 0 && isExplicitZero(text)) return { ok: true, value: 0, dist: point(0), quote: text.trim() };
    return { ok: false, reason: ps.length === 0 ? 'no percentage in the reply' : 'more than one percentage, and not a clear range' };
  }
  const ms = [...text.matchAll(MONEY)];
  // A range first, so both ends are kept. A bare range ("3,000-5,000") counts only when no other figure is in the reply.
  const ranges = moneyRanges(text).filter((r) => r.marked || ms.length === 0);
  if (ranges.length === 1) {
    const r = ranges[0];
    if (ms.some((m) => m.index! < r.index || m.index! >= r.end)) return { ok: false, reason: 'more than one dollar figure, and not a clear range' };
    if (!(r.lo > 0 && r.hi > r.lo)) return { ok: false, reason: 'the range must be two dollar figures, low then high' };
    const mid = Math.sqrt(r.lo * r.hi);
    return { ok: true, value: mid, low: r.lo, high: r.hi, dist: lognormalFromQuantiles(r.lo, mid, r.hi), quote: sentenceAround(text, r.index) };
  }
  if (ms.length === 1) {
    const v = money(ms[0]);
    if (!(v >= 0)) return { ok: false, reason: 'the figure must not be negative' };
    return { ok: true, value: v, dist: v === 0 ? point(0) : lognormal(v, ESTIMATE_SPREAD), quote: sentenceAround(text, ms[0].index!) };
  }
  if (ms.length === 0 && isExplicitZero(text)) return { ok: true, value: 0, dist: point(0), quote: text.trim() };
  if (ms.length === 0 && UNKNOWN.test(text)) return { ok: false, reason: 'the reply says the figure is not known yet' };
  return { ok: false, reason: ms.length === 0 ? 'no dollar figure in the reply' : 'more than one dollar figure, and not a clear range' };
}
