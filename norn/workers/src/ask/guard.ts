// The guardrail: before an answer is shown, every number in it must be found in the stored data it
// points to. Code computes and agents explain, so a number the agent made up or worked out itself is
// marked "not found in Norn's data" rather than passed on.
//
// How a number is tied to its source. The agent writes a marker such as [c1] right after each number,
// and lists the citations the markers name ({ id: "c1", refId, value }). A number is checked against
// the stored value of the citation named by its own marker, and against nothing else. A number with
// no marker, or a marker that names no usable citation, is not verified. Wording around the number
// and the labels the agent chooses play no part. Markers are removed from the text that is shown.
//
// How a number is read. It is read the way a person would read it: "$148k" is 148,000 to the nearest
// thousand, "nine million dollars" is 9,000,000, "USD999999" is 999,999, ".1%" is a tenth of a
// percent, "+$9.20" and "$9.20 higher" are increases and "saves $9.20" is a decrease. It counts as
// found when a cited value rounds to it at the precision shown. So "$148k" does not match 147,000,
// "$2 billion" does not match 2, and a stated increase does not match a stored decrease. Anything that
// looks numeric but cannot be read as a quantity ("1.2.3", "ABC999999", "1,2,3", full-width digits)
// is never verified; it is not skipped.
import type { AgentAnswer, AskCitation, AskSegment } from './protocol.ts';

export interface ToolResultText {
  tool: string;
  /** The tool result's text, normally JSON. */
  content: string;
}

export interface GuardResult {
  /** The answer as shown: the agent's text with its [c1] markers removed. */
  text: string;
  segments: AskSegment[];
  unverifiedNumbers: string[];
  citations: AskCitation[];
  /** A cited value is, or sits inside, a result that says mock: true. */
  mock: boolean;
}

export interface Found {
  start: number;
  /** End of the number and its magnitude or percent suffix (what is shown as the number). */
  end: number;
  /** End including a currency word ("dollars"); a citation marker must follow this. */
  reach: number;
  text: string;
  /** False when the text looks numeric but cannot be read as a quantity. Never verified. */
  parsed: boolean;
  /** The number as written, with its suffix applied (k, M, million, cents), always >= 0. */
  nominal: number;
  /** Half a unit of the last digit shown, in the same scale. */
  tolerance: number;
  percent: boolean;
  /** -1 when the text says the number is negative (a minus, a saving, a reduction), +1 for an explicit plus or an increase, 0 when it doesn't say. */
  sign: -1 | 0 | 1;
  /** A small count written as a plain word ("three", "three-way"). Left unmarked unless a citation marker follows it. */
  count?: boolean;
  /** Digits glued into a word with a hyphen ("12-month", "13-week"). With no marker after them, left unmarked only when some tool result holds the number. */
  glued?: boolean;
}

export interface FindOptions {
  /** Read number words ("nine million"). On for an agent's answer, off for stored data. */
  words?: boolean;
  /**
   * Lower-cased text of everything the session read. When given, a word that holds digits (an id such
   * as BW-5120-210) is an identifier only if it appears there; any other is an unreadable number.
   * When left out, such words are treated as identifiers.
   */
  known?: string;
}

/** A number found in a tool result, with its sign kept and whether it was written as a percent. */
interface Hay {
  v: number;
  percent: boolean;
}

const CODES = 'USD|EUR|GBP|CAD|AUD|JPY|CHF|CNY|INR|MXN';

