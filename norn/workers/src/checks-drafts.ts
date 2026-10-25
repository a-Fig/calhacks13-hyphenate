// End-to-end check of Fern's ERP drafts (Tyler, 2026-10-25, reversing #71) on a scratch database and the live ERPNext:
// ECR-0417 is taken in and assessed by a real worker on the ERP baseline, approved, its ECO released (the PLM's part is
// simulated on the scratch database: nothing is filed or approved in the PLM), and the worker builds the change package
// and saves the drafts. Then the ECR page's view of the package is read, and the worker is restarted to show that it
// makes no second draft. Afterwards undo the drafts with bowman/erp/reset-eco.ts <ECO>.
//
//   NORN_DB=fern-erpdraft-<random> ENV_FILE=<.env> NORN_WEB_URL=http://127.0.0.1:5180 npm run check:drafts   (from norn/)
//   CHECK_ECO=ECO-0319 to tag the drafts with a real number (default: a made-up ECO-E2E-<stamp>)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import type { ChangeRequest } from '../../checks/src/index.ts';
import { connectionFromEnv, loadEnvFile } from '../../connectors/erpnext/src/index.ts';
import { packageView } from '../../web/src/assessment/live/gate.ts';
import { DB, connect, subscribe } from './connect.ts';
import { ingestOnce, stubSource } from './ingest.ts';
import { TABLES, kit, recorder } from './testkit.ts';

if (['norn', 'norn-test', 'norn-mcp', 'norn-live', 'norn-ui', 'norn-l1'].includes(DB)) throw new Error(`check:drafts runs a worker of its own: point NORN_DB at a scratch database, not ${DB}`);
loadEnvFile();
const erp = connectionFromEnv();

const { check, finish } = recorder();
const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'fern-drafts-'));
const ecrDir = join(tmp, 'ecrs');
mkdirSync(ecrDir, { recursive: true });
const stamp = Date.now().toString(36);
const ECO = process.env.CHECK_ECO ?? `ECO-E2E-${stamp}`;
const ECR = 'ECR-0417';
const e417 = structuredClone(bowman.ecrs.find(e => e.id === ECR)!) as ChangeRequest & { title: string };
writeFileSync(join(ecrDir, `${ECR}.json`), JSON.stringify(e417));

