// What Norn's assessment hands the write-back when the CCB approves ECR-0417 and its ECO is released: the new standard
// cost of the bracket and the three journal entries. Built from the dataset's answer key (bowman/data/scenarios.ts, S1)
// until Norn's own assessment produces it; the connector (norn/connectors/erpnext/src/write.ts) takes any such release.
//
// The accounting for each entry is in norn/connectors/erpnext/NOTES.md ("Journal entries").
import assert from 'node:assert/strict';
import { ecrs } from '../data/changes.ts';
import { stock } from '../data/derive.ts';
import { demoScenarios } from '../data/scenarios.ts';
import type { EcoRelease } from '../../norn/connectors/erpnext/src/index.ts';

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface Ecr0417Options {
  /** First day the new standard cost applies. */
  effectiveDate: string;
  /** Where the decision is readable in Norn. A stand-in until norn/web has decision pages. */
  decisionUrl?: string;
  eco?: string;
}

export function ecr0417Release(o: Ecr0417Options): { release: EcoRelease; notes: string[] } {
  const ecr = ecrs.find((e) => e.id === 'ECR-0417')!;
  const change = ecr.itemChanges[0];
  const price = change.changes.find((c) => c.field === 'unit_price_usd')!;
  const oldCost = price.from as number;
  const newCost = price.to as number;
  const s = stock.find((x) => x.item === change.item)!;
  const key = demoScenarios.find((x) => x.id === 'S1')!.reference as Record<string, number>;
  const cancel = ecr.supplierQuotes[0].lines.find((l) => /cancellation/i.test(l.description))!;

  // The answer key nets a scrap value per piece; it is not stated, but it is what the key's totals imply.
  const scrapQty = s.stores + s.wip + s.supplierFinished + s.inField;
  assert.equal(scrapQty, key.brackets_scrapped, 'scrap quantity differs from the answer key');
  const salvage = r2((scrapQty * oldCost - key.scrapNetOfSalvageUsd) / scrapQty);
  const net = r2(oldCost - salvage); // written-down loss per piece
  assert.equal(r2(scrapQty * net), key.scrapNetOfSalvageUsd);
  assert.equal(r2(cancel.unitPrice! * cancel.qty!), key.cancellationChargeUsd);

  const rev = `${change.item} Rev ${change.fromRev}`;
  const each = `${money(oldCost)} less ${money(salvage)} scrap value`;
  const onHand = r2(s.stores * net) + r2(s.wip * net);
  const supplier = r2(s.supplierFinished * net);
  const inField = r2(s.inField * net);
  assert.equal(r2(onHand + supplier + inField), key.scrapNetOfSalvageUsd);

  const release: EcoRelease = {
    eco: o.eco ?? 'ECO-0319',
    ecr: ecr.id,
    decision: { id: `DEC-${ecr.id}`, url: o.decisionUrl ?? `https://norn.bowman.example/decisions/DEC-${ecr.id}` },
    effectiveDate: o.effectiveDate,
    items: [{ item: change.item, rev: change.toRev, standardCost: newCost }],
    journals: [
      {
        key: 'scrap-on-hand', title: 'Write down Rev B brackets in Stores and WIP to scrap value',
        lines: [
          { amount: r2(s.stores * net), debit: 'scrapExpense', credit: 'inventoryReserve', memo: `Stores: ${s.stores} x ${rev} at ${each}` },
          { amount: r2(s.wip * net), debit: 'scrapExpense', credit: 'inventoryReserve', memo: `Work in progress: ${s.wip} x ${rev} at ${each}` },
        ],
      },
      {
        key: 'supplier-finished', title: 'Accrue the loss on Rev B brackets finished at the supplier',
        lines: [
          { amount: supplier, debit: 'scrapExpense', credit: 'accruedLiability', memo: `${s.supplierFinished} x ${rev} finished at Halden, still payable at ${money(oldCost)} each, worth ${money(salvage)} as scrap` },
        ],
      },
      {
        key: 'cancellation', title: 'Accrue the cancellation charge on Rev B brackets not started',
        lines: [
          { amount: r2(cancel.unitPrice! * cancel.qty!), debit: 'scrapExpense', credit: 'accruedLiability', memo: `${cancel.qty} x ${rev} not started: 10% of ${money(oldCost)} = ${money(cancel.unitPrice!)} each (quote Q-HAL-26-1187)` },
        ],
      },
    ],
  };
  const notes = [
    `answer key (S1): ${scrapQty} brackets scrapped, ${money(key.scrapNetOfSalvageUsd)} net of ${money(salvage)} scrap value each; cancellation ${money(key.cancellationChargeUsd)}`,
    `booked in these entries: ${s.stores + s.wip + s.supplierFinished} brackets (Stores ${s.stores}, WIP ${s.wip}, at supplier ${s.supplierFinished}) = ${money(onHand + supplier)}, plus the cancellation charge ${money(key.cancellationChargeUsd)}`,
    `not booked: ${s.inField} brackets installed on S/N 001-010 (${money(inField)}). They are not in ERPNext's stock or ledger; the loss arises when the retrofit removes them`,
  ];
  return { release, notes };
}
