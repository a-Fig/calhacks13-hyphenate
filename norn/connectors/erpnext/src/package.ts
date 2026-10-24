// The ERP change package of a released ECO: every line a person enters in ERPNext to carry the change out, with the
// exact values, traced to the ECO and to Norn's decision. Norn never writes to the ERP (issue #71), so this file only reads.
//
//   buildErpChangePackage(conn, settings, release)  reads ERPNext and returns the package: the lines in order, each with
//                                                   a status from that read (entered, to enter, or conflict)
//   formatErpChangePackage(pkg)                     the package as markdown for a person
//
// Run the build again after a person has entered some lines: every line carries the ECO number in a custom field, so the
// read finds what was entered and compares it with the package. That is how Norn tells whether the entries landed as packaged.
//
// The order is the one verified against the live ERP (bowman/erp/NOTES.md, "Verified call sequence"): the new standard cost,
// then for each affected BOM the new version, its replacement in the parent assemblies, and only then the retirement of the
// old version (ERPNext refuses to retire it first), then the journal entries.
//
// The amounts of the journal entries come from the release (Norn's assessment), not from here. Nothing in this file names a
// company; account roles, price lists and custom-field names come from the settings. The package is plain data: it
// survives JSON.stringify and JSON.parse unchanged.

import type { ItemCode } from './baseline.ts';
import { ErpnextClient } from './client.ts';
import type { DocRef } from './history.ts';
import type { ErpnextConnection, ErpnextSettings } from './options.ts';
import { explodeQty, readBaseline, today, validOn } from './read.ts';

// ---- the input ---------------------------------------------------------------------------------------------------

/** A change to a BOM's lines, on the default BOM of `parent`. Item changes alone re-version the BOMs that use the item. */
export interface BomLineChange {
  parent: ItemCode;
  op: 'add' | 'remove' | 'set_qty';
  child: ItemCode;
  /** The line's new quantity per BOM quantity (`add`, `set_qty`). */
  qty?: number;
}

/** One journal entry: lines that each debit one account role and credit another by the same amount. */
export interface EcoJournal {
  /** Stable within the release; with the ECO number it is how the read finds the entry. Letters, digits, `-` and `_`. */
  key: string;
  title: string;
  lines: { amount: number; debit: string; credit: string; memo: string }[];
}

export interface EcoRelease {
  /** The released change order, e.g. ECO-0319. Entered on every document of the package. */
  eco: string;
  /** The change request it came from, e.g. ECR-0417. */
  ecr: string;
  /** The Norn decision that caused the release: its id and the URL where a finance user can read it. */
  decision: { id: string; url: string };
  /** First day the new standard cost applies, 'YYYY-MM-DD'. A date after today means ERPNext costs the new BOMs at the old price until then. */
  effectiveDate: string;
  /** Posting date of the journal entries. Default: the effective date. */
  postingDate?: string;
  /** Items whose standard cost changes. `rev` is the new revision, shown in the descriptions (the package does not change the Item). */
  items: { item: ItemCode; rev?: string; standardCost: number }[];
  bomChanges?: BomLineChange[];
  journals?: EcoJournal[];
}

// ---- the package -------------------------------------------------------------------------------------------------

export type LineKind = 'standard-cost-close' | 'standard-cost' | 'bom' | 'bom-replace' | 'bom-retire' | 'journal-entry';

/** `to-enter`: nothing for this line in ERPNext yet (or only a draft). `entered`: found, and it matches. `conflict`: found, and it differs. */
export type LineStatus = 'to-enter' | 'entered' | 'conflict';

/**
 * How the person gets to the form: `new` opens an empty one, `edit` changes `document`, `duplicate` starts from
 * `document` (ERPNext's Duplicate), `tool` uses ERPNext's BOM Update Tool, which has no document of its own.
 */
export type LineMode = 'new' | 'edit' | 'duplicate' | 'tool';

/** One value to enter. `field` is ERPNext's field name, `label` the name on the form. */
export interface ErpField {
  field: string;
  label: string;
  /** Null when the value is a document that does not exist yet: `from` says which line creates it. */
  value: string | number | null;
  money?: true;
  /** Id of the line whose document supplies this value. */
  from?: string;
}

/** A child table of the form (BOM items, journal entry accounts) and its rows. */
export interface ErpTable {
  table: string;
  label: string;
  rows: ErpField[][];
}

/** Where a line comes from: the ECO, its ECR and the Norn decision. */
export interface LineTrace {
  eco: string;
  ecr: string;
  decisionId: string;
  decisionUrl: string;
}

export interface ChangeLine {
  /** Stable, e.g. `standard-cost:BW-5120-210`. */
  id: string;
  kind: LineKind;
  /** One short phrase for a list. */
  title: string;
  /** The seat that enters it. */
  enteredBy: 'cost accountant' | 'manufacturing engineer';
  /** The ERPNext doctype to open. */
  doctype: string;
  mode: LineMode;
  /** The document to edit or duplicate. Absent for `new` and `tool`. */
  document?: DocRef;
  /** The page to open, relative to the ERPNext address (`/app/item-price/new`). */
  path: string;
  /** What to do, as a sentence. */
  instruction: string;
  /** Values for the form's own fields, including the ECO tags that let a later read recognise the entry. */
  fields: ErpField[];
  tables: ErpTable[];
  /** The numbers behind the line. */
  amounts: Record<string, number>;
  trace: LineTrace;
  status: LineStatus;
  /** The ERPNext document the read found for this line. */
  found?: DocRef;
  note?: string;
}

