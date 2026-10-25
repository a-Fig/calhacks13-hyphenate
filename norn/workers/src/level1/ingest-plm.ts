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
import type { IngestItem, PlmDecisionItem, ingestOnce as IngestOnce, itemOf as ItemOf } from '../ingest.ts';
import { plmOptionsFromEnv } from './plm.ts';

export const DEFAULT_STATES = ['Submitted', 'In CM Review', 'CCB Review'];

/**
 * The states in which the PLM has decided an ECR, and what each decision is. The PLM is the system of record for the decision,
 * and Norn mirrors it (`record_plm_decision`). Approved is also where the PLM's release automation links the ECO to the ECR
 * (`released_eco`, a moment after the approval; bowman/plm/NOTES.md), so the ECO release is recorded here too
 * (`recordEcoOnly`). An ECR in one of these states is never reported to ingest_ecr, whatever `NORN_PLM_STATES` says: it cannot
 * bump the ECR's revision, re-run its checks or start a Level 1 agent. The first listing does not take these in either (see
 * `startupWanted`): the PLM's history is full of decided ECRs Norn has no business opening.
 */
export const DECISIONS: Record<string, PlmDecisionItem['decision']> = { Approved: 'approved', Rejected: 'rejected' };
export const DECIDED_STATES = Object.keys(DECISIONS);

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
  (o.states.includes(e.workflowState) || DECIDED_STATES.includes(e.workflowState)) && (o.only.length === 0 || o.only.includes(e.name));

/** The same for the first listing: only the ECRs still undecided, not every decided one in the PLM's history. */
export const startupWanted = (o: PlmIngestOptions, e: Pick<EcrListing, 'name' | 'workflowState'>) =>
  wanted(o, e) && !DECIDED_STATES.includes(e.workflowState);

/** One ECR as the PLM has it now, as an ingest item. */
export async function readItem(opts: PlmOptions, name: string, itemOf: typeof ItemOf): Promise<IngestItem> {
  const r = await readChangeRequest(opts, name);
  // The approver is stamped on the ECO as its releaser once the PLM has made one; until then the ECR's last editor is the one
  // who decided it (the release automation only touches the ECR to link the ECO, and by then the ECO names the approver).
  const decided = DECISIONS[r.record.workflowState];
  const decidedBy = r.record.ecoReleasedBy ?? r.record.modifiedBy;
  const decision = decided && decidedBy ? { decision: decided, decidedBy, decidedOn: r.record.dates.decidedOn ?? r.record.dates.modified } : undefined;
  // The PLM's own title and text, as filed; the change request carries the structure the checks read.
  return { ...itemOf(r.change as Record<string, any>, r.modified), title: r.record.title || name, description: r.record.text.description, ...(decision ? { decision } : {}) };
}

/** The module took the decision but did not act on it (checks not done, baseline moved, the ECR edited in the PLM, ...): it is tried again until it does. */
export class DecisionNotFollowed extends Error {}

/** Whether Norn acted on the decision the PLM took: an approval releases the ECR (merged), a rejection closes it. */
export type Followed = (plmEcrNumber: string, decision: PlmDecisionItem['decision']) => Promise<boolean>;

/**
 * `Followed` from what Norn's ECR table says: an approval is followed once the ECR is merged (released), a rejection once it is
 * closed. The table is a subscription, so the new status can land a moment after the reducer returns; wait briefly for it.
 */
export const followedFrom = (statusOf: (plmEcrNumber: string) => string | undefined, waitMs = 1000, stepMs = 50): Followed => async (plm, decision) => {
  const want = decision === 'approved' ? 'merged' : 'closed';
  for (let waited = 0; ; waited += stepMs) {
    if (statusOf(plm) === want) return true;
    if (waited >= waitMs) return false;
    await new Promise(r => setTimeout(r, stepMs));
  }
};

/**
 * The PLM has decided the ECR: tell Norn who decided what. The module follows the decision only when it can (and says why when
 * it cannot, in the ECR's log), so a call that returns is not proof: `followed` reads what Norn did. The decision is remembered as
 * delivered only once it is followed. Until then this throws `DecisionNotFollowed`, so the caller's retry sends it again with
 * a fresh read of the ECR (the checks may have finished, or the baseline been re-checked, since). Like `recordEcoOnly`, this is
 * deliberately not `ingestOnce`: a decided ECR gets no new revision, re-check or agent.
 */
export async function recordDecision(R: Pick<Client['R'], 'recordPlmDecision'>, item: IngestItem, sent: Map<string, string>, log: (m: string) => void, followed?: Followed): Promise<void> {
  const d = item.decision;
  if (!d) return;
  const key = `decision:${item.plmEcrNumber}`;
  if (sent.get(key) === d.decision) return;
  try {
    await withRetry(
      () => R.recordPlmDecision({ plmEcrNumber: item.plmEcrNumber, decision: d.decision, decidedBy: d.decidedBy, decidedOn: d.decidedOn, title: item.title, description: item.description, changeRequestJson: JSON.stringify(item.changeRequest), source: 'plm', sourceRef: item.sourceRef }),
      { idempotent: true, label: `record_plm_decision ${item.plmEcrNumber}` }
    );
  } catch (e) {
    const c = classify(e);
    if (c.name === 'SenderError') sent.set(key, d.decision); // refused for good (an ECR Norn never opened): not retried every poll
    log(`could not record ${item.plmEcrNumber}'s ${d.decision} decision: ${c.name}: ${c.message}`);
    if (c.name !== 'SenderError') throw e; // transient: the retry offers it again
    return;
  }
  if (followed && !(await followed(item.plmEcrNumber, d.decision))) {
    const note = `${item.plmEcrNumber} ${d.decision} in the PLM by ${d.decidedBy}, but Norn has not followed it (the reason is in the ECR's log)`;
    if (!unfollowedLogged.has(key)) log(note);
    unfollowedLogged.add(key);
    throw new DecisionNotFollowed(note);
  }
  unfollowedLogged.delete(key);
  sent.set(key, d.decision);
  log(`${item.plmEcrNumber} ${d.decision} in the PLM by ${d.decidedBy}, reported to Norn and followed`);
}
const unfollowedLogged = new Set<string>();

/** A decided ECR: its decision, then the ECO it released (an ECR the PLM rejected has none). The ECO is recorded even while the decision is not followed yet. */
export async function recordDecided(R: Pick<Client['R'], 'recordPlmDecision' | 'recordEcoRelease'>, item: IngestItem, sent: Map<string, string>, log: (m: string) => void, followed?: Followed): Promise<void> {
  let pending: unknown;
  try {
    await recordDecision(R, item, sent, log, followed);
  } catch (e) {
    if (!(e instanceof DecisionNotFollowed)) throw e;
    pending = e;
  }
  await recordEcoOnly(R, item, sent, log);
  if (pending) throw pending;
}

/**
 * Where a freshly read ECR goes, whichever path read it (start-up, retry, watcher): by the state of that read, never the state it
 * was listed in. A decided ECR is only recorded, so it can never get a revision, a re-check or an agent; any other is reported.
 */
export const routed = (d: { report: (item: IngestItem) => Promise<void>; recordEco: (item: IngestItem) => Promise<void> }) => (item: IngestItem) => (item.decision ? d.recordEco(item) : d.report(item));

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

/**
 * At start-up, the decided ECRs: a decision the PLM took, or an ECO it linked, while this process was down is never delivered by
 * the watcher, which starts from the newest stamp. Each is only recorded (`recordEco`, as `recordDecided`), never ingested, and
 * an ECR Norn never opened is refused by the module and skipped. One failure does not stop the others.
 */
