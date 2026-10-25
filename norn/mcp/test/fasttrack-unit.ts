// Unit tests for the fast-track tool and signal: argument validation and the messages, the `candidate`
// computation on Bowman's real configuration and dataset (the real cost and timeline checks' stored rows),
// and that the signal and the gate agree. No database, no model.
//   npm run test:unit -w @norn/mcp
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck, costCheckRows, timelineCheck, timelineRows } from '../../checks/src/index.ts';
import { canonicalJson, loadConfigFile, type CompanyConfig } from '../../config/src/index.ts';
import { configActor, factsFromRows, fastTrackSignal, judge, readCompanyConfig, resolveClasses, statementCompanyClass, type ResultRow } from '../../module/src/gate-logic.ts';
import { explainRefusal, fastTrackField, outcomeOf, prepareRequest } from '../src/fasttrack.ts';

const loaded = await loadConfigFile(join(import.meta.dirname, '..', '..', '..', 'bowman', 'norn-config', 'bowman.config.ts'));
assert.ok(loaded.ok);
const config: CompanyConfig = loaded.config;
const agent = configActor(config, { kind: 'agent', name: 'agent:norn/level1/x', onBehalfOf: null })!;

// The rows the cost (with the configured measure) and timeline checks store for one of Bowman's ECRs.
const SEED = 'norn-seed-1';
function rowsFor(ecrId: string): { cost: ResultRow[]; slip: ResultRow[] } {
  const ecr = bowman.ecrs.find(e => e.id === ecrId)!;
  const m = config.approval.costMeasure;
  const cost = costCheckRows(costCheck(bowman, JSON.parse(JSON.stringify(ecr)), { seed: SEED, measures: [{ horizonMonths: m.horizonMonths, savingsOffset: m.savingsOffset }], windowMonths: m.horizonMonths }));
  const slip = timelineRows(timelineCheck(bowman, JSON.parse(JSON.stringify(ecr)), { seed: SEED }));
  return { cost: cost.map(r => ({ ...r, mock: false })), slip: slip.map(r => ({ ...r, mock: false })) };
}
const real = { 'ECR-0423': rowsFor('ECR-0423'), 'ECR-0417': rowsFor('ECR-0417') };
const signal = (id: 'ECR-0423' | 'ECR-0417', over: Partial<Parameters<typeof fastTrackSignal>[1]> & { reportLevel?: number; cost?: ResultRow[] } = {}) =>
  fastTrackSignal(config, {
    facts: factsFromRows({ ecrId: id, costRows: over.cost ?? real[id].cost, slipRows: real[id].slip, reportLevel: over.reportLevel ?? 0 }, config),
    actor: over.actor ?? agent,
    status: over.status ?? 'review',
    checksFinished: over.checksFinished ?? true,
    maxReportLevel: over.maxReportLevel ?? 1,
    statementCompany: over.statementCompany,
  });

test('Bowman: ECR-0423 is a fast-track candidate, and the signal says which tests, which classes and what to post first', () => {
  const s = signal('ECR-0423');
  assert.equal(s.candidate, true, s.why);
  assert.deepEqual(s.tests.map(t => t.id).sort(), [
    'authorized_equivalent', 'documentation_fix', 'interchangeability_or_interface', 'no_form_fit_function_change', 'obsolescence_replacement',
    'retrofit_of_delivered_units', 'safety_part', 'same_supplier_no_tooling', 'supplier_process_or_tooling',
  ]);
  assert.ok(s.tests.every(t => t.text.length > 3 && ['neverFastTrack', 'requireAll', 'requireOneOf'].includes(t.list)));
  assert.deepEqual(s.propose, { companyClass: 'II', regulatoryClass: 'minor' });
  assert.match(s.why, /against a limit of/);
  assert.match(s.why, /Post your Level 1 statement first/);
  assert.match(s.why, /Your statement must propose Class II/, 'with no statement yet the signal says the statement has to propose the class the tests need');
  assert.doesNotMatch(signal('ECR-0423', { reportLevel: 1 }).why, /Post your Level/);
  const withStatement = signal('ECR-0423', { reportLevel: 1, statementCompany: 'II' });
  assert.equal(withStatement.candidate, true, withStatement.why);
  assert.match(withStatement.why, /Fern takes the company class from your statement/);
});

test("a Class I statement makes the ECR no candidate: Fern's class decides, not the agent's", () => {
  const s = signal('ECR-0423', { reportLevel: 1, statementCompany: 'I' });
  assert.equal(s.candidate, false);
  assert.match(s.why, /current statement proposes Class I/);
  assert.deepEqual(s.propose, {});
});

