import { Timeline } from '@primer/react';
import type { ImpactAssessment, Revision } from '../assessment/types.ts';
import { MockTag, Person } from '../ui/Bits.tsx';
import { RevisionTriangleIcon } from '../ui/icons.tsx';
import { ago, dayLabel } from '../ui/fmt.ts';

export function Revisions({ a }: { a: ImpactAssessment }) {
  const byDay = new Map<string, Revision[]>();
  for (const r of a.revisions) {
    const d = dayLabel(r.at);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  return (
    <div className="nx-revs">
      <Timeline clipSidebar>
        {[...byDay.entries()].map(([day, list]) => (
          <Timeline.Item key={day}>
            <Timeline.Badge><RevisionTriangleIcon size={15} /></Timeline.Badge>
            <Timeline.Body>
              <div className="nx-rev-day">Revisions on {day} <MockTag on={a.mock.includes('narrative')} /></div>
              <div className="nx-box nx-rev-box">
                <ul className="nx-rows nx-rev-list">
                  {list.map(r => (
                    <li key={r.id} className="nx-rev-row">
                      <div>
                        <div className="nx-rev-msg">{r.message}</div>
                        <div className="nx-row-sub">
                          <Person name={r.author} size={16} /> <b>{r.author}</b> revised {ago(r.at)}
                        </div>
                      </div>
                      <span className="nx-rev-badge" title={`Drawing revision ${r.id.toUpperCase()}`}>
                        <RevisionTriangleIcon size={13} />
                        <code>{r.id.toUpperCase()}</code>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Timeline.Body>
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  );
}