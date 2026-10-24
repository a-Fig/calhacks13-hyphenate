import { useCallback, useMemo, useState } from 'react';
import type {
  ActivityEvent, CostBlock, CostRow, ImpactAssessment, Likelihood, StepState,
} from '../assessment/types.ts';
import { source } from '../assessment/source.ts';
import { Avatar, LevelBadge, Meter, RangeStrip, StatusChip, StepIcon } from '../ui/Bits.tsx';
import { SCurveChart, TornadoChart } from '../ui/Charts.tsx';
import { evidenceCounts, WhyDrawer } from '../ui/Drawer.tsx';
import { Glyph, Legend, Mark, Num, WhyContext } from '../ui/Evidence.tsx';
import { ago, clock, dayLabel, range as rangeText, usd, usdK } from '../ui/fmt.ts';
import { Link } from '../router.tsx';

const BLOCKS: { id: CostBlock; label: string }[] = [
  { id: 'production', label: 'Production' },
  { id: 'retrofit', label: 'Retrofit' },
  { id: 'logistics', label: 'Logistics support' },
  { id: 'other', label: 'Other' },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function EcrPage({ id }: { id: string }) {
  const a = source.getAssessment(id);
  const summary = source.getSummary(id);
  if (!summary) return <div className="nx-wrap"><p>No ECR {id}.</p></div>;
  if (!a) return <SummaryOnly id={id} />;
  return <AssessmentView a={a} />;
}

function AssessmentView({ a }: { a: ImpactAssessment }) {
  const [stack, setStack] = useState<string[]>([]);
  const open = useCallback((id: string) => setStack(s => (s[s.length - 1] === id ? s : [...s, id])), []);
  const ctx = useMemo(() => ({ open, current: stack[stack.length - 1] ?? null }), [open, stack]);
  const counts = useMemo(() => evidenceCounts(a), [a]);
  const e = a.ecr;
  const h = a.headline;

  return (
    <WhyContext.Provider value={ctx}>
      <div className="nx-wrap">
        <div className="nx-head">
          <div className="top">
            <Link to="/" className="mute">ECRs</Link>
            <span>/</span>
            <span className="id">{e.id}</span>
            <span>&middot; {e.program}</span>
            <span className="nx-sp" />
            <LevelBadge level={a.level} />
          </div>
          <h1>{e.title}</h1>
          <div className="meta">
            <StatusChip status={e.status} />
            {e.priority !== 'Routine' && <span className="nx-chip urgent">{e.priority}</span>}
            <span className="nx-chip plain">Class {e.companyClass}</span>
            <span className="nx-chip plain">FAA {e.faa}</span>
            <span className="by">{e.originator} filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}</span>
          </div>
          <div className="keyrow">
            <Legend counts={counts} />
          </div>
        </div>

        <div className="nx-tiles">
          <Tile label="Unit cost">
            <div className="big num">
              <Num f={h.unitCost} plus />
              <small>per aircraft</small>
            </div>
            <Strip f={h.unitCost} />
            <div className="rng num">{rangeText(h.unitCost, 'short')}</div>
            <div className="note">{h.unitCostNote}</div>
          </Tile>
          <Tile label={`Year 1 total, ${a.cost.yearLabel}`}>
            <div className="big num"><Num f={h.year1} kind="short" plus /></div>
            <Strip f={h.year1} />
            <div className="rng num">{rangeText(h.year1, 'short')}</div>
            <Like l={h.year1Likelihood} id={h.year1.id} className="lik" />
          </Tile>
          <Tile label="Cut-in">
            <div className="big num"><Num f={h.cutIn} /></div>
            <Strip f={h.cutIn} />
            <div className="rng num">{rangeText(h.cutIn, 'short')}</div>
            <Like l={h.cutInLikelihood} id={h.cutIn.id} className="lik" />
            <div className="note" style={{ paddingTop: 6 }}>{h.cutInNote}</div>
          </Tile>
          <Tile label="Supply risk">
            <div className="big"><Mark ev={h.supply.evidence} id={h.supply.id}>{cap(h.supply.level)}</Mark></div>
            <Meter level={h.supply.level} />
            <div className="rng">{h.supply.note}</div>
            <Like l={h.supply.likelihood} id="supply" className="lik" />
          </Tile>
        </div>

        <div className="nx-cols">
          <div className="nx-stack">
            <CostPage a={a} />
            <div className="nx-card">
              <header>
                <h2>Cost range</h2>
                <span className="sub">Chance the {a.cost.yearLabel} total stays under a given cost</span>
              </header>
              <SCurveChart data={a.sCurve} />
            </div>
            <div className="nx-card">
              <header>
                <h2>What moves it most</h2>
                <span className="sub">Each input alone at its P10 and P90</span>
              </header>
              <TornadoChart drivers={a.drivers} base={a.sCurve.pointEstimate.x} />
            </div>
          </div>

          <div className="nx-stack">
            <Decision a={a} />
            {a.scenarios.length > 0 && (
              <div className="nx-card nx-whatif">
                <header><h2>If supply fails</h2></header>
                <div className="nx-pad" style={{ paddingTop: 6 }}>
                  {a.scenarios.map(s => (
                    <div className="it" key={s.label}>
                      <span>{s.label}</span>
                      <b className="num" style={{ fontWeight: 600 }}>{s.effect}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Activity events={a.activity} />
          </div>
        </div>
      </div>
      {stack.length > 0 && (
        <WhyDrawer
          a={a}
          stack={stack}
          onOpen={open}
          onBack={() => setStack(s => s.slice(0, -1))}
          onClose={() => setStack([])}
        />
      )}
    </WhyContext.Provider>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="nx-card nx-tile">
      <div className="lab">{label}</div>
      {children}
    </div>
  );
}

function Strip({ f }: { f: { p10?: number; p50: number; p90?: number; evidence: import('../assessment/types.ts').Evidence } }) {
  if (f.p10 === undefined || f.p90 === undefined) return null;
  return <RangeStrip p10={f.p10} p50={f.p50} p90={f.p90} ev={f.evidence} />;
}

/** "Very likely under $450k": the ICD 203 word first. */
function Like({ l, id, className }: { l: Likelihood; id: string; className?: string }) {
  return (
    <div className={className}>
      <Mark ev="computation" id={id}>
        <b>{cap(l.word)}</b> {l.event}
      </Mark>
    </div>
  );
}

// ---------------------------------------------------------------- the cost page

function CostPage({ a }: { a: ImpactAssessment }) {
  const byBlock = (b: CostBlock) => a.cost.rows.filter(r => r.block === b);
  return (
    <div className="nx-card nx-cost">
      <header>
        <h2>Cost page</h2>
        <span className="sub">{a.cost.yearLabel}, savings in parentheses</span>
      </header>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>One-time</th>
            <th>Recurring</th>
            <th>Total</th>
            <th>P10 &ndash; P90</th>
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map(b => {
            const rows = byBlock(b.id);
            const sub = a.cost.subtotals.find(s => s.block === b.id);
            if (!rows.length || !sub) return null;
            return (
              <FragmentRows key={b.id} label={b.label} rows={rows} sub={sub.total} />
            );
          })}
          <tr className="net">
            <td>Net total, {a.cost.yearLabel}</td>
            <td />
            <td />
            <td><Num f={a.cost.net} /></td>
            <td className="rg num">{rangeText(a.cost.net, 'short')}</td>
          </tr>
        </tbody>
      </table>
      <div className="nx-foot">Totals are simulated on the same draws, so rows do not add up exactly.</div>
    </div>
  );
}

function FragmentRows({ label, rows, sub }: { label: string; rows: CostRow[]; sub: import('../assessment/types.ts').Figure }) {
  return (
    <>
      <tr className="blk">
        <td>{label}</td>
        <td />
        <td />
        <td><Num f={sub} /></td>
        <td className="rg num" style={{ fontWeight: 400 }}>{rangeText(sub, 'short')}</td>
      </tr>
      {rows.map(r => {
        const recurring = !!r.unitCost && !r.oneTime;
        return (
          <tr className="row" key={r.id}>
            <td>
              <div className="lbl">{r.label}</div>
              <div className="nt">
                {r.unitCost && r.quantity !== undefined && (
                  <>
                    <Num f={r.unitCost} /> &times; {r.quantity.toLocaleString('en-US')}
                    {r.note ? ' · ' : ''}
                  </>
                )}
                {r.note}
              </div>
            </td>
            <td className="num">{!recurring ? <Num f={r.total} /> : <span className="dash">&ndash;</span>}</td>
            <td className="num">{recurring ? <Num f={r.total} /> : <span className="dash">&ndash;</span>}</td>
            <td />
            <td className="rg num">{rangeText(r.total, 'full') || <span className="dash">exact</span>}</td>
          </tr>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- the merge box

function Decision({ a }: { a: ImpactAssessment }) {
  const r = a.recommendation;
  const done = a.route.steps.filter(s => s.state === 'approved').length;
  const reviews = a.route.steps.filter(s => s.role !== 'CCB' && s.state !== 'not_required');
  const reviewDone = reviews.filter(s => s.state === 'approved').length;
  const c = a.changeClass;
  const waiting = r.verdict === 'wait';
  void done;
  return (
    <div className="nx-card nx-decide">
      <div className="sec verdict">
        <div className={`check ${waiting ? 'wait' : ''}`}>
          {waiting ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8" cy="8" r="5.8" /><path d="M8 4.8V8l2.2 1.4" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.6 8.4 3 3 5.8-6.2" /></svg>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <h2><Mark ev="judgment" id={r.traceId}>{r.headline}</Mark></h2>
          <ul>
            {r.reasons.map((x, i) => (
              <li key={i}>
                <Glyph ev={x.evidence} />
                {x.traceId ? <Mark ev={x.evidence} id={x.traceId} claim>{x.text}</Mark> : <span>{x.text}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sec">
        <h3>Change class</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Mark ev={c.evidence} id={c.traceId}>Class {c.company}</Mark>
          <span className="mute">&middot;</span>
          <Mark ev={c.evidence} id={c.traceId}>FAA {c.faa}</Mark>
        </div>
        <div className="why">{c.companyWhy}. {c.faaWhy}.</div>
      </div>

      <div className="sec">
        <h3>Approval route</h3>
        <div className="nx-prog" aria-label={`${reviewDone} of ${reviews.length} reviews done`}>
          {reviews.map((s, i) => <i key={i} className={s.state === 'approved' ? 'ok' : ''} />)}
        </div>
        <ul className="nx-steps">
          {a.route.steps.map((s, i) => (
            <li key={i}>
              <StepIcon state={s.state} />
              <div className="who">
                {s.person ?? s.by ?? s.role} <span>&middot; {s.role}</span>
              </div>
              <span className="st">{stepText(s.state, s.when, s.by)}</span>
            </li>
          ))}
        </ul>
        <div className="why">{a.route.tier}</div>
      </div>

      {a.needed.length > 0 && (
        <div className="sec">
          <h3>Still needed</h3>
          <ul className="nx-need">
            {a.needed.map((n, i) => (
              <li key={i}>
                <svg width="16" height="16" viewBox="0 0 16 16" style={{ marginTop: 2, flex: 'none' }} aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="#b9b5aa" strokeWidth="1.6" /></svg>
                <div>
                  {n.text} {n.owner && <span>&middot; {n.owner}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sec">
        <button className="nx-release" type="button" disabled>Release ECO</button>
      </div>
    </div>
  );
}

function stepText(state: StepState, when?: string, by?: string) {
  if (state === 'approved') return when ? `Approved ${when}` : by ? 'Approved' : 'Approved';
  if (state === 'pending') return 'Needed';
  if (state === 'waiting') return when ? `Meets ${when}` : 'Waiting';
  return '';
}

// ---------------------------------------------------------------- agent activity

function Activity({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="nx-card">
      <header>
        <h2>Activity</h2>
        <span className="sub">Who acted, and for whom</span>
      </header>
      <ul className="nx-tl">
        {events.map(ev => (
          <li key={ev.id}>
            {ev.state === 'running' ? (
              <span className="nx-av" style={{ background: 'transparent' }}><span className="nx-spin" /></span>
            ) : (
              <Avatar name={ev.actor} kind={ev.actorKind} />
            )}
            <div className="body">
              <div className="who">
                <b>{ev.actor}</b>
                {(ev.onBehalfOf || ev.spawnedBy) && <span className="for">{ev.onBehalfOf ? `for ${ev.onBehalfOf}` : ev.spawnedBy}</span>}
                <span className="sp" />
                <span className="time" title={`${dayLabel(ev.at)} ${clock(ev.at)}`}>{ev.state === 'running' ? 'Now' : ago(ev.at)}</span>
              </div>
              <div className="what">
                {ev.text}
                {ev.level && <span className="badge">Level {ev.level}</span>}
                {ev.reportedByAgent && <span className="badge">Reported by agent</span>}
              </div>
              {ev.detail && <div className="detail">{ev.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- an ECR without a full page

function SummaryOnly({ id }: { id: string }) {
  const e = source.getSummary(id)!;
  return (
    <div className="nx-wrap">
      <div className="nx-head">
        <div className="top">
          <Link to="/" className="mute">ECRs</Link><span>/</span><span className="id">{e.id}</span><span>&middot; {e.program}</span>
          <span className="nx-sp" />
          {e.level && <LevelBadge level={e.level} />}
        </div>
        <h1>{e.title}</h1>
        <div className="meta">
          <StatusChip status={e.status} />
          <span className="nx-chip plain">Class {e.companyClass}</span>
          <span className="nx-chip plain">FAA {e.faa}</span>
          <span className="by">{e.originator} filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}</span>
        </div>
      </div>
      <div className="nx-card nx-pad" style={{ maxWidth: 640 }}>
        {e.cost && (
          <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }} className="num">
            {usd(e.cost.p50, { plus: true })}
            <div className="mute" style={{ fontSize: 14, fontWeight: 400, letterSpacing: 0 }}>{usdK(e.cost.p10)} &ndash; {usdK(e.cost.p90)} in 2027</div>
          </div>
        )}
        {e.flag && <p style={{ marginTop: 12 }}>{e.flag}</p>}
        <p className="mute" style={{ marginTop: 12, fontSize: 12.5 }}>Mock: ECR-0417, ECR-0409 and ECR-0423 have a full page.</p>
      </div>
    </div>
  );
}
