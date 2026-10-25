// Fills a SCRATCH database with the rows the web's gate and ERP-package views show, so they can be looked at
// in live mode (VITE_NORN_SOURCE=live VITE_NORN_DB=<db>). It never reads or writes the PLM or ERPNext: the
// ECRs come from Bowman's dataset through the stub feed, the checks run on a baseline file, and the ERP change
// package is a hand-made one recorded with record_erp_package (the real one needs ERPNext).
//
//   cd norn/module && spacetime publish -s local -p . norn-uipkg-<hex> -y
//   cd norn/workers && NORN_DB=norn-uipkg-<hex> npx tsx ../web/scripts/seed-gate-rows.ts            # stage 1
//   cd norn/workers && NORN_DB=norn-uipkg-<hex> npx tsx ../web/scripts/seed-gate-rows.ts --pending  # stage 2
//
// Stage 1 leaves, in the order it makes them:
//   ECR-0423  approved on the fast track by Norn's agent, released as ECO-0423, with an ERP change package that
//             has lines in every status and two problems (labour hours, a zero price)
//   ECR-0417  in review, with a recommendation made on revision 1 (superseded by an edit) and one on the current
//             revision, with its reasons and recipients
//   ECR-0431  a copy of ECR-0423's change request, approved at the technical-review tier by a person
// Stage 2 stops the cost worker and moves the baseline, so ECR-0431's approval is left pending a re-check.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { COMPANY_CONFIG_KEY, canonicalJson, loadConfigFile } from '../../config/src/index.ts';
import { costCheck, type Baseline, type ChangeRequest } from '../../checks/src/index.ts';
import { DB, connect, subscribe, type Client, type Who } from '../../workers/src/connect.ts';
import { ingestOnce, stubSource } from '../../workers/src/ingest.ts';
import { releaseOf } from '../../workers/src/release.ts';
import { CODE, TABLES, kit } from '../../workers/src/testkit.ts';

