// The check Norn's MCP server runs on a Level 1 statement before it is saved (#123). The agent's words are shown in the
// PLM next to the rule's output, so a statement that says "the checks are clean" while the rule found conditions, or
// quotes a dollar figure no check produced, is refused with the reason, as any other refusal of the post tool is (the
// tool's text goes back to the agent, which fixes it and posts again). It never rewrites the agent's prose.
//
// The server (mcp/src/main.ts) passes this to `startServer`; the server itself knows nothing of the rule. It reads the
// server's mirror of the database, for the check run that started the session (`spawnedBy`, "norn:check_run:7", or "norn:check_run:7:revision:2" once the credential carries the ECR revision).
import type { DbConnection } from '@norn/bindings';
import { cleanClaims, findingsByCheck, findingsOf, numbersIn, QUOTABLE_BARS, unknownAmounts, type Prose } from './prose.ts';
import { deriveRecommendation } from './recommendation.ts';
import { ruleInputForRun } from './source.ts';

type Db = DbConnection['db'];

/** Returns why the statement may not be posted, or undefined when it may. */
export type StatementGuard = (pr: { id: bigint; plmEcrNumber: string }, spawnedBy: string, statement: Prose) => string | undefined;

const jsonOr = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

export function statementGuardFor(db: Db): StatementGuard {
  return (pr, spawnedBy, statement) => {
    // Same reading of the credential as the module's: a session started by a check run. Any other poster is not checked here.
    const started = /(?:^|:)check_run:(\d+)(?::revision:\d+)?$/.exec(spawnedBy);
    if (!started) return undefined;
    const found = ruleInputForRun(db, pr.id, BigInt(started[1]!), pr.plmEcrNumber);
    if (!found) return undefined;
    const derived = deriveRecommendation(found.input);
    const findings = findingsOf(found.input, derived);
    const problems: string[] = [];

    const clean = cleanClaims(statement, findings, findingsByCheck(found.input, derived));
    if (clean.length)
      problems.push(
        `Your ${clean.map(c => `${c.where} says "${c.phrase}"`).join(' and your ')}, but Norn's checks found ${findings.length === 1 ? 'one item' : `${findings.length} items`} for ${pr.plmEcrNumber}: ${findings.map((f, i) => `(${i + 1}) ${f}`).join('; ')}. Do not say the checks are clean or that there are no issues, flags, gaps or conditions. Norn lists these items in the PLM itself.`
      );

    // The amounts the checks produced: every number in the run's results and its timeline and supply rows, and the bars the agent is given.
    const known = [...QUOTABLE_BARS, ...findings.flatMap(f => numbersIn(f))];
    for (const r of found.results) {
      known.push(r.p10, r.p50, r.p90);
      numbersIn(jsonOr(r.detailJson), known);
    }
    const unknown = unknownAmounts(statement, known);
    if (unknown.length)
      problems.push(`The ${unknown.map(u => `${u.figure} in your ${u.where}`).join(' and the ')} ${unknown.length === 1 ? 'is' : 'are'} not in any check result of ${pr.plmEcrNumber}. Quote dollar figures only as get_impact shows them, rounded to the dollar, or leave them out.`);

    return problems.length ? `Not posted. ${problems.join(' ')} Rewrite the wording and post again.` : undefined;
  };
}
