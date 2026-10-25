// ECR-0423: the avionics closeout panel from grey to charcoal. The fast-track case: Class II, same
// supplier, no tooling, so Norn approves within its limits, and the ECO is released. The numbers
// are the real checks' on Bowman's dataset; the approval, the route and the ERP change package
// are mock.
import type { CheckResultRow } from '../../../../checks/src/rows.ts';
import { fromChecks, monthLabel } from '../adapter.ts';
import rows from '../fixtures/ecr-0423.json';
import listCosts from '../fixtures/list-costs.json';
import type { ActivityEvent, Check, EcrSummary, ErpPackage, ImpactAssessment, Trace } from '../types.ts';
import { usd } from '../../ui/fmt.ts';
import { detail0423 } from './details.ts';

const v = fromChecks(rows as CheckResultRow[]);
const net = v.cost.net;
const unit = v.headline.unitCost[0].figure;

const traces: Record<string, Trace> = {
  ...v.traces,
  class: {
    id: 'class', title: 'Change class', evidence: 'judgment',
    summary: 'Class II and FAA minor: a colour change in a non-structural panel. The supplier’s flame-test certificate covers the new masterbatch, and the panel is not a flame barrier.',
    value: { text: 'Class II · FAA minor' },
    sources: [{ system: 'PLM', ref: 'ECR-0423 classification' }, { system: 'Policy', ref: 'Never-fast-track list', detail: 'None of the five exclusions applies' }],
    inputs: [], assumptions: [], producedBy: { check: 'Change class (#33)', actor: 'Fern router', note: 'Mock' },
  },
  rec: {
    id: 'rec', title: 'Fern’s decision', evidence: 'judgment',
    summary: 'Bowman lets Fern approve a change that is Class II, FAA minor, from the same supplier, with no tooling and under the dollar limit. This one meets all of it. Convening the board would cost more than the saving.',
    value: { text: 'Approved', range: 'Fast track, within Fern’s limits' },
    sources: [{ system: 'Policy', ref: 'Bowman fast-track criteria' }, { system: 'Fern', ref: 'Policy gate', detail: 'Allowed: within autonomy limits' }],
    inputs: [], assumptions: [], producedBy: { check: 'Policy gate (#43)', actor: 'Fern', onBehalfOf: 'Bowman’s fast-track rule' },
  },
};

const checks: Check[] = [
  { id: 'bom', name: 'BOM delta', state: 'passed', summary: '1 item revised, no BOM line changes', by: 'Reader' },
  { id: 'cost', name: 'Cost', state: 'passed', summary: `Net ${usd(net.point ?? net.p50, { plus: true, cents: true })} in the first 12 months, a saving`, by: 'Cost check' },
  { id: 'timeline', name: 'Time to the line', state: 'passed', summary: `The grey stock is used up first: the change starts at S/N ${v.cutIn.serial}, ${monthLabel(v.cutIn.month)} (default)`, by: 'Cost check' },
  { id: 'supply', name: 'Supply risk', state: 'passed', summary: 'Same supplier, same mould', by: 'Fern supply agent' },
  { id: 'class', name: 'Classification', state: 'passed', summary: 'Class II, FAA minor: fast track', by: 'Fern router' },
];

const activity: ActivityEvent[] = [
  { id: 'c1', at: '2026-10-22T10:19:00-07:00', actor: 'Ayesha Karimi', actorKind: 'person', kind: 'filed', text: 'filed the ECR' },
  { id: 'c2', at: '2026-10-22T10:20:00-07:00', actor: 'Fern', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'ran_checks', text: 'ran the impact checks', detail: 'All passed.' },
  { id: 'c3', at: '2026-10-22T10:20:30-07:00', actor: 'Fern', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'label', text: 'added the labels Class II, FAA minor, Fast track and Vesper' },
  { id: 'c4', at: '2026-10-22T10:21:00-07:00', actor: 'Fern', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'report', text: 'posted the impact statement, Level 1', level: 1 },
  { id: 'c5', at: '2026-10-22T10:30:00-07:00', actor: 'Fern blind checker', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'research', text: 'formed its own estimate without seeing the answer', detail: 'Same sign, same size.' },
  { id: 'c6', at: '2026-10-22T10:44:00-07:00', actor: 'Fern', actorKind: 'norn', spawnedBy: 'Norn, for Ayesha Karimi', kind: 'report', text: 'posted Level 3: Fern’s final verdict', detail: 'Checked the never-fast-track list: clear.', level: 3 },
  { id: 'c7', at: '2026-10-23T13:10:00-07:00', actor: 'Fern', actorKind: 'norn', onBehalfOf: 'Bowman’s fast-track rule', kind: 'approved', text: 'approved these changes', detail: 'Policy gate: allowed, within limits. No CCB.' },
  { id: 'c8', at: '2026-10-23T13:12:00-07:00', actor: 'Fern', actorKind: 'norn', onBehalfOf: 'Bowman’s fast-track rule', kind: 'policy', text: 'prepared the ERP change package for ECO release', detail: 'Three lines for a person to enter in ERPNext.' },
];

/** What Norn hands over when the ECO is released. A person enters it in the ERP; Norn never does. */
const erpPackage: ErpPackage = {
  system: 'ERPNext',
  lines: [
    {
      kind: 'MBOM', title: 'Manufacturing BOM, Vesper V4: avionics bay closeout panel', status: 'To enter in ERPNext',
      diff: [
        { kind: 'ctx', text: 'BOM  Vesper V4 > Avionics bay closeout' },
        { kind: 'del', text: '  BW-9440-030 Rev A  qty 1', remark: 'light grey' },
        { kind: 'add', text: '  BW-9440-030 Rev B  qty 1', remark: 'charcoal, effective S/N 28' },
      ],
    },
    {
      kind: 'Standard cost', title: 'BW-9440-030: new standard cost', status: 'To enter in ERPNext',
      diff: [
        { kind: 'del', text: 'standard_rate:  41.50' },
        { kind: 'add', text: 'standard_rate:  39.60', remark: '(1.90) per panel, (11.40) per aircraft' },
      ],
    },
    {
      kind: 'Journal entry', title: 'Standard cost revaluation of the grey panels on hand', status: 'To enter in ERPNext',
      diff: [
        { kind: 'add', text: 'Dr  Stock Adjustment             (193.80)', remark: '102 panels on hand and on order x (1.90)' },
        { kind: 'add', text: 'Cr  Stock In Hand                (193.80)' },
      ],
    },
  ],
};

const list = listCosts['ECR-0423'];
export const ecr0423Summary: EcrSummary = {
  id: 'ECR-0423', title: 'Avionics bay closeout panel BW-9440-030: grey to charcoal',
  program: 'Vesper', partNumber: 'BW-9440-030', companyClass: 'II', faa: 'minor', priority: 'Routine', status: 'ECO released',
  cost: { p10: net.p10 ?? net.p50, p50: net.p50, p90: net.p90 ?? net.p50, point: net.point, from: list.from }, level: 3,
  lastActivity: '2026-10-23T13:12:00-07:00', lastActivityBy: 'ECO released',
  originator: 'Ayesha Karimi', filedOn: '2026-10-22', flag: 'Fast track: Fern approved within its limits', hasAssessment: true,
  reviewers: [{ name: 'Fern', state: 'approved' }], checks: 'passed', comments: 8, change: 'BW-9440-030 from grey to charcoal',
};

export const ecr0423: ImpactAssessment = {
  ecr: ecr0423Summary, source: 'saved', level: 3,
  headline: { ...v.headline, unitCost: v.headline.unitCost.map(u => ({ ...u, note: `${usd(unit.point ?? unit.p50, { cents: true })} per aircraft at the stated price` })) },
  cost: v.cost, cutIn: v.cutIn, sCurve: v.sCurve, drivers: v.drivers, scenarios: [],
  changeClass: { company: 'II', companyWhy: 'Colour only, same supplier', faa: 'minor', faaWhy: 'Non-structural, not a flame barrier', evidence: 'judgment', traceId: 'class' },
  route: {
    tier: 'Fast track: Class II, FAA minor, same supplier, no tooling. No CCB.',
    steps: [
      { role: 'Within Fern’s limits', person: 'Fern', state: 'approved', when: 'Oct 23' },
      { role: 'CCB', state: 'not_required' },
    ],
  },
  recommendation: {
    verdict: 'approve', headline: 'Fern approved within its limits', traceId: 'rec',
    reasons: [
      { text: 'Class II and FAA minor, same supplier, no tooling', evidence: 'fact', traceId: 'class' },
      { text: 'None of the never-fast-track cases applies', evidence: 'judgment', traceId: 'rec' },
      { text: 'Grey stock is used up first, so nothing is written off', evidence: 'fact', traceId: v.cutIn ? 'cutin' : undefined },
      { text: 'A board meeting would cost more than the saving', evidence: 'judgment', traceId: 'rec' },
    ],
  },
  needed: [],
  activity, ...detail0423, checks, erpPackage,
  mock: ['narrative', 'class', 'route', 'recommendation', 'erp'],
  traces,
};
