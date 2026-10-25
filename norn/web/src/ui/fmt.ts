import type { Figure, Unit } from '../assessment/types.ts';

/** The mock "now": Saturday 24 Oct 2026, 09:00 Pacific. Relative times on screen count from here. */
export const NOW = Date.parse('2026-10-24T09:00:00-07:00');

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole dollars; savings in parentheses, as on the ECP cost page. */
export function usd(n: number, opts: { cents?: boolean; plus?: boolean } = {}): string {
  const body = '$' + (opts.cents ? nf2 : nf0).format(Math.abs(n));
  if (n < 0 && Math.round(Math.abs(n) * 100) > 0) return `(${body})`;
  return opts.plus && n > 0 ? `+${body}` : body;
}

/** $317k, $1.6M. */
export function usdK(n: number, opts: { plus?: boolean } = {}): string {
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e6) {
    const m = (a / 1e6).toFixed(a >= 1e7 ? 0 : 2);
    s = '$' + (m.includes('.') ? m.replace(/\.?0+$/, '') : m) + 'M';
  } else if (a >= 1e4) s = '$' + Math.round(a / 1e3) + 'k';
  else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  else s = '$' + Math.round(a);
  if (n < 0) return `(${s})`;
  return opts.plus && n > 0 ? `+${s}` : s;
}

export function dateLong(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function dateShort(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
}
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

/** GitHub's wording: "5 days ago", "20 hours ago", "3 weeks ago". */
export function ago(iso: string): string {
  const s = Math.max(0, (NOW - Date.parse(iso)) / 1000);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (s < 90) return 'just now';
  if (s < 3600) return n(Math.round(s / 60), 'minute');
  if (s < 86400) return n(Math.round(s / 3600), 'hour');
  const d = Math.round(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 14) return n(d, 'day');
  if (d < 60) return n(Math.round(d / 7), 'week');
  return n(Math.round(d / 30), 'month');
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
}

/** `use` picks the number: the median, or the point estimate, which adds up across rows. */
export function fig(f: Figure, kind: 'full' | 'short' = 'full', plus = false, use: 'p50' | 'point' = 'p50'): string {
  return unitText(f.unit, use === 'point' ? f.point ?? f.p50 : f.p50, kind, plus);
}

export function unitText(unit: Unit, v: number, kind: 'full' | 'short' = 'full', plus = false): string {
  switch (unit) {
    // Cents below $1,000 and whole dollars above, as the checks format money (norn/checks/src/format.ts).
    case 'usd': return kind === 'short' ? usdK(v, { plus }) : usd(v, { plus, cents: Math.abs(v) < 1000 && Math.round(v * 100) !== 0 });
    case 'date': return kind === 'short' ? dateShort(v) : dateLong(v);
    case 'weeks': return `${nf0.format(v)} wk`;
    case 'percent': return `${nf0.format(v * 100)}%`;
    default: return nf0.format(v);
  }
}

/** "$276k – $396k", or empty when exact. */
export function range(f: Figure, kind: 'full' | 'short' = 'short'): string {
  if (f.p10 === undefined || f.p90 === undefined) return '';
  return `${unitText(f.unit, f.p10, kind)} – ${unitText(f.unit, f.p90, kind)}`;
}

export const initials = (name: string) =>
  name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** The number the cost page adds up: the point estimate, or the median when there is none. */
export const pointOf = (f: { point?: number; p50: number }) => f.point ?? f.p50;

/** Said wherever cost numbers are shown that belong to the previous revision of an ECR. */
export function staleNote(state: 'rechecking' | 'failed'): string {
  return state === 'failed' ? 'From the previous revision; the re-check failed.' : 'From the previous revision; Fern is checking the changed ECR again.';
}
