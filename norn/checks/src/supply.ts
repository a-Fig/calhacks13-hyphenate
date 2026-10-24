// S4, supply (ARCHITECTURE.md section 5): what the change asks of its suppliers. For each part the
// change brings in: who else could supply it, how long the supplier takes, and what a year of
// production at the new price spends. For the ECR as a whole: the chance the change misses the
// effectivity it states, and how much of a supplier's capacity it takes.
//
// The headline numbers treat the ECR alone. Other open ECRs that buy from the same supplier are passed
// in as `peers`, and the result then also says what changes when both are open: a qualification slot
// takes one lot, so the later ECR waits for the next slot, while two part numbers qualified close
// together earn the supplier's bundle terms. That comparison is a what-if on the same draws, so the
// two sides differ only by the other ECR.

import type { Draws } from './sim.ts';
import { hash128 } from './random.ts';
import { pert } from './dist.ts';
import {
  type Convergence, type PlanOptions, type Schedule, type Stat, type Timing, Book, evaluateSchedules,
  gatherSchedule, isoRange, mergePlanDefaults, r4, simulate, unitsNextYear, WEEK,
} from './plan.ts';
import { dateOf } from './time.ts';
import { type Baseline, type ChangeRequest, type Flag, type InputRecord, type ItemCode, type ProgramId, CHECKS_CODE_VERSION } from './types.ts';
import type { DateRange } from './timeline.ts';

export interface SupplyCheckOptions extends PlanOptions {
  /** The other open ECRs. Those that buy from a supplier this one buys from are compared with it. */
  peers?: ChangeRequest[];
}

export interface SupplyPart {
  item: ItemCode;
  name: string;
  supplier: string | null;
  /** Suppliers that could supply this revision. */
  sources: string[];
  singleSource: boolean;
  leadFrom: 'quote' | 'sourcing' | 'default';
  quoteId: string | null;
  leadWeeks: Stat;
  /** Parts per finished unit of the ECR's program, and the quoted unit price. */
  perUnit: number;
  price: number | null;
  slot: { constraint: string; opens: DateRange } | null;
}

export interface CapacityResult {
  constraint: string;
  supplier: string;
  items: ItemCode[];
  capacityPerYear: number;
  window: { from: string; to: string } | null;
  /** Demand in the 12 months from the cut-in, as a share of a year's capacity: this ECR alone, then with the peers. */
  utilization: Stat;
  utilizationWithPeers: Stat | null;
}

export interface PeerRef {
  ecr: string;
  program: ProgramId;
  filedOn: string;
  /** Suppliers it shares with this ECR. */
  sharedSuppliers: string[];
  /** A hash of the peer change request's content, so a result names the revision it compared against. */
  contentHash: string;
}

export interface BundleResult {
  constraint: string;
  withinWeeks: number;
  /** Share of draws in which this ECR's part number is qualified within the window of another's. */
  probabilityBundled: number;
  /** What this ECR gains: its qualification discount if it is the later one, and its raw-material price break. */
  ownSaving: Stat;
  /** What every ECR in the bundle gains together. */
  pairSaving: Stat;
}

export interface Interaction {
  peers: PeerRef[];
  /** The day the change can first reach the line: alone, with the peers, and the shift between them. */
  cutIn: { alone: Stat; withPeers: Stat; shiftWeeks: Stat; probabilityLater: number };
  /** Against the stated effectivity, with the peers. */
  late: { weeks: Stat; probability: number } | null;
  slots: { constraint: string; item: ItemCode; alone: DateRange; withPeers: DateRange; peers: { ecr: string; item: ItemCode; opens: DateRange }[] }[];
  bundles: BundleResult[];
}

export interface SupplyResult {
  check: 's4_supply';
  codeVersion: string;
  ecr: string;
  program: ProgramId;
  seed: string;
  draws: number;
  correlation: number;
  stated: { basis: string; label: string; date: string | null; serial: number | null };
  parts: SupplyPart[];
  singleSourceItems: ItemCode[];
  /** The chance the change misses the effectivity it states, ECR alone. Null when the ECR states none the plan can place. */
  missEffectivity: { probability: number; weeks: Stat } | null;
  /** What a year of production of the changed parts spends from the cut-in, at the quoted prices. */
  spend: { yearOne: Stat; singleSourceYearOne: Stat };
  capacity: CapacityResult[];
  /** Null when no peer shares a supplier with this ECR. */
  interaction: Interaction | null;
  /** Peers passed in that share no supplier with this ECR, and so were left out. */
  unrelatedPeers: string[];
  convergence: Convergence;
  flags: Flag[];
  inputs: InputRecord[];
}

