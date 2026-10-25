import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapEcr } from '../src/map.ts';
import { ecrDoc, settings } from './fixture.ts';

test('PLM task rows retain prerequisites, exact zero, completion evidence and downtime assessment', () => {
  const doc = ecrDoc();
  doc.test_and_qualification = 'Qualification required before release';
  doc.implementation_plan_complete = 1;
  doc.implementation_plan = [{ task_id: 'qual', label: 'Qualification', kind: 'qualification', applies_to: 'production', task_owner: 'Certification', status: 'planned', duration_basis: 'Exact', duration_weeks: 8, after_tasks: 'parts' },
    { task_id: 'install', label: 'Install and test', kind: 'installation', applies_to: 'retrofit', task_owner: 'Maintenance', status: 'complete', duration_basis: 'Exact', duration_assessed: 1, duration_weeks: 0, after_tasks: 'qual', completed_on: '2026-10-01', evidence: 'Signed work card', downtime_assessed: 1, downtime_hours_per_unit: 0 }];
  const { change } = mapEcr(settings, doc);
  assert.equal(change.testAndQualification, doc.test_and_qualification);
  assert.equal(change.implementationPlan!.complete, true);
  assert.equal(change.implementationPlan!.tasks[0].durationWeeks, 8);
  assert.deepEqual(change.implementationPlan!.tasks[1].after, ['qual']);
  assert.equal(change.implementationPlan!.tasks[1].durationWeeks, 0);
  assert.equal(change.implementationPlan!.tasks[1].downtimeHoursPerUnit, 0);
  assert.equal(change.implementationPlan!.tasks[1].evidence, 'Signed work card');
});

test('explicit assessed zero and cost factors survive the PLM round trip; blanks remain absent', () => {
  const doc = ecrDoc();
  doc.cost_factors = [{ factor: 'qualification', status: 'assessed', note: 'Covered by supplier' }];
  doc.cost_production = [{ name: 'zero', label: 'Qualification', factor: 'qualification', basis: 'Estimate', assessed_zero: 1, one_time: 0 },
    { name: 'blank', label: 'Unknown', basis: 'Not provided', one_time: 0 }];
  const { change } = mapEcr(settings, doc);
  assert.equal(change.costPage.production[0].oneTime, 0);
  assert.equal(change.costPage.production[0].factor, 'qualification');
  assert.equal(change.costPage.production[1].oneTime, undefined);
  assert.equal(change.costFactors![0].note, 'Covered by supplier');
  doc.cost_production[0].one_time = 100;
  assert.throws(() => mapEcr(settings, doc), /marked zero but states a nonzero/);
});

test('invalid prerequisite and completeness documents fail with an ECR-specific error', () => {
  assert.throws(() => mapEcr(settings, { ...ecrDoc(), implementation_plan: '{' }), /ECR-0001.*implementation_plan/);
  assert.throws(() => mapEcr(settings, { ...ecrDoc(), cost_factors: [{ factor: 'q', status: 'approved' }] }), /ECR-0001.*cost_factors/);
});

test('an empty Exact duration stays unknown; an explicitly confirmed zero is preserved', () => {
  const doc = ecrDoc();
  doc.implementation_plan_complete = 1;
  doc.implementation_plan = [{ task_id: 'q', label: 'Qualification', kind: 'qualification', applies_to: 'production', task_owner: 'Certification', status: 'planned', duration_basis: 'Exact', duration_weeks: 0 }];
  assert.equal(mapEcr(settings, doc).change.implementationPlan!.tasks[0].durationWeeks, undefined);
  doc.implementation_plan[0].duration_assessed = 1;
  assert.equal(mapEcr(settings, doc).change.implementationPlan!.tasks[0].durationWeeks, 0);
});
