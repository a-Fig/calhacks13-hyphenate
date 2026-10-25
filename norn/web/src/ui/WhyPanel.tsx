import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeftIcon, ChevronRightIcon } from '@primer/octicons-react';
import { ActionList, Dialog, IconButton, Label } from '@primer/react';
import type { ImpactAssessment, Origin } from '../assessment/types.ts';
import { Person } from './Bits.tsx';
import { EV, EvidenceLabel } from './Evidence.tsx';
import { ago, fig as figText, range as rangeText } from './fmt.ts';
import { figureIndex } from './trace.ts';

const ORIGIN: Record<Origin, string> = { given: 'Given', default: 'Default', agent_estimated: 'Agent estimate' };

/**
 * Where a number came from: its sources, inputs, assumptions and formula. A side panel on the right,
 * the way GitHub opens its own detail panes. Inputs drill down; the arrow goes back.
 */
export function WhyPanel({
  a, stack, onOpen, onBack, onClose,
}: {
  a: ImpactAssessment;
  stack: string[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const id = stack[stack.length - 1];
  const t = a.traces[id];
  const figs = useMemo(() => figureIndex(a), [a]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [id]);
  if (!t) return null;

  const f = figs.get(id);
  // The point estimate is the number the cost page adds up; the median and the range come with it.
  const value = f ? figText(f, 'full', id.startsWith('unit_cost_delta'), 'point') : t.value?.text ?? '';
  const rg = f
    ? [f.point !== undefined && f.point !== f.p50 ? `Median ${figText(f, 'full', false, 'p50')}` : '', rangeText(f, 'full') && `P10 to P90 ${rangeText(f, 'full')}`].filter(Boolean).join(' · ')
    : t.value?.range ?? '';
  const prev = stack.length > 1 ? a.traces[stack[stack.length - 2]] : undefined;

  return (
    <Dialog
      title={t.title}
      onClose={onClose}
      position="right"
      width="large"
      renderHeader={() => (
        <Dialog.Header>
          <div className="nx-why-head">
            {prev && (
              <IconButton icon={ArrowLeftIcon} variant="invisible" size="small" aria-label={`Back to ${prev.title}`} onClick={onBack} />
            )}
            <div className="nx-why-head-text">
              <span className="nx-why-class">
                <EvidenceLabel ev={t.evidence} />
                <span className="nx-fg-muted"> &middot; {EV[t.evidence].hint}</span>
              </span>
              <Dialog.Title>{t.title}</Dialog.Title>
            </div>
            <Dialog.CloseButton onClose={onClose} />
          </div>
        </Dialog.Header>
      )}
    >
      <div className="nx-why" data-testid="why-panel" ref={body}>
        <div className={`nx-why-value nx-ev-${t.evidence}`}>
          <div className="v num">{value}</div>
          {rg && <div className="r num">{rg}</div>}
        </div>
        <p className="nx-why-sum">{t.summary}</p>

        {t.formula && (
          <>
            <h3 className="nx-why-h">Formula</h3>
            <div className="nx-why-formula">
              <code>{t.formula.expression}</code>
              {t.formula.worked && <div className="num">{t.formula.worked}</div>}
            </div>
          </>
        )}

        {t.inputs.length > 0 && (
          <>
            <h3 className="nx-why-h">Inputs</h3>
            <ActionList variant="full">
              {t.inputs.map((i, k) => {
                const target = i.traceId && a.traces[i.traceId] && i.traceId !== id ? i.traceId : undefined;
                return (
                  <ActionList.Item key={k} onSelect={target ? () => onOpen(target) : undefined} disabled={false} className={target ? '' : 'nx-noact'}>
                    <ActionList.LeadingVisual><EvidenceLabel ev={i.evidence} /></ActionList.LeadingVisual>
                    {i.label}
                    <ActionList.TrailingVisual>
                      <span className="num nx-trail">{i.display}{target && <ChevronRightIcon size={14} />}</span>
                    </ActionList.TrailingVisual>
                  </ActionList.Item>
                );
              })}
            </ActionList>
          </>
        )}

        {t.assumptions.length > 0 && (
          <>
            <h3 className="nx-why-h">Assumptions</h3>
            <ActionList variant="full">
              {t.assumptions.map((s, k) => (
                <ActionList.Item key={k} className="nx-noact">
                  <ActionList.LeadingVisual><EvidenceLabel ev="assumption" /></ActionList.LeadingVisual>
                  {s.label}
                  <ActionList.Description variant="block">
                    <Label variant={s.origin === 'agent_estimated' ? 'attention' : 'secondary'} size="small">{ORIGIN[s.origin]}</Label> {s.source}
                  </ActionList.Description>
                  <ActionList.TrailingVisual><span className="num nx-trail">{s.display}</span></ActionList.TrailingVisual>
                </ActionList.Item>
              ))}
            </ActionList>
          </>
        )}

        {t.sources && t.sources.length > 0 && (
          <>
            <h3 className="nx-why-h">Sources</h3>
            <ActionList variant="full">
              {t.sources.map((s, k) => (
                <ActionList.Item key={k} className="nx-noact">
                  <ActionList.LeadingVisual><Label variant="secondary" size="small">{s.system}</Label></ActionList.LeadingVisual>
                  {s.ref}
                  {s.detail && <ActionList.Description variant="block">{s.detail}</ActionList.Description>}
                </ActionList.Item>
              ))}
            </ActionList>
          </>
        )}

        {t.producedBy && (
          <>
            <h3 className="nx-why-h">Made by</h3>
            <div className="nx-by">
              <Person name={t.producedBy.actor} kind="norn" size={24} />
              <div>
                <b>{t.producedBy.actor}</b>, {t.producedBy.check}
                {(t.producedBy.onBehalfOf || t.producedBy.at) && (
                  <div className="nx-fg-muted nx-small">{[t.producedBy.onBehalfOf, t.producedBy.at && ago(t.producedBy.at)].filter(Boolean).join(' · ')}</div>
                )}
                {t.producedBy.note && <div className="nx-fg-muted nx-small">{t.producedBy.note}</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
