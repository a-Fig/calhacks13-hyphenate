// For whoever builds a runner job: the `mcpServers` entry that gives the job Norn's tools, with a
// token minted for exactly that job. The token is the job's credential; the identity it carries is
// the one the server will act as, so build it from the same identity the job spec carries.
//
//   const id = `level1-${Date.now().toString(36)}`;
//   const identity = { actor: `agent:norn/level1/BWM-ECR-0417/${id}`, onBehalfOf: null, spawnedBy: 'norn' };
//   const spec: JobSpec = {
//     ...,
//     identity,
//     mcpServers: { [NORN_MCP_SERVER_NAME]: nornMcpFor(identity, { jobId: id, role: 'level1-writeup', ecrs: ['BWM-ECR-0417'] }) },
//     allowedTools: nornTools('read', 'add_comment'),
//   };
//
// Put the job id in the actor name. An actor can be held by one live job at a time, so a rerun of a
// job under the same actor name inside the token's life would be refused (HTTP 409).
//
// The token is kept off the command line. The Agent SDK hands MCP server configs to the `claude`
// process as `--mcp-config <json>`, so a token in `headers` is on argv (on Linux, readable by every
// local user through /proc). By default the entry carries a `headersHelper` instead: Claude Code runs
// `node headers-helper.mjs <token file>`, which prints the headers. The token file is in a private
// directory (mode 0600 / a current-user-only ACL). `delivery: 'header'` gives a plain Authorization
// header, for other MCP clients and tests. `npm run probe:argv` shows both on a live session.
import { createHash } from 'node:crypto';
import { readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSigningKey } from './env.ts';
import { securePrivateDir } from './fsutil.ts';
import { signToken, type TokenKind } from './token.ts';

/** The key under `mcpServers`, so tools appear to the model as `mcp__norn__<tool>`. */
export const NORN_MCP_SERVER_NAME = 'norn';

export const DEFAULT_PORT = 3917;

/** The runner's job identity (norn/runner `Identity`), repeated here so this package needs nothing from it. */
export interface JobIdentity {
  actor: string;
  onBehalfOf: string | null;
  spawnedBy: string;
}

export interface NornMcpOptions {
  /** The runner job id; it also names the job's scope grant in Norn, so make it unique per job. */
  jobId: string;
  role: string;
  /** PLM numbers of the ECRs this job may write to (reads are open). */
  ecrs: string[];
  /** Token lifetime. Default 30 minutes; at most 6 hours for a job. */
  ttlSeconds?: number;
  /** Where the server is. Default `NORN_MCP_URL`, else `http://127.0.0.1:<NORN_MCP_PORT or 3917>/mcp`. */
  url?: string;
  /** Default: `NORN_MCP_SIGNING_KEY` from the environment or the root `.env`. */
  signingKey?: string;
  /** 'job' (default) or 'person_agent'. A person's agent is minted by scripts/mint-person-token.ts. */
  kind?: TokenKind;
  /**
   * How the token reaches the server: `'headersHelper'` (default; the token is in a private file and
   * not on any command line) or `'header'` (a plain Authorization header).
   */
  delivery?: 'headersHelper' | 'header';
}

/** An entry for a runner job spec's `mcpServers` with a plain Authorization header (`delivery: 'header'`). */
export interface NornMcpServerEntry {
  type: 'http';
  url: string;
  headers: { Authorization: string };
}

/** The default entry: Claude Code runs `headersHelper` to get the headers, so no token is on a command line. */
export interface NornMcpHelperEntry {
  type: 'http';
  url: string;
  headersHelper: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const HELPER = join(here, '..', 'scripts', 'headers-helper.mjs');

/** Where job token files live: `<state dir>/job-tokens` (NORN_MCP_STATE_DIR, else norn/mcp/.state). */
export function jobTokenDir(): string {
  return join(process.env.NORN_MCP_STATE_DIR ?? join(here, '..', '.state'), 'job-tokens');
}

/** The file that holds a job's token when it is delivered through the headers helper. */
export function jobTokenFile(jobId: string): string {
  const safe = jobId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
  return join(jobTokenDir(), `${safe}-${createHash('sha256').update(jobId).digest('hex').slice(0, 8)}.token`);
}

// Token files older than a day are long expired (a job token lives at most six hours): remove them.
function pruneOldTokenFiles(dir: string, keep: string): void {
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (basename(p) !== basename(keep) && Date.now() - statSync(p).mtimeMs > 24 * 3600_000) unlinkSync(p);
    }
  } catch {
    // best effort
  }
}

export function nornMcpUrl(): string {
  return process.env.NORN_MCP_URL ?? `http://127.0.0.1:${process.env.NORN_MCP_PORT ?? DEFAULT_PORT}/mcp`;
}

export function nornMcpFor(identity: JobIdentity, opts: NornMcpOptions & { delivery: 'header' }): NornMcpServerEntry;
export function nornMcpFor(identity: JobIdentity, opts: NornMcpOptions): NornMcpHelperEntry;
export function nornMcpFor(identity: JobIdentity, opts: NornMcpOptions): NornMcpServerEntry | NornMcpHelperEntry {
  const key = opts.signingKey ?? loadSigningKey();
  if (!key) throw new Error('NORN_MCP_SIGNING_KEY is not set; run `npm run key:ensure -w @norn/mcp`');
  const token = signToken(
    {
      kind: opts.kind ?? 'job',
      jobId: opts.jobId,
      role: opts.role,
      actor: identity.actor,
      onBehalfOf: identity.onBehalfOf,
      spawnedBy: identity.spawnedBy,
      ecrs: opts.ecrs,
      ttlSeconds: opts.ttlSeconds ?? 1800,
    },
    key
  );
  const url = opts.url ?? nornMcpUrl();
  if (opts.delivery === 'header') return { type: 'http', url, headers: { Authorization: `Bearer ${token}` } };
  const file = jobTokenFile(opts.jobId);
  securePrivateDir(jobTokenDir());
  writeFileSync(file, token, { mode: 0o600 });
  pruneOldTokenFiles(jobTokenDir(), file);
  return { type: 'http', url, headersHelper: `node "${HELPER}" "${file}"` };
}

// ---------------------------------------------------------------------------------------------
// Tool names, for a job's `allowedTools`
// ---------------------------------------------------------------------------------------------

export const READ_TOOLS = ['list_ecrs', 'get_ecr', 'get_impact', 'get_part', 'list_assumptions', 'get_ecr_history'] as const;
export const WRITE_TOOLS = ['add_comment', 'propose_assumption', 'post_impact_statement', 'request_fast_track_approval'] as const;
export type NornToolName = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

/** `mcp__norn__<tool>` names for a job's allowlist: `'read'` (all reads), `'write'` (all writes) or tool names. */
export function nornTools(...which: ('read' | 'write' | NornToolName)[]): string[] {
  const names = which.flatMap(w => (w === 'read' ? [...READ_TOOLS] : w === 'write' ? [...WRITE_TOOLS] : [w]));
  return [...new Set(names)].map(n => `mcp__${NORN_MCP_SERVER_NAME}__${n}`);
}
