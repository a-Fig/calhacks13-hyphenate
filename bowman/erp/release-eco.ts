// Dry-runs or applies the ECO write-back for ECR-0417 against Bowman's ERPNext, as the Norn Agent user.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/release-eco.ts            print the plan, write nothing
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/release-eco.ts --apply    write it, then read the result back
//   options: --effective YYYY-MM-DD (default today)  --decision-url <url>  --eco ECO-0319
//
// Undo with bowman/erp/reset-eco.ts. Needs the tunnel and ERPNEXT_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET (ENV_FILE or the repo-root .env).
import { erpnext } from '../norn-config/erpnext.ts';
import {
  applyEcoRelease, bomVersions, connectionFromEnv, formatPlan, loadEnvFile, planEcoRelease, priceHistory, readBaseline, today,
} from '../../norn/connectors/erpnext/src/index.ts';
import { ecr0417Release } from './ecr-0417-release.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

loadEnvFile();
const conn = connectionFromEnv();
const effectiveDate = arg('effective') ?? today(erpnext.timeZone); // Pacific, per the settings
const { release, notes } = ecr0417Release({ effectiveDate, decisionUrl: arg('decision-url'), eco: arg('eco') });

const plan = await planEcoRelease(conn, erpnext, release);
console.log(formatPlan(plan));
console.log('\nNotes:');
for (const n of notes) console.log(`    ${n}`);

if (!process.argv.includes('--apply')) {
  console.log(`\nDry run: nothing written. Add --apply to write ${plan.steps.filter((s) => s.status === 'todo').length} steps.`);
  process.exit(plan.problems.length ? 1 : 0);
}

console.log('\nApplying...');
const t0 = Date.now();
const result = await applyEcoRelease(conn, erpnext, plan);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s. ${result.written.length} documents:`);
for (const w of result.written) console.log(`  ${w.action.padEnd(8)} ${w.doctype.padEnd(15)} ${w.name}\n           ${w.summary}\n           ${w.link}`);
for (const s of result.skipped) console.log(`  skipped  ${s}`);

// Read it back the way a person would check it.
const opts = { ...erpnext, ...conn };
console.log('\nRead back from ERPNext:');
for (const { item } of release.items) {
  const rows = await priceHistory(opts, item);
  console.log(`  ${item} standard cost: ${rows.map((r) => `${money(r.rate)} from ${r.validFrom}${r.validUpto ? ` to ${r.validUpto}` : ''}`).join('; ')}`);
}
const baseline = (await readBaseline({ ...opts, asOf: release.effectiveDate })).baseline;
for (const p of baseline.programs) {
  const v = (await bomVersions(opts, p.topItem)).filter((x) => x.active && x.default);
  console.log(`  ${p.name} (${p.topItem}) default BOM ${v.map((x) => `${x.bom.name} total cost ${money(x.totalCost)}`).join(', ')}`);
}
