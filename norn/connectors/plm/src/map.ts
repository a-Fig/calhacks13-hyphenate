// A PLM change request document to the checks library's ChangeRequest, plus the record Norn shows beside
// it. Pure: the same function maps what REST returns and what a webhook delivers.
//
// The PLM keeps some things differently from the checks, so the mapping reverses them:
//   - a blank number is stored as 0, so a 0 on a cost, quote or lead-time field is read as "not given";
//   - redline values are stored as text, so "1.25" is read back as the number 1.25 and "" as null, and the
//     characteristics the checks compute with (the unit price, labour hours) are always read as numbers:
//     "34.60" is 34.6, and text that is not a number is refused rather than left for the checks to ignore;
//   - a supplier quote is one row per line with the quote's header repeated, so rows are grouped by quote;
//   - enums are spelled for people ("Urgent"), so they go back through the company's settings.

import type {
  BomChange, ChangeRequest, CostBlock, FieldChange, CostPage, CostPageRow, EffectivityPoint, FieldValue, InventoryProposal, ItemChange, QuoteLine, SupplierQuote,
} from '../../../checks/src/types.ts';
import { createHash } from 'node:crypto';
import { COST_BLOCKS } from '../../../checks/src/types.ts';
import { HOURS_FIELD, PRICE_FIELD } from '../../../checks/src/bom.ts';
import type { CompanyClass, FaaClass, PlmSettings, Priority } from './options.ts';
import { COST_TABLE, IMPACT_FIELDS } from './schema.ts';
import type { ImpactField, PlmDoc } from './schema.ts';

/**
 * The checks' ChangeRequest, plus the ECO that released it. `eco` is not a field of the checks library's
 * type (norn/checks/src/types.ts, 2026-10-24); it is set only when the PLM has an ECO for the request, so
 * a consumer that serialises the request carries it along. Drop the intersection if the library adds it.
 */
export type PlmChangeRequest = ChangeRequest & { eco?: string };

/** What the impact assessment fields hold now, under the PLM's own field names. Absent: empty. */
export type ImpactState = { [K in ImpactField]?: string };

export interface EcrRecord {
  id: string;
  title: string;
  /** The PLM's own workflow state: Draft, Submitted, In CM Review, CCB Review, Approved, Rejected, Sent Back. */
  workflowState: string;
  /** The originator's PLM login. */
  originator: string;
  priority: Priority;
  companyClass: CompanyClass;
  faaClass: FaaClass;
  justificationCode: string;
  /** The ECP revision letter. */
  ecpRevision?: string;
  originatingNcr?: string;
  /** The ECO that released this request, once approved. */
  eco?: string;
  ecoReleasedOn?: string;
  /** The login of whoever approved the request, which the PLM stamps on the ECO as its releaser. */
  ecoReleasedBy?: string;
  /** Review functions the CM analyst routed it to, through `reviewFunctions`. */
  routedTo: string[];
  dates: {
    filedOn: string;
    neededBy?: string;
    decidedOn?: string;
    created?: string;
    modified: string;
  };
  modifiedBy?: string;
  /** The originator's prose, as written. */
  text: {
    description: string;
    need: string;
    consequencesIfDisapproved?: string;
    alternativesConsidered?: string;
    failureData?: string;
    testAndQualification?: string;
    faaRationale?: string;
    classificationNote?: string;
  };
  /** Dates on each quote, which the checks do not use. */
  quotes: { id: string; receivedOn?: string; validUntil?: string }[];
  /** What Norn has posted on the request so far. */
  impact: ImpactState;
  /** Things in the PLM's data that could not be placed (a redline on a part that is not an affected item). */
  warnings: string[];
}

export interface ReadResult {
  change: PlmChangeRequest;
  record: EcrRecord;
  /** The document's `modified` stamp when it was read. */
  modified: string;
}

/** A value in the PLM that the company's settings do not map. */
export class PlmMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlmMappingError';
  }
}

/**
 * A fingerprint of what an assessment is made from: the mapped request and everything Norn shows beside it,
 * except what Norn itself writes (the impact fields), the PLM's `modified` stamp, who made the last change
 * and the mapping warnings. Two reads with the same fingerprint need the same assessment, so Norn's own
 * write does not change it and a person's edit to a cost, quote, redline, state or the prose does.
 */
