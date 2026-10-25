// Who to ask: the seat file names the company seat that owns each kind of number; the company's
// people say who holds that seat. `originator` is whoever filed the ECR.
import type { Gap, Person, SeatDefinition } from './types.ts';
import { ruleFor } from './gaps.ts';

export interface Routed {
  to: Person;
  rule: SeatDefinition['asks'][number];
}

/** The person to ask about a gap, preferring someone on the ECR's program when a seat has several holders. */
export function routeGap(seat: SeatDefinition, gap: Gap, people: Person[], ctx: { originator: Person; program: string }): Routed | null {
  const rule = ruleFor(seat, gap.label, gap.inputId);
  if (!rule) return null;
  if (rule.seat === 'originator') return { to: ctx.originator, rule };
  const holders = people.filter((p) => p.seat === rule.seat);
  if (holders.length === 0) return null;
  const onProgram = holders.find((p) => p.programs?.includes(ctx.program));
  return { to: onProgram ?? holders[0], rule };
}

/** Who to escalate to at a level (0 = first escalation), from the seat file's escalation order. */
export function escalationTarget(seat: SeatDefinition, level: number, people: Person[], program: string): Person | null {
  const s = seat.escalation[level];
  if (!s) return null;
  const holders = people.filter((p) => p.seat === s);
  return holders.find((p) => p.programs?.includes(program)) ?? holders[0] ?? null;
}
