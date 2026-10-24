// Writes Bowman's baseline (the ERP's side of the dataset) as one JSON file, for a worker started with
// NORN_BASELINE_FILE so s1 and s2 run with no ERP:  node web/scripts/make-stub-baseline.ts <file>  (from norn/)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { bowman as b } from '../../../bowman/data/index.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: node web/scripts/make-stub-baseline.ts <file>');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ programs: b.programs, workCenters: b.workCenters, items: b.items, bom: b.bom, sourcing: b.sourcing, stock: b.stock, volumePlan: b.volumePlan, builtAircraft: b.builtAircraft }));
console.log(`wrote the baseline to ${file}`);
