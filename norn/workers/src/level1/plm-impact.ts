// Read or clear the seven impact fields of an ECR in the PLM, as Norn's integration user. For
// checking what the publisher wrote, and for putting the demo record back as it was.
//   npx tsx src/level1/plm-impact.ts read  ECR-0417      (from norn/workers; ENV_FILE points at the .env)
//   npx tsx src/level1/plm-impact.ts clear ECR-0417      sets all seven fields empty
// Prints field names and lengths, never credentials. `read --full` also prints the statement HTML.
import { pathToFileURL } from 'node:url';
import { IMPACT_FIELDS, connectionFromEnv, plmFromConnection, type ImpactFields, type PlmApi } from './plm.ts';

/** Every impact field set to null: the ECR as it was before Norn wrote anything. */
export const EMPTY_IMPACT: ImpactFields = Object.fromEntries(IMPACT_FIELDS.map(f => [f, null]));

export async function clearImpact(plm: PlmApi, ecr: string) {
  return plm.writeImpact(ecr, EMPTY_IMPACT);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, ecr, flag] = process.argv.slice(2);
  if (!['read', 'clear'].includes(cmd ?? '') || !ecr) throw new Error('usage: plm-impact.ts read|clear <ECR number> [--full]');
  const plm = plmFromConnection(connectionFromEnv());
  const state = cmd === 'clear' ? await clearImpact(plm, ecr) : await plm.readImpact(ecr);
  if (state === null) throw new Error(`the PLM has no ECR ${ecr}`);
  console.log(cmd === 'clear' ? `cleared the impact fields of ${ecr}; the PLM now holds:` : `the PLM holds on ${ecr}:`);
  for (const f of IMPACT_FIELDS) {
    const v = state[f];
    console.log(`  ${f.padEnd(24)} ${v === undefined ? '(empty)' : f === 'impact_statement' && flag !== '--full' ? `${v.length} characters of HTML` : v}`);
  }
}
