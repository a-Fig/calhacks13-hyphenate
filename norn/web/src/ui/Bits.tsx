import {
  AlertFillIcon, CheckCircleFillIcon, DotFillIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon,
  GitPullRequestIcon, SkipIcon, XCircleFillIcon,
} from '@primer/octicons-react';
import { Avatar, Label, Spinner, StateLabel } from '@primer/react';
import type { Check, EcrSummary, ReportLevel } from '../assessment/types.ts';
import { avatarSrc, type AvatarKind } from './avatars.ts';

type Status = EcrSummary['status'];

export const isOpen = (s: Status) => s === 'Draft' || s === 'Submitted' || s === 'In review';

/** GitHub's state colours: open is green, approved and released (merged) purple, rejected (closed) red. */
export function StateBadge({ status, size = 'medium' }: { status: Status; size?: 'small' | 'medium' }) {
  const map: Record<Status, { status: 'pullOpened' | 'pullMerged' | 'pullClosed' | 'draft'; text: string }> = {
    Draft: { status: 'draft', text: 'Draft' },
    Submitted: { status: 'pullOpened', text: 'Submitted' },
    'In review': { status: 'pullOpened', text: 'In review' },
    Approved: { status: 'pullMerged', text: 'Approved' },
    'ECO released': { status: 'pullMerged', text: 'Released' },
    Rejected: { status: 'pullClosed', text: 'Rejected' },
  };
  const m = map[status];
  return <StateLabel status={m.status} size={size}>{m.text}</StateLabel>;
}

export function StateIcon({ status, size = 16 }: { status: Status; size?: number }) {
  if (status === 'Draft') return <GitPullRequestDraftIcon size={size} className="nx-fg-muted" />;
  if (status === 'Approved' || status === 'ECO released') return <GitMergeIcon size={size} className="nx-fg-done" />;
  if (status === 'Rejected') return <GitPullRequestClosedIcon size={size} className="nx-fg-danger" />;
  return <GitPullRequestIcon size={size} className="nx-fg-open" />;
}

export function LevelLabel({ level, long = false }: { level: ReportLevel; long?: boolean }) {
  if (level === 3) return <Label variant="success">{long ? 'Level 3 · Norn’s final verdict' : 'Level 3'}</Label>;
  if (level === 2) return <Label variant="accent">{long ? 'Level 2 · Reviewed once' : 'Level 2'}</Label>;
  return <Label variant="attention">{long ? 'Level 1 · Provisional' : 'Level 1'}</Label>;
}

export function CheckStateIcon({ state, size = 16 }: { state: Check['state']; size?: number }) {
  if (state === 'passed') return <CheckCircleFillIcon size={size} className="nx-fg-success" />;
  if (state === 'attention') return <AlertFillIcon size={size} className="nx-fg-attention" />;
  if (state === 'skipped') return <SkipIcon size={size} className="nx-fg-muted" />;
  if (state === 'running') return <Spinner size="small" />;
  return <DotFillIcon size={size} className="nx-fg-attention" />;
}

export function Person({ name, kind = 'person', size = 20 }: { name: string; kind?: AvatarKind; size?: number }) {
  return <Avatar src={avatarSrc(name, kind)} alt={name} size={size} square={kind === 'norn'} />;
}

export function XFail() {
  return <XCircleFillIcon className="nx-fg-danger" />;
}
