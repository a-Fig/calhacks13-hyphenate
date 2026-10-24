// ECO write-back: when a change order is released, Norn writes its effects into ERPNext as the Norn Agent user.
//
//   planEcoRelease(conn, settings, release)  reads ERPNext, writes nothing, and returns the plan: every write, in order
//   applyEcoRelease(conn, settings, plan)    executes the plan and returns what it wrote (doctype, name, link)
//
// The order is the one verified against the live ERP (bowman/erp/NOTES.md, "Verified call sequence"): the new price,
// then for each affected BOM the new version, its replacement in the parent assemblies, and only then the retirement
// of the old version (retiring first fails with 417), then the draft journal entries.
//
// Re-applying a release is safe: every document carries the ECO number, so each step first looks for its own earlier
// write and skips it. The amounts of the journal entries come from the release (Norn's assessment), not from here.
// Nothing in this file names a company; account roles, price lists and custom-field names come from the settings.

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
  /** Stable within the release; with the ECO number it is how a retry finds the entry. Letters, digits, `-` and `_`. */
  key: string;
  title: string;
  lines: { amount: number; debit: string; credit: string; memo: string }[];
}

export interface EcoRelease {
  /** The released change order, e.g. ECO-0319. Stamped on everything written. */
  eco: string;
  /** The change request it came from, e.g. ECR-0417. */
  ecr: string;
  /** The Norn decision that caused the release: its id and the URL where a finance user can read it. */
  decision: { id: string; url: string };
  /** First day the new standard cost applies, 'YYYY-MM-DD'. A date after today means ERPNext costs the new BOMs at the old price until then. */
  effectiveDate: string;
  /** Posting date of the journal entries. Default: the effective date. */
  postingDate?: string;
  /** Items whose standard cost changes. `rev` is the new revision, shown in the descriptions (Norn cannot edit the Item). */
  items: { item: ItemCode; rev?: string; standardCost: number }[];
  bomChanges?: BomLineChange[];
  journals?: EcoJournal[];
}

// ---- the plan ----------------------------------------------------------------------------------------------------

export type StepKind = 'price-close' | 'price' | 'bom' | 'bom-replace' | 'bom-retire' | 'journal';

export interface PlanStep {
  /** Stable, e.g. `price:BW-5120-210`. */
  id: string;
  kind: StepKind;
  /** The ERPNext doctype written. */
  doctype: string;
  /** One line a person can read. */
  summary: string;
  /** The numbers behind the line. */
  amounts: Record<string, number>;
  /** `todo`; `done` when the ECO's own earlier write was found; `conflict` when something else stands in the way. */
  status: 'todo' | 'done' | 'conflict';
  /** The document already there, for `done` and `conflict`. */
  existing?: DocRef;
  note?: string;
  /** What `applyEcoRelease` needs to do the step. Plain data. */
  args: Record<string, any>;
}

export interface PlanEffect {
  program: string;
  topItem: ItemCode;
  name: string;
  /** Change in the top item's unit cost, from the BOM lines at the effective cost. */
  costDelta: number;
  /** Where it comes from: quantity of the repriced item per unit times its change. */
  basis: string;
}

export interface EcoPlan {
  release: EcoRelease;
  /** ISO timestamp of the read. */
  readAt: string;
  steps: PlanStep[];
  /** Estimated change in each program's unit cost. */
  effects: PlanEffect[];
  /** Worth reading; the plan can still be applied. */
  warnings: string[];
  /** Stops `applyEcoRelease`: a missing account, a clash with an existing document. */
  problems: string[];
}

// ---- the result --------------------------------------------------------------------------------------------------

export interface Written {
  step: string;
  /** `existing`: the ECO's own earlier write was found and left alone. */
  action: 'created' | 'updated' | 'existing';
  doctype: string;
  name: string;
  /** Where to open it in ERPNext. */
  link: string;
  summary: string;
}

export interface ApplyResult {
  eco: string;
  at: string;
  written: Written[];
  /** Steps that needed no write, with the reason. */
  skipped: string[];
}

