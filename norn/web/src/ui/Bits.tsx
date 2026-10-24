import {
  AlertFillIcon, CheckCircleFillIcon, CircleIcon, DotFillIcon, SkipIcon, XCircleFillIcon,
} from '@primer/octicons-react';
import { Avatar, Label, Spinner } from '@primer/react';
import type { Check, EcrSummary, ReportLevel } from '../assessment/types.ts';
import { avatarSrc, type AvatarKind } from './avatars.ts';
import { staleNote } from './fmt.ts';
import { EcrIcon, RejectedIcon, ReleaseIcon } from './EngineeringIcons.tsx';

type Status = EcrSummary['status'];

export const isOpen = (s: Status) => s === 'Draft' || s === 'Submitted' || s === 'In review';

/** Explicit words plus an engineering symbol keep status readable without colour. */
export function StateBadge({ status, size = 'medium' }: { status: Status; size?: 'small' | 'medium' }) {
  return <span className={`nx-state-badge nx-status-${status.toLowerCase().replaceAll(' ', '-')} ${size}`}><StateIcon status={status} />{status === 'ECO released' ? 'Released' : status}</span>;
}

export function StateIcon({ status, size = 16 }: { status: Status; size?: number }) {
  if (status === 'Approved') return <CheckCircleFillIcon size={size} className="nx-fg-success" />;
  if (status === 'ECO released') return <ReleaseIcon size={size} className="nx-fg-done" />;
  if (status === 'Rejected') return <RejectedIcon size={size} className="nx-fg-danger" />;
  return <EcrIcon size={size} strokeDasharray={status === 'Draft' ? '3 2' : undefined} className={status === 'Draft' ? 'nx-fg-muted' : 'nx-fg-open'} />;
}

/** A title-block cell uses the request's known number, without inventing a part revision. */
export function RequestNumber({ id }: { id: string }) {
  return <span className="nx-request-number"><span>ECR</span><b>{id.replace(/^ECR-/, '')}</b></span>;
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
  if (state === 'queued') return <DotFillIcon size={size} className="nx-fg-attention" />;
  if (state === 'pending') return <CircleIcon size={size} className="nx-fg-muted" />;
  if (state === 'running') return <Spinner size="small" />;
  return <DotFillIcon size={size} className="nx-fg-attention" />;
}

export function Person({ name, kind = 'person', size = 20 }: { name: string; kind?: AvatarKind; size?: number }) {
  return <Avatar src={avatarSrc(name, kind)} alt={name} size={size} square={kind === 'norn'} />;
}

/** Marks one section of a page as a mock fixture, so a live section can drop it later. */
export function MockTag({ on = true, title = 'Mock: not produced by a check yet' }: { on?: boolean; title?: string }) {
  if (!on) return null;
  return (
    <span title={title} className="nx-mock">
      <Label variant="attention" size="small">Mock</Label>
    </span>
  );
}

/** Says the cost numbers beside it are the previous revision's. */
export function StaleNote({ state }: { state: 'rechecking' | 'failed' }) {
  return (
    <span className="nx-flag"><AlertFillIcon size={12} className="nx-fg-attention" /> {staleNote(state)}</span>
  );
}

/** Marks the cost section: the real checks' output on Bowman's dataset, saved, not live. */
export function SavedRun({ source = 'saved' }: { source?: 'saved' | 'live' }) {
  if (source === 'live') {
    return (
      <span title="Read from Norn's database: the checks' stored results" className="nx-mock">
        <Label variant="success" size="small">Live</Label>
      </span>
    );
  }
  return (
    <span title="Norn's checks run on Bowman's dataset and saved as a fixture; not a live run" className="nx-mock">
      <Label variant="accent" size="small">Saved run</Label>
    </span>
  );
}

export function XFail() {
  return <XCircleFillIcon className="nx-fg-danger" />;
}
