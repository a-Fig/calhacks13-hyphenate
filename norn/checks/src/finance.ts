// What a change does to the money that is left: the program's budget for the current period, the delay
// cost of a change that reaches the line late, and days of runway. The numbers are drawn and traced in the
// cost check (cost.ts), on its own draws, so they are ranges that move with every cost input. This module holds
// the shapes of those results and the small pure arithmetic they share. Company figures (budget, cash,
// burn, cost of a week of delay) come from the baseline's `finance`; nothing here names a company.

import type { Money } from './cost.ts';
import type { FigureNote, MonthStr, ProgramId } from './types.ts';

/** The change's cost against the ECR's program budget for the current period. */
export interface BudgetImpact {
  budgetUsd: number;
  spentToDateUsd: number;
  /** Budget less spent to date: what the change is measured against. */
  remainingUsd: number;
  /** The period cost as a share of the remaining budget (0.01 is 1%). Null when nothing is left to measure against. */
  share: Money | null;
  /** Share of draws in which the period cost is more than the remaining budget. */
  probabilityOver: number;
}

/** The change's cost in days of the company's runway. */
export interface RunwayImpact {
  cashOnHandUsd: number;
  monthlyBurnUsd: number;
  /** Cash out per day: monthly burn x 12 / 365. */
  burnPerDayUsd: number;
  /** Days of cash at today's burn, before the change. */
  runwayDaysNow: number;
  /** The change's cost in the period across every program it touches. */
  periodCost: Money;
  /** periodCost / burnPerDayUsd: the days of runway the change uses. Negative for a saving. */
  daysUsed: Money;
}

export interface FinanceImpact {
  program: ProgramId;
  period: { label: string; from: MonthStr; to: MonthStr };
  asOf: string;
  /**
   * The ECR's program: every one-time cost (counted in full, all of it assumed to fall in the period) plus the
   * program's recurring cost on units built from the cut-in to the end of the period.
   */
  periodCost: Money;
  budget: BudgetImpact;
  runway: RunwayImpact;
}

/** The delay cost the cost page carries on the originator's blank "delay" line. */
export interface DelayResult {
  /** The cost-page row it fills. */
  row: string;
  /** Weeks after the stated effectivity that the change can first reach the line, floored at 0 (the timeline model's lateness). */
  weeksLate: Money;
  /** The weekly cost basis: p10, p50 and p90 dollars per week of delay. */
  perWeekUsd: { p10: number; p50: number; p90: number };
  /** weeksLate x the weekly cost: an exposure, the most it costs if the line holds for the whole delay. */
  cost: Money;
}

/** Months from `from` to `to`, both included. */
export function monthSpan(from: MonthStr, to: MonthStr): number {
  const idx = (m: MonthStr) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  return idx(to) - idx(from) + 1;
}

/** Cash out per day from a monthly figure. */
export const perDay = (monthlyUsd: number): number => (monthlyUsd * 12) / 365;

/** A figure's provenance as one sentence for a trace: 'invented: why it is that size'. */
export function figureText(n: FigureNote | undefined): string | undefined {
  return n ? `${n.basis}${n.note ? `: ${n.note}` : ''}` : undefined;
}
