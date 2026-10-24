// A poller for change requests: the demo path. The PLM may run where Norn's webhook receiver cannot be
// reached, so Norn asks every couple of seconds what changed.
//
// It keeps a high-water mark, the newest `modified` stamp it has delivered, and asks only for what is
// newer. It reads the PLM's own stamps, never the local clock, so clock drift between the machines does
// not matter. A change made by Norn's own login is skipped (Norn does not need to hear about its own
// impact assessment), but the mark still moves past it.
//
// Delivery is at least once: if `onChange` throws, the change is offered again on the next pass, up to
// `maxAttempts` times, and then given up on so that it cannot hold back the ones after it. Each
// pass also looks a few seconds behind the mark, because a change saved just before another can commit
// just after it; changes it has already delivered are remembered and not delivered twice.
//
// Known gap: if a person edits a request and Norn writes its impact assessment before the next pass,
// the pass sees only Norn's later stamp and skips the person's edit. Norn writes seconds after it reads,
// so this needs a person to edit within that window; the webhook path does not have the gap.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DOCTYPE } from './schema.ts';
import { PlmClient } from './client.ts';
import { listEcrs } from './read.ts';
import type { EcrListing } from './read.ts';
import type { PlmOptions } from './options.ts';

export interface WatchOptions {
  /** Time between passes. Default 2000 ms. */
  intervalMs?: number;
  /**
   * Deliver only changes newer than this `modified` stamp (the `highWater()` of an earlier run). Default:
   * the newest change in the PLM now, so only what happens from here on is delivered. To replay everything,
   * pass '1970-01-01 00:00:00'.
   */
  since?: string;
  /** A file that holds the high-water mark between runs. Read at start (when `since` is not given) and rewritten as it moves. */
  stateFile?: string;
  /** How far behind the mark each pass looks, for changes that committed late. Default 5000 ms. */
  overlapMs?: number;
  /** Deliveries of one change tried before it is given up on, so one bad request cannot stall the rest. Default 3. */
  maxAttempts?: number;
  /** Called with a failed pass or a failed `onChange`. Default: a one-line message on stderr. */
  onError?: (err: unknown) => void;
}

export type EcrChangeHandler = (change: EcrListing) => void | Promise<void>;

const STAMP = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?$/;

