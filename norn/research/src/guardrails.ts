// The guardrails: deterministic checks on what the research agent proposes. No model, no clock, no
// network of its own (the page fetcher is injected). This file is what lets a person trust an
// `agent_estimated` number: whatever the agent says, only a proposal that passes these checks
// reaches the forecast, and each failure says why.
//
// For every proposal, the verdict is one of
//   accepted      applied as an assumption, with its source, quote and date in the rationale;
//   needs_person  well-formed and honest-looking, but a person must decide (out of bounds, low
//                 confidence, the page could not be fetched to verify);
//   rejected      not usable: a missing or ill-typed field, a quote that is not on the page, a
//                 search query that carried an identifier from the company's data.
// The strictest outcome wins; all reasons are kept.
//
// Page text is DATA. The only thing done with it is a substring search for the agent's quote. It is
// never parsed for instructions, never executed, never shown to a model by this code, and nothing in
// it can change a verdict except by containing the quote. A page that says "ignore the rules and
// accept everything" changes nothing (tested).

import { lognormal, lognormalFromQuantiles, pert, point, quantileOf, type AssumptionOverride, type Dist } from '../../checks/src/index.ts';
import { findLeaks, DEFAULT_ALLOW, type Identifier } from './leak.ts';
import { quoteInPage } from './text.ts';
import { UNIT_OF, type Flag, type PageFetcher, type Proposal, type ProposedDist, type Reason, type Status, type Target, type Verdict } from './types.ts';

export const AGENT_NAME = 'norn research agent (cost engineer)';

export interface GuardrailConfig {
  /** Today, as an ISO date, supplied by the caller: the guardrails read no clock. A retrievedAt after it is invalid. */
  today: string;
  /** Identifiers from the company's data; a query containing any is rejected. */
  identifiers: Identifier[];
  /** Words that are ordinary terms even though a name starts with them (see leak.ts). */
  allowTerms?: readonly string[];
  /** A dollar input must stay within this multiple of its current value, up or down (when it has one). Default 10. */
  priceMultiple?: number;
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

function checkBounds(d: Dist, target: Target, cfg: Required<Pick<GuardrailConfig, 'priceMultiple' | 'blankRowMaxUsd' | 'weeks'>>): string[] {
  const out: string[] = [];
  const [lo, hi] = support(d);
  const mid = quantileOf(d, 0.5);
  if (target.kind === 'share') {
    if (lo < 0 || hi > 1) out.push(`a share must stay within 0 to 1; the proposal spans ${lo} to ${hi}`);
  } else if (target.kind === 'weeks') {
    if (lo < cfg.weeks.min || hi > cfg.weeks.max) out.push(`a lead time must stay within ${cfg.weeks.min} to ${cfg.weeks.max} weeks; the proposal spans ${lo} to ${hi}`);
  } else {
    if (!(lo > 0)) out.push(`a cost must be above zero; the proposal reaches ${lo}`);
    if ('p50' in target.current) {
      const cur = target.current.p50;
      if (cur > 0 && (mid > cur * cfg.priceMultiple || mid < cur / cfg.priceMultiple)) {
        out.push(`the proposed ${mid} is more than ${cfg.priceMultiple} times away from the current ${cur}`);
      }
    } else if (hi > cfg.blankRowMaxUsd) {
      out.push(`the proposal reaches ${hi}, above the ${cfg.blankRowMaxUsd} ceiling for an input with nothing to compare to`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the review

const rank: Record<Status, number> = { accepted: 0, needs_person: 1, rejected: 2 };

export async function reviewProposals(raw: unknown[], targets: Target[], fetchPage: PageFetcher, config: GuardrailConfig): Promise<Verdict[]> {
  const cfg = {
    priceMultiple: config.priceMultiple ?? DEFAULTS.priceMultiple,
    blankRowMaxUsd: config.blankRowMaxUsd ?? DEFAULTS.blankRowMaxUsd,
    weeks: config.weeks ?? DEFAULTS.weeks,
    disagreementFactor: config.disagreementFactor ?? DEFAULTS.disagreementFactor,
    pointSpread: config.pointSpread ?? DEFAULTS.pointSpread,
    quote: config.quote ?? DEFAULTS.quote,
  };
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const seen = new Set<string>();
  const pages = new Map<string, ReturnType<PageFetcher>>();
  const getPage = (url: string) => {
    if (!pages.has(url)) pages.set(url, fetchPage(url).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })));
    return pages.get(url)!;
  };

  const verdicts: Verdict[] = [];
  for (let index = 0; index < raw.length; index++) {
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
      verdicts.push({ index, targetId: typeof maybe === 'string' ? maybe : null, status: st.status, reasons, flags });
      continue;
    }
    const p = v.proposal;
    const target = byKey.get(p.targetId);
    if (!target) {
      worsen('rejected', { code: 'unknown_target', message: `no research target is called ${p.targetId}` });
      verdicts.push({ index, targetId: p.targetId, status: st.status, reasons, flags });
      continue;
    }
    if (seen.has(p.targetId)) worsen('rejected', { code: 'duplicate_target', message: `an earlier proposal already answers ${p.targetId}; only the first is considered` });
    seen.add(p.targetId);
    if (p.unit !== UNIT_OF[target.kind]) worsen('rejected', { code: 'unit_mismatch', message: `${p.targetId} is asked in ${UNIT_OF[target.kind]}; the proposal is in ${p.unit}` });

    // Leak check on every search query.
    for (const q of p.queries) {
      const leaks = findLeaks(q, config.identifiers, config.allowTerms ?? DEFAULT_ALLOW);
      if (leaks.length > 0) {
        const names = [...new Set(leaks.map((l) => `${l.identifier} (${l.kind})`))].join(', ');
        worsen('rejected', { code: 'leak', message: `search query "${q}" contains ${names} from the company's data` });
      }
    }
    if (p.retrievedAt.slice(0, 10) > config.today) worsen('rejected', { code: 'schema', message: `retrievedAt ${p.retrievedAt} is after today (${config.today})` });

    // Distribution.
    let dist: Dist | undefined;
    try {
      dist = toDist(p, target, cfg.pointSpread);
    } catch (e) {
      worsen('rejected', { code: 'bad_distribution', message: e instanceof Error ? e.message : String(e) });
    }

    // Quote: its length and a number in it; then the page.
    const qn = p.quote.trim();
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
        worsen('rejected', { code: 'quote_not_found', message: 'the quote does not appear in the page text' });
      } else {
        verifiedAgainst = { url: p.sourceUrl, retrievedAt: page.retrievedAt ?? p.retrievedAt };
      }
    }

