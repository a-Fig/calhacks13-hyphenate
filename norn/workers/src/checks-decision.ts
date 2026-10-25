// End-to-end check of record_plm_decision on a scratch database: the PLM's board decides an ECR, and Norn mirrors it.
//
//   Phase 1 (no worker; the checks are finished by hand): an approval Norn cannot follow yet is logged and moves nothing; the
//   same approval once the checks are done releases the ECR, with an approval row naming the PLM's approver and not the
//   connection that reported it; a repeat changes nothing; the release re-checks the other open ECRs, so a decision that
//   arrives before they finish is not followed, and is when they have; a rejection closes; a rejection of a released ECR is
//   not followed; an outside agent and a job-scoped agent are refused and a person may report.
//   Phase 2 (a real worker on Bowman's dataset): ECR-0417 is assessed, its approval and ECO number are reported through the
//   ingest's own `recordDecided`, and the package job builds the ERP change package (with a planner of its own: what the
//   planner makes of a release is the connector's to test).
//
// Needs a scratch database that you publish and name; it will not run against `norn` or the other shared ones:
//   cd norn/module && spacetime publish -s local -p . norn-pd-1 -y
//   NORN_DB=norn-pd-1 npm run check:decision        (from norn/)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'spacetimedb';
import { bowman } from '../../../bowman/data/index.ts';
import { COMPANY_CONFIG_KEY, canonicalJson, loadConfigFile } from '../../config/src/index.ts';
import type { Baseline, ChangeRequest } from '../../checks/src/index.ts';
import { hashOf, type EcoRelease } from '../../connectors/erpnext/src/index.ts';
import { BaselineStore, type BaselineSource } from './baseline.ts';
import { DB, connect, subscribe, withRetry, type Who } from './connect.ts';
import { ingestOnce, stubSource, type IngestItem } from './ingest.ts';
import { DecisionNotFollowed, followedFrom, recordDecided } from './level1/ingest-plm.ts';
import { packageOnce, type Planner } from './package.ts';
import { TABLES, kit, recorder, rejects } from './testkit.ts';

const SHARED = ['norn', 'norn-test', 'norn-mcp', 'norn-l1', 'norn-demo', 'norn-ui'];
if (!process.env.NORN_DB || SHARED.includes(DB)) {
  console.error('check:decision approves and rejects ECRs and stores a company configuration. Publish a scratch database and name it, for example: NORN_DB=norn-pd-1 npm run check:decision');
  process.exit(2);
}

