// The server and the module's gate, end to end, without a model: real HTTP, real MCP client, real
// SpacetimeDB database `norn-mcp` (rebuilt and seeded here). Checks the edge (tokens), the tools,
// that a write outside a job's scope is refused by the module and logged, and that the module
// itself refuses what the tools never send.
//   npm run check:gate -w @norn/mcp      (SpacetimeDB must be running on 127.0.0.1:3000)
import { request } from 'node:http';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Timestamp } from 'spacetimedb';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Norn, jobTokenFile, loadSigningKey, nornMcpFor, signToken, startServer, verifyToken } from '../src/index.ts';
import { DB, URI, meta, nornDir, rawClient, recorder, resetDatabase, sleep, waitForChecks } from './kit.ts';

const { check, finish } = recorder();
const key = loadSigningKey();
if (!key) throw new Error('NORN_MCP_SIGNING_KEY is not set; run `npm run key:ensure -w @norn/mcp`');
const stamp = Date.now().toString(36);

const { stopWorker } = await resetDatabase();
const norn = await Norn.open({ uri: URI, database: DB, stateDir: join(nornDir, 'mcp', '.state', 'gate') });
const ecr417 = await waitForChecks(norn, 'BWM-ECR-0417');
const server = await startServer({ norn, signingKey: key, port: 0 });
console.log(`serving ${server.url}`);

// ---- helpers -------------------------------------------------------------------------------------
const ident = (actor: string, onBehalfOf: string | null = null, spawnedBy = 'norn') => ({ actor, onBehalfOf, spawnedBy });
const entryFor = (actor: string, ecrs: string[], extra: { jobId?: string; kind?: 'job' | 'person_agent'; onBehalfOf?: string | null; spawnedBy?: string; role?: string; ttlSeconds?: number } = {}) =>
  nornMcpFor(ident(actor, extra.onBehalfOf ?? null, extra.spawnedBy), { jobId: extra.jobId ?? `job-${stamp}-${actor.length}`, role: extra.role ?? 'level1-writeup', ecrs, url: server.url, signingKey: key, kind: extra.kind, ttlSeconds: extra.ttlSeconds, delivery: 'header' as const });
async function connect(entry: { url: string; headers: Record<string, string> }) {
  const c = new Client({ name: 'gate-check', version: '0.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }));
  return c;
}
async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = r.content[0]?.text ?? '';
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {}
  return { isError: !!r.isError, text, json };
}
const post = (headers: Record<string, string>, body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}') =>
  fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });
const logRow = (id: number) => norn.db.actionLog.id.find(BigInt(id));
const ecr = (plm: string) => [...norn.db.pullRequest.iter()].find(p => p.plmEcrNumber === plm)!;

