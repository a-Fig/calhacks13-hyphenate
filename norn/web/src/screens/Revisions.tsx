import type { ImpactAssessment, Revision } from '../assessment/types.ts';
import { Person } from '../ui/Bits.tsx';
import { ago, dateTime, dayLabel } from '../ui/fmt.ts';

/** GitHub's commits list: the edits of the request, newest first, grouped by day. */
export function Revisions({ a }: { a: ImpactAssessment }) {
  const byDay = new Map<string, Revision[]>();
  for (const r of [...a.revisions].sort((x, y) => y.at.localeCompare(x.at))) {
    const d = dayLabel(r.at);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  return (
    <div className="nx-revs">
      {[...byDay.entries()].map(([day, revs]) => (
        <section key={day}>
          <h3 className="nx-revs-day">Revisions on {day}, 2026</h3>
          <ul className="nx-box nx-rev-list">
            {revs.map(r => (
              <li key={r.id}>
                <div className="nx-rev-main">
                  <b>{r.message}</b>
                  <div className="nx-fg-muted nx-rev-by">
                    <Person name={r.author} size={16} /> <b>{r.author}</b> edited <span title={dateTime(r.at)}>{ago(r.at)}</span>
                  </div>
                </div>
                <code className="nx-rev-id">{r.id}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
