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
import { Norn, loadSigningKey, nornMcpFor, signToken, startServer, verifyToken } from '../src/index.ts';
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
const entryFor = (actor: string, ecrs: string[], extra: { jobId?: string; kind?: 'job' | 'person_agent'; onBehalfOf?: string | null; spawnedBy?: string } = {}) =>
  nornMcpFor(ident(actor, extra.onBehalfOf ?? null, extra.spawnedBy), { jobId: extra.jobId ?? `job-${stamp}-${actor.length}`, role: 'gate-check', ecrs, url: server.url, signingKey: key, kind: extra.kind });
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

// ---- job A: Norn's own agent, for Jeff, scoped to ECR-0417 ---------------------------------------
const actorA = `agent:norn/gate/${stamp}`;
const entryA = entryFor(actorA, ['BWM-ECR-0417'], { onBehalfOf: 'person:jeff' });
const A = await connect(entryA);
const tools = (await A.listTools()).tools;
check('nine tools are offered, each with a description', tools.length === 9 && tools.every(t => (t.description ?? '').length > 40), tools.map(t => t.name).join(', '));

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
const widen = await norn.call(handleA, claimsA, 'grantScope', { jobId: claimsA.jobId, anyEcr: true, prIds: [], expiresAt: Timestamp.fromDate(new Date(Date.now() + 60_000)) });
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
  claims: [{ text: 'The bracket cracked in the fatigue test.', evidence: 'fact' }],
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
const sOut = await call(A, 'post_impact_statement', { ...stmtArgs, ecr: 'BWM-ECR-0418', assumptions: [], numbers: [{ key: 'j', evidence: 'judgment', p10: 1, p50: 2, p90: 3 }] });
check('a statement on another ECR is refused by the gate and logged', sOut.isError && sOut.text.includes('Refused by Norn') && [...norn.db.actionLog.prId.filter(ecr418.id)].some(l => l.reducer === 'post_impact_statement' && l.outcome === 'denied'));

const raw = await rawClient();
await raw.R.registerActor({ meta: meta('reg'), kind: 'agent', name: `gate-raw-${stamp}`, origin: 'norn', onBehalfOf: undefined });
const reject = (p: Promise<unknown>) => p.then(() => '', (e: Error) => e.message);
await sleep(100);
// ---- the module on its own: what the tools never send -----------------------------------------------
const base = { prId: ecr417.id, level: 1, changeClass: 'Class I', route: 'CCB', headline: 'x', drivers: [], claims: [] };
const num = (p50: number) => ({ key: 'k', label: 'k', unit: 'USD', p10: wanted.p10, p50, p90: wanted.p90, evidence: 'computation', resultKey });
const m1 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [num(wanted.p50 + 0.01)], assumptions: [] }));
check('the module refuses a computation number that is not the check result', /differs from check result/.test(m1), m1.slice(0, 160));
const m2 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [{ key: 'k', label: 'k', unit: '', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }], assumptions: [{ key: 'tooling_cost_usd', source: 'agent_estimated', note: '' }] }));
check('...or an assumption whose source was relabelled', /may not relabel/.test(m2), m2.slice(0, 140));
const m3 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, level: 4, numbers: [], assumptions: [] }));
check('...or level 4', /level must be 1, 2 or 3/.test(m3), m3.slice(0, 100));
const m4 = await reject(raw.R.postImpactStatement({ meta: meta('s'), ...base, numbers: [{ key: 'k', label: 'k', unit: '', p10: 3, p50: 2, p90: 1, evidence: 'judgment', resultKey: '' }], assumptions: [] }));
check('...or p10 above p90', /p10 <= p50 <= p90/.test(m4), m4.slice(0, 100));


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
const P = await connect(entryFor(actorP, ['*'], { kind: 'person_agent', onBehalfOf: 'person:jeff', spawnedBy: 'person:jeff', jobId: `pat-${stamp}` }));
const pc = await call(P, 'add_comment', { ecr: 'BWM-ECR-0418', body: `gate check ${stamp}: from Jeff's own agent` });
const principalP = [...norn.db.principal.iter()].find(p => p.name === actorP);
const prow = pc.json ? logRow(pc.json.actionLogEntry) : undefined;
check('a person\'s own agent acts as an external principal, for that person, on any ECR', !pc.isError && principalP?.origin === 'external' && principalP.onBehalfOf === 'person:jeff' && prow?.actorOrigin === 'external' && prow.onBehalfOf === 'person:jeff' && prow.prId === ecr418.id, prow?.policy);
await P.close();

// ---- the module on its own (continued): the grant that runs out ------------------------------------
// a grant that runs out: the module refuses even though nothing else changed
const expId = meta('exp');
await raw.R.grantScope({ meta: meta('grant'), jobId: `short-${stamp}`, anyEcr: false, prIds: [ecr417.id], expiresAt: Timestamp.fromDate(new Date(Date.now() + 1500)) });
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
