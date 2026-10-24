// End-to-end checks of the Norn pipeline (#40, #67) against a live database: an ECR reported by a
// change-request source becomes a Norn ECR, the real worker runs the impact checks on it against
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
import { bomDelta, bomDeltaRows, costCheck, costCheckRows, type AssumptionOverride, type Baseline, type ChangeRequest } from '../../checks/src/index.ts';
import { slug } from '../../checks/src/cost.ts';
import { DB, connect, subscribe } from './connect.ts';
import { toOverride } from './impact.ts';
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
});
let baseline = structuredClone(baselineOf(bowman));
writeFileSync(baselineFile, JSON.stringify(baseline));
const ecrOf = (id: string, as: string) => ({ ...structuredClone(bowman.ecrs.find(e => e.id === id)!), id: as }) as ChangeRequest & { title: string; description: string };
const e417 = ecrOf('ECR-0417', `ECR-0417-${stamp}`);
const e423 = ecrOf('ECR-0423', `ECR-0423-${stamp}`);
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
/** What the library gives for this ECR, as the worker reads it (the change request round-trips through JSON). */
const expectS2 = (e: object, b: Baseline, assumptions: AssumptionOverride[] = []) => costCheckRows(costCheck(b, JSON.parse(JSON.stringify(e)), { seed: SEED, assumptions }));
const expectS1 = (e: object, b: Baseline) => bomDeltaRows(bomDelta(b, JSON.parse(JSON.stringify(e))));
const source = stubSource(ecrDir);
const sent = new Map<string, string>();
const log = (m: string) => console.log(`  ingest: ${m}`);

