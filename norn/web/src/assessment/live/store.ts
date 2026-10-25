// A read-only client of Norn's database for the screens. It subscribes to the whole tables the screens
// read (not to rows filtered by state: a filtered subscription loses the row when the state changes,
// norn/NOTES.md), keeps a snapshot, and tells the hooks when it changes. The snapshot is rebuilt at
// most every 80 ms, and the summaries and assessments built from it are cached until it changes.
//
// Point it at a database with VITE_NORN_URI and VITE_NORN_DB (default ws://127.0.0.1:3000 and norn).
import { DbConnection } from '@norn/bindings';
import type { AssessmentSource } from '../source.ts';
import type { EcrSummary, ImpactAssessment } from '../types.ts';
import { buildAssessment, buildSummary, type Snapshot } from './build.ts';

const URI: string = import.meta.env.VITE_NORN_URI ?? 'ws://127.0.0.1:3000';
const DB: string = import.meta.env.VITE_NORN_DB ?? 'norn';

const QUERIES = [
  'SELECT * FROM pull_request',
  'SELECT * FROM ecr_revision',
  'SELECT * FROM check_run',
  'SELECT * FROM check_result',
  'SELECT * FROM impact_statement',
  'SELECT * FROM comment',
  'SELECT * FROM action_log',
  'SELECT * FROM agent_event',
  'SELECT * FROM principal',
  'SELECT * FROM approval',
  'SELECT * FROM recommendation',
  'SELECT * FROM eco_release',
  'SELECT * FROM erp_package',
  'SELECT * FROM norn_config',
];
const TABLES = ['pullRequest', 'ecrRevision', 'checkRun', 'checkResult', 'impactStatement', 'comment', 'actionLog', 'agentEvent', 'principal', 'approval', 'recommendation', 'ecoRelease', 'erpPackage', 'nornConfig'] as const;
type TableName = (typeof TABLES)[number];

export function createLiveSource(): AssessmentSource {
  const listeners = new Set<() => void>();
  let conn: DbConnection | undefined;
  let status: ReturnType<AssessmentSource['status']> = { state: 'connecting' };
  let snap: Snapshot | undefined;
  let list: EcrSummary[] | undefined;
  const assessments = new Map<string, ImpactAssessment | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => listeners.forEach(l => l());

  const rowsOf = (c: DbConnection, t: TableName): unknown[] => [...(c.db as unknown as Record<TableName, { iter(): Iterable<unknown> }>)[t].iter()];

  const take = (c: DbConnection): Snapshot =>
    ({
      prs: rowsOf(c, 'pullRequest'), revisions: rowsOf(c, 'ecrRevision'), runs: rowsOf(c, 'checkRun'), results: rowsOf(c, 'checkResult'),
      statements: rowsOf(c, 'impactStatement'), comments: rowsOf(c, 'comment'), actions: rowsOf(c, 'actionLog'),
      events: rowsOf(c, 'agentEvent'), principals: rowsOf(c, 'principal'),
      approvals: rowsOf(c, 'approval'), recommendations: rowsOf(c, 'recommendation'), ecoReleases: rowsOf(c, 'ecoRelease'), erpPackages: rowsOf(c, 'erpPackage'), configs: rowsOf(c, 'nornConfig'),
    }) as unknown as Snapshot;

  const refresh = () => {
    if (!conn || status.state !== 'ready') return;
    const s = take(conn);
    snap = s;
    list = [...s.prs].sort((a, b) => Number(a.id - b.id)).map(pr => buildSummary(s, pr));
    assessments.clear();
    notify();
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, 80);
  };

  const connect = () => {
    if (conn) return;
    conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withAutomaticReconnect()
      .onConnect(c => {
        for (const t of TABLES) {
          const table = (c.db as unknown as Record<string, any>)[t];
          table.onInsert(schedule);
          table.onUpdate(schedule);
          table.onDelete(schedule);
        }
        c.subscriptionBuilder()
          .onApplied(() => {
            status = { state: 'ready' };
            refresh();
          })
          .onError(() => {
            status = { state: 'error', message: `Fern refused the subscription on ${DB}` };
            notify();
          })
          .subscribe(QUERIES);
      })
      .onConnectError((_ctx, err) => {
        status = { state: 'error', message: `Could not reach Fern at ${URI} (${err.message})` };
        notify();
      })
      .onDisconnect((_ctx, err) => {
        if (status.state !== 'error') status = { state: 'error', message: `Disconnected from Fern${err ? `: ${err.message}` : ''}` };
        notify();
      })
      .build();
  };

  return {
    isMock: false,
    subscribe(onChange) {
      connect();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    status: () => status,
    list: () => list,
    get(id) {
      if (!snap) return undefined;
      if (!assessments.has(id)) {
        const pr = snap.prs.find(p => p.plmEcrNumber === id);
        assessments.set(id, pr ? buildAssessment(snap, pr) : undefined);
      }
      return assessments.get(id);
    },
    summary: id => list?.find(e => e.id === id),
  };
}
