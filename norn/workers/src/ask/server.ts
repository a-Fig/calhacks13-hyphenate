// The Ask Norn server.   npm run ask -w @norn/workers
//   NORN_ASK_PORT (3918)  NORN_ASK_MODEL (claude-sonnet-5-5)  NORN_ASK_ORIGINS (the web app's origins)
// Needs Norn's MCP server (npm run start -w @norn/mcp) and the machine's Claude login. Loopback only:
// the browser asks this server, and this server starts the Claude session, so no key or token reaches
// the page.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadSigningKey, nornMcpUrl } from '../../../mcp/src/index.ts';
import { Runner, type EventSink, type NornEvent } from '../../../runner/src/index.ts';
import { ask, askSettingsFromEnv, validateRequest, type AskDeps, type RunAskJob } from './ask.ts';
import { ASK_PORT, type AskResponse, type AskStatus } from './protocol.ts';

const HOST = '127.0.0.1';
const MAX_BODY = 8_000;
const MAX_WAITING = 3;

const DEFAULT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'];

export interface AskServerOptions {
  port: number;
  /** Replaces the real runner and MCP check. For tests. */
  deps?: AskDeps;
  status?: () => Promise<AskStatus>;
  origins?: string[];
  log?: (m: string) => void;
}

/** Is Norn's MCP server up and is there a key to talk to it? (The Claude login itself is only known when a session starts.) */
export async function mcpStatus(): Promise<AskStatus> {
  if (!loadSigningKey()) return { available: false, reason: 'Ask Norn is unavailable: Norn has no MCP signing key on this machine.' };
  try {
    const r = await fetch(nornMcpUrl().replace(/\/mcp$/, '/healthz'), { signal: AbortSignal.timeout(2000) });
    if (r.ok) return { available: true };
  } catch {
    // fall through
  }
  return { available: false, reason: "Ask Norn is unavailable: Norn's database and tools are not running here." };
}

function realDeps(): AskDeps {
  const listeners = new Map<string, EventSink>();
  const sink: EventSink = (e: NornEvent) => listeners.get(e.jobId)?.(e);
  const runner = new Runner({ sink, config: { concurrency: 2 } });
  const run: RunAskJob = async (spec, onEvent) => {
    listeners.set(spec.id, onEvent);
    try {
      return await runner.run(spec);
    } finally {
      listeners.delete(spec.id);
    }
  };
  return { run, settings: askSettingsFromEnv() };
}

export function startAskServer(opts: AskServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const log = opts.log ?? (() => {});
  const deps = opts.deps ?? realDeps();
  const status = opts.status ?? mcpStatus;
  const origins = new Set(opts.origins ?? (process.env.NORN_ASK_ORIGINS ? process.env.NORN_ASK_ORIGINS.split(',') : DEFAULT_ORIGINS));
  let waiting = 0;

  const send = (req: IncomingMessage, res: ServerResponse, code: number, body: unknown) => {
    const text = JSON.stringify(body);
    const origin = req.headers.origin;
    res.writeHead(code, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
      ...(origin && origins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    });
    res.end(text);
  };

  const http: Server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) return send(req, res, 403, { ok: false, kind: 'bad_request', message: 'Origin not allowed.' });
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...(origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'content-type',
        });
        return void res.end();
      }
      if (path === '/status' && req.method === 'GET') return send(req, res, 200, await status());
      if (path !== '/ask' || req.method !== 'POST') return send(req, res, 404, { ok: false, kind: 'bad_request', message: 'Not found.' });

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > MAX_BODY) return send(req, res, 413, { ok: false, kind: 'bad_request', message: 'That question is too long.' });
        chunks.push(c as Buffer);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(req, res, 400, { ok: false, kind: 'bad_request', message: 'Could not read the question.' });
      }
      const v = validateRequest(body);
      if (!v.ok) return send(req, res, 400, v);
      const st = await status();
      if (!st.available) return send(req, res, 200, { ok: false, kind: 'unavailable', message: st.reason ?? 'Ask Norn is unavailable.' } satisfies AskResponse);
      if (waiting >= MAX_WAITING) return send(req, res, 200, { ok: false, kind: 'busy', message: 'Norn is answering other questions. Try again in a minute.' } satisfies AskResponse);

      waiting++;
      try {
        const r = await ask(v.req, deps);
        log(`${v.req.ecr}: ${r.ok ? `answered, ${r.unverifiedNumbers.length} number(s) not found, ${r.citations.length} citation(s)` : `${r.kind}: ${r.message}`}`);
        send(req, res, 200, r);
      } finally {
        waiting--;
      }
    } catch (e) {
      log(`500 ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!res.headersSent) send(req, res, 500, { ok: false, kind: 'failed', message: 'Ask Norn hit an internal error.' });
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, HOST, () => {
      resolve({
        port: (http.address() as { port: number }).port,
        close: () =>
          new Promise<void>(r => {
            http.close(() => r());
            http.closeAllConnections();
          }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} [ask-norn] ${m}`);
  const port = Number(process.env.NORN_ASK_PORT ?? ASK_PORT);
  const s = await startAskServer({ port, log });
  log(`listening on http://${HOST}:${s.port} (POST /ask, GET /status)`);
}
