// End-to-end check of the ERP change package (#72) on a scratch database: an ECR is ingested and
// assessed by a worker, approved and released; the PLM's change order number arrives; and the package
// job builds the package from the assessment, records it, leaves it alone on the same ERP read, and
// checks it again on a new one. The connector's planner reads ERPNext, so this check gives the job a
// planner of its own that records what it was handed: what the planner makes of a release is the
// connector's to test (norn/connectors/erpnext/test).
//   NORN_DB=norn-pipe npm run check:package     (from norn/)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { type Baseline, type ChangeRequest } from '../../checks/src/index.ts';
import { hashOf, type EcoRelease } from '../../connectors/erpnext/src/index.ts';
import { BaselineStore, type BaselineSource } from './baseline.ts';
import { DB, connect, subscribe, withRetry } from './connect.ts';
import { ingestOnce, stubSource } from './ingest.ts';
import { packageOnce, type Planner } from './package.ts';
import { TABLES, kit, recorder, rejects } from './testkit.ts';

if (DB === 'norn') throw new Error('check:package runs a worker of its own: point NORN_DB at a scratch database, not norn');

const { check, finish } = recorder();
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'norn-pkg-'));
const ecrDir = join(tmp, 'ecrs');
const baselineFile = join(tmp, 'baseline.json');
const stamp = Date.now().toString(36);
const SEED = 'norn-seed-1';
const ECO = `ECO-T${stamp}`;

const baseline: Baseline = structuredClone({
  programs: bowman.programs, workCenters: bowman.workCenters, items: bowman.items, bom: bowman.bom, sourcing: bowman.sourcing, stock: bowman.stock, volumePlan: bowman.volumePlan, builtAircraft: bowman.builtAircraft,
}) as Baseline;
writeFileSync(baselineFile, JSON.stringify(baseline));
const e417 = { ...structuredClone(bowman.ecrs.find(e => e.id === 'ECR-0417')!), id: `ECR-0417-${stamp}` } as ChangeRequest & { title: string };
(await import('node:fs')).mkdirSync(ecrDir, { recursive: true });
writeFileSync(join(ecrDir, `${e417.id}.json`), JSON.stringify(e417));

