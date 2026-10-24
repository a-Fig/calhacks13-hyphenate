// Connection, subscriptions and table hooks.
//
// We do not use the SDK's useTable here: it subscribes inside an effect, so on a query change
// React runs the old effect's cleanup (unsubscribe) before the new subscribe, which is the order
// the docs say to avoid. usePrSubscription() subscribes to the new ECR first and drops the old
// subscription only once the new one has been applied. Rows are read from the client cache and
// filtered by pr_id here, so rows of the previous ECR never show on the new one.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { DbConnection } from '@norn/bindings';
import { reducersFor, type WithMeta } from './rpc.ts';

export const URI: string = import.meta.env.VITE_NORN_URI ?? 'ws://127.0.0.1:3000';
export const DB: string = import.meta.env.VITE_NORN_DB ?? 'norn';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'error';

type NornState = {
  conn: DbConnection | null;
  /** conn.reducers with `meta` filled in: use this for every write. */
  R: WithMeta<DbConnection['reducers']> | null;
  status: Status;
  error: string | null;
  identityHex: string | null;
  me: string;
  globalReady: boolean;
};

const params = new URLSearchParams(window.location.search);
const defaultName = params.get('as') ?? `Reviewer-${Math.random().toString(16).slice(2, 6)}`;

const initial: NornState = {
  conn: null,
  R: null,
  status: 'connecting',
  error: null,
  identityHex: null,
  me: defaultName,
  globalReady: false,
};

const NornContext = createContext<NornState>(initial);
export const useNorn = () => useContext(NornContext);

// Test hook: the browser spike reads this to see what the page believes, without scraping the DOM.
type Debug = {
  events: { t: number; table: string; op: string }[];
  counts: Record<string, number>;
  prId: string | null;
  ready: string | null;
  [k: string]: unknown;
};
const debug: Debug = { events: [], counts: {}, prId: null, ready: null };
(window as unknown as { __norn: Debug }).__norn = debug;
export const nornDebug = debug;

export function NornProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NornState>(initial);

  useEffect(() => {
    // sessionStorage: a new tab is a new identity (two tabs can play two reviewers), a reload keeps it.
    const tokenKey = `norn.token.${DB}`;
    const conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(sessionStorage.getItem(tokenKey) ?? undefined)
      .withAutomaticReconnect()
      .onConnect(async (c, identity, token) => {
        sessionStorage.setItem(tokenKey, token);
        const identityHex = identity.toHexString();
        debug.identity = identityHex;
        // Rows per ECR in the client cache: after switching ECRs only the new one may remain.
        debug.cacheByPr = () => {
          const out: Record<string, Record<string, number>> = {};
          for (const [name, t] of Object.entries({ checkRun: c.db.checkRun, checkResult: c.db.checkResult, comment: c.db.comment, actionLog: c.db.actionLog, assumption: c.db.assumption, checkProgress: c.db.checkProgress })) {
            for (const row of (t as any).iter()) {
              const k = String(row.prId);
              ((out[k] ??= {})[name] ??= 0);
              out[k][name]++;
            }
          }
          return out;
        };
        const R = reducersFor(c);
        setState(s => ({ ...s, conn: c, R, status: 'connected', identityHex, error: null }));
        await R.registerActor({ kind: 'person', name: defaultName, origin: 'human', onBehalfOf: undefined });
        c.subscriptionBuilder()
          .onApplied(() => setState(s => ({ ...s, globalReady: true })))
          .subscribe([
            'SELECT * FROM pull_request',
            'SELECT * FROM main_version',
            'SELECT * FROM norn_config',
            'SELECT * FROM principal',
          ]);
      })
      .onAutomaticReconnect(() => setState(s => ({ ...s, status: 'connected' })))
      .onConnectError((_ctx, err) => setState(s => ({ ...s, status: 'error', error: err.message })))
      .onDisconnect((_ctx, err, nextAttempt) =>
        setState(s => ({ ...s, status: nextAttempt ? 'reconnecting' : 'error', error: err?.message ?? null }))
      )
      .build();
    return () => conn.disconnect();
  }, []);

  return <NornContext.Provider value={state}>{children}</NornContext.Provider>;
}

