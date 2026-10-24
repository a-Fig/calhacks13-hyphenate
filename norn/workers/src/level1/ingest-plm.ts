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
import { listEcrs, readChangeRequest, watchEcrs, type EcrListing, type PlmOptions } from '../../../connectors/plm/src/index.ts';
import type { Client } from '../connect.ts';
// ingest.ts hands these in: it is the entry module, and importing it back from here would deadlock its top-level await.
import type { IngestItem, ingestOnce as IngestOnce, itemOf as ItemOf } from '../ingest.ts';
import { plmOptionsFromEnv } from './plm.ts';

export const DEFAULT_STATES = ['Submitted', 'In CM Review', 'CCB Review'];

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
  o.states.includes(e.workflowState) && (o.only.length === 0 || o.only.includes(e.name));

/** One ECR as the PLM has it now, as an ingest item. */
export async function readItem(opts: PlmOptions, name: string, itemOf: typeof ItemOf): Promise<IngestItem> {
  const r = await readChangeRequest(opts, name);
  // The PLM's own title and text, as filed; the change request carries the structure the checks read.
  return { ...itemOf(r.change as Record<string, any>, r.modified), title: r.record.title || name, description: r.record.text.description };
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
  const take = all.filter(e => wanted(o, e));
  log(`the PLM has ${all.length} ECR(s); ${take.length} to take in${o.only.length ? ` (only ${o.only.join(', ')})` : ''}: ${take.map(e => `${e.name} [${e.workflowState}]`).join(', ') || 'none'}`);
  for (const e of take) await report(await readItem(opts, e.name, deps.itemOf));

  const watcher = watchEcrs(
    opts,
    async change => {
      if (!wanted(o, change)) return;
      await report(await readItem(opts, change.name, deps.itemOf));
    },
    { intervalMs: o.intervalMs, since: mark, stateFile: o.stateFile, onError: e => log(`PLM watch: ${(e as Error).message}`) }
  );
  await watcher.ready();
  log(`watching the PLM every ${o.intervalMs} ms from ${watcher.highWater()}`);
  await new Promise<never>(() => {}); // the watcher's timer keeps the process alive
}
