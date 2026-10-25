// Writes docs/PROOF.md: Norn's checks run on Bowman's planted scenarios, each expectation compared with
// what the code produced. Offline, seeded, deterministic: a second run writes the same file.
//
//   node norn/checks/proof.ts               from the repo root; runs the test suites too (about 40 s)
//   node norn/checks/proof.ts --skip-tests  leaves the test counts as "not run" and writes to the temp directory, never docs/PROOF.md
//
// What the script reads: Bowman's dataset (bowman/data), Norn's checks (norn/checks/src), Norn's routing
// and decision rules (norn/config/src) and Bowman's configuration (bowman/norn-config). It reaches no
// network service. Every expectation comes from the dataset's own answer key (bowman/data/scenarios.ts)
// or its comments, quoted in the table. Nothing here changes a check; a result that contradicts the
// expectation is written as FAIL.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bowman } from '../../bowman/data/index.ts';
import { bomDelta, costCheck, supplyCheck, timelineCheck } from './src/index.ts';
import { costForecastFromCheck, decideAction, loadConfigFile, routeEcr, formatIssue } from '../config/src/index.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED = 'norn-seed-1'; // the seed the workers use (norn/workers/src/checks-*.ts)
const skipTests = process.argv.includes('--skip-tests');
// A partial run (no test counts) never overwrites the page in the repository; it writes to the OS temp directory instead.
const OUT = skipTests ? join(tmpdir(), 'PROOF.skip-tests.md') : join(ROOT, 'docs/PROOF.md');

// ---------------------------------------------------------------- bookkeeping

type Status = 'PASS' | 'FAIL' | 'NOT BUILT';
interface Row { id: string; what: string; expected: string; actual: string; status: Status }
const rows: Row[] = [];
const scenarioTitles = new Map<string, string>();
function expect(id: string, what: string, expected: string, actual: string, ok: boolean | 'not built') {
  rows.push({ id, what, expected, actual, status: ok === 'not built' ? 'NOT BUILT' : ok ? 'PASS' : 'FAIL' });
}

const num = (x: number, d = 0) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (x: number, d = 0) => (x < 0 ? '-$' : '$') + num(Math.abs(x), d);
const range = (r: { p10: number; p50: number; p90: number }, f: (x: number) => string) => `${f(r.p50)} (P10 ${f(r.p10)}, P90 ${f(r.p90)})`;
const within = (x: number, r: { p10: number; p90: number }) => x >= Math.min(r.p10, r.p90) && x <= Math.max(r.p10, r.p90);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const ecr = (id: string) => {
  const e = bowman.ecrs.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id} in the dataset`);
  return e;
};
const keyOf = (id: string) => bowman.demoScenarios.find((s) => s.id === id)!;
const check = (id: string, extra: object = {}) => costCheck(bowman, ecr(id), { seed: SEED, ...extra });

// ---------------------------------------------------------------- the counts

function run(cmd: string[], cwd: string): { out: string; code: number } {
  const r = spawnSync(process.execPath, cmd, { cwd: join(ROOT, cwd), encoding: 'utf8', maxBuffer: 64 << 20 });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? 1 };
}

const validator = run(['check.ts'], 'bowman/data');
const checksLine = /(\d+) checks, (\d+) failed/.exec(validator.out);
const provLine = /Provenance sourced\/total: (.*)/.exec(validator.out);
const asOf = /as of (\S+)/.exec(validator.out)?.[1] ?? 'unknown';
if (!checksLine || !provLine) throw new Error(`could not read the validator output:\n${validator.out.slice(-600)}`);
const provRows = provLine[1]!.split(', ').map((p) => {
  const m = /^(.+?) (\d+)\/(\d+)$/.exec(p.trim())!;
  return { kind: m[1]!, sourced: Number(m[2]), total: Number(m[3]) };
});
const sourced = provRows.reduce((n, r) => n + r.sourced, 0);
const total = provRows.reduce((n, r) => n + r.total, 0);

function tests(cwd: string, glob: string[]): string {
  if (skipTests) return 'not run (--skip-tests)';
  const r = run(['--test', '--test-reporter=tap', ...glob], cwd);
  const n = (k: string) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(r.out)?.[1] ?? NaN);
  if (Number.isNaN(n('tests'))) return `could not read the test output (exit ${r.code})`;
  return `${n('pass')} passed, ${n('fail')} failed of ${n('tests')}`;
}
const checksTests = tests('norn/checks', ['test/*.test.ts']);
const configTests = tests('norn/config', ['test/*.test.ts']);

const loaded = await loadConfigFile(join(ROOT, 'bowman/norn-config/bowman.config.ts'));
if (!loaded.ok) throw new Error(`Bowman's configuration does not load:\n${loaded.issues.map(formatIssue).join('\n')}`);
const config = loaded.config;