const { check, finish } = recorder();
const here = dirname(fileURLToPath(import.meta.url));
const WORKERS = join(here, '..');
const BOWMAN = join(here, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts');
const tmp = mkdtempSync(join(tmpdir(), 'norn-pd-'));
const ecrDir = join(tmp, 'ecrs');
const baselineFile = join(tmp, 'baseline.json');
const stamp = Date.now().toString(36);
const ECO = `ECO-D${stamp}`;
const RAFAEL = 'rafael.quintero@bowman-aviation.example'; // the PLM login of the CCB chair (EMP-01)
const DECIDED_ON = '2026-10-25 02:14:07.000000';

const loaded = await loadConfigFile(BOWMAN);
if (!loaded.ok) throw new Error(`the example configuration is not valid: ${loaded.issues.map(i => i.message).join('; ')}`);
const bowmanText = canonicalJson(loaded.config);

const baseline: Baseline = structuredClone({
  programs: bowman.programs, workCenters: bowman.workCenters, items: bowman.items, bom: bowman.bom, sourcing: bowman.sourcing, stock: bowman.stock, volumePlan: bowman.volumePlan, builtAircraft: bowman.builtAircraft,
}) as Baseline;
writeFileSync(baselineFile, JSON.stringify(baseline));
const e417 = { ...structuredClone(bowman.ecrs.find(e => e.id === 'ECR-0417')!), id: `ECR-0417-${stamp}` } as ChangeRequest & { title: string };
mkdirSync(ecrDir, { recursive: true });
writeFileSync(join(ecrDir, `${e417.id}.json`), JSON.stringify(e417));

const as = (kind: Who['kind'], name: string, origin: Who['origin'], onBehalfOf?: string) =>
  connect({ kind, name, origin, spawnedBy: 'Norn', ...(onBehalfOf ? { onBehalfOf } : {}) }, { persistToken: false, quiet: true });
const A = await as('agent', 'check-decision-ingest', 'norn'); // stands in for Norn's PLM ingest
const dana = await as('person', 'Dana Okafor', 'human');
const mallory = await as('person', 'Mallory Nobody', 'human'); // registers as a person the company does not list
const outsider = await as('agent', 'check-decision-outsider', 'external', 'Dana Okafor'); // a person's own agent
const scoped = await as('agent', 'check-decision-job', 'norn'); // one of Norn's agents, held to a job's scope
await subscribe(A.conn, [...TABLES, 'SELECT * FROM ecr_revision', 'SELECT * FROM baseline_snapshot', 'SELECT * FROM approval', 'SELECT * FROM eco_release', 'SELECT * FROM erp_package']);
const { R, db, until, holds, pr, runs, current, logs, mainNow, allCodeDone } = kit(A);
// An ECR as the ingest files it: with the change request Norn assesses (the decision is checked against it).
const newPr = async (title: string, number: string) => {
  await R.ingestEcr({ plmEcrNumber: number, title, description: 'check', changeRequestJson: JSON.stringify({ id: number }), source: 'check', sourceRef: 'check' });
  return until(() => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === number), 5000, `ECR ${number} to be filed`);
};
console.log(`checking database '${DB}'`);

const approvals = (prId: bigint) => [...db.approval.iter()].filter(a => a.prId === prId).sort((a, b) => Number(a.id - b.id));
const decisionLogs = (prId: bigint) => logs(l => l.prId === prId && l.reducer === 'record_plm_decision' && /^(approved|rejected) in /.test(l.summary)); // not the re-check rows the release logs on other ECRs
// The change request as Norn last stored it: what the PLM holds when nobody has edited the ECR since Norn read it.
const storedJson = (number: string) => {
  const found = [...db.pullRequest.iter()].find(p => p.plmEcrNumber === number);
  return [...db.ecrRevision.iter()].find(r => r.prId === found?.id && r.current)?.changeRequestJson ?? '{}';
};
const storedText = (number: string) => {
  const found = [...db.pullRequest.iter()].find(p => p.plmEcrNumber === number);
  return { title: found?.title ?? 'x', description: found?.description ?? '' };
};
const report = (who: typeof A, number: string, decision: string, decidedBy = RAFAEL, changeRequestJson = storedJson(number), text = storedText(number)) =>
  who.R.recordPlmDecision({ plmEcrNumber: number, decision, decidedBy, decidedOn: DECIDED_ON, ...text, changeRequestJson, source: 'plm', sourceRef: `check@${DECIDED_ON}` });
// A refusal is logged without an ECR (the call names it by its PLM number, not by id), so it is found by who was refused.
const denied = (name: string) => logs(l => l.reducer === 'record_plm_decision' && l.outcome === 'denied' && l.actorName === name);
const statusIs = (id: bigint, s: string) => until(() => pr(id).status === s || undefined, 5000, `ECR ${id} to be ${s}`);
let workerLog: string[] = [];
let worker: ReturnType<typeof spawn> | undefined;

