// What a released ECO changes in the ERP, worked out from Norn's own assessment of its ECR (#72): the
// ERPNext connector's EcoRelease, which the connector's planner turns into the ERP change package, the
// lines a person enters. Norn never writes to the ERP (#71).
//
// The amounts are the assessment's point estimates (every input at its stated value), rounded to cents
// once per line. Ranges are for deciding; a ledger entry takes one number.
import type { DispositionRow } from '../../checks/src/cost.ts';
import type { ChangeRequest, CostCheckResult, StockLocation } from '../../checks/src/index.ts';
import type { EcoJournal, EcoRelease } from '../../connectors/erpnext/src/index.ts';

export type ReleaseContext = {
  /** The PLM's change order number, e.g. ECO-0319. */
  eco: string;
  /** The Norn decision behind the release: its id, and where a finance user can read it. */
  decision: { id: string; url: string };
  /** The day the ECO was released, 'YYYY-MM-DD'. The journal entries post on it. */
  releasedOn: string;
};

export type ReleaseOut = {
  release: EcoRelease;
  /** What the release leaves out, and why, in words for the person entering the package. */
  notes: string[];
};

/**
 * The account roles the journal lines name. The company's ERP settings map each role to an account
 * (the connector's `write.accounts`, which the planner reads).
 */
export const ACCOUNT_ROLES = { expense: 'scrapExpense', reserve: 'inventoryReserve', accrued: 'accruedLiability' } as const;