const workerLog: string[] = [];
function startWorker(n: number): ChildProcess {
  const w = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    cwd: join(here, '..'),
    env: {
      ...process.env, NORN_DB: DB, WORKER_NAME: `drafts-worker-${stamp}-${n}`, NORN_ERP_SETTINGS: resolve(here, '../../../bowman/norn-config/erpnext.ts'),
      NORN_BASELINE_POLL_MS: '600000', NORN_PACKAGE_POLL_MS: '3000', NORN_PACKAGE_RECHECK_MS: '5000', NORN_BASELINE_CACHE_DIR: join(tmp, 'worker-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (d: Buffer) => { for (const l of String(d).split(/\r?\n/).filter(Boolean)) workerLog.push(`[worker ${n}] ${l}`); };
  w.stdout!.on('data', keep);
  w.stderr!.on('data', keep);
  return w;
}
const stop = async (w: ChildProcess) => { if (w.exitCode === null) { w.kill(); await new Promise(r => w.once('exit', r)); } };

/** Fern's documents for the ECO in ERPNext, read with Fern's own token. */
async function inErp(): Promise<Record<string, any>[]> {
  const get = async (doctype: string, fields: string[]) => {
    const u = new URL(`${erp.url.replace(/\/+$/, '')}/api/resource/${encodeURIComponent(doctype)}`);
    u.searchParams.set('filters', JSON.stringify([['bw_eco', '=', ECO], ['docstatus', '<', 2]]));
    u.searchParams.set('fields', JSON.stringify(fields));
    u.searchParams.set('limit_page_length', '0');
    const r = await fetch(u, { headers: { Authorization: `token ${erp.apiKey}:${erp.apiSecret}`, Accept: 'application/json' } });
    return ((await r.json()) as { data: Record<string, any>[] }).data;
  };
  return [
    ...(await get('BOM', ['name', 'item', 'docstatus', 'bw_eco', 'bw_decision_url'])).map(d => ({ doctype: 'BOM', ...d })),
    ...(await get('Journal Entry', ['name', 'docstatus', 'bw_eco', 'bw_eco_entry', 'bw_decision_url'])).map(d => ({ doctype: 'Journal Entry', ...d })),
  ];
}

let worker = startWorker(1);
const A = await connect({ kind: 'agent', name: 'check-drafts', origin: 'norn', spawnedBy: 'Fern' }, { persistToken: false, quiet: true });
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot', 'SELECT * FROM eco_release', 'SELECT * FROM erp_package']);
const { R, db, until, current } = kit(A);
console.log(`checking database '${DB}', ECO ${ECO}, ERPNext ${erp.url}`);
const quiet = () => {};

try {
  check('ERPNext holds nothing for the ECO before the release', (await inErp()).length === 0, JSON.stringify(await inErp()));
  const sent = new Map<string, string>();
  await ingestOnce(R, stubSource(ecrDir), sent, quiet);
  const pr = await until(() => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === ECR), 10000, `${ECR} to be taken in`);
  for (const stage of ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'])
    await until(() => current(pr.id, stage)?.status === 'done' && current(pr.id, stage), 240000, `${stage} on ${ECR} to finish`);
  console.log(`assessed ${ECR}`);

  // The CCB approves and the PLM releases the ECO and links it back: simulated on this database only.
  await R.setPrStatus({ prId: pr.id, status: 'approved' });
  writeFileSync(join(ecrDir, `${ECR}.json`), JSON.stringify({ ...e417, eco: ECO }));
  await ingestOnce(R, stubSource(ecrDir), sent, quiet);
  await until(() => db.ecoRelease.prId.find(pr.id), 10000, 'the change order number');
  await R.setPrStatus({ prId: pr.id, status: 'merged' });
  const released = Date.now();

  const row = (await until(() => {
    const r = db.erpPackage.prId.find(pr.id);
    return r && (JSON.parse(r.packageJson).counts?.drafted ?? 0) > 0 && r;
  }, 180000, 'the package with its drafts'))!;
  console.log(`package with drafts recorded ${((Date.now() - released) / 1000).toFixed(1)} s after the release`);
  const pkg = JSON.parse(row.packageJson);
  const first = await inErp();
  const wantUrl = `${(process.env.NORN_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')}/ecr/${ECR}`;
  check('the drafts appear in ERPNext as docstatus 0 with the ECO tag', first.length > 0 && first.every(d => d.docstatus === 0 && d.bw_eco === ECO), JSON.stringify(first));
  check('each draft links to Fern\'s ECR page, the PLM\'s impact_norn_url', first.every(d => d.bw_decision_url === wantUrl), `${wantUrl} vs ${first.map(d => d.bw_decision_url).join(', ')}`);
  check('the journal entries carry their ECO entry key', first.filter(d => d.doctype === 'Journal Entry').every(d => !!d.bw_eco_entry), '');
  check('the package shows the drafts as drafted, no conflicts', pkg.counts.drafted === first.length && pkg.counts.conflict === 0, JSON.stringify(pkg.counts));

  const view = packageView(row as never);
  if (view.state !== 'built') throw new Error(`the ECR page cannot read the package: ${JSON.stringify(view)}`);
  const drafted = view.groups.flatMap(g => g.lines).filter(l => l.draft);
  console.log('\nECR page, ERP change package:');
  console.log(`  ${view.headline}`);
  for (const g of view.groups) for (const l of g.lines) console.log(`  [${l.statusText}] ${l.title}${l.draft ? `\n      ${l.draft.doctype} ${l.draft.name} (${l.draft.url}): Draft in ERPNext, waiting for ${l.draft.waitingFor} to submit.` : ''}`);
  check('the ECR page shows each draft with its link and who submits it', drafted.length === first.length && drafted.every(l => /\/app\/(bom|journal-entry)\//.test(l.draft!.url) && /\(.+\)$/.test(l.draft!.waitingFor)), JSON.stringify(drafted.map(l => l.draft)));

  // A restart: a new worker reads the ERP again and checks the package; it must find the drafts and save nothing.
  await stop(worker);
  const before = row.updatedAt.microsSinceUnixEpoch;
  const restarted = Date.now();
  worker = startWorker(2);
  await until(() => {
    const r = db.erpPackage.prId.find(pr.id);
    return r && r.updatedAt.microsSinceUnixEpoch > before && r;
  }, 120000, 'the restarted worker to check the package again');
  await new Promise(r => setTimeout(r, 8000)); // and one more cycle
  const after = await inErp();
  console.log(`\nrestarted worker checked the package ${((Date.now() - restarted) / 1000).toFixed(1)} s after the restart`);
  check('a worker restart creates no duplicates', JSON.stringify(after.map(d => d.name).sort()) === JSON.stringify(first.map(d => d.name).sort()), `${first.map(d => d.name)} -> ${after.map(d => d.name)}`);
  check('the restarted worker logs no new drafts', !workerLog.some(l => l.startsWith('[worker 2]') && /could not save/.test(l)), '');

  console.log('\nDrafts in ERPNext:');
  for (const d of after) console.log(`  ${d.doctype} ${d.name}  ${erp.url.replace(/\/+$/, '')}/app/${d.doctype.toLowerCase().replace(/\s+/g, '-')}/${d.name}  ${d.bw_eco_entry ?? d.item}  docstatus ${d.docstatus}  ${d.bw_decision_url}`);
} catch (e) {
  console.log(workerLog.slice(-40).join('\n'));
  throw e;
} finally {
  await stop(worker);
  console.log(`\nworker log lines about the package:\n${workerLog.filter(l => /ERP change package|draft/i.test(l)).join('\n')}`);
  console.log(`\nUndo with: node bowman/erp/reset-eco.ts ${ECO}`);
}
finish();
process.exit(0);
