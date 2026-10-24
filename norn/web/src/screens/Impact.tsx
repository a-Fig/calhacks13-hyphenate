import { Fragment, useMemo, type ReactNode } from 'react';
import { ActionList, Label, PageLayout, Spinner } from '@primer/react';
import type { Check, CostBlock, CostRow, Evidence, ImpactAssessment } from '../assessment/types.ts';
import { monthLabel } from '../assessment/adapter.ts';
import { CheckStateIcon, MockTag, SavedRun } from '../ui/Bits.tsx';
import { CaliperIcon, CcbTableIcon, CrateIcon, GaugeIcon, SerialPlateIcon } from '../ui/icons.tsx';
import { SCurveChart, TornadoChart } from '../ui/Charts.tsx';
import { EV_ORDER, Glyph, Legend, Mark, Num } from '../ui/Evidence.tsx';
import { fig as figText, range as rangeText, usd, usdK } from '../ui/fmt.ts';
import { navigate } from '../router.tsx';
import { figureIndex } from '../ui/trace.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const CHECK_ICON: Record<Check['id'], ReactNode> = {
  cost: <GaugeIcon size={15} className="nx-fg-muted" />,
  timeline: <SerialPlateIcon size={15} className="nx-fg-muted" />,
  supply: <CrateIcon size={15} className="nx-fg-muted" />,
  bom: <CaliperIcon size={15} className="nx-fg-muted" />,
  class: <CcbTableIcon size={15} className="nx-fg-muted" />,
};

export function Impact({ a, check }: { a: ImpactAssessment; check?: string }) {
  const id = (a.checks.find(c => c.id === check)?.id ?? 'cost') as Check['id'];
  const picked = a.checks.find(c => c.id === id) ?? a.checks[0];

  const counts = useMemo(() => {
    const out: Record<Evidence, number> = { fact: 0, assumption: 0, computation: 0, judgment: 0 };
    for (const f of figureIndex(a).values()) out[f.evidence]++;
    for (const d of a.drivers) out[d.evidence]++;
    for (const r of a.recommendation.reasons) out[r.evidence]++;
    out[a.changeClass.evidence]++;
    return out;
  }, [a]);

  return (
    <PageLayout containerWidth="full" padding="none" columnGap="normal">
      <PageLayout.Pane position="start" width="small" padding="none" divider="line">
        <div className="nx-checks nx-checks-pane">
          <div className="nx-checks-head">Impact checks</div>
          <ActionList variant="full">
            {a.checks.map(c => (
              <ActionList.Item key={c.id} active={c.id === id} onSelect={() => navigate(`/ecr/${a.ecr.id}/impact/${c.id}`)}>
                <ActionList.LeadingVisual><CheckStateIcon state={c.state} /></ActionList.LeadingVisual>
                <span className="nx-check-item-title">{CHECK_ICON[c.id]} {c.name}</span>
                {c.mock && <MockTag title="Mock compute: this stage is a placeholder" />}
                <ActionList.Description variant="block">{c.summary}</ActionList.Description>
              </ActionList.Item>
            ))}
          </ActionList>
        </div>
      </PageLayout.Pane>

      <PageLayout.Content>
        <div className="nx-check-body">
          <header className="nx-check-title">
            <CheckStateIcon state={picked.state} size={20} />
            {CHECK_ICON[picked.id]}
            <h2>{picked.name}</h2>
            {picked.id === 'cost' || picked.id === 'bom' ? <SavedRun source={a.source} /> : null}
            {picked.mock && <MockTag title="Mock compute: this stage is a placeholder, and its numbers are made up" />}
            {picked.by && <span className="nx-fg-muted">{picked.by}{picked.took ? ` \u00b7 ${picked.took}` : ''}</span>}
            <span className="nx-sp" />
            <Legend counts={EV_ORDER.some(k => counts[k] > 0) ? counts : undefined} />
          </header>

          {id === 'cost' && <CostCheck a={a} />}
          {id === 'timeline' && <TimelineCheck a={a} />}
          {id === 'supply' && <SupplyCheck a={a} />}
          {id === 'bom' && <BomCheck a={a} />}
          {id === 'class' && <ClassCheck a={a} />}
        </div>
      </PageLayout.Content>
    </PageLayout>
  );
}

