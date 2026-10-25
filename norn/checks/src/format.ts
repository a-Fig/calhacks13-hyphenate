// Money as a finance reader expects it: savings in parentheses (MIL-HDBK-61A App. B), and a plain
// text rendering of the cost page for logs, tests and PR descriptions. The web UI draws its own.

import type { CostCheckResult, CostRow, Money } from './cost.ts';
import type { CostBlock } from './types.ts';
import { COST_BLOCKS } from './types.ts';

/** 1234.5 -> '1,234.50'; -1900 -> '(1,900)'. Cents below 1,000, whole dollars above. */
export function formatUsd(x: number): string {
  const abs = Math.abs(x);
  const digits = abs < 1000 ? 2 : 0;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (Math.round(x * 100) === 0) return '0';
  return x < 0 ? `(${s})` : s;
}

/** p50 with the p10 to p90 range: '415.20 [398.53 to 444.25]'. */
export function formatMoney(m: Money | null): string {
  if (!m) return '';
  if (m.p10 === m.p90) return formatUsd(m.p50);
  return `${formatUsd(m.p50)} [${formatUsd(m.p10)} to ${formatUsd(m.p90)}]`;
}

const BLOCK_NAME: Record<CostBlock, string> = {
  production: 'Production',
  retrofit: 'Retrofit',
  logisticsSupport: 'Logistics support',
  other: 'Other',
};

const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w - 1) + '…' : s + ' '.repeat(w - s.length));
const lpad = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);

function rowLine(r: CostRow): string {
  const qty = r.quantity === null ? '' : String(r.quantity);
  const flag = r.needsEstimate ? ' *' : r.exposure ? ' †' : '';
  // The label is cut to leave room for its marker.
  const label = r.exposure ? r.label.replace(/ \(exposure\)$/, '') : r.label;
  return `  ${pad(label.length + flag.length > 57 ? label.slice(0, 57 - flag.length) + '…' : label, 58 - flag.length)}${flag}${lpad(formatMoney(r.oneTime), 30)}${lpad(formatMoney(r.unitCost), 28)}${lpad(qty, 6)}${lpad(formatMoney(r.total), 32)}`;
}

/** The cost page as text: p50 with [p10 to p90] in every cell, savings in parentheses. */
export function renderCostPage(r: CostCheckResult): string {
  const out: string[] = [];
  out.push(`${r.ecr} cost impact (${r.currency}; p50 [p10 to p90]; ${r.draws.toLocaleString('en-US')} paired draws, seed ${r.seed})`);
  out.push(`Year-one window: ${r.window.months} months from ${r.window.from ?? 'the cut-in'}. ${r.effectivity.map((e) => `${e.program} cut-in S/N ${e.cutInSerial}${e.cutInMonth ? ` (${e.cutInMonth})` : ''}, ${e.source}`).join('; ')}.`);
  out.push('');
  out.push(`  ${pad('', 58)}${lpad('One-time', 30)}${lpad('Unit cost', 28)}${lpad('Qty', 6)}${lpad('Total', 32)}`);
  for (const b of COST_BLOCKS) {
    out.push(BLOCK_NAME[b]);
    const rows = r.blocks[b];
    if (rows.length === 0) out.push('  (none)');
    for (const row of rows) out.push(rowLine(row));
    out.push(`  ${pad(`Subtotal, ${BLOCK_NAME[b].toLowerCase()}`, 58)}${lpad(formatMoney(r.blockTotals[b].oneTime), 30)}${lpad('', 28)}${lpad('', 6)}${lpad(formatMoney(r.blockTotals[b].total), 32)}`);
  }
  const h = r.headline;
  out.push('');
  for (const u of h.unitCostDelta) out.push(`Unit cost change, ${u.program}: ${formatMoney(u.perUnit)} per unit`);
  out.push(`One-time total: ${formatMoney(h.oneTimeTotal)}`);
  out.push(`Recurring, year one: ${formatMoney(h.recurringWindow)}`);
  out.push(`Net total, year one: ${formatMoney(h.windowTotal)}`);
  out.push(`Net total, whole volume plan: ${formatMoney(h.planTotal)}`);
  if (COST_BLOCKS.some((b) => r.blocks[b].some((x) => x.exposure))) out.push('† exposure, not an expected cost: the line is assumed to hold for every week the change is late');
  if (r.delay) out.push(`Weeks late against the stated effectivity (floored at 0): ${r.delay.weeksLate.p10 === r.delay.weeksLate.p90 ? r.delay.weeksLate.p50 : `${r.delay.weeksLate.p50} [${r.delay.weeksLate.p10} to ${r.delay.weeksLate.p90}]`}, at ${formatMoney({ ...r.delay.cost, ...r.delay.perWeekUsd, mean: 0, point: 0 })} per week`);
  const fin = r.finance;
  if (fin) {
    const pctOf = (x: number) => `${(100 * x).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
    const range = (m: Money, f: (x: number) => string) => (m.p10 === m.p90 ? f(m.p50) : `${f(m.p50)} [${f(m.p10)} to ${f(m.p90)}]`);
    out.push(`Cost in ${fin.period.label}, ${fin.program}: ${formatMoney(fin.periodCost)}`);
    if (fin.budget.share) {
      out.push(`Share of the remaining ${fin.program} budget: ${range(fin.budget.share, pctOf)} of ${formatUsd(fin.budget.remainingUsd)} (budget ${formatUsd(fin.budget.budgetUsd)}, spent ${formatUsd(fin.budget.spentToDateUsd)} by ${fin.asOf}); chance it exceeds the remainder: ${pctOf(fin.budget.probabilityOver)}`);
    } else {
      out.push(`The ${fin.program} budget for ${fin.period.label} is spent (${formatUsd(fin.budget.spentToDateUsd)} of ${formatUsd(fin.budget.budgetUsd)}); chance the change costs more than what is left: ${pctOf(fin.budget.probabilityOver)}`);
    }
    out.push(`Runway used: ${range(fin.runway.daysUsed, (x) => `${x.toLocaleString('en-US', { maximumFractionDigits: 2 })} days`)} of ${fin.runway.runwayDaysNow} (cash ${formatUsd(fin.runway.cashOnHandUsd)}, burn ${formatUsd(fin.runway.monthlyBurnUsd)} a month)`);
  }
  if (r.blocks.production.some((x) => x.needsEstimate) || COST_BLOCKS.some((b) => r.blocks[b].some((x) => x.needsEstimate))) {
    out.push('* left blank on the cost page; counted as 0 until estimated');
  }
  return out.join('\n');
}
