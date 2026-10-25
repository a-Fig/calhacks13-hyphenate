// The fast-track tool and signal, end to end: real HTTP, the real MCP client, the real module and Bowman's own
// configuration, with the real cost and timeline checks (not the mock worker) on Bowman's ECR-0423 and
// ECR-0417. It stores the company configuration and approves ECRs, so it needs a scratch database that it
// publishes (and wipes) itself, named in NORN_MCP_TEST_DB:
//   NORN_MCP_TEST_DB=norn-ftt-1 npm run check:fasttrack -w @norn/mcp       (SpacetimeDB running on 127.0.0.1:3000)
// Then delete the database: spacetime delete norn-ftt-1 -s local -y
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Norn, loadSigningKey, nornMcpFor, startServer } from '../src/index.ts';
import { verifyToken } from '../src/token.ts';
import { DB, URI, nornDir, recorder, sleep } from './kit.ts';

if (!process.env.NORN_MCP_TEST_DB || DB === 'norn-mcp') {
  console.error('check:fasttrack stores a company configuration and approves ECRs. Name a scratch database: NORN_MCP_TEST_DB=norn-ftt-1 npm run check:fasttrack -w @norn/mcp');
  process.exit(2);
}
// The workers' modules read the database from NORN_DB when they load, so set it before they do.
process.env.NORN_DB = DB;
process.env.NORN_URI = URI;
const { connect } = await import('../../workers/src/connect.ts');
const { ingestOnce, stubSource } = await import('../../workers/src/ingest.ts');
const { bowman } = await import('../../../bowman/data/index.ts');
const { COMPANY_CONFIG_KEY, canonicalJson, loadConfigFile, sampleValue } = await import('../../config/src/index.ts');
const { spacetimeBin } = await import('./kit.ts');

const { check, finish } = recorder();
const key = loadSigningKey();
if (!key) throw new Error('NORN_MCP_SIGNING_KEY is not set; run `npm run key:ensure -w @norn/mcp`');
const stamp = Date.now().toString(36);
const BOWMAN = join(nornDir, '..', 'bowman', 'norn-config', 'bowman.config.ts');
const loaded = await loadConfigFile(BOWMAN);
if (!loaded.ok) throw new Error('Bowman\'s configuration does not load');
const bowmanText = canonicalJson(loaded.config);

// ---- the database, the inputs and a worker -------------------------------------------------------------
console.log(`publishing the module as '${DB}' (data wiped)`);
execFileSync(spacetimeBin(), ['publish', DB, '--no-config', '--module-path', 'module', '--server', 'local', '--delete-data=always', '--yes'], { cwd: nornDir, stdio: 'ignore' });

const tmp = mkdtempSync(join(tmpdir(), 'norn-ftt-'));
const ecrDir = join(tmp, 'ecrs');
const baselineFile = join(tmp, 'baseline.json');
const b = bowman;
writeFileSync(baselineFile, JSON.stringify({ programs: b.programs, workCenters: b.workCenters, items: b.items, bom: b.bom, sourcing: b.sourcing, stock: b.stock, volumePlan: b.volumePlan, builtAircraft: b.builtAircraft }));
mkdirSync(ecrDir, { recursive: true });
const ecrAs = (id: string, as: string) => ({ ...structuredClone(bowman.ecrs.find(e => e.id === id)!), id: as });
// No Bowman ECR is drawn for the blind second check, so one more small ECR carries a number that is.
const drawnId = Array.from({ length: 300 }, (_, i) => `ECR-${9000 + i}`).find(id => sampleValue({ sampleSeed: loaded.config.autonomy.sampleSeed, ecrId: id, action: 'approve_fast_track_ecr' }) < 0.2)!;
const unfinishedId = 'ECR-9500';
// ECR-0423 with a 12,000 USD one-time supplier charge added: under the company's 25,000 limit, so only the change class stands between it and an approval
const solId = 'ECR-9503';
const solEcr = ecrAs('ECR-0423', solId) as any;
solEcr.supplierQuotes[0].lines.push({ description: 'Supplier expedite and requalification charge', oneTime: 12000 });
solEcr.costPage.other.push({ label: 'Supplier expedite and requalification charge', oneTime: 12000, basis: 'supplier_quote' });
for (const e of [ecrAs('ECR-0423', 'ECR-0423'), ecrAs('ECR-0417', 'ECR-0417'), ecrAs('ECR-0423', drawnId), solEcr]) writeFileSync(join(ecrDir, `${e.id}.json`), JSON.stringify(e));