export interface ProgramEffect {
  program: string;
  topItem: ItemCode;
  name: string;
  /** Change in the top item's unit cost, from the BOM lines at the effective cost. */
  costDelta: number;
  /** Where it comes from: quantity of the repriced item per unit times its change. */
  basis: string;
}

export interface ErpChangePackage {
  /** Version of this shape. */
  version: 1;
  release: EcoRelease;
  /** The ERPNext address the paths are relative to. */
  erpUrl: string;
  /** ISO timestamp of the read the statuses come from. */
  readAt: string;
  /** In the order to enter them. */
  lines: ChangeLine[];
  counts: { total: number; entered: number; toEnter: number; conflict: number };
  /** Estimated change in each program's unit cost. */
  effects: ProgramEffect[];
  /** Worth reading; the lines can still be entered. */
  warnings: string[];
  /** The package cannot be followed as it stands: a missing account, a price row in the way. */
  problems: string[];
}

// ---- helpers -----------------------------------------------------------------------------------------------------

type Row = Record<string, any>;

const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const enc = encodeURIComponent;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const sentence = (s: string) => s.replace(/\s+/g, ' ').trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function checkRelease(r: EcoRelease): void {
  const bad = (m: string): never => { throw new Error(`invalid ECO release: ${m}`); };
  if (!r.eco?.trim()) bad('eco is empty');
  if (!r.ecr?.trim()) bad('ecr is empty');
  if (!r.decision?.id?.trim()) bad('decision.id is empty');
  try { new URL(r.decision.url); } catch { bad('decision.url is not a URL'); }
  if (!ISO.test(r.effectiveDate ?? '') || Number.isNaN(Date.parse(r.effectiveDate))) bad('effectiveDate must be YYYY-MM-DD');
  if (r.postingDate !== undefined && (!ISO.test(r.postingDate) || Number.isNaN(Date.parse(r.postingDate)))) bad('postingDate must be YYYY-MM-DD');
  if (!r.items?.length && !r.bomChanges?.length && !r.journals?.length) bad('the release changes nothing');
  const seen = new Set<string>();
  for (const i of r.items ?? []) {
    if (!i.item) bad('an item change has no item');
    if (seen.has(i.item)) bad(`${i.item} appears twice in items`);
    seen.add(i.item);
    if (!(Number.isFinite(i.standardCost) && i.standardCost > 0)) bad(`${i.item} needs a standardCost above zero`);
  }
  for (const b of r.bomChanges ?? []) {
    if (!b.parent || !b.child || !['add', 'remove', 'set_qty'].includes(b.op)) bad('a BOM change needs parent, child and op add, remove or set_qty');
    if (b.op !== 'remove' && !(Number.isFinite(b.qty) && b.qty! > 0)) bad(`BOM change ${b.op} ${b.child} in ${b.parent} needs qty above zero`);
  }
  const keys = new Set<string>();
  for (const j of r.journals ?? []) {
    if (!/^[\w-]+$/.test(j.key ?? '')) bad(`journal key '${j.key}' must be letters, digits, - or _`);
    if (keys.has(j.key)) bad(`journal key ${j.key} appears twice`);
    keys.add(j.key);
    if (!j.title?.trim()) bad(`journal ${j.key} has no title`);
    if (!j.lines?.length) bad(`journal ${j.key} has no lines`);
    for (const l of j.lines) {
      if (!(Number.isFinite(l.amount) && l.amount > 0 && r2(l.amount) > 0)) bad(`journal ${j.key}: a line amount must be above zero`);
      if (!l.debit || !l.credit || l.debit === l.credit) bad(`journal ${j.key}: a line needs different debit and credit roles`);
    }
  }
}

/** The custom-field names the package needs, or a message saying which are missing. */
function tagFields(s: ErpnextSettings) {
  const cf = s.customFields ?? {};
  const need = (v: string | undefined, path: string): string => {
    if (!v) throw new Error(`an ERP change package needs customFields.${path} in the settings`);
    return v;
  };
  return {
    bom: { eco: need(cf.bom?.changeOrder, 'bom.changeOrder'), releasedOn: cf.bom?.releasedOn, decision: cf.bom?.decision },
    price: { eco: need(cf.itemPrice?.changeOrder, 'itemPrice.changeOrder'), decision: cf.itemPrice?.decision },
    je: { eco: need(cf.journalEntry?.changeOrder, 'journalEntry.changeOrder'), entry: need(cf.journalEntry?.entry, 'journalEntry.entry'), decision: cf.journalEntry?.decision },
  };
}

