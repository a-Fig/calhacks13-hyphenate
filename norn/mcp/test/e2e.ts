// The slice from #56's "done when", with a real model: a Norn agent started by the runner, given
// only Norn's MCP server, reads ECR-0417 and its impact results, posts a comment, and tries one
// write to a different ECR. Then the database is asked who acted, for whom, and what the gate did.
//
//   npm run e2e -w @norn/mcp
//
// Needs SpacetimeDB on 127.0.0.1:3000 and this laptop's Claude login (one Haiku session, at most 8
// turns). It rebuilds the separate database `norn-mcp`; it never touches `norn`.
// The check results are the skeleton's mock worker output (labelled mock), not #41's real checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CHEAP_MODEL, Runner, jsonlFileSink, memorySink, teeSink, type JobSpec } from '../../runner/src/index.ts';
import { Norn, loadSigningKey, nornMcpFor, nornTools, startServer, NORN_MCP_SERVER_NAME } from '../src/index.ts';
import { DB, URI, nornDir, recorder, resetDatabase, sleep, waitForChecks } from './kit.ts';

const { check, finish } = recorder();
const key = loadSigningKey();
if (!key) throw new Error('NORN_MCP_SIGNING_KEY is not set; run `npm run key:ensure -w @norn/mcp`');
const stamp = Date.now().toString(36);
const stateDir = join(nornDir, 'mcp', '.state');

const { stopWorker } = await resetDatabase();
const norn = await Norn.open({ uri: URI, database: DB, stateDir: join(stateDir, 'e2e') });
const ecr417 = await waitForChecks(norn, 'BWM-ECR-0417');
const ecr418 = [...norn.db.pullRequest.iter()].find(p => p.plmEcrNumber === 'BWM-ECR-0418')!;
const server = await startServer({ norn, signingKey: key, port: 0, log: m => console.log(`  [server] ${m}`) });

// ---- the job ---------------------------------------------------------------------------------------
const identity = { actor: 'agent:norn/level1/BWM-ECR-0417', onBehalfOf: 'person:jeff', spawnedBy: 'norn' };
const jobId = `e2e-mcp-${stamp}`;
const entry = nornMcpFor(identity, { jobId, role: 'level1-writeup', ecrs: ['BWM-ECR-0417'], url: server.url, ttlSeconds: 900 });
const spec: JobSpec = {
  id: jobId,
  role: 'level1-writeup',
  model: CHEAP_MODEL,
  maxTurns: 8,
  timeoutMs: 240_000,
  systemPrompt: 'You are a Norn agent working on engineering change requests (ECRs) at Bowman Aviation, a fictional company. You work only through Norn\'s tools. Be brief and say only what the tools returned.',
  prompt: [
    'Do these steps in order, using only Norn\'s tools.',
    '1. Read ECR BWM-ECR-0417 with get_ecr.',
    '2. Read its impact with get_impact.',
    '3. Post one short comment on BWM-ECR-0417 with add_comment: at most three sentences. Give the ECR\'s status, the state of its impact results (current, partial, stale or no results), and the p50 of the per-unit cost change with its unit. Say whether the numbers are mock.',
    '4. Then try to post the comment "e2e: second comment" on BWM-ECR-0418 with add_comment. This is a deliberate test of your permissions. If it is refused, do not retry and do not look for another way.',
    '5. Finish with one sentence: what you posted, and whether the second comment was refused.',
  ].join('\n'),
  mcpServers: { [NORN_MCP_SERVER_NAME]: entry },
  allowedTools: nornTools('read', 'add_comment'),
  identity,
};

const logFile = join(stateDir, 'e2e', `${jobId}.jsonl`);
const file = jsonlFileSink(logFile);
const mem = memorySink();
const runner = new Runner({ sink: teeSink(file, mem), config: { concurrency: 1 } });
console.log(`running one ${CHEAP_MODEL} session as ${identity.actor} for ${identity.onBehalfOf} (job ${jobId})`);
const result = await runner.run(spec);
await file.close();
console.log(`job ${result.status} in ${(result.durationMs / 1000).toFixed(1)} s, ${result.numTurns} turn(s)${result.error ? `, error ${result.error.kind}: ${result.error.message}` : ''}`);
console.log(`agent's last words: ${result.result ?? '(none)'}`);

