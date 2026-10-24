// What Norn's state layer takes from a validated configuration: the whole config as canonical JSON
// under one key, and the existing policy knobs that the config sets.
//
// The pairs are shaped for the module's `set_config` reducer ({ key, value }, both strings). The
// worker sends them at start-up (norn/workers/src/config.ts). Nothing here talks to the module.

import { COMPANY_CONFIG_KEY, canonicalJson } from './stored.ts';
import type { CompanyConfig } from './schema.ts';

export { COMPANY_CONFIG_KEY, canonicalJson };

export interface ConfigEntry {
  key: string;
  value: string;
}

/** The pairs to send to `set_config`, whole config first. */
export function configEntries(config: CompanyConfig): ConfigEntry[] {
  const { deepReview } = config.reviewDepth;
  return [
    { key: COMPANY_CONFIG_KEY, value: canonicalJson(config) },
    { key: 'deep_review_mode', value: deepReview.mode },
    { key: 'deep_review_limit', value: String(deepReview.maxPasses) },
  ];
}