const slug = (doctype: string) => doctype.toLowerCase().replace(/\s+/g, '-');
const deskPath = (doctype: string, name?: string) => `/app/${slug(doctype)}/${name ? enc(name) : 'new'}`;
const ref = (doctype: string, name: string): DocRef => ({ doctype, name });

function field(name: string, label: string, value: string | number | null, extra: { money?: true; from?: string } = {}): ErpField {
  return { field: name, label, value, ...(extra.money ? { money: true as const } : {}), ...(extra.from ? { from: extra.from } : {}) };
}

/** "26,431.20 Dr 51900 / Cr 11420; 1,118.40 Dr ...": lines with the same two accounts added up, accounts by number when they have one. */
function pairs(j: EcoJournal, accounts: Record<string, string>): string {
  const short = (role: string) => { const a = accounts[role] ?? role; return /^\d+ - /.test(a) ? a.split(' - ')[0] : a; };
  const sums = new Map<string, number>();
  for (const l of j.lines) {
    const k = `Dr ${short(l.debit)} / Cr ${short(l.credit)}`;
    sums.set(k, (sums.get(k) ?? 0) + l.amount);
  }
  return [...sums].map(([k, v]) => `${money(r2(v))} ${k}`).join('; ') + ` (${plural(j.lines.length, 'line')})`;
}

/** Where a closing date puts a price row: closed as packaged, still open (or running longer), or closed too early. */
function closeState(row: Row, upto: string): { status: LineStatus; note?: string } {
  if (row.valid_upto === upto) return { status: 'entered' };
  if (!row.valid_upto || row.valid_upto > upto) return { status: 'to-enter', ...(row.valid_upto ? { note: `${row.name} still runs to ${row.valid_upto}` } : {}) };
  return { status: 'conflict', note: `${row.name} was closed on ${row.valid_upto}, before ${upto}` };
}

// ---- build -------------------------------------------------------------------------------------------------------

