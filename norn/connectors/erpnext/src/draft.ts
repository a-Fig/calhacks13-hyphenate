// Fern's drafts in ERPNext (Tyler, 2026-10-25, reversing #71: "Fern drafts"). When an ECO is released, Fern saves the
// lines of its ERP change package that ERPNext can hold as drafts, unsubmitted (docstatus 0): each new BOM version and each
// journal entry. A person reviews and submits them. Fern cannot: its ERPNext role may create, read and write BOMs and
// journal entries, and has no submit, cancel or delete anywhere (bowman/erp/bootstrap.mjs; bowman/erp/prove-no-submit.ts
// shows ERPNext refusing).
//
//   planDrafts(pkg)                      which lines to draft, as ERPNext documents (pure: no requests)
//   draftErpChangePackage(conn, s, pkg)  saves them, unless a document for the line is already there
//
// Idempotent: before it saves, it looks for a document carrying the ECO number and the line's identity (the item for a
// BOM, the ECO entry key for a journal entry) that is not cancelled. Found means nothing is saved, so a re-run or a worker
// restart never makes a second draft. The package read (package.ts) finds the same documents and shows them as `drafted`.
//
// The other lines stay for a person, as before: the Item Price standard cost (and closing the old row), the BOM's
// replacement in its parent BOMs (BOM Update Tool) and retiring the old BOM. A BOM whose line has to point at another new
// BOM is not drafted either: ERPNext only lets a BOM name a submitted BOM, and the new one is still a draft.
//
// This file is the only place in the connector that sends anything but a GET, and the only thing it sends is an insert
// of a new document with docstatus 0. Never logs or throws headers, keys or secrets.

import { ErpnextClient, ErpnextError } from './client.ts';
import type { DocRef } from './history.ts';
import type { ErpnextConnection, ErpnextSettings } from './options.ts';
import type { ChangeLine, ErpChangePackage, ErpField } from './package.ts';

/** One document to save as a draft. `identity` is how an existing one is found: the ECO tag plus the line's own key. */
export interface PlannedDraft {
  lineId: string;
  doctype: 'BOM' | 'Journal Entry';
  identity: [field: string, value: string][];
  doc: Record<string, unknown>;
}

export interface DraftPlan {
  drafts: PlannedDraft[];
  /** Lines of a draftable kind that are not drafted, and why. */
  skipped: { lineId: string; why: string }[];
}

export interface DraftResult {
  created: (DocRef & { lineId: string })[];
  /** A document for the line was already there: nothing saved. */
  existing: (DocRef & { lineId: string })[];
  skipped: { lineId: string; why: string }[];
  /** A save ERPNext refused. The line stays for a person. */
  failed: { lineId: string; why: string }[];
}

const DRAFTABLE: Record<string, PlannedDraft['doctype']> = { bom: 'BOM', 'journal-entry': 'Journal Entry' };

const fieldsToDoc = (fs: ErpField[]): Record<string, unknown> => Object.fromEntries(fs.map((f) => [f.field, f.value]));
const valueOf = (l: ChangeLine, field: string) => l.fields.find((f) => f.field === field)?.value;

/** The lines Fern drafts: a BOM version or a journal entry that ERPNext does not hold yet in any form. */
export function planDrafts(pkg: ErpChangePackage, ecoField: string, entryField: string): DraftPlan {
  const out: DraftPlan = { drafts: [], skipped: [] };
  for (const l of pkg.lines) {
    const doctype = DRAFTABLE[l.kind];
    if (!doctype) continue;
    if (l.status !== 'to-enter' || l.found) continue; // drafted, entered or in conflict: a document is already there
    const waiting = [...l.fields, ...l.tables.flatMap((t) => t.rows.flat())].filter((f) => f.value === null);
    if (waiting.length) {
      out.skipped.push({ lineId: l.id, why: `needs the document from ${waiting.map((f) => f.from ?? f.label).join(', ')} submitted first` });
      continue;
    }
    const eco = valueOf(l, ecoField);
    if (eco !== pkg.release.eco) {
      out.skipped.push({ lineId: l.id, why: `the line does not carry ${pkg.release.eco} in ${ecoField}` });
      continue;
    }
    const doc: Record<string, unknown> = { ...fieldsToDoc(l.fields) };
    for (const t of l.tables) doc[t.table] = t.rows.map(fieldsToDoc);
    let identity: PlannedDraft['identity'];
    if (doctype === 'BOM') {
      identity = [[ecoField, eco], ['item', String(valueOf(l, 'item'))]];
    } else {
      identity = [[ecoField, eco], [entryField, String(valueOf(l, entryField))]];
      doc.user_remark = `${l.title}. Drafted by Fern for ${l.trace.eco} (${l.trace.ecr}); decision ${l.trace.decisionUrl}`;
    }
    doc.docstatus = 0;
    out.drafts.push({ lineId: l.id, doctype, identity, doc });
  }
  return out;
}