const TABLES = [
  'pullRequest', 'mainVersion', 'nornConfig', 'principal',
  'assumption', 'checkRun', 'checkProgress', 'checkResult', 'comment', 'actionLog',
] as const;
type TableName = (typeof TABLES)[number];

/**
 * A version number that changes when any of the named tables changes in the client cache.
 * Bumps are coalesced to one per animation frame, and SDK callbacks run after a whole
 * transaction has been applied, so a render never sees half of a transaction.
 */
export function useTableVersion(...names: TableName[]): number {
  const { conn } = useNorn();
  const key = names.join(',');
  const store = useRef<{ v: number; listeners: Set<() => void> }>({ v: 0, listeners: new Set() });

  useEffect(() => {
    if (!conn) return;
    let scheduled = false;
    const bump = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        store.current.v++;
        store.current.listeners.forEach(l => l());
      });
    };
    const off: (() => void)[] = [];
    for (const name of names) {
      const t = (conn.db as unknown as Record<string, any>)[name];
      const rec = (op: string) => () => {
        debug.counts[`${name}.${op}`] = (debug.counts[`${name}.${op}`] ?? 0) + 1;
        if (debug.events.length < 5000) debug.events.push({ t: performance.now(), table: name, op });
        bump();
      };
      const i = rec('insert'), u = rec('update'), d = rec('delete');
      t.onInsert(i); t.onUpdate(u); t.onDelete(d);
      off.push(() => { t.removeOnInsert(i); t.removeOnUpdate(u); t.removeOnDelete(d); });
    }
    bump();
    return () => off.forEach(f => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, key]);

  return useSyncExternalStore(
    cb => {
      store.current.listeners.add(cb);
      return () => store.current.listeners.delete(cb);
    },
    () => store.current.v
  );
}

/**
 * Subscribe to everything about one ECR. Switching ECRs subscribes to the new one first and
 * unsubscribes the old one when the new one is applied. `readyFor` is the ECR whose rows are
 * complete in the cache; the UI shows a loading state until it equals the selected ECR.
 */
export function usePrSubscription(prId: bigint | null): bigint | null {
  const { conn } = useNorn();
  const [readyFor, setReadyFor] = useState<bigint | null>(null);
  const current = useRef<{ prId: bigint; unsubscribe: () => void } | null>(null);
  const latest = useRef<bigint | null>(null);
  latest.current = prId;

  useEffect(() => {
    if (!conn || prId === null) return;
    if (current.current?.prId === prId) return;
    const previous = current.current;
    const id = prId.toString();
    const handle = conn
      .subscriptionBuilder()
      .onApplied(() => {
        // Only now is it safe to let go of the old ECR. A subscription that was superseded
        // before it applied still releases its predecessor, but must not claim to be ready.
        try { previous?.unsubscribe(); } catch { /* already ended */ }
        if (latest.current === prId) {
          setReadyFor(prId);
          debug.ready = id;
        }
      })
      .onError(() => setReadyFor(null))
      .subscribe([
        `SELECT * FROM assumption WHERE pr_id = 0`,
        `SELECT * FROM assumption WHERE pr_id = ${id}`,
        `SELECT * FROM check_run WHERE pr_id = ${id}`,
        `SELECT * FROM check_progress WHERE pr_id = ${id}`,
        `SELECT * FROM check_result WHERE pr_id = ${id}`,
        `SELECT * FROM comment WHERE pr_id = ${id}`,
        `SELECT * FROM action_log WHERE pr_id = ${id}`,
      ]);
    current.current = { prId, unsubscribe: () => handle.unsubscribe() };
    debug.prId = id;
  }, [conn, prId]);

  useEffect(() => () => { try { current.current?.unsubscribe(); } catch { /* ignore */ } }, []);
  return readyFor;
}
