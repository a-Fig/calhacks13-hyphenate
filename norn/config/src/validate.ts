// Checks a loaded value against the schema and the cross-field rules, and reports every problem.

import { describe, didYouMean, type Issue } from './kit.ts';
import { withDefaults } from './defaults.ts';
import { rules } from './rules.ts';
import { SECTION_NAMES, configShape, type CompanyConfig, type SectionName } from './schema.ts';

export type ValidationResult = { ok: true; config: CompanyConfig } | { ok: false; issues: Issue[] };

/**
 * Every section is checked on its own, so one bad section does not hide problems in the others.
 * The rules that connect sections run for the sections that came out clean; the rest of them run
 * once the file is fixed. A valid config comes back as a copy with the schema's defaults filled in.
 */
export function validateConfig(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: `expected an object with the company's configuration, got ${describe(input)}` }] };
  }
  const record = input as Record<string, unknown>;
  const issues: Issue[] = [];
  const clean = new Set<SectionName>();

  for (const name of SECTION_NAMES) {
    if (record[name] === undefined) issues.push({ path: name, message: 'required section, but missing' });
    else if (configShape[name].check(record[name], name, issues)) clean.add(name);
  }
  for (const key of Object.keys(record)) {
    if (!(SECTION_NAMES as string[]).includes(key)) issues.push({ path: key, message: `unknown section${didYouMean(key, SECTION_NAMES)}` });
  }
  for (const rule of rules) {
    if (rule.needs.every((name) => clean.has(name))) rule.run(record as CompanyConfig, issues);
  }

  return issues.length === 0 ? { ok: true, config: withDefaults(record as CompanyConfig) } : { ok: false, issues };
}

/** One line per problem: the path of the field, then what is wrong with it. */
export const formatIssue = (issue: Issue): string => `${issue.path === '' ? '(file)' : issue.path}: ${issue.message}`;
