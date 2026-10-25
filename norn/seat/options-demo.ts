// The cost engineer seat finding the best option for an ECR, offline, from Bowman's dataset.
//   node norn/seat/options-demo.ts ECR-0417 [--json out.json] [--draws 10000]
import { writeFileSync } from 'node:fs';
import { bowman } from '../../bowman/data/index.ts';
import { evaluateOptions, renderOptions } from './src/options.ts';

const args = process.argv.slice(2);
const id = args.find((a) => /^ECR-/.test(a)) ?? 'ECR-0417';
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const ecr = bowman.ecrs.find((e) => e.id === id);
if (!ecr) throw new Error(`no ${id} in the dataset`);
const report = evaluateOptions(bowman, ecr, {
  seed: 'norn-seed-1',
  draws: flag('--draws') ? Number(flag('--draws')) : undefined,
  peers: bowman.ecrs.filter((e) => e.status === 'submitted' && e.id !== id),
  ncrs: bowman.ncrs,
  computedAt: new Date().toISOString(),
});
console.log(renderOptions(report));
const out = flag('--json');
if (out) { writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(`\nwrote ${out}`); }
