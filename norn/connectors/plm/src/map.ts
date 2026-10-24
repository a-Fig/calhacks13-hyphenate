// A PLM change request document to the checks library's ChangeRequest, plus the record Norn shows beside
// it. Pure: the same function maps what REST returns and what a webhook delivers.
//
// The PLM keeps some things differently from the checks, so the mapping reverses them:
//   - a blank number is stored as 0, so a 0 on a cost, quote or lead-time field is read as "not given";
//   - redline values are stored as text, so "1.25" is read back as the number 1.25 and "" as null;
//   - a supplier quote is one row per line with the quote's header repeated, so rows are grouped by quote;
//   - enums are spelled for people ("Urgent"), so they go back through the company's settings.

import type {
  BomChange, ChangeRequest, CostBlock, CostPage, CostPageRow, EffectivityPoint, FieldValue, InventoryProposal, ItemChange, QuoteLine, SupplierQuote,
} from '../../../checks/src/types.ts';
import { COST_BLOCKS } from '../../../checks/src/types.ts';
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

// ---------------------------------------------------------------- small helpers

const blank = (v: unknown) => v === undefined || v === null || v === '';
const text = (v: unknown): string | undefined => (blank(v) ? undefined : String(v));
/** A number the PLM stores as 0 when nobody filled it in: 0 and blank both read as not given. */
const given = (v: unknown): number | undefined => {
  if (blank(v)) return undefined;
  const x = Number(v);
  return Number.isFinite(x) && x !== 0 ? x : undefined;
};
const num = (v: unknown): number | undefined => {
  if (blank(v)) return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
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

function supplierId(s: PlmSettings, name: string): string {
  if (typeof s.supplier === 'function') return s.supplier(name);
  if (s.supplier && Object.hasOwn(s.supplier, name)) return s.supplier[name];
  return name;
}

// ---------------------------------------------------------------- the mapping

function itemChanges(s: PlmSettings, doc: PlmDoc, warnings: string[]): ItemChange[] {
  const id = String(doc.name);
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
      changes: mine.map((r) => ({ field: String(r.field), from: parseFieldValue(r.from_value), to: parseFieldValue(r.to_value) })),
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
      qtyFrom: op === 'add' ? undefined : num(b.qty_from),
      qtyTo: op === 'remove' ? undefined : num(b.qty_to),
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
      lines: rs.map((r): QuoteLine => clean({ description: String(r.description ?? ''), unitPrice: given(r.unit_price), qty: given(r.qty), oneTime: given(r.one_time) })),
      leadTimeWeeks: given(head.lead_time_weeks),
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
    page[block] = rows(doc[COST_TABLE[block]]).map((r): CostPageRow => clean({
      // The child row's own name: it stays with the row when the table is reordered.
      id: text(r.name),
      label: String(r.label ?? ''),
      oneTime: given(r.one_time),
      unitCost: given(r.unit_cost),
      quantity: given(r.quantity),
      basis: lookup(s.costBasis, r.basis, `${block} cost basis`, id),
      note: text(r.note),
    }));
  }
  return page;
}

function impactState(doc: PlmDoc): ImpactState {
  const out: ImpactState = {};
  for (const f of IMPACT_FIELDS) if (!blank(doc[f])) out[f] = String(doc[f]);
  return out;
}

/** Map one ECR document (REST or webhook) and, if it has been released, its ECO. */
export function mapEcr(s: PlmSettings, doc: PlmDoc, eco?: { name: string; released_on?: string }): ReadResult {
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