// A worker on the baseline file assesses the ECR. It has no ERP, so it must build no packages.
const workerLog: string[] = [];
const worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
  cwd: join(here, '..'),
  env: { ...process.env, NORN_DB: DB, WORKER_NAME: `pkg-worker-${stamp}`, NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24', NORN_BASELINE_POLL_MS: '600000', NORN_ERP_SETTINGS: '', NORN_BASELINE_CACHE_DIR: join(tmp, 'worker-cache') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
worker.stdout.on('data', d => workerLog.push(String(d)));
worker.stderr.on('data', d => workerLog.push(String(d)));

const A = await connect({ kind: 'agent', name: 'check-package', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot', 'SELECT * FROM eco_release', 'SELECT * FROM erp_package']);
const { R, db, until, current, logs } = kit(A);
console.log(`checking database '${DB}'`);

// The job's own baseline store, on a source this check can move.
let erpNow = baseline;
const source: BaselineSource = {
  kind: 'file',
  describe: 'the check baseline',
  read: async () => ({ baseline: erpNow, hash: hashOf(erpNow), asOf: '2026-10-24', source: 'file', counts: { items: erpNow.items.length }, warnings: [] }),
};
const store = new BaselineStore(
  source,
  r => withRetry(() => R.recordBaseline({ hash: r.hash, asOf: r.asOf, source: r.source, countsJson: JSON.stringify(r.counts), warningsJson: '[]' }), { idempotent: true, label: 'record_baseline' }).then(() => undefined),
  join(tmp, 'job-cache')
);
// Released ECOs an earlier run on this database left are re-checked too; this check follows its own.
const handed: EcoRelease[] = [];
let enteredNow = 0;
const planner: Planner = async release => {
  if (release.ecr === e417.id) handed.push(release);
  const lines = release.items.length + (release.bomChanges?.length ?? 0) + (release.journals?.length ?? 0);
  return { packageJson: JSON.stringify({ check: true, eco: release.eco, lines, entered: enteredNow }), lines, entered: enteredNow, conflicts: 0, problems: [] };
};
const opts = { webUrl: 'https://norn.example.com/', timeZone: 'America/Los_Angeles' };
const quiet = () => {};
const pkgLogs = (prId: bigint) => logs(l => l.entity === `erp_package:${prId}` && l.outcome === 'applied');

try {
  await ingestOnce(R, stubSource(ecrDir), new Map(), quiet);
  const pr = await until(() => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === e417.id), 5000, `${e417.id} to be filed`);
  for (const stage of ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'])
    await until(() => current(pr.id, stage)?.status === 'done' && current(pr.id, stage), 90000, `${stage} on ${e417.id} to finish`);
  const s2 = current(pr.id, 's2_cost')!;

  // ---- the module's refusals before the release ---------------------------------------------------
  const early = await rejects(R.recordErpPackage({ prId: pr.id, ecoNumber: ECO, s2RunId: s2.id, erpBaseline: 'x', releaseJson: '{}', packageJson: '{}', lines: 0, entered: 0, conflicts: 0, notesJson: '{}' }));
  check('a package is refused while the ECR is not released', !!early && /released ECO/.test(early.message), early?.message);
  await R.setPrStatus({ prId: pr.id, status: 'review' });
  await R.setPrStatus({ prId: pr.id, status: 'approved' });
  // The PLM releases the ECO: the feed now carries its number, and ingest records it.
  writeFileSync(join(ecrDir, `${e417.id}.json`), JSON.stringify({ ...e417, eco: ECO }));
  const sent = new Map<string, string>();
  await ingestOnce(R, stubSource(ecrDir), sent, quiet);
  await until(() => db.ecoRelease.prId.find(pr.id), 5000, 'the change order number');
  const revs = [...db.ecrRevision.iter()].filter(r => r.prId === pr.id).length;
  await ingestOnce(R, stubSource(ecrDir), sent, quiet);
  const renumber = await rejects(R.recordEcoRelease({ plmEcrNumber: e417.id, ecoNumber: `${ECO}-B`, source: 'stub', sourceRef: 'check' }));
  check('ingest records the change order number once, without a new revision, and a different number is refused', db.ecoRelease.prId.find(pr.id)?.ecoNumber === ECO && revs === 1 && /keeps its number/.test(renumber?.message ?? ''), `${revs} revision(s); ${renumber?.message}`);
  await R.setPrStatus({ prId: pr.id, status: 'merged' });
  await until(() => db.pullRequest.id.find(pr.id)?.status === 'merged', 5000, 'the release');
  worker.kill(); // from here only the job's own store records baselines
  check('a worker with no ERP builds no package', !workerLog.join('').includes('ERP change package for'), '');

  // ---- the job builds the package from the assessment -----------------------------------------------
  await store.refresh(quiet);
  const first = await packageOnce(A.conn, R, store, planner, opts, quiet);
  const row = await until(() => db.erpPackage.prId.find(pr.id) ?? undefined, 5000, 'the package row');
  const release = JSON.parse(row.releaseJson) as EcoRelease;
  check('the job builds one package for the released ECO, from its last cost assessment', first.built >= 1 && handed.length === 1 && row.s2RunId === s2.id && row.ecoNumber === ECO && row.lines === 4, `${JSON.stringify(first)} lines ${row.lines}`);
  check('the new standard cost is the ECR\'s new price, at its new revision', JSON.stringify(release.items) === JSON.stringify([{ item: 'BW-5120-210', rev: 'C', standardCost: 221 }]), JSON.stringify(release.items));
  const amounts = (release.journals ?? []).map(j => [j.key, j.lines.map(l => l.amount)]);
  check('the journal entries are the assessment\'s write-downs: stock on hand, units at the supplier, the cancellation charge', JSON.stringify(amounts) === JSON.stringify([['scrap-on-hand', [17620.62, 8810.31]], ['supplier-finished', [11012.88]], ['cancellation', [1118.4]]]), JSON.stringify(amounts));
  const notes = JSON.parse(row.notesJson) as { notes: string[] };
  check('the brackets on built aircraft are left to the retrofit, and the package says so', notes.notes.some(n => /120 x BW-5120-210 Rev B installed on built aircraft/.test(n)), notes.notes.join(' | '));
  check('every line is traced to the ECR page, and the new cost applies from the cut-in', release.decision.url === `https://norn.example.com/ecr/${e417.id}` && release.effectiveDate === '2026-11-01' && release.ecr === e417.id, `${release.decision.url} ${release.effectiveDate}`);
  check('the package is recorded on the ERP read it was checked against', row.erpBaseline === hashOf(baseline) && row.entered === 0, row.erpBaseline.slice(0, 12));

  // ---- the same ERP read: nothing to do --------------------------------------------------------------
  const logsBefore = pkgLogs(pr.id).length;
  const again = await packageOnce(A.conn, R, store, planner, opts, quiet);
  check('on the same ERP read the job leaves the package alone', handed.length === 1 && pkgLogs(pr.id).length === logsBefore, JSON.stringify(again));

  // ---- a new ERP read: a person has entered two lines ------------------------------------------------
  erpNow = structuredClone(baseline);
  erpNow.items = erpNow.items.map(i => (i.code === 'BW-5120-210' ? { ...i, standardCost: 221 } : i));
  enteredNow = 2;
  await store.refresh(quiet);
  const third = await packageOnce(A.conn, R, store, planner, opts, quiet);
  const row2 = await until(() => (db.erpPackage.prId.find(pr.id)?.entered === 2 && db.erpPackage.prId.find(pr.id)) || undefined, 5000, 'the updated package');
  check('a new ERP read checks the package again: entered lines show, on the old assessment', third.built >= 1 && handed.length === 2 && row2.erpBaseline === hashOf(erpNow) && row2.s2RunId === s2.id && pkgLogs(pr.id).length === logsBefore + 1, `${JSON.stringify(third)} ${row2.entered}/${row2.lines}`);
  check('the release is the same on the new read: the amounts come from the assessment, not from the ERP now', handed[1]!.journals!.length === 3 && JSON.stringify(handed[0]) === JSON.stringify(handed[1]), '');
  const summary = pkgLogs(pr.id).at(-1)?.summary ?? '';
  check('the log says how much of the package is entered', summary.includes(`ERP change package for ${ECO}: 2 of 4 line(s) entered`), summary);
} catch (e) {
  check('the package run finished', false, (e as Error).message);
  console.log(workerLog.join('').split('\n').slice(-30).join('\n'));
} finally {
  worker.kill();
  A.close();
  rmSync(tmp, { recursive: true, force: true });
}
const ok = finish();
process.exit(ok ? 0 : 1);