// ---------------------------------------------------------------- Cost check

const BLOCK_NAME: Record<CostBlock, string> = {
  production: 'I. Production',
  retrofit: 'II. Retrofit',
  logisticsSupport: 'III. Operations & support',
  other: 'IV. Other costs & savings',
};
const BLOCKS: CostBlock[] = ['production', 'retrofit', 'logisticsSupport', 'other'];

function CostCheck({ a }: { a: ImpactAssessment }) {
  const h = a.headline;
  return (
    <div className="nx-sections">
      <div className="nx-stats">
        <div className="nx-stat">
          <div className="nx-stat-label">Net cost, first 12 months ({a.cost.window.label})</div>
          <div className="nx-stat-value num"><Num f={h.year1} kind="short" plus /></div>
          <div className="nx-stat-sub num">
            {h.year1.point !== undefined && h.year1.point !== h.year1.p50 && <>Median <Num f={h.year1} kind="short" plus use="p50" /> &middot; </>}
            P10 to P90: {rangeText(h.year1, 'short') || 'exact'}
          </div>
          {h.year1Likelihood && (
            <div className="nx-stat-sub">
              <Mark ev="computation" id={h.year1.id}><b>{cap(h.year1Likelihood.word)}</b> ({Math.round(h.year1Likelihood.probability * 100)}%) {h.year1Likelihood.event}</Mark>
            </div>
          )}
        </div>
        {h.unitCost.map(u => (
          <div className="nx-stat" key={u.figure.id}>
            <div className="nx-stat-label">Unit cost, per {u.program} unit built</div>
            <div className="nx-stat-value num"><Num f={u.figure} plus /></div>
            <div className="nx-stat-sub">{u.note ?? (rangeText(u.figure, 'full') ? `P10 to P90: ${rangeText(u.figure, 'full')}` : 'Exact from quote')}</div>
          </div>
        ))}
      </div>

      {a.sCurve && (
        <div className="nx-box">
          <div className="nx-box-title">
            Cumulative probability of the first-12-months cost
            <span className="nx-fg-muted nx-small">Read across from a probability to see the cost at that confidence</span>
          </div>
          <div className="nx-box-pad"><SCurveChart data={a.sCurve} /></div>
        </div>
      )}

      {a.drivers.length > 0 && (
        <div className="nx-box">
          <div className="nx-box-title">
            What moves the first-12-months cost most
            <span className="nx-fg-muted nx-small">Each input alone at its P10 and P90; click a bar to see why</span>
          </div>
          <div className="nx-box-pad"><TornadoChart drivers={a.drivers} base={h.year1.point ?? h.year1.p50} /></div>
          {a.scenarios.length > 0 && (
            <div className="nx-scenarios">
              {a.scenarios.map((s, i) => (
                <div key={i}><b>{s.label}:</b> <span className="nx-fg-muted">{s.effect}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      <CostTable a={a} />
    </div>
  );
}

function CostTable({ a }: { a: ImpactAssessment }) {
  const c = a.cost;
  const sub = new Map(c.subtotals.map(s => [s.block, s.total]));

  const cell = (r: CostRow, side: 'one' | 'rec') => {
    if ((side === 'rec') !== r.recurring) return <td className="num nx-fg-muted">&ndash;</td>;
    if (r.needsEstimate) return <td className="num"><Mark ev={r.total.evidence} id={r.total.id}><Label variant="attention" size="small">Needs estimate</Label> $0</Mark></td>;
    const rg = rangeText(r.total, 'full');
    return (
      <td className="num">
        <Num f={r.total} />
        {rg && <div className="nx-range">{rg}</div>}
      </td>
    );
  };

  return (
    <div className="nx-box">
      <div className="nx-box-title">
        Cost breakdown (MIL-HDBK-61A App. B)
        <span className="nx-fg-muted nx-small">Point estimates add up down the column; P10 &ndash; P90 come from {c.run.draws.toLocaleString('en-US')} draws &middot; {c.window.label}</span>
      </div>
      <table className="nx-cost-table">
        <thead>
          <tr>
            <th>Element</th>
            <th className="r">Unit / rate</th>
            <th className="r">Units</th>
            <th className="r">One-time</th>
            <th className="r">Recurring (12 mo)</th>
            <th>Basis</th>
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map(b => {
            const rows = c.rows.filter(r => r.block === b);
            const tot = sub.get(b);
            if (!rows.length || !tot) return null;
            return (
              <Fragment key={b}>
                <tr className="nx-block-row">
                  <td colSpan={3}>{BLOCK_NAME[b]}</td>
                  <td colSpan={2} className="num">
                    Subtotal <Num f={tot} />
                    {rangeText(tot, 'full') && <span className="nx-fg-muted"> ({rangeText(tot, 'full')})</span>}
                  </td>
                  <td />
                </tr>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="nx-row-label">{r.label}</div>
                      {r.note && <div className="nx-fg-muted nx-small">{r.note}</div>}
                    </td>
                    <td className="num">{r.unitCost ? <Num f={r.unitCost} plus={r.id.startsWith('unit_cost')} /> : <span className="nx-fg-muted">&ndash;</span>}</td>
                    <td className="num nx-fg-muted">{r.quantity ?? '\u2013'}</td>
                    {cell(r, 'one')}
                    {cell(r, 'rec')}
                    <td className="nx-fg-muted nx-small">{r.basis ?? '\u2013'}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>One-time total / 12-month recurring total</td>
            <td className="num"><Num f={c.oneTime} /></td>
            <td className="num"><Num f={c.recurring} /></td>
            <td />
          </tr>
          <tr className="nx-net-row">
            <td colSpan={3}>Net total, first 12 months ({c.window.label})</td>
            <td colSpan={2} className="num">
              <Num f={c.net} plus />
              {c.net.point !== undefined && c.net.point !== c.net.p50 && (
                <span className="nx-fg-muted nx-small"> &middot; median {usd(c.net.p50)}</span>
              )}
              {rangeText(c.net, 'full') && (
                <span className="nx-fg-muted nx-small"> &middot; P10 to P90 {rangeText(c.net, 'full')}</span>
              )}
            </td>
            <td className="nx-fg-muted nx-small">
              {c.run.draws > 0 ? `${c.run.draws.toLocaleString('en-US')} draws, \u03c1=${c.run.correlation}, ${c.run.codeVersion}` : c.run.codeVersion}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- the other four checks

function TimelineCheck({ a }: { a: ImpactAssessment }) {
  const c = a.cutIn;
  const check = a.checks.find(x => x.id === 'timeline');
  const waiting = check?.state === 'queued' || check?.state === 'running';
  return (
    <div className="nx-sections">
      <div className="nx-stats">
        <div className="nx-stat">
          <div className="nx-stat-label">Cut-in on {c.program}{c.estimate ? ', as filed' : ''}</div>
          <div className="nx-stat-value num"><Mark ev={c.source === 'given' ? 'fact' : 'assumption'} id="cutin">{monthLabel(c.month)} &middot; S/N {c.serial}</Mark></div>
          <div className="nx-stat-sub">{c.rationale}</div>
        </div>
        <div className="nx-stat">
          <div className="nx-stat-label">When the change reaches the line {c.estimate && <MockTag on={a.mock.includes('cutInEstimate')} />}</div>
          {c.estimate ? (
            <>
              <div className="nx-stat-value num"><Num f={c.estimate.figure} use="p50" /></div>
              <div className="nx-stat-sub num">P10 to P90: {rangeText(c.estimate.figure, 'short')} &middot; {c.estimate.note}</div>
              {c.estimate.likelihood && (
                <div className="nx-stat-sub"><Mark ev="assumption" id={c.estimate.figure.id}><b>{cap(c.estimate.likelihood.word)}</b> ({Math.round(c.estimate.likelihood.probability * 100)}%) {c.estimate.likelihood.event}</Mark></div>
              )}
            </>
          ) : (
            <>
              <div className="nx-stat-value nx-fg-muted">{waiting ? <><Spinner size="small" /> Running</> : 'Not assessed yet'}</div>
              <div className="nx-stat-sub">The cost check uses one fixed cut-in month. A date range needs the timeline check (S3), which is not built yet.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SupplyCheck({ a }: { a: ImpactAssessment }) {
  const s = a.supply;
  const check = a.checks.find(x => x.id === 'supply');
  const waiting = check?.state === 'queued' || check?.state === 'running';
  return (
    <div className="nx-sections">
      <div className="nx-stats">
        <div className="nx-stat">
          <div className="nx-stat-label">Supply risk {s && <MockTag on={a.mock.includes('supply')} />}</div>
          {s ? (
            <>
              <div className="nx-stat-value"><Mark ev={s.evidence} id={s.id}>{cap(s.level)}</Mark></div>
              <div className="nx-stat-sub">{s.note}</div>
              {s.likelihood && (
                <div className="nx-stat-sub"><Mark ev="computation" id={s.id}><b>{cap(s.likelihood.word)}</b> ({Math.round(s.likelihood.probability * 100)}%) {s.likelihood.event}</Mark></div>
              )}
            </>
          ) : (
            <>
              <div className="nx-stat-value nx-fg-muted">{waiting ? <><Spinner size="small" /> Running</> : 'Not assessed yet'}</div>
              <div className="nx-stat-sub">Needs the supply check (S4), which is not built yet.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BomCheck({ a }: { a: ImpactAssessment }) {
  const c = a.checks.find(x => x.id === 'bom');
  return (
    <div className="nx-sections">
      <div className="nx-box">
        <div className="nx-box-title"><CaliperIcon size={15} /> {c?.summary ?? 'BOM delta'}</div>
        <table className="nx-cost-table">
          <thead>
            <tr><th>Item / record</th><th>Change</th><th className="r">Cost effect</th></tr>
          </thead>
          <tbody>
            {a.changes.map(ch => (
              <tr key={ch.id}>
                <td><b>{ch.title}</b></td>
                <td className="nx-fg-muted">{ch.subtitle}</td>
                <td className="num">{ch.impact ?? '\u2013'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClassCheck({ a }: { a: ImpactAssessment }) {
  const c = a.changeClass;
  return (
    <div className="nx-sections">
      <div className="nx-stats">
        <div className="nx-stat">
          <div className="nx-stat-label">Company class <MockTag on={a.mock.includes('class')} /></div>
          <div className="nx-stat-value"><Mark ev={c.evidence} id={c.traceId}>Class {c.company}</Mark></div>
          <div className="nx-stat-sub">{c.companyWhy}</div>
        </div>
        <div className="nx-stat">
          <div className="nx-stat-label">FAA 14 CFR 21.93 <MockTag on={a.mock.includes('class')} /></div>
          <div className="nx-stat-value"><Mark ev={c.evidence} id={c.traceId}>FAA {c.faa}</Mark></div>
          <div className="nx-stat-sub">{c.faaWhy}</div>
        </div>
      </div>
      <div className="nx-box">
        <div className="nx-box-title"><CcbTableIcon size={15} /> Approval route &middot; {a.route.tier} <MockTag on={a.mock.includes('route')} /></div>
        <table className="nx-cost-table">
          <thead><tr><th>Seat</th><th>Person</th><th>Status</th></tr></thead>
          <tbody>
            {a.route.steps.map((s, i) => (
              <tr key={i}>
                <td><b>{s.role}</b></td>
                <td>{s.person ?? '\u2013'}</td>
                <td>
                  <Label variant={s.state === 'approved' ? 'success' : s.state === 'not_required' ? 'secondary' : 'attention'}>
                    {s.state === 'not_required' ? 'Not required' : cap(s.state)}
                  </Label>
                  {s.when && <span className="nx-fg-muted nx-small"> &middot; {s.when}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { usdK };