const worker: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
  cwd: join(nornDir, 'workers'),
  env: { ...process.env, NORN_DB: DB, WORKER_NAME: `ftt-${stamp}`, NORN_STAGES: 's1_bom_delta,s2_cost,s3_timeline,s4_supply', NORN_BASELINE_FILE: baselineFile, NORN_BASELINE_AS_OF: '2026-10-24', NORN_BASELINE_POLL_MS: '1000', NORN_ERP_SETTINGS: '', NORN_COMPANY_CONFIG: BOWMAN },
  stdio: 'ignore',
  windowsHide: true,
});

// ---- ingest the ECRs, wait for the real checks, put them in review ------------------------------------
const setup = await connect({ kind: 'agent', name: `ftt-setup-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
const norn = await Norn.open({ uri: URI, database: DB, stateDir: join(nornDir, 'mcp', '.state', 'fasttrack') });
const until = async <T>(fn: () => T | undefined | false, ms: number, what: string): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
};
const ecr = (plm: string) => [...norn.db.pullRequest.iter()].find(p => p.plmEcrNumber === plm)!;
const codeDone = (plm: string) => {
  const p = ecr(plm);
  if (!p) return false;
  const done = new Set([...norn.db.checkRun.prId.filter(p.id)].filter(r => r.status === 'done').map(r => r.stage));
  return ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'].every(s => done.has(s));
};
try {
  await until(() => norn.db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value === bowmanText, 90_000, "the worker to store Bowman's configuration");
  const sent = new Map<string, string>();
  await ingestOnce(setup.R, stubSource(ecrDir), sent, m => console.log(`  ingest: ${m}`));
  for (const plm of ['ECR-0423', 'ECR-0417', drawnId, solId]) await until(() => codeDone(plm), 120_000, `${plm} to have every code check done`);
  // No promotion by hand: ingest_ecr opens an ECR the PLM reports in review, which is what the fast track needs.
  check('ingest opens the PLM-reported ECRs in review', ['ECR-0423', 'ECR-0417', drawnId, solId].every(p => ecr(p).status === 'review'), ['ECR-0423', 'ECR-0417', drawnId, solId].map(p => ecr(p).status).join(', '));
  // ---- the MCP server and three scoped agents ------------------------------------------------------------
  const server = await startServer({ norn, signingKey: key, port: 0 });
  const entries = new Map<Client, { headers: Record<string, string> }>();
  const agentFor = async (name: string, ecrs: string[]) => {
    const e = nornMcpFor({ actor: `agent:norn/level1/${name}/${stamp}`, onBehalfOf: null, spawnedBy: 'norn' }, { jobId: `ftt-${name}-${stamp}`, role: 'level1-writeup', ecrs, url: server.url, signingKey: key, delivery: 'header' });
    const c = new Client({ name: 'ftt-check', version: '0.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(e.url), { requestInit: { headers: e.headers } }));
    entries.set(c, e);
    return c;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = r.content[0]?.text ?? '';
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {}
    return { isError: !!r.isError, text, json };
  };
  const statement = (c: Client, plm: string, changeClass = 'II') =>
    call(c, 'post_impact_statement', {
      ecr: plm, level: 1, changeClass, route: 'Fast track', headline: 'ftt check: a Level 1 read so the report-level limit is met',
      numbers: [{ key: 'n', evidence: 'judgment', label: 'n', unit: 'x', p10: 0, p50: 0, p90: 0 }], drivers: [], assumptions: [], claims: [],
    });
  const tests = (impact: any) => impact.fastTrack.tests as { id: string; text: string; list: string }[];
  const answersFor = (impact: any, holdsAll = false) =>
    tests(impact).map(t => ({ testId: t.id, holds: t.list === 'neverFastTrack' ? false : holdsAll || t.id !== 'documentation_fix' && t.id !== 'obsolescence_replacement', evidence: `ftt check: ${t.id}` }));

  const A423 = await agentFor('a423', ['ECR-0423']);
  const A417 = await agentFor('a417', ['ECR-0417']);
  const ADrawn = await agentFor('adrawn', [drawnId]);
  const tools = (await A423.listTools()).tools;
  check('request_fast_track_approval is offered, with a description', tools.some(t => t.name === 'request_fast_track_approval' && (t.description ?? '').length > 100), tools.map(t => t.name).join(', '));

  // ---- the signal ---------------------------------------------------------------------------------------
  const i423 = (await call(A423, 'get_impact', { ecr: 'ECR-0423' })).json;
  const i417 = (await call(A417, 'get_impact', { ecr: 'ECR-0417' })).json;
  check('get_impact: ECR-0423 is a fast-track candidate, with exactly the keys candidate, why, tests', i423.fastTrack.candidate === true && Object.keys(i423.fastTrack).sort().join() === 'candidate,tests,why' && !i423.mock, i423.fastTrack.why);
  check('get_impact: its tests are the configuration\'s answerable ones, each with id, text and list', tests(i423).length === 9 && tests(i423).every(t => t.id && t.text && ['neverFastTrack', 'requireAll', 'requireOneOf'].includes(t.list)), tests(i423).map(t => t.id).join(','));
  check('get_impact: ECR-0417 is not a candidate (over the cost limit and late), and says why', i417.fastTrack.candidate === false && /limit of 25,000/.test(i417.fastTrack.why) && /limit of 14/.test(i417.fastTrack.why), i417.fastTrack.why);

  // ---- ECR-0417: a recommendation, to the CM analyst ----------------------------------------------------
  await statement(A417, 'ECR-0417');
  const r417 = await call(A417, 'request_fast_track_approval', { ecr: 'ECR-0417', answers: answersFor(i417), regulatoryClass: 'minor' });
  check('ECR-0417: the agent gets a recommendation, not an approval, to a named role, with reasons', !r417.isError && r417.json?.decision === 'recommended' && r417.json.ecrStatus === 'review' && r417.json.recipients?.length > 0 && r417.json.reasons?.length > 0 && /NOT approved/.test(r417.json.summary), r417.text.slice(0, 400));
  check('ECR-0417 stays in review, and Norn holds a recommendation by that agent', ecr('ECR-0417').status === 'review' && [...norn.db.recommendation.prId.filter(ecr('ECR-0417').id)].some(r => r.recommenderName.includes('/a417/')));

  // ---- ECR-0423: approved; the classes the agent left out are filled in and said so ------------------------
  const logged423 = () => [...norn.db.actionLog.prId.filter(ecr('ECR-0423').id)].filter(l => l.reducer === 'request_fast_track_approval').length;
  const beforeEarly = logged423();
  const early = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: answersFor(i423), regulatoryClass: 'minor' });
  check('before the agent posts a statement Norn has no class of its own: refused in words, nothing sent', early.isError && /Norn has no change class for this revision/.test(early.text) && /State the change class and the regulatory class, with evidence/.test(early.text) && logged423() === beforeEarly, early.text.slice(0, 300));
  const earlyII = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: answersFor(i423), companyClass: 'II', regulatoryClass: 'minor' });
  check('and a Class II the agent states with no statement behind it is refused too', earlyII.isError && /Nothing was sent to Norn/.test(earlyII.text) && logged423() === beforeEarly, earlyII.text.slice(0, 300));
  const st = await statement(A423, 'ECR-0423');
  check('the agent posts its Level 1 statement (the signal said to)', !st.isError && st.json?.saved === true, st.text.slice(0, 200));
  const bad = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: [{ testId: 'not_a_test', holds: true, evidence: 'x' }] });
  check('an unknown test id is refused before anything is sent, naming the valid ids', bad.isError && /Nothing was sent to Norn: 'not_a_test' is not one of the configuration's fast-track tests \(.*safety_part/.test(bad.text), bad.text.slice(0, 200));
  const before423 = [...norn.db.actionLog.prId.filter(ecr('ECR-0423').id)].filter(l => l.reducer === 'request_fast_track_approval').length;
  const noReg = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: answersFor(i423) });
  check('the FAA class is not filled in for the agent: left out, it is asked for', noReg.isError && /state the regulatory \(FAA\) class/.test(noReg.text) && logged423() === before423, noReg.text.slice(0, 250));
  const r423 = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: answersFor(i423), regulatoryClass: 'minor' });
  check('ECR-0423: approved on the fast track, with the gate\'s reasons and limits', !r423.isError && r423.json?.decision === 'approved' && r423.json.ecrStatus === 'approved' && r423.json.reasons.length > 0 && r423.json.limits.every((l: any) => l.held) && /is approved on the fast track/.test(r423.json.summary), r423.text.slice(0, 400));
  check('and it says where each class came from: the company class from the statement, the FAA class the agent\'s', r423.json?.classes?.company?.id === 'II' && r423.json.classes.company.source === 'statement' && r423.json.classes.regulatory.id === 'minor' && r423.json.classes.regulatory.source === 'agent' && /Norn's own, from the ECR's current statement/.test(r423.json.classesNote ?? ''), r423.json?.classesNote);
  const stored = JSON.parse([...norn.db.approval.prId.filter(ecr('ECR-0423').id)].find(a => a.status === 'standing')?.answersJson || '{}');
  check('the standing approval records the classes it was decided on and their sources', stored.classes?.company === 'II' && stored.classSources?.company === 'statement' && stored.classSources?.regulatory === 'agent', JSON.stringify(stored.classSources));
  const appr = [...norn.db.approval.prId.filter(ecr('ECR-0423').id)].find(a => a.status === 'standing');
  check('Norn holds a standing fast-track approval by the agent, and the log has one more request', ecr('ECR-0423').status === 'approved' && appr?.kind === 'fast_track' && appr.approverName.includes('/a423/') && [...norn.db.actionLog.prId.filter(ecr('ECR-0423').id)].filter(l => l.reducer === 'request_fast_track_approval').length === before423 + 1);
  const again = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0423', answers: answersFor(i423), regulatoryClass: 'minor' });
  check('asking again on an approved ECR: refused as not in review, in words', again.isError && /BWM-ECR-0423|ECR-0423 is approved, not in review/.test(again.text) && /Nothing was changed/.test(again.text), again.text.slice(0, 200));

  // ---- out of scope ----------------------------------------------------------------------------------------
  const out = await call(A423, 'request_fast_track_approval', { ecr: 'ECR-0417', answers: answersFor(i417), regulatoryClass: 'minor' });
  check('an agent scoped to ECR-0423 is refused on ECR-0417 by the policy gate, and told not to retry', out.isError && /Refused by Norn's policy gate: outside the scope of job/.test(out.text) && /Do not retry/.test(out.text), out.text.slice(0, 250));
  check('the refusal is in the action log as denied, for ECR-0417', [...norn.db.actionLog.prId.filter(ecr('ECR-0417').id)].some(l => l.reducer === 'request_fast_track_approval' && l.outcome === 'denied' && l.actorName.includes('/a423/')));

  // ---- a draw for the blind second check; checks not finished ------------------------------------------------
  const iDrawn = (await call(ADrawn, 'get_impact', { ecr: drawnId })).json;
  await statement(ADrawn, drawnId);
  const rDrawn = await call(ADrawn, 'request_fast_track_approval', { ecr: drawnId, answers: answersFor(iDrawn), companyClass: 'II', regulatoryClass: 'minor' });
  check(`${drawnId} (drawn for the second check): not approved, held for it, and still in review`, rDrawn.json?.decision === 'held_for_second_check' && rDrawn.json.ecrStatus === 'review' && ecr(drawnId).status === 'review' && rDrawn.json.classes?.company?.source === 'statement', rDrawn.text.slice(0, 300));
  // ---- a Class I statement on a cost the company's limits would allow: the agent's word does not make it Class II ----
  const ASol = await agentFor('asol', [solId]);
  const iSol = (await call(ASol, 'get_impact', { ecr: solId })).json;
  const oneTime = iSol.stages.flatMap((s: any) => s.results).find((r: any) => r.key === 'one_time_total');
  check('the added supplier charge is in the cost check, and under the 25,000 limit', oneTime && oneTime.p50 > 11000 && oneTime.p90 < 25000, `one-time p50 ${oneTime?.p50}, p90 ${oneTime?.p90}`);
  check('before any statement the signal is optimistic about the class, and says the statement has to propose it', iSol.fastTrack.candidate === true && /Your statement must propose/.test(iSol.fastTrack.why), iSol.fastTrack.why);
  const stI = await statement(ASol, solId, 'Class I');
  check('the agent posts a Class I statement', !stI.isError && stI.json?.saved === true, stI.text.slice(0, 200));
  const iSol2 = (await call(ASol, 'get_impact', { ecr: solId })).json;
  check('and the signal now says the statement\'s class rules the fast track out', iSol2.fastTrack.candidate === false && /current statement proposes Class I/.test(iSol2.fastTrack.why), iSol2.fastTrack.why);
  const solAnswers = answersFor(iSol);
  const solOmitted = await call(ASol, 'request_fast_track_approval', { ecr: solId, answers: solAnswers, regulatoryClass: 'minor' });
  check('a company class left out is the statement\'s (Class I): no approval, a recommendation, and the answer says the class was Norn\'s', !solOmitted.isError && solOmitted.json?.decision !== 'approved' && solOmitted.json?.ecrStatus === 'review' && solOmitted.json?.classes?.company?.id === 'I' && solOmitted.json.classes.company.source === 'statement', solOmitted.text.slice(0, 300));
  const solII = await call(ASol, 'request_fast_track_approval', { ecr: solId, answers: solAnswers, companyClass: 'II', regulatoryClass: 'minor' });
  check('Class II passed explicitly over a Class I statement is refused in words, before anything is sent', solII.isError && /you proposed Class II, but the ECR's current statement proposes Class I/.test(solII.text) && /Nothing was sent to Norn/.test(solII.text), solII.text.slice(0, 300));
  // the module's gate does not rely on the tool: the same request made to the reducer directly is denied
  const solClaims = verifyToken(entries.get(ASol)!.headers.Authorization.slice('Bearer '.length), key);
  const solHandle = await norn.actorFor(solClaims);
  const direct = await norn.call(solHandle, solClaims, 'requestFastTrackApproval', { prId: ecr(solId).id, answers: solAnswers, companyClass: 'II', regulatoryClass: 'minor', triggers: [] });
  check('the reducer called directly with Class II over a Class I statement is denied by the gate and logged', direct.row?.outcome === 'denied' && /more permissive than its own proposal/.test(direct.row.policy), direct.row?.policy);
  check('Sol\'s ECR is still in review with no standing approval', ecr(solId).status === 'review' && ![...norn.db.approval.prId.filter(ecr(solId).id)].some(a => a.status === 'standing'));

  // a last ECR whose checks never run: the worker is stopped before it is filed (a new ECR makes the others' supply check run again)
  worker.kill();
  await sleep(500);
  writeFileSync(join(ecrDir, `${unfinishedId}.json`), JSON.stringify(ecrAs('ECR-0423', unfinishedId)));
  await ingestOnce(setup.R, stubSource(ecrDir), sent, m => console.log(`  ingest: ${m}`));
  await until(() => ecr(unfinishedId), 10_000, `${unfinishedId} to be filed`);
  await until(() => ecr(unfinishedId).status === 'review', 10_000, `${unfinishedId} to be in review`);

  const AUnfinished = await agentFor('aunfin', [unfinishedId]);
  const iUn = (await call(AUnfinished, 'get_impact', { ecr: unfinishedId })).json;
  check('get_impact: an ECR whose checks have not finished is not a candidate, and says so', iUn.fastTrack.candidate === false && /checks are still running/.test(iUn.fastTrack.why), iUn.fastTrack.why);
  await statement(AUnfinished, unfinishedId);
  const rUn = await call(AUnfinished, 'request_fast_track_approval', { ecr: unfinishedId, answers: answersFor(iUn), regulatoryClass: 'minor' });
  check('and asking anyway is refused: the checks have not finished', rUn.isError && /have not finished on its current inputs/.test(rUn.text) && /Nothing was changed/.test(rUn.text), rUn.text.slice(0, 250));

  // A draft (filed in Norn, not submitted) stays ineligible, whatever its checks say.
  const draftId = `ECR-9501-${stamp}`.slice(0, 40);
  await setup.R.createPr({ plmEcrNumber: draftId, title: 'ftt draft', description: 'a draft, not yet submitted for review' });
  await until(() => ecr(draftId), 10_000, `${draftId} to be filed`);
  const ADraft = await agentFor('adraft', [draftId]);
  const iDr = (await call(ADraft, 'get_impact', { ecr: draftId })).json;
  check('a draft ECR is not a candidate: the fast track decides ECRs in review', iDr.fastTrack.candidate === false && /is draft/.test(iDr.fastTrack.why), iDr.fastTrack.why);

  for (const c of [A423, A417, ADrawn, ASol, AUnfinished, ADraft]) await c.close();
  await server.close();
} finally {
  worker.kill();
  setup.close();
  norn.close();
  rmSync(tmp, { recursive: true, force: true });
}
const ok = finish();
setTimeout(() => process.exit(ok ? 0 : 1), 200);
