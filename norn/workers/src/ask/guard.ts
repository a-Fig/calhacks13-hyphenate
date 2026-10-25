// The guardrail: before an answer is shown, every number in it must be found in the tool results it
// cites. Code computes and agents explain, so a number the agent made up or worked out itself is
// marked "not found in Norn's data" rather than passed on.
//
// How a number is matched: it is read the way a person would read it ("$148k" is 148,000 to the
// nearest thousand, "$60,439" is 60,439 to the nearest dollar, "10%" is 10 or 0.10), and it counts as
// found when a cited value rounds to it at the precision shown. So "$148k" does not match 147,000.
import type { AgentAnswer, AskCitation, AskSegment } from './protocol.ts';

export interface ToolResultText {
  tool: string;
  /** The tool result's text, normally JSON. */
  content: string;
}

export interface GuardResult {
  segments: AskSegment[];
  unverifiedNumbers: string[];
  citations: AskCitation[];
  /** Some cited result says mock: true. */
  mock: boolean;
}

interface Found {
  start: number;
  end: number;
  text: string;
  /** The number as written, with its suffix applied (k, M), always >= 0. */
  nominal: number;
  /** Half a unit of the last digit shown, in the same scale. */
  tolerance: number;
  percent: boolean;
  /** -1 when the text says the number is a saving or reduction (or writes a minus), +1 for an increase, 0 when it doesn't say. */
  sign: -1 | 0 | 1;
}

/** A number found in a tool result, with its sign kept and whether it was written as a percent. */
interface Hay {
  v: number;
  percent: boolean;
}

// Identifiers hold digits that are not quantities: ECR-0417, BW-5120-210, Q-HAL-26-1187#1, P50, S2.
const IDENTIFIER = /\b[A-Za-z]{1,6}(?:-[A-Za-z0-9]+)+(?:#\d+)?|\b[A-Za-z]{1,4}\d+(?:-\d+)*\b|\bS\/N\b/g;
const NUMBER = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(%|percent\b|million\b|thousand\b|[kKM](?![A-Za-z0-9])))?/g;
const LIST_MARKER = /^[ \t]*\d+[.)][ \t]/gm;
// Dates and serial numbers hold digits that are not quantities: 2026-11-05, 2026-11, S/N 011-014, S/N 11.
const DATE_OR_SERIAL = /\b\d{4}-\d{2}(?:-\d{2})?\b|\bS\/N\s*\d+(?:\s*(?:-|to)\s*\d+)?/g;
const NEGATIVE_WORDS = /\b(?:saves?|saving|savings|reduc(?:e|es|ed|ing|tion)|cheaper|lower|less|decreas(?:e|es|ed|ing)|drops?|cuts?|credit)\b[^.;:\n]{0,40}$/i;
const POSITIVE_WORDS = /\b(?:adds?|added|increas(?:e|es|ed|ing)|more|higher|rises?|raises?|extra)\b[^.;:\n]{0,40}$/i;

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/** Numbers in `text` with identifiers and list markers masked out, positions kept. */
export function findNumbers(text: string): Found[] {
  let masked = text.replace(DATE_OR_SERIAL, blank).replace(IDENTIFIER, blank).replace(LIST_MARKER, blank);
  masked = masked.replace(/\b(?:[Pp](?:10|50|90))\b/g, blank);
  const out: Found[] = [];
  for (const m of masked.matchAll(NUMBER)) {
    const intPart = m[1]!.replace(/,/g, '');
    const frac = m[2] ?? '';
    const suffix = (m[3] ?? '').toLowerCase();
    const scale = suffix === 'k' || suffix === 'thousand' ? 1e3 : suffix === 'm' || suffix === 'million' ? 1e6 : 1;
    const base = Number(intPart + frac);
    const decimals = frac ? frac.length - 1 : 0;
    const before = text.slice(Math.max(0, m.index! - 60), m.index!);
    const minus = /[-\u2212]\s*\$?\s*$/.test(before) && !/\d\s*[-\u2212]\s*\$?\s*$/.test(before);
    const sign: -1 | 0 | 1 = minus || NEGATIVE_WORDS.test(before) ? -1 : POSITIVE_WORDS.test(before) ? 1 : 0;
    out.push({
      start: m.index!,
      end: m.index! + m[0].length,
      text: text.slice(m.index!, m.index! + m[0].length),
      nominal: base * scale,
      tolerance: 0.5 * 10 ** -decimals * scale,
      percent: suffix === '%' || suffix === 'percent',
      sign,
    });
  }
  return out;
}