// Dates, serial numbers and list numbers hold digits that are not quantities: 2026-11-05, 11/05/2026, S/N 011-014, "1. ".
const DATE_OR_SERIAL = /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b|\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)?\d{2}\b|\bS\/N\s*\d+(?:\s*(?:-|to)\s*\d+)?/g;
const LIST_MARKER = /^[ \t]*\d{1,2}[.)][ \t]/gm;
// A word that may hold digits and the ids built from it: ECR-0417, BW-5120-210, cancel:BW-5120-210, s2_cost.one_time_total, P50.
const ID_WORD = /(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*(?:(?:[-:#/]|\.(?=[\p{L}_]))[\p{L}\p{N}_]+)*/gu;
const SHORT_ID = /^(?:p(?:10|50|90)|s[0-5]|q[1-4]|l[1-3])$/i;
const CURRENCY_CODE_NUMBER = new RegExp(`^(?:${CODES})\\d[\\d.,_]*[a-z]{0,2}$`, 'i');
// A run of what looks like a number: digits with . , _ ' inside (or a leading decimal point), or a symbol that is a number (full-width digits, vulgar fractions).
const NUM_RUN = /(?<![\p{L}\p{N}_.])\.\p{Nd}[\p{Nd}.,_'\u2019]*|\p{Nd}[\p{Nd}.,_'\u2019]*|(?![\u00B2\u00B3\u00B9])[\p{No}\p{Nl}]/gu;
const PLAIN = /^\d+(?:\.\d+)?$/;
const LEADING = /^\.\d+$/;
const COMMAS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const GROUPS = /^\d{1,3}(?:[_'\u2019]\d{3})+(?:\.\d+)?$/;
const SPACE_GROUPS = /^(?:[ \u00A0\u202F]\d{3})+(?![\d])(?![.,]\d)/;

const MAGNITUDE_WORD = /^\s?(hundred|thousand|million|billion|trillion|mil|mio|mln|bln|lakh|lac|crore)s?\b/i;
const BASIS_POINTS = /^\s?(?:bps|bp|basis\s+points?)\b/i;
const MAGNITUDE_ATTACHED = /^(bn|mn|MM|[kKmMbB])(?![A-Za-z0-9])/;
const MAGNITUDE_SPACED = /^ (bn|mn|MM|[KkMB])(?![A-Za-z0-9])/;
// After a currency sign an amount followed by a lower-case m or b is millions or billions, not metres or bytes.
const MAGNITUDE_SPACED_MONEY = /^ ([mb])(?![A-Za-z0-9])/;
const PERCENT = /^\s?(?:%|per[\s-]?cent\b|percent(?:age)?\b|pct\b)/i;
const PER_MILLE = /^\s?\u2030/;
const CURRENCY_WORD = /^\s?(?:(dollars?|usd|bucks|euros?|eur|gbp|pounds?|cad|aud)|(cents?))\b/i;
const CURRENCY_BEFORE = new RegExp(`(?:US\\$|[$\u20AC\u00A3\u00A5\u20B9]|\\b(?:${CODES}))\\s?$`, 'i');
const SCALE: Record<string, number> = { hundred: 1e2, lakh: 1e5, lac: 1e5, crore: 1e7, k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, mil: 1e6, mio: 1e6, mln: 1e6, million: 1e6, b: 1e9, bn: 1e9, bln: 1e9, billion: 1e9, trillion: 1e12 };

// Words before a number that give it a direction. "lower than", "more than" compare with a figure and give none.
const THAN = String.raw`(?!\s+than\b)`;
const DIRECTION_BEFORE = new RegExp(
  String.raw`\b(?:(saves?|saving|savings|saved|reduc(?:e|es|ed|ing|tion)|cheaper${THAN}|lower${THAN}|less${THAN}|decreas(?:e|es|ed|ing)|drops?|dropped|cuts?|credit|credits|refund(?:s|ed)?|rebate|discount|minus|negative)|(adds?|added|adding|increas(?:e|es|ed|ing)|raises?|raised|rises?|rose|more${THAN}|higher${THAN}|extra|additional|surcharge|premium|plus|positive|costs|costing|cost\s+of|penalty))\b`,
  'gi'
);
const QUALIFIER = '(?:(?:per|each|a|an|every)\\s+[\\w-]+\\s+)?';
const NEGATIVE_AFTER = new RegExp(`^[\\s,]*${QUALIFIER}(?:less|lower|cheaper|saving|savings|saved|off|down|decrease|reduction|cut|credit|discount)\\b`, 'i');
const POSITIVE_AFTER = new RegExp(`^[\\s,]*${QUALIFIER}(?:more|higher|extra|greater|increase|up|costlier|pricier|dearer)\\b`, 'i');

// A number glued into a word with a hyphen ("12-month", "three-way") is part of that word, not a quantity. Magnitude, percent and currency words are not.
const GLUED = /^-(?!(?:hundred|thousand|million|billion|trillion|mil|mio|mln|bln|lakh|lac|crore|bn|mn|mm|per|percent|pct|dollars?|usd|bucks|euros?|eur|gbp|pounds?|cents?|cad|aud|bps|bp|basis)(?![\p{L}\p{N}]))\p{L}{2,}/iu;

const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const alnum = /[\p{L}\p{N}]/u;

/** Is this id-like word one the session read (or a short form such as P50)? */
function knownId(tok: string, known: string): boolean {
  const t = tok.toLowerCase();
  if (SHORT_ID.test(t)) return true;
  // Also as the agent may write it: with a stage in front (s2_cost.x) or a namespace (in:x, row:x) the result does not carry.
  for (let cand = t; cand; ) {
    if (known.includes(cand)) return true;
    const next = cand.replace(/^s\d_[a-z_]+\./, '').replace(/^[a-z]{1,8}:/, '');
    if (next === cand) break;
    cand = next;
  }
  return false;
}

/** The sign, currency and brackets written in front of a number that starts at `start`. */
function prefixOf(text: string, start: number): { sign: -1 | 0 | 1; paren: boolean; money: boolean } {
  let p = start;
  const take = (re: RegExp) => {
    const m = re.exec(text.slice(0, p));
    if (m) p = m.index;
    return m;
  };
  const takeSign = (): -1 | 0 | 1 => {
    const m = take(/[+\-\u2212]$/);
    if (!m) return 0;
    const ch = m[0];
    if (ch === '+') return 1;
    // A hyphen after a letter or digit is a hyphen or a range (5-7), not a minus.
    if (ch === '-' && m.index > 0 && alnum.test(text[m.index - 1]!)) return 0;
    return -1;
  };
  let sign = takeSign();
  const money = take(CURRENCY_BEFORE) !== null;
  if (!sign) sign = takeSign();
  const paren = take(/\(\s?$/) !== null;
  return { sign, paren, money };
}

/** What is written after a number: magnitude, percent, currency words. */
function suffixOf(text: string, from: number, money = false): { end: number; reach: number; scale: number; percent: boolean; cents: boolean } {
  const rest = text.slice(from);
  let end = from;
  let scale = 1;
  let percent = false;
  let cents = false;
  const w = MAGNITUDE_WORD.exec(rest);
  const a = w ? null : MAGNITUDE_ATTACHED.exec(rest) ?? MAGNITUDE_SPACED.exec(rest) ?? (money ? MAGNITUDE_SPACED_MONEY.exec(rest) : null);
  const mag = w ?? a;
  if (mag) {
    scale = SCALE[mag[1]!.toLowerCase()]!;
    end = from + mag[0].length;
    // "9 hundred thousand": more magnitude words may follow a word
    for (let more = w ? MAGNITUDE_WORD.exec(text.slice(end)) : null; more; more = MAGNITUDE_WORD.exec(text.slice(end))) {
      scale *= SCALE[more[1]!.toLowerCase()]!;
      end += more[0].length;
    }
  } else {
    const p = PERCENT.exec(rest);
    const bp = p ? null : BASIS_POINTS.exec(rest);
    const pm = p || bp ? null : PER_MILLE.exec(rest);
    if (p || bp || pm) {
      percent = true;
      if (bp) scale = 0.01;
      if (pm) scale = 0.1;
      end = from + (p ?? bp ?? pm)![0].length;
    }
  }
  let reach = end;
  if (!percent) {
    const c = CURRENCY_WORD.exec(text.slice(end));
    if (c) {
      cents = c[2] !== undefined;
      reach = end + c[0].length;
    }
  }
  return { end, reach, scale, percent, cents };
}

/** The direction the text gives a number: an explicit sign, then words after it (higher, lower), then words before it (saves, adds). */
function directionOf(text: string, start: number, reach: number, explicit: -1 | 0 | 1, paren: boolean): -1 | 0 | 1 {
  if (explicit) return explicit;
  if (paren && /^\s?\)/.test(text.slice(reach))) return -1;
  const after = text.slice(reach, reach + 60).split(/[.!?;:\n](?=\s|$)/)[0]!;
  if (NEGATIVE_AFTER.test(after)) return -1;
  if (POSITIVE_AFTER.test(after)) return 1;
  // The nearest direction word in the clause before the number, within 40 characters of it.
  const before = text.slice(Math.max(0, start - 60), start).split(/[.!?;:\n](?=\s|$)/).pop()!;
  let found: -1 | 0 | 1 = 0;
  for (const m of before.matchAll(DIRECTION_BEFORE)) if (before.length - (m.index! + m[0].length) <= 40) found = m[1] ? -1 : 1;
  return found;
}

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BIG: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const WORD = /^([A-Za-z]+)/;

/**
 * Read a number written in words, starting at `from` ("nine million", "twenty-one", "two and a half million",
 * "a hundred and five", "half a million", "two point five million"). Returns null when no number starts there.
 */
function readWords(text: string, from: number): { end: number; value: number; tolerance: number; lone: string | null } | null {
  const tokens: { w: string; end: number }[] = [];
  for (let i = from; i < text.length; ) {
    const m = WORD.exec(text.slice(i));
    if (!m) break;
    tokens.push({ w: m[1]!.toLowerCase(), end: i + m[1]!.length });
    const sep = /^(?: +|\t+|-)/.exec(text.slice(i + m[1]!.length));
    if (!sep) break;
    i += m[1]!.length + sep[0].length;
  }
  let k = 0;
  let total = 0;
  let group = 0; // the part below a thousand, being built
  let lastBig = Infinity;
  let decimals = 0;
  let consumed = 0;
  let any = false;
  while (k < tokens.length) {
    const w = tokens[k]!.w;
    const next = tokens[k + 1]?.w;
    const tens = Math.floor(group) % 100;
    if (w === 'zero' && k === 0) {
      // zero
    } else if (w in UNITS && w !== 'zero' && ((UNITS[w]! < 10 && (tens === 0 || (tens >= 20 && tens % 10 === 0))) || (UNITS[w]! >= 10 && tens === 0))) {
      group += UNITS[w]!;
    } else if (w in TENS && tens === 0) {
      group += TENS[w]!;
    } else if (w === 'hundred' && group < 10) {
      group = (group || 1) * 100;
    } else if (w in BIG && BIG[w]! < lastBig && group > 0) {
      total += group * BIG[w]!;
      group = 0;
      lastBig = BIG[w]!;
    } else if (w === 'dozen' && group > 0 && total === 0 && lastBig === Infinity) {
      group *= 12;
    } else if ((w === 'a' || w === 'an') && k === 0 && next && (next in BIG || next === 'hundred' || next === 'dozen')) {
      group = 1;
      k++;
      continue;
    } else if (w === 'half' && k === 0 && (next === 'a' || next === 'an') && (tokens[2]?.w === 'dozen' || (tokens[2]?.w ?? '') in BIG)) {
      group = 0.5;
      decimals = 1;
      k += 2;
      continue;
    } else if (w === 'and' && any && next === 'a' && tokens[k + 2]?.w === 'half') {
      group += 0.5;
      decimals = 1;
      k += 3;
      consumed = k;
      continue;
    } else if (w === 'and' && any && next && next !== 'zero' && (next in UNITS || next in TENS)) {
      k++;
      continue;
    } else if (w === 'point' && any && next && next in UNITS && UNITS[next]! < 10) {
      let digits = '';
      let j = k + 1;
      while (tokens[j] && tokens[j]!.w in UNITS && UNITS[tokens[j]!.w]! < 10) digits += UNITS[tokens[j++]!.w]!;
      group += Number(`0.${digits}`);
      decimals = digits.length;
      k = j;
      consumed = k;
      continue;
    } else {
      break;
    }
    any = true;
    k++;
    consumed = k;
  }
  if (!any || consumed === 0) return null;
  const last = tokens[consumed - 1]!.w;
  return { end: tokens[consumed - 1]!.end, value: total + group, tolerance: 0.5 * 10 ** -decimals * (last in BIG ? BIG[last]! : 1), lone: consumed === 1 ? tokens[0]!.w : null };
}

/** Numbers in `text` (and anything that looks like one but cannot be read), in order, with identifiers, dates and list markers left out. */
export function findNumbers(text: string, opts: FindOptions = {}): Found[] {
  const words = opts.words ?? true;
  const known = opts.known;
  const out: Found[] = [];
  let masked = text.replace(DATE_OR_SERIAL, blank).replace(LIST_MARKER, blank);

  // Words that hold digits: an identifier the session read is fine; any other is a number we cannot read.
  masked = masked.replace(ID_WORD, (tok, offset: number) => {
    if (!/\d/.test(tok)) return tok;
    if (CURRENCY_CODE_NUMBER.test(tok)) return tok; // USD999999: a currency code and an amount, read below
    if (known === undefined || knownId(tok, known) || (tok.replace(/\D/g, '').length <= 2 && /[\p{L}]/u.test(tok))) return blank(tok);
    out.push({ start: offset, end: offset + tok.length, reach: offset + tok.length, text: tok, parsed: false, nominal: NaN, tolerance: 0, percent: false, sign: 0 });
    return blank(tok);
  });

  const push = (start: number, end: number, body: { nominal: number; tolerance: number }) => {
    const { sign, paren, money } = prefixOf(text, start);
    const sfx = suffixOf(text, end, money);
    const cents = sfx.cents ? 100 : 1;
    out.push({
      start,
      end: sfx.end,
      reach: sfx.reach,
      text: text.slice(start, sfx.end),
      parsed: true,
      nominal: (body.nominal * sfx.scale) / cents,
      tolerance: (body.tolerance * sfx.scale) / cents,
      percent: sfx.percent,
      sign: directionOf(text, start, sfx.reach, sign, paren),
    });
  };
  const unreadable = (start: number, end: number) => out.push({ start, end, reach: end, text: text.slice(start, end), parsed: false, nominal: NaN, tolerance: 0, percent: false, sign: 0 });

  let skipUntil = 0; // a number read across several runs (1 000 000, 1e6) is read once
  for (const m of masked.matchAll(NUM_RUN)) {
    if (m.index! < skipUntil) continue;
    let start = m.index!;
    let end = start + m[0].length;
    let run = m[0];
    if (!/^[.\d]/.test(run) || /[^\x00-\x7F]/.test(run.replace(/\u2019/g, ''))) {
      // full-width digits, fractions, circled numbers and the like
      while (/[.,_'\u2019]$/.test(run)) run = run.slice(0, -1);
      end = start + run.length;
      unreadable(start, end);
      skipUntil = end;
      continue;
    }
    // 1e6, 2.5E3, and 0x1F
    const tail = masked.slice(end);
    const sci = /^[eE][+-]?\d+(?![\p{L}\p{N}_])/u.exec(tail);
    if (sci && /^\d+(?:\.\d+)?$/.test(run.replace(/[.,]+$/, ''))) {
      const num = Number(run + sci[0]);
      end += sci[0].length;
      push(start, end, { nominal: num, tolerance: 0.5 * 10 ** (Number(sci[0].slice(1)) - (run.split('.')[1]?.length ?? 0)) });
      skipUntil = end;
      continue;
    }
    if (run === '0' && /^[xXbBoO][0-9a-fA-F]/.test(tail)) {
      end += /^[xXbBoO][0-9a-fA-F]+/.exec(tail)![0].length;
      unreadable(start, end);
      skipUntil = end;
      continue;
    }
    // trailing sentence punctuation is not part of the number
    while (/[.,_'\u2019]$/.test(run)) run = run.slice(0, -1);
    end = start + run.length;
    // 1 000 000 and 1 000
    if (/^\d{1,3}$/.test(run) && (start === 0 || !/[\d,.]/.test(masked[start - 1]!))) {
      const g = SPACE_GROUPS.exec(masked.slice(end));
      if (g) {
        run += g[0].replace(/[^\d]/g, '');
        end += g[0].length;
      }
    }
    let clean: string | null = null;
    if (PLAIN.test(run) || LEADING.test(run)) clean = run;
    else if (COMMAS.test(run)) clean = run.replace(/,/g, '');
    else if (GROUPS.test(run)) clean = run.replace(/[_'\u2019]/g, '');
    if (clean === null) {
      unreadable(start, end);
      skipUntil = end;
      continue;
    }
    const decimals = clean.includes('.') ? clean.length - clean.indexOf('.') - 1 : 0;
    push(start, end, { nominal: Number(clean), tolerance: 0.5 * 10 ** -decimals });
    if (GLUED.test(masked.slice(end)) && !prefixOf(text, start).money && out.length) out[out.length - 1]!.glued = true;
    skipUntil = end;
  }

  if (words) {
    let scan = masked;
    for (const f of out) scan = scan.slice(0, f.start) + blank(scan.slice(f.start, f.reach)) + scan.slice(f.reach);
    const re = /(?<![\p{L}\p{N}_])(?:a|an|half|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|dozen)(?![\p{L}\p{N}_])/giu;
    let from = 0;
    for (const m of scan.matchAll(re)) {
      if (m.index! < from) continue;
      const r = readWords(scan, m.index!);
      if (!r) continue;
      from = r.end;
      const sfx = suffixOf(text, r.end);
      // "one" alone is a pronoun or part of a word (one of, one-time) unless an amount word follows it.
      if (r.lone === 'one' && (text[r.end] === '-' || (sfx.end === r.end && sfx.reach === r.end))) continue;
      const money = prefixOf(text, m.index!).money;
      push(m.index!, r.end, { nominal: r.value, tolerance: r.tolerance });
      // "three" on its own is a count of things, and "three-way" part of a word: soft, like a glued digit.
      if (!money && (GLUED.test(text.slice(r.end)) || (r.lone !== null && r.lone !== 'one' && r.value >= 2 && r.value <= 10 && sfx.end === r.end && sfx.reach === r.end))) out[out.length - 1]!.count = true;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Every number a piece of tool-result JSON holds: numeric leaves (sign kept), and numbers written inside its strings. */
function collectNumbers(node: unknown, into: Hay[]): void {
  if (typeof node === 'number') {
    if (Number.isFinite(node)) into.push({ v: node, percent: false });
  } else if (typeof node === 'string') {
    for (const f of findNumbers(node, { words: false })) if (f.parsed) into.push({ v: f.sign < 0 ? -f.nominal : f.nominal, percent: f.percent });
  } else if (Array.isArray(node)) {
    for (const x of node) collectNumbers(x, into);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      collectNumbers(v, into);
      if (/^\d/.test(k)) into.push({ v: Number(k.replace(/,/g, '')), percent: false });
    }
  }
}

const ID_FIELDS = ['key', 'id', 'refId', 'ref', 'name', 'partNumber'] as const;

/** A result key as an agent may write it, with or without its stage (`s2_cost.one_time_total`). */
function bare(ref: string): string {
  return ref.replace(/^s\d_[a-z_]+\./i, '');
}

function sameId(a: unknown, ref: string): boolean {
  return typeof a === 'string' && (a === ref || bare(a) === bare(ref));
}

/** A driver of a statement has no id in the data; the answer names it by its statement and place: driver:12.2. */
const DRIVER_REF = /^driver:(\d+)\.([1-9]\d*)$/i;

/** The parts of the tool results that carry this id: the objects whose key or id field is it, and whether a result around one says mock. */
function subtreesFor(roots: unknown[], ref: string): { parts: unknown[]; mockAround: boolean } {
  const parts: unknown[] = [];
  let mockAround = false;
  const driver = DRIVER_REF.exec(ref.trim());
  if (driver) {
    // driver:<statement id>.<place in its drivers list, from 1>: exactly that one driver row, and no other.
    const walkDrivers = (n: unknown, isRoot: boolean, mock: boolean) => {
      if (Array.isArray(n)) return n.forEach(x => walkDrivers(x, false, mock));
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      const row = Array.isArray(o.drivers) && String(o.id) === driver[1] ? o.drivers[Number(driver[2]) - 1] : undefined;
      if (row && typeof row === 'object') {
        parts.push(row);
        if (mock || o.mock === true) mockAround = true;
      }
      const m = mock || (!isRoot && o.mock === true);
      for (const v of Object.values(o)) walkDrivers(v, false, m);
    };
    roots.forEach(r => walkDrivers(r, true, false));
    return { parts, mockAround };
  }
  // `mock` is true when an object above this one (not the tool result's own top level) says mock: true.
  const walk = (n: unknown, isRoot: boolean, mock: boolean) => {
    if (Array.isArray(n)) return n.forEach(x => walk(x, false, mock));
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (!isRoot && ID_FIELDS.some(f => sameId(o[f], ref))) {
      parts.push(n);
      if (mock) mockAround = true;
    } else {
      const m = mock || (!isRoot && o.mock === true);
      for (const v of Object.values(o)) walk(v, false, m);
    }
  };
  roots.forEach(r => walk(r, true, false));
  return { parts, mockAround };
}

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function hasMock(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasMock);
  if (node && typeof node === 'object') return (node as Record<string, unknown>).mock === true || Object.values(node).some(hasMock);
  return false;
}

/** A cited part this large (the whole `detail` row, say) holds so many numbers that nearly anything would match. */
const MAX_EVIDENCE_CHARS = 6000;

function found(f: Found, haystack: Hay[]): boolean {
  if (!f.parsed) return false;
  const eps = 1e-9;
  const near = (x: number) => Math.abs(x - f.nominal) <= f.tolerance + eps;
  return haystack.some(h => {
    // Direction: a stated saving must match a negative value, a stated increase a positive one.
    if (f.sign < 0 && h.v > 0) return false;
    if (f.sign > 0 && h.v < 0) return false;
    const mag = Math.abs(h.v);
    // A percent in the answer matches a share only times 100 (10% is 0.10), or a value written as a percent.
    if (f.percent) return h.percent ? near(mag) : near(mag * 100);
    return !h.percent && near(mag);
  });
}

/** What the stored data calls the cited thing: the label it carries, else its own key or id. Never the agent's wording. */
function storedLabel(parts: unknown[], refId: string): string {
  for (const f of ['label', 'name', 'key', 'id'] as const)
    for (const p of parts) {
      const v = (p as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 160);
    }
  // A driver ("What moves the numbers") has no label or id of its own: its words are what is stored.
  for (const p of parts) {
    const v = (p as Record<string, unknown>).text;
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 160);
  }
  return bare(refId);
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })}`;

/** The stored value's own display, when the stored part carries one. */
function storedValue(parts: unknown[]): string {
  for (const p of parts) {
    const o = p as Record<string, unknown>;
    if (typeof o.display === 'string' && o.display.trim()) return o.display.trim().slice(0, 60);
    const unit = typeof o.unit === 'string' ? o.unit.toLowerCase() : '';
    const n = typeof o.p50 === 'number' ? o.p50 : typeof o.value === 'number' ? o.value : null;
    if (n !== null && Number.isFinite(n)) return unit === 'usd' ? money(n) : `${n}${unit && unit !== 'json' ? ` ${unit}` : ''}`;
  }
  return '';
}

/** The agent's value text, if it is only numbers (with their signs, symbols and units); else ''. Words of its own are not shown. */
function plainValue(value: string, numbers: Found[]): string {
  let rest = value;
  for (const f of [...numbers].reverse()) rest = rest.slice(0, f.start) + rest.slice(f.reach);
  return /^[\s$\u20AC\u00A3\u00A5\u20B9+\-\u2212(),]*$/.test(rest) ? value.trim().slice(0, 60) : '';
}

/** Lift [c1] / [c1, c2] markers out of the text. Each marker is remembered by where it stood in the cleaned text. */
function liftMarkers(raw: string): { clean: string; marks: { at: number; ids: string[] }[] } {
  const marks: { at: number; ids: string[] }[] = [];
  let clean = '';
  let last = 0;
  for (const m of raw.matchAll(/\s?\[(c\d+(?:\s*,\s*c\d+)*)\]/gi)) {
    clean += raw.slice(last, m.index!);
    marks.push({ at: clean.length, ids: m[1]!.toLowerCase().split(/\s*,\s*/) });
    last = m.index! + m[0].length;
  }
  return { clean: clean + raw.slice(last), marks };
}

/**
 * Check an agent's answer against the tool results its session read. A citation counts only when its
 * id is in a tool result; each number in the answer is then looked up in the stored value of the
 * citation its own marker names, and nowhere else.
 */
export function guardAnswer(agent: AgentAnswer, results: ToolResultText[]): GuardResult {
  const roots = results.filter(r => r.content).map(r => parse(r.content));
  // Every number any tool result holds: an uncited glued number ("13-week") passes only if it is one of them.
  const anywhere: Hay[] = [];
  collectNumbers(roots, anywhere);
  const known = results.map(r => r.content).join('\n').toLowerCase();
  const citations: AskCitation[] = [];
  const byId = new Map<string, { index: number; usable: boolean; hay: Hay[] }>();
  let mock = false;
  let anyParts = false;
  for (const [i, c] of agent.citations.entries()) {
    const id = (c.id || `c${i + 1}`).toLowerCase();
    const { parts, mockAround } = subtreesFor(roots, c.refId);
    const size = parts.length ? JSON.stringify(parts).length : 0;
    const usable = parts.length > 0 && size <= MAX_EVIDENCE_CHARS;
    const hay: Hay[] = [];
    if (usable) collectNumbers(parts, hay);
    const valueNumbers = findNumbers(c.value, { known });
    // An empty value proves nothing, and a cited part too broad to check is not evidence.
    const valueOk = c.value.trim() !== '' && valueNumbers.length > 0 ? valueNumbers.every(f => found(f, hay)) : c.value.trim() !== '' && usable;
    const verified = usable && valueOk;
    if (parts.length > 0) {
      anyParts = true;
      if (mockAround || hasMock(parts)) mock = true;
    }
    // What the chip shows comes from the stored data. The agent's label is never shown. Its value is shown only
    // when every number in it was found in the stored data, else the stored value's own display.
    const label = parts.length > 0 ? storedLabel(parts, c.refId) : bare(c.refId).slice(0, 60);
    const value = (verified ? plainValue(c.value, valueNumbers) : '') || (usable ? storedValue(parts) : '');
    citations.push({ id, label, refId: c.refId, value, verified });
    if (!byId.has(id)) byId.set(id, { index: i, usable, hay });
  }
  if (!mock && !anyParts && roots.some(hasMock)) mock = true;

  const { clean, marks } = liftMarkers(agent.answer);
  const segments: AskSegment[] = [];
  const unverified: string[] = [];
  let at = 0;
  for (const f of findNumbers(clean, { known })) {
    if (f.start < at) continue;
    // The markers that follow this number, with nothing but spaces between.
    const named = marks.filter(m => m.at >= f.reach && clean.slice(f.reach, m.at).trim() === '').flatMap(m => m.ids);
    const cited = [...new Set(named)].map(id => byId.get(id)).filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (named.length === 0 && (f.count || (f.glued && f.parsed && found(f, anywhere)))) continue;
    const hay = cited.filter(c => c.usable).flatMap(c => c.hay);
    const ok = f.parsed && hay.length > 0 && found(f, hay);
    if (f.start > at) segments.push({ text: clean.slice(at, f.start) });
    const cites = cited.map(c => citations[c.index]!.id);
    segments.push({ text: f.text, ...(ok ? {} : { unverified: true }), ...(cites.length ? { cites } : {}) });
    if (!ok) unverified.push(f.text);
    at = f.end;
  }
  if (at < clean.length) segments.push({ text: clean.slice(at) });
  return { text: clean, segments, unverifiedNumbers: unverified, citations, mock };
}

/** Parse the agent's final text into the answer object. Tolerates a code fence around the JSON. */
export function parseAgentAnswer(text: string | null): AgentAnswer | null {
  if (!text) return null;
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.answer !== 'string' || !o.answer.trim()) return null;
  const citations = Array.isArray(o.citations)
    ? o.citations.flatMap(c => {
        const x = c as Record<string, unknown>;
        return x && typeof x.refId === 'string' && x.refId
          ? [{ id: typeof x.id === 'string' && /^c\d+$/i.test(x.id.trim()) ? x.id.trim().toLowerCase() : undefined, label: String(x.label ?? x.refId), refId: x.refId, value: String(x.value ?? '') }]
          : [];
      })
    : [];
  // A citation with no id of its own is named by its place in the list: c1, c2, ...
  return { answer: o.answer.trim(), citations: citations.slice(0, 12).map((c, i) => ({ ...c, id: c.id ?? `c${i + 1}` })) };
}
