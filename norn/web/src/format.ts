import type { Identity, Timestamp } from 'spacetimedb';
import type { DbConnection } from '@norn/bindings';

// Business words for anything a user sees (docs/GLOSSARY.md). Stage ids stay internal.
export const STAGE_ORDER = ['s0_extract', 's1_bom_delta', 's2_cost', 's3_timeline', 's4_supply', 's5_card'] as const;

export const STAGE_LABEL: Record<string, string> = {
  s0_extract: 'Read the ECR text',
  s1_bom_delta: 'Bill of materials change',
  s2_cost: 'Unit cost',
  s3_timeline: 'Time to the line',
  s4_supply: 'Supply risk',
  s5_card: 'Change impact statement',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  merged: 'ECO released',
  closed: 'Closed',
};

export function ts(t: Timestamp | undefined): string {
  if (!t) return '';
  const d = t.toDate();
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function num(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '–';
  return x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export const short = (hex: string | undefined | null) => (hex ? hex.slice(0, 8) : '');

/** A person's or agent's current name; who did something is stored as an identity, names are looked up. */
export function nameOf(conn: DbConnection, who: Identity): string {
  return conn.db.principal.identity.find(who)?.name ?? short(who.toHexString());
}
