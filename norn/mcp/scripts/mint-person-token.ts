// Mint a credential for a person's own agent (M5), e.g. Claude Code on an engineer's laptop.
// The token goes to a file, not to the screen: it is a secret, and the file is created mode 0600.
//
//   npm run token:person -w @norn/mcp -- --person jeff --label laptop --ecr BWM-ECR-0417 [--ecr ...] [--hours 8]
//   npm run token:person -w @norn/mcp -- --person jeff --label laptop --all-ecrs
//
// The agent then connects with the file's contents as a bearer token (the output says how). It acts
// in Norn as `agent:<person>/<label>`, as an outside agent for `person:<person>`, and may write only
// to the ECRs named here. Nothing can revoke a token before it expires except changing the key.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nornMcpUrl } from '../src/client.ts';
import { loadSigningKey } from '../src/env.ts';
import { MAX_TTL_SECONDS, signToken } from '../src/token.ts';

const { values } = parseArgs({
  options: {
    person: { type: 'string' },
    label: { type: 'string', default: 'agent' },
    ecr: { type: 'string', multiple: true, default: [] },
    'all-ecrs': { type: 'boolean', default: false },
    hours: { type: 'string', default: '8' },
    out: { type: 'string' },
  },
});

const fail = (m: string): never => {
  console.error(m);
  process.exit(64);
};
if (!values.person) fail('--person <name> is required, e.g. --person jeff');
if (!values['all-ecrs'] && values.ecr!.length === 0) fail('name the ECRs this agent may write to (--ecr BWM-ECR-0417, repeatable), or pass --all-ecrs');
if (values['all-ecrs'] && values.ecr!.length > 0) fail('use either --ecr or --all-ecrs, not both');
const key = loadSigningKey();
if (!key) fail('NORN_MCP_SIGNING_KEY is not set; run `npm run key:ensure -w @norn/mcp` first');
const hours = Number(values.hours);
if (!(hours > 0) || hours * 3600 > MAX_TTL_SECONDS.person_agent) fail(`--hours must be between 0 and ${MAX_TTL_SECONDS.person_agent / 3600}`);

const person = values.person!;
const actor = `agent:${person}/${values.label}`;
const token = signToken(
  {
    kind: 'person_agent',
    jobId: `pat-${randomBytes(4).toString('hex')}`,
    role: 'person-agent',
    actor,
    onBehalfOf: `person:${person}`,
    spawnedBy: `person:${person}`,
    ecrs: values['all-ecrs'] ? ['*'] : values.ecr!,
    ttlSeconds: hours * 3600,
  },
  key
);

const here = dirname(fileURLToPath(import.meta.url));
const file = values.out ?? join(here, '..', '.state', 'person-tokens', `${actor.replace(/[^a-z0-9_-]/gi, '_')}.token`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, token, { mode: 0o600 });
try {
  chmodSync(file, 0o600);
} catch {}

console.log(`Wrote a token for ${actor} (acting for person:${person}) to ${file}`);
console.log(`It may write to ${values['all-ecrs'] ? 'any ECR' : values.ecr!.join(', ')} and expires in ${hours} hour(s). Reads are open.`);
console.log('Connect Claude Code with:');
console.log(`  claude mcp add --transport http norn ${nornMcpUrl()} --header "Authorization: Bearer $(cat '${file}')"`);
