// The server's side of SpacetimeDB.
//
// * One read-only mirror connection, subscribed to the tables the read tools answer from.
// * One write connection per verified actor, each with its own SpacetimeDB identity, kept in a
//   file under the state directory so a restart keeps it. The identity is registered as a Norn
//   principal (register_actor) and given the scope its token names (grant_scope), so the module's
//   policy gate, not this process, decides what that actor may write.
//
// A refused write returns normally from a reducer (the refusal is a row in action_log), so every
// write waits for its own log row, found by request id, and reports the outcome from there.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection, type ErrorContext } from '@norn/bindings';
import type { ActionLog, PullRequest } from '@norn/bindings/types';
import { DisconnectedError, InternalError, SenderError, Timestamp, UnknownCallResultError, type Identity } from 'spacetimedb';
import { securePrivateDir } from './fsutil.ts';
import type { Claims } from './token.ts';

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const CALL_TIMEOUT_MS = 20_000;

export interface NornOptions {
  uri: string;
  database: string;
  /** Where actor identities are kept (untracked). */
  stateDir: string;
  log?: (message: string) => void;
}

/** Thrown when a credential cannot be turned into a working actor (HTTP 403/409 at the edge). */
export class ActorError extends Error {
  constructor(
    readonly status: 403 | 409 | 503,
    message: string
  ) {
    super(message);
    this.name = 'ActorError';
  }
}

const MIRROR_QUERIES = [
  'SELECT * FROM pull_request',
  'SELECT * FROM part',
  'SELECT * FROM assumption',
  'SELECT * FROM check_run',
  'SELECT * FROM check_result',
  'SELECT * FROM comment',
  'SELECT * FROM action_log',
  'SELECT * FROM principal',
  'SELECT * FROM impact_statement',
  'SELECT * FROM main_version',
  'SELECT * FROM norn_config',
  'SELECT * FROM approval',
  'SELECT * FROM recommendation',
];

type Reducers = Record<string, (args: Record<string, unknown>) => Promise<void>>;

