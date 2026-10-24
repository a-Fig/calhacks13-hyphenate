// Does a runner job reach Norn's MCP server with its token kept off the command line?
//
// The Agent SDK passes MCP server configs to the `claude` process as `--mcp-config <json>`, so a
// token in `headers` is on argv (on Linux, readable by every local user through /proc). Claude
// Code's `headersHelper` runs a command that prints the headers instead. This probe runs one short
// Haiku session both ways against the database `norn-mcp` and looks at the live process's command
// line: it reports whether the token is on argv, and whether the tool call worked.
//
//   npm run probe:argv -w @norn/mcp        (SpacetimeDB running; norn-mcp already published and seeded, e.g. by check:gate)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEAP_MODEL, Runner, memorySink } from '../../runner/src/index.ts';
import { Norn, jobTokenFile, loadSigningKey, nornMcpFor, nornTools, startServer, NORN_MCP_SERVER_NAME } from '../src/index.ts';
import { securePrivateDir } from '../src/fsutil.ts';
import { DB, URI, nornDir } from './kit.ts';

const key = loadSigningKey();
if (!key) throw new Error('NORN_MCP_SIGNING_KEY is not set');
const stamp = Date.now().toString(36);
const dir = join(nornDir, 'mcp', '.state', 'probe');
securePrivateDir(dir);
const norn = await Norn.open({ uri: URI, database: DB, stateDir: dir });
const server = await startServer({ norn, signingKey: key, port: 0 });

/** Command lines of the `claude` processes right now, as text. */
function claudeCommandLines(): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mcp-config' } | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8', windowsHide: true });
  } catch {
    return execFileSync('sh', ['-c', "ps -eo args | grep -- --mcp-config | grep -v grep"], { encoding: 'utf8' });
  }
}

async function run(mode: 'headers' | 'helper') {
  const jobId = `probe-${mode}-${stamp}`;
  const identity = { actor: `agent:norn/probe/${mode}/${stamp}`, onBehalfOf: null, spawnedBy: 'norn' };
  const opts = { jobId, role: 'probe', ecrs: ['BWM-ECR-0417'], url: server.url, ttlSeconds: 600 };
  const config = mode === 'helper' ? nornMcpFor(identity, opts) : nornMcpFor(identity, { ...opts, delivery: 'header' });
  const token = mode === 'helper' ? readFileSync(jobTokenFile(jobId), 'utf8').trim() : (config as { headers: { Authorization: string } }).headers.Authorization.slice('Bearer '.length);
  const sink = memorySink();
  let seen = '';
  const runner = new Runner({
    sink: ev => {
      sink(ev);
      if (ev.type === 'session_init' && !seen) {
        setTimeout(() => (seen = claudeCommandLines()), 300);
      }
    },
    config: { concurrency: 1 },
  });
  const result = await runner.run({
    id: jobId,
    role: 'probe',
    model: CHEAP_MODEL,
    maxTurns: 3,
    timeoutMs: 120_000,
    prompt: 'Call get_ecr for BWM-ECR-0417 and reply with its status in one word.',
    mcpServers: { [NORN_MCP_SERVER_NAME]: config as never },
    allowedTools: nornTools('get_ecr'),
    identity,
  });
  const calls = sink.events.filter(e => e.type === 'tool_result') as any[];
  const init = sink.events.find(e => e.type === 'session_init') as any;
  console.log(`[${mode}] job ${result.status}; mcp status at init: ${JSON.stringify(init?.mcpServers)}; tool results: ${calls.map(c => (c.isError ? 'error' : 'ok')).join(',') || 'none'}`);
  console.log(`[${mode}] token on the claude command line: ${seen.includes(token) ? 'YES' : seen ? 'no' : 'could not read the command line'}`);
}

await run('headers');
await run('helper');
await server.close();
norn.close();
setTimeout(() => process.exit(0), 300);