export async function buildErpChangePackage(conn: ErpnextConnection, opts: ErpnextSettings, release: EcoRelease): Promise<ErpChangePackage> {
  checkRelease(release);
  const t = tagFields(opts);
  const c = new ErpnextClient(conn);
  const { eco, effectiveDate } = release;
  const lines: ChangeLine[] = [];
  const warnings: string[] = [];
  const problems: string[] = [];
  const itemCodes = (release.items ?? []).map((i) => i.item);
  const newCost = new Map(release.items.map((i) => [i.item, r2(i.standardCost)]));
  const label = (item: ItemCode) => { const rev = release.items.find((i) => i.item === item)?.rev; return rev ? `${item} Rev ${rev}` : item; };
  const trace: LineTrace = { eco, ecr: release.ecr, decisionId: release.decision.id, decisionUrl: release.decision.url };
  const traceText = `${eco} (${release.ecr}); Norn decision ${release.decision.id}: ${release.decision.url}`;
  type LineInit = Omit<ChangeLine, 'trace' | 'tables' | 'note' | 'found' | 'document'> & { tables?: ErpTable[]; note?: string; found?: DocRef; document?: DocRef };
  const add = (l: LineInit) => lines.push({ ...l, tables: l.tables ?? [], trace });

  if (effectiveDate > today(opts.timeZone)) warnings.push(`the effective date ${effectiveDate} is after today: ERPNext costs a new BOM at the price valid today, so the new BOMs show the old cost until then`);

  // -- standard cost -------------------------------------------------------------------------------------------------
  const oldCost = new Map<ItemCode, number>();
  const closeLine = (code: ItemCode, row: Row, upto: string) => {
    const { status, note } = closeState(row, upto);
    add({
      id: `standard-cost-close:${code}`, kind: 'standard-cost-close', title: `Close ${code}'s current standard cost`, enteredBy: 'cost accountant',
      doctype: 'Item Price', mode: 'edit', document: ref('Item Price', row.name), path: deskPath('Item Price', row.name),
      instruction: `Open Item Price ${row.name} (${code}, ${money(num(row.price_list_rate))} from ${row.valid_from ?? 'the start'}) and set Valid Upto to ${upto}, the day before the new standard cost starts.`,
      fields: [field('valid_upto', 'Valid Upto', upto)], amounts: { rate: num(row.price_list_rate) },
      status, ...(status === 'to-enter' ? {} : { found: ref('Item Price', row.name) }), ...(note ? { note } : {}),
    });
  };
  const priceLine = (code: ItemCode, state: { status: LineStatus; found?: Row; note?: string }, was: number | undefined, from: Row | undefined) => {
    const rate = newCost.get(code)!;
    const rev = release.items.find((i) => i.item === code)?.rev;
    const delta = was === undefined ? '' : ` (was ${money(was)}, ${rate >= was ? '+' : '-'}${money(Math.abs(rate - was))})`;
    add({
      id: `standard-cost:${code}`, kind: 'standard-cost', title: `Set ${label(code)} standard cost to ${money(rate)}`, enteredBy: 'cost accountant',
      doctype: 'Item Price', mode: 'new', path: deskPath('Item Price'),
      instruction: `Add a new Item Price for ${label(code)} on ${opts.standardCostPriceList}: ${money(rate)} from ${effectiveDate}${delta}.`,
      fields: [
        field('item_code', 'Item Code', code), field('price_list', 'Price List', opts.standardCostPriceList),
        field('price_list_rate', 'Rate', rate, { money: true }), field('valid_from', 'Valid From', effectiveDate),
        ...(from?.uom ? [field('uom', 'UOM', from.uom)] : []), ...(from?.currency ? [field('currency', 'Currency', from.currency)] : []),
        field('note', 'Note', sentence(`${traceText}. ${code}${rev ? ` Rev ${rev}` : ''} standard cost ${money(rate)} from ${effectiveDate}${was ? `, was ${money(was)}` : ''}.`)),
        field(t.price.eco, 'Released by ECO', eco), ...(t.price.decision ? [field(t.price.decision, 'Norn decision', release.decision.url)] : []),
      ],
      amounts: { to: rate, ...(was === undefined ? {} : { from: was, change: r2(rate - was) }) },
      status: state.status, ...(state.found ? { found: ref('Item Price', state.found.name) } : {}), ...(state.note ? { note: state.note } : {}),
    });
  };

  if (itemCodes.length) {
    const found = await c.list('Item', { filters: [['name', 'in', itemCodes]], fields: ['name', 'disabled'] });
    for (const code of itemCodes) {
      const it = found.find((x) => x.name === code);
      if (!it) problems.push(`item ${code} does not exist in ERPNext`);
      else if (it.disabled) warnings.push(`item ${code} is disabled in ERPNext`);
    }
    const prices = await c.list('Item Price', {
      filters: [['item_code', 'in', itemCodes], ['price_list', '=', opts.standardCostPriceList]],
      fields: ['name', 'item_code', 'price_list_rate', 'valid_from', 'valid_upto', 'uom', 'currency', t.price.eco], orderBy: 'valid_from asc',
    });
    const upto = dayBefore(effectiveDate);
    for (const code of itemCodes) {
      if (!found.some((x) => x.name === code)) continue;
      const rows = prices.filter((p) => p.item_code === code);
      const rate = newCost.get(code)!;
      const mine = rows.find((p) => p[t.price.eco] === eco);
      const current = [...rows].reverse().find((p) => p[t.price.eco] !== eco && validOn(p, effectiveDate));
      const later = rows.filter((p) => p[t.price.eco] !== eco && p.valid_from && p.valid_from > effectiveDate);
      // What the cost was before this ECO: the row in force now, or the row just before the ECO's own.
      const before = mine ? rows.filter((p) => p !== mine && (p.valid_from ?? '') < (mine.valid_from ?? '')).at(-1) : current;
      oldCost.set(code, num(before?.price_list_rate));
      if (mine) {
        // Entered: the row carries the ECO. It matches when its rate and start date are the package's.
        const diffs = [
          ...(Math.abs(num(mine.price_list_rate) - rate) < 0.005 ? [] : [`has ${money(num(mine.price_list_rate))} where the release says ${money(rate)}`]),
          ...(mine.valid_from === effectiveDate ? [] : [`starts ${mine.valid_from ?? 'with no date'} where the release says ${effectiveDate}`]),
        ];
        if (before) closeLine(code, before, upto);
        priceLine(code, { status: diffs.length ? 'conflict' : 'entered', found: mine, ...(diffs.length ? { note: `${mine.name} ${diffs.join(' and ')}` } : {}) }, before ? num(before.price_list_rate) : undefined, before);
        continue;
      }
      if (later.length) { problems.push(`${code} already has a ${opts.standardCostPriceList} row starting ${later[0].valid_from}, after the effective date ${effectiveDate}`); continue; }
      if (current && Math.abs(num(current.price_list_rate) - rate) < 0.005) { warnings.push(`${code} already costs ${money(rate)} on ${effectiveDate}; no price row to enter`); continue; }
      if (current) {
        if (current.valid_from && current.valid_from >= effectiveDate) { problems.push(`${code}'s current ${opts.standardCostPriceList} row starts ${current.valid_from}, not before the effective date ${effectiveDate}`); continue; }
        closeLine(code, current, upto);
      } else warnings.push(`${code} has no ${opts.standardCostPriceList} row valid on ${effectiveDate}; the new row is the first`);
      priceLine(code, { status: 'to-enter' }, current ? num(current.price_list_rate) : undefined, current);
    }
  }

  // -- BOMs ----------------------------------------------------------------------------------------------------------
  const lineChanges = release.bomChanges ?? [];
  let affected: string[] = [];
  if (itemCodes.length) {
    const useLines = await c.list('BOM Item', { parent: 'BOM', filters: [['item_code', 'in', itemCodes], ['docstatus', '=', 1]], fields: ['parent'] });
    const parents = uniq(useLines.map((l) => l.parent));
    if (parents.length) {
      const boms = await c.list('BOM', { filters: [['name', 'in', parents], ['company', '=', opts.company], ['docstatus', '=', 1]], fields: ['name', 'item', 'is_active', 'is_default', t.bom.eco] });
      affected = boms.filter((b) => (b.is_active && b.is_default) || b[t.bom.eco] === eco).map((b) => b.item);
    }
  }
  affected = uniq([...affected, ...lineChanges.map((b) => b.parent)]);

  const bomFields = ['name', 'item', 'is_active', 'is_default', 'docstatus', 'quantity', 'raw_material_cost', 'operating_cost', 'total_cost', 'creation', t.bom.eco];
  const versions: Row[] = affected.length
    ? await c.list('BOM', { filters: [['item', 'in', affected], ['company', '=', opts.company], ['docstatus', '<', 2]], fields: bomFields, orderBy: 'creation asc' })
    : [];
  const bases = new Map<ItemCode, { base: Row; tagged?: Row }>();
  for (const item of affected) {
    const mine = versions.filter((v) => v.item === item);
    const tagged = [...mine].reverse().find((v) => v[t.bom.eco] === eco);
    const base = tagged ? [...mine].reverse().find((v) => v !== tagged) : [...mine].reverse().find((v) => v.is_active && v.is_default);
    if (!base) { problems.push(`${item} has no active default BOM to version`); continue; }
    bases.set(item, { base, tagged });
  }
  const baseLines: Row[] = bases.size
    ? await c.list('BOM Item', { parent: 'BOM', filters: [['parent', 'in', [...bases.values()].map((b) => b.base.name)], ['docstatus', '=', 1]], fields: ['parent', 'item_code', 'qty', 'uom', 'rate', 'bom_no', 'idx'] })
    : [];
  // The parents that use the old BOM (still to be switched) or the new one (already switched).
  const bomNames = [...bases.values()].flatMap((b) => [b.base.name, ...(b.tagged ? [b.tagged.name] : [])]);
  const refs: Row[] = bomNames.length
    ? await c.list('BOM Item', { parent: 'BOM', filters: [['bom_no', 'in', bomNames], ['docstatus', '=', 1]], fields: ['parent', 'bom_no'] })
    : [];
  const parentBoms: Row[] = refs.length
    ? await c.list('BOM', { filters: [['name', 'in', uniq(refs.map((r) => r.parent))], ['is_active', '=', 1], ['docstatus', '=', 1]], fields: ['name', 'item'] })
    : [];
  const activeParent = new Map(parentBoms.map((p) => [p.name, p.item as ItemCode]));
  const addCodes = uniq(lineChanges.filter((b) => b.op === 'add').map((b) => b.child));
  const addItems: Row[] = addCodes.length ? await c.list('Item', { filters: [['name', 'in', addCodes]], fields: ['name', 'stock_uom', 'default_bom'] }) : [];
  for (const code of addCodes) if (!addItems.some((i) => i.name === code)) problems.push(`item ${code} does not exist in ERPNext`);

  // Children before parents, so a parent's new lines can point at its sub-assembly's new BOM.
  const ordered: ItemCode[] = [];
  const visit = (item: ItemCode, path: ItemCode[]) => {
    if (ordered.includes(item) || path.includes(item) || !bases.has(item)) return;
    for (const l of baseLines.filter((x) => x.parent === bases.get(item)!.base.name)) if (bases.has(l.item_code)) visit(l.item_code, [...path, item]);
    ordered.push(item);
  };
  for (const item of affected) visit(item, []);

  const estimate = new Map<ItemCode, number>(); // new unit cost of an affected assembly
  for (const item of ordered) {
    const { base, tagged } = bases.get(item)!;
    const q = num(base.quantity) || 1;
    const baseRows = baseLines.filter((l) => l.parent === base.name).sort((a, b) => a.idx - b.idx);
    const changes = lineChanges.filter((b) => b.parent === item);
    // A line for a sub-assembly that this release also versions points at that sub-assembly's new BOM.
    const itemRow = (code: ItemCode, qty: number, uom: string | undefined, bomNo: string | undefined): ErpField[] => [
      field('item_code', 'Item Code', code), field('qty', 'Quantity', qty), ...(uom ? [field('uom', 'UOM', uom)] : []),
      ...(bases.has(code) ? [field('bom_no', 'BOM No', bases.get(code)!.tagged?.name ?? null, { from: `bom:${code}` })] : bomNo ? [field('bom_no', 'BOM No', bomNo)] : []),
    ];
    const rows: ErpField[][] = [];
    let raw = 0;
    let known = true;
    for (const l of baseRows) {
      const ch = changes.find((b) => b.child === l.item_code);
      if (ch?.op === 'remove') continue;
      const qty = ch?.op === 'set_qty' ? ch.qty! : num(l.qty);
      raw += qty * (newCost.get(l.item_code) ?? estimate.get(l.item_code) ?? num(l.rate));
      rows.push(itemRow(l.item_code, qty, l.uom, l.bom_no));
    }
    for (const ch of changes) {
      if (ch.op === 'add') {
        known = false;
        const it = addItems.find((i) => i.name === ch.child);
        rows.push(itemRow(ch.child, ch.qty!, it?.stock_uom, it?.default_bom));
      }
      if (ch.op !== 'add' && !baseRows.some((l) => l.item_code === ch.child)) problems.push(`${item}'s BOM ${base.name} has no line for ${ch.child} to ${ch.op === 'remove' ? 'remove' : 'change'}`);
      if (ch.op === 'add' && baseRows.some((l) => l.item_code === ch.child)) problems.push(`${item}'s BOM ${base.name} already has a line for ${ch.child}`);
    }
    const operating = num(base.operating_cost);
    const afterTotal = tagged ? num(tagged.total_cost) : known ? r2(raw + operating) : undefined;
    if (afterTotal !== undefined) estimate.set(item, afterTotal / q);
    const amounts: Record<string, number> = { rawBefore: num(base.raw_material_cost), totalBefore: num(base.total_cost) };
    if (tagged) { amounts.rawAfter = num(tagged.raw_material_cost); amounts.totalAfter = num(tagged.total_cost); } else if (known) { amounts.rawAfter = r2(raw); amounts.totalAfter = afterTotal!; }
    const touched = baseRows.filter((l) => newCost.has(l.item_code)).map((l) => label(l.item_code));
    const why = [...touched.map((x) => `${x} repriced`), ...changes.map((b) => `${b.op} ${b.child}${b.qty ? ` x${b.qty}` : ''}`)].join(', ');
    const cost = `total cost ${money(num(base.total_cost))} -> ${tagged ? money(num(tagged.total_cost)) : known ? money(afterTotal!) : 'recalculated by ERPNext'}`;

    add({
      id: `bom:${item}`, kind: 'bom', title: `New BOM for ${item}`, enteredBy: 'manufacturing engineer',
      doctype: 'BOM', mode: 'duplicate', document: ref('BOM', base.name), path: deskPath('BOM', base.name),
      instruction: `Make the next version of the ${item} BOM (${why || 'changed lines'}): open ${base.name}, choose Duplicate, set the fields below, check the items against the table, and submit. ERPNext costs it from the ${opts.standardCostPriceList} price list (${cost}).`,
      fields: [
        field('item', 'Item', item), field('quantity', 'Quantity', num(base.quantity) || 1), field('company', 'Company', opts.company),
        field('is_active', 'Is Active', 1), field('is_default', 'Is Default', 1),
        field('rm_cost_as_per', 'Rate Of Materials Based On', 'Price List'), field('buying_price_list', 'Price List', opts.standardCostPriceList),
        field(t.bom.eco, 'Released by ECO', eco), ...(t.bom.releasedOn ? [field(t.bom.releasedOn, 'Released on', effectiveDate)] : []),
        ...(t.bom.decision ? [field(t.bom.decision, 'Norn decision', release.decision.url)] : []),
      ],
      tables: [{ table: 'items', label: 'Items', rows }],
      amounts,
      status: tagged?.docstatus === 1 ? 'entered' : 'to-enter',
      ...(tagged ? { found: ref('BOM', tagged.name) } : {}),
      ...(tagged && tagged.docstatus !== 1 ? { note: `${tagged.name} is saved but not submitted; submit it` } : {}),
    });

    const parentsOf = (name: string | undefined) => uniq(refs.filter((r) => r.bom_no === name && activeParent.has(r.parent)).map((r) => r.parent)).sort();
    const stillOld = parentsOf(base.name);
    const switched = tagged ? parentsOf(tagged.name) : [];
    if (stillOld.length || switched.length) {
      const names = stillOld.length ? stillOld : switched;
      add({
        id: `bom-replace:${item}`, kind: 'bom-replace', title: `Replace ${base.name} in its parent BOMs`, enteredBy: 'manufacturing engineer',
        doctype: 'BOM Update Tool', mode: 'tool', path: '/app/bom-update-tool',
        instruction: `In the BOM Update Tool, use Replace BOM to replace ${base.name} with the new ${item} BOM in ${plural(names.length, 'parent BOM')} (${uniq(names.map((n) => activeParent.get(n))).join(', ')}). ERPNext recosts the assemblies above.`,
        fields: [field('current_bom', 'Current BOM', base.name), field('new_bom', 'New BOM', tagged?.name ?? null, { from: `bom:${item}` })],
        amounts: {}, status: stillOld.length ? 'to-enter' : 'entered',
        ...(stillOld.length && switched.length ? { note: `${plural(stillOld.length, 'parent BOM')} still use ${base.name}: ${stillOld.join(', ')}` } : {}),
      });
    }
    add({
      id: `bom-retire:${item}`, kind: 'bom-retire', title: `Retire ${base.name}`, enteredBy: 'manufacturing engineer',
      doctype: 'BOM', mode: 'edit', document: ref('BOM', base.name), path: deskPath('BOM', base.name),
      instruction: `Open ${base.name} and untick Is Active. Do this after it is replaced in the parent BOMs: ERPNext refuses while an active parent still uses it.`,
      fields: [field('is_active', 'Is Active', 0)], amounts: {},
      status: base.is_active ? 'to-enter' : 'entered', ...(base.is_active ? {} : { found: ref('BOM', base.name) }),
    });
  }

  // -- journal entries -----------------------------------------------------------------------------------------------
  const journals = release.journals ?? [];
  const accounts = opts.changePackage?.accounts ?? {};
  if (journals.length) {
    const roles = uniq(journals.flatMap((j) => j.lines.flatMap((l) => [l.debit, l.credit])));
    for (const role of roles) if (!accounts[role]) problems.push(`no account for the role '${role}' in the settings (changePackage.accounts)`);
    const names = uniq(roles.map((r) => accounts[r]).filter(Boolean));
    const found: Row[] = names.length
      ? await c.list('Account', { filters: [['name', 'in', names], ['company', '=', opts.company]], fields: ['name', 'is_group', 'disabled', 'account_type'] })
      : [];
    for (const [role, name] of roles.map((r) => [r, accounts[r]] as const).filter(([, n]) => n)) {
      const a = found.find((x) => x.name === name);
      if (!a) problems.push(`account '${name}' (role ${role}) does not exist for ${opts.company}`);
      else if (a.is_group) problems.push(`account '${name}' (role ${role}) is a group; entries need a leaf account`);
      else if (a.disabled) problems.push(`account '${name}' (role ${role}) is disabled`);
      else if (a.account_type === 'Stock') problems.push(`account '${name}' (role ${role}) is a stock account: with perpetual inventory ERPNext only lets stock transactions post to it`);
    }
    const existing: Row[] = await c.list('Journal Entry', { filters: [[t.je.eco, '=', eco], ['docstatus', '<', 2]], fields: ['name', 'docstatus', 'posting_date', 'total_debit', t.je.entry] });
    const posting = release.postingDate ?? effectiveDate;
    const cc = opts.changePackage?.costCenter;
    for (const j of journals) {
      const total = r2(j.lines.reduce((s, l) => s + l.amount, 0));
      const have = existing.find((e) => e[t.je.entry] === j.key);
      const diffs = have ? [
        ...(Math.abs(num(have.total_debit) - total) < 0.005 ? [] : [`for ${money(num(have.total_debit))} where the release says ${money(total)}`]),
        ...(!have.posting_date || have.posting_date === posting ? [] : [`dated ${have.posting_date} where the release says ${posting}`]),
      ] : [];
      const entryRow = (role: string, side: 'debit' | 'credit', amount: number, memo: string): ErpField[] => [
        field('account', 'Account', accounts[role] ?? role),
        side === 'debit' ? field('debit_in_account_currency', 'Debit', r2(amount), { money: true }) : field('credit_in_account_currency', 'Credit', r2(amount), { money: true }),
        ...(memo ? [field('user_remark', 'Remark', memo)] : []), ...(cc ? [field('cost_center', 'Cost Center', cc)] : []),
      ];
      add({
        id: `journal-entry:${j.key}`, kind: 'journal-entry', title: `Journal entry: ${j.title}`, enteredBy: 'cost accountant',
        doctype: 'Journal Entry', mode: 'new', path: deskPath('Journal Entry'),
        instruction: `Enter the journal entry '${j.title}' dated ${posting}: ${pairs(j, accounts)}. Save it, check the accounting entries against the table, and submit it to post.`,
        fields: [
          field('voucher_type', 'Entry Type', 'Journal Entry'), field('company', 'Company', opts.company), field('posting_date', 'Posting Date', posting),
          field('title', 'Title', sentence(`${eco}: ${j.title}`).slice(0, 140)),
          field(t.je.eco, 'Released by ECO', eco), field(t.je.entry, 'ECO entry', j.key),
          ...(t.je.decision ? [field(t.je.decision, 'Norn decision', release.decision.url)] : []),
        ],
        tables: [{ table: 'accounts', label: 'Accounting Entries', rows: j.lines.flatMap((l) => [entryRow(l.debit, 'debit', l.amount, l.memo), entryRow(l.credit, 'credit', l.amount, l.memo)]) }],
        amounts: { debit: total, credit: total },
        status: diffs.length ? 'conflict' : have?.docstatus === 1 ? 'entered' : 'to-enter',
        ...(have ? { found: ref('Journal Entry', have.name) } : {}),
        ...(have && diffs.length ? { note: `${have.name} is ${diffs.join(' and ')}` } : have && have.docstatus !== 1 ? { note: `${have.name} is saved as a draft; submit it to post` } : {}),
      });
    }
    for (const e of existing) if (!journals.some((j) => j.key === e[t.je.entry])) warnings.push(`${e.name} carries ${eco} but is not in this release (entry '${e[t.je.entry] ?? ''}')`);
  }

  // -- effect on the programs ----------------------------------------------------------------------------------------
  const effects: ProgramEffect[] = [];
  if (itemCodes.length) {
    const { baseline } = await readBaseline({ ...conn, ...opts });
    for (const p of baseline.programs) {
      const below = explodeQty(baseline.bom, p.topItem);
      const parts: string[] = [];
      let delta = 0;
      for (const [item, rate] of newCost) {
        const qty = below.get(item) ?? 0;
        const was = oldCost.get(item);
        if (!qty || was === undefined) continue;
        delta += qty * (rate - was);
        parts.push(`${qty} x ${money(rate - was)} (${item})`);
      }
      if (parts.length) effects.push({ program: p.id, topItem: p.topItem, name: p.name, costDelta: r2(delta), basis: parts.join(' + ') });
    }
  }

  const count = (s: LineStatus) => lines.filter((l) => l.status === s).length;
  return {
    version: 1, release, erpUrl: conn.url.replace(/\/+$/, ''), readAt: new Date().toISOString(), lines,
    counts: { total: lines.length, entered: count('entered'), toEnter: count('to-enter'), conflict: count('conflict') },
    effects, warnings, problems,
  };
}

