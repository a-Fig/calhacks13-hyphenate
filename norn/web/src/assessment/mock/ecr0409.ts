// ECR-0409: aft lift propellers, 2 blades with dampers to 4 blades without. The big change: one-time
// cost dominates and certification sets the date (bowman/data scenarios.ts, S2). MOCK, Level 1 only,
// still under review, so some lines are honestly "not assessed".
import { likelihoodWord, runModel, type InputDef, type RowDef } from '../engine.ts';
import type { ActivityEvent, Check, CostRow, EcrSummary, ImpactAssessment } from '../types.ts';
import { detail0409 } from './details.ts';
import { dateShort, usdK } from '../../ui/fmt.ts';

const DAY = 86400000;
const APPROVAL = Date.UTC(2026, 11, 10); // CCB, second Thursday of December
const AT = '2026-10-05T14:11:00-07:00';
const usdFmt = (v: number) => usdK(v);

const inputs: InputDef[] = [
  {
    key: 'tooling', label: 'Blade mould and hub tooling', unit: 'usd', evidence: 'fact',
    q: { p10: 450000, p50: 500000, p90: 600000 }, fmt: usdFmt,
    trace: {
      summary: 'Halvorsen’s budgetary quote: a blade mould set at $410,000 and hub forging tooling at $90,000. The quote is good to plus or minus 20%.',
      sources: [{ system: 'Quote', ref: 'Q-HV-4417', detail: 'Halvorsen, received 2 Oct 2026, budgetary, 34 weeks to first articles' }],
      assumptions: [{ label: 'Quote accuracy', display: '±20%', origin: 'given', source: 'Halvorsen' }],
    },
  },
  {
    key: 'engCert', label: 'Engineering and certification', unit: 'usd', evidence: 'assumption',
    q: { p10: 560000, p50: 650000, p90: 900000, lo: 500000, hi: 1100000 }, fmt: usdFmt,
    trace: {
      summary: 'About 4,500 hours, from the originator. An FAA project for a major change usually runs over, so the range leans up.',
      sources: [{ system: 'PLM', ref: 'ECR-0409 cost page', detail: 'Engineering and certification, about 4,500 h' }],
      assumptions: [{ label: 'Hours and rate', display: '4,500 h', origin: 'given', source: 'Maren Solheim, originator' }],
    },
  },
  {
    key: 'testing', label: 'Whirl-tower, flutter and noise testing', unit: 'usd', evidence: 'assumption',
    q: { p10: 250000, p50: 380000, p90: 650000, lo: 200000, hi: 900000 }, fmt: usdFmt,
    trace: {
      summary: 'The originator left test cost blank. Norn estimates it from the test scope the ECR lists and published rig rates.',
      sources: [{ system: 'PLM', ref: 'ECR-0409 test and qualification', detail: 'New blade mould set, whirl-tower and flutter test, noise campaign' }],
      assumptions: [{ label: 'Rig time and staffing', display: '$380k, range $250k to $650k', origin: 'agent_estimated', source: 'Norn cost agent, Level 1: one research pass' }],
    },
  },
  {
    key: 'flight', label: 'Hover performance flight test', unit: 'usd', evidence: 'assumption',
    q: { p10: 90000, p50: 140000, p90: 260000 }, fmt: usdFmt,
    trace: {
      summary: 'About twelve sorties. Left blank on the ECR.',
      sources: [{ system: 'PLM', ref: 'ECR-0409 test and qualification', detail: 'Hover performance flight test, about 12 sorties' }],
      assumptions: [{ label: 'Cost per sortie', display: '$11,700', origin: 'agent_estimated', source: 'Norn cost agent' }],
    },
  },
  {
    key: 'recal', label: 'Aft controller recalibration', unit: 'usd', evidence: 'assumption',
    q: { p10: 30000, p50: 60000, p90: 110000 }, fmt: usdFmt,
    trace: {
      summary: 'Lower tip speed means a new current limit and hover table in the aft motor controllers.',
      sources: [{ system: 'PLM', ref: 'ECR-0409 description', detail: 'The controller current limit and the hover software table need a new calibration' }],
      assumptions: [{ label: 'Engineering effort', display: '$60k', origin: 'agent_estimated', source: 'Norn cost agent' }],
    },
  },
  {
    key: 'delta', label: 'Cost per propeller, 4-blade vs 2-blade', unit: 'usd', evidence: 'fact',
    q: { p10: 1250, p50: 1440, p90: 1730 }, fmt: v => `$${Math.round(v).toLocaleString('en-US')}`,
    trace: {
      summary: 'A hub at $3,950, four blades at $930 and a cap at $330, against the 2-blade parts they replace. Budgetary.',
      sources: [{ system: 'Quote', ref: 'Q-HV-4417', detail: 'Hub $3,950, blade $930, spinner cap $330' }, { system: 'ERP', ref: 'BOM, BW-4200-000' }],
    },
  },
  {
    key: 'cutInWeeks', label: 'Cut-in, weeks after CCB approval', unit: 'weeks', evidence: 'computation',
    q: { p10: 42, p50: 52, p90: 70, lo: 38, hi: 90 }, fmt: v => `${v} wk`,
    trace: {
      summary: 'FAA acceptance of a major change takes 6 to 12 months after approval and sets the date. Blade tooling alone is 34 weeks.',
      sources: [
        { system: 'PLM', ref: 'ECR-0409 effectivity', detail: 'Engineering suggests S/N 034, about December 2027' },
        { system: 'Quote', ref: 'Q-HV-4417', detail: '34 weeks to first articles, then 20 weeks to production' },
      ],
      assumptions: [{ label: 'FAA acceptance', display: '6 to 12 months', origin: 'given', source: 'Maren Solheim, originator' }],
      formula: { expression: 'cut-in = CCB approval + the longer of tooling and certification' },
      check: 'Time to the line (S3)', actor: 'Timeline check',
    },
  },
];

