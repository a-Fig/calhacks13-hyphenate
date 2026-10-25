import { useMemo, useRef, useState } from 'react';
import type { Driver, SCurve } from '../assessment/types.ts';
import { fitQuantiles, likelihoodWord } from '../assessment/fit.ts';
import { EvidenceLabel, useWhy } from './Evidence.tsx';
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

/**
 * Cumulative probability of the window total. The checks give P10, P50 and P90, not the draws, so the
 * curve is fitted through those three (marked on it) unless the assessment carries its own points.
 * A single series: the title names it, so no legend.
 */
export function SCurveChart({ data }: { data: SCurve }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const pts = useMemo(() => {
    if (data.points) return data.points;
    const f = fitQuantiles(data.p10, data.p50, data.p90);
    return Array.from({ length: 99 }, (_, i) => ({ x: f.quantile((i + 1) / 100), y: (i + 1) / 100 }));
  }, [data]);
  const fit = useMemo(() => fitQuantiles(data.p10, data.p50, data.p90), [data]);

  const W = 760, H = 300, L = 46, R = 22, T = 30, B = 40;
  const span = pts[pts.length - 1].x - pts[0].x;
  const xmin = pts[0].x - span * 0.06;
  const xmax = pts[pts.length - 1].x + span * 0.06;
  const ticks = niceTicks(xmin, xmax, 6);
  const sx = (v: number) => L + ((v - xmin) / (xmax - xmin)) * (W - L - R);
  const sy = (p: number) => T + (1 - p) * (H - T - B);
  const curve = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join('');
  const area = `${curve}L${sx(pts[pts.length - 1].x)} ${sy(0)}L${sx(pts[0].x)} ${sy(0)}Z`;
  const marks = [
    { p: 0.1, label: 'P10', v: data.p10 },
    { p: 0.5, label: 'P50', v: data.p50 },
    { p: 0.9, label: 'P90', v: data.p90 },
  ];
  const pe = { x: data.point, y: fit.cdf(data.point) };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const cx = Math.min(Math.max(vx, sx(pts[0].x)), sx(pts[pts.length - 1].x));
    const x = xmin + ((cx - L) / (W - L - R)) * (xmax - xmin);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    setHover(best);
  };

  const box = ref.current?.getBoundingClientRect();
  const tipLeft = hover && box ? (sx(hover.x) / W) * box.width : 0;
  const tipTop = hover && box ? (sy(hover.y) / H) * (box.width * (H / W)) - 12 : 0;

  return (
    <div className="nx-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative probability of the first-12-months cost" onPointerMove={move} onPointerLeave={() => setHover(null)}>
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

        {marks.map(m => (
          <g key={m.label}>
            <line x1={sx(m.v)} x2={sx(m.v)} y1={sy(m.p)} y2={sy(0)} stroke="var(--ev-computation)" strokeWidth="1" opacity="0.35" />
            <circle cx={sx(m.v)} cy={sy(m.p)} r="5" fill="var(--ev-computation)" stroke="var(--bgColor-default)" strokeWidth="2" />
            <text x={sx(m.v) - 11} y={sy(m.p) - 4} textAnchor="end" className="ink halo">
              {m.label} <tspan className="ink2" fontWeight="500">{usdK(m.v)}</tspan>
            </text>
          </g>
        ))}

        {/* The point estimate (every input at its stated value): a diamond, as GAO marks it. */}
        <g transform={`translate(${sx(pe.x)} ${sy(pe.y)})`}>
          <path d="M0 -6 6 0 0 6 -6 0Z" fill="var(--bgColor-default)" stroke="var(--fgColor-default)" strokeWidth="1.8" />
        </g>
        <text x={sx(pe.x) + 12} y={sy(pe.y) + 20} className="ink2 halo">
          Point estimate {usdK(pe.x)} sits at {Math.round(pe.y * 100)}%
        </text>

        {hover && (
          <g pointerEvents="none">
            <line x1={sx(hover.x)} x2={sx(hover.x)} y1={T} y2={sy(0)} stroke="var(--fgColor-default)" strokeWidth="1" opacity="0.25" />
            <circle cx={sx(hover.x)} cy={sy(hover.y)} r="5" fill="var(--bgColor-default)" stroke="var(--ev-computation)" strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="nx-tip" style={{ left: tipLeft, top: tipTop }}>
          <b>{cap(likelihoodWord(hover.y))}</b>, {Math.round(hover.y * 100)}%
          <small>the cost is {usdK(hover.x)} or less</small>
        </div>
      )}
      {!data.points && <div className="nx-chart-note">A curve fitted through P10, P50 and P90.</div>}
    </div>
  );
}

/**
 * The top drivers. Each input alone at its P10 and P90 (a decision: each alternative), the rest at
 * their stated value; the bar runs between the two totals and each end says which input value made
 * it. Bars are coloured by how the input is known.
 */
export function TornadoChart({ drivers, base }: { drivers: Driver[]; base: number }) {
  const why = useWhy();
  const W = 760, L = 32, R = 32;
  const all = drivers.flatMap(d => [d.low, d.high]).concat(base);
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.05 || Math.max(Math.abs(base) * 0.05, 1);
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
    <div className="nx-tornado" role="group" aria-label="Top drivers of cost">
      <div className="nx-tornado-base">Point estimate <b className="num">{usdK(base)}</b></div>
      <div className="nx-tornado-rows">
        {drivers.map(d => {
          // Each end keeps its input: the P10 end and the P90 end, wherever they fall.
          const lowIsLeft = d.low <= d.high;
          const leftVal = lowIsLeft ? d.low : d.high, rightVal = lowIsLeft ? d.high : d.low;
          const leftLab = lowIsLeft ? d.lowLabel : d.highLabel, rightLab = lowIsLeft ? d.highLabel : d.lowLabel;
          const color = `var(--ev-${d.evidence})`;
          const swing = rightVal - leftVal;
          return (
            <button
              key={d.id}
              type="button"
              className="nx-tornado-row"
              onClick={() => why.open(d.id)}
            >
              <span className="nx-tornado-heading">
                <span className="nx-tornado-name"><EvidenceLabel ev={d.evidence} /><span>{d.label}</span></span>
                <span className="nx-tornado-swing num">{usdK(swing)} swing</span>
              </span>
              <svg viewBox={`0 0 ${W} 36`} preserveAspectRatio="none" aria-hidden="true">
                {ticks.map(t => <line key={t} className="grid" x1={sx(t)} x2={sx(t)} y1={0} y2={36} />)}
                {leftVal < base && <path className="bar" d={seg(bx, sx(leftVal), 7)} fill={color} />}
                {rightVal > base && <path className="bar" d={seg(bx, sx(rightVal), 7)} fill={color} />}
                <line x1={bx} x2={bx} y1={0} y2={36} stroke="var(--fgColor-default)" strokeWidth="1.5" />
              </svg>
              <span className="nx-tornado-ends">
                <span><span className="nx-fg-muted">{leftLab ?? 'Lower cost'}</span><b className="num">Net {usdK(leftVal)}</b></span>
                <span><span className="nx-fg-muted">{rightLab ?? 'Higher cost'}</span><b className="num">Net {usdK(rightVal)}</b></span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="nx-tornado-axis" aria-hidden="true">
        {ticks.map(t => <span key={t} style={{ left: `${sx(t) / W * 100}%` }}>{usdK(t)}</span>)}
      </div>
    </div>
  );
}
