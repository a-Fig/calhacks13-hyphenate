// Shared client plumbing for workers and scripts: connect, keep an identity, say who we are
// (register_actor), and classify reducer errors so callers can decide what is safe to retry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DbConnection,
  type ErrorContext,
} from '@norn/bindings';
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
  spawnedBy: string;
};

export type Client = {
  conn: DbConnection;
  identity: Identity;
  who: Who;
  close: () => void;
};

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.tokens');

function tokenPath(name: string) {
  return join(TOKEN_DIR, `${name.replace(/[^a-z0-9_-]/gi, '_')}.token`);
}

/** Connect, subscribe to nothing, and register who we are. Reuses a saved token per name. */
export async function connect(who: Who, opts: { persistToken?: boolean; quiet?: boolean } = {}): Promise<Client> {
  const persist = opts.persistToken ?? true;
  const file = tokenPath(who.name);
  const token = persist && existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;

  const client = await new Promise<Client>((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((conn, identity, newToken) => {
        if (persist) {
          mkdirSync(TOKEN_DIR, { recursive: true });
          writeFileSync(file, newToken, { mode: 0o600 });
        }
        resolve({ conn, identity, who, close: () => conn.disconnect() });
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => reject(err))
      .onDisconnect((_ctx: ErrorContext, err?: Error) => {
        if (!opts.quiet) console.warn(`[${who.name}] disconnected${err ? `: ${err.message}` : ''}`);
      })
      .build();
  });

  await client.conn.reducers.registerActor({
    kind: who.kind,
    name: who.name,
    origin: who.origin,
    onBehalfOf: who.onBehalfOf,
    spawnedBy: who.spawnedBy,
  });
  return client;
}

/** Subscribe and resolve when the initial rows have arrived. */
export function subscribe(conn: DbConnection, queries: string[]): Promise<{ unsubscribe: () => void }> {
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

export function classify(e: unknown): { name: string; retry: Retry; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof SenderError) return { name: 'SenderError', retry: 'never', message }; // rejected on the merits
  if (e instanceof DisconnectedError) return { name: 'DisconnectedError', retry: 'after-reconnect', message }; // never sent
  if (e instanceof UnknownCallResultError) return { name: 'UnknownCallResultError', retry: 'if-idempotent', message }; // may have run
  if (e instanceof InternalError) return { name: 'InternalError', retry: 'limited', message }; // module bug or host trouble
  return { name: e instanceof Error ? e.constructor.name : typeof e, retry: 'never', message };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Call a reducer with the retry policy above. `idempotent` says a repeat of the same call is safe
 * (enqueue_check, complete_check on the same attempt, ...), which allows retrying after an
 * UnknownCallResultError.
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
