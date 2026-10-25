// Checks on the agent's own words against what Norn's code found (#123). Pure: text and facts in, problems out.
//
// The PLM and the web page show the agent's words next to the rule's output. Two things must hold whatever the agent
// wrote, and neither can be repaired by rewriting its prose, so a statement that breaks them is refused and the
// agent is told why (guard.ts, in the post_impact_statement tool):
//   - it never says the checks are clean, or that there are no issues, while the rule has a blocker or a condition, or
//     a check has a finding (`cleanWording`). "The checks are not clean" is not that, and "the cost check is clean" is
//     true when the cost check found nothing;
//   - it quotes no dollar figure that no check produced (`unknownAmounts`), allowing for rounding, for $154k against
//     $154,000, and for "154,000 USD" or "154,000 dollars";
//   - a number that is not a computation is never money (`judgedNumberProblems`): its unit and label carry no money
//     marker, and its unit is one of a short list that are not money (weeks, %, count...). A computation takes its
//     label, unit and values from its check result (the module copies them), so a money figure must be one.
// Both checks read every piece of agent-written text the pages display (`piecesOf`), not only the prose fields.
// The publisher (format.ts) does not refuse: it lists every derived condition itself, and notes a clean wording it finds.
import { MATERIALITY } from './prompt.ts';
import { deriveRecommendation, type Derived, type RuleInput } from './recommendation.ts';

// "clean", "all clear", "no issues", "nothing to flag" and the like. Deliberately narrow: a refusal costs the agent a
// retry, so a phrase is here only when it means "nothing was found". "No conflicts" is not: a statement can truthfully
// say there is no supplier conflict next to a late cut-in.
const CLEAN = [
  /\ball[- ]clear\b/i,
  /\bclean\b/i,
  /\bno (?:known |open |outstanding |remaining |material |significant |further |other )?(?:issues?|problems?|concerns?|flags?|findings?|gaps?|conditions?|risks?|warnings?)\b/i,
  /\bnothing (?:here |else )?(?:to (?:flag|raise|report|note)|of concern|worth (?:flagging|raising|noting)|needs? (?:attention|a second look)|stands out)\b/i,
  /\bwithout (?:any )?(?:issues?|problems?|concerns?|flags?|findings?|gaps?|conditions?)\b/i,
];

