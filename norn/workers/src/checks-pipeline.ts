// End-to-end checks of the Norn pipeline (#40, #67) against a live database: an ECR reported by a
// change-request source becomes a Norn ECR, the real worker runs the impact checks (s1 to s4) on it against
// the baseline, and the stored results are exactly what the checks library returns for the same
// inputs. Then a new revision, an agent's assumption and a baseline change each re-check it, and
// an ECR with no change request stays mock.
//
// It starts its own worker on a test baseline file (Bowman's dataset, not the ERP) and feeds ECRs
// through the stub source, so nothing here reads the ERP or the PLM. Use a scratch database, never
// the demo's, and run no other worker on it:
//   NORN_DB=norn-pipe npm run check:pipeline        (from norn/)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { bomDelta, bomDeltaRows, costAssessment, supplyCheck, supplyCheckRows, timelineCheck, timelineRows, type AssumptionOverride, type Baseline, type ChangeRequest } from '../../checks/src/index.ts';
import { slug } from '../../checks/src/cost.ts';
import { hashOf } from '../../connectors/erpnext/src/index.ts';
import { DB, connect, subscribe } from './connect.ts';
import { provenanceOf, toOverride, type Inputs } from './impact.ts';
import { ingestOnce, stubSource } from './ingest.ts';
import { TABLES, kit, recorder, rejects } from './testkit.ts';

if (DB === 'norn') throw new Error('check:pipeline runs a worker of its own: point NORN_DB at a scratch database, not norn');

const { check, finish } = recorder();
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'norn-pipe-'));
const ecrDir = join(tmp, 'ecrs');
const baselineFile = join(tmp, 'baseline.json');
const stamp = Date.now().toString(36);
const SEED = 'norn-seed-1';

// ---- inputs: the dataset's baseline as a file, two of its ECRs under fresh numbers ------------------
const baselineOf = (b: typeof bowman): Baseline => ({
  programs: b.programs, workCenters: b.workCenters, items: b.items, bom: b.bom, sourcing: b.sourcing, stock: b.stock, volumePlan: b.volumePlan, builtAircraft: b.builtAircraft,
  supplierConstraints: b.supplierConstraints, // the slots and capacity s3 and s4 read; the ERP holds none, so these checks also run without
});
let baseline = structuredClone(baselineOf(bowman));
writeFileSync(baselineFile, JSON.stringify(baseline));
const ecrOf = (id: string, as: string) => ({ ...structuredClone(bowman.ecrs.find(e => e.id === id)!), id: as }) as ChangeRequest & { title: string; description: string };
const e417 = ecrOf('ECR-0417', `ECR-0417-${stamp}`);
const e423 = ecrOf('ECR-0423', `ECR-0423-${stamp}`);
// The pair that share a supplier (Orrin); filed later, to see s4's interaction.
const e419 = ecrOf('ECR-0419', `ECR-0419-${stamp}`);
const e421 = ecrOf('ECR-0421', `ECR-0421-${stamp}`);
const mkdir = () => import('node:fs').then(fs => fs.mkdirSync(ecrDir, { recursive: true }));
await mkdir();
const putEcr = (e: object & { id: string }) => writeFileSync(join(ecrDir, `${e.id}.json`), JSON.stringify(e));
putEcr(e417);
putEcr(e423);

