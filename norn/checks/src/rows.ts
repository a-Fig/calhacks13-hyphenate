// Check results as rows the state layer stores: one row per number, with p10/p50/p90 and the rest
// (point estimate, mean, trace) in `detailJson`. The row shape matches the skeleton worker's
// `Result` (norn/workers/src/stages.ts), so wiring this in is a mapping, not a migration.

import type { BomDeltaResult } from './bom.ts';
import type { CostCheckResult, Money } from './cost.ts';
import { COST_BLOCKS } from './types.ts';

/** The key of the row that holds the cost measure for this horizon and savings rule (see costCheckRows). */
export const costMeasureKey = (horizonMonths: number, savingsOffset: boolean): string => `cost_measure:${horizonMonths}:${savingsOffset ? 'net' : 'larger'}`;

export interface CheckResultRow {
  key: string;
  label: string;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  detailJson: string;
}

const moneyRow = (key: string, label: string, m: Money, extra: object = {}): CheckResultRow => ({
  key, label, unit: 'USD', p10: m.p10, p50: m.p50, p90: m.p90,
  detailJson: JSON.stringify({ point: m.point, mean: m.mean, trace: m.trace, ...extra }),
});

const countRow = (key: string, label: string, unit: string, n: number, detail: object): CheckResultRow => ({
  key, label, unit, p10: n, p50: n, p90: n, detailJson: JSON.stringify(detail),
});

export function bomDeltaRows(r: BomDeltaResult): CheckResultRow[] {
  return [
    countRow('bom_lines_changed', 'BOM lines changed', 'lines', r.bom.length, { lines: r.bom, trace: r.trace }),
    countRow('items_changed', 'Items changed', 'items', r.items.length, { items: r.items, trace: r.trace }),
    countRow('affected_programs', 'Programs affected', 'programs', r.affected.programs.length, { affected: r.affected, programs: r.programs, trace: r.trace }),
    countRow('conflicts', 'Conflicts with the baseline', 'conflicts', r.conflicts.length, { conflicts: r.conflicts, trace: r.trace }),
  ];
}

export function costCheckRows(r: CostCheckResult): CheckResultRow[] {
  const h = r.headline;
  const out: CheckResultRow[] = [
    ...h.unitCostDelta.map((u) => moneyRow(`unit_cost_delta:${u.program}`, `Unit cost change per unit, ${u.program}`, u.perUnit)),
    moneyRow('one_time_total', 'One-time cost', h.oneTimeTotal),
    moneyRow('recurring_year_one', 'Recurring cost, year one', h.recurringWindow, { window: r.window }),
    moneyRow('net_total_year_one', 'Net cost, year one', h.windowTotal, { window: r.window }),
    moneyRow('net_total_plan', 'Net cost over the volume plan', h.planTotal),
  ];
  for (const b of COST_BLOCKS) {
    for (const row of r.blocks[b]) {
      out.push(moneyRow(`line:${row.id}`, row.label, row.total, { block: b, recurring: row.recurring, basis: row.basis, quantity: row.quantity, oneTime: row.oneTime, unitCost: row.unitCost, needsEstimate: row.needsEstimate ?? false }));
    }
    out.push(moneyRow(`block:${b}`, `Subtotal, ${b}`, r.blockTotals[b].total));
  }
  for (const p of r.periods) out.push(moneyRow(`period:${p.program}:${p.period}`, `Recurring, ${p.program}, ${p.period}`, p.recurring, { units: p.units }));
  // The cost measures an approval rule asked for. The row's p50 and p90 are the measure's own (computed per draw,
  // not from the rows above); the measure has no p10, so p10 repeats p50. The full measure is in the detail, which
  // is what a reader checks (source, horizon, savingsOffset) before relying on it. One that could not be
  // computed has no row: it is in the detail row's `measures`.
  for (const m of r.measures) {
    if (m.source !== 'exact') continue;
    out.push({
      key: costMeasureKey(m.horizonMonths, m.savingsOffset),
      label: `Cost measure, ${m.horizonMonths} months, ${m.savingsOffset ? 'net of savings' : 'larger of spend and saving'}`,
      unit: 'USD',
      p10: m.p50,
      p50: m.p50,
      p90: m.p90,
      detailJson: JSON.stringify({ ...m, note: 'p10 repeats p50: the measure is summarised at p50 and p90 only' }),
    });
  }
  // Everything a trace points at, and what the card needs besides the numbers, in one row.
  out.push({
    key: 'detail', label: 'Inputs, flags and supporting results', unit: 'json', p10: 0, p50: 0, p90: 0,
    detailJson: JSON.stringify({
      codeVersion: r.codeVersion, seed: r.seed, draws: r.draws, correlation: r.correlation, window: r.window, bomDelta: r.bomDelta,
      inputs: r.inputs, flags: r.flags, drivers: r.drivers, convergence: r.convergence, effectivity: r.effectivity,
      inventory: r.inventory, unitCost: r.unitCost, piecePrices: r.piecePrices, measures: r.measures,
    }),
  });
  return out;
}
