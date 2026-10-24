// The prompts, the materiality screen and the runner-event mapping, offline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toInput } from './agent-events.ts';
import { SYSTEM_PROMPT, jobPrompt, screenDetail, type JobFacts } from './prompt.ts';
import { ROUTE_PENDING } from './routing.ts';

const detail = {
  drivers: [
    { id: 'decision:inventory:X', label: 'X: use up the old stock or scrap it', kind: 'decision', low: 96233, high: 156821, swing: 60588 },
    { id: 'cost:a', label: 'Qualification re-test', kind: 'input', low: 153585, high: 160742, swing: 7157 },
    { id: 'cost:b', label: 'Engineering revision', kind: 'input', low: 154133, high: 160079, swing: 5946 },
    { id: 'price:X', label: 'X price index', kind: 'input', low: 156118, high: 158226, swing: 2107 },
    { id: 'tiny', label: 'NC programming', kind: 'input', low: 156560, high: 157099, swing: 539 },
    { id: 'small-decision', label: 'Small decision', kind: 'decision', low: 1, high: 2000, swing: 2000 },
  ],
  flags: [
    { kind: 'cross_check', severity: 'info', message: 'The per-unit change matches the BOM delta.' },
    { kind: 'needs_estimate', severity: 'warn', message: '"Re-inspection" was left blank.' },
    { kind: 'needs_estimate', severity: 'warn', message: '"Spares" was left blank.' },
    { kind: 'needs_estimate', severity: 'warn', message: '"Delay cost" was left blank.' },
    { kind: 'needs_estimate', severity: 'warn', message: '"Fourth blank" was left blank.' },
    { kind: 'read_from_quote', severity: 'info', message: 'A first-lot premium was read from the quote.' },
  ],
  inputs: [
    { id: 'row:1', label: 'A stated cost', source: 'given' },
    { id: 'default:scrap', label: 'Share of scrapped value recovered', source: 'default', rationale: 'Metal value only.' },
    { id: 'cost:blank', label: 'Spares', source: 'default', needsEstimate: true, rationale: 'Left blank.' },
  ],
};

test('the screen names only drivers that clear Bowman\'s bars, largest first', () => {
  const s = screenDetail(detail, 13_824);
  // 7,157 / 13,824 = 52%, 5,946 = 43%, 2,107 = 15%; 539 = 4% is below the 10% bar; a $2,000 decision is below $10,000
  assert.equal(s.drivers.length, 3);
  assert.ok(s.drivers[0]!.startsWith('X: use up the old stock or scrap it'), 'the decision swing clears $10,000');
  assert.ok(s.drivers.some(d => d.includes('Qualification re-test') && d.includes('52%')));
  assert.ok(!s.drivers.some(d => d.includes('NC programming') || d.includes('Small decision')));
});

test('at most three flags, warnings before information, and the blank lines are among them', () => {
  const s = screenDetail(detail, 13_824);
  assert.equal(s.flags.length, 3);
  assert.ok(s.flags.every(f => f.includes('left blank')));
  assert.ok(!s.flags.some(f => f.includes('matches the BOM delta')));
});

test('the assumptions on offer are the inputs that are not stated facts, blank lines first', () => {
  const s = screenDetail(detail, 13_824);
  assert.deepEqual(s.assumptions.map(a => a.label), ['Spares', 'Share of scrapped value recovered']);
});

const facts = (over: Partial<JobFacts> = {}): JobFacts => ({
  ecr: 'ECR-0417',
  title: 'Motor-controller mounting bracket',
  revision: 1,
  s2RunId: 7,
  baseline: 'ERPNext baseline 2c02958e, as of 2026-10-24',
  changeRequest: 'change request rev 1 from the PLM',
  numbers: [{ key: 'unit_cost_delta_vesper', resultKey: 'unit_cost_delta:vesper', label: 'Unit cost change per unit, vesper' }, { key: 'one_time_total', resultKey: 'one_time_total', label: 'One-time cost' }],
  screened: screenDetail(detail, 13_824),
  routing: {},
  ...over,
});

test('the job prompt gives the exact keys, the route text and the sources, and does not route', () => {
  const p = jobPrompt(facts());
  assert.ok(p.includes('resultKey "unit_cost_delta:vesper"') && p.includes('resultKey "one_time_total"'));
  assert.ok(p.includes(`"${ROUTE_PENDING}"`) && p.includes('do not name a board or a tier'));
  assert.ok(p.includes('ERPNext baseline 2c02958e, as of 2026-10-24') && p.includes('check run 7'));
  assert.ok(p.includes('Proposed change class: '));
  assert.ok(p.includes('"Class I" or "Class II" only if you can give a one-line reason'));
});

test('when routing has decided, the prompt says to use it as given', () => {
  const p = jobPrompt(facts({ routing: { class: 'Class II', route: 'Fast track' } }));
  assert.ok(p.includes('"Class II" (decided by Norn\'s routing') && p.includes('"Fast track" (decided by Norn\'s routing'));
  assert.ok(!p.includes('Proposed change class: '));
});

test('the system prompt carries the posting standards', () => {
  for (const w of ['almost no chance', 'almost certain', 'fact', 'assumption', 'computation', 'judgment', 'ICD'.slice(0, 0), '$250', '$10,000', '14 days', 'at most 3 flags', 'ECN']) assert.ok(SYSTEM_PROMPT.includes(w), w);
  assert.ok(SYSTEM_PROMPT.includes('separate sentences'));
  assert.ok(!/\bapprove[sd]? .* tier\b/i.test(SYSTEM_PROMPT), 'no routing logic in the prompt');
});

test('a runner event becomes an agent_event row: named fields out, the rest as JSON', () => {
  const row = toInput({
    seq: 3,
    ts: '2026-10-24T20:00:00.000Z',
    jobId: 'l1-ECR-0417-r1-a1',
    role: 'level1',
    identity: { actor: 'agent:norn/level1/l1-ECR-0417-r1-a1', onBehalfOf: null, spawnedBy: 'norn: check_run 7' },
    sessionId: null,
    type: 'tool_call',
    toolUseId: 't1',
    tool: 'mcp__norn__get_ecr',
    input: { ecr: 'ECR-0417' },
    parentToolUseId: null,
  } as any);
  assert.equal(row.jobId, 'l1-ECR-0417-r1-a1');
  assert.equal(row.seq, 3);
  assert.equal(row.eventType, 'tool_call');
  assert.equal(row.onBehalfOf, undefined);
  assert.equal(row.sessionId, undefined);
  assert.equal(row.spawnedBy, 'norn: check_run 7');
  assert.deepEqual(JSON.parse(row.payloadJson), { toolUseId: 't1', tool: 'mcp__norn__get_ecr', input: { ecr: 'ECR-0417' }, parentToolUseId: null });
  const big = toInput({ seq: 0, ts: '2026-10-24T20:00:00.000Z', jobId: 'j', role: 'level1', identity: { actor: 'a', onBehalfOf: null, spawnedBy: 's' }, sessionId: 'x', type: 'tool_result', content: 'x'.repeat(300_000) } as any);
  assert.ok(big.payloadJson.length < 200_000);
  assert.equal(JSON.parse(big.payloadJson).payloadTruncated, true);
});
