// Reads from the PLM: one change request in the checks' shape, and the list of requests that changed.

import { DOCTYPE, LIST_FIELDS } from './schema.ts';
import { PlmClient, enc } from './client.ts';
import { mapEcr } from './map.ts';
import type { ReadResult } from './map.ts';
import type { PlmOptions } from './options.ts';

export interface EcrListing {
  /** The ECR number, e.g. ECR-0417. */
  name: string;
  title: string;
  workflowState: string;
  /** The PLM's `modified` stamp, 'YYYY-MM-DD HH:MM:SS.ffffff' in the PLM's own clock. */
  modified: string;
  /** The login that made the last change. Norn's own login for Norn's own writes. */
  modifiedBy: string;
}

/**
 * One change request in the checks' shape, with the record Norn shows beside it. The ECR with its child
 * tables, and the ECO that released it (none until it is approved). The PLM links the ECO onto the ECR
 * (`released_eco`) a moment after it creates it, so the field is read first, with one more request for the
 * ECO's release date. An ECR without the field (an older PLM, or the moment before the link) falls back to
 * looking the ECO up by its `ecr`.
 */
export async function readChangeRequest(opts: PlmOptions, ecrNumber: string): Promise<ReadResult> {
  const plm = new PlmClient(opts);
  const doc = await plm.get<{ data: Record<string, any> }>(`/api/resource/${enc(DOCTYPE.ecr)}/${enc(ecrNumber)}`);
  const linked = typeof doc.data.released_eco === 'string' && doc.data.released_eco !== '' ? doc.data.released_eco : undefined;
  const ecos = await plm.list<{ name: string; released_on?: string; released_by?: string }>(DOCTYPE.eco, {
    fields: ['name', 'released_on', 'released_by'],
    filters: linked ? [['name', '=', linked]] : [['ecr', '=', ecrNumber]],
    orderBy: 'creation asc',
  });
  return mapEcr(opts, doc.data, ecos[0] ?? (linked ? { name: linked } : undefined));
}

/**
 * The change requests modified after `since` (a `modified` stamp from an earlier listing), oldest change
 * first. Without `since`, all of them. Norn's own writes are included; `modifiedBy` says whose they are.
 * One request.
 */
export async function listEcrs(opts: PlmOptions, q: { since?: string; limit?: number } = {}): Promise<EcrListing[]> {
  const plm = new PlmClient(opts);
  const rows = await plm.list(DOCTYPE.ecr, {
    fields: LIST_FIELDS,
    filters: q.since ? [['modified', '>', q.since]] : undefined,
    orderBy: 'modified asc',
    limit: q.limit,
  });
  return rows.map((r) => ({
    name: String(r.name),
    title: String(r.title ?? ''),
    workflowState: String(r.workflow_state ?? ''),
    modified: String(r.modified),
    modifiedBy: String(r.modified_by ?? ''),
  }));
}
