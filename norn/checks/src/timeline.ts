// S3, timeline (ARCHITECTURE.md section 5): when the change can reach the line. The board decides some
// weeks after filing; each changed part then takes its supplier's lead time (or waits for a
// qualification slot first); old stock the proposal uses up is built into aircraft before the new part.
// The cut-in is the latest of those. The result is a range of dates, the first serial that can take
// the change, and how late that is against the effectivity the ECR states.
//
// This is the earliest the change can reach the line on the facts the baseline and the ECR give. It
// does not replace the effectivity the cost check uses (S2 reads the ECR's stated serial), so S2's
// money does not move when S3 reports a later date.

import { type PlanOptions, type Stat, Book, evaluateSchedules, gatherSchedule, isoRange, mergePlanDefaults, r4, simulate, WEEK, type Convergence } from './plan.ts';
import type { Draws } from './sim.ts';
import { dateOf } from './time.ts';
import { type Baseline, type ChangeRequest, type Flag, type InputRecord, type ProgramId, CHECKS_CODE_VERSION } from './types.ts';

export interface DateRange {
  p10: string;
  p50: string;
  p90: string;
}

export interface PathResult {
  id: string;
  kind: 'decision' | 'parts' | 'stock';
  label: string;
  /** Day (since 1970-01-01) this step is done: the decision, the part in the building, or the old stock gone. */
  day: Stat;
  date: DateRange;
  /** Share of draws in which this step is the one that sets the cut-in. */
  criticalShare: number;
  supplier?: string;
  slot?: { constraint: string; opens: DateRange; shareInFirstSlot: number } | null;
}

export interface TimelineResult {
  check: 's3_timeline';
  codeVersion: string;
  ecr: string;
  program: ProgramId;
  seed: string;
  draws: number;
  correlation: number;
  filed: string;
  /** The effectivity the ECR states, and the day it falls on. */
  stated: { basis: string; label: string; date: string | null; serial: number | null };
  decision: { day: Stat; date: DateRange };
  cutIn: {
    /** Day number since 1970-01-01, with the dates it stands for. */
    day: Stat;
    date: DateRange;
    weeksFromFiling: Stat;
    /** The first serial that can take the change. */
    serial: Stat;
  };
  /** Against the stated effectivity: how many weeks after it the change can first reach the line. Null when the ECR states none the plan can place. */
  late: { weeks: Stat; probability: number } | null;
  paths: PathResult[];
  convergence: Convergence;
  flags: Flag[];
  inputs: InputRecord[];
}

