import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react';
import { Label } from '@primer/react';
import { useState } from 'react';
import type { ChangedItem, ImpactAssessment } from '../assessment/types.ts';

function stat(item: ChangedItem) {
  return {
    add: item.lines.filter(l => l.kind === 'add').length,
    del: item.lines.filter(l => l.kind === 'del').length,
  };
}

/** GitHub's "Files changed": one block per affected item, with red and green lines. */
export function Changes({ a }: { a: ImpactAssessment }) {
  const total = a.changes.reduce((s, c) => ({ add: s.add + stat(c).add, del: s.del + stat(c).del }), { add: 0, del: 0 });
  return (
    <div className="nx-changes">
      <div className="nx-changes-summary">
        Showing <b>{a.changes.length} changed items</b> with <b className="nx-add">{total.add} additions</b> and <b className="nx-del">{total.del} deletions</b>.
      </div>
      {a.changes.map(c => <Block key={c.id} item={c} />)}
    </div>
  );
}

function Block({ item }: { item: ChangedItem }) {
  const [open, setOpen] = useState(true);
  const s = stat(item);
  let n1 = 0, n2 = 0;
  return (
    <section className="nx-diff">
      <header className="nx-diff-head">
        <button type="button" className="nx-diff-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`}>
          {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        </button>
        <span className="nx-diff-stat" title={`${s.add} additions and ${s.del} deletions`}>
          <b className="nx-add">+{s.add}</b> <b className="nx-del">&minus;{s.del}</b>
        </span>
        <span className="mono nx-diff-title">{item.title}</span>
        {item.subtitle && <span className="nx-fg-muted">{item.subtitle}</span>}
        <span className="nx-sp" />
        {item.impact && <Label variant="secondary">{item.impact}</Label>}
      </header>
      {open && (
        <table className="nx-diff-table">
          <tbody>
            {item.lines.map((l, i) => {
              if (l.kind !== 'add') n1++;
              if (l.kind !== 'del') n2++;
              return (
                <tr key={i} className={`nx-line ${l.kind}`}>
                  <td className="ln">{l.kind !== 'add' ? n1 : ''}</td>
                  <td className="ln">{l.kind !== 'del' ? n2 : ''}</td>
                  <td className="mk">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</td>
                  <td className="tx">
                    <code>{l.text}</code>
                    {l.remark && <span className="nx-remark">  # {l.remark}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
