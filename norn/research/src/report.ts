// The report as text: what was asked, what the guardrails decided, which numbers moved and why.
// Every section of a replay says RECORDED; nothing recorded is shown as live.

import type { ResearchReport, Change } from './apply.ts';

const VIA = { fetch: 'by a plain HTTPS fetch', brightdata: 'through Bright Data (the plain fetch failed or was blocked)', recorded: 'from the recording' } as const;
const usd = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) < 1000 ? 2 : 0 })}`;
const fmt = (c: Change, r: { p10: number; p50: number; p90: number }) =>
  c.unit === 'USD' ? `${usd(r.p50)} [${usd(r.p10)} to ${usd(r.p90)}]` : `${r.p50} [${r.p10} to ${r.p90}] weeks`;
const q = (r: { p10: number; p50: number; p90: number }) => `p10 ${r.p10}, p50 ${r.p50}, p90 ${r.p90}`;

export function renderReport(r: ResearchReport): string {
  const out: string[] = [];
  const tag = r.mode;
  out.push(`Fern research agent: ${r.ecr}, seed ${r.seed}  [${tag}]`);
  for (const p of r.provenance) out.push(`  ${p}`);
  out.push('', 'Research targets (ranked by swing of the year-one total)');
  for (const t of r.targets) {
    const sw = t.swing === null ? 'swing not measurable (blank row)' : `swing ${usd(t.swing)} (${t.swingBasis})`;
    out.push(`  ${t.key}  ${t.label}: ${sw}`);
  }
  out.push('', `Proposals and guardrail verdicts [${tag}]`);
  for (const p of r.proposals) {
    const head = `  #${p.index + 1} ${p.targetKey ?? '?'}  ${p.status.toUpperCase()}`;
    out.push(`${head}${p.label ? `  (${p.label})` : ''}`);
    if (p.proposed) out.push(`      proposed: ${q(p.proposed)}`);
    if (p.source) out.push(`      quote verified on ${p.source.url} (retrieved ${p.source.retrievedAt.slice(0, 10)}${p.source.via ? `, read ${VIA[p.source.via]}` : ''})`);
    for (const x of p.reasons) out.push(`      ${p.status === 'rejected' ? 'rejected' : 'held for a person'} (${x.code}): ${x.message}`);
    for (const f of p.flags) out.push(`      flagged (${f.code}): ${f.message}`);
  }
  if (r.unresolved.length > 0 || r.unanswered.length > 0) {
    out.push('', `Unresolved and unanswered [${tag}]`);
    for (const u of r.unresolved) out.push(`  ${u.targetKey}  UNRESOLVED${u.label ? `  (${u.label})` : '  (not one of the targets)'}: ${u.reason || 'no reason given'}`);
    for (const u of r.unanswered) out.push(`  ${u.key}  NO ANSWER  (${u.label}): the agent made no proposal and did not say it was unresolved`);
  }
  out.push('', `Before and after, accepted assumptions applied [${tag}]`);
  if (r.changes.length === 0) out.push('  No headline number changed.');
  for (const c of r.changes) {
    out.push(`  ${c.label}`);
    out.push(`      before ${fmt(c, c.before)}`);
    out.push(`      after  ${fmt(c, c.after)}`);
    for (const m of c.movedBy) out.push(`      moved by ${m.targetKey} (${m.label}): p50 ${m.deltaP50 >= 0 ? '+' : ''}${c.unit === 'USD' ? usd(m.deltaP50) : m.deltaP50}`);
  }
  out.push(`  ${r.unchangedHeadlines} headline number${r.unchangedHeadlines === 1 ? '' : 's'} unchanged.`);
  for (const n of r.notApplied) out.push(`  NOT APPLIED by the check, ${n.targetKey}: ${n.message}`);
  out.push('', `Converged: before ${r.convergence.before}, after ${r.convergence.after}. The agent proposed inputs; code computed every number above.`);
  return out.join('\n');
}
