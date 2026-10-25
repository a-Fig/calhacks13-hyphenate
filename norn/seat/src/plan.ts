// The seat's next moves for one ECR, as a pure function of what it knows: the gaps, the questions it
// has asked, the replies it has had and the clock. A worker runs this on every change and carries out
// the actions; the same state always gives the same actions, so a reviewer can replay any decision.
import type { AssumptionOverride } from '../../checks/src/types.ts';
import { parseReply } from './answer.ts';
import { askBody, escalateBody, followUpBody, remindBody } from './question.ts';
import { escalationTarget, routeGap } from './route.ts';
import type { Action, Gap, Person, Question, Reply, SeatDefinition } from './types.ts';

export interface SeatState {
  ecr: string;
  program: string;
  originator: Person;
  gaps: Gap[];
  questions: Question[];
  replies: Reply[];
  /** Input ids whose answer is already recorded. */
  recorded: string[];
  /** Input ids already reminded. */
  reminded: string[];
  /** Highest escalation level done per input id (0 = first escalation). */
  escalated: Record<string, number>;
  /** Input ids that already had a follow-up for their latest reply. */
  followedUp: string[];
}

const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000);
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

export function nextActions(seat: SeatDefinition, people: Person[], s: SeatState, now: string): Action[] {
  const actions: Action[] = [];
  const asked = new Map(s.questions.map((q) => [q.gap.inputId, q]));
  for (const gap of s.gaps) {
    if (asked.has(gap.inputId) || s.recorded.includes(gap.inputId)) continue;
    const routed = routeGap(seat, gap, people, { originator: s.originator, program: s.program });
    if (!routed) continue;
    const question: Question = { gap, to: routed.to, rule: routed.rule, body: askBody(s.ecr, gap, routed.to, routed.rule), askedAt: now };
    actions.push({ kind: 'ask', question });
  }
  let recordedAny = false;
  for (const q of s.questions) {
    const id = q.gap.inputId;
    if (s.recorded.includes(id)) continue;
    const reply = [...s.replies].reverse().find((r) => r.inputId === id);
    if (reply) {
      const parsed = parseReply(reply.text, q.rule.unit);
      if (parsed.ok) {
        const range = parsed.low !== undefined ? ` (range ${parsed.low} to ${parsed.high})` : '';
        const override: AssumptionOverride = {
          id,
          source: 'given',
          dist: parsed.dist,
          rationale: `${reply.from.name}, ${reply.from.title}, answered on ${s.ecr} at ${reply.at}: "${parsed.quote}". Recorded as ${round(parsed.value)}${range} by Norn's ${seat.title} seat.`,
          by: reply.from.name,
        };
        actions.push({ kind: 'record', reply, override });
        recordedAny = true;
        continue;
      }
      if (!s.followedUp.includes(id)) {
        actions.push({ kind: 'follow_up', reply, body: followUpBody(q, parsed.reason) });
        continue;
      }
      // A reply with no usable figure, already followed up: the clock restarts from that reply.
    }
    const waited = hoursBetween(reply && s.followedUp.includes(id) ? reply.at : q.askedAt, now);
    const done = s.escalated[id] ?? -1;
    const due = seat.deadlines.escalateAfterHours.filter((h) => waited >= h).length - 1;
    if (due > done) {
      // Skip a level whose holder is the person who was asked: escalating to them would be a reminder.
      let level = due;
      let to = escalationTarget(seat, level, people, s.program);
      while (to && to.id === q.to.id) to = escalationTarget(seat, ++level, people, s.program);
      if (to) actions.push({ kind: 'escalate', question: q, to, level, body: escalateBody(s.ecr, q, to, waited) });
    } else if (done < 0 && waited >= seat.deadlines.remindAfterHours && !s.reminded.includes(id)) {
      actions.push({ kind: 'remind', question: q, body: remindBody(s.ecr, q, waited) });
    }
  }
  if (recordedAny) actions.push({ kind: 'rerun', ecr: s.ecr, reason: 'answers recorded as assumptions; the checks re-run on them' });
  return actions;
}
