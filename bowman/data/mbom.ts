import type { BomLine, Item, ItemCode, Mbom } from './types.ts';
import { programs, workCenters } from './company.ts';
import { bom, items } from './derive.ts';
import { inv } from './prov.ts';

// The manufacturing BOM (MBOM). The PLM keeps the engineering BOM (`bom`: the aircraft as designed). The ERP
// keeps the aircraft as built: the same sub-assemblies, parts and exploded quantities, but each program's top
// level is a short list of build stations instead of the design's twelve (or eleven) systems. A station is an
// ERP-only make item that groups the top-level children built at one point on the final assembly line and
// carries that part of the aircraft's own final-assembly labor, so the roll-up cost does not change.

interface StationPlan {
  /** Station number: 10, 20, ... */
  n: number;
  label: string;
  /** Final-assembly hours at this station. The stations of an aircraft add up to the top item's own hours. */
  hours: number;
  /** The aircraft's top-level children (by code) built here. */
  children: ItemCode[];
}

const PLAN: Record<ItemCode, StationPlan[]> = {
  // Vesper V4: 640 h of final assembly.
  'BW-0001-000': [
    { n: 10, label: 'structure join', hours: 120, children: ['BW-1000-000', 'BW-2000-000'] },
    { n: 20, label: 'propulsion and energy install', hours: 200, children: ['BW-3000-000', 'BW-3500-000', 'BW-6000-000'] },
    { n: 30, label: 'systems and avionics', hours: 220, children: ['BW-7000-000', 'BW-8000-000', 'BW-8200-000', 'BW-9100-000', 'BW-9300-100'] },
    { n: 40, label: 'interior and final', hours: 100, children: ['BW-9400-000', 'BW-9600-000'] },
  ],
  // Meridian M6: 900 h of final assembly.
  'BW-M000-000': [
    { n: 10, label: 'structure join', hours: 180, children: ['BW-M100-000', 'BW-M200-100'] },
    { n: 20, label: 'propulsion and energy install', hours: 280, children: ['BW-M300-000', 'BW-M400-000', 'BW-M500-000', 'BW-M600-000'] },
    { n: 30, label: 'systems and avionics', hours: 260, children: ['BW-M700-000', 'BW-M800-000', 'BW-M900-000'] },
    { n: 40, label: 'interior and final', hours: 180, children: ['BW-M950-000', 'BW-M990-100'] },
  ],
};

const cents = (x: number) => Math.round(x * 100) / 100;

/** Station item code: the top item's code with its `-000` suffix replaced by `-S<n>`. */
export const stationCode = (top: ItemCode, n: number): ItemCode => top.replace(/-000$/, `-S${n}`);

function build(): Mbom {
  const itemBy = new Map(items.map((i) => [i.code, i]));
  const rate = new Map(workCenters.map((w) => [w.id, w.laborRatePerHour]));
  const stationItems: Item[] = [];
  const lines: BomLine[] = [];
  for (const [top, stations] of Object.entries(PLAN)) {
    const topItem = itemBy.get(top)!;
    const program = programs.find((p) => p.topItem === top)!;
    const topLines = bom.filter((l) => l.parent === top);
    const placed = new Set(stations.flatMap((s) => s.children));
    if (placed.size !== topLines.length || !topLines.every((l) => placed.has(l.child))) throw new Error(`stations of ${top} do not place every top-level child exactly once`);
    if (stations.reduce((h, s) => h + s.hours, 0) !== topItem.laborHours) throw new Error(`station hours of ${top} do not add up to ${topItem.laborHours}`);
    const wc = topItem.workCenter!;
    for (const s of stations) {
      const code = stationCode(top, s.n);
      const kids = topLines.filter((l) => s.children.includes(l.child));
      const material = cents(kids.reduce((m, l) => m + l.qty * itemBy.get(l.child)!.standardCost, 0));
      const labor = cents(s.hours * rate.get(wc)!);
      stationItems.push({
        code, name: `${program.name}, Station ${s.n}: ${s.label}`, itemGroup: 'Build stations', costGroup: topItem.costGroup, kind: 'assembly', uom: 'Nos',
        makeBuy: 'make', rev: 'A', status: 'released', workCenter: wc, laborHours: s.hours, safetyCritical: false, programs: [program.id],
        standardCost: cents(material + labor), standardCostMaterial: material, standardCostLabor: labor,
        revHistory: [{ rev: 'A', date: '2025-01-15', note: 'ERP-only build station. The manufacturing BOM groups the top-level systems by station.' }],
        prov: inv('Station split invented: which systems are installed at which point of the final assembly line, and the hours at each. The hours add up to the aircraft\'s own final-assembly hours.'),
      });
      lines.push({ parent: top, child: code, qty: 1, seq: s.n });
      for (const l of kids) lines.push({ parent: code, child: l.child, qty: l.qty, seq: l.seq });
    }
  }
  return { items: stationItems, bom: lines };
}

export const mbom: Mbom = build();