// ---------------------------------------------------------------- S1: ECR-0417, the worked example

scenarioTitles.set('S1', keyOf('S1').title);
{
  const c: any = check('ECR-0417', { measures: [{ horizonMonths: 12, savingsOffset: false }] });
  const key: any = keyOf('S1').reference;
  const h = c.headline;
  const ves = h.unitCostDelta.find((u: any) => u.program === 'vesper').perUnit;
  const mer = h.unitCostDelta.find((u: any) => u.program === 'meridian').perUnit;
  expect('S1', 'Vesper cost change per aircraft, 12 brackets at +$34.60', usd(key.steadyStateDeltaPerAircraftUsd, 2),
    `point ${usd(ves.point, 2)}; ${range(ves, (x) => usd(x, 2))}`, near(ves.point, key.steadyStateDeltaPerAircraftUsd, 0.01));
  expect('S1', 'Meridian also moves: 8 brackets per aircraft at +$34.60', usd(34.6 * 8, 2),
    `point ${usd(mer.point, 2)}; ${range(mer, (x) => usd(x, 2))}`, near(mer.point, 34.6 * 8, 0.01));
  const oneTimeKey = key.oneTimeTotalUsd + key.firstLotPremiumUsd;
  expect('S1', 'One-time total with the first-lot premium as its own row', usd(oneTimeKey, 2) + ' (key, inside the simulated range)',
    `point ${usd(h.oneTimeTotal.point, 2)}; ${range(h.oneTimeTotal, usd)}`, within(oneTimeKey, h.oneTimeTotal) && near(h.oneTimeTotal.point, oneTimeKey, 1));
  const inv = c.inventory[0];
  const scrapKey = key.scrapNetOfSalvageUsd + key.cancellationChargeUsd;
  expect('S1', 'Scrap of stores, WIP, supplier-finished and installed brackets, plus the cancellation charge', usd(scrapKey, 2) + ' (key, inside the simulated range)',
    range(inv.total, usd), within(scrapKey, inv.total));
  expect('S1', 'No use-up: Rev B failed fatigue', 'no stock row with disposition use-up',
    inv.rows.map((r: any) => `${r.location}:${r.disposition}`).join(', '), inv.rows.every((r: any) => !String(r.disposition).startsWith('use')));
  const blanks = c.flags.filter((f: any) => /was left blank/.test(f.message)).map((f: any) => f.message);
  expect('S1', 'The originator left the delay cost of holding S/N 011-014 blank, and the check says so', 'a flag naming the delay-cost row',
    `${blanks.length} blank-row flags; delay cost flagged: ${blanks.some((m: string) => /Delay cost/.test(m))}`, blanks.some((m: string) => /Delay cost/.test(m)));
  const b: any = bomDelta(bowman, ecr('ECR-0417'));
  expect('S1', 'The bracket is also in Meridian: two programs, one supplier (Halden, single source)', 'programs vesper and meridian; supplier SUP-HALDEN',
    `programs ${b.affected.programs.join(', ')}; suppliers ${b.affected.suppliers.join(', ')}`,
    ['vesper', 'meridian'].every((p) => b.affected.programs.includes(p)) && b.affected.suppliers.join() === 'SUP-HALDEN');
  const sup: any = supplyCheck(bowman, ecr('ECR-0417'), { seed: SEED });
  expect('S1', 'Single-source flag on the bracket', 'BW-5120-210 single source',
    `single-source items: ${sup.singleSourceItems.join(', ')}`, sup.singleSourceItems.includes('BW-5120-210'));
  const t: any = timelineCheck(bowman, ecr('ECR-0417'), { seed: SEED });
  expect('S1', 'S/N 011-014 wait about 14 weeks (we accept 11 to 17)', 'weeks late against the stated S/N 11',
    `${range(t.late.weeks, (x) => num(x, 1))} weeks; cut-in S/N ${t.cutIn.serial.p50}`, t.late.weeks.p50 >= 11 && t.late.weeks.p50 <= 17);
  expect('S1', 'Applies cleanly to the baseline', 'no BOM conflicts', `${b.conflicts.length} conflicts`, b.ok);
}

