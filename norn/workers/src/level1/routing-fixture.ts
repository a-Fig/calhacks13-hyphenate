// Test support: Bowman's real configuration and the real cost check's stored rows for its demo ECRs, so
// the routing tests run on what Norn would hold, not on hand-made numbers. Not imported by the product.
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../../bowman/data/index.ts';
import { costCheck, costCheckRows, supplyCheck, supplyCheckRows, timelineCheck, timelineRows } from '../../../checks/src/index.ts';
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

const rowsOf0423 = (change: (e: (typeof bowman.ecrs)[number]) => (typeof bowman.ecrs)[number]) => {
  const base = bowman.ecrs.find(e => e.id === 'ECR-0423');
  if (!base) throw new Error("no ECR-0423 in Bowman's data");
  return costCheckRows(costCheck(bowman, change(base), { seed: 'norn-seed-1' }));
};

/** ECR-0423 with a cost-page line that rests on an engineer's estimate but states no amount: the check counts it as $0 and flags nothing. */
export const blankAmountRows = () =>
  rowsOf0423(e => ({ ...e, costPage: { ...e.costPage, other: [{ label: 'Expedite fee for the first lot', basis: 'engineer_estimate' as const }] } }));

/** ECR-0423 with the proposal for its old stock taken out: the check says "no disposition proposed" as information only. */
export const noDispositionRows = () => rowsOf0423(e => ({ ...e, inventoryProposal: [] }));

/** The rows the s3_timeline stage stores for one of Bowman's ECRs: the real check, the test seed. */
export function storedTimelineRows(ecrId: string) {
  const ecr = bowman.ecrs.find(e => e.id === ecrId);
  if (!ecr) throw new Error(`no ${ecrId} in Bowman's data`);
  return timelineRows(timelineCheck(bowman, ecr, { seed: 'norn-seed-1' }));
}

/**
 * The rows the s4_supply stage stores: the real check, the test seed, with the other ECRs of Bowman's data as the
 * open peers (the module names every other open ECR; the check works out which share a supplier).
 */
export function storedSupplyRows(ecrId: string, peerIds?: string[]) {
  const ecr = bowman.ecrs.find(e => e.id === ecrId);
  if (!ecr) throw new Error(`no ${ecrId} in Bowman's data`);
  const peers = bowman.ecrs.filter(e => e.id !== ecrId && (!peerIds || peerIds.includes(e.id)));
  return supplyCheckRows(supplyCheck(bowman, ecr, { seed: 'norn-seed-1', peers }));
}
