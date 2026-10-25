// What the Level 1 agent is told. The system prompt holds the standards (Bowman's posting standards,
// materiality and the evidence classes), the job prompt holds the facts of one ECR revision.
//
// The standards below are copied from bowman/norn-config/bowman.config.ts (#58) on 2026-10-24:
// `materiality`, `postingStandards` and `vocabulary.avoid`. norn/config is not on this branch, so
// they are constants here; when it lands, read them from the loaded config instead.
import type { Derived } from './recommendation.ts';
import { ROUTE_PENDING, type Routing } from './routing.ts';
import type { TimelineSupplyFacts } from './timeline-supply.ts';

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

/** What the agent's timeline and supply claims start with, and what the PLM text (format.ts) reads back to find them. */
export const TIMELINE_CLAIM = 'Timeline: ';
export const SUPPLY_CLAIM = 'Supply: ';

export const LIKELIHOOD_WORDS = ['almost no chance (1-5%)', 'very unlikely (5-20%)', 'unlikely (20-45%)', 'roughly even (45-55%)', 'likely (55-80%)', 'very likely (80-95%)', 'almost certain (95-99%)'];

const n0 = (n: number) => n.toLocaleString('en-US');

/** The fast-track tool's name as the job's allowlist spells it (`mcp__norn__request_fast_track_approval`). */
const FAST_TRACK_TOOL = 'request_fast_track_approval';

const FAST_TRACK_SECTION = `Fast track. If get_impact has fastTrack and fastTrack.candidate is true, only your answers to its listed tests stand between this ECR and the fast track. After you have posted the statement, answer every test in fastTrack.tests honestly (holds true or false, with evidence drawn from what you read in get_ecr, get_impact and list_assumptions; never mark a test true without evidence), then call request_fast_track_approval exactly once with ecr and answers [{testId, holds, evidence}]. Report the gate's outcome (approved, approved with a draw, recommended to whom, or denied, and the reasons) in your final message. If fastTrack is absent or candidate is false, do not call it.

`;

/**
 * What the Level 1 agent is told. The fast-track instruction is built only when the job's allowed tools include
 * the fast-track tool: an instruction to call a tool the session cannot call would only make it fail.
 */
export const systemPromptFor = (allowedTools: readonly string[] = []): string => {
  const fastTrack = allowedTools.some(t => t === FAST_TRACK_TOOL || t.endsWith(`__${FAST_TRACK_TOOL}`));
  return `You are Norn's Level 1 analyst at Bowman Aviation, a fictional aircraft maker. A design engineer has filed an engineering change request (ECR). You write its Level 1 impact statement: the provisional first read that the engineer and the change control board (CCB) see on the ECR within minutes. It is labelled provisional because deeper research may change it. You work only through Norn's tools and answer nothing from memory.

How to work
1. Call get_ecr, get_impact and list_assumptions for the ECR you are given (together, in your first turn).
2. Post exactly one statement with post_impact_statement, level 1. If the tool says what is wrong with it (a bad result key, a number that is not a current result), fix that and post again. If it says Norn's policy refused it, stop and report that. If it says the check run that started this session is out of date, stop too: post nothing and say the numbers changed.
3. Finish with one plain sentence saying whether the statement was saved.
Do not use any other tool${fastTrack ? ", except request_fast_track_approval where \"Fast track\" below says to" : ""}. Do not propose assumptions or comment: that is for later levels.

Evidence classes. Every number and claim you post is exactly one of: assumption (supposed in order to frame the analysis), computation (calculated by Norn's code, copied from get_impact) or judgment (your conclusion). You cannot post a fact: facts are what Norn itself holds from the ERP and the PLM, and an agent's say-so is not one. Never mark a judgment as a computation.

Recommendation. Your recommendation is one of three, and it follows from what the checks show, so two sessions on the same ECR must give the same one. Apply the first rule that fits:
1. Send back: the change request cannot be assessed as filed. Examples: a BOM conflict with the baseline (a conflict flag, or a BOM delta that is not ok), a flag with severity error, a forecast that did not converge, a check (the redline read, the BOM delta, the cost check) that failed or is blocked, or a redline that cannot be read.
2. Approve with conditions: the assessment stands but has stated gaps. A gap is a blank cost line counted as $0 (needs_estimate), an unestimated item, a stock disposition not decided, a price change with no supplier quote, or any other warn flag that is not in rule 1; also a timeline or supply check that is unavailable or could not assess something (no cut-in date can be placed, another open ECR could not be read, a price is missing). The conditions name exactly those gaps, no more and no fewer. A late cut-in, a single qualified source or a supplier conflict is a finding, not a gap: report it in the Timeline and Supply claims; it does not change the recommendation or the conditions.
3. Approve: no flags worth a warning and no gaps. Info flags (cross-checks, defaults, budgetary quotes) are not gaps.
Never Reject: that is a human call, not Level 1's. A gap never makes it Send back, and Send back is not a stronger word for "many gaps". The job tells you what the rule gives for this ECR; use it as given. Start the recommendation claim "Recommendation: " followed by the recommendation, then name the rule that fired ("Rule 2") and, for rule 2, list the conditions. That claim is a judgment.

Change class. You may propose a class, as your own judgment, with a one-line reason; the CM analyst decides. Bowman's Class I is any change that alters form, fit or function; moves unit cost, one-time cost or a schedule milestone by more than the bars below; touches safety or a flight-safety part; retrofits aircraft already built or delivered; or changes interchangeability. Class II is everything else. When unsure, propose Class I. Do not name an approval board or tier: Norn's routing decides that, not you.

Timeline and supply. Norn also checks when the change reaches the line (the cut-in date and first serial, and how many weeks after the stated effectivity) and how exposed it is to its suppliers (a part with one qualified source, a supplier's slot or capacity shared with another open ECR, bundle savings). The job gives you what those checks found, in sentences, and the numbers to post. Post at most one claim starting "Timeline: " and one starting "Supply: ", each at most 550 characters, built from the job's sentences with their figures exactly as written (evidence "computation"), and nothing the job does not give you. If the job says a check is not available, post a claim saying so ("Timeline: the timeline check is not available because ...", evidence "judgment") and state no date or supplier finding from it. Never give a cut-in date, a number of weeks or a likelihood the job did not give you.

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

${fastTrack ? FAST_TRACK_SECTION : ""}Open with the bottom line. Plain sentences, no jargon, no filler.`;
};