if (!/^norn-uipkg-[0-9a-f]+$/.test(DB)) {
  console.error('This seeds a scratch database named norn-uipkg-<hex>. Set NORN_DB to one you published for this.');
  process.exit(2);
}
const pending = process.argv.includes('--pending');
const here = dirname(fileURLToPath(import.meta.url));
const WORKERS = join(here, '..', '..', 'workers');
const BOWMAN = join(here, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts');
const state = join(tmpdir(), `${DB}-seed`);
const ecrDir = join(state, 'ecrs');
const baselineFile = join(state, 'baseline.json');
const SEED = 'norn-seed-1';
mkdirSync(ecrDir, { recursive: true });
const cacheDir = mkdtempSync(join(tmpdir(), 'norn-uipkg-cache-'));

const loaded = await loadConfigFile(BOWMAN);
if (!loaded.ok) throw new Error('the Bowman configuration is not valid');
const bowmanText = canonicalJson(loaded.config);

const baselineOf = (b: typeof bowman): Baseline => ({
  programs: b.programs, workCenters: b.workCenters, items: b.items, bom: b.bom, sourcing: b.sourcing, stock: b.stock, volumePlan: b.volumePlan, builtAircraft: b.builtAircraft,
});
type Ecr = ChangeRequest & { title: string; description: string; eco?: string };
const ecrOf = (id: string, as: string) => ({ ...structuredClone(bowman.ecrs.find(e => e.id === id)!), id: as }) as unknown as Ecr;
const putEcr = (e: object & { id: string }) => writeFileSync(join(ecrDir, `${e.id}.json`), JSON.stringify(e));

type Proc = { child: ChildProcess; out: string[]; stop: () => Promise<void> };
function startWorker(label: string, stages: string, withConfig: boolean): Proc {
  const env: Record<string, string | undefined> = {
    ...process.env, NORN_DB: DB, WORKER_NAME: `uipkg-${label}`, NORN_STAGES: stages, NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24',
    NORN_BASELINE_POLL_MS: '1000', NORN_ERP_SETTINGS: '', NORN_BASELINE_CACHE_DIR: join(cacheDir, label),
  };
  if (withConfig) env.NORN_COMPANY_CONFIG = BOWMAN;
  else delete env.NORN_COMPANY_CONFIG;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd: WORKERS, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const out: string[] = [];
  child.stdout!.on('data', d => out.push(String(d)));
  child.stderr!.on('data', d => out.push(String(d)));
  return { child, out, stop: () => new Promise<void>(res => { if (child.exitCode !== null) return res(); child.once('exit', () => res()); child.kill(); }) };
}

const as = (kind: Who['kind'], name: string, onBehalfOf?: string) =>
  connect({ kind, name, origin: kind === 'person' ? 'human' : 'norn', spawnedBy: 'Norn', ...(onBehalfOf ? { onBehalfOf } : {}) }, { persistToken: false, quiet: true });

if (pending) {
  // ---- stage 2: only the general worker, so the cost check cannot finish on the new baseline -------------
  const general = startWorker('general2', 's1_bom_delta,s3_timeline,s4_supply', true);
  const A = await as('agent', 'uipkg-seed');
  await subscribe(A.conn, [...TABLES, 'SELECT * FROM baseline_snapshot', 'SELECT * FROM approval']);
  const { db, until } = kit(A);
  const before = [...db.baselineSnapshot.iter()].find(b => b.current)!.hash;
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline;
  const untouched = baseline.items.find(i => !['BW-5120-210', 'BW-9440-030'].includes(i.code) && i.standardCost !== undefined)!;
  baseline.items.find(i => i.code === untouched.code)!.standardCost! += 1;
  writeFileSync(baselineFile, JSON.stringify(baseline));
  await until(() => [...db.baselineSnapshot.iter()].find(b => b.current)!.hash !== before || undefined, 60000, 'the new baseline to be recorded');
  const pr = [...db.pullRequest.iter()].find(p => p.plmEcrNumber === 'ECR-0431')!;
  await until(() => [...db.approval.iter()].find(a => a.prId === pr.id && a.status === 'standing' && a.pendingRecheck) || undefined, 30000, 'ECR-0431 to wait for its re-check');
  console.log('ECR-0431: approval pending a re-check');
  A.close();
  await general.stop();
  process.exit(0);
}

// ---- stage 1 ---------------------------------------------------------------------------------------------
const baseline = structuredClone(baselineOf(bowman));
writeFileSync(baselineFile, JSON.stringify(baseline));
const e423 = ecrOf('ECR-0423', 'ECR-0423');
const e417 = ecrOf('ECR-0417', 'ECR-0417');
const e431 = { ...ecrOf('ECR-0423', 'ECR-0431'), title: `${e423.title} (copy, for the re-check view)` };
for (const e of [e423, e417, e431]) putEcr(e);

const general = startWorker('general', 's1_bom_delta,s3_timeline,s4_supply', true);
const cost = startWorker('cost', 's2_cost', false);
const A = await as('agent', 'norn-level1'); // Norn's own agent
const dana = await as('person', 'Dana Okafor'); // the CM analyst, who releases
const priya = await as('person', 'Priya Venkataraman'); // chairs the Technical Review Committee
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot', 'SELECT * FROM approval', 'SELECT * FROM recommendation', 'SELECT * FROM impact_statement', 'SELECT * FROM eco_release', 'SELECT * FROM erp_package']);
const { R, db, until, pr, current } = kit(A);
const byNumber = (n: string) => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === n);
const settled = (id: bigint) => CODE.every(s => current(id, s)?.status === 'done');
const settledOn = (id: bigint) => until(() => settled(id) || undefined, 120000, `ECR ${id} to have every code check done`);

const answers = [
  { testId: 'no_form_fit_function_change', holds: true, evidence: 'Same geometry and interface.' },
  { testId: 'same_supplier_no_tooling', holds: true, evidence: 'Same supplier, no tooling.' },
  { testId: 'authorized_equivalent', holds: true, evidence: 'On the authorized list.' },
  ...loaded.config.approval.neverFastTrack.filter(t => !t.whenClass).map(t => ({ testId: t.id, holds: false, evidence: 'Checked: no.' })),
];
const fastTrack = (prId: bigint) => A.R.requestFastTrackApproval({ prId, answers, companyClass: 'II', regulatoryClass: 'minor', triggers: [] });
const statement = (who: Client, prId: bigint) =>
  who.R.postImpactStatement({
    prId, level: 1, changeClass: 'Class II, FAA minor', route: 'Fast track', headline: 'Fern read the cost check and the change request; the figures below are the check’s own.',
    numbers: [{ key: 'open_questions', label: 'Open questions for the board', unit: '', p10: 0, p50: 0, p90: 0, evidence: 'judgment', resultKey: '' }], drivers: [], assumptions: [], claims: [{ text: 'Same supplier, no tooling, no change to form, fit or function.', evidence: 'judgment' }],
  });