/** Every number a piece of tool-result JSON holds: numeric leaves (sign kept), and numbers written inside its strings. */
function collectNumbers(node: unknown, into: Hay[]): void {
  if (typeof node === 'number') {
    if (Number.isFinite(node)) into.push({ v: node, percent: false });
  } else if (typeof node === 'string') {
    for (const f of findNumbers(node)) into.push({ v: f.sign < 0 ? -f.nominal : f.nominal, percent: f.percent });
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

/** The parts of the tool results that carry this id: the objects whose key or id field is it. */
function subtreesFor(roots: unknown[], ref: string): unknown[] {
  const hits: unknown[] = [];
  const walk = (n: unknown, isRoot: boolean) => {
    if (Array.isArray(n)) return n.forEach(x => walk(x, false));
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (!isRoot && ID_FIELDS.some(f => sameId(o[f], ref))) hits.push(n);
    else for (const v of Object.values(o)) walk(v, false);
  };
  roots.forEach(r => walk(r, true));
  return hits;
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

const STOP = new Set(['cost', 'costs', 'total', 'the', 'and', 'for', 'per', 'unit', 'change', 'with', 'from', 'line', 'lines', 'item', 'part', 'parts', 'price', 'quote', 'order', 'value', 'share', 'rate', 'result', 'check']);

/** The distinctive words of a citation's label and id, to tie it to the sentence that uses it. */
function labelWords(c: { label: string; refId: string }): string[] {
  const words = normWords(`${c.label} ${bare(c.refId)}`).match(/[a-z]{3,}/g) ?? [];
  return [...new Set(words.filter(w => !STOP.has(w)))];
}

/** Lowercase, with hyphens, underscores, dots and colons as spaces, so "one-time" and "one_time" read alike. */
function normWords(s: string): string {
  return ` ${s.toLowerCase().replace(/[-_.:/]/g, ' ')} `;
}

/** Sentence spans of the answer, so each number is checked against the citations its sentence names. */
function sentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[^.!?\n]+(?:[.!?](?=\s|$)|\n|$)/g;
  for (const m of text.matchAll(re)) if (m[0].trim()) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

/**
 * Check an agent's answer against the tool results its session read. A citation counts only when
 * its id is in a tool result; the answer's numbers are then looked up in the cited parts alone.
 */
export function guardAnswer(agent: AgentAnswer, results: ToolResultText[]): GuardResult {
  const roots = results.filter(r => r.content).map(r => parse(r.content));
  const citations: AskCitation[] = [];
  const perCitation: { words: string[]; hay: Hay[] }[] = [];
  const allHay: Hay[] = [];
  let mock = false;
  let anyParts = false;
  for (const c of agent.citations) {
    const parts = subtreesFor(roots, c.refId);
    const size = parts.length ? JSON.stringify(parts).length : 0;
    const usable = parts.length > 0 && size <= MAX_EVIDENCE_CHARS;
    const hay: Hay[] = [];
    if (usable) collectNumbers(parts, hay);
    const valueNumbers = findNumbers(c.value);
    // An empty value proves nothing, and a cited part too broad to check is not evidence.
    const valueOk = c.value.trim() !== '' && valueNumbers.length > 0 ? valueNumbers.every(f => found(f, hay)) : c.value.trim() !== '' && usable;
    citations.push({ ...c, verified: usable && valueOk });
    if (parts.length > 0) {
      anyParts = true;
      if (hasMock(parts)) mock = true;
    }
    if (usable) {
      allHay.push(...hay);
      perCitation.push({ words: labelWords(c), hay });
    }
  }
  if (!mock && !anyParts && roots.some(hasMock)) mock = true;

  const text = agent.answer;
  const spans = sentences(text);
  // A number is checked against the citations its sentence names; if it names none, against all of them.
  const hayFor = (pos: number): Hay[] => {
    const s = spans.find(x => pos >= x.start && pos < x.end);
    if (!s) return allHay;
    const sentence = normWords(text.slice(s.start, s.end));
    const named = perCitation.filter(c => c.words.some(w => new RegExp(`[^a-z]${w}[^a-z]`).test(sentence)));
    return named.length ? named.flatMap(c => c.hay) : allHay;
  };

  const segments: AskSegment[] = [];
  const unverified: string[] = [];
  let at = 0;
  for (const f of findNumbers(text)) {
    if (found(f, hayFor(f.start))) continue;
    if (f.start > at) segments.push({ text: text.slice(at, f.start) });
    segments.push({ text: f.text, unverified: true });
    unverified.push(f.text);
    at = f.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return { segments, unverifiedNumbers: unverified, citations, mock };
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
        return x && typeof x.refId === 'string' && x.refId ? [{ label: String(x.label ?? x.refId), refId: x.refId, value: String(x.value ?? '') }] : [];
      })
    : [];
  return { answer: o.answer.trim(), citations: citations.slice(0, 12) };
}