// ---------------------------------------------------------------- S2: ECR-0409

scenarioTitles.set('S2', keyOf('S2').title);
{
  const c: any = check('ECR-0409');
  const key: any = keyOf('S2').reference;
  const ves = c.headline.unitCostDelta.find((u: any) => u.program === 'vesper').perUnit;
  expect('S2', 'Material change per aircraft: +$1,440 per propeller, 6 propellers', usd(key.unitCostDeltaPerAircraftUsd),
    `point ${usd(ves.point, 2)}; ${range(ves, usd)}`, near(ves.point, key.unitCostDeltaPerAircraftUsd, 0.01));
  const oneTimeKey = key.toolingUsd + key.engineeringUsd;
  expect('S2', 'One-time cost dominates: $500,000 tooling plus $650,000 engineering', usd(oneTimeKey),
    `point ${usd(c.headline.oneTimeTotal.point)}; ${range(c.headline.oneTimeTotal, usd)}`, near(c.headline.oneTimeTotal.point, oneTimeKey, 1));
  expect('S2', 'One-time cost is larger than a year of recurring change', 'one-time P50 above the first-year recurring P50',
    `${usd(c.headline.oneTimeTotal.p50)} against ${usd(c.headline.recurringWindow.p50)}`, c.headline.oneTimeTotal.p50 > c.headline.recurringWindow.p50);
  const b: any = bomDelta(bowman, ecr('ECR-0409'));
  expect('S2', 'Meridian is unaffected (its own lift rotors)', 'programs: vesper only', `programs: ${b.affected.programs.join(', ')}`, b.affected.programs.join() === 'vesper');
  const t: any = timelineCheck(bowman, ecr('ECR-0409'), { seed: SEED });
  const sn = t.cutIn.serial;
  expect('S2', 'Earliest realistic cut-in is S/N 34 (December 2027), set by certification, not tooling', 'cut-in serial P50 of 34 or later',
    `S/N ${sn.p50} (P10 ${sn.p10}, P90 ${sn.p90}); the timeline models decision and parts lead times, not certification`, sn.p50 >= 34);
}

// ---------------------------------------------------------------- S3: ECR-0423, the fast track

