import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { point } from '../src/dist.ts';
import { slotTerms, PLAN_DEFAULTS } from '../src/plan.ts';
import { timelineRows } from '../src/rows.ts';
import { timelineCheck, type TimelineResult } from '../src/timeline.ts';
import { dateOf, dayOf, serialTable, dayOfSerial, serialAtDay } from '../src/time.ts';
import type { Baseline, ChangeRequest } from '../src/types.ts';
import { serialsByMonth } from '../src/volume.ts';

const SEED = 'norn-seed-1';
const ecr = (id: string): ChangeRequest => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return structuredClone(e);
};
const baseline: Baseline = bowman;
const traceIds = (x: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.evidence === 'computation' && Array.isArray(o.uses)) for (const u of o.uses as { id: string }[]) out.push(u.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(x);
  return out;
};

const r417 = timelineCheck(baseline, ecr('ECR-0417'), { seed: SEED });
const r419 = timelineCheck(baseline, ecr('ECR-0419'), { seed: SEED });
const r421 = timelineCheck(baseline, ecr('ECR-0421'), { seed: SEED });

test('days and serials: dates round trip, and a serial maps to the day it is planned to complete', () => {
  assert.equal(dateOf(dayOf('2026-10-19')), '2026-10-19');
  const t = serialTable(serialsByMonth(baseline.volumePlan, baseline.builtAircraft, 'vesper'));
  assert.equal(t.first, 10, 'S/N 010 completed on 2026-10-16, inside the first plan month, so it is the planned unit of that month');
  const d11 = dayOfSerial(t, 11)!;
  assert.equal(dateOf(d11).slice(0, 7), '2026-11');
  assert.equal(serialAtDay(t, d11), 11);
  assert.equal(serialAtDay(t, d11 + 1), 12, 'a day after S/N 011 completes, the next unit is S/N 012');
  assert.equal(dayOfSerial(t, 9), undefined, 'a serial built before the plan starts is not in it');
});

test('the same inputs and seed give the same result, byte for byte; another seed does not', () => {
  const again = timelineCheck(baseline, ecr('ECR-0417'), { seed: SEED });
  assert.equal(JSON.stringify(again), JSON.stringify(r417));
  assert.notEqual(JSON.stringify(timelineCheck(baseline, ecr('ECR-0417'), { seed: 'another-seed' })), JSON.stringify(r417));
});

test('ECR-0417: the Halden bracket cannot reach the line until about February 2027, three months after S/N 011', () => {
  assert.equal(r417.stated.serial, 11);
  assert.equal(r417.stated.date?.slice(0, 7), '2026-11');
  // Filed 2026-10-19, urgent: decided about three weeks later; Halden quotes 14 weeks after the order.
  assert.ok(r417.decision.date.p50 >= '2026-11-02' && r417.decision.date.p50 <= '2026-11-20', r417.decision.date.p50);
  const c = r417.cutIn.date;
  assert.ok(c!.p10 < c!.p50 && c!.p50 < c!.p90, 'a range, not a point');
  assert.ok(c!.p10 >= '2026-12-20' && c!.p90 <= '2027-05-15', `${c!.p10} to ${c!.p90}`);
  assert.ok(c!.p50 >= '2027-02-01' && c!.p50 <= '2027-03-05', c!.p50);
  assert.ok(r417.cutIn.weeksFromFiling!.p50 > 14 && r417.cutIn.weeksFromFiling!.p50 < 20);
  // S/N 011-014 wait for the part: the scenario says about 14 weeks.
  assert.ok(r417.late && r417.late.weeks.p50 > 11 && r417.late.weeks.p50 < 16, String(r417.late?.weeks.p50));
  assert.equal(r417.late!.probability, 1, 'the quoted lead time alone puts the part past S/N 011 in every draw');
  assert.ok(r417.cutIn.serial.p50 >= 14 && r417.cutIn.serial.p50 <= 17, `first serial that could take Rev C without a hold: ${r417.cutIn.serial.p50}`);
  assert.equal(r417.paths.find((p) => p.id === 'parts:BW-5120-210')!.criticalShare, 1);
  assert.ok(r417.flags.some((f) => f.kind === 'likely_late'));
});

test('ECR-0417: the quoted 14 weeks is the median, spread by Halden\'s own lead-time record', () => {
  const lead = r417.inputs.find((i) => i.id === 'lead:ECR-0417:BW-5120-210')!;
  assert.equal(lead.source, 'given');
  assert.equal(lead.value, 14);
  assert.deepEqual(lead.groups, ['supplier:SUP-HALDEN']);
  // Halden's record is p10 6, p50 9, p90 14: ratios 0.667 and 1.556 on the median.
  assert.equal(lead.dist?.kind, 'lognormal');
  if (lead.dist?.kind === 'lognormal') {
    assert.equal(lead.dist.median, 14);
    assert.ok(Math.abs(lead.dist.median * (6 / 9) - 14 * (6 / 9)) < 1e-9);
  }
  const decision = r417.inputs.find((i) => i.id === 'decision:ECR-0417')!;
  assert.equal(decision.source, 'default', 'nobody has stated how long the board takes');
});

