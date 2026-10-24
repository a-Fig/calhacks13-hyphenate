// S1, the BOM delta (ARCHITECTURE.md §5): apply an ECR's item and BOM overlay to the baseline and
// return the BOM at head, the diff, and the affected items, assemblies, suppliers and programs.
// Each change carries the value its author saw on the baseline (`from`, `fromRev`, `qtyFrom`). A
// mismatch is a conflict (§2, `expected_old`): the change is still applied, so later checks can run,
// but the result says `ok: false` and lists the conflict, and nothing downstream should read it as clean.

import type {
  Baseline, BomLine, ChangeRequest, FieldValue, Item, ItemCode, ProgramId, SupplierId, Trace,
} from './types.ts';
import { CHECKS_CODE_VERSION } from './types.ts';

/** Fields with a meaning to the checks. Anything else is a spec field carried to head as written. */
export const PRICE_FIELD = 'unit_price_usd';
export const HOURS_FIELD = 'labor_hours';

export interface HeadItem {
  code: ItemCode;
  name: string;
  rev: string;
  makeBuy: 'make' | 'buy';
  status: 'released' | 'proposed';
  supplier?: SupplierId;
  /** Standard unit cost of a buy item (its purchase price); undefined for make items. */
  unitPrice?: number;
  laborHours?: number;
  workCenter?: string;
  spec: Record<string, FieldValue>;
}

export interface FieldCheck {
  field: string;
  from: FieldValue;
  to: FieldValue;
  /** The value on the baseline, where the baseline holds the field. */
  base?: FieldValue;
  /** `unverified`: the baseline does not hold this field, so the author's `from` can't be checked. */
  status: 'ok' | 'mismatch' | 'unverified';
}

export interface ItemDiff {
  change: string;
  item: ItemCode;
  op: 'revise' | 'add' | 'remove';
  fromRev?: string;
  toRev?: string;
  baseRev?: string;
  fields: FieldCheck[];
}

export interface BomLineDiff {
  op: 'added' | 'removed' | 'qty_changed';
  parent: ItemCode;
  child: ItemCode;
  qtyBase: number | null;
  qtyHead: number | null;
  change?: string;
}

/** One item whose quantity per finished unit, or whose unit cost, differs between base and head. */
export interface ExplodedRow {
  item: ItemCode;
  name: string;
  makeBuy: 'make' | 'buy';
  qtyBase: number;
  qtyHead: number;
  /** Buy items: unit price. Make items: own labour hours. */
  priceBase: number | null;
  priceHead: number | null;
  hoursBase: number | null;
  hoursHead: number | null;
  supplier?: SupplierId;
}

export interface ProgramDelta {
  program: ProgramId;
  topItem: ItemCode;
  rows: ExplodedRow[];
}

export interface Conflict {
  change: string;
  kind: 'missing_item' | 'stale_rev' | 'stale_value' | 'line_exists' | 'missing_line' | 'already_exists' | 'dangling_reference' | 'cycle';
  message: string;
}

export interface BomDeltaResult {
  check: 's1_bom_delta';
  codeVersion: string;
  ecr: string;
  /** True when every change applied against the values its author saw. */
  ok: boolean;
  conflicts: Conflict[];
  items: ItemDiff[];
  bom: BomLineDiff[];
  programs: ProgramDelta[];
  affected: { items: ItemCode[]; assemblies: ItemCode[]; suppliers: SupplierId[]; programs: ProgramId[] };
  head: { bom: BomLine[]; items: HeadItem[]; removedItems: ItemCode[] };
  trace: Trace;
}