const NOT: Pick<RowDef, 'value'> = { value: () => 0 };
const stub = (summary: string) => ({ summary, sources: [{ system: 'PLM' as const, ref: 'ECR-0409 cost page', detail: 'Left blank by the originator' }] });

const rows: RowDef[] = [
  {
    id: 'p1', block: 'production', label: 'Propeller unit cost, 4-blade vs 2-blade', evidence: 'computation', step: 100,
    note: '$1,440 a propeller, 6 an aircraft, from cut-in',
    value: x => x.delta * 6 * Math.max(0, (53.5 - x.cutInWeeks) * 0.7),
    trace: {
      summary: 'Material is a small change: $8,640 more per aircraft. Cut-in is near the end of 2027, so only about one aircraft is built with four blades in the year.',
      sources: [{ system: 'Quote', ref: 'Q-HV-4417' }, { system: 'ERP', ref: 'Volume plan', detail: 'Three Vesper aircraft in December 2027' }],
      inputs: [
        { label: 'Cost per propeller', display: '$1,440', evidence: 'fact', traceId: 'in.delta' },
        { label: 'Cut-in', display: '52 wk after approval', evidence: 'computation', traceId: 'in.cutInWeeks' },
      ],
      formula: { expression: 'cost per propeller x 6 x aircraft built after cut-in in 2027' },
    },
  },
  {
    id: 'p2', block: 'production', step: 1000, label: 'Blade mould set and hub forging tooling', evidence: 'fact', oneTime: true, note: 'Halvorsen budgetary quote',
    value: x => x.tooling,
    trace: { summary: 'Halvorsen’s budgetary quote for the blade mould set and hub forging tooling.', sources: [{ system: 'Quote', ref: 'Q-HV-4417' }], inputs: [{ label: 'Tooling', display: '$500,000', evidence: 'fact', traceId: 'in.tooling' }] },
  },
  {
    id: 'p3', block: 'production', step: 1000, label: 'Engineering and certification', evidence: 'assumption', oneTime: true, note: 'About 4,500 h',
    value: x => x.engCert,
    trace: { summary: 'The originator’s estimate for the engineering and the FAA project.', sources: [{ system: 'PLM', ref: 'ECR-0409 cost page' }], inputs: [{ label: 'Estimate', display: '$650,000', evidence: 'assumption', traceId: 'in.engCert' }] },
  },
  {
    id: 'p4', block: 'production', step: 1000, label: 'Whirl-tower, flutter and noise testing', evidence: 'assumption', oneTime: true, note: 'Not on the ECR, estimated',
    value: x => x.testing,
    trace: { summary: 'Left blank on the ECR; Norn estimates it.', sources: [{ system: 'PLM', ref: 'ECR-0409 cost page' }], inputs: [{ label: 'Estimate', display: '$380,000', evidence: 'assumption', traceId: 'in.testing' }] },
  },
  {
    id: 'p5', block: 'production', step: 1000, label: 'Hover performance flight test', evidence: 'assumption', oneTime: true, note: 'About 12 sorties, estimated',
    value: x => x.flight,
    trace: { summary: 'Left blank on the ECR; Norn estimates it.', sources: [{ system: 'PLM', ref: 'ECR-0409 cost page' }], inputs: [{ label: 'Estimate', display: '$140,000', evidence: 'assumption', traceId: 'in.flight' }] },
  },
  {
    id: 'p6', block: 'production', label: 'Scrap of 2-blade inventory', evidence: 'judgment', note: 'No disposition yet', ...NOT,
    trace: stub('The 2-blade parts still fly on aircraft in service, so Norn cannot yet say what is scrap.'),
  },
  {
    id: 'r1', block: 'retrofit', label: 'Retrofit kits, S/N 005–033', evidence: 'judgment', note: 'Engineering recommends it; not scoped', ...NOT,
    trace: stub('Built aircraft S/N 005 to 033 would need a kit before entry into service. Nobody has scoped it, and it is the largest unknown on this ECR.'),
  },
  {
    id: 'l1', block: 'logistics', label: 'Spares, manuals, training, support equipment', evidence: 'judgment', note: 'Left blank', ...NOT,
    trace: stub('Not assessed at Level 1.'),
  },
  {
    id: 'o1', block: 'other', step: 1000, label: 'Aft controller recalibration', evidence: 'assumption', oneTime: true, note: 'Not on the ECR, estimated',
    value: x => x.recal,
    trace: { summary: 'New current limit and hover table in the aft controllers.', sources: [{ system: 'PLM', ref: 'ECR-0409 description' }], inputs: [{ label: 'Estimate', display: '$60,000', evidence: 'assumption', traceId: 'in.recal' }] },
  },
];
const unassessed = new Set(['p6', 'r1', 'l1']);

