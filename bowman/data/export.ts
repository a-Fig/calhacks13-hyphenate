// Writes the dataset as one JSON file for seeders in any language: node bowman/data/export.ts
// check.ts fails if bowman.json is out of date with the TypeScript source.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bowman } from './index.ts';

export const JSON_PATH = fileURLToPath(new URL('./bowman.json', import.meta.url));
export const render = (): string => JSON.stringify(bowman, null, 2) + '\n';

if (import.meta.main) {
  writeFileSync(JSON_PATH, render());
  console.log(`wrote ${JSON_PATH}`);
}
