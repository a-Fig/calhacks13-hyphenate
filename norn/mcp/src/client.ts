// For whoever builds a runner job: the `mcpServers` entry that gives the job Norn's tools, with a
// token minted for exactly that job. The token is the job's credential; the identity it carries is
// the one the server will act as, so build it from the same identity the job spec carries.
//
//   const spec: JobSpec = {
//     ...,
//     identity,
//     mcpServers: { [NORN_MCP_SERVER_NAME]: nornMcpFor(identity, { jobId: id, role, ecrs: ['BWM-ECR-0417'] }) },
//     allowedTools: nornTools('read', 'comment'),
//   };
import { loadSigningKey } from './env.ts';
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
}

/** An entry for a runner job spec's `mcpServers` (the Agent SDK's `http` config). */
export interface NornMcpServerEntry {
  type: 'http';
  url: string;
  headers: { Authorization: string };
}

export function nornMcpUrl(): string {
  return process.env.NORN_MCP_URL ?? `http://127.0.0.1:${process.env.NORN_MCP_PORT ?? DEFAULT_PORT}/mcp`;
}

export function nornMcpFor(identity: JobIdentity, opts: NornMcpOptions): NornMcpServerEntry {
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
  return { type: 'http', url: opts.url ?? nornMcpUrl(), headers: { Authorization: `Bearer ${token}` } };
}

// ---------------------------------------------------------------------------------------------
// Tool names, for a job's `allowedTools`
// ---------------------------------------------------------------------------------------------

export const READ_TOOLS = ['list_ecrs', 'get_ecr', 'get_impact', 'get_part', 'list_assumptions', 'get_ecr_history'] as const;
export const WRITE_TOOLS = ['add_comment', 'propose_assumption', 'post_impact_statement'] as const;
export type NornToolName = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

/** `mcp__norn__<tool>` names for a job's allowlist: `'read'` (all reads), `'write'` (all writes) or tool names. */
export function nornTools(...which: ('read' | 'write' | NornToolName)[]): string[] {
  const names = which.flatMap(w => (w === 'read' ? [...READ_TOOLS] : w === 'write' ? [...WRITE_TOOLS] : [w]));
  return [...new Set(names)].map(n => `mcp__${NORN_MCP_SERVER_NAME}__${n}`);
}
