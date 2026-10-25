// Test support: Bowman's real configuration and the real cost check's stored rows for its demo ECRs, so
// the routing tests run on what Norn would hold, not on hand-made numbers. Not imported by the product.
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../../bowman/data/index.ts';
import { costCheck, costCheckRows } from '../../../checks/src/index.ts';
import { formatIssue, loadConfigFile, type CompanyConfig } from '../../../config/src/index.ts';

const BOWMAN_CONFIG = fileURLToPath(new URL('../../../../bowman/norn-config/bowman.config.ts', import.meta.url));

export async function bowmanConfig(): Promise<CompanyConfig> {
  const loaded = await loadConfigFile(BOWMAN_CONFIG);
  if (!loaded.ok) throw new Error(loaded.issues.map(formatIssue).join('\n'));
  return loaded.config;
}

/** The rows the s2_cost stage stores for one of Bowman's ECRs: the real check, the test seed. */
export function storedRows(ecrId: string) {
  const ecr = bowman.ecrs.find(e => e.id === ecrId);
  if (!ecr) throw new Error(`no ${ecrId} in Bowman's data`);
  return costCheckRows(costCheck(bowman, ecr, { seed: 'norn-seed-1' }));
}

/**
 * The rows for a change request that does not fit the baseline: ECR-0423 filed against a revision of
 * BW-9440-030 the baseline is not at. The real check reports the BOM conflict; nothing here is hand-made.
 */
export function conflictRows() {
  const base = bowman.ecrs.find(e => e.id === 'ECR-0423');
  if (!base) throw new Error("no ECR-0423 in Bowman's data");
  const ecr = { ...base, itemChanges: base.itemChanges.map(c => (c.op === 'revise' ? { ...c, fromRev: 'Z' } : c)) };
  return costCheckRows(costCheck(bowman, ecr, { seed: 'norn-seed-1' }));
}
