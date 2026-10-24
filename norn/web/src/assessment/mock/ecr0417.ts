// ECR-0417, the demo's star: the motor-controller bracket, Rev B to Rev C, after the vibration crack.
//
// MOCK. The inputs come from Bowman's dataset (bowman/data/changes.ts, scenarios.ts, volume.ts) and
// the answer key: the fact rows reproduce the key (one-time rows, $59,470 scrap net of salvage,
// $415.20 per aircraft). The ranges, the hold cost and the agent timeline are made up for the
// screens, and the engine in ../engine.ts draws them. The shape follows docs/IN-PRACTICE.md section 1.
import { likelihoodWord, runModel, type InputDef, type RowDef } from '../engine.ts';
import type { ActivityEvent, EcrSummary, ImpactAssessment, Likelihood } from '../types.ts';
import { dateShort, usd, usdK } from '../../ui/fmt.ts';

const DAY = 86400000;
const APPROVAL = Date.UTC(2026, 10, 12); // CCB meeting, second Thursday of November
const STD_COST = 2_800_019; // Vesper V4 standard cost roll-up
const AIRCRAFT = 24; // Vesper builds in 2027 (volume plan)
const PER_AC = 12; // brackets per aircraft
const RETROFIT_AC = 10; // S/N 001-010
const STOCK = { stores: 96, wip: 48, supplier: 60, installed: 120, onOrder: 60 };
const SCRAP = STOCK.stores + STOCK.wip + STOCK.supplier + STOCK.installed; // 324
const LOOSE = SCRAP - STOCK.installed; // 204 that could be reused
const SALVAGE = 2.85;
const AT = '2026-10-21T09:52:00-07:00';

// Aircraft that reach the controller-install station before Rev C does, as days after the CCB
// meeting (S/N 011 reaches it in about three weeks from filing; one aircraft a month after that).
const ARRIVALS = [-3, 25, 60, 88, 116, 130, 144];
const heldAircraftWeeks = (cutInWeeks: number) =>
  ARRIVALS.reduce((s, a) => s + Math.max(0, (cutInWeeks * 7 - a) / 7), 0);

const pct0 = (v: number) => `${Math.round(v * 100)}%`;

