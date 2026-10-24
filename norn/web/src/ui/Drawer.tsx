import { useEffect, useMemo, useRef } from 'react';
import type { Evidence, Figure, ImpactAssessment, Origin } from '../assessment/types.ts';
import { Avatar } from './Bits.tsx';
import { EV, Glyph } from './Evidence.tsx';
import { ago, fig as figText, range as rangeText } from './fmt.ts';

const ORIGIN: Record<Origin, string> = { given: 'Given', default: 'Default', agent_estimated: 'Agent estimate' };

/** Every figure on the page by its trace id, so the drawer can show the number it explains. */
export function figureIndex(a: ImpactAssessment): Map<string, Figure> {
  const m = new Map<string, Figure>();
  for (const r of a.cost.rows) {
    if (r.unitCost) m.set(r.unitCost.id, r.unitCost);
    m.set(r.total.id, r.total);
  }
  for (const s of a.cost.subtotals) m.set(s.total.id, s.total);
  m.set(a.cost.net.id, a.cost.net);
  m.set(a.headline.unitCost.id, a.headline.unitCost);
  m.set(a.headline.cutIn.id, a.headline.cutIn);
  return m;
}

export function evidenceCounts(a: ImpactAssessment): Record<Evidence, number> {
  const c: Record<Evidence, number> = { fact: 0, assumption: 0, computation: 0, judgment: 0 };
  const add = (f?: Figure) => f && c[f.evidence]++;
  for (const r of a.cost.rows) { add(r.oneTime); add(r.unitCost); if (!r.oneTime) add(r.total); }
  a.cost.subtotals.forEach(s => add(s.total));
  [a.cost.net, a.headline.unitCost, a.headline.cutIn].forEach(add);
  c[a.headline.supply.evidence]++;
  c[a.changeClass.evidence]++;
  a.recommendation.reasons.forEach(r => c[r.evidence]++);
  a.drivers.forEach(d => c[d.evidence]++);
  return c;
}

export function WhyDrawer({
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
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!t) return null;
  const f = figs.get(id);
  const value = f ? figText(f, 'full', f.unit === 'usd' && id === 'x.unitPerAc') : t.value?.text ?? '';
  const rg = f ? rangeText(f, 'full') : t.value?.range ?? '';
  const prev = stack.length > 1 ? a.traces[stack[stack.length - 2]] : undefined;

  return (
    <aside className="nx-drawer" aria-label={`Why: ${t.title}`} data-testid="why-drawer">
      <div className="dh">
        {prev && (
          <button type="button" className="back" onClick={onBack}>
            &larr; {prev.title.length > 28 ? prev.title.slice(0, 27) + '…' : prev.title}
          </button>
        )}
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m2.5 2.5 9 9m0-9-9 9" /></svg>
        </button>
      </div>
      <div className="scroll" ref={scroller}>
        <div className={`nx-ev-${t.evidence}`}>
          <span className="cls">
            <Glyph ev={t.evidence} size={11} /> {EV[t.evidence].label}
            <span className="mute" style={{ fontWeight: 450 }}>&middot; {EV[t.evidence].hint}</span>
          </span>
          <h2>{t.title}</h2>
          <div className="val">
            <div className="v num">{value}</div>
            {rg && <div className="r num">{f ? `${rg}, p10 to p90` : rg}</div>}
          </div>
        </div>
        <p className="sum">{t.summary}</p>

        {t.formula && (
          <section>
            <h3>Formula</h3>
            <div className="nx-formula">
              <div className="e">{t.formula.expression}</div>
              {t.formula.worked && <div className="w num">{t.formula.worked}</div>}
            </div>
          </section>
        )}

        {t.inputs.length > 0 && (
          <section>
            <h3>Inputs</h3>
            <ul className="nx-list">
              {t.inputs.map((i, k) => {
                const target = i.traceId && a.traces[i.traceId] && i.traceId !== id ? i.traceId : undefined;
                const row = (
                  <>
                    <span className={`nx-ev-${i.evidence}`} style={{ marginTop: 5 }}><Glyph ev={i.evidence} /></span>
                    <span className="t">{i.label}</span>
                    <span className="v">{i.display}</span>
                    {target && (
                      <svg className="chev" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5.2 3 4 4-4 4" /></svg>
                    )}
                  </>
                );
                return (
                  <li key={k}>
                    {target ? <button type="button" className="go" onClick={() => onOpen(target)}>{row}</button> : <div style={{ display: 'flex', gap: 10, width: '100%' }}>{row}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {t.assumptions.length > 0 && (
          <section>
            <h3>Assumptions</h3>
            <ul className="nx-list">
              {t.assumptions.map((s, k) => (
                <li key={k}>
                  <span className="nx-ev-assumption" style={{ marginTop: 5 }}><Glyph ev="assumption" /></span>
                  <span className="t">
                    {s.label}
                    <span className="s"><span className={`nx-origin ${s.origin}`}>{ORIGIN[s.origin]}</span> {s.source}</span>
                  </span>
                  <span className="v">{s.display}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.sources.length > 0 && (
          <section>
            <h3>Sources</h3>
            <ul className="nx-list">
              {t.sources.map((s, k) => (
                <li key={k}>
                  <span className="nx-sys">{s.system}</span>
                  <span className="t">
                    {s.ref}
                    {s.detail && <span className="s">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>Made by</h3>
          <div className="nx-by">
            <Avatar name={t.producedBy.actor} kind="norn" />
            <div>
              {t.producedBy.actor}, {t.producedBy.check}
              <div className="s">{t.producedBy.onBehalfOf} &middot; {ago(t.producedBy.at)}</div>
              {t.producedBy.note && <div className="s">{t.producedBy.note}</div>}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
