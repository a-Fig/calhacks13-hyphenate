import { createContext, useContext, type ReactNode } from 'react';
import { Tooltip } from '@primer/react/next';
import type { Evidence, Figure } from '../assessment/types.ts';
import { fig as figText } from './fmt.ts';

export const EV: Record<Evidence, { label: string; hint: string }> = {
  fact: { label: 'Fact', hint: 'read from a source' },
  assumption: { label: 'Assumption', hint: 'supposed, to frame the analysis' },
  computation: { label: 'Computation', hint: 'calculated by code' },
  judgment: { label: 'Judgment', hint: 'the agent’s conclusion' },
};
export const EV_ORDER: Evidence[] = ['fact', 'assumption', 'computation', 'judgment'];

/** Opens the "why" panel on a trace. Provided by the ECR page. */
export const WhyContext = createContext<{ open: (traceId: string) => void; current: string | null }>({
  open: () => {},
  current: null,
});
export const useWhy = () => useContext(WhyContext);

/** A shape per class, so colour is never the only cue: circle, diamond, square, triangle. */
export function Glyph({ ev, size = 10 }: { ev: Evidence; size?: number }) {
  return (
    <svg className={`nx-glyph nx-ev-${ev}`} width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      {ev === 'fact' && <circle cx="5" cy="5" r="4.2" fill="var(--c)" />}
      {ev === 'assumption' && <path d="M5 .6 9.4 5 5 9.4.6 5Z" fill="var(--c)" />}
      {ev === 'computation' && <rect x=".9" y=".9" width="8.2" height="8.2" rx="1.3" fill="var(--c)" />}
      {ev === 'judgment' && <path d="M5 .8 9.4 9H.6Z" fill="var(--c)" stroke="var(--c)" strokeWidth=".8" strokeLinejoin="round" />}
    </svg>
  );
}

/**
 * A number or claim that has a "why". Quiet by default, as GitHub marks things: ink text with a thin
 * underline in the class colour, and a tooltip that names the class. The underline style says it too
 * (solid fact, dashed assumption, dotted computation, double judgment), so colour is never alone.
 */
export function Mark({ ev, id, children, className = '', claim = false }: { ev: Evidence; id: string; children: ReactNode; className?: string; claim?: boolean }) {
  const why = useWhy();
  return (
    <Tooltip text={`${EV[ev].label}: ${EV[ev].hint}`} direction="s" type="description">
      <button
        type="button"
        className={`nx-mark nx-ev-${ev} ${claim ? 'claim' : ''} ${why.current === id ? 'open' : ''} ${className}`}
        onClick={() => why.open(id)}
      >
        {children}
      </button>
    </Tooltip>
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

/** The key, with how many of each class the assessment has. Lives on the Impact tab. */
export function Legend({ counts }: { counts?: Record<Evidence, number> }) {
  return (
    <div className="nx-legend" aria-label="Evidence key">
      <span className="nx-legend-title">Evidence</span>
      {EV_ORDER.map(k => (
        <span key={k} className={`k nx-ev-${k}`}>
          <Glyph ev={k} />
          <span className={`nx-sample nx-ev-${k}`}>{EV[k].label}</span>
          <span className="hint">{EV[k].hint}</span>
          {counts && <span className="n">{counts[k]}</span>}
        </span>
      ))}
    </div>
  );
}