const inputs: InputDef[] = [
  {
    key: 'priceC', label: 'Rev C bracket price', unit: 'usd', evidence: 'fact',
    q: { p10: 219, p50: 221, p90: 228.5, lo: 217, hi: 236 }, fmt: v => usd(v, { cents: true }),
    trace: {
      summary: 'Halden Precision quotes Rev C at $221.00 for lots of 100 and over. The quote holds to 15 Jan 2027; the range allows for a re-quote if the order slips past that.',
      sources: [
        { system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'Halden Precision, received 16 Oct 2026, valid to 15 Jan 2027' },
        { system: 'PLM', ref: 'ECR-0417 item change', detail: 'BW-5120-210 unit price $186.40 to $221.00' },
      ],
      assumptions: [
        { label: 'Price after the quote expires', display: 'up to +3.4%', origin: 'agent_estimated', source: 'Norn researcher, from Halden re-quotes in the ERP purchase history' },
      ],
    },
  },
  {
    key: 'priceB', label: 'Rev B bracket price', unit: 'usd', evidence: 'fact',
    q: { p10: 186.4, p50: 186.4, p90: 186.4 }, fmt: v => usd(v, { cents: true }),
    trace: {
      summary: 'What Bowman pays Halden today for Rev B, and the standard cost of the part.',
      sources: [{ system: 'ERP', ref: 'BW-5120-210 Rev B', detail: 'Standard cost and last purchase order price, ECO-0271 first-lot story' }],
    },
  },
  {
    key: 'perAc', label: 'Brackets per aircraft', unit: 'count', evidence: 'fact',
    q: { p10: PER_AC, p50: PER_AC, p90: PER_AC }, fmt: v => String(v),
    trace: {
      summary: 'Twelve brackets per aircraft: one for each of the six forward and six aft motor controllers.',
      sources: [{ system: 'PLM', ref: 'Engineering BOM, Vesper V4', detail: 'BW-5120-210, quantity 12 per aircraft' }],
    },
  },
  {
    key: 'aircraft', label: 'Aircraft built in 2027', unit: 'count', evidence: 'fact',
    q: { p10: AIRCRAFT, p50: AIRCRAFT, p90: AIRCRAFT }, fmt: v => String(v),
    trace: {
      summary: 'The 2027 volume plan: one aircraft in January and February, two a month to October, three in November and December.',
      sources: [{ system: 'ERP', ref: 'Volume plan 2026-10 to 2030-12', detail: 'Vesper V4, 24 aircraft in 2027' }],
    },
  },
  {
    key: 'cutInWeeks', label: 'Cut-in, weeks after CCB approval', unit: 'weeks', evidence: 'computation',
    q: { p10: 13, p50: 15, p90: 20, lo: 12, hi: 28 }, fmt: v => `${v} wk`,
    trace: {
      summary: 'Halden ships the first lot 14 weeks after the order, and Bowman needs a week to receive and inspect it. Past ECOs with a tooling step slipped 5 to 10 weeks, which sets the upper tail.',
      sources: [
        { system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'First lot ships about 14 weeks after PO; plate stock 6 weeks in parallel with an 8 week fixture build, then 4 weeks of machining and inspection' },
        { system: 'Policy', ref: 'CCB schedule', detail: 'Next meeting Thursday 12 Nov 2026; an urgent ECR gets a decision within 30 days' },
        { system: 'History', ref: 'Released ECOs', detail: 'Six of ten slipped 5 to 10 weeks; all had a tooling step, a long lead time or a qualification slot' },
      ],
      assumptions: [
        { label: 'Order placed on approval day', display: '12 Nov 2026', origin: 'default', source: 'Norn configuration for Bowman' },
        { label: 'Receiving and first-article review', display: '1 week', origin: 'agent_estimated', source: 'Norn researcher, from the last four Halden lots' },
      ],
      formula: { expression: 'cut-in = CCB approval + first-lot lead time + receiving', worked: '12 Nov 2026 + 14 weeks + 1 week = 25 Feb 2027' },
      check: 'Time to the line (S3)', actor: 'Timeline check',
    },
  },
  {
    key: 'carry', label: 'Cost of capital', unit: 'percent', evidence: 'assumption',
    q: { p10: 0.07, p50: 0.09, p90: 0.11 }, fmt: pct0,
    trace: {
      summary: 'The yearly rate Bowman charges itself for money tied up in aircraft that are built but held.',
      sources: [{ system: 'Policy', ref: 'Bowman finance configuration', detail: 'Cost of capital 9% a year (mock)' }],
      assumptions: [{ label: 'Rate', display: '9%, range 7 to 11%', origin: 'default', source: 'Bowman finance configuration' }],
    },
  },
  {
    key: 'heldFrac', label: 'Share of cost in a held aircraft', unit: 'percent', evidence: 'assumption',
    q: { p10: 0.85, p50: 0.85, p90: 0.85 }, fmt: pct0,
    trace: {
      summary: 'The controller install is the last station before ground power-up, so a held aircraft is almost fully built.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 effectivity note', detail: 'Controller installation is the last station before ground power-up' }],
      assumptions: [{ label: 'Share of standard cost already spent', display: '85%', origin: 'agent_estimated', source: 'Norn planner agent, from the build sequence' }],
    },
  },
  {
    key: 'overrun', label: 'One-time cost overrun', unit: 'percent', evidence: 'assumption',
    q: { p10: 1.0, p50: 1.12, p90: 1.38, lo: 0.97, hi: 1.55 }, fmt: v => `+${Math.round((v - 1) * 100)}%`,
    trace: {
      summary: 'Quotes and estimates for one-time work have run over. Eight of nine nonzero one-time costs on past ECOs landed 7 to 40% above forecast, so Norn adds an allowance.',
      sources: [{ system: 'History', ref: 'ERP released ECOs', detail: 'Forecast at approval against actual, ten ECOs' }],
      assumptions: [{ label: 'Median overrun', display: '+12%, range 0 to +38%', origin: 'default', source: 'Fitted to the ten released ECOs' }],
    },
  },
  {
    key: 'engHours', label: 'Engineering hours', unit: 'count', evidence: 'assumption',
    q: { p10: 100, p50: 106, p90: 140, lo: 95, hi: 170 }, fmt: v => `${v} h`,
    trace: {
      summary: 'The design engineer estimates 106 hours: stress 60, drawing 12, other 34. Stress supplement is already drafted, so the downside is rework.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 cost page', detail: 'Engineering and data revision, 106 h at $145' }],
      assumptions: [{ label: 'Hours', display: '106 h, range 100 to 140', origin: 'given', source: 'Jeff Hargrove, originator' }],
    },
  },
  {
    key: 'requal', label: 'Vibration re-qualification', unit: 'usd', evidence: 'assumption',
    q: { p10: 16000, p50: 18500, p90: 26000, lo: 15000, hi: 34000 }, fmt: v => usdK(v),
    trace: {
      summary: 'The 20 hour EP-3 profile plus a 2x margin run on the endurance rig. A failed first run would repeat part of it.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 test and qualification', detail: 'Vibration re-qualification on the endurance rig, $18,500' }],
      assumptions: [{ label: 'Cost', display: '$18,500, range $16,000 to $26,000', origin: 'given', source: 'Jeff Hargrove, originator; range from Norn' }],
    },
  },
  {
    key: 'reuse', label: 'Rev B stock reused for ground tests', unit: 'percent', evidence: 'judgment',
    q: { p10: 0, p50: 0, p90: 0.25, lo: 0, hi: 0.5 }, fmt: pct0,
    trace: {
      summary: 'The Material Review Board quarantined the loose Rev B stock because the part failed fatigue. Norn assumes none is reused, and lets up to a quarter go to ground-test rigs.',
      sources: [{ system: 'PLM', ref: 'NCR-0119 and ECR-0417 inventory proposal', detail: 'Stores, WIP and supplier-finished Rev B: scrap. Failed fatigue, so no use-up' }],
      assumptions: [{ label: 'Share of 204 loose pieces reused', display: '0%, up to 25%', origin: 'agent_estimated', source: 'Norn reviewer agent' }],
    },
  },
  {
    key: 'reinspH', label: 'Re-inspection hours per aircraft', unit: 'count', evidence: 'assumption',
    q: { p10: 4, p50: 6, p90: 10, lo: 3, hi: 14 }, fmt: v => `${v} h`,
    trace: {
      summary: 'The originator left re-inspection and test after retrofit blank. Norn estimates it from the installation hours.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 cost page', detail: 'Re-inspection and test after retrofit: not provided' }],
      assumptions: [{ label: 'Hours per aircraft', display: '6 h, range 4 to 10', origin: 'agent_estimated', source: 'Norn cost agent, half the 12 h installation time' }],
    },
  },
];

