import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowman } from '../../../bowman/data/index.ts';
import { timelineCheck } from '../src/timeline.ts';
import { timelineRows } from '../src/rows.ts';
import { costAssessment } from '../src/assessment.ts';
import type { ChangeRequest, ImplementationTask } from '../src/types.ts';

const seed = 'norn-seed-1';
const ecr = (): ChangeRequest => structuredClone(bowman.ecrs.find(e => e.id === 'ECR-0412')!);
const task = (weeks: number): ImplementationTask => ({ id: 'qualification', label: 'Qualification release', kind: 'qualification',
  appliesTo: 'production', owner: 'Certification lead', status: 'planned', durationWeeks: weeks, after: ['parts'] });

test('qualification duration moves the dependent production date, with owner and evidence in the path', () => {
  const e = ecr();
  e.implementationPlan = { complete: true, tasks: [task(8)] };
  const eight = timelineCheck(bowman, e, { seed });
  e.implementationPlan.tasks[0] = task(52);
  const year = timelineCheck(bowman, e, { seed });
  assert.equal(year.readiness, 'materials_only', 'retrofit prerequisites are still unassessed');
  assert.ok(year.cutIn.day!.p50 - eight.cutIn.day!.p50 > 300);
  assert.equal(year.paths.find(p => p.id.endsWith(':qualification'))!.owner, 'Certification lead');
  assert.ok(year.flags.some(f => /Retrofit execution/.test(f.message)));
});

test('retrofit execution has a separate completion milestone and downtime', () => {
  const e = ecr();
  e.implementationPlan = { complete: true, tasks: [task(8), { id: 'install', label: 'Install and retest', kind: 'installation',
    appliesTo: 'retrofit', owner: 'Maintenance lead', status: 'planned', durationWeeks: 2, after: ['qualification'], downtimeHoursPerUnit: 12 }] };
  const r = timelineCheck(bowman, e, { seed });
  assert.equal(r.readiness, 'implementation');
  assert.equal(r.retrofit!.day.p50 - r.cutIn.day!.p50, 14);
  assert.equal(r.paths.find(p => p.id.endsWith(':install'))!.downtimeHoursPerUnit, 12);
  assert.ok(timelineRows(r).some(row => row.key === 'retrofit_completion_date'));
});

test('unknown gates and unsupported completion claims cannot establish implementation readiness', () => {
  const e = ecr();
  e.implementationPlan = { complete: true, tasks: [{ ...task(0), status: 'unknown' }] };
  assert.equal(timelineCheck(bowman, e, { seed }).readiness, 'materials_only');
  e.implementationPlan.tasks[0] = { ...task(0), status: 'complete', completedOn: '2026-10-01' };
  assert.ok(timelineCheck(bowman, e, { seed }).flags.some(f => /completion needs/.test(f.message)));
  e.implementationPlan.tasks[0] = { ...task(0), after: ['missing'] };
  assert.throws(() => timelineCheck(bowman, e, { seed }), /unknown task/);
  e.implementationPlan.tasks[0] = { ...task(0), after: ['qualification'] };
  assert.throws(() => timelineCheck(bowman, e, { seed }), /cycle/);
});

test('completed retrofit work is not delayed by unrelated production material arrivals', () => {
  const e = ecr();
  e.implementationPlan = { complete: true, tasks: [task(8), { id: 'retrofit_done', label: 'Retrofit completed', kind: 'test',
    appliesTo: 'retrofit', owner: 'Maintenance', status: 'complete', after: ['decision'], completedOn: '2026-10-20', evidence: 'Signed work card', downtimeHoursPerUnit: 12 }] };
  const r = timelineCheck(bowman, e, { seed });
  assert.equal(r.retrofit!.date.p50, '2026-10-20');
  assert.ok(r.retrofit!.day.p50 < r.cutIn.day!.p50);
});

test('cost assessment keeps requested costs separate and reprices the median readiness scenario', () => {
  const e = structuredClone(bowman.ecrs.find(e => e.id === 'ECR-0417')!);
  const first = costAssessment(bowman, e, { seed, windowMonths: 6 });
  assert.equal(first.requested.effectivity.find(e => e.program === 'vesper')!.cutInSerial, 11);
  assert.ok(first.forecast!.effectivity.find(e => e.program === 'vesper')!.cutInSerial > 11);
  assert.equal(first.forecast!.window.months, 6);
  assert.notEqual(first.forecast!.headline.recurringWindow.point, first.requested.headline.recurringWindow.point);
  const delayed = structuredClone(e);
  delayed.implementationPlan = { complete: false, tasks: [task(52)] };
  const second = costAssessment(bowman, delayed, { seed, windowMonths: 6 });
  assert.notEqual(second.forecast!.effectivity.find(e => e.program === 'vesper')!.cutInSerial, first.forecast!.effectivity.find(e => e.program === 'vesper')!.cutInSerial);
  assert.notEqual(second.forecast!.headline.recurringWindow.point, first.forecast!.headline.recurringWindow.point);
  assert.equal(second.requested.headline.recurringWindow.point, first.requested.headline.recurringWindow.point);
  const detail = JSON.parse(second.rows.find(row => row.key === 'detail')!.detailJson);
  assert.equal(detail.implementationScenario.basis, 'requested');
  assert.ok(detail.flags.some((f: { kind: string }) => f.kind === 'implementation_scenario'));
  assert.ok(second.rows.some(row => row.key === 'scenario:forecast_net'));
});