export class EcoPlanError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`the plan has problems: ${problems.join('; ')}`.slice(0, 600));
    this.name = 'EcoPlanError';
    this.problems = problems;
  }
}

/** A step failed. Everything before it was written; applying the same release again continues from there. */
export class EcoApplyError extends Error {
  step: string;
  written: Written[];
  constructor(step: string, cause: unknown, written: Written[]) {
    super(`step ${step} failed after ${written.length} writes: ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 700));
    this.name = 'EcoApplyError';
    this.step = step;
    this.written = written;
  }
}

// ---- helpers -----------------------------------------------------------------------------------------------------

const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const enc = encodeURIComponent;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const sentence = (s: string) => s.replace(/\s+/g, ' ').trim();

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

/** The custom-field names the write-back needs, or a message saying which are missing. */
function tagFields(s: ErpnextSettings) {
  const cf = s.customFields ?? {};
  const need = (v: string | undefined, path: string): string => {
    if (!v) throw new Error(`writing an ECO release needs customFields.${path} in the settings`);
    return v;
  };
  return {
    bom: { eco: need(cf.bom?.changeOrder, 'bom.changeOrder'), releasedOn: cf.bom?.releasedOn, decision: cf.bom?.decision },
    price: { eco: need(cf.itemPrice?.changeOrder, 'itemPrice.changeOrder'), decision: cf.itemPrice?.decision },
    je: { eco: need(cf.journalEntry?.changeOrder, 'journalEntry.changeOrder'), entry: need(cf.journalEntry?.entry, 'journalEntry.entry'), decision: cf.journalEntry?.decision },
  };
}
type Tags = ReturnType<typeof tagFields>;

const slug = (doctype: string) => doctype.toLowerCase().replace(/\s+/g, '-');
const docLink = (conn: ErpnextConnection, doctype: string, name: string) => `${conn.url.replace(/\/+$/, '')}/app/${slug(doctype)}/${enc(name)}`;
const priceUrl = `/api/resource/${enc('Item Price')}`;
const bomUrl = `/api/resource/${enc('BOM')}`;
const jeUrl = `/api/resource/${enc('Journal Entry')}`;
const replaceMethod = '/api/method/erpnext.manufacturing.doctype.bom_update_tool.bom_update_tool.enqueue_replace_bom';

/** "26,431.20 Dr 51900 / Cr 11420; 1,118.40 Dr ...": lines with the same two accounts added up, accounts by number when they have one. */
function pairs(j: EcoJournal, accounts: Record<string, string>): string {
  const short = (role: string) => { const a = accounts[role] ?? role; return /^\d+ - /.test(a) ? a.split(' - ')[0] : a; };
  const sums = new Map<string, number>();
  for (const l of j.lines) {
    const k = `Dr ${short(l.debit)} / Cr ${short(l.credit)}`;
    sums.set(k, (sums.get(k) ?? 0) + l.amount);
  }
  return [...sums].map(([k, v]) => `${money(r2(v))} ${k}`).join('; ') + ` (${j.lines.length} line${j.lines.length > 1 ? 's' : ''})`;
}

/** The text a finance user reads on a document Norn wrote. */
const traceText = (r: EcoRelease) => `${r.eco} (${r.ecr}); Norn decision ${r.decision.id}: ${r.decision.url}`;

// ---- plan --------------------------------------------------------------------------------------------------------

type Row = Record<string, any>;

export async function planEcoRelease(conn: ErpnextConnection, opts: ErpnextSettings, release: EcoRelease): Promise<EcoPlan> {
  checkRelease(release);
  const t = tagFields(opts);
  const c = new ErpnextClient(conn);
  const { eco, effectiveDate } = release;
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  const problems: string[] = [];
  const itemCodes = (release.items ?? []).map((i) => i.item);
  const newCost = new Map(release.items.map((i) => [i.item, r2(i.standardCost)]));
  const label = (item: ItemCode) => { const rev = release.items.find((i) => i.item === item)?.rev; return rev ? `${item} Rev ${rev}` : item; };

  if (effectiveDate > today()) warnings.push(`the effective date ${effectiveDate} is after today: ERPNext costs a new BOM at the price valid today, so the new BOMs show the old cost until then`);

  // -- standard cost -------------------------------------------------------------------------------------------------
  const oldCost = new Map<ItemCode, number>();
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
    for (const code of itemCodes) {
      if (!found.some((x) => x.name === code)) continue;
      const rows = prices.filter((p) => p.item_code === code);
      const rate = newCost.get(code)!;
      const mine = rows.find((p) => p[t.price.eco] === eco);
      const current = [...rows].reverse().find((p) => p[t.price.eco] !== eco && validOn(p, effectiveDate));
      const later = rows.filter((p) => p[t.price.eco] !== eco && p.valid_from && p.valid_from > effectiveDate);
      // What the cost was before this ECO: the row in force now, or the row just before the ECO's own.
      oldCost.set(code, num((mine ? rows.filter((p) => p !== mine && (p.valid_from ?? '') < (mine.valid_from ?? '')).at(-1) : current)?.price_list_rate));
      if (mine) {
        const same = Math.abs(num(mine.price_list_rate) - rate) < 0.005;
        steps.push({
          id: `price:${code}`, kind: 'price', doctype: 'Item Price', status: same ? 'done' : 'conflict',
          summary: `${label(code)} standard cost ${money(rate)} from ${effectiveDate}: already written as ${mine.name}`,
          amounts: { to: rate, from: oldCost.get(code) ?? 0 }, existing: { doctype: 'Item Price', name: mine.name },
          ...(same ? {} : { note: `${mine.name} has ${money(num(mine.price_list_rate))}, the release says ${money(rate)}` }), args: {},
        });
        if (!same) problems.push(`${code}: ${mine.name} was written for ${eco} at ${money(num(mine.price_list_rate))}, the release now says ${money(rate)}; delete it first`);
        continue;
      }
      if (later.length) { problems.push(`${code} already has a ${opts.standardCostPriceList} row starting ${later[0].valid_from}, after the effective date ${effectiveDate}`); continue; }
      if (current && Math.abs(num(current.price_list_rate) - rate) < 0.005) { warnings.push(`${code} already costs ${money(rate)} on ${effectiveDate}; no price row written`); continue; }
      if (current) {
        if (current.valid_from && current.valid_from >= effectiveDate) { problems.push(`${code}'s current ${opts.standardCostPriceList} row starts ${current.valid_from}, not before the effective date ${effectiveDate}`); continue; }
        steps.push({
          id: `price-close:${code}`, kind: 'price-close', doctype: 'Item Price', status: 'todo',
          summary: `Close ${code}'s current standard cost ${money(num(current.price_list_rate))} (from ${current.valid_from ?? 'the start'}) on ${dayBefore(effectiveDate)}`,
          amounts: { rate: num(current.price_list_rate) }, existing: { doctype: 'Item Price', name: current.name }, args: { name: current.name, upto: dayBefore(effectiveDate) },
        });
      } else warnings.push(`${code} has no ${opts.standardCostPriceList} row valid on ${effectiveDate}; the new row is the first`);
      const was = num(current?.price_list_rate);
      steps.push({
        id: `price:${code}`, kind: 'price', doctype: 'Item Price', status: 'todo',
        summary: `Set ${label(code)} standard cost to ${money(rate)} from ${effectiveDate}${current ? ` (was ${money(was)}, ${rate >= was ? '+' : '-'}${money(Math.abs(rate - was))})` : ''}`,
        amounts: { from: was, to: rate, change: r2(rate - was) }, args: { item: code, rate, uom: current?.uom, currency: current?.currency },
      });
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
    ? await c.list('BOM Item', { parent: 'BOM', filters: [['parent', 'in', [...bases.values()].map((b) => b.base.name)], ['docstatus', '=', 1]], fields: ['parent', 'item_code', 'qty', 'rate', 'bom_no', 'idx'] })
    : [];
  const refs: Row[] = bases.size
    ? await c.list('BOM Item', { parent: 'BOM', filters: [['bom_no', 'in', [...bases.values()].map((b) => b.base.name)], ['docstatus', '=', 1]], fields: ['parent', 'bom_no'] })
    : [];
  const parentBoms: Row[] = refs.length
    ? await c.list('BOM', { filters: [['name', 'in', uniq(refs.map((r) => r.parent))], ['is_active', '=', 1], ['docstatus', '=', 1]], fields: ['name', 'item'] })
    : [];
  const activeParent = new Map(parentBoms.map((p) => [p.name, p.item as ItemCode]));

  // Children before parents, so a parent version is cloned after its sub-assembly was replaced in it.
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
    const lines = baseLines.filter((l) => l.parent === base.name).sort((a, b) => a.idx - b.idx);
    const changes = lineChanges.filter((b) => b.parent === item);
    let raw = 0;
    let known = true;
    for (const l of lines) {
      const ch = changes.find((b) => b.child === l.item_code);
      if (ch?.op === 'remove') continue;
      const qty = ch?.op === 'set_qty' ? ch.qty! : num(l.qty);
      raw += qty * (newCost.get(l.item_code) ?? estimate.get(l.item_code) ?? num(l.rate));
    }
    for (const ch of changes) {
      if (ch.op === 'add') known = false;
      if (ch.op !== 'add' && !lines.some((l) => l.item_code === ch.child)) problems.push(`${item}'s BOM ${base.name} has no line for ${ch.child} to ${ch.op === 'remove' ? 'remove' : 'change'}`);
      if (ch.op === 'add' && lines.some((l) => l.item_code === ch.child)) problems.push(`${item}'s BOM ${base.name} already has a line for ${ch.child}`);
    }
    const operating = num(base.operating_cost);
    const afterTotal = tagged ? num(tagged.total_cost) : known ? r2(raw + operating) : undefined;
    if (afterTotal !== undefined) estimate.set(item, afterTotal / q);
    const amounts: Record<string, number> = { rawBefore: num(base.raw_material_cost), totalBefore: num(base.total_cost) };
    if (tagged) { amounts.rawAfter = num(tagged.raw_material_cost); amounts.totalAfter = num(tagged.total_cost); } else if (known) { amounts.rawAfter = r2(raw); amounts.totalAfter = afterTotal!; }
    const touched = lines.filter((l) => newCost.has(l.item_code)).map((l) => label(l.item_code));
    const why = [...touched.map((x) => `${x} repriced`), ...changes.map((b) => `${b.op} ${b.child}${b.qty ? ` x${b.qty}` : ''}`)].join(', ');

    steps.push({
      id: `bom:${item}`, kind: 'bom', doctype: 'BOM', status: tagged ? 'done' : 'todo',
      summary: tagged
        ? `New BOM for ${item}: ${tagged.name} already written`
        : `New BOM for ${item} from ${base.name} (${why || 'changed lines'}): total cost ${money(num(base.total_cost))} -> ${known ? money(afterTotal!) : 'recalculated by ERPNext'}, tagged ${eco}`,
      amounts, ...(tagged ? { existing: { doctype: 'BOM', name: tagged.name } } : {}), args: { item, oldBom: base.name },
    });
    const parentsOfBase = uniq(refs.filter((r) => r.bom_no === base.name && activeParent.has(r.parent)).map((r) => r.parent));
    const parentItems = uniq(parentsOfBase.map((p) => activeParent.get(p)!));
    steps.push({
      id: `bom-replace:${item}`, kind: 'bom-replace', doctype: 'BOM Update Log',
      status: parentsOfBase.length ? 'todo' : 'done',
      summary: parentsOfBase.length
        ? `Replace ${base.name} with the new ${item} BOM in ${parentsOfBase.length} parent BOM${parentsOfBase.length > 1 ? 's' : ''} (${parentItems.join(', ')}); ERPNext recosts the assemblies above`
        : `Replace ${base.name} in parent BOMs: no active parent uses it`,
      amounts: { parents: parentsOfBase.length }, args: { item, oldBom: base.name, parents: parentsOfBase },
    });
    steps.push({
      id: `bom-retire:${item}`, kind: 'bom-retire', doctype: 'BOM', status: base.is_active ? 'todo' : 'done',
      summary: base.is_active ? `Retire ${base.name} (inactive, no longer default)` : `Retire ${base.name}: already inactive`,
      amounts: {}, existing: { doctype: 'BOM', name: base.name }, args: { item, oldBom: base.name },
    });
  }

