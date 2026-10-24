import { createContext, useContext, type ReactNode } from 'react';
import type { Evidence, Figure } from '../assessment/types.ts';
import { fig as figText } from './fmt.ts';

export const EV: Record<Evidence, { label: string; hint: string }> = {
  fact: { label: 'Fact', hint: 'Read from a source' },
  assumption: { label: 'Assumption', hint: 'Supposed, to frame the analysis' },
  computation: { label: 'Computation', hint: 'Calculated by code' },
  judgment: { label: 'Judgment', hint: 'The agent’s conclusion' },
};
export const EV_ORDER: Evidence[] = ['fact', 'assumption', 'computation', 'judgment'];

/** Opens the "why" drawer on a trace. Provided by the ECR page. */
export const WhyContext = createContext<{ open: (traceId: string) => void; current: string | null }>({
  open: () => {},
  current: null,
});
export const useWhy = () => useContext(WhyContext);

/** A shape per class, so the colour is never the only cue: circle, diamond, square, triangle. */
export function Glyph({ ev, size = 10 }: { ev: Evidence; size?: number }) {
  const s = size;
  return (
    <svg className={`nx-glyph nx-ev-${ev}`} width={s} height={s} viewBox="0 0 10 10" aria-hidden="true">
      {ev === 'fact' && <circle cx="5" cy="5" r="4.2" fill="var(--c)" />}
      {ev === 'assumption' && <path d="M5 .6 9.4 5 5 9.4.6 5Z" fill="var(--c)" />}
      {ev === 'computation' && <rect x=".9" y=".9" width="8.2" height="8.2" rx="1.3" fill="var(--c)" />}
      {ev === 'judgment' && <path d="M5 .8 9.4 9H.6Z" fill="var(--c)" strokeLinejoin="round" stroke="var(--c)" strokeWidth=".8" />}
    </svg>
  );
}

/** Any number or claim that has a "why". */
export function Mark({ ev, id, children, className = '', claim = false }: { ev: Evidence; id: string; children: ReactNode; className?: string; claim?: boolean }) {
  const why = useWhy();
  return (
    <button
      type="button"
      className={`nx-mark-btn nx-ev-${ev} ${claim ? 'claim' : ''} ${why.current === id ? 'open' : ''} ${className}`}
      title={`${EV[ev].label}: ${EV[ev].hint}`}
      onClick={() => why.open(id)}
    >
      {children}
    </button>
  );
}

/** A Figure's median, as a Mark. */
export function Num({ f, kind = 'full', plus = false, className }: { f: Figure; kind?: 'full' | 'short'; plus?: boolean; className?: string }) {
  return (
    <Mark ev={f.evidence} id={f.id} className={`num ${className ?? ''}`}>
      {figText(f, kind, plus)}
    </Mark>
  );
}

export function Legend({ counts }: { counts?: Record<Evidence, number> }) {
  const total = counts ? EV_ORDER.reduce((s, k) => s + counts[k], 0) : 0;
  return (
    <div className="nx-legend" aria-label="Evidence key">
      {EV_ORDER.map(k => (
        <span key={k} className={`k nx-ev-${k}`} title={EV[k].hint}>
          <Glyph ev={k} />
          {EV[k].label}
          {counts && <span className="mute num">{counts[k]}</span>}
        </span>
      ))}
      {counts && total > 0 && (
        <span className="nx-mix" aria-hidden="true">
          {EV_ORDER.filter(k => counts[k] > 0).map(k => (
            <i key={k} className={`nx-ev-${k}`} style={{ flex: counts[k] }} />
          ))}
        </span>
      )}
    </div>
  );
}
