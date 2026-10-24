// Spike probe, not part of the app: how does the SDK's own React hook behave when the query
// changes (switching ECRs)? It records, on every render, which ECR it was asked for, whether it
// says it is ready, and how many rows it returned.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DbConnection, tables } from '@norn/bindings';
import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';

const builder = DbConnection.builder()
  .withUri(import.meta.env.VITE_NORN_URI ?? 'ws://127.0.0.1:3000')
  .withDatabaseName(import.meta.env.VITE_NORN_DB ?? 'norn');

const renders: { t: number; pr: string; ready: boolean; rows: number; rowPrs: string[] }[] = [];
(window as unknown as { __probe: unknown }).__probe = renders;

function Panel() {
  const [prId, setPrId] = useState(1n);
  const [rows, ready] = useTable(tables.checkRun.where(r => r.prId.eq(prId)));
  renders.push({ t: performance.now(), pr: String(prId), ready, rows: rows.length, rowPrs: [...new Set(rows.map(r => String(r.prId)))] });
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  return (
    <div>
      {[1n, 2n, 3n].map(n => <button key={String(n)} data-testid={`go-${n}`} onClick={() => setPrId(n)}>ECR-{String(n)}</button>)}
      <div data-testid="probe" data-pr={String(prId)} data-ready={String(ready)} data-rows={rows.length}>
        asked for ECR-{String(prId)}, ready={String(ready)}, rows={rows.length}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <SpacetimeDBProvider connectionBuilder={builder}>
    <Panel />
  </SpacetimeDBProvider>
);
