// Which inputs the seat should get from a person: every blank cost line, and every default whose
// swing on the window total is material. Everything else the seat settles from data or research.
import type { CostCheckResult } from '../../checks/src/cost.ts';
import type { AskRule, Gap, SeatDefinition } from './types.ts';

/** The rule that owns an input, by its label and id; undefined when no rule matches. */
export function ruleFor(seat: SeatDefinition, label: string, id: string): AskRule | undefined {
  const hay = `${label} ${id}`;
  return seat.asks.find((r) => new RegExp(r.match, 'i').test(hay));
}

/** The gaps in one cost run, most material first. Blank rows come before defaults, then by swing. */
export function findGaps(seat: SeatDefinition, cost: CostCheckResult): Gap[] {
  const gaps: Gap[] = [];
  const seen = new Set<string>();
  for (const [block, rows] of Object.entries(cost.blocks)) {
    for (const row of rows) {
      if (!row.needsEstimate || seen.has(row.id)) continue;
      seen.add(row.id);
      gaps.push({ inputId: row.id, label: row.label, kind: 'blank_row', swing: null, block, unit: ruleFor(seat, row.label, row.id)?.unit ?? 'usd' });
    }
  }
  const inputs = new Map(cost.inputs.map((i) => [i.id, i]));
  for (const d of cost.drivers) {
    if (d.kind !== 'input' || seen.has(d.id)) continue;
    const rec = inputs.get(d.id);
    if (!rec || rec.source !== 'default' || d.swing < seat.materialityUsd) continue;
    seen.add(d.id);
    gaps.push({ inputId: d.id, label: rec.label, kind: 'default', swing: d.swing, unit: ruleFor(seat, rec.label, d.id)?.unit ?? 'usd' });
  }
  return gaps.sort((a, b) => (a.kind === b.kind ? (b.swing ?? 0) - (a.swing ?? 0) : a.kind === 'blank_row' ? -1 : 1));
}
