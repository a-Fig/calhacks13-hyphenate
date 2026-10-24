// One handler per stage. Handlers get a `RunCtx` to stream progress; they return results.
import { PERCENTILES, drawCostAtRisk, histogram, normal, quantile, rng, seedFrom, sleep } from './sim.ts';

export type Result = {
  key: string;
  label: string;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  detailJson: string;
};

/** Thrown by a handler that noticed the server no longer wants its work (stale inputs, run lost). */
export class AbortedError extends Error {
  constructor() {
    super('the server no longer wants this run');
    this.name = 'AbortedError';
  }
}

export type RunCtx = {
  runId: bigint;
  prId: bigint;
  stage: string;
  inputHash: string;
  /** Aborted when a heartbeat or progress call is told the run is stale or no longer ours. */
  signal: AbortSignal;
  /** Stream progress; resolves when the server has accepted it. Throws if the run is stale or lost. */
  progress: (p: { done: number; total: number; percentiles: number[]; histogram: number[]; histMin: number; histMax: number }) => Promise<void>;
  log: (msg: string) => void;
};

const MOCK = { mock: true };
const detail = (extra: object = {}) => JSON.stringify({ ...MOCK, ...extra });

function summarize(key: string, label: string, unit: string, draws: Float64Array, extra: object = {}): Result {
  const s = Float64Array.from(draws).sort();
  return { key, label, unit, p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9), detailJson: detail(extra) };
}

async function quick(ctx: RunCtx, ms: number, make: (rand: () => number) => Result[]): Promise<Result[]> {
  await sleep(ms);
  return make(rng(seedFrom(ctx.inputHash)));
}

export const HANDLERS: Record<string, (ctx: RunCtx) => Promise<Result[]>> = {
  s1_bom_delta: ctx =>
    quick(ctx, 400, rand => {
      const n = 3 + Math.floor(rand() * 5);
      return [{ key: 'bom_lines_changed', label: 'BOM lines changed', unit: 'lines', p10: n, p50: n, p90: n, detailJson: detail() }];
    }),

  s2_cost: ctx =>
    quick(ctx, 900, rand => {
      const draws = new Float64Array(4000).map(() => -120 + 260 * normal(rand) * 0.4 + 40);
      return [summarize('unit_cost_delta', 'Per-unit cost change', 'USD', draws)];
    }),

  s3_timeline: ctx =>
    quick(ctx, 900, rand => {
      const draws = new Float64Array(4000).map(() => 26 + 5 * normal(rand) + 6 * rand());
      return [summarize('effectivity_weeks', 'Weeks until the change reaches the line', 'weeks', draws)];
    }),

  // The long one: Monte Carlo with live percentile and histogram updates, about 2 per second.
  s4_supply: async ctx => {
    const rand = rng(seedFrom(ctx.inputHash));
    const total = Number(process.env.NORN_MC_DRAWS ?? 20000);
    const ticks = Number(process.env.NORN_MC_TICKS ?? 40);
    const tickMs = Number(process.env.NORN_MC_TICK_MS ?? 500);
    const per = Math.ceil(total / ticks);
    const draws = new Float64Array(total);
    const lo = 700;
    const hi = 2600;
    let n = 0;
    const rtts: number[] = []; // how long the server took to accept each progress report
    while (n < total) {
      if (ctx.signal.aborted) throw new AbortedError();
      const started = Date.now();
      const end = Math.min(total, n + per);
      for (; n < end; n++) draws[n] = drawCostAtRisk(rand);
      const sorted = draws.slice(0, n).sort();
      const sent = performance.now();
      await ctx.progress({
        done: n,
        total,
        percentiles: PERCENTILES.map(q => quantile(sorted, q)),
        histogram: histogram(sorted, 32, lo, hi),
        histMin: lo,
        histMax: hi,
      });
      rtts.push(performance.now() - sent);
      await sleep(Math.max(0, tickMs - (Date.now() - started)));
    }
    rtts.sort((a, b) => a - b);
    ctx.log(`s4 run ${ctx.runId}: ${rtts.length} progress reports, round trip p50 ${rtts[Math.floor(rtts.length * 0.5)]!.toFixed(1)} ms, p95 ${rtts[Math.floor(rtts.length * 0.95)]!.toFixed(1)} ms, max ${rtts[rtts.length - 1]!.toFixed(1)} ms`);
    const missed = draws.reduce((k, x) => k + (x > 1900 ? 1 : 0), 0) / total;
    return [
      summarize('cost_at_risk', 'Cost at risk per unit', 'USD', draws),
      { key: 'p_miss_effectivity', label: 'Chance of missing the effectivity date', unit: 'probability', p10: missed, p50: missed, p90: missed, detailJson: detail() },
    ];
  },

  // Agent stages. No LLM is called; the output says so.
  // NORN_AGENT_STAGE_MS stands in for an LLM call that outlives the lease.
  s0_extract: async ctx => {
    await sleep(Number(process.env.NORN_AGENT_STAGE_MS ?? 1500));
    return [{ key: 'extracted_changes', label: 'Changes extracted from the ECR text', unit: 'changes', p10: 4, p50: 4, p90: 4, detailJson: detail({ note: 'MOCK: no LLM call was made' }) }];
  },
  s5_card: async ctx => {
    await sleep(Number(process.env.NORN_AGENT_STAGE_MS ?? 1500));
    return [{ key: 'impact_statement', label: 'Change impact statement', unit: 'card', p10: 1, p50: 1, p90: 1, detailJson: detail({ note: 'MOCK: no LLM call was made', pr: String(ctx.prId) }) }];
  },
};
