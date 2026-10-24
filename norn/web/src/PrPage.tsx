import { useMemo, useRef, useState } from 'react';
import { useNorn, useTableVersion, nornDebug } from './store.tsx';
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL, num, ts } from './format.ts';
import type { Assumption, CheckProgress, CheckResult, CheckRun } from '@norn/bindings/types';

export function PrPage({ prId, loadingFor }: { prId: bigint; loadingFor: bigint | null }) {
  const { conn } = useNorn();
  const v = useTableVersion('pullRequest', 'assumption', 'checkRun', 'checkProgress', 'checkResult', 'comment', 'actionLog', 'principal');
  const [actionErr, setActionErr] = useState('');

  const data = useMemo(() => {
    if (!conn) return null;
    const pr = conn.db.pullRequest.id.find(prId);
    const runs = [...conn.db.checkRun.iter()].filter(r => r.prId === prId);
    const progress = new Map<bigint, CheckProgress>();
    for (const p of conn.db.checkProgress.iter()) if (p.prId === prId) progress.set(p.checkRunId, p);
    const results = [...conn.db.checkResult.iter()].filter(r => r.prId === prId);
    const comments = [...conn.db.comment.iter()].filter(c => c.prId === prId).sort((a, b) => Number(a.id - b.id));
    const log = [...conn.db.actionLog.iter()].filter(a => a.prId === prId).sort((a, b) => Number(b.id - a.id));
    // Baseline assumptions, with this ECR's own rows on top.
    const eff = new Map<string, { row: Assumption; scope: 'baseline' | 'ecr' }>();
    for (const a of conn.db.assumption.iter()) if (a.current && a.prId === 0n) eff.set(a.key, { row: a, scope: 'baseline' });
    for (const a of conn.db.assumption.iter()) if (a.current && a.prId === prId) eff.set(a.key, { row: a, scope: 'ecr' });
    return { pr, runs, progress, results, comments, log, assumptions: [...eff.values()].sort((a, b) => a.row.key.localeCompare(b.row.key)) };
  }, [conn, prId, v]);

  nornDebug.pageRenders = ((nornDebug.pageRenders as number) ?? 0) + 1;
  if (!conn || !data || !data.pr) return <div className="card mute">Loading…</div>;
  const { pr, runs, progress, results, comments, log, assumptions } = data;

  const act = (p: Promise<unknown>) => p.then(() => setActionErr('')).catch(e => setActionErr((e as Error).message));
  const setStatus = (status: string) => act(conn.reducers.setPrStatus({ prId, status }));
  const open = ['draft', 'review', 'approved'].includes(pr.status);
  const back = pr.status === 'approved' ? 'review' : 'draft';

  return (
    <div data-testid="pr-page" data-pr={String(prId)} data-loading-for={loadingFor === null ? '' : String(loadingFor)} style={{ opacity: loadingFor === null ? 1 : 0.55 }}>
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>ECR-{String(pr.id)}</h2>
          <span className={`chip ${pr.status}`} data-testid="pr-status">{STATUS_LABEL[pr.status] ?? pr.status}</span>
          <span className="mute" data-testid="pr-revision">r{pr.revision}</span>
          <span className="mute">checked against baseline v{pr.baseVersion}</span>
          {loadingFor !== null && <span className="chip queued" data-testid="loading">loading ECR-{String(loadingFor)}…</span>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, margin: '6px 0' }}>{pr.title}</div>
        <div className="row">
          {pr.status === 'draft' && <button className="primary" data-testid="submit" onClick={() => setStatus('review')}>Submit for review</button>}
          {pr.status === 'review' && <button className="primary" data-testid="approve" onClick={() => setStatus('approved')}>Approve</button>}
          {pr.status === 'approved' && <button className="primary" data-testid="release" onClick={() => setStatus('merged')}>Release ECO</button>}
          {(pr.status === 'approved' || pr.status === 'review') && (
            <button onClick={() => setStatus(back)}>{pr.status === 'approved' ? 'Withdraw approval' : 'Back to draft'}</button>
          )}
          {pr.status === 'closed' && <button onClick={() => setStatus('draft')}>Reopen</button>}
          {open && <button onClick={() => setStatus('closed')}>Close ECR</button>}
        </div>
        {actionErr && <div className="err" data-testid="action-error">{actionErr}</div>}
      </div>

      <div className="card">
        <h2>Impact assessment</h2>
        <table data-testid="runs">
          <thead>
            <tr><th>Step</th><th>Status</th><th>Result (p10 / p50 / p90)</th><th>Worker</th><th></th></tr>
          </thead>
          <tbody>
            {STAGE_ORDER.map(stage => (
              <StageRow
                key={stage}
                stage={stage}
                runs={runs.filter(r => r.stage === stage)}
                results={results}
                progress={progress}
                canAct={open}
                onRequest={() => act(conn.reducers.enqueueCheck({ prId, stage, trigger: 'requested' }))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Assumptions</h2>
        <table data-testid="assumptions">
          <thead><tr><th>Assumption</th><th>Value</th><th>Source</th><th>Rev</th><th>Feeds</th><th></th></tr></thead>
          <tbody>
            {assumptions.map(({ row, scope }) => (
              <AssumptionRow key={row.key} row={row} scope={scope} prId={prId} editable={open} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Comments</h2>
          {comments.map(c => (
            <div key={String(c.id)} style={{ marginBottom: 6 }}>
              <b>{c.authorName}</b> <span className="mute">{ts(c.createdAt)}{c.anchor ? ` · on ${c.anchor}` : ''}</span>
              <div>{c.body}</div>
            </div>
          ))}
          <CommentBox prId={prId} />
        </div>
        <div className="card">
          <h2>Activity</h2>
          <table className="log" data-testid="activity">
            <tbody>
              {log.slice(0, 25).map(a => (
                <tr key={String(a.id)}>
                  <td className="mono">{ts(a.at)}</td>
                  <td>
                    <b>{a.actorName}</b>
                    <span className="mute"> {a.actorKind}{a.onBehalfOf ? ` for ${a.onBehalfOf}` : ''} · via {a.spawnedBy}</span>
                    <div>{a.reducer}: {a.summary}</div>
                    <div className="mute">policy: {a.policy}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StageRow(props: {
  stage: string;
  runs: CheckRun[];
  results: CheckResult[];
  progress: Map<bigint, CheckProgress>;
  canAct: boolean;
  onRequest: () => void;
}) {
  const { stage, runs, results, progress, canAct, onRequest } = props;
  const latest = [...runs].sort((a, b) => Number(b.id - a.id))[0];
  const tier = latest?.tier ?? (stage === 's0_extract' || stage === 's5_card' ? 'deep' : 'code');
  const res = latest ? results.filter(r => r.checkRunId === latest.id) : [];
  const prog = latest ? progress.get(latest.id) : undefined;
  const outdated = latest && (latest.status === 'stale' || latest.status === 'cancelled');
  return (
    <tr
      className={outdated ? 'stale' : ''}
      data-testid={`run-${stage}`}
      data-status={latest?.status ?? 'none'}
      data-run={latest ? String(latest.id) : ''}
      data-pr={latest ? String(latest.prId) : ''}
      data-hash={latest?.inputHash ?? ''}
    >
      <td>
        {STAGE_LABEL[stage]} <span className="mute">{tier === 'deep' ? 'full assessment' : 'impact screen'}</span>
      </td>
      <td>
        {latest ? (
          <span className={`chip ${latest.status}`}>{latest.status === 'stale' ? 'outdated' : latest.status}</span>
        ) : (
          <span className="mute">not requested</span>
        )}
        {latest && latest.attempts > 1 && <span className="mute"> try {latest.attempts}/{latest.maxAttempts}</span>}
        {latest?.note && <div className="mute">{latest.note}</div>}
      </td>
      <td>
        {res.map(r => (
          <div key={String(r.id)} data-testid={`result-${r.key}`}>
            {r.label}: {num(r.p10, 2)} / <b>{num(r.p50, 2)}</b> / {num(r.p90, 2)} {r.unit}
            {r.detailJson.includes('"mock":true') && <span className="chip mock" style={{ marginLeft: 6 }}>mock</span>}
          </div>
        ))}
        {latest?.status === 'running' && prog && <ProgressView p={prog} />}
      </td>
      <td className="mute">{latest?.claimedByName ?? ''}</td>
      <td>
        {tier === 'deep' && canAct && (!latest || latest.status === 'stale' || latest.status === 'failed' || latest.status === 'cancelled') && (
          <button data-testid={`request-${stage}`} onClick={onRequest}>Request</button>
        )}
      </td>
    </tr>
  );
}

function ProgressView({ p }: { p: CheckProgress }) {
  const renders = useRef(0);
  renders.current++;
  const max = Math.max(1, ...p.histogram);
  const pct = p.total ? (100 * p.done) / p.total : 0;
  // Read by the browser spike: how stale is what the screen shows?
  const updatedAtMs = Number(p.updatedAt.microsSinceUnixEpoch / 1000n);
  nornDebug.lastProgress = { done: p.done, total: p.total, updatedAtMs, seenAtMs: Date.now() };
  const samples = ((nornDebug.progressRenders as { done: number; lagMs: number }[] | undefined) ??= []);
  if (samples[samples.length - 1]?.done !== p.done) samples.push({ done: p.done, lagMs: Date.now() - updatedAtMs });
  return (
    <div data-testid="progress" data-done={p.done} data-total={p.total}>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="mute">
        {num(p.done)} / {num(p.total)} draws · p10 {num(p.percentiles[1] ?? 0)} · p50 {num(p.percentiles[3] ?? 0)} · p90 {num(p.percentiles[5] ?? 0)}
      </div>
      <div className="hist">{p.histogram.map((h, i) => <i key={i} style={{ height: `${(100 * h) / max}%` }} />)}</div>
    </div>
  );
}

function AssumptionRow({ row, scope, prId, editable }: { row: Assumption; scope: 'baseline' | 'ecr'; prId: bigint; editable: boolean }) {
  const { conn } = useNorn();
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const shown = draft ?? row.distJson;
  const dirty = draft !== null && draft !== row.distJson;

  const save = async (toBaseline: boolean) => {
    try {
      // Saving over a baseline row from an ECR page creates this ECR's own override (expected rev 0).
      const target = toBaseline ? 0n : prId;
      const expectedRev = (toBaseline && scope === 'baseline') || (!toBaseline && scope === 'ecr') ? row.rev : 0;
      await conn!.reducers.recordAssumption({
        prId: target,
        key: row.key,
        distJson: shown,
        source: 'given',
        rationale: 'Edited by reviewer',
        affects: row.affects,
        expectedRev,
      });
      setDraft(null);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <tr data-testid={`assumption-${row.key}`} data-rev={row.rev} data-scope={scope}>
      <td>
        {row.key}
        <div className="mute">{scope === 'baseline' ? 'production baseline' : 'this ECR'}</div>
      </td>
      <td style={{ minWidth: 260 }}>
        <input type="text" className="mono" value={shown} disabled={!editable} onChange={e => setDraft(e.target.value)} data-testid={`input-${row.key}`} />
        {err && <div className="err" data-testid={`error-${row.key}`}>{err}</div>}
      </td>
      <td>
        {row.source}
        {row.source === 'agent_estimated' && <span className="chip mock" style={{ marginLeft: 4 }}>guess</span>}
      </td>
      <td data-testid={`rev-${row.key}`}>{row.rev}</td>
      <td className="mute">{row.affects.length ? row.affects.map(s => STAGE_LABEL[s] ?? s).join(', ') : 'everything'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button disabled={!dirty || !editable} data-testid={`save-${row.key}`} onClick={() => save(false)}>Save for ECR</button>{' '}
        <button disabled={!dirty || !editable} data-testid={`save-baseline-${row.key}`} onClick={() => save(true)}>Save to baseline</button>
      </td>
    </tr>
  );
}

function CommentBox({ prId }: { prId: bigint }) {
  const { conn } = useNorn();
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  return (
    <div>
      <textarea rows={2} value={body} onChange={e => setBody(e.target.value)} data-testid="comment-body" />
      <button
        disabled={!body.trim()}
        data-testid="comment-send"
        onClick={async () => {
          try {
            await conn!.reducers.addComment({ prId, anchor: '', body });
            setBody('');
            setErr('');
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Comment
      </button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
