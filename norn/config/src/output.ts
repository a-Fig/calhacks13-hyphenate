// What Norn's state layer takes from a validated configuration: the whole config as canonical JSON
// under one key, and the existing policy knobs that the config sets.
//
// The pairs are shaped for the module's `set_config` reducer ({ key, value }, both strings). Today
// that reducer accepts only the knobs in its CONFIG_DEFAULTS, so 'company_config' needs the module
// to learn the key first. Nothing here talks to the module.

import type { CompanyConfig } from './schema.ts';

/** The key the whole configuration is stored under. */
export const COMPANY_CONFIG_KEY = 'company_config';

export interface ConfigEntry {
  key: string;
  value: string;
}

/**
 * JSON with sorted keys and no whitespace, so equal configurations give identical text and the same
 * hash. Optional fields that are unset are left out.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${value} as JSON`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${fields.join(',')}}`;
  }
  throw new Error(`cannot write a ${typeof value} as JSON`);
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
