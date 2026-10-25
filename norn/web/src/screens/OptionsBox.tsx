// The cost engineer seat's "find the best option" result on the ECR page (#157): the decisions hidden in
// the ECR, simulated side by side, the cheapest safe one highlighted, the rest greyed with their reason.
// Today it reads a saved run (norn/seat/options-demo.ts --json); computing it in the worker is a follow-up.
import { Label } from '@primer/react';
import { usd } from '../ui/fmt.ts';
import o0417 from '../assessment/fixtures/options-ecr-0417.json';
import o0419 from '../assessment/fixtures/options-ecr-0419.json';
import './options.css';

interface Range { p10: number; p50: number; p90: number }
interface Option {
  id: string; label: string; asFiled: boolean; eligible: boolean;
  oneTime: Range; window12: Range; plan: Range;
  cutIn: { serial: number | null; date: string | null };
  weeksLate: number | null;
  vsFiled: { oneTime: number; window12: number };
  exclusions: { rule: string; reason: string; evidence: { source: string; quote: string }[] }[];
  notes: string[];
}
interface Report { ecr: string; seed: string; draws: number; computedAt: string | null; options: Option[]; recommended: string | null; recommendation: { text: string } | null }

const SAVED: Record<string, Report> = { 'ECR-0417': o0417 as unknown as Report, 'ECR-0419': o0419 as unknown as Report };

const delta = (n: number) => (Math.round(n) === 0 ? 'as filed' : `${n < 0 ? '' : '+'}${usd(n)}`);
const late = (w: number | null) => (w === null ? '' : Math.abs(w) < 0.5 ? 'on time' : `${Math.round(Math.abs(w))} wk ${w > 0 ? 'late' : 'early'}`);

export function OptionsBox({ id }: { id: string }) {
  const r = SAVED[id];
  if (!r || r.options.length < 2) return null;
  const when = r.computedAt ? new Date(r.computedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }) + ' PT' : 'date not recorded';
  return (
    <div className="nx-box">
      <div className="nx-box-title">
        Options <span title="Fern's checks run on each option and saved as a fixture; not a live run" className="nx-mock"><Label variant="accent" size="small">Saved run</Label></span>{' '}
        <span className="nx-fg-muted">&middot; computed {when}; the cheapest option that passes the safety screen is highlighted</span>
      </div>
      {r.recommendation && <div className="nx-opt-sum">{r.recommendation.text}</div>}
      <div className="nx-table-scroll" role="region" aria-label="Options" tabIndex={0}>
        <table className="nx-table nx-opt-table">
          <thead>
            <tr><th>Option</th><th className="r">One-time (P10 &ndash; P90)</th><th className="r">12 months</th><th className="r">vs filed</th><th className="r">Cut-in</th></tr>
          </thead>
          <tbody>
            {r.options.map(o => (
              <tr key={o.id} className={o.id === r.recommended ? 'nx-opt-rec' : o.eligible ? undefined : 'nx-opt-out'}>
                <td>
                  <b>{o.label}</b>{' '}
                  {o.id === r.recommended && <Label variant="success" size="small">Recommended</Label>}
                  {!o.eligible && <Label variant="danger" size="small">Excluded</Label>}
                  {o.exclusions.map(x => (
                    <div key={x.rule} className="nx-opt-why">
                      {x.reason}
                      {x.evidence.slice(0, 2).map(e => <blockquote key={e.source + e.quote}>{e.source}: &ldquo;{e.quote}&rdquo;</blockquote>)}
                    </div>
                  ))}
                </td>
                <td className="r">{usd(o.oneTime.p50)}<div className="nx-fg-muted">{usd(o.oneTime.p10)} &ndash; {usd(o.oneTime.p90)}</div></td>
                <td className="r">{usd(o.window12.p50)}</td>
                <td className="r">{delta(o.vsFiled.window12)}</td>
                <td className="r">S/N {o.cutIn.serial ?? '?'}<div className="nx-fg-muted">{late(o.weeksLate)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nx-foot">
        {r.draws.toLocaleString('en-US')} paired draws, seed {r.seed}: every option runs the same cost, timeline and supply checks on a changed decision, never a typed amount.
      </div>
    </div>
  );
}
