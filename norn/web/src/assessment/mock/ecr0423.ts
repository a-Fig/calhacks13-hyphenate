// ECR-0423: the avionics closeout panel from grey to charcoal. The fast-track case (bowman/data
// scenarios.ts, S3): Class II, same supplier, no tooling, so Norn approves within its limits. MOCK.
import { likelihoodWord, runModel, type InputDef, type RowDef } from '../engine.ts';
import type { ActivityEvent, Check, EcrSummary, ImpactAssessment } from '../types.ts';
import { detail0423 } from './details.ts';
import { dateShort, usd } from '../../ui/fmt.ts';

const DAY = 86400000;
const APPROVAL = Date.UTC(2026, 9, 23);
const AT = '2026-10-22T10:20:00-07:00';

const inputs: InputDef[] = [
  {
    key: 'price', label: 'Panel price change', unit: 'usd', evidence: 'fact',
    q: { p10: -1.9, p50: -1.9, p90: -1.9 }, fmt: v => usd(v, { cents: true }),
    trace: { summary: 'Charcoal masterbatch is cheaper: $39.60 against $41.50 for grey.', sources: [{ system: 'PLM', ref: 'ECR-0423 item change', detail: 'BW-9440-030 unit price $41.50 to $39.60' }, { system: 'ERP', ref: 'Supplier price, same supplier' }] },
  },
  {
    key: 'useUp', label: 'Weeks to use up the grey stock', unit: 'weeks', evidence: 'computation',
    q: { p10: 2, p50: 5, p90: 12, lo: 1, hi: 16 }, fmt: v => `${v} wk`,
    trace: {
      summary: 'Existing grey panels are used first, so there is no write-off and the saving starts later.',
      sources: [{ system: 'ERP', ref: 'Stock, BW-9440-030', detail: 'Grey panels in stores and WIP' }, { system: 'ERP', ref: 'Volume plan', detail: 'Two Vesper aircraft a month' }],
      formula: { expression: 'weeks = grey panels on hand / (6 x aircraft per week)' },
    },
  },
  {
    key: 'draw', label: 'Drawing revision hours', unit: 'count', evidence: 'assumption',
    q: { p10: 0.5, p50: 1, p90: 2 }, fmt: v => `${v} h`,
    trace: { summary: 'A colour callout on one drawing.', sources: [{ system: 'PLM', ref: 'ECR-0423 description' }], assumptions: [{ label: 'Hours', display: '1 h', origin: 'agent_estimated', source: 'Norn cost agent' }] },
  },
];

const rows: RowDef[] = [
  {
    id: 'p1', block: 'production', label: 'Panel unit cost, charcoal vs grey', evidence: 'computation', step: 1,
    note: 'Six panels an aircraft, from the end of the grey stock',
    value: x => x.price * 6 * Math.max(0, 24 - x.useUp * 0.46),
    unit: { value: x => x.price, qty: 6 * 22, evidence: 'fact', traceId: 'in.price' },
    trace: {
      summary: 'Saves $1.90 a panel, $11.40 an aircraft, on about 22 aircraft built after the grey stock is gone.',
      sources: [{ system: 'PLM', ref: 'ECR-0423 cost page' }, { system: 'ERP', ref: 'Volume plan, 24 aircraft in 2027' }],
      inputs: [
        { label: 'Panel price change', display: '($1.90)', evidence: 'fact', traceId: 'in.price' },
        { label: 'Weeks to use up the grey stock', display: '5 wk', evidence: 'computation', traceId: 'in.useUp' },
      ],
      formula: { expression: 'price change x 6 panels x aircraft after the stock is used', worked: '($1.90) x 6 x 21.7 = ($247)' },
    },
  },
  {
    id: 'p2', block: 'production', label: 'Drawing and data revision', evidence: 'assumption', oneTime: true, note: '1 h at $145', step: 1,
    value: x => x.draw * 145,
    trace: { summary: 'One drawing callout.', sources: [{ system: 'PLM', ref: 'ECR-0423' }], inputs: [{ label: 'Hours', display: '1 h', evidence: 'assumption', traceId: 'in.draw' }], formula: { expression: 'hours x rate', worked: '1 h x $145 = $145' } },
  },
  {
    id: 'p3', block: 'production', label: 'Tooling, first article, retrofit', evidence: 'judgment', oneTime: true, note: 'None needed', step: 1,
    value: () => 0,
    trace: { summary: 'Same supplier, same mould, a masterbatch change only. No tooling, no first-article trigger, nothing built is touched.', sources: [{ system: 'PLM', ref: 'ECR-0423 description' }, { system: 'Policy', ref: 'Fast-track criteria' }] },
  },
];

