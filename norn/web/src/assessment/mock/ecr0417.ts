// ECR-0417, the demo's star: the motor-controller bracket, Rev B to Rev C, after the vibration crack.
//
// The numbers are the real checks' (norn/checks) on Bowman's dataset, saved by
// web/scripts/make-fixtures.ts and read through fromChecks(), the same function live rows will use:
//   Level 1  the checks as they stand: about $157k a year, with three lines the originator left
//            blank flagged "needs an estimate" and counted as $0, and the use-up-or-scrap decision
//            the widest swing.
//   Level 3  Norn's agent has estimated those lines (a mock agent: the estimates are made up, the
//            arithmetic around them is the checks'). The hold on S/N 011 onward alone is about
//            $147k, so the total about doubles. That is the demo's point: Norn finds the line the
//            originator left blank.
// What the checks do not produce yet (the cut-in range, supply risk, class, route, recommendation,
// the agent timeline) is mock and named in `mock`, so the screens label it.
import type { CheckResultRow } from '../../../../checks/src/rows.ts';
import { fromChecks } from '../adapter.ts';
import l1Rows from '../fixtures/ecr-0417.l1.json';
import l3Rows from '../fixtures/ecr-0417.l3.json';
import listCosts from '../fixtures/list-costs.json';
import type { ActivityEvent, Check, EcrSummary, ImpactAssessment, Trace } from '../types.ts';
import { dateShort, pointOf, usdK } from '../../ui/fmt.ts';
import { detail0417 } from './details.ts';

const v1 = fromChecks(l1Rows as CheckResultRow[]);
const v3 = fromChecks(l3Rows as CheckResultRow[]);
const net1 = v1.cost.net;
const net3 = v3.cost.net;
const DAY = 86400000;
const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

// Norn's agent's range for when Rev C reaches the line: Halden ships the first lot about 14 weeks
// after the order, so late February, not the November 2026 the ECR states. Mock.
const arrives = { p10: D(2027, 2, 11), p50: D(2027, 2, 25), p90: D(2027, 4, 1) };
const arrivalTrace: Trace = {
  id: 'cutin-estimate', title: 'When Rev C reaches the line', evidence: 'assumption',
  summary: 'The ECR states S/N 011 and on, which the checks take as November 2026. Halden ships the first lot about 14 weeks after the order and Bowman needs a week to receive it, so Rev C cannot be on the line before late February. Past ECOs with a tooling step slipped 5 to 10 weeks, which sets the late end.',
  value: { text: 'Feb 25, 2027', range: 'Feb 11 – Apr 1, 2027' },
  sources: [
    { system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'First lot ships about 14 weeks after the order; plate stock 6 weeks in parallel with an 8 week fixture build' },
    { system: 'Policy', ref: 'CCB schedule', detail: 'Next meeting Thursday Nov 12, 2026' },
    { system: 'History', ref: 'Released ECOs', detail: 'Six of ten slipped 5 to 10 weeks; all had a tooling step, a long lead time or a qualification slot' },
  ],
  inputs: [],
  assumptions: [
    { label: 'Order placed on approval day', display: 'Nov 12, 2026', origin: 'default', source: 'Norn configuration for Bowman' },
    { label: 'Receiving and first-article review', display: '1 week', origin: 'agent_estimated', source: 'Norn planner agent, from the last four Halden lots' },
  ],
  formula: { expression: 'Rev C on the line = CCB approval + first-lot lead time + receiving', worked: 'Nov 12, 2026 + 14 weeks + 1 week = Feb 25, 2027' },
  producedBy: { check: 'Timeline estimate (the check, S3, is not built yet)', actor: 'Norn planner agent', onBehalfOf: 'Wei-Lin Zhao', note: 'Mock: a stand-in agent, not a live model' },
};

