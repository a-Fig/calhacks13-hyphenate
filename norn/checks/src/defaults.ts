// The cost check's defaults, in their own module so the schedule model (plan.ts) and the cost check (cost.ts),
// which reads that model for the delay cost, can both import them without an import cycle.

export interface CostDefaults {
  /** Log-space spread around a stated cost, by who stated it (Joint Agency handbook Table 2-9). */
  spread: Record<'supplier_quote' | 'budgetary_quote' | 'engineer_estimate' | 'agent_estimated', number>;
  /** Forward price range for an item with no sourcing record, as multipliers on its price. */
  newItemPrice: { p10: number; p90: number };
  /** Share of a scrapped unit's value that is recovered: resale, reuse elsewhere, or metal value (#32). */
  scrapRecovery: { min: number; mode: number; max: number };
  /** Charge for cancelling units on order and not started, as a share of their price. */
  cancellation: { min: number; mode: number; max: number };
}

export const COST_DEFAULTS: CostDefaults = {
  spread: { supplier_quote: 0.05, budgetary_quote: 0.15, engineer_estimate: 0.15, agent_estimated: 0.25 },
  newItemPrice: { p10: 0.95, p90: 1.08 },
  scrapRecovery: { min: 0, mode: 0.0153, max: 0.05 },
  cancellation: { min: 0.05, mode: 0.1, max: 0.3 },
};
