// NORN_INGEST_SOURCE=plm (#40): the ingest loop on the real PLM, through Norn's PLM connector.
//
// On start it lists the PLM's ECRs once and reports every one that is filed and still undecided, so
// nothing falls between the first listing and the watch. Then it watches: the poller hands over each
// ECR a person created or changed (not Norn's own writes), `readChangeRequest` turns it into the
// checks library's `ChangeRequest`, and the existing `ingest_ecr` path (`ingestOnce` in ../ingest.ts)
// opens the ECR in Norn or records its new revision.
//
//   NORN_INGEST_SOURCE=plm NORN_DB=norn-l1 npm run ingest -w @norn/workers
//   NORN_PLM_ECRS=ECR-0417        only these ECRs (default: every filed, undecided ECR)
//   NORN_PLM_STATES               workflow states to take in (default Submitted,In CM Review,CCB Review)
//   NORN_PLM_INTERVAL_MS          watch interval (default 1000)
//   NORN_PLM_SETTINGS             a module exporting Bowman's PLM spellings (default bowman/norn-config/plm.ts)
//
// The connector's `eco` (set when the PLM has an ECO for the request) stays inside the stored change
// request; ingest does nothing else with it. The ECO can lag the approval by a moment (the PLM's own
// release automation creates it); the connector's notes say so, and that is not worked around here.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlmMappingError, listEcrs, readChangeRequest, watchEcrs, type EcrListing, type PlmOptions } from '../../../connectors/plm/src/index.ts';
import { classify, withRetry, type Client } from '../connect.ts';
// ingest.ts hands these in: it is the entry module, and importing it back from here would deadlock its top-level await.
import type { IngestItem, ingestOnce as IngestOnce, itemOf as ItemOf } from '../ingest.ts';
import { plmOptionsFromEnv } from './plm.ts';

export const DEFAULT_STATES = ['Submitted', 'In CM Review', 'CCB Review'];

/**
 * States an ECR is watched in even though it is decided: Approved is where the PLM's release automation links the ECO to the
 * ECR (`released_eco`, a moment after the approval; bowman/plm/NOTES.md), and no other Bowman state carries it. Without it the
 * poller drops the approval and the ECO link, and the ECO's package is never built. An ECR in one of these states only ever has
 * its ECO release recorded (`recordEcoOnly`): it is never reported to ingest_ecr, so it cannot bump the ECR's revision, re-run
 * its checks or start a Level 1 agent. The first listing does not take these in either (see `startupWanted`): the PLM's
 * history is full of approved ECRs Norn has no business opening.
 */
export const ECO_STATES = ['Approved'];

export interface PlmIngestOptions {
  /** ECR numbers to take in; empty: all. */
  only: string[];
  /** Workflow states to take in. */
  states: string[];
  intervalMs: number;
  /** Where the watcher keeps its high-water mark between runs. */
  stateFile: string;
}

export function plmIngestOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PlmIngestOptions {
  const here = dirname(fileURLToPath(import.meta.url));
  const list = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    only: list(env.NORN_PLM_ECRS),
    states: list(env.NORN_PLM_STATES).length ? list(env.NORN_PLM_STATES) : DEFAULT_STATES,
    intervalMs: Number(env.NORN_PLM_INTERVAL_MS) > 0 ? Number(env.NORN_PLM_INTERVAL_MS) : 1000,
    stateFile: join(here, '..', '..', '.cache', 'level1', `plm-mark-${env.NORN_DB ?? 'norn'}.txt`),
  };
}

/** Whether an ECR in this state, by this number, is Norn's to take in. */
export const wanted = (o: PlmIngestOptions, e: Pick<EcrListing, 'name' | 'workflowState'>) =>
  (o.states.includes(e.workflowState) || ECO_STATES.includes(e.workflowState)) && (o.only.length === 0 || o.only.includes(e.name));

/** The same for the first listing: only the ECRs still undecided, not every approved one in the PLM's history. */
export const startupWanted = (o: PlmIngestOptions, e: Pick<EcrListing, 'name' | 'workflowState'>) =>
  wanted(o, e) && (o.states.includes(e.workflowState) || !ECO_STATES.includes(e.workflowState));

/** One ECR as the PLM has it now, as an ingest item. */
export async function readItem(opts: PlmOptions, name: string, itemOf: typeof ItemOf): Promise<IngestItem> {
  const r = await readChangeRequest(opts, name);
  // The PLM's own title and text, as filed; the change request carries the structure the checks read.
  return { ...itemOf(r.change as Record<string, any>, r.modified), title: r.record.title || name, description: r.record.text.description };
}

