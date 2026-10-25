// Bowman's ERPNext settings for the Norn connector (norn/connectors/erpnext). Everything here is a name
// that bowman/erp/seed.ts, seed-planning.ts and seed-mbom.ts created. The connection (URL, key, secret) is not
// here: it comes from ERPNEXT_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET in the untracked .env.
//
// bowman.config.ts will import `erpnext` from this file.
import type { ErpnextSettings } from '../../norn/connectors/erpnext/src/index.ts';

export const erpnext: ErpnextSettings = {
  company: 'Bowman Aviation',
  standardCostPriceList: 'Standard Cost',
  supplierPriceList: 'Standard Buying',
  warehouses: {
    'Stores - BWA': 'stores',
    'Work In Progress - BWA': 'wip',
    'Finished Goods - BWA': 'finishedGoods',
    'At Supplier - BWA': 'supplierFinished',
  },
  // Bowman's seed keeps finished units at the supplier on their open POs as well (bowman/erp/NOTES.md, Stock).
  supplierFinishedOnOpenOrders: true,
  // Bowman dates its records in Pacific time, so "today" is Pacific wherever Norn runs.
  timeZone: 'America/Los_Angeles',
  // The two program top items (Vesper V4, Meridian M6) are the items in this group.
  programItemGroup: 'Aircraft',
  // The item is "Vesper V4 air vehicle"; the program is "Vesper V4".
  programName: (itemName) => itemName.replace(/ air vehicle$/i, ''),
  customFields: {
    item: { revision: 'bw_rev', status: 'bw_status', programs: 'bw_programs' },
    quote: {
      priceP10: 'bw_price_p10', priceP90: 'bw_price_p90', leadWeeksP10: 'bw_lead_weeks_p10', leadWeeksP90: 'bw_lead_weeks_p90',
      qualified: 'bw_qualified', primary: 'bw_primary', allocation: 'bw_allocation',
    },
    bom: { changeOrder: 'bw_eco', releasedOn: 'bw_released_on', decision: 'bw_decision_url' },
    purchaseOrder: { externalId: 'bw_po_id' },
    // The dataset's work center ids (WC-STRUCT); ERPNext names the workstation 'Structure assembly'. Suppliers stay ERPNext's names
    // ('Tarn Composites'): the PLM connector maps the PLM's supplier names to them, so quotes and price indexes link.
    workCenter: { externalId: 'bw_work_center_id' },
    // The change package's tags, which a person enters and Norn reads back. bw_eco on the BOM is the seed's; the rest are added by bowman/erp/eco-setup.ts.
    itemPrice: { changeOrder: 'bw_eco', decision: 'bw_decision_url' },
    journalEntry: { changeOrder: 'bw_eco', entry: 'bw_eco_entry', decision: 'bw_decision_url' },
  },
  // The ECO change package's journal entries name accounts by role; these are Bowman's. All three are in ERPNext's US chart
  // except the reserve, which bowman/erp/eco-setup.ts adds: with perpetual inventory a journal entry cannot credit
  // 11410 - Inventory on Hand, so a stock write-down is booked to a reserve until the stock is issued out.
  changePackage: {
    accounts: {
      scrapExpense: '51900 - Inventory Shrinkage and Adjustments - BWA',
      inventoryReserve: '11420 - Reserve for Obsolete Inventory - BWA',
      accruedLiability: '21210 - Accrued Expenses - BWA',
    },
    // Who submits Fern's drafts: the people in those seats in Bowman's dataset (bowman/data/company.ts, EMP-11 and EMP-18).
    people: { 'cost accountant': 'Samir Vaidya', 'manufacturing engineer': 'Owen Tillery' },
  },
  // Bowman's purchasing team keeps its suppliers' limits in the custom doctype that bowman/erp/seed-constraints.ts creates.
  supplierConstraints: {
    doctype: 'Supplier Constraint',
    items: { doctype: 'Supplier Constraint Item', itemField: 'item_code' },
    fields: {
      id: 'constraint_id', supplier: 'supplier', kind: 'kind', capacityPerYear: 'capacity_per_year', windowFrom: 'window_from',
      windowTo: 'window_to', description: 'description', slotCadenceMonths: 'slot_cadence_months', bundleWithinWeeks: 'bundle_within_weeks',
      bundleSecondQualificationDiscount: 'bundle_second_qualification_discount', bundlePriceBreak: 'bundle_price_break',
    },
  },
  // No `fallback`: the volume plan is a Master Production Schedule and the built aircraft are Serial Nos in
  // Bowman's ERPNext (bowman/erp/seed-planning.ts).
};

/** What the connector's check script compares ERPNext against. Not used by Norn at run time. */
export const erpnextCheck = {
  /** The dataset the ERP was seeded from, relative to the repo root. */
  reference: 'bowman/data/bowman.json',
  /**
   * The ERP holds the manufacturing BOM (bowman/erp/seed-mbom.ts), the dataset's `bom` is the engineering BOM. Expected in
   * ERPNext: the engineering lines below each aircraft, the MBOM's lines for the top level, the build stations as items,
   * and no labor on an aircraft's own item (its hours sit on its stations).
   */
  view: (ds: any) => {
    const tops = new Set<string>(ds.programs.map((p: any) => p.topItem));
    return {
      ...ds,
      items: [...ds.items.map((i: any) => (tops.has(i.code) ? { ...i, laborHours: undefined, workCenter: undefined } : i)), ...ds.mbom.items],
      bom: [...ds.bom.filter((l: any) => !tops.has(l.parent)), ...ds.mbom.bom],
    };
  },
  /** Roll-up standard cost (USD) of each program's top item: Vesper V4 and Meridian M6. */
  rollups: { 'BW-0001-000': 2_800_019, 'BW-M000-000': 5_007_356.8 } as Record<string, number>,
  /**
   * The ECR-0417 bracket (docs/ARCHITECTURE.md worked example; values from bowman/erp/NOTES.md): repriced by ECO-0271
   * on 2025-11-20, seven received orders, two open lines from PO-26-0144, and a parent BOM that has two versions.
   */
  spot: {
    item: 'BW-5120-210',
    standardCost: [[175.2, '2025-01-15', '2025-11-19'], [186.4, '2025-11-20']] as [number, string, string?][],
    leadTimeDays: [49, 49, 56, 57, 74, 80, 63],
    openOrders: [[60, '2026-11-02'], [60, '2026-12-07']] as [number, string][],
    bomItem: 'BW-5120-000',
    bomVersions: [[false, 353.2], [true, 364.4]] as [boolean, number][],
  },
};
