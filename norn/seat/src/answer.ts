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
const ZERO = /\b(?:none|zero|no cost|not needed|n\/a|nothing|no work)\b/i;
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
    if (ps.length === 0 && ZERO.test(text)) return { ok: true, value: 0, dist: point(0), quote: text.trim() };
    return { ok: false, reason: ps.length === 0 ? 'no percentage in the reply' : 'more than one percentage, and not a clear range' };
  }
  const ms = [...text.matchAll(MONEY)];
  if (ms.length === 1) {
    const v = money(ms[0]);
    if (!(v >= 0)) return { ok: false, reason: 'the figure must not be negative' };
    return { ok: true, value: v, dist: v === 0 ? point(0) : lognormal(v, ESTIMATE_SPREAD), quote: sentenceAround(text, ms[0].index!) };
  }
  if (ms.length === 2 && RANGE_JOIN.test(text.slice(ms[0].index! + ms[0][0].length, ms[1].index!))) {
    const lo = money(ms[0]), hi = money(ms[1]);
    if (!(lo > 0 && hi > lo)) return { ok: false, reason: 'the range must be two dollar figures, low then high' };
    return { ok: true, value: Math.sqrt(lo * hi), low: lo, high: hi, dist: lognormalFromQuantiles(lo, Math.sqrt(lo * hi), hi), quote: sentenceAround(text, ms[0].index!) };
  }
  if (ms.length === 0 && ZERO.test(text)) return { ok: true, value: 0, dist: point(0), quote: text.trim() };
  return { ok: false, reason: ms.length === 0 ? 'no dollar figure in the reply' : 'more than one dollar figure, and not a clear range' };
}
