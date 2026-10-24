import { useMemo, useState } from 'react';
import { source } from '../assessment/source.ts';
import type { EcrSummary } from '../assessment/types.ts';
import { LevelPill, StatusIcon } from '../ui/Bits.tsx';
import { Glyph } from '../ui/Evidence.tsx';
import { ago, usdK } from '../ui/fmt.ts';
import { navigate } from '../router.tsx';

type Filter = 'all' | 'decision' | 'flagged' | 'done';

const needsDecision = (e: EcrSummary) => e.status === 'In review' || (e.level === 3 && e.status !== 'Approved');
const done = (e: EcrSummary) => e.status === 'Approved' || e.status === 'ECO released';

export function EcrList() {
  const all = source.listEcrs();
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: all.length,
      decision: all.filter(needsDecision).length,
      flagged: all.filter(e => e.flag && !done(e)).length,
      done: all.filter(done).length,
    }),
    [all]
  );
  const rows = all.filter(e => {
    if (filter === 'decision') return needsDecision(e);
    if (filter === 'flagged') return !!e.flag && !done(e);
    if (filter === 'done') return done(e);
    return true;
  });

  const open = all.filter(e => !done(e));
  const cost = open.reduce((s, e) => s + (e.cost?.p50 ?? 0), 0);
  const level3 = all.filter(e => e.level === 3).length;

  return (
    <div className="nx-wrap">
      <div className="nx-list-head">
        <div>
          <h1>Engineering change requests</h1>
          <p>Bowman Aviation &middot; Vesper and Meridian</p>
        </div>
      </div>

      <div className="nx-sum">
        <div className="nx-card">
          <div className="lab">Open</div>
          <div className="v num">{open.length}</div>
          <div className="s">{counts.done} approved this week</div>
        </div>
        <div className="nx-card">
          <div className="lab">Year-1 impact, open</div>
          <div className="v num">{usdK(cost, { plus: true })}</div>
          <div className="s">Sum of medians, 2027</div>
        </div>
        <div className="nx-card">
          <div className="lab">Next CCB</div>
          <div className="v">Nov 12</div>
          <div className="s">{counts.decision} waiting on a decision</div>
        </div>
        <div className="nx-card">
          <div className="lab">Final verdicts</div>
          <div className="v num">{level3} <span className="mute" style={{ fontSize: 16, fontWeight: 450 }}>of {all.length}</span></div>
          <div className="s">The rest are provisional</div>
        </div>
      </div>

      <div className="nx-filters" role="tablist">
        {([
          ['all', 'All'],
          ['decision', 'Needs a decision'],
          ['flagged', 'Flagged by Norn'],
          ['done', 'Approved'],
        ] as [Filter, string][]).map(([k, label]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} role="tab" aria-selected={filter === k}>
            {label}<span>{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="nx-card" style={{ overflow: 'hidden' }}>
        <table className="nx-table" data-testid="ecr-table">
          <thead>
            <tr>
              <th>ECR</th>
              <th>Title</th>
              <th>Program</th>
              <th>Class</th>
              <th>Status</th>
              <th className="r">Cost impact, 2027</th>
              <th>Report</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(e => (
              <tr
                key={e.id}
                className="go"
                data-testid={`row-${e.id}`}
                tabIndex={0}
                onClick={() => navigate(`/ecr/${e.id}`)}
                onKeyDown={ev => ev.key === 'Enter' && navigate(`/ecr/${e.id}`)}
              >
                <td>
                  <div className="nx-ecr-cell">
                    <span className="id">{e.id}</span>
                  </div>
                </td>
                <td>
                  <div className="ti">{e.title}</div>
                  {e.flag && (
                    <div className="flag">
                      <Glyph ev="judgment" size={9} />
                      {e.flag}
                    </div>
                  )}
                </td>
                <td className="la">
                  {e.program}
                  {e.partNumber && <small className="mono">{e.partNumber}</small>}
                </td>
                <td className="la">
                  Class {e.companyClass}
                  <small>FAA {e.faa}</small>
                </td>
                <td>
                  <span className="st"><StatusIcon status={e.status} /> {e.status}</span>
                </td>
                <td className="r">
                  {e.cost ? (
                    <div className="cost num">
                      {usdK(e.cost.p50, { plus: true })}
                      <small>{usdK(e.cost.p10)} &ndash; {usdK(e.cost.p90)}</small>
                    </div>
                  ) : (
                    <span className="mute">&ndash;</span>
                  )}
                </td>
                <td><LevelPill level={e.level} /></td>
                <td className="la">
                  {ago(e.lastActivity)}
                  <small>{e.lastActivityBy}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
