import type { Evidence, Figure, ImpactAssessment } from '../assessment/types.ts';

/** Every figure on the page by its trace id, so the "why" panel can show the number it explains. */
export function figureIndex(a: ImpactAssessment): Map<string, Figure> {
  const m = new Map<string, Figure>();
  for (const r of a.cost.rows) {
    if (r.unitCost) m.set(r.unitCost.id, r.unitCost);
    m.set(r.total.id, r.total);
  }
  for (const s of a.cost.subtotals) m.set(s.total.id, s.total);
  m.set(a.cost.net.id, a.cost.net);
  m.set(a.headline.unitCost.id, a.headline.unitCost);
  m.set(a.headline.cutIn.id, a.headline.cutIn);
  return m;
}

/** How many numbers and claims of each evidence class the assessment shows. */
export function evidenceCounts(a: ImpactAssessment): Record<Evidence, number> {
  const c: Record<Evidence, number> = { fact: 0, assumption: 0, computation: 0, judgment: 0 };
  const add = (f?: Figure) => f && c[f.evidence]++;
  for (const r of a.cost.rows) {
    if (r.notAssessed) continue;
    add(r.oneTime);
    add(r.unitCost);
    if (!r.oneTime) add(r.total);
  }
  a.cost.subtotals.forEach(s => add(s.total));
  [a.cost.net, a.headline.unitCost, a.headline.cutIn].forEach(add);
  c[a.headline.supply.evidence]++;
  c[a.changeClass.evidence]++;
  a.recommendation.reasons.forEach(r => c[r.evidence]++);
  a.drivers.forEach(d => c[d.evidence]++);
  return c;
}
