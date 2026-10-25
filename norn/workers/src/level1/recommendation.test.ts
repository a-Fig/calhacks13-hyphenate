// The Level 1 recommendation rule (recommendation.ts) on Bowman's real stored cost rows, offline, and the
// two places it is applied: the job prompt and the PLM fields.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statementToPlmFields, type StatementDoc } from './format.ts';
import { LEVEL1_TOOLS } from './dispatcher.ts';
import { jobPrompt, screenDetail, SYSTEM_PROMPT, systemPromptFor, type Detail, type JobFacts } from './prompt.ts';
import { overrideComment, recordOverride } from './publisher.ts';
import { deriveRecommendation, failedChecksOf, ruleInputOf, type RunRow } from './recommendation.ts';
import { blankAmountRows, conflictRows, noDispositionRows, storedRows } from './routing-fixture.ts';
import { failedChecksForRun } from './source.ts';

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

test('a failed or blocked check, or no cost detail at all, is Send back', () => {
  const rows = storedRows('ECR-0417');
  assert.equal(derive(rows, ['s1_bom_delta']).recommendation, 'Send back');
  assert.equal(derive([], []).recommendation, 'Send back');
});

// ---- the checks' state is read as of the statement's own run, never the ECR's latest runs -------------

const run = (id: number, stage: string, status: string, inputHash = `h${id}`, finishedMs: number | null = id * 1000 + 100): RunRow => ({ id: BigInt(id), stage, status, inputHash, createdUs: BigInt(id) * 1_000_000n, startedUs: BigInt(id) * 1_000_000n, finishedUs: finishedMs === null ? null : BigInt(finishedMs) * 1000n });

test("a failure after the statement's run does not change it: a later extraction failure leaves Approve as it was", () => {
  const s2 = run(3, 's2_cost', 'done');
  const before = [run(1, 's0_extract', 'done'), run(2, 's1_bom_delta', 'done', 'S1'), s2];
  assert.deepEqual(failedChecksOf(before, s2, 'S1'), []);
  // the text is edited and the extraction re-run fails: a newer run, created after the statement's own
  const later = [...before, run(7, 's0_extract', 'failed')];
  assert.deepEqual(failedChecksOf(later, s2, 'S1'), [], "a run created after the statement's own does not count");
  // an s0 run created earlier that only failed after the s2 run finished does not count either
  assert.deepEqual(failedChecksOf([run(1, 's0_extract', 'failed', 'h1', 9000), run(2, 's1_bom_delta', 'done', 'S1'), s2], s2, 'S1'), []);
  const d = (failed: string[]) => deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), failed));
  assert.equal(d(failedChecksOf(later, s2, 'S1')).recommendation, 'Approve');
});

test("a check that had failed when the statement was written, or its own upstream run, still counts", () => {
  const s2 = run(3, 's2_cost', 'done');
  assert.deepEqual(failedChecksOf([run(1, 's0_extract', 'failed', 'h1', 500), run(2, 's1_bom_delta', 'done', 'S1'), s2], s2, 'S1'), ['s0_extract']);
  assert.deepEqual(failedChecksOf([run(1, 's1_bom_delta', 'done', 'OLD'), run(2, 's1_bom_delta', 'failed', 'S1'), s2], s2, 'S1'), ['s1_bom_delta'], 'the run the s2 run names, not the latest');
  assert.deepEqual(failedChecksOf([run(1, 's1_bom_delta', 'failed', 'NEWER'), run(2, 's1_bom_delta', 'done', 'S1'), s2], s2, 'S1'), [], "another revision's s1 is not this snapshot");
  assert.deepEqual(failedChecksOf([], run(3, 's2_cost', 'failed'), undefined), ['s2_cost']);
});

test('inputs that change and revert: a later failed s1 run with the same hash is not the one the statement was computed on', () => {
  const s2 = run(3, 's2_cost', 'done');
  const first = [run(1, 's0_extract', 'done'), run(2, 's1_bom_delta', 'done', 'S1'), s2];
  // the request is edited (hash S2), then edited back (hash S1 again); the new s1 run for S1 fails
  const reverted = [...first, run(5, 's1_bom_delta', 'done', 'S2'), run(8, 's1_bom_delta', 'failed', 'S1')];
  assert.deepEqual(failedChecksOf(reverted, s2, 'S1'), [], "the later run was created after the s2 run started");
  // one that had already failed, but only finished after the s2 run did, is not it either
  assert.deepEqual(failedChecksOf([run(1, 's1_bom_delta', 'done', 'S1'), run(2, 's1_bom_delta', 'failed', 'S1', 9999), s2], s2, 'S1'), [], 'finished after the s2 run finished');
  const d = (failed: string[]) => deriveRecommendation(ruleInputOf(storedRows('ECR-0423'), failed));
  assert.equal(d(failedChecksOf(reverted, s2, 'S1')).recommendation, 'Approve');
  // while the newest such run, if it had failed by then, still counts
  assert.deepEqual(failedChecksOf([run(1, 's1_bom_delta', 'done', 'S1'), { ...run(2, 's1_bom_delta', 'failed', 'S1'), finishedUs: 2_100_000n }, s2], s2, 'S1'), ['s1_bom_delta']);
});