  // -- journal entries -----------------------------------------------------------------------------------------------
  const journals = release.journals ?? [];
  const accounts = opts.write?.accounts ?? {};
  if (journals.length) {
    const roles = uniq(journals.flatMap((j) => j.lines.flatMap((l) => [l.debit, l.credit])));
    for (const role of roles) if (!accounts[role]) problems.push(`no account for the role '${role}' in the settings (write.accounts)`);
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
    for (const j of journals) {
      const total = r2(j.lines.reduce((s, l) => s + l.amount, 0));
      const have = existing.find((e) => e[t.je.entry] === j.key);
      const same = have && Math.abs(num(have.total_debit) - total) < 0.005;
      steps.push({
        id: `journal:${j.key}`, kind: 'journal', doctype: 'Journal Entry', status: have ? (same ? 'done' : 'conflict') : 'todo',
        summary: have
          ? `Draft journal entry '${j.title}': ${have.name} already written${have.docstatus === 1 ? ' and submitted' : ''}${same ? '' : `, but for ${money(num(have.total_debit))} where the release says ${money(total)}`}`
          : `Draft journal entry '${j.title}': ${pairs(j, accounts)} (${posting})`,
        amounts: { debit: total, credit: total, lines: j.lines.length },
        ...(have ? { existing: { doctype: 'Journal Entry', name: have.name } } : {}),
        args: { key: j.key, posting },
      });
      if (have && !same) problems.push(`${have.name} (${j.key}) was written for ${money(num(have.total_debit))}, the release now says ${money(total)}; Norn cannot edit a journal entry, so delete the draft first`);
    }
    for (const e of existing) if (!journals.some((j) => j.key === e[t.je.entry])) warnings.push(`${e.name} carries ${eco} but is not in this release (entry '${e[t.je.entry] ?? ''}')`);
  }