const rows: RowDef[] = [
  // Production
  {
    id: 'p1', block: 'production', label: 'Bracket unit cost, Rev C vs Rev B', evidence: 'computation', step: 1,
    note: `${PER_AC} per aircraft, ${AIRCRAFT} aircraft`,
    value: x => (x.priceC - x.priceB) * x.perAc * x.aircraft,
    unit: { value: x => x.priceC - x.priceB, qty: PER_AC * AIRCRAFT, evidence: 'computation' },
    trace: {
      summary: 'Rev C costs $34.60 more per bracket at steady state. Over the 2027 build the recurring cost is about $10k, the smallest line on the page.',
      sources: [
        { system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'Rev C $221.00 steady state' },
        { system: 'ERP', ref: 'BW-5120-210 Rev B', detail: '$186.40' },
        { system: 'ERP', ref: 'Volume plan', detail: '24 Vesper aircraft in 2027' },
      ],
      inputs: [
        { label: 'Rev C bracket price', display: '$221.00', evidence: 'fact', traceId: 'in.priceC' },
        { label: 'Rev B bracket price', display: '$186.40', evidence: 'fact', traceId: 'in.priceB' },
        { label: 'Brackets per aircraft', display: '12', evidence: 'fact', traceId: 'in.perAc' },
        { label: 'Aircraft built in 2027', display: '24', evidence: 'fact', traceId: 'in.aircraft' },
      ],
      assumptions: [
        { label: 'Rev C price holds after the quote expires', display: 'yes, with a 3% upside risk', origin: 'agent_estimated', source: 'Norn researcher' },
        { label: 'Every 2027 aircraft is built with Rev C', display: '24 of 24', origin: 'default', source: 'Norn configuration: the change applies from cut-in, held aircraft catch up' },
      ],
      formula: { expression: '(Rev C price - Rev B price) x brackets per aircraft x aircraft', worked: '($221.00 - $186.40) x 12 x 24 = $9,965' },
    },
  },
  {
    id: 'p2', block: 'production', label: 'First lot of 25 at $239.50', evidence: 'computation', step: 1, oneTime: true,
    note: '$18.50 over steady state',
    value: () => 25 * (239.5 - 221),
    trace: {
      summary: 'Halden prices the first lot of 25 above the steady-state price. The premium is paid once and shows up as a purchase price variance against the new standard.',
      sources: [{ system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'First lot of 25 pieces at $239.50' }],
      inputs: [
        { label: 'First-lot price', display: '$239.50', evidence: 'fact' },
        { label: 'Steady-state price', display: '$221.00', evidence: 'fact', traceId: 'in.priceC' },
      ],
      formula: { expression: 'lot size x (first-lot price - steady-state price)', worked: '25 x ($239.50 - $221.00) = $462.50' },
    },
  },
  {
    id: 'p3', block: 'production', label: 'Halden fixture, programs and first article', evidence: 'fact', step: 1, oneTime: true,
    note: 'Three lines on the quote',
    value: () => 13600,
    trace: {
      summary: 'Read straight from Halden’s quote: fixture and CMM programs, NC programming, and a delta first-article inspection.',
      sources: [{ system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'Three one-time lines' }],
      inputs: [
        { label: 'Fixture and CMM programs', display: '$6,800', evidence: 'fact' },
        { label: 'NC programming', display: '$4,200', evidence: 'fact' },
        { label: 'Delta first-article inspection (AS9102)', display: '$2,600', evidence: 'fact' },
      ],
      formula: { expression: 'sum of the three quote lines', worked: '$6,800 + $4,200 + $2,600 = $13,600' },
    },
  },
  {
    id: 'p4', block: 'production', label: 'Engineering and data revision', evidence: 'assumption', oneTime: true,
    note: '106 h at $145',
    value: x => x.engHours * 145,
    trace: {
      summary: 'The design engineer’s own estimate, which Norn takes as given. The stress supplement is drafted, so the upside risk is limited.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 cost page', detail: 'Engineering and data revision' }],
      inputs: [
        { label: 'Engineering hours', display: '106 h', evidence: 'assumption', traceId: 'in.engHours' },
        { label: 'Engineering rate', display: '$145 per hour', evidence: 'fact' },
      ],
      formula: { expression: 'hours x rate', worked: '106 h x $145 = $15,370' },
    },
  },
  {
    id: 'p5', block: 'production', label: 'Vibration re-qualification', evidence: 'assumption', oneTime: true,
    note: '20 h profile plus a 2x run',
    value: x => x.requal,
    trace: {
      summary: 'Re-qualification of Rev C on the endurance rig. The originator’s figure is taken as given; the range allows for a repeat run.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 test and qualification' }],
      inputs: [{ label: 'Re-qualification cost', display: '$18,500', evidence: 'assumption', traceId: 'in.requal' }],
    },
  },
  {
    id: 'p6', block: 'production', label: 'Rev B stock scrapped, net of salvage', evidence: 'computation', oneTime: true,
    note: `${SCRAP} pieces`,
    value: x => (SCRAP - x.reuse * LOOSE) * (x.priceB - SALVAGE),
    trace: {
      summary: 'Rev B failed fatigue, so nothing can be used up. Every piece is written off: 96 in stores, 48 in work in progress, 60 finished at Halden and the 120 installed on S/N 001 to 010, net of $2.85 scrap salvage each.',
      sources: [
        { system: 'ERP', ref: 'Stock, BW-5120-210', detail: 'Stores 96, WIP 48, supplier-finished 60, on order 60, installed 120' },
        { system: 'PLM', ref: 'ECR-0417 inventory proposal', detail: 'Scrap everything on hand; cancel the 60 not started' },
      ],
      inputs: [
        { label: 'Pieces to scrap', display: '324', evidence: 'fact' },
        { label: 'Rev B cost each', display: '$186.40', evidence: 'fact', traceId: 'in.priceB' },
        { label: 'Salvage each', display: '$2.85', evidence: 'fact' },
        { label: 'Loose stock reused for ground tests', display: '0%', evidence: 'judgment', traceId: 'in.reuse' },
      ],
      assumptions: [{ label: 'No use-up', display: 'MRB quarantined the stock', origin: 'given', source: 'NCR-0119 and the ECR’s inventory proposal' }],
      formula: { expression: '(pieces - reused) x (cost - salvage)', worked: '324 x ($186.40 - $2.85) = $59,470' },
    },
  },
  {
    id: 'p7', block: 'production', label: 'Cancel 60 Rev B not started', evidence: 'fact', step: 1, oneTime: true,
    note: '10% of $186.40',
    value: () => 60 * 18.64,
    trace: {
      summary: 'Halden charges 10% to cancel the 60 pieces on the open order that have not been started.',
      sources: [{ system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'Cancellation charge $18.64 x 60' }],
      inputs: [
        { label: 'Pieces not started', display: '60', evidence: 'fact' },
        { label: 'Charge each', display: '$18.64', evidence: 'fact' },
      ],
      formula: { expression: 'pieces x charge', worked: '60 x $18.64 = $1,118' },
    },
  },
  // Retrofit
  {
    id: 'r1', block: 'retrofit', label: 'Rev C brackets for S/N 001–010', evidence: 'computation', oneTime: true,
    note: '12 per aircraft',
    value: x => x.priceC * PER_AC * RETROFIT_AC,
    unit: { value: x => x.priceC, qty: PER_AC * RETROFIT_AC, evidence: 'fact', traceId: 'in.priceC' },
    trace: {
      summary: 'Retrofit covers all ten built aircraft, not only the four test aircraft: S/N 005 to 010 are in the hangar, undelivered, with Rev B installed.',
      sources: [
        { system: 'PLM', ref: 'ECR-0417 effectivity', detail: 'Retrofit S/N 001 to 010' },
        { system: 'Quote', ref: 'Q-HAL-26-1187' },
      ],
      inputs: [
        { label: 'Rev C bracket price', display: '$221.00', evidence: 'fact', traceId: 'in.priceC' },
        { label: 'Brackets', display: '120', evidence: 'fact' },
      ],
      formula: { expression: 'brackets per aircraft x aircraft x Rev C price', worked: '12 x 10 x $221.00 = $26,520' },
    },
  },
  {
    id: 'r2', block: 'retrofit', label: 'Installation labor', evidence: 'assumption', step: 1, oneTime: true,
    note: '12 h per aircraft at $110',
    value: () => 1320 * RETROFIT_AC,
    unit: { value: () => 1320, qty: RETROFIT_AC, evidence: 'assumption' },
    trace: {
      summary: 'Remove Rev B and install Rev C: 12 labor hours per aircraft, from the originator.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 effectivity', detail: '12 h labor per aircraft' }],
      assumptions: [{ label: 'Hours per aircraft', display: '12 h at $110', origin: 'given', source: 'Jeff Hargrove, originator' }],
      formula: { expression: 'hours x rate x aircraft', worked: '12 h x $110 x 10 = $13,200' },
    },
  },
  {
    id: 'r3', block: 'retrofit', label: 'Re-inspection and test', evidence: 'assumption', oneTime: true,
    note: 'Not on the ECR, estimated',
    value: x => x.reinspH * 110 * RETROFIT_AC,
    unit: { value: x => x.reinspH * 110, qty: RETROFIT_AC, evidence: 'assumption' },
    trace: {
      summary: 'The originator left this line blank. Norn estimates six hours per aircraft.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 cost page', detail: 'Re-inspection and test after retrofit: not provided' }],
      inputs: [{ label: 'Hours per aircraft', display: '6 h', evidence: 'assumption', traceId: 'in.reinspH' }],
      assumptions: [{ label: 'Rate', display: '$110 per hour', origin: 'default', source: 'Same rate as the installation line' }],
      formula: { expression: 'hours x rate x aircraft', worked: '6 h x $110 x 10 = $6,600' },
    },
  },
  // Logistics support
  {
    id: 'l1', block: 'logistics', label: 'Maintenance manual, task 24-31', evidence: 'assumption', step: 1, oneTime: true,
    note: 'Torque table changes',
    value: () => 1900,
    trace: {
      summary: 'The ECR notes that task 24-31 changes the torque table and nothing else was assessed. Norn estimates 20 hours of technical publications work.',
      sources: [{ system: 'PLM', ref: 'ECR-0417 cost page', detail: 'Maintenance manual task 24-31 changes the torque table' }],
      assumptions: [{ label: 'Technical publications work', display: '20 h at $95', origin: 'agent_estimated', source: 'Norn cost agent' }],
      formula: { expression: 'hours x rate', worked: '20 h x $95 = $1,900' },
    },
  },
  {
    id: 'l2', block: 'logistics', label: 'Spares and training', evidence: 'judgment', step: 1, oneTime: true,
    note: 'No aircraft delivered',
    value: () => 0,
    trace: {
      summary: 'No aircraft has been delivered, so there is no fleet to provision spares for. A bracket swap is shop work and needs no new training.',
      sources: [{ system: 'ERP', ref: 'Delivery history', detail: 'None of S/N 001 to 010 is delivered' }],
      assumptions: [{ label: 'No spares or training cost', display: '$0', origin: 'agent_estimated', source: 'Norn reviewer agent' }],
    },
  },
  // Other
  {
    id: 'o1', block: 'other', label: 'Hold on S/N 011 onward', evidence: 'assumption', oneTime: true, step: 100,
    note: 'Carrying cost until cut-in',
    value: x => heldAircraftWeeks(x.cutInWeeks) * ((STD_COST * x.heldFrac * x.carry) / 52),
    trace: {
      summary: 'Controller installation is held on every aircraft that reaches the station before Rev C arrives. The originator left this line for the planner. Norn counts the money tied up in each held aircraft.',
      sources: [
        { system: 'PLM', ref: 'ECR-0417 consequences', detail: 'Controller installation stays held on every aircraft still in build' },
        { system: 'ERP', ref: 'Volume plan and standard cost', detail: 'One aircraft a month; Vesper V4 standard cost $2,800,019' },
      ],
      inputs: [
        { label: 'Cut-in, weeks after approval', display: '15 wk (25 Feb 2027)', evidence: 'computation', traceId: 'in.cutInWeeks' },
        { label: 'Standard cost per aircraft', display: '$2,800,019', evidence: 'fact', traceId: 'in.stdCost' },
        { label: 'Share of cost in a held aircraft', display: '85%', evidence: 'assumption', traceId: 'in.heldFrac' },
        { label: 'Cost of capital', display: '9% a year', evidence: 'assumption', traceId: 'in.carry' },
        { label: 'Aircraft-weeks held', display: '36', evidence: 'computation' },
      ],
      formula: {
        expression: 'aircraft-weeks held x standard cost x share x cost of capital / 52',
        worked: 'With every input at its median: 35.7 x $2,800,019 x 85% x 9% / 52 = $147,100. The line shows the median of all draws, which is higher because the cut-in can slip later but not earlier.',
      },
    },
  },
  {
    id: 'o2', block: 'other', label: 'Allowance for past overruns', evidence: 'computation', oneTime: true,
    note: 'One-time costs ran over',
    value: x => (x.overrun - 1) * (13600 + 13200 + x.reinspH * 110 * RETROFIT_AC + 1900),
    trace: {
      summary: 'Past ECOs ran over on one-time cost, so Norn adds a contingency to the lines that rest on quotes and estimates without a range of their own.',
      sources: [{ system: 'History', ref: 'ERP released ECOs', detail: 'Eight of nine nonzero one-time costs ran 7 to 40% over' }],
      inputs: [
        { label: 'One-time cost overrun', display: '+12%', evidence: 'assumption', traceId: 'in.overrun' },
        { label: 'Lines it applies to', display: '$35,300', evidence: 'computation' },
      ],
      formula: { expression: 'overrun x (fixture + installation + re-inspection + manual)', worked: '12% x ($13,600 + $13,200 + $6,600 + $1,900) = $4,236' },
    },
  },
];