scenarioTitles.set('S3', keyOf('S3').title);
{
  const c: any = check('ECR-0423', { measures: [{ horizonMonths: 12, savingsOffset: false }] });
  const key: any = keyOf('S3').reference;
  const ves = c.headline.unitCostDelta.find((u: any) => u.program === 'vesper').perUnit;
  expect('S3', 'Saves $1.90 per panel, $11.40 per aircraft', usd(-key.savingPerAircraftUsd, 2), `point ${usd(ves.point, 2)}; ${range(ves, (x) => usd(x, 2))}`, near(ves.point, -key.savingPerAircraftUsd, 0.01));
  expect('S3', 'Use up existing stock: no disposition cost', 'one-time total of $0', `one-time ${usd(c.headline.oneTimeTotal.p50)}`, c.headline.oneTimeTotal.p50 === 0 && c.headline.oneTimeTotal.p90 === 0);

  // The facts a classifier would supply do not exist yet (norn/config/test/route.test.ts says the same). The
  // yes/no answers below are set here from the dataset's own scenario notes. The company and regulatory classes are
  // taken as given from the dataset (companyClass, faaClass); routing places them, it does not infer them.
  const answers = {
    safety_part: false, interchangeability_or_interface: false, retrofit_of_delivered_units: false, supplier_process_or_tooling: false,
    no_form_fit_function_change: true, same_supplier_no_tooling: true, authorized_equivalent: true, obsolescence_replacement: false, documentation_fix: false,
  };
  const t: any = timelineCheck(bowman, ecr('ECR-0423'), { seed: SEED });
  const slipP90Days = t.late === null ? 0 : Math.max(0, Math.round(t.late.weeks.p90 * 7));
  const e = ecr('ECR-0423');
  const facts = {
    ecrId: 'ECR-0423', cost: { ...costForecastFromCheck(c), measured: c.measures[0] }, classes: { company: e.companyClass, regulatory: e.faaClass },
    answers, slipP90Days, reportLevel: 1 as const,
  };
  const route = routeEcr(config, facts);
  expect('S3', 'Qualifies for the fast track under Bowman\'s limits (Class II, FAA minor, no never-fast-track test holds); the two classes are supplied by the dataset', 'eligible: true',
    `eligible: ${route.fastTrack.eligible}; classes as supplied ${route.classes.company.value}/${route.classes.regulatory.value}`, route.fastTrack.eligible === true);
  expect('S3', 'No CCB: the cost of convening a board would exceed the saving', 'tier below the Change Control Board',
    `${route.tier.bodyName} (size ${usd(route.cost.size ?? NaN)}, ${route.cost.basis})`, route.tier.bodyId !== 'ccb' && (route.cost.size ?? Infinity) < 150_000);
  const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: { kind: 'agent' }, facts });
  expect('S3', 'Norn\'s agent may approve it on the fast track', 'outcome approve or approve_sampled',
    `${d.outcome}${d.actsNow ? ', acts now' : ', does not act now'}`, d.outcome === 'approve' || d.outcome === 'approve_sampled');

  // Control: ECR-0417 must not get the same treatment.
  const c17: any = check('ECR-0417', { measures: [{ horizonMonths: 12, savingsOffset: false }] });
  const e17 = ecr('ECR-0417');
  const facts17 = {
    ecrId: 'ECR-0417', cost: { ...costForecastFromCheck(c17), measured: c17.measures[0] }, classes: { company: e17.companyClass, regulatory: e17.faaClass },
    answers: { ...answers, retrofit_of_delivered_units: true, supplier_process_or_tooling: true, no_form_fit_function_change: false, same_supplier_no_tooling: false, authorized_equivalent: false },
    reportLevel: 1 as const,
  };
  const r17 = routeEcr(config, facts17);
  const d17 = decideAction(config, { action: 'approve_fast_track_ecr', actor: { kind: 'agent' }, facts: facts17 });
  expect('S3', 'Control: ECR-0417 (retrofit, tooling, over the limits) goes to the CCB and is refused the fast track', 'CCB; fast-track action denied',
    `${r17.tier.bodyName}; eligible ${r17.fastTrack.eligible}; fast-track decision ${d17.outcome}`, r17.tier.bodyId === 'ccb' && !r17.fastTrack.eligible && d17.outcome === 'deny');
}

// ---------------------------------------------------------------- S4: the conflicting pair