  // -- effect on the programs ----------------------------------------------------------------------------------------
  const effects: PlanEffect[] = [];
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

  return { release, readAt: new Date().toISOString(), steps, effects, warnings, problems };
}

/** The plan as text for a person: the steps in order, the estimated effect, then warnings and problems. */
export function formatPlan(plan: EcoPlan): string {
  const r = plan.release;
  const out = [
    `${r.eco} (${r.ecr})  decision ${r.decision.id}  ${r.decision.url}`,
    `effective ${r.effectiveDate}; journal entries dated ${r.postingDate ?? r.effectiveDate}; read ${plan.readAt}`,
    '',
  ];
  plan.steps.forEach((s, i) => out.push(`${String(i + 1).padStart(2)}. [${s.status.padEnd(8)}] ${s.doctype.padEnd(13)} ${s.summary}`));
  if (!plan.steps.length) out.push('    (nothing to write)');
  if (plan.effects.length) {
    out.push('', 'Estimated change in unit cost:');
    for (const e of plan.effects) out.push(`    ${e.name} (${e.topItem}) ${e.costDelta >= 0 ? '+' : '-'}${money(Math.abs(e.costDelta))}   ${e.basis}`);
  }
  if (plan.warnings.length) out.push('', 'Warnings:', ...plan.warnings.map((w) => `    ${w}`));
  if (plan.problems.length) out.push('', 'Problems (apply refuses until fixed):', ...plan.problems.map((w) => `    ${w}`));
  return out.join('\n');
}

