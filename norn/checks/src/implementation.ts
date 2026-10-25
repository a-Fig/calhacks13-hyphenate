import { lognormalFromQuantiles, point } from './dist.ts';
import { dayOf, dateOf } from './time.ts';
import type { Book } from './plan.ts';
import type { ChangeRequest, ImplementationTask } from './types.ts';

export interface PlannedTask {
  task: ImplementationTask;
  input: string;
  duration: string;
  after: string[];
  completedDay?: number;
}

/** Validate and topologically order the supplied plan. Unknown work stays visible as a lower bound. */
export function implementationTasks(book: Book, ecr: ChangeRequest): { tasks: PlannedTask[]; complete: boolean } {
  const plan = ecr.implementationPlan;
  const tasks = plan?.tasks ?? [];
  const byId = new Map(tasks.map(t => [t.id, t]));
  if (byId.size !== tasks.length || tasks.some(t => !t.id || ['decision', 'parts'].includes(t.id))) throw new Error('Implementation task ids must be unique and cannot be decision or parts');
  const ordered: ImplementationTask[] = [];
  const seen = new Set<string>(), visiting = new Set<string>();
  const visit = (t: ImplementationTask) => {
    if (seen.has(t.id)) return;
    if (visiting.has(t.id)) throw new Error(`Implementation dependency cycle at ${t.id}`);
    visiting.add(t.id);
    for (const id of t.after ?? ['parts']) {
      if (id === 'decision' || id === 'parts') continue;
      const dependency = byId.get(id);
      if (!dependency) throw new Error(`Implementation task ${t.id} depends on unknown task ${id}`);
      if (t.appliesTo === 'production' && dependency.appliesTo === 'retrofit') throw new Error(`Production task ${t.id} depends on retrofit-only task ${id}`);
      visit(dependency);
    }
    visiting.delete(t.id); seen.add(t.id); ordered.push(t);
  };
  tasks.forEach(visit);
  const noQualification = /^\s*(none|n\/a|not applicable)\b/i.test(ecr.testAndQualification ?? '');
  let complete = plan?.complete === true || (!plan && noQualification && !ecr.effectivity.retrofit);
  const warn = (ref: string, message: string) => {
    complete = false;
    book.flags.push({ kind: 'implementation_unestimated', severity: 'warn', ref, message });
  };
  if (!complete) {
    warn(`implementation:${ecr.id}`, 'Qualification, release or retrofit prerequisites have not all been assessed. Dates show material readiness only; implementation may be later.');
  }
  if (ecr.effectivity.retrofit && !tasks.some(task => task.appliesTo !== 'production')) warn(`implementation:${ecr.id}:retrofit`, 'Retrofit execution, installation/retest and aircraft downtime have not been assessed.');
  const result = ordered.map(task => {
    const input = `implementation:${ecr.id}:${task.id}`;
    book.input({ id: input, label: task.label, source: 'given', value: task.status, ref: `${ecr.id} implementationPlan.${task.id}`, rationale: `${task.owner || 'Owner not assigned'}; ${task.evidence || 'no completion evidence'}` });
    let duration = point(0);
    let completedDay: number | undefined;
    if (!task.owner?.trim()) warn(input, `${task.label}: no owner is assigned.`);
    if (task.status === 'complete') {
      completedDay = task.completedOn ? dayOf(task.completedOn) : NaN;
      if (!Number.isFinite(completedDay) || dateOf(completedDay!) !== task.completedOn || !task.evidence?.trim()) {
        completedDay = undefined;
        warn(input, `${task.label}: completion needs a date and evidence.`);
      }
    } else if (task.status === 'not_applicable') {
      if (!task.evidence?.trim()) warn(input, `${task.label}: not applicable needs a reason.`);
    } else if (task.status === 'planned') {
      const d = task.durationWeeks;
      if (typeof d === 'number' && Number.isFinite(d) && d >= 0) duration = point(d);
      else if (d && typeof d === 'object' && [d.p10, d.p50, d.p90].every(Number.isFinite) && d.p10 >= 0 && d.p10 <= d.p50 && d.p50 <= d.p90) {
        duration = d.p10 === d.p90 ? point(d.p50) : d.p10 > 0 ? lognormalFromQuantiles(d.p10, d.p50, d.p90) : point(0);
        if (d.p10 === 0 && d.p90 > 0) warn(input, `${task.label}: a nonzero duration range must have positive quantiles.`);
      } else warn(input, `${task.label}: duration is unknown; no implementation completion date is established.`);
    } else warn(input, `${task.label}: work is unassessed.`);
    if (task.appliesTo !== 'production' && (task.downtimeHoursPerUnit === undefined || !Number.isFinite(task.downtimeHoursPerUnit) || task.downtimeHoursPerUnit < 0)) warn(input, `${task.label}: retrofit downtime per unit is not estimated.`);
    const id = book.variable({ id: `${input}:weeks`, label: `${task.label}: elapsed weeks`, dist: duration, source: 'given', ref: input });
    return { task, input, duration: id, after: task.after ?? ['parts'], ...(completedDay === undefined ? {} : { completedDay }) };
  });
  return { tasks: result, complete };
}
