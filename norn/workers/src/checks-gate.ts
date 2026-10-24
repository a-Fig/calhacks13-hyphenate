// End-to-end check of the company gate (#43) and the fast track (#22) against a live database: the same
// agent request is approved on one ECR and becomes a recommendation on another because of Bowman's
// configuration alone, a person is allowed or refused by the body they chair, an approval stays when
// only the baseline changed and is withdrawn when the re-checked numbers move the ECR to another tier
// or the ECR itself changes, and a release is refused while a re-check is still pending.
//
// It starts two workers of its own on a test baseline file (Bowman's dataset, not the ERP) and feeds
// the ECRs through the stub source, so nothing here reads the ERP or the PLM. One worker runs every
// stage but the cost check; the other runs only the cost check, and is stopped to hold a re-check
// pending. It stores the company configuration, so it needs a scratch database that you publish and
// name in NORN_DB (it will not run against `norn`), with no other worker on it:
//   cd norn/module && spacetime publish -s local -p . norn-gate-1 -y
//   NORN_DB=norn-gate-1 npm run check:gate        (from norn/)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { COMPANY_CONFIG_KEY, canonicalJson, loadConfigFile, sampleValue, type CompanyConfig } from '../../config/src/index.ts';
import { costCheck, type Baseline, type ChangeRequest } from '../../checks/src/index.ts';
import { DB, connect, subscribe, type Client, type Who } from './connect.ts';
import { ingestOnce, stubSource } from './ingest.ts';
import { TABLES, CODE, kit, recorder, rejects } from './testkit.ts';

if (!process.env.NORN_DB || DB === 'norn') {
  console.error('check:gate stores a company configuration and approves ECRs. Publish a scratch database and name it, for example: NORN_DB=norn-gate-1 npm run check:gate');
  process.exit(2);
}