const model = runModel({
  seed: 409, draws: 10000, at: AT, inputs, rows, extras: {
    cutIn: x => APPROVAL + x.cutInWeeks * 7 * DAY, cutInWeeks: x => x.cutInWeeks, unit: x => x.delta * 6,
  },
  driverKeys: ['testing', 'engCert', 'flight', 'tooling', 'recal', 'cutInWeeks', 'delta'],
  netTrace: {
    summary: 'The assessed lines summed on the same draws. Three lines are not assessed yet, so this is a floor: retrofit alone could add more than the tooling.',
    sources: [{ system: 'Norn', ref: 'Cost check (S2)' }],
    formula: { expression: 'percentile of (sum of assessed lines) over 10,000 draws' },
  },
  subtotalTrace: b => ({ summary: `The assessed ${b} lines, summed on the same draws.`, sources: [{ system: 'Norn', ref: 'Cost check (S2)' }] }),
});

const tr = model.traces;
tr['x.unit'] = model.makeTrace('x.unit', 'Unit cost change per aircraft', 'computation', {
  summary: 'Six propellers at $1,440 more each.', sources: [{ system: 'Quote', ref: 'Q-HV-4417' }],
  inputs: [{ label: 'Cost per propeller', display: '$1,440', evidence: 'fact', traceId: 'in.delta' }],
  formula: { expression: 'cost per propeller x 6', worked: '$1,440 x 6 = $8,640' },
  check: 'Cost (S2)', actor: 'Cost check',
});
tr['x.cutIn'] = model.makeTrace('x.cutIn', 'Cut-in date', 'computation', {
  summary: tr['in.cutInWeeks'].summary, sources: tr['in.cutInWeeks'].sources, assumptions: tr['in.cutInWeeks'].assumptions,
  inputs: [{ label: 'Weeks after CCB approval', display: '52 wk', evidence: 'computation', traceId: 'in.cutInWeeks' }],
  check: 'Time to the line (S3)', actor: 'Timeline check',
});
tr['supply'] = model.makeTrace('supply', 'Supply risk', 'judgment', {
  value: { text: 'High', range: 'New tooling, 34 weeks, one supplier' },
  summary: 'The blades and hub need new tooling from one supplier with 34 weeks to first articles. Meridian is unaffected: it has its own lift rotors.',
  sources: [{ system: 'Quote', ref: 'Q-HV-4417', detail: '34 weeks to first articles' }],
  check: 'Supply risk (S4)', actor: 'Supply agent',
});
tr['class'] = model.makeTrace('class', 'Change class', 'judgment', {
  value: { text: 'Class I · FAA major' },
  summary: 'Class I: it is not interchangeable with the 2-blade assembly and costs real money. FAA major: it changes the propeller type design and reopens 23 of 797 means-of-compliance items and issue paper IP-07.',
  sources: [{ system: 'PLM', ref: 'ECR-0409 classification', detail: 'Major under 14 CFR 21.93(a)' }],
  assumptions: [{ label: '23 items reopened', display: '23 of 797', origin: 'given', source: 'Engineering’s count; Gideon Falk to confirm' }],
  check: 'Change class (#33)', actor: 'Router agent',
});
tr['rec'] = model.makeTrace('rec', 'Norn’s recommendation', 'judgment', {
  value: { text: 'Wait for Level 2', range: 'Retrofit is not scoped' },
  summary: 'The case for four blades is sound, but the cost page is incomplete. Retrofit of 29 built aircraft is unscoped and may exceed the tooling. Norn would rather say so before the CCB than after.',
  sources: [{ system: 'PLM', ref: 'ECR-0409', detail: 'Retrofit recommended for S/N 005 to 033, not assessed' }],
  inputs: [{ label: 'Year-1 total, assessed lines only', display: usdK(model.net.p50), evidence: 'computation', traceId: 'net' }],
  check: 'Impact statement (S5)', actor: 'Reviewer agent', note: 'Mock: written by a stand-in, not a live model',
});
tr['coupling'] = model.makeTrace('coupling', 'Interaction with ECR-0417', 'judgment', {
  value: { text: 'Flagged', range: 'Not detectable from shared parts' },
  summary: 'Four blades change the blade-pass content in the aft boom, the vibration spectrum that ECR-0417’s Rev C bracket was qualified in. The two ECRs share no part, so only a reader of both would notice.',
  sources: [{ system: 'PLM', ref: 'ECR-0409 alternatives considered', detail: 'The aft-boom vibration spectrum changes with four blades' }, { system: 'PLM', ref: 'ECR-0417 need', detail: 'Rev C moves the mode to 262 Hz, between the 6th and 7th orders' }],
  check: 'Interaction review', actor: 'Reviewer agent',
});

