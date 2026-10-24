import { useState, type ReactNode } from 'react';
import {
  AlertFillIcon, CheckCircleFillIcon, CheckIcon, ChecklistIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, CommentIcon,
  DotFillIcon, EyeIcon, FileDiffIcon, GitMergeIcon, GraphIcon, NoteIcon, PackageIcon, SearchIcon, ShieldCheckIcon, TagIcon,
} from '@primer/octicons-react';
import { AvatarStack, Button, Label, PageLayout, ProgressBar, Timeline } from '@primer/react';
import type { ActivityEvent, EventKind, ImpactAssessment, RiskLevel, StepState } from '../assessment/types.ts';
import { CheckStateIcon, LevelLabel, Person } from '../ui/Bits.tsx';
import { Glyph, Mark, Num } from '../ui/Evidence.tsx';
import { ago, dateTime, dayLabel, range as rangeText } from '../ui/fmt.ts';
import { Link } from '../router.tsx';

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
            {rest.map(e => <EventItem key={e.id} e={e} />)}
          </Timeline>
          <MergeBox a={a} />
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
        <CommentBox name={filed.actor} kind="person" time={filed.at} label={<Label variant="secondary" size="small">Originator</Label>}>
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
  const h = a.headline;
  const report = [...a.activity].reverse().find(e => e.kind === 'report');
  return (
    <Timeline.Item className="nx-t-comment">
      <div className="nx-av-col"><Person name="Norn" kind="norn" size={40} /></div>
      <Timeline.Body className="nx-t-body">
        <CommentBox name="norn" kind="norn" time={a.activity.find(e => e.kind === 'report')?.at ?? ''} edited right={<LevelLabel level={a.level} long />}>
          <h3 className="nx-h3">Impact assessment</h3>
          <table className="nx-bot-table">
            <thead>
              <tr><th /><th>Median</th><th>P10 &ndash; P90</th><th>Likelihood</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Unit cost, per aircraft</td>
                <td className="num"><Num f={h.unitCost} plus /></td>
                <td className="num nx-fg-muted">{rangeText(h.unitCost, 'short')}</td>
                <td className="nx-fg-muted">&ndash;</td>
              </tr>
              <tr>
                <td>Year-1 total, {a.cost.yearLabel}</td>
                <td className="num"><Num f={h.year1} kind="short" plus /></td>
                <td className="num nx-fg-muted">{rangeText(h.year1, 'short')}</td>
                <td><Mark ev="computation" id={h.year1.id}><b>{cap(h.year1Likelihood.word)}</b> {h.year1Likelihood.event}</Mark></td>
              </tr>
              <tr>
                <td>Cut-in</td>
                <td className="num"><Num f={h.cutIn} /></td>
                <td className="num nx-fg-muted">{rangeText(h.cutIn, 'short')}</td>
                <td><Mark ev="computation" id={h.cutIn.id}><b>{cap(h.cutInLikelihood.word)}</b> {h.cutInLikelihood.event}</Mark></td>
              </tr>
              <tr>
                <td>Supply risk</td>
                <td><Mark ev={h.supply.evidence} id={h.supply.id}><Label variant={RISK[h.supply.level]}>{cap(h.supply.level)}</Label></Mark></td>
                <td className="nx-fg-muted" colSpan={1}>{h.supply.note}</td>
                <td><Mark ev="computation" id="supply"><b>{cap(h.supply.likelihood.word)}</b> {h.supply.likelihood.event}</Mark></td>
              </tr>
            </tbody>
          </table>

          <h4 className="nx-h4">
            {a.recommendation.verdict === 'wait' ? <ClockIcon size={16} className="nx-fg-attention" /> : <ShieldCheckIcon size={16} className="nx-fg-success" />}{' '}
            <Mark ev="judgment" id={a.recommendation.traceId}>{a.recommendation.headline}</Mark>
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
                {a.drivers.map(d => (
                  <li key={d.id}>
                    <Glyph ev={d.evidence} /> <Mark ev={d.evidence} id={d.id} claim>{d.label}</Mark>
                    <span className="nx-fg-muted"> &middot; {d.lowLabel} to {d.highLabel} moves the year-1 total by </span>
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

function swing(lo: number, hi: number) {
  const d = Math.abs(hi - lo);
  return d >= 1e6 ? `$${(d / 1e6).toFixed(2)}M` : d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${Math.round(d)}`;
}

// ---------------------------------------------------------------- events

type BadgeSpec = { icon: ReactNode; variant?: 'success' | 'danger' | 'done' | 'attention' | 'accent' };
const BADGE: Partial<Record<EventKind, BadgeSpec>> = {
  ran_checks: { icon: <ChecklistIcon /> },
  label: { icon: <TagIcon /> },
  review_requested: { icon: <EyeIcon /> },
  report: { icon: <GraphIcon /> },
  approved: { icon: <CheckIcon />, variant: 'success' },
  changes_requested: { icon: <FileDiffIcon />, variant: 'danger' },
  comment: { icon: <CommentIcon /> },
  research: { icon: <SearchIcon /> },
  policy: { icon: <ShieldCheckIcon />, variant: 'done' },
};

/** Whom an agent acted for: the person it was started on behalf of. */
function forWho(e: ActivityEvent): string | undefined {
  return e.onBehalfOf ?? (e.spawnedBy?.startsWith('Norn, for ') ? e.spawnedBy.slice('Norn, for '.length) : undefined);
}

function EventItem({ e }: { e: ActivityEvent }) {
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
            {e.level && <> <LevelLabel level={e.level} /></>}
            {e.reportedByAgent && <> <Label variant="attention" size="small">Reported by agent</Label></>}
            {' '}<span className="nx-fg-muted" title={dateTime(e.at)}>{e.state === 'running' ? 'now' : ago(e.at)}</span>
          </span>
        </div>
        {e.detail && <div className="nx-ev-detail">{e.detail}</div>}
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
  const waiting = a.recommendation.verdict === 'wait';

  return (
    <section className="nx-merge" aria-label="Approval">
      <MergeRow
        icon={bad ? <AlertFillIcon size={24} className="nx-fg-attention" /> : <CheckCircleFillIcon size={24} className="nx-fg-success" />}
        title={bad ? `${bad} impact check${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} attention` : 'All impact checks have passed'}
        sub={`${ok} passed${bad ? `, ${bad} need attention` : ''}`}
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

      {decided ? (
        <MergeRow
          icon={<GitMergeIcon size={24} className="nx-fg-done" />}
          title={a.ecr.status === 'ECO released' ? 'ECO released' : 'Approved'}
          sub={ccb && ccb.state === 'not_required' ? 'Within Norn’s limits, no CCB needed' : 'The CCB approved this ECR'}
        />
      ) : (
        <MergeRow
          icon={<DotFillIcon size={24} className="nx-fg-attention" />}
          title="Review required"
          sub={`${ccb ? 'CCB approval needed' : 'Approval needed'} · ${done} of ${reviewers.length} approved`}
        >
          <div className="nx-merge-bar"><ProgressBar barSize="small" progress={reviewers.length ? (done / reviewers.length) * 100 : 0} aria-label="Approvals" /></div>
        </MergeRow>
      )}

      <MergeRow
        icon={waiting ? <ClockIcon size={24} className="nx-fg-attention" /> : <ShieldCheckIcon size={24} className="nx-fg-success" />}
        title={<Mark ev="judgment" id={a.recommendation.traceId}>{a.recommendation.headline}</Mark>}
        sub={a.recommendation.reasons[0]?.text}
      />

      {!decided && (
        <div className="nx-merge-foot">
          <Button variant="primary" disabled leadingVisual={PackageIcon}>Release ECO</Button>
          <span className="nx-fg-muted">
            {ccb?.when ? `Waiting for the CCB on ${ccb.when}` : 'Waiting for approvals'}
          </span>
        </div>
      )}
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
  const pct = reviewers.length ? (done / reviewers.length) * 100 : 100;
  const people = [...new Map(events.map(x => [x.actor, x])).values()].slice(0, 8);

  return (
    <aside className="nx-side">
      <section>
        <h3>Approvers</h3>
        <ul className="nx-side-list">
          {steps.map((s, i) => (
            <li key={i}>
              {s.role === 'CCB'
                ? <Person name="CCB" kind="team" size={20} />
                : <Person name={s.person ?? s.role} kind={s.person === 'Norn' ? 'norn' : 'person'} size={20} />}
              <span className="nx-side-name">{s.role === 'CCB' ? 'bowman-aviation/ccb' : s.person}</span>
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
                {l.state === 'released' ? <GitMergeIcon size={16} className="nx-fg-done" /> : l.state === 'open' ? <DotFillIcon size={16} className="nx-fg-open" /> : <CheckCircleFillIcon size={16} className="nx-fg-done" />}
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
