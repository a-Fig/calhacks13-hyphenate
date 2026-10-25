// The Level 1 recommendation rule (recommendation.ts) on Bowman's real stored cost rows, offline, and the
// two places it is applied: the job prompt and the PLM fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statementToPlmFields, type StatementDoc } from './format.ts';
import { jobPrompt, screenDetail, SYSTEM_PROMPT, type Detail, type JobFacts } from './prompt.ts';
import { deriveRecommendation, failedChecksOf, ruleInputOf } from './recommendation.ts';
import { conflictRows, storedRows } from './routing-fixture.ts';

const derive = (rows: { key: string; detailJson: string }[], failed: string[] = []) => deriveRecommendation(ruleInputOf(rows, failed));

test('ECR-0417: three blank cost lines are stated gaps, so Approve with conditions naming exactly those three', () => {
  const d = derive(storedRows('ECR-0417'));
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.rule, 2);
  assert.deepEqual(d.blockers, []);
  assert.equal(d.conditions.length, 3);
  for (const label of ['Re-inspection and test after retrofit', 'Spares, maintenance manual task update, training', 'Delay cost of holding S/N 011-014 at the controller-install station']) {
    assert.ok(d.conditions.some(c => c.includes(`"${label}"`)), label);
  }
  assert.ok(d.reasoning.startsWith('Rule 2'));
});

test('ECR-0423 has no flags and no gaps: Approve', () => {
  const d = derive(storedRows('ECR-0423'));
  assert.equal(d.recommendation, 'Approve');
  assert.equal(d.rule, 3);
  assert.deepEqual([d.blockers, d.conditions], [[], []]);
});

test('a BOM conflict with the baseline cannot be assessed as filed: Send back', () => {
  const rows = conflictRows();
  const detail = JSON.parse(rows.find(r => r.key === 'detail')!.detailJson);
  assert.equal(detail.bomDelta.ok, false, 'the real check reports the conflict');
  const d = derive(rows);
  assert.equal(d.recommendation, 'Send back');
  assert.equal(d.rule, 1);
  assert.ok(d.blockers.some(b => b.startsWith('BOM conflict with the baseline')), d.blockers.join('|'));
});

test('a failed or blocked check, or no cost detail at all, is Send back; a stale or pending one is not looked at', () => {
  const rows = storedRows('ECR-0417');
  assert.equal(derive(rows, ['s1_bom_delta']).recommendation, 'Send back');
  assert.equal(derive([], []).recommendation, 'Send back');
  assert.deepEqual(failedChecksOf([{ stage: 's2_cost', status: 'done' }, { stage: 's1_bom_delta', status: 'failed' }, { stage: 's0_extract', status: 'blocked' }, { stage: 's4_supply', status: 'failed' }]), ['s0_extract', 's1_bom_delta']);
  assert.deepEqual(failedChecksOf([{ stage: 's2_cost', status: 'failed' }, { stage: 's2_cost', status: 'done' }]), [], 'only the latest run counts');
  assert.deepEqual(failedChecksOf([{ stage: 's2_cost', status: 'stale' }, { stage: 's2_cost', status: 'queued' }]), []);
});

test('an error flag or a forecast that did not converge is Send back; a warning is a gap; info is neither', () => {
  const d = (flags: { kind: string; severity: string; message: string }[]) => deriveRecommendation({ detail: { flags } });
  assert.equal(d([{ kind: 'x', severity: 'error', message: 'broken' }]).recommendation, 'Send back');
  assert.equal(d([{ kind: 'not_converged', severity: 'warn', message: 'raise maxDraws' }]).recommendation, 'Send back');
  assert.equal(d([{ kind: 'no_quote', severity: 'warn', message: 'no supplier quote covers it' }]).recommendation, 'Approve with conditions');
  assert.equal(d([{ kind: 'cross_check', severity: 'info', message: 'matches' }, { kind: 'effectivity_default', severity: 'info', message: 'default' }]).recommendation, 'Approve');
});

test('the rule is deterministic: the same rows always give the same answer, whatever the order of the flags', () => {
  const rows = storedRows('ECR-0417');
  const a = derive(rows);
  const detail = JSON.parse(rows.find(r => r.key === 'detail')!.detailJson);
  detail.flags.reverse();
  const b = derive(rows.map(r => (r.key === 'detail' ? { ...r, detailJson: JSON.stringify(detail) } : r)));
  assert.equal(a.recommendation, b.recommendation);
  assert.deepEqual([...a.conditions].sort(), [...b.conditions].sort());
});

// ---- the job prompt tells the agent what the rule gives -----------------------------------------