export async function recoverEcos(names: string[], read: (name: string) => Promise<IngestItem>, recordEco: (item: IngestItem) => Promise<void>, lock: EcrLock, log: (m: string) => void): Promise<string[]> {
  const failed: string[] = [];
  for (const name of names) {
    try {
      await lock(name, async () => {
        const item = await read(name);
        if (item.eco || item.decision) await recordEco(item);
      });
    } catch (e) {
      failed.push(name);
      log(`could not check ${name}'s change order: ${(e as Error).message}; trying again`);
    }
  }
  // The watcher will not offer these again (their stamps are older than its floor), so the caller retries them.
  return failed;
}

/** What the watcher does with one changed ECR: a decided one only records its decision and ECO release, any other is reported to ingest_ecr. */
export async function onChange(
  o: PlmIngestOptions,
  change: Pick<EcrListing, 'name' | 'workflowState'>,
  d: { read: (name: string) => Promise<IngestItem>; report: (item: IngestItem) => Promise<void>; recordEco: (item: IngestItem) => Promise<void>; lock: EcrLock; retry: RetryQueue; now?: () => number; log?: (m: string) => void }
): Promise<void> {
  if (!wanted(o, change)) return;
  await d.lock(change.name, async () => {
    try {
      const item = await d.read(change.name);
      // Routed by what was just read: the listing's state may be older (an ECR approved between the listing and the read).
      await routed(d)(item);
    } catch (e) {
      // A mapping error is the ECR's own fault: the watcher delivers it again when someone fixes it. Anything else (the PLM or Norn
      // unreachable, a failed report, a decision Norn has not followed yet) goes to the retry queue, with a fresh read and a
      // growing wait, rather than to the watcher: the watcher gives up on a delivery after a few failures and never offers
      // an unchanged ECR again, which would lose the decision for good.
      if (!isTransient(e)) throw e;
      const n = d.retry.fail(change.name, (d.now ?? Date.now)());
      d.log?.(`${change.name}: not taken in yet (attempt ${n}), will retry: ${(e as Error).message}`);
      return;
    }
    d.retry.done(change.name); // delivered fresh by the watcher: nothing left to retry
  });
}

/** Run until the process ends. */
export async function runPlmIngest(R: Client['R'], log: (m: string) => void, deps: { ingestOnce: typeof IngestOnce; itemOf: typeof ItemOf; followed?: Followed }, o = plmIngestOptionsFromEnv()): Promise<void> {
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
  const recordEco = (item: IngestItem) => recordDecided(R, item, sent, log, deps.followed);
  const deliver = routed({ report, recordEco });
  await takeIn(take.map(e => e.name), read, deliver, log, retry, Date.now, lock);
  // The decided ECRs: a decision the PLM took, or an ECO it linked, while this process was down is never delivered by the
  // watcher, which starts from the newest stamp. Those that fail, or that Norn has not followed yet, join the retry queue,
  // which sends them again with a fresh read and a growing wait.
  const decided = all.filter(e => wanted(o, e) && !startupWanted(o, e)).map(e => e.name);
  for (const name of await recoverEcos(decided, read, recordEco, lock, log)) retry.fail(name, Date.now());
  let retrying = false;
  setInterval(() => {
    if (retrying || retry.names.length === 0) return;
    retrying = true;
    retryDue(retry, read, deliver, log, Date.now, lock).catch(e => log(`PLM retry: ${(e as Error).message}`)).finally(() => (retrying = false));
  }, o.intervalMs);

  const watcher = watchEcrs(
    opts,
    async change => {
      await onChange(o, change, { read, report, recordEco, lock, retry, log });
    },
    { intervalMs: o.intervalMs, since: mark, stateFile: o.stateFile, onError: e => log(`PLM watch: ${(e as Error).message}`) }
  );
  await watcher.ready();
  log(`watching the PLM every ${o.intervalMs} ms from ${watcher.highWater()}`);
  await new Promise<never>(() => {}); // the watcher's timer keeps the process alive
}
