// Shared by the offline tests: a made-up company's settings and one ECR document as the PLM returns it.
// The company spells its pick lists its own way, so the tests show the mapping runs through the settings.
import type { PlmOptions, PlmSettings } from '../src/index.ts';

export const settings: PlmSettings = {
  nornUser: 'norn@acme.test',
  programs: { 'Falcon 1': 'falcon', 'Kestrel 2': 'kestrel' },
  priorities: { Critical: 'emergency', Rush: 'urgent', Normal: 'routine' },
  companyClasses: { 'Type 1': 'I', 'Type 2': 'II' },
  faaClasses: { Small: 'minor', Large: 'major' },
  itemOps: { Revise: 'revise', Add: 'add', Remove: 'remove' },
  bomOps: { Add: 'add', Remove: 'remove', 'Change qty': 'set_qty' },
  effectivityBasis: { Serial: 'serial', Date: 'date', Lot: 'lot', TBD: 'tbd' },
  locations: { Stores: 'stores', WIP: 'wip', 'Finished goods': 'finished_goods', 'At supplier': 'supplier_finished', 'On order': 'on_order', 'In field': 'in_field' },
  dispositions: { Use: 'use_until_depleted', Install: 'mandatory_install', Rework: 'rework', Scrap: 'scrap', Cancel: 'cancel', TBD: 'tbd' },
  costBasis: { Quote: 'supplier_quote', Estimate: 'engineer_estimate', 'Not provided': 'not_provided' },
  firmness: { Held: 'firm', Provisional: 'budgetary' },
  reviewFunctions: { Buyer: 'buyer', 'Cost engineer': 'cost_engineer' },
  supplier: { 'Tarn Co': 'Tarn Composites' },
  webhook: { eventHeader: 'X-Acme-Event' },
};

export const opts: PlmOptions = { ...settings, url: 'http://plm.test', apiKey: 'test-key', apiSecret: 'test-secret' };

const row = (parentfield: string, name: string, o: Record<string, any>) => ({ name, parent: 'ECR-0001', parentfield, doctype: 'x', ...o });

/** An ECR document in the shape REST returns (and a webhook carries): child rows with a `name`, blanks stored as 0 or "". */
export function ecrDoc(): Record<string, any> {
  return {
    name: 'ECR-0001', owner: 'ann@acme.test', creation: '2026-10-01 09:00:00.100000', modified: '2026-10-02 10:30:15.250000', modified_by: 'ann@acme.test',
    title: 'Bracket rev B to C', program: 'Falcon 1', originating_ncr: 'NCR-0007', originator: 'ann@acme.test', filed_on: '2026-10-01', needed_by: '2026-11-12',
    ecr_revision: 'A', workflow_state: 'Submitted', priority: 'Rush', justification_code: 'D', company_class: 'Type 1', faa_class: 'Small',
    faa_rationale: 'Secondary structure.', description: 'Thicker plate.', need: 'It cracked.', consequences_if_disapproved: 'No flights.',
    alternatives_considered: 'Shot-peen.', failure_data: '', test_and_qualification: 'Rig test.',
    production_basis: 'Serial', production_from: '11', production_note: 'S/N 011 on.',
    retrofit_basis: 'Serial', retrofit_from: '1', retrofit_to: '10', retrofit_note: 'Swap on S/N 001-010.', interchangeable: 1,
    affected_items: [
      row('affected_items', 'ai1', { part: 'P-100', change_type: 'Revise', from_revision: 'B', to_revision: 'C' }),
      row('affected_items', 'ai2', { part: 'P-200', change_type: 'Add', from_revision: '', to_revision: 'A' }),
    ],
    field_changes: [
      row('field_changes', 'fc1', { part: 'P-100', field: 'plate_thickness_in', from_value: '1', to_value: '1.25' }),
      row('field_changes', 'fc2', { part: 'P-100', field: 'finish', from_value: 'anodised', to_value: 'chromate' }),
      row('field_changes', 'fc3', { part: 'P-100', field: 'dampers', from_value: '2', to_value: '0' }),
      row('field_changes', 'fc4', { part: 'P-200', field: 'supplier', from_value: '', to_value: 'Tarn Co' }),
    ],
    bom_changes: [
      row('bom_changes', 'bc1', { op: 'Add', parent_part: 'A-1', child_part: 'P-200', qty_from: 0, qty_to: 2 }),
      row('bom_changes', 'bc2', { op: 'Remove', parent_part: 'A-1', child_part: 'P-300', qty_from: 4, qty_to: 0 }),
      row('bom_changes', 'bc3', { op: 'Change qty', parent_part: 'A-1', child_part: 'P-100', qty_from: 12, qty_to: 8 }),
    ],
    inventory: [
      row('inventory', 'iv1', { part: 'P-100', location: 'Stores', disposition: 'Scrap', note: 'Quarantined.' }),
      row('inventory', 'iv2', { part: 'P-100', location: 'At supplier', disposition: 'Cancel', note: '' }),
    ],
    supplier_quotes: [
      row('supplier_quotes', 'sq1', { quote_id: 'Q-1', firmness: 'Held', supplier: 'Tarn Co', part: 'P-100', description: 'Steady state', unit_price: 221, qty: 0, one_time: 0, received_on: '2026-10-16', valid_until: '2027-01-15', lead_time_weeks: 14, note: 'Plate in 6 weeks.' }),
      row('supplier_quotes', 'sq2', { quote_id: 'Q-1', firmness: 'Held', supplier: 'Tarn Co', part: 'P-100', description: 'First lot', unit_price: 239.5, qty: 25, one_time: 0, received_on: '2026-10-16', valid_until: '2027-01-15', lead_time_weeks: 14, note: '' }),
      row('supplier_quotes', 'sq3', { quote_id: 'Q-1', firmness: 'Held', supplier: 'Tarn Co', part: 'P-100', description: 'Fixture', unit_price: 0, qty: 0, one_time: 6800, received_on: '2026-10-16', valid_until: '2027-01-15', lead_time_weeks: 14, note: '' }),
      row('supplier_quotes', 'sq4', { quote_id: 'Q-2', firmness: 'Provisional', supplier: 'Other Co', part: 'P-200', description: 'Unit', unit_price: 12.5, qty: 0, one_time: 0, received_on: '2026-10-17', lead_time_weeks: 0, note: '' }),
    ],
    cost_production: [
      row('cost_production', 'cp1', { label: 'Bracket unit cost', basis: 'Quote', one_time: 0, unit_cost: 34.6, quantity: 12, note: 'per aircraft' }),
      row('cost_production', 'cp2', { label: 'Tooling', basis: 'Quote', one_time: 6800, unit_cost: 0, quantity: 0, note: '' }),
      row('cost_production', 'cp3', { label: 'Write-off', basis: 'Not provided', one_time: 0, unit_cost: 0, quantity: 0, note: '' }),
    ],
    cost_retrofit: [row('cost_retrofit', 'cr1', { label: 'Retrofit kits', basis: 'Estimate', one_time: 0, unit_cost: 221, quantity: 120, note: '' })],
    cost_logistics: [],
    cost_other: [row('cost_other', 'co1', { label: 'Delay', basis: 'Not provided', one_time: 0, unit_cost: 0, quantity: 0, note: 'Planner to estimate.' })],
    routed_to: [row('routed_to', 'rt1', { review_function: 'Buyer' }), row('routed_to', 'rt2', { review_function: 'Quality' })],
  };
}
