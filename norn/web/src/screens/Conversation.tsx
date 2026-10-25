import { useState, type ReactNode } from 'react';
import {
  AlertFillIcon, CheckCircleFillIcon, CheckIcon, CircleIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, CommentIcon,
  DotFillIcon, EyeIcon, GraphIcon, NoteIcon, SearchIcon, ShieldCheckIcon, TagIcon,
} from '@primer/octicons-react';
import { AvatarStack, Button, Checkbox, Label, PageLayout, ProgressBar, Spinner, Timeline } from '@primer/react';
import type { ActivityEvent, ErpPackage, EventKind, ImpactAssessment, RiskLevel, StepState } from '../assessment/types.ts';
import { monthLabel } from '../assessment/adapter.ts';
import { DiffTable } from './Changes.tsx';
import { CheckStateIcon, LevelLabel, MockTag, Person, SavedRun, StaleNote } from '../ui/Bits.tsx';
import { BoardIcon, CaliperIcon, CostIcon, GaugeIcon, NcrIcon, ReleaseIcon } from '../ui/EngineeringIcons.tsx';
import { Glyph, Mark, Num } from '../ui/Evidence.tsx';
import { ago, dateTime, dayLabel, dateShort, range as rangeText, usdK } from '../ui/fmt.ts';
import { Link } from '../router.tsx';
import { ApprovalRows, ApproverItems, ErpPackageCard, RecommendationRow, ReleaseFoot } from './GateBox.tsx';
import type { AgentRun, StatementView } from '../assessment/types.ts';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const kindOf = (e: ActivityEvent) => (e.actorKind === 'norn' ? 'norn' : e.actorKind === 'person_agent' ? 'agent' : 'person');

export function Conversation({ a }: { a: ImpactAssessment }) {
  const events = [...a.activity].sort((x, y) => x.at.localeCompare(y.at));
  const filed = events.find(e => e.kind === 'filed');
  const rest = events.filter(e => e !== filed);

  return (
    <PageLayout containerWidth="full" padding="none" columnGap="normal">
      <PageLayout.Content>
        <div className="nx-thread">
          <Timeline clipSidebar>
            {filed && <OpeningComment a={a} filed={filed} />}
            <BotComment a={a} />
            {rest.map(e => <EventItem key={e.id} e={e} mock={a.mock.includes('narrative')} />)}
          </Timeline>
          <MergeBox a={a} />
          {a.erpPackage && <ErpCard pkg={a.erpPackage} mock={a.mock.includes('erp')} />}
          {a.gate && <ErpPackageCard gate={a.gate} />}
        </div>
      </PageLayout.Content>
      <PageLayout.Pane position="end" width="small" padding="none">
        <Sidebar a={a} events={events} />
      </PageLayout.Pane>
    </PageLayout>
  );
}

// ---------------------------------------------------------------- comments

function CommentBox({ name, kind, label, time, edited, children, right }: {
  name: string; kind: 'person' | 'norn' | 'agent'; label?: ReactNode; time: string; edited?: boolean; children: ReactNode; right?: ReactNode;
}) {
  return (
    <div className="nx-comment">
      <div className="nx-comment-head">
        <b>{name}</b>
        {kind === 'norn' && <Label variant="secondary" size="small">Bot</Label>}
        <span className="nx-fg-muted" title={dateTime(time)}>commented {ago(time)}{edited ? ' · edited' : ''}</span>
        <span className="nx-sp" />
        {right}
        {label}
      </div>
      <div className="nx-comment-body">{children}</div>
    </div>
  );
}

function OpeningComment({ a, filed }: { a: ImpactAssessment; filed: ActivityEvent }) {
  return (
    <Timeline.Item className="nx-t-comment">
      <div className="nx-av-col"><Person name={filed.actor} size={40} /></div>
      <Timeline.Body className="nx-t-body">
        <CommentBox name={filed.actor} kind="person" time={filed.at} label={<><MockTag on={a.mock.includes('narrative')} title="Mock: a saved ECR text, not read from the PLM" /> <Label variant="secondary" size="small">Originator</Label></>}>
          {a.body.map(s => (
            <div key={s.heading}>
              <h4 className="nx-h4">{s.heading}</h4>
              <p>{s.text}</p>
            </div>
          ))}
        </CommentBox>
      </Timeline.Body>
    </Timeline.Item>
  );
}

