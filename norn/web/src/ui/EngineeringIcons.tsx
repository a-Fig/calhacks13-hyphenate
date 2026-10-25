import type { ReactNode, SVGProps } from 'react';
import type { Check } from '../assessment/types.ts';

type IconProps = SVGProps<SVGSVGElement> & { size?: number | 'small' | 'medium' | 'large' };

// A common drawing grid keeps symbols legible at Primer's 16px and 20px sizes.
function Drawing({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  const px = typeof size === 'number' ? size : { small: 16, medium: 20, large: 24 }[size];
  return <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

/** A redlined engineering drawing, with its part and dimension leader. */
export function EcrIcon(props: IconProps) {
  return <Drawing {...props}><path d="M4 3h11l5 5v13H4zM15 3v5h5M7 17v-6h4v6zM12 15l6-5M15 10h3v3" /></Drawing>;
}
export function RejectedIcon(props: IconProps) {
  return <Drawing {...props}><path d="M4 3h11l5 5v13H4zM15 3v5h5M8 11l8 7M16 11l-8 7" /></Drawing>;
}
export function ReleaseIcon(props: IconProps) {
  return <Drawing {...props}><path d="M5 13h14l2 5H3zM9 13V7a3 3 0 0 1 6 0v6M4 21h16M9 7h6" /></Drawing>;
}
export function RevisionIcon(props: IconProps) {
  return <Drawing {...props}><path d="M12 3 22 21H2zM9 17l3-6 3 6M10 15h4" /></Drawing>;
}
export function CaliperIcon(props: IconProps) {
  return <Drawing {...props}><path d="M3 10h18M6 4v13h5v-4M16 6v11h-5M4 20h14M18 18v4M5 7h3M16 8h3" /></Drawing>;
}
export function NcrIcon(props: IconProps) {
  return <Drawing {...props}><path d="M3 5h18v14H3zM14 5l-4 5 4 3-4 6" /><circle cx="6.5" cy="9" r="1" /><circle cx="17.5" cy="15" r="1" /></Drawing>;
}
export function GaugeIcon(props: IconProps) {
  return <Drawing {...props}><path d="M4 19a10 10 0 1 1 16 0zM12 4v3M5 8l2 2M19 8l-2 2M12 15l4-5" /><circle cx="12" cy="15" r="1.5" /></Drawing>;
}
export function CrateIcon(props: IconProps) {
  return <Drawing {...props}><path d="M3 4h18v16H3zM3 8h18M3 16h18M7 8v8M17 8v8M7 8l10 8" /></Drawing>;
}
export function SerialIcon(props: IconProps) {
  return <Drawing {...props}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 10h10M7 14h3M13 14h4" /><circle cx="5" cy="8" r=".6" /><circle cx="19" cy="16" r=".6" /></Drawing>;
}
export function AircraftIcon(props: IconProps) {
  return <Drawing {...props}><path d="M12 2l2 8 8 5v2l-8-2v5l3 2H7l3-2v-5l-8 2v-2l8-5z" /></Drawing>;
}
export function BoardIcon(props: IconProps) {
  return <Drawing {...props}><rect x="5" y="7" width="14" height="10" rx="3" /><path d="M8 3v1M16 3v1M8 20v1M16 20v1M2 11v2M22 11v2" /></Drawing>;
}
export function BomIcon(props: IconProps) {
  return <Drawing {...props}><path d="M12 8v5M5 16v-3h14v3" /><rect x="8" y="2" width="8" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /></Drawing>;
}
export function CostIcon(props: IconProps) {
  return <Drawing {...props}><path d="M5 3h14v19l-3-2-4 2-4-2-3 2zM9 7h6M9 11h6M9 15h3" /></Drawing>;
}

const checkIcons = { bom: BomIcon, cost: CostIcon, timeline: SerialIcon, supply: CrateIcon, class: BoardIcon };
export function ImpactIcon({ check, ...props }: IconProps & { check: Check['id'] }) {
  const Icon = checkIcons[check];
  return <Icon {...props} />;
}
