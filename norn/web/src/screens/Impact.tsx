import { useMemo } from 'react';
import { ArrowRightIcon, CheckIcon, CircleIcon, ClockIcon, DotFillIcon } from '@primer/octicons-react';
import { ActionList, Flash, Label } from '@primer/react';
import { monthLabel } from '../assessment/adapter.ts';
import type { CostBlock, CostRow, Figure, ImpactAssessment, RiskLevel } from '../assessment/types.ts';
import { CheckStateIcon, MockTag, SavedRun } from '../ui/Bits.tsx';
import { ImpactIcon } from '../ui/EngineeringIcons.tsx';
import { SCurveChart, TornadoChart } from '../ui/Charts.tsx';
import { Legend, Mark, Num } from '../ui/Evidence.tsx';
import { dateLong, range as rangeText, staleNote, usd } from '../ui/fmt.ts';
import { evidenceCounts } from '../ui/trace.ts';
import { Link, navigate } from '../router.tsx';
import { OptionsBox } from './OptionsBox.tsx';

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
          Cost page <SavedRun source={a.source} /> <span className="nx-fg-muted">&middot; {a.cost.scenarios ? `${a.cost.scenarios.requested}; ` : ''}{a.cost.window.label}, point estimates, savings in parentheses; Total is nonrecurring plus extended</span>
        </div>
        <div className="nx-table-scroll" role="region" aria-label="Cost page numbers" tabIndex={0}>
          <CostTable a={a} />
        </div>
        <div className="nx-foot">
          {a.cost.run.draws.toLocaleString('en-US')} paired draws, seed {a.cost.run.seed}, {a.cost.run.codeVersion}. Ranges are P10 to P90; the values are the point estimate, which adds up.
        </div>
      </div>
      <ScenarioBox a={a} />
      <OptionsBox id={a.ecr.id} />
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

const isoDate = (s: string) => dateLong(Date.parse(`${s}T12:00:00Z`));

/**
 * The cost page costs the requested effectivity. When the timeline check forecasts a different one, the checks
 * cost that too, conditional on the median forecast serial. The box says which is which, and what is not in either.
 */
function ScenarioBox({ a }: { a: ImpactAssessment }) {
  const sc = a.cost.scenarios;
  const need = a.cost.needsEstimate;
  if (!sc && !need.length) return null;
  const f = sc?.forecast;
  const alt = sc?.alternative;
  return (
    <div className="nx-box">
      <div className="nx-box-title">
        Requested and forecast scenarios <span className="nx-fg-muted">&middot; the cost page above is the requested scenario</span>
      </div>
      {sc ? (
        <ul className="nx-plain">
          <li>
            <span><b>Requested</b> <span className="nx-fg-muted">&middot; {sc.requested}. The cost page, the headline and the cost range assume this.</span></span>
            <b className="num"><Num f={a.cost.net} /></b>
          </li>
          <li>
            <span>
              <b>Forecast</b>{' '}
              <span className="nx-fg-muted">
                &middot; {f && !f.placed ? 'the timeline check cannot place the change in the volume plan' : f?.date ? `${sc.readiness === 'materials_only' ? 'material readiness' : 'reaches the line'} ${isoDate(f.date.p50)} (${isoDate(f.date.p10)} – ${isoDate(f.date.p90)})` : 'no forecast date'}
                {f?.serial ? `, from S/N ${Math.round(f.serial.p50)}` : ''}
              </span>
              {alt && <div className="nx-fg-muted nx-small">{alt.label}; {alt.window.label}. Conditional on that one serial, not a joint simulation of cost and date.</div>}
            </span>
            {alt ? <b className="num"><Num f={alt.net} /> <span className="nx-fg-muted nx-small">{rangeText(alt.net, 'short')}</span></b> : <span className="nx-fg-muted">Not costed</span>}
          </li>
          {alt && (
            <li>
              <span className="nx-fg-muted">Ongoing production at the forecast serial</span>
              <b className="num"><Num f={alt.recurring} /></b>
            </li>
          )}
        </ul>
      ) : (
        <p className="nx-fg-muted nx-small">The cost check did not cost a forecast scenario for this revision, so the only cost shown is the requested effectivity&rsquo;s.</p>
      )}
      {sc?.unavailable && <p className="nx-fg-muted nx-small">{sc.unavailable}</p>}
      {alt?.flags.map((fl, i) => <p key={i} className={`nx-small ${fl.severity === 'warn' ? 'nx-fg-attention' : 'nx-fg-muted'}`}>{fl.message}</p>)}
      {sc?.readiness === 'materials_only' && (
        <p className="nx-small nx-fg-attention">The forecast date is material readiness only: qualification, release or retrofit work that is not assessed may make implementation later, and its cost is in neither scenario.</p>
      )}
      {need.length > 0 && (
        <p className="nx-small nx-fg-attention">Not in either scenario: {need.length} line{need.length > 1 ? 's' : ''} without an estimate ({need.map(n => n.label).join('; ')}).</p>
      )}
      {sc?.note && <p className="nx-fg-muted nx-small">{sc.note}</p>}
    </div>
  );
}

