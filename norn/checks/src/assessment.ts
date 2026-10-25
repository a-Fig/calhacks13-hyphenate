// Requested and forecast implementation are distinct scenarios, not mixed into one cost distribution.
import { costCheck, type CostCheckOptions, type Money } from './cost.ts';
import { costCheckRows, type CheckResultRow } from './rows.ts';
import { timelineCheck } from './timeline.ts';
import type { Baseline, ChangeRequest, InputRecord } from './types.ts';

export function costAssessment(baseline: Baseline, ecr: ChangeRequest, options: CostCheckOptions) {
  const requested = costCheck(baseline, ecr, options);
  const timeline = timelineCheck(baseline, ecr, {
    seed: options.seed, assumptions: options.assumptions, provenance: options.provenance,
    draws: options.draws, maxDraws: options.maxDraws, correlation: options.correlation,
    convergenceTolerance: options.convergenceTolerance,
  });
  const inputId = `implementation-scenario:${ecr.id}`;
  const requestedSerial = requested.effectivity.find(e => e.program === ecr.program)?.cutInSerial ?? 1;
  const serial = Math.max(requestedSerial, Math.ceil(timeline.cutIn.serial.p50));
  const key = `effectivity:${ecr.id}:${ecr.program}`;
  const forecast = !timeline.cutIn.placed ? null : costCheck(baseline, ecr, {
    ...options,
    assumptions: [...(options.assumptions ?? []).filter(a => a.id !== key), {
      id: key, source: 'default', value: serial, replacesGiven: true,
      rationale: `Conditional scenario at the later of requested S/N ${requestedSerial} and the timeline median S/N ${Math.ceil(timeline.cutIn.serial.p50)}. This is a scenario choice, not a joint cost/date simulation.`,
    }],
  });
  const scenarioInput: InputRecord = {
    id: inputId, label: 'Implementation scenario', source: 'default', value: `Requested S/N ${requestedSerial}; forecast scenario S/N ${serial}`,
    ref: `${ecr.id} effectivity.production and the timeline on the same baseline, seed and assumptions`,
    rationale: 'Primary totals assume requested effectivity. The alternative uses the median readiness serial, never earlier than requested. Its cost ranges are conditional on that serial and exclude unknown delay, qualification and support costs.',
  };
  requested.inputs.push(scenarioInput);
  for (const flag of timeline.flags.filter(f => f.severity === 'warn')) {
    // Timeline flags have their complete input records in the separate scenario snapshot below.
    requested.flags.push({ ...flag, ref: inputId });
  }
  if (serial > requestedSerial || !forecast) requested.flags.push({
    kind: 'implementation_scenario', severity: 'warn', ref: inputId,
    message: forecast
      ? `Primary costs assume requested S/N ${requestedSerial}; the ${timeline.readiness === 'materials_only' ? 'material-readiness' : 'implementation'} median is S/N ${serial}. The separately costed scenario excludes unestimated delay and support costs.`
      : 'Implementation cannot be placed in the volume plan. Primary costs remain a requested-effectivity scenario; feasible implementation cost is unknown.',
  });
  if (forecast && !forecast.convergence.converged) requested.flags.push({ kind: 'not_converged', severity: 'warn', ref: inputId, message: 'The alternative implementation-cost scenario did not converge.' });
  const implementationScenario = {
    basis: 'requested' as const,
    requested: ecr.effectivity.production,
    forecast: { readiness: timeline.readiness, date: timeline.cutIn.date, serial: timeline.cutIn.serial, placed: timeline.cutIn.placed },
    alternative: forecast ? {
      label: `${timeline.readiness === 'materials_only' ? 'Material-readiness' : 'Implementation'} scenario at median S/N ${serial}`,
      window: forecast.window, effectivity: forecast.effectivity,
      net: forecast.headline.windowTotal, recurring: forecast.headline.recurringWindow, oneTime: forecast.headline.oneTimeTotal,
      inputs: forecast.inputs, flags: forecast.flags, convergence: forecast.convergence,
    } : null,
    timelineInputs: timeline.inputs,
    note: scenarioInput.rationale,
  };
  const rows = costCheckRows(requested);
  const detail = rows.find(row => row.key === 'detail')!;
  detail.detailJson = JSON.stringify({ ...JSON.parse(detail.detailJson), implementationScenario });
  const alternativeRow = (key: string, label: string, money: Money): CheckResultRow => ({
    key, label, unit: 'USD', p10: money.p10, p50: money.p50, p90: money.p90,
    detailJson: JSON.stringify({ point: money.point, mean: money.mean,
      trace: { formula: 'Conditional forecast scenario: cost at the later of requested and median readiness serial; see implementationScenario for the separate inputs and window', uses: [{ id: inputId, source: 'default' }], evidence: 'computation' },
      scenario: 'forecast', window: forecast!.window }),
  });
  if (forecast) {
    rows.push(alternativeRow('scenario:forecast_net', 'Net cost at forecast median implementation', forecast.headline.windowTotal));
    rows.push(alternativeRow('scenario:forecast_recurring', 'Recurring cost at forecast median implementation', forecast.headline.recurringWindow));
  }
  return { requested, timeline, forecast, rows, implementationScenario };
}

export type ImplementationScenario = ReturnType<typeof costAssessment>['implementationScenario'];
