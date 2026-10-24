// The Changes tab, read from the change request the PLM sent (the checks library's ChangeRequest, plus
// the fields the dataset's ECRs carry). Real, not mock: it is whatever the ECR's current revision says.
import type { ChangedItem, DiffLine } from '../types.ts';

const pad = (k: string) => `${k}:`.padEnd(22);
const val = (v: unknown) => (v === null || v === undefined ? 'none' : String(v));
const usd = (n: number) => `${n < 0 ? '(' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0, maximumFractionDigits: 2 })}${n < 0 ? ')' : ''}`;

export function changedItems(cr: any): ChangedItem[] {
  const out: ChangedItem[] = [];

  for (const ic of cr.itemChanges ?? []) {
    const lines: DiffLine[] = [];
    if (ic.fromRev || ic.toRev) {
      if (ic.fromRev) lines.push({ kind: 'del', text: `${pad('revision')}${ic.fromRev}` });
      if (ic.toRev) lines.push({ kind: 'add', text: `${pad('revision')}${ic.toRev}` });
    }
    let impact: string | undefined;
    for (const c of ic.changes ?? []) {
      if (c.from !== null && c.from !== undefined) lines.push({ kind: 'del', text: `${pad(c.field)}${val(c.from)}` });
      if (c.to !== null && c.to !== undefined) lines.push({ kind: 'add', text: `${pad(c.field)}${val(c.to)}` });
      if (c.field === 'unit_price_usd' && typeof c.from === 'number' && typeof c.to === 'number') impact = `${c.to - c.from >= 0 ? '+' : ''}${usd(c.to - c.from)} per unit`;
    }
    out.push({
      id: `item:${ic.item}`, title: ic.item,
      subtitle: `${ic.op === 'revise' ? 'Revised' : ic.op === 'add' ? 'Added' : 'Removed'}${ic.fromRev ? ` · Rev ${ic.fromRev} → Rev ${ic.toRev}` : ''}`,
      impact, lines,
    });
  }

  if ((cr.bomChanges ?? []).length) {
    out.push({
      id: 'bom', title: 'Engineering BOM', subtitle: `${cr.bomChanges.length} line changes`,
      lines: cr.bomChanges.flatMap((b: any): DiffLine[] => {
        const where = `${b.parent} > ${b.child}`;
        if (b.op === 'add') return [{ kind: 'add', text: `${where}  qty ${b.qtyTo}` }];
        if (b.op === 'remove') return [{ kind: 'del', text: `${where}  qty ${b.qtyFrom}` }];
        return [{ kind: 'del', text: `${where}  qty ${b.qtyFrom}` }, { kind: 'add', text: `${where}  qty ${b.qtyTo}` }];
      }),
    });
  }

  for (const q of cr.supplierQuotes ?? []) {
    const lines: DiffLine[] = [{ kind: 'ctx', text: `${pad('supplier')}${q.supplier}` }, { kind: 'ctx', text: `${pad('item')}${q.item}` }];
    for (const l of q.lines ?? []) {
      const price = l.unitPrice !== undefined ? `${usd(l.unitPrice)}${l.qty ? ` x ${l.qty}` : ''}` : l.oneTime !== undefined ? `${usd(l.oneTime)} one-time` : '';
      lines.push({ kind: 'add', text: `${pad('quote line')}${price}`, remark: l.description });
    }
    if (q.leadTimeWeeks) lines.push({ kind: 'add', text: `${pad('lead_time_weeks')}${q.leadTimeWeeks}`, remark: q.note });
    out.push({ id: `quote:${q.id}`, title: q.supplier, subtitle: `Quote ${q.id}${q.firmness ? ` · ${q.firmness}` : ''}`, impact: q.leadTimeWeeks ? `${q.leadTimeWeeks} weeks to the first lot` : undefined, lines });
  }

  if ((cr.inventoryProposal ?? []).length) {
    out.push({
      id: 'inventory', title: `Inventory · ${cr.inventoryProposal[0].item}`, subtitle: 'Old stock',
      impact: `${cr.inventoryProposal.length} dispositions`,
      lines: cr.inventoryProposal.flatMap((p: any): DiffLine[] => [
        { kind: 'del', text: `${pad(String(p.location))}on hand` },
        { kind: 'add', text: `${pad(String(p.location))}${String(p.disposition).replace(/_/g, ' ')}`, remark: p.note },
      ]),
    });
  }
  return out;
}
