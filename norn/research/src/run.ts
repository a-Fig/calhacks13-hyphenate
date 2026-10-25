// The whole research pass, for one ECR, from an agent's output to a report. Live and replay run
// this same function; they differ only in where the agent's output and the pages come from.

import { costCheck, timelineCheck, point, quantileOf, type AssumptionOverride, type Baseline, type ChangeRequest, type Dist } from '../../checks/src/index.ts';
import { applyAndReport, type CheckRun, type Mode, type ResearchReport } from './apply.ts';
import { reviewProposals, type GuardrailConfig } from './guardrails.ts';
import { collectIdentifiers, type IdentifierSource } from './leak.ts';
import { pickTargets, type TargetContext } from './targets.ts';
import type { AgentOutput, PageFetcher, Target, Verdict } from './types.ts';

export type Company = Baseline & Omit<IdentifierSource, 'ecrs' | 'items'> & { ecrs: (ChangeRequest & { description?: string; originatingNcr?: string })[] };

export interface ResearchRun {
  ecr: ChangeRequest;
  seed: string;
  targets: Target[];
  /** The checks, run with the given assumptions (and the timeline too when asked for). */
  run: (assumptions: AssumptionOverride[]) => CheckRun;
  /** Guardrail config pieces the caller can extend. */
  identifiers: ReturnType<typeof collectIdentifiers>;
}

export interface PrepareOptions {
  ecrId: string;
  seed: string;
  n?: number;
  timeline?: boolean;
  context?: TargetContext;
}

/** The context the question can state about the scrapped part, from the ECR's own change data: generic facts only. */
export function contextFromEcr(ecr: ChangeRequest & { description?: string }): TargetContext {
  const ctx: TargetContext = {};
  for (const ic of ecr.itemChanges) for (const c of ic.changes) if (c.field === 'mass_kg' && typeof c.from === 'number') ctx.massKg = c.from;
  const m = /\b([2-7]\d{3})\b[^.]{0,30}\b(?:bracket|plate|fitting|part)\b/i.exec(ecr.description ?? '');
  if (m) ctx.material = `${m[1]}-series aluminum alloy`;
  return ctx;
}

export function prepare(company: Company, opts: PrepareOptions): ResearchRun {
  const ecr = company.ecrs.find((e) => e.id === opts.ecrId);
  if (!ecr) throw new Error(`no ${opts.ecrId} in the dataset`);
  const run = (assumptions: AssumptionOverride[]): CheckRun => ({
    cost: costCheck(company, ecr, { seed: opts.seed, assumptions }),
    ...(opts.timeline ? { timeline: timelineCheck(company, ecr, { seed: opts.seed, assumptions }) } : {}),
  });
  const identifiers = collectIdentifiers(company);
  const first = run([]);
  const rerun = (inputId: string, dist: Dist, q: number): number => {
    const probe: AssumptionOverride = { id: inputId, source: 'agent_estimated', rationale: 'sensitivity probe', dist: point(quantileOf(dist, q)) };
    return costCheck(company, ecr, { seed: opts.seed, assumptions: [probe], draws: 1000, maxDraws: 1000 }).headline.windowTotal.point;
  };
  const targets = pickTargets(first.cost, {
    n: opts.n ?? 3,
    context: opts.context ?? contextFromEcr(ecr),
    ...(first.timeline ? { timeline: first.timeline } : {}),
    rerun,
    identifiers,
  });
  return { ecr, seed: opts.seed, targets, run, identifiers };
}

export interface FinishOptions {
  mode: Mode;
  provenance: string[];
  agentOutput: AgentOutput;
  fetcher: PageFetcher;
  guardrails: Omit<GuardrailConfig, 'identifiers'>;
}

export async function finish(prep: ResearchRun, opts: FinishOptions): Promise<{ verdicts: Verdict[]; report: ResearchReport }> {
  const verdicts = await reviewProposals(opts.agentOutput.proposals, prep.targets, opts.fetcher, { ...opts.guardrails, identifiers: prep.identifiers });
  const report = applyAndReport({
    mode: opts.mode,
    ecr: prep.ecr.id,
    seed: prep.seed,
    provenance: opts.provenance,
    targets: prep.targets,
    verdicts,
    run: prep.run,
  });
  return { verdicts, report };
}
