// ECR-0409: aft lift propellers, 2 blades with dampers to 4 blades without. The big change: one-time
// cost dominates and certification sets the date. The numbers are the real checks' on Bowman's
// dataset (Level 1, as they stand): the test, retrofit and disposition lines the originator left
// blank are flagged "needs an estimate" and counted as $0, so the total is a floor. The cut-in is
// the checks' default (the longest quoted lead time), which ignores certification. The rest is mock.
import type { CheckResultRow } from '../../../../checks/src/rows.ts';
import { fromChecks } from '../adapter.ts';
import rows from '../fixtures/ecr-0409.json';
import listCosts from '../fixtures/list-costs.json';
import type { ActivityEvent, Check, EcrSummary, ImpactAssessment, Trace } from '../types.ts';
import { pointOf, usdK } from '../../ui/fmt.ts';
import { detail0409 } from './details.ts';
import { monthLabel } from '../adapter.ts';

const v = fromChecks(rows as CheckResultRow[]);
const net = v.cost.net;

const traces: Record<string, Trace> = {
  ...v.traces,
  class: {
    id: 'class', title: 'Change class', evidence: 'judgment',
    summary: 'Class I: it is not interchangeable with the 2-blade assembly and costs real money. FAA major: it changes the propeller type design and reopens 23 of 797 means-of-compliance items and issue paper IP-07.',
    value: { text: 'Class I · FAA major' },
    sources: [{ system: 'PLM', ref: 'ECR-0409 classification', detail: 'Major under 14 CFR 21.93(a)' }],
    inputs: [], assumptions: [{ label: '23 items reopened', display: '23 of 797', origin: 'given', source: 'Engineering’s count; Gideon Falk to confirm' }],
    producedBy: { check: 'Change class (#33)', actor: 'Norn router', note: 'Mock' },
  },
  rec: {
    id: 'rec', title: 'Norn’s recommendation', evidence: 'judgment',
    summary: 'The case for four blades is sound, but the cost page is incomplete: test, retrofit and old-stock lines are blank and count as $0. Retrofit of 29 built aircraft is unscoped and may exceed the tooling. Norn would rather say so before the CCB than after.',
    value: { text: 'Wait for Level 2', range: 'Lines need an estimate' },
    sources: [{ system: 'PLM', ref: 'ECR-0409', detail: 'Retrofit recommended for S/N 005 to 033, not assessed' }],
    inputs: [{ label: 'Net cost, first 12 months, as it stands', display: usdK(pointOf(net), { plus: true }), evidence: 'computation', traceId: net.id }],
    assumptions: [], producedBy: { check: 'Impact statement (S5)', actor: 'Norn reviewer', note: 'Mock: written by a stand-in, not a live model' },
  },
  coupling: {
    id: 'coupling', title: 'Interaction with ECR-0417', evidence: 'judgment',
    summary: 'Four blades change the blade-pass content in the aft boom, the vibration spectrum that ECR-0417’s Rev C bracket was qualified in. The two ECRs share no part, so only a reader of both would notice.',
    value: { text: 'Flagged', range: 'Not detectable from shared parts' },
    sources: [{ system: 'PLM', ref: 'ECR-0409 alternatives considered', detail: 'The aft-boom vibration spectrum changes with four blades' }, { system: 'PLM', ref: 'ECR-0417 need', detail: 'Rev C moves the mode to 262 Hz' }],
    inputs: [], assumptions: [], producedBy: { check: 'Interaction review', actor: 'Norn reviewer', note: 'Mock' },
  },
};

const n = v.cost.needsEstimate.length;
const checks: Check[] = [
  { id: 'bom', name: 'BOM delta', state: 'passed', summary: '4 item changes, 7 BOM lines', by: 'Reader' },
  { id: 'cost', name: 'Cost', state: 'attention', summary: `Net ${usdK(pointOf(net), { plus: true })} for the lines that are costed; ${n} lines need an estimate`, by: 'Cost check' },
  { id: 'timeline', name: 'Time to the line', state: 'pending', summary: `Not assessed yet. The cost check assumes ${monthLabel(v.cutIn.month)}, the longest quoted lead time; certification could push it later` },
  { id: 'supply', name: 'Supply risk', state: 'pending', summary: 'Not assessed yet' },
  { id: 'class', name: 'Classification', state: 'passed', summary: 'Class I, FAA major', by: 'Norn router' },
];

