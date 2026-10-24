// The defaults the schema documents, written into a validated configuration so that the code that
// reads it does not have to repeat them.

import type { CompanyConfig } from './schema.ts';

/** A copy of `config` with every documented default filled in. Filling twice changes nothing. */
export function withDefaults(config: CompanyConfig): CompanyConfig {
  // A JSON copy, not structuredClone: the SpacetimeDB module runs this, and its JavaScript runtime has no structuredClone.
  const copy: CompanyConfig = JSON.parse(JSON.stringify(config));
  for (const rule of copy.autonomy.actions) {
    if (rule.limits && rule.otherwise === undefined) rule.otherwise = 'recommend';
  }
  for (const tier of copy.approval.tiers) tier.alsoReviewsAbove ??= false;
  for (const approver of copy.approval.fastTrack.approvers) approver.mustOwnTheChange ??= false;
  copy.reviewDepth.deepReview.autoFor ??= [];
  return copy;
}
