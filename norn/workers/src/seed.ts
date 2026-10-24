// Reseed the demo data through the same reducers everything else uses. Fictional company
// (Bowman Aviation), fictional ECRs, mock numbers. Run after `npm run db:reset`.
import { connect } from './connect.ts';

const client = await connect({ kind: 'agent', name: 'seed-script', origin: 'norn', spawnedBy: 'npm run seed' }, { persistToken: false });
const { R } = client;

const dist = (o: object) => JSON.stringify(o);
const base = async (key: string, value: object, source: string, rationale: string, affects: string[]) =>
  R.recordAssumption({ prId: 0n, key, distJson: dist(value), source, rationale, affects, expectedRev: 0 });

const t0 = Date.now();
await base('supplier_lead_time_weeks', { kind: 'triangular', min: 8, mode: 12, max: 20 }, 'default', 'Category default for machined parts', ['s3_timeline', 's4_supply']);
await base('scrap_rate', { kind: 'triangular', min: 0.01, mode: 0.03, max: 0.08 }, 'default', 'Category default', ['s2_cost', 's4_supply']);
await base('tooling_cost_usd', { kind: 'fixed', value: 250000 }, 'given', 'Tooling quote on file (mock)', ['s2_cost']);
await base('learning_curve_slope', { kind: 'fixed', value: 0.88 }, 'given', 'Aerospace structures norm (mock)', ['s2_cost']);
await base('disruption_rate_per_year', { kind: 'fixed', value: 0.15 }, 'agent_estimated', 'Proposed from comparable single-source parts (mock)', ['s4_supply']);

const ecrs = [
  { plmEcrNumber: 'BWM-ECR-0417', title: 'Replace machined aluminium wing-root bracket with a titanium forging', description: 'The aluminium bracket cracked in fatigue test. Replace it with a Ti-6Al-4V forging, same interface.' },
  { plmEcrNumber: 'BWM-ECR-0418', title: 'Add a second source for the battery contactor', description: 'Single-source exposure on the main contactor. Qualify a second supplier with the same footprint.' },
  { plmEcrNumber: 'BWM-ECR-0419', title: 'Move the harness connector to the lighter variant', description: 'Saves 0.4 kg per aircraft. Needs re-pinning of two harnesses.' },
];
for (const e of ecrs) await R.createPr(e);

// A few parts, so the connectors' external key has something to match against.
for (const p of [
  { partNumber: 'BWM-1042-01', name: 'Wing-root bracket, aluminium', category: 'structure' },
  { partNumber: 'BWM-1042-02', name: 'Wing-root bracket, titanium forging', category: 'structure' },
  { partNumber: 'BWM-5510-03', name: 'Battery contactor, main', category: 'electrical' },
]) await R.upsertPart({ ...p, specJson: '{}' });

// ECR-specific overrides: ids are 1..3 because the database was just reset.
const over = (prId: bigint, key: string, value: object, source: string, rationale: string, affects: string[]) =>
  R.recordAssumption({ prId, key, distJson: dist(value), source, rationale, affects, expectedRev: 0 });
await over(1n, 'requalification_weeks', { kind: 'triangular', min: 10, mode: 16, max: 30 }, 'agent_estimated', 'Proposed from comparable structural changes (mock)', ['s3_timeline']);
await over(1n, 'titanium_price_usd_per_kg', { kind: 'triangular', min: 38, mode: 46, max: 70 }, 'given', 'Mill quote range (mock)', ['s2_cost', 's4_supply']);
await over(2n, 'second_source_qualification_weeks', { kind: 'triangular', min: 20, mode: 30, max: 52 }, 'agent_estimated', 'Proposed (mock)', ['s3_timeline']);
await over(3n, 'repin_labor_hours', { kind: 'triangular', min: 6, mode: 9, max: 16 }, 'given', 'Harness shop estimate (mock)', ['s2_cost']);

console.log(`seeded in ${Date.now() - t0} ms: 5 baseline assumptions, ${ecrs.length} ECRs, 4 ECR assumptions, 3 parts`);
client.close();
process.exit(0);