// A constant fact that the cost lines read but that has no range of its own.
inputs.push({
  key: 'stdCost', label: 'Standard cost per aircraft', unit: 'usd', evidence: 'fact',
  q: { p10: STD_COST, p50: STD_COST, p90: STD_COST }, fmt: v => usd(v),
  trace: {
    summary: 'Vesper V4 standard cost, rolled up from 214 items and labor.',
    sources: [{ system: 'ERP', ref: 'Standard cost roll-up', detail: 'Vesper V4, $2,800,019' }],
  },
});

const model = runModel({
  seed: 417,
  draws: 10000,
  at: AT,
  inputs,
  rows,
  extras: {
    cutIn: x => APPROVAL + x.cutInWeeks * 7 * DAY,
    cutInWeeks: x => x.cutInWeeks,
    unitPerAc: x => (x.priceC - x.priceB) * x.perAc,
  },
  driverKeys: ['cutInWeeks', 'carry', 'overrun', 'requal', 'reuse', 'engHours', 'priceC', 'reinspH'],
  netTrace: {
    summary: 'Every line summed on the same 10,000 draws, so the range is the range of the total, not a sum of the lines’ ranges. About half of it is the hold on the aircraft waiting for Rev C.',
    sources: [{ system: 'Norn', ref: 'Cost check (S2)', detail: 'Paired Monte Carlo over all inputs' }],
    formula: { expression: 'percentile of (sum of lines) over 10,000 draws', worked: 'p10 / p50 / p90 of the draws, not the sum of each line’s percentiles' },
    assumptions: [{ label: 'Draws', display: '10,000, seed 417', origin: 'default', source: 'Norn configuration' }],
  },
  subtotalTrace: b => ({
    summary: `The ${b} lines of the ECP cost page, summed on the same draws.`,
    sources: [{ system: 'Norn', ref: 'Cost check (S2)' }],
    formula: { expression: 'percentile of (sum of the block’s lines)' },
  }),
});

