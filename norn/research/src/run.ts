// The whole research pass, for one ECR, from an agent's output to a report. Live and replay run
// this same function; they differ only in where the agent's output and the pages come from.

import { costCheck, timelineCheck, point, quantileOf, type AssumptionOverride, type Baseline, type ChangeRequest, type Dist } from '../../checks/src/index.ts';
import { costForecastFromCheck, routeEcr, type CompanyConfig, type CostForecast } from '../../config/src/index.ts';
import { applyAndReport, type TierInfo, type CheckRun, type Mode, type ResearchReport } from './apply.ts';
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
  /** The approval tier the company's routing gives for a set of assumptions (the configured cost measure, per draw). Absent without a config. */
  tierOf?: (assumptions: AssumptionOverride[]) => TierInfo;
}

export interface PrepareOptions {
  ecrId: string;
  seed: string;
  n?: number;
  timeline?: boolean;
  /** The company's configuration. With it, the approval tier is computed, and a set of proposals that would change it goes to a person. */
  config?: CompanyConfig;
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
  const cfg = opts.config;
  const tierOf = cfg
    ? (assumptions: AssumptionOverride[]): TierInfo => {
        const m = cfg.approval.costMeasure;
        const r = costCheck(company, ecr, { seed: opts.seed, assumptions, measures: [{ horizonMonths: m.horizonMonths, savingsOffset: m.savingsOffset }], windowMonths: m.horizonMonths });
        const cost = { ...costForecastFromCheck(r), measured: r.measures[0] } as CostForecast;
        const route = routeEcr(cfg, { ecrId: ecr.id, cost });
        return { tierId: route.tier.tierId, body: route.tier.bodyName, size: route.cost.size };
      }
    : undefined;
  return { ecr, seed: opts.seed, targets, run, identifiers, ...(tierOf ? { tierOf } : {}) };
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
  if (prep.tierOf) guardTier(verdicts, prep.tierOf);
  const report = applyAndReport({
    mode: opts.mode,
    ecr: prep.ecr.id,
    seed: prep.seed,
    provenance: opts.provenance,
    targets: prep.targets,
    verdicts,
    unresolved: opts.agentOutput.unresolved,
    run: prep.run,
    ...(prep.tierOf ? { tierOf: prep.tierOf } : {}),
  });
  return { verdicts, report };
}

/**
 * A proposal set that would change the routed approval tier goes to a person: an agent's estimate must
 * not decide who approves a change. Each accepted proposal that changes the tier alone is held; if the
 * rest together still change it, all are held.
 */
export function guardTier(verdicts: Verdict[], tierOf: (a: AssumptionOverride[]) => TierInfo): void {
  const accepted = () => verdicts.filter((v) => v.status === 'accepted' && v.override);
  if (accepted().length === 0) return;
  const base = tierOf([]);
  const hold = (v: Verdict, why: string) => {
    v.status = 'needs_person';
    v.reasons.push({ code: 'changes_tier', message: why });
    v.heldOverride = v.override;
    delete v.override;
  };
  const size = (x: number | null) => Math.round(x ?? 0).toLocaleString('en-US');
  for (const v of accepted()) {
    const t = tierOf([v.override!]);
    if (t.tierId !== base.tierId) hold(v, `applied, this moves the approval from ${base.body} to ${t.body} (cost size ${size(base.size)} to ${size(t.size)})`);
  }
  const rest = accepted();
  if (rest.length > 1) {
    const t = tierOf(rest.map((v) => v.override!));
    if (t.tierId !== base.tierId) for (const v of rest) hold(v, `together with the other accepted proposals this moves the approval from ${base.body} to ${t.body}`);
  }
}
