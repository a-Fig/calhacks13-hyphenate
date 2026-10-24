import { useCallback, useMemo, useState } from 'react';
import { ChecklistIcon, CommentDiscussionIcon, FileDiffIcon, GitCommitIcon } from '@primer/octicons-react';
import { PageHeader, UnderlineNav } from '@primer/react';
import { useAssessment } from '../assessment/source.ts';
import type { ImpactAssessment } from '../assessment/types.ts';
import { StateBadge, LevelLabel } from '../ui/Bits.tsx';
import { WhyContext } from '../ui/Evidence.tsx';
import { WhyPanel } from '../ui/WhyPanel.tsx';
import { dayLabel } from '../ui/fmt.ts';
import { navigate } from '../router.tsx';
import { Changes } from './Changes.tsx';
import { Conversation } from './Conversation.tsx';
import { Impact } from './Impact.tsx';
import { Revisions } from './Revisions.tsx';
import { RepoHeader } from './Shell.tsx';

export type Tab = 'conversation' | 'impact' | 'changes' | 'revisions';

export function EcrPage({ id, tab, check }: { id: string; tab: Tab; check?: string }) {
  const { assessment: a, summary, loading } = useAssessment(id);
  if (loading) return <div className="nx-container nx-tabbody"><p className="nx-fg-muted">Loading</p></div>;
  if (!summary) return <div className="nx-container nx-tabbody"><p>No ECR {id}.</p></div>;
  if (!a) return <SummaryOnly e={summary} />;
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
      <RepoHeader />
      <div className="nx-pr-head">
        <div className="nx-container">
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                {e.title} <span className="nx-num-muted">{e.id}</span>
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span>
                  <b>{e.originator}</b> wants to change <code className="nx-chip-code">{e.change ?? e.partNumber ?? 'the design'}</code>
                  {' '}&middot; filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}
                </span>
                <LevelLabel level={a.level} long />
              </div>
            </PageHeader.Description>
            <PageHeader.Navigation>
              <UnderlineNav aria-label="ECR" variant="flush">
                <UnderlineNav.Item href={base} icon={CommentDiscussionIcon} counter={comments} aria-current={tab === 'conversation' ? 'page' : undefined} onSelect={go(base)}>
                  Conversation
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/impact`} icon={ChecklistIcon} counter={a.checks.length} aria-current={tab === 'impact' ? 'page' : undefined} onSelect={go(`${base}/impact`)}>
                  Impact
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/changes`} icon={FileDiffIcon} counter={a.changes.length} aria-current={tab === 'changes' ? 'page' : undefined} onSelect={go(`${base}/changes`)}>
                  Changes
                </UnderlineNav.Item>
                <UnderlineNav.Item href={`${base}/revisions`} icon={GitCommitIcon} counter={a.revisions.length} aria-current={tab === 'revisions' ? 'page' : undefined} onSelect={go(`${base}/revisions`)}>
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

/** An ECR without a full page: what the list knows. */
function SummaryOnly({ e }: { e: NonNullable<ReturnType<typeof useAssessment>['summary']> }) {
  return (
    <>
      <RepoHeader />
      <div className="nx-pr-head">
        <div className="nx-container">
          <PageHeader>
            <PageHeader.TitleArea variant="large">
              <PageHeader.Title>
                {e.title} <span className="nx-num-muted">{e.id}</span>
              </PageHeader.Title>
            </PageHeader.TitleArea>
            <PageHeader.Description>
              <div className="nx-pr-sub">
                <StateBadge status={e.status} />
                <span><b>{e.originator}</b> filed {dayLabel(e.filedOn + 'T12:00:00-07:00')}</span>
                {e.level && <LevelLabel level={e.level} long />}
              </div>
            </PageHeader.Description>
          </PageHeader>
        </div>
      </div>
      <main className="nx-container nx-tabbody">
        <p className="nx-fg-muted">Only ECR-0417, ECR-0409 and ECR-0423 have a full page in this mock.</p>
      </main>
    </>
  );
}
