// Checks on the agent's own words against what Norn's code found (#123). Pure: text and facts in, problems out.
//
// The PLM shows the agent's headline, reasoning and claims next to the rule's output. Two things must hold whatever the
// agent wrote, and neither can be repaired by rewriting its prose, so a statement that breaks them is refused and the
// agent is told why (guard.ts, in the post_impact_statement tool):
//   - it never says the checks are clean, or that there are no issues, while the rule has a blocker or a condition, or
//     a check has a finding (`cleanWording`);
//   - it quotes no dollar figure that no check produced (`unknownAmounts`), allowing for rounding and for $154k
//     against $154,000.
// The publisher (format.ts) does not refuse: it lists every derived condition itself, and notes a clean wording it finds.
import { MATERIALITY } from './prompt.ts';
import type { Derived, RuleInput } from './recommendation.ts';

// "clean", "all clear", "no issues", "nothing to flag" and the like. Deliberately narrow: a refusal costs the agent a
// retry, so a phrase is here only when it means "nothing was found". "No conflicts" is not: a statement can truthfully
// say there is no supplier conflict next to a late cut-in.
const CLEAN = [
  /\ball[- ]clear\b/i,
  /\bclean\b/i,
  /\bno (?:open |outstanding |remaining |material |significant |further |other )?(?:issues?|problems?|concerns?|flags?|findings?|gaps?|conditions?|risks?|warnings?)\b/i,
  /\bnothing (?:here |else )?(?:to (?:flag|raise|report|note)|of concern|worth (?:flagging|raising|noting)|needs? (?:attention|a second look)|stands out)\b/i,
  /\bwithout (?:any )?(?:issues?|problems?|concerns?|flags?|findings?|gaps?|conditions?)\b/i,
];

/** The sentence the prompt tells the agent to use when no cost bar is cleared: it is about the cost bars, not about the checks. */
const ALLOWED = MATERIALITY.whenNothingMaterial;

/** The wording in `text` that says nothing was found, or null. */
export function cleanWording(text: string): string | null {
  const t = text.split(ALLOWED).join(' ');
  for (const re of CLEAN) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

/** What the rule and the checks found, in words: blockers, conditions, and the findings that are not conditions. */
export function findingsOf(input: RuleInput | undefined, derived: Derived): string[] {
  const out = [...derived.blockers, ...derived.conditions];
  for (const f of input?.supply?.flags ?? []) if (f.kind === 'single_source' && f.severity === 'warn') out.push(`${f.ref ?? 'A part'} has a single qualified source`);
  return out;
}

export interface Prose {
  headline: string;
  drivers: { text: string }[];
  claims: { text: string }[];
}

/** Every piece of the agent's text with a name for where it is, for the message. */
function pieces(p: Prose): { where: string; text: string }[] {
  return [
    { where: 'headline', text: p.headline },
    ...p.drivers.map((d, i) => ({ where: `driver ${i + 1}`, text: d.text })),
    ...p.claims.map((c, i) => ({ where: `claim ${i + 1}`, text: c.text })),
  ];
}

/** The agent's wording that says nothing was found, where there are findings. */
export function cleanClaims(p: Prose, findings: readonly string[]): { where: string; phrase: string }[] {
  if (!findings.length) return [];
  const out: { where: string; phrase: string }[] = [];
  for (const { where, text } of pieces(p)) {
    const phrase = cleanWording(text);
    if (phrase) out.push({ where, phrase });
  }
  return out;
}

// ---- dollar figures ---------------------------------------------------------------------------------

/** A dollar figure in prose with the amount's rounding: "$154k" is 154,000 give or take 500. */
export interface Figure {
  text: string;
  value: number;
  tolerance: number;
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(thousand|million|billion|bn|mm|[kmb])?(?![a-z])/gi)) {
    const digits = m[1]!.replace(/,/g, '');
    const scale = SCALE[(m[2] ?? '').toLowerCase()] ?? 1;
    const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0;
    // Rounded to the shown digit; a plain dollar figure is "rounded to the dollar" in the prompt, so a dollar either way.
    const tolerance = scale === 1 ? Math.max(1, 0.5 * 10 ** -decimals) : 0.5 * 10 ** -decimals * scale;
    out.push({ text: m[0].trim(), value: Number(digits) * scale, tolerance });
  }
  return out;
}

/** Every finite number inside a parsed JSON value. */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) numbersIn(v, out);
  else if (typeof value === 'string') for (const f of figuresIn(value)) out.push(f.value);
  return out;
}

/**
 * The figures in the prose that match no known amount. `known` is every number the checks produced (their results and
 * detail) plus the bars the agent is given; a figure matches when it is within its own rounding of one, in either sign
 * (a saving is written in parentheses). $0 always matches.
 */
export function unknownAmounts(p: Prose, known: readonly number[]): { where: string; figure: string }[] {
  const abs = known.map(Math.abs);
  const out: { where: string; figure: string }[] = [];
  for (const { where, text } of pieces(p))
    for (const f of figuresIn(text))
      if (f.value !== 0 && !abs.some(k => Math.abs(k - f.value) <= f.tolerance)) out.push({ where, figure: f.text });
  return out;
}

/** The bars in the system prompt, which the agent may quote. */
export const QUOTABLE_BARS = [MATERIALITY.unitCostAbsoluteUsd, MATERIALITY.oneTimeCostUsd, MATERIALITY.dispositionSwingUsd];