test("failedChecksForRun reads the cache the same way: a later s0 failure on the ECR is not this statement's", () => {
  const at = (s: number) => ({ microsSinceUnixEpoch: BigInt(s) * 1_000_000n });
  const created = (s: number) => ({ createdAt: at(s), startedAt: at(s) });
  const rows = [
    { id: 1n, stage: 's0_extract', status: 'done', inputHash: 'a', inputsJson: '{}', finishedAt: at(1), ...created(1) },
    { id: 2n, stage: 's1_bom_delta', status: 'done', inputHash: 'S1', inputsJson: '{}', finishedAt: at(2), ...created(2) },
    { id: 3n, stage: 's2_cost', status: 'done', inputHash: 'c', inputsJson: JSON.stringify({ upstream: { s1_bom_delta: 'S1' } }), finishedAt: at(3), ...created(3) },
    { id: 9n, stage: 's0_extract', status: 'failed', inputHash: 'z', inputsJson: '{}', finishedAt: at(9), ...created(9) },
  ];
  const db = { checkRun: { prId: { filter: () => rows }, id: { find: (id: bigint) => rows.find(r => r.id === id) } } } as any;
  assert.deepEqual(failedChecksForRun(db, 5n, 3n), []);
  rows[0]!.status = 'failed';
  assert.deepEqual(failedChecksForRun(db, 5n, 3n), ['s0_extract'], 'failed before the statement\'s run finished');
});

test('a cost line on a stated basis with no amount is a gap, whatever the check flagged', () => {
  const rows = blankAmountRows();
  const detail = JSON.parse(rows.find(r => r.key === 'detail')!.detailJson);
  assert.ok(!detail.flags.some((f: { kind: string }) => f.kind === 'needs_estimate'), 'the check itself says nothing about it');
  assert.ok(!detail.inputs.some((i: { needsEstimate?: boolean }) => i.needsEstimate));
  const d = derive(rows);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.equal(d.conditions.length, 1);
  assert.ok(d.conditions[0]!.includes('Expedite fee for the first lot') && d.conditions[0]!.includes('states no amount'), d.conditions[0]);
  assert.equal(derive(storedRows('ECR-0423')).recommendation, 'Approve', 'the unchanged ECR-0423 has no such line');
  assert.equal(derive(storedRows('ECR-0417')).conditions.length, 3, 'and a blank line is not counted twice');
});

test('an undecided stock disposition is a gap even though the check only says so as information', () => {
  const rows = noDispositionRows();
  const detail = JSON.parse(rows.find(r => r.key === 'detail')!.detailJson);
  assert.equal(detail.flags.find((x: { kind: string }) => x.kind === 'no_disposition')?.severity, 'info');
  const d = derive(rows);
  assert.equal(d.recommendation, 'Approve with conditions');
  assert.ok(d.conditions.some(c => c.includes('no disposition proposed')), d.conditions.join('|'));
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

test("the fast-track instruction is built only when the tool is in the job's allowed tools", () => {
  assert.ok(!LEVEL1_TOOLS.some(t => t.endsWith('request_fast_track_approval')), 'not allowed yet');
  for (const prompt of [SYSTEM_PROMPT, systemPromptFor(LEVEL1_TOOLS)]) {
    assert.ok(!prompt.includes('request_fast_track_approval') && !prompt.includes('Fast track.'), 'so the section is absent');
    assert.ok(prompt.includes('Do not use any other tool. Do not propose'));
  }
  const on = systemPromptFor([...LEVEL1_TOOLS, 'mcp__norn__request_fast_track_approval']);
  for (const w of ['fastTrack.candidate is true', 'request_fast_track_approval', 'exactly once', 'after you have posted the statement', 'never mark a test true without evidence', 'regulatoryClass', 'what you rest it on', 'do not call it']) assert.ok(on.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(on.includes('except request_fast_track_approval'));
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

// ---- the override is recorded in Norn ----------------------------------------------------------------

test('an override leaves one comment on the ECR, and a second sweep or a restart adds none', async () => {
  const f = statementToPlmFields(statement('Send back. Three lines are blank.'), ecr, prov(storedRows('ECR-0417')), opts);
  const comments: string[] = [];
  const deps = { existing: () => [...comments], add: async (b: string) => void comments.push(b) };
  assert.equal(await recordOverride(deps, 12, f), true);
  assert.equal(comments.length, 1);
  assert.ok(comments[0]!.startsWith('Norn\'s rule set the recommendation to Approve with conditions; the Level 1 agent wrote "Send back" (rule 2, statement 12).'), comments[0]);
  assert.equal(await recordOverride(deps, 12, f), false, 'the same statement and outcome');
  assert.equal(comments.length, 1);
  assert.equal(await recordOverride(deps, 13, f), true, 'a new statement is a new record');
  const agrees = statementToPlmFields(statement('Approve with conditions. Rule 2.'), ecr, prov(storedRows('ECR-0417')), opts);
  assert.equal(await recordOverride(deps, 14, agrees), false, 'nothing to record when the agent agreed');
  assert.equal(comments.length, 2);
  assert.ok(overrideComment(1, { agent: null, derived: deriveRecommendation({ detail: {} }) }).includes('wrote none'));
});
