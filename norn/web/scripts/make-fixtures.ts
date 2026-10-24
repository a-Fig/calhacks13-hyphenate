// Runs Norn's real checks (norn/checks) on Bowman's dataset and saves the rows the state layer
// stores, as the fixtures behind the demo screens:  node web/scripts/make-fixtures.ts  (from norn/)
//
// ECR-0417 is saved twice: Level 1, straight from the checks (the lines the originator left blank
// are flagged and counted as $0), and Level 3, after Norn's agent has estimated those lines (a mock
// agent: the numbers are made up, the arithmetic around them is the checks').
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck, costCheckRows, lognormal, type AssumptionOverride } from '../../checks/src/index.ts';
import { slug } from '../../checks/src/cost.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'assessment', 'fixtures');
mkdirSync(out, { recursive: true });
const SEED = 'norn-seed-1';
const rowId = (ecr: string, block: string, label: string) => `cost:${ecr}:${block}:${slug(label)}`;
const save = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data) + '\n');

const run = (id: string, assumptions?: AssumptionOverride[]) => {
  const ecr = bowman.ecrs.find((e) => e.id === id);
  if (!ecr) throw new Error(`no ${id}`);
  return costCheck(bowman, ecr, { seed: SEED, provenance: { baseline: 'Bowman dataset (bowman/data), as saved for the demo', changeRequest: `${id} from the dataset` }, ...(assumptions ? { assumptions } : {}) });
};

// Level 1: as filed.
save('ecr-0417.l1.json', costCheckRows(run('ECR-0417')));

// Level 3: Norn's agent estimates the three lines the originator left blank. Mock estimates.
const estimates: AssumptionOverride[] = [
  {
    id: rowId('ECR-0417', 'other', 'Delay cost of holding S/N 011-014 at the controller-install station'),
    source: 'agent_estimated', dist: lognormal(147_000, 0.3), by: 'Norn planner agent',
    rationale:
      'Controller installation is held on every aircraft that reaches the station before Rev C arrives (first lot about 14 weeks after the order, so about 25 Feb 2027). ' +
      'About 36 aircraft-weeks, each carrying 85% of the $2.8M standard cost at 9% a year: about $147,000.',
  },
  {
    id: rowId('ECR-0417', 'retrofit', 'Re-inspection and test after retrofit'),
    source: 'agent_estimated', dist: lognormal(6_600, 0.25), by: 'Norn cost agent',
    rationale: 'Six hours per aircraft on ten aircraft at $110, half the 12 hour installation time.',
  },
  {
    id: rowId('ECR-0417', 'logisticsSupport', 'Spares, maintenance manual task update, training'),
    source: 'agent_estimated', dist: lognormal(1_900, 0.25), by: 'Norn cost agent',
    rationale: 'Maintenance manual task 24-31 changes the torque table: 20 hours of technical publications at $95. No aircraft is delivered, so no spares or training.',
  },
];
save('ecr-0417.l3.json', costCheckRows(run('ECR-0417', estimates)));

// The rest: the checks as they stand.
save('ecr-0409.json', costCheckRows(run('ECR-0409')));
save('ecr-0423.json', costCheckRows(run('ECR-0423')));

// The backlog: every open ECR's year-one total, from the same checks.
const list: Record<string, { p10: number; p50: number; p90: number; point: number; from: string | null; months: number }> = {};
for (const e of bowman.ecrs) {
  const r = run(e.id);
  const m = r.headline.windowTotal;
  list[e.id] = { p10: m.p10, p50: m.p50, p90: m.p90, point: m.point, from: r.window.from, months: r.window.months };
}
save('list-costs.json', list);
console.log('wrote fixtures for', Object.keys(list).join(', '));