// Numbers the page quotes in words.
const perWeek = model.totalAt({ cutInWeeks: 16 }) - model.totalAt({});
const p90Round = Math.round((model.net.p90 ?? model.net.p50) / 25000) * 25000;
const pUnder = model.sCurve.points.filter(p => p.x <= p90Round).length / 100;
const marchFifteenth = Date.UTC(2027, 2, 15);
const pByMarch = model.prob(e => e.cutIn <= marchFifteenth);
const pSlip = model.prob(e => e.cutInWeeks >= 17);
const lk = (event: string, p: number): Likelihood => ({ word: likelihoodWord(p), event, probability: p });

const rowP50 = (id: string) => model.rows.find(r => r.id === id)!.total.p50;
// What Level 1 said: no hold, the 252 pieces in the worked example, retrofit scoped to the four test aircraft, no allowance.
const level1 = Math.round((model.net.p50 - rowP50('o1') - rowP50('o2') - 72 * (186.4 - SALVAGE) - 72 * 221 - (13200 - 5280)) / 1000) * 1000;
const checker = Math.round((model.net.p50 * 0.96) / 1000) * 1000;

const unitFig = model.extra('unitPerAc', 'usd');
const cutInFig = model.extra('cutIn', 'date');
const t = model.traces;

t['x.unitPerAc'] = model.makeTrace('x.unitPerAc', 'Unit cost change per aircraft', 'computation', {
  summary: 'What each aircraft costs more to build once Rev C is in: twelve brackets at $34.60 more.',
  sources: [{ system: 'Quote', ref: 'Q-HAL-26-1187' }, { system: 'ERP', ref: 'BW-5120-210 Rev B' }, { system: 'PLM', ref: 'Engineering BOM' }],
  inputs: [
    { label: 'Rev C bracket price', display: '$221.00', evidence: 'fact', traceId: 'in.priceC' },
    { label: 'Rev B bracket price', display: '$186.40', evidence: 'fact', traceId: 'in.priceB' },
    { label: 'Brackets per aircraft', display: '12', evidence: 'fact', traceId: 'in.perAc' },
  ],
  formula: { expression: '(Rev C price - Rev B price) x brackets per aircraft', worked: '($221.00 - $186.40) x 12 = $415.20' },
  check: 'Cost (S2)', actor: 'Cost check', onBehalfOf: 'Norn, automatically', note: 'Mock compute: 10,000 draws, seed 417',
});
t['x.cutIn'] = model.makeTrace('x.cutIn', 'Cut-in date', 'computation', {
  summary: 'The date Rev C brackets reach the line, so controller installation can restart on S/N 011. Halden’s lead time sets it; past slips set the late tail.',
  sources: t['in.cutInWeeks'].sources,
  assumptions: t['in.cutInWeeks'].assumptions,
  formula: t['in.cutInWeeks'].formula,
  inputs: [{ label: 'Weeks after CCB approval', display: '15 wk', evidence: 'computation', traceId: 'in.cutInWeeks' }],
  check: 'Time to the line (S3)', actor: 'Timeline check',
});
t['supply'] = model.makeTrace('supply', 'Supply risk', 'judgment', {
  value: { text: 'Moderate', range: 'One source, no Rev C stock' },
  summary: 'Halden is the only qualified source for the bracket, and there is no Rev C stock to bridge a delay. A slip of two weeks or more is unlikely, but a longer outage has no fallback.',
  sources: [
    { system: 'ERP', ref: 'Sourcing, BW-5120-210', detail: 'Sole source: Halden Precision. Not on the strategic single-source list' },
    { system: 'Quote', ref: 'Q-HAL-26-1187', detail: 'Plate lead time 6 weeks, first lot 14 weeks after PO' },
  ],
  inputs: [
    { label: 'Chance the first lot slips 2 weeks or more', display: `${Math.round(pSlip * 100)}%`, evidence: 'computation', traceId: 'in.cutInWeeks' },
    { label: 'Sources', display: '1 (Halden)', evidence: 'fact' },
    { label: 'Rev C on hand', display: '0', evidence: 'fact' },
  ],
  assumptions: [{ label: 'Outages are shown as scenarios, not blended into the range', display: 'what-ifs below', origin: 'default', source: 'Norn configuration' }],
  check: 'Supply risk (S4)', actor: 'Supply agent', onBehalfOf: 'Norn, automatically',
});
t['class'] = model.makeTrace('class', 'Change class', 'judgment', {
  value: { text: 'Class I · FAA minor', range: 'Company class and FAA class are set separately' },
  summary: 'Company Class I, because the change costs money and reaches aircraft already built. FAA minor, because the part is secondary structure with the same envelope and interfaces. The two are set separately and here they differ.',
  sources: [
    { system: 'PLM', ref: 'ECR-0417 classification', detail: 'Originator proposes Class I and FAA minor under 14 CFR 21.93(a)' },
    { system: 'Policy', ref: 'Bowman change classes', detail: 'Class I: cost, retrofit of built aircraft, interchangeability' },
  ],
  inputs: [
    { label: 'Retrofit of built aircraft', display: 'S/N 001 to 010', evidence: 'fact' },
    { label: 'Interchangeable with Rev B', display: 'yes', evidence: 'fact' },
  ],
  assumptions: [{ label: 'FAA minor', display: 'proposed by the originator', origin: 'given', source: 'Gideon Falk decides as design approval holder' }],
  check: 'Change class (#33)', actor: 'Router agent', onBehalfOf: 'Norn, automatically',
});
t['rec'] = model.makeTrace('rec', 'Norn’s recommendation', 'judgment', {
  value: { text: 'Approve', range: 'At the 12 Nov CCB' },
  summary: 'Approve. Rev B cannot fly past its 5 hour inspection interval, the fix is proven on the rig, and each week of delay costs more than the part does in a year.',
  sources: [
    { system: 'PLM', ref: 'NCR-0119 and ECR-0417', detail: 'Fatigue margin +14% for Rev C against -31% for Rev B' },
    { system: 'Norn', ref: 'Cost and timeline checks' },
  ],
  inputs: [
    { label: 'Year-1 total', display: `${usdK(model.net.p50)}, ${usdK(model.net.p10!)} to ${usdK(model.net.p90!)}`, evidence: 'computation', traceId: 'net' },
    { label: 'Cost of one more week of delay', display: usdK(perWeek), evidence: 'computation' },
    { label: 'Blind checker’s own estimate', display: usdK(checker), evidence: 'computation' },
  ],
  assumptions: [{ label: 'Four alternatives were ruled out in the ECR', display: 'peening, doubler, isolator, inspect', origin: 'given', source: 'Jeff Hargrove, originator' }],
  check: 'Impact statement (S5)', actor: 'Reviewer agent', onBehalfOf: 'Norn, automatically',
  note: 'Mock: written by a stand-in, not a live model',
});

