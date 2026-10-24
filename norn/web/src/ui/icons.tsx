// Norn's R&D icon set, drawn from physical engineering and manufacturing (drawings, parts, aircraft,
// the shop floor) so the screens use GitHub's grammar without looking like Git.
// Every icon matches Octicons' signature (`size?: number`, `className?: string`) so it drops directly
// into Primer's `UnderlineNav.Item`, `ActionList`, `Button`, or inline spans.
import type { IconProps as OcticonProps } from '@primer/octicons-react';

export type IconProps = OcticonProps;

const px = (s: IconProps['size']) => (s === 'small' ? 16 : s === 'medium' ? 20 : s === 'large' ? 24 : s ?? 16);

/**
 * ECR (Engineering Change Request): an engineering part/blueprint sheet with a redline callout corner
 * and a drafting pencil slash. Variants indicate open, draft (dashed), or rejected (crossed).
 */
export function EcrIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      {/* Part flange / blueprint outline */}
      <path d="M2.5 2.5h7l4 4v7a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 2.5v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      {/* Machined bracket hole + redline callout leader */}
      <circle cx="6.2" cy="9.8" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.6 8.4 10.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10.8" cy="5.8" r="1" fill="currentColor" />
    </svg>
  );
}

export function EcrDraftIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <path d="M2.5 2.5h7l4 4v7a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.8" strokeLinejoin="round" />
      <circle cx="6.5" cy="9.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function EcrRejectedIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <path d="M2.5 2.5h7l4 4v7a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5.5 7.5l5 5M10.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * ECO released (Engineering Change Order): a drawing release stamp (tilted rectangular approval stamp
 * with a checkmark inside, as stamped on released aerospace drawings).
 */
export function EcoStampIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <g transform="rotate(-8 8 8)">
        <rect x="1.5" y="3.2" width="13" height="9.6" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3.2" y="4.9" width="9.6" height="6.2" rx="0.6" stroke="currentColor" strokeWidth="1" strokeDasharray="1.8 1.2" />
        <path d="M5.5 8.1l1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * Revisions: the standard ASME Y14.35 drafting revision triangle (delta) containing a revision mark.
 */
export function RevisionTriangleIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <path d="M8 2L14.5 13.5H1.5L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.4 11.5L8 7.2l1.6 4.3M6.8 10.3h2.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Changes: vernier caliper jaws measuring a dimension (replaces Git's FileDiffIcon).
 */
export function CaliperIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      {/* Main beam */}
      <path d="M1.5 4.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* Fixed jaw on left */}
      <path d="M3 2.5v10l2-2V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Sliding jaw on right */}
      <path d="M10.5 2.5v10l-2-2V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dimension ticks */}
      <path d="M6.5 4.5V3M8 4.5V3M12.5 4.5V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Measurement arrows */}
      <path d="M5.2 11.5h3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.2 1.2" />
    </svg>
  );
}

/**
 * Impact checks: a dial indicator / pressure gauge with needle and tolerance arc (replaces ChecklistIcon).
 */
export function GaugeIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <circle cx="8" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 2.2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Scale arc & ticks */}
      <path d="M4.5 9.5a4 4 0 0 1 7-2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
      {/* Needle pointing upper right */}
      <path d="M8 8.8 11.2 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="8.8" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * NCR (Non-Conformance Report): a machined bracket/part with a jagged fatigue crack running through it.
 */
export function NcrCrackIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      {/* L-bracket / part outline */}
      <path d="M2.5 2.5h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Jagged crack from top edge through middle */}
      <path d="M8.5 2.5 6.8 6l2.4 1.8-2.2 3 1.2 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Supply: a wooden/industrial shipping crate with diagonal bracing.
 */
export function CrateIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 5.5h12M2 10.5h12" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 5.5l7 5M11.5 5.5l-7 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Cut-in: a riveted aircraft serial data plate ("S/N") marking effectivity on the assembly line.
 */
export function SerialPlateIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Four corner rivets */}
      <circle cx="3.3" cy="5.3" r="0.8" fill="currentColor" />
      <circle cx="12.7" cy="5.3" r="0.8" fill="currentColor" />
      <circle cx="3.3" cy="10.7" r="0.8" fill="currentColor" />
      <circle cx="12.7" cy="10.7" r="0.8" fill="currentColor" />
      {/* Stamped serial lines */}
      <path d="M5 7h6M5 9.2h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Programs: a clean electric aircraft / eVTOL planform silhouette.
 */
export function AircraftIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      <path
        d="M8 1.5c.6 0 1 .5 1 1.2v3.6l5.2 2.4v1.5L9 8.7v3.4l2 1.4v1L8 13.8l-3 0.7v-1l2-1.4V8.7L1.8 10.2V8.7L7 6.3V2.7c0-.7.4-1.2 1-1.2Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * CCB (Change Control Board): a board table with seats around it.
 */
export function CcbTableIcon({ size = 16, className, ...rest }: IconProps) {
  const n = px(size);
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true" {...rest}>
      {/* Board table */}
      <rect x="3.5" y="5" width="9" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Chairs top, bottom, and head of table */}
      <path d="M5.5 2.8h2M8.5 2.8h2M5.5 13.2h2M8.5 13.2h2M1.8 7v2M14.2 7v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Norn brand mark: an aerospace drafting compass / precision wing-caliper delta mark.
 */
export function NornMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="#0d9488" fillOpacity="0.18" stroke="#2dd4bf" strokeWidth="1.4" />
      {/* Precision drafting compass / delta wing */}
      <path d="M14 5.5 21.5 21h-2.8L14 11.2 9.3 21H6.5L14 5.5Z" fill="#f0fdfa" />
      {/* Caliper arc and centre reticle */}
      <path d="M8.5 16.5a7.5 7.5 0 0 0 11 0" stroke="#5eead4" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14" cy="6" r="1.6" fill="#5eead4" />
    </svg>
  );
}