// ---- apply -------------------------------------------------------------------------------------------------------

export interface ApplyOptions {
  /** How often to ask whether a BOM Update Log finished, ms. Default 1000. */
  pollMs?: number;
  /** How long to wait for it, ms. Default 120000. */
  waitMs?: number;
}

export async function applyEcoRelease(conn: ErpnextConnection, opts: ErpnextSettings, plan: EcoPlan, run: ApplyOptions = {}): Promise<ApplyResult> {
  if (plan.problems.length) throw new EcoPlanError(plan.problems);
  checkRelease(plan.release);
  const t = tagFields(opts);
  const c = new ErpnextClient(conn);
  const r = plan.release;
  const written: Written[] = [];
  const skipped: string[] = [];
  const newBom = new Map<ItemCode, string>();
  const link = (doctype: string, name: string) => docLink(conn, doctype, name);
  const add = (step: PlanStep, action: Written['action'], doctype: string, name: string, summary = step.summary) => {
    written.push({ step: step.id, action, doctype, name, link: link(doctype, name), summary });
  };
  const one = async <T = Row>(url: string, name: string): Promise<T> => (await c.get<{ data: T }>(`${url}/${enc(name)}`)).data;
  const trace = traceText(r);

  for (const step of plan.steps) {
    try {
      switch (step.kind) {
        case 'price-close': {
          const row = await one(priceUrl, step.args.name);
          if (row.valid_upto && row.valid_upto <= step.args.upto) { add(step, 'existing', 'Item Price', row.name); break; }
          await c.put(`${priceUrl}/${enc(row.name)}`, { valid_upto: step.args.upto });
          add(step, 'updated', 'Item Price', row.name);
          break;
        }
        case 'price': {
          if (step.status === 'done') { add(step, 'existing', step.existing!.doctype, step.existing!.name); break; }
          const have = await c.list('Item Price', {
            filters: [['item_code', '=', step.args.item], ['price_list', '=', opts.standardCostPriceList], [t.price.eco, '=', r.eco]], fields: ['name'],
          });
          if (have.length) { add(step, 'existing', 'Item Price', have[0].name); break; }
          const rev = r.items.find((i) => i.item === step.args.item)?.rev;
          const was = step.amounts.from;
          const doc = await c.post<{ data: Row }>(priceUrl, {
            item_code: step.args.item, price_list: opts.standardCostPriceList, price_list_rate: step.args.rate, valid_from: r.effectiveDate,
            ...(step.args.uom && { uom: step.args.uom }), ...(step.args.currency && { currency: step.args.currency }),
            [t.price.eco]: r.eco, ...(t.price.decision && { [t.price.decision]: r.decision.url }),
            note: sentence(`${trace}. ${step.args.item}${rev ? ` Rev ${rev}` : ''} standard cost ${money(step.args.rate)} from ${r.effectiveDate}${was ? `, was ${money(was)}` : ''}.`),
          });
          add(step, 'created', 'Item Price', doc.data.name);
          break;
        }
        case 'bom': {
          const item: ItemCode = step.args.item;
          const have = await c.list('BOM', { filters: [['item', '=', item], ['company', '=', opts.company], [t.bom.eco, '=', r.eco], ['docstatus', '<', 2]], fields: ['name'], orderBy: 'creation desc' });
          if (have.length) { newBom.set(item, have[0].name); add(step, 'existing', 'BOM', have[0].name); break; }
          const old = await one(bomUrl, step.args.oldBom);
          if (old.docstatus !== 1) throw new Error(`${old.name} is not submitted`);
          const items = await cloneLines(c, old.items ?? [], (r.bomChanges ?? []).filter((b) => b.parent === item), item);
          const operations = (old.operations ?? []).map((o: Row) => pick(o, ['operation', 'workstation', 'workstation_type', 'time_in_mins', 'batch_size', 'sequence_id', 'fixed_time', 'set_cost_based_on_bom_qty']));
          const doc = await c.post<{ data: Row }>(bomUrl, {
            item, quantity: old.quantity, company: old.company, currency: old.currency, uom: old.uom,
            is_active: 1, is_default: 1, rm_cost_as_per: 'Price List', buying_price_list: opts.standardCostPriceList,
            ...pick(old, ['set_rate_of_sub_assembly_item_based_on_bom', 'transfer_material_against', 'routing', 'conversion_rate']),
            with_operations: old.with_operations ? 1 : 0, ...(operations.length && { operations }), items,
            [t.bom.eco]: r.eco, ...(t.bom.releasedOn && { [t.bom.releasedOn]: r.effectiveDate }), ...(t.bom.decision && { [t.bom.decision]: r.decision.url }),
            docstatus: 1,
          });
          newBom.set(item, doc.data.name);
          add(step, 'created', 'BOM', doc.data.name, `New BOM ${doc.data.name} for ${item}: total cost ${money(num(old.total_cost))} -> ${money(num(doc.data.total_cost))}`);
          break;
        }
        case 'bom-replace': {
          const item: ItemCode = step.args.item;
          const fresh = newBom.get(item) ?? (await c.list('BOM', { filters: [['item', '=', item], ['company', '=', opts.company], [t.bom.eco, '=', r.eco], ['docstatus', '=', 1]], fields: ['name'] }))[0]?.name;
          if (!fresh) throw new Error(`no ${r.eco} BOM for ${item} to replace ${step.args.oldBom} with`);
          const parents = await activeParents(c, step.args.oldBom);
          if (!parents.length) { skipped.push(`${step.id}: no active parent BOM uses ${step.args.oldBom}`); break; }
          const res = await c.post<{ message?: Row; data?: Row }>(replaceMethod, { boms: { current_bom: step.args.oldBom, new_bom: fresh } });
          const log = res.message?.name ?? res.data?.name;
          if (!log) throw new Error('ERPNext did not return a BOM Update Log');
          await waitFor(c, log, run);
          const left = await activeParents(c, step.args.oldBom);
          if (left.length) throw new Error(`${left.join(', ')} still use ${step.args.oldBom} after ${log}`);
          add(step, 'created', 'BOM Update Log', log, `Replaced ${step.args.oldBom} with ${fresh} in ${parents.length} parent BOM${parents.length > 1 ? 's' : ''} (${parents.join(', ')})`);
          break;
        }
        case 'bom-retire': {
          const old = await one(bomUrl, step.args.oldBom);
          if (!old.is_active) { add(step, 'existing', 'BOM', old.name); break; }
          await c.put(`${bomUrl}/${enc(old.name)}`, { is_active: 0 });
          add(step, 'updated', 'BOM', old.name);
          break;
        }
        case 'journal': {
          const j = (r.journals ?? []).find((x) => x.key === step.args.key);
          if (!j) throw new Error(`the release has no journal '${step.args.key}'`);
          const total = r2(j.lines.reduce((s, l) => s + l.amount, 0));
          const have = await c.list('Journal Entry', { filters: [[t.je.eco, '=', r.eco], [t.je.entry, '=', j.key], ['docstatus', '<', 2]], fields: ['name', 'total_debit'] });
          if (have.length) {
            if (Math.abs(num(have[0].total_debit) - total) >= 0.005) throw new Error(`${have[0].name} exists for ${money(num(have[0].total_debit))}, the release says ${money(total)}`);
            add(step, 'existing', 'Journal Entry', have[0].name);
            break;
          }
          const acct = (role: string) => {
            const a = opts.write?.accounts[role];
            if (!a) throw new Error(`no account for the role '${role}'`);
            return a;
          };
          const cc = opts.write?.costCenter ? { cost_center: opts.write.costCenter } : {};
          const doc = await c.post<{ data: Row }>(jeUrl, {
            voucher_type: 'Journal Entry', company: opts.company, posting_date: step.args.posting, title: sentence(`${r.eco}: ${j.title}`).slice(0, 140),
            user_remark: sentence(`${r.eco} (${r.ecr}): ${j.title}. Drafted by Norn from decision ${r.decision.id}: ${r.decision.url}`),
            [t.je.eco]: r.eco, [t.je.entry]: j.key, ...(t.je.decision && { [t.je.decision]: r.decision.url }),
            accounts: j.lines.flatMap((l) => [
              { account: acct(l.debit), debit_in_account_currency: r2(l.amount), user_remark: l.memo, ...cc },
              { account: acct(l.credit), credit_in_account_currency: r2(l.amount), user_remark: l.memo, ...cc },
            ]),
          });
          add(step, 'created', 'Journal Entry', doc.data.name, `Draft journal entry ${doc.data.name} '${j.title}': ${money(total)}`);
          break;
        }
      }
    } catch (e) {
      throw new EcoApplyError(step.id, e, written);
    }
  }
  return { eco: r.eco, at: new Date().toISOString(), written, skipped };
}