const model = runModel({
  seed: 423, draws: 10000, at: AT, inputs, rows,
  extras: { cutIn: x => APPROVAL + x.useUp * 7 * DAY, useUp: x => x.useUp, unit: x => x.price * 6 },
  driverKeys: ['useUp', 'draw'],
  netTrace: { summary: 'The saving net of the drawing revision, on the same draws. At the 650 aircraft a year Bowman plans for 2030 the saving is about $7,400 a year.', sources: [{ system: 'Norn', ref: 'Cost check (S2)' }], formula: { expression: 'percentile of (sum of lines)' } },
  subtotalTrace: b => ({ summary: `The ${b} lines, summed.`, sources: [{ system: 'Norn', ref: 'Cost check (S2)' }] }),
});
const tr = model.traces;
tr['x.unit'] = model.makeTrace('x.unit', 'Unit cost change per aircraft', 'computation', {
  summary: 'Six panels, $1.90 cheaper each.', sources: [{ system: 'PLM', ref: 'ECR-0423 cost page' }],
  inputs: [{ label: 'Panel price change', display: '($1.90)', evidence: 'fact', traceId: 'in.price' }],
  formula: { expression: 'price change x 6', worked: '($1.90) x 6 = ($11.40)' }, check: 'Cost (S2)', actor: 'Cost check',
});
tr['x.cutIn'] = model.makeTrace('x.cutIn', 'Cut-in date', 'computation', {
  summary: 'The first lot of charcoal panels is used once the grey stock runs out.', sources: tr['in.useUp'].sources,
  inputs: [{ label: 'Weeks to use up the grey stock', display: '5 wk', evidence: 'computation', traceId: 'in.useUp' }], check: 'Time to the line (S3)', actor: 'Timeline check',
});
tr['supply'] = model.makeTrace('supply', 'Supply risk', 'judgment', {
  value: { text: 'Low', range: 'Same supplier, same mould' },
  summary: 'Nothing about the supply changes: same supplier, same tool, same lead time.', sources: [{ system: 'ERP', ref: 'Sourcing, BW-9440-030' }], check: 'Supply risk (S4)', actor: 'Supply agent',
});
tr['class'] = model.makeTrace('class', 'Change class', 'judgment', {
  value: { text: 'Class II · FAA minor' },
  summary: 'Class II and FAA minor: a colour change in a non-structural panel. The supplier’s flame-test certificate covers the new masterbatch, and the panel is not a flame barrier.',
  sources: [{ system: 'PLM', ref: 'ECR-0423 classification' }, { system: 'Policy', ref: 'Never-fast-track list', detail: 'None of the five exclusions applies' }],
  check: 'Change class (#33)', actor: 'Router agent',
});
tr['rec'] = model.makeTrace('rec', 'Norn’s decision', 'judgment', {
  value: { text: 'Approved', range: 'Fast track, within Norn’s limits' },
  summary: 'Bowman lets Norn approve a change that is Class II, FAA minor, from the same supplier, with no tooling and under the dollar limit. This one meets all of it. Convening the board would cost more than the saving.',
  sources: [{ system: 'Policy', ref: 'Bowman fast-track criteria' }, { system: 'Norn', ref: 'Policy gate', detail: 'Allowed: within autonomy limits' }],
  check: 'Policy gate (#43)', actor: 'Norn', onBehalfOf: 'Bowman’s fast-track rule',
});

const net = model.net;
const checks: Check[] = [
  { id: 'bom', name: 'BOM delta', state: 'passed', summary: '1 item revised, no BOM line changes', took: '0.3 s', by: 'Reader' },
  { id: 'cost', name: 'Cost', state: 'passed', summary: `Year 1 ${usd(net.p50, { plus: true })}, a net saving`, took: '3.1 s', by: 'Cost check' },
  { id: 'timeline', name: 'Time to the line', state: 'passed', summary: 'After the grey stock is used up', took: '0.9 s', by: 'Timeline check' },
  { id: 'supply', name: 'Supply risk', state: 'passed', summary: 'Same supplier, same mould', took: '1.2 s', by: 'Supply agent' },
  { id: 'class', name: 'Classification', state: 'passed', summary: 'Class II, FAA minor: fast track', took: '0.6 s', by: 'Router' },
];
const pSave = model.sCurve.points.filter(p => p.x < 0).length / 100;
export const ecr0423Summary: EcrSummary = {
  id: 'ECR-0423', title: 'Avionics bay closeout panel BW-9440-030: grey to charcoal',
  program: 'Vesper', partNumber: 'BW-9440-030', companyClass: 'II', faa: 'minor', priority: 'Routine', status: 'Approved',
  cost: { p10: net.p10 ?? net.p50, p50: net.p50, p90: net.p90 ?? net.p50 }, level: 3,
  lastActivity: '2026-10-23T13:10:00-07:00', lastActivityBy: 'Norn approved, fast track',
  originator: 'Ayesha Karimi', filedOn: '2026-10-22', flag: 'Fast track: Norn approved within its limits', hasAssessment: true,
  reviewers: [{ name: 'Norn', state: 'approved' }], checks: 'passed', comments: 7, change: 'BW-9440-030 from grey to charcoal',
};

