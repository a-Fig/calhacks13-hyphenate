// Loads and validates a company's configuration file.
//
//   node src/cli.ts <config-file>          check it, print a short summary
//   node src/cli.ts <config-file> --json   also print the { key, value } pairs for Norn's set_config
//
// Exit code 0 when the file is valid, 1 when it is not (every problem is listed, one per line, on
// stderr), 2 when the command line is wrong.

import { formatIssue } from './validate.ts';
import { loadConfigFile } from './load.ts';
import { configEntries } from './output.ts';
import { LEVEL_IDS, type CompanyConfig } from './schema.ts';

const USAGE = 'usage: node src/cli.ts <config-file> [--json]';

function summary(config: CompanyConfig): string[] {
  const { company, ecrForm, approval, autonomy, reviewDepth, materiality, postingStandards } = config;
  const money = (n: number) => `${n.toLocaleString('en-US')} ${company.currency}`;
  const fields = ecrForm.sections.reduce((n, s) => n + s.fields.length, 0);
  const tiers = approval.tiers.map((t) => `${t.upTo === null ? 'above' : 'up to ' + money(t.upTo)}: ${approval.bodies.find((b) => b.id === t.body)?.name ?? t.body}`);
  const levels = LEVEL_IDS.map((level) => `${autonomy.actions.filter((a) => a.level === level).length} ${level}`);
  const { deepReview } = reviewDepth;
  const rows: [string, string][] = [
    ['company', `${company.name} (${company.currency})`],
    ['ecr form', `${ecrForm.sections.length} sections, ${fields} fields, ${ecrForm.costPage.blocks.length} cost blocks, ${ecrForm.priorities.length} priorities`],
    ['classes', `company ${config.changeClasses.company.values.map((v) => v.id).join('/')}, regulatory ${config.changeClasses.regulatory.values.map((v) => v.id).join('/')}`],
    ['approval', `${tiers.join('; ')}; ${approval.neverFastTrack.length} never-fast-track rules`],
    ['people', `${config.people.length} people in ${config.roles.length} roles`],
    ['autonomy', `${autonomy.actions.length} actions: ${levels.join(', ')}`],
    ['deep review', `${deepReview.mode}, at most ${deepReview.maxPasses} ${deepReview.maxPasses === 1 ? 'pass' : 'passes'}`],
    ['materiality', `unit cost ${money(materiality.unitCost.absolute)} or ${materiality.unitCost.relativePct}%, one-time ${money(materiality.oneTimeCost)}, cut-in ${materiality.cutInSlipDays} days`],
    ['posting', `${postingStandards.requirements.length} checks, ${postingStandards.requirements.filter((r) => r.enforcement === 'block').length} blocking`],
  ];
  return rows.map(([label, text]) => `  ${label.padEnd(12)}${text}`);
}

/** Runs the command. Output goes through `out` (stdout) and `err` (stderr) so tests can read it. */
export async function run(argv: string[], out: (line: string) => void, err: (line: string) => void): Promise<number> {
  const flags = argv.filter((a) => a.startsWith('--'));
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length !== 1 || flags.some((f) => f !== '--json')) {
    err(USAGE);
    return 2;
  }
  const file = files[0]!;
  const result = await loadConfigFile(file);
  if (!result.ok) {
    err(`${file}: ${result.issues.length} ${result.issues.length === 1 ? 'problem' : 'problems'}`);
    for (const issue of result.issues) err(`  ${formatIssue(issue)}`);
    return 1;
  }
  if (flags.includes('--json')) {
    out(JSON.stringify(configEntries(result.config), null, 2));
  } else {
    out(`${file}: valid`);
    for (const line of summary(result.config)) out(line);
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), console.log, console.error);
}
