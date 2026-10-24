// Bowman's ERPNext settings for the Norn connector (norn/connectors/erpnext). Everything here is a name
// that bowman/erp/seed.ts and bowman/erp/seed-planning.ts created. The connection (URL, key, secret) is not
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
    bom: { changeOrder: 'bw_eco', releasedOn: 'bw_released_on' },
    purchaseOrder: { externalId: 'bw_po_id' },
  },
  // No `fallback`: the volume plan is a Master Production Schedule and the built aircraft are Serial Nos in
  // Bowman's ERPNext (bowman/erp/seed-planning.ts).
};

/** What the connector's check script compares ERPNext against. Not used by Norn at run time. */
export const erpnextCheck = {
  /** The dataset the ERP was seeded from, relative to the repo root. */
  reference: 'bowman/data/bowman.json',
  /** Roll-up standard cost (USD) of each program's top item: Vesper V4 and Meridian M6. */
  rollups: { 'BW-0001-000': 2_800_019, 'BW-M000-000': 5_007_356.8 } as Record<string, number>,
};