scenarioTitles.set('S4', keyOf('S4').title);
{
  const a = ecr('ECR-0412');
  const b = ecr('ECR-0415');
  const key: any = keyOf('S4').reference;
  const ca = a.itemChanges[0]!;
  const cb = b.itemChanges[0]!;
  const sets = (x: typeof ca) => new Map(x.changes.map((f) => [f.field, f.to]));
  const sa = sets(ca), sb = sets(cb);
  const both = [...sa.keys()].filter((f) => sb.has(f));
  const differ = both.filter((f) => sa.get(f) !== sb.get(f)).sort();
  // This part is the script's own comparison of the two change requests, not a Norn check (see the last row).
  expect('S4', 'Both revise BW-8210-110 from Rev B to Rev C and set the same fields to different values (script comparison of the two change requests)',
    'rated_flow_lpm, motor_power_w, unit_price_usd differ',
    `same item ${ca.item === cb.item}, ${ca.fromRev}>${ca.toRev} and ${cb.fromRev}>${cb.toRev}; differ: ${differ.join(', ')}`,
    ca.item === cb.item && ca.fromRev === cb.fromRev && ca.toRev === cb.toRev && differ.join() === 'motor_power_w,rated_flow_lpm,unit_price_usd');
  const cA: any = check('ECR-0412');
  const cB: any = check('ECR-0415');
  const dA = cA.headline.unitCostDelta.find((u: any) => u.program === 'vesper').perUnit;
  const dB = cB.headline.unitCostDelta.find((u: any) => u.program === 'vesper').perUnit;
  expect('S4', 'The directions are opposed: +$420 per pump for margin, -$385 for cost, two pumps per aircraft', `${usd(key.deltaA_perAircraftUsd)} and ${usd(key.deltaB_perAircraftUsd)} per aircraft`,
    `point ${usd(dA.point, 2)} and ${usd(dB.point, 2)}`, near(dA.point, key.deltaA_perAircraftUsd, 0.01) && near(dB.point, key.deltaB_perAircraftUsd, 0.01));
  const progs = (id: string) => (bomDelta(bowman, ecr(id)) as any).affected.programs.join(', ');
  expect('S4', 'The pump is shared with Meridian, so a decision moves both programs', 'vesper and meridian', `ECR-0412: ${progs('ECR-0412')}; ECR-0415: ${progs('ECR-0415')}`,
    progs('ECR-0412') === 'vesper, meridian' && progs('ECR-0415') === 'vesper, meridian');
  const alone = [bomDelta(bowman, a), bomDelta(bowman, b)] as any[];
  expect('S4', 'Each ECR alone applies cleanly to the baseline (a conflict between two ECRs is invisible to a single-ECR check)', 'no baseline conflict for either',
    `ECR-0412: ${alone[0].conflicts.length} conflicts; ECR-0415: ${alone[1].conflicts.length} conflicts`, alone[0].ok && alone[1].ok);

  // Library run on a baseline where one ECR is already applied: the other ECR's "from" values no longer match.
  const withApplied = (applied: typeof ca) => ({
    ...bowman,
    items: bowman.items.map((i) => {
      if (i.code !== applied.item) return i;
      const price = applied.changes.find((f) => f.field === 'unit_price_usd')?.to;
      return { ...i, rev: applied.toRev ?? i.rev, standardCost: typeof price === 'number' ? price : i.standardCost };
    }),
  });
  const kinds = (base: any, e: ReturnType<typeof ecr>) => (bomDelta(base, e) as any).conflicts.map((c: any) => c.kind).sort();
  const k415 = kinds(withApplied(ca), b);
  const k412 = kinds(withApplied(cb), a);
  expect('S4', 'S1 (BOM delta) reports a conflict when either ECR is applied on a baseline that already contains the other (baseline built by this script)',
    'stale_rev and stale_value in both orders', `0415 after 0412: ${k415.join(', ') || 'none'}; 0412 after 0415: ${k412.join(', ') || 'none'}`,
    ['stale_rev', 'stale_value'].every((k) => k415.includes(k) && k412.includes(k)));

  // Behavioural: run all four checks on each ECR with the other named as an open peer, and look for a flag or a
  // BOM conflict of kind conflicting_open_ecr. Matching the name in source text proves nothing, so nothing here reads source.
  const TRIGGER = 'conflicting_open_ecr';
  const emitted = (e: ReturnType<typeof ecr>, peer: ReturnType<typeof ecr>) => {
    const results: any[] = [
      bomDelta(bowman, e), costCheck(bowman, e, { seed: SEED }),
      timelineCheck(bowman, e, { seed: SEED }), supplyCheck(bowman, e, { seed: SEED, peers: [peer] }),
    ];
    return results.flatMap((r) => [...(r.flags ?? []), ...(r.conflicts ?? [])]).map((f: any) => String(f.kind));
  };
  const seen = [...emitted(a, b), ...emitted(b, a)];
  const raised = seen.includes(TRIGGER);
  expect('S4', 'Norn raises the conflicting_open_ecr trigger on its own when a second open ECR edits the same item',
    'a flag or conflict of kind conflicting_open_ecr from the BOM delta, cost, timeline or supply check, run on each ECR, with the other passed as an open peer to the check that takes peers',
    raised ? 'raised' : `none; run that way, those checks emit only these flag and conflict kinds: ${[...new Set(seen)].sort().join(', ')}`,
    raised ? true : 'not built');
}