const factsFor = (ecr: string, rows = storedRows(ecr)): JobFacts => {
  const detail = JSON.parse(rows.find(r => r.key === 'detail')!.detailJson) as Detail;
  return {
    ecr,
    title: 'T',
    revision: 1,
    s2RunId: 7,
    baseline: 'ERPNext baseline 2c02958e, as of 2026-10-24',
    changeRequest: 'change request rev 1 from the PLM',
    numbers: [{ key: 'one_time_total', resultKey: 'one_time_total', label: 'One-time cost' }],
    screened: screenDetail(detail, 10_000),
    routing: {},
    recommendation: deriveRecommendation(ruleInputOf(rows, [])),
  };
};

test("the job prompt gives the rule's recommendation, its number and the three blank lines as conditions", () => {
  const p = jobPrompt(factsFor('ECR-0417'));
  assert.ok(p.includes('Norn\'s rule gives "Approve with conditions" (rule 2)'));
  for (const label of ['Re-inspection and test after retrofit', 'Spares, maintenance manual task update, training', 'Delay cost of holding']) assert.ok(p.includes(label), label);
  assert.ok(!p.includes('and your recommendation in a few words'), 'the headline does not carry the recommendation');
  assert.ok(jobPrompt(factsFor('ECR-0423')).includes('"Approve" (rule 3)'));
  assert.ok(jobPrompt(factsFor('ECR-0423', conflictRows())).includes('"Send back" (rule 1)'));
});

test('the system prompt states the three rules, never Reject, and the rule is a judgment claim', () => {
  for (const w of ['1. Send back', '2. Approve with conditions', '3. Approve', 'Never Reject', 'BOM conflict', 'needs_estimate', 'name the rule that fired', 'That claim is a judgment']) assert.ok(SYSTEM_PROMPT.includes(w), w);
});

test('the system prompt carries the fast-track rule (the tool itself is not wired yet)', () => {
  for (const w of ['fastTrack.candidate is true', 'request_fast_track_approval', 'exactly once', 'after you have posted the statement', 'never mark a test true without evidence', 'do not call it']) assert.ok(SYSTEM_PROMPT.toLowerCase().includes(w.toLowerCase()), w);
});

// ---- the publisher writes the rule's recommendation ----------------------------------------------

const statement = (rec: string | null): StatementDoc => ({
  id: 12,
  level: 1,
  prRevision: 3,
  createdAtIso: '2026-10-24T20:42:11.000Z',
  changeClass: 'Class I',
  route: "Pending Norn's routing",
  headline: 'ECR-0417 adds money.',
  numbers: [],
  drivers: [],
  assumptions: [],
  claims: rec ? [{ text: `Recommendation: ${rec}`, evidence: 'judgment' }] : [],
});
const prov = (rows: { key: string; detailJson: string }[]) => ({ baseline: 'b', changeRequest: 'c', formulas: {}, mock: false, ruleInput: ruleInputOf(rows, []) });
const ecr = { number: 'ECR-0417', title: 'T', revision: 1 };
const opts = { nornBaseUrl: 'http://127.0.0.1:5173' };

test('an agent that says Send back on ECR-0417 is overruled: the PLM gets Approve with conditions and a note says so', () => {
  const f = statementToPlmFields(statement('Send back. Three lines are blank.'), ecr, prov(storedRows('ECR-0417')), opts);
  assert.equal(f.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(f.recommendation, 'Approve with conditions');
  assert.equal(f.overridden?.agent, 'Send back');
  assert.equal(f.overridden?.derived.rule, 2);
  const html = f.fields.impact_statement as string;
  assert.ok(html.includes('Recommendation: Approve with conditions') && html.includes('the Level 1 agent wrote "Send back"'));
  assert.ok(html.includes('Re-inspection and test after retrofit'), 'the conditions are named');
});

test("an agent that agrees keeps its own words and no note; one that wrote none gets the rule's", () => {
  const agree = statementToPlmFields(statement('Approve with conditions. Rule 2: three lines are blank.'), ecr, prov(storedRows('ECR-0417')), opts);
  assert.equal(agree.overridden, undefined);
  assert.ok((agree.fields.impact_statement as string).includes('Rule 2: three lines are blank.'));
  assert.ok(!(agree.fields.impact_statement as string).includes("so the rule's stands"));
  const none = statementToPlmFields(statement(null), ecr, prov(storedRows('ECR-0417')), opts);
  assert.equal(none.fields.impact_recommendation, 'Approve with conditions');
  assert.equal(none.overridden?.agent, null);
});

test("Reject from the agent is overruled too; a statement with no run keeps the agent's recommendation", () => {
  assert.equal(statementToPlmFields(statement('Reject. No.'), ecr, prov(storedRows('ECR-0423')), opts).fields.impact_recommendation, 'Approve');
  const noRun = statementToPlmFields(statement('Reject. No.'), ecr, { baseline: 'b', changeRequest: 'c', formulas: {}, mock: false }, opts);
  assert.equal(noRun.fields.impact_recommendation, 'Reject');
});
