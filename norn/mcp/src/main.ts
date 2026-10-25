// Start Norn's MCP server.   npm run start -w @norn/mcp
//   NORN_URI (ws://127.0.0.1:3000)  NORN_DB (norn)  NORN_MCP_PORT (3917)  NORN_MCP_STATE_DIR (norn/mcp/.state)
// The signing key is read from NORN_MCP_SIGNING_KEY or the root .env, and is never printed.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from './client.ts';
import { loadSigningKey } from './env.ts';
import { Norn } from './norn.ts';
import { startServer } from './server.ts';
import { statementGuardFor } from '../../workers/src/level1/guard.ts';

const here = dirname(fileURLToPath(import.meta.url));
const stamp = () => new Date().toISOString();
const log = (m: string) => console.error(`${stamp()} [norn-mcp] ${m}`);

const key = loadSigningKey();
if (!key) {
  console.error('NORN_MCP_SIGNING_KEY is not set. Run `npm run key:ensure -w @norn/mcp` to add one to the root .env.');
  process.exit(1);
}
const uri = process.env.NORN_URI ?? 'ws://127.0.0.1:3000';
const database = process.env.NORN_DB ?? 'norn';
const norn = await Norn.open({ uri, database, stateDir: process.env.NORN_MCP_STATE_DIR ?? join(here, '..', '.state'), log });
const port = Number(process.env.NORN_MCP_PORT ?? DEFAULT_PORT);
// Level 1 statements are checked against the rule's findings before they are saved (workers/src/level1/guard.ts).
const server = await startServer({ norn, signingKey: key, port, log, statementGuard: statementGuardFor(norn.db) });
log(`serving ${server.url} for database '${database}' at ${uri}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`${sig}: shutting down`);
    void server.close().then(() => {
      norn.close();
      process.exit(0);
    });
  });
}