// ---------------------------------------------------------------- S5: the shared supplier

scenarioTitles.set('S5', keyOf('S5').title);
{
  const key: any = keyOf('S5').reference;
  const t19: any = timelineCheck(bowman, ecr('ECR-0419'), { seed: SEED });
  const s19: any = supplyCheck(bowman, ecr('ECR-0419'), { seed: SEED, peers: [ecr('ECR-0421')] });
  const s21: any = supplyCheck(bowman, ecr('ECR-0421'), { seed: SEED, peers: [ecr('ECR-0419')] });
  const i19 = s19.interaction, i21 = s21.interaction;
  expect('S5', 'Different parts, no shared entity, but one supplier: Orrin Magnetics', 'each ECR names the other as a shared-supplier peer through SUP-ORRIN',
    `ECR-0419: ${i19.peers.map((p: any) => `${p.ecr} via ${p.sharedSuppliers.join()}`).join('; ')}; ECR-0421: ${i21.peers.map((p: any) => `${p.ecr} via ${p.sharedSuppliers.join()}`).join('; ')}`,
    i19.peers[0]?.ecr === 'ECR-0421' && i21.peers[0]?.ecr === 'ECR-0419' && i19.peers[0].sharedSuppliers.includes('SUP-ORRIN') && i21.peers[0].sharedSuppliers.includes('SUP-ORRIN'));
  const slot = i21.slots[0];
  expect('S5', 'Both want the 2027-Q2 qualification slot; one slips to the 2027-Q3 slot', 'ECR-0421 (filed second) moves from 2027-04-01 to 2027-07-01; ECR-0419 stays',
    `ECR-0421 ${slot.alone.p50} to ${slot.withPeers.p50}; ECR-0419 ${i19.slots[0].alone.p50} to ${i19.slots[0].withPeers.p50}`,
    slot.alone.p50 === '2027-04-01' && slot.withPeers.p50 === '2027-07-01' && i19.slots[0].withPeers.p50 === '2027-04-01');
  // Probabilities are rounded to 4 places, so a value of exactly 1 proves "every draw" only while one miss would still show: fewer than 20,000 draws.
  const everyDraw = (p: number) => p === 1 && s21.draws < 20_000;
  expect('S5', 'The slip is about 13 weeks', '13 weeks at P10, P50 and P90, and later in every draw', `shift P10 ${i21.cutIn.shiftWeeks.p10}, P50 ${i21.cutIn.shiftWeeks.p50}, P90 ${i21.cutIn.shiftWeeks.p90} weeks; later in ${num(i21.cutIn.probabilityLater * 100)}% of ${num(s21.draws)} draws`,
    i21.cutIn.shiftWeeks.p10 === 13 && i21.cutIn.shiftWeeks.p50 === 13 && i21.cutIn.shiftWeeks.p90 === 13 && everyDraw(i21.cutIn.probabilityLater));
  expect('S5', 'The ECR filed first loses nothing', 'ECR-0419 cut-in shift of 0 weeks', `shift ${i19.cutIn.shiftWeeks.p50} weeks`, i19.cutIn.shiftWeeks.p50 === 0);
  expect('S5', 'Vesper cut-in S/N 030 (October 2027) when ECR-0419 gets the first slot', 'S/N 30, October 2027', `S/N ${t19.cutIn.serial.p50}; ${t19.cutIn.date.p50}`, t19.cutIn.serial.p50 === 30 && t19.cutIn.date.p50.startsWith('2027-10'));
  const bundle = i19.bundles[0];
  const floor = key.secondQualificationDiscount * key.vesperQualificationUsd;
  expect('S5', 'Ordering both within 26 weeks earns a 40% cheaper second qualification and a 6% raw-material price break', `pair saving above $${num(floor)} (40% of the cheaper qualification) at P10, P50 and P90, and bundled in every draw`,
    `pair saving ${range(bundle.pairSaving, usd)}; bundled in ${num(bundle.probabilityBundled * 100)}% of ${num(s19.draws)} draws`, (bundle.probabilityBundled === 1 && s19.draws < 20_000) && bundle.pairSaving.p10 > floor);
  expect('S5', 'The pair saving is one number from either ECR', 'P10, P50, P90, mean and point identical from ECR-0419 and ECR-0421', `${usd(bundle.pairSaving.p50)} and ${usd(i21.bundles[0].pairSaving.p50)}`,
    (['p10', 'p50', 'p90', 'mean', 'point'] as const).every((k) => bundle.pairSaving[k] === i21.bundles[0].pairSaving[k]));
}

