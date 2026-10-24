import { useCallback, useMemo, useState } from 'react';
import { AlertFillIcon, CommentDiscussionIcon } from '@primer/octicons-react';
import { Label, PageHeader, PageLayout, Spinner, UnderlineNav } from '@primer/react';
import { source, useAssessment } from '../assessment/source.ts';
import type { ImpactAssessment } from '../assessment/types.ts';
import { DrawingStamp, LevelLabel, Person, StateBadge } from '../ui/Bits.tsx';
import { AircraftIcon, CaliperIcon, CcbTableIcon, EcrIcon, GaugeIcon, RevisionTriangleIcon } from '../ui/icons.tsx';
import { WhyContext } from '../ui/Evidence.tsx';
import { WhyPanel } from '../ui/WhyPanel.tsx';
import { dayLabel, usdK } from '../ui/fmt.ts';
import { navigate } from '../router.tsx';
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
  if (!a) return <SummaryOnly e={summary} tab={tab} />;
  return <AssessmentView key={id} a={a} tab={tab} check={check} />;
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
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                <span className="nx-pr-title-row">
                  <span>{e.title}</span>
                  <DrawingStamp id={e.id} part={e.partNumber} program={e.program} />
                </span>
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span>
                  <b>{e.originator}</b> wants to change <code className="nx-chip-code">{e.change ?? e.partNumber ?? 'the design'}</code>
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
                <UnderlineNav.Item href={`${base}/revisions`} icon={RevisionTriangleIcon} counter={a.revisions.length} aria-current={tab === 'revisions' ? 'page' : undefined} onSelect={go(`${base}/revisions`)}>
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
      </main>

      {stack.length > 0 && (
        <WhyPanel a={a} stack={stack} onOpen={open} onBack={() => setStack(s => s.slice(0, -1))} onClose={() => setStack([])} />
      )}
    </WhyContext.Provider>
  );
}

/** An ECR without a full mock narrative: keeps the same header, tabs and sidebar frame so no page breaks the style. */
function SummaryOnly({ e, tab }: { e: NonNullable<ReturnType<typeof useAssessment>['summary']>; tab: Tab }) {
  const base = `/ecr/${e.id}`;
  const go = (to: string) => (ev: { preventDefault: () => void }) => {
    ev.preventDefault();
    navigate(to);
  };
  return (
    <>
      <div className="nx-pr-head">
        <div className="nx-container">
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                <span className="nx-pr-title-row">
                  <span>{e.title}</span>
                  <DrawingStamp id={e.id} part={e.partNumber} program={e.program} />
                </span>
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span>
                  <b>{e.originator}</b> wants to change <code className="nx-chip-code">{e.change ?? e.partNumber ?? 'the design'}</code>
                  {' '}&middot; filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}
                </span>
                {e.level && <LevelLabel level={e.level} long />}
              </div>
            </PageHeader.Description>
            <PageHeader.Navigation>
              <UnderlineNav aria-label="ECR" variant="flush">
                <UnderlineNav.Item href={base} icon={CommentDiscussionIcon} counter={e.comments ?? 1} aria-current={tab === 'conversation' ? 'page' : undefined} onSelect={go(base)}>
                  Conversation
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/impact`} icon={GaugeIcon} aria-current={tab === 'impact' ? 'page' : undefined} onSelect={go(`${base}/impact`)}>
                  Impact
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/changes`} icon={CaliperIcon} aria-current={tab === 'changes' ? 'page' : undefined} onSelect={go(`${base}/changes`)}>
                  Changes
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/revisions`} icon={RevisionTriangleIcon} aria-current={tab === 'revisions' ? 'page' : undefined} onSelect={go(`${base}/revisions`)}>
                  Revisions
                </UnderlineNav.Item>
              </UnderlineNav>
            </PageHeader.Navigation>
          </PageHeader>
        </div>
      </div>
      <main className="nx-container nx-tabbody">
        <PageLayout containerWidth="full" padding="none" columnGap="normal">
          <PageLayout.Content>
            <div className="nx-box">
              <div className="nx-box-title">
                <EcrIcon size={16} /> Summary record &middot; {e.id}
              </div>
              <div className="nx-comment-body">
                {e.cost && (
                  <div className="nx-stats" style={{ marginBottom: 16 }}>
                    <div className="nx-stat">
                      <div className="nx-stat-label">Net cost, first 12 months (saved check run)</div>
                      <div className="nx-stat-value num">{usdK(e.cost.point ?? e.cost.p50, { plus: true })}</div>
                      <div className="nx-stat-sub num">P10 to P90: {usdK(e.cost.p10)} &ndash; {usdK(e.cost.p90)}</div>
                    </div>
                    {e.flag && (
                      <div className="nx-stat">
                        <div className="nx-stat-label">Backlog flag</div>
                        <div className="nx-stat-value" style={{ fontSize: 16 }}><AlertFillIcon size={16} className="nx-fg-attention" /> {e.flag}</div>
                      </div>
                    )}
                  </div>
                )}
                {source.isMock ? (
                  <p className="nx-fg-muted">
                    Year-one cost is from Norn&rsquo;s saved check run on Bowman&rsquo;s dataset. Full conversation, item diffs and trace drill-down are mocked on <b>ECR-0417</b>, <b>ECR-0409</b> and <b>ECR-0423</b>.
                  </p>
                ) : e.checks === 'running' ? (
                  <p className="nx-fg-muted"><Spinner size="small" /> Norn&rsquo;s impact checks are queued or running for this ECR. The page fills in when the cost check finishes.</p>
                ) : (
                  <p className="nx-fg-muted">Norn has no impact checks for this ECR yet.</p>
                )}
              </div>
            </div>
          </PageLayout.Content>
          <PageLayout.Pane position="end" width="small" padding="none">
            <aside className="nx-side">
              {e.reviewers && e.reviewers.length > 0 && (
                <section>
                  <h3>Approvers</h3>
                  <ul className="nx-side-list">
                    {e.reviewers.map(r => (
                      <li key={r.name}>
                        <Person name={r.name} kind={r.name === 'Norn' ? 'norn' : 'person'} size={20} />
                        <span className="nx-side-name">{r.name}</span>
                      </li>
                    ))}
                    <li>
                      <CcbTableIcon size={16} className="nx-fg-muted" />
                      <span className="nx-side-name">Change Control Board</span>
                    </li>
                  </ul>
                </section>
              )}
              <section>
                <h3>Originator</h3>
                <div className="nx-side-one"><Person name={e.originator} size={20} /> <b>{e.originator}</b></div>
              </section>
              <section>
                <h3>Labels</h3>
                <div className="nx-side-labels">
                  <span className="nx-prog-tag"><AircraftIcon size={12} /> {e.program}</span>
                  <Label variant="secondary">Class {e.companyClass}</Label>
                  <Label variant="secondary">FAA {e.faa}</Label>
                  {e.priority !== 'Routine' && <Label variant="severe">{e.priority}</Label>}
                  {e.level && <LevelLabel level={e.level} />}
                </div>
              </section>
            </aside>
          </PageLayout.Pane>
        </PageLayout>
      </main>
    </>
  );
}