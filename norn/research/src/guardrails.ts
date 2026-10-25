// The guardrails: deterministic checks on what the research agent proposes. No model, no clock, no
// network of its own (the page fetcher is injected). This file is what lets a person trust an
// `agent_estimated` number: whatever the agent says, only a proposal that passes these checks
// reaches the forecast, and each failure says why.
//
// For every proposal, the verdict is one of
//   accepted      applied as an assumption, with its source, quote and date in the rationale.
//                 Only a proposal with no flag and no reason to hold it gets here;
//   needs_person  well-formed and honest-looking, but a person must decide (out of bounds, low
//                 confidence, a stale or undated source, any flag, the page could not be fetched
//                 to verify). Held, never applied;
//   rejected      not usable: a missing or ill-typed field, a quote that is not on the page, a
//                 search query or source URL that carried an identifier from the company's data,
//                 a range beyond what the current value allows.
// The strictest outcome wins; all reasons are kept.
//
// Page text is DATA. The only thing done with it is a substring search for the agent's quote. It is
// never parsed for instructions, never executed, never shown to a model by this code, and nothing in
// it can change a verdict except by containing the quote. A page that says "ignore the rules and
// accept everything" changes nothing (tested).

import { lognormal, lognormalFromQuantiles, pert, point, quantileOf, type AssumptionOverride, type Dist } from '../../checks/src/index.ts';
import { findLeaks, findUrlLeaks, DEFAULT_ALLOW, type Identifier } from './leak.ts';
import { quoteInPage } from './text.ts';
import { quotedValues, quoteStates } from './quotevalue.ts';
import { UNIT_OF, type Flag, type PageFetcher, type Proposal, type ProposedDist, type Reason, type Status, type Target, type Verdict } from './types.ts';

export const AGENT_NAME = 'norn research agent (cost engineer)';

export interface GuardrailConfig {
  /** Today, as an ISO date, supplied by the caller: the guardrails read no clock. A retrievedAt after it is invalid. */
  today: string;
  /** Identifiers from the company's data; a query containing any is rejected. */
  identifiers: Identifier[];
  /** Words that are ordinary terms even though a name starts with them (see leak.ts). */
  allowTerms?: readonly string[];
  /**
   * A dollar input must stay within this multiple of its current value, up or down (when it has one).
   * Default 10. A median further away is held for a person; a median within it but a range whose
   * p90 is above the multiple of the current p90, or whose p10 is below the current p10 divided by
   * it, is rejected.
   */
  priceMultiple?: number;
  /**
   * The quote's own figure, with its unit and scale, must equal the value the agent proposes (its
   * `value`, the p50 of quantiles, or the mode of a PERT). A quote can be on the page and say
   * nothing about the amount: one that does not state it holds the proposal for a person. Default
   * true; a proposal derived by arithmetic from page figures is therefore held.
   */
  quoteMustStateValue?: boolean;
  /** A source dated more than this many years before today is held as stale. Default 3. */
  maxSourceAgeYears?: number;
  /** Ceiling for a dollar input with nothing to compare to, such as a blank row. Default 1,000,000. */
  blankRowMaxUsd?: number;
  /** Lead time bounds in weeks. Default [0, 104]. */
  weeks?: { min: number; max: number };
  /** Accepted, but flagged for a person, when the proposal's p50 is further than this factor from the current p50. Defaults: share 3, usd 2, weeks 2. */
  disagreementFactor?: { share: number; usd: number; weeks: number };
  /** Reference values from the company's own history, by target key: a proposal far from them is flagged. */
  history?: Record<string, { label: string; value: number }[]>;
  /** Spread (log-space) of a single value, which has no range of its own. Default 0.25, the check's 'agent_estimated' spread. */
  pointSpread?: number;
  quote?: { minChars: number; maxChars: number };
}

const DEFAULTS = {
  priceMultiple: 10,
  maxSourceAgeYears: 3,
  blankRowMaxUsd: 1_000_000,
  weeks: { min: 0, max: 104 },
  disagreementFactor: { share: 3, usd: 2, weeks: 2 },
  pointSpread: 0.25,
  quote: { minChars: 20, maxChars: 600 },
};

// ---------------------------------------------------------------- schema

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s) && !Number.isNaN(Date.parse(s));

