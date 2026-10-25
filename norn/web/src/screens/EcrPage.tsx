import { Component, useCallback, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { CommentDiscussionIcon } from '@primer/octicons-react';
import { Flash, PageHeader, Spinner, UnderlineNav } from '@primer/react';
import { source, useAssessment } from '../assessment/source.ts';
import type { ImpactAssessment } from '../assessment/types.ts';
import { StateBadge, LevelLabel, RequestNumber, MockTag } from '../ui/Bits.tsx';
import { AircraftIcon, CaliperIcon, GaugeIcon, RevisionIcon } from '../ui/EngineeringIcons.tsx';
import { WhyContext } from '../ui/Evidence.tsx';
import { WhyPanel } from '../ui/WhyPanel.tsx';
import { dayLabel } from '../ui/fmt.ts';
import { Link, navigate } from '../router.tsx';
import { AskNorn } from './AskNorn.tsx';
import { Changes } from './Changes.tsx';
import { Conversation } from './Conversation.tsx';
import { Impact } from './Impact.tsx';
import { Revisions } from './Revisions.tsx';

export type Tab = 'conversation' | 'impact' | 'changes' | 'revisions';

export function EcrPage({ id, tab, check }: { id: string; tab: Tab; check?: string }) {
  const { assessment: a, summary, loading, error } = useAssessment(id);
  if (error) return <div className="nx-container nx-tabbody"><p className="nx-fg-danger">{error}</p></div>;
  if (loading) return <div className="nx-container nx-tabbody"><p className="nx-fg-muted">Loading</p></div>;
  if (!summary) return <div className="nx-container nx-tabbody"><p>No ECR {id}.</p></div>;
  if (!a) return <SummaryOnly e={summary} />;
  return (
    <PageBoundary key={id} id={id}>
      <AssessmentView a={a} tab={tab} check={check} />
    </PageBoundary>
  );
}

/** Any throw while drawing an ECR page shows a message instead of a blank screen. */
class PageBoundary extends Component<{ id: string; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`ECR page ${this.props.id} failed to draw`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <main className="nx-container nx-tabbody">
          <Flash variant="danger">
            <b>Fern could not draw {this.props.id}.</b> The data for this ECR is not in a shape the page can show. {this.state.error.message}
          </Flash>
        </main>
      </>
    );
  }
}

function AssessmentView({ a, tab, check }: { a: ImpactAssessment; tab: Tab; check?: string }) {
  const [stack, setStack] = useState<string[]>([]);
  const open = useCallback((id: string) => setStack(s => (s[s.length - 1] === id ? s : [...s, id])), []);
  const ctx = useMemo(() => ({ open, current: stack[stack.length - 1] ?? null }), [open, stack]);
  const e = a.ecr;
  const base = `/ecr/${e.id}`;
  const go = (to: string) => (ev: { preventDefault: () => void }) => {
    ev.preventDefault();
    navigate(to);
  };
  const comments = a.activity.filter(x => x.kind === 'filed' || x.kind === 'comment' || x.kind === 'approved').length + 1;

  return (
    <WhyContext.Provider value={ctx}>
      <div className="nx-pr-head">
        <div className="nx-container">
          <div className="nx-drawing-head"><Link to="/">Engineering changes</Link><span className="nx-sp" /><AircraftIcon size={16} /> {e.program}<RequestNumber id={e.id} /></div>
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                {e.title}
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span>
                  {e.originator ? <><b>{e.originator}</b> wants to change</> : 'Change to'} <code className="nx-chip-code">{e.change ?? e.partNumber ?? 'the design'}</code>
                  {' '}&middot; filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}
                </span>
                {a.level && <LevelLabel level={a.level} long />}
              </div>
            </PageHeader.Description>
            <PageHeader.Navigation>
              <UnderlineNav aria-label="ECR" variant="flush">
                <UnderlineNav.Item href={base} icon={CommentDiscussionIcon} counter={comments} aria-current={tab === 'conversation' ? 'page' : undefined} onSelect={go(base)}>
                  Conversation
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/impact`} icon={GaugeIcon} counter={a.checks.length} aria-current={tab === 'impact' ? 'page' : undefined} onSelect={go(`${base}/impact`)}>
                  Impact
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/changes`} icon={CaliperIcon} counter={a.changes.length} aria-current={tab === 'changes' ? 'page' : undefined} onSelect={go(`${base}/changes`)}>
                  Changes
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/revisions`} icon={RevisionIcon} counter={a.revisions.length} aria-current={tab === 'revisions' ? 'page' : undefined} onSelect={go(`${base}/revisions`)}>
                  Revisions
                </UnderlineNav.Item>
              </UnderlineNav>
            </PageHeader.Navigation>
          </PageHeader>
        </div>
      </div>

      <main className="nx-container nx-tabbody">
        {tab === 'conversation' && <Conversation a={a} />}
        {tab === 'impact' && <Impact a={a} check={check} />}
        {tab === 'changes' && <Changes a={a} />}
        {tab === 'revisions' && <Revisions a={a} />}
        {(tab === 'conversation' || tab === 'impact') && <AskNorn a={a} />}
      </main>

      {stack.length > 0 && (
        <WhyPanel a={a} stack={stack} onOpen={open} onBack={() => setStack(s => s.slice(0, -1))} onClose={() => setStack([])} />
      )}
    </WhyContext.Provider>
  );
}

/** An ECR without a full page: what the list knows. */
function SummaryOnly({ e }: { e: NonNullable<ReturnType<typeof useAssessment>['summary']> }) {
  return (
    <>
      <div className="nx-pr-head">
        <div className="nx-container">
          <div className="nx-drawing-head"><Link to="/">Engineering changes</Link><span className="nx-sp" /><AircraftIcon size={16} /> {e.program}<RequestNumber id={e.id} /></div>
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                {e.title}
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span>{e.originator ? <><b>{e.originator}</b> filed</> : 'Filed'} {dayLabel(e.filedOn + 'T12:00:00-07:00')}</span>
                {e.level && <LevelLabel level={e.level} long />}
              </div>
            </PageHeader.Description>
          </PageHeader>
        </div>
      </div>
      <main className="nx-container nx-tabbody">
        {source.isMock ? (
          <div className="nx-pending-card"><GaugeIcon size={24} /><div><h2 className="nx-h3">Assessment preview unavailable <MockTag /></h2><p className="nx-fg-muted">This saved-run preview includes full assessments for <Link to="/ecr/ECR-0417">ECR-0417</Link>, <Link to="/ecr/ECR-0409">ECR-0409</Link> and <Link to="/ecr/ECR-0423">ECR-0423</Link>.</p></div></div>
        ) : e.costNote ? (
          <p className="nx-fg-muted">{e.costNote}</p>
        ) : e.checks === 'running' ? (
          <p className="nx-fg-muted"><Spinner size="small" /> Fern&rsquo;s impact checks are queued or running for this ECR. The page fills in when the cost check finishes.</p>
        ) : (
          <p className="nx-fg-muted">Fern has no impact checks for this ECR yet.</p>
        )}
      </main>
    </>
  );
}
