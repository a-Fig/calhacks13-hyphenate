import type { BuiltAircraft, MonthStr, StdCostPoint, VolumeRow } from './types.ts';
import { ARCHER, INV, inv, src } from './prov.ts';

// Volume plan 2026-10 through 2030-12 (aircraft completed per month).
// Vesper: about 1 per month now, 2 per month in 2027, 6 per month in 2028, 650 per year at the
// Georgia plant around 2030 (exit rate 54 per month in December 2030 = 648 per year).
// Meridian: first flight 2027, first deliveries 2029, 24 per year by 2030.

const PLAN: Record<number, number[]> = {
  2026: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
  2027: [1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3], // 24
  2028: [4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 8, 8], // 72
  2029: [9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28], // 210
  2030: [35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 54, 54], // 548
};

const MERIDIAN: Record<number, number[]> = {
  2027: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], // first-flight article
  2028: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], // two conforming articles
  2029: [0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 2], // 8, first deliveries
  2030: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], // 24
};

const mm = (y: number, i: number): MonthStr => `${y}-${String(i + 1).padStart(2, '0')}`;

export const volumePlan: VolumeRow[] = [];
for (const [ys, units] of Object.entries(PLAN)) {
  const y = Number(ys);
  units.forEach((u, i) => {
    const month = mm(y, i);
    if (month < '2026-10' || u === 0) return;
    // California pilot line takes everything until the Georgia final line opens in 2028-07, then at most 6 per month.
    if (month < '2028-07') {
      volumePlan.push({ month, program: 'vesper', units: u, kind: 'production', site: 'CA' });
    } else {
      const ca = Math.min(u, 6);
      volumePlan.push({ month, program: 'vesper', units: ca, kind: 'production', site: 'CA' });
      if (u > ca) volumePlan.push({ month, program: 'vesper', units: u - ca, kind: 'production', site: 'GA' });
    }
  });
}
for (const [ys, units] of Object.entries(MERIDIAN)) {
  const y = Number(ys);
  units.forEach((u, i) => {
    if (u === 0) return;
    volumePlan.push({ month: mm(y, i), program: 'meridian', units: u, kind: y >= 2029 ? 'production' : 'development', site: y >= 2029 ? 'GA' : 'CA' });
  });
}

/** Aircraft built to date. S/N 001-004 are test aircraft; 005-010 are production, in the hangar and not delivered. */
export const builtAircraft: BuiltAircraft[] = [
  { program: 'vesper', serial: 1, completed: '2025-03-14', kind: 'test', site: 'CA', note: 'First conforming aircraft. Flight and structural test.' },
  { program: 'vesper', serial: 2, completed: '2025-05-30', kind: 'test', site: 'CA', note: 'Propulsion and endurance test.' },
  { program: 'vesper', serial: 3, completed: '2025-08-22', kind: 'test', site: 'CA', note: 'Systems and thermal test.' },
  { program: 'vesper', serial: 4, completed: '2025-11-07', kind: 'test', site: 'CA', note: 'Certification flight test.' },
  { program: 'vesper', serial: 5, completed: '2026-05-19', kind: 'production', site: 'CA', note: 'First production aircraft, in hangar awaiting delivery.' },
  { program: 'vesper', serial: 6, completed: '2026-06-23', kind: 'production', site: 'CA', note: 'In hangar.' },
  { program: 'vesper', serial: 7, completed: '2026-07-21', kind: 'production', site: 'CA', note: 'In hangar.' },
  { program: 'vesper', serial: 8, completed: '2026-08-25', kind: 'production', site: 'CA', note: 'In hangar.' },
  { program: 'vesper', serial: 9, completed: '2026-09-22', kind: 'production', site: 'CA', note: 'In hangar.' },
  { program: 'vesper', serial: 10, completed: '2026-10-16', kind: 'production', site: 'CA', note: 'Final acceptance test complete, in hangar.' },
];

export const standardCostHistory: StdCostPoint[] = [
  { asOf: '2025-01-15', program: 'vesper', standardCostUsd: 3_460_000, note: 'Initial standard on production release of the BOM.' },
  { asOf: '2025-07-01', program: 'vesper', standardCostUsd: 3_310_000, note: 'Cell and avionics contract prices after first annual quotes.' },
  { asOf: '2026-01-01', program: 'vesper', standardCostUsd: 3_040_000, note: 'Annual standard-cost revision; labor hours reset after S/N 004.' },
  { asOf: '2026-07-01', program: 'vesper', standardCostUsd: 2_880_000, note: 'Mid-year roll-up.' },
  { asOf: '2026-10-01', program: 'vesper', standardCostUsd: 2_800_000, note: 'Current standard; rolled up from the BOM in this dataset.' },
  { asOf: '2026-06-30', program: 'meridian', standardCostUsd: 5_420_000, note: 'Design-to-cost baseline at the end of preliminary design.' },
  { asOf: '2026-10-01', program: 'meridian', standardCostUsd: 5_000_000, note: 'Current launch standard; rolled up from the BOM in this dataset.' },
];

/** Serial range completed in each future Vesper month, from the plan above. */
export function serialRanges(): { month: MonthStr; first: number; last: number }[] {
  const out: { month: MonthStr; first: number; last: number }[] = [];
  let n = builtAircraft.filter((a) => a.program === 'vesper').length;
  const byMonth = new Map<MonthStr, number>();
  for (const r of volumePlan) if (r.program === 'vesper') byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.units);
  for (const month of [...byMonth.keys()].sort()) {
    const u = byMonth.get(month)!;
    out.push({ month, first: n + 1, last: n + u });
    n += u;
  }
  return out;
}

export const volumeProv = src(`${ARCHER} "Suggested basis for Bowman"`, 'Rates are decided facts (1 per month now, 2 per month in 2027, 6 per month in 2028, 650 per year around 2030). Month-by-month shape and site split invented.');
export const builtProv = INV;
export const stdCostProv = inv('Current standards are the roll-up of this dataset ($2.8M Vesper, $5.0M Meridian are decided facts); earlier points invented.');