export function inputsHash(r: ReadResult): string {
  const { impact: _impact, modifiedBy: _by, warnings: _warnings, dates: { modified: _modified, ...dates }, ...record } = r.record;
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => [k, canon((v as any)[k])]))
    : v);
  return createHash('sha256').update(JSON.stringify(canon({ change: r.change, record: { ...record, dates } }))).digest('hex');
}

// ---------------------------------------------------------------- small helpers

const blank = (v: unknown) => v === undefined || v === null || v === '';
const text = (v: unknown): string | undefined => (blank(v) ? undefined : String(v));
/** A number the PLM stores as 0 when nobody filled it in: 0 and blank both read as not given. */
const given = (v: unknown, what: string): number | undefined => {
  const x = num(v, what);
  return x !== undefined && x !== 0 ? x : undefined;
};
/** A number column. Blank is not given; a value that is not a finite number is refused, not dropped. */
const num = (v: unknown, what: string): number | undefined => {
  if (blank(v)) return undefined;
  const x = typeof v === 'boolean' ? NaN : Number(v);
  if (!Number.isFinite(x)) throw new PlmMappingError(`${what} ${JSON.stringify(v)} is not a number`);
  return x;
};
const rows = (v: unknown): PlmDoc[] => (Array.isArray(v) ? v : []);
/** Drop the keys whose value is undefined, so an absent field is absent rather than undefined. */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function lookup<V extends string>(map: Record<string, V>, value: unknown, what: string, ecr: string): V {
  if (typeof value === 'string' && Object.hasOwn(map, value)) return map[value];
  throw new PlmMappingError(`${ecr}: ${what} ${JSON.stringify(value)} is not in the PLM settings (known: ${Object.keys(map).join(', ')})`);
}

/**
 * A redline value from the PLM's text back to a value. "" is null, "true" and "false" are booleans, and
 * a number comes back as a number only when printing it gives the same text ("1.25", not "1.250").
 */
export function parseFieldValue(v: unknown): FieldValue {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const t = String(v);
  if (t === 'true') return true;
  if (t === 'false') return false;
  const x = Number(t);
  return Number.isFinite(x) && String(x) === t ? x : t;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * A redline value on a characteristic the checks compute with. Blank is null; "34.60" is 34.6. Anything
 * else (a currency sign, "TBD", "1,200") throws: the checks apply a price or hours change only when it is
 * a number, so passing text through would leave the assessed cost at the old value with no conflict.
 */
export function parseNumericValue(v: unknown, what: string): number | null {
  if (blank(v)) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    if (NUMBER.test(t) && Number.isFinite(Number(t))) return Number(t);
  }
  throw new PlmMappingError(`${what} ${JSON.stringify(v)} is not a number`);
}

function supplierId(s: PlmSettings, name: string): string {
  if (typeof s.supplier === 'function') return s.supplier(name);
  if (s.supplier && Object.hasOwn(s.supplier, name)) return s.supplier[name];
  return name;
}

// ---------------------------------------------------------------- the mapping

function itemChanges(s: PlmSettings, doc: PlmDoc, warnings: string[]): ItemChange[] {
  const id = String(doc.name);
  const numeric = new Set([PRICE_FIELD, HOURS_FIELD, ...(s.numericFields ?? [])]);
  const redlines = new Map<string, PlmDoc[]>();
  for (const r of rows(doc.field_changes)) redlines.set(String(r.part), [...(redlines.get(String(r.part)) ?? []), r]);
  const out = rows(doc.affected_items).map((a): ItemChange => {
    const mine = redlines.get(String(a.part)) ?? [];
    redlines.delete(String(a.part));
    return clean({
      item: String(a.part),
      op: lookup(s.itemOps, a.change_type, 'change type', id),
      fromRev: text(a.from_revision),
      toRev: text(a.to_revision),
      changes: mine.map((r): FieldChange => {
        const field = String(r.field);
        if (!numeric.has(field)) {
          // Not a name the checks compute with exactly as written, so a near miss ("Unit_Price_USD") would be carried as text.
          if ([...numeric].some((n) => n === field.trim().toLowerCase())) warnings.push(`${a.part}: "${field}" looks like a numeric characteristic but is not spelled exactly so; it is read as text`);
          return { field, from: parseFieldValue(r.from_value), to: parseFieldValue(r.to_value) };
        }
        const where = `${a.part}.${field}`;
        return { field, from: parseNumericValue(r.from_value, `${where} from value`), to: parseNumericValue(r.to_value, `${where} to value`) };
      }),
    });
  });
  for (const [part, rs] of redlines) warnings.push(`${rs.length} characteristic change(s) on ${part}, which is not an affected item`);
  return out;
}

function bomChanges(s: PlmSettings, doc: PlmDoc): BomChange[] {
  return rows(doc.bom_changes).map((b): BomChange => {
    const op = lookup(s.bomOps, b.op, 'BOM change', String(doc.name));
    // The PLM stores an unused quantity as 0: only the side an operation uses is read.
    return clean({
      op,
      parent: String(b.parent_part),
      child: String(b.child_part),
      qtyFrom: op === 'add' ? undefined : num(b.qty_from, `${b.parent_part}/${b.child_part} quantity from`),
      qtyTo: op === 'remove' ? undefined : num(b.qty_to, `${b.parent_part}/${b.child_part} quantity to`),
    });
  });
}

function firmness(s: PlmSettings, rs: PlmDoc[], ecr: string): SupplierQuote['firmness'] {
  if (!s.firmness) return undefined;
  const found = rs.map((r) => text(r.firmness)).filter((v): v is string => v !== undefined).map((v) => lookup(s.firmness!, v, 'quote firmness', ecr));
  return found.includes('budgetary') ? 'budgetary' : found[0];
}

function supplierQuotes(s: PlmSettings, doc: PlmDoc): { quotes: SupplierQuote[]; dates: EcrRecord['quotes'] } {
  const groups = new Map<string, PlmDoc[]>();
  for (const r of rows(doc.supplier_quotes)) {
    const key = text(r.quote_id) ?? `${doc.name}-quote`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const quotes: SupplierQuote[] = [];
  const dates: EcrRecord['quotes'] = [];
  for (const [id, rs] of groups) {
    const head = rs[0];
    quotes.push(clean({
      id,
      supplier: supplierId(s, String(head.supplier)),
      item: String(head.part),
      lines: rs.map((r): QuoteLine => clean({ description: String(r.description ?? ''), unitPrice: given(r.unit_price, `quote ${id} unit price`), qty: given(r.qty, `quote ${id} quantity`), oneTime: given(r.one_time, `quote ${id} one-time cost`) })),
      leadTimeWeeks: given(head.lead_time_weeks, `quote ${id} lead time`),
      // Firm or budgetary where the PLM carries it; unset otherwise, and the checks then read the note. One budgetary row makes the quote budgetary.
      firmness: firmness(s, rs, doc.name),
      note: rs.map((r) => text(r.note)).find((n) => n !== undefined),
    }));
    dates.push(clean({ id, receivedOn: text(head.received_on), validUntil: text(head.valid_until) }));
  }
  return { quotes, dates };
}

function point(s: PlmSettings, id: string, basis: unknown, from: unknown, to: unknown, note: unknown, what: string): EffectivityPoint {
  return clean({ basis: lookup(s.effectivityBasis, basis, `${what} basis`, id), from: text(from) ?? '', to: text(to), note: text(note) });
}

function effectivity(s: PlmSettings, doc: PlmDoc, warnings: string[]): ChangeRequest['effectivity'] {
  const id = String(doc.name);
  let production: EffectivityPoint;
  if (blank(doc.production_basis)) {
    // A draft that has not set its cut-in yet: the checks' "to be decided".
    warnings.push('production effectivity is not set');
    production = clean({ basis: 'tbd', from: '', note: text(doc.production_note) });
  } else {
    production = point(s, id, doc.production_basis, doc.production_from, undefined, doc.production_note, 'production effectivity');
  }
  const retrofit = blank(doc.retrofit_basis)
    ? undefined
    : point(s, id, doc.retrofit_basis, doc.retrofit_from, doc.retrofit_to, doc.retrofit_note, 'retrofit effectivity');
  return clean({ production, retrofit, interchangeable: Boolean(Number(doc.interchangeable ?? 0)) });
}

function inventory(s: PlmSettings, doc: PlmDoc): InventoryProposal[] {
  const id = String(doc.name);
  return rows(doc.inventory).map((i): InventoryProposal => clean({
    item: String(i.part),
    location: lookup(s.locations, i.location, 'inventory location', id),
    disposition: lookup(s.dispositions, i.disposition, 'inventory disposition', id),
    note: text(i.note),
  }));
}

function costPage(s: PlmSettings, doc: PlmDoc): CostPage {
  const id = String(doc.name);
  const page = {} as CostPage;
  for (const block of COST_BLOCKS as readonly CostBlock[]) {
    page[block] = rows(doc[COST_TABLE[block]]).map((r): CostPageRow => {
      const oneTime = given(r.one_time, `${block} cost "${r.label}" one-time cost`);
      const unitCost = given(r.unit_cost, `${block} cost "${r.label}" unit cost`);
      const assessedZero = Number(r.assessed_zero) === 1;
      if (assessedZero && (oneTime !== undefined || unitCost !== undefined)) throw new PlmMappingError(`${block} cost "${r.label}" is marked zero but states a nonzero cost`);
      return clean({
      // The child row's own name: it stays with the row when the table is reordered.
      id: text(r.name),
      label: String(r.label ?? ''),
      factor: text(r.factor),
      oneTime: assessedZero ? 0 : oneTime,
      unitCost,
      quantity: given(r.quantity, `${block} cost "${r.label}" quantity`),
      basis: lookup(s.costBasis, r.basis, `${block} cost basis`, id),
      note: text(r.note),
      });
    });
  }
  return page;
}

function impactState(doc: PlmDoc): ImpactState {
  const out: ImpactState = {};
  for (const f of IMPACT_FIELDS) if (!blank(doc[f])) out[f] = String(doc[f]);
  return out;
}

/**
 * Map one ECR document (REST or webhook) and, if it has been released, its ECO. Throws a PlmMappingError,
 * naming the ECR, for a value the settings do not map or a number column that holds something else.
 */
export function mapEcr(s: PlmSettings, doc: PlmDoc, eco?: { name: string; released_on?: string; released_by?: string }): ReadResult {
  try {
    return mapEcrDoc(s, doc, eco);
  } catch (e) {
    if (e instanceof PlmMappingError && !e.message.startsWith(`${doc.name}: `)) throw new PlmMappingError(`${doc.name}: ${e.message}`);
    throw e;
  }
}

function mapEcrDoc(s: PlmSettings, doc: PlmDoc, eco?: { name: string; released_on?: string; released_by?: string }): ReadResult {
  const id = String(doc.name);
  const warnings: string[] = [];
  const quotes = supplierQuotes(s, doc);
  // The ECO that released the ECR: the one passed in (a lookup by `ecr`), else the ECR's own `released_eco`.
  const ecoName = eco?.name ?? text(doc.released_eco);
  const change: PlmChangeRequest = clean({
    id,
    program: lookup(s.programs, doc.program, 'program', id),
    filedOn: String(doc.filed_on ?? ''),
    itemChanges: itemChanges(s, doc, warnings),
    bomChanges: bomChanges(s, doc),
    supplierQuotes: quotes.quotes,
    effectivity: effectivity(s, doc, warnings),
    inventoryProposal: inventory(s, doc),
    costPage: costPage(s, doc),
    testAndQualification: String(doc.test_and_qualification ?? ''),
    implementationPlan: implementationPlan(doc.implementation_plan, doc.implementation_plan_complete),
    costFactors: costFactors(doc.cost_factors),
    eco: ecoName,
  });
  const names = s.reviewFunctions ?? {};
  const record: EcrRecord = clean({
    id,
    title: String(doc.title ?? ''),
    workflowState: String(doc.workflow_state ?? ''),
    originator: String(doc.originator ?? doc.owner ?? ''),
    priority: lookup(s.priorities, doc.priority, 'priority', id),
    companyClass: lookup(s.companyClasses, doc.company_class, 'company class', id),
    faaClass: lookup(s.faaClasses, doc.faa_class, 'FAA class', id),
    justificationCode: String(doc.justification_code ?? ''),
    ecpRevision: text(doc.ecr_revision),
    originatingNcr: text(doc.originating_ncr),
    eco: ecoName,
    ecoReleasedOn: text(eco?.released_on),
    ecoReleasedBy: text(eco?.released_by),
    routedTo: rows(doc.routed_to).map((r) => (Object.hasOwn(names, r.review_function) ? names[r.review_function] : String(r.review_function))),
    dates: clean({ filedOn: change.filedOn, neededBy: text(doc.needed_by), decidedOn: text(doc.decided_on), created: text(doc.creation), modified: String(doc.modified ?? '') }),
    modifiedBy: text(doc.modified_by),
    text: clean({
      description: String(doc.description ?? ''),
      need: String(doc.need ?? ''),
      consequencesIfDisapproved: text(doc.consequences_if_disapproved),
      alternativesConsidered: text(doc.alternatives_considered),
      failureData: text(doc.failure_data),
      testAndQualification: text(doc.test_and_qualification),
      faaRationale: text(doc.faa_rationale),
      classificationNote: text(doc.classification_note),
    }),
    quotes: quotes.dates,
    impact: impactState(doc),
    warnings,
  });
  return { change, record, modified: record.dates.modified };
}

/** The PLM stores the plan as JSON, preserving explicit zero durations and completion evidence. */
function implementationPlan(value: unknown, complete?: unknown): ChangeRequest['implementationPlan'] {
  if (value === null || value === undefined || value === '') return undefined;
  let plan: any;
  try { plan = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new PlmMappingError('implementation_plan must be valid JSON'); }
  if (Array.isArray(plan)) {
    if (!plan.length && !Number(complete)) return undefined;
    plan = { complete: Number(complete) === 1, tasks: plan.map((t: any) => clean({
      id: t.task_id, label: t.label, kind: t.kind, appliesTo: t.applies_to, owner: t.task_owner, status: t.status,
      durationWeeks: taskDuration(t),
      after: t.after_tasks ? String(t.after_tasks).split(',').map(x => x.trim()).filter(Boolean) : undefined,
      completedOn: text(t.completed_on), evidence: text(t.evidence),
      downtimeHoursPerUnit: Number(t.downtime_assessed) === 1 ? Number(t.downtime_hours_per_unit ?? 0) : undefined,
    })) };
  }
  if (!plan || typeof plan !== 'object' || typeof plan.complete !== 'boolean' || !Array.isArray(plan.tasks)) throw new PlmMappingError('implementation_plan needs complete and tasks');
  for (const task of plan.tasks) {
    if (!task || typeof task.id !== 'string' || typeof task.label !== 'string' || typeof task.owner !== 'string'
      || !['qualification', 'certification', 'release', 'installation', 'test'].includes(task.kind)
      || !['production', 'retrofit', 'both'].includes(task.appliesTo)
      || !['planned', 'complete', 'not_applicable', 'unknown'].includes(task.status)
      || (task.after !== undefined && (!Array.isArray(task.after) || task.after.some((id: unknown) => typeof id !== 'string')))) throw new PlmMappingError('implementation_plan contains an invalid task');
  }
  return plan;
}

/** Frappe Float fields turn blank into zero. Zero needs explicit confirmation, just like zero costs. */
function taskDuration(task: PlmDoc): number | { p10: number; p50: number; p90: number } | undefined {
  const confirmed = Number(task.duration_assessed) === 1;
  if (task.duration_basis === 'Exact') {
    const weeks = Number(task.duration_weeks ?? 0);
    return Number.isFinite(weeks) && (confirmed || weeks !== 0) ? weeks : undefined;
  }
  if (task.duration_basis === 'Range') {
    const values = [task.duration_p10, task.duration_p50, task.duration_p90].map(v => Number(v ?? 0));
    if (values.every(Number.isFinite) && (confirmed || values.some(v => v !== 0))) return { p10: values[0], p50: values[1], p90: values[2] };
  }
  return undefined;
}

function costFactors(value: unknown): ChangeRequest['costFactors'] {
  if (value === null || value === undefined || value === '') return undefined;
  let factors: any;
  try { factors = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new PlmMappingError('cost_factors must be valid JSON'); }
  if (!Array.isArray(factors) || factors.some(f => !f || typeof f.factor !== 'string'
    || !['assessed', 'not_applicable', 'unknown'].includes(f.status)
    || (f.rows !== undefined && (!Array.isArray(f.rows) || f.rows.some((id: unknown) => typeof id !== 'string'))))) throw new PlmMappingError('cost_factors needs factor/status declarations');
  return factors;
}
