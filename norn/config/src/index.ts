export * from './schema.ts';
export { validateConfig, formatIssue, type ValidationResult } from './validate.ts';
export { loadConfigFile, type LoadResult } from './load.ts';
export { COMPANY_CONFIG_KEY, canonicalJson, configEntries, type ConfigEntry } from './output.ts';
export type { Issue } from './kit.ts';
