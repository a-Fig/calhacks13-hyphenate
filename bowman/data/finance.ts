import type { Finance } from './types.ts';
import { inv } from './prov.ts';

// Program budgets, cash and the cost of a late change, so Norn can say what a change does to the
// budget and to runway. All invented: the fictional company's books, sized from its own volume plan.
//
// Sizing, so the figures hang together (the validator checks the relations):
// - Fiscal year July to June. The books are read on 2026-10-24, 3.8 months in.
// - Vesper FY2027 builds 16 aircraft (S/N 007 to 010 completed July to October, then 1 a month to
//   December and 1, 1, 2, 2, 2, 2 a month January to June): 16 x $2.8M standard cost = $44.8M, plus
//   about $27M of engineering, certification support and line overhead = $72M.
// - Meridian FY2027 is development with no aircraft completed before September 2027: $38M of engineering,
//   test articles and certification work.
// - Burn: both programs plus $15M of company overhead and Georgia plant build-out, spread over 12
//   months: (72 + 38 + 15) / 12 = $10.4M a month. Cash $236M is 22.7 months of that.

export const finance: Finance = {
  budgets: [
    {
      program: 'vesper',
      period: { label: 'FY2027 (Jul 2026 to Jun 2027)', from: '2026-07', to: '2027-06' },
      budgetUsd: 72_000_000,
      spentToDateUsd: 20_400_000,
      asOf: '2026-10-24',
      prov: inv('16 aircraft in the period at the $2.8M standard cost ($44.8M) plus about $27M engineering, certification and line overhead; 28% spent after 31% of the year.'),
    },
    {
      program: 'meridian',
      period: { label: 'FY2027 (Jul 2026 to Jun 2027)', from: '2026-07', to: '2027-06' },
      budgetUsd: 38_000_000,
      spentToDateUsd: 13_200_000,
      asOf: '2026-10-24',
      prov: inv('Development program, no aircraft completed in the period: engineering, test articles and certification work; 35% spent after 31% of the year (first-flight article procurement is front-loaded).'),
    },
  ],
  delayCosts: [
    {
      program: 'vesper',
      perWeekUsd: { p10: 20_000, p50: 32_000, p90: 55_000 },
      basis: 'The controller-install station crew idle or redeployed (6 people x 40 h x about $100 per hour is $24k), carrying a held aircraft (1 held x $2.8M x 12% a year / 52 is $6.5k) and expediting.',
      prov: inv('Crew from the work-center rates in this dataset (WC-SYS $100 per hour); carrying cost at a 12% cost of capital; p10 assumes the crew is redeployed part of the week, p90 four held aircraft and overtime.'),
    },
    {
      program: 'meridian',
      perWeekUsd: { p10: 10_000, p50: 16_000, p90: 30_000 },
      basis: 'The prototype build team waiting on the change (about 10 people x 40 h x $95 per hour is $38k at full idleness, so the p50 assumes a share of the week is redeployed) and test-article carrying cost.',
      prov: inv('Smaller than Vesper because no production aircraft is held; sized from the work-center rates in this dataset and a partial redeployment assumption.'),
    },
  ],
  cash: {
    cashOnHandUsd: 236_000_000,
    monthlyBurnUsd: 10_400_000,
    asOf: '2026-10-24',
    prov: inv('Pre-revenue: no sales yet (S/N 005 to 010 are in the hangar, undelivered). Burn is the two program budgets plus $15M overhead and Georgia plant build-out over 12 months; cash is 22.7 months of it.'),
  },
};
