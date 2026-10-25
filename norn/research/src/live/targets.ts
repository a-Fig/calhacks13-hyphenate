// The research targets for a finished cost run, from what the run stored.
//
// The cost check's `detail` row holds the inputs it used (source, distribution, whether a row still
// needs an estimate), its sensitivity drivers and its inventory (workers/README.md, "Results"). That
// is all `pickTargets` reads of a cost result, so targets come from the numbers on the impact page
// without running the check again. The sensitivity of an input outside the check's top eight drivers
// is not measured here (that needs the check re-run): it ranks after the measured ones.

import type { ChangeRequest, CostCheckResult } from '../../../checks/src/index.ts';
import type { Identifier } from '../leak.ts';
import { contextFromEcr } from '../run.ts';
import { pickTargets } from '../targets.ts';
import type { Target } from '../types.ts';

export function targetsFromDetail(detailJson: string, cr: ChangeRequest & { description?: string }, identifiers: Identifier[], n: number): Target[] {
  const d = JSON.parse(detailJson) as Partial<CostCheckResult>;
  if (!Array.isArray(d.inputs)) throw new Error("the cost run's detail row has no inputs");
  const cost = { inputs: d.inputs, drivers: d.drivers ?? [], inventory: d.inventory ?? [] } as unknown as CostCheckResult;
  return pickTargets(cost, { n, context: contextFromEcr(cr), identifiers });
}