/** "not clean", "isn't clean", "not entirely clean", "never all clear": the opposite of the claim. */
const NEGATED = /(?:\bnot|n['\u2019]t|\bnever|\bhardly)\s+(?:(?:entirely|quite|fully|completely|really|all|yet|exactly|particularly)\s+)*(?:clean|all[- ]clear)\b/gi;

/** The checks a claim of "clean" can be scoped to, and the findings of each (a check with none can be called clean). */
export const SCOPES = ['cost', 'timeline', 'supply'] as const;
export type Scope = (typeof SCOPES)[number];
export type CheckFindings = Record<Scope, readonly string[]>;

/**
 * "the cost check is clean", "cost and supply checks came back clean", "the cost check has no issues": a claim about
 * named checks only.
 */
const SCOPED = /\b((?:the |our )?(?:cost|timeline|supply)(?: checks?)?(?:(?:,|,? and|,? or) (?:the )?(?:cost|timeline|supply)(?: checks?)?)*)\s+(?:(?:is|are|was|were|came back|come back|comes back|looks?|seems?)\s+(?:all\s+)?clean\b|(?:has|have|had|shows?|showed|found|finds|raised|raises)\s+no (?:known |open |outstanding |remaining |material |significant |further |other )?(?:issues?|problems?|concerns?|flags?|findings?|gaps?|conditions?|risks?|warnings?)\b)/gi;

/** The sentence the prompt tells the agent to use when no cost bar is cleared: it is about the cost bars, not about the checks. */
const ALLOWED = MATERIALITY.whenNothingMaterial;

/**
 * The wording in `text` that says nothing was found, or null. A negated claim is not one. A claim scoped to named
 * checks is not one when `byCheck` says each of them found nothing; without `byCheck` it cannot be vouched for.
 */
export function cleanWording(text: string, byCheck?: CheckFindings): string | null {
  let t = text.split(ALLOWED).join(' ').replace(NEGATED, ' ');
  if (byCheck)
    t = t.replace(SCOPED, (whole, names: string) => {
      const named = (names.toLowerCase().match(/cost|timeline|supply/g) ?? []) as Scope[];
      return named.every(n => byCheck[n].length === 0) ? ' ' : whole;
    });
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

/**
 * The same findings by the check they belong to. Each of the timeline and supply checks is given to the rule on its
 * own, and its findings are what the rule adds over the cost check alone: a finding both checks raise (each one's
 * `implementation_unestimated`) is in both lists, although the rule's combined list names it once. Everything the cost
 * check and the checks before it found (a blocker, a failed BOM delta) counts against the cost check, so "the cost
 * check is clean" is never said over a blocker.
 */
export function findingsByCheck(input: RuleInput | undefined, derived: Derived): CheckFindings {
  if (!input) return { cost: derived.conditions.length || derived.blockers.length ? [...derived.blockers, ...derived.conditions] : [], timeline: [], supply: [] };
  const costOnly = deriveRecommendation({ ...input, timeline: undefined, supply: undefined });
  const added = (only: Derived) => only.conditions.filter(c => !costOnly.conditions.includes(c));
  const cost = [...costOnly.blockers, ...costOnly.conditions];
  const timeline = added(deriveRecommendation({ ...input, supply: undefined }));
  const supply = added(deriveRecommendation({ ...input, timeline: undefined }));
  for (const f of input.supply?.flags ?? []) if (f.kind === 'single_source' && f.severity === 'warn') supply.push(`${f.ref ?? 'A part'} has a single qualified source`);
  return { cost, timeline, supply };
}

/**
 * The statement as the agent writes it, as far as the checks read it: everything it wrote that the PLM page or the web
 * page displays. The first three are the tool's prose fields; the rest are the fields the tool schema does not call
 * prose and a reader still sees.
 */
export interface Prose {
  headline: string;
  drivers: { text: string }[];
  claims: { text: string }[];
  changeClass?: string;
  route?: string;
  numbers?: { key?: string; label?: string; unit?: string; evidence?: string; p10?: number; p50?: number; p90?: number }[];
  assumptions?: { key?: string; note?: string }[];
}

/**
 * Every piece of the agent's text that is displayed, with a name for where it is, for the message. A number's label
 * and unit are the agent's only when the number is not a computation (a computation takes its check's own); a number
 * with no label is shown under its key.
 */
export function piecesOf(p: Prose): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [{ where: 'headline', text: p.headline }];
  const add = (where: string, text: string | undefined) => {
    if (text) out.push({ where, text });
  };
  add('change class', p.changeClass);
  add('approval route', p.route);
  (p.numbers ?? []).forEach((n, i) => {
    if (n.evidence === 'computation') return;
    add(`number ${i + 1} label`, n.label ?? n.key);
    add(`number ${i + 1} unit`, n.unit);
  });
  p.drivers.forEach((d, i) => add(`driver ${i + 1}`, d.text));
  (p.assumptions ?? []).forEach((a, i) => add(`assumption ${i + 1} note`, a.note));
  p.claims.forEach((c, i) => add(`claim ${i + 1}`, c.text));
  return out;
}

/** The agent's wording that says nothing was found, where there are findings. */
export function cleanClaims(p: Prose, findings: readonly string[], byCheck?: CheckFindings): { where: string; phrase: string }[] {
  if (!findings.length) return [];
  const out: { where: string; phrase: string }[] = [];
  for (const { where, text } of piecesOf(p)) {
    const phrase = cleanWording(text, byCheck);
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

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const SCALES = String.raw`(thousand|million|billion|bn|mm|[kmb])`;
/** "$154k", "$ 1,234.50", "$1.2 million". */
const DOLLAR = new RegExp(String.raw`\$\s?${NUM}\s?${SCALES}?(?![a-z])`, 'gi');
/** "999,999 USD", "154k USD", "154 kUSD", "999,999 dollars": a number followed by USD or dollars, not already part of a $ figure. */
const USD_AFTER = new RegExp(String.raw`(?<![$\d,.])${NUM}\s?${SCALES}?\s?(?:USD|dollars?)\b`, 'gi');
/** "USD 999,999". */
const USD_BEFORE = new RegExp(String.raw`\bUSD\s?${NUM}\s?${SCALES}?(?![a-z])`, 'gi');

export function figuresIn(text: string): Figure[] {
  const found: (Figure & { at: number })[] = [];
  for (const re of [DOLLAR, USD_AFTER, USD_BEFORE])
    for (const m of text.matchAll(re)) {
      const digits = m[1]!.replace(/,/g, '');
      const scale = SCALE[(m[2] ?? '').toLowerCase()] ?? 1;
      const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0;
      // Rounded to the shown digit; a plain dollar figure is "rounded to the dollar" in the prompt, so a dollar either way.
      const tolerance = scale === 1 ? Math.max(1, 0.5 * 10 ** -decimals) : 0.5 * 10 ** -decimals * scale;
      found.push({ at: m.index ?? 0, text: m[0].trim(), value: Number(digits) * scale, tolerance });
    }
  return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...f }) => f);
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
  for (const { where, text } of piecesOf(p))
    for (const f of figuresIn(text))
      if (f.value !== 0 && !abs.some(k => Math.abs(k - f.value) <= f.tolerance)) out.push({ where, figure: f.text });
  return out;
}

// ---- numbers that are not computations --------------------------------------------------------------

/**
 * A money marker in a unit or a label: a currency sign or code, scaled or not ("$", "$k", "k$", "USD", "kUSD", "MUSD",
 * "€", "EUR", "kEUR", "£", "GBP", "dollars"). Matching a value against the checks' amounts cannot close this: "250 kUSD"
 * is $250,000 on the page and matches the $250 bar, and "Annual cost (USD)" puts the currency in the label.
 */
const MONEY = /[$€£¥]|usd|dollar|gbp|\b[km]?eur(?:os?)?\b|\beuros?\b|\bpounds? sterling\b/i;
export const hasMoneyMarker = (s: string | undefined): boolean => !!s && MONEY.test(s);

/** The units a number that is not a computation may have: none of them is money. Anything else, and no unit, is refused. */
export const NOT_MONEY_UNITS = ['weeks', 'days', 'hours', 'months', 'years', '%', 'percent', 'count', 'units', 'parts', 'aircraft', 'serials', 'ratio'] as const;
const NOT_MONEY = new Set<string>([...NOT_MONEY_UNITS, 'week', 'wk', 'wks', 'day', 'hour', 'h', 'hr', 'hrs', 'month', 'year', 'unit', 'part', 'serial', 's/n', 'fraction']);
const unitWord = (unit: string | undefined) => (unit ?? '').trim().toLowerCase().replace(/^\((.*)\)$/, '$1').trim();

/**
 * The numbers the agent posted that are not computations and could be read as money, each with what is wrong. The
 * pages show such a number's label, unit and values as the agent wrote them, so a money figure must be a computation:
 * its unit and label carry no money marker, and its unit is on `NOT_MONEY_UNITS`.
 */
export function judgedNumberProblems(p: Prose): { where: string; why: string }[] {
  const out: { where: string; why: string }[] = [];
  (p.numbers ?? []).forEach((n, i) => {
    if (n.evidence === 'computation') return;
    const where = `number ${i + 1} (${n.label ?? n.key ?? 'no label'})`;
    if (hasMoneyMarker(n.unit) || hasMoneyMarker(n.label)) out.push({ where, why: `is money (${hasMoneyMarker(n.unit) ? `unit "${n.unit}"` : `label "${n.label}"`}) but is not a computation` });
    else if (!NOT_MONEY.has(unitWord(n.unit))) out.push({ where, why: unitWord(n.unit) ? `has the unit "${n.unit}", which Norn cannot tell is not money` : 'has no unit, so Norn cannot tell it is not money' });
  });
  return out;
}

/** The bars in the system prompt, which the agent may quote. */
export const QUOTABLE_BARS = [MATERIALITY.unitCostAbsoluteUsd, MATERIALITY.oneTimeCostUsd, MATERIALITY.dispositionSwingUsd];
