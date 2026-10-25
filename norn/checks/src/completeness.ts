// Cost completeness: which impact costs a change request must account for, and whether its cost page does.
//
// The cost check can only price rows that exist. A row left blank becomes a `needs_estimate` $0, but an
// applicable cost the originator left off the page altogether (ECR-0407: "coupon tests. Not estimated."
// beside a cost page holding only the material saving) read as an assessed $0 and let the recommendation
// reach Approve. So each factor the DD 1692 Block 50 cost page must account for ends in exactly one of:
//   assessed        a cost-page row covers it (an explicit $0 is an assessment),
//   not_applicable  stated, or inferred from a field that says there is none,
//   unknown         applicable, and no estimate: a gap.
// Applicability comes from, in order: the row that covers the factor (tagged `factor`, or declared in
// `costFactors`); the ECR's own declaration, where "not applicable" needs its reason; a field that makes
// it applicable (a stated retrofit range; test and qualification text, blank included) or says none
// (an explicit "None" / "N/A"). A factor nothing mentions is not assessed: absence of evidence alone never
// invents a cost. Pure and deterministic, so the schedule and PLM paths can call it without a Monte Carlo run.

import type { ChangeRequest, CostBlock, CostPageRow } from './types.ts';
import { COST_BLOCKS } from './types.ts';

export type CostFactorStatus = 'assessed' | 'not_applicable' | 'unknown';

/** What the originator (or the PLM form) says about one factor. */
export interface CostFactorDeclaration {
  factor: string;
  status: CostFactorStatus;
  /** Ids of the cost-page rows that carry the factor's cost (`row.id ?? slug(label)`). */
  rows?: string[];
  note?: string;
}

// The fields the change request carries beyond the checks' own shape. `ChangeRequest` may declare them too.
type Declared = { testAndQualification?: string; costFactors?: CostFactorDeclaration[] };
type FactorRow = CostPageRow & { factor?: string };

export interface CostFactorAssessment {
  key: string;
  label: string;
  /** The cost-page block a missing estimate belongs in. */
  block: CostBlock;
  status: CostFactorStatus;
  /** `declared`: the change request says so (a row, or `costFactors`). `inferred`: Norn read it from the change request's other fields. */
  basis: 'declared' | 'inferred';
  reason: string;
  /** The ids (`cost:<ecr>:<block>:<key>`) of the cost-page rows that cover the factor. Empty: nothing on the page does. */
  rowIds: string[];
  ref: string;
}

/** 'NC programming (Halden)' -> 'nc-programming-halden'. Whole words, at most 48 characters. */
export function slug(label: string): string {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 48) break;
    out = next;
  }
  return out || (words[0] ?? 'row').slice(0, 48);
}

/** A block's row keys, unique within the block: the PLM's row id, else a slug of the label, then -2, -3. */
export function rowKeys(rows: readonly CostPageRow[]): { key: string; stem: string }[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const stem = row.id ?? slug(row.label);
    let key = stem;
    for (let k = 2; taken.has(key); k++) key = `${stem}-${k}`;
    taken.add(key);
    return { key, stem };
  });
}

interface FactorSpec {
  key: string;
  label: string;
  block: CostBlock;
  /** Whether the change request's own fields make the factor applicable (and say why), or that they say nothing. */
  infer?: (ecr: ChangeRequest & Declared) => { applicable: boolean; reason: string } | null;
}

/** "None", "N/A": the usual way a form says there is nothing to enter. */
const NOTHING = /^\s*(none|nil|n\/a|na|not applicable)\b/i;

