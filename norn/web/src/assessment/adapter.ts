// The adapter seam: live check results in, the screens' ImpactAssessment out.
//
// The checks library (#41) will return ECP-shaped rows with p10/p50/p90 and a trace per number.
// The mapping is mechanical:
//
//   check row (block, label, one-time, unit cost, quantity, p10/p50/p90)  ->  CostRow, with Figure ids
//   per-number trace (sources, inputs, assumptions with origin, formula)   ->  Trace, keyed by Figure id
//   evidence class of a value (fact / assumption / computation / judgment) ->  Figure.evidence
//   paired-draw totals                                                     ->  Figure p10/p50/p90, SCurve
//   one-at-a-time input swings                                             ->  Driver[]
//   agent events (#53, agent_event rows)                                   ->  ActivityEvent[]
//
// Until #41 defines its output type, the input is `unknown`: the first live commit narrows it here
// and nowhere else.
import type { ImpactAssessment } from './types.ts';

export function fromChecks(_results: unknown): ImpactAssessment {
  throw new Error('fromChecks is not wired yet: waiting on the checks library (#41) and the impact statement (#42)');
}
