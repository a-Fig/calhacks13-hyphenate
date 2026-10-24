import type { CostGroup, ItemCode } from './types.ts';
import type { Row } from './catalog-core.ts';
import { workCenters } from './company.ts';

// Standard-cost roll-up. A buy item costs its purchase price. A make item costs the sum of its
// children (quantity x cost) plus its own labor (hours x work-center rate). Labor is booked to the
// cost group of the make item; material to the group of the buy item that carries it.

export interface Rolled {
  material: number;
  labor: number;
  total: number;
}

const rateOf = new Map(workCenters.map((w) => [w.id, w.laborRatePerHour]));

export function rowMap(rows: Row[]): Map<ItemCode, Row> {
  const m = new Map<ItemCode, Row>();
  for (const r of rows) {
    if (m.has(r.code)) throw new Error(`duplicate item code ${r.code}`);
    m.set(r.code, r);
  }
  return m;
}

export function rollUp(rows: Row[]): Map<ItemCode, Rolled> {
  const byCode = rowMap(rows);
  const memo = new Map<ItemCode, Rolled>();
  const visiting = new Set<ItemCode>();
  const go = (code: ItemCode): Rolled => {
    const hit = memo.get(code);
    if (hit) return hit;
    const row = byCode.get(code);
    if (!row) throw new Error(`unknown item ${code}`);
    if (visiting.has(code)) throw new Error(`BOM cycle at ${code}`);
    visiting.add(code);
    let out: Rolled;
    if (row.type === 'buy') {
      out = { material: row.price, labor: 0, total: row.price };
    } else {
      let material = 0;
      let labor = 0;
      for (const [child, qty] of row.children) {
        const c = go(child);
        material += c.material * qty;
        labor += c.labor * qty;
      }
      const rate = row.workCenter ? (rateOf.get(row.workCenter) ?? 0) : 0;
      labor += row.hours * rate;
      out = { material, labor, total: material + labor };
    }
    visiting.delete(code);
    memo.set(code, out);
    return out;
  };
  for (const r of rows) go(r.code);
  return memo;
}

/** Cost per cost group for one unit of `top`: material by buy-item group, labor by make-item group. */
export function groupCosts(rows: Row[], top: ItemCode): Record<CostGroup, number> {
  const byCode = rowMap(rows);
  const acc: Record<CostGroup, number> = { airframe: 0, powertrain: 0, battery: 0, avionics: 0, actuation_thermal: 0, other: 0 };
  const walk = (code: ItemCode, mult: number) => {
    const row = byCode.get(code);
    if (!row) throw new Error(`unknown item ${code}`);
    if (row.type === 'buy') {
      acc[row.group] += row.price * mult;
      return;
    }
    const rate = row.workCenter ? (rateOf.get(row.workCenter) ?? 0) : 0;
    acc[row.group] += row.hours * rate * mult;
    for (const [child, qty] of row.children) walk(child, mult * qty);
  };
  walk(top, 1);
  return acc;
}

/** Explode a BOM into total quantity per item code for one unit of `top`. */
export function explode(rows: Row[], top: ItemCode): Map<ItemCode, number> {
  const byCode = rowMap(rows);
  const qty = new Map<ItemCode, number>();
  const walk = (code: ItemCode, mult: number) => {
    qty.set(code, (qty.get(code) ?? 0) + mult);
    const row = byCode.get(code);
    if (row && row.type === 'make') for (const [child, q] of row.children) walk(child, mult * q);
  };
  walk(top, 1);
  return qty;
}