const activity: ActivityEvent[] = [
  { id: 'a12', at: '2026-10-23T10:05:00-07:00', actor: 'Samir Vaidya', actorKind: 'person', text: 'Approved the cost review' },
  { id: 'a11', at: '2026-10-22T16:20:00-07:00', actor: 'Hamid Barzani’s agent', actorKind: 'person_agent', onBehalfOf: 'Hamid Barzani', text: 'Confirmed the 14 week lead time with Halden', detail: 'Reported by agent. Norn has not fetched the source itself.', reportedByAgent: true },
  { id: 'a10', at: '2026-10-21T10:41:00-07:00', actor: 'Reviewer', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Posted Level 3: Norn’s final verdict', detail: `Year 1 ${usdK(model.net.p50, { plus: true })}, up from ${usdK(level1)} at Level 1.`, level: 3 },
  { id: 'a9', at: '2026-10-21T10:36:00-07:00', actor: 'Blind checker', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Formed its own estimate without seeing the answer', detail: `${usdK(checker)}, within 4% of the verdict.` },
  { id: 'a8', at: '2026-10-21T09:52:00-07:00', actor: 'Cost check', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Posted Level 2 after the pushback', detail: 'Added the hold on S/N 011 onward and the 324 pieces to scrap.', level: 2 },
  { id: 'a7', at: '2026-10-21T09:30:00-07:00', actor: 'Reviewer', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Pushed back on Level 1', detail: 'Counted 252 pieces to scrap, left out the hold, and scoped the retrofit to four aircraft.' },
  { id: 'a6', at: '2026-10-21T09:21:00-07:00', actor: 'Researcher', actorKind: 'norn', onBehalfOf: 'Wei-Lin Zhao', spawnedBy: 'Norn, for Wei-Lin Zhao', text: 'Read Halden’s quote and the stock in the ERP', detail: '6 purchase lines, 5 stock locations.' },
  { id: 'a5', at: '2026-10-21T09:12:00-07:00', actor: 'Wei-Lin Zhao', actorKind: 'person', text: 'Asked for the full assessment' },
  { id: 'a4', at: '2026-10-19T14:03:00-07:00', actor: 'Router', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Set the class and proposed the route', detail: 'Class I, FAA minor. Over $150,000, so the CCB decides.' },
  { id: 'a3', at: '2026-10-19T14:03:00-07:00', actor: 'Cost check', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Posted Level 1 to the PLM', detail: `Provisional: year 1 ${usdK(level1, { plus: true })}.`, level: 1 },
  { id: 'a2', at: '2026-10-19T14:02:00-07:00', actor: 'Reader', actorKind: 'norn', spawnedBy: 'Norn, automatically', text: 'Read the ECR', detail: 'One item change, five fields.' },
  { id: 'a1', at: '2026-10-19T14:02:00-07:00', actor: 'Jeff Hargrove', actorKind: 'person', text: 'Filed the ECR in the PLM', detail: 'From NCR-0119, the fillet crack at 8.2 h.' },
];

const net = model.net;
export const ecr0417Summary: EcrSummary = {
  id: 'ECR-0417',
  title: 'Motor-controller mounting bracket BW-5120-210, Rev B to Rev C: fillet fatigue crack',
  program: 'Vesper', partNumber: 'BW-5120-210', companyClass: 'I', faa: 'minor', priority: 'Urgent', status: 'In review',
  cost: { p10: net.p10!, p50: net.p50, p90: net.p90! },
  level: 3, lastActivity: '2026-10-23T10:05:00-07:00', lastActivityBy: 'Samir Vaidya approved',
  originator: 'Jeff Hargrove', filedOn: '2026-10-19', hasAssessment: true,
};

export const ecr0417: ImpactAssessment = {
  ecr: ecr0417Summary,
  level: 3,
  headline: {
    unitCost: unitFig,
    unitCostNote: '$34.60 more per bracket, 12 per aircraft',
    year1: net,
    year1Likelihood: lk(`under ${usdK(p90Round)}`, pUnder),
    cutIn: cutInFig,
    cutInNote: 'S/N 011 and on, after Halden’s first lot',
    cutInLikelihood: lk(`by ${dateShort(marchFifteenth)}`, pByMarch),
    supply: {
      id: 'supply', level: 'moderate', evidence: 'judgment',
      note: 'One source, no Rev C stock',
      likelihood: lk('the first lot slips 2 weeks or more', pSlip),
    },
  },
  cost: { rows: model.rows, subtotals: model.subtotals, net, yearLabel: '2027' },
  sCurve: model.sCurve,
  drivers: model.drivers.slice(0, 4),
  scenarios: [
    {
      label: 'Halden down 6 weeks',
      effect: `Cut-in ${dateShort(APPROVAL + 21 * 7 * DAY)}, ${usdK(model.totalAt({ cutInWeeks: 21 }) - model.totalAt({}), { plus: true })}`,
    },
    {
      label: 'First article fails once',
      effect: `Cut-in ${dateShort(APPROVAL + 19 * 7 * DAY)}, ${usdK(model.totalAt({ cutInWeeks: 19 }) - model.totalAt({}), { plus: true })}`,
    },
  ],
  changeClass: {
    company: 'I', companyWhy: 'Costs money and reaches built aircraft',
    faa: 'minor', faaWhy: 'Secondary structure, same envelope',
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
      { text: `Rev C fatigue margin is +14%, against −31% for Rev B`, evidence: 'fact', traceId: 'rec' },
      { text: `Each week of delay costs ${usdK(perWeek)}; the part adds about ${usdK(model.rows[0].total.p50)} a year`, evidence: 'computation', traceId: 'rec' },
      { text: 'Approving at the 12 Nov CCB is the earliest start', evidence: 'judgment', traceId: 'rec' },
    ],
    traceId: 'rec',
  },
  needed: [
    { text: 'Certification to confirm FAA minor', owner: 'Gideon Falk' },
    { text: 'Plan for the aircraft held at install', owner: 'Colleen Rourke' },
    { text: 'Delta first-article review', owner: 'Beatriz Nowak' },
  ],
  activity,
  traces: t,
};