// ---- a worker of our own -------------------------------------------------------------------------
const workerLog: string[] = [];
const worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
  cwd: join(here, '..'),
  env: { ...process.env, NORN_DB: DB, WORKER_NAME: `pipe-worker-${stamp}`, NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24', NORN_BASELINE_POLL_MS: '1500', NORN_ERP_SETTINGS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
worker.stdout.on('data', d => workerLog.push(String(d)));
worker.stderr.on('data', d => workerLog.push(String(d)));
// A second worker with no baseline source, as on another machine: it must leave real runs alone.
const blindLog: string[] = [];
const blind = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
  cwd: join(here, '..'),
  // Its own empty cache: on this machine it would otherwise read the baselines the first worker cached.
  env: { ...process.env, NORN_DB: DB, WORKER_NAME: `pipe-blind-${stamp}`, NORN_BASELINE_FILE: '', NORN_ERP_SETTINGS: '', NORN_BASELINE_CACHE_DIR: join(tmp, 'blind-cache') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
blind.stdout.on('data', d => blindLog.push(String(d)));
blind.stderr.on('data', d => blindLog.push(String(d)));

const A = await connect({ kind: 'agent', name: 'check-pipeline', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot']);
const { R, db, until, current, run } = kit(A);
console.log(`checking database '${DB}'`);

const byNumber = (n: string) => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === n);
const results = (runId: bigint) => [...db.checkResult.iter()].filter(r => r.checkRunId === runId).sort((a, b) => Number(a.id - b.id));
const doneRun = (prId: bigint, stage: string, ms = 60000) =>
  until(() => {
    const r = current(prId, stage);
    return r?.status === 'done' && results(r.id).length > 0 && r;
  }, ms, `${stage} on ECR ${prId} to finish`);
const currentBaseline = () => [...db.baselineSnapshot.iter()].find(b => b.current);
type Row = { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string };
const same = (stored: Row[], want: Row[]) =>
  stored.length === want.length && want.every((w, i) => {
    const s = stored[i]!;
    return s.key === w.key && s.label === w.label && s.unit === w.unit && s.p10 === w.p10 && s.p50 === w.p50 && s.p90 === w.p90 && s.detailJson === w.detailJson;
  });
const firstDiff = (stored: Row[], want: Row[]) => {
  if (stored.length !== want.length) return `${stored.length} rows stored, ${want.length} expected`;
  const i = want.findIndex((w, k) => JSON.stringify(w) !== JSON.stringify({ key: stored[k]!.key, label: stored[k]!.label, unit: stored[k]!.unit, p10: stored[k]!.p10, p50: stored[k]!.p50, p90: stored[k]!.p90, detailJson: stored[k]!.detailJson }));
  return i < 0 ? '' : `first difference at ${want[i]!.key}`;
};
/**
 * What the library gives for this ECR on this run's inputs, as the worker reads them: the change
 * request round-trips through JSON, and the assumptions are the ones the run names (the baseline's
 * included, whatever else has been recorded on this database).
 */
const assumptionsNamed = (runInputs: string): AssumptionOverride[] =>
  ((JSON.parse(runInputs) as Inputs).assumptions ?? [])
    .map(a => toOverride(db.assumption.id.find(BigInt(a.id))!))
    .filter((o): o is AssumptionOverride => typeof o !== 'string');
const expectS2 = (runInputs: string, e: object, b: Baseline) =>
  costAssessment(b, JSON.parse(JSON.stringify(e)), { seed: SEED, assumptions: assumptionsNamed(runInputs), provenance: provenanceOf(JSON.parse(runInputs) as Inputs) }).rows;
const expectS1 = (e: object, b: Baseline) => bomDeltaRows(bomDelta(b, JSON.parse(JSON.stringify(e))));
const expectS3 = (runInputs: string, e: object, b: Baseline) =>
  timelineRows(timelineCheck(b, JSON.parse(JSON.stringify(e)), { seed: SEED, assumptions: assumptionsNamed(runInputs), provenance: provenanceOf(JSON.parse(runInputs) as Inputs) }));
/**
 * s4 compares an ECR with the other open ones, and its inputs name them (core.ts peerSnapshot: each
 * one's pull request, revision and digest). The expectation is the library on exactly those change
 * requests, read from the revisions the run names.
 */
const peersNamed = (runInputs: string): object[] =>
  ((JSON.parse(runInputs) as Inputs).peers ?? []).map(n => JSON.parse([...db.ecrRevision.prId.filter(BigInt(n.pr))].find(r => r.seq === n.revision)!.changeRequestJson));
const peerIdsOf = (runInputs: string): string[] => peersNamed(runInputs).map(c => (c as { id: string }).id).sort();
const expectS4 = (runInputs: string, e: object, b: Baseline) =>
  supplyCheckRows(supplyCheck(b, JSON.parse(JSON.stringify(e)), {
    seed: SEED, assumptions: assumptionsNamed(runInputs), provenance: provenanceOf(JSON.parse(runInputs) as Inputs), peers: peersNamed(runInputs) as never,
  }));
const source = stubSource(ecrDir);
const sent = new Map<string, string>();
const log = (m: string) => console.log(`  ingest: ${m}`);

try {
  // ---- the worker records the baseline it read --------------------------------------------------
  // This run's file, not a baseline an earlier run left current.
  const snap = await until(() => currentBaseline()?.hash === hashOf(baseline) && currentBaseline(), 30000, 'the worker to record this baseline');
  check('the worker reads the baseline and records it by hash, with its source and counts', snap.source === 'file' && snap.asOf === '2026-10-24' && JSON.parse(snap.countsJson).items === baseline.items.length, `${snap.hash.slice(0, 12)} ${snap.source} ${snap.countsJson}`);

  // ---- ingest: two ECRs from the source become Norn ECRs ------------------------------------------
  const first = await ingestOnce(R, source, sent, log);
  const p417 = await until(() => byNumber(e417.id), 5000, `${e417.id} to be filed`);
  const p423 = await until(() => byNumber(e423.id), 5000, `${e423.id} to be filed`);
  const rev1 = [...db.ecrRevision.iter()].find(r => r.prId === p417.id && r.current);
  check('ingest opens each ECR once, with its change request as revision 1, title and text from the source', first.reported === 2 && rev1?.seq === 1 && rev1.source === 'stub' && p417.title === e417.title && p417.description === e417.description, JSON.stringify(first));

  // ---- the worker runs the real checks, and stores exactly what the library returns -----------------
  const s1 = await doneRun(p417.id, 's1_bom_delta');
  const s2 = await doneRun(p417.id, 's2_cost');
  const inputs = JSON.parse(s2.inputsJson);
  check('the runs name the change request revision, the baseline hash and the seed they computed on', inputs.revision === 1 && inputs.overlay === rev1?.digest && inputs.erpBaseline === snap.hash && inputs.seed === SEED, s2.inputsJson.slice(0, 200));
  check('and where they came from: a test file and a stub feed, never passed off as the ERP and the PLM', inputs.erpBaselineSource === 'file' && inputs.revisionSource === 'stub' && inputs.erpBaselineAsOf === '2026-10-24', `${inputs.erpBaselineSource} ${inputs.revisionSource}`);
  check('s1 stores bomDeltaRows unchanged, marked computed', same(results(s1.id), expectS1(e417, baseline)) && results(s1.id).every(r => !r.mock), firstDiff(results(s1.id), expectS1(e417, baseline)));
  const want417 = expectS2(s2.inputsJson, e417, baseline);
  check('s2 stores costCheckRows unchanged, marked computed: every row, p10/p50/p90 and detail JSON', same(results(s2.id), want417) && results(s2.id).every(r => !r.mock), firstDiff(results(s2.id), want417));
  const detail = results(s2.id).find(r => r.key === 'detail');
  check('the detail row carries the inputs every trace points at', !!detail && JSON.parse(detail.detailJson).inputs.length > 10, `${detail?.detailJson.length} bytes`);
  const itemsRef = detail ? JSON.parse(detail.detailJson).inputs.find((i: { id: string }) => i.id === 'baseline:items')?.ref ?? '' : '';
  check('the trace says the baseline is a test file, not the ERP', /not the ERP/.test(itemsRef) && !detail!.detailJson.includes('ERP and PLM item master'), itemsRef);
  const s2b = await doneRun(p423.id, 's2_cost');
  check('a second ECR runs too, on its own numbers', same(results(s2b.id), expectS2(s2b.inputsJson, e423, baseline)), firstDiff(results(s2b.id), expectS2(s2b.inputsJson, e423, baseline)));
  const s3 = await doneRun(p417.id, 's3_timeline');
  const want3 = expectS3(s3.inputsJson, e417, baseline);
  check('s3 stores timelineRows unchanged, marked computed, with a cut-in date and the first serial', same(results(s3.id), want3) && results(s3.id).every(r => !r.mock) && results(s3.id).some(r => r.key === 'cut_in_date') && results(s3.id).some(r => r.key === 'cut_in_serial'), firstDiff(results(s3.id), want3));
  const s4 = await doneRun(p417.id, 's4_supply');
  const want4 = expectS4(s4.inputsJson, e417, baseline);
  const single = results(s4.id).find(r => r.key === 'single_source_items');
  check('s4 stores supplyCheckRows unchanged, marked computed, with the single-source part', same(results(s4.id), want4) && results(s4.id).every(r => !r.mock) && (single?.p50 ?? 0) >= 1 && single!.detailJson.includes('BW-5120-210'), firstDiff(results(s4.id), want4));

  // ---- the same report again changes nothing ------------------------------------------------------
  const runsBefore = [...db.checkRun.iter()].length;
  await R.ingestEcr({ plmEcrNumber: e417.id, title: e417.title, description: e417.description, changeRequestJson: JSON.stringify(e417), source: 'stub', sourceRef: 'again' });
  await new Promise(r => setTimeout(r, 800));
  const again = await ingestOnce(R, source, sent, log);
  check('reporting an unchanged ECR writes nothing: no revision, no runs', again.unchanged === 2 && [...db.ecrRevision.iter()].filter(r => r.prId === p417.id).length === 1 && [...db.checkRun.iter()].length === runsBefore);

  // ---- a new revision from the source re-checks it ---------------------------------------------
  const nc = e417.costPage.production.find(r => /NC programming/.test(r.label))!;
  nc.oneTime = (nc.oneTime ?? 0) + 1000;
  putEcr(e417);
  await ingestOnce(R, source, sent, log);
  const rev2 = await until(() => [...db.ecrRevision.iter()].find(r => r.prId === p417.id && r.current && r.seq === 2), 5000, 'revision 2');
  const s2r2 = await until(() => {
    const r = current(p417.id, 's2_cost');
    return r && r.id !== s2.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 on revision 2');
  const oneTime = (rows: Row[]) => rows.find(r => r.key === 'one_time_total')?.p50 ?? NaN;
  check('a changed change request is revision 2: the old s2 run goes stale and a new one runs on it', run(s2.id).status === 'stale' && JSON.parse(s2r2.inputsJson).overlay === rev2.digest && same(results(s2r2.id), expectS2(s2r2.inputsJson, e417, baseline)), `old ${run(s2.id).status}; ${firstDiff(results(s2r2.id), expectS2(s2r2.inputsJson, e417, baseline))}`);
  check('and its numbers move with it', Math.abs(oneTime(results(s2r2.id)) - oneTime(results(s2.id)) - 1000) < 60, `${oneTime(results(s2.id))} -> ${oneTime(results(s2r2.id))}`);

  // ---- an agent's estimate of a blank row lands through the assumptions -----------------------------
  const delayId = `cost:${e417.id}:other:${slug('Delay cost of holding S/N 011-014 at the controller-install station')}`;
  const distJson = JSON.stringify({ kind: 'lognormal', p10: 15000, p50: 20000, p90: 28000 });
  await R.recordAssumption({ prId: p417.id, key: delayId, distJson, source: 'agent_estimated', rationale: 'check: four aircraft held two days', affects: ['s2_cost'], expectedRev: 0 });
  const s2a = await until(() => {
    const r = current(p417.id, 's2_cost');
    return r && r.id !== s2r2.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 with the assumption');
  const named = (JSON.parse(s2a.inputsJson) as Inputs).assumptions ?? [];
  const wantA = expectS2(s2a.inputsJson, e417, baseline);
  const delayRow = results(s2a.id).find(r => r.key === `line:${delayId}`);
  check('an agent_estimated assumption replaces the blank row\'s $0 and the trace names it', named.some(a => a.key === delayId) && same(results(s2a.id), wantA) && Math.abs((delayRow?.p50 ?? 0) - 20000) < 1500 && delayRow!.detailJson.includes('agent_estimated'), `${firstDiff(results(s2a.id), wantA)} delay p50 ${delayRow?.p50}`);

  // ---- an unreadable assumption is reported, not dropped ---------------------------------------------
  await R.recordAssumption({ prId: p423.id, key: 'recovery:BW-9440-030', distJson: JSON.stringify({ kind: 'weird' }), source: 'agent_estimated', rationale: 'check: a bad shape', affects: ['s2_cost'], expectedRev: 0 });
  const s2bad = await until(() => {
    const r = current(p423.id, 's2_cost');
    return r && r.id !== s2b.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 with the bad assumption');
  const errRow = results(s2bad.id).find(r => r.key === 'assumption_errors');
  check('an assumption the library cannot take is reported in its own row', !!errRow && errRow.detailJson.includes('unknown kind'), errRow?.detailJson);
  // Quantiles out of order make the library throw: still a reported assumption, not a failed run.
  await R.recordAssumption({ prId: p423.id, key: 'scrapRecovery-out-of-order', distJson: JSON.stringify({ kind: 'lognormal', p10: 9, p50: 5, p90: 7 }), source: 'agent_estimated', rationale: 'check: quantiles out of order', affects: ['s2_cost'], expectedRev: 0 });
  const s2ooo = await until(() => {
    const r = current(p423.id, 's2_cost');
    return r && r.id !== s2bad.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 with quantiles out of order');
  const ooo = results(s2ooo.id).find(r => r.key === 'assumption_errors');
  check('quantiles out of order are reported with the others, and the run still finishes', !!ooo && JSON.parse(ooo.detailJson).problems.length === 2, ooo?.detailJson);

  // ---- a baseline change re-checks every open ECR ---------------------------------------------------
  const before = currentBaseline()!.hash;
  const untouched = baseline.items.find(i => i.code !== 'BW-5120-210' && i.code !== 'BW-9440-030' && i.standardCost !== undefined)!;
  baseline = structuredClone(baseline);
  baseline.items.find(i => i.code === untouched.code)!.standardCost! += 1;
  writeFileSync(baselineFile, JSON.stringify(baseline));
  const snap2 = await until(() => currentBaseline()?.hash !== before && currentBaseline(), 30000, 'the new baseline to be recorded');
  const s2n = await until(() => {
    const r = current(p423.id, 's2_cost');
    return r && JSON.parse(r.inputsJson).erpBaseline === snap2.hash && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 on the new baseline');
  const wantN = expectS2(s2n.inputsJson, e423, baseline);
  check('a new baseline is recorded and every open ECR is re-checked on it', run(s2ooo.id).status === 'stale' && same(results(s2n.id).filter(r => r.key !== 'assumption_errors'), wantN), firstDiff(results(s2n.id).filter(r => r.key !== 'assumption_errors'), wantN));

  // ---- two ECRs on one supplier: filing the second re-runs the first's s4 ---------------------------
  putEcr(e419);
  await ingestOnce(R, source, sent, log);
  const p419 = await until(() => byNumber(e419.id), 5000, `${e419.id} to be filed`);
  const s4_419 = await doneRun(p419.id, 's4_supply');
  const rev419 = byNumber(e419.id)!.revision;
  check('the first ECR files with no peer on its supplier: s4 shows no interaction', JSON.parse(results(s4_419.id).find(r => r.key === 'detail')!.detailJson).interaction === null && peerIdsOf(s4_419.inputsJson).every(id => id !== e421.id), peerIdsOf(s4_419.inputsJson).join());
  putEcr(e421);
  await ingestOnce(R, source, sent, log);
  const p421 = await until(() => byNumber(e421.id), 5000, `${e421.id} to be filed`);
  const s4_421 = await doneRun(p421.id, 's4_supply');
  const s3_421 = await doneRun(p421.id, 's3_timeline');
  const w421 = expectS4(s4_421.inputsJson, e421, baseline);
  const d421 = JSON.parse(results(s4_421.id).find(r => r.key === 'detail')!.detailJson);
  check('the ECR filed second sees the first in s4: same rows as the library, its slot moves a quarter later', same(results(s4_421.id), w421) && d421.interaction?.peers.map((p: { ecr: string }) => p.ecr).join() === e419.id && results(s4_421.id).find(r => r.key === 'peer_cut_in_shift_weeks')?.p50 === 13 && results(s4_421.id).find(r => r.key === 'p_cut_in_later_with_peers')?.p50 === 1, firstDiff(results(s4_421.id), w421));
  check('s3 on the same ECR is alone by construction: its own cut-in, unmoved by the pair', same(results(s3_421.id), expectS3(s3_421.inputsJson, e421, baseline)) && results(s3_421.id).every(r => !r.mock), firstDiff(results(s3_421.id), expectS3(s3_421.inputsJson, e421, baseline)));
  // The first ECR's s4 names the second now: it re-ran by itself, on the same revision.
  const s4_419b = await until(() => {
    const r = current(p419.id, 's4_supply');
    return r && r.id !== s4_419.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's4 on ECR-0419 after ECR-0421 was filed');
  const w419 = expectS4(s4_419b.inputsJson, e419, baseline);
  const d419 = JSON.parse(results(s4_419b.id).find(r => r.key === 'detail')!.detailJson);
  const own = (rows: Row[], k: string) => rows.find(r => r.key === k)?.p50 ?? NaN;
  check('filing the second ECR re-ran s4 on the first ECR by itself: it names the second, and shows the pair', run(s4_419.id).status === 'stale' && peerIdsOf(s4_419b.inputsJson).includes(e421.id) && same(results(s4_419b.id), w419) && d419.interaction?.peers.map((p: { ecr: string }) => p.ecr).join() === e421.id && own(results(s4_419b.id), 'peer_cut_in_shift_weeks') === 0 && own(results(s4_419b.id), 'pair_bundle_saving:CON-ORRIN-UH-SLOT') > own(results(s4_419b.id), 'bundle_saving:CON-ORRIN-UH-SLOT'), firstDiff(results(s4_419b.id), w419));
  check('...without a new revision of the first ECR: another ECR being filed is not a change to its inputs', byNumber(e419.id)!.revision === rev419 && JSON.parse(s4_419b.inputsJson).revision === JSON.parse(s4_419.inputsJson).revision, `revision ${rev419} -> ${byNumber(e419.id)!.revision}`);
  // A new revision of the first ECR is a new peer revision for the second.
  const fee = e419.costPage.production.find(r => /Engineering and testing/.test(r.label))!;
  fee.oneTime = (fee.oneTime ?? 0) + 1000;
  putEcr(e419);
  await ingestOnce(R, source, sent, log);
  const s4_421b = await until(() => {
    const r = current(p421.id, 's4_supply');
    return r && r.id !== s4_421.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's4 on ECR-0421 after ECR-0419 revision 2');
  const named419 = (JSON.parse(s4_421b.inputsJson) as Inputs).peers?.find(n => n.pr === String(p419.id));
  check('a new revision of the first ECR re-runs s4 on the second ECR, on the revised change request', run(s4_421.id).status === 'stale' && named419?.revision === 2 && same(results(s4_421b.id), expectS4(s4_421b.inputsJson, e421, baseline)), `${JSON.stringify(named419)} ${firstDiff(results(s4_421b.id), expectS4(s4_421b.inputsJson, e421, baseline))}`);
  console.log(`  pair: ECR-0421 cut-in later by ${own(results(s4_421.id), 'peer_cut_in_shift_weeks')} weeks in ${own(results(s4_421.id), 'p_cut_in_later_with_peers') * 100}% of draws; pair bundle saving $${Math.round(own(results(s4_419b.id), 'pair_bundle_saving:CON-ORRIN-UH-SLOT'))} (P50)`);

  // ---- an ECR with no change request keeps the mock handlers ----------------------------------------
  await R.createPr({ plmEcrNumber: '', title: `check pipeline: no change request ${stamp}`, description: 'check' });
  const bare = await until(() => [...db.pullRequest.iter()].find(p => p.title === `check pipeline: no change request ${stamp}`), 5000, 'the bare ECR');
  const bareRuns = [] as { stage: string; rows: ReturnType<typeof results> }[];
  for (const stage of ['s2_cost', 's3_timeline', 's4_supply']) bareRuns.push({ stage, rows: results((await doneRun(bare.id, stage)).id) });
  check('an ECR with no change request gets mock results in s2, s3 and s4, labelled mock', bareRuns.every(b => b.rows.length > 0 && b.rows.every(r => r.mock)), bareRuns.map(b => `${b.stage}:${b.rows.map(r => r.key).join('/')}`).join(' '));

  // ---- the module refuses a change request for another ECR ------------------------------------------
  const wrong = await rejects(R.ingestEcr({ plmEcrNumber: e423.id, title: 'x', description: '', changeRequestJson: JSON.stringify({ ...e417 }), source: 'stub', sourceRef: 'wrong' }));
  const notObj = await rejects(R.ingestEcr({ plmEcrNumber: `ECR-X-${stamp}`, title: 'x', description: '', changeRequestJson: '[1,2]', source: 'stub', sourceRef: 'x' }));
  check('ingest refuses a change request for another ECR, or one that is not an object', wrong?.name === 'SenderError' && notObj?.name === 'SenderError' && !byNumber(`ECR-X-${stamp}`), `${wrong?.message} | ${notObj?.message}`);

  // ---- the worker with no baseline source left every real run alone ---------------------------------
  const ours = new Set([p417.id, p423.id, p419.id, p421.id]);
  const failedRuns = [...db.checkRun.iter()].filter(r => ours.has(r.prId) && r.status === 'failed');
  const blindClaims = blindLog.join('').split('\n').filter(l => /claimed run \d+ s[1-4]_/.test(l) && [...ours].some(id => l.includes(`(pr ${id},`)));
  check('a worker with no baseline source never claims or fails a real run', failedRuns.length === 0 && blindClaims.length === 0 && blindLog.join('').includes('connected'), `${failedRuns.length} failed, ${blindClaims.length} claimed by the blind worker`);

  // Leave the scratch database tidy: close what this run opened.
  for (const p of [p417, p423, p419, p421, bare]) await R.setPrStatus({ prId: p.id, status: 'closed' }).catch(() => {});
} catch (e) {
  check('the pipeline run finished', false, (e as Error).message);
  console.log(workerLog.join('').split('\n').slice(-40).join('\n'));
} finally {
  worker.kill();
  blind.kill();
  A.close();
  rmSync(tmp, { recursive: true, force: true });
}
const ok = finish();
process.exit(ok ? 0 : 1);