/** The overlay applied: what S2 and later checks read. Not JSON; `bomDelta` is the JSON view. */
export interface HeadState {
  base: Map<ItemCode, HeadItem>;
  head: Map<ItemCode, HeadItem>;
  baseBom: BomLine[];
  headBom: BomLine[];
  /** Quantity per one finished unit of each program, at base and at head. */
  explodedBase: Map<ProgramId, Map<ItemCode, number>>;
  explodedHead: Map<ProgramId, Map<ItemCode, number>>;
  conflicts: Conflict[];
  itemDiffs: ItemDiff[];
  bomDiffs: BomLineDiff[];
  /** Items the overlay touched directly: revised, added or removed, or a child of a changed BOM line. */
  touched: Set<ItemCode>;
  /** Items with an item change (revised, added or removed). A BOM line change alone moves quantities only. */
  revised: Set<ItemCode>;
}

const near = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;

function toHead(i: Item, sourcingSupplier: Map<ItemCode, SupplierId>): HeadItem {
  return {
    code: i.code,
    name: i.name,
    rev: i.rev,
    makeBuy: i.makeBuy,
    status: i.status,
    supplier: i.defaultSupplier ?? sourcingSupplier.get(i.code),
    unitPrice: i.makeBuy === 'buy' ? i.standardCost : undefined,
    laborHours: i.makeBuy === 'make' ? (i.laborHours ?? 0) : undefined,
    workCenter: i.workCenter,
    spec: {},
  };
}

const cloneItem = (h: HeadItem): HeadItem => ({ ...h, spec: { ...h.spec } });
const lineKey = (parent: ItemCode, child: ItemCode) => `${parent}>${child}`;

/** Quantity of every item per one unit of `top`, through all BOM levels. */
export function explode(bom: BomLine[], top: ItemCode, onCycle?: (at: ItemCode) => void): Map<ItemCode, number> {
  const children = new Map<ItemCode, BomLine[]>();
  for (const l of bom) {
    const list = children.get(l.parent) ?? [];
    list.push(l);
    children.set(l.parent, list);
  }
  const qty = new Map<ItemCode, number>();
  const path = new Set<ItemCode>();
  const walk = (code: ItemCode, mult: number) => {
    if (path.has(code)) {
      onCycle?.(code);
      return;
    }
    qty.set(code, (qty.get(code) ?? 0) + mult);
    path.add(code);
    for (const l of children.get(code) ?? []) walk(l.child, mult * l.qty);
    path.delete(code);
  };
  walk(top, 1);
  return qty;
}

