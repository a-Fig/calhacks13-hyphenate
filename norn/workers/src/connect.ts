// Shared client plumbing for workers and scripts: connect, keep an identity, say who we are
// (register_actor), stamp every call with its request id and what spawned it, and classify
// reducer errors so callers can decide what is safe to retry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, type ErrorContext } from '@norn/bindings';
import {
  DisconnectedError,
  InternalError,
  SenderError,
  UnknownCallResultError,
  type Identity,
} from 'spacetimedb';

export const URI = process.env.NORN_URI ?? 'ws://127.0.0.1:3000';
export const DB = process.env.NORN_DB ?? 'norn';

export type Who = {
  kind: 'person' | 'agent';
  name: string;
  origin: 'human' | 'norn' | 'external';
  onBehalfOf?: string;
  /** What started this process; the default `meta.spawnedBy` of every call it makes. */
  spawnedBy: string;
};

/** What every write reducer takes first. Both fields are filled in when left out. */
export type MetaArg = { requestId?: string; spawnedBy?: string };

/** A reducers object whose methods fill in `meta` for the caller. */
export type WithMeta<R> = {
  [K in keyof R]: R[K] extends (p: infer P) => infer Ret ? (p: Omit<P, 'meta'> & { meta?: MetaArg }) => Ret : R[K];
};

export type Client<C extends { reducers: unknown } = DbConnection> = {
  conn: C;
  /** `conn.reducers` with `meta` filled in. Use this, not `conn.reducers`. */
  R: WithMeta<C['reducers']>;
  identity: Identity;
  who: Who;
  close: () => void;
};

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function withMeta<R extends object>(reducers: R, spawnedBy: string): WithMeta<R> {
  return new Proxy(reducers, {
    get(target, prop, receiver) {
      const f = Reflect.get(target, prop, receiver);
      if (typeof f !== 'function') return f;
      return (args: { meta?: MetaArg }) => f.call(target, { ...args, meta: { requestId: newRequestId(), spawnedBy, ...args?.meta } });
    },
  }) as WithMeta<R>;
}

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.tokens');

function tokenPath(name: string) {
  return join(TOKEN_DIR, `${name.replace(/[^a-z0-9_-]/gi, '_')}.token`);
}

type Bindings = { DbConnection: { builder(): any } };

/**
 * Connect and register who we are. Reuses a saved token per name. `bindings` swaps in another
 * module's generated bindings (the test module's, for the failure-path checks).
 */
export async function connect<C extends { reducers: any; disconnect(): void } = DbConnection>(
  who: Who,
  opts: { persistToken?: boolean; quiet?: boolean; bindings?: Bindings; database?: string } = {}
): Promise<Client<C>> {
  const persist = opts.persistToken ?? true;
  const file = tokenPath(who.name);
  const token = persist && existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
  const Conn: Bindings['DbConnection'] = opts.bindings?.DbConnection ?? DbConnection;

  const client = await new Promise<Client<C>>((resolve, reject) => {
    Conn.builder()
      .withUri(URI)
      .withDatabaseName(opts.database ?? DB)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((conn: C, identity: Identity, newToken: string) => {
        if (persist) {
          mkdirSync(TOKEN_DIR, { recursive: true });
          writeFileSync(file, newToken, { mode: 0o600 });
        }
        resolve({ conn, R: withMeta(conn.reducers, who.spawnedBy) as WithMeta<C['reducers']>, identity, who, close: () => conn.disconnect() });
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => reject(err))
      .onDisconnect((_ctx: ErrorContext, err?: Error) => {
        if (!opts.quiet) console.warn(`[${who.name}] disconnected${err ? `: ${err.message}` : ''}`);
      })
      .build();
  });

  await (client.R as any).registerActor({
    kind: who.kind,
    name: who.name,
    origin: who.origin,
    onBehalfOf: who.onBehalfOf,
  });
  return client;
}

/** Subscribe and resolve when the initial rows have arrived. */
export function subscribe(conn: { subscriptionBuilder(): any }, queries: string[]): Promise<{ unsubscribe: () => void }> {
  return new Promise((resolve, reject) => {
    const handle = conn
      .subscriptionBuilder()
      .onApplied(() => resolve({ unsubscribe: () => handle.unsubscribe() }))
      .onError((ctx: ErrorContext) => reject(new Error(`subscription failed: ${String(ctx.event ?? 'unknown')}`)))
      .subscribe(queries);
  });
}

// ---------------------------------------------------------------------------------------------
// Error classes the SDK gives us, and what each means for a retry
// ---------------------------------------------------------------------------------------------

export type Retry = 'never' | 'after-reconnect' | 'if-idempotent' | 'limited';
/** The code at the start of a SenderError message, when the module gives one. */
export type ErrorCode = 'stale' | 'lost' | 'invalid';

export function classify(e: unknown): { name: string; retry: Retry; message: string; code?: ErrorCode } {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof SenderError) {
    // rejected on the merits: retrying cannot help
    const code = /^\[(stale|lost|invalid)\]/.exec(message)?.[1] as ErrorCode | undefined;
    return { name: 'SenderError', retry: 'never', message, code };
  }
  if (e instanceof DisconnectedError) return { name: 'DisconnectedError', retry: 'after-reconnect', message }; // never sent
  if (e instanceof UnknownCallResultError) return { name: 'UnknownCallResultError', retry: 'if-idempotent', message }; // may have run
  if (e instanceof InternalError) return { name: 'InternalError', retry: 'limited', message }; // module bug or host trouble
  return { name: e instanceof Error ? e.constructor.name : typeof e, retry: 'never', message };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Call a reducer with the retry policy above. `idempotent` says a repeat of the same call is safe
 * (enqueue_check, complete_check on the same attempt, ...), which allows retrying after an
 * UnknownCallResultError. The same request id is reused across retries only if the caller passes
 * `meta.requestId` itself.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { idempotent?: boolean; tries?: number; label?: string } = {}
): Promise<T> {
  const tries = opts.tries ?? 4;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const c = classify(e);
      const retryable =
        c.retry === 'after-reconnect' || c.retry === 'limited' || (c.retry === 'if-idempotent' && opts.idempotent);
      if (!retryable || i >= tries) throw e;
      const wait = Math.min(250 * 2 ** (i - 1), 4000);
      console.warn(`[retry] ${opts.label ?? 'call'} ${c.name}: ${c.message}; attempt ${i}/${tries}, waiting ${wait} ms`);
      await sleep(wait);
    }
  }
}