test('ECR-0419: the Orrin qualification slot opens 2027-04-01 and the part follows 28 weeks later, about S/N 030', () => {
  const slot = r419.paths.find((p) => p.id === 'parts:BW-3120-340')!.slot!;
  assert.equal(slot.constraint, 'CON-ORRIN-UH-SLOT');
  assert.deepEqual(slot.opens, { p10: '2027-04-01', p50: '2027-04-01', p90: '2027-04-01' });
  assert.equal(slot.shareInFirstSlot, 1);
  assert.equal(r419.stated.serial, 30);
  assert.ok(r419.cutIn.date!.p50 >= '2027-10-01' && r419.cutIn.date!.p50 <= '2027-10-31', r419.cutIn.date!.p50);
  assert.ok(r419.cutIn.serial.p50 >= 29 && r419.cutIn.serial.p50 <= 31, String(r419.cutIn.serial.p50));
  // Close to the stated date, so it is a coin toss and not a certainty either way.
  assert.ok(r419.late!.probability > 0.2 && r419.late!.probability < 0.5, String(r419.late!.probability));
  assert.ok(r419.late!.weeks.p10 < 0 && r419.late!.weeks.p90 > 0);
  assert.ok(r419.flags.some((f) => f.kind === 'terms_from_text'), 'the slot terms come from the constraint\'s description');
});

test('ECR-0421: a stated June 2027 rotor build is out of reach of a 30-week lead time from the April slot', () => {
  assert.equal(r421.stated.date, '2027-06-01');
  assert.equal(r421.late!.probability, 1);
  assert.ok(r421.late!.weeks.p50 > 18 && r421.late!.weeks.p50 < 24, String(r421.late!.weeks.p50));
});

test('every number carries a trace, and every id in a trace is a recorded input', () => {
  for (const r of [r417, r419, r421]) {
    const ids = new Set(r.inputs.map((i) => i.id));
    const used = traceIds(r);
    assert.ok(used.length > 5);
    for (const id of used) assert.ok(ids.has(id), `${r.ecr}: a trace names ${id}, which is not among the inputs`);
    for (const i of r.inputs) assert.ok(['given', 'default', 'agent_estimated'].includes(i.source));
  }
});

test('converges on its continuous metrics', () => {
  for (const r of [r417, r419, r421]) {
    assert.ok(r.convergence.converged, r.ecr);
    assert.equal(r.draws, 10_000);
    assert.deepEqual(r.convergence.seeds, [SEED, `${SEED}:convergence`]);
    assert.ok(r.convergence.metrics.every((m) => m.relDiff <= 0.01));
  }
});

test('rows: finite and ordered, with a detail row that carries the inputs', () => {
  const rows = timelineRows(r417);
  assert.deepEqual(rows.map((r) => r.key), ['cut_in_date', 'cut_in_weeks', 'cut_in_serial', 'decision_date', 'late_weeks', 'p_late', 'detail']);
  for (const r of rows) {
    assert.ok([r.p10, r.p50, r.p90].every(Number.isFinite), r.key);
    assert.ok(r.p10 <= r.p50 && r.p50 <= r.p90, r.key);
    JSON.parse(r.detailJson);
  }
  const date = rows.find((r) => r.key === 'cut_in_date')!;
  assert.equal(dateOf(date.p50), r417.cutIn.date!.p50);
  const detail = JSON.parse(rows.at(-1)!.detailJson) as TimelineResult;
  assert.equal(detail.codeVersion, r417.codeVersion);
  assert.equal(detail.seed, SEED);
  assert.ok(detail.inputs.length > 5);
  assert.equal(detail.paths.length, 2);
});

test('an assumption replaces a default: a faster board decision moves the cut-in earlier by that many weeks', () => {
  const fast = timelineCheck(baseline, ecr('ECR-0417'), {
    seed: SEED, assumptions: [{ id: 'decision:ECR-0417', source: 'agent_estimated', rationale: 'The board meets next week.', dist: point(1) }],
  });
  const dec = fast.inputs.find((i) => i.id === 'decision:ECR-0417')!;
  assert.equal(dec.source, 'agent_estimated');
  assert.ok(fast.cutIn.day!.p50 < r417.cutIn.day!.p50 - 10);
  assert.equal(fast.decision.date.p50, '2026-10-26');
});

