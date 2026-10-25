// What the dispatcher tells the agent about routing (jobFactsOf), offline: a fake client cache holding
// the real cost check's rows for ECR-0417 and Bowman's real configuration, as the worker stores it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factsOf, jobFactsOf } from './dispatcher.ts';
import { jobPrompt } from './prompt.ts';
import { bowmanConfig, storedRows } from './routing-fixture.ts';
import { ROUTE_PENDING } from './routing.ts';

type Db = Parameters<typeof jobFactsOf>[0];
type Pr = Parameters<typeof jobFactsOf>[1];

const config = await bowmanConfig();
const inputsJson = JSON.stringify({ revision: 1, revisionSource: 'plm', erpBaseline: '2c02958e00', erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24' });

/** The parts of the client cache jobFactsOf reads. `stored` is what norn_config holds under company_config. */
function cache(ecrId: string, stored?: string): { db: Db; pr: Pr } {
  const pr = { id: 5n, plmEcrNumber: ecrId, title: 'Motor-controller mounting bracket' } as Pr;
  const rows = storedRows(ecrId).map((r, i) => ({ id: BigInt(i + 1), prId: 5n, checkRunId: 7n, mock: false, ...r }));
  const db = {
    checkRun: { prId: { filter: () => [] }, id: { find: (id: bigint) => (id === 7n ? { id: 7n, inputsJson } : undefined) } },
    checkResult: { prId: { filter: (id: bigint) => (id === 5n ? rows : []) } },
    nornConfig: { key: { find: (k: string) => (k === 'company_config' && stored !== undefined ? { key: k, value: stored } : null) } },
  } as unknown as Db;
  return { db, pr };
}

test('with the company configuration stored, the agent is told the route Fern decided and not to name a board', () => {
  const { db, pr } = cache('ECR-0417', JSON.stringify(config));
  const facts = jobFactsOf(db, pr, 1, 7);
  assert.match(facts.routing.route!, /^Change Control Board, with Technical Review Committee review \(p90 cost about 16\d,\d{3} USD, above 150,000 USD\)$/);
  assert.equal(facts.routing.class, undefined, 'no class was decided, so the agent still proposes its own');
  const p = jobPrompt(facts);
  assert.ok(p.includes(`"${facts.routing.route}" (decided by Fern's routing; use it as given)`));
  assert.ok(!p.includes(ROUTE_PENDING));
  assert.ok(p.includes('Proposed change class: '), 'the class proposal is still asked for');
});

test('with no configuration stored, nothing is routed and the agent is told the route is pending', () => {
  const { db, pr } = cache('ECR-0417');
  const facts = jobFactsOf(db, pr, 1, 7);
  assert.deepEqual(facts.routing, {});
  assert.ok(jobPrompt(facts).includes(`"${ROUTE_PENDING}"`));
});

test('a stored configuration that does not validate routes nothing, and the dispatcher still works', () => {
  const { db, pr } = cache('ECR-0417', '{"company":{}}');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(jobFactsOf(db, pr, 1, 7).routing, {});
  } finally {
    console.warn = warn;
  }
});

test('the headline numbers the agent is told to use are unchanged by routing', () => {
  const withConfig = jobFactsOf(...(Object.values(cache('ECR-0417', JSON.stringify(config))) as [Db, Pr]), 1, 7);
  const without = jobFactsOf(...(Object.values(cache('ECR-0417')) as [Db, Pr]), 1, 7);
  assert.deepEqual(withConfig.numbers, without.numbers);
});

test("factsOf reads the research worker's stored results only when asked, for this ECR and by change-request revision", () => {
  const ts = { toDate: () => new Date('2026-10-24T20:00:00Z') };
  const ev = (jobId: string, role: string, eventType: string, id = 1) => ({ id: BigInt(id), jobId, role, eventType, ts, payloadJson: '{}' });
  const pr = { id: 5n, plmEcrNumber: 'ECR-0417', status: 'draft', revision: 3 } as Pr;
  const events = [
    ev('research-ECR-0417-r2-0a1b2c3d-a1', 'researcher', 'research_result'),
    ev('research-ECR-0417-r1-ffffffff-a1', 'researcher', 'job_started'), // started, no result: not researched
    ev('research-ECR-0423-r1-0a1b2c3d-a1', 'researcher', 'research_result'), // another ECR's
    ev('l1-ECR-0417-r1-e3-a1', 'level1-statement', 'job_started'),
  ];
  const at = (iso: string) => ({ toDate: () => new Date(iso), microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n });
  const finishedAt = at('2026-10-24T20:00:20Z');
  const db = {
    ecrRevision: { prId: { filter: () => [{ seq: 2, current: true, createdAt: ts }] } },
    // run 6 completed at 20:00:05 (its results say so); its finishedAt was overwritten when it went stale
    checkResult: { prId: { filter: () => [{ id: 1n, checkRunId: 6n, createdAt: at('2026-10-24T20:00:05Z') }] } },
    checkRun: { prId: { filter: () => [{ id: 6n, stage: 's2_cost', status: 'stale', inputsJson: JSON.stringify({ revision: 2 }), finishedAt: at('2026-10-24T20:09:00Z') }, { id: 7n, stage: 's2_cost', status: 'done', inputsJson: JSON.stringify({ revision: 2 }), finishedAt }] } },
    agentEvent: { prId: { filter: () => events } },
    impactStatement: { prId: { filter: () => [] } },
  } as unknown as Db;
  const off = factsOf(db, pr, 'level1-statement');
  assert.equal(off.researched, undefined, 'research off: the field is not even read');
  assert.equal(off.jobs.length, 1, 'only this role, as before');
  const on = factsOf(db, pr, 'level1-statement', true);
  assert.deepEqual(on.researched, [2]);
  assert.equal(on.s2Done[0]!.finishedMs, Date.parse('2026-10-24T20:00:20Z'));
  assert.equal(on.firstS2FinishedMs, Date.parse('2026-10-24T20:00:05Z'), 'the first finished run on the current revision, though it has since gone stale');
});