/** Apply the ECR's overlay to the baseline. Pure: the inputs are not modified. */
export function applyOverlay(baseline: Baseline, ecr: ChangeRequest): HeadState {
  const sourcingSupplier = new Map<ItemCode, SupplierId>();
  for (const s of baseline.sourcing) if (s.primary && !sourcingSupplier.has(s.item)) sourcingSupplier.set(s.item, s.supplier);
  const base = new Map(baseline.items.map((i) => [i.code, toHead(i, sourcingSupplier)]));
  const head = new Map([...base].map(([k, v]) => [k, cloneItem(v)]));
  const conflicts: Conflict[] = [];
  const itemDiffs: ItemDiff[] = [];
  const touched = new Set<ItemCode>();
  const revised = new Set<ItemCode>();
  const removed = new Set<ItemCode>();

  ecr.itemChanges.forEach((ch, i) => {
    const change = `${ecr.id} itemChanges[${i}]`;
    const diff: ItemDiff = { change, item: ch.item, op: ch.op, fromRev: ch.fromRev, toRev: ch.toRev, fields: [] };
    itemDiffs.push(diff);
    touched.add(ch.item);
    revised.add(ch.item);
    const cur = head.get(ch.item);
    diff.baseRev = base.get(ch.item)?.rev;

    if (ch.op === 'remove') {
      if (!cur) conflicts.push({ change, kind: 'missing_item', message: `${ch.item} is not on the baseline, so it cannot be removed` });
      else removed.add(ch.item);
      return;
    }

    let target: HeadItem;
    if (ch.op === 'add') {
      if (cur && cur.status === 'released') {
        conflicts.push({ change, kind: 'already_exists', message: `${ch.item} is already a released item on the baseline` });
        target = cur;
      } else if (cur) {
        // A proposed item (quoted for this change, in no released BOM) is released by the change.
        target = cur;
        target.status = 'released';
      } else {
        const quote = ecr.supplierQuotes.find((q) => q.item === ch.item || q.lines.some((l) => l.description.includes(ch.item)));
        target = { code: ch.item, name: ch.item, rev: ch.toRev ?? 'A', makeBuy: 'buy', status: 'released', supplier: quote?.supplier, unitPrice: 0, spec: {} };
        head.set(ch.item, target);
      }
    } else {
      if (!cur) {
        conflicts.push({ change, kind: 'missing_item', message: `${ch.item} is not on the baseline, so it cannot be revised` });
        return;
      }
      if (ch.fromRev !== undefined && cur.rev !== ch.fromRev) {
        conflicts.push({ change, kind: 'stale_rev', message: `${ch.item}: the ECR revises Rev ${ch.fromRev}, the baseline is at Rev ${cur.rev}` });
      }
      target = cur;
    }
    if (ch.toRev !== undefined) target.rev = ch.toRev;

    for (const fc of ch.changes) {
      let baseValue: FieldValue | undefined;
      const known = ch.op === 'revise' || (ch.op === 'add' && base.has(ch.item));
      if (fc.field === PRICE_FIELD) {
        baseValue = ch.op === 'add' && !base.has(ch.item) ? null : (base.get(ch.item)?.unitPrice ?? null);
        target.unitPrice = typeof fc.to === 'number' ? fc.to : target.unitPrice;
        if (target.makeBuy === 'make') target.unitPrice = undefined;
      } else if (fc.field === HOURS_FIELD) {
        baseValue = base.get(ch.item)?.laborHours ?? null;
        if (typeof fc.to === 'number') target.laborHours = fc.to;
      } else if (fc.field === 'name') {
        baseValue = base.get(ch.item)?.name ?? null;
        if (typeof fc.to === 'string') target.name = fc.to;
      } else {
        target.spec[fc.field] = fc.to;
      }
      let status: FieldCheck['status'] = 'unverified';
      if (baseValue !== undefined) {
        // An 'add' of a proposed item may carry from: null against a quoted price; that is not stale.
        const expectNull = ch.op === 'add' && fc.from === null;
        status = near(fc.from, baseValue) || expectNull ? 'ok' : 'mismatch';
        if (status === 'mismatch' && known) {
          conflicts.push({ change, kind: 'stale_value', message: `${ch.item}.${fc.field}: the ECR expects ${JSON.stringify(fc.from)}, the baseline has ${JSON.stringify(baseValue)}` });
        }
      }
      diff.fields.push({ field: fc.field, from: fc.from, to: fc.to, ...(baseValue !== undefined ? { base: baseValue } : {}), status });
    }
  });

  // BOM lines. A parent may list one child on two lines (ERPNext allows it); here they are one line
  // with the quantities summed, and base and head both explode from these merged lines.
  const merged = new Map<string, BomLine>();
  for (const l of baseline.bom) {
    const k = lineKey(l.parent, l.child);
    const m = merged.get(k);
    if (m) m.qty += l.qty;
    else merged.set(k, { ...l });
  }
  const baseBom = [...merged.values()];
  const headLines = new Map(baseBom.map((l) => [lineKey(l.parent, l.child), { ...l }]));
  const bomDiffs: BomLineDiff[] = [];
  ecr.bomChanges.forEach((bc, j) => {
    const change = `${ecr.id} bomChanges[${j}]`;
    const key = lineKey(bc.parent, bc.child);
    const cur = headLines.get(key);
    touched.add(bc.child);
    if (!head.has(bc.parent)) conflicts.push({ change, kind: 'missing_item', message: `parent ${bc.parent} is not an item` });
    if (bc.op === 'add') {
      if (cur) {
        conflicts.push({ change, kind: 'line_exists', message: `${bc.parent} already uses ${bc.child} (qty ${cur.qty})` });
        return;
      }
      if (!head.has(bc.child) || removed.has(bc.child)) conflicts.push({ change, kind: 'missing_item', message: `child ${bc.child} is not an item at head` });
      const qty = bc.qtyTo ?? 1;
      const seq = Math.max(0, ...[...headLines.values()].filter((l) => l.parent === bc.parent).map((l) => l.seq ?? 0)) + 10;
      headLines.set(key, { parent: bc.parent, child: bc.child, qty, seq });
      return;
    }
    if (!cur) {
      conflicts.push({ change, kind: 'missing_line', message: `${bc.parent} does not use ${bc.child}` });
      return;
    }
    if (bc.qtyFrom !== undefined && cur.qty !== bc.qtyFrom) {
      conflicts.push({ change, kind: 'stale_value', message: `${bc.parent} > ${bc.child}: the ECR expects qty ${bc.qtyFrom}, the baseline has ${cur.qty}` });
    }
    if (bc.op === 'remove') headLines.delete(key);
    else cur.qty = bc.qtyTo ?? cur.qty;
  });

  for (const code of removed) head.delete(code);
  const headBom = [...headLines.values()];
  for (const l of headBom) {
    if (removed.has(l.child) || removed.has(l.parent)) {
      conflicts.push({ change: `${ecr.id}`, kind: 'dangling_reference', message: `${l.parent} still uses ${l.child}, which the ECR removes` });
    }
  }

  // Line-level diff, in baseline order then additions.
  const baseLines = new Map(baseBom.map((l) => [lineKey(l.parent, l.child), l]));
  for (const [k, b] of baseLines) {
    const h = headLines.get(k);
    if (!h) bomDiffs.push({ op: 'removed', parent: b.parent, child: b.child, qtyBase: b.qty, qtyHead: null });
    else if (h.qty !== b.qty) bomDiffs.push({ op: 'qty_changed', parent: b.parent, child: b.child, qtyBase: b.qty, qtyHead: h.qty });
  }
  for (const [k, h] of headLines) if (!baseLines.has(k)) bomDiffs.push({ op: 'added', parent: h.parent, child: h.child, qtyBase: null, qtyHead: h.qty });
  ecr.bomChanges.forEach((bc, j) => {
    const d = bomDiffs.find((x) => x.parent === bc.parent && x.child === bc.child);
    if (d) d.change = `${ecr.id} bomChanges[${j}]`;
  });

  const explodedBase = new Map<ProgramId, Map<ItemCode, number>>();
  const explodedHead = new Map<ProgramId, Map<ItemCode, number>>();
  for (const p of baseline.programs) {
    explodedBase.set(p.id, explode(baseBom, p.topItem));
    explodedHead.set(p.id, explode(headBom, p.topItem, (at) => conflicts.push({ change: ecr.id, kind: 'cycle', message: `the BOM at head has a cycle at ${at}` })));
  }

  return { base, head, baseBom, headBom, explodedBase, explodedHead, conflicts, itemDiffs, bomDiffs, touched, revised };
}