/** A client that can also insert. It inherits the GET-only reads; `insert` saves a new document as a draft and nothing else. */
class DraftClient extends ErpnextClient {
  #base: string;
  #auth: string;
  constructor(c: ErpnextConnection) {
    super(c);
    this.#base = c.url.replace(/\/+$/, '');
    this.#auth = `token ${c.apiKey}:${c.apiSecret}`;
  }

  async insert(doctype: string, doc: Record<string, unknown>): Promise<string> {
    if (doc.docstatus !== 0) throw new Error('Fern only saves drafts (docstatus 0)');
    const path = `/api/resource/${encodeURIComponent(doctype)}`;
    this.requests++;
    const r = await fetch(this.#base + path, {
      method: 'POST',
      headers: { Authorization: this.#auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...doc, doctype }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (!r.ok) {
      let msg = '';
      try { msg = JSON.parse(body._server_messages).map((m: string) => JSON.parse(m).message).join(' | ').replace(/<[^>]+>/g, ''); } catch { /* none */ }
      throw new ErpnextError(r.status, doctype, [body?.exc_type, msg].filter(Boolean).join(' - '));
    }
    const name = body?.data?.name;
    if (typeof name !== 'string') throw new ErpnextError(r.status, doctype, 'no document name in the answer');
    if (body.data.docstatus !== 0) throw new Error(`ERPNext saved ${doctype} ${name} with docstatus ${body.data.docstatus}, not as a draft`);
    return name;
  }
}

/** Save the package's draftable lines as drafts in ERPNext, skipping any line whose document is already there. */
export async function draftErpChangePackage(conn: ErpnextConnection, settings: ErpnextSettings, pkg: ErpChangePackage): Promise<DraftResult> {
  const cf = settings.customFields ?? {};
  const ecoField = cf.bom?.changeOrder;
  const entryField = cf.journalEntry?.entry;
  if (!ecoField || !entryField || cf.journalEntry?.changeOrder !== ecoField) throw new Error('drafts need customFields.bom.changeOrder and journalEntry.changeOrder (the same field) and journalEntry.entry');
  const plan = planDrafts(pkg, ecoField, entryField);
  const res: DraftResult = { created: [], existing: [], skipped: plan.skipped, failed: [] };
  if (!plan.drafts.length) return res;
  const c = new DraftClient(conn);
  for (const d of plan.drafts) {
    const filters: [string, string, unknown][] = [...d.identity.map(([f, v]) => [f, '=', v] as [string, string, unknown]), ['docstatus', '<', 2]];
    if (d.doctype === 'BOM') filters.push(['company', '=', settings.company]);
    const there = await c.list(d.doctype, { filters, fields: ['name', 'docstatus'], orderBy: 'creation asc' });
    if (there.length) {
      res.existing.push({ lineId: d.lineId, doctype: d.doctype, name: there[0].name });
      continue;
    }
    try {
      res.created.push({ lineId: d.lineId, doctype: d.doctype, name: await c.insert(d.doctype, d.doc) });
    } catch (e) {
      res.failed.push({ lineId: d.lineId, why: (e as Error).message });
    }
  }
  return res;
}

/** The ERPNext desk page of a document, for a link. */
export const deskUrl = (erpUrl: string, ref: DocRef) => `${erpUrl.replace(/\/+$/, '')}/app/${ref.doctype.toLowerCase().replace(/\s+/g, '-')}/${encodeURIComponent(ref.name)}`;
