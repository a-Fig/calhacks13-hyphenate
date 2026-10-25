// The Ask Norn server.   npm run ask -w @norn/workers
//   NORN_ASK_PORT (3918)  NORN_ASK_MODEL (claude-sonnet-5-5)  NORN_ASK_ORIGINS (the web app's origins)
//   NORN_ASK_MAX_PER_10_MIN (6)  NORN_ASK_MAX_PER_HOUR (30): how many questions Norn takes, in total, so a loop or a busy
//   page cannot run up the model bill. NORN_ASK_TIMEOUT_MS (90000): one limit for waiting plus answering.
// Needs Norn's MCP server (npm run start -w @norn/mcp) and the machine's Claude login. Loopback only:
// the browser asks this server, and this server starts the Claude session, so no key or token reaches
// the page.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadSigningKey, nornMcpUrl } from '../../../mcp/src/index.ts';
import { Runner, type EventSink, type NornEvent, type RunnerOptions } from '../../../runner/src/index.ts';
import { ask, askSettingsFromEnv, validateRequest, type AskDeps, type RunAskJob } from './ask.ts';
import { ASK_PORT, type AskResponse, type AskStatus } from './protocol.ts';

const HOST = '127.0.0.1';
const MAX_BODY = 8_000;
const MAX_WAITING = 3;
const TEN_MINUTES = 10 * 60_000;
const HOUR = 60 * 60_000;

/** How many questions Norn takes in a while. A question counts when it starts, whatever its outcome. */
export interface AskLimits {
  per10Minutes: number;
  perHour: number;
}

export function askLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AskLimits {
  const n = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { per10Minutes: n(env.NORN_ASK_MAX_PER_10_MIN, 6), perHour: n(env.NORN_ASK_MAX_PER_HOUR, 30) };
}

/** Takes a question into the count, or says how long until one more is allowed. Pure apart from the list it is given. */
export function takeQuestion(times: number[], limits: AskLimits, now: number): { ok: true } | { ok: false; retryAfterMs: number } {
  while (times.length > 0 && now - times[0]! >= HOUR) times.shift();
  const recent = times.filter(t => now - t < TEN_MINUTES);
  let wait = 0;
  if (recent.length >= limits.per10Minutes) wait = Math.max(wait, recent[recent.length - limits.per10Minutes]! + TEN_MINUTES - now);
  if (times.length >= limits.perHour) wait = Math.max(wait, times[times.length - limits.perHour]! + HOUR - now);
  if (wait > 0) return { ok: false, retryAfterMs: wait };
  times.push(now);
  return { ok: true };
}

const DEFAULT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'];

export interface AskServerOptions {
  port: number;
  /** Replaces the real runner and MCP check. For tests. */
  deps?: AskDeps;
  status?: () => Promise<AskStatus>;
  origins?: string[];
  /** How many questions in total. Default from the environment: 6 in 10 minutes and 30 in an hour. */
  limits?: AskLimits;
  /** The clock, for tests. */
  now?: () => number;
  log?: (m: string) => void;
}

/** Is Norn's MCP server up and is there a key to talk to it? (The Claude login itself is only known when a session starts.) */
export async function mcpStatus(): Promise<AskStatus> {
  if (!loadSigningKey()) return { available: false, reason: 'Ask Fern is unavailable: Fern has no MCP signing key on this machine.' };
  try {
    const r = await fetch(nornMcpUrl().replace(/\/mcp$/, '/healthz'), { signal: AbortSignal.timeout(2000) });
    if (r.ok) return { available: true };
  } catch {
    // fall through
  }
  return { available: false, reason: "Ask Fern is unavailable: Fern's database and tools are not running here." };
}

/** The real runner behind Ask Norn. `runnerOptions` is for tests of the queue (a fake `execute`, a smaller `concurrency`). */
export function realDeps(runnerOptions: { execute?: RunnerOptions['execute']; concurrency?: number } = {}): AskDeps {
  const listeners = new Map<string, EventSink>();
  const sink: EventSink = (e: NornEvent) => listeners.get(e.jobId)?.(e);
  const runner = new Runner({ sink, config: { concurrency: runnerOptions.concurrency ?? 2 }, execute: runnerOptions.execute });
  const run: RunAskJob = async (spec, onEvent, signal) => {
    listeners.set(spec.id, onEvent);
    try {
      const job = runner.submit(spec);
      // Cancelling removes the job from the queue if it is still waiting, or stops its session.
      if (signal.aborted) job.cancel();
      else signal.addEventListener('abort', () => job.cancel(), { once: true });
      return await job.result;
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
  const limits = opts.limits ?? askLimitsFromEnv();
  const now = opts.now ?? Date.now;
  const asked: number[] = [];
  let waiting = 0;

  const send = (req: IncomingMessage, res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    const origin = req.headers.origin;
    res.writeHead(code, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text),
      ...extra,
      ...(origin && origins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    });
    res.end(text);
  };

  const http: Server = createServer(async (req, res) => {
    // If the reader goes away (closes the page, or the browser gives up) the question is cancelled, not left to run.
    const gone = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) gone.abort();
    });
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
      const receivedAt = now();
      const st = await status();
      if (!st.available) return send(req, res, 200, { ok: false, kind: 'unavailable', message: st.reason ?? 'Ask Fern is unavailable.' } satisfies AskResponse);
      if (waiting >= MAX_WAITING) return send(req, res, 200, { ok: false, kind: 'busy', message: 'Fern is answering other questions. Try again in a minute.' } satisfies AskResponse);
      const taken = takeQuestion(asked, limits, receivedAt);
      if (!taken.ok) {
        const minutes = Math.max(1, Math.ceil(taken.retryAfterMs / 60_000));
        log(`${v.req.ecr}: limited, retry in ${minutes} min`);
        return send(
          req,
          res,
          429,
          { ok: false, kind: 'limited', message: `Too many questions in a short time. Fern takes ${limits.per10Minutes} every 10 minutes and ${limits.perHour} an hour. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.` } satisfies AskResponse,
          { 'retry-after': String(Math.ceil(taken.retryAfterMs / 1000)) }
        );
      }

      waiting++;
      try {
        const r = await ask(v.req, deps, { signal: gone.signal, startedAt: receivedAt });
        log(`${v.req.ecr}: ${r.ok ? `answered, ${r.unverifiedNumbers.length} number(s) not found, ${r.citations.length} citation(s)` : `${r.kind}: ${r.message}`}`);
        send(req, res, 200, r);
      } finally {
        waiting--;
      }
    } catch (e) {
      log(`500 ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!res.headersSent) send(req, res, 500, { ok: false, kind: 'failed', message: 'Ask Fern hit an internal error.' });
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