test('Bowman: ECR-0417 is not a candidate: over the cost limit and late', () => {
  const s = signal('ECR-0417', { reportLevel: 1 });
  assert.equal(s.candidate, false);
  assert.match(s.why, /limit of 25,000/);
  assert.match(s.why, /slip is [\d.]+ days against a limit of 14/);
  assert.equal(s.tests.length, 9);
});

test('the signal is false, with the reason, when something other than an answer is in the way', () => {
  assert.match(signal('ECR-0423', { status: 'approved' }).why, /ECR is approved; the fast track decides ECRs in review/);
  assert.match(signal('ECR-0423', { checksFinished: false }).why, /checks are still running/);
  const noCost = signal('ECR-0423', { cost: [] });
  assert.equal(noCost.candidate, false);
  assert.match(noCost.why, /unmeasured/);
  const mock = signal('ECR-0423', { cost: real['ECR-0423'].cost.map(r => ({ ...r, mock: true })) });
  assert.equal(mock.candidate, false);
  // an agent that may not post the Level 1 report the limits need cannot meet the report limit by writing it
  const noReport = signal('ECR-0423', { maxReportLevel: 0 });
  assert.equal(noReport.candidate, false);
  assert.match(noReport.why, /no report yet|needs at least Level 1/);
  // an agent acting for someone the configuration does not know is refused by the gate, so it is no candidate
  const stranger = signal('ECR-0423', { actor: configActor(config, { kind: 'agent', name: 'a', onBehalfOf: 'Nobody Known' })! });
  assert.equal(stranger.candidate, false);
  assert.match(stranger.why, /not a person in this configuration|do not let this agent/);
});

test('no choice of class can satisfy the tests: not a candidate, and the reason says so', () => {
  const noII: CompanyConfig = structuredClone(config);
  noII.changeClasses.company.values = noII.changeClasses.company.values.filter(v => v.id !== 'II');
  noII.changeClasses.company.whenUnsure = 'I';
  const facts = factsFromRows({ ecrId: 'ECR-0423', costRows: real['ECR-0423'].cost, slipRows: real['ECR-0423'].slip, reportLevel: 1 }, noII);
  const s = fastTrackSignal(noII, { facts, actor: agent, status: 'review', checksFinished: true, maxReportLevel: 1 });
  assert.equal(s.candidate, false);
  assert.match(s.why, /No choice of company and regulatory class/);
  assert.deepEqual(s.propose, {});
});

test('the signal and the gate agree: what the signal calls a candidate the gate does not recommend, and the reverse', () => {
  for (const id of ['ECR-0423', 'ECR-0417'] as const) {
    const s = signal(id, { reportLevel: 1 });
    // the request the signal's own favourable answers make
    const answers = s.tests.map(t => ({ testId: t.id, holds: t.list !== 'neverFastTrack', evidence: 'test' }));
    // an agent that states the classes the tests need, on a statement that proposes the company class
    const p = prepareRequest(config, { answers, regulatoryClass: s.propose.regulatoryClass ?? 'major' }, s.propose.companyClass ?? 'I');
    assert.ok(p.ok, p.ok ? '' : p.message);
    const facts = factsFromRows({ ecrId: id, costRows: real[id].cost, slipRows: real[id].slip, reportLevel: 1 }, config, p.request);
    const v = judge(config, 'h', { action: 'approve_fast_track_ecr', actor: agent, facts, request: p.request });
    const decidedApproval = v.detail.outcome === 'approve' || v.detail.outcome === 'approve_sampled';
    assert.equal(decidedApproval && v.detail.action === 'approve_fast_track_ecr', s.candidate, `${id}: signal ${s.candidate}, gate ${v.detail.outcome} (${v.detail.action})`);
  }
});

