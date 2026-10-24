// Prints an ECR's cost page from Bowman's dataset: node demo.ts [ECR-0417] [seed]
import { bowman } from '../../bowman/data/index.ts';
import { costCheck, renderCostPage } from './src/index.ts';

const id = process.argv[2] ?? 'ECR-0417';
const ecr = bowman.ecrs.find((e) => e.id === id);
if (!ecr) throw new Error(`no ${id} in the dataset`);
const t0 = performance.now();
const r = costCheck(bowman, ecr, { seed: process.argv[3] ?? 'norn-seed-1' });
console.log(renderCostPage(r));
console.log(`\n${Math.round(performance.now() - t0)} ms; converged ${r.convergence.converged}`);
for (const f of r.flags) console.log(`${f.severity}: ${f.message}`);