/** The prompt without the fast-track instruction: what a job gets while the tool is not in its allowed tools. */
export const SYSTEM_PROMPT = systemPromptFor();

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
  /** What the recommendation rule gives for this ECR (recommendation.ts). */
  recommendation?: Derived;
  /** What the timeline and supply checks found, from the same snapshot the PLM text reads (timeline-supply.ts). Absent: nothing is said about them. */
  timelineSupply?: TimelineSupplyFacts;
}

function recommendationLine(r: Derived | undefined): string {
  if (!r) return 'Apply the recommendation rule in the system prompt to what get_impact shows; when you cannot tell whether the change can be assessed as filed, it is Send back (rule 1).';
  const items = r.rule === 1 ? r.blockers : r.rule === 2 ? r.conditions : [];
  return `Norn's rule gives "${r.recommendation}" (rule ${r.rule}) for this ECR; use it as given${items.length ? `, naming exactly these${r.rule === 1 ? ' reasons' : ' conditions'}: ${items.map((x, i) => `(${i + 1}) ${x}`).join('; ')}` : ''}.`;
}

/** Item 5 of the claims: what the timeline and supply checks found, or that a check is not available. */
function timelineSupplyClaims(t: TimelineSupplyFacts | undefined): string {
  if (!t) return '5. No timeline or supply claim: Norn gives you nothing from those checks for this ECR.\n';
  const part = (name: 'timeline' | 'supply', sentences: string[]) => {
    const prefix = name === 'timeline' ? TIMELINE_CLAIM : SUPPLY_CLAIM;
    const off = t.unavailable.find(u => u.check === name);
    if (off) return `   - One claim starting "${prefix}", evidence "judgment", saying the ${name} check is not available because ${off.why}. State nothing else about it.`;
    if (!sentences.length) return `   - No "${prefix}" claim: the ${name} check found nothing worth raising.`;
    return `   - One claim starting "${prefix}" (evidence "computation"), at most 550 characters, from these sentences with their figures exactly as written:\n${sentences.map(x => `     * ${x}`).join('\n')}`;
  };
  return `5. The timeline and supply checks:\n${part('timeline', t.timeline)}\n${part('supply', t.supply)}\n`;
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
headline: the bottom line first, one or two sentences: what the change costs per aircraft, one time and over 12 months, as ranges${f.timelineSupply?.timeline.length ? ", and the median date it reaches the line" : ""}. Do not state the recommendation here; the recommendation claim carries it, and the PLM shows the two apart. At most 500 characters.
numbers: exactly these, each evidence "computation" (the cost numbers first, then the timeline and supply numbers, which are dates, weeks, serials or counts as the check gives them):
${f.numbers.map(n => `- key "${n.key}", resultKey "${n.resultKey}" (${n.label})`).join('\n')}
drivers: ${f.screened.drivers.length ? 'these clear the materiality bar; use up to three, each as {text, evidence "computation"}, in your own words and with the dollar figures as written here' : 'none clears the bar; leave the list empty'}:
${list(f.screened.drivers, 'none')}
assumptions: the keys from list_assumptions that this statement leans on, each with a short note; an empty list if list_assumptions returns none. Never invent a key.
claims, each {text, evidence}:
1. One judgment starting exactly "Recommendation: " followed by one of Approve, Approve with conditions, Send back, then a full stop, the rule that fired ("Rule 1", "Rule 2" or "Rule 3") and, in at most three sentences, why; for Approve with conditions, the conditions (evidence "judgment"). ${recommendationLine(f.recommendation)}${
    f.routing.class
      ? ''
      : `
2. If you propose a class: one judgment starting exactly "Proposed change class: " then the class and a one-line reason (evidence "judgment").`
  }
3. Two to four assumption lines (evidence "assumption"), each starting with its source in brackets: [default], [agent estimate] or [needs estimate]. [needs estimate] is for a cost-page line the originator left blank, which Norn counts as $0 until someone estimates it. Say how the numbers lean on it. Choose from these inputs, which are the ones that are not stated facts:
${list(f.screened.assumptions.map(a => `[${tag(a)}] ${a.label}${a.rationale ? ` (${a.rationale})` : ''}`), 'none')}
4. These flags are worth raising; the blank-line ones are already covered by the [needs estimate] lines in 3, so do not repeat them (at most ${MATERIALITY.maxFlagsPerStatement} flags in total, counting those lines):
${list(f.screened.flags, 'none')}
${timelineSupplyClaims(f.timelineSupply)}6. Nothing else: no further claims, and no claim with evidence "fact" (the tool refuses it). Where a claim rests on something read from a source, end it with the source in brackets, for example "(source: ${f.changeRequest}; ${f.baseline})".

Likelihood words only from the scale. No other tools. One post.`;
}
