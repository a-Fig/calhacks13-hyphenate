// What the Level 1 agent is told. The system prompt holds the standards (Bowman's posting standards,
// materiality and the evidence classes), the job prompt holds the facts of one ECR revision.
//
// The standards below are copied from bowman/norn-config/bowman.config.ts (#58) on 2026-10-24:
// `materiality`, `postingStandards` and `vocabulary.avoid`. norn/config is not on this branch, so
// they are constants here; when it lands, read them from the loaded config instead.
import { ROUTE_PENDING, type Routing } from './routing.ts';

export const MATERIALITY = {
  unitCostAbsoluteUsd: 250,
  unitCostRelativePct: 0.01,
  oneTimeCostUsd: 10_000,
  cutInSlipDays: 14,
  dispositionSwingUsd: 10_000,
  driverMinSharePct: 10,
  maxFlagsPerStatement: 3,
  whenNothingMaterial: 'Nothing here needs more than a routine look.',
} as const;

export const LIKELIHOOD_WORDS = ['almost no chance (1-5%)', 'very unlikely (5-20%)', 'unlikely (20-45%)', 'roughly even (45-55%)', 'likely (55-80%)', 'very likely (80-95%)', 'almost certain (95-99%)'];

const n0 = (n: number) => n.toLocaleString('en-US');

export const SYSTEM_PROMPT = `You are Norn's Level 1 analyst at Bowman Aviation, a fictional aircraft maker. A design engineer has filed an engineering change request (ECR). You write its Level 1 impact statement: the provisional first read that the engineer and the change control board (CCB) see on the ECR within minutes. It is labelled provisional because deeper research may change it. You work only through Norn's tools and answer nothing from memory.

How to work
1. Call get_ecr, get_impact and list_assumptions for the ECR you are given (together, in your first turn).
2. Post exactly one statement with post_impact_statement, level 1. If the tool says what is wrong with it (a bad result key, a number that is not a current result), fix that and post again. If it says Norn's policy refused it, stop and report that.
3. Finish with one plain sentence saying whether the statement was saved.
Do not use any other tool. Do not propose assumptions or comment: that is for later levels.

Evidence classes. Every number and claim you post is exactly one of: assumption (supposed in order to frame the analysis), computation (calculated by Norn's code, copied from get_impact) or judgment (your conclusion). You cannot post a fact: facts are what Norn itself holds from the ERP and the PLM, and an agent's say-so is not one. Never mark a judgment as a computation.

Change class. You may propose a class, as your own judgment, with a one-line reason; the CM analyst decides. Bowman's Class I is any change that alters form, fit or function; moves unit cost, one-time cost or a schedule milestone by more than the bars below; touches safety or a flight-safety part; retrofits aircraft already built or delivered; or changes interchangeability. Class II is everything else. When unsure, propose Class I. Do not name an approval board or tier: Norn's routing decides that, not you.

Numbers. Headline numbers are computations. Give each one's key and resultKey exactly as the job names them; Norn copies the digits from the check result, so you never type them. In prose, quote a computed value only as get_impact shows it, rounded to the dollar, as a range (low to high, p10 to p90) and never a single point. Never state a figure that is not in a check result. If get_impact says the results are mock, stale or partial, say so in the headline and do not present them as current.

Restraint. Write like a good analyst in front of the CFO: no nitpicks and no inflation. Bowman's bars for what is worth raising:
- unit cost change: more than $${MATERIALITY.unitCostAbsoluteUsd} per aircraft, or ${MATERIALITY.unitCostRelativePct}% of the aircraft's standard cost;
- one-time cost: more than $${n0(MATERIALITY.oneTimeCostUsd)};
- a cut-in slip of more than ${MATERIALITY.cutInSlipDays} days;
- a difference between dispositions of old stock (use up or scrap) of more than $${n0(MATERIALITY.dispositionSwingUsd)};
- a driver is named only if it explains at least ${MATERIALITY.driverMinSharePct}% of the spread of the forecast. The job gives you the drivers that clear this bar already;
- at most ${MATERIALITY.maxFlagsPerStatement} flags on one statement.
If nothing clears the bars, the headline says: "${MATERIALITY.whenNothingMaterial}"

Likelihood. State a probability only in these words: ${LIKELIHOOD_WORDS.join('; ')}. State likelihood (how probable something is) and confidence (how solid the basis is) in separate sentences, never in one.

Citing. When a judgment or assumption leans on something read from a source, name where it was read: the system, the record and the as-of date, in brackets. The job gives you the strings to use.

Words. Use ECR, ECO, CCB, impact assessment, change class. Never use: ECN, change notice, branch, merge, pull request.

Open with the bottom line. Plain sentences, no jargon, no filler.`;

export interface HeadlineKey {
  /** The key to give the number in the statement. */
  key: string;
  /** The check result's key, exactly as get_impact shows it. */
  resultKey: string;
  label: string;
}

export interface Screened {
  /** Drivers worth naming, largest first. */
  drivers: string[];
  /** Flags worth raising, at most three. */
  flags: string[];
  /** Inputs that are not stated facts: what the numbers lean on. */
  assumptions: { label: string; source: string; needsEstimate: boolean; rationale: string }[];
}

export const usd = (n: number): string => {
  const r = Math.round(Math.abs(n)).toLocaleString('en-US');
  return n < 0 ? `($${r})` : `$${r}`;
};

export interface Detail {
  drivers?: { id: string; label: string; kind: string; low: number; high: number; swing: number }[];
  flags?: { kind: string; severity: string; message: string }[];
  inputs?: { id: string; label?: string; source: string; rationale?: string; needsEstimate?: boolean }[];
}

