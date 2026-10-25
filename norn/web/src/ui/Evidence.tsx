import { createContext, useContext, type ReactNode } from 'react';
import { Label } from '@primer/react';
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

/** A small neutral text badge naming the evidence class. Neutral variant so it is not read as risk or severity. */
export function EvidenceLabel({ ev }: { ev: Evidence }) {
  return <Label variant="secondary" size="small" className="nx-evidence-label">{EV[ev].label}</Label>;
}

/**
 * A traceable number or claim, with an explicit evidence label and standard link-button treatment.
 * Hide the inline label only where the surrounding row already names the evidence class.
 */
export function Mark({ ev, id, children, className = '', showEvidence = true }: { ev: Evidence; id: string; children: ReactNode; className?: string; showEvidence?: boolean }) {
  const why = useWhy();
  return (
    <Tooltip text={`${EV[ev].label}: ${EV[ev].hint}`} direction="s" type="description">
      <button
        type="button"
        className={`nx-mark ${why.current === id ? 'open' : ''} ${className}`}
        aria-haspopup="dialog"
        onClick={() => why.open(id)}
      >
        <span className="nx-mark-value">{children}</span>
        {showEvidence && <EvidenceLabel ev={ev} />}
      </button>
    </Tooltip>
  );
}

/** A Figure's point estimate (or median, with `use`), as a Mark. */
export function Num({ f, kind = 'full', plus = false, use = 'point', className }: { f: Figure; kind?: 'full' | 'short'; plus?: boolean; use?: 'p50' | 'point'; className?: string }) {
  return (
    <Mark ev={f.evidence} id={f.id} className={`num ${className ?? ''}`}>
      {figText(f, kind, plus, use)}
    </Mark>
  );
}

/** The key, with how many of each class the assessment has. Lives on the Impact tab. */
export function Legend({ counts }: { counts?: Record<Evidence, number> }) {
  return (
    <div className="nx-legend" role="group" aria-label="Evidence key">
      <div className="nx-legend-heading">
        <span className="nx-legend-title">Evidence</span>
        {counts && <span className="hint">Numbers and claims in this assessment</span>}
      </div>
      <ul className="nx-legend-entries">
        {EV_ORDER.map(k => (
          <li key={k}>
            <div className="nx-legend-copy">
              <div className="nx-legend-label">
                <EvidenceLabel ev={k} />
                {counts && <span className="n" aria-label={`${counts[k]} items`}>{counts[k]}</span>}
              </div>
              <span className="hint">{k === 'assumption' ? 'Assumed input' : EV[k].hint}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