export const COST_FACTORS: readonly FactorSpec[] = [
  {
    key: 'qualification', label: 'Test and qualification', block: 'production',
    infer: (e) => {
      const text = e.testAndQualification;
      if (text === undefined) return null;
      // Only an explicit "none" means none. A blank field says nothing, so it is a question, not an answer.
      if (!text.trim()) return { applicable: true, reason: 'the test and qualification field is blank, so nobody has said whether any work is needed, and no cost-page row estimates it' };
      if (NOTHING.test(text)) return { applicable: false, reason: `the change request states no test or qualification work ("${text.trim().slice(0, 120)}")` };
      return { applicable: true, reason: `the change request states test or qualification work ("${text.trim().slice(0, 120)}") and no cost-page row estimates it` };
    },
  },
  // Retrofit parts do not stand for the work of fitting and checking them: installation (Block 43) and
  // re-test (Block 44) each need a row of their own, tagged with the factor.
  ...(['retrofit_installation', 'retrofit_test'] as const).map((key): FactorSpec => ({
    key, label: key === 'retrofit_installation' ? 'Retrofit installation' : 'Retrofit re-test', block: 'retrofit',
    // A 'tbd' retrofit is not decided: the originator's own (blank) retrofit rows stand for it.
    infer: (e) => {
      const r = e.effectivity?.retrofit;
      if (!r || r.basis === 'tbd') return null;
      return { applicable: true, reason: `the effectivity states a retrofit (${r.basis} ${r.from}${r.to ? `-${r.to}` : ''}) and no cost-page row is tagged as its ${key === 'retrofit_installation' ? 'installation' : 're-test'} estimate` };
    },
  })),
  { key: 'logistics_support', label: 'Integrated product support (spares, manuals, training)', block: 'logisticsSupport' },
];

const humanize = (key: string) => {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
};

/**
 * Every cost factor the change request speaks to, each with its status. Factors nothing in the change
 * request mentions are left out. Order: the known factors, then any others the change request declares.
 */
export function assessCostFactors(change: ChangeRequest): CostFactorAssessment[] {
  const ecr = change as ChangeRequest & Declared;
  const declared = new Map((ecr.costFactors ?? []).map((d) => [d.factor, d]));
  const specs: FactorSpec[] = [...COST_FACTORS];
  for (const d of ecr.costFactors ?? []) {
    if (!specs.some((s) => s.key === d.factor)) specs.push({ key: d.factor, label: humanize(d.factor), block: 'other' });
  }

  // Every cost-page row, with its stem (what a declaration or the factor key names) and the id the cost check gives it.
  const all = COST_BLOCKS.flatMap((block) =>
    rowKeys(ecr.costPage[block]).map(({ key, stem }, i) => ({ block, row: ecr.costPage[block][i] as FactorRow, stem, id: `cost:${ecr.id}:${block}:${key}` })),
  );

  const out: CostFactorAssessment[] = [];
  for (const spec of specs) {
    const d = declared.get(spec.key);
    const rows = all.filter((x) => x.row.factor === spec.key || x.stem === spec.key || (d?.rows ?? []).includes(x.stem));
    const base = { key: spec.key, label: spec.label, block: spec.block, rowIds: rows.map((x) => x.id), ref: `${ecr.id} costFactors.${spec.key}` };
    const stated = rows.filter((x) => x.row.basis !== 'not_provided');

    if (stated.length) {
      out.push({ ...base, status: 'assessed', basis: 'declared', reason: `cost-page row${stated.length > 1 ? 's' : ''} ${stated.map((x) => `"${x.row.label}"`).join(', ')} estimate${stated.length > 1 ? '' : 's'} it` });
    } else if (d?.status === 'not_applicable' && d.note?.trim()) {
      out.push({ ...base, status: 'not_applicable', basis: 'declared', reason: d.note.trim() });
    } else if (d) {
      out.push({
        ...base, status: 'unknown', basis: 'declared',
        reason: d.status === 'not_applicable' ? 'declared not applicable without saying why, which is not an answer'
          : d.note ?? (d.status === 'assessed' ? 'declared assessed, but no cost-page row carries it' : 'declared applicable, with no estimate'),
      });
    } else {
      const inferred = spec.infer?.(ecr);
      if (!inferred) continue;
      out.push({ ...base, status: inferred.applicable ? 'unknown' : 'not_applicable', basis: 'inferred', reason: inferred.reason });
    }
  }
  return out;
}

/** The applicable factors with no estimate: the gaps. Includes a factor whose only row is blank. */
export const incompleteCostFactors = (change: ChangeRequest): CostFactorAssessment[] => assessCostFactors(change).filter((f) => f.status === 'unknown');