try {
  // ---- with no company configuration stored, no person may report (it fails closed); Norn's own ingest is unchanged ------------
  const p0 = await newPr('check: a person reports before any configuration is stored', 'ECR-D0');
  await report(dana, 'ECR-D0', 'approved');
  await until(() => denied('Dana Okafor').length === 1 || undefined, 5000, 'the refusal when no configuration is stored');
  check('with no company configuration stored, a person may not report a PLM decision', /no company configuration is stored, so Fern cannot tell who may report a PLM decision/.test(denied('Dana Okafor')[0]!.summary) && pr(p0.id).status === 'review', denied('Dana Okafor')[0]?.summary);
  await report(A, 'ECR-D0', 'rejected');
  await statusIs(p0.id, 'closed');
  check("Fern's own ingest may still report one with none stored", pr(p0.id).status === 'closed', pr(p0.id).status);

  await R.setConfig({ key: COMPANY_CONFIG_KEY, value: bowmanText });

  // ---- an approval Norn cannot follow yet --------------------------------------------------------------
  const p1 = await newPr('check: decided before its checks finished', 'ECR-D1');
  await report(A, 'ECR-D1', 'approved');
  await until(() => decisionLogs(p1.id).length === 1 || undefined, 5000, 'the log row for the approval');
  const l1 = decisionLogs(p1.id)[0]!;
  check('an approval arriving before the checks have finished is logged with why, and moves nothing', pr(p1.id).status === 'review' && l1.outcome === 'downgraded' && /did not follow it: its checks have not finished/.test(l1.summary) && approvals(p1.id).length === 0, `${pr(p1.id).status}; ${l1.summary}`);
  check('the log says plainly who approved it in the PLM, and that the ingest only reported it', l1.summary.startsWith('approved in the PLM by Rafael Quintero (rafael.quintero@bowman-aviation.example) on 2026-10-25') && l1.summary.includes('reported by check-decision-ingest'), l1.summary);
  await report(A, 'ECR-D1', 'approved');
  await holds(() => false, 300);
  check('the same approval again adds no log row', decisionLogs(p1.id).length === 1, `${decisionLogs(p1.id).length} row(s)`);

  // ---- a release, and what it does to the others -----------------------------------------------------
  const p3 = await newPr('check: checks done, decided after another ECR released', 'ECR-D3');
  await allCodeDone(p3.id);
  const p2 = await newPr('check: checks done, approved in the PLM', 'ECR-D2');
  await allCodeDone(p2.id);
  const before = mainNow();
  const logsBefore = logs(() => true).length;
  await report(A, 'ECR-D2', 'approved');
  await statusIs(p2.id, 'merged');
  const a2 = approvals(p2.id);
  check('an ECR whose checks are finished and which the PLM approved ends merged, the baseline moved by it', pr(p2.id).mergedVersion === mainNow().version && mainNow().version === before.version + 1 && mainNow().mergedPrId === p2.id, `v${before.version} -> v${mainNow().version}`);
  check('its approval row names the PLM approver as a person, taken in the PLM, not the connection that reported it', a2.length === 1 && a2[0]!.kind === 'plm' && a2[0]!.approverKind === 'person' && a2[0]!.approverName === 'Rafael Quintero' && a2[0]!.approverOrigin === 'human' && a2[0]!.status === 'released' && a2[0]!.sender.isEqual(A.identity), JSON.stringify(a2.map(a => [a.kind, a.approverKind, a.approverName, a.status])));
  const d2 = JSON.parse(a2[0]!.decisionJson) as { decidedBy: string; decidedOn: string; person: string; reasons: { text: string }[] };
  check('the approval keeps the PLM login, the PLM time and the company person', d2.decidedBy === RAFAEL && d2.decidedOn === DECIDED_ON && d2.person === 'EMP-01' && /Approved in the PLM by Rafael Quintero/.test(d2.reasons[0]!.text), a2[0]!.decisionJson.slice(0, 160));
  const l2 = decisionLogs(p2.id).filter(l => l.outcome === 'applied');
  check('the log row reads: approved in the PLM by the approver, reported by the ingest, then the moves', l2.length === 1 && l2[0]!.actorName === 'check-decision-ingest' && /^approved in the PLM by Rafael Quintero .* reported by check-decision-ingest; review -> approved; approved -> merged; baseline v\d+ -> v\d+/.test(l2[0]!.summary), l2[0]?.summary);
  const logsAfter = logs(() => true).length;
  await report(A, 'ECR-D2', 'approved');
  await holds(() => false, 300);
  check('the same approval again changes nothing', logs(() => true).length === logsAfter && approvals(p2.id).length === 1 && pr(p2.id).status === 'merged' && mainNow().version === before.version + 1, `${logsAfter - logsBefore} row(s) in the first call`);

  await until(() => current(p3.id, 's1_bom_delta')?.status === 'queued' || undefined, 5000, "ECR-D3's checks to be repeated after the release");
  await report(A, 'ECR-D3', 'approved');
  await until(() => decisionLogs(p3.id).length === 1 || undefined, 5000, 'the log row on ECR-D3');
  check('the release re-checked the other open ECR, and an approval that arrives before that finishes is not followed', pr(p3.id).status !== 'merged' && decisionLogs(p3.id)[0]!.outcome === 'downgraded' && /checks have not finished/.test(decisionLogs(p3.id)[0]!.summary), `${pr(p3.id).status}; ${decisionLogs(p3.id)[0]?.summary}`);
  await allCodeDone(p3.id);
  await report(A, 'ECR-D3', 'approved');
  await statusIs(p3.id, 'merged');
  check('reported again once its checks have finished, it is released', approvals(p3.id).at(-1)?.status === 'released' && approvals(p3.id).at(-1)?.approverName === 'Rafael Quintero', pr(p3.id).status);

  // ---- a rejection ---------------------------------------------------------------------------------------
  const p4 = await newPr('check: rejected in the PLM', 'ECR-D4');
  await report(A, 'ECR-D4', 'rejected', 'dana.okafor@bowman-aviation.example');
  await statusIs(p4.id, 'closed');
  const l4 = decisionLogs(p4.id);
  check('a rejection in the PLM closes the ECR and says who rejected it', l4.length === 1 && l4[0]!.outcome === 'applied' && /^rejected in the PLM by Dana Okafor .* review -> closed/.test(l4[0]!.summary) && approvals(p4.id).length === 0, l4[0]?.summary);
  const logs4 = logs(() => true).length;
  await report(A, 'ECR-D4', 'rejected', 'dana.okafor@bowman-aviation.example');
  await holds(() => false, 300);
  check('the same rejection again changes nothing', logs(() => true).length === logs4 && pr(p4.id).status === 'closed', '');
  await report(A, 'ECR-D1', 'rejected');
  await statusIs(p1.id, 'closed');
  check('an ECR whose approval Fern could not follow is closed by a later rejection', pr(p1.id).status === 'closed' && runs(p1.id).every(r => !['queued', 'running', 'blocked'].includes(r.status)), pr(p1.id).status);
  await report(A, 'ECR-D2', 'rejected');
  await until(() => decisionLogs(p2.id).length === 2 || undefined, 5000, 'the log row for the rejection of a released ECR');
  check('a rejection of an ECR Fern already released is logged as not followed and moves nothing', pr(p2.id).status === 'merged' && decisionLogs(p2.id).at(-1)!.outcome === 'downgraded' && /already released/.test(decisionLogs(p2.id).at(-1)!.summary), decisionLogs(p2.id).at(-1)?.summary);

  // ---- who may report ------------------------------------------------------------------------------------
  const p5 = await newPr('check: an agent tries to approve', 'ECR-D5');
  await allCodeDone(p5.id);
  const m0 = mainNow().version;
  await report(outsider, 'ECR-D5', 'approved');
  await until(() => denied('check-decision-outsider').length === 1 || undefined, 5000, 'the refusal of the outside agent');
  check("an outside agent (a person's own) reporting an approval is refused, and the ECR stays as it was", /outside agent/.test(denied('check-decision-outsider')[0]!.summary) && pr(p5.id).status === 'review' && approvals(p5.id).length === 0 && decisionLogs(p5.id).length === 0, denied('check-decision-outsider')[0]?.summary);
  await scoped.R.grantScope({ jobId: 'check-job', anyEcr: true, prIds: [], maxLevel: 1, expiresAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)) });
  await report(scoped, 'ECR-D5', 'approved');
  await until(() => denied('check-decision-job').length === 1 || undefined, 5000, "the refusal of the job-scoped agent");
  check("one of Fern's own agents working under a job's scope is refused too", /job check-job/.test(denied('check-decision-job')[0]!.summary) && pr(p5.id).status === 'review' && mainNow().version === m0, denied('check-decision-job')[0]?.summary);
  await report(dana, 'ECR-D5', 'approved', RAFAEL);
  await statusIs(p5.id, 'merged');
  const l5 = decisionLogs(p5.id).at(-1)!;
  check('a person may report one: it is released, the log naming them as the reporter and Rafael as the approver', l5.actorKind === 'person' && l5.actorName === 'Dana Okafor' && approvals(p5.id).at(-1)?.approverName === 'Rafael Quintero' && /by Rafael Quintero .* reported by Dana Okafor/.test(l5.summary), l5.summary);
  await report(mallory, 'ECR-D5', 'approved', RAFAEL);
  await until(() => denied('Mallory Nobody').length === 1 || undefined, 5000, 'the refusal of the unlisted person');
  check("a person the company's configuration does not list may not report one, whatever name they give the PLM approver", /Mallory Nobody is not a person in this configuration/.test(denied('Mallory Nobody')[0]!.summary) && denied('Mallory Nobody')[0]!.outcome === 'denied', denied('Mallory Nobody')[0]?.summary);
  const badValue = await rejects(report(A, 'ECR-D5', 'withdrawn'));
  const noEcr = await rejects(report(A, 'ECR-NOPE', 'approved'));
  check('a decision other than approved or rejected is refused, and so is an ECR Fern never opened', /decision must be one of approved, rejected/.test(badValue?.message ?? '') && /Fern has no ECR ECR-NOPE/.test(noEcr?.message ?? ''), `${badValue?.message}; ${noEcr?.message}`);
  const stranger = await newPr('check: approver the company does not know', 'ECR-D6');
  await allCodeDone(stranger.id);
  await report(A, 'ECR-D6', 'approved', 'visitor@plm.example');
  await statusIs(stranger.id, 'merged');
  check("an approver the company's people do not include is recorded under the PLM login, not as someone else", approvals(stranger.id).at(-1)?.approverName === 'visitor@plm.example' && JSON.parse(approvals(stranger.id).at(-1)!.decisionJson).person === null, approvals(stranger.id).at(-1)?.approverName);

  // ---- an ECR a person edited in the PLM after Norn read it -----------------------------------------------
  const p7 = await newPr('check: edited in the PLM, then approved before Fern read the edit', 'ECR-D7');
  await allCodeDone(p7.id);
  const edited = JSON.stringify({ ...JSON.parse(storedJson('ECR-D7')), justification: 'edited in the PLM after Fern assessed it' });
  await report(A, 'ECR-D7', 'approved', RAFAEL, edited);
  await until(() => decisionLogs(p7.id).length === 1 || undefined, 5000, 'the log row for the stale approval');
  const l7 = decisionLogs(p7.id)[0]!;
  check('an approval of content Fern did not assess is not followed: logged with why, the ECR stays unreleased', pr(p7.id).status === 'review' && approvals(p7.id).length === 0 && l7.outcome === 'downgraded' && /did not follow it: the ECR changed in the PLM after Fern assessed it/.test(l7.summary), `${pr(p7.id).status}; ${l7.summary}`);
  await report(A, 'ECR-D7', 'approved', RAFAEL, edited);
  await holds(() => false, 300);
  check('the same stale approval again adds no log row', decisionLogs(p7.id).length === 1, `${decisionLogs(p7.id).length} row(s)`);
  await report(A, 'ECR-D7', 'rejected', RAFAEL, edited);
  await statusIs(p7.id, 'closed');
  check('a rejection needs no such match: it only closes', pr(p7.id).status === 'closed', pr(p7.id).status);
  const p8 = await newPr('check: approved with the content Fern assessed, after an earlier stale approval', 'ECR-D8');
  await allCodeDone(p8.id);
  await report(A, 'ECR-D8', 'approved', RAFAEL, edited.replace('ECR-D7', 'ECR-D8'));
  await until(() => decisionLogs(p8.id).length === 1 || undefined, 5000, 'the log row for the stale approval on ECR-D8');
  await report(A, 'ECR-D8', 'approved');
  await statusIs(p8.id, 'merged');
  check('the same ECR, approved with the content Fern assessed, is released', approvals(p8.id).at(-1)?.status === 'released', pr(p8.id).status);

  const p10 = await newPr('check: title edited in the PLM, then approved', 'ECR-D10');
  await allCodeDone(p10.id);
  await report(A, 'ECR-D10', 'approved', RAFAEL, storedJson('ECR-D10'), { ...storedText('ECR-D10'), title: 'NEW: mandatory fleet grounding until replaced' });
  await until(() => decisionLogs(p10.id).length === 1 || undefined, 5000, 'the log row for the title edit');
  check('an approval of a title Fern did not assess is not followed, and the log names the title', pr(p10.id).status === 'review' && /changed in the PLM after Fern assessed it \(title;/.test(decisionLogs(p10.id)[0]!.summary), decisionLogs(p10.id)[0]?.summary);
  await report(A, 'ECR-D10', 'approved', RAFAEL, storedJson('ECR-D10'), { ...storedText('ECR-D10'), description: 'a different text' });
  await until(() => decisionLogs(p10.id).length === 2 || undefined, 5000, 'the log row for the description edit');
  check('a description Fern did not assess is not followed either', pr(p10.id).status === 'review' && /\(description;/.test(decisionLogs(p10.id)[1]!.summary), decisionLogs(p10.id)[1]?.summary);
  await report(A, 'ECR-D10', 'approved');
  await statusIs(p10.id, 'merged');
  check('with the title and text Fern assessed, it is released', approvals(p10.id).at(-1)?.status === 'released', pr(p10.id).status);

  // ---- the ingest does not remember an approval Norn did not follow ----------------------------------------------
  const p9 = await newPr('check: approved before its checks finished, then they finish', 'ECR-D9');
  const sentD9 = new Map<string, string>();
  const followed = followedFrom(plm => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === plm)?.status, 2000);
  const d9: IngestItem = { plmEcrNumber: 'ECR-D9', title: p9.title, description: p9.description, changeRequest: JSON.parse(storedJson('ECR-D9')), sourceRef: 'check', eco: 'ECO-D9', decision: { decision: 'approved', decidedBy: RAFAEL, decidedOn: DECIDED_ON } };
  const firstTry = await recordDecided(R, d9, sentD9, () => {}, followed).then(() => undefined, e => e);
  check('the ingest sees that Fern did not follow the approval, does not remember it as delivered, and still records the ECO number', firstTry instanceof DecisionNotFollowed && !sentD9.has('decision:ECR-D9') && sentD9.get('eco:ECR-D9') === 'ECO-D9' && pr(p9.id).status === 'review', `${firstTry?.message}; ${pr(p9.id).status}`);
  await allCodeDone(p9.id);
  await recordDecided(R, d9, sentD9, () => {}, followed);
  check('sent again once the checks have finished, the approval is followed and then remembered', pr(p9.id).status === 'merged' && sentD9.get('decision:ECR-D9') === 'approved', pr(p9.id).status);

  // ---- phase 2: a real ECR, assessed by a worker, decided in the PLM, packaged ---------------------------------
  worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    cwd: WORKERS,
    env: { ...process.env, NORN_DB: DB, WORKER_NAME: `pd-worker-${stamp}`, NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24', NORN_BASELINE_POLL_MS: '600000', NORN_ERP_SETTINGS: '', NORN_BASELINE_CACHE_DIR: join(tmp, 'worker-cache') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout!.on('data', d => workerLog.push(String(d)));
  worker.stderr!.on('data', d => workerLog.push(String(d)));
  const quiet = () => {};
  const sent = new Map<string, string>();
  await ingestOnce(R, stubSource(ecrDir), sent, quiet);
  const real = await until(() => [...db.pullRequest.iter()].find(p => p.plmEcrNumber === e417.id), 5000, `${e417.id} to be filed`);
  for (const stage of ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'])
    await until(() => current(real.id, stage)?.status === 'done' && current(real.id, stage), 90000, `${stage} on ${e417.id} to finish`);
  const s2 = current(real.id, 's2_cost')!;
  const revs = [...db.ecrRevision.iter()].filter(r => r.prId === real.id).length;

  // What the ingest does for a decided ECR: its decision, then its ECO number; never ingest_ecr.
  const item: IngestItem = { plmEcrNumber: e417.id, title: real.title, description: real.description, changeRequest: e417, sourceRef: 'check', eco: ECO, decision: { decision: 'approved', decidedBy: RAFAEL, decidedOn: DECIDED_ON } };
  const calls: string[] = [];
  const counted = new Proxy(R, { get: (t, m: string) => (m === 'ingestEcr' ? () => { throw new Error('a decided ECR must not be ingested'); } : (a: any) => (calls.push(m), (t as any)[m](a))) }) as typeof R;
  await recordDecided(counted, item, sent, quiet, followed);
  await recordDecided(counted, item, sent, quiet, followed);
  await statusIs(real.id, 'merged');
  const eco = await until(() => db.ecoRelease.prId.find(real.id) ?? undefined, 5000, 'the ECO number');
  check('the ingest reports an approved ECR once, then its ECO once, with no new revision of the ECR', calls.join(',') === 'recordPlmDecision,recordEcoRelease' && eco.ecoNumber === ECO && [...db.ecrRevision.iter()].filter(r => r.prId === real.id).length === revs, calls.join(','));
  check('the assessed ECR ends merged with an approval naming the PLM approver', pr(real.id).status === 'merged' && approvals(real.id).length === 1 && approvals(real.id)[0]!.approverName === 'Rafael Quintero' && approvals(real.id)[0]!.kind === 'plm', JSON.stringify(approvals(real.id).map(a => [a.kind, a.approverName, a.status])));

  // The job builds the package: the ECR is merged and has its ECO number.
  worker.kill();
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
  await store.refresh(quiet);
  const handed: EcoRelease[] = [];
  const planner: Planner = async release => {
    if (release.ecr === e417.id) handed.push(release);
    const lines = release.items.length + (release.bomChanges?.length ?? 0) + (release.journals?.length ?? 0);
    return { packageJson: JSON.stringify({ check: true, eco: release.eco, lines }), lines, entered: 0, conflicts: 0, problems: [] };
  };
  const built = await packageOnce(A.conn, R, store, planner, { webUrl: 'https://norn.example.com/', timeZone: 'America/Los_Angeles', recheckMs: 3_600_000 }, quiet);
  const row = await until(() => db.erpPackage.prId.find(real.id) ?? undefined, 5000, 'the package row');
  check('the package job then builds the ERP change package for the released ECO, from the ECR\'s assessment', built.built >= 1 && handed.length === 1 && row.ecoNumber === ECO && row.s2RunId === s2.id && row.lines > 0, `${JSON.stringify(built)} lines ${row.lines}`);
  check('every line traces to the ECR page', handed[0]?.decision.url === `https://norn.example.com/ecr/${e417.id}` && handed[0]?.ecr === e417.id, handed[0]?.decision.url);
} catch (e) {
  check('the decision run finished', false, (e as Error).message);
  console.log(workerLog.join('').split('\n').slice(-30).join('\n'));
} finally {
  worker?.kill();
  for (const c of [A, dana, mallory, outsider, scoped]) c.close();
  rmSync(tmp, { recursive: true, force: true });
}
const ok = finish();
process.exit(ok ? 0 : 1);