/** Run S3 on one ECR. Pure and deterministic in (baseline, ecr, options). */
export function timelineCheck(baseline: Baseline, ecr: ChangeRequest, options: PlanOptions): TimelineResult {
  if (!options.seed) throw new Error("timelineCheck needs a seed: the deployment's configured seed");
  const n0 = options.draws ?? 10_000;
  const rho = options.correlation ?? 0.3;
  const tol = options.convergenceTolerance ?? 0.01;
  const book = new Book(options.assumptions ?? [], mergePlanDefaults(options.defaults));
  const where = { baseline: options.provenance?.baseline ?? 'the baseline', changeRequest: options.provenance?.changeRequest ?? 'the change request' };
  const sched = gatherSchedule(book, baseline, ecr, where);
  const statedDay = sched.stated.day;

  const compute = (d: Draws) => ({ d, t: evaluateSchedules([sched], d, false)[0] });
  const lateOf = (t: ReturnType<typeof compute>['t']) => {
    const out = new Float64Array(t.cutIn.length);
    for (let i = 0; i < out.length; i++) out[i] = (t.cutIn[i] - statedDay!) / WEEK;
    return out;
  };
  const sim = simulate(
    book,
    { seed: options.seed, n0, maxDraws: Math.max(n0, options.maxDraws ?? 4 * n0), rho, tol },
    compute,
    (r) => {
      const weeks = new Float64Array(r.t.cutIn.length);
      for (let i = 0; i < weeks.length; i++) weeks[i] = (r.t.cutIn[i] - sched.filedDay) / WEEK;
      return { cutInWeeks: weeks, ...(statedDay !== null ? { lateWeeks: lateOf(r.t) } : {}) };
    },
  );
  const { d, t } = sim.result;
  const pointDraws = book.pointDraws();
  const at = evaluateSchedules([sched], pointDraws, false)[0];
  const dayAt = (x: Float64Array) => x[0];

  const filedId = `ecr:${ecr.id}:filed`;
  const decisionUses = [filedId, sched.decisionVar];
  const decision = book.stat(t.decision, dayAt(at.decision), 'filing date + weeks to the board\'s decision × 7', decisionUses);
  const cutDay = book.stat(
    t.cutIn, dayAt(at.cutIn),
    'the later of: the day every changed part is in (for each part, the day its order is placed + its weeks from order to parts in × 7; an order for a part with a qualification slot is placed at the first slot that opens after the decision), and the day old stock the proposal uses up has been built into aircraft',
    sched.uses,
  );
  const cutWeeks = (() => {
    const w = new Float64Array(t.cutIn.length);
    for (let i = 0; i < w.length; i++) w[i] = (t.cutIn[i] - sched.filedDay) / WEEK;
    return book.stat(w, (dayAt(at.cutIn) - sched.filedDay) / WEEK, '(cut-in day − filing day) / 7', sched.uses);
  })();
  const serial = book.stat(t.serial, dayAt(at.serial), 'the first serial planned to complete on or after the cut-in day, never before the first unbuilt serial', [...sched.uses, `volume:${sched.program}`], 0);

  let late: TimelineResult['late'] = null;
  if (statedDay !== null) {
    const w = lateOf(t);
    let over = 0;
    for (const x of w) if (x > 0) over++;
    late = {
      weeks: book.stat(w, (dayAt(at.cutIn) - statedDay) / WEEK, '(cut-in day − the day the stated effectivity is planned) / 7; positive is late', [...sched.uses, sched.stated.id]),
      probability: r4(over / w.length),
    };
  }

  // Each step on the path, and how often it is the one that sets the cut-in.
  const paths: PathResult[] = [];
  const share = (pred: (i: number) => boolean) => {
    let c = 0;
    for (let i = 0; i < d.n; i++) if (pred(i)) c++;
    return r4(c / d.n);
  };
  paths.push({
    id: 'decision', kind: 'decision', label: `Board decision on ${ecr.id}`, day: decision, date: isoRange(decision),
    criticalShare: share((i) => t.critical[i] < 0 && !t.floored[i]),
  });
  sched.items.forEach((it, k) => {
    const lead = d.values.get(it.leadVar)!;
    const arrives = new Float64Array(d.n);
    for (let i = 0; i < d.n; i++) arrives[i] = t.placed[k][i] + WEEK * lead[i];
    const atArr = at.placed[k][0] + WEEK * pointDraws.values.get(it.leadVar)![0];
    const ids = [filedId, sched.decisionVar, it.leadVar, ...(it.slot ? [`constraint:${it.slot.constraintId}`, `constraint:${it.slot.constraintId}:terms`] : [])];
    const day = book.stat(arrives, atArr, `${it.item}: ${it.slot ? 'the day of the first qualification slot after the decision' : 'the decision day'} + weeks from order to parts in × 7`, ids);
    const slot = it.slot
      ? (() => {
          const idx = t.slotIndex[k];
          const opens = book.stat(t.placed[k], at.placed[k][0], 'the slot the order waits for', ids);
          return { constraint: it.slot!.constraintId, opens: isoRange(opens), shareInFirstSlot: share((i) => idx[i] === 0) };
        })()
      : null;
    paths.push({
      id: `parts:${it.item}`, kind: 'parts', label: `${it.item} in the building`, day, date: isoRange(day), criticalShare: share((i) => t.critical[i] === k && !t.floored[i]),
      ...(it.supplier ? { supplier: it.supplier } : {}), slot,
    });
  });
  if (sched.floor) {
    const fl = book.stat(t.cutIn, dayAt(at.cutIn), `the day S/N ${sched.floor.serial - 1} is planned to complete: the old stock is used up`, [sched.floor.id, `volume:${sched.program}`]);
    paths.push({ id: 'stock', kind: 'stock', label: 'Old stock used up', day: fl, date: isoRange(fl), criticalShare: share((i) => t.floored[i] === 1) });
  }

  // What a reader should look at.
  const flags: Flag[] = [...book.flags];
  const planEnd = sched.table.days.length ? sched.table.days[sched.table.days.length - 1] : -Infinity;
  if (cutDay.p50 > planEnd) flags.push({ kind: 'cut_in_beyond_plan', severity: 'warn', ref: ecr.id, message: `The median cut-in (${dateOf(cutDay.p50)}) is beyond the volume plan, so no serial is planned to take the change by then.` });
  if (late && late.probability >= 0.5) {
    flags.push({ kind: 'likely_late', severity: 'warn', ref: sched.stated.id, message: `${ecr.id} states ${sched.stated.label}; the change can first reach the line ${late.weeks.p50} weeks after it (P10 ${late.weeks.p10}, P90 ${late.weeks.p90}), in ${Math.round(late.probability * 100)}% of draws.` });
  }
  sched.items.forEach((it, k) => {
    if (!it.slot) return;
    const past = share((i) => t.slotIndex[k][i] >= it.slot!.published);
    if (past > 0) flags.push({ kind: 'beyond_published_slots', severity: 'warn', ref: it.item, message: `${it.item}: in ${Math.round(past * 100)}% of draws the decision falls after the last published slot, so the order waits for a slot nobody has announced.` });
  });
  flags.push(...book.unusedFlags());

  return {
    check: 's3_timeline',
    codeVersion: CHECKS_CODE_VERSION,
    ecr: ecr.id,
    program: ecr.program,
    seed: options.seed,
    draws: sim.n,
    correlation: rho,
    filed: ecr.filedOn,
    stated: { basis: sched.stated.basis, label: sched.stated.label, date: statedDay === null ? null : dateOf(statedDay), serial: sched.stated.serial },
    decision: { day: decision, date: isoRange(decision) },
    cutIn: { day: cutDay, date: isoRange(cutDay), weeksFromFiling: cutWeeks, serial },
    late,
    paths,
    convergence: sim.convergence,
    flags,
    inputs: [...book.reg.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
