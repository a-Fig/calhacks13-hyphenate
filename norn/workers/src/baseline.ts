// Where a worker gets the production baseline, and how it keeps it. The ERP is read through Norn's
// ERPNext connector with the company's settings (NORN_ERP_SETTINGS: a module exporting `erpnext`)
// and the connection from the environment; a test can give a baseline file instead
// (NORN_BASELINE_FILE). Every read is recorded in Norn by its content hash (record_baseline), the
// check runs name the hash they compute on, and baselines are cached by hash in memory and on disk
// (norn/workers/.cache/baselines), so the JSON never has to live in the database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Baseline } from '../../checks/src/index.ts';
import { connectionFromEnv, hashOf, loadEnvFile, readBaseline, type ErpnextConnection, type ErpnextSettings } from '../../connectors/erpnext/src/index.ts';
import { FatalRunError } from './stages.ts';

export type BaselineRead = {
  baseline: Baseline;
  hash: string;
  asOf: string;
  source: 'erp' | 'file';
  counts: Record<string, number>;
  warnings: string[];
};

export type BaselineSource = {
  kind: 'erp' | 'file';
  describe: string;
  read: () => Promise<BaselineRead>;
  /** For an ERP source: the connection and the company's settings, which the change package also reads with. */
  erp?: { connection: ErpnextConnection; settings: ErpnextSettings };
};

const CACHE_DIR = process.env.NORN_BASELINE_CACHE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'baselines');

const today = () => new Date().toISOString().slice(0, 10);
const countsOf = (b: Baseline): Record<string, number> => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));

/** The baseline source the environment names, or null when it names none. */
export async function baselineSourceFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<BaselineSource | null> {
  if (env.NORN_BASELINE_FILE) {
    const file = resolve(env.NORN_BASELINE_FILE);
    return {
      kind: 'file',
      describe: `a baseline file (${file.split(/[\\/]/).pop()}), not the ERP`,
      read: async () => {
        const baseline = JSON.parse(readFileSync(file, 'utf8')) as Baseline;
        return { baseline, hash: hashOf(baseline), asOf: env.NORN_BASELINE_AS_OF ?? today(), source: 'file', counts: countsOf(baseline), warnings: [] };
      },
    };
  }
  if (env.NORN_ERP_SETTINGS) {
    const mod = await import(pathToFileURL(resolve(env.NORN_ERP_SETTINGS)).href);
    const settings = (mod.erpnext ?? mod.default) as ErpnextSettings | undefined;
    if (!settings?.company) throw new Error(`${env.NORN_ERP_SETTINGS} exports no ERPNext settings (expected \`erpnext\`)`);
    loadEnvFile();
    const connection = connectionFromEnv(env);
    return {
      kind: 'erp',
      describe: `ERPNext, company ${settings.company}`,
      erp: { connection, settings },
      read: async () => {
        const r = await readBaseline({ ...settings, ...connection });
        return { baseline: r.baseline, hash: r.hash, asOf: r.asOf, source: 'erp', counts: r.meta.counts, warnings: r.meta.warnings };
      },
    };
  }
  return null;
}

/** Baselines by content hash, read from the source when a run names one this worker has not got. */
export class BaselineStore {
  private mem = new Map<string, Baseline>();
  private inflight: Promise<BaselineRead> | null = null;

  constructor(
    readonly source: BaselineSource | null,
    /** Records a read in Norn (record_baseline). */
    private record: (r: BaselineRead) => Promise<void>,
    private dir = CACHE_DIR
  ) {}

  /** Read the source, cache the result and record it in Norn. Concurrent calls share one read. */
  refresh(log: (msg: string) => void): Promise<BaselineRead> {
    if (!this.source) return Promise.reject(new FatalRunError('no baseline source is configured (set NORN_ERP_SETTINGS, or NORN_BASELINE_FILE for a test baseline)'));
    this.inflight ??= (async () => {
      try {
        const t0 = Date.now();
        const r = await this.source!.read();
        this.put(r.hash, r.baseline);
        await this.record(r);
        log(`read the baseline from ${this.source!.describe}: ${r.hash.slice(0, 12)} as of ${r.asOf}, ${r.counts.items ?? '?'} items, ${Date.now() - t0} ms${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''}`);
        return r;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /**
   * The baseline with this hash. Returns undefined when the source now gives a different one: the
   * read has been recorded, which makes every run on the old hash stale, so the caller drops its run.
   */
  async get(hash: string, log: (msg: string) => void): Promise<Baseline | undefined> {
    const cached = this.mem.get(hash) ?? this.fromDisk(hash);
    if (cached) return cached;
    // Another worker may have it: return the run to the queue rather than failing it (worker.ts
    // does not claim such runs in the first place; see canServe).
    if (!this.source) throw new Error(`baseline ${hash.slice(0, 12)} is not cached on this worker and no baseline source is configured`);
    const r = await this.refresh(log);
    return r.hash === hash ? r.baseline : undefined;
  }

  /** Whether this worker can produce the baseline with this hash: it has a source, or the baseline is cached. */
  canProvide(hash: string | undefined): boolean {
    if (this.source) return true;
    return hash !== undefined && (this.mem.has(hash) || this.fromDisk(hash) !== undefined);
  }

  private put(hash: string, b: Baseline) {
    this.mem.set(hash, b);
    const file = join(this.dir, `${hash}.json`);
    if (existsSync(file)) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(b));
  }

  private fromDisk(hash: string): Baseline | undefined {
    const file = join(this.dir, `${hash}.json`);
    if (!existsSync(file)) return undefined;
    const b = JSON.parse(readFileSync(file, 'utf8')) as Baseline;
    if (hashOf(b) !== hash) return undefined; // a damaged cache file is not the baseline it claims to be
    this.mem.set(hash, b);
    return b;
  }
}