try {
  await until(() => db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value === bowmanText || undefined, 90000, "the worker to store Bowman's configuration");
  const source = stubSource(ecrDir);
  const sent = new Map<string, string>();
  const log = (m: string) => console.log(`  ingest: ${m}`);
  await ingestOnce(R, source, sent, log);
  const p423 = await until(() => byNumber('ECR-0423'), 5000, 'ECR-0423');
  const p417 = await until(() => byNumber('ECR-0417'), 5000, 'ECR-0417');
  const p431 = await until(() => byNumber('ECR-0431'), 5000, 'ECR-0431');
  for (const p of [p423, p417, p431]) await settledOn(p.id);
  for (const p of [p423, p417, p431]) {
    // ingest_ecr opened them in review already.
    await statement(A, p.id);
  }

  // ---- ECR-0423: fast track, release, change order number, package -------------------------------------
  await fastTrack(p423.id);
  await until(() => pr(p423.id).status === 'approved' || undefined, 10000, 'ECR-0423 to be approved on the fast track');
  console.log('ECR-0423: approved on the fast track');
  await dana.R.setPrStatus({ prId: p423.id, status: 'merged' });
  await until(() => pr(p423.id).status === 'merged' || undefined, 10000, 'ECR-0423 to be released');
  putEcr({ ...e423, eco: 'ECO-0423' });
  await ingestOnce(R, source, sent, log);
  await until(() => db.ecoRelease.prId.find(p423.id), 5000, 'the change order number');
  for (const p of [p417, p431]) await settledOn(p.id);

  const s2 = [...db.checkRun.iter()].filter(r => r.prId === p423.id && r.stage === 's2_cost' && r.status === 'done').sort((a, b) => Number(b.id - a.id))[0]!;
  const cr = JSON.parse(JSON.stringify(e423)) as ChangeRequest;
  const { release, notes } = releaseOf(cr, costCheck(baseline, cr, { seed: SEED }), { eco: 'ECO-0423', decision: { id: 'ECR-0423 (assessment run)', url: 'https://norn.example.com/ecr/ECR-0423' }, releasedOn: '2026-10-24' });
  // Two changes the assessment costs but the package cannot carry out: they are problems, not silence.
  release.unsupported = [
    'BW-9440-030 labor hours 0.40 -> 0.55: ERPNext holds labor as BOM operation time, which this package does not enter. The assessment costs the change; enter the new operation time by hand.',
    'BW-9440-031 standard cost 4.20 -> 0.00: the package enters only standard costs above zero. The assessment costs the change; set the new price by hand if a zero cost is intended.',
  ];
  const trace = { eco: 'ECO-0423', ecr: 'ECR-0423', decisionId: 'ECR-0423', decisionUrl: 'https://norn.example.com/ecr/ECR-0423' };
  const line = (id: string, kind: string, title: string, enteredBy: string, doctype: string, status: string, instruction: string, fields: object[], tables: object[] = [], note?: string) =>
    ({ id, kind, title, enteredBy, doctype, mode: 'new', path: '/app/' + doctype.toLowerCase().replace(/ /g, '-') + '/new', instruction, fields, tables, amounts: {}, trace, status, ...(note ? { note } : {}) });
  const lines = [
    line('standard-cost-close:BW-9440-030', 'standard-cost-close', 'BW-9440-030: close the current standard cost', 'cost accountant', 'Item Price', 'entered', 'End the current price of BW-9440-030 the day before the new one starts.',
      [{ field: 'item_code', label: 'Item', value: 'BW-9440-030' }, { field: 'valid_upto', label: 'Valid up to', value: '2027-08-31' }]),
    line('standard-cost:BW-9440-030', 'standard-cost', 'BW-9440-030: new standard cost 39.60 from 2027-09-01', 'cost accountant', 'Item Price', 'to-enter', 'Create an Item Price for BW-9440-030 at 39.60 on the standard cost list, valid from 2027-09-01.',
      [{ field: 'item_code', label: 'Item', value: 'BW-9440-030' }, { field: 'price_list_rate', label: 'Rate', value: 39.6, money: true }, { field: 'valid_from', label: 'Valid from', value: '2027-09-01' }, { field: 'eco', label: 'ECO', value: 'ECO-0423' }]),
    line('bom:VES-V4-CLOSEOUT', 'bom', 'Avionics bay closeout: new BOM version', 'manufacturing engineer', 'BOM', 'to-enter', 'Duplicate the active BOM of the closeout assembly and swap BW-9440-030 Rev A for Rev B.',
      [{ field: 'item', label: 'Item', value: 'VES-V4-CLOSEOUT' }, { field: 'quantity', label: 'Quantity', value: 1 }],
      [{ table: 'items', label: 'Items', rows: [[{ field: 'item_code', label: 'Item', value: 'BW-9440-030' }, { field: 'qty', label: 'Qty', value: 1 }]] }]),
    line('bom-replace:VES-V4', 'bom-replace', 'Vesper V4: use the new closeout BOM', 'manufacturing engineer', 'BOM', 'to-enter', 'In the Vesper V4 top-level BOM, point the closeout line at the new BOM.',
      [{ field: 'bom_no', label: 'BOM', value: null, from: 'bom:VES-V4-CLOSEOUT' }]),
    line('bom-retire:VES-V4-CLOSEOUT', 'bom-retire', 'Avionics bay closeout: retire the old BOM', 'manufacturing engineer', 'BOM', 'conflict', 'Deactivate the old closeout BOM once the new one is in use.',
      [{ field: 'is_active', label: 'Active', value: 0 }], [], 'The old BOM is still the default one in ERPNext, and the new one is not. Enter the lines above first.'),
  ];
  const pkg = {
    version: 1, release, erpUrl: 'https://erp.example.com', readAt: new Date().toISOString(), lines,
    counts: { total: lines.length, entered: 1, toEnter: 3, conflict: 1 },
    effects: [{ program: 'Vesper', topItem: 'VES-V4', name: 'Vesper V4', costDelta: -11.4, basis: '6 x BW-9440-030 per aircraft x a change of (1.90)' }],
    warnings: ['The new standard cost applies from 2027-09-01. ERPNext costs the new BOMs at the old price until then.'],
    problems: release.unsupported.map(u => `not in this package: ${u}`),
  };
  const baselineHash = [...db.baselineSnapshot.iter()].find(b => b.current)!.hash;
  await A.R.recordErpPackage({
    prId: p423.id, ecoNumber: 'ECO-0423', s2RunId: s2.id, erpBaseline: baselineHash, releaseJson: JSON.stringify(release), packageJson: JSON.stringify(pkg),
    lines: lines.length, entered: 1, conflicts: 1, notesJson: JSON.stringify({ notes: [...notes, 'The grey stock is used up first, so nothing is written off.'], problems: [], mock: 'Hand-made rows from web/scripts/seed-gate-rows.ts: the lines, their statuses, the problems and the effect were not read from ERPNext.' }),
  });
  console.log('ECR-0423: released as ECO-0423, package recorded (hand-made lines, 2 problems)');

  // ---- ECR-0417: a recommendation, then an edit that supersedes it, then a new one --------------------------
  const rev0 = pr(p417.id).revision;
  await fastTrack(p417.id);
  await until(() => [...db.recommendation.iter()].some(r => r.prId === p417.id) || undefined, 10000, 'the first recommendation');
  await R.editPrText({ prId: p417.id, description: `${pr(p417.id).description}\n\nClarification: the old stock is scrapped, not reworked.` });
  await until(() => pr(p417.id).revision > rev0 || undefined, 10000, 'the edit to move ECR-0417 to a new revision');
  await settledOn(p417.id);
  await statement(A, p417.id);
  await fastTrack(p417.id);
  await until(() => [...db.recommendation.iter()].filter(r => r.prId === p417.id).length === 2 || undefined, 10000, 'the second recommendation');
  console.log(`ECR-0417: recommendations on revisions ${rev0} and ${pr(p417.id).revision}`);

  // ---- ECR-0431: approved at the technical-review tier by a person ----------------------------------------
  await priya.R.setPrStatus({ prId: p431.id, status: 'approved' });
  await until(() => pr(p431.id).status === 'approved' || undefined, 10000, 'ECR-0431 to be approved');
  console.log('ECR-0431: approved by Priya Venkataraman');
} finally {
  for (const c of [A, dana, priya]) c.close();
  await cost.stop();
  await general.stop();
}
process.exit(0);