const pick = (o: Row, keys: string[]): Row => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));

/** The old BOM's lines as new rows, with the release's line changes applied. */
async function cloneLines(c: ErpnextClient, old: Row[], changes: BomLineChange[], item: ItemCode): Promise<Row[]> {
  const rows = old.map((l) => pick(l, ['item_code', 'qty', 'uom', 'bom_no', 'source_warehouse', 'operation', 'sourced_by_supplier', 'allow_alternative_item', 'do_not_explode']));
  let out = rows;
  for (const ch of changes) {
    const at = out.findIndex((l) => l.item_code === ch.child);
    if (ch.op === 'remove') {
      if (at < 0) throw new Error(`${item}'s BOM has no line for ${ch.child} to remove`);
      out = out.filter((_, i) => i !== at);
    } else if (ch.op === 'set_qty') {
      if (at < 0) throw new Error(`${item}'s BOM has no line for ${ch.child} to change`);
      out = out.map((l, i) => (i === at ? { ...l, qty: ch.qty } : l));
    } else {
      if (at >= 0) throw new Error(`${item}'s BOM already has a line for ${ch.child}`);
      const [it] = await c.list('Item', { filters: [['name', '=', ch.child]], fields: ['name', 'stock_uom', 'default_bom'] });
      if (!it) throw new Error(`item ${ch.child} does not exist`);
      out = [...out, { item_code: ch.child, qty: ch.qty, uom: it.stock_uom, ...(it.default_bom && { bom_no: it.default_bom }) }];
    }
  }
  return out;
}

