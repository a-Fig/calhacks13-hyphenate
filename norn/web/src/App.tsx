import { useMemo, useState } from 'react';
import { useNorn, useTableVersion, usePrSubscription, URI, DB } from './store.tsx';
import { STATUS_LABEL, short } from './format.ts';
import { PrPage } from './PrPage.tsx';

export function App() {
  const { conn, R, status, error, identityHex, me, globalReady } = useNorn();
  const v = useTableVersion('pullRequest', 'mainVersion', 'nornConfig');
  const [selected, setSelected] = useState<bigint | null>(null);

  const prs = useMemo(
    () => (conn ? [...conn.db.pullRequest.iter()].sort((a, b) => Number(a.id - b.id)) : []),
    [conn, v]
  );
  const main = useMemo(() => (conn ? [...conn.db.mainVersion.iter()].sort((a, b) => b.version - a.version)[0] : undefined), [conn, v]);
  const deepMode = useMemo(() => (conn ? conn.db.nornConfig.key.find('deep_review_mode')?.value : undefined), [conn, v]);

  const readyFor = usePrSubscription(selected);

  return (
    <>
      <header>
        <h1>NORN</h1>
        <span data-testid="conn" data-status={status}>{status}{error ? `: ${error}` : ''}</span>
        <span>
          Production baseline <b data-testid="baseline">v{main?.version ?? '–'}</b>
        </span>
        <span className="sp" />
        <small>
          you: <b data-testid="me">{me}</b> ({short(identityHex)}) · {DB} @ {URI}
        </small>
        {conn && R && (
          <label>
            <small>Full assessments:&nbsp;</small>
            <select
              value={deepMode ?? 'on_request'}
              data-testid="deep-mode"
              onChange={e => R.setConfig({ key: 'deep_review_mode', value: e.target.value }).catch(alert)}
            >
              <option value="on_request">on request</option>
              <option value="auto">automatic</option>
            </select>
          </label>
        )}
      </header>
      <div className="banner">Skeleton build: every number and every agent result here is mock (no real model, no real data).</div>
      <main>
        <aside>
          <div className="card">
            <h2>Engineering change requests</h2>
            {!globalReady && <div className="mute">Loading…</div>}
            {prs.map(pr => (
              <button
                key={String(pr.id)}
                className={`ecr ${selected === pr.id ? 'sel' : ''}`}
                data-testid={`ecr-${pr.id}`}
                onClick={() => setSelected(pr.id)}
              >
                <div className="t">ECR-{String(pr.id)} {pr.title}</div>
                <div className="row">
                  <span className={`chip ${pr.status}`}>{STATUS_LABEL[pr.status] ?? pr.status}</span>
                  <span className="mute">r{pr.revision}</span>
                </div>
              </button>
            ))}
            {conn && <NewEcr />}
          </div>
        </aside>
        <section>
          {/* Keep showing the last fully loaded ECR until the newly selected one has applied,
              so a switch never flashes an empty or half-loaded page. */}
          {readyFor === null ? (
            <div className="card mute">{selected === null ? 'Pick an ECR.' : 'Loading…'}</div>
          ) : (
            <PrPage prId={readyFor} loadingFor={selected !== null && selected !== readyFor ? selected : null} />
          )}
        </section>
      </main>
    </>
  );
}

function NewEcr() {
  const { conn, R } = useNorn();
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        try {
          await R!.createPr({ plmEcrNumber: '', title, description: '' });
          setTitle('');
          setErr('');
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <input type="text" placeholder="New ECR title" value={title} onChange={e => setTitle(e.target.value)} data-testid="new-ecr-title" />
      <button disabled={!title.trim()} style={{ marginTop: 6 }}>File ECR</button>
      {err && <div className="err">{err}</div>}
    </form>
  );
}