const net = model.net;
const checks: Check[] = [
  { id: 'bom', name: 'BOM delta', state: 'passed', summary: '4 item changes, 7 BOM lines', took: '0.6 s', by: 'Reader' },
  { id: 'cost', name: 'Cost', state: 'attention', summary: `Year 1 ${usdK(net.p50, { plus: true })} for the assessed lines, and 3 lines not assessed`, took: '5.0 s', by: 'Cost check' },
  { id: 'timeline', name: 'Time to the line', state: 'passed', summary: 'Cut-in Dec 2027, set by FAA acceptance', took: '1.4 s', by: 'Timeline check' },
  { id: 'supply', name: 'Supply risk', state: 'attention', summary: 'New tooling from one supplier, 34 weeks', took: '2.6 s', by: 'Supply agent' },
  { id: 'class', name: 'Classification', state: 'passed', summary: 'Class I, FAA major', took: '0.7 s', by: 'Router' },
];
const rowsOut: CostRow[] = model.rows.map(r => (unassessed.has(r.id) ? { ...r, notAssessed: true } : r));
const level = 1 as const;

export const ecr0409Summary: EcrSummary = {
  id: 'ECR-0409', title: 'Aft lift propellers: 2 blades with dampers to 4 blades without',
  program: 'Vesper', partNumber: 'BW-4200-000', companyClass: 'I', faa: 'major', priority: 'Routine', status: 'Submitted',
  cost: { p10: net.p10!, p50: net.p50, p90: net.p90! }, level,
  lastActivity: '2026-10-24T08:52:00-07:00', lastActivityBy: 'Norn is reviewing Level 1',
  originator: 'Maren Solheim', filedOn: '2026-10-05', flag: 'Retrofit of built aircraft is not scoped', hasAssessment: true,
  reviewers: [{ name: 'Gideon Falk', state: 'pending' }, { name: 'Beatriz Nowak', state: 'pending' }, { name: 'Samir Vaidya', state: 'pending' }, { name: 'Colleen Rourke', state: 'pending' }],
  checks: 'attention', comments: 2, change: 'the aft propellers from 2 blades to 4 blades',
};

