// The check Norn's MCP server runs on a Level 1 statement before it is saved (#123). The agent's words are shown in the
// PLM next to the rule's output, so a statement that says "the checks are clean" while the rule found conditions, or
// quotes a dollar figure no check produced, is refused with the reason, as any other refusal of the post tool is (the
// tool's text goes back to the agent, which fixes it and posts again). It never rewrites the agent's prose.
//
// The server (mcp/src/main.ts) passes this to `startServer`; the server itself knows nothing of the rule. It reads the
// server's mirror of the database, for the check run that started the session (`spawnedBy`, "norn:check_run:7", or
// "norn:check_run:7:revision:2" as the dispatcher signs it since #128), read with the module's own `parseSessionSpawn`.
//
// The module's freshness refusal (`sessionRunId` in reducers.ts) comes first: a session whose signed revision is
// behind the ECR's, or whose run is no longer done, is not checked here, so the agent is told its numbers are out of
// date rather than asked to reword a statement it may not post at all. The module's other test (the run's inputs
// moved under it) needs the stage hashes, so the guard leaves that to the module; such a statement can be refused for
// its wording first, and then for being out of date.
import type { DbConnection } from '@norn/bindings';
import { parseSessionSpawn } from '../../../module/src/gate-logic.ts';
import { jobFactsOf } from './facts.ts';
import { cleanClaims, findingsByCheck, findingsOf, nonComputationNumbers, numbersIn, QUOTABLE_BARS, SMALL, unknownAmounts, type Prose } from './prose.ts';
import { deriveRecommendation } from './recommendation.ts';
import { crSeqOfRun, ruleInputForRun } from './source.ts';

type Db = DbConnection['db'];

/** Returns why the statement may not be posted, or undefined when it may. */
export type StatementGuard = (pr: { id: bigint; plmEcrNumber: string; revision?: number }, spawnedBy: string, statement: Prose) => string | undefined;

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
    const started = parseSessionSpawn(spawnedBy);
    if (!started) return undefined;
    if (started.revision !== undefined && pr.revision !== undefined && started.revision !== pr.revision) return undefined;
    const run = db.checkRun.id.find(BigInt(started.runId));
    if (!run || run.status !== 'done') return undefined;
    const found = ruleInputForRun(db, pr.id, run.id, pr.plmEcrNumber);
    if (!found) return undefined;
    const derived = deriveRecommendation(found.input);
    const findings = findingsOf(found.input, derived);
    const problems: string[] = [];

    const clean = cleanClaims(statement, findings, findingsByCheck(found.input, derived));
    if (clean.length)
      problems.push(
        `Your ${clean.map(c => `${c.where} says "${c.phrase}"`).join(' and your ')}, but Norn's checks found ${findings.length === 1 ? 'one item' : `${findings.length} items`} for ${pr.plmEcrNumber}: ${findings.map((f, i) => `(${i + 1}) ${f}`).join('; ')}. Do not say the checks are clean or that there are no issues, flags, gaps or conditions. Norn lists these items in the PLM itself.`
      );

    const judged = nonComputationNumbers(statement);
    if (judged.length)
      problems.push(
        `Your ${judged.map(j => `${j.where} has evidence "${j.evidence}"`).join(' and your ')}. A Level 1 statement's numbers are exactly the ones the job names, each evidence computation with its key and resultKey; post ${judged.length === 1 ? 'it' : 'them'} as one of those or leave ${judged.length === 1 ? 'it' : 'them'} out.`
      );

    // The numbers Norn produced for this ECR: every number in the run's results and its timeline and supply rows, in
    // the job's facts (its sentences, the route, the change request), in the findings, and the bars the agent is given.
    const known = [...QUOTABLE_BARS, ...findings.flatMap(f => numbersIn(f))];
    // Without the facts (a mirror missing a table) fewer numbers are known, which only refuses more.
    try {
      numbersIn(jobFactsOf(db, { title: '', ...pr } as Parameters<typeof jobFactsOf>[1], crSeqOfRun(db, run.id) ?? 0, Number(run.id)), known);
    } catch {
      /* the results above still count */
    }
    for (const r of found.results) {
      known.push(r.p10, r.p50, r.p90);
      numbersIn(jsonOr(r.detailJson), known);
    }
    const unknown = unknownAmounts(statement, known);
    if (unknown.length)
      problems.push(`The ${unknown.map(u => `${u.figure} in your ${u.where}`).join(' and the ')} ${unknown.length === 1 ? 'is' : 'are'} not in any check result of ${pr.plmEcrNumber}. A number over ${SMALL} must be one Norn gave you (get_impact or the job), as it shows it, or part of an id or a date; leave the others out.`);

    return problems.length ? `Not posted. ${problems.join(' ')} Rewrite the wording and post again.` : undefined;
  };
}