/** Names of the active, submitted BOMs with a line that points at `bom`. */
async function activeParents(c: ErpnextClient, bom: string): Promise<string[]> {
  const refs = await c.list('BOM Item', { parent: 'BOM', filters: [['bom_no', '=', bom], ['docstatus', '=', 1]], fields: ['parent'] });
  if (!refs.length) return [];
  const boms = await c.list('BOM', { filters: [['name', 'in', uniq(refs.map((x) => x.parent))], ['is_active', '=', 1], ['docstatus', '=', 1]], fields: ['name'] });
  return boms.map((b) => b.name).sort();
}

async function waitFor(c: ErpnextClient, log: string, run: ApplyOptions): Promise<void> {
  const poll = run.pollMs ?? 1000;
  const until = Date.now() + (run.waitMs ?? 120_000);
  for (;;) {
    const row = (await c.get<{ data: Row }>(`/api/resource/${enc('BOM Update Log')}/${enc(log)}`)).data;
    if (row.status === 'Completed') return;
    if (row.status === 'Failed') throw new Error(`${log} failed`);
    if (Date.now() > until) throw new Error(`${log} is still ${row.status} after ${Math.round((run.waitMs ?? 120_000) / 1000)} s`);
    await new Promise((res) => setTimeout(res, poll));
  }
}
