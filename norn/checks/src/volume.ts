// The volume plan as serial numbers, and the split of planned units at a change's cut-in
// (ARCHITECTURE.md §7: units before the cut-in keep the old part, units after get the new one).

import type { BuiltUnit, MonthStr, ProgramId, VolumeRow } from './types.ts';

export interface SerialMonth {
  month: MonthStr;
  first: number;
  last: number;
}

export function addMonths(month: MonthStr, n: number): MonthStr {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function lastBuiltSerial(built: BuiltUnit[], program: ProgramId): number {
  return built.filter((b) => b.program === program).reduce((m, b) => Math.max(m, b.serial), 0);
}

/**
 * Serial numbers completed in each planned month. Units completed before the plan's first month
 * are already built; numbering continues from them. A unit completed during the first plan month
 * is that month's planned unit, not an extra one.
 */
export function serialsByMonth(plan: VolumeRow[], built: BuiltUnit[], program: ProgramId): SerialMonth[] {
  const byMonth = new Map<MonthStr, number>();
  for (const r of plan) if (r.program === program) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.units);
  const months = [...byMonth.keys()].sort();
  if (months.length === 0) return [];
  const firstMonth = months[0];
  let n = built.filter((b) => b.program === program && b.completed.slice(0, 7) < firstMonth).length;
  const out: SerialMonth[] = [];
  for (const month of months) {
    const u = byMonth.get(month)!;
    if (u > 0) out.push({ month, first: n + 1, last: n + u });
    n += u;
  }
  return out;
}

export function monthOfSerial(sm: SerialMonth[], serial: number): MonthStr | undefined {
  return sm.find((r) => serial >= r.first && serial <= r.last)?.month;
}

/** The first serial completed in or after a month. */
export function firstSerialFrom(sm: SerialMonth[], month: MonthStr): number | undefined {
  return sm.find((r) => r.month >= month)?.first;
}

export interface CutIn {
  /** First serial that gets the change. */
  serial: number;
  /** Month that serial is planned to complete; undefined if the plan never reaches it. */
  month?: MonthStr;
}

/** Planned units at or after the cut-in, by calendar year, and inside a window of months. */
export function unitsAfterCutIn(sm: SerialMonth[], cut: CutIn, window?: { from: MonthStr; months: number }) {
  const byYear = new Map<string, number>();
  let inWindow = 0;
  let total = 0;
  const to = window ? addMonths(window.from, window.months) : undefined;
  for (const r of sm) {
    const lo = Math.max(r.first, cut.serial);
    const u = Math.max(0, r.last - lo + 1);
    if (u === 0) continue;
    total += u;
    const y = r.month.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + u);
    if (window && r.month >= window.from && r.month < to!) inWindow += u;
  }
  return { byYear, inWindow, total };
}