// ---------------------------------------------------------------- R: the checks themselves

scenarioTitles.set('R', 'Reproducibility of the checks');
{
  const ids = ['ECR-0417', 'ECR-0409', 'ECR-0423', 'ECR-0412', 'ECR-0415', 'ECR-0419', 'ECR-0421'];
  const same = ids.every((id) => JSON.stringify(check(id)) === JSON.stringify(check(id)));
  expect('R', 'Same ECR, same seed, same draws: identical cost-check output', 'byte-identical JSON on two runs, 7 ECRs', same ? 'identical' : 'differs', same);
  const notConverged = ids.filter((id) => !(check(id) as any).convergence.converged);
  expect('R', 'Second-seed convergence: P80 and P90 of the headline numbers agree within 1%', 'converged on all 7 ECRs', notConverged.length ? `not converged: ${notConverged.join(', ')}` : 'converged on all 7', notConverged.length === 0);
}

// ---------------------------------------------------------------- the document

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
const count = (s: Status) => rows.filter((r) => r.status === s).length;
const sample: any = check('ECR-0417');
const codeVersion = sample.codeVersion;

const lines: string[] = [];
const out = (s = '') => lines.push(s);

out('# Proof that Norn works: what is real, what is simulated, how we know');
out();
out('Generated by `node norn/checks/proof.ts`. Do not edit by hand: the next run overwrites this file.');
out(`The run is seeded (\`${SEED}\`, checks code \`${codeVersion}\`) and reads only files in this repo, so a second run writes the same text.`);
out();
out('## Result');
out();
out(`**${count('PASS')} of ${rows.length} expectations pass, ${count('FAIL')} fail, ${count('NOT BUILT')} not built (the checks, run as the expectation describes, do not produce what it names).** `
  + 'The expectations come from the answer key the dataset carries for its planted scenarios (`bowman/data/scenarios.ts`) and from comments in `bowman/data/changes.ts`. '
  + 'The code was not changed to fit them. Failures stay in the table.');
