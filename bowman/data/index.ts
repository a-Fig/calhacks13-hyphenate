import type { Dataset } from './types.ts';
import { company, people, programs, sites, workCenters } from './company.ts';
import { supplierConstraints, suppliers } from './suppliers.ts';
import { bom, items, otdBySupplier, purchaseOrders, rateFactors, sourcing, stock } from './derive.ts';
import { builtAircraft, builtProv, standardCostHistory, stdCostProv, volumePlan, volumeProv } from './volume.ts';
import { mbom } from './mbom.ts';
import { history } from './history.ts';
import { ecrs, ncrs } from './changes.ts';
import { demoScenarios, scenarioProv } from './scenarios.ts';
import { INV, inv, src } from './prov.ts';

// The Bowman dataset: single source of truth for the PLM and ERPNext seeds.
// Run `node bowman/data/check.ts` to validate it and print a summary.

export const bowman: Dataset = {
  sectionProvenance: {
    volumePlan: volumeProv,
    builtAircraft: builtProv,
    standardCostHistory: stdCostProv,
    demoScenarios: scenarioProv,
    supplierConstraints: inv('Invented to create the shared-supplier interactions; see each record.'),
    purchaseOrders: inv('Generated from price paths and quoted lead-time ranges (deterministic seed). The bracket and the ECO-affected parts follow history.ts.'),
    stock: inv('Derived from usage, cover and open purchase orders; the bracket matches the ECR-0417 worked example.'),
    bom: src('docs/research/archer-public-data.md §1 and "Suggested basis for Bowman"', 'Architecture follows Midnight (12-tilt-6, composite, in-house powertrain). Every quantity and part number invented.'),
    mbom: inv('Derived in code (mbom.ts) from the engineering BOM: the top level regrouped into build stations; everything below is shared. The station split and hours are invented.'),
    ecrs: src('docs/IN-PRACTICE.md §1; docs/research/practice-impact-assessment.md §1a', 'ECP fields follow DD Form 1692 / MIL-HDBK-61A Table 6-6; per-record provenance says what else is sourced.'),
    history: INV,
  },
  company,
  sites,
  programs,
  workCenters,
  people: [...people].sort((a, b) => a.id.localeCompare(b.id)),
  // On-time delivery is measured from the generated PO history where there is enough of it.
  suppliers: suppliers.map((s) => ({ ...s, onTimeDeliveryPct: otdBySupplier.get(s.id) ?? s.onTimeDeliveryPct })),
  supplierConstraints,
  items,
  bom,
  mbom,
  sourcing,
  rateFactors,
  stock,
  purchaseOrders,
  volumePlan,
  builtAircraft,
  standardCostHistory,
  history,
  ncrs,
  ecrs,
  demoScenarios,
};
