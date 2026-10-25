// A Norn impact statement as the PLM's seven impact fields. Pure: no database, no network.
//
// The point of #42 is that an engineer or a CCB member reads the statement on the ECR in the PLM
// without opening Norn. So `impact_statement` is clean HTML (headings, tables, lists and inline
// colour only: what the PLM's text editor keeps) with the bottom line first, the headline numbers as
// a table with their ranges, the drivers, the assumptions flagged by source, the recommendation, and
// where every number came from.
//
// Conventions the Level 1 agent follows (prompt.ts), read back here from the statement's claims:
//   "Recommendation: Approve with conditions. <reasoning>"   -> impact_recommendation + the reasoning
//   "Proposed change class: Class I. <reason>"               -> the class, shown as a proposal
//   evidence "assumption", text "[default] ..." / "[agent estimate] ..." / "[needs estimate] ..."
// A statement that does not follow them still renders; it just has no recommendation field.
import { createHash } from 'node:crypto';
import type { CompanyConfig, CostCheckHeadline } from '../../../config/src/index.ts';
import { routeFor, ROUTE_PENDING, type AssessmentRef, type EcrRef } from './routing.ts';
import type { ImpactFields } from './plm.ts';
import { deriveRecommendation, type Derived, type RuleInput } from './recommendation.ts';

export interface StatementNumber {
  key: string;
  label: string;
  unit: string;
  p10: number;
  p50: number;
  p90: number;
  evidence: string;
  resultKey: string;
}
export interface StatementClaim {
  text: string;
  evidence: string;
}
export interface StatementDoc {
  id: number;
  level: number;
  /** The ECR's own revision counter when the statement was written. */
  prRevision: number;
  createdAtIso: string;
  changeClass: string;
  route: string;
  headline: string;
  numbers: StatementNumber[];
  drivers: StatementClaim[];
  assumptions: { key: string; source: string; note: string }[];
  claims: StatementClaim[];
}

/** Where the numbers came from: what the s2_cost run's inputs and results name. */
export interface Provenance {
  /** e.g. "ERPNext baseline 2c02958e, as of 2026-10-24" */
  baseline: string;
  /** e.g. "change request rev 1 from the PLM" */
  changeRequest: string;
  codeVersion?: string;
  draws?: number;
  /** The check run the numbers are from. */
  s2RunId?: number;
  /** result key -> the formula its trace states. */
  formulas: Record<string, string>;
  /** Some number comes from mock compute. */
  mock: boolean;
  /** The run's cost check with its rows, for routing (`costCheckOf`). Not shown in the statement. */
  costCheck?: CostCheckHeadline;
  /**
   * What the recommendation rule reads (recommendation.ts), from the statement's own run. With it the
   * PLM's recommendation is the rule's, whatever the agent wrote; without it (a statement that rests
   * on no run) the agent's stands.
   */
  ruleInput?: RuleInput;
}

export interface FormatOptions {
  /** Base URL of Norn's pages, e.g. http://127.0.0.1:5173. */
  nornBaseUrl: string;
  /** The company configuration routing runs on. Without it nothing is routed and the statement's own class and route stand. */
  config?: CompanyConfig;
}