// ---- the edge: tokens ----------------------------------------------------------------------------
const good = signToken({ kind: 'job', jobId: `edge-${stamp}`, role: 'r', actor: `agent:norn/edge/${stamp}`, onBehalfOf: null, spawnedBy: 'norn', ecrs: ['BWM-ECR-0417'], ttlSeconds: 300 }, key);
check('no credential: 401', (await post({})).status === 401);
check('a token signed with another key: 401', (await post({ authorization: `Bearer ${signToken({ kind: 'job', jobId: 'x', role: 'r', actor: 'agent:norn/x', onBehalfOf: null, spawnedBy: 'norn', ecrs: [], ttlSeconds: 60 }, 'k'.repeat(40))}` })).status === 401);
check('an expired token: 401', (await post({ authorization: `Bearer ${signToken({ kind: 'job', jobId: 'x', role: 'r', actor: 'agent:norn/x', onBehalfOf: null, spawnedBy: 'norn', ecrs: [], ttlSeconds: 60 }, key, Date.now() - 3_600_000)}` })).status === 401);
const [p0, p1, p2] = good.split('.');
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p1!, 'base64url').toString()), actor: 'agent:norn/someone-else' })).toString('base64url');
check('a payload edited after signing (a different actor): 401', (await post({ authorization: `Bearer ${p0}.${forged}.${p2}` })).status === 401);
check('GET is not served: 405', (await fetch(server.url, { method: 'GET', headers: { authorization: `Bearer ${good}` } })).status === 405);
const hostStatus = await new Promise<number>((res, rej) => {
  const u = new URL(server.url);
  const r = request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${good}`, 'content-type': 'application/json' } }, x => res(x.statusCode ?? 0));
  r.on('error', rej);
  r.end('{}');
});
check('a request for another host name: 403', hostStatus === 403);
check('a token names an ECR Norn does not have: 403', (await post({ authorization: `Bearer ${signToken({ kind: 'job', jobId: `ghost-${stamp}`, role: 'r', actor: `agent:norn/ghost/${stamp}`, onBehalfOf: null, spawnedBy: 'norn', ecrs: ['BWM-ECR-9999'], ttlSeconds: 60 }, key)}` })).status === 403);
check('a person_agent token needs a person; "*" is for person agents only', (() => {
  try { signToken({ kind: 'person_agent', jobId: 'p', role: 'r', actor: 'a', onBehalfOf: null, spawnedBy: 's', ecrs: [], ttlSeconds: 60 }, key); return false; } catch { /* expected */ }
  try { signToken({ kind: 'job', jobId: 'p', role: 'r', actor: 'a', onBehalfOf: null, spawnedBy: 's', ecrs: ['*'], ttlSeconds: 60 }, key); return false; } catch { return true; }
})());
check('claims survive a round trip', verifyToken(good, key).ecrs[0] === 'BWM-ECR-0417');
// the default delivery keeps the token off the command line: Claude Code runs the helper, which prints the header
const helperEntry = nornMcpFor(ident(`agent:norn/helper/${stamp}`), { jobId: `helper-${stamp}`, role: 'level1-writeup', ecrs: ['BWM-ECR-0417'], url: server.url, signingKey: key });
const helperText = JSON.stringify(helperEntry);
const helperToken = readFileSync(jobTokenFile(`helper-${stamp}`), 'utf8').trim();
const helperOut = JSON.parse(execFileSync('node', [helperEntry.headersHelper.match(/^node "(.+?)" "/)![1]!, jobTokenFile(`helper-${stamp}`)], { encoding: 'utf8' }));
check('#10 the default entry has no token in it (a headers helper reads a private file), and the helper prints a header the server accepts', !('headers' in helperEntry) && !helperText.includes(helperToken) && helperOut.Authorization === `Bearer ${helperToken}` && (await post({ authorization: helperOut.Authorization })).status === 200, helperEntry.headersHelper.slice(0, 60));

// ---- job A: Norn's own agent, for Jeff, scoped to ECR-0417 ---------------------------------------
const actorA = `agent:norn/gate/${stamp}`;
const entryA = entryFor(actorA, ['BWM-ECR-0417'], { onBehalfOf: 'person:jeff' });
const A = await connect(entryA);
const tools = (await A.listTools()).tools;
check('ten tools are offered, each with a description', tools.length === 10 && tools.every(t => (t.description ?? '').length > 40), tools.map(t => t.name).join(', '));

const list = await call(A, 'list_ecrs', {});
check('list_ecrs lists the three ECRs', list.json?.ecrs?.length === 3, list.json?.ecrs?.map((e: any) => `${e.ecr}:${e.impactState}`).join(' '));
const got = await call(A, 'get_ecr', { ecr: 'ECR-0417' });
check('get_ecr takes a tail of the number and returns text, status, revision and base version', got.json?.ecr === 'BWM-ECR-0417' && got.json.text.includes('cracked') && got.json.status === 'draft' && got.json.baseVersion >= 1 && got.json.revision >= 1, `${got.text.length} chars`);
const impact = await call(A, 'get_impact', { ecr: 'BWM-ECR-0417' });
const cost = impact.json?.stages?.find((s: any) => s.stage === 's2_cost')?.results?.[0];
check('get_impact: state current, mock flagged, each number has p10/p50/p90 and a trace', impact.json?.state === 'current' && impact.json.mock === true && cost?.key === 'unit_cost_delta' && cost.p10 <= cost.p50 && cost.p50 <= cost.p90 && cost.trace && cost.evidence === 'computation', `${impact.json?.state}; ${cost?.key} ${cost?.p50}; ${impact.text.length} chars`);
check('get_impact: the run says what it read, with each assumption\'s source', impact.json?.stages?.find((s: any) => s.stage === 's2_cost')?.run?.assumptionsUsed?.some((a: any) => a.source === 'given' || a.source === 'default'));
const staleView = await call(A, 'get_impact', { ecr: 'BWM-ECR-0418' });
check('get_impact on an ECR whose checks may not be done says so plainly', ['no_results', 'partial', 'current'].includes(staleView.json?.state) && typeof staleView.json?.hint === 'string', staleView.json?.state);
const part = await call(A, 'get_part', { part: 'bwm-1042-02' });
check('get_part finds a part', part.json?.name?.includes('titanium'));
const asm = await call(A, 'list_assumptions', { ecr: 'BWM-ECR-0417' });
const bySource = Object.fromEntries((asm.json?.assumptions ?? []).map((a: any) => [a.key, a.source]));
check('list_assumptions: baseline plus the ECR\'s own, each with its source', bySource.tooling_cost_usd === 'given' && bySource.scrap_rate === 'default' && bySource.requalification_weeks === 'agent_estimated' && bySource.titanium_price_usd_per_kg === 'given', JSON.stringify(bySource));

// a comment inside the scope
const c1 = await call(A, 'add_comment', { ecr: 'BWM-ECR-0417', body: `gate check ${stamp}: reading the impact numbers` });
const row1 = c1.json ? logRow(c1.json.actionLogEntry) : undefined;
const comment = [...norn.db.comment.iter()].find(c => c.body.includes(`gate check ${stamp}`));
const principalA = [...norn.db.principal.iter()].find(p => p.name === actorA);
check('add_comment inside the scope is saved', !c1.isError && c1.json?.saved === true && !!comment);
check('...its author is the agent\'s own principal (not the server, not a person)', !!comment && !!principalA && comment.author.isEqual(principalA.identity) && principalA.kind === 'agent' && principalA.origin === 'norn' && principalA.onBehalfOf === 'person:jeff');
check('...the action log names actor, on-behalf-of, spawned-by and outcome, and why it was allowed', row1?.actorName === actorA && row1.onBehalfOf === 'person:jeff' && row1.spawnedBy === 'norn' && row1.outcome === 'applied' && row1.policy.startsWith('allow (job scope: job ') && row1.prId === ecr417.id, `${row1?.actorName} / ${row1?.onBehalfOf} / ${row1?.spawnedBy} / ${row1?.outcome} / ${row1?.policy}`);

// a comment outside the scope
const ecr418 = ecr('BWM-ECR-0418');
const commentsOn418 = () => [...norn.db.comment.prId.filter(ecr418.id)].length;
const before418 = commentsOn418();
const c2 = await call(A, 'add_comment', { ecr: 'BWM-ECR-0418', body: `gate check ${stamp}: this must be refused` });
await sleep(300);
const denied = [...norn.db.actionLog.prId.filter(ecr418.id)].find(l => l.actorName === actorA && l.outcome === 'denied');
check('add_comment on another ECR returns a clear refusal, not a crash', c2.isError && c2.text.includes('Refused by Norn\'s policy gate') && c2.text.includes('outside the scope') && c2.text.includes('BWM-ECR-0418'), c2.text.slice(0, 160));
check('...nothing was written to that ECR', commentsOn418() === before418);
check('...and the refusal is in the action log: denied, with the reason, the actor and who it was for', !!denied && denied.reducer === 'add_comment' && denied.policy.startsWith('deny: outside the scope of job ') && denied.onBehalfOf === 'person:jeff' && denied.spawnedBy === 'norn', denied?.policy);
check('...and the refusal is visible in that ECR\'s history', (await call(A, 'get_ecr_history', { ecr: 'BWM-ECR-0418' })).json?.entries?.some((e: any) => e.outcome === 'denied' && e.by === actorA && e.policy));

// reducers the tools never call are not open to a scoped actor
const handleA = await norn.actorFor(verifyToken(entryA.headers.Authorization.replace('Bearer ', ''), key));
const claimsA = verifyToken(entryA.headers.Authorization.replace('Bearer ', ''), key);
const status = await norn.call(handleA, claimsA, 'setPrStatus', { prId: ecr417.id, status: 'review' });
check('a scoped actor cannot call a reducer outside comment, assumption and statement', status.row?.outcome === 'denied' && status.row.policy.includes('is not open to an agent'), status.row?.policy);
const edit = await norn.call(handleA, claimsA, 'recordAssumption', { prId: 0n, key: 'scrap_rate', distJson: '{"kind":"fixed","value":0.5}', source: 'agent_estimated', rationale: 'x', affects: [], expectedRev: 1 });
check('...or write to the production baseline', edit.row?.outcome === 'denied' && edit.row.policy.includes('baseline'), edit.row?.policy);
const widen = await norn.call(handleA, claimsA, 'grantScope', { jobId: claimsA.jobId, anyEcr: true, prIds: [], maxLevel: 1, expiresAt: Timestamp.fromDate(new Date(Date.now() + 60_000)) });
check('...or widen its own scope while the grant is live', widen.row?.outcome === 'denied' && widen.row.policy.includes('cannot be given to another job or widened'), widen.row?.policy);

// impact statement
const resultKey = 'unit_cost_delta';
const stmtArgs = {
  ecr: 'BWM-ECR-0417',
  level: 1,
  changeClass: 'Class I',
  route: 'CCB',
  headline: 'Mock numbers: the change adds cost per unit and takes about half a year to reach the line.',
  numbers: [
    { key: 'unit_cost', evidence: 'computation', resultKey },
    { key: 'retrofit_hours', evidence: 'judgment', label: 'Retrofit effort', unit: 'h', p10: 1, p50: 2, p90: 3 },
  ],
  drivers: [{ text: 'Requalification time', evidence: 'judgment' }],
  assumptions: [{ key: 'requalification_weeks', note: 'drives the timeline' }, { key: 'tooling_cost_usd', note: 'one-time cost' }],
  claims: [{ text: 'The bracket cracked in the fatigue test.', evidence: 'judgment' }],
};
const s1 = await call(A, 'post_impact_statement', stmtArgs);
const stored = [...norn.db.impactStatement.prId.filter(ecr417.id)][0];
const wanted = [...norn.db.checkResult.prId.filter(ecr417.id)].find(r => r.key === resultKey)!;
check('post_impact_statement stores a structured statement', !s1.isError && s1.json?.saved === true && stored?.level === 1 && stored.changeClass === 'Class I' && stored.numbers.length === 2 && stored.drivers.length === 1 && stored.claims.length === 1, s1.text.slice(0, 200));
check('...a computation number is copied from the check result, to the digit', stored?.numbers[0]?.p10 === wanted.p10 && stored.numbers[0].p50 === wanted.p50 && stored.numbers[0].p90 === wanted.p90 && stored.numbers[0].evidence === 'computation');
check('...assumption sources are the real ones, filled in by Norn', stored?.assumptions.find(a => a.key === 'requalification_weeks')?.source === 'agent_estimated' && stored.assumptions.find(a => a.key === 'tooling_cost_usd')?.source === 'given');
const g2 = await call(A, 'get_ecr', { ecr: 'BWM-ECR-0417' });
check('get_ecr shows the statement, and that it is current for this revision', g2.json?.statements?.[0]?.level === 1 && g2.json.statements[0].current === true && g2.json.statements[0].postedBy?.name === actorA);
const sBad = await call(A, 'post_impact_statement', { ...stmtArgs, numbers: [{ key: 'x', evidence: 'computation', resultKey: 'no_such_result' }] });
check('a computation number with no such current result is refused with what to do', sBad.isError && sBad.text.includes('no current check result'), sBad.text.slice(0, 120));
check('...and it lists the result keys that do exist', sBad.text.includes('Current result keys:') && sBad.text.includes('unit_cost_delta'));
const sPref = await call(A, 'post_impact_statement', { ...stmtArgs, numbers: [{ key: 'unit_cost', evidence: 'computation', resultKey: 's2_cost.unit_cost_delta' }], assumptions: [] });
check('a result key written with its stage in front (s2_cost.unit_cost_delta) is accepted', !sPref.isError && sPref.json?.saved === true, sPref.text.slice(0, 120));
const sOut = await call(A, 'post_impact_statement', { ...stmtArgs, ecr: 'BWM-ECR-0418', assumptions: [], numbers: [{ key: 'j', evidence: 'judgment', p10: 1, p50: 2, p90: 3 }] });
check('a statement on another ECR is refused by the gate and logged', sOut.isError && sOut.text.includes('Refused by Norn') && [...norn.db.actionLog.prId.filter(ecr418.id)].some(l => l.reducer === 'post_impact_statement' && l.outcome === 'denied'));

const raw = await rawClient();
await raw.R.registerActor({ meta: meta('reg'), kind: 'agent', name: `gate-raw-${stamp}`, origin: 'norn', onBehalfOf: undefined });
const reject = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message);
await sleep(100);
// ---- the module on its own: what the tools never send -----------------------------------------------
const base = { prId: ecr417.id, level: 1, changeClass: 'Class I', route: 'CCB', headline: 'x', drivers: [], claims: [] };
const num = (p50: number) => ({ key: 'k', label: wanted.label, unit: wanted.unit, p10: wanted.p10, p50, p90: wanted.p90, evidence: 'computation', resultKey });
const m1 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [num(wanted.p50 + 0.01)], assumptions: [] }));
check('the module refuses a computation number that is not the check result', /differs from check result/.test(m1), m1.slice(0, 160));
const m2 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [{ key: 'k', label: 'k', unit: '', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }], assumptions: [{ key: 'tooling_cost_usd', source: 'agent_estimated', note: '' }] }));
check('...or an assumption whose source was relabelled', /may not relabel/.test(m2), m2.slice(0, 140));
const m3 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, level: 4, numbers: [], assumptions: [] }));
check('...or level 4', /level must be 1, 2 or 3/.test(m3), m3.slice(0, 100));
const m4 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [{ key: 'k', label: 'k', unit: '', p10: 3, p50: 2, p90: 1, evidence: 'judgment', resultKey: '' }], assumptions: [] }));
check('...or p10 above p90', /p10 <= p50 <= p90/.test(m4), m4.slice(0, 100));


// an ECR filed a moment ago has no results yet; the tool must say so rather than invent anything
const freshTitle = `gate check fresh ECR ${stamp}`;
await raw.R.createPr({ meta: meta('fresh'), plmEcrNumber: `BWM-GATE-${stamp}`, title: freshTitle, description: 'Filed by the gate check.' });
for (let i = 0; i < 100 && !norn.findEcr(`BWM-GATE-${stamp}`).pr; i++) await sleep(20);
const fresh = await call(A, 'get_impact', { ecr: `BWM-GATE-${stamp}` });
check('get_impact on an ECR with no results yet says so plainly (no_results, with what to do)', fresh.json?.state === 'no_results' && /No check results yet/.test(fresh.json.hint) && fresh.json.stages.every((s: any) => s.results.length === 0), `${fresh.json?.state}; ${fresh.json?.stages?.map((s: any) => s.state).join(',')}`);

// assumptions
const given = await call(A, 'propose_assumption', { ecr: 'BWM-ECR-0417', key: 'titanium_price_usd_per_kg', value: 99, rationale: 'x', sources: ['guess'] });
check('an agent may not replace a given assumption (refused by the gate, logged)', given.isError && given.text.includes('given value'), given.text.slice(0, 140));
const baselineGiven = await call(A, 'propose_assumption', { ecr: 'BWM-ECR-0417', key: 'tooling_cost_usd', value: 1, rationale: 'x', sources: ['guess'] });
check('...nor override a given baseline value on its ECR', baselineGiven.isError && baselineGiven.text.includes('given value'));
const prop = await call(A, 'propose_assumption', { ecr: 'BWM-ECR-0417', key: `gate_note_${stamp}`, value: { kind: 'triangular', min: 1, mode: 2, max: 4 }, rationale: 'Comparable parts took two to four weeks.', sources: ['ECR text', 'comparable part BWM-1042-01'] });
const newAsm = [...norn.db.assumption.prId.filter(ecr417.id)].find(a => a.key === `gate_note_${stamp}`);
check('propose_assumption records an agent_estimated assumption with rationale and sources', !prop.isError && newAsm?.source === 'agent_estimated' && newAsm.rationale.includes('Sources:') && newAsm.rationale.includes('comparable part') && newAsm.createdBy.isEqual(principalA!.identity), prop.text.slice(0, 160));
const afterEdit = await call(A, 'get_impact', { ecr: 'BWM-ECR-0417' });
check('...and get_impact then says the numbers are not current (stale or recomputing)', ['stale', 'partial'].includes(afterEdit.json?.state), afterEdit.json?.state);
await A.close();

// ---- a second live job for the same actor ---------------------------------------------------------
const clash = await post({ authorization: entryFor(actorA, ['BWM-ECR-0418'], { jobId: `other-job-${stamp}`, onBehalfOf: 'person:jeff' }).headers.Authorization });
check('the same actor cannot be held by a second, different live job: 409', clash.status === 409, String(clash.status));

// ---- a person's own agent -----------------------------------------------------------------------------
const actorP = `agent:jeff/laptop-${stamp}`;
const entryP = entryFor(actorP, ['*'], { kind: 'person_agent', onBehalfOf: 'person:jeff', spawnedBy: 'person:jeff', jobId: `pat-${stamp}`, role: 'person-agent' });
const P = await connect(entryP);
const pc = await call(P, 'add_comment', { ecr: 'BWM-ECR-0418', body: `gate check ${stamp}: from Jeff's own agent` });
const principalP = [...norn.db.principal.iter()].find(p => p.name === actorP);
const prow = pc.json ? logRow(pc.json.actionLogEntry) : undefined;
check('a person\'s own agent acts as an external principal, for that person, on any ECR', !pc.isError && principalP?.origin === 'external' && principalP.onBehalfOf === 'person:jeff' && prow?.actorOrigin === 'external' && prow.onBehalfOf === 'person:jeff' && prow.prId === ecr418.id, prow?.policy);
// ======================================================================================================
// Review fixes (#64)
// ======================================================================================================
const claimsOf = (e: { headers: { Authorization: string } }) => verifyToken(e.headers.Authorization.slice('Bearer '.length), key);
const claimsP = claimsOf(entryP);
const handleP = await norn.actorFor(claimsP);
const res418 = [...norn.db.checkResult.prId.filter(ecr418.id)].find(r => r.key === resultKey)!;
const stmt = (ecrRef: string, level: number, over: Record<string, unknown> = {}) => ({
  ecr: ecrRef, level, changeClass: 'Class II', route: 'CCB', headline: `gate check ${stamp}: level ${level}`,
  numbers: [{ key: 'j', evidence: 'judgment', label: 'Effort', unit: 'h', p10: 1, p50: 2, p90: 3 }], drivers: [], assumptions: [], claims: [], ...over,
});
const direct = (prId: bigint, level: number, over: Record<string, unknown> = {}) => ({
  prId, level, changeClass: 'Class II', route: 'CCB', headline: `direct ${stamp}`,
  numbers: [{ key: 'j', label: 'Effort', unit: 'h', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }], drivers: [], assumptions: [], claims: [], ...over,
});
const numOf = (over: Record<string, unknown> = {}) => ({ key: 'k', label: res418.label, unit: res418.unit, p10: res418.p10, p50: res418.p50, p90: res418.p90, evidence: 'computation', resultKey, ...over });

// 1. A scoped agent cannot take back a CCB approval by changing an assumption.
const ecr419 = await waitForChecks(norn, 'BWM-ECR-0419');
await raw.R.setPrStatus({ meta: meta('rev'), prId: ecr419.id, status: 'review' });
await raw.R.setPrStatus({ meta: meta('appr'), prId: ecr419.id, status: 'approved' });
for (let i = 0; i < 100 && ecr('BWM-ECR-0419').status !== 'approved'; i++) await sleep(20);
const approved = ecr('BWM-ECR-0419');
const ap = await call(P, 'propose_assumption', { ecr: 'BWM-ECR-0419', key: `gate_approval_${stamp}`, value: 3, rationale: 'x', sources: ['y'] });
await sleep(200);
check('#1 a scoped agent (even with any-ECR scope) may not change an assumption on an approved ECR: refused, and it says to comment', ap.isError && /is approved/.test(ap.text) && /[Cc]omment/.test(ap.text), ap.text.slice(0, 200));
check('...the approval and revision are untouched, and the refusal is logged as denied', ecr('BWM-ECR-0419').status === 'approved' && ecr('BWM-ECR-0419').revision === approved.revision && [...norn.db.actionLog.prId.filter(ecr419.id)].some(l => l.actorName === actorP && l.reducer === 'record_assumption' && l.outcome === 'denied'));
const apc = await call(P, 'add_comment', { ecr: 'BWM-ECR-0419', body: `gate check ${stamp}: comment on an approved ECR` });
check('...it can still comment on it', !apc.isError && apc.json?.saved === true);

// 2. A computation number keeps the check's own label and unit.
const rel = await call(P, 'post_impact_statement', stmt('BWM-ECR-0418', 1, { headline: `relabel ${stamp}`, numbers: [{ key: 'fleet_tooling', evidence: 'computation', resultKey, label: 'One-time tooling cost (fleet)', unit: 'kUSD' }] }));
const relStored = [...norn.db.impactStatement.prId.filter(ecr418.id)].find(s => s.headline === `relabel ${stamp}`);
check("#2 the tool takes a computation number's label and unit from the check result, whatever the agent wrote", !rel.isError && relStored?.numbers[0]?.label === res418.label && relStored.numbers[0].unit === res418.unit, `${relStored?.numbers[0]?.label} / ${relStored?.numbers[0]?.unit}`);
const relabelled = await norn.call(handleP, claimsP, 'postImpactStatement', direct(ecr418.id, 1, { numbers: [numOf({ label: 'One-time tooling cost (fleet)', unit: 'kUSD' })] }));
check("...and the module refuses a relabelled computation number (rejected, logged, naming the result's label)", relabelled.row?.outcome === 'rejected' && /keeps the label and unit/.test(relabelled.row.summary) && relabelled.row.summary.includes(res418.label), relabelled.row?.summary);

// 3. A level cap from role and origin.
const pl3 = await call(P, 'post_impact_statement', stmt('BWM-ECR-0418', 3));
const pl2 = await call(P, 'post_impact_statement', stmt('BWM-ECR-0418', 2));
check("#3 a person's own agent can never post Level 3 (refused by the gate) but can post Level 2", pl3.isError && /up to Level 2/.test(pl3.text) && !pl2.isError && pl2.json?.saved === true, pl3.text.slice(0, 120));
check('...no Level 3 statement exists', ![...norn.db.impactStatement.iter()].some(s => s.level === 3));
const A2 = await connect(entryA);
const a3 = await call(A2, 'post_impact_statement', stmt('BWM-ECR-0417', 3));
const a2 = await call(A2, 'post_impact_statement', stmt('BWM-ECR-0417', 2));
check('...a level1-writeup job gets Level 1 only (Levels 2 and 3 refused, logged)', a3.isError && /up to Level 1/.test(a3.text) && a2.isError && /up to Level 1/.test(a2.text), a3.text.slice(0, 120));
const actorR = `agent:norn/research/${stamp}`;
const R = await connect(entryFor(actorR, ['BWM-ECR-0418'], { role: 'researcher', onBehalfOf: null }));
const r1 = await call(R, 'post_impact_statement', stmt('BWM-ECR-0418', 1));
const rc = await call(R, 'add_comment', { ecr: 'BWM-ECR-0418', body: `gate check ${stamp}: a researcher comments` });
check('...a job whose role posts no statements may comment but not post one', r1.isError && /may not post impact statements/.test(r1.text) && !rc.isError, r1.text.slice(0, 120));
await R.close();

// 4. A refused second job must not rewrite the first job's on-behalf-of, and history shows what was recorded at the time.
const mallory = await post({ authorization: entryFor(actorA, ['BWM-ECR-0417'], { jobId: `mallory-job-${stamp}`, onBehalfOf: 'person:mallory' }).headers.Authorization });
await sleep(300);
const regRows = [...norn.db.actionLog.iter()].filter(l => l.actorName === actorA && l.reducer === 'register_actor');
check('#4 a refused second job for another person does not re-register the actor: 409, still acting for the first person', mallory.status === 409 && [...norn.db.principal.iter()].find(p => p.name === actorA)?.onBehalfOf === 'person:jeff' && !regRows.some(l => l.outcome === 'applied' && l.summary.includes('mallory')) && regRows.some(l => l.outcome === 'denied'), `${mallory.status}; ${regRows.map(l => l.outcome).join(',')}`);
const handoverPlm = `BWM-GATE-hand-${stamp}`;
await raw.R.createPr({ meta: meta('hand'), plmEcrNumber: handoverPlm, title: `gate check handover ${stamp}`, description: 'x' });
for (let i = 0; i < 100 && !norn.findEcr(handoverPlm).pr; i++) await sleep(20);
const actorX = `agent:norn/handover/${stamp}`;
const X1 = await connect(entryFor(actorX, [handoverPlm], { jobId: `x1-${stamp}`, onBehalfOf: 'person:jeff', ttlSeconds: 6 }));
await call(X1, 'add_comment', { ecr: handoverPlm, body: 'comment from the first job' });
await call(X1, 'post_impact_statement', stmt(handoverPlm, 1));
await X1.close();
await sleep(7000);
const X2 = await connect(entryFor(actorX, [handoverPlm], { jobId: `x2-${stamp}`, onBehalfOf: 'person:ann' }));
await call(X2, 'add_comment', { ecr: handoverPlm, body: 'comment from the second job' });
const hist = (await call(X2, 'get_ecr_history', { ecr: handoverPlm })).json?.entries ?? [];
const h1 = hist.find((e: any) => e.body === 'comment from the first job');
const h2 = hist.find((e: any) => e.body === 'comment from the second job');
const st = (await call(X2, 'get_ecr', { ecr: handoverPlm })).json?.statements?.[0];
check('...a later job under the same actor name takes the principal over, and history keeps who each comment was for at the time', [...norn.db.principal.iter()].find(p => p.name === actorX)?.onBehalfOf === 'person:ann' && h1?.onBehalfOf === 'person:jeff' && h2?.onBehalfOf === 'person:ann', `${h1?.onBehalfOf} / ${h2?.onBehalfOf}`);
check('...and a statement shows the on-behalf-of it was posted with', st?.postedBy?.onBehalfOf === 'person:jeff' && st.postedBy.name === actorX, JSON.stringify(st?.postedBy));
await X2.close();

// 5. An agent cannot stamp its own claims as fact.
const factTool = await call(A2, 'post_impact_statement', stmt('BWM-ECR-0417', 1, { claims: [{ text: 'The bracket cracked.', evidence: 'fact' }] }));
check('#5 the tool does not offer evidence "fact"', factTool.isError, factTool.text.slice(0, 100));
const claimsA2 = claimsOf(entryA);
const factGate = await norn.call(handleA, claimsA2, 'postImpactStatement', direct(ecr417.id, 1, { claims: [{ text: 'The bracket cracked.', evidence: 'fact' }] }));
const factNum = await norn.call(handleA, claimsA2, 'postImpactStatement', direct(ecr417.id, 1, { numbers: [{ key: 'j', label: 'x', unit: '', p10: 1, p50: 2, p90: 3, evidence: 'fact', resultKey: '' }] }));
check("...and the gate refuses an agent's own fact, in a claim or a number (denied, logged)", factGate.row?.outcome === 'denied' && /as fact/.test(factGate.row.policy) && factNum.row?.outcome === 'denied', factGate.row?.policy);
await A2.close();

// 6. Validation failures by a scoped agent leave an action-log row (outcome rejected); other callers still get a SenderError.
const forgedStmt = await norn.call(handleP, claimsP, 'postImpactStatement', direct(ecr418.id, 1, { numbers: [numOf({ p50: res418.p50 + 0.01 })] }));
check('#6 a forged computation number is rejected and logged (outcome rejected, with the reason)', forgedStmt.row?.outcome === 'rejected' && /differs from check result/.test(forgedStmt.row.summary) && forgedStmt.row.prId === ecr418.id && forgedStmt.row.actorName === actorP, forgedStmt.row?.summary);
const conflict = await norn.call(handleP, claimsP, 'recordAssumption', { prId: ecr418.id, key: `gate_rev_${stamp}`, distJson: '{"kind":"fixed","value":1}', source: 'agent_estimated', rationale: 'x', affects: [], expectedRev: 5 });
check('...a revision conflict is rejected and logged', conflict.row?.outcome === 'rejected' && /is at revision 0, not 5/.test(conflict.row.summary), conflict.row?.summary);
const closedPlm = `BWM-GATE-closed-${stamp}`;
await raw.R.createPr({ meta: meta('cl'), plmEcrNumber: closedPlm, title: `gate check closed ${stamp}`, description: 'x' });
for (let i = 0; i < 100 && !norn.findEcr(closedPlm).pr; i++) await sleep(20);
const closedId = norn.findEcr(closedPlm).pr!.id;
await raw.R.setPrStatus({ meta: meta('cl2'), prId: closedId, status: 'closed' });
for (let i = 0; i < 100 && norn.findEcr(closedPlm).pr!.status !== 'closed'; i++) await sleep(20);
const onClosed = await call(P, 'post_impact_statement', stmt(closedPlm, 1));
const onClosedA = await call(P, 'propose_assumption', { ecr: closedPlm, key: 'k', value: 1, rationale: 'x', sources: ['y'] });
check('...a statement or an assumption on a closed ECR is rejected, names the ECR by number (not an internal id), and says nothing was saved', onClosed.isError && onClosed.text.includes(closedPlm) && onClosed.text.includes('Nothing was saved') && onClosedA.isError && onClosedA.text.includes(closedPlm) && !/ECR \d+ is/.test(onClosed.text + onClosedA.text), onClosed.text.slice(0, 160));
check("...both are in the action log as rejected, and in the ECR's history", [...norn.db.actionLog.prId.filter(closedId)].filter(l => l.outcome === 'rejected').length === 2 && ((await call(P, 'get_ecr_history', { ecr: closedPlm })).json?.entries ?? []).filter((e: any) => e.outcome === 'rejected').length === 2);
const rawClosed = await reject(raw.R.postImpactStatement({ meta: meta('rc'), ...direct(closedId, 1) }));
check('...the same call by an unscoped client still throws, and leaves no rejected row', /frozen/.test(rawClosed) && ![...norn.db.actionLog.iter()].some(l => l.actorName === `gate-raw-${stamp}` && l.outcome === 'rejected'), rawClosed.slice(0, 100));
const m5 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...direct(ecr418.id, 1, { numbers: [numOf({ label: 'something else' })] }) }));
check('#2 the module refuses a relabelled computation number from any caller', /keeps the label and unit/.test(m5), m5.slice(0, 140));
await P.close();

