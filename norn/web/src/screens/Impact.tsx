import { useMemo } from 'react';
import { ArrowRightIcon, CheckIcon, ClockIcon, DotFillIcon } from '@primer/octicons-react';
import { ActionList, Label } from '@primer/react';
import type { CostBlock, CostRow, Figure, ImpactAssessment, RiskLevel } from '../assessment/types.ts';
import { CheckStateIcon } from '../ui/Bits.tsx';
import { SCurveChart, TornadoChart } from '../ui/Charts.tsx';
import { Legend, Mark, Num } from '../ui/Evidence.tsx';
import { range as rangeText } from '../ui/fmt.ts';
import { evidenceCounts } from '../ui/trace.ts';
import { Link, navigate } from '../router.tsx';

const BLOCKS: { id: CostBlock; label: string }[] = [
  { id: 'production', label: 'Production' },
  { id: 'retrofit', label: 'Retrofit' },
  { id: 'logistics', label: 'Logistics support' },
  { id: 'other', label: 'Other' },
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const RISK: Record<RiskLevel, 'success' | 'attention' | 'severe'> = { low: 'success', moderate: 'attention', high: 'severe' };

/** GitHub's Checks tab: the list on the left, the selected check's summary page on the right. */
export function Impact({ a, check }: { a: ImpactAssessment; check?: string }) {
  const current = a.checks.find(c => c.id === check) ?? a.checks.find(c => c.id === 'cost') ?? a.checks[0];
  const counts = useMemo(() => evidenceCounts(a), [a]);
  const base = `/ecr/${a.ecr.id}/impact`;
  const bad = a.checks.filter(c => c.state === 'attention').length;

  return (
    <div className="nx-checks">
      <nav className="nx-checks-list" aria-label="Impact checks">
        <div className="nx-checks-title">
          Impact checks
          <span className="nx-fg-muted nx-small">{a.checks.length - bad} passed{bad ? `, ${bad} need attention` : ''}</span>
        </div>
        <ActionList>
          {a.checks.map(c => (
            <ActionList.Item key={c.id} active={c.id === current.id} onSelect={() => navigate(`${base}/${c.id}`)}>
              <ActionList.LeadingVisual><CheckStateIcon state={c.state} /></ActionList.LeadingVisual>
              {c.name}
              <ActionList.Description>{c.took}</ActionList.Description>
            </ActionList.Item>
          ))}
        </ActionList>
      </nav>

      <section className="nx-check-pane">
        <header className="nx-check-head">
          <CheckStateIcon state={current.state} size={20} />
          <div>
            <h2>{current.name}</h2>
            <div className="nx-fg-muted">
              {current.state === 'attention' ? 'Needs attention' : current.state === 'passed' ? 'Passed' : cap(current.state)} in {current.took} &middot; {current.by}, Norn automatically
            </div>
          </div>
        </header>
        <Legend counts={counts} />
        <p className="nx-check-sum">{current.summary}.</p>
        {current.id === 'cost' && <CostCheck a={a} />}
        {current.id === 'timeline' && <TimelineCheck a={a} />}
        {current.id === 'supply' && <SupplyCheck a={a} />}
        {current.id === 'bom' && <BomCheck a={a} />}
        {current.id === 'class' && <ClassCheck a={a} />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Cost

function CostCheck({ a }: { a: ImpactAssessment }) {
  return (
    <>
      <div className="nx-box">
        <div className="nx-box-title">
          Cost page <span className="nx-fg-muted">&middot; {a.cost.yearLabel}, savings in parentheses</span>
        </div>
        <CostTable a={a} />
        <div className="nx-foot">Totals are simulated on the same draws, so rows do not add up exactly.</div>
      </div>
      <div className="nx-box">
        <div className="nx-box-title">
          Cost range <span className="nx-fg-muted">&middot; chance the {a.cost.yearLabel} total stays under a given cost</span>
        </div>
        <SCurveChart data={a.sCurve} />
      </div>
      <div className="nx-box">
        <div className="nx-box-title">
          What moves it most <span className="nx-fg-muted">&middot; each input alone at its P10 and P90</span>
        </div>
        <TornadoChart drivers={a.drivers} base={a.sCurve.pointEstimate.x} />
      </div>
    </>
  );
}

function CostTable({ a }: { a: ImpactAssessment }) {
  return (
    <table className="nx-table nx-cost">
      <thead>
        <tr>
          <th>Item</th>
          <th className="r">One-time</th>
          <th className="r">Recurring</th>
          <th className="r">Total</th>
          <th className="r">P10 &ndash; P90</th>
        </tr>
      </thead>
      <tbody>
        {BLOCKS.map(b => {
          const rows = a.cost.rows.filter(r => r.block === b.id);
          const sub = a.cost.subtotals.find(s => s.block === b.id);
          if (!rows.length || !sub) return null;
          return <BlockRows key={b.id} label={b.label} rows={rows} sub={sub.total} />;
        })}
        <tr className="net">
          <td>Net total, {a.cost.yearLabel}</td>
          <td />
          <td />
          <td className="r num"><Num f={a.cost.net} /></td>
          <td className="r num nx-fg-muted">{rangeText(a.cost.net, 'short')}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BlockRows({ label, rows, sub }: { label: string; rows: CostRow[]; sub: Figure }) {
  const none = rows.every(r => r.notAssessed);
  return (
    <>
      <tr className="blk">
        <td>{label}</td>
        <td />
        <td />
        <td className="r num">{none ? <span className="nx-fg-muted">&ndash;</span> : <Num f={sub} />}</td>
        <td className="r num nx-fg-muted">{none ? '' : rangeText(sub, 'short')}</td>
      </tr>
      {rows.map(r => {
        const recurring = !!r.unitCost && !r.oneTime;
        return (
          <tr key={r.id}>
            <td>
              <div>{r.label}</div>
              <div className="nx-fg-muted nx-small">
                {r.unitCost && r.quantity !== undefined && (<><Num f={r.unitCost} /> &times; {r.quantity.toLocaleString('en-US')}{r.note ? ' · ' : ''}</>)}
                {r.note}
              </div>
            </td>
            {r.notAssessed ? (
              <td colSpan={4} className="r nx-fg-muted"><em>Not assessed yet</em></td>
            ) : (
              <>
                <td className="r num">{!recurring ? <Num f={r.total} /> : <span className="nx-fg-muted">&ndash;</span>}</td>
                <td className="r num">{recurring ? <Num f={r.total} /> : <span className="nx-fg-muted">&ndash;</span>}</td>
                <td />
                <td className="r num nx-fg-muted">{rangeText(r.total, 'full') || 'exact'}</td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- the other checks

function Stat({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="nx-stat">
      <div className="nx-stat-label">{label}</div>
      <div className="nx-stat-value">{children}</div>
      {sub && <div className="nx-stat-sub">{sub}</div>}
    </div>
  );
}

function Scenarios({ a }: { a: ImpactAssessment }) {
  if (!a.scenarios.length) return null;
  return (
    <div className="nx-box">
      <div className="nx-box-title">What if</div>
      <ul className="nx-plain">
        {a.scenarios.map(s => (
          <li key={s.label}><span>{s.label}</span><b className="num">{s.effect}</b></li>
        ))}
      </ul>
    </div>
  );
}

function TimelineCheck({ a }: { a: ImpactAssessment }) {
  const h = a.headline;
  return (
    <>
      <div className="nx-stats">
        <Stat label="Cut-in" sub={`${rangeText(h.cutIn, 'short')} · ${h.cutInNote}`}><Num f={h.cutIn} /></Stat>
        <Stat label="Likelihood" sub="From the paired draws">
          <Mark ev="computation" id={h.cutIn.id}><b>{cap(h.cutInLikelihood.word)}</b> {h.cutInLikelihood.event}</Mark>
        </Stat>
      </div>
      <Scenarios a={a} />
    </>
  );
}

function SupplyCheck({ a }: { a: ImpactAssessment }) {
  const h = a.headline;
  return (
    <>
      <div className="nx-stats">
        <Stat label="Supply risk" sub={h.supply.note}>
          <Mark ev={h.supply.evidence} id={h.supply.id}><Label variant={RISK[h.supply.level]} size="large">{cap(h.supply.level)}</Label></Mark>
        </Stat>
        <Stat label="Likelihood" sub="Outages are shown as scenarios, not blended into the range">
          <Mark ev="computation" id="supply"><b>{cap(h.supply.likelihood.word)}</b> {h.supply.likelihood.event}</Mark>
        </Stat>
      </div>
      <Scenarios a={a} />
    </>
  );
}

function BomCheck({ a }: { a: ImpactAssessment }) {
  return (
    <div className="nx-box">
      <div className="nx-box-title">Changed items</div>
      <ul className="nx-plain">
        {a.changes.map(c => (
          <li key={c.id}>
            <span><b className="mono">{c.title}</b> <span className="nx-fg-muted">{c.subtitle}</span></span>
            <span className="nx-fg-muted">{c.impact}</span>
          </li>
        ))}
      </ul>
      <div className="nx-foot"><Link to={`/ecr/${a.ecr.id}/changes`}>See the diff <ArrowRightIcon size={12} /></Link></div>
    </div>
  );
}

function ClassCheck({ a }: { a: ImpactAssessment }) {
  const c = a.changeClass;
  return (
    <>
      <div className="nx-stats">
        <Stat label="Company class" sub={c.companyWhy}><Mark ev={c.evidence} id={c.traceId}>Class {c.company}</Mark></Stat>
        <Stat label="FAA class" sub={c.faaWhy}><Mark ev={c.evidence} id={c.traceId}>FAA {c.faa}</Mark></Stat>
      </div>
      <div className="nx-box">
        <div className="nx-box-title">Approval route <span className="nx-fg-muted">&middot; {a.route.tier}</span></div>
        <ul className="nx-plain">
          {a.route.steps.map((s, i) => (
            <li key={i}>
              <span>
                {s.state === 'approved' ? <CheckIcon size={16} className="nx-fg-success" /> : s.state === 'waiting' ? <ClockIcon size={16} className="nx-fg-muted" /> : <DotFillIcon size={16} className="nx-fg-attention" />}{' '}
                <b>{s.person ?? s.role}</b> <span className="nx-fg-muted">{s.person ? s.role : ''}</span>
              </span>
              <span className="nx-fg-muted">
                {s.state === 'approved' ? `Approved ${s.when ?? ''}` : s.state === 'waiting' ? `Meets ${s.when ?? ''}` : s.state === 'not_required' ? 'Not needed' : 'Needed'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {a.needed.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">Still needed</div>
          <ul className="nx-plain">
            {a.needed.map((n, i) => (
              <li key={i}><span>{n.text}</span><span className="nx-fg-muted">{n.owner}</span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