const { check, finish } = recorder();
const here = dirname(fileURLToPath(import.meta.url));
const WORKERS = join(here, '..');
const BOWMAN = join(here, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts');
const tmp = mkdtempSync(join(tmpdir(), 'norn-gate-'));
const ecrDir = join(tmp, 'ecrs');
const baselineFile = join(tmp, 'baseline.json');
const SEED = 'norn-seed-1';
const MEASURE = { horizonMonths: 12, savingsOffset: false };

// ---- the configuration: Bowman's own, and Bowman's without the slip limit ----------------------------
// ECR-0423 states no date for the change to be late against, so the timeline check gives it no slip, and
// Bowman's fast track (which holds a 14-day p90 slip limit) cannot approve it. The second configuration
// takes that one limit out so that the cost limit is what decides.
const loaded = await loadConfigFile(BOWMAN);
if (!loaded.ok) throw new Error(`the example configuration is not valid: ${loaded.issues.map(i => i.message).join('; ')}`);
const bowmanConfig: CompanyConfig = loaded.config;
const noSlip: CompanyConfig = JSON.parse(canonicalJson(bowmanConfig));
for (const a of noSlip.autonomy.actions) if (a.action === 'approve_fast_track_ecr') delete a.limits!.maxP90SlipDays;
const bowmanText = canonicalJson(bowmanConfig);
const noSlipText = canonicalJson(noSlip);
const tierOf = (size: number) => {
  const i = bowmanConfig.approval.tiers.findIndex(t => t.upTo === null || size <= t.upTo);
  return bowmanConfig.approval.tiers[i]!.id;
};

// ---- inputs: the dataset's baseline as a file, its ECRs under their own numbers -----------------------
const baselineOf = (b: typeof bowman): Baseline => ({
  programs: b.programs, workCenters: b.workCenters, items: b.items, bom: b.bom, sourcing: b.sourcing, stock: b.stock, volumePlan: b.volumePlan, builtAircraft: b.builtAircraft,
});
let baseline = structuredClone(baselineOf(bowman));
writeFileSync(baselineFile, JSON.stringify(baseline));
type Ecr = ChangeRequest & { title: string; description: string };
const ecrOf = (id: string, as: string) => ({ ...structuredClone(bowman.ecrs.find(e => e.id === id)!), id: as }) as unknown as Ecr;
// No Bowman ECR is drawn for the blind second check, so one more small ECR carries a number that is.
const drawnId = Array.from({ length: 300 }, (_, i) => `ECR-${String(9000 + i)}`).find(
  id => sampleValue({ sampleSeed: bowmanConfig.autonomy.sampleSeed, ecrId: id, action: 'approve_fast_track_ecr' }) < 0.2,
)!;
const e423 = ecrOf('ECR-0423', 'ECR-0423');
const e417 = ecrOf('ECR-0417', 'ECR-0417');
const eDrawn = ecrOf('ECR-0423', drawnId);
mkdirSync(ecrDir, { recursive: true });
const putEcr = (e: object & { id: string }) => writeFileSync(join(ecrDir, `${e.id}.json`), JSON.stringify(e));
for (const e of [e423, e417, eDrawn]) putEcr(e);
const sizeOf = (b: Baseline, e: Ecr): number => {
  const m = costCheck(b, JSON.parse(JSON.stringify(e)), { seed: SEED, measures: [MEASURE] }).measures[0]!;
  if (m.source !== 'exact') throw new Error(`the library gave no exact measure: ${m.reason}`);
  return m.p90;
};

// ---- two workers of our own ------------------------------------------------------------------------
type Proc = { child: ChildProcess; out: string[]; stop: () => Promise<void> };
function startWorker(label: string, stages: string, withConfig: boolean): Proc {
  const env: Record<string, string | undefined> = {
    ...process.env, NORN_DB: DB, WORKER_NAME: `gate-${label}`, NORN_STAGES: stages, NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24', NORN_BASELINE_POLL_MS: '1000', NORN_ERP_SETTINGS: '',
  };
  if (withConfig) env.NORN_COMPANY_CONFIG = BOWMAN;
  else delete env.NORN_COMPANY_CONFIG;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd: WORKERS, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const out: string[] = [];
  child.stdout!.on('data', d => out.push(String(d)));
  child.stderr!.on('data', d => out.push(String(d)));
  return {
    child,
    out,
    stop: () => new Promise<void>(res => {
      if (child.exitCode !== null) return res();
      child.once('exit', () => res());
      child.kill();
    }),
  };
}
const OTHER_STAGES = 's1_bom_delta,s3_timeline,s4_supply';
const general = startWorker('general', OTHER_STAGES, true);
let costWorker: Proc | undefined;
const startCost = () => (costWorker = startWorker(`cost-${Date.now().toString(36)}`, 's2_cost', false));
const stopCost = async () => {
  await costWorker?.stop();
  costWorker = undefined;
};
startCost();

// ---- people and an agent -----------------------------------------------------------------------------
const as = (kind: Who['kind'], name: string, onBehalfOf?: string) =>
  connect({ kind, name, origin: kind === 'person' ? 'human' : 'norn', spawnedBy: 'Norn', ...(onBehalfOf ? { onBehalfOf } : {}) }, { persistToken: false, quiet: true });
const A = await as('agent', 'check-gate-agent');
const rafael = await as('person', 'Rafael Quintero'); // EMP-01, chairs the Change Control Board
const priya = await as('person', 'Priya Venkataraman'); // EMP-05, chairs the Technical Review Committee
const helen = await as('person', 'Helen Castellanos'); // EMP-14, the CFO, chairs the Program Management Committee
const dana = await as('person', 'Dana Okafor'); // EMP-02, the CM analyst, who releases
const mallory = await as('person', 'Mallory Nobody'); // not in the company's list of people
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot', 'SELECT * FROM approval', 'SELECT * FROM recommendation', 'SELECT * FROM impact_statement']);
const { R, db, until, holds, pr, current, run, logs, mainNow } = kit(A);
console.log(`checking database '${DB}'`);

const byNumber = (n: string) => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === n);
const results = (runId: bigint) => [...db.checkResult.iter()].filter(r => r.checkRunId === runId);
const approvals = (prId: bigint) => [...db.approval.iter()].filter(a => a.prId === prId).sort((a, b) => Number(a.id - b.id));
const standing = (prId: bigint) => approvals(prId).find(a => a.status === 'standing');
const recs = (prId: bigint) => [...db.recommendation.iter()].filter(r => r.prId === prId).sort((a, b) => Number(a.id - b.id));
const mark = () => logs(() => true).reduce((m, l) => (l.id > m ? l.id : m), 0n);
const logAfter = (after: bigint, prId: bigint, reducer: string) => logs(l => l.id > after && l.prId === prId && l.reducer === reducer);
const settled = (prId: bigint) => CODE.every(s => current(prId, s)?.status === 'done');
const settledOn = (prId: bigint, ms = 90000) => until(() => settled(prId) || undefined, ms, `ECR ${prId} to have every code check done`);
const gateOf = (l: { detailJson: string }) => (JSON.parse(l.detailJson) as { gate?: any }).gate;
const texts = (g: any): string => (g?.reasons ?? []).map((r: { text: string }) => r.text).join(' | ');

