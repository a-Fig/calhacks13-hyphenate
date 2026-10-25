import { useMemo } from 'react';
import { ArrowRightIcon, CheckIcon, CircleIcon, ClockIcon, DotFillIcon } from '@primer/octicons-react';
import { ActionList, Flash, Label } from '@primer/react';
import { monthLabel } from '../assessment/adapter.ts';
import type { CostBlock, CostRow, Figure, ImpactAssessment, RiskLevel } from '../assessment/types.ts';
import { CheckStateIcon, MockTag, SavedRun } from '../ui/Bits.tsx';
import { ImpactIcon } from '../ui/EngineeringIcons.tsx';
import { SCurveChart, TornadoChart } from '../ui/Charts.tsx';
import { Legend, Mark, Num } from '../ui/Evidence.tsx';
import { range as rangeText, staleNote } from '../ui/fmt.ts';
import { evidenceCounts } from '../ui/trace.ts';
import { Link, navigate } from '../router.tsx';

const BLOCKS: { id: CostBlock; label: string }[] = [
  { id: 'production', label: 'Production' },
  { id: 'retrofit', label: 'Retrofit' },
  { id: 'logisticsSupport', label: 'Logistics support' },
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
  const pending = a.checks.filter(c => c.state === 'pending').length;
  const working = a.checks.filter(c => c.state === 'queued' || c.state === 'running').length;
  const passed = a.checks.filter(c => c.state === 'passed').length;
  const stateWord = { passed: 'Passed', attention: 'Needs attention', running: 'Running', queued: 'Queued', pending: 'Not assessed yet', skipped: 'Skipped' }[current.state];

  return (
    <div className="nx-checks">
      <nav className="nx-checks-list" aria-label="Impact checks">
        <div className="nx-checks-title">
          Impact checks
          <span className="nx-fg-muted nx-small">
            {[`${passed} passed`, bad ? `${bad} need attention` : '', working ? `${working} queued or running` : '', pending ? `${pending} not assessed yet` : ''].filter(Boolean).join(', ')}
          </span>
        </div>
        <ActionList>
          {a.checks.map(c => (
            <ActionList.Item key={c.id} active={c.id === current.id} onSelect={() => navigate(`${base}/${c.id}`)}>
              <ActionList.LeadingVisual><ImpactIcon check={c.id} /></ActionList.LeadingVisual>
              {c.name} <MockTag on={!!c.mock} />
              <ActionList.Description><CheckStateIcon state={c.state} size={12} /> {c.state === 'pending' ? 'Not assessed yet' : c.state === 'queued' ? 'Queued' : c.state === 'running' ? 'Running' : c.took ?? ''}</ActionList.Description>
            </ActionList.Item>
          ))}
        </ActionList>
      </nav>

      <section className="nx-check-pane">
        <header className="nx-check-head">
          <span className="nx-check-emblem"><ImpactIcon check={current.id} size={24} /></span>
          <div>
            <h2>{current.name} <MockTag on={!!current.mock} /></h2>
            <div className="nx-fg-muted">
              {stateWord}{current.by ? ` · ${current.by}` : ''}
            </div>
          </div>
        </header>
        <Legend counts={counts} />
        <p className="nx-check-sum">{current.summary}{/[.!?]$/.test(current.summary) ? '' : '.'}</p>
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
  const need = a.cost.needsEstimate;
  return (
    <>
      {a.ecr.staleCost && (
        <Flash variant="warning" className="nx-flash">
          <b>{staleNote(a.ecr.staleCost)}</b> The cost page below is the previous revision&rsquo;s.
        </Flash>
      )}
      {need.length > 0 && (
        <Flash variant="warning" className="nx-flash">
          <b>{need.length} lines need an estimate.</b> The originator left them blank, so they count as $0 until someone estimates them:{' '}
          {need.map(n => n.label).join('; ')}.
        </Flash>
      )}
      <div className="nx-box">
        <div className="nx-box-title">
          Cost page <SavedRun source={a.source} /> <span className="nx-fg-muted">&middot; {a.cost.window.label}, point estimates, savings in parentheses</span>
        </div>
        <div className="nx-table-scroll" role="region" aria-label="Cost page numbers" tabIndex={0}>
          <CostTable a={a} />
        </div>
        <div className="nx-foot">
          {a.cost.run.draws.toLocaleString('en-US')} paired draws, seed {a.cost.run.seed}, {a.cost.run.codeVersion}. Ranges are P10 to P90; the values are the point estimate, which adds up.
        </div>
      </div>
      {a.sCurve && (
        <div className="nx-box">
          <div className="nx-box-title">
            Cost range <span className="nx-fg-muted">&middot; chance the net cost of {a.cost.window.label} stays under a given cost</span>
          </div>
          <SCurveChart data={a.sCurve} />
        </div>
      )}
      {a.drivers.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">
            What moves it most <span className="nx-fg-muted">&middot; each input alone at its P10 and P90, a decision at each alternative</span>
          </div>
          <TornadoChart drivers={a.drivers.slice(0, 4)} base={a.sCurve?.point ?? a.cost.net.point ?? a.cost.net.p50} />
        </div>
      )}
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
          <td>Net cost, {a.cost.window.label}</td>
          <td className="r num"><Num f={a.cost.oneTime} /></td>
          <td className="r num"><Num f={a.cost.recurring} /></td>
          <td className="r num"><Num f={a.cost.net} /></td>
          <td className="r num nx-fg-muted">{rangeText(a.cost.net, 'short')}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BlockRows({ label, rows, sub }: { label: string; rows: CostRow[]; sub: Figure }) {
  return (
    <>
      <tr className="blk">
        <td>{label}</td>
        <td />
        <td />
        <td className="r num"><Num f={sub} /></td>
        <td className="r num nx-fg-muted">{rangeText(sub, 'short')}</td>
      </tr>
      {rows.map(r => (
        <tr key={r.id}>
          <td>
            <div>
              {r.label}
              {r.needsEstimate && <> <Label variant="attention" size="small">Needs an estimate</Label></>}
            </div>
            <div className="nx-fg-muted nx-small">
              {r.unitCost && r.quantity !== undefined && (<><Num f={r.unitCost} /> &times; {r.quantity.toLocaleString('en-US')} &middot; </>)}
              {r.basis}
            </div>
          </td>
          <td className="r num">{!r.recurring ? <Num f={r.total} /> : <span className="nx-fg-muted">&ndash;</span>}</td>
          <td className="r num">{r.recurring ? <Num f={r.total} /> : <span className="nx-fg-muted">&ndash;</span>}</td>
          <td />
          <td className="r num nx-fg-muted">{r.needsEstimate ? '–' : rangeText(r.total, 'full') || 'exact'}</td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- the other checks

function Stat({ label, children, sub }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="nx-stat">
      <div className="nx-stat-label">{label}</div>
      <div className="nx-stat-value">{children}</div>
      {sub && <div className="nx-stat-sub">{sub}</div>}
    </div>
  );
}

function PendingCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="nx-pending-card">
      <CircleIcon size={16} className="nx-fg-muted" />
      <div>
        <b>Not assessed yet</b>
        <div className="nx-fg-muted">{children}</div>
      </div>
    </div>
  );
}

function Scenarios({ a }: { a: ImpactAssessment }) {
  if (!a.scenarios.length) return null;
  return (
    <div className="nx-box">
      <div className="nx-box-title">What if <MockTag on={a.mock.includes('supply')} /></div>
      <ul className="nx-plain">
        {a.scenarios.map(s => (
          <li key={s.label}><span>{s.label}</span><b className="num">{s.effect}</b></li>
        ))}
      </ul>
    </div>
  );
}

function TimelineCheck({ a }: { a: ImpactAssessment }) {
  const c = a.cutIn;
  const est = c.estimate;
  return (
    <>
      <div className="nx-stats">
        <Stat label={`Cut-in on ${c.program}, as ${c.source === 'given' ? 'filed' : 'assumed'}`} sub={`S/N ${c.serial}. ${c.rationale}`}>
          <Mark ev={c.source === 'given' ? 'fact' : 'assumption'} id="cutin">{monthLabel(c.month)}</Mark>
        </Stat>
        {est ? (
          <Stat label={<>Rev C reaches the line <MockTag on={a.mock.includes('cutInEstimate')} /></>} sub={`${rangeText(est.figure, 'short')} · ${est.note}`}>
            <Num f={est.figure} use="p50" />
          </Stat>
        ) : null}
        {est?.likelihood && (
          <Stat label="Likelihood">
            <Mark ev="assumption" id={est.figure.id}><b>{cap(est.likelihood.word)}</b> {est.likelihood.event}</Mark>
          </Stat>
        )}
      </div>
      {!est && <PendingCard>The cut-in has no range yet. The cost check takes the month above, which is {c.source === 'given' ? 'what the ECR states' : 'a default until the timeline check sets it'}.</PendingCard>}
    </>
  );
}

function SupplyCheck({ a }: { a: ImpactAssessment }) {
  const s = a.supply;
  if (!s) return <PendingCard>Supply risk comes from the supply check, which is not built yet.</PendingCard>;
  return (
    <>
      <div className="nx-stats">
        <Stat label={<>Supply risk <MockTag on={a.mock.includes('supply')} /></>} sub={s.note}>
          <Mark ev={s.evidence} id={s.id}><Label variant={RISK[s.level]} size="large">{cap(s.level)}</Label></Mark>
        </Stat>
        {s.likelihood && (
          <Stat label="Likelihood" sub="Outages are shown as scenarios, not blended into the range">
            <Mark ev="computation" id={s.id}><b>{cap(s.likelihood.word)}</b> {s.likelihood.event}</Mark>
          </Stat>
        )}
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
      <div className="nx-foot"><Link to={`/ecr/${a.ecr.id}/changes`}>See the changes <ArrowRightIcon size={12} /></Link></div>
    </div>
  );
}

function ClassCheck({ a }: { a: ImpactAssessment }) {
  const c = a.changeClass;
  return (
    <>
      <div className="nx-stats">
        <Stat label={<>Company class <MockTag on={a.mock.includes('class')} /></>} sub={c.companyWhy}><Mark ev={c.evidence} id={c.traceId}>Class {c.company}</Mark></Stat>
        <Stat label={<>FAA class <MockTag on={a.mock.includes('class')} /></>} sub={c.faaWhy}><Mark ev={c.evidence} id={c.traceId}>FAA {c.faa}</Mark></Stat>
      </div>
      <div className="nx-box">
        <div className="nx-box-title">Approval route <MockTag on={a.mock.includes('route')} /> <span className="nx-fg-muted">&middot; {a.route.tier}</span></div>
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
