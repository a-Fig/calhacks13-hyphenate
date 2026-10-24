// Norn's ingest loop (#40): asks a change-request source for the ECRs it has and reports each one to
// Norn through ingest_ecr, which opens the ECR or records its new revision and re-checks it in one
// transaction. Reporting the same ECR twice changes nothing, so the loop simply repeats.
//   NORN_INGEST_SOURCE=stub NORN_STUB_ECR_DIR=<dir> npm run ingest   (from norn/; each <dir>/*.json is one change request)
//   NORN_INGEST_SOURCE=plm npm run ingest                            (the PLM connector: lists once, then watches; level1/ingest-plm.ts)
// NORN_INGEST_POLL_MS sets the interval (default 5000).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classify, connect, withRetry, type Client } from './connect.ts';
import { sleep } from './sim.ts';

export type IngestItem = {
  plmEcrNumber: string;
  title: string;
  description: string;
  changeRequest: object;
  sourceRef: string;
  /** The change order the PLM released for the ECR, once it has (#72). */
  eco?: string;
};
export type IngestSource = { name: string; list: () => Promise<IngestItem[]> };

/** JSON with object keys sorted, so the same content always gives the same text and digest. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * A change request as the checks read it, with the title and text the ECR shows. An `eco` field is the
 * released change order's number: it is kept out of the change request, so releasing changes nothing
 * the checks read.
 */
export function itemOf(json: Record<string, any>, sourceRef: string): IngestItem {
  const { eco, ...cr } = json;
  if (typeof cr.id !== 'string' || !cr.id) throw new Error('a change request needs its ECR number in `id`');
  if (eco !== undefined && (typeof eco !== 'string' || !eco)) throw new Error(`${cr.id}: \`eco\` must be the change order number`);
  return { plmEcrNumber: cr.id, title: String(cr.title ?? cr.id), description: String(cr.description ?? ''), changeRequest: cr, sourceRef, ...(eco ? { eco } : {}) };
}

/** A directory of change-request JSON files: a test feed, labelled 'stub' everywhere it lands. */
export function stubSource(dir: string): IngestSource {
  const root = resolve(dir);
  return {
    name: 'stub',
    list: async () =>
      readdirSync(root)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => {
          const file = join(root, f);
          return itemOf(JSON.parse(readFileSync(file, 'utf8')), `${f}@${statSync(file).mtime.toISOString()}`);
        }),
  };
}

/** Report every ECR the source has. `sent` remembers what was last reported, to skip repeats. */
export async function ingestOnce(R: Client['R'], source: IngestSource, sent: Map<string, string>, log: (m: string) => void) {
  const out = { reported: 0, unchanged: 0, failed: 0 };
  for (const it of await source.list()) {
    // As the source gives it, so the stored change request reads as the PLM sent it. The digest only
    // has to be stable for the same source output, which a deterministic connector gives.
    const changeRequestJson = JSON.stringify(it.changeRequest);
    const key = canonicalJson([it.title, it.description, changeRequestJson]);
    if (sent.get(it.plmEcrNumber) === key) {
      out.unchanged++;
    } else try {
      await withRetry(
        () => R.ingestEcr({ plmEcrNumber: it.plmEcrNumber, title: it.title, description: it.description, changeRequestJson, source: source.name, sourceRef: it.sourceRef }),
        { idempotent: true, label: `ingest_ecr ${it.plmEcrNumber}` }
      );
      sent.set(it.plmEcrNumber, key);
      out.reported++;
      log(`reported ${it.plmEcrNumber} (${source.name}, ${it.sourceRef})`);
    } catch (e) {
      const c = classify(e);
      out.failed++;
      // Refused for good (closed ECR, malformed change request): remember it, so it is not retried every poll.
      if (c.name === 'SenderError') sent.set(it.plmEcrNumber, key);
      log(`could not report ${it.plmEcrNumber}: ${c.name}: ${c.message}`);
    }
    // The PLM has released the ECO: record its number, once.
    if (it.eco && sent.get(`eco:${it.plmEcrNumber}`) !== it.eco) {
      try {
        await withRetry(() => R.recordEcoRelease({ plmEcrNumber: it.plmEcrNumber, ecoNumber: it.eco!, source: source.name, sourceRef: it.sourceRef }), { idempotent: true, label: `record_eco_release ${it.plmEcrNumber}` });
        sent.set(`eco:${it.plmEcrNumber}`, it.eco);
        log(`${it.plmEcrNumber} released as ${it.eco} (${source.name})`);
      } catch (e) {
        const c = classify(e);
        out.failed++;
        if (c.name === 'SenderError') sent.set(`eco:${it.plmEcrNumber}`, it.eco);
        log(`could not record ${it.plmEcrNumber}'s change order ${it.eco}: ${c.name}: ${c.message}`);
      }
    }
  }
  return out;
}

export function sourceFromEnv(env: NodeJS.ProcessEnv = process.env): IngestSource {
  const kind = env.NORN_INGEST_SOURCE ?? 'plm';
  if (kind === 'stub') {
    if (!env.NORN_STUB_ECR_DIR) throw new Error('NORN_INGEST_SOURCE=stub needs NORN_STUB_ECR_DIR');
    return stubSource(env.NORN_STUB_ECR_DIR);
  }
  // The PLM is watched, not listed on every poll: runPlmIngest (level1/ingest-plm.ts) runs it, below.
  if (kind === 'plm') throw new Error('NORN_INGEST_SOURCE=plm is a watcher rather than a list; the main below hands it to runPlmIngest');
  throw new Error(`unknown NORN_INGEST_SOURCE '${kind}' (expected plm or stub)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const name = process.env.WORKER_NAME ?? 'ingest';
  const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${name}] ${m}`);
  const { R } = await connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' });
  if ((process.env.NORN_INGEST_SOURCE ?? 'plm') === 'plm') {
    const { runPlmIngest } = await import('./level1/ingest-plm.ts');
    await runPlmIngest(R, log, { ingestOnce, itemOf }); // never returns
  }
  const source = sourceFromEnv();
  const pollMs = Number(process.env.NORN_INGEST_POLL_MS ?? 5000);
  log(`ingesting from ${source.name}${source.name === 'stub' ? ' (a test feed, not the PLM)' : ''}, every ${pollMs} ms`);
  const sent = new Map<string, string>();
  for (;;) {
    try {
      const r = await ingestOnce(R, source, sent, log);
      if (r.reported || r.failed) log(`poll: ${r.reported} reported, ${r.unchanged} unchanged, ${r.failed} failed`);
    } catch (e) {
      log(`poll failed: ${(e as Error).message}`);
    }
    await sleep(pollMs);
  }
}