const cap = Math.round((net.p90 ?? net.p50) / 100000) * 100000;
const pUnder = model.sCurve.points.filter(p => p.x <= cap).length / 100;
const pLate = model.prob(e => e.cutInWeeks > 55);
const activity: ActivityEvent[] = [
  { id: 'b1', at: '2026-10-05T14:08:00-07:00', actor: 'Maren Solheim', actorKind: 'person', kind: 'filed', text: 'filed the ECR', detail: 'From NCR-0113, damper wear and 2.1 dB over on noise.' },
  { id: 'b2', at: '2026-10-05T14:09:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'ran_checks', text: 'ran 5 impact checks', detail: '3 passed, 2 need attention.' },
  { id: 'b3', at: '2026-10-05T14:10:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'label', text: 'added the labels Class I, FAA major and Vesper' },
  { id: 'b4', at: '2026-10-05T14:10:30-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'review_requested', text: 'requested review from Gideon Falk, Beatriz Nowak, Samir Vaidya, Colleen Rourke and the CCB', detail: 'FAA major and over $150,000.' },
  { id: 'b5', at: '2026-10-05T14:11:00-07:00', actor: 'Norn', actorKind: 'norn', spawnedBy: 'Norn, for Maren Solheim', kind: 'report', text: 'posted the impact statement, Level 1', detail: `Provisional: year 1 ${usdK(net.p50, { plus: true })}. Retrofit not assessed.`, level: 1 },
  { id: 'b6', at: '2026-10-24T08:40:00-07:00', actor: 'Priya Venkataraman', actorKind: 'person', kind: 'comment', text: 'asked for the full assessment' },
  { id: 'b7', at: '2026-10-24T08:52:00-07:00', actor: 'Norn reviewer', actorKind: 'norn', onBehalfOf: 'Priya Venkataraman', kind: 'research', text: 'is reviewing Level 1', detail: 'Checking the retrofit scope and the link to ECR-0417.', state: 'running' },
];

export const ecr0409: ImpactAssessment = {
  ecr: ecr0409Summary, level,
  headline: {
    unitCost: model.extra('unit', 'usd'), unitCostNote: '$1,440 more per propeller, 6 per aircraft',
    year1: net, year1Likelihood: { word: likelihoodWord(pUnder), event: `under ${usdK(cap)}`, probability: pUnder },
    cutIn: model.extra('cutIn', 'date'), cutInNote: 'Set by FAA acceptance, about S/N 034',
    cutInLikelihood: { word: likelihoodWord(1 - pLate), event: `by ${dateShort(Date.UTC(2027, 11, 31))}`, probability: 1 - pLate },
    supply: { id: 'supply', level: 'high', evidence: 'judgment', note: 'New tooling, one supplier', likelihood: { word: 'likely', event: 'that blade tooling takes the full 34 weeks', probability: 0.7 } },
  },
  cost: { rows: rowsOut, subtotals: model.subtotals, net, yearLabel: '2027' },
  sCurve: model.sCurve, drivers: model.drivers.slice(0, 4),
  scenarios: [
    { label: 'Certification takes 12 months', effect: `Cut-in ${dateShort(APPROVAL + 70 * 7 * DAY)}` },
    { label: 'Retrofit of S/N 005–033', effect: 'Not scoped' },
  ],
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
      { text: 'Retrofit of 29 built aircraft is not scoped and may exceed the tooling', evidence: 'judgment', traceId: 'rec' },
      { text: 'Certification, not tooling, sets the date', evidence: 'computation', traceId: 'x.cutIn' },
      { text: 'Reopens 23 of 797 compliance items', evidence: 'fact', traceId: 'class' },
      { text: 'Moves the vibration spectrum ECR-0417’s bracket sits in', evidence: 'judgment', traceId: 'coupling' },
    ],
  },
  needed: [
    { text: 'Retrofit scope for S/N 005–033', owner: 'Norn, Level 2' },
    { text: 'Confirm the 23 compliance items', owner: 'Gideon Falk' },
    { text: 'Re-run the aft-boom vibration survey', owner: 'Structures' },
  ],
  activity, ...detail0409, checks, traces: tr,
};