const activity: ActivityEvent[] = [
  { id: 'c1', at: '2026-10-22T10:19:00-07:00', actor: 'Ayesha Karimi', actorKind: 'person', kind: 'filed', text: 'filed the ECR' },
  { id: 'c2', at: '2026-10-22T10:20:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'ran_checks', text: 'ran 5 impact checks', detail: 'All passed.' },
  { id: 'c3', at: '2026-10-22T10:20:30-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'label', text: 'added the labels Class II, FAA minor, Fast track and Vesper' },
  { id: 'c4', at: '2026-10-22T10:21:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'report', text: 'posted the impact statement, Level 1', level: 1 },
  { id: 'c5', at: '2026-10-22T10:30:00-07:00', actor: 'Norn blind checker', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'research', text: 'formed its own estimate without seeing the answer', detail: 'Same sign, same size.' },
  { id: 'c6', at: '2026-10-22T10:44:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'report', text: 'posted Level 3: Norn\u2019s final verdict', detail: 'Checked the never-fast-track list: clear.', level: 3 },
  { id: 'c7', at: '2026-10-23T13:10:00-07:00', actor: 'Norn', actorKind: 'norn', onBehalfOf: 'Bowman\u2019s fast-track rule', kind: 'approved', text: 'approved these changes', detail: 'Policy gate: allowed, within limits. No CCB.' },
];

export const ecr0423: ImpactAssessment = {
  ecr: ecr0423Summary, level: 3,
  headline: {
    unitCost: model.extra('unit', 'usd'), unitCostNote: '$1.90 less per panel, 6 per aircraft',
    year1: net, year1Likelihood: { word: likelihoodWord(pSave), event: 'a net saving', probability: pSave },
    cutIn: model.extra('cutIn', 'date'), cutInNote: 'After the grey stock is used up',
    cutInLikelihood: { word: likelihoodWord(model.prob(e => e.useUp <= 8)), event: `by ${dateShort(APPROVAL + 8 * 7 * DAY)}`, probability: model.prob(e => e.useUp <= 8) },
    supply: { id: 'supply', level: 'low', evidence: 'judgment', note: 'Same supplier, same mould', likelihood: { word: 'almost no chance', event: 'of a supply change', probability: 0.02 } },
  },
  cost: { rows: model.rows, subtotals: model.subtotals, net, yearLabel: '2027' },
  sCurve: model.sCurve, drivers: model.drivers, scenarios: [],
  changeClass: { company: 'II', companyWhy: 'Colour only, same supplier', faa: 'minor', faaWhy: 'Non-structural, not a flame barrier', evidence: 'judgment', traceId: 'class' },
  route: {
    tier: 'Fast track: Class II, FAA minor, same supplier, no tooling. No CCB.',
    steps: [
      { role: 'Within Norn’s limits', person: 'Norn', state: 'approved', when: 'Oct 23' },
      { role: 'CCB', state: 'not_required' },
    ],
  },
  recommendation: {
    verdict: 'approve', headline: 'Norn approved within its limits', traceId: 'rec',
    reasons: [
      { text: 'Class II and FAA minor, same supplier, no tooling', evidence: 'fact', traceId: 'class' },
      { text: 'None of the never-fast-track cases applies', evidence: 'judgment', traceId: 'rec' },
      { text: 'Grey stock is used up first, so nothing is written off', evidence: 'fact', traceId: 'in.useUp' },
      { text: 'A board meeting would cost more than the saving', evidence: 'judgment', traceId: 'rec' },
    ],
  },
  needed: [],
  activity, ...detail0423, checks, traces: tr,
};
