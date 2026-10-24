// Dates as day numbers (days since 1970-01-01 UTC), and the volume plan as a list of planned
// completion days, one per serial. The timeline and supply checks compute on day numbers and turn
// them into ISO dates only to show them. Nothing here reads the clock: every date is anchored on
// the ECR's filing date or the plan, so a result is the same on any day.

import type { DateStr, MonthStr } from './types.ts';
import { addMonths, type SerialMonth } from './volume.ts';

const MS_PER_DAY = 86_400_000;

export const dayOf = (d: DateStr): number => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / MS_PER_DAY;
export const dateOf = (day: number): DateStr => new Date(Math.round(day) * MS_PER_DAY).toISOString().slice(0, 10);
export const monthOfDay = (day: number): MonthStr => dateOf(day).slice(0, 7);
export const monthStartDay = (m: MonthStr): number => dayOf(`${m}-01`);
export const monthLength = (m: MonthStr): number => monthStartDay(addMonths(m, 1)) - monthStartDay(m);

/** The same day-of-month n months on, or the last day of that month when it has no such day. */
export function addMonthsToDay(day: number, n: number): number {
  const d = new Date(Math.round(day) * MS_PER_DAY);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last)) / MS_PER_DAY;
}

/** Planned completion day of each serial from `first` on. Units are spread evenly through their month. */
export interface SerialTable {
  first: number;
  days: Float64Array;
}

export function serialTable(sm: SerialMonth[]): SerialTable {
  const days: number[] = [];
  for (const r of sm) {
    const u = r.last - r.first + 1;
    const start = monthStartDay(r.month);
    const len = monthLength(r.month);
    for (let k = 0; k < u; k++) days.push(start + ((k + 0.5) / u) * len);
  }
  return { first: sm[0]?.first ?? 1, days: Float64Array.from(days) };
}

/** The day a serial is planned to complete; undefined for a serial outside the plan. */
export function dayOfSerial(t: SerialTable, serial: number): number | undefined {
  const i = serial - t.first;
  return i >= 0 && i < t.days.length ? t.days[i] : undefined;
}

/** Number of planned units completed on or before a day. */
export function completedBy(t: SerialTable, day: number): number {
  let lo = 0;
  let hi = t.days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.days[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The first serial planned to complete on or after a day. Past the end of the plan: one beyond the last. */
export function serialAtDay(t: SerialTable, day: number): number {
  return t.first + completedBy(t, day - 1e-9);
}
