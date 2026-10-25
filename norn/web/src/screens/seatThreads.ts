// Groups the seat's comments on an ECR into one thread per input: the question, then what followed.
// Pure (the page and its test share it). The anchors are the seat's own (norn/seat/src/thread.ts).
import { parseAnchor, type SeatAnchor } from '../../../seat/src/thread.ts';
import type { ActivityEvent } from '../assessment/types.ts';

export interface SeatItem { e: ActivityEvent; a: SeatAnchor }
export interface SeatThread {
  inputId: string;
  /** The question; absent when the ECR holds replies to a question that is gone. */
  ask: SeatItem;
  /** Everything after the question, oldest first. */
  after: SeatItem[];
  recorded: boolean;
}

export function seatThreadsOf(events: ActivityEvent[]): { threads: SeatThread[]; others: ActivityEvent[] } {
  const items: SeatItem[] = [];
  const others: ActivityEvent[] = [];
  for (const e of events) {
    const a = e.kind === 'comment' && e.anchor ? parseAnchor(e.anchor) : undefined;
    if (a) items.push({ e, a });
    else others.push(e);
  }
  const asks = new Map<string, SeatItem>();
  for (const it of items) if (it.a.kind === 'ask' && !asks.has(it.a.inputId)) asks.set(it.a.inputId, it);
  const threads: SeatThread[] = [];
  for (const [inputId, ask] of asks) {
    const after = items.filter((i) => i.a.inputId === inputId && i !== ask && i.a.kind !== 'ask').sort((x, y) => x.e.at.localeCompare(y.e.at));
    threads.push({ inputId, ask, after, recorded: after.some((i) => i.a.kind === 'record') });
  }
  // A comment whose question is not on the ECR is shown as the plain comment it is.
  for (const it of items) if (!asks.has(it.a.inputId)) others.push(it.e);
  threads.sort((x, y) => x.ask.e.at.localeCompare(y.ask.e.at));
  return { threads, others: others.sort((x, y) => x.at.localeCompare(y.at)) };
}
