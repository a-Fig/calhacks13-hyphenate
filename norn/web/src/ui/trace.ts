import type { Evidence, Figure, ImpactAssessment } from '../assessment/types.ts';

/** Every figure on the page by its trace id, so the "why" panel can show the number it explains. */
export function figureIndex(a: ImpactAssessment): Map<string, Figure> {
  const m = new Map<string, Figure>();
  for (const r of a.cost.rows) {
    if (r.unitCost) m.set(r.unitCost.id, r.unitCost);
    if (r.nonrecurring) m.set(r.nonrecurring.id, r.nonrecurring);
    if (r.extended) m.set(r.extended.id, r.extended);
    m.set(r.total.id, r.total);
  }
  for (const s of a.cost.subtotals) m.set(s.total.id, s.total);
  a.headline.unitCost.forEach(u => m.set(u.figure.id, u.figure));
  for (const f of [a.cost.net, a.cost.oneTime, a.cost.recurring]) m.set(f.id, f);
  if (a.cutIn.estimate) m.set(a.cutIn.estimate.figure.id, a.cutIn.estimate.figure);
  const put = (f?: Figure) => { if (f) m.set(f.id, f); };
  put(a.cost.scenarios?.alternative?.net);
  put(a.cost.scenarios?.alternative?.recurring);
  const t = a.cutIn.timeline;
  for (const f of [t?.decision, t?.weeksFromFiling, t?.serial, t?.retrofit, t?.late?.weeks]) put(f);
  t?.steps.forEach(s => put(s.date));
  const s = a.supply?.detail;
  s?.parts.forEach(p => put(p.leadWeeks));
  for (const f of [s?.spend?.yearOne, s?.spend?.singleSource, s?.miss?.weeksLate, s?.missWithPeers?.weeksLate, s?.peerCutInShift?.weeks]) put(f);
  s?.capacity.forEach(c => { put(c.utilization); put(c.withPeers); });
  s?.bundles.forEach(b => { put(b.ownSaving); put(b.pairSaving); });
  return m;
}

/** How many numbers and claims of each evidence class the assessment shows. */
export function evidenceCounts(a: ImpactAssessment): Record<Evidence, number> {
  const c: Record<Evidence, number> = { fact: 0, assumption: 0, computation: 0, judgment: 0 };
  const add = (f?: Figure) => f && c[f.evidence]++;
  for (const r of a.cost.rows) {
    add(r.total);
    add(r.unitCost);
  }
  a.cost.subtotals.forEach(s => add(s.total));
  add(a.cost.net);
  a.headline.unitCost.forEach(u => add(u.figure));
  if (a.cutIn.estimate) add(a.cutIn.estimate.figure);
  if (a.supply) c[a.supply.evidence]++;
  c[a.changeClass.evidence]++;
  a.recommendation.reasons.forEach(r => c[r.evidence]++);
  a.drivers.slice(0, 4).forEach(d => c[d.evidence]++);
  return c;
}
