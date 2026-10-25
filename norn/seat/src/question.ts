// What the seat writes to people. Short, specific, and always says what the answer is for and in
// which unit, the way a cost engineer would ask a colleague. Escalations follow SBAR: situation,
// background, assessment, recommendation.
import type { AskRule, Gap, Person, Question } from './types.ts';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const first = (p: Person) => p.name.split(' ')[0];
const unitAsk = (u: AskRule['unit']) =>
  u === 'share' ? 'a percentage (a range like 5% to 15% is fine)' : 'a dollar figure for the whole line (a range like $3,000 to $5,000 is fine; "none" if there is no cost)';

export function askBody(ecr: string, gap: Gap, to: Person, rule: AskRule): string {
  const why = gap.kind === 'blank_row'
    ? `It is blank on the cost page and counted as $0 until someone who owns it gives a figure.`
    : `Norn is using a default for it, and it moves the 12-month total by about ${usd(gap.swing ?? 0)}.`;
  return `${first(to)}, for ${ecr}: what is your estimate for "${gap.label}"? ${why} Please answer with ${unitAsk(rule.unit)}. Asking you because ${rule.why}`;
}

export function remindBody(ecr: string, q: Question, hours: number): string {
  return `${first(q.to)}, a reminder on "${q.gap.label}" for ${ecr}: still counted as ${q.gap.kind === 'blank_row' ? '$0' : 'a default'} after ${Math.round(hours)} hours. A one-line figure is enough.`;
}

export function followUpBody(q: Question, reason: string): string {
  return `${first(q.to)}, thanks. I couldn't record that for "${q.gap.label}": ${reason}. Could you reply with ${unitAsk(q.rule.unit)}?`;
}

export function escalateBody(ecr: string, q: Question, to: Person, hours: number): string {
  const impact = q.gap.kind === 'blank_row' ? 'it is counted as $0, so the cost page understates the change' : `the default moves the 12-month total by about ${usd(q.gap.swing ?? 0)}`;
  return [
    `${first(to)}, escalating one input on ${ecr}.`,
    `Situation: "${q.gap.label}" has no estimate.`,
    `Background: asked ${q.to.name} (${q.to.title}) ${Math.round(hours)} hours ago, no answer.`,
    `Assessment: ${impact}.`,
    `Recommendation: assign someone to estimate it, or tell the board the line is unestimated.`,
  ].join(' ');
}