test('an assumption cannot replace a number someone stated unless it says so; unknown ids are reported', () => {
  const dist = point(8);
  const refused = timelineCheck(baseline, ecr('ECR-0417'), { seed: SEED, assumptions: [{ id: 'lead:ECR-0417:BW-5120-210', source: 'agent_estimated', rationale: 'x', dist }] });
  assert.equal(refused.cutIn.date!.p50, r417.cutIn.date!.p50);
  assert.ok(refused.flags.some((f) => f.kind === 'assumption_not_applied'));
  const applied = timelineCheck(baseline, ecr('ECR-0417'), { seed: SEED, assumptions: [{ id: 'lead:ECR-0417:BW-5120-210', source: 'agent_estimated', rationale: 'x', dist, replacesGiven: true }] });
  assert.ok(applied.cutIn.day!.p50 < r417.cutIn.day!.p50 - 30);
  const unknown = timelineCheck(baseline, ecr('ECR-0417'), { seed: SEED, assumptions: [{ id: 'nonsense', source: 'default', rationale: 'x', dist }] });
  assert.ok(unknown.flags.some((f) => f.kind === 'unused_assumption' && f.ref === 'nonsense'));
});

test('old stock the proposal uses up sets the cut-in when it outlasts the parts', () => {
  const big: Baseline = { ...baseline, stock: baseline.stock.map((s) => (s.item === 'BW-3120-340' ? { ...s, stores: 600 } : s)) };
  const r = timelineCheck(big, ecr('ECR-0419'), { seed: SEED });
  const stock = r.paths.find((p) => p.id === 'stock')!;
  assert.equal(stock.criticalShare, 1, 'about 100 aircraft of old magnet sets: the new grade waits for them');
  assert.ok(r.cutIn.serial.p50 >= 100, String(r.cutIn.serial.p50));
  assert.ok(r.cutIn.date!.p50 > r419.cutIn.date!.p50);
});

test('an ECR that brings in no bought part waits only for the board', () => {
  const e = ecr('ECR-0417');
  e.itemChanges = [];
  const r = timelineCheck(baseline, e, { seed: SEED });
  assert.ok(r.flags.some((f) => f.kind === 'no_supply_path'));
  assert.equal(r.cutIn.date!.p50, r.decision.date.p50);
  assert.deepEqual(r.paths.map((p) => p.id), ['decision']);
});

test('an effectivity of "lot" or "tbd" has no deadline to miss', () => {
  const e = ecr('ECR-0417');
  e.effectivity.production = { basis: 'tbd', from: 'tbd' };
  const r = timelineCheck(baseline, e, { seed: SEED });
  assert.equal(r.late, null);
  assert.ok(r.flags.some((f) => f.kind === 'no_stated_effectivity'));
  assert.deepEqual(timelineRows(r).map((x) => x.key), ['cut_in_date', 'cut_in_weeks', 'cut_in_serial', 'decision_date', 'detail']);
});

test('without the supplier constraint (the ERP holds none) the order is not held for a slot', () => {
  const { supplierConstraints: _, ...erpLike } = baseline;
  const r = timelineCheck(erpLike as Baseline, ecr('ECR-0419'), { seed: SEED });
  assert.equal(r.paths.find((p) => p.id === 'parts:BW-3120-340')!.slot, null);
  assert.ok(r.cutIn.date!.p50 < r419.cutIn.date!.p50, 'decision plus 28 weeks is June 2027, ahead of the slot');
});

test('slot terms: read from structured fields, else from the description, else defaulted', () => {
  const orrin = bowman.supplierConstraints.find((c) => c.id === 'CON-ORRIN-UH-SLOT')!;
  const fromText = slotTerms(orrin, PLAN_DEFAULTS);
  assert.equal(fromText.cadenceMonths, 3);
  assert.equal(fromText.cadenceSource, 'given');
  assert.deepEqual(fromText.bundle, { withinWeeks: 26, secondQualificationDiscount: 0.4, priceBreak: 0.06 });
  assert.equal(fromText.fromText, true);
  const structured = slotTerms({ id: 'c', supplier: 's', kind: 'qualification_slot', items: [], slotCadenceMonths: 2, bundle: { withinWeeks: 10, priceBreak: 0.1 } }, PLAN_DEFAULTS);
  assert.equal(structured.cadenceMonths, 2);
  assert.deepEqual(structured.bundle, { withinWeeks: 10, secondQualificationDiscount: 0, priceBreak: 0.1 });
  assert.equal(structured.fromText, false);
  const none = slotTerms({ id: 'c', supplier: 's', kind: 'qualification_slot', items: [] }, PLAN_DEFAULTS);
  assert.equal(none.cadenceSource, 'default');
  assert.equal(none.bundle, undefined);
});

test('does not touch the cost check: S2 still takes the stated serial', async () => {
  const { costCheck } = await import('../src/cost.ts');
  const cost = costCheck(baseline, ecr('ECR-0417'), { seed: SEED });
  assert.equal(cost.effectivity.find((e) => e.program === 'vesper')!.cutInSerial, 11);
});
