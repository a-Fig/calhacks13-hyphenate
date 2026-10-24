// Writes to the PLM. Norn may do two things there: set the impact assessment on a change request, and add
// a comment to it. Anything else is refused here before a request is made, and refused again by the PLM.

import { DOCTYPE, IMPACT_FIELDS } from './schema.ts';
import type { ImpactField } from './schema.ts';
import { PlmClient, enc } from './client.ts';
import type { ImpactState } from './map.ts';
import type { PlmOptions } from './options.ts';

/** Values for the impact assessment fields, under the PLM's field names. null clears a field. */
export type ImpactFields = { [K in ImpactField]?: string | number | null };

const allowed = new Set<string>(IMPACT_FIELDS);

/**
 * Set the impact assessment on an ECR: only `impact_report_level`, `impact_recommendation`,
 * `impact_change_class`, `impact_approval_route`, `impact_norn_url`, `impact_updated_on` and
 * `impact_statement` (HTML). Only the fields given are touched. Returns the assessment as stored.
 * `impact_updated_on` is stamped by the PLM when not given.
 */
export async function writeImpact(opts: PlmOptions, ecrNumber: string, fields: ImpactFields): Promise<{ impact: ImpactState; modified: string }> {
  const body: Record<string, string | null> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!allowed.has(k)) { rejected.push(k); continue; }
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new TypeError(`${k}: expected a string, a number or null`);
    body[k] = v === null ? null : String(v);
  }
  if (rejected.length) throw new RangeError(`writeImpact writes only ${IMPACT_FIELDS.join(', ')}; refused: ${rejected.join(', ')}`);
  if (!Object.keys(body).length) throw new RangeError('writeImpact needs at least one field');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ecrNumber)) throw new RangeError(`not an ECR number: ${ecrNumber}`);
  const res = await new PlmClient(opts).put<{ data: Record<string, any> }>(`/api/resource/${enc(DOCTYPE.ecr)}/${enc(ecrNumber)}`, body);
  const impact: ImpactState = {};
  for (const f of IMPACT_FIELDS) if (res.data[f] !== undefined && res.data[f] !== null && res.data[f] !== '') impact[f] = String(res.data[f]);
  return { impact, modified: String(res.data.modified ?? '') };
}

/** Add a comment (HTML) to an ECR, as the integration user. Returns the comment's name. */
export async function postComment(opts: PlmOptions, ecrNumber: string, html: string): Promise<{ name: string }> {
  if (!html.trim()) throw new RangeError('postComment needs some text');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ecrNumber)) throw new RangeError(`not an ECR number: ${ecrNumber}`);
  const res = await new PlmClient(opts).post<{ data: { name: string } }>(`/api/resource/${enc(DOCTYPE.comment)}`, {
    doctype: DOCTYPE.comment,
    comment_type: 'Comment',
    reference_doctype: DOCTYPE.ecr,
    reference_name: ecrNumber,
    content: html,
  });
  return { name: String(res.data.name) };
}