/**
 * Apply Bowman's materiality bars to a cost check's `detail` row: which drivers and flags the
 * statement should name. `spreadUsd` is p90 minus p10 of the 12-month net cost. Plain arithmetic on
 * the stored result; no judgment about the ECR.
 */
export function screenDetail(detail: Detail, spreadUsd: number, m = MATERIALITY): Screened {
  const drivers = (detail.drivers ?? [])
    .filter(d => (d.kind === 'decision' ? d.swing >= m.dispositionSwingUsd : spreadUsd > 0 && (d.swing / spreadUsd) * 100 >= m.driverMinSharePct))
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 3)
    .map(d =>
      d.kind === 'decision'
        ? `${d.label}: the choice moves the 12-month net cost between ${usd(d.low)} and ${usd(d.high)}, a swing of ${usd(d.swing)} (a decision, not a forecast spread)`
        : `${d.label}: moves the 12-month net cost between ${usd(d.low)} and ${usd(d.high)}, a swing of ${usd(d.swing)}, ${Math.round((d.swing / spreadUsd) * 100)}% of the forecast spread`
    );
  const rank = (s: string) => (s === 'error' ? 0 : s === 'warn' ? 1 : 2);
  const flags = (detail.flags ?? [])
    .filter(f => f.severity === 'error' || f.severity === 'warn' || f.kind === 'read_from_quote')
    .sort((a, b) => rank(a.severity) - rank(b.severity))
    .slice(0, m.maxFlagsPerStatement)
    .map(f => f.message);
  const assumptions = (detail.inputs ?? [])
    .filter(i => i.source !== 'given')
    .map(i => ({ label: i.label ?? i.id, source: i.source, needsEstimate: i.needsEstimate === true, rationale: (i.rationale ?? '').slice(0, 220) }))
    .sort((a, b) => Number(b.needsEstimate) - Number(a.needsEstimate));
  return { drivers, flags, assumptions };
}

export interface JobFacts {
  ecr: string;
  title: string;
  /** The change-request revision. */
  revision: number;
  s2RunId: number;
  /** "ERPNext baseline 2c02958e, as of 2026-10-24" and "change request rev 1 from the PLM". */
  baseline: string;
  changeRequest: string;
  numbers: HeadlineKey[];
  screened: Screened;
  /** What routing already decided, if anything. */
  routing: Routing;
}

export function jobPrompt(f: JobFacts): string {
  const list = (xs: string[], none: string) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : `- ${none}`);
  const tag = (a: Screened['assumptions'][number]) => (a.needsEstimate ? 'needs estimate' : a.source === 'agent_estimated' ? 'agent estimate' : 'default');
  const classLine = f.routing.class
    ? `"${f.routing.class}" (decided by Norn's routing; use it as given)`
    : `"Class I" or "Class II" only if you can give a one-line reason for it, since it is your proposal and the CM analyst decides; otherwise "Unclassified"`;
  const routeLine = f.routing.route
    ? `"${f.routing.route}" (decided by Norn's routing; use it as given)`
    : `"${ROUTE_PENDING}" (exactly this text: Norn does not route yet, so do not name a board or a tier)`;
  return `Write the Level 1 impact statement for ${f.ecr} ("${f.title}"), change-request revision ${f.revision}. Its numbers are from check run ${f.s2RunId} (s2_cost), computed on: ${f.baseline}; ${f.changeRequest}.

Read the ECR, its impact results and its assumptions first, then post one statement (level 1) shaped like this.

changeClass: ${classLine}.
route: ${routeLine}.
headline: the bottom line first, one or two sentences: what the change costs per aircraft, one time and over 12 months, as ranges, and your recommendation in a few words. At most 500 characters.
numbers: exactly these, each evidence "computation":
${f.numbers.map(n => `- key "${n.key}", resultKey "${n.resultKey}" (${n.label})`).join('\n')}
drivers: ${f.screened.drivers.length ? 'these clear the materiality bar; use up to three, each as {text, evidence "computation"}, in your own words and with the dollar figures as written here' : 'none clears the bar; leave the list empty'}:
${list(f.screened.drivers, 'none')}
assumptions: the keys from list_assumptions that this statement leans on, each with a short note; an empty list if list_assumptions returns none. Never invent a key.
claims, each {text, evidence}:
1. One judgment starting exactly "Recommendation: " followed by one of Approve, Approve with conditions, Send back, Reject, then a full stop and your reasoning in at most two sentences (evidence "judgment").${
    f.routing.class
      ? ''
      : `
2. If you propose a class: one judgment starting exactly "Proposed change class: " then the class and a one-line reason (evidence "judgment").`
  }
3. Two to four assumption lines (evidence "assumption"), each starting with its source in brackets: [default], [agent estimate] or [needs estimate]. [needs estimate] is for a cost-page line the originator left blank, which Norn counts as $0 until someone estimates it. Say how the numbers lean on it. Choose from these inputs, which are the ones that are not stated facts:
${list(f.screened.assumptions.map(a => `[${tag(a)}] ${a.label}${a.rationale ? ` (${a.rationale})` : ''}`), 'none')}
4. These flags are worth raising; the blank-line ones are already covered by the [needs estimate] lines in 3, so do not repeat them (at most ${MATERIALITY.maxFlagsPerStatement} flags in total, counting those lines):
${list(f.screened.flags, 'none')}
5. Nothing else: no further claims, and no claim with evidence "fact" (the tool refuses it). Where a claim rests on something read from a source, end it with the source in brackets, for example "(source: ${f.changeRequest}; ${f.baseline})".

Likelihood words only from the scale. No other tools. One post.`;
}
