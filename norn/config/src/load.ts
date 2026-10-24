// Loads a company's configuration file and validates it. A TypeScript or JavaScript file default-exports
// the configuration; a .json file holds it directly.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConfig, type ValidationResult } from './validate.ts';

export type LoadResult = ValidationResult;

const failure = (message: string): LoadResult => ({ ok: false, issues: [{ path: '', message }] });

export async function loadConfigFile(file: string): Promise<LoadResult> {
  const absolute = resolve(file);
  if (!existsSync(absolute)) return failure(`cannot read ${file}: no such file`);

  let value: unknown;
  if (absolute.endsWith('.json')) {
    try {
      value = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch (error) {
      return failure(`${file} is not valid JSON: ${(error as Error).message}`);
    }
  } else {
    try {
      const module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
      value = module.default;
    } catch (error) {
      return failure(`could not load ${file}: ${(error as Error).message}`);
    }
    if (value === undefined) return failure(`${file} has no default export: end the file with "export default <the configuration>"`);
  }
  return validateConfig(value);
}
