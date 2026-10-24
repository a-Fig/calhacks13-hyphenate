// Check results as rows the state layer stores: one row per number, with p10/p50/p90 and the rest
// (point estimate, mean, trace) in `detailJson`. The row shape matches the skeleton worker's
// `Result` (norn/workers/src/stages.ts), so wiring this in is a mapping, not a migration.

import type { BomDeltaResult } from './bom.ts';
import type { CostCheckResult, Money } from './cost.ts';
import type { Stat } from './plan.ts';
import type { SupplyResult } from './supply.ts';
import type { TimelineResult } from './timeline.ts';
import { COST_BLOCKS } from './types.ts';

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
  // Everything a trace points at, and what the card needs besides the numbers, in one row.
  out.push({
    key: 'detail', label: 'Inputs, flags and supporting results', unit: 'json', p10: 0, p50: 0, p90: 0,
    detailJson: JSON.stringify({
      codeVersion: r.codeVersion, seed: r.seed, draws: r.draws, correlation: r.correlation, window: r.window, bomDelta: r.bomDelta,
      inputs: r.inputs, flags: r.flags, drivers: r.drivers, convergence: r.convergence, effectivity: r.effectivity,
      inventory: r.inventory, unitCost: r.unitCost, piecePrices: r.piecePrices,
    }),
  });
  return out;
}

// ---------------------------------------------------------------- S3 and S4

const statRow = (key: string, label: string, unit: string, s: Stat, extra: object = {}): CheckResultRow => ({
  key, label, unit, p10: s.p10, p50: s.p50, p90: s.p90,
  detailJson: JSON.stringify({ point: s.point, mean: s.mean, trace: s.trace, ...extra }),
});

const probRow = (key: string, label: string, p: number, detail: object): CheckResultRow => countRow(key, label, 'probability', p, detail);

/**
 * S3 as rows. Dates are day numbers since 1970-01-01 (unit 'day'); the ISO dates are in each row's
 * detail. `cut_in_serial` is the first serial that can take the change.
 */
export function timelineRows(r: TimelineResult): CheckResultRow[] {
  // The date rows are left out when the old stock runs past the volume plan: no date can be placed, only the serial.
  const out: CheckResultRow[] = [];
  if (r.cutIn.day && r.cutIn.weeksFromFiling) {
    out.push(statRow('cut_in_date', 'Earliest cut-in date', 'day', r.cutIn.day, { date: r.cutIn.date }));
    out.push(statRow('cut_in_weeks', 'Weeks from filing to cut-in', 'weeks', r.cutIn.weeksFromFiling, { date: r.cutIn.date }));
  }
  out.push(statRow('cut_in_serial', 'First serial that can take the change', 'serial', r.cutIn.serial, { placed: r.cutIn.placed }));
  out.push(statRow('decision_date', 'Board decision date', 'day', r.decision.day, { date: r.decision.date }));
  if (r.late) {
    out.push(statRow('late_weeks', `Weeks after the stated effectivity (${r.stated.label})`, 'weeks', r.late.weeks, { statedDate: r.stated.date, statedSerial: r.stated.serial }));
    out.push(probRow('p_late', 'Chance the change reaches the line after the stated effectivity', r.late.probability, { stated: r.stated, trace: r.late.weeks.trace }));
  }
  out.push({
    key: 'detail', label: 'Inputs, flags and supporting results', unit: 'json', p10: 0, p50: 0, p90: 0,
    detailJson: JSON.stringify({
      codeVersion: r.codeVersion, seed: r.seed, draws: r.draws, correlation: r.correlation, filed: r.filed, stated: r.stated,
      decision: r.decision, cutIn: r.cutIn, late: r.late, paths: r.paths, convergence: r.convergence, flags: r.flags, inputs: r.inputs,
    }),
  });
  return out;
}