test('the request is checked against the configuration before anything is sent', () => {
  const ok = [{ testId: 'safety_part', holds: false, evidence: 'Not a safety part.' }];
  const msg = (answers: unknown, extra: object = {}, statement: string | undefined = 'II') => {
    const r = prepareRequest(config, { answers: answers as never, regulatoryClass: 'minor', ...extra }, statement);
    return r.ok ? '' : r.message;
  };
  assert.match(msg([{ testId: 'nope', holds: true, evidence: 'x' }]), /Nothing was sent to Fern: 'nope' is not one of the configuration's fast-track tests \(.*safety_part/);
  assert.match(msg([...ok, ...ok]), /'safety_part' is answered twice/);
  assert.match(msg([{ testId: 'safety_part', holds: false, evidence: '   ' }]), /has no evidence/);
  assert.match(msg([{ testId: 'faa_minor', holds: true, evidence: 'x' }]), /settled by the ECR's class, not by an answer/);
  assert.match(msg(ok, { companyClass: 'IX' }), /'IX' is not a company class \(I, II\)/);
  assert.match(msg(ok, { triggers: ['rain'] }), /'rain' is not a trigger/);
  assert.match(msg([{ testId: 'safety_part', holds: false, evidence: 'x'.repeat(401) }]), /too long/);
  // the company class left out is the statement's, and the answer can say where each class came from
  const good = prepareRequest(config, { answers: ok, regulatoryClass: 'minor' }, 'II');
  assert.ok(good.ok);
  assert.deepEqual(good.request.classes, { company: 'II', regulatory: 'minor' });
  assert.deepEqual(good.request.classSources, { company: 'statement', regulatory: 'agent' });
  const mine = prepareRequest(config, { answers: ok, companyClass: 'I', regulatoryClass: 'major' }, 'II');
  assert.ok(mine.ok, "a class stricter than Fern's is the agent's to send");
  assert.deepEqual([mine.request.classes, mine.request.classSources], [{ company: 'I', regulatory: 'major' }, { company: 'agent_stricter', regulatory: 'agent' }]);
});

test('classes are never filled in with the permissive value, and never more permissive than the statement', () => {
  const ok = [{ testId: 'safety_part', holds: false, evidence: 'Not a safety part.' }];
  // no statement class at all: nothing to take, so the request is refused in words
  const none = prepareRequest(config, { answers: ok, regulatoryClass: 'minor' }, undefined);
  assert.ok(!none.ok);
  assert.match(none.message, /Nothing was sent to Fern: Fern has no change class for this revision/);
  assert.match(none.message, /State the change class and the regulatory class, with evidence/);
  // a regulatory class left out: Norn has none of its own to use
  const noReg = prepareRequest(config, { answers: ok }, 'II');
  assert.ok(!noReg.ok);
  assert.match(noReg.message, /state the regulatory \(FAA\) class in regulatoryClass/);
  // Class I statement, Class II sent: refused
  const up = prepareRequest(config, { answers: ok, companyClass: 'II', regulatoryClass: 'minor' }, 'I');
  assert.ok(!up.ok);
  assert.match(up.message, /you proposed Class II, but the ECR's current statement proposes Class I/);
  // Class II sent with no statement class at all: refused too
  const noStmt = prepareRequest(config, { answers: ok, companyClass: 'II', regulatoryClass: 'minor' }, undefined);
  assert.ok(!noStmt.ok);
  // Class I statement, class left out: decided on Class I, so the gate does not approve
  const answers = signal('ECR-0423').tests.map(t => ({ testId: t.id, holds: t.list !== 'neverFastTrack', evidence: 'test' }));
  const req = prepareRequest(config, { answers, regulatoryClass: 'minor' }, 'I');
  assert.ok(req.ok);
  assert.equal(req.request.classes.company, 'I');
  const v = judge(config, 'h', { action: 'approve_fast_track_ecr', actor: agent, facts: factsFromRows({ ecrId: 'ECR-0423', costRows: real['ECR-0423'].cost, slipRows: real['ECR-0423'].slip, reportLevel: 1 }, config, req.request), request: req.request });
  assert.notEqual(v.detail.outcome, 'approve');
  assert.notEqual(v.detail.outcome, 'approve_sampled');
  assert.notEqual(v.effect, 'allow');
});

test("Fern's company class is read from the current revision's newest statement at the highest level", () => {
  const st = (id: number, level: number, prRevision: number, changeClass: string) => ({ id: BigInt(id), level, prRevision, changeClass });
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, 'Class II')], 1), 'II');
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, 'II')], 1), 'II');
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, ' class i ')], 1), 'I');
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, 'Unclassified')], 1), undefined);
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, 'Class II')], 2), undefined, "a statement of an earlier revision is not Fern's class now");
  assert.equal(statementCompanyClass(config, [st(1, 1, 1, 'Class II'), st(2, 1, 1, 'Class I')], 1), 'I', 'the newest statement at that level');
  assert.equal(statementCompanyClass(config, [st(1, 2, 1, 'Class I'), st(2, 1, 1, 'Class II')], 1), 'I', 'the highest level wins');
  assert.deepEqual(resolveClasses(config, { company: '', regulatory: '' }, undefined), { ok: true, classes: { company: '', regulatory: '' }, sources: { company: 'none', regulatory: 'none' } });
  assert.equal(resolveClasses(config, { company: 'II', regulatory: 'minor' }, 'I').ok, false);
  assert.equal(resolveClasses(config, { company: 'I', regulatory: 'minor' }, 'II').ok, true);
});

