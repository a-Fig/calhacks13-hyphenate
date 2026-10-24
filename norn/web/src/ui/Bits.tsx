import type { ActorKind, EcrSummary, Evidence, ReportLevel, StepState } from '../assessment/types.ts';
import { initials } from './fmt.ts';

export function NornMark({ size = 22 }: { size?: number }) {
  return (
    <span className="nx-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 10V2l7 8V2" />
      </svg>
    </span>
  );
}

export function Avatar({ name, kind }: { name: string; kind?: ActorKind }) {
  if (kind === 'norn') {
    return (
      <span className="nx-av norn" title={name}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 10V2l7 8V2" /></svg>
      </span>
    );
  }
  if (kind === 'person_agent') {
    return (
      <span className="nx-av agent" title={name}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3.5" width="8" height="6" rx="1.8" /><path d="M6 3.5V1.8M4.4 6.3v.6M7.6 6.3v.6" /></svg>
      </span>
    );
  }
  return <span className="nx-av" title={name}>{initials(name)}</span>;
}

export function LevelBadge({ level }: { level: ReportLevel }) {
  if (level === 3) {
    return (
      <span className="nx-level final" title="Level 3 is the only report most people need to read">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 7.4 2.7 2.7L11 4.4" /></svg>
        Level 3 <small>Norn&rsquo;s final verdict</small>
      </span>
    );
  }
  if (level === 2) {
    return <span className="nx-level mid">Level 2 <small>Reviewed once</small></span>;
  }
  return (
    <span className="nx-level prov" title="Provisional: likely to change">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2"><circle cx="7" cy="7" r="5.6" /></svg>
      Level 1 <small>Provisional</small>
    </span>
  );
}

export function LevelPill({ level }: { level?: ReportLevel }) {
  if (!level) return <span className="mute">&ndash;</span>;
  return <span className={`nx-lv l${level}`} title={level === 3 ? 'Norn’s final verdict' : level === 2 ? 'Reviewed once' : 'Provisional'}>L{level}</span>;
}

export function StatusIcon({ status }: { status: EcrSummary['status'] }) {
  const s = 16;
  switch (status) {
    case 'Approved':
    case 'ECO released':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="var(--good)" />
          <path d="m4.8 8.3 2.2 2.2 4.2-4.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'In review':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="#4d4a43" strokeWidth="1.6" />
          <path d="M8 3.6a4.4 4.4 0 0 1 0 8.8Z" fill="#4d4a43" />
        </svg>
      );
    case 'Draft':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="#a8a499" strokeWidth="1.6" strokeDasharray="2.6 2.4" />
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="#86827a" strokeWidth="1.6" />
        </svg>
      );
  }
}

export function StatusChip({ status }: { status: EcrSummary['status'] }) {
  return (
    <span className="nx-chip">
      <StatusIcon status={status} />
      {status}
    </span>
  );
}

export function StepIcon({ state }: { state: StepState }) {
  if (state === 'approved') return <StatusIcon status="Approved" />;
  if (state === 'pending') {
    return (
      <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="#4d4a43" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="2" fill="#4d4a43" />
      </svg>
    );
  }
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="#b9b5aa" strokeWidth="1.6" />
    </svg>
  );
}

/** p10 to p90 on a track, with the p50 dot. The track pads each side so skew is visible. */
export function RangeStrip({ p10, p50, p90, ev }: { p10: number; p50: number; p90: number; ev: Evidence }) {
  const span = p90 - p10 || 1;
  const lo = p10 - span * 0.45, hi = p90 + span * 0.45;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className={`nx-strip nx-ev-${ev}`} aria-hidden="true">
      <div className="track" />
      <div className="span" style={{ left: pos(p10), width: `calc(${pos(p90)} - ${pos(p10)})` }} />
      <div className="p50" style={{ left: pos(p50) }} />
    </div>
  );
}

export function Meter({ level }: { level: 'low' | 'moderate' | 'high' }) {
  const n = level === 'low' ? 1 : level === 'moderate' ? 2 : 3;
  return (
    <div className="nx-meter" aria-hidden="true">
      {[1, 2, 3].map(i => <i key={i} className={i <= n ? 'on' : ''} />)}
    </div>
  );
}
