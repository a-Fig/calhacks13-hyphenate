// A runner event sink that stores every event in Norn's agent_event table (record_agent_events).
// That table is the ECR page's live agent timeline and, for the dispatcher, the record of which
// sessions were started: no extra table. The sink never throws: the runner would stop the session
// ("sink_failed") rather than run it unlogged, and a database hiccup should not cost a paid session.
// Events wait in memory and are retried; a JSONL copy (teeSink in dispatcher.ts) is the fallback.
import { Timestamp } from 'spacetimedb';
import type { EventSink, NornEvent } from '../../../runner/src/index.ts';
import type { Client } from '../connect.ts';
import { withRetry } from '../connect.ts';
import { sleep } from '../sim.ts';

const MAX_PAYLOAD = 190_000;

type Input = {
  jobId: string;
  seq: number;
  ts: Timestamp;
  role: string;
  actor: string;
  onBehalfOf: string | undefined;
  spawnedBy: string;
  sessionId: string | undefined;
  eventType: string;
  payloadJson: string;
};

/** The runner's event as the module's AgentEventInput: the named fields, and the rest as JSON. */
export function toInput(e: NornEvent): Input {
  const { seq, ts, jobId, role, identity, sessionId, type, ...rest } = e as NornEvent & Record<string, unknown>;
  let payload = JSON.stringify(rest);
  if (payload.length > MAX_PAYLOAD) {
    // Cut the long text fields, not the event: the shape of the event stays readable.
    const cut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) cut[k] = typeof v === 'string' && v.length > 20_000 ? `${v.slice(0, 20_000)}...` : v;
    cut.payloadTruncated = true;
    payload = JSON.stringify(cut);
    if (payload.length > MAX_PAYLOAD) payload = JSON.stringify({ payloadTruncated: true, note: 'event too large to store' });
  }
  return {
    jobId,
    seq,
    ts: Timestamp.fromDate(new Date(ts)),
    role,
    actor: identity.actor,
    onBehalfOf: identity.onBehalfOf ?? undefined,
    spawnedBy: identity.spawnedBy,
    sessionId: sessionId ?? undefined,
    eventType: type,
    payloadJson: payload,
  };
}

export interface AgentEventWriter {
  sink: EventSink;
  /** Wait until everything queued has been stored (or give up after `ms`). Returns whether the queue is empty. */
  drain(ms?: number): Promise<boolean>;
}

/**
 * @param checkRunIdOf  the check run a job belongs to (the s2_cost run that triggered it), which
 *                      gives its events their ECR; 0n for a job that is not tied to one.
 */
export function agentEventWriter(R: Client['R'], checkRunIdOf: (jobId: string) => bigint, log: (m: string) => void): AgentEventWriter {
  const queue: { run: bigint; input: Input }[] = [];
  let flushing: Promise<void> | null = null;

  async function flushLoop() {
    let failures = 0;
    while (queue.length) {
      const run = queue[0]!.run;
      const batch: { run: bigint; input: Input }[] = [];
      while (queue.length && queue[0]!.run === run && batch.length < 50) batch.push(queue.shift()!);
      try {
        await withRetry(() => R.recordAgentEvents({ checkRunId: run, events: batch.map(b => b.input) }), { idempotent: true, tries: 3, label: 'record_agent_events' });
        failures = 0;
      } catch (e) {
        queue.unshift(...batch);
        if (++failures >= 5) {
          log(`could not store ${queue.length} agent event(s): ${(e as Error).message}; they stay queued`);
          return;
        }
        await sleep(1000);
      }
    }
  }
  const flush = () => (flushing ??= flushLoop().finally(() => (flushing = null)));

  return {
    sink: async event => {
      queue.push({ run: checkRunIdOf(event.jobId), input: toInput(event) });
      // Wait for the write, but not forever: the session matters more than its timeline.
      await Promise.race([flush(), sleep(8000)]);
    },
    async drain(ms = 30_000) {
      const t0 = Date.now();
      while (queue.length && Date.now() - t0 < ms) {
        await Promise.race([flush(), sleep(1000)]);
      }
      return queue.length === 0;
    },
  };
}
