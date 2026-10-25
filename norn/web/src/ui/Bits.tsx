import {
  AlertFillIcon, CheckCircleFillIcon, CircleIcon, DotFillIcon, SkipIcon, XCircleFillIcon,
} from '@primer/octicons-react';
import { Avatar, Label, Spinner } from '@primer/react';
import type { Check, EcrSummary, ReportLevel } from '../assessment/types.ts';
import { avatarSrc, type AvatarKind } from './avatars.ts';
import { EcoStampIcon, EcrDraftIcon, EcrIcon, EcrRejectedIcon } from './icons.tsx';
import { staleNote } from './fmt.ts';

type Status = EcrSummary['status'];

export const isOpen = (s: Status) => s === 'Draft' || s === 'Submitted' || s === 'In review';

/**
 * State colours: open is green, approved and ECO released are purple, rejected is red. Drawn here rather than
 * with Primer's StateLabel, whose icons are the git pull request, merge and close glyphs.
 */
export function StateBadge({ status, size = 'medium' }: { status: Status; size?: 'small' | 'medium' }) {
  const map: Record<Status, { tone: 'open' | 'done' | 'closed' | 'draft'; icon: typeof EcrIcon }> = {
    Draft: { tone: 'draft', icon: EcrDraftIcon },
    Submitted: { tone: 'open', icon: EcrIcon },
    'In review': { tone: 'open', icon: EcrIcon },
    Approved: { tone: 'done', icon: EcoStampIcon },
    'ECO released': { tone: 'done', icon: EcoStampIcon },
    Rejected: { tone: 'closed', icon: EcrRejectedIcon },
  };
  const m = map[status];
  const Icon = m.icon;
  return <span className={`nx-statebadge nx-statebadge-${m.tone} ${size === 'small' ? 'sm' : ''}`}><Icon size={size === 'small' ? 12 : 16} /> {status}</span>;
}

export function StateIcon({ status, size = 16 }: { status: Status; size?: number }) {
  if (status === 'Draft') return <EcrDraftIcon size={size} className="nx-fg-muted" />;
  if (status === 'Approved' || status === 'ECO released') return <EcoStampIcon size={size} className="nx-fg-done" />;
  if (status === 'Rejected') return <EcrRejectedIcon size={size} className="nx-fg-danger" />;
  return <EcrIcon size={size} className="nx-fg-open" />;
}

export function LevelLabel({ level, long = false }: { level: ReportLevel; long?: boolean }) {
  if (level === 3) return <Label variant="success">{long ? 'Level 3 \u00b7 Norn\u2019s final verdict' : 'Level 3'}</Label>;
  if (level === 2) return <Label variant="accent">{long ? 'Level 2 \u00b7 Reviewed once' : 'Level 2'}</Label>;
  return <Label variant="attention">{long ? 'Level 1 \u00b7 Provisional' : 'Level 1'}</Label>;
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
  return <Avatar src={avatarSrc(name, kind)} alt={name} size={size} square={kind === 'norn' || kind === 'team'} />;
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

/**
 * Engineering drawing title block stamp for an ECR number.
 * Replaces GitHub's `#123` muted pull-request number with a technical drawing block.
 */
export function DrawingStamp({ id, program, part, compact = false }: { id: string; program?: string; part?: string; compact?: boolean }) {
  if (compact) {
    return <span className="nx-dwg-chip" title={`Engineering Change Request ${id}`}>{id}</span>;
  }
  return (
    <span className="nx-dwg-block" aria-label={`Drawing title block ${id}`}>
      <span className="nx-dwg-cell nx-dwg-tag">DWG CHG</span>
      <span className="nx-dwg-cell nx-dwg-id">{id}</span>
      {part && <span className="nx-dwg-cell nx-dwg-meta">{part}</span>}
      {program && <span className="nx-dwg-cell nx-dwg-prog">{program.toUpperCase()}</span>}
    </span>
  );
}