const activity: ActivityEvent[] = [
  { id: 'b1', at: '2026-10-05T14:08:00-07:00', actor: 'Maren Solheim', actorKind: 'person', kind: 'filed', text: 'filed the ECR', detail: 'From NCR-0113, damper wear and 2.1 dB over on noise.' },
  { id: 'b2', at: '2026-10-05T14:09:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'ran_checks', text: 'ran the impact checks', detail: `${n} lines need an estimate.` },
  { id: 'b3', at: '2026-10-05T14:10:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'label', text: 'added the labels Class I, FAA major and Vesper' },
  { id: 'b4', at: '2026-10-05T14:10:30-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'review_requested', text: 'requested review from Gideon Falk, Beatriz Nowak, Samir Vaidya, Colleen Rourke and the CCB', detail: 'FAA major and over $150,000.' },
  { id: 'b5', at: '2026-10-05T14:11:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'report', text: 'posted the impact statement, Level 1', detail: `Provisional: net ${usdK(pointOf(net), { plus: true })} for the lines that are costed; retrofit and testing are not.`, level: 1 },
  { id: 'b6', at: '2026-10-24T08:40:00-07:00', actor: 'Priya Venkataraman', actorKind: 'person', kind: 'comment', text: 'asked for the full assessment' },
  { id: 'b7', at: '2026-10-24T08:52:00-07:00', actor: 'Norn reviewer', actorKind: 'norn', onBehalfOf: 'Priya Venkataraman', kind: 'research', text: 'is reviewing Level 1', detail: 'Checking the retrofit scope and the link to ECR-0417.', state: 'running' },
];

const list = listCosts['ECR-0409'];
export const ecr0409Summary: EcrSummary = {
  id: 'ECR-0409', title: 'Aft lift propellers: 2 blades with dampers to 4 blades without',
  program: 'Vesper', partNumber: 'BW-4200-000', companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
  cost: { p10: net.p10!, p50: net.p50, p90: net.p90!, point: net.point, from: list.from }, level: 1,
  lastActivity: '2026-10-24T08:52:00-07:00', lastActivityBy: 'Norn is reviewing Level 1',
  originator: 'Maren Solheim', filedOn: '2026-10-05', flag: `${n} cost lines need an estimate`, hasAssessment: true,
  reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }, { name: 'Samir Vaidya', state: 'pending' }, { name: 'Colleen Rourke', state: 'pending' }],
  checks: 'attention', comments: 2, change: 'the aft propellers from 2 blades to 4 blades',
};

export const ecr0409: ImpactAssessment = {
  ecr: ecr0409Summary, source: 'saved', level: 1,
  headline: v.headline, cost: v.cost, cutIn: v.cutIn, sCurve: v.sCurve, drivers: v.drivers,
  scenarios: [],
  changeClass: { company: 'I', companyWhy: 'Not interchangeable with the 2-blade assembly', faa: 'major', faaWhy: 'Reopens 23 of 797 compliance items', evidence: 'judgment', traceId: 'class' },
  route: {
    tier: 'FAA major and over $150,000: Technical Review, then the CCB, with an FAA project.',
    steps: [
      { role: 'Certification', person: 'Gideon Falk', state: 'pending' },
      { role: 'Quality', person: 'Beatriz Nowak', state: 'pending' },
      { role: 'Cost accounting', person: 'Samir Vaidya', state: 'pending' },
      { role: 'Production planning', person: 'Colleen Rourke', state: 'pending' },
      { role: 'CCB', person: 'Rafael Quintero, chair', state: 'waiting', when: 'Dec 10' },
    ],
  },
  recommendation: {
    verdict: 'wait', headline: 'Norn recommends waiting for Level 2', traceId: 'rec',
    reasons: [
      { text: `${n} cost lines are blank and count as $0, so the total is a floor`, evidence: 'computation', traceId: net.id },
      { text: 'Retrofit of 29 built aircraft is not scoped and may exceed the tooling', evidence: 'judgment', traceId: 'rec' },
      { text: 'Reopens 23 of 797 compliance items', evidence: 'fact', traceId: 'class' },
      { text: 'Moves the vibration spectrum ECR-0417’s bracket sits in', evidence: 'judgment', traceId: 'coupling' },
    ],
  },
  needed: [
    { text: 'Estimates for the blank cost lines', owner: 'Norn, Level 2' },
    { text: 'Confirm the 23 compliance items', owner: 'Gideon Falk' },
    { text: 'Re-run the aft-boom vibration survey', owner: 'Structures' },
  ],
  activity, ...detail0409, checks,
  mock: ['narrative', 'class', 'route', 'recommendation'],
  traces,
};