/** S4 as rows. `p_miss_effectivity` and the `_with_peers` rows are present only when they apply. */
export function supplyCheckRows(r: SupplyResult): CheckResultRow[] {
  const out: CheckResultRow[] = [];
  if (r.missEffectivity) {
    out.push(probRow('p_miss_effectivity', `Chance the supply misses the stated effectivity (${r.stated.label})`, r.missEffectivity.probability, { stated: r.stated, weeksLate: r.missEffectivity.weeks, ...(r.missEffectivity.weeks ? { trace: r.missEffectivity.weeks.trace } : { placed: false }) }));
  }
  out.push(countRow('single_source_items', 'Changed parts with one qualified source', 'parts', r.singleSourceItems.length, { items: r.singleSourceItems, parts: r.parts.filter((p) => p.singleSource).map((p) => ({ item: p.item, supplier: p.supplier, sources: p.sources })) }));
  for (const p of r.parts) {
    out.push(statRow(`lead_weeks:${p.item}`, `${p.item}: weeks from order to parts in`, 'weeks', p.leadWeeks, { supplier: p.supplier, sources: p.sources, singleSource: p.singleSource, leadFrom: p.leadFrom, quote: p.quoteId, slot: p.slot }));
  }
  out.push(statRow('spend_year_one', 'Spend on the changed parts, first year after the cut-in', 'USD', r.spend.yearOne));
  out.push(statRow('spend_year_one_single_source', 'Of which on parts with one qualified source', 'USD', r.spend.singleSourceYearOne));
  for (const c of r.capacity) {
    out.push(statRow(`capacity_utilization:${c.constraint}`, `Share of ${c.supplier}'s yearly capacity, this ECR (${c.constraint})`, 'fraction', c.utilization, { capacityPerYear: c.capacityPerYear, window: c.window }));
    if (c.utilizationWithPeers) out.push(statRow(`capacity_utilization_with_peers:${c.constraint}`, `Share of ${c.supplier}'s yearly capacity, with the other open ECRs`, 'fraction', c.utilizationWithPeers, { capacityPerYear: c.capacityPerYear }));
  }
  const I = r.interaction;
  if (I) {
    if (I.cutIn) {
      out.push(statRow('peer_cut_in_shift_weeks', 'Weeks the cut-in moves because of the other open ECRs', 'weeks', I.cutIn.shiftWeeks, { peers: I.peers.map((p) => p.ecr), slots: I.slots }));
      out.push(probRow('p_cut_in_later_with_peers', 'Chance the other open ECRs push the cut-in later', I.cutIn.probabilityLater, { peers: I.peers, trace: I.cutIn.shiftWeeks.trace }));
    }
    if (I.late) out.push(probRow('p_miss_effectivity_with_peers', 'Chance the supply misses the stated effectivity, with the other open ECRs', I.late.probability, { weeksLate: I.late.weeks, trace: I.late.weeks.trace }));
    for (const b of I.bundles) {
      out.push(statRow(`bundle_saving:${b.constraint}`, `Saving from the bundle terms, this ECR (${b.constraint})`, 'USD', b.ownSaving, { withinWeeks: b.withinWeeks, probabilityBundled: b.probabilityBundled }));
      out.push(statRow(`pair_bundle_saving:${b.constraint}`, `Saving from the bundle terms, every ECR in the bundle`, 'USD', b.pairSaving, { withinWeeks: b.withinWeeks }));
    }
  }
  out.push({
    key: 'detail', label: 'Inputs, flags and supporting results', unit: 'json', p10: 0, p50: 0, p90: 0,
    detailJson: JSON.stringify({
      codeVersion: r.codeVersion, seed: r.seed, draws: r.draws, correlation: r.correlation, stated: r.stated, cutInPlaced: r.cutInPlaced, parts: r.parts,
      singleSourceItems: r.singleSourceItems, missEffectivity: r.missEffectivity, spend: r.spend, capacity: r.capacity,
      interaction: I, unrelatedPeers: r.unrelatedPeers, convergence: r.convergence, flags: r.flags, inputs: r.inputs,
    }),
  });
  return out;
}