/** A PLM stamp moved back by `ms`, in the same format. */
export function shiftStamp(stamp: string, ms: number): string {
  const m = STAMP.exec(stamp);
  if (!m) throw new Error(`not a PLM timestamp: ${stamp}`);
  const micro = Number((m[7] ?? '').padEnd(6, '0'));
  const total = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) * 1000 + micro - ms * 1000;
  const d = new Date(Math.floor(total / 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(((total % 1_000_000) + 1_000_000) % 1_000_000, 6)}`;
}

export class EcrWatcher {
  #opts: PlmOptions;
  #onChange: EcrChangeHandler;
  #interval: number;
  #overlap: number;
  #stateFile?: string;
  #onError: (err: unknown) => void;
  #since?: string;
  #floor?: string;
  #mark?: string;
  #seen = new Map<string, string>();
  #failures = new Map<string, number>();
  #maxAttempts: number;
  #timer?: ReturnType<typeof setTimeout>;
  #running = false;
  #pass?: Promise<void>;
  #ready?: Promise<void>;

  constructor(opts: PlmOptions, onChange: EcrChangeHandler, w: WatchOptions = {}) {
    this.#interval = w.intervalMs ?? 2000;
    // A request that hangs (a dropped tunnel) should cost a few passes, not half a minute.
    this.#opts = { ...opts, timeoutMs: opts.timeoutMs ?? Math.max(5000, this.#interval * 3) };
    this.#onChange = onChange;
    this.#overlap = w.overlapMs ?? 5000;
    this.#maxAttempts = w.maxAttempts ?? 3;
    this.#stateFile = w.stateFile;
    this.#onError = w.onError ?? ((e) => console.error(`watchEcrs: ${e instanceof Error ? e.message : String(e)}`));
    this.#since = w.since ?? (w.stateFile && existsSync(w.stateFile) ? readFileSync(w.stateFile, 'utf8').trim() || undefined : undefined);
  }

  /** The newest `modified` stamp delivered or skipped so far. Keep it to resume after a restart. */
  highWater(): string | undefined {
    return this.#mark;
  }

  /** Fix the starting mark: the given one, else the newest change in the PLM now. */
  #init(): Promise<void> {
    this.#ready ??= (async () => {
      if (this.#since !== undefined) {
        this.#floor = this.#mark = this.#since;
        return;
      }
      const newest = await new PlmClient(this.#opts).list(DOCTYPE.ecr, { fields: ['modified'], orderBy: 'modified desc', limit: 1 });
      this.#floor = this.#mark = newest[0] ? String(newest[0].modified) : '1970-01-01 00:00:00';
      this.#save();
    })();
    this.#ready.catch(() => { this.#ready = undefined; });
    return this.#ready;
  }

  #save() {
    if (this.#stateFile && this.#mark) writeFileSync(this.#stateFile, this.#mark + '\n');
  }

  /** One pass: ask for what changed, deliver it oldest first. Returns the changes delivered. */
  async tick(): Promise<EcrListing[]> {
    await this.#init();
    const floor = this.#floor!;
    const back = shiftStamp(this.#mark!, this.#overlap);
    const rows = await listEcrs(this.#opts, { since: back > floor ? back : floor });
    const delivered: EcrListing[] = [];
    for (const row of rows) {
      const key = `${row.name}|${row.modified}`;
      if (!this.#seen.has(key)) {
        if (row.modifiedBy !== this.#opts.nornUser) {
          try {
            await this.#onChange(row);
            delivered.push(row);
          } catch (e) {
            this.#onError(e);
            const tries = (this.#failures.get(key) ?? 0) + 1;
            this.#failures.set(key, tries);
            if (tries < this.#maxAttempts) break; // not remembered and the mark stays behind it: offered again next pass
            this.#onError(new Error(`giving up on ${row.name} (modified ${row.modified}) after ${tries} failed deliveries`));
          }
          this.#failures.delete(key);
        }
        this.#seen.set(key, row.modified);
      }
      if (row.modified > this.#mark!) this.#mark = row.modified;
    }
    // Forget what is older than the look-back, which no later pass will ask for.
    const horizon = shiftStamp(this.#mark!, this.#overlap * 2);
    for (const [k, m] of this.#seen) if (m < horizon) this.#seen.delete(k);
    this.#save();
    return delivered;
  }

  /** Start passes every `intervalMs`. The first begins at once. Passes never overlap. */
  start(): this {
    if (this.#running) return this;
    this.#running = true;
    const loop = async () => {
      if (!this.#running) return;
      const began = Date.now();
      this.#pass = this.tick().then(() => undefined, (e) => this.#onError(e));
      await this.#pass;
      // A fixed rate: the next pass starts one interval after this one began, not after it ended.
      if (this.#running) this.#timer = setTimeout(loop, Math.max(0, this.#interval - (Date.now() - began)));
    };
    void loop();
    return this;
  }

  /** Resolves once the starting mark is fixed: changes made after this are delivered. */
  ready(): Promise<void> {
    return this.#init();
  }

  /** Stop after the pass in flight finishes. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#pass;
  }
}

/**
 * Watch the change requests: `onChange` is called for each one that someone other than Norn created or
 * changed, oldest first. Returns the running watcher; `await w.ready()` to know the starting mark is set,
 * `w.highWater()` for the mark to keep, `await w.stop()` to end it.
 */
export function watchEcrs(opts: PlmOptions, onChange: EcrChangeHandler, w: WatchOptions = {}): EcrWatcher {
  return new EcrWatcher(opts, onChange, w).start();
}