test("the reducer's refusals are put in words an agent can act on", () => {
  assert.equal(explainRefusal('ECR 7 is approved; the fast track decides ECRs in review', 'BWM-ECR-0423'), 'BWM-ECR-0423 is approved, not in review. The fast track decides ECRs in review only. Nothing was changed.');
  assert.match(explainRefusal("no company configuration is stored: the fast track is the company's rule, and there is none to apply", 'BWM-ECR-0423')!, /^No company configuration is stored/);
  assert.match(explainRefusal('cannot approve ECR 7: checks not finished on current inputs (s2_cost, s3_timeline)', 'BWM-ECR-0423')!, /checks on BWM-ECR-0423 have not finished on its current inputs \(s2_cost, s3_timeline\)/);
  assert.equal(explainRefusal('something else', 'BWM-ECR-0423'), undefined);
});

test('no company configuration: the signal is false and says so; an unreadable one too', () => {
  const none = { db: { nornConfig: { key: { find: () => undefined } } } };
  const f = fastTrackField(none as never, { plmEcrNumber: 'BWM-ECR-0423' } as never, { kind: 'job', role: 'level1-writeup', actor: 'a', onBehalfOf: null });
  assert.deepEqual(f, { candidate: false, why: 'No company configuration is stored in Fern, so there is no fast track to ask for.', tests: [] });
  const bad = { db: { nornConfig: { key: { find: () => ({ value: '{' }) } } } };
  const g = fastTrackField(bad as never, { plmEcrNumber: 'BWM-ECR-0423' } as never, { kind: 'job', role: 'level1-writeup', actor: 'a', onBehalfOf: null });
  assert.equal(g.candidate, false);
  assert.match(g.why, /cannot read the company configuration/);
  assert.equal(readCompanyConfig(canonicalJson(config)).state, 'ok');
});

test('the outcome is put in words: approved, held for a second check, recommended to whom, escalated', () => {
  const at = { microsSinceUnixEpoch: 1n };
  const detail = (extra: object) => JSON.stringify({ reasons: [{ rule: 'r', text: 'because' }], limits: [{ limit: 'maxCost', held: true, text: 'within' }], route: { bodyName: 'Change Control Board' }, ...extra });
  const row = { id: 5n, outcome: 'applied' } as never;
  const sent = { classes: { company: 'II', regulatory: 'minor' }, classSources: { company: 'statement', regulatory: 'agent' } } as never;
  const approved = outcomeOf(config, 'BWM-ECR-0423', row, { approval: { decisionJson: detail({ sample: { sampled: false, value: 0.5, rate: 0.2 } }) } as never }, sent);
  assert.equal(approved.decision, 'approved');
  assert.equal((approved as { secondCheck: string }).secondCheck, 'not drawn');
  assert.match(approved.summary, /BWM-ECR-0423 is approved on the fast track/);
  const said = approved as unknown as { classes: { company: { id: string; source: string }; regulatory: { source: string } }; classesNote: string };
  assert.deepEqual([said.classes.company.id, said.classes.company.source, said.classes.regulatory.source], ['II', 'statement', 'agent']);
  assert.match(said.classesNote, /Class II \(Fern's own, from the ECR's current statement\) and Minor \(yours/);
  const rec = (over: object) => ({ recommendation: { at, action: 'approve_fast_track_ecr', outcome: 'recommend', recipients: ['cm_analyst'], reasons: [{ rule: 'r', text: 'past a limit' }], decisionJson: detail({}), awaitingSecondCheck: false, ...over } as never });
  const held = outcomeOf(config, 'BWM-ECR-0423', row, rec({ outcome: 'sampled', awaitingSecondCheck: true }), undefined);
  assert.equal(held.decision, 'held_for_second_check');
  assert.match(held.summary, /NOT approved yet/);
  const rr = outcomeOf(config, 'BWM-ECR-0417', row, rec({}), undefined) as { decision: string; recipients: { label: string }[]; summary: string; route: string };
  assert.equal(rr.decision, 'recommended');
  assert.equal(rr.route, 'fast_track');
  assert.equal(rr.recipients[0]!.label, 'Configuration management analyst');
  const ordinary = outcomeOf(config, 'BWM-ECR-0417', row, rec({ action: 'approve_ecr_at_tier', recipients: ['ccb_chair'] }), undefined) as { route: string; summary: string };
  assert.equal(ordinary.route, 'ordinary');
  assert.match(ordinary.summary, /ordinary route \(Change Control Board\)/);
  assert.equal(outcomeOf(config, 'BWM-ECR-0417', row, rec({ outcome: 'escalate' }), undefined).decision, 'escalated');
  assert.equal(outcomeOf(config, 'BWM-ECR-0417', row, {}, undefined).decision, 'unconfirmed');
});
