// Norn's impact checks, as a pure library: S1 (BOM delta) and S2 (cost). No database, no I/O.
export * from './types.ts';
export * from './dist.ts';
export { applyOverlay, bomDelta, changedRows, explode, type BomDeltaResult, type HeadState } from './bom.ts';
export { costCheck, COST_DEFAULTS, type CostCheckOptions, type CostCheckResult, type CostDefaults, type CostMeasure, type CostMeasureRequest, type CostRow, type Money } from './cost.ts';
export { drawAll, evaluate, pairedDelta, summarize, type Expr, type Variable } from './sim.ts';
export { serialsByMonth, unitsAfterCutIn } from './volume.ts';
export { formatMoney, formatUsd, renderCostPage } from './format.ts';
export { bomDeltaRows, costCheckRows, costMeasureKey, type CheckResultRow } from './rows.ts';
