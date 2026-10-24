// Streamable HTTP, loopback only, stateless: every request carries its own bearer token, which is
// verified before anything else happens, and gets a fresh MCP server bound to that token's actor.
// There is no session to hijack, and the identity cannot change between requests.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ActorError, type Norn } from './norn.ts';
import { INSTRUCTIONS, registerTools } from './tools.ts';
import { TokenError, verifyToken } from './token.ts';

export interface ServerOptions {
  norn: Norn;
  signingKey: string;
  /** 0 picks a free port. */
  port: number;
  log?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MAX_BODY = 1_000_000;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

const rpcError = (message: string) => ({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Only a browser can be talked into calling a loopback server by name, so insist on loopback names. */
function loopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => {});

  const http: Server = createServer(async (req, res) => {
    const port = (http.address() as { port: number }).port;
    try {
      if (!loopbackHost(req.headers.host, port)) return send(res, 403, rpcError('Host not allowed'));
      if (req.headers.origin) return send(res, 403, rpcError('Browser requests are not accepted'));
      const path = (req.url ?? '').split('?')[0];
      if (path === '/healthz') return send(res, 200, { ok: true });
      if (path !== '/mcp') return send(res, 404, rpcError('Not found'));
      if (req.method !== 'POST') return send(res, 405, rpcError('Use POST'), { allow: 'POST' });

      // 1. Who is this? Nothing else happens before the signature is checked.
      const auth = req.headers.authorization ?? '';
      const m = /^Bearer\s+(\S+)$/i.exec(auth);
      if (!m) return send(res, 401, rpcError('A bearer token is required'), { 'www-authenticate': 'Bearer' });
      let claims;
      try {
        claims = verifyToken(m[1]!, opts.signingKey);
      } catch (e) {
        const why = e instanceof TokenError ? e.message : 'invalid token';
        log(`401 ${e instanceof TokenError ? e.code : 'error'}`);
        return send(res, 401, rpcError(`Unauthorized: ${why}`), { 'www-authenticate': `Bearer error="invalid_token"` });
      }

      let body: unknown;
      try {
        body = await readBody(req);
      } catch (e) {
        return send(res, 400, rpcError(e instanceof Error ? e.message : 'bad request'));
      }

      // 2. Make that identity a Norn principal holding exactly the scope the token names.
      let actor;
      try {
        actor = await opts.norn.actorFor(claims);
      } catch (e) {
        if (e instanceof ActorError) {
          log(`${e.status} ${claims.actor} job=${claims.jobId}: ${e.message}`);
          return send(res, e.status, rpcError(e.message));
        }
        throw e;
      }

      // 3. Serve this one request as that actor.
      const server = new McpServer({ name: 'norn', version: '0.1.0' }, { instructions: INSTRUCTIONS });
      registerTools(server, { norn: opts.norn, claims, actor, log });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`500 ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!res.headersSent) send(res, 500, rpcError('Internal error'));
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, HOST, () => {
      const port = (http.address() as { port: number }).port;
      resolve({
        port,
        url: `http://${HOST}:${port}/mcp`,
        close: () =>
          new Promise<void>(r => {
            http.close(() => r());
            http.closeAllConnections();
          }),
      });
    });
  });
}