/**
 * The PLM has decided the ECR: record the ECO it released, once, and nothing else. This is deliberately not `ingestOnce`:
 * that reports the ECR through ingest_ecr, and a decided ECR must not get a new revision, a re-check or an agent. An ECR the PLM
 * has not yet linked an ECO to does nothing; the link bumps its `modified`, and the watcher delivers it again.
 */
export async function recordEcoOnly(R: Pick<Client['R'], 'recordEcoRelease'>, item: IngestItem, sent: Map<string, string>, log: (m: string) => void): Promise<void> {
  const key = `eco:${item.plmEcrNumber}`;
  if (!item.eco || sent.get(key) === item.eco) return;
  try {
    await withRetry(() => R.recordEcoRelease({ plmEcrNumber: item.plmEcrNumber, ecoNumber: item.eco!, source: 'plm', sourceRef: item.sourceRef }), { idempotent: true, label: `record_eco_release ${item.plmEcrNumber}` });
    sent.set(key, item.eco);
    log(`${item.plmEcrNumber} released as ${item.eco} (plm)`);
  } catch (e) {
    const c = classify(e);
    if (c.name === 'SenderError') sent.set(key, item.eco); // refused for good (an ECR Norn never opened): not retried every poll
    log(`could not record ${item.plmEcrNumber}'s change order ${item.eco}: ${c.name}: ${c.message}`);
    if (c.name !== 'SenderError') throw e; // transient: the watcher offers it again
  }
}

/** A mapping error is the ECR's own fault (a field the connector will not guess): retrying cannot help, a person must fix it. Anything else (network, timeout, 5xx, a failed report) is transient. */
export const isTransient = (e: unknown) => !(e instanceof PlmMappingError);

/**
 * ECRs whose take-in failed for a transient reason, each retried with a growing wait until it
 * succeeds. The watcher only reports ECRs changed after the first listing's newest stamp, so without
 * this an ECR that failed at start-up would stay out until someone edited it or the process restarted.
 */
export class RetryQueue {
  private waiting = new Map<string, { attempts: number; dueMs: number }>();
  constructor(private baseMs = 1000, private maxMs = 60_000) {}
  /** Note a failure (the first, or another); the next try waits baseMs, then double, up to maxMs. */
  fail(name: string, nowMs: number): number {
    const attempts = (this.waiting.get(name)?.attempts ?? 0) + 1;
    this.waiting.set(name, { attempts, dueMs: nowMs + Math.min(this.maxMs, this.baseMs * 2 ** (attempts - 1)) });
    return attempts;
  }
  done(name: string): void {
    this.waiting.delete(name);
  }
  due(nowMs: number): string[] {
    return [...this.waiting].filter(([, w]) => w.dueMs <= nowMs).map(([n]) => n);
  }
  has(name: string): boolean {
    return this.waiting.has(name);
  }
  get names(): string[] {
    return [...this.waiting.keys()];
  }
}

/** Runs one ECR's read and report at a time, so a retry and the watcher can never interleave and report older content last. */
export type EcrLock = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
export function ecrLock(): EcrLock {
  const tail = new Map<string, Promise<unknown>>();
  return (name, fn) => {
    const run = (tail.get(name) ?? Promise.resolve()).then(fn, fn);
    const settled = run.catch(() => {});
    tail.set(name, settled);
    void settled.then(() => { if (tail.get(name) === settled) tail.delete(name); });
    return run;
  };
}
const noLock: EcrLock = (_name, fn) => fn();

/**
 * Take in ECRs one at a time. One that cannot be mapped (a `PlmMappingError`) is logged by name and
 * skipped: the watcher delivers it again when someone fixes the ECR. One that fails for any other
 * reason goes to the retry queue, and `retryDue` takes it in on a later tick. The rest are taken in
 * either way, and the watcher still starts.
 */
