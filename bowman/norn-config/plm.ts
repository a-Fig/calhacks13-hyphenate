// Bowman's PLM settings for the Norn connector (norn/connectors/plm). Everything here is a name that
// bowman/plm/model.ts and bowman/plm/seed.ts created. The connection (URL, key, secret) is not here: it comes
// from PLM_URL, PLM_API_KEY and PLM_API_SECRET in the untracked .env, and the webhook secret from
// PLM_WEBHOOK_SECRET.
//
// bowman.config.ts will import `plm` from this file.
import type { PlmSettings } from '../../norn/connectors/plm/src/index.ts';

export const plm: PlmSettings = {
  // The Norn Integration user (bowman/plm/NOTES.md). The poller does not tell Norn's writes from a person's by this login; it compares what an assessment is made from.
  nornUser: 'norn@bowman-aviation.example',
  // The PLM spells its pick lists for the people who read them; the right-hand values are the dataset's
  // (bowman/data/types.ts), which the checks library reads.
  programs: { 'Vesper V4': 'vesper', 'Meridian M6': 'meridian' },
  priorities: { Emergency: 'emergency', Urgent: 'urgent', Routine: 'routine' },
  companyClasses: { 'Class I': 'I', 'Class II': 'II' },
  faaClasses: { Minor: 'minor', Major: 'major' },
  itemOps: { Revise: 'revise', Add: 'add', Remove: 'remove' },
  bomOps: { Add: 'add', Remove: 'remove', 'Set quantity': 'set_qty' },
  effectivityBasis: { Serial: 'serial', Date: 'date', Lot: 'lot', TBD: 'tbd' },
  locations: {
    Stores: 'stores', WIP: 'wip', 'Finished goods': 'finished_goods', 'Supplier finished': 'supplier_finished', 'On order': 'on_order', 'In field': 'in_field',
  },
  dispositions: {
    'Use until depleted': 'use_until_depleted', 'Mandatory install': 'mandatory_install', Rework: 'rework', Scrap: 'scrap', Cancel: 'cancel', TBD: 'tbd',
  },
  costBasis: { 'Supplier quote': 'supplier_quote', 'Engineer estimate': 'engineer_estimate', 'Not provided': 'not_provided' },
  firmness: { Firm: 'firm', Budgetary: 'budgetary' },
  // The functions the CM analyst routes an ECR to, as the dataset's seats.
  reviewFunctions: {
    'CM analyst': 'cm_analyst', 'Cost engineer': 'cost_engineer', Buyer: 'buyer', 'Production planner': 'production_planner',
    'Cost accountant': 'cost_accountant', Quality: 'quality', Certification: 'certification', 'Manufacturing engineer': 'manufacturing_engineer',
  },
  // Suppliers: the PLM writes the supplier's name on a quote ("Tarn Composites"), and Bowman's ERPNext keeps the
  // same name as the Supplier record, which the ERP connector uses as the supplier id. So the id is the name as is.
  // (The dataset's own ids, SUP-TARN, exist only in the dataset.)
  supplier: (plmName) => plmName,
  // Frappe signs the body (X-Frappe-Webhook-Signature); the PLM also names the event in this header.
  webhook: { eventHeader: 'X-Bowman-PLM-Event' },
};

/** What the connector's check script compares the PLM against. Not used by Norn at run time. */
export const plmCheck = {
  /** The dataset the PLM was seeded from, relative to the repo root. */
  reference: 'bowman/data/bowman.json',
  /** The demo ECR: Norn writes its impact assessment and clears it again. Its request data is never touched. */
  demoEcr: 'ECR-0417',
  /**
   * The throwaway ECR the latency test files as Administrator and deletes: the PLM's own field names, the
   * workflow action that submits it, and the naming series to put back afterwards.
   */
  throwaway: {
    doc: {
      doctype: 'ECR',
      title: 'Connector latency probe (deleted after the test)',
      program: 'Vesper V4',
      priority: 'Routine',
      justification_code: 'D',
      company_class: 'Class II',
      faa_class: 'Minor',
      description: 'Probe filed by norn/connectors/plm/check.ts to time the poller. Not a real change.',
      need: 'Probe.',
      // A part no open ECR touches.
      affected_items: [{ part: 'BW-1110-100', change_type: 'Revise', from_revision: 'A', to_revision: 'B' }],
    },
    submitAction: 'Submit',
    seriesPrefix: 'ECR-',
  },
};