// ---- the fast-track answers the agent brings (the configuration's own tests) ---------------------------
const answers = [
  { testId: 'no_form_fit_function_change', holds: true, evidence: 'Same geometry and interface.' },
  { testId: 'same_supplier_no_tooling', holds: true, evidence: 'Same supplier, no tooling.' },
  { testId: 'authorized_equivalent', holds: true, evidence: 'On the authorized list.' },
  ...bowmanConfig.approval.neverFastTrack.filter(t => !t.whenClass).map(t => ({ testId: t.id, holds: false, evidence: 'Checked: no.' })),
];
const fastTrack = (who: Client, prId: bigint) => who.R.requestFastTrackApproval({ prId, answers, companyClass: 'II', regulatoryClass: 'minor', triggers: [] });
const statement = (who: Client, prId: bigint) =>
  who.R.postImpactStatement({
    prId, level: 1, changeClass: 'II', route: 'check', headline: 'check: a Level 1 read so the report-level limit is met',
    numbers: [{ key: 'n', label: 'n', unit: 'x', p10: 0, p50: 0, p90: 0, evidence: 'judgment', resultKey: '' }], drivers: [], assumptions: [], claims: [],
  });

try {
  // ---- ingest three ECRs; the real checks run on all of them -----------------------------------------
  const source = stubSource(ecrDir);
  const sent = new Map<string, string>();
  const log = (m: string) => console.log(`  ingest: ${m}`);
  await until(() => db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value === bowmanText || undefined, 60000, "the worker to store Bowman's configuration");
  const first = await ingestOnce(R, source, sent, log);
  const p423 = await until(() => byNumber('ECR-0423'), 5000, 'ECR-0423 to be filed');
  const p417 = await until(() => byNumber('ECR-0417'), 5000, 'ECR-0417 to be filed');
  const pDrawn = await until(() => byNumber(drawnId), 5000, `${drawnId} to be filed`);
  check('three ECRs are filed from the source, and the worker stored the company configuration', first.reported === 3 && db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value === bowmanText, JSON.stringify(first));
  for (const p of [p423, p417, pDrawn]) await settledOn(p.id);

  // ---- the exact cost measure is a stored result, and it is the library's number ---------------------
  const s2of = (p: { id: bigint }) => run(current(p.id, 's2_cost')!.id);
  const measureRow = (p: { id: bigint }) => results(s2of(p).id).find(r => r.key === 'cost_measure:12:larger');
  const size423 = sizeOf(baseline, e423);
  const size417 = sizeOf(baseline, e417);
  check(
    'the cost check stores the measure the configuration names, per ECR, equal to what the library returns for it',
    measureRow(p423)?.p90 === size423 && measureRow(p417)?.p90 === size417 && !measureRow(p423)!.mock && JSON.parse(s2of(p423).inputsJson).costMeasure !== undefined,
    `ECR-0423 ${measureRow(p423)?.p90} vs ${size423}; ECR-0417 ${measureRow(p417)?.p90} vs ${size417}`,
  );
  check('and Bowman routes them to different tiers on it', tierOf(size423) === 'technical_review' && tierOf(size417) === 'board', `${tierOf(size423)}, ${tierOf(size417)}`);

  // ---- put all three in review with a Level 1 read ---------------------------------------------------------
  for (const p of [p423, p417, pDrawn]) {
    await R.setPrStatus({ prId: p.id, status: 'review' });
    await statement(A, p.id);
  }
  await until(() => [p423, p417, pDrawn].every(p => pr(p.id).status === 'review') || undefined, 5000, 'the ECRs to be in review');

  // ---- Bowman as configured: no slip is known, so the fast track recommends on the small ECR -------------
  let m = mark();
  await fastTrack(A, p423.id);
  const rec1 = await until(() => logAfter(m, p423.id, 'request_fast_track_approval')[0], 5000, 'the fast-track request to be logged');
  const g1 = gateOf(rec1);
  check(
    "Bowman as configured: the fast track cannot approve ECR-0423 while its slip is unknown (no stated date to be late against), so the agent's request is a recommendation, in review",
    rec1.outcome === 'downgraded' && pr(p423.id).status === 'review' && !standing(p423.id) && g1?.outcome === 'recommend' && /slip/i.test(texts(g1)),
    `${rec1.outcome} slip limit ${JSON.stringify(g1?.limits?.find((l: any) => l.limit === 'maxP90SlipDays'))} ${texts(g1).slice(0, 200)}`,
  );

  // ---- the same configuration without the slip limit: small approves, large recommends ---------------------
  await R.setConfig({ key: COMPANY_CONFIG_KEY, value: noSlipText });
  await until(() => db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value === noSlipText || undefined, 5000, 'the new configuration to show');
  m = mark();
  await fastTrack(A, p423.id);
  await fastTrack(A, p417.id);
  const small = await until(() => logAfter(m, p423.id, 'request_fast_track_approval')[0], 5000, 'the log row for the small ECR');
  const large = await until(() => logAfter(m, p417.id, 'request_fast_track_approval')[0], 5000, 'the log row for the large ECR');
  const gs = gateOf(small);
  const gl = gateOf(large);
  const appr423 = standing(p423.id);
  check(
    'the same request from the same agent: approved on the small ECR, on the fast track, with its reasons stored',
    small.outcome === 'applied' && pr(p423.id).status === 'approved' && appr423?.kind === 'fast_track' && appr423.approverKind === 'agent' && appr423.tierId === 'technical_review'
      && gs?.outcome === 'approve_sampled' && gs.sample?.sampled === false && gs.reasons.length > 0 && JSON.parse(appr423.decisionJson).reasons.length === gs.reasons.length && JSON.parse(appr423.answersJson).answers.length === answers.length,
    `${small.outcome} ${pr(p423.id).status} ${appr423?.kind}/${appr423?.approverKind}/${appr423?.tierId} gate ${gs?.outcome} reasons ${gs?.reasons?.length}/${appr423 && JSON.parse(appr423.decisionJson).reasons?.length} answers ${appr423?.answersJson.slice(0, 80)}`,
  );
  check(
    '...and "Norn recommends approval" on the large ECR, not approved, with the limit it passed and the roles who get it',
    large.outcome === 'downgraded' && pr(p417.id).status === 'review' && !standing(p417.id) && /recommends approval; not approved/.test(large.summary)
      && gl?.outcome === 'recommend' && gl.limits.some((l: any) => l.limit === 'maxCost' && !l.held) && /maxCost/.test(gl.reasons.map((r: any) => r.rule).join(' ')) && gl.recipients.includes('cm_analyst'),
    `${large.outcome} ${large.summary.slice(0, 120)} ${texts(gl).slice(0, 160)}`,
  );
  const r417 = recs(p417.id).at(-1);
  check(
    'the recommendation is a queryable row: who recommended, for which revision, what was decided, why, and to whom',
    r417?.outcome === 'recommend' && r417.recommenderName === 'check-gate-agent' && r417.recommenderKind === 'agent' && r417.prRevision === pr(p417.id).revision && r417.action === 'approve_fast_track_ecr'
      && r417.reasons.length > 0 && r417.recipients.includes('cm_analyst') && JSON.parse(r417.answersJson).answers.length === answers.length && JSON.parse(r417.decisionJson).route.tierId === 'board',
    JSON.stringify(r417 && { ...r417, id: String(r417.id), prId: String(r417.prId), sender: undefined, at: undefined }).slice(0, 300),
  );
  check(
    'both decisions are in the action log with their reasons, and the two differ only by what the configuration says about their cost',
    gs.config === gl.config && gs.route.costSize === size423 && gl.route.costSize === size417 && gs.route.costBasis === gl.route.costBasis && gs.route.costBasis === 'measured',
    `${gs.route.costBasis}/${gl.route.costBasis}, sizes ${gs.route.costSize}, ${gl.route.costSize}`,
  );

  // ---- a request that can be neither approved nor refused: the draw for the blind second check ------------
  m = mark();
  await fastTrack(A, pDrawn.id);
  const drawn = await until(() => logAfter(m, pDrawn.id, 'request_fast_track_approval')[0], 5000, 'the log row for the drawn ECR');
  const rd = recs(pDrawn.id).at(-1);
  check(
    'an approval drawn for the blind second check is held: a recommendation that says it is waiting, and the draw is recorded',
    drawn.outcome === 'downgraded' && pr(pDrawn.id).status === 'review' && rd?.awaitingSecondCheck === true && rd.outcome === 'sampled' && gateOf(drawn)?.sample?.sampled === true,
    `${drawn.outcome} ${rd?.outcome} ${JSON.stringify(gateOf(drawn)?.sample)}`,
  );

  // ---- denials ---------------------------------------------------------------------------------------
  m = mark();
  await priya.R.setPrStatus({ prId: p417.id, status: 'approved' });
  const denied = await until(() => logAfter(m, p417.id, 'set_pr_status')[0], 5000, 'the log row for the refused approval');
  check(
    "a person who does not chair the body that decides the ECR is refused, with the reason, and nothing changes",
    denied.outcome === 'denied' && /does not chair a body that decides this change/.test(denied.summary) && pr(p417.id).status === 'review' && !standing(p417.id),
    `${denied.outcome} ${denied.summary.slice(0, 200)}`,
  );
  m = mark();
  await mallory.R.setPrStatus({ prId: p417.id, status: 'approved' });
  const unknown = await until(() => logAfter(m, p417.id, 'set_pr_status')[0], 5000, 'the log row for the unknown person');
  check('a person the configuration does not list is refused', unknown.outcome === 'denied' && pr(p417.id).status === 'review', `${unknown.outcome} ${unknown.summary.slice(0, 200)}`);
  m = mark();
  await A.R.setPrStatus({ prId: p417.id, status: 'approved' });
  const agentTier = await until(() => logAfter(m, p417.id, 'set_pr_status')[0], 5000, 'the log row for the agent approval');
  check(
    "an agent's approval at a tier becomes a recommendation too, whatever the ECR's size",
    agentTier.outcome === 'downgraded' && pr(p417.id).status === 'review' && recs(p417.id).length === 2 && recs(p417.id).at(-1)!.action === 'approve_ecr_at_tier',
    `${agentTier.outcome} ${recs(p417.id).map(r => r.action).join(',')}`,
  );

  // ---- people's approvals ---------------------------------------------------------------------------------
  m = mark();
  await rafael.R.setPrStatus({ prId: p417.id, status: 'approved' });
  await priya.R.setPrStatus({ prId: pDrawn.id, status: 'approved' });
  await until(() => pr(p417.id).status === 'approved' && pr(pDrawn.id).status === 'approved' || undefined, 5000, 'the two approvals to land');
  const a417 = standing(p417.id)!;
  const aDrawn = standing(pDrawn.id)!;
  check(
    'the chair of the board approves the large ECR, and the chair of the technical committee the small one; each approval records who, at which tier and on what numbers',
    a417.approverKind === 'person' && a417.approverName === 'Rafael Quintero' && a417.tierId === 'board' && a417.bodyId === 'ccb' && a417.costSize === size417 && a417.costBasis === 'measured'
      && aDrawn.approverName === 'Priya Venkataraman' && aDrawn.tierId === 'technical_review' && aDrawn.bodyId === 'trc' && a417.kind === 'tier',
    `${a417.approverName}/${a417.tierId}/${a417.bodyId}/${a417.costSize}; ${aDrawn.approverName}/${aDrawn.tierId}`,
  );

  // ---- a change that is the baseline's alone keeps the approvals, while the checks are repeated ---------------
  const open = [p423, p417, pDrawn];
  await stopCost();
  const before = [...db.baselineSnapshot.iter()].find(b => b.current)!.hash;
  const untouched = baseline.items.find(i => !['BW-5120-210', 'BW-9440-030'].includes(i.code) && i.standardCost !== undefined)!;
  baseline = structuredClone(baseline);
  baseline.items.find(i => i.code === untouched.code)!.standardCost! += 1;
  writeFileSync(baselineFile, JSON.stringify(baseline));
  await until(() => [...db.baselineSnapshot.iter()].find(b => b.current)!.hash !== before || undefined, 30000, 'the new baseline to be recorded');
  await until(() => open.every(p => current(p.id, 's2_cost')?.status === 'queued') || undefined, 30000, 'the cost checks to be queued again');
  check(
    'a baseline change leaves the approvals standing, marked as waiting for their re-check, and the ECRs still approved',
    open.every(p => pr(p.id).status === 'approved' && standing(p.id)?.pendingRecheck === true),
    open.map(p => `${pr(p.id).status}/${standing(p.id)?.pendingRecheck}`).join(' '),
  );
  m = mark();
  const early = await rejects(dana.R.setPrStatus({ prId: p423.id, status: 'merged' }));
  const earlyLog = logAfter(m, p423.id, 'set_pr_status')[0];
  check(
    'and the ECR cannot be released on checks that have not finished: the release is refused with the checks it waits for',
    (early !== null && /checks not finished on current inputs \([^)]*s2_cost/.test(early.message)) || (earlyLog !== undefined && earlyLog.outcome !== 'applied'),
    `${early?.message ?? 'accepted'} ${earlyLog?.outcome ?? ''} ${earlyLog?.summary.slice(0, 160) ?? ''}`,
  );
  check('...and nothing was released', pr(p423.id).status === 'approved' && mainNow().version === 1, `${pr(p423.id).status}, baseline v${mainNow().version}`);

  m = mark();
  startCost();
  for (const p of open) await settledOn(p.id);
  await until(() => open.every(p => standing(p.id)?.pendingRecheck === false) || undefined, 30000, 'the re-checks to settle the approvals');
  const kept = open.map(p => logs(l => l.id > m && l.prId === p.id && /approval stands/.test(l.summary)).length);
  check(
    'when the checks finish on the new baseline and the tier is the same, the approvals stand and the log says so',
    open.every(p => pr(p.id).status === 'approved' && standing(p.id) !== undefined) && kept.every(n => n === 1),
    `${open.map(p => pr(p.id).status).join(',')} log rows ${kept.join(',')}`,
  );

  // ---- the ECR's own revision changing withdraws its approval, at once ------------------------------------
  m = mark();
  const slim = (eDrawn.costPage.production[0] as { unitCost?: number });
  slim.unitCost = (slim.unitCost ?? 0) - 1;
  putEcr(eDrawn);
  await ingestOnce(R, source, sent, log);
  await until(() => pr(pDrawn.id).status === 'review' || undefined, 10000, 'the changed ECR to go back to review');
  const wDrawn = approvals(pDrawn.id).at(-1)!;
  check(
    "a change to the ECR's own revision withdraws the approval at once, back to review, with the reason",
    wDrawn.status === 'withdrawn' && /own revision changed/.test(wDrawn.endedReason) && !standing(pDrawn.id),
    `${wDrawn.status} ${wDrawn.endedReason}`,
  );

  // ---- a baseline change that moves the numbers to another tier withdraws the approvals ------------------
  const pending = [p423, p417];
  const bigger = structuredClone(baseline);
  bigger.volumePlan = bigger.volumePlan.map(v => ({ ...v, units: v.units * 1000 }));
  const want423 = tierOf(sizeOf(bigger, e423));
  const want417 = tierOf(sizeOf(bigger, e417));
  check('(the volume change moves both ECRs to another tier on the library\'s own numbers)', want423 !== 'technical_review' && want417 !== 'board', `${want423}, ${want417}`);
  m = mark();
  baseline = bigger;
  writeFileSync(baselineFile, JSON.stringify(baseline));
  for (const p of pending) await until(() => approvals(p.id).at(-1)!.status === 'withdrawn' || undefined, 120000, `the approval of ${p.plmEcrNumber} to be settled`);
  const w423 = approvals(p423.id).at(-1)!;
  const w417 = approvals(p417.id).at(-1)!;
  const wlog = logs(l => l.id > m && l.prId === p417.id && /approval withdrawn/.test(l.summary));
  check(
    'once the checks finish, an ECR whose re-checked numbers point to another tier loses its approval, back to review, with the tiers in the reason',
    pending.every(p => pr(p.id).status === 'review') && w423.endedReason.includes(`from the technical_review tier to the ${want423} tier`) && w417.endedReason.includes(`from the board tier to the ${want417} tier`) && wlog.length === 1,
    `${w423.endedReason.slice(0, 120)} | ${w417.endedReason.slice(0, 120)} | log rows ${wlog.length}`,
  );

  // ---- a person approves at the new tier and the CM analyst releases -------------------------------------------
  m = mark();
  await rafael.R.setPrStatus({ prId: p417.id, status: 'approved' });
  const wrongBody = await until(() => logAfter(m, p417.id, 'set_pr_status')[0], 5000, 'the log row for the board chair');
  check('the board chair can no longer approve it: it now belongs to the Program Management Committee', wrongBody.outcome === 'denied' && pr(p417.id).status === 'review', `${wrongBody.outcome} ${wrongBody.summary.slice(0, 160)}`);
  await helen.R.setPrStatus({ prId: p417.id, status: 'approved' });
  await until(() => pr(p417.id).status === 'approved' || undefined, 5000, 'the CFO approval');
  check('the CFO, who chairs it, approves, and the approval records the tier it was given at', standing(p417.id)?.tierId === want417 && standing(p417.id)?.approverName === 'Helen Castellanos');
  m = mark();
  await dana.R.setPrStatus({ prId: p417.id, status: 'merged' });
  const released = await until(() => logAfter(m, p417.id, 'set_pr_status')[0], 5000, 'the log row for the release');
  const done = approvals(p417.id).at(-1)!;
  check(
    'the CM analyst releases it: the approval is closed as released and the baseline moves on',
    released.outcome === 'applied' && pr(p417.id).status === 'merged' && done.status === 'released' && mainNow().version === 2,
    `${released.outcome} ${released.summary.slice(0, 160)} ${done.status}`,
  );
  void holds;
} catch (e) {
  check('the check ran to the end', false, e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  const text = (p?: Proc) => (p ? p.out.join('') : '');
  if (!process.env.GATE_KEEP_LOGS) void text;
  for (const c of [A, rafael, priya, helen, dana, mallory]) c.close();
  await stopCost();
  await general.stop();
  const ok = finish();
  if (!ok) console.log(`--- general worker ---\n${general.out.join('').slice(-1500)}`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}