const RISK: Record<RiskLevel, 'success' | 'attention' | 'severe'> = { low: 'success', moderate: 'attention', high: 'severe' };

/** Norn's impact statement, as a bot comment in the manner of Vercel and Codecov. */
function BotComment({ a }: { a: ImpactAssessment }) {
  if (a.statement) return <StatementComment a={a} />;
  const h = a.headline;
  const report = [...a.activity].reverse().find(e => e.kind === 'report');
  return (
    <Timeline.Item className="nx-t-comment">
      <div className="nx-av-col"><Person name="Norn" kind="norn" size={40} /></div>
      <Timeline.Body className="nx-t-body">
        <CommentBox name="Norn" kind="norn" time={a.activity.find(e => e.kind === 'report')?.at ?? a.activity[a.activity.length - 1]?.at ?? ''} edited={a.source !== 'live'} right={a.level ? <LevelLabel level={a.level} long /> : undefined}>
          <h3 className="nx-h3">Impact assessment <SavedRun source={a.source} /></h3>
          {a.ecr.staleCost && <p className="nx-small"><StaleNote state={a.ecr.staleCost} /></p>}
          <table className="nx-bot-table">
            <thead>
              <tr><th /><th>Point estimate</th><th>P10 &ndash; P90</th><th>Likelihood</th></tr>
            </thead>
            <tbody>
              {h.unitCost.map(u => (
                <tr key={u.figure.id}>
                  <td>Unit cost, per {u.program} unit built</td>
                  <td className="num"><Num f={u.figure} plus /></td>
                  <td className="num nx-fg-muted">{rangeText(u.figure, 'full')}</td>
                  <td className="nx-fg-muted">&ndash;</td>
                </tr>
              ))}
              <tr>
                <td>Net cost, first 12 months<div className="nx-fg-muted nx-small">{a.cost.window.label}</div></td>
                <td className="num"><Num f={h.year1} kind="short" plus /></td>
                <td className="num nx-fg-muted">{rangeText(h.year1, 'short')}</td>
                <td>
                  {h.year1Likelihood
                    ? <Mark ev="computation" id={h.year1.id}><b>{cap(h.year1Likelihood.word)}</b> {h.year1Likelihood.event}</Mark>
                    : a.cost.needsEstimate.length > 0
                      ? <span className="nx-fg-muted"><AlertFillIcon size={12} className="nx-fg-attention" /> {a.cost.needsEstimate.length} lines need an estimate</span>
                      : <Pending />}
                </td>
              </tr>
              <tr>
                <td>Cut-in, {a.cutIn.program}{a.cutIn.estimate ? ', as filed' : ''}</td>
                <td className="num"><Mark ev={a.cutIn.source === 'given' ? 'fact' : 'assumption'} id="cutin">{monthLabel(a.cutIn.month)}</Mark></td>
                <td className="nx-fg-muted">S/N {a.cutIn.serial}{a.cutIn.source === 'default' ? ', a default' : ''}</td>
                <td>{a.cutIn.estimate ? <span className="nx-fg-muted">Range: see below</span> : <Pending />}</td>
              </tr>
              {a.cutIn.estimate && (
                <tr>
                  <td>Rev C reaches the line <MockTag on={a.mock.includes('cutInEstimate')} /></td>
                  <td className="num"><Num f={a.cutIn.estimate.figure} use="p50" /></td>
                  <td className="num nx-fg-muted">{rangeText(a.cutIn.estimate.figure, 'short')}</td>
                  <td>
                    {a.cutIn.estimate.likelihood && (
                      <Mark ev="assumption" id={a.cutIn.estimate.figure.id}><b>{cap(a.cutIn.estimate.likelihood.word)}</b> {a.cutIn.estimate.likelihood.event}</Mark>
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td>Supply risk {a.supply && <MockTag on={a.mock.includes('supply')} />}</td>
                {a.supply ? (
                  <>
                    <td><Mark ev={a.supply.evidence} id={a.supply.id}><Label variant={RISK[a.supply.level]}>{cap(a.supply.level)}</Label></Mark></td>
                    <td className="nx-fg-muted">{a.supply.note}</td>
                    <td>{a.supply.likelihood && <Mark ev="computation" id={a.supply.id}><b>{cap(a.supply.likelihood.word)}</b> {a.supply.likelihood.event}</Mark>}</td>
                  </>
                ) : (
                  <td colSpan={3}><Pending /></td>
                )}
              </tr>
            </tbody>
          </table>

          <h4 className="nx-h4">
            {a.recommendation.verdict === 'wait' ? <ClockIcon size={16} className="nx-fg-attention" /> : <ShieldCheckIcon size={16} className="nx-fg-success" />}{' '}
            <Mark ev="judgment" id={a.recommendation.traceId}>{a.recommendation.headline}</Mark>
            <MockTag on={a.mock.includes('recommendation')} />
          </h4>
          <ul className="nx-reasons">
            {a.recommendation.reasons.map((r, i) => (
              <li key={i}>
                <Glyph ev={r.evidence} />
                {r.traceId ? <Mark ev={r.evidence} id={r.traceId} claim>{r.text}</Mark> : <span>{r.text}</span>}
              </li>
            ))}
          </ul>

          {a.drivers.length > 0 && (
            <>
              <h4 className="nx-h4">What moves it most</h4>
              <ol className="nx-drivers">
                {a.drivers.slice(0, 4).map(d => (
                  <li key={d.id}>
                    <Glyph ev={d.evidence} /> <Mark ev={d.evidence} id={d.id} claim>{d.label}</Mark>
                    <span className="nx-fg-muted"> {d.lowLabel && d.highLabel ? `· ${d.lowLabel} to ${d.highLabel} ` : '· '}moves the net cost by </span>
                    <b className="num">{swing(d.low, d.high)}</b>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="nx-fg-muted nx-small">
            {report?.level === 3 ? 'Level 3 replaces the earlier levels. ' : 'Provisional: likely to change. '}
            <Link to={`/ecr/${a.ecr.id}/impact`}>See the impact checks</Link>
          </p>
        </CommentBox>
      </Timeline.Body>
    </Timeline.Item>
  );
}

function Pending() {
  return <span className="nx-fg-muted"><CircleIcon size={12} /> Not assessed yet</span>;
}

function swing(lo: number, hi: number) {
  const d = Math.abs(hi - lo);
  return d >= 1e6 ? `$${(d / 1e6).toFixed(2)}M` : d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${Math.round(d)}`;
}

// ---------------------------------------------------------------- events

type BadgeSpec = { icon: ReactNode; variant?: 'success' | 'danger' | 'done' | 'attention' | 'accent' };
const BADGE: Partial<Record<EventKind, BadgeSpec>> = {
  ran_checks: { icon: <GaugeIcon /> },
  label: { icon: <TagIcon /> },
  review_requested: { icon: <EyeIcon /> },
  report: { icon: <GraphIcon /> },
  approved: { icon: <CheckIcon />, variant: 'success' },
  changes_requested: { icon: <CaliperIcon />, variant: 'danger' },
  comment: { icon: <CommentIcon /> },
  research: { icon: <SearchIcon /> },
  policy: { icon: <ShieldCheckIcon />, variant: 'done' },
};

/** Whom an agent acted for: the person it was started on behalf of. */
function forWho(e: ActivityEvent): string | undefined {
  return e.onBehalfOf ?? (e.spawnedBy?.startsWith('Norn, for ') ? e.spawnedBy.slice('Norn, for '.length) : undefined);
}

/** `mock`: the timeline is a saved fixture, so a step marked running is not happening now. */
function EventItem({ e, mock }: { e: ActivityEvent; mock: boolean }) {
  const b: BadgeSpec = BADGE[e.kind ?? 'comment'] ?? { icon: <NoteIcon /> };
  return (
    <Timeline.Item>
      <Timeline.Badge variant={b.variant}>{e.state === 'running' ? <ClockIcon /> : b.icon}</Timeline.Badge>
      <Timeline.Body>
        <div className="nx-ev">
          <Person name={e.actor} kind={kindOf(e)} size={16} />
          <span>
            <b>{e.actor}</b>
            {forWho(e) && <span className="nx-fg-muted"> for {forWho(e)}</span>}
            {' '}{e.text}
            {mock && <> <MockTag title="Mock: a saved timeline entry, not an event in Norn" /></>}
            {e.level && <> <LevelLabel level={e.level} /></>}
            {e.reportedByAgent && <> <Label variant="attention" size="small">Reported by agent</Label></>}
            {e.superseded && <> <Label variant="secondary" size="small">Superseded</Label></>}
            {' '}<span className="nx-fg-muted" title={dateTime(e.at)}>{e.state === 'running' && !mock ? 'now' : ago(e.at)}</span>
          </span>
        </div>
        {e.detail && <div className="nx-ev-detail">{e.detail}</div>}
        {e.run && <AgentLog run={e.run} />}
      </Timeline.Body>
    </Timeline.Item>
  );
}

// ---------------------------------------------------------------- the approval box

function MergeRow({ icon, title, sub, children, open, onToggle }: {
  icon: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode; open?: boolean; onToggle?: () => void;
}) {
  const head = (
    <>
      <span className="nx-merge-icon">{icon}</span>
      <span className="nx-merge-text">
        <b>{title}</b>
        {sub && <span className="nx-fg-muted">{sub}</span>}
      </span>
      {onToggle && (open ? <ChevronDownIcon className="nx-fg-muted" /> : <ChevronRightIcon className="nx-fg-muted" />)}
    </>
  );
  return (
    <div className="nx-merge-row">
      {onToggle ? <button type="button" className="nx-merge-head" onClick={onToggle} aria-expanded={open}>{head}</button> : <div className="nx-merge-head">{head}</div>}
      {open && children}
    </div>
  );
}

function MergeBox({ a }: { a: ImpactAssessment }) {
  const [open, setOpen] = useState(false);
  const steps = a.route.steps;
  const reviewers = steps.filter(s => s.role !== 'CCB' && s.state !== 'not_required');
  const done = reviewers.filter(s => s.state === 'approved').length;
  const ccb = steps.find(s => s.role === 'CCB');
  const decided = a.ecr.status === 'Approved' || a.ecr.status === 'ECO released';
  const bad = a.checks.filter(c => c.state === 'attention').length;
  const ok = a.checks.filter(c => c.state === 'passed').length;
  const working = a.checks.filter(c => c.state === 'queued' || c.state === 'running').length;
  const waiting = a.recommendation.verdict === 'wait' || a.recommendation.verdict === 'none';
  const noStatement = a.recommendation.verdict === 'none' && !a.statement;

  return (
    <section className="nx-merge" aria-label="Approval">
      <MergeRow
        icon={working ? <Spinner size="medium" /> : bad ? <AlertFillIcon size={24} className="nx-fg-attention" /> : <CheckCircleFillIcon size={24} className="nx-fg-success" />}
        title={working ? `${working} impact check${working > 1 ? 's are' : ' is'} queued or running` : bad ? `${bad} impact check${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} attention` : ok === a.checks.length ? 'All impact checks have passed' : 'Impact checks not complete'}
        sub={<>{`${ok} passed${bad ? `, ${bad} need attention` : ''}${working ? `, ${working} waiting` : ''}`}{a.ecr.staleCost && <> &middot; <StaleNote state={a.ecr.staleCost} /></>}</>}
        open={open}
        onToggle={() => setOpen(o => !o)}
      >
        <ul className="nx-merge-checks">
          {a.checks.map(c => (
            <li key={c.id}>
              <CheckStateIcon state={c.state} />
              <b>{c.name}</b>
              <span className="nx-fg-muted nx-trunc">{c.summary}</span>
              <Link to={`/ecr/${a.ecr.id}/impact/${c.id}`} className="nx-details">Details</Link>
            </li>
          ))}
        </ul>
      </MergeRow>

      {a.gate?.approvals.length ? <ApprovalRows gate={a.gate} released={a.ecr.status === 'ECO released'} /> : decided ? (
        <MergeRow
          icon={a.ecr.status === 'ECO released' ? <ReleaseIcon size={24} className="nx-fg-done" /> : <CheckCircleFillIcon size={24} className="nx-fg-success" />}
          title={a.ecr.status === 'ECO released' ? 'ECO released' : 'Approved'}
          sub={ccb && ccb.state === 'not_required' ? 'Within Norn’s limits, no CCB needed' : 'The CCB approved this ECR'}
        />
      ) : (
        <MergeRow
          icon={<DotFillIcon size={24} className="nx-fg-attention" />}
          title={<>Review required <MockTag on={!!a.gate && a.mock.includes('route')} /></>}
          sub={`${ccb ? 'CCB approval needed' : 'Approval needed'} · ${done} of ${reviewers.length} approved`}
        >
          <div className="nx-merge-bar"><ProgressBar barSize="small" progress={reviewers.length ? (done / reviewers.length) * 100 : 0} aria-label="Approvals" /></div>
        </MergeRow>
      )}

      <MergeRow
        icon={waiting ? <ClockIcon size={24} className="nx-fg-attention" /> : <ShieldCheckIcon size={24} className="nx-fg-success" />}
        title={noStatement ? 'Waiting for Norn\u2019s impact statement' : <><Mark ev="judgment" id={a.recommendation.traceId}>{a.recommendation.headline}</Mark> <MockTag on={a.mock.includes('recommendation')} /></>}
        sub={a.statement ? a.statement.headline : a.recommendation.reasons[0]?.text}
      />

      {a.gate?.recommendation && <RecommendationRow rec={a.gate.recommendation} />}

      {!decided && (
        <div className="nx-merge-foot">
          <Button variant="primary" disabled leadingVisual={ReleaseIcon}>Release ECO</Button>
          <span className="nx-fg-muted">
            {ccb?.when ? `Waiting for the CCB on ${ccb.when}` : 'Waiting for approvals'}
          </span>
        </div>
      )}
      {a.gate && a.ecr.status === 'Approved' && <ReleaseFoot gate={a.gate} />}
    </section>
  );
}

// ---------------------------------------------------------------- sidebar

function StepIcon({ state }: { state: StepState }) {
  if (state === 'approved') return <CheckIcon size={16} className="nx-fg-success" aria-label="Approved" />;
  if (state === 'not_required') return <span className="nx-fg-muted nx-small">Not needed</span>;
  return <DotFillIcon size={16} className="nx-fg-attention" aria-label="Review pending" />;
}

function Sidebar({ a, events }: { a: ImpactAssessment; events: ActivityEvent[] }) {
  const e = a.ecr;
  const steps = a.route.steps;
  const reviewers = steps.filter(s => s.role !== 'CCB' && s.state !== 'not_required');
  const done = reviewers.filter(s => s.state === 'approved').length;
  const pct = a.gate?.approvals.length ? (a.gate.approvals.some(x => x.state !== 'withdrawn') ? 100 : 0) : reviewers.length ? (done / reviewers.length) * 100 : 100;
  const people = [...new Map(events.map(x => [x.actor, x])).values()].slice(0, 8);

  return (
    <aside className="nx-side">
      <section>
        <h3>Approvers <MockTag on={a.mock.includes('route') && !a.gate?.approvals.length} /></h3>
        <ul className="nx-side-list">
          {a.gate?.approvals.length ? <ApproverItems gate={a.gate} /> : steps.map((s, i) => (
            <li key={i}>
              {s.role === 'CCB'
                ? <BoardIcon size={20} />
                : <Person name={s.person ?? s.role} kind={s.person === 'Norn' ? 'norn' : 'person'} size={20} />}
              <span className="nx-side-name">{s.role === 'CCB' ? 'Change Control Board' : s.person}</span>
              <span className="nx-side-trail"><StepIcon state={s.state} /></span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Originator</h3>
        <div className="nx-side-one"><Person name={e.originator} size={20} /> <b>{e.originator}</b></div>
      </section>

      <section>
        <h3>Labels</h3>
        <div className="nx-side-labels">
          <Label variant="secondary">Class {e.companyClass}</Label>
          <Label variant="secondary">FAA {e.faa}</Label>
          {e.priority !== 'Routine' && <Label variant="severe">{e.priority}</Label>}
          <Label variant="accent">{e.program}</Label>
          {a.level && <LevelLabel level={a.level} />}
        </div>
      </section>

      <section>
        <h3>Milestone</h3>
        <div className="nx-side-one"><b>{a.meeting.label}</b></div>
        <div className="nx-side-ms">
          <ProgressBar barSize="small" progress={pct} aria-label="Approvals so far" />
          <span className="nx-fg-muted nx-small">{Math.round(pct)}% approved &middot; {dayLabel(a.meeting.date + 'T12:00:00-07:00')}</span>
        </div>
      </section>

      {a.linked.length > 0 && (
        <section>
          <h3>Linked records</h3>
          <ul className="nx-side-list nx-linked">
            {a.linked.map(l => (
              <li key={l.ref}>
                {l.kind === 'NCR' ? <NcrIcon size={16} className={l.state === 'open' ? 'nx-fg-attention' : 'nx-fg-muted'} /> : l.state === 'released' ? <ReleaseIcon size={16} className="nx-fg-done" /> : l.state === 'open' ? <DotFillIcon size={16} className="nx-fg-open" /> : <CheckCircleFillIcon size={16} className="nx-fg-done" />}
                <span><b>{l.ref}</b> <span className="nx-fg-muted">{l.title}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{people.length} participants</h3>
        <AvatarStack>
          {people.map(p => <Person key={p.actor} name={p.actor} kind={kindOf(p)} size={24} />)}
        </AvatarStack>
      </section>
    </aside>
  );
}

/**
 * What Norn hands over when an ECO is released: the lines to enter in the ERP, laid out like the files
 * of a diff. A person enters them in ERPNext and ticks each off; nothing here writes to the ERP.
 */
function ErpCard({ pkg, mock }: { pkg: ErpPackage; mock: boolean }) {
  const [entered, setEntered] = useState<Record<number, boolean>>({});
  const n = pkg.lines.filter((_, i) => entered[i]).length;
  return (
    <section className="nx-erp" aria-label="ERP change package">
      <header className="nx-erp-head">
        <CostIcon size={16} />
        <b>ERP change package</b>
        <MockTag on={mock} />
        <span className="nx-fg-muted">Lines for a person to enter in {pkg.system}</span>
        <span className="nx-sp" />
        <Label variant={n === pkg.lines.length ? 'success' : 'secondary'}>{n} of {pkg.lines.length} entered</Label>
      </header>
      {pkg.lines.map((l, i) => (
        <div className="nx-erp-line" key={i}>
          <div className="nx-erp-line-head">
            <Checkbox checked={!!entered[i]} onChange={e => setEntered(x => ({ ...x, [i]: e.target.checked }))} aria-label={`Mark "${l.title}" as entered in ${pkg.system}`} />
            <Label variant="secondary">{l.kind}</Label>
            <b>{l.title}</b>
            <span className="nx-sp" />
            <Label variant={entered[i] ? 'success' : 'attention'}>{entered[i] ? 'Entered' : l.status}</Label>
          </div>
          <DiffTable lines={l.diff} />
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- a live impact statement

const fmtNumber = (n: StatementView['numbers'][number], x: number) =>
  n.unit === 'USD' ? (Math.abs(x) >= 1000 ? usdK(x) : `$${x.toFixed(2)}`) : `${Math.round(x * 100) / 100}${n.unit ? ` ${n.unit}` : ''}`;

/** Norn's newest impact statement, as posted: the agent narrates, every number carries how it is known. */
function StatementComment({ a }: { a: ImpactAssessment }) {
  const st = a.statement!;
  return (
    <Timeline.Item className="nx-t-comment">
      <div className="nx-av-col"><Person name="Norn" kind="norn" size={40} /></div>
      <Timeline.Body className="nx-t-body">
        <CommentBox name={st.author} kind="norn" time={st.at} right={<LevelLabel level={st.level} long />}>
          <h3 className="nx-h3">
            Impact assessment <SavedRun source={a.source} />
            {st.outdated && <> <Label variant="attention" size="small">Out of date: the ECR has changed since</Label></>}
          </h3>
          <p className="nx-stmt-headline">{st.headline}</p>
          <table className="nx-bot-table">
            <thead>
              <tr><th /><th>Median</th><th>P10 &ndash; P90</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {st.numbers.map(n => (
                <tr key={n.key}>
                  <td>{n.label}</td>
                  <td className="num">{n.traceId ? <Mark ev={n.evidence} id={n.traceId}>{fmtNumber(n, n.p50)}</Mark> : fmtNumber(n, n.p50)}</td>
                  <td className="num nx-fg-muted">{n.p10 !== n.p90 ? `${fmtNumber(n, n.p10)} \u2013 ${fmtNumber(n, n.p90)}` : 'exact'}</td>
                  <td className="nx-fg-muted"><Glyph ev={n.evidence} /> {cap(n.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {st.numbersNote && <p className="nx-fg-muted nx-small">{st.numbersNote}</p>}
          <div className="nx-stmt-line">
            <b>Change class</b> <Mark ev="judgment" id="stmt-class">{st.changeClass}</Mark>
            <span className="nx-fg-muted"> &middot; route: {st.route}</span>
          </div>
          {st.drivers.length > 0 && (
            <>
              <h4 className="nx-h4">What moves it most</h4>
              <ul className="nx-reasons">
                {st.drivers.map((d, i) => (
                  <li key={i}><Glyph ev={d.evidence} /><Mark ev={d.evidence} id={d.traceId!} claim>{d.text}</Mark></li>
                ))}
              </ul>
            </>
          )}
          {st.claims.length > 0 && (
            <>
              <h4 className="nx-h4">What Norn concludes</h4>
              <ul className="nx-reasons">
                {st.claims.map((c, i) => (
                  <li key={i}><Glyph ev={c.evidence} /><Mark ev={c.evidence} id={c.traceId!} claim>{c.text}</Mark></li>
                ))}
              </ul>
            </>
          )}
          {st.assumptions.length > 0 && (
            <>
              <h4 className="nx-h4">Assumptions it rests on</h4>
              <ul className="nx-reasons">
                {st.assumptions.map(x => (
                  <li key={x.key}>
                    <Glyph ev="assumption" />
                    <span>
                      {x.traceId ? <Mark ev="assumption" id={x.traceId} claim>{x.label}</Mark> : x.label}
                      <span className="nx-fg-muted"> &middot; {x.source === 'agent_estimated' ? 'agent estimate' : x.source}. {x.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="nx-fg-muted nx-small">
            Posted by {st.author}. <Link to={`/ecr/${a.ecr.id}/impact`}>See the impact checks</Link>
          </p>
        </CommentBox>
      </Timeline.Body>
    </Timeline.Item>
  );
}

// ---------------------------------------------------------------- a Norn agent at work

const LOG_ICON = { start: '\u25b6', text: '\u00b7', tool: '\u203a', result: '\u2713', end: '\u25a0' } as const;

/** An agent's steps as the runner reports them, laid out like a build log: open while it runs. */
function AgentLog({ run }: { run: AgentRun }) {
  const elapsed = (iso: string) => {
    const t = Math.max(0, (Date.parse(iso) - Date.parse(run.startedAt)) / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  };
  return (
    <details className="nx-log" open={run.state === 'running'}>
      <summary>
        {run.state === 'running' ? <Spinner size="small" /> : run.state === 'done' ? <CheckCircleFillIcon size={14} className="nx-fg-success" /> : <AlertFillIcon size={14} className="nx-fg-danger" />}
        <b>{run.title}</b>
        <span className="nx-fg-muted">{run.state === 'running' ? 'running' : run.state === 'done' ? 'finished' : 'stopped'} &middot; {run.lines.length} steps</span>
      </summary>
      <ol className="nx-log-lines">
        {run.lines.map((l, i) => (
          <li key={i} className={`${l.kind} ${l.error ? 'err' : ''}`}>
            <span className="t">{elapsed(l.at)}</span>
            <span className="i">{l.error ? '\u2715' : LOG_ICON[l.kind]}</span>
            <span className="x">{l.text}</span>
          </li>
        ))}
        {run.state === 'running' && (
          <li className="run"><span className="t" /><span className="i"><Spinner size="small" /></span><span className="x">working</span></li>
        )}
      </ol>
    </details>
  );
}
