// Unit tests for restricted roles (src/roles.ts): which tools a credential is offered and which ECRs and
// parts it may read. A fake server and a fake mirror, no database, no model.
//   npm run test:unit -w @norn/mcp
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ASK_NORN_ROLE, ASK_NORN_TOOLS, readsOnlyOwnEcrs, toolsForRole } from '../src/roles.ts';
import type { Norn } from '../src/norn.ts';
import type { Claims } from '../src/token.ts';
import { TOOL_NAMES, registerTools } from '../src/tools.ts';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: { text: string }[] }>;

const prs = [
  { id: 1n, plmEcrNumber: 'BWM-ECR-0417', title: 'Bracket', description: 'Replace BW-5120-210 with Rev B' },
  { id: 2n, plmEcrNumber: 'BWM-ECR-0409', title: 'Other', description: 'Change BW-7000-001 and BW-5120-210 finish' },
];
const stamp = { toDate: () => new Date(0) };
const part = (partNumber: string) => ({ partNumber, name: `Part ${partNumber}`, category: 'bracket', specJson: '{}', updatedAt: stamp });
const parts = [part('BW-5120-210'), part('BW-7000-001'), part('BW-9999-999')];
const none = { prId: { filter: () => [] } };

const fakeNorn = {
  findEcr(ref: string) {
    const want = ref.trim().toLowerCase();
    const known = prs.map(p => p.plmEcrNumber).sort();
    const hit = prs.filter(p => p.plmEcrNumber.toLowerCase() === want || p.plmEcrNumber.toLowerCase().endsWith(`-${want}`));
    return { pr: hit.length === 1 ? hit[0] : undefined, known };
  },
  db: {
    pullRequest: { iter: () => prs },
    part: { iter: () => parts },
    checkRun: none,
    checkResult: none,
    comment: none,
    actionLog: none,
  },
} as unknown as Norn;

function claims(role: string, ecrs: string[], kind: Claims['kind'] = 'job'): Claims {
  return { v: 1, kind, jobId: 'j1', role, actor: `agent:norn/${role}/j1`, onBehalfOf: kind === 'person_agent' ? 'person:jeff' : null, spawnedBy: 'norn', ecrs, iat: 0, exp: 9_999_999_999 };
}

function register(c: Claims): Map<string, Handler> {
  const tools = new Map<string, Handler>();
  const server = { registerTool: (name: string, _cfg: unknown, h: Handler) => void tools.set(name, h) } as unknown as McpServer;
  registerTools(server, { norn: fakeNorn, claims: c, actor: {} as never, log: () => {} });
  return tools;
}

const text = (r: { content: { text: string }[] }) => r.content.map(c => c.text).join('');
const askTools = () => register(claims(ASK_NORN_ROLE, ['BWM-ECR-0417']));

test('an ask-norn credential is offered the five read tools and nothing else', () => {
  assert.deepEqual([...askTools().keys()].sort(), [...ASK_NORN_TOOLS].sort());
  for (const banned of ['list_ecrs', 'add_comment', 'propose_assumption', 'post_impact_statement', 'request_fast_track_approval']) assert.ok(!askTools().has(banned), banned);
});

test('every other role is offered every tool, as before', () => {
  for (const c of [
    claims('level1-writeup', ['BWM-ECR-0417']),
    claims('level2-research', ['BWM-ECR-0417']),
    claims('researcher', ['BWM-ECR-0417']),
    claims('ask-norn-extra', ['BWM-ECR-0417']),
    claims('person-agent', ['*'], 'person_agent'),
  ]) {
    assert.deepEqual([...register(c).keys()].sort(), [...TOOL_NAMES].sort(), c.role);
  }
  assert.equal(toolsForRole('level1-writeup'), null);
  assert.equal(toolsForRole('constructor'), null);
  assert.equal(readsOnlyOwnEcrs('toString'), false);
  assert.equal(readsOnlyOwnEcrs(ASK_NORN_ROLE), true);
});

test('an ask-norn credential cannot read another ECR, however it is named', async () => {
  const t = askTools();
  for (const [tool, args] of [
    ['get_ecr', { ecr: 'BWM-ECR-0409' }],
    ['get_ecr', { ecr: 'ECR-0409' }],
    ['get_impact', { ecr: 'BWM-ECR-0409' }],
    ['list_assumptions', { ecr: 'BWM-ECR-0409' }],
    ['get_ecr_history', { ecr: 'BWM-ECR-0409' }],
    ['get_ecr_history', { ecr: 'no-such-ecr' }],
  ] as const) {
    const r = await t.get(tool)!(args);
    assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.match(text(r), /can read only BWM-ECR-0417/);
    assert.ok(!text(r).includes('0409') || /It cannot read '[^']*0409'/.test(text(r)), 'no list of other ECRs');
  }
  // the ECR it names reads fine, by full number or by its tail
  for (const ecr of ['BWM-ECR-0417', 'ECR-0417']) {
    const r = await t.get('get_ecr_history')!({ ecr });
    assert.equal(r.isError, undefined, ecr);
    assert.equal(JSON.parse(text(r)).ecr, 'BWM-ECR-0417');
  }
});

test('"any ECR" in an ask-norn token grants nothing', async () => {
  const r = await register(claims(ASK_NORN_ROLE, ['*'], 'person_agent')).get('get_ecr_history')!({ ecr: 'BWM-ECR-0417' });
  assert.equal(r.isError, true);
});

test('an ask-norn credential reads a part only when it is on the scoped ECR, and sees only that ECR', async () => {
  const t = askTools();
  const ok = await t.get('get_part')!({ part: 'bw-5120-210' });
  assert.equal(ok.isError, undefined);
  assert.deepEqual(JSON.parse(text(ok)).namedInEcrs, ['BWM-ECR-0417']);
  for (const p of ['BW-7000-001', 'BW-9999-999', 'BW-0000-000']) {
    const r = await t.get('get_part')!({ part: p });
    assert.equal(r.isError, true, p);
    assert.match(text(r), /can read only parts on the change request or BOM delta of BWM-ECR-0417/);
    assert.ok(!/BW-9999-999|BWM-ECR-0409/.test(text(r).replace(`'${p}'`, '')), 'no list of other parts or ECRs');
  }
});

test('a level1-writeup credential still reads any ECR and any part, with every ECR named', async () => {
  const t = register(claims('level1-writeup', ['BWM-ECR-0417']));
  assert.equal((await t.get('get_ecr_history')!({ ecr: 'BWM-ECR-0409' })).isError, undefined);
  const p = await t.get('get_part')!({ part: 'BW-9999-999' });
  assert.equal(p.isError, undefined);
  assert.deepEqual(JSON.parse(text(p)).namedInEcrs, []);
  const shared = JSON.parse(text(await t.get('get_part')!({ part: 'BW-5120-210' })));
  assert.deepEqual(shared.namedInEcrs, ['BWM-ECR-0417', 'BWM-ECR-0409']);
  const missing = await t.get('get_part')!({ part: 'nope' });
  assert.match(text(missing), /^No part 'nope' in Norn\. Part numbers: /);
  assert.match(text(await t.get('get_ecr_history')!({ ecr: 'nope' })), /^No single ECR matches 'nope'\. ECRs: BWM-ECR-0409, BWM-ECR-0417\./);
});