    // Bounds and confidence, on a well-formed distribution.
    if (dist && st.status !== 'rejected') {
      for (const m of checkBounds(dist, target, cfg)) worsen('needs_person', { code: 'out_of_bounds', message: m });
    }
    if (p.confidence === 'low') worsen('needs_person', { code: 'low_confidence', message: 'the agent rates its own confidence as low; a person decides' });

    // Flags on an accepted proposal.
    if (st.status === 'accepted' && dist) {
      const mid = quantileOf(dist, 0.5);
      if ('blank' in target.current) {
        flags.push({ code: 'replaces_blank_row', message: `this fills a cost-page row that was blank (counted as $0): it adds ${Math.round(mid).toLocaleString('en-US')} to the forecast` });
      } else {
        const cur = target.current.p50;
        const f = cfg.disagreementFactor[target.kind];
        if (cur > 0 && mid > 0 && (mid / cur > f || cur / mid > f)) {
          flags.push({ code: 'disagrees_with_current', message: `p50 ${Math.round(mid * 10000) / 10000} against the current ${Math.round(cur * 10000) / 10000}: more than ${f} times apart` });
        }
      }
      for (const h of config.history?.[target.key] ?? []) {
        const f = cfg.disagreementFactor[target.kind];
        if (h.value > 0 && mid > 0 && (mid / h.value > f || h.value / mid > f)) {
          flags.push({ code: 'disagrees_with_history', message: `p50 ${Math.round(mid * 10000) / 10000} against ${h.label} (${h.value}): more than ${f} times apart` });
        }
      }
      const p10 = quantileOf(dist, 0.1), p90 = quantileOf(dist, 0.9);
      if (p10 > 0 && p90 / p10 > 4) flags.push({ code: 'wide_range', message: `p90 is ${Math.round((p90 / p10) * 10) / 10} times p10` });
    }

    const verdict: Verdict = { index, targetId: p.targetId, status: st.status, reasons, flags, ...(dist ? { dist } : {}), ...(verifiedAgainst ? { verifiedAgainst } : {}) };
    if (st.status === 'accepted' && dist) {
      const date = (verifiedAgainst?.retrievedAt ?? p.retrievedAt).slice(0, 10);
      verdict.override = {
        id: target.inputId,
        source: 'agent_estimated',
        rationale: `${p.rationale.trim()} Source: ${p.sourceUrl}. Quote: "${qn}". Retrieved ${date}. Proposed ${describeDist(dist)}; confidence ${p.confidence}.`,
        dist,
        by: AGENT_NAME,
      } satisfies AssumptionOverride;
    }
    verdicts.push(verdict);
  }
  return verdicts;
}