/** Rows whose quantity per unit or unit cost changed, for one program. */
export function changedRows(s: HeadState, program: ProgramId): ExplodedRow[] {
  const qb = s.explodedBase.get(program) ?? new Map<ItemCode, number>();
  const qh = s.explodedHead.get(program) ?? new Map<ItemCode, number>();
  const codes = [...new Set([...qb.keys(), ...qh.keys()])];
  const rows: ExplodedRow[] = [];
  for (const code of codes) {
    const b = s.base.get(code);
    const h = s.head.get(code) ?? b;
    if (!h) continue;
    const qtyBase = qb.get(code) ?? 0;
    const qtyHead = qh.get(code) ?? 0;
    const buy = h.makeBuy === 'buy';
    const priceBase = buy ? (b?.unitPrice ?? null) : null;
    const priceHead = buy ? (s.head.get(code)?.unitPrice ?? null) : null;
    const hoursBase = !buy ? (b?.laborHours ?? null) : null;
    const hoursHead = !buy ? (s.head.get(code)?.laborHours ?? null) : null;
    const moved = qtyBase !== qtyHead || (buy && !near(priceBase ?? 0, priceHead ?? 0)) || (!buy && !near(hoursBase ?? 0, hoursHead ?? 0));
    const revised = s.revised.has(code) && (qtyBase > 0 || qtyHead > 0);
    if (!moved && !revised) continue;
    rows.push({ item: code, name: h.name, makeBuy: h.makeBuy, qtyBase, qtyHead, priceBase, priceHead, hoursBase, hoursHead, ...(h.supplier ? { supplier: h.supplier } : {}) });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Every assembly above the given items, at base or head. */
function ancestors(lines: BomLine[], items: Iterable<ItemCode>): Set<ItemCode> {
  const parents = new Map<ItemCode, ItemCode[]>();
  for (const l of lines) parents.set(l.child, [...(parents.get(l.child) ?? []), l.parent]);
  const out = new Set<ItemCode>();
  const stack = [...items];
  while (stack.length) {
    const c = stack.pop()!;
    for (const p of parents.get(c) ?? []) {
      if (!out.has(p)) {
        out.add(p);
        stack.push(p);
      }
    }
  }
  return out;
}

/** S1 as a JSON-serialisable check result. */
export function bomDelta(baseline: Baseline, ecr: ChangeRequest, state = applyOverlay(baseline, ecr)): BomDeltaResult {
  const s = state;
  const programs: ProgramDelta[] = baseline.programs
    .map((p) => ({ program: p.id, topItem: p.topItem, rows: changedRows(s, p.id) }))
    .filter((p) => p.rows.length > 0);
  const affectedItems = new Set<ItemCode>(s.touched);
  for (const p of programs) for (const r of p.rows) affectedItems.add(r.item);
  const assemblies = new Set([...ancestors(s.baseBom, affectedItems), ...ancestors(s.headBom, affectedItems)]);
  for (const code of affectedItems) assemblies.delete(code);
  const suppliers = new Set<SupplierId>();
  for (const code of affectedItems) {
    const h = s.head.get(code) ?? s.base.get(code);
    if (h?.makeBuy === 'buy' && h.supplier) suppliers.add(h.supplier);
    for (const src of baseline.sourcing) if (src.item === code) suppliers.add(src.supplier);
  }
  const changedItems = [...s.head.values()].filter((h) => {
    const b = s.base.get(h.code);
    return !b || JSON.stringify(b) !== JSON.stringify(h);
  });
  const removedItems = [...s.base.keys()].filter((k) => !s.head.has(k));
  return {
    check: 's1_bom_delta',
    codeVersion: CHECKS_CODE_VERSION,
    ecr: ecr.id,
    ok: s.conflicts.length === 0,
    conflicts: s.conflicts,
    items: s.itemDiffs,
    bom: s.bomDiffs,
    programs,
    affected: {
      items: [...affectedItems].sort(),
      assemblies: [...assemblies].sort(),
      suppliers: [...suppliers].sort(),
      programs: programs.map((p) => p.program),
    },
    head: {
      bom: s.headBom.slice().sort((a, b) => a.parent.localeCompare(b.parent) || (a.seq ?? 0) - (b.seq ?? 0) || a.child.localeCompare(b.child)),
      items: changedItems.sort((a, b) => a.code.localeCompare(b.code)),
      removedItems: removedItems.sort(),
    },
    trace: {
      formula: 'BOM at head = baseline BOM with the ECR overlay applied; quantity per unit = product of line quantities down every path from the program top item',
      uses: [
        { id: 'baseline:items', source: 'given' },
        { id: 'baseline:bom', source: 'given' },
        { id: `ecr:${ecr.id}:overlay`, source: 'given' },
      ],
      evidence: 'computation',
    },
  };
}
