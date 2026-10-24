// The real s1 and s2 handlers: Norn's impact checks (norn/checks) on the ECR's change request and
// on the ERP baseline the run's inputs name, with the run's seed and assumptions. The rows the
// library returns are stored unchanged (mock: false), so get_impact returns their traces. An ECR the
// PLM has sent no change request for keeps the mock handlers in stages.ts, labelled mock.
import type { DbConnection } from '@norn/bindings';
import {
  bomDelta,
  bomDeltaRows,
  costCheck,
  costCheckRows,
  lognormal,
  lognormalFromQuantiles,
  point,
  type AssumptionOverride,
  type ChangeRequest,
  type CheckResultRow,
  type Dist,
  type Source,
} from '../../checks/src/index.ts';
import type { BaselineStore } from './baseline.ts';
import { AbortedError, FatalRunError, HANDLERS, type Result, type RunCtx } from './stages.ts';

/** What the module puts in a code stage's inputsJson (core.ts StageInputs). */
type Inputs = {
  seed?: string;
  overlay?: string;
  revision?: number;
  erpBaseline?: string;
  assumptions?: { id: string; key: string; rev: number }[];
};

const SOURCES: Source[] = ['given', 'default', 'agent_estimated'];
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * An assumption row as the checks library takes it. The key is the library's input id
 * (`cost:ECR-0417:other:...`, `recovery:BW-5120-210`, `effectivity:ECR-0417:vesper`). distJson is
 * one of: { kind: 'fixed' | 'point', value }, { kind: 'lognormal', p10, p50, p90 },
 * { kind: 'lognormal', median, sigma }, { kind: 'lognormal', median, sigmaLow, sigmaHigh },
 * { kind: 'pert' | 'triangular', min, mode, max }, or { value } for a serial or a month; any of them
 * may add replacesGiven: true to replace a number someone stated.
 */
export function toOverride(row: { key: string; distJson: string; source: string; rationale: string }): AssumptionOverride | string {
  let o: any;
  try {
    o = JSON.parse(row.distJson);
  } catch {
    return 'distJson is not JSON';
  }
  if (!o || typeof o !== 'object') return 'distJson is not an object';
  if (!SOURCES.includes(row.source as Source)) return `unknown source '${row.source}'`;
  const base: AssumptionOverride = { id: row.key, source: row.source as Source, rationale: row.rationale, ...(o.replacesGiven === true ? { replacesGiven: true } : {}) };
  let dist: Dist | undefined;
  switch (o.kind) {
    case 'fixed':
    case 'point':
      if (!finite(o.value)) return `${o.kind} needs a numeric value`;
      return { ...base, dist: point(o.value), value: o.value };
    case 'lognormal':
      if (finite(o.p10) && finite(o.p50) && finite(o.p90)) dist = lognormalFromQuantiles(o.p10, o.p50, o.p90);
      else if (finite(o.median) && finite(o.sigmaLow) && finite(o.sigmaHigh)) dist = { kind: 'lognormal', median: o.median, sigmaLow: o.sigmaLow, sigmaHigh: o.sigmaHigh };
      else if (finite(o.median) && finite(o.sigma)) dist = lognormal(o.median, o.sigma);
      else return 'lognormal needs p10, p50 and p90, or a median and sigma';
      return { ...base, dist };
    case 'pert':
    case 'triangular':
      if (!(finite(o.min) && finite(o.mode) && finite(o.max) && o.min <= o.mode && o.mode <= o.max)) return `${o.kind} needs min <= mode <= max`;
      return { ...base, dist: { kind: o.kind, min: o.min, mode: o.mode, max: o.max } };
    case undefined:
      if (finite(o.value)) return { ...base, value: o.value, dist: point(o.value) };
      if (typeof o.value === 'string') return { ...base, value: o.value };
      return 'distJson has no kind and no value';
    default:
      return `unknown kind '${o.kind}'`;
  }
}

const real = (rows: CheckResultRow[]): Result[] => rows.map(r => ({ ...r, mock: false }));

export function impactHandlers(conn: DbConnection, baselines: BaselineStore) {
  /** The change request and baseline this run is on, or null when the ECR has no change request. */
  async function prepare(ctx: RunCtx) {
    const inputs = JSON.parse(ctx.inputsJson) as Inputs;
    if (inputs.revision === undefined) return null;
    if (!inputs.seed) throw new FatalRunError('the run names no seed');
    const rev = [...conn.db.ecrRevision.prId.filter(ctx.prId)].find(r => r.seq === inputs.revision);
    // The revision the run names has been replaced: the same transaction made the run stale.
    if (!rev || rev.digest !== inputs.overlay) throw new AbortedError();
    if (!inputs.erpBaseline) {
      // Norn has no baseline yet. Recording one re-checks every open ECR, which makes this run stale.
      await baselines.refresh(ctx.log);
      throw new AbortedError();
    }
    const baseline = await baselines.get(inputs.erpBaseline, ctx.log);
    if (!baseline) throw new AbortedError(); // the ERP has moved on; the new baseline is recorded and this run is stale
    return { inputs, baseline, ecr: JSON.parse(rev.changeRequestJson) as ChangeRequest };
  }

  /** The run's assumptions, by the ids its inputs name, as the library takes them. */
  function assumptionsOf(inputs: Inputs) {
    const overrides: AssumptionOverride[] = [];
    const problems: { key: string; id: string; problem: string }[] = [];
    for (const a of inputs.assumptions ?? []) {
      const row = conn.db.assumption.id.find(BigInt(a.id));
      if (!row) throw new AbortedError(); // not in the cache yet, or replaced: the run is stale
      const o = toOverride(row);
      if (typeof o === 'string') problems.push({ key: row.key, id: a.id, problem: o });
      else overrides.push(o);
    }
    return { overrides, problems };
  }

  return {
    s1_bom_delta: async (ctx: RunCtx): Promise<Result[]> => {
      const p = await prepare(ctx);
      if (!p) return HANDLERS.s1_bom_delta!(ctx);
      const rows = real(bomDeltaRows(bomDelta(p.baseline, p.ecr)));
      ctx.log(`s1 on ${p.ecr.id} rev ${p.inputs.revision}, baseline ${p.inputs.erpBaseline!.slice(0, 12)}: ${rows.length} row(s)`);
      return rows;
    },
    s2_cost: async (ctx: RunCtx): Promise<Result[]> => {
      const p = await prepare(ctx);
      if (!p) return HANDLERS.s2_cost!(ctx);
      const { overrides, problems } = assumptionsOf(p.inputs);
      const t0 = Date.now();
      const r = costCheck(p.baseline, p.ecr, { seed: p.inputs.seed!, assumptions: overrides });
      const rows = real(costCheckRows(r));
      // Assumptions the library could not be given are reported, never dropped silently.
      if (problems.length) {
        rows.push({ key: 'assumption_errors', label: 'Assumptions that could not be read', unit: 'count', p10: problems.length, p50: problems.length, p90: problems.length, detailJson: JSON.stringify({ problems }), mock: false });
      }
      ctx.log(`s2 on ${p.ecr.id} rev ${p.inputs.revision}: ${r.draws} draws in ${Date.now() - t0} ms, converged ${r.convergence.converged}, ${overrides.length} assumption(s)${problems.length ? `, ${problems.length} unreadable` : ''}`);
      return rows;
    },
  };
}
