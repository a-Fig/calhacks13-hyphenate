// Prints the ERP change package of ECR-0417's ECO against Bowman's ERPNext: every line a person enters in ERPNext for
// the release, with exact values, and whether each line is already there. It reads as the Norn Agent user. With --draft it
// also does what Fern's worker does on release (Tyler, 2026-10-25, reversing #71): saves the BOM versions and journal
// entries as unsubmitted drafts, unless they are already there, and reads again. Run it again after entering lines to see
// them turn from "to enter" (or "drafted") to "entered".
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts           the package as markdown
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts --json    the package as JSON
//   options: --effective YYYY-MM-DD (default today)  --decision-url <url>  --eco ECO-0319
//            --draft                  save the drafts as Fern, then show the package
//            --release-json <file>    use this release (e.g. the worker's stored release_json) instead of ECR-0417's
//
// Exit code 1 when the package has problems (a missing account, a price row that starts after the effective date, ...) or
// a line in conflict. Undo what was entered with bowman/erp/reset-eco.ts.
// Needs the tunnel and ERPNEXT_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET (ENV_FILE or the repo-root .env).
import { erpnext } from '../norn-config/erpnext.ts';
import { readFileSync } from 'node:fs';
import { buildErpChangePackage, connectionFromEnv, deskUrl, draftErpChangePackage, formatErpChangePackage, loadEnvFile, today } from '../../norn/connectors/erpnext/src/index.ts';
import type { EcoRelease } from '../../norn/connectors/erpnext/src/index.ts';
import { ecr0417Release } from './ecr-0417-release.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

loadEnvFile();
const conn = connectionFromEnv();
const effectiveDate = arg('effective') ?? today(erpnext.timeZone); // Pacific, per the settings
const file = arg('release-json');
const { release, notes } = file
  ? { release: JSON.parse(readFileSync(file, 'utf8')) as EcoRelease, notes: [`release read from ${file}`] }
  : ecr0417Release({ effectiveDate, decisionUrl: arg('decision-url'), eco: arg('eco') });

let pkg = await buildErpChangePackage(conn, erpnext, release);
if (process.argv.includes('--draft')) {
  const d = await draftErpChangePackage(conn, erpnext, pkg);
  const say = (m: string) => console.error(m);
  for (const x of d.created) say(`drafted   ${x.lineId}: ${x.doctype} ${x.name}  ${deskUrl(pkg.erpUrl, x)}`);
  for (const x of d.updated) say(`updated   ${x.lineId}: ${x.doctype} ${x.name} ${x.field} set to the package's decision link`);
  for (const x of d.existing) say(`existing  ${x.lineId}: ${x.doctype} ${x.name} (nothing saved)`);
  for (const x of d.skipped) say(`skipped   ${x.lineId}: ${x.why}`);
  for (const x of d.failed) say(`FAILED    ${x.lineId}: ${x.why}`);
  say(`${d.created.length} draft(s) saved, ${pkg.counts.drafted + d.existing.length} already there as drafts, ${d.skipped.length} skipped, ${d.failed.length} failed.
`);
  pkg = await buildErpChangePackage(conn, erpnext, release);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(pkg, null, 2));
} else {
  console.log(formatErpChangePackage(pkg));
  console.log('\nNotes:');
  for (const n of notes) console.log(`    ${n}`);
}
process.exit(pkg.problems.length || pkg.counts.conflict ? 1 : 0);
