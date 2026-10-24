import { Label } from '@primer/react';
import type { DiffLine, ImpactAssessment } from '../assessment/types.ts';
import { MockTag } from '../ui/Bits.tsx';
import { CaliperIcon } from '../ui/icons.tsx';

export function Changes({ a }: { a: ImpactAssessment }) {
  return (
    <div className="nx-sections">
      <div className="nx-changes-bar">
        <CaliperIcon size={16} className="nx-fg-muted" />
        <span>Showing <b>{a.changes.length} changed records</b></span>
        <MockTag on={a.mock.includes('narrative')} />
      </div>
      {a.changes.map(c => (
        <section key={c.id} className="nx-diff">
          <header className="nx-diff-head">
            <CaliperIcon size={14} className="nx-fg-muted" />
            <code className="nx-diff-title">{c.title}</code>
            {c.subtitle && <span className="nx-fg-muted">{c.subtitle}</span>}
            <span className="nx-sp" />
            {c.impact && <Label variant="secondary">{c.impact}</Label>}
          </header>
          <DiffTable lines={c.lines} />
        </section>
      ))}
    </div>
  );
}

export function DiffTable({ lines }: { lines: DiffLine[] }) {
  let oldN = 0, newN = 0;
  return (
    <table className="nx-diff-table">
      <tbody>
        {lines.map((l, i) => {
          const o = l.kind === 'add' ? '' : ++oldN;
          const n = l.kind === 'del' ? '' : ++newN;
          const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '\u2212' : ' ';
          return (
            <tr key={i} className={`nx-dl nx-dl-${l.kind}`}>
              <td className="ln">{o}</td>
              <td className="ln">{n}</td>
              <td className="sg">{sign}</td>
              <td className="tx">
                <code>{l.text}</code>
                {l.remark && <span className="rm"># {l.remark}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}