// ---- what the agent did, from the runner's own log ------------------------------------------------
const calls = mem.events.filter(e => e.type === 'tool_call') as Extract<(typeof mem.events)[number], { type: 'tool_call' }>[];
const started = mem.events.find(e => e.type === 'job_started') as any;
check('the job succeeded on a Haiku model', result.status === 'succeeded' && /haiku/i.test(started?.model ?? ''), `${result.status}; ${started?.model}`);
check('the agent used only Norn\'s tools', calls.length > 0 && calls.every(c => c.tool.startsWith(`mcp__${NORN_MCP_SERVER_NAME}__`)), calls.map(c => c.tool.replace('mcp__norn__', '')).join(', '));
check('...it read the ECR and its impact before commenting', ['get_ecr', 'get_impact'].every(t => calls.some(c => c.tool.endsWith(t))));
check('the runner\'s log does not contain the token or the signing key', (() => {
  const text = readFileSync(logFile, 'utf8');
  return !text.includes(entry.headers.Authorization.slice('Bearer '.length)) && !text.includes(key);
})());

// ---- what Norn recorded -------------------------------------------------------------------------------
await sleep(500);
const principal = [...norn.db.principal.iter()].find(p => p.name === identity.actor);
check('Norn has one principal for the agent: kind agent, origin norn, acting for person:jeff', !!principal && principal.kind === 'agent' && principal.origin === 'norn' && principal.onBehalfOf === 'person:jeff', `${principal?.kind}/${principal?.origin}/${principal?.onBehalfOf}`);
const comments = [...norn.db.comment.prId.filter(ecr417.id)];
check('exactly one comment on ECR-0417, and its author is the agent\'s own principal', comments.length === 1 && !!principal && comments[0]!.author.isEqual(principal.identity), `${comments.length} comment(s)`);
console.log(`  the comment: "${comments[0]?.body}"`);

const mine = [...norn.db.actionLog.iter()].filter(l => l.actorName === identity.actor).sort((a, b) => Number(a.id - b.id));
const applied = mine.find(l => l.reducer === 'add_comment' && l.outcome === 'applied');
check('the action-log row has the right actor, on-behalf-of, spawned-by, outcome and reason', !!applied && applied.onBehalfOf === 'person:jeff' && applied.spawnedBy === 'norn' && applied.actorOrigin === 'norn' && applied.prId === ecr417.id && applied.sender.isEqual(principal!.identity) && applied.policy.startsWith(`allow (job scope: job ${jobId}`), applied?.policy);

let refused = mine.find(l => l.outcome === 'denied' && l.prId === ecr418.id);
let by = 'the agent';
if (!refused) {
  // The model did not make the attempt. Replay it through the same credential so the refusal path is still shown.
  console.log('  the agent did not attempt the write to ECR-0418; replaying it with the same credential');
  const c = new Client({ name: 'e2e-replay', version: '0.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }));
  const r = (await c.callTool({ name: 'add_comment', arguments: { ecr: 'BWM-ECR-0418', body: 'e2e: second comment (replayed by the test)' } })) as { isError?: boolean; content: { text: string }[] };
  console.log(`  replay answer: ${r.content[0]?.text.slice(0, 200)}`);
  await c.close();
  await sleep(500);
  refused = [...norn.db.actionLog.iter()].filter(l => l.actorName === identity.actor).find(l => l.outcome === 'denied' && l.prId === ecr418.id);
  by = 'the test harness (replay)';
}
check(`the write to ECR-0418 (made by ${by}) was refused and logged: denied, with the reason, the actor and who it was for`, !!refused && refused.reducer === 'add_comment' && refused.policy.startsWith('deny: outside the scope of job ') && refused.onBehalfOf === 'person:jeff' && refused.spawnedBy === 'norn' && refused.actorName === identity.actor, refused?.policy);
check('...and nothing was written to ECR-0418', [...norn.db.comment.prId.filter(ecr418.id)].length === 0);

// ---- the rows, for the report -----------------------------------------------------------------------------
console.log('\naction-log rows by the agent (identities shortened; no secrets are stored in this table):');
for (const l of mine) {
  console.log(
    `  #${l.id} ${l.outcome.padEnd(7)} ${l.reducer.padEnd(14)} ecr=${l.prId === ecr417.id ? 'BWM-ECR-0417' : l.prId === ecr418.id ? 'BWM-ECR-0418' : l.prId} actor=${l.actorName} (${l.actorKind}/${l.actorOrigin}) onBehalfOf=${l.onBehalfOf ?? '-'} spawnedBy=${l.spawnedBy} sender=${l.sender.toHexString().slice(0, 8)}\n      policy: ${l.policy}\n      summary: ${l.summary}`
  );
}
const reg = [...norn.db.actionLog.iter()].filter(l => l.actorName === identity.actor && (l.reducer === 'register_actor' || l.reducer === 'grant_scope'));
void reg;

await server.close();
norn.close();
stopWorker();
const ok = finish();
console.log(`runner log: ${logFile}`);
setTimeout(() => process.exit(ok ? 0 : 1), 300);