const traces: Record<string, Trace> = {
  ...v3.traces,
  'cutin-estimate': arrivalTrace,
  supply: {
    id: 'supply', title: 'Supply risk', evidence: 'judgment',
    summary: 'Halden is the only qualified source for the bracket, and there is no Rev C stock to bridge a delay. A slip of two weeks or more is unlikely, but a longer outage has no fallback.',
    value: { text: 'Moderate', range: 'One source, no Rev C stock' },
    sources: [{ system: 'ERP', ref: 'Sourcing, BW-5120-210', detail: 'Sole source: Halden Precision. Not on the strategic single-source list' }, { system: 'Quote', ref: 'Q-HAL-26-1187' }],
    inputs: [], assumptions: [{ label: 'Outages are shown as scenarios, not blended into the range', display: 'what-ifs below', origin: 'default', source: 'Norn configuration' }],
    producedBy: { check: 'Supply risk (the check, S4, is not built yet)', actor: 'Norn supply agent', note: 'Mock' },
  },
  class: {
    id: 'class', title: 'Change class', evidence: 'judgment',
    summary: 'Company Class I, because the change costs money and reaches aircraft already built. FAA minor, because the part is secondary structure with the same envelope and interfaces. The two are set separately and here they differ.',
    value: { text: 'Class I · FAA minor', range: 'Company class and FAA class are set separately' },
    sources: [{ system: 'PLM', ref: 'ECR-0417 classification', detail: 'Originator proposes Class I and FAA minor under 14 CFR 21.93(a)' }, { system: 'Policy', ref: 'Bowman change classes', detail: 'Class I: cost, retrofit of built aircraft, interchangeability' }],
    inputs: [], assumptions: [{ label: 'FAA minor', display: 'proposed by the originator', origin: 'given', source: 'Gideon Falk decides as design approval holder' }],
    producedBy: { check: 'Change class (#33)', actor: 'Norn router', note: 'Mock' },
  },
  rec: {
    id: 'rec', title: 'Norn’s recommendation', evidence: 'judgment',
    summary: 'Approve. Rev B cannot fly past its 5 hour inspection interval, the fix is proven on the rig, and each week of delay costs far more than the part does in a year.',
    value: { text: 'Approve', range: 'At the Nov 12 CCB' },
    sources: [{ system: 'PLM', ref: 'NCR-0119 and ECR-0417', detail: 'Fatigue margin +14% for Rev C against −31% for Rev B' }, { system: 'Norn', ref: 'Cost check and the planner agent’s estimates' }],
    inputs: [{ label: 'Net cost, first 12 months', display: `${usdK(pointOf(net3), { plus: true })}, ${usdK(net3.p10!)} to ${usdK(net3.p90!)}`, evidence: 'computation', traceId: net3.id }],
    assumptions: [{ label: 'Four alternatives were ruled out in the ECR', display: 'peening, doubler, isolator, inspection', origin: 'given', source: 'Jeff Hargrove, originator' }],
    producedBy: { check: 'Impact statement (S5)', actor: 'Norn reviewer', note: 'Mock: written by a stand-in, not a live model' },
  },
  coupling: {
    id: 'coupling', title: 'Interaction with ECR-0409', evidence: 'judgment',
    summary: 'ECR-0409 changes the aft propellers to four blades, which changes the vibration spectrum the Rev C bracket was qualified in. The two ECRs share no part, so only a reader of both would notice.',
    value: { text: 'Flagged', range: 'Not detectable from shared parts' },
    sources: [{ system: 'PLM', ref: 'ECR-0409 alternatives considered' }, { system: 'PLM', ref: 'ECR-0417 need', detail: 'Rev C moves the mode to 262 Hz, between the 6th and 7th orders' }],
    inputs: [], assumptions: [], producedBy: { check: 'Interaction review', actor: 'Norn reviewer', note: 'Mock' },
  },
};

const hold = v3.cost.rows.find(r => r.label.startsWith('Delay cost'))!;
const weeklyDelay = usdK(Math.round((hold.total.point ?? hold.total.p50) / 36 / 100) * 100 * 4, { plus: false });
const recurringYear = v3.cost.recurring.point ?? v3.cost.recurring.p50;

