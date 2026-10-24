import { useRef, useState } from 'react';
import type { Driver, SCurve } from '../assessment/types.ts';
import { likelihoodWord } from '../assessment/engine.ts';
import { Glyph, EV, useWhy } from './Evidence.tsx';
import { usdK } from './fmt.ts';

function niceTicks(lo: number, hi: number, want = 6): number[] {
  const raw = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Cumulative probability of the year-1 total. A single series: the title names it, so no legend. */
export function SCurveChart({ data }: { data: SCurve }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const W = 760, H = 300, L = 46, R = 22, T = 30, B = 40;
  const pts = data.points;
  const xmin = pts[0].x - (pts[pts.length - 1].x - pts[0].x) * 0.06;
  const xmax = pts[pts.length - 1].x + (pts[pts.length - 1].x - pts[0].x) * 0.06;
  const ticks = niceTicks(xmin, xmax, 6);
  const sx = (v: number) => L + ((v - xmin) / (xmax - xmin)) * (W - L - R);
  const sy = (p: number) => T + (1 - p) * (H - T - B);
  const curve = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join('');
  const area = `${curve}L${sx(pts[pts.length - 1].x)} ${sy(0)}L${sx(pts[0].x)} ${sy(0)}Z`;
  const at = (p: number) => pts.find(q => Math.abs(q.y - p) < 1e-9)!;
  const marks = [
    { p: 0.1, label: 'P10', v: data.p10 },
    { p: 0.5, label: 'P50', v: data.p50 },
    { p: 0.9, label: 'P90', v: data.p90 },
  ];

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const cx = Math.min(Math.max(vx, sx(pts[0].x)), sx(pts[pts.length - 1].x));
    const x = xmin + ((cx - L) / (W - L - R)) * (xmax - xmin);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    setHover(best);
  };

  const hp = hover;
  const box = ref.current?.getBoundingClientRect();
  const tipLeft = hp && box ? (sx(hp.x) / W) * box.width : 0;
  const tipTop = hp && box ? (sy(hp.y) / H) * (box.width * (H / W)) - 12 : 0;

  return (
    <div className="nx-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative probability of the year-1 cost" onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(p => (
          <g key={p}>
            <line className="grid" x1={L} x2={W - R} y1={sy(p)} y2={sy(p)} />
            <text x={L - 8} y={sy(p) + 4} textAnchor="end">{Math.round(p * 100)}%</text>
          </g>
        ))}
        {ticks.map(t => (
          <text key={t} x={sx(t)} y={H - B + 20} textAnchor="middle">{usdK(t)}</text>
        ))}
        <line className="axis" x1={L} x2={W - R} y1={sy(0)} y2={sy(0)} />

        <path d={area} fill="var(--ev-computation)" opacity="0.10" />
        <path d={curve} fill="none" stroke="var(--ev-computation)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {marks.map(m => {
          const p = at(m.p);
          return (
            <g key={m.label}>
              <line x1={sx(m.v)} x2={sx(m.v)} y1={sy(m.p)} y2={sy(0)} stroke="var(--ev-computation)" strokeWidth="1" opacity="0.35" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r="5" fill="var(--ev-computation)" stroke="#fff" strokeWidth="2" />
              <text x={sx(p.x) - 11} y={sy(p.y) - 4} textAnchor="end" className="ink halo">
                {m.label} <tspan className="ink2" fontWeight="500">{usdK(m.v)}</tspan>
              </text>
            </g>
          );
        })}

        {/* The deterministic point estimate: a diamond, like the one GAO marks on its S-curves. */}
        <g transform={`translate(${sx(data.pointEstimate.x)} ${sy(data.pointEstimate.y)})`}>
          <path d="M0 -6 6 0 0 6 -6 0Z" fill="#fff" stroke="var(--fgColor-default)" strokeWidth="1.8" />
        </g>
        <text x={sx(data.pointEstimate.x) + 12} y={sy(data.pointEstimate.y) + 20} className="ink2 halo">
          Point estimate {usdK(data.pointEstimate.x)} sits at {Math.round(data.pointEstimate.y * 100)}%
        </text>

        {hp && (
          <g pointerEvents="none">
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={T} y2={sy(0)} stroke="var(--fgColor-default)" strokeWidth="1" opacity="0.25" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r="5" fill="#fff" stroke="var(--ev-computation)" strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="nx-tip" style={{ left: tipLeft, top: tipTop }}>
          <b>{cap(likelihoodWord(hp.y))}</b>, {Math.round(hp.y * 100)}%
          <small>the cost is {usdK(hp.x)} or less</small>
        </div>
      )}
    </div>
  );
}