/** The sum of a column's point estimates: the one number per column that adds up exactly. */
const pointSum = (fs: (Figure | undefined)[]) => fs.reduce((t, f) => t + (f ? f.point ?? f.p50 : 0), 0);

function CostTable({ a }: { a: ImpactAssessment }) {
  const rows = a.cost.rows;
  return (
    <>
      <table className="nx-table nx-cost">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">Nonrecurring</th>
            <th className="r">Unit cost &times; quantity</th>
            <th className="r">Extended</th>
            <th className="r">Total</th>
            <th className="r">P10 &ndash; P90</th>
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map(b => {
            const own = rows.filter(r => r.block === b.id);
            const sub = a.cost.subtotals.find(s => s.block === b.id);
            if (!own.length || !sub) return null;
            return <BlockRows key={b.id} label={b.label} rows={own} sub={sub.total} />;
          })}
          <tr className="net">
            <td>Net cost, {a.cost.window.label}<div className="nx-fg-muted nx-small">Columns add the lines&rsquo; point estimates</div></td>
            <td className="r num">{usd(pointSum(rows.map(r => r.nonrecurring)))}</td>
            <td />
            <td className="r num">{usd(pointSum(rows.map(r => r.extended)))}</td>
            <td className="r num"><Num f={a.cost.net} /></td>
            <td className="r num nx-fg-muted">{rangeText(a.cost.net, 'short')}</td>
          </tr>
        </tbody>
      </table>
      <ul className="nx-plain nx-cost-sums">
        <li>
          <span>Rollout budget <span className="nx-fg-muted">&middot; every line except ongoing production, retrofit and support unit costs &times; quantity included</span></span>
          <b className="num"><Num f={a.cost.oneTime} /></b>
        </li>
        <li>
          <span>Ongoing production <span className="nx-fg-muted">&middot; per-unit change &times; units built after the cut-in, {a.cost.window.label}</span></span>
          <b className="num"><Num f={a.cost.recurring} /></b>
        </li>
      </ul>
    </>
  );
}