/** A verified actor's own connection to the database. */
export class ActorHandle {
  grant?: { sig: string; until: number };
  registeredFor?: { onBehalfOf: string | null };
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    readonly conn: DbConnection,
    readonly identity: Identity,
    readonly name: string
  ) {}
  /** Runs `fn` after anything already queued for this actor, so a grant is never raced by a second request. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export type CallResult = { requestId: string; error?: { kind: 'rejected' | 'unknown_result' | 'disconnected' | 'internal'; message: string }; row?: ActionLog };

export function describeError(e: unknown): NonNullable<CallResult['error']> {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof SenderError) return { kind: 'rejected', message };
  if (e instanceof UnknownCallResultError) return { kind: 'unknown_result', message };
  if (e instanceof DisconnectedError) return { kind: 'disconnected', message };
  if (e instanceof InternalError) return { kind: 'internal', message };
  return { kind: 'internal', message };
}

let counter = 0;
/** A request id that matches a call to its action_log row. At most 64 characters (the module's limit). */
export function newRequestId(jobId: string): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${jobId.slice(0, 30)}-${counter}-${rand}`;
}

function tokenFile(stateDir: string, label: string): string {
  const safe = label.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48);
  const hash = createHash('sha256').update(label).digest('hex').slice(0, 8);
  return join(stateDir, 'identities', `${safe}-${hash}.token`);
}

function connectWithFile(uri: string, database: string, file: string, onDisconnect: (e?: Error) => void): Promise<{ conn: DbConnection; identity: Identity }> {
  mkdirSync(join(file, '..'), { recursive: true });
  const saved = existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withToken(saved)
      .withAutomaticReconnect()
      .onConnect((conn, identity, token) => {
        if (token !== saved) {
          writeFileSync(file, token, { mode: 0o600 });
          try {
            chmodSync(file, 0o600);
          } catch {}
        }
        resolve({ conn, identity });
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => reject(new Error(connectErrorText(err, uri, database))))
      .onDisconnect((_ctx: ErrorContext, err?: Error) => onDisconnect(err))
      .build();
  });
}

/** Why a connection failed, in words. The SDK's error can be empty; the address and database are not secret. */
export function connectErrorText(err: unknown, uri: string, database: string): string {
  const raw = err instanceof Error ? [err.name !== 'Error' ? err.name : '', err.message].filter(Boolean).join(': ') : String(err ?? '');
  const reason = raw && raw !== '[object Object]' && raw !== '[object Event]' ? raw : 'no reason given';
  return `${reason} (database '${database}' at ${uri}; is SpacetimeDB running and the module published?)`;
}

/**
 * The highest impact-statement level a credential may post, from its role and origin. A job whose
 * role is `level<N>-...` may post up to Level N; any other job role posts none (it can still
 * comment and propose assumptions). A person's own agent is an outside agent: never Level 3,
 * which is Norn's final verdict.
 */
export function maxLevelFor(claims: Pick<Claims, 'kind' | 'role'>): number {
  if (claims.kind === 'person_agent') return 2;
  const m = /^level([1-3])-/.exec(claims.role);
  return m ? Number(m[1]) : 0;
}

export class Norn {
  private actors = new Map<string, Promise<ActorHandle>>();
  private constructor(
    readonly mirror: DbConnection,
    readonly opts: NornOptions
  ) {}

  static async open(opts: NornOptions): Promise<Norn> {
    const log = opts.log ?? (() => {});
    try {
      securePrivateDir(opts.stateDir);
    } catch (e) {
      log(`could not restrict ${opts.stateDir} to the current user: ${e instanceof Error ? e.message : String(e)}`);
    }
    const { conn } = await connectWithFile(opts.uri, opts.database, tokenFile(opts.stateDir, 'mirror'), e => log(`mirror disconnected${e ? `: ${e.message}` : ''}`));
    await new Promise<void>((resolve, reject) => {
      conn
        .subscriptionBuilder()
        .onApplied(() => resolve())
        .onError((ctx: ErrorContext) => reject(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`)))
        .subscribe(MIRROR_QUERIES);
    });
    return new Norn(conn, opts);
  }

  close() {
    this.mirror.disconnect();
    for (const p of this.actors.values()) p.then(h => h.conn.disconnect(), () => {});
  }

  // ---- reading --------------------------------------------------------------------------------

  get db() {
    return this.mirror.db;
  }

  /** Finds an ECR by PLM number (any case), or by a unique tail such as `ECR-0417` or `0417`. */
  findEcr(ref: string): { pr?: PullRequest; known: string[] } {
    const all = [...this.db.pullRequest.iter()];
    const known = all.map(p => p.plmEcrNumber).sort();
    const want = ref.trim().toLowerCase();
    if (!want) return { known };
    const exact = all.filter(p => p.plmEcrNumber.toLowerCase() === want);
    if (exact.length === 1) return { pr: exact[0], known };
    const tail = all.filter(p => p.plmEcrNumber.toLowerCase().endsWith(`-${want}`) || p.plmEcrNumber.toLowerCase().endsWith(want));
    return { pr: tail.length === 1 ? tail[0] : undefined, known };
  }

  nameOf(identity: Identity): { name: string; onBehalfOf: string | null; origin: string } {
    const p = this.db.principal.identity.find(identity);
    if (p) return { name: p.name, onBehalfOf: p.onBehalfOf ?? null, origin: p.origin };
    return { name: `unregistered:${identity.toHexString().slice(0, 8)}`, onBehalfOf: null, origin: 'unknown' };
  }

  // ---- writing --------------------------------------------------------------------------------

  /** The action_log row for a request id (the one `reducer` wrote, else the first), waiting for it to arrive. */
  async outcome(requestId: string, reducer: string, timeoutMs = 6000): Promise<ActionLog | undefined> {
    const t0 = Date.now();
    for (;;) {
      const rows = [...this.db.actionLog.requestId.filter(requestId)].sort((a, b) => Number(a.id - b.id));
      const row = rows.find(r => r.reducer === reducer) ?? rows[0];
      if (row) return row;
      if (Date.now() - t0 > timeoutMs) return undefined;
      await sleep(15);
    }
  }

  /** Call a write reducer as `actor`, stamped with the claims' spawnedBy, and find what the gate did. */
  async call(actor: ActorHandle, claims: Pick<Claims, 'jobId' | 'spawnedBy'>, reducer: string, args: Record<string, unknown>): Promise<CallResult> {
    const requestId = newRequestId(claims.jobId);
    const fn = (actor.conn.reducers as unknown as Reducers)[reducer];
    if (!fn) throw new Error(`no reducer '${reducer}' in the bindings`);
    let timer: NodeJS.Timeout | undefined;
    try {
      // A hung database must not hang the agent's tool call for ever.
      await Promise.race([
        fn.call(actor.conn.reducers, { ...args, meta: { requestId, spawnedBy: claims.spawnedBy } }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new UnknownCallResultError()), CALL_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      return { requestId, error: describeError(e) };
    } finally {
      clearTimeout(timer);
    }
    return { requestId, row: await this.outcome(requestId, snake(reducer)) };
  }

  // ---- actors ---------------------------------------------------------------------------------

  /**
   * The verified actor's connection, registered as a Norn principal and holding the scope the
   * token names. Cached by kind and actor name. Throws ActorError when it cannot be set up.
   */
  async actorFor(claims: Claims): Promise<ActorHandle> {
    const key = `${claims.kind}|${claims.actor}`;
    let p = this.actors.get(key);
    if (!p) {
      p = connectWithFile(this.opts.uri, this.opts.database, tokenFile(this.opts.stateDir, key), e =>
        this.opts.log?.(`${claims.actor} disconnected${e ? `: ${e.message}` : ''}`)
      ).then(({ conn, identity }) => new ActorHandle(conn, identity, claims.actor));
      this.actors.set(key, p);
      p.catch(() => this.actors.delete(key));
    }
    let h: ActorHandle;
    try {
      h = await p;
    } catch (e) {
      throw new ActorError(503, `could not connect to Norn's database: ${e instanceof Error ? e.message : connectErrorText(e, this.opts.uri, this.opts.database)}`);
    }
    await h.exclusive(async () => {
      await this.register(h, claims);
      await this.grant(h, claims);
    });
    return h;
  }

  private async register(h: ActorHandle, claims: Claims) {
    if (h.registeredFor && h.registeredFor.onBehalfOf === claims.onBehalfOf) return;
    const r = await this.call(h, claims, 'registerActor', {
      kind: 'agent',
      name: claims.actor,
      origin: claims.kind === 'job' ? 'norn' : 'external',
      onBehalfOf: claims.onBehalfOf ?? undefined,
    });
    if (r.error || r.row?.outcome !== 'applied')
      throw new ActorError(409, `could not register ${claims.actor} in Norn: ${r.error?.message ?? r.row?.policy.replace(/^deny: /, '') ?? 'no confirmation from the database'}`);
    h.registeredFor = { onBehalfOf: claims.onBehalfOf };
  }

  private async grant(h: ActorHandle, claims: Claims) {
    const anyEcr = claims.ecrs.includes('*');
    const prIds: bigint[] = [];
    if (!anyEcr) {
      for (const ref of claims.ecrs) {
        const { pr, known } = this.findEcr(ref);
        if (!pr || pr.plmEcrNumber.toLowerCase() !== ref.toLowerCase())
          throw new ActorError(403, `the token names ECR '${ref}', which Norn does not have (tokens carry the full PLM number; Norn has: ${known.join(', ') || 'none'})`);
        prIds.push(pr.id);
      }
    }
    // The module accepts a grant for at most 24 hours; a longer-lived credential is re-granted as it runs down.
    const until = Math.min(claims.exp * 1000, Date.now() + 12 * 3600_000);
    const maxLevel = maxLevelFor(claims);
    const sig = JSON.stringify([claims.jobId, anyEcr, prIds.map(String).sort(), maxLevel]);
    if (h.grant && h.grant.sig === sig && (h.grant.until >= claims.exp * 1000 || h.grant.until - Date.now() > 30 * 60_000)) return;
    const r = await this.call(h, claims, 'grantScope', { jobId: claims.jobId, anyEcr, prIds, maxLevel, expiresAt: Timestamp.fromDate(new Date(until)) });
    if (r.error) throw new ActorError(409, `Norn did not accept the job's scope: ${r.error.message}`);
    if (r.row?.outcome !== 'applied') throw new ActorError(409, `Norn did not accept the job's scope: ${r.row ? r.row.policy.replace(/^deny: /, '') : 'no confirmation from the database'}`);
    h.grant = { sig, until };
  }
}

/** `addComment` -> `add_comment`: the name the module logs. */
export function snake(reducer: string): string {
  return reducer.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
