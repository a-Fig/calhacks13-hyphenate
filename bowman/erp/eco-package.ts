// Prints the ERP change package of ECR-0417's ECO against Bowman's ERPNext: every line a person enters in ERPNext for
// the release, with exact values, and whether each line is already there. It only reads, as the Norn Agent user, which
// has no write permission (issue #71). Run it again after entering lines to see them turn from "to enter" to "entered".
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts           the package as markdown
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON bowman/erp/eco-package.ts --json    the package as JSON
//   options: --effective YYYY-MM-DD (default today)  --decision-url <url>  --eco ECO-0319
//
// Exit code 1 when the package has problems (a missing account, a price row that starts after the effective date, ...) or
// a line in conflict. Undo what was entered with bowman/erp/reset-eco.ts.
// Needs the tunnel and ERPNEXT_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET (ENV_FILE or the repo-root .env).
import { erpnext } from '../norn-config/erpnext.ts';
import { buildErpChangePackage, connectionFromEnv, formatErpChangePackage, loadEnvFile, today } from '../../norn/connectors/erpnext/src/index.ts';
import { ecr0417Release } from './ecr-0417-release.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

loadEnvFile();
const conn = connectionFromEnv();
const effectiveDate = arg('effective') ?? today(erpnext.timeZone); // Pacific, per the settings
const { release, notes } = ecr0417Release({ effectiveDate, decisionUrl: arg('decision-url'), eco: arg('eco') });

const pkg = await buildErpChangePackage(conn, erpnext, release);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(pkg, null, 2));
} else {
  console.log(formatErpChangePackage(pkg));
  console.log('\nNotes:');
  for (const n of notes) console.log(`    ${n}`);
}
process.exit(pkg.problems.length || pkg.counts.conflict ? 1 : 0);