/** The top drivers. Each input moved alone to its p10 and p90; bars are coloured by how the input is known. */
export function TornadoChart({ drivers, base }: { drivers: Driver[]; base: number }) {
  const why = useWhy();
  const [hover, setHover] = useState<string | null>(null);
  const rowH = 52, W = 760, L = 214, R = 56, T = 34, B = 34;
  const H = T + drivers.length * rowH + B;
  const all = drivers.flatMap(d => [d.low, d.high]).concat(base);
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.05;
  const ticks = niceTicks(lo - pad, hi + pad, 5);
  const xmin = Math.min(ticks[0], lo - pad), xmax = Math.max(ticks[ticks.length - 1], hi + pad);
  const sx = (v: number) => L + ((v - xmin) / (xmax - xmin)) * (W - L - R);
  const bx = sx(base);
  const th = 22, rr = 4;

  // A bar from the base line outward, rounded only at its data end.
  const seg = (x0: number, x1: number, y: number) => {
    if (Math.abs(x1 - x0) < 1) return '';
    const dir = x1 > x0 ? 1 : -1;
    const r = Math.min(rr, Math.abs(x1 - x0));
    return `M${x0} ${y}H${x1 - dir * r}Q${x1} ${y} ${x1} ${y + r}V${y + th - r}Q${x1} ${y + th} ${x1 - dir * r} ${y + th}H${x0}Z`;
  };

  return (
    <div className="nx-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Top drivers of the year-1 cost">
        {ticks.map(t => (
          <g key={t}>
            <line className="grid" x1={sx(t)} x2={sx(t)} y1={T - 6} y2={H - B} />
            <text x={sx(t)} y={H - B + 20} textAnchor="middle">{usdK(t)}</text>
          </g>
        ))}
        <text x={bx} y={T - 14} textAnchor="middle" className="ink">Point estimate {usdK(base)}</text>

        {drivers.map((d, i) => {
          const y = T + i * rowH + (rowH - th) / 2;
          const leftVal = Math.min(d.low, d.high), rightVal = Math.max(d.low, d.high);
          const leftLab = d.low <= d.high ? d.lowLabel : d.highLabel;
          const rightLab = d.low <= d.high ? d.highLabel : d.lowLabel;
          const color = `var(--ev-${d.evidence})`;
          const swing = rightVal - leftVal;
          return (
            <g
              key={d.id}
              className="nx-bar-hit"
              tabIndex={0}
              role="button"
              aria-label={`${d.label}: ${usdK(leftVal)} to ${usdK(rightVal)}`}
              onClick={() => why.open(d.id)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && why.open(d.id)}
              onPointerEnter={() => setHover(d.id)}
              onPointerLeave={() => setHover(null)}
            >
              <rect x={0} y={y - (rowH - th) / 2} width={W} height={rowH} fill={hover === d.id ? 'rgba(0,0,0,0.025)' : 'transparent'} />
              <foreignObject x={0} y={y - 6} width={L - 14} height={34}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, fontSize: 13.5, lineHeight: 1.2, color: 'var(--fgColor-default)' }}>
                  <Glyph ev={d.evidence} />
                  <span>{d.label}</span>
                </div>
              </foreignObject>
              {leftVal < base && <path className="bar" d={seg(bx, sx(leftVal), y)} fill={color} />}
              {rightVal > base && <path className="bar" d={seg(bx, sx(rightVal), y)} fill={color} />}
              {leftVal < base && (
                <text x={sx(leftVal) - 7} y={y + 15} textAnchor="end" className="ink2">{leftLab}</text>
              )}
              {rightVal > base && (
                <text x={sx(rightVal) + 7} y={y + 15} textAnchor="start" className="ink2">{rightLab}</text>
              )}
              {hover === d.id && (
                <text x={W - R + 52} y={y + 15} textAnchor="end" className="ink">{usdK(swing)} swing</text>
              )}
              <title>{`${d.label}: ${EV[d.evidence].label}. ${usdK(leftVal)} to ${usdK(rightVal)}`}</title>
            </g>
          );
        })}
        <line x1={bx} x2={bx} y1={T - 6} y2={H - B} stroke="var(--fgColor-default)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