const activity: ActivityEvent[] = [
  { id: 'a1', at: '2026-10-19T14:02:00-07:00', actor: 'Jeff Hargrove', actorKind: 'person', kind: 'filed', text: 'filed the ECR', detail: 'From NCR-0119, the fillet crack at 8.2 h.' },
  { id: 'a2', at: '2026-10-19T14:02:30-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Jeff Hargrove', kind: 'ran_checks', text: 'ran the impact checks', detail: 'BOM delta and cost ran. The timeline and supply checks are not built yet.' },
  { id: 'a3', at: '2026-10-19T14:03:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Jeff Hargrove', kind: 'label', text: 'added the labels Class I, FAA minor, Urgent and Vesper' },
  { id: 'a4', at: '2026-10-19T14:03:10-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Jeff Hargrove', kind: 'review_requested', text: 'requested review from Samir Vaidya, Hamid Barzani, Colleen Rourke, Beatriz Nowak, Gideon Falk and the CCB', detail: 'Over $150,000, so the CCB decides.' },
  { id: 'a5', at: '2026-10-19T14:03:20-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Jeff Hargrove', kind: 'report', text: 'posted the impact statement, Level 1', detail: `Provisional: year 1 ${usdK(pointOf(net1), { plus: true })} (${usdK(net1.p10!)} to ${usdK(net1.p90!)}). ${v1.cost.needsEstimate.length} lines the originator left blank need an estimate and count as $0.`, level: 1 },
  { id: 'a6', at: '2026-10-21T09:12:00-07:00', actor: 'Wei-Lin Zhao', actorKind: 'person', kind: 'comment', text: 'asked for the full assessment' },
  { id: 'a7', at: '2026-10-21T09:21:00-07:00', actor: 'Norn researcher', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'research', text: 'read Halden’s quote and the stock in the ERP', detail: '6 purchase lines, 5 stock locations.' },
  { id: 'a8', at: '2026-10-21T09:30:00-07:00', actor: 'Norn reviewer', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'changes_requested', text: 'requested changes to Level 1', detail: 'The hold on S/N 011 onward is $0 because the originator left it blank, but the first aircraft reaches the install station in about three weeks and Rev C cannot arrive before late February.' },
  { id: 'a9', at: '2026-10-21T09:52:00-07:00', actor: 'Norn planner agent', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'research', text: 'estimated the three blank lines', detail: `Hold on S/N 011 onward ${usdK(hold.total.point ?? hold.total.p50)}, re-inspection, manual update. Each is an agent estimate with its rationale.` },
  { id: 'a10', at: '2026-10-21T09:53:00-07:00', actor: 'Norn', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'report', text: 'posted Level 2', level: 2 },
  { id: 'a11', at: '2026-10-21T10:36:00-07:00', actor: 'Norn blind checker', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'research', text: 'formed its own estimate without seeing the answer', detail: `${usdK(Math.round((pointOf(net3) * 0.96) / 1000) * 1000)}, within 4% of the verdict.` },
  { id: 'a12', at: '2026-10-21T10:41:00-07:00', actor: 'Norn', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', kind: 'report', text: 'posted Level 3: Norn’s final verdict', detail: `Year 1 ${usdK(pointOf(net3), { plus: true })}, up from ${usdK(pointOf(net1))} at Level 1.`, level: 3 },
  { id: 'a13', at: '2026-10-22T16:20:00-07:00', actor: 'Hamid Barzani’s agent', actorKind: 'person_agent', onBehalfOf: 'Hamid Barzani', kind: 'comment', text: 'confirmed the 14 week lead time with Halden', detail: 'Reported by agent. Norn has not fetched the source itself.', reportedByAgent: true },
  { id: 'a14', at: '2026-10-22T16:25:00-07:00', actor: 'Hamid Barzani', actorKind: 'person', kind: 'approved', text: 'approved these changes' },
  { id: 'a15', at: '2026-10-23T10:05:00-07:00', actor: 'Samir Vaidya', actorKind: 'person', kind: 'approved', text: 'approved these changes' },
];

const checks: Check[] = [
  { id: 'bom', name: 'BOM delta', state: 'passed', summary: '1 item revised, no BOM line changes', by: 'Reader' },
  { id: 'cost', name: 'Cost', state: 'passed', summary: `Net ${usdK(pointOf(net3), { plus: true })} in the first 12 months, range ${usdK(net3.p10!)} to ${usdK(net3.p90!)}`, by: 'Cost check' },
  { id: 'timeline', name: 'Time to the line', state: 'passed', summary: `Rev C reaches the line about ${dateShort(arrives.p50)}, not ${v3.cutIn.month} as filed (agent estimate)`, by: 'Norn planner agent' },
  { id: 'supply', name: 'Supply risk', state: 'attention', summary: 'Sole source: Halden, and no Rev C stock to bridge a delay', by: 'Norn supply agent' },
  { id: 'class', name: 'Classification', state: 'passed', summary: 'Class I, FAA minor, set separately', by: 'Norn router' },
];

const list = listCosts['ECR-0417'];
export const ecr0417Summary: EcrSummary = {
  id: 'ECR-0417',
  title: 'Motor-controller mounting bracket BW-5120-210, Rev B to Rev C: fillet fatigue crack',
  program: 'Vesper', partNumber: 'BW-5120-210', companyClass: 'I', faa: 'minor', priority: 'Urgent', status: 'In review',
  cost: { p10: net3.p10!, p50: net3.p50, p90: net3.p90!, point: net3.point, from: list.from },
  level: 3, lastActivity: '2026-10-23T10:05:00-07:00', lastActivityBy: 'Samir Vaidya approved',
  originator: 'Jeff Hargrove', filedOn: '2026-10-19', hasAssessment: true,
  reviewers: [
    { name: 'Samir Vaidya', state: 'approved' }, { name: 'Hamid Barzani', state: 'approved' }, { name: 'Colleen Rourke', state: 'pending' },
    { name: 'Beatriz Nowak', state: 'pending' }, { name: 'Gideon Falk', state: 'pending' },
  ],
  checks: 'attention', comments: 6, change: 'BW-5120-210 from Rev B to Rev C',
};

export const ecr0417: ImpactAssessment = {
  ecr: ecr0417Summary, source: 'saved',
  level: 3,
  headline: v3.headline,
  cost: v3.cost,
  cutIn: {
    ...v3.cutIn,
    estimate: {
      figure: { id: 'cutin-estimate', unit: 'date', ...arrives, evidence: 'assumption' },
      note: 'Agent estimate: when Rev C can reach the line',
      likelihood: { word: 'likely', event: `by ${dateShort(D(2027, 3, 15))}`, probability: 0.71 },
    },
  },
  supply: {
    id: 'supply', level: 'moderate', evidence: 'judgment', note: 'One source, no Rev C stock',
    likelihood: { word: 'unlikely', event: 'that the first lot slips 2 weeks or more', probability: 0.34 },
  },
  sCurve: v3.sCurve,
  drivers: v3.drivers,
  scenarios: [
    { label: 'Halden down 6 weeks', effect: `Rev C ${dateShort(arrives.p50 + 42 * DAY)}, +$129k` },
    { label: 'First article fails once', effect: `Rev C ${dateShort(arrives.p50 + 28 * DAY)}, +$78k` },
  ],
  changeClass: {
    company: 'I', companyWhy: 'Costs money and reaches built aircraft', faa: 'minor', faaWhy: 'Secondary structure, same envelope',
    evidence: 'judgment', traceId: 'class',
  },
  route: {
    tier: 'Over $150,000: the CCB decides. Retrofit of built aircraft rules out fast track.',
    steps: [
      { role: 'Cost accounting', person: 'Samir Vaidya', state: 'approved', when: 'Oct 23' },
      { role: 'Procurement', person: 'Hamid Barzani', state: 'approved', when: 'Oct 22' },
      { role: 'Production planning', person: 'Colleen Rourke', state: 'pending' },
      { role: 'Quality', person: 'Beatriz Nowak', state: 'pending' },
      { role: 'Certification', person: 'Gideon Falk', state: 'pending' },
      { role: 'CCB', person: 'Rafael Quintero, chair', state: 'waiting', when: 'Nov 12' },
    ],
  },
  recommendation: {
    verdict: 'approve',
    headline: 'Norn recommends approval',
    reasons: [
      { text: 'Rev B cannot fly past its 5 hour inspection', evidence: 'fact', traceId: 'rec' },
      { text: 'Rev C fatigue margin is +14%, against −31% for Rev B', evidence: 'fact', traceId: 'rec' },
      { text: `Each week of delay costs about ${weeklyDelay}; the part adds about ${usdK(recurringYear)} a year`, evidence: 'assumption', traceId: hold.total.id },
      { text: 'Approving at the Nov 12 CCB is the earliest start', evidence: 'judgment', traceId: 'rec' },
    ],
    traceId: 'rec',
  },
  needed: [
    { text: 'Certification to confirm FAA minor', owner: 'Gideon Falk' },
    { text: 'Plan for the aircraft held at install', owner: 'Colleen Rourke' },
    { text: 'Delta first-article review', owner: 'Beatriz Nowak' },
  ],
  activity,
  body: detail0417.body,
  checks,
  changes: detail0417.changes.map(c => {
    if (c.id !== 'stock') return c;
    const inv = v3.cost.rows.find(r => r.label.startsWith('Inventory disposition'));
    return inv ? { ...c, impact: `${usdK(inv.total.point ?? inv.total.p50)} written off` } : c;
  }),
  revisions: detail0417.revisions,
  linked: detail0417.linked,
  meeting: detail0417.meeting,
  mock: ['narrative', 'class', 'route', 'recommendation', 'supply', 'cutInEstimate', 'agentEstimates'],
  traces,
};

