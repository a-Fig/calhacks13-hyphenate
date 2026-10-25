// The research agent's shapes: what it is asked (Target), what it proposes (Proposal), what the
// guardrails decide (Verdict). The agent proposes inputs; code decides which to use and computes
// every number (norn/ARCHITECTURE.md §3).

import type { AssumptionOverride, Range3 } from '../../checks/src/index.ts';
import type { Dist } from '../../checks/src/index.ts';

export type TargetKind = 'share' | 'usd' | 'weeks';
export type Unit = 'fraction' | 'usd' | 'weeks';
export const UNIT_OF: Record<TargetKind, Unit> = { share: 'fraction', usd: 'usd', weeks: 'weeks' };

/** One input worth researching, phrased with nothing that names the company. */
export interface Target {
  /** What the agent sees and echoes back: T1, T2, ... Never an input id, which can hold an item code. */
  key: string;
  /** The check's own input id, e.g. 'recovery:<item>'. Stays inside Norn. */
  inputId: string;
  kind: TargetKind;
  unit: Unit;
  /** A generic name for the quantity. */
  label: string;
  /** The question put to the agent, in generic terms. */
  question: string;
  /** What the check uses now, as quantiles. A blank cost-page row is `blank`. */
  current: Range3 | { blank: true };
  currentNote: string;
  /** Change in the year-one total (USD) when this input moves from its p10 to its p90. Null: not measurable (a blank row has no spread to move). */
  swing: number | null;
  swingBasis: 'driver' | 'rerun' | 'unmeasured';
}

export type ProposedDist =
  | { kind: 'quantiles'; p10: number; p50: number; p90: number }
  | { kind: 'pert'; min: number; mode: number; max: number };

/** What the agent returns for one target. Validated by `validateProposal`, never trusted as typed. */
export interface Proposal {
  targetId: string;
  value?: number;
  dist?: ProposedDist;
  unit: Unit;
  sourceUrl: string;
  quote: string;
  /** The date the source states for itself: its publication, last-updated or "prices as of" date (YYYY-MM-DD, YYYY-MM or YYYY). Omitted when the page states none. */
  sourceDate?: string;
  retrievedAt: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  queries: string[];
}

export interface AgentOutput {
  proposals: unknown[];
  unresolved: { targetId: string; reason: string }[];
}

export type Status = 'accepted' | 'rejected' | 'needs_person';

export interface Reason {
  code:
    | 'schema' | 'unknown_target' | 'duplicate_target' | 'unit_mismatch' | 'leak' | 'quote_missing'
    | 'quote_not_found' | 'page_unavailable' | 'out_of_bounds' | 'low_confidence' | 'bad_distribution'
    | 'stale_source' | 'flagged' | 'review_error' | 'quote_value';
  message: string;
}

export interface Flag {
  code: 'disagrees_with_current' | 'disagrees_with_history' | 'replaces_blank_row' | 'wide_range' | 'no_source_date';
  message: string;
}

export interface Verdict {
  /** Position in the agent's list. */
  index: number;
  targetId: string | null;
  status: Status;
  reasons: Reason[];
  /** What a person should look at. A proposal with any flag is held (needs_person), never applied. */
  flags: Flag[];
  /** Set on accepted proposals only. */
  override?: AssumptionOverride;
  /** The distribution the check will use, set whenever the proposal was well-formed. */
  dist?: Dist;
  /** The page the quote was checked against. */
  verifiedAgainst?: { url: string; retrievedAt: string; /** How the page was read: a plain HTTPS fetch, Bright Data, or a recording. */ via?: PageVia };
}

/** Fetches a page's text for quote verification. Live: Bright Data. Tests and replay: recorded pages. */
export type PageVia = 'fetch' | 'brightdata' | 'recorded';
export interface PageResult { ok: boolean; text?: string; retrievedAt?: string; error?: string; /** How it was read; absent in older fakes. */ via?: PageVia }
export type PageFetcher = (url: string) => Promise<PageResult>;