// ---- the module on its own (continued): the grant that runs out ------------------------------------
// a grant that runs out: the module refuses even though nothing else changed
const expId = meta('exp');
await raw.R.grantScope({ meta: meta('grant'), jobId: `short-${stamp}`, anyEcr: false, prIds: [ecr417.id], maxLevel: 1, expiresAt: Timestamp.fromDate(new Date(Date.now() + 1500)) });
const okC = meta('inscope');
await raw.R.addComment({ meta: okC, prId: ecr417.id, anchor: '', body: `gate check ${stamp}: before expiry` });
await sleep(2200);
await raw.R.addComment({ meta: expId, prId: ecr417.id, anchor: '', body: `gate check ${stamp}: after expiry` });
const [okRow, expRow] = [await norn.outcome(okC.requestId, 'add_comment'), await norn.outcome(expId.requestId, 'add_comment')];
check('a grant that has run out is refused by the module, and logged', okRow?.outcome === 'applied' && expRow?.outcome === 'denied' && expRow.policy.includes('has expired'), expRow?.policy);

// the secret never shows up in what the server logged to the database
const leaked = [...norn.db.actionLog.iter()].some(l => JSON.stringify(l, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(key));
check('the signing key appears nowhere in the action log', !leaked);

raw.conn.disconnect();
await server.close();
norn.close();
stopWorker();
const ok = finish();
setTimeout(() => process.exit(ok ? 0 : 1), 200);