const ON_HAND: StockLocation[] = ['stores', 'wip', 'finished_goods'];
const WHERE: Record<StockLocation, string> = {
  stores: 'Stores',
  wip: 'Work in progress',
  finished_goods: 'Finished goods',
  supplier_finished: 'Finished at the supplier',
  on_order: 'On order, not started',
  in_field: 'Installed on built aircraft',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nonZero = (n: number) => Math.abs(r2(n)) >= 0.01;

/** The release for this ECR's assessment. Throws when the assessment is not one an ECO can carry out. */
export function releaseOf(cr: ChangeRequest, result: CostCheckResult, ctx: ReleaseContext): ReleaseOut {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.releasedOn)) throw new Error(`releasedOn must be 'YYYY-MM-DD', got '${ctx.releasedOn}'`);
  if (result.ecr !== cr.id) throw new Error(`the assessment is of ${result.ecr}, not ${cr.id}`);
  if (!result.bomDelta.ok) throw new Error(`${cr.id}'s BOM changes conflict with the baseline (${result.bomDelta.conflicts}); the ECO cannot be carried out as assessed`);
  const notes: string[] = [];
  const change = new Map(cr.itemChanges.map(c => [c.item, c]));

  // ---- standard costs: every item whose price the ECR changes, at its new price
  const items: EcoRelease['items'] = [];
  for (const p of result.piecePrices) {
    if (!p.head) continue; // removed by the ECR: it leaves the BOM, and its standard cost stays as history
    if (p.base && r2(p.base.point) === r2(p.head.point)) continue;
    const rev = change.get(p.item)?.toRev;
    items.push({ item: p.item, ...(rev ? { rev } : {}), standardCost: r2(p.head.point) });
  }

  // ---- BOM lines, as the ECR redlines them
  // Quantities as the assessment reads them (checks/src/bom.ts): an add with no quantity is 1, and a
  // quantity change with none changes nothing, so it is not a line to enter.
  const bomChanges = cr.bomChanges
    .filter(b => !(b.op === 'set_qty' && b.qtyTo === undefined))
    .map(b => ({ parent: b.parent, op: b.op, child: b.child, ...(b.op === 'add' ? { qty: b.qtyTo ?? 1 } : b.op === 'set_qty' ? { qty: b.qtyTo! } : {}) }));

  // ---- journal entries, from the old stock's disposition
  type Line = EcoJournal['lines'][number];
  const onHand: Line[] = [];
  const supplier: Line[] = [];
  const cancel: Line[] = [];
  for (const inv of result.inventory) {
    const fromRev = change.get(inv.item)?.fromRev;
    const what = `${inv.item}${fromRev ? ` Rev ${fromRev}` : ''}`;
    for (const row of inv.rows) {
      const amount = r2(row.cost.point);
      const written = writtenDown(row);
      if (row.disposition === 'use_until_depleted') continue;
      if (row.disposition === 'tbd') {
        notes.push(`${row.qty} x ${what} (${WHERE[row.location].toLowerCase()}): the disposition is not decided, so there is no entry for them yet.`);
        continue;
      }
      if (row.disposition === 'rework') {
        notes.push(`${row.qty} x ${what} (${WHERE[row.location].toLowerCase()}) are reworked: the rework is booked as it is done, not at release.`);
        continue;
      }
      if (row.location === 'in_field') {
        if (nonZero(amount)) notes.push(`${row.qty} x ${what} installed on built aircraft (${money(amount)} after scrap value) are not in the ERP's stock. The loss is booked when the retrofit removes them.`);
        continue;
      }
      if (!nonZero(amount)) continue;
      if (row.disposition === 'cancel') {
        cancel.push({ amount, debit: ACCOUNT_ROLES.expense, credit: ACCOUNT_ROLES.accrued, memo: `${row.qty} x ${what} not started: cancellation charge ${money(amount / row.qty)} each on ${money(row.unitValue)}` });
      } else if (row.location === 'supplier_finished') {
        supplier.push({ amount, debit: ACCOUNT_ROLES.expense, credit: ACCOUNT_ROLES.accrued, memo: `${row.qty} x ${what} finished at the supplier, payable at ${money(row.unitValue)} each, ${written}` });
      } else if (ON_HAND.includes(row.location)) {
        onHand.push({ amount, debit: ACCOUNT_ROLES.expense, credit: ACCOUNT_ROLES.reserve, memo: `${WHERE[row.location]}: ${row.qty} x ${what} at ${money(row.unitValue)}, ${written}` });
      } else {
        notes.push(`${row.qty} x ${what} (${WHERE[row.location].toLowerCase()}, ${row.disposition}): no entry rule for this case; enter it by hand if it needs one.`);
      }
    }
  }
  // A first-lot price premium is a purchase price variance: it arises when the first lot is received
  // and invoiced above the new standard cost, not at release, so the package states it rather than
  // asking for an entry now.
  for (const row of Object.values(result.blocks).flat()) {
    if (!/premium|first[- ]lot|PPV/i.test(row.label)) continue;
    const amount = r2(row.total.point);
    if (nonZero(amount)) notes.push(`${row.label}: ${money(amount)}. It is a purchase price variance on the first lot, booked when that lot is received and invoiced, not at release.`);
  }

  const journals: EcoJournal[] = [];
  if (onHand.length) journals.push({ key: 'scrap-on-hand', title: 'Write down the old stock on hand to scrap value', lines: onHand });
  if (supplier.length) journals.push({ key: 'supplier-finished', title: 'Accrue the loss on old units finished at the supplier', lines: supplier });
  if (cancel.length) journals.push({ key: 'cancellation', title: 'Accrue the cancellation charge on old units not started', lines: cancel });

  // ---- when the new standard cost applies: the first cut-in, or the release day if that has passed
  const months = result.effectivity.map(e => e.cutInMonth).filter((m): m is string => !!m).sort();
  const cutIn = months[0] ? `${months[0]}-01` : undefined;
  const effectiveDate = cutIn && cutIn > ctx.releasedOn ? cutIn : ctx.releasedOn;
  if (!cutIn && items.length) notes.push('No cut-in month was found, so the new standard costs apply from the release day.');

  if (!items.length && !bomChanges.length && !journals.length) notes.push(`${cr.id} changes nothing the ERP holds: there is nothing to enter.`);
  return {
    release: {
      eco: ctx.eco,
      ecr: cr.id,
      decision: ctx.decision,
      effectiveDate,
      postingDate: ctx.releasedOn,
      items,
      ...(bomChanges.length ? { bomChanges } : {}),
      ...(journals.length ? { journals } : {}),
    },
    notes,
  };
}

/** "written down to 2.85 scrap value each", from the row's cost and quantity. */
function writtenDown(row: DispositionRow): string {
  const each = row.unitValue - row.cost.point / row.qty;
  return nonZero(each) ? `written down to ${money(each)} scrap value each` : 'written off in full';
}
