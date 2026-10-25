// The facts a Level 1 job prompt is written from, for one finished s2_cost run (#123). The dispatcher writes the prompt
// from them; the post tool's guard (guard.ts) reads the same facts for the numbers the agent was given, so a number
// in its prose is either one of them or one it invented. Kept apart from dispatcher.ts, which the MCP server must not
// load (it pulls in the runner).
import type { DbConnection } from '@norn/bindings';
import { provenanceOf, type Inputs } from '../impact.ts';
import { screenDetail, type Detail, type HeadlineKey } from './prompt.ts';
import { deriveRecommendation, ruleInputOf } from './recommendation.ts';
import { costCheckOf, routeFor, storedCompanyConfig } from './routing.ts';
import { failedChecksForRun, ruleSiblingsOf, siblingsForRun } from './source.ts';
import { timelineSupplyFacts } from './timeline-supply.ts';

type Db = DbConnection['db'];
type Pr = NonNullable<ReturnType<Db['pullRequest']['id']['find']>>;

const jsonOr = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/** The job prompt's facts for one finished s2_cost run, with its timeline and supply checks as of `snapshotUs` (the session's snapshot, siblings.ts). */
export function jobFactsOf(db: Db, pr: Pr, revision: number, s2RunId: number, snapshotUs?: bigint) {
  const run = db.checkRun.id.find(BigInt(s2RunId))!;
  const inputs = jsonOr<Inputs>(run.inputsJson, {});
  const p = provenanceOf(inputs);
  const rows = [...db.checkResult.prId.filter(pr.id)].filter(r => r.checkRunId === run.id);
  const numbers: HeadlineKey[] = rows
    .filter(r => r.key.startsWith('unit_cost_delta:') || r.key === 'one_time_total' || r.key === 'net_total_year_one')
    .sort((a, b) => Number(a.id - b.id))
    .map(r => ({ key: r.key.replace(/[^A-Za-z0-9_]/g, '_'), resultKey: r.key, label: r.label }));
  const year = rows.find(r => r.key === 'net_total_year_one');
  const detail = jsonOr<Detail>(rows.find(r => r.key === 'detail')?.detailJson ?? '{}', {});
  const screened = screenDetail(detail, year ? year.p90 - year.p10 : 0);
  const routing = routeFor(
    { number: pr.plmEcrNumber, title: pr.title, revision },
    { numbers: Object.fromEntries(rows.filter(r => r.key !== 'detail').map(r => [r.key, { p10: r.p10, p50: r.p50, p90: r.p90, unit: r.unit }])), costCheck: costCheckOf(rows) },
    storedCompanyConfig(db)
  );
  // The same rule and the same rows the publisher applies, so the agent is told what the PLM will say.
  // The timeline and supply checks of the same snapshot the publisher will read (siblings.ts). The agent posts none of
  // their numbers (the module would check them against the newest finished runs, which a later re-run can change
  // under it); the publisher shows them from these runs. The agent gets sentences built from the same rows.
  const siblings = siblingsForRun(db, pr.id, run.id, snapshotUs);
  const recommendation = deriveRecommendation(ruleInputOf(rows, failedChecksForRun(db, pr.id, run.id), ruleSiblingsOf(siblings, pr.plmEcrNumber)));
  return {
    ecr: pr.plmEcrNumber,
    title: pr.title,
    revision,
    s2RunId,
    baseline: p.baseline,
    changeRequest: p.changeRequest,
    numbers,
    screened,
    routing,
    recommendation,
    ...(siblings ? { timelineSupply: timelineSupplyFacts(siblings.timeline, siblings.supply) } : {}),
  };
}
