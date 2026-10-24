// Comparing the supplier constraints ERPNext holds with a reference dataset's. Used by check.ts; kept apart so it can be unit tested offline.
import type { ItemCode, SupplierConstraint } from './baseline.ts';
import { canonicalJson } from './read.ts';

/** A reference dataset's constraint: the baseline's shape, but the supplier is the dataset's own id and it may carry provenance. */
export type ReferenceConstraint = Omit<SupplierConstraint, 'supplier'> & { supplier: string; prov?: unknown };

/**
 * The constraints the ERP should return for a reference dataset: the supplier mapped by `supplierName` (the dataset id to the
 * ERPNext name, the same mapping the sourcing comparison uses), provenance dropped, items sorted, sorted by id.
 */
export function expectedSupplierConstraints(ref: ReferenceConstraint[], supplierName: (id: string) => string): SupplierConstraint[] {
  const sorted = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return ref.map(({ prov: _prov, supplier, items, ...rest }) => ({ ...rest, supplier: supplierName(supplier), items: [...items].sort(sorted) as ItemCode[] }))
    .sort((a, b) => sorted(a.id, b.id));
}

/** One line per constraint that is missing, extra or different between the ERP's list and the expected one. Empty when they match. */
export function diffSupplierConstraints(have: SupplierConstraint[], want: SupplierConstraint[]): string[] {
  const haveById = new Map(have.map((c) => [c.id, c]));
  const wantIds = new Set(want.map((c) => c.id));
  const diffs: string[] = [];
  for (const w of want) {
    const h = haveById.get(w.id);
    if (!h) { diffs.push(`${w.id} missing`); continue; }
    const fields = [...new Set([...Object.keys(w), ...Object.keys(h)])].sort() as (keyof SupplierConstraint)[];
    const bad = fields.filter((k) => canonicalJson(h[k]) !== canonicalJson(w[k]));
    if (bad.length) diffs.push(`${w.id} differs in ${bad.join(', ')}`);
  }
  for (const h of have) if (!wantIds.has(h.id)) diffs.push(`${h.id} is not in the reference`);
  return diffs;
}