try {
  // ---- the worker records the baseline it read --------------------------------------------------
  const snap = await until(() => currentBaseline(), 30000, 'the worker to record a baseline');
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
  check('s1 stores bomDeltaRows unchanged, marked computed', same(results(s1.id), expectS1(e417, baseline)) && results(s1.id).every(r => !r.mock), firstDiff(results(s1.id), expectS1(e417, baseline)));
  const want417 = expectS2(e417, baseline);
  check('s2 stores costCheckRows unchanged, marked computed: every row, p10/p50/p90 and detail JSON', same(results(s2.id), want417) && results(s2.id).every(r => !r.mock), firstDiff(results(s2.id), want417));
  const detail = results(s2.id).find(r => r.key === 'detail');
  check('the detail row carries the inputs every trace points at', !!detail && JSON.parse(detail.detailJson).inputs.length > 10, `${detail?.detailJson.length} bytes`);
  const s2b = await doneRun(p423.id, 's2_cost');
  check('a second ECR runs too, on its own numbers', same(results(s2b.id), expectS2(e423, baseline)), firstDiff(results(s2b.id), expectS2(e423, baseline)));
  const s3 = await until(() => current(p417.id, 's3_timeline')?.status === 'done' && current(p417.id, 's3_timeline'), 30000, 's3 to finish');
  check('stages without a real check stay mock and say so', results(s3.id).every(r => r.mock), results(s3.id).map(r => r.key).join(','));

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
  check('a changed change request is revision 2: the old s2 run goes stale and a new one runs on it', run(s2.id).status === 'stale' && JSON.parse(s2r2.inputsJson).overlay === rev2.digest && same(results(s2r2.id), expectS2(e417, baseline)), `old ${run(s2.id).status}; ${firstDiff(results(s2r2.id), expectS2(e417, baseline))}`);
  check('and its numbers move with it', Math.abs(oneTime(results(s2r2.id)) - oneTime(results(s2.id)) - 1000) < 60, `${oneTime(results(s2.id))} -> ${oneTime(results(s2r2.id))}`);

  // ---- an agent's estimate of a blank row lands through the assumptions -----------------------------
  const delayId = `cost:${e417.id}:other:${slug('Delay cost of holding S/N 011-014 at the controller-install station')}`;
  const distJson = JSON.stringify({ kind: 'lognormal', p10: 15000, p50: 20000, p90: 28000 });
  await R.recordAssumption({ prId: p417.id, key: delayId, distJson, source: 'agent_estimated', rationale: 'check: four aircraft held two days', affects: ['s2_cost'], expectedRev: 0 });
  const s2a = await until(() => {
    const r = current(p417.id, 's2_cost');
    return r && r.id !== s2r2.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 with the assumption');
  const ov = toOverride({ key: delayId, distJson, source: 'agent_estimated', rationale: 'check: four aircraft held two days' }) as AssumptionOverride;
  const wantA = expectS2(e417, baseline, [ov]);
  const delayRow = results(s2a.id).find(r => r.key === `line:${delayId}`);
  check('an agent_estimated assumption replaces the blank row\'s $0 and the trace names it', same(results(s2a.id), wantA) && Math.abs((delayRow?.p50 ?? 0) - 20000) < 1500 && delayRow!.detailJson.includes('agent_estimated'), `${firstDiff(results(s2a.id), wantA)} delay p50 ${delayRow?.p50}`);

  // ---- an unreadable assumption is reported, not dropped ---------------------------------------------
  await R.recordAssumption({ prId: p423.id, key: 'recovery:BW-9440-030', distJson: JSON.stringify({ kind: 'weird' }), source: 'agent_estimated', rationale: 'check: a bad shape', affects: ['s2_cost'], expectedRev: 0 });
  const s2bad = await until(() => {
    const r = current(p423.id, 's2_cost');
    return r && r.id !== s2b.id && r.status === 'done' && results(r.id).length > 0 && r;
  }, 60000, 's2 with the bad assumption');
  const errRow = results(s2bad.id).find(r => r.key === 'assumption_errors');
  check('an assumption the library cannot take is reported in its own row', !!errRow && errRow.detailJson.includes('unknown kind'), errRow?.detailJson);

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
  const badOv = { key: 'recovery:BW-9440-030', distJson: JSON.stringify({ kind: 'weird' }) };
  const wantN = [...expectS2(e423, baseline), { ...results(s2n.id).at(-1)! }].slice(0, results(s2n.id).length);
  check('a new baseline is recorded and every open ECR is re-checked on it', run(s2bad.id).status === 'stale' && same(results(s2n.id).filter(r => r.key !== 'assumption_errors'), expectS2(e423, baseline)), `${badOv.key}; ${firstDiff(results(s2n.id).filter(r => r.key !== 'assumption_errors'), wantN.filter(r => r.key !== 'assumption_errors'))}`);

  // ---- an ECR with no change request keeps the mock handlers ----------------------------------------
  await R.createPr({ plmEcrNumber: '', title: `check pipeline: no change request ${stamp}`, description: 'check' });
  const bare = await until(() => [...db.pullRequest.iter()].find(p => p.title === `check pipeline: no change request ${stamp}`), 5000, 'the bare ECR');
  const s2m = await doneRun(bare.id, 's2_cost');
  check('an ECR with no change request gets mock results, labelled mock', results(s2m.id).every(r => r.mock), results(s2m.id).map(r => r.key).join(','));

  // ---- the module refuses a change request for another ECR ------------------------------------------
  const wrong = await rejects(R.ingestEcr({ plmEcrNumber: e423.id, title: 'x', description: '', changeRequestJson: JSON.stringify({ ...e417 }), source: 'stub', sourceRef: 'wrong' }));
  const notObj = await rejects(R.ingestEcr({ plmEcrNumber: `ECR-X-${stamp}`, title: 'x', description: '', changeRequestJson: '[1,2]', source: 'stub', sourceRef: 'x' }));
  check('ingest refuses a change request for another ECR, or one that is not an object', wrong?.name === 'SenderError' && notObj?.name === 'SenderError' && !byNumber(`ECR-X-${stamp}`), `${wrong?.message} | ${notObj?.message}`);

  // Leave the scratch database tidy: close what this run opened.
  for (const p of [p417, p423, bare]) await R.setPrStatus({ prId: p.id, status: 'closed' }).catch(() => {});
} catch (e) {
  check('the pipeline run finished', false, (e as Error).message);
  console.log(workerLog.join('').split('\n').slice(-40).join('\n'));
} finally {
  worker.kill();
  A.close();
  rmSync(tmp, { recursive: true, force: true });
}
const ok = finish();
process.exit(ok ? 0 : 1);
