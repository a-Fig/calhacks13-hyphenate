// What the dispatcher tells the agent about routing (jobFactsOf), offline: a fake client cache holding
// the real cost check's rows for ECR-0417 and Bowman's real configuration, as the worker stores it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobFactsOf } from './dispatcher.ts';
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

test('with the company configuration stored, the agent is told the route Norn decided and not to name a board', () => {
  const { db, pr } = cache('ECR-0417', JSON.stringify(config));
  const facts = jobFactsOf(db, pr, 1, 7);
  assert.match(facts.routing.route!, /^Change Control Board, with Technical Review Committee review \(p90 cost about 16\d,\d{3} USD, above 150,000 USD\)$/);
  assert.equal(facts.routing.class, undefined, 'no class was decided, so the agent still proposes its own');
  const p = jobPrompt(facts);
  assert.ok(p.includes(`"${facts.routing.route}" (decided by Norn's routing; use it as given)`));
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
