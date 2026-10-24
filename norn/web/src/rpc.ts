// Reducer calls from the browser: every write reducer takes `meta` first (the caller's request id
// and what started the call). This fills it in, so components call `R.createPr({...})`.
import type { DbConnection } from '@norn/bindings';

type Meta = { requestId?: string; spawnedBy?: string };
export type WithMeta<R> = {
  [K in keyof R]: R[K] extends (p: infer P) => infer Ret ? (p: Omit<P, 'meta'> & { meta?: Meta }) => Ret : R[K];
};

export const newRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function reducersFor(conn: DbConnection, spawnedBy = 'web'): WithMeta<DbConnection['reducers']> {
  return new Proxy(conn.reducers, {
    get(target, prop, receiver) {
      const f = Reflect.get(target, prop, receiver);
      if (typeof f !== 'function') return f;
      return (args: { meta?: Meta }) => f.call(target, { ...args, meta: { requestId: newRequestId(), spawnedBy, ...args?.meta } });
    },
  }) as WithMeta<DbConnection['reducers']>;
}