const contentHash = (x: unknown) => hash128(JSON.stringify(x)).map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');

/** Run S4 on one ECR. Pure and deterministic in (baseline, ecr, peers, options). */
export function supplyCheck(baseline: Baseline, ecr: ChangeRequest, options: SupplyCheckOptions): SupplyResult {
  if (!options.seed) throw new Error("supplyCheck needs a seed: the deployment's configured seed");
  const n0 = options.draws ?? 10_000;
  const rho = options.correlation ?? 0.3;
  const tol = options.convergenceTolerance ?? 0.01;
  const D = mergePlanDefaults(options.defaults);
  const book = new Book(options.assumptions ?? [], D);
  const where = { baseline: options.provenance?.baseline ?? 'the baseline', changeRequest: options.provenance?.changeRequest ?? 'the change request' };
  const sched = gatherSchedule(book, baseline, ecr, where);
  const statedDay = sched.stated.day;
  const suppliersOf = (s: Schedule) => new Set(s.items.map((i) => i.supplier).filter((x): x is string => !!x));
  const mine = suppliersOf(sched);

  // Peers that buy from a supplier this ECR buys from. A scratch book decides, so an unrelated peer registers no inputs.
  const peerList = [...new Map((options.peers ?? []).filter((p) => p.id !== ecr.id).map((p) => [p.id, p])).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const related: { ecr: ChangeRequest; sched: Schedule; shared: string[] }[] = [];
  const unrelatedPeers: string[] = [];
  for (const p of peerList) {
    const probe = gatherSchedule(new Book([], D), baseline, p, { baseline: where.baseline, changeRequest: `the open change request ${p.id}` });
    const shared = [...suppliersOf(probe)].filter((s) => mine.has(s)).sort();
    if (shared.length === 0) {
      unrelatedPeers.push(p.id);
      continue;
    }
    related.push({ ecr: p, sched: gatherSchedule(book, baseline, p, { baseline: where.baseline, changeRequest: `the open change request ${p.id}` }), shared });
  }
  const group = [sched, ...related.map((r) => r.sched)];

  // What a year of production of each changed part spends, at the quoted price.
  for (const s of group) for (const it of s.items) {
    if (it.price !== null) book.input({ id: `price:${s.ecr.id}:${it.item}`, label: `${s.ecr.id}: quoted unit price of ${it.item}`, source: 'given', value: it.price, ref: it.quoteId ? `supplier quote ${it.quoteId}` : `${where.baseline}: item master` });
  }
  const qualIds = new Map<string, string>();
  for (const s of group) for (const [item, amount] of s.qualification) {
    qualIds.set(`${s.ecr.id}:${item}`, book.input({ id: `qualification:${s.ecr.id}:${item}`, label: `${s.ecr.id}: qualification lot for ${item}`, source: 'given', value: amount, ref: `supplier quote lines on ${s.ecr.id} that name qualification` }));
  }
  // The raw-material share a price break applies to: nobody has stated it, so it is a flagged default.
  const bundleConstraints = (baseline.supplierConstraints ?? []).filter((c) => c.kind === 'qualification_slot' && related.length > 0);
  const usesBundle = bundleConstraints.some((c) => {
    const holders = group.filter((s) => s.items.some((it) => it.slot?.constraintId === c.id));
    return holders.length > 1 && holders.some((s) => s === sched) && holders[0].items.some((it) => it.slot?.terms.bundle);
  });
  const rawVar = usesBundle
    ? book.variable({
        id: 'plan:rawMaterialShare', label: 'Share of a part\'s price that a raw-material price break applies to', source: 'default', needsEstimate: true,
        dist: pert(D.rawMaterialShare.min, D.rawMaterialShare.mode, D.rawMaterialShare.max),
        ref: book.defaultInput('rawMaterialShare', 'Raw-material share of price', `${D.rawMaterialShare.min} to ${D.rawMaterialShare.max}, most likely ${D.rawMaterialShare.mode}`),
        rationale: 'The share of a part\'s price that a raw-material price break applies to, PERT(40%, 60%, 80%). Nobody has stated it, so it needs an estimate (Norn default).',
      })
    : null;
  if (rawVar) book.flags.push({ kind: 'needs_estimate', severity: 'warn', ref: rawVar, message: 'The raw-material share of a part\'s price is a default; a buyer should estimate it. It scales the price break the bundle earns.' });

  const capacityConstraints = (baseline.supplierConstraints ?? []).filter(
    (c) => c.kind === 'capacity' && (c.capacityPerYear ?? 0) > 0 && sched.items.some((it) => c.items.includes(it.item) && (!it.supplier || it.supplier === c.supplier)),
  );
  for (const c of capacityConstraints) book.input({ id: `constraint:${c.id}`, label: `${c.id}: ${c.supplier} capacity`, source: 'given', value: c.capacityPerYear, ref: `${where.baseline}: supplier constraint ${c.id}${c.window ? `, ${c.window.from} to ${c.window.to}` : ''}` });

  // ---- per-draw quantities
  const spendOf = (s: Schedule, t: Timing, n: number, only?: (k: number) => boolean) => {
    const out = new Float64Array(n);
    s.items.forEach((it, k) => {
      if (it.price === null || (only && !only(k))) return;
      for (let i = 0; i < n; i++) out[i] += it.perUnit * it.price * unitsNextYear(s.table, t.cutIn[i]);
    });
    return out;
  };
  const lateOf = (t: Timing) => {
    const out = new Float64Array(t.cutIn.length);
    for (let i = 0; i < out.length; i++) out[i] = (t.cutIn[i] - statedDay!) / WEEK;
    return out;
  };
  const compute = (d: Draws) => ({
    d,
    alone: evaluateSchedules([sched], d, false)[0],
    joint: related.length ? evaluateSchedules(group, d, true) : null,
  });
  const sim = simulate(
    book,
    { seed: options.seed, n0, maxDraws: Math.max(n0, options.maxDraws ?? 4 * n0), rho, tol },
    compute,
    (r) => {
      const n = r.d.n;
      const weeks = (t: Timing) => {
        const w = new Float64Array(n);
        for (let i = 0; i < n; i++) w[i] = (t.cutIn[i] - sched.filedDay) / WEEK;
        return w;
      };
      return {
        cutInWeeks: weeks(r.alone),
        spendYearOne: spendOf(sched, r.alone, n),
        ...(r.joint ? { cutInWeeksWithPeers: weeks(r.joint[0]) } : {}),
      };
    },
  );
  const { d, alone, joint } = sim.result;
  const n = d.n;
  const pd = book.pointDraws();
  const atAlone = evaluateSchedules([sched], pd, false)[0];
  const atJoint = related.length ? evaluateSchedules(group, pd, true) : null;
  const share = (pred: (i: number) => boolean) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (pred(i)) c++;
    return r4(c / n);
  };
  const baseUses = sched.uses;

  // ---- the parts
  const parts: SupplyPart[] = sched.items.map((it, k) => {
    const lead = d.values.get(it.leadVar)!;
    const leadPoint = pd.values.get(it.leadVar)![0];
    const opens = it.slot ? book.stat(alone.placed[k], atAlone.placed[k][0], 'the slot the order waits for', [`ecr:${ecr.id}:filed`, sched.decisionVar, `constraint:${it.slot.constraintId}`, `constraint:${it.slot.constraintId}:terms`]) : null;
    return {
      item: it.item, name: it.name, supplier: it.supplier ?? null, sources: it.sources, singleSource: it.sources.length <= 1, leadFrom: it.leadFrom, quoteId: it.quoteId ?? null,
      leadWeeks: book.stat(lead, leadPoint, `${it.item}: weeks from order to parts in (${it.leadFrom === 'quote' ? 'the quoted lead time, spread by the supplier\'s record' : it.leadFrom === 'sourcing' ? 'the supplier\'s record' : 'a default'})`, [it.leadVar]),
      perUnit: it.perUnit, price: it.price,
      slot: it.slot && opens ? { constraint: it.slot.constraintId, opens: isoRange(opens) } : null,
    };
  });
  const singleSourceItems = parts.filter((p) => p.singleSource).map((p) => p.item);

  // ---- lateness against the stated effectivity, ECR alone
  let missEffectivity: SupplyResult['missEffectivity'] = null;
  if (statedDay !== null) {
    const w = lateOf(alone);
    missEffectivity = {
      probability: share((i) => w[i] > 0),
      weeks: book.stat(w, (atAlone.cutIn[0] - statedDay) / WEEK, '(cut-in day − the day the stated effectivity is planned) / 7; positive is late', [...baseUses, sched.stated.id]),
    };
  }

  // ---- spend
  const spendIds = (s: Schedule) => [...s.uses, ...s.items.filter((it) => it.price !== null).map((it) => `price:${s.ecr.id}:${it.item}`)];
  const spendFormula = 'Σ changed parts: parts per finished unit × quoted unit price × planned units completed in the 365 days from the cut-in';
  const singleSourceIdx = (k: number) => sched.items[k].sources.length <= 1;
  const spend = {
    yearOne: book.stat(spendOf(sched, alone, n), spendOf(sched, atAlone, 1)[0], spendFormula, spendIds(sched)),
    singleSourceYearOne: book.stat(spendOf(sched, alone, n, singleSourceIdx), spendOf(sched, atAlone, 1, singleSourceIdx)[0], `${spendFormula}, for the parts with one qualified source`, spendIds(sched)),
  };

  // ---- capacity
  const utilization = (c: (typeof capacityConstraints)[number], t: (s: Schedule) => Timing, at: boolean, ids: Schedule[]) => {
    const total = new Float64Array(at ? 1 : n);
    for (const s of ids) {
      const tt = t(s);
      for (const it of s.items) {
        if (!c.items.includes(it.item) || (it.supplier && it.supplier !== c.supplier)) continue;
        for (let i = 0; i < total.length; i++) total[i] += (it.perUnit * unitsNextYear(s.table, tt.cutIn[i])) / c.capacityPerYear!;
      }
    }
    return total;
  };
  const capacity: CapacityResult[] = capacityConstraints.map((c) => {
    const ids = [...baseUses, `constraint:${c.id}`];
    const formula = `Σ ECRs: parts per finished unit × planned units completed in the 365 days from the cut-in, as a share of ${c.capacityPerYear} a year`;
    return {
      constraint: c.id, supplier: c.supplier, items: c.items.filter((x) => sched.items.some((it) => it.item === x)), capacityPerYear: c.capacityPerYear!, window: c.window ?? null,
      utilization: book.stat(utilization(c, () => alone, false, [sched]), utilization(c, () => atAlone, true, [sched])[0], formula.replace('Σ ECRs', 'this ECR'), ids, 4),
      utilizationWithPeers: joint && atJoint
        ? book.stat(
            utilization(c, (s) => joint[group.indexOf(s)], false, group.filter((s) => s === sched || s.items.some((it) => c.items.includes(it.item)))),
            utilization(c, (s) => atJoint[group.indexOf(s)], true, group.filter((s) => s === sched || s.items.some((it) => c.items.includes(it.item))))[0],
            formula, [...ids, ...related.flatMap((r) => r.sched.uses)], 4)
        : null,
    };
  });

  // ---- the interaction with the peers
  let interaction: Interaction | null = null;
  if (joint && atJoint) {
    const me = joint[0];
    const meAt = atJoint[0];
    const shift = new Float64Array(n);
    for (let i = 0; i < n; i++) shift[i] = (me.cutIn[i] - alone.cutIn[i]) / WEEK;
    const peerUses = related.flatMap((r) => r.sched.uses);
    const ids = [...baseUses, ...peerUses];
    const cutAlone = book.stat(alone.cutIn, atAlone.cutIn[0], 'the day the change can first reach the line, this ECR alone', baseUses);
    const cutWith = book.stat(me.cutIn, meAt.cutIn[0], 'the day the change can first reach the line when the open ECRs that share a supplier are filed ahead of it in the supplier\'s slots', ids);
    const shiftStat = book.stat(shift, (meAt.cutIn[0] - atAlone.cutIn[0]) / WEEK, '(cut-in day with the peers − cut-in day alone) / 7, on the same draws', ids);
    const slots: Interaction['slots'] = [];
    sched.items.forEach((it, k) => {
      if (!it.slot) return;
      const peers: Interaction['slots'][number]['peers'] = [];
      related.forEach((r, ri) => r.sched.items.forEach((pit, pk) => {
        if (pit.slot?.constraintId === it.slot!.constraintId) {
          peers.push({ ecr: r.ecr.id, item: pit.item, opens: isoRange(book.stat(joint[ri + 1].placed[pk], atJoint[ri + 1].placed[pk][0], 'the slot the peer\'s order waits for', [...r.sched.uses])) });
        }
      }));
      slots.push({
        constraint: it.slot.constraintId, item: it.item,
        alone: isoRange(book.stat(alone.placed[k], atAlone.placed[k][0], 'the slot the order waits for, alone', baseUses)),
        withPeers: isoRange(book.stat(me.placed[k], meAt.placed[k][0], 'the slot the order waits for, with the peers', ids)),
        peers,
      });
    });
    // Bundle terms: a second part number qualified within the window of the first, and a price break for ordering both.
    const bundles: BundleResult[] = [];
    for (const c of bundleConstraints) {
      const holders = group.map((s, gi) => ({ s, gi })).filter(({ s }) => s.items.some((it) => it.slot?.constraintId === c.id));
      const terms = holders.flatMap(({ s }) => s.items.map((it) => it.slot).filter((x) => x?.constraintId === c.id))[0]?.terms.bundle;
      if (holders.length < 2 || !holders.some(({ s }) => s === sched) || !terms) continue;
      const w = terms.withinWeeks * WEEK;
      const start = (gi: number, i: number, tt: Timing[]) => {
        const s = group[gi];
        const k = s.items.findIndex((it) => it.slot?.constraintId === c.id);
        return tt[gi].placed[k][i];
      };
      const savingOf = (gi: number, i: number, tt: Timing[], raw: number): number => {
        const mine = start(gi, i, tt);
        let near = false;
        let later = false;
        for (const h of holders) {
          if (h.gi === gi) continue;
          const other = start(h.gi, i, tt);
          if (Math.abs(other - mine) <= w) {
            near = true;
            if (other < mine || (other === mine && h.gi < gi)) later = true;
          }
        }
        if (!near) return 0;
        const s = group[gi];
        let out = 0;
        s.items.forEach((it, k) => {
          if (it.slot?.constraintId !== c.id) return;
          if (later) out += terms.secondQualificationDiscount * (s.qualification.get(it.item) ?? 0);
          if (it.price !== null) out += terms.priceBreak * raw * it.perUnit * it.price * unitsNextYear(s.table, tt[gi].cutIn[i]);
        });
        return out;
      };
      const rawDraws = rawVar ? d.values.get(rawVar)! : new Float64Array(n);
      const rawPoint = rawVar ? pd.values.get(rawVar)![0] : 0;
      const own = new Float64Array(n);
      const pair = new Float64Array(n);
      let bundled = 0;
      for (let i = 0; i < n; i++) {
        own[i] = savingOf(0, i, joint, rawDraws[i]);
        for (const h of holders) pair[i] += savingOf(h.gi, i, joint, rawDraws[i]);
        if (own[i] > 0) bundled++;
      }
      const ownPoint = savingOf(0, 0, atJoint, rawPoint);
      const pairPoint = holders.reduce((a, h) => a + savingOf(h.gi, 0, atJoint, rawPoint), 0);
      const bundleIds = [...ids, `constraint:${c.id}`, `constraint:${c.id}:terms`, ...(rawVar ? [rawVar] : []), ...[...qualIds.values()], ...group.flatMap((s) => s.items.filter((it) => it.price !== null).map((it) => `price:${s.ecr.id}:${it.item}`))];
      bundles.push({
        constraint: c.id, withinWeeks: terms.withinWeeks, probabilityBundled: r4(bundled / n),
        ownSaving: book.stat(own, ownPoint, `this ECR's saving when its part number is qualified within ${terms.withinWeeks} weeks of another's: ${terms.secondQualificationDiscount * 100}% off its qualification lot if it is the later one, plus ${terms.priceBreak * 100}% × the raw-material share × its year-one spend`, bundleIds),
        pairSaving: book.stat(pair, pairPoint, 'the same saving summed over every ECR in the bundle', bundleIds),
      });
    }
    let lateWith: Interaction['late'] = null;
    if (statedDay !== null) {
      const w = lateOf(me);
      lateWith = {
        weeks: book.stat(w, (meAt.cutIn[0] - statedDay) / WEEK, '(cut-in day with the peers − the day the stated effectivity is planned) / 7; positive is late', [...ids, sched.stated.id]),
        probability: share((i) => w[i] > 0),
      };
    }
    interaction = {
      peers: related.map((r) => ({ ecr: r.ecr.id, program: r.ecr.program, filedOn: r.ecr.filedOn, sharedSuppliers: r.shared, contentHash: contentHash(r.ecr) })),
      cutIn: { alone: cutAlone, withPeers: cutWith, shiftWeeks: shiftStat, probabilityLater: share((i) => shift[i] > 1e-9) },
      late: lateWith,
      slots,
      bundles,
    };
  }

  // ---- what a reader should look at
  const flags: Flag[] = [...book.flags];
  for (const p of parts) {
    if (p.singleSource) {
      flags.push({
        kind: 'single_source', severity: 'warn', ref: p.item,
        message: `${p.item} has one qualified source${p.supplier ? ` (${p.supplier})` : ''}. Its lead time is ${p.leadWeeks.p50} weeks (P10 ${p.leadWeeks.p10}, P90 ${p.leadWeeks.p90}) and a second source would need its own qualification.`,
      });
    }
    if (p.price === null) flags.push({ kind: 'no_price', severity: 'warn', ref: p.item, message: `${p.item}: no quote or item master gives a price, so its spend is left out.` });
  }
  if (missEffectivity && missEffectivity.probability >= 0.5) {
    flags.push({ kind: 'likely_late', severity: 'warn', ref: sched.stated.id, message: `${ecr.id} states ${sched.stated.label}; the chance the supply misses it is ${Math.round(missEffectivity.probability * 100)}%, by ${missEffectivity.weeks.p50} weeks at the median.` });
  }
  for (const c of capacity) {
    const u = c.utilizationWithPeers ?? c.utilization;
    if (u.p90 > 1) flags.push({ kind: 'capacity_exceeded', severity: 'warn', ref: c.constraint, message: `${c.constraint}: demand in the first year after the cut-in reaches ${Math.round(u.p90 * 100)}% of ${c.supplier}'s annual capacity at P90.` });
    else if (u.p50 > 0.8) flags.push({ kind: 'capacity_tight', severity: 'info', ref: c.constraint, message: `${c.constraint}: demand in the first year takes ${Math.round(u.p50 * 100)}% of ${c.supplier}'s annual capacity at the median.` });
  }
  if (interaction) {
    flags.push({ kind: 'shared_supplier', severity: 'info', message: `${ecr.id} shares ${[...new Set(related.flatMap((r) => r.shared))].join(', ')} with ${related.map((r) => r.ecr.id).join(', ')}.` });
    if (interaction.cutIn.probabilityLater >= 0.5) {
      flags.push({ kind: 'slot_contention', severity: 'warn', message: `With ${interaction.peers.map((p) => p.ecr).join(', ')} filed ahead, ${ecr.id} waits for a later qualification slot: its cut-in moves ${interaction.cutIn.shiftWeeks.p50} weeks at the median.` });
    }
  }
  flags.push(...book.unusedFlags());

  return {
    check: 's4_supply',
    codeVersion: CHECKS_CODE_VERSION,
    ecr: ecr.id,
    program: ecr.program,
    seed: options.seed,
    draws: n,
    correlation: rho,
    stated: { basis: sched.stated.basis, label: sched.stated.label, date: statedDay === null ? null : dateOf(statedDay), serial: sched.stated.serial },
    parts,
    singleSourceItems,
    missEffectivity,
    spend,
    capacity,
    interaction,
    unrelatedPeers,
    convergence: sim.convergence,
    flags,
    inputs: [...book.reg.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

