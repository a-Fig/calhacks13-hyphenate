// One look at one ECR: from what is stored (the gaps in the current cost run, the comments, the given
// assumptions) and the clock, the calls the seat should make now. Pure, so a restart, a replay and a
// test all give the same answer. The worker reads the database, calls this, and carries the calls out.
import { toCall, type Call } from './calls.ts';
import { nextActions } from './plan.ts';
import { askedInputs, deriveState, type DeriveInput } from './state.ts';
import type { Action, Person, SeatDefinition } from './types.ts';

export interface ChaseInput extends DeriveInput {
  prId: bigint;
  /** The current revision of each input's assumption on this ECR. */
  revisions: Record<string, number>;
  /** Anchors this process has already posted but the database cache has not shown yet. */
  inFlight?: Set<string>;
  demoClock?: string;
}

export interface Chase {
  actions: Action[];
  calls: { action: Action; call: Call }[];
}

export function chase(seat: SeatDefinition, people: Person[], inp: ChaseInput, now: string): Chase {
  const state = deriveState(seat, people, inp);
  const asked = askedInputs(inp.comments);
  const actions = nextActions(seat, people, state, now).filter((a) => !(a.kind === 'ask' && asked.has(a.question.gap.inputId)));
  const calls: Chase['calls'] = [];
  const ctx = { prId: inp.prId, expectedRev: (id: string) => inp.revisions[id] ?? 0, demoClock: inp.demoClock };
  for (const action of actions) {
    const call = toCall(action, ctx);
    if (!call) continue;
    if (call.reducer === 'add_comment' && inp.inFlight?.has(call.args.anchor)) continue;
    calls.push({ action, call });
  }
  return { actions, calls };
}

/** `+25h`, `+90m`, `+2d`: the demo clock's shift in milliseconds. */
export function parseOffset(text: string): number {
  const m = /^\+?(\d+(?:\.\d+)?)\s*(m|h|d)$/.exec(text.trim());
  if (!m) throw new Error(`--demo-clock takes a shift like +25h, +90m or +2d, not "${text}"`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
}
