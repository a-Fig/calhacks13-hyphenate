// Offline tests for the pure half of the company gate (module/src/gate-logic.ts): how a write becomes
// one of the company's actions, how the facts are read from stored check results, and how the
// configuration's decision becomes allow / deny / downgrade. No database: the end-to-end check against
// a real module is src/checks-gate.ts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { canonicalJson, loadConfigFile, sampleValue, type CompanyConfig, type EcrFacts } from '../../config/src/index.ts';
import { costMeasureKey as rowKey } from '../../checks/src/rows.ts';
import {
  actionFor,
  configActor,
  costFromRows,
  costMeasureKey,
  judge,
  readCompanyConfig,
  readFastTrackRequest,
  slipFromRows,
  tierVerdict,
  type ResultRow,
} from '../../module/src/gate-logic.ts';

const BOWMAN = join(import.meta.dirname, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts');

const loaded = await loadConfigFile(BOWMAN);
assert.ok(loaded.ok);
const bowman: CompanyConfig = loaded.config;
const text = canonicalJson(bowman);
const HASH = 'test-hash';

// Bowman's configuration without the slip limit, so that the cost limit alone decides in the cases below;
// the slip limit has its own test.
const noSlipLimit: CompanyConfig = structuredClone(bowman);
for (const a of noSlipLimit.autonomy.actions) if (a.action === 'approve_fast_track_ecr') delete a.limits!.maxP90SlipDays;

const row = (key: string, p10: number, p50: number, p90: number, detail: object = {}, mock = false): ResultRow => ({ key, p10, p50, p90, detailJson: JSON.stringify(detail), mock });
const costRows = (p90: number, mock = false): ResultRow[] => [
  row('one_time_total', 0, 0, p90, {}, mock),
  row('recurring_year_one', 0, 0, p90, {}, mock),
  row('net_total_year_one', 0, 0, p90, { window: { months: 12 } }, mock),
  row(costMeasureKey(12, false), p90, p90, p90, { source: 'exact', horizonMonths: 12, savingsOffset: false, windowMonths: 12, draws: 10000, p50: p90, p90 }, mock),
];

// The answers that make the fast track apply: an authorized equivalent, nothing that rules it out.
const fastTrackAnswers = [
  { testId: 'no_form_fit_function_change', holds: true, evidence: 'Same geometry and interface.' },
  { testId: 'same_supplier_no_tooling', holds: true, evidence: 'Same supplier, no tooling.' },
  { testId: 'authorized_equivalent', holds: true, evidence: 'On the authorized list.' },
  ...bowman.approval.neverFastTrack.filter((t) => !t.whenClass).map((t) => ({ testId: t.id, holds: false, evidence: 'Checked: no.' })),
];
const request = (config: CompanyConfig) => {
  const r = readFastTrackRequest(config, { answers: fastTrackAnswers, companyClass: 'II', regulatoryClass: 'minor', triggers: [] });
  assert.ok(r.ok, r.ok ? '' : r.why);
  return structuredClone(r.request);
};
const factsFor = (ecrId: string, p90: number, req = request(bowman)): EcrFacts => ({
  ecrId,
  cost: costFromRows(costRows(p90), bowman),
  reportLevel: 1,
  classes: { company: req.classes.company, regulatory: req.classes.regulatory },
  answers: Object.fromEntries(req.answers.map((a) => [a.testId, a.holds])),
  triggers: req.triggers,
});
const agent = { kind: 'agent' as const };

// An ECR number whose draw for the fast track falls under the sample rate (Bowman's is 0.2).
const seed = bowman.autonomy.sampleSeed;
const drawn = Array.from({ length: 200 }, (_, i) => `ECR-${String(9000 + i).padStart(4, '0')}`).find(
  (id) => sampleValue({ sampleSeed: seed, ecrId: id, action: 'approve_fast_track_ecr' }) < 0.2,
)!;

describe('the stored configuration', () => {
  it('is none, unreadable or ok', () => {
    assert.equal(readCompanyConfig(undefined).state, 'none');
    assert.equal(readCompanyConfig('{').state, 'unreadable');
    assert.equal(readCompanyConfig('{"schemaVersion":1}').state, 'unreadable');
    assert.equal(readCompanyConfig(text).state, 'ok');
  });
});

describe('which write is which action', () => {
  it('maps the company decisions and leaves the rest unmapped', () => {
    assert.equal(actionFor('set_pr_status', { status: 'approved' }), 'approve_ecr_at_tier');
    assert.equal(actionFor('set_pr_status', { status: 'merged' }), 'release_eco');
    assert.equal(actionFor('set_pr_status', { status: 'review' }), null);
    assert.equal(actionFor('post_impact_statement', {}), 'post_impact_statement');
    assert.equal(actionFor('request_fast_track_approval', {}), 'approve_fast_track_ecr');
    for (const r of ['add_comment', 'set_config', 'complete_check', 'record_assumption']) assert.equal(actionFor(r, {}), null, r);
  });
  it('names a person by id or by name, and passes an unknown name on', () => {
    assert.deepEqual(configActor(bowman, { kind: 'person', name: 'Priya Venkataraman', onBehalfOf: null }), { kind: 'person', id: 'EMP-05' });
    assert.deepEqual(configActor(bowman, { kind: 'person', name: 'emp-01', onBehalfOf: null }), { kind: 'person', id: 'EMP-01' });
    assert.deepEqual(configActor(bowman, { kind: 'agent', name: 'a', onBehalfOf: 'Dana Okafor' }), { kind: 'agent', actingFor: 'EMP-02' });
    assert.deepEqual(configActor(bowman, { kind: 'agent', name: 'a', onBehalfOf: 'Tyler' }), { kind: 'agent', actingFor: 'Tyler' });
    assert.deepEqual(configActor(bowman, { kind: 'agent', name: 'a', onBehalfOf: null }), { kind: 'agent' });
    assert.equal(configActor(bowman, { kind: 'unknown', name: 'x', onBehalfOf: null }), null);
  });
});

describe('the fast-track request', () => {
  const base = { answers: fastTrackAnswers, companyClass: 'II', regulatoryClass: 'minor', triggers: [] as string[] };
  const refused = (over: object) => {
    const r = readFastTrackRequest(bowman, { ...base, ...over });
    assert.equal(r.ok, false);
    return r.ok ? '' : r.why;
  };
  it("accepts answers that name the configuration's tests, and keeps them", () => {
    const r = request(bowman);
    assert.equal(r.answers.length, fastTrackAnswers.length);
    assert.deepEqual(r.classes, { company: 'II', regulatory: 'minor' });
  });
  it('refuses an unknown test, a repeated test, a test the class settles, missing evidence, an unknown class and an unknown trigger', () => {
    assert.match(refused({ answers: [{ testId: 'made_up', holds: true, evidence: 'x' }] }), /not one of the configuration's fast-track tests/);
    assert.match(refused({ answers: [fastTrackAnswers[0], fastTrackAnswers[0]] }), /answered twice/);
    assert.match(refused({ answers: [{ testId: 'company_class_ii', holds: true, evidence: 'x' }] }), /settled by the ECR's class/);
    assert.match(refused({ answers: [{ testId: 'authorized_equivalent', holds: true, evidence: '  ' }] }), /no evidence/);
    assert.match(refused({ companyClass: 'IX' }), /not a company class/);
    assert.match(refused({ triggers: ['made_up'] }), /not a trigger/);
  });
});

describe('the cost, from stored results', () => {
  it('reads the totals, the window and the exact measure the configuration asks for', () => {
    const c = costFromRows(costRows(900), bowman)!;
    assert.equal(c.windowMonths, 12);
    assert.deepEqual(c.windowTotal, { p10: 0, p50: 0, p90: 900 });
    assert.deepEqual(c.measured, { source: 'exact', horizonMonths: 12, savingsOffset: false, p50: 900, p90: 900 });
  });
  it('ignores stand-in (mock) rows, so the cost is unmeasured', () => {
    assert.equal(costFromRows(costRows(900, true), bowman), undefined);
  });
  it('does not attach a measure of another savings rule, or one that says it is unavailable', () => {
    const other = costRows(900).map((r) =>
      r.key.startsWith('cost_measure') ? { ...r, key: costMeasureKey(12, true), detailJson: JSON.stringify({ ...JSON.parse(r.detailJson), savingsOffset: true }) } : r,
    );
    assert.equal(costFromRows(other, bowman)!.measured, undefined);
    const unavailable = costRows(900).map((r) => (r.key.startsWith('cost_measure') ? { ...r, detailJson: JSON.stringify({ ...JSON.parse(r.detailJson), source: 'unavailable' }) } : r));
    assert.equal(costFromRows(unavailable, bowman)!.measured, undefined);
  });
  it('reads the same row key the cost check writes', () => {
    assert.equal(costMeasureKey(12, false), rowKey(12, false));
    assert.equal(costMeasureKey(6, true), rowKey(6, true));
  });
  it('reads a slip only from a real timeline row: p90 weeks late, in days, never negative', () => {
    assert.equal(slipFromRows([row('late_weeks', 1, 2, 3, {}, true)]), undefined);
    assert.equal(slipFromRows([row('late_weeks', 0, 1, 3)]), 21);
    assert.equal(slipFromRows([row('late_weeks', -5, -3, -1)]), 0);
    assert.equal(slipFromRows([row('cut_in_weeks', 1, 2, 3)]), undefined);
    assert.equal(slipFromRows([]), undefined);
  });
});

describe('the decision', () => {
  it('approves the same agent request on a small ECR and recommends it on a large one, by the configuration alone', () => {
    const small = judge(noSlipLimit, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: factsFor('ECR-0423', 622), request: request(noSlipLimit) });
    const large = judge(noSlipLimit, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: factsFor('ECR-0417', 164_489), request: request(noSlipLimit) });
    assert.equal(small.effect, 'allow', small.reason);
    assert.equal(small.detail.route.tierId, 'technical_review');
    assert.equal(large.effect, 'downgrade', large.reason);
    assert.equal(large.detail.outcome, 'recommend');
    assert.equal(large.detail.route.tierId, 'board');
    assert.ok(large.detail.limits!.some((l) => l.limit === 'maxCost' && !l.held));
    assert.ok(large.detail.reasons.some((r) => r.rule.endsWith('limits.maxCost')), 'the reason names the limit');
    assert.deepEqual([...large.detail.recipients].sort(), ['cm_analyst', 'design_engineer']);
  });
  it('recommends when the cost is not the exact measure', () => {
    const facts = factsFor('ECR-0423', 622);
    delete facts.cost!.measured;
    const v = judge(noSlipLimit, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts, request: request(noSlipLimit) });
    assert.equal(v.effect, 'downgrade');
    assert.equal(v.detail.route.costBasis, 'unmeasured');
  });
  it("recommends under Bowman's real configuration while no slip is forecast", () => {
    const v = judge(bowman, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: factsFor('ECR-0423', 622), request: request(bowman) });
    assert.equal(v.effect, 'downgrade');
    assert.ok(v.detail.limits!.some((l) => l.limit === 'maxP90SlipDays' && !l.held && l.actual === null));
  });
  it("applies Bowman's 14-day slip limit once a real slip is known", () => {
    const facts = (slip: number) => ({ ...factsFor('ECR-0423', 622), slipP90Days: slip });
    const within = judge(bowman, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: facts(7), request: request(bowman) });
    const past = judge(bowman, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: facts(21), request: request(bowman) });
    assert.equal(within.effect, 'allow', within.reason);
    assert.equal(past.effect, 'downgrade');
    assert.ok(past.detail.limits!.some((l) => l.limit === 'maxP90SlipDays' && !l.held && l.actual === 21));
  });
  it('holds an approval drawn for the second check', () => {
    const v = judge(noSlipLimit, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: factsFor(drawn, 622), request: request(noSlipLimit) });
    assert.equal(v.effect, 'downgrade');
    assert.equal(v.detail.awaitingSecondCheck, true);
    assert.equal(v.detail.sample!.sampled, true);
  });
  it('turns a fast-track request on an ineligible ECR into a recommendation on the ordinary route', () => {
    const no = request(noSlipLimit);
    no.answers.find((a) => a.testId === 'no_form_fit_function_change')!.holds = false;
    const v = judge(noSlipLimit, HASH, { action: 'approve_fast_track_ecr', actor: agent, facts: factsFor('ECR-0423', 622, no), request: no });
    assert.equal(v.effect, 'downgrade');
    assert.equal(v.detail.action, 'approve_ecr_at_tier');
    assert.equal(v.detail.requestedAction, 'approve_fast_track_ecr');
    assert.deepEqual(v.detail.recipients, ['engineering_director']);
  });
  it('denies a person who does not chair a body that decides the tier, and approves one who does', () => {
    const facts = factsFor('ECR-0417', 164_489);
    const priya = judge(bowman, HASH, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: 'EMP-05' }, facts });
    assert.equal(priya.effect, 'deny');
    assert.match(priya.reason, /does not chair a body that decides this change/);
    const rafael = judge(bowman, HASH, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: 'EMP-01' }, facts });
    assert.equal(rafael.effect, 'allow');
  });
  it("downgrades a person's approval when the cost is not the exact measure", () => {
    const facts = factsFor('ECR-0417', 164_489);
    delete facts.cost!.measured;
    // Unmeasured, the ECR goes to the top tier, whose chair is the CFO.
    const v = judge(bowman, HASH, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: 'EMP-14' }, facts });
    assert.equal(v.effect, 'downgrade');
    assert.equal(judge(bowman, HASH, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: 'EMP-01' }, facts }).effect, 'deny');
  });
  it('denies a name that is not a person in the configuration', () => {
    const v = judge(bowman, HASH, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: 'Tyler' }, facts: factsFor('ECR-0417', 164_489) });
    assert.equal(v.effect, 'deny');
  });
  it('lets an agent release an ECR only once a body that covers its tier approved it', () => {
    const facts = factsFor('ECR-0417', 164_489);
    assert.equal(judge(bowman, HASH, { action: 'release_eco', actor: agent, facts }).effect, 'deny');
    const approved = judge(bowman, HASH, { action: 'release_eco', actor: agent, facts: { ...facts, approvedBy: 'ccb' } });
    assert.equal(approved.effect, 'allow', approved.reason);
    assert.equal(judge(bowman, HASH, { action: 'release_eco', actor: agent, facts: { ...facts, approvedBy: 'trc' } }).effect, 'downgrade');
  });
});

describe('an approval across a change of inputs', () => {
  const approvedAt = { tierId: 'technical_review', tierIndex: 0 };
  it('stands while the re-checked numbers point to the same tier', () => {
    assert.equal(tierVerdict(bowman, factsFor('ECR-0423', 5_000), approvedAt).stands, true);
  });
  it('is withdrawn, with the reason, when they point to a different tier', () => {
    const v = tierVerdict(bowman, factsFor('ECR-0423', 164_489), approvedAt);
    assert.equal(v.stands, false);
    if (!v.stands) assert.match(v.reason, /from the technical_review tier to the board tier/);
  });
  it('is withdrawn when the re-checked cost is no longer measured', () => {
    const facts = factsFor('ECR-0423', 5_000);
    delete facts.cost!.measured;
    assert.equal(tierVerdict(bowman, facts, approvedAt).stands, false);
  });
});