export async function takeIn(
  names: string[],
  read: (name: string) => Promise<IngestItem>,
  report: (item: IngestItem) => Promise<void>,
  log: (m: string) => void,
  retry = new RetryQueue(),
  now: () => number = Date.now,
  lock: EcrLock = noLock,
  onlyQueued = false
): Promise<{ taken: string[]; skipped: string[]; retrying: string[] }> {
  const out = { taken: [] as string[], skipped: [] as string[], retrying: [] as string[] };
  for (const name of names) {
    try {
      // A retry whose ECR the watcher delivered meanwhile has nothing left to do. The check is inside the
      // lock, so it sees the watcher's delivery if that ran first; if the retry runs first, the watcher's
      // later read is of newer or equal content, so the newest is always reported last.
      const did = await lock(name, async () => {
        if (onlyQueued && !retry.has(name)) return false;
        await report(await read(name));
        return true;
      });
      if (!did) continue;
      retry.done(name);
      out.taken.push(name);
    } catch (e) {
      if (isTransient(e)) {
        const n = retry.fail(name, now());
        out.retrying.push(name);
        log(`${name}: not taken in yet (attempt ${n}), will retry: ${(e as Error).message}`);
      } else {
        retry.done(name);
        out.skipped.push(name);
        log(`${name}: not taken in, skipped until it is fixed in the PLM: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/** One tick: try again the ECRs that are due. */
export const retryDue = (retry: RetryQueue, read: (name: string) => Promise<IngestItem>, report: (item: IngestItem) => Promise<void>, log: (m: string) => void, now: () => number = Date.now, lock: EcrLock = noLock) =>
  takeIn(retry.due(now()), read, report, log, retry, now, lock, true);

/** What the watcher does with one changed ECR: a decided one only records its ECO release, any other is reported to ingest_ecr. */
export async function onChange(
  o: PlmIngestOptions,
  change: Pick<EcrListing, 'name' | 'workflowState'>,
  d: { read: (name: string) => Promise<IngestItem>; report: (item: IngestItem) => Promise<void>; recordEco: (item: IngestItem) => Promise<void>; lock: EcrLock; retry: RetryQueue }
): Promise<void> {
  if (!wanted(o, change)) return;
  await d.lock(change.name, async () => {
    const item = await d.read(change.name);
    if (ECO_STATES.includes(change.workflowState) && !o.states.includes(change.workflowState)) await d.recordEco(item);
    else await d.report(item);
    d.retry.done(change.name); // delivered fresh by the watcher: nothing left to retry
  });
}

/** Run until the process ends. */
export async function runPlmIngest(R: Client['R'], log: (m: string) => void, deps: { ingestOnce: typeof IngestOnce; itemOf: typeof ItemOf }, o = plmIngestOptionsFromEnv()): Promise<void> {
  const opts = await plmOptionsFromEnv();
  mkdirSync(dirname(o.stateFile), { recursive: true });
  const sent = new Map<string, string>();
  const report = async (item: IngestItem) => {
    const r = await deps.ingestOnce(R, { name: 'plm', list: async () => [item] }, sent, log);
    if (r.failed) throw new Error(`could not report ${item.plmEcrNumber}`); // the watcher offers it again
  };

  // The recipe from the connector's notes: list everything once, take the newest stamp as the mark,
  // ingest the open ones, then watch from the mark.
  const all = await listEcrs(opts);
  const mark = all.at(-1)?.modified;
  const take = all.filter(e => startupWanted(o, e));
  log(`the PLM has ${all.length} ECR(s); ${take.length} to take in${o.only.length ? ` (only ${o.only.join(', ')})` : ''}: ${take.map(e => `${e.name} [${e.workflowState}]`).join(', ') || 'none'}`);
  const read = (name: string) => readItem(opts, name, deps.itemOf);
  const retry = new RetryQueue(o.intervalMs);
  const lock = ecrLock();
  await takeIn(take.map(e => e.name), read, report, log, retry, Date.now, lock);
  let retrying = false;
  setInterval(() => {
    if (retrying || retry.names.length === 0) return;
    retrying = true;
    retryDue(retry, read, report, log, Date.now, lock).catch(e => log(`PLM retry: ${(e as Error).message}`)).finally(() => (retrying = false));
  }, o.intervalMs);

  const watcher = watchEcrs(
    opts,
    async change => {
      await onChange(o, change, { read, report, recordEco: item => recordEcoOnly(R, item, sent, log), lock, retry });
    },
    { intervalMs: o.intervalMs, since: mark, stateFile: o.stateFile, onError: e => log(`PLM watch: ${(e as Error).message}`) }
  );
  await watcher.ready();
  log(`watching the PLM every ${o.intervalMs} ms from ${watcher.highWater()}`);
  await new Promise<never>(() => {}); // the watcher's timer keeps the process alive
}