// ---- render ------------------------------------------------------------------------------------------------------

const STATUS: Record<LineStatus, string> = { 'to-enter': 'To enter', entered: 'Entered', conflict: 'Conflict' };
const words = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase();
const cell = (v: string) => v.replace(/\|/g, '\\|');

/** One value as the form shows it. A value that waits for another line says which. */
function shown(f: ErpField, pkg: ErpChangePackage): string {
  if (f.value === null) {
    const n = pkg.lines.findIndex((l) => l.id === f.from);
    return n < 0 ? 'empty' : `the new ${pkg.lines[n].doctype} from step ${n + 1}`;
  }
  return typeof f.value === 'number' ? (f.money ? money(f.value) : String(f.value)) : f.value;
}

/** The package as markdown for a person: what is entered so far, then each line in order with its values and trace. */
export function formatErpChangePackage(pkg: ErpChangePackage): string {
  const r = pkg.release;
  const k = pkg.counts;
  const out: string[] = [
    `# ERP change package for ${r.eco}`,
    '',
    `${r.eco} came from ${r.ecr} and Norn decision ${r.decision.id} (${r.decision.url}). New standard costs apply from ${r.effectiveDate}; journal entries are dated ${r.postingDate ?? r.effectiveDate}.`,
    '',
    `ERPNext was read at ${pkg.readAt}: ${k.entered} of ${plural(k.total, 'line')} entered, ${k.toEnter} to enter, ${k.conflict} in conflict.`,
  ];
  if (pkg.problems.length) out.push('', '## Problems', '', 'The package cannot be followed as it stands until these are fixed.', '', ...pkg.problems.map((p) => `- ${p}`));
  if (!pkg.lines.length) out.push('', 'Nothing to enter.');
  else out.push('', `Enter the lines in this order. Each carries the ECO number, which is how Norn finds it again on its next read of ERPNext.`);

  pkg.lines.forEach((l, i) => {
    const where = l.mode === 'new' ? `a new ${l.doctype}` : l.mode === 'tool' ? `the ${l.doctype}` : `${l.doctype} ${l.document!.name}`;
    out.push('', `## ${i + 1}. ${l.title}`, '', `${STATUS[l.status]}. ${l.enteredBy[0].toUpperCase()}${l.enteredBy.slice(1)}. Open ${where}: ${pkg.erpUrl}${l.path}`, '', l.instruction);
    if (l.note) out.push('', `Note: ${l.note}.`);
    if (l.found && l.status !== 'to-enter') out.push('', `Found in ERPNext: ${l.found.doctype} ${l.found.name}.`);
    if (l.fields.length) out.push('', '| Field | Value |', '|---|---|', ...l.fields.map((f) => `| ${cell(f.label)} (${f.field}) | ${cell(shown(f, pkg))} |`));
    for (const tb of l.tables) {
      // Columns in the order rows first show them, except that amounts sit next to each other, before free text.
      const all = tb.rows.flatMap((row) => row);
      const seen = uniq(all.map((f) => f.field));
      const isMoney = (col: string) => all.find((f) => f.field === col)!.money === true;
      const cols = [seen[0], ...seen.slice(1).filter(isMoney), ...seen.slice(1).filter((c) => !isMoney(c))];
      const head = cols.map((col) => all.find((f) => f.field === col)!.label);
      out.push('', `${tb.label} (${tb.table}):`, '', `| ${head.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
        ...tb.rows.map((row) => `| ${cols.map((col) => { const f = row.find((x) => x.field === col); return f ? cell(shown(f, pkg)) : ''; }).join(' | ')} |`));
    }
    const amounts = Object.entries(l.amounts);
    if (amounts.length) out.push('', `Amounts: ${amounts.map(([key, v]) => `${words(key)} ${money(v)}`).join(', ')}.`);
    out.push('', `Trace: ${l.trace.eco}, ${l.trace.ecr}, Norn decision ${l.trace.decisionId} (${l.trace.decisionUrl}).`);
  });

  if (pkg.effects.length) {
    out.push('', '## Estimated change in unit cost', '');
    for (const e of pkg.effects) out.push(`- ${e.name} (${e.topItem}): ${e.costDelta >= 0 ? '+' : '-'}${money(Math.abs(e.costDelta))}, from ${e.basis}`);
  }
  if (pkg.warnings.length) out.push('', '## Warnings', '', ...pkg.warnings.map((w) => `- ${w}`));
  return out.join('\n');
}