export const RECOMMENDATIONS = ['Approve with conditions', 'Approve', 'Send back', 'Reject'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const PLM_CLASSES = ['Class I', 'Class II'] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- reading the agent's conventions --------------------------------------------------------

export function parseRecommendation(claims: StatementClaim[]): { value: Recommendation; reasoning: string } | null {
  for (const c of claims) {
    const m = /^\s*recommendation\s*[:–-]\s*(approve with conditions|approve|send back|reject)\b[\s.:;,–-]*([\s\S]*)$/i.exec(c.text);
    if (!m) continue;
    const value = RECOMMENDATIONS.find(r => r.toLowerCase() === m[1]!.toLowerCase())!;
    return { value, reasoning: m[2]!.trim() };
  }
  return null;
}

export function parseClassProposal(claims: StatementClaim[]): { cls: string; reason: string } | null {
  for (const c of claims) {
    const m = /^\s*proposed change class\s*[:–-]\s*([\s\S]*)$/i.exec(c.text);
    if (!m) continue;
    const body = m[1]!.trim();
    const cls = /^class\s+(ii|i)\b/i.exec(body);
    const reason = body.replace(/^class\s+(ii|i)\b[\s.:;,–-]*/i, '').trim();
    return { cls: cls ? `Class ${cls[1]!.toUpperCase()}` : '', reason };
  }
  return null;
}

export type AssumptionTag = 'default' | 'agent estimate' | 'needs estimate' | 'given';
export function parseTag(text: string): { tag: AssumptionTag | null; body: string } {
  const m = /^\s*\[(given|default|agent[ _-]?estimate(?:d)?|needs[ _-]?estimate)\]\s*([\s\S]*)$/i.exec(text);
  if (!m) return { tag: null, body: text.trim() };
  const t = m[1]!.toLowerCase();
  return { tag: t.startsWith('agent') ? 'agent estimate' : t.startsWith('needs') ? 'needs estimate' : (t as 'given' | 'default'), body: m[2]!.trim() };
}

// ---- numbers --------------------------------------------------------------------------------

/** Dollars to the dollar; a saving in parentheses, as the ECP's cost page writes it. */
export function money(n: number): string {
  const r = Math.round(Math.abs(n)).toLocaleString('en-US');
  return Math.round(n) < 0 ? `($${r})` : `$${r}`;
}

export function show(n: number, unit: string): string {
  if (unit === 'USD') return money(n);
  const v = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit ? `${v} ${unit}` : v;
}

// ---- evidence tags ---------------------------------------------------------------------------

// Placeholder colours: Tyler has not chosen the evidence colours yet (docs/GLOSSARY.md).
const EVIDENCE: Record<string, { label: string; color: string }> = {
  fact: { label: 'Fact', color: '#0b6b2e' },
  assumption: { label: 'Assumption', color: '#8a5a00' },
  computation: { label: 'Computation', color: '#0b4f9c' },
  judgment: { label: 'Judgment', color: '#6b2fa0' },
};
const tag = (evidence: string) => {
  const e = EVIDENCE[evidence] ?? { label: evidence, color: '#555555' };
  return `<span style="color:${e.color};font-weight:600">[${esc(e.label)}]</span>`;
};

const TAG_LABEL: Record<AssumptionTag, string> = { given: 'Given', default: 'Default', 'agent estimate': 'Agent estimate', 'needs estimate': 'Needs an estimate' };

const TH = 'style="border:1px solid #c8ccd0;padding:4px 8px;background:#f2f4f6;text-align:left"';
const THR = 'style="border:1px solid #c8ccd0;padding:4px 8px;background:#f2f4f6;text-align:right"';
const TD = 'style="border:1px solid #c8ccd0;padding:4px 8px;vertical-align:top"';
const TDR = 'style="border:1px solid #c8ccd0;padding:4px 8px;text-align:right;white-space:nowrap"';

const LEVELS: Record<number, string> = {
  1: 'Level 1, provisional: a quick first read that deeper research may change',
  2: 'Level 2: researched, and reviewed by a second agent',
  3: "Level 3: Norn's final verdict",
};

// ---- the statement ------------------------------------------------------------------------------

export interface Formatted {
  fields: ImpactFields;
  /** Short token written into the HTML; a later read finds it to know this statement is already there. */
  ref: string;
  /** The recommendation written to the PLM: the rule's when it could be derived, else the one parsed from the claims. */
  recommendation: Recommendation | null;
  /** Set when the agent's recommendation differed from the rule's (or was missing) and the rule's was written. */
  overridden?: { agent: Recommendation | null; derived: Derived };
}

/** The ECR number's own link in Norn. */
export const nornUrl = (base: string, ecrNumber: string) => `${base.replace(/\/+$/, '')}/ecr/${encodeURIComponent(ecrNumber)}`;

export function assessmentOf(s: StatementDoc, costCheck?: CostCheckHeadline): AssessmentRef {
  const numbers: AssessmentRef['numbers'] = {};
  for (const n of s.numbers) if (n.resultKey) numbers[n.resultKey] = { p10: n.p10, p50: n.p50, p90: n.p90, unit: n.unit };
  return { numbers, costCheck };
}

export function statementToPlmFields(s: StatementDoc, ecr: EcrRef, prov: Provenance, opts: FormatOptions): Formatted {
  const agentRec = parseRecommendation(s.claims);
  // Two runs on the same inputs must not differ: the rule's recommendation wins over the agent's, with a note.
  const derived = prov.ruleInput ? deriveRecommendation(prov.ruleInput) : undefined;
  const overridden = derived && agentRec?.value !== derived.recommendation ? { agent: agentRec?.value ?? null, derived } : undefined;
  const rec: { value: Recommendation; reasoning: string } | null = !derived
    ? agentRec
    : { value: derived.recommendation, reasoning: overridden || !agentRec?.reasoning ? derived.reasoning : agentRec.reasoning };
  const proposal = parseClassProposal(s.claims);
  // What Norn's routing decides wins; where it decides nothing (no configuration, or no class set) the statement's own class and route stand.
  const routed = routeFor(ecr, assessmentOf(s, prov.costCheck), opts.config);
  const cls = routed.class ?? (PLM_CLASSES.includes(s.changeClass as (typeof PLM_CLASSES)[number]) ? s.changeClass : undefined);
  const route = routed.route ?? (s.route.trim() || ROUTE_PENDING);
  const classIsProposal = routed.class === undefined;
  const url = nornUrl(opts.nornBaseUrl, ecr.number);

  const out: string[] = [];
  out.push(`<h4 style="margin:0 0 6px 0">Norn impact statement</h4>`);
  out.push(`<p style="margin:0 0 8px 0;color:#555555">${esc(LEVELS[s.level] ?? `Level ${s.level}`)}. Revision ${ecr.revision} of ${esc(ecr.number)}.${prov.mock ? ' <b style="color:#b00020">MOCK numbers: placeholders, not a forecast.</b>' : ''}</p>`);
  out.push(`<p style="margin:0 0 8px 0"><b>Bottom line.</b> ${esc(s.headline)}</p>`);
  if (rec) {
    const note = overridden
      ? `<br><i style="color:#555555">Norn's rule gave this recommendation (rule ${overridden.derived.rule}); the Level 1 agent ${overridden.agent ? `wrote "${esc(overridden.agent)}"` : 'wrote none'}, so the rule's stands.</i>`
      : '';
    out.push(`<p style="margin:0 0 8px 0"><b>Recommendation: ${esc(rec.value)}</b> ${tag('judgment')}${rec.reasoning ? `<br>${esc(rec.reasoning)}` : ''}${note}</p>`);
  }

  // Headline numbers.
  out.push(`<h5 style="margin:12px 0 4px 0">Headline numbers</h5>`);
  out.push(`<table style="border-collapse:collapse"><thead><tr><th ${TH}>Measure</th><th ${THR}>Low (p10)</th><th ${THR}>Median (p50)</th><th ${THR}>High (p90)</th><th ${TH}>Where it comes from</th></tr></thead><tbody>`);
  for (const n of s.numbers) {
    const formula = n.resultKey ? prov.formulas[n.resultKey] : undefined;
    const basis = n.evidence === 'computation' ? `Norn's check ${esc(n.resultKey)}${formula ? `: ${esc(formula)}` : ''}` : `${esc((EVIDENCE[n.evidence] ?? { label: n.evidence }).label)}, stated by the agent`;
    out.push(`<tr><td ${TD}>${esc(n.label)} ${tag(n.evidence)}</td><td ${TDR}>${esc(show(n.p10, n.unit))}</td><td ${TDR}><b>${esc(show(n.p50, n.unit))}</b></td><td ${TDR}>${esc(show(n.p90, n.unit))}</td><td ${TD}>${basis}</td></tr>`);
  }
  out.push(`</tbody></table>`);
  out.push(`<p style="margin:4px 0 0 0;color:#555555;font-size:12px">A range, not a point: in 10 out of 100 simulated outcomes the cost is below the low figure, and in 10 out of 100 it is above the high one. Savings are in parentheses.</p>`);

  if (s.drivers.length) {
    out.push(`<h5 style="margin:12px 0 4px 0">What moves the numbers</h5><ul style="margin:0">`);
    for (const d of s.drivers) out.push(`<li>${esc(d.text)} ${tag(d.evidence)}</li>`);
    out.push(`</ul>`);
  }

  // Assumptions: tagged claims first, then the assumption rows Norn holds.
  const assumed = s.claims.filter(c => c.evidence === 'assumption');
  if (assumed.length || s.assumptions.length) {
    out.push(`<h5 style="margin:12px 0 4px 0">What it rests on</h5>`);
    out.push(`<table style="border-collapse:collapse"><thead><tr><th ${TH}>Assumption</th><th ${TH}>Source</th></tr></thead><tbody>`);
    for (const c of assumed) {
      const t = parseTag(c.text);
      out.push(`<tr><td ${TD}>${esc(t.body)}</td><td ${TD}>${t.tag ? esc(TAG_LABEL[t.tag]) : 'Not stated'} ${tag('assumption')}</td></tr>`);
    }
    for (const a of s.assumptions) {
      const label = a.source === 'agent_estimated' ? 'Agent estimate' : a.source === 'given' ? 'Given' : 'Default';
      out.push(`<tr><td ${TD}>${esc(a.key)}${a.note ? `: ${esc(a.note)}` : ''}</td><td ${TD}>${label} ${tag(a.source === 'given' ? 'fact' : 'assumption')}</td></tr>`);
    }
    out.push(`</tbody></table>`);
  }

  // Everything else the agent claimed (facts, further judgments), minus what is shown above.
  const shown = new Set<StatementClaim>([...assumed]);
  for (const c of s.claims) if (/^\s*recommendation\s*[:–-]/i.test(c.text) || /^\s*proposed change class\s*[:–-]/i.test(c.text)) shown.add(c);
  const other = s.claims.filter(c => !shown.has(c));
  if (other.length) {
    out.push(`<h5 style="margin:12px 0 4px 0">Also noted</h5><ul style="margin:0">`);
    for (const c of other) out.push(`<li>${esc(c.text)} ${tag(c.evidence)}</li>`);
    out.push(`</ul>`);
  }

  // Class and route.
  out.push(`<h5 style="margin:12px 0 4px 0">Change class and approval route</h5><ul style="margin:0">`);
  if (cls && !classIsProposal) out.push(`<li>Change class: ${esc(cls)}.</li>`);
  else if (cls || proposal)
    out.push(`<li>Change class: ${esc(cls ?? proposal?.cls ?? '')} <b>(proposed by Norn's Level 1 agent; the CM analyst decides)</b> ${tag('judgment')}${proposal?.reason ? `. ${esc(proposal.reason)}` : ''}</li>`);
  else out.push(`<li>Change class: none proposed.</li>`);
  out.push(`<li>Approval route: ${esc(route)}${routed.route === undefined ? ' (not yet decided)' : ''}.</li></ul>`);

  // Sources.
  out.push(`<h5 style="margin:12px 0 4px 0">Sources</h5><ul style="margin:0">`);
  out.push(`<li>Baseline (costs, BOMs, stock, volume plan): ${esc(prov.baseline)}.</li>`);
  out.push(`<li>The request: ${esc(prov.changeRequest)} (${esc(ecr.number)}, filed in the PLM).</li>`);
  out.push(`<li>Numbers: computed by Norn's cost check${prov.codeVersion ? ` (${esc(prov.codeVersion)}` : ''}${prov.draws ? `, ${prov.draws.toLocaleString('en-US')} simulated outcomes` : ''}${prov.codeVersion ? ')' : ''}${prov.s2RunId ? `, run ${prov.s2RunId}` : ''}. The ERP was only read.</li>`);
  out.push(`</ul>`);

  const body = out.join('\n');
  const ref = `${s.id}.${createHash('sha256').update(body).update(JSON.stringify([cls ?? null, route, rec?.value ?? null, url, s.level])).digest('hex').slice(0, 8)}`;
  const footer = `<p style="margin:12px 0 0 0;color:#555555;font-size:12px">Written by Norn on ${esc(s.createdAtIso.slice(0, 16).replace('T', ' '))} UTC. <a href="${esc(url)}">Open in Norn</a> for the checks, the trace behind each number and the agent's work. Ref ${ref}</p>`;

  const fields: ImpactFields = {
    impact_report_level: String(s.level),
    impact_recommendation: rec?.value ?? null,
    impact_change_class: cls ?? null,
    impact_approval_route: route,
    impact_norn_url: url,
    impact_statement: `${body}\n${footer}`,
  };
  return { fields, ref, recommendation: rec?.value ?? null, ...(overridden ? { overridden } : {}) };
}

/** Whether the PLM already shows this exact statement: same ref in the text, same plain fields. */
export function alreadyPublished(current: Record<string, string | undefined> | null, f: Formatted): boolean {
  if (!current) return false;
  const html = current.impact_statement ?? '';
  if (!html.includes(`Ref ${f.ref}`)) return false;
  for (const k of ['impact_report_level', 'impact_recommendation', 'impact_change_class', 'impact_approval_route', 'impact_norn_url'] as const) {
    const want = f.fields[k];
    if ((want === null || want === undefined ? '' : String(want)) !== (current[k] ?? '')) return false;
  }
  return true;
}