/** The first and last day a source date covers: 2024 is 2024-01-01 to 2024-12-31, 2024-02 is 2024-02-01 to 2024-02-29. Null when it is not a date. */
export function parseSourceDate(s: unknown): { start: string; end: string } | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T[\d:.]+Z?)?$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] === undefined ? 12 : Number(m[2]);
  if (month < 1 || month > 12 || year < 1000) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (m[3] !== undefined && (Number(m[3]) < 1 || Number(m[3]) > last)) return null;
  const mm = String(month).padStart(2, '0');
  const dd = (d: number) => String(d).padStart(2, '0');
  return {
    start: `${m[1]}-${m[2] === undefined ? '01' : mm}-${m[3] === undefined ? '01' : m[3]}`,
    end: `${m[1]}-${mm}-${m[3] === undefined ? dd(last) : m[3]}`,
  };
}

/** The date `years` years before `iso`, as an ISO date (29 February becomes 28 February). */
function yearsBefore(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y - years, m, 0)).getUTCDate();
  return `${String(y - years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function validateProposal(raw: unknown): { ok: true; proposal: Proposal } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['the proposal is not an object'] };
  const p = raw as Record<string, unknown>;
  if (!isStr(p.targetId)) errors.push('targetId is missing');
  const hasValue = p.value !== undefined && p.value !== null;
  const hasDist = p.dist !== undefined && p.dist !== null;
  if (hasValue === hasDist) errors.push('exactly one of value and dist is required');
  if (hasValue && !isNum(p.value)) errors.push('value must be a finite number');
  if (hasDist) {
    const d = p.dist as Record<string, unknown>;
    if (typeof d !== 'object' || d === null) errors.push('dist must be an object');
    else if (d.kind === 'quantiles') {
      if (!isNum(d.p10) || !isNum(d.p50) || !isNum(d.p90)) errors.push('dist.quantiles needs numeric p10, p50 and p90');
    } else if (d.kind === 'pert') {
      if (!isNum(d.min) || !isNum(d.mode) || !isNum(d.max)) errors.push('dist.pert needs numeric min, mode and max');
    } else errors.push("dist.kind must be 'quantiles' or 'pert'");
  }
  if (p.unit !== 'fraction' && p.unit !== 'usd' && p.unit !== 'weeks') errors.push("unit must be 'fraction', 'usd' or 'weeks'");
  if (!isStr(p.sourceUrl)) errors.push('sourceUrl is missing');
  else {
    try {
      const u = new URL(p.sourceUrl as string);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') errors.push('sourceUrl must be an http(s) URL');
    } catch {
      errors.push('sourceUrl is not a URL');
    }
  }
  if (!isStr(p.quote)) errors.push('quote is missing');
  if (!isIsoDate(p.retrievedAt)) errors.push('retrievedAt must be an ISO date');
  if (p.sourceDate !== undefined && p.sourceDate !== null && parseSourceDate(p.sourceDate) === null) errors.push('sourceDate must be YYYY-MM-DD, YYYY-MM or YYYY, or left out when the page states no date');
  if (p.confidence !== 'low' && p.confidence !== 'medium' && p.confidence !== 'high') errors.push("confidence must be 'low', 'medium' or 'high'");
  if (!isStr(p.rationale)) errors.push('rationale is missing');
  if (!Array.isArray(p.queries) || p.queries.length === 0 || !p.queries.every((q) => typeof q === 'string' && q.trim() !== '')) errors.push('queries must be a non-empty list of the search queries used');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposal: p as unknown as Proposal };
}

// ---------------------------------------------------------------- distribution and bounds

/** The distribution a proposal stands for. A single value gets the spread an agent's estimate gets in the check. */
export function toDist(p: Proposal, target: Target, pointSpread = DEFAULTS.pointSpread): Dist {
  if (p.dist) {
    const d: ProposedDist = p.dist;
    if (d.kind === 'pert') {
      if (!(d.min <= d.mode && d.mode <= d.max)) throw new Error('needs min <= mode <= max');
      return pert(d.min, d.mode, d.max);
    }
    if (target.kind === 'share') throw new Error('a share needs a pert {min, mode, max}: quantiles of a bounded share are not accepted');
    return lognormalFromQuantiles(d.p10, d.p50, d.p90);
  }
  const v = p.value!;
  if (target.kind === 'share') return v === 0 ? point(0) : pert(v / 2, v, Math.max(v, Math.min(1, v * 2)));
  return lognormal(v, pointSpread);
}

function describeDist(d: Dist): string {
  const q = (x: number) => Math.round(x * 10000) / 10000;
  return `p10 ${q(quantileOf(d, 0.1))}, p50 ${q(quantileOf(d, 0.5))}, p90 ${q(quantileOf(d, 0.9))}`;
}

/** The range a distribution can reach: exact for a point or a bounded shape, the 0.1% and 99.9% points for a lognormal, which has no bounds. */
function support(d: Dist): [number, number] {
  switch (d.kind) {
    case 'point': return [d.value, d.value];
    case 'pert':
    case 'triangular': return [d.min, d.max];
    case 'lognormal': return [quantileOf(d, 0.001), quantileOf(d, 0.999)];
  }
}

/** Why a distribution cannot be used, or null. Every quantile the review reads must be a finite number. */
function distProblem(d: Dist): string | null {
  try {
    for (const q of [0.001, 0.1, 0.5, 0.9, 0.999]) {
      const x = quantileOf(d, q);
      if (!Number.isFinite(x)) return `the distribution has a non-finite ${Math.round(q * 1000) / 10}% point`;
    }
    const [lo, hi] = support(d);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 'the distribution has no finite range';
    return null;
  } catch (e) {
    return `the distribution cannot be evaluated (${e instanceof Error ? e.message : String(e)})`;
  }
}

interface Bounds { hold: string[]; reject: string[] }

function checkBounds(d: Dist, target: Target, cfg: Required<Pick<GuardrailConfig, 'priceMultiple' | 'blankRowMaxUsd' | 'weeks'>>): Bounds {
  const out: Bounds = { hold: [], reject: [] };
  const [lo, hi] = support(d);
  const mid = quantileOf(d, 0.5);
  if (target.kind === 'share') {
    if (lo < 0 || hi > 1) out.hold.push(`a share must stay within 0 to 1; the proposal spans ${lo} to ${hi}`);
  } else if (target.kind === 'weeks') {
    if (lo < cfg.weeks.min || hi > cfg.weeks.max) out.hold.push(`a lead time must stay within ${cfg.weeks.min} to ${cfg.weeks.max} weeks; the proposal spans ${lo} to ${hi}`);
  } else {
    if (!(lo > 0)) out.hold.push(`a cost must be above zero; the proposal reaches ${lo}`);
    if ('p50' in target.current) {
      const cur = target.current;
      const m = cfg.priceMultiple;
      if (cur.p50 > 0 && (mid > cur.p50 * m || mid < cur.p50 / m)) {
        out.hold.push(`the proposed ${mid} is more than ${m} times away from the current ${cur.p50}`);
      } else {
        // The median is plausible; the range around it must be too.
        const p10 = quantileOf(d, 0.1), p90 = quantileOf(d, 0.9);
        if (cur.p90 > 0 && p90 > cur.p90 * m) out.reject.push(`the proposed p90 ${p90} is more than ${m} times the current p90 ${cur.p90}`);
        if (cur.p10 > 0 && p10 < cur.p10 / m) out.reject.push(`the proposed p10 ${p10} is less than 1/${m} of the current p10 ${cur.p10}`);
      }
    } else if (hi > cfg.blankRowMaxUsd) {
      out.hold.push(`the proposal reaches ${hi}, above the ${cfg.blankRowMaxUsd} ceiling for an input with nothing to compare to`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the review

const rank: Record<Status, number> = { accepted: 0, needs_person: 1, rejected: 2 };

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export async function reviewProposals(raw: unknown[], targets: Target[], fetchPage: PageFetcher, config: GuardrailConfig): Promise<Verdict[]> {
  const cfg = {
    priceMultiple: config.priceMultiple ?? DEFAULTS.priceMultiple,
    blankRowMaxUsd: config.blankRowMaxUsd ?? DEFAULTS.blankRowMaxUsd,
    weeks: config.weeks ?? DEFAULTS.weeks,
    disagreementFactor: config.disagreementFactor ?? DEFAULTS.disagreementFactor,
    pointSpread: config.pointSpread ?? DEFAULTS.pointSpread,
    quote: config.quote ?? DEFAULTS.quote,
    maxSourceAgeYears: config.maxSourceAgeYears ?? DEFAULTS.maxSourceAgeYears,
    quoteMustStateValue: config.quoteMustStateValue ?? true,
  };
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const seen = new Set<string>();
  const pages = new Map<string, ReturnType<PageFetcher>>();
  const getPage = (url: string) => {
    if (!pages.has(url)) pages.set(url, fetchPage(url).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })));
    return pages.get(url)!;
  };

  async function reviewOne(index: number): Promise<Verdict> {
    const reasons: Reason[] = [];
    const flags: Flag[] = [];
    const st = { status: 'accepted' as Status };
    const worsen = (s: Status, r: Reason) => {
      reasons.push(r);
      if (rank[s] > rank[st.status]) st.status = s;
    };
    const v = validateProposal(raw[index]);
    if (!v.ok) {
      const maybe = (raw[index] as { targetId?: unknown } | null)?.targetId;
      for (const e of v.errors) worsen('rejected', { code: 'schema', message: e });
      return { index, targetId: typeof maybe === 'string' ? maybe : null, status: st.status, reasons, flags };
    }
    const p = v.proposal;
    const target = byKey.get(p.targetId);
    if (!target) {
      worsen('rejected', { code: 'unknown_target', message: `no research target is called ${p.targetId}` });
      return { index, targetId: p.targetId, status: st.status, reasons, flags };
    }
    if (seen.has(p.targetId)) worsen('rejected', { code: 'duplicate_target', message: `an earlier proposal already answers ${p.targetId}; only the first is considered` });
    seen.add(p.targetId);
    if (p.unit !== UNIT_OF[target.kind]) worsen('rejected', { code: 'unit_mismatch', message: `${p.targetId} is asked in ${UNIT_OF[target.kind]}; the proposal is in ${p.unit}` });

    // Leak check on every search query the agent says it ran (the real calls are checked as they
    // are made: see researchToolGuards in job.ts), and on the source URL, which the page check
    // would send to the fetch service.
    const allow = config.allowTerms ?? DEFAULT_ALLOW;
    for (const q of p.queries) {
      const leaks = findLeaks(q, config.identifiers, allow);
      if (leaks.length > 0) {
        const names = [...new Set(leaks.map((l) => `${l.identifier} (${l.kind})`))].join(', ');
        worsen('rejected', { code: 'leak', message: `search query "${q}" contains ${names} from the company's data` });
      }
    }
    const urlLeaks = findUrlLeaks(p.sourceUrl, config.identifiers, allow);
    if (urlLeaks.length > 0) {
      const names = [...new Set(urlLeaks.map((l) => `${l.identifier} (${l.kind})`))].join(', ');
      worsen('rejected', { code: 'leak', message: `the source URL contains ${names} from the company's data, so it was not fetched` });
    }
    if (p.retrievedAt.slice(0, 10) > config.today) worsen('rejected', { code: 'schema', message: `retrievedAt ${p.retrievedAt} is after today (${config.today})` });

    // Age of the source, when it states a date. A period counts up to its last day for age, from its first day for "in the future".
    const stated = p.sourceDate == null ? null : parseSourceDate(p.sourceDate);
    if (stated !== null) {
      if (stated.start > config.today) {
        worsen('rejected', { code: 'schema', message: `sourceDate ${p.sourceDate} is after today (${config.today})` });
      } else if (stated.end < yearsBefore(config.today, cfg.maxSourceAgeYears)) {
        worsen('needs_person', { code: 'stale_source', message: `stale source: the page is dated ${p.sourceDate}, more than ${cfg.maxSourceAgeYears} years before ${config.today}` });
      }
    }

    // Distribution: it must convert, and every quantile the review reads must be a finite number.
    let dist: Dist | undefined;
    try {
      dist = toDist(p, target, cfg.pointSpread);
    } catch (e) {
      worsen('rejected', { code: 'bad_distribution', message: e instanceof Error ? e.message : String(e) });
    }
    if (dist) {
      const problem = distProblem(dist);
      if (problem) {
        worsen('rejected', { code: 'bad_distribution', message: problem });
        dist = undefined;
      }
    }

    // Quote: its length and a number in it; then the page.
    const qn = p.quote.trim();
    if (cfg.quoteMustStateValue && dist) {
      const proposed = p.value ?? (p.dist?.kind === 'quantiles' ? p.dist.p50 : p.dist?.kind === 'pert' ? p.dist.mode : undefined);
      if (proposed !== undefined && !quoteStates(qn, proposed, p.unit)) {
        const stated = quotedValues(qn, p.unit).map((x) => round4(x));
        worsen('needs_person', { code: 'quote_value', message: `quote does not state the proposed value: the quote states ${stated.length ? stated.join(', ') : 'no figure'} (in ${p.unit}); the proposal is ${round4(proposed)}` });
      }
    }
    let verifiedAgainst: Verdict['verifiedAgainst'];
    if (qn.length < cfg.quote.minChars || qn.length > cfg.quote.maxChars) {
      worsen('rejected', { code: 'quote_missing', message: `the quote has ${qn.length} characters; it must have ${cfg.quote.minChars} to ${cfg.quote.maxChars}` });
    } else if (!/\d/.test(qn)) {
      worsen('rejected', { code: 'quote_missing', message: 'the quote contains no number, so it cannot support one' });
    } else if (st.status !== 'rejected') {
      const page = await getPage(p.sourceUrl);
      if (!page.ok || page.text === undefined) {
        worsen('needs_person', { code: 'page_unavailable', message: `the page could not be fetched to verify the quote (${page.error ?? 'no text'})` });
      } else if (!quoteInPage(qn, page.text)) {
        worsen('rejected', { code: 'quote_not_found', message: 'the quote does not appear in the page text, or it starts or ends in the middle of a number on the page' });
      } else {
        verifiedAgainst = { url: p.sourceUrl, retrievedAt: page.retrievedAt ?? p.retrievedAt };
      }
    }

    // Bounds and confidence, on a well-formed distribution.
    if (dist && st.status !== 'rejected') {
      const b = checkBounds(dist, target, cfg);
      for (const m of b.reject) worsen('rejected', { code: 'out_of_bounds', message: m });
      for (const m of b.hold) worsen('needs_person', { code: 'out_of_bounds', message: m });
    }
    if (p.confidence === 'low') worsen('needs_person', { code: 'low_confidence', message: 'the agent rates its own confidence as low; a person decides' });

    // Flags: anything a person should look at. A flagged proposal is held, not applied.
    if (st.status === 'accepted' && dist) {
      const mid = quantileOf(dist, 0.5);
      if ('blank' in target.current) {
        flags.push({ code: 'replaces_blank_row', message: `this fills a cost-page row that was blank (counted as $0): it adds ${Math.round(mid).toLocaleString('en-US')} to the forecast` });
      } else {
        const cur = target.current.p50;
        const f = cfg.disagreementFactor[target.kind];
        if (cur > 0 && mid > 0 && (mid / cur > f || cur / mid > f)) {
          flags.push({ code: 'disagrees_with_current', message: `p50 ${round4(mid)} against the current ${round4(cur)}: more than ${f} times apart` });
        }
      }
      for (const h of config.history?.[target.key] ?? []) {
        const f = cfg.disagreementFactor[target.kind];
        if (h.value > 0 && mid > 0 && (mid / h.value > f || h.value / mid > f)) {
          flags.push({ code: 'disagrees_with_history', message: `p50 ${round4(mid)} against ${h.label} (${h.value}): more than ${f} times apart` });
        }
      }
      const p10 = quantileOf(dist, 0.1), p90 = quantileOf(dist, 0.9);
      if (p10 > 0 && p90 / p10 > 4) flags.push({ code: 'wide_range', message: `p90 is ${Math.round((p90 / p10) * 10) / 10} times p10` });
      if (stated === null) flags.push({ code: 'no_source_date', message: 'the proposal states no date for the source, so its age is unknown' });
      if (flags.length > 0) worsen('needs_person', { code: 'flagged', message: `not applied, flagged for ${flags.map((f) => f.code).join(', ')}` });
    }

    const verdict: Verdict = { index, targetId: p.targetId, status: st.status, reasons, flags, ...(dist ? { dist } : {}), ...(verifiedAgainst ? { verifiedAgainst } : {}) };
    if (st.status === 'accepted' && dist && flags.length === 0) {
      const date = (verifiedAgainst?.retrievedAt ?? p.retrievedAt).slice(0, 10);
      verdict.override = {
        id: target.inputId,
        source: 'agent_estimated',
        rationale: `${p.rationale.trim()} Source: ${p.sourceUrl}${p.sourceDate ? ` (dated ${p.sourceDate})` : ''}. Quote: "${qn}". Retrieved ${date}. Proposed ${describeDist(dist)}; confidence ${p.confidence}.`,
        dist,
        by: AGENT_NAME,
      } satisfies AssumptionOverride;
    }
    return verdict;
  }

  const verdicts: Verdict[] = [];
  for (let index = 0; index < raw.length; index++) {
    // One bad proposal never ends the review: whatever goes wrong inside this call rejects that
    // proposal with a reason, and the next one is read.
    try {
      verdicts.push(await reviewOne(index));
    } catch (e) {
      const maybe = (raw[index] as { targetId?: unknown } | null)?.targetId;
      verdicts.push({
        index,
        targetId: typeof maybe === 'string' ? maybe : null,
        status: 'rejected',
        reasons: [{ code: 'review_error', message: `the proposal could not be reviewed: ${e instanceof Error ? e.message : String(e)}` }],
        flags: [],
      });
    }
  }
  return verdicts;
}