function BlockRows({ label, rows, sub }: { label: string; rows: CostRow[]; sub: Figure }) {
  const dash = <span className="nx-fg-muted">&ndash;</span>;
  return (
    <>
      <tr className="blk">
        <td>{label}</td>
        <td />
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
              {r.recurring && <> <Label variant="secondary" size="small">Ongoing production</Label></>}
              {r.needsEstimate && <> <Label variant="attention" size="small">Needs an estimate</Label></>}
            </div>
            <div className="nx-fg-muted nx-small">{r.basis}</div>
          </td>
          <td className="r num">{r.nonrecurring ? <Num f={r.nonrecurring} /> : dash}</td>
          <td className="r num">
            {r.unitCost && r.quantity !== undefined ? <><Num f={r.unitCost} /> &times; {r.quantity.toLocaleString('en-US')}</> : dash}
          </td>
          <td className="r num">{r.extended ? <Num f={r.extended} /> : dash}</td>
          <td className="r num"><Num f={r.total} /></td>
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

function Flags({ flags }: { flags: { severity: 'info' | 'warn'; message: string }[] }) {
  if (!flags.length) return null;
  return (
    <>
      {flags.map((f, i) => (
        <Flash key={i} variant={f.severity === 'warn' ? 'warning' : 'default'} className="nx-flash">{f.message}</Flash>
      ))}
    </>
  );
}

function TimelineCheck({ a }: { a: ImpactAssessment }) {
  const c = a.cutIn;
  const est = c.estimate;
  const t = c.timeline;
  const stateWord = a.checks.find(x => x.id === 'timeline')?.state;
  if (!t && !est) {
    return <PendingCard>{stateWord === 'attention' ? 'The timeline check has no result to show; the summary above says why.' : 'The cut-in has no range yet.'} The cost check takes {monthLabel(c.month)}, which is {c.source === 'given' ? 'what the ECR states' : 'a default until the timeline check sets it'}.</PendingCard>;
  }
  return (
    <>
      {t?.stale && <Flash variant="warning" className="nx-flash"><b>{staleNote(t.stale)}</b> The timeline below is the previous revision&rsquo;s.</Flash>}
      {t?.readiness === 'materials_only' && (
        <Flash variant="warning" className="nx-flash">
          <b>Material readiness, not implementation.</b> The date is when the parts and the assessed work allow the change. Qualification, release or retrofit work that is not assessed may make implementation later.
        </Flash>
      )}
      {t && !t.placed && <Flash variant="warning" className="nx-flash"><b>No date can be placed.</b> The old stock runs past the end of the volume plan{t.serial ? `, so the first serial the change can take is S/N ${Math.round(t.serial.p50)}` : ''}.</Flash>}
      {t && <Flags flags={t.flags} />}
      <div className="nx-stats">
        <Stat label={`Cut-in on ${c.program}, as ${c.source === 'given' ? 'filed' : 'assumed'}`} sub={`S/N ${c.serial}. ${c.rationale}`}>
          <Mark ev={c.source === 'given' ? 'fact' : 'assumption'} id="cutin">{monthLabel(c.month)}</Mark>
        </Stat>
        {est ? (
          <Stat label={<>{est.label ?? 'Reaches the line'} <MockTag on={a.mock.includes('cutInEstimate')} /></>} sub={`${rangeText(est.figure, 'short')} · ${est.note}`}>
            <Num f={est.figure} use="p50" />
          </Stat>
        ) : null}
        {t?.serial && (
          <Stat label="First serial that can take it" sub={rangeText(t.serial, 'short')}>
            <Num f={t.serial} use="p50" />
          </Stat>
        )}
        {est?.likelihood && (
          <Stat label="Likelihood" sub={t ? `Stated effectivity: ${t.stated.label}` : undefined}>
            <Mark ev={a.mock.includes('cutInEstimate') ? 'assumption' : 'computation'} id={t ? 's3:p_late' : est.figure.id}><b>{cap(est.likelihood.word)}</b> {est.likelihood.event}</Mark>
          </Stat>
        )}
        {t?.retrofit && (
          <Stat label="Assessed retrofit completes" sub={`${rangeText(t.retrofit, 'short')} · separate from the production cut-in`}>
            <Num f={t.retrofit} use="p50" />
          </Stat>
        )}
      </div>
      {t && t.steps.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">What the date waits for <span className="nx-fg-muted">&middot; the latest of these sets it; share is how often each does</span></div>
          <ul className="nx-plain">
            {t.steps.map(s => (
              <li key={s.id}>
                <span>
                  {s.label}
                  {s.status || s.owner || s.evidence ? <div className="nx-fg-muted nx-small">{[s.owner, s.status, s.evidence].filter(Boolean).join(' · ')}</div> : null}
                  {s.downtimeHoursPerUnit !== undefined && <div className="nx-fg-muted nx-small">{s.downtimeHoursPerUnit} h downtime per unit{s.appliesTo ? `, ${s.appliesTo}` : ''}</div>}
                </span>
                <span className="num">
                  {s.date ? <><Num f={s.date} use="p50" /> <span className="nx-fg-muted nx-small">{rangeText(s.date, 'short')}</span></> : <span className="nx-fg-muted">Past the volume plan</span>}
                  {' '}<span className="nx-fg-muted nx-small">{Math.round(s.criticalShare * 100)}% sets it</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!est && t && <PendingCard>The timeline check ran, but no date could be placed.</PendingCard>}
    </>
  );
}

const pctText = (p: number) => `${Math.round(p * 100)}%`;

function SupplyCheck({ a }: { a: ImpactAssessment }) {
  const s = a.supply;
  const state = a.checks.find(x => x.id === 'supply')?.state;
  if (!s) return <PendingCard>{state === 'attention' ? 'The supply check has no result to show; the summary above says why.' : 'Supply risk comes from the supply check, which has not produced a result yet.'}</PendingCard>;
  const d = s.detail;
  return (
    <>
      {d?.stale && <Flash variant="warning" className="nx-flash"><b>{staleNote(d.stale)}</b> The supply page below is the previous revision&rsquo;s.</Flash>}
      {d && <Flags flags={d.flags} />}
      <div className="nx-stats">
        <Stat label={<>Supply risk <MockTag on={a.mock.includes('supply')} /></>} sub={s.note}>
          <Mark ev={s.evidence} id={s.id}><Label variant={RISK[s.level]} size="large">{cap(s.level)}</Label></Mark>
        </Stat>
        {s.likelihood && (
          <Stat label="Likelihood" sub={d ? `Stated effectivity: ${d.stated}` : 'Outages are shown as scenarios, not blended into the range'}>
            <Mark ev="computation" id={d ? 's4:p_miss' : s.id}><b>{cap(s.likelihood.word)}</b> {s.likelihood.event}</Mark>
          </Stat>
        )}
        {d?.missWithPeers && (
          <Stat label="With the other open ECRs" sub="Shared suppliers also compete for qualification slots and capacity">
            <Mark ev="computation" id="s4:p_miss_peers">{pctText(d.missWithPeers.likelihood.probability)} {d.missWithPeers.likelihood.event}</Mark>
          </Stat>
        )}
        {d?.spend && (
          <Stat label="Spend on the changed parts, first year" sub={`${rangeText(d.spend.yearOne, 'short')} · ${usd(d.spend.singleSource.p50)} of it on single-source parts`}>
            <Num f={d.spend.yearOne} use="p50" />
          </Stat>
        )}
      </div>
      {d && d.parts.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">Parts <span className="nx-fg-muted">&middot; weeks from order to parts in the building</span></div>
          <ul className="nx-plain">
            {d.parts.map(p => (
              <li key={p.item}>
                <span>
                  <b className="mono">{p.item}</b> {p.name}
                  {p.singleSource && <> <Label variant="attention" size="small">One qualified source</Label></>}
                  <div className="nx-fg-muted nx-small">{[p.supplier, p.sources.length ? `sources: ${p.sources.join(', ')}` : '', p.leadFrom].filter(Boolean).join(' · ')}</div>
                </span>
                <span className="num"><Num f={p.leadWeeks} use="p50" /> <span className="nx-fg-muted nx-small">{rangeText(p.leadWeeks, 'short')}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d && d.capacity.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">Supplier capacity <span className="nx-fg-muted">&middot; this ECR&rsquo;s demand in the 12 months from the cut-in, as a share of a year</span></div>
          <ul className="nx-plain">
            {d.capacity.map(c => (
              <li key={c.constraint}>
                <span>{c.supplier} <span className="nx-fg-muted">&middot; {c.constraint}, {c.perYear.toLocaleString('en-US')} a year</span></span>
                <span className="num"><Num f={c.utilization} use="p50" />{c.withPeers && <span className="nx-fg-muted nx-small"> · <Num f={c.withPeers} use="p50" /> with the other open ECRs</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d && (d.peers.length > 0 || d.peerCutInShift || d.bundles.length > 0 || d.unrelatedPeers.length > 0) && (
        <div className="nx-box">
          <div className="nx-box-title">Other open ECRs</div>
          <ul className="nx-plain">
            {d.peers.map(p => <li key={p.ecr}><span><b className="mono">{p.ecr}</b> shares {p.sharedSuppliers.join(', ')}</span></li>)}
            {d.peerCutInShift && (
              <li>
                <span>Moves this cut-in <span className="nx-fg-muted">&middot; {pctText(d.peerCutInShift.later.probability)} chance it is later</span></span>
                <span className="num"><Num f={d.peerCutInShift.weeks} use="p50" /></span>
              </li>
            )}
            {d.bundles.map(b => (
              <li key={b.constraint}>
                <span>Bundle terms, {b.constraint} <span className="nx-fg-muted">&middot; {pctText(b.bundled.probability)} chance of qualifying within {b.withinWeeks} weeks of another ECR</span></span>
                <span className="num"><Num f={b.ownSaving} use="p50" /> <span className="nx-fg-muted nx-small">this ECR</span></span>
              </li>
            ))}
            {d.unrelatedPeers.length > 0 && <li><span className="nx-fg-muted">No shared supplier: {d.unrelatedPeers.join(', ')}</span></li>}
          </ul>
        </div>
      )}
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
                {s.by && <span className="nx-fg-muted nx-small"> &middot; {s.by}</span>}
                {s.note && <div className="nx-fg-muted nx-small">{s.note}</div>}
              </span>
              <span className="nx-fg-muted">
                {s.state === 'approved' ? `Approved ${s.when ?? ''}` : s.state === 'waiting' ? (s.when ? `Meets ${s.when}` : 'Not decided') : s.state === 'not_required' ? 'Not needed' : s.when ? 'Approval needs a re-check' : 'Needed'}
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