out();
for (const r of rows.filter((x) => x.status !== 'PASS')) out(`- ${r.status}, ${r.id}: ${r.what}. Expected ${r.expected}; got ${r.actual}.`);
out();
out('## What is real');
out();
out('| Part | What it is | Evidence in this repo |');
out('|---|---|---|');
out('| Norn\'s checks | BOM delta, cost, timeline and supply, in TypeScript with seeded Monte Carlo draws, a second-seed convergence test and a trace behind each number | `norn/checks/src`; run above on 7 ECRs; test counts below |');
out('| Norn\'s routing and decision rules | Approval tier, fast-track eligibility and what an agent may do, read from Bowman\'s configuration | `norn/config/src/route.ts`; run above on ECR-0423 and ECR-0417; test counts below |');
out('| Bowman\'s dataset | Parts, BOMs, suppliers, prices, stock, volume plan, history and the demo\'s changes, with a validator | `bowman/data`; validator counts below |');
out('| ERPNext | Real open-source ERP (v16), set up as Bowman\'s | `bowman/erp`. Not started or reached by this script: not verified here |');
out('| The PLM | Where engineers file changes; scenery that stands in for Teamcenter | `bowman/plm`. Not reached by this script: not verified here |');
out('| Norn\'s agents | Claude sessions started through the Claude Agent SDK, offered only Norn\'s MCP tools | `norn/runner`, `norn/mcp`. Not run by this script (no network): not verified here |');
out();
out('## What is simulated');
out();
out(`- **Bowman Aviation is fictional**, as are its people, suppliers and history. The validator counts ${sourced} of ${total} records as \`sourced\` (traced to a public source) and the other ${total - sourced} as \`invented\`.`);
out('  By kind, sourced/total: ' + provRows.map((r) => `${r.kind} ${r.sourced}/${r.total}`).join(', ') + '.');
out('- **The planted scenarios are invented** (`bowman/data/changes.ts`). Their answer key is invented too, by the people who wrote the data. This page shows the checks agree with the key. It does not show the key matches a real aircraft maker.');
out('- **Ranges come from assumed distributions.** Where the dataset gives a price or lead-time range, the draws use it. Where it does not, the checks use stated defaults and flag them (`needs_estimate`). The slot rule for two ECRs on one supplier (the one filed first takes the first slot) is Norn\'s assumption, not a supplier\'s statement.');
out('- **The inputs to the fast-track test that Norn does not produce.** The yes/no answers (safety part, retrofit, tooling and so on) are set in the script from the dataset\'s scenario notes for ECR-0423 and ECR-0417. No classifier produces them yet. The company class and the FAA class are also supplied, taken as given from the dataset (`companyClass` and `faaClass` on each change request): routing places them, it does not infer them. The cost, tier, fast-track eligibility and decision are computed from those inputs.');
out('- **The baselines with the other ECR already applied**, used for the conflict test (S4), are built by the script from the two change requests. Norn does not build them.');
out();
out('## Planted scenarios: expected against actual');
out();
out('PASS means the check\'s output meets the expectation as written. A range is shown as P50 (P10, P90). "Point" is every input at its stated value.');
for (const id of [...scenarioTitles.keys()]) {
  out();
  out(`### ${id}: ${scenarioTitles.get(id)}`);
  out();
  out('| Expectation | Expected | Actual | Result |');
  out('|---|---|---|---|');
  for (const r of rows.filter((x) => x.id === id)) out(`| ${cell(r.what)} | ${cell(r.expected)} | ${cell(r.actual)} | ${r.status} |`);
}
out();
out('## Verification counts');
out();
out('| What | Result |');
out('|---|---|');
out(`| Bowman dataset validator (\`bowman/data/check.ts\`, as of ${asOf}) | ${checksLine[1]} checks, ${checksLine[2]} failed; exit code ${validator.code} |`);
out(`| Provenance (records marked sourced / all records) | ${sourced} / ${total} |`);
out(`| Bowman's Norn configuration | loads and validates (\`norn/config/src/load.ts\`) |`);
out(`| Checks library tests (\`norn/checks\`) | ${checksTests} |`);
out(`| Configuration and routing tests (\`norn/config\`) | ${configTests} |`);
out('| Everything else (workers, module, runner, web, PLM, ERP, live agents) | not run by this page: not verified here |');
out();
out('## Reproduce');
out();
out('Needs Node 22.18 or later (the repo targets Node 24). No network and no install step: the generator and both test suites run directly on Node, with no dependencies installed.');
out();
out('```');
out('node norn/checks/proof.ts                                      # rewrites docs/PROOF.md, about 40 s with the test suites');
out('git diff --exit-code docs/PROOF.md                              # no output: the rerun wrote the same text as the page in the repository');
out('node bowman/data/check.ts                                       # the dataset validator on its own');
out('(cd norn/checks && node --test "test/*.test.ts")                # the checks library tests on their own');
out('(cd norn/config && node --test "test/*.test.ts")                # the configuration and routing tests on their own');
out('```');
out();
out('## Limits');
out();
out('- A pass shows the code agrees with the dataset\'s own answer key on invented data. It is not a benchmark against real engineering changes.');
out('- The live path (a change filed in the PLM, Norn\'s assessment posted on it, the ERP change package) is described in `docs/DEVPOST.md`. This page does not exercise it.');
out('- Convergence is checked on the continuous headline numbers. Serial numbers and probabilities are steps and are not.');

writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`wrote ${OUT}: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('NOT BUILT')} not built, of ${rows.length}`);
