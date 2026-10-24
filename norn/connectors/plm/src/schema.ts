// The shape of the PLM's change records as this connector reads and writes them: doctype names and the
// fields on them. It is the PLM's data model, so a different PLM replaces this file. (Frappe leaves a
// null field out of a document, so every field below may be absent.)

import type { CostBlock } from '../../../checks/src/types.ts';

export const DOCTYPE = { ecr: 'ECR', eco: 'ECO', comment: 'Comment' } as const;

/** A document as the REST API (or a webhook body) returns it, with its child tables as arrays of rows. */
export type PlmDoc = Record<string, any>;

/**
 * The only ECR fields Norn may write: the impact assessment. Keep in step with the PLM's own list and
 * with its server-side guard, which refuses any other change from Norn.
 */
export const IMPACT_FIELDS = [
  'impact_report_level',
  'impact_recommendation',
  'impact_change_class',
  'impact_approval_route',
  'impact_norn_url',
  'impact_updated_on',
  'impact_statement',
] as const;
export type ImpactField = (typeof IMPACT_FIELDS)[number];

/** The ECR's cost tables, by the checks' cost block. */
export const COST_TABLE: Record<CostBlock, string> = {
  production: 'cost_production',
  retrofit: 'cost_retrofit',
  logisticsSupport: 'cost_logistics',
  other: 'cost_other',
};

/** The columns the poller reads from the list endpoint. */
export const LIST_FIELDS = ['name', 'title', 'workflow_state', 'modified', 'modified_by'];
