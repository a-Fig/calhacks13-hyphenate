import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DbConnection } from '@norn/bindings';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck, costCheckRows, quantileOf } from '../../checks/src/index.ts';
import { toOverride } from '../../workers/src/impact.ts';
import { collectIdentifiers } from '../src/leak.ts';
import { pickTargets } from '../src/targets.ts';
import { reviewProposals } from '../src/guardrails.ts';
import { recordedFetcher } from '../src/pages.ts';
import { loadRecording } from '../src/recording.ts';
import { contextFromEcr, prepare, type Company } from '../src/run.ts';
import { affectsFor, callResult, distToJson, toRecordAssumption, type AssumptionRow, type LogRow, type RecordAssumptionArgs } from '../src/live/assumptions.ts';
import { buildOutcome, commentArgs, commentFor, type OutcomeInput } from '../src/live/outcome.ts';
import { renderReplay, replayPlan } from '../src/live/replay.ts';
import { targetsFromDetail } from '../src/live/targets.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const company = bowman as unknown as Company;
const AGENT = 'ab'.repeat(32);
const PR = 7n;

async function recorded() {
  const rec = await loadRecording(here('../recordings/ecr-0417.recording.json'));
  const prep = prepare(company, { ecrId: rec.ecr, seed: rec.seed, n: rec.n, ...(rec.context ? { context: rec.context } : {}) });
  const verdicts = await reviewProposals(rec.agentOutput.proposals, prep.targets, recordedFetcher(rec.pages), { today: rec.recordedOn, identifiers: prep.identifiers });
  return { rec, prep, verdicts };
}
const input = async (over: Partial<OutcomeInput> = {}): Promise<OutcomeInput> => {
  const { rec, prep, verdicts } = await recorded();
  return { mode: 'LIVE', key: 'ECR-0417@d1', ecr: 'ECR-0417', prId: PR, revision: 2, digest: 'd1', s2RunId: 11n, jobId: 'research-ECR-0417-r2-d1-a1', now: '2026-10-25T05:00:00.000Z', targets: prep.targets, agentOutput: rec.agentOutput, verdicts, existing: [], agentHex: AGENT, ...over };
};

describe('targets from a stored cost run', () => {
  it("are the ones the check's own result gives, after the detail row has been through JSON", () => {
    const ecr = company.ecrs.find((e) => e.id === 'ECR-0417')!;
    const cost = costCheck(company, ecr, { seed: 'norn-seed-1' });
    const detail = costCheckRows(cost).find((r) => r.key === 'detail')!.detailJson;
    const ids = collectIdentifiers(company);
    const stored = targetsFromDetail(detail, ecr, ids, 3);
    const direct = pickTargets(cost, { n: 3, context: contextFromEcr(ecr), identifiers: ids });
    assert.ok(stored.length > 0);
    assert.deepEqual(stored, direct);
  });
  it('fail loudly on a detail row without inputs, instead of returning nothing', () => {
    assert.throws(() => targetsFromDetail('{}', company.ecrs[0]!, [], 3), /no inputs/);
  });
});

describe('accepted proposals as record_assumption calls', () => {
  it('has exactly the reducer arguments, typed against the generated bindings', async () => {
    const { outcome, calls } = buildOutcome(await input());
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    // Compile-time: this is the reducer's own parameter type, plus the metadata the client fills in.
    const typed: Parameters<DbConnection['reducers']['recordAssumption']>[0] = { ...call.args, meta: { requestId: 'r', spawnedBy: 'Norn' } };
    assert.ok(typed);
    assert.deepEqual(Object.keys(call.args).sort(), ['affects', 'distJson', 'expectedCrRev', 'expectedRev', 'key', 'prId', 'rationale', 'source']);
    assert.equal(call.args.prId, PR);
    assert.equal(call.args.key, 'recovery:BW-5120-210');
    assert.equal(call.args.source, 'agent_estimated');
    assert.deepEqual(call.args.affects, ['s2_cost']);
    assert.equal(call.args.expectedRev, 0);
    assert.equal(call.args.distJson, '{"kind":"pert","min":0.002,"mode":0.0036,"max":0.006}');
    assert.equal(typeof call.args.expectedRev, 'number');
    assert.equal(typeof call.args.prId, 'bigint');
    assert.equal(call.targetKey, 'T1');
    assert.equal(outcome.recorded.length, 0, 'nothing is recorded until the worker has seen the assumption');
  });

  it('carries the URL, the quote, the retrieval date, the confidence and the flag in the rationale', async () => {
    const { calls } = buildOutcome(await input());
    const r = calls[0]!.args.rationale;
    assert.match(r, /Source: https:\/\/rockawayrecycling\.com\/metal\/al-machine-cuts\//);
    assert.match(r, /Quote: "[^"]*CURRENT PRICE \$0\.75\/lb[^"]*"/);
    assert.match(r, /Retrieved 2026-10-25/);
    assert.match(r, /confidence medium/);
    assert.match(r, /Flagged for a person to read: p50 .* more than 3 times apart/);
  });

  it('is read by the worker the way the checks library takes it, to the same distribution', async () => {
    const { verdicts } = await recorded();
    const { calls } = buildOutcome(await input());
    const o = toOverride({ key: calls[0]!.args.key, distJson: calls[0]!.args.distJson, source: calls[0]!.args.source, rationale: calls[0]!.args.rationale });
    assert.equal(typeof o, 'object', typeof o === 'string' ? o : '');
    if (typeof o === 'string') return;
    assert.equal(o.id, 'recovery:BW-5120-210');
    assert.equal(o.source, 'agent_estimated');
    for (const q of [0.1, 0.5, 0.9]) assert.ok(Math.abs(quantileOf(o.dist!, q) - quantileOf(verdicts[0]!.dist!, q)) < 1e-12, `q${q}`);
  });

  it('writes every distribution kind in a shape the worker reads', () => {
    for (const d of [
      { kind: 'lognormal' as const, median: 4500, sigmaLow: 0.857, sigmaHigh: 0.532 },
      { kind: 'pert' as const, min: 1, mode: 2, max: 3 },
      { kind: 'triangular' as const, min: 1, mode: 2, max: 3 },
      { kind: 'point' as const, value: 5 },
    ]) {
      const o = toOverride({ key: 'k', distJson: distToJson(d), source: 'agent_estimated', rationale: 'r' });
      assert.equal(typeof o, 'object', `${d.kind}: ${String(o)}`);
    }
  });

  it('replaces its own earlier estimate at the revision it saw, and leaves another actor assumption alone', async () => {
    const row = (over: Partial<AssumptionRow>): AssumptionRow => ({ id: 3n, prId: PR, key: 'recovery:BW-5120-210', rev: 2, source: 'agent_estimated', current: true, distJson: '{}', createdBy: AGENT, rationale: '', affects: ['s2_cost'], ...over });
    const own = buildOutcome(await input({ existing: [row({})] }));
    assert.equal(own.calls[0]!.args.expectedRev, 2);
    const person = buildOutcome(await input({ existing: [row({ createdBy: 'cd'.repeat(32) })] }));
    assert.equal(person.calls.length, 0);
    assert.match(person.outcome.notRecorded[0]!.why, /already has a current assumption .* another actor wrote/);
    const given = buildOutcome(await input({ existing: [row({ source: 'given' })] }));
    assert.equal(given.calls.length, 0);
    // an old, superseded row does not count
    assert.equal(buildOutcome(await input({ existing: [row({ current: false })] })).calls.length, 1);
  });

  it('never makes a call for a held or rejected proposal', async () => {
    const { outcome, calls } = buildOutcome(await input());
    assert.deepEqual(outcome.proposals.map((p) => p.status), ['accepted', 'needs_person', 'rejected', 'rejected']);
    assert.deepEqual(calls.map((c) => c.targetKey), ['T1']);
  });

  it('sends a lead time to the timeline stage and everything else to the cost stage', () => {
    assert.deepEqual(affectsFor('sourcing:X-1:lead'), ['s3_timeline']);
    assert.deepEqual(affectsFor('cost:E:other:x'), ['s2_cost']);
    assert.deepEqual(affectsFor('cancel:X-1'), ['s2_cost']);
  });

  it('carries the change-request revision it was researched against, and a replay (no database) carries none', async () => {
    const { calls } = buildOutcome(await input({ revision: 2 }));
    assert.equal(calls[0]!.args.expectedCrRev, 2);
    const replay = buildOutcome(await input({ mode: 'RECORDED', revision: 0 }));
    assert.equal('expectedCrRev' in replay.calls[0]!.args, false);
  });
});

describe("what became of one record_assumption call (its own row in the action log)", () => {
  const REQ = 'research-ECR-0417-r2-d1-a1-w1';
  const callArgs = async (): Promise<RecordAssumptionArgs> => buildOutcome(await input({ revision: 2 })).calls[0]!.args;
  const rowFor = (a: RecordAssumptionArgs, over: Partial<AssumptionRow> = {}): AssumptionRow => ({ id: 9n, prId: a.prId, key: a.key, rev: a.expectedRev + 1, source: a.source, current: true, distJson: a.distJson, createdBy: AGENT, rationale: a.rationale, affects: a.affects, ...over });
  const logRow = (over: Partial<LogRow> = {}): LogRow => ({ id: 40n, prId: PR, requestId: REQ, reducer: 'record_assumption', outcome: 'applied', entity: 'assumption:9', summary: 'applied', ...over });

  it('is applied when the call was logged as applied and its assumption is the one asked for, at the revision the call makes', async () => {
    const a = await callArgs();
    const r = callResult(a, REQ, [logRow()], [rowFor(a)], AGENT);
    assert.equal(r.state, 'applied');
    assert.equal(r.state === 'applied' && r.row.id, 9n);
  });

  it("is refused when the call was refused, even though an older row of this agent matches the value, source and author (Sol's repro)", async () => {
    const a = await callArgs();
    // An earlier estimate by this agent on the same key with the same value is still in the table...
    const older = rowFor(a, { id: 5n, rev: 1, rationale: 'an earlier run', affects: ['s2_cost'] });
    // ...and this call, at expectedRev 1, was refused (the ECR was edited, or moved to another change request).
    const refused = { ...a, expectedRev: 1 };
    const rejected = logRow({ outcome: 'rejected', entity: 'rejected', summary: 'record_assumption rejected: the ECR is on change-request revision 3, not 2' });
    const r = callResult(refused, REQ, [rejected], [older], AGENT);
    assert.equal(r.state, 'refused');
    assert.match(r.state === 'refused' ? r.why : '', /change-request revision 3, not 2/);
    // The gate's own refusal reads the same way.
    assert.equal(callResult(refused, REQ, [logRow({ outcome: 'denied', summary: 'record_assumption refused: no' })], [older], AGENT).state, 'refused');
    // And it does not wait on the table: an older matching row alone is no answer at all.
    assert.equal(callResult(refused, REQ, [], [older], AGENT).state, 'pending');
    assert.equal(callResult(refused, REQ, [], [older], AGENT, true).state, 'refused', 'the older row differs in revision, so even the final look does not take it for this call');
  });

  it('is not applied when the logged row is another value, key, author or revision than the call asked for', async () => {
    const a = await callArgs();
    for (const over of [{ distJson: '{"kind":"fixed","value":1}' }, { key: 'other' }, { createdBy: 'cd'.repeat(32) }, { rev: 5 }, { source: 'given' }, { prId: 8n }]) {
      assert.equal(callResult(a, REQ, [logRow()], [rowFor(a, over)], AGENT).state, 'refused', Object.keys(over).join());
    }
  });

  it("ignores another call's row, and waits when the log row has not reached the table cache yet", async () => {
    const a = await callArgs();
    assert.equal(callResult(a, REQ, [logRow({ requestId: 'someone-else' })], [rowFor(a)], AGENT).state, 'pending');
    assert.equal(callResult(a, REQ, [logRow({ reducer: 'add_comment' })], [rowFor(a)], AGENT).state, 'pending');
    assert.equal(callResult(a, REQ, [logRow()], [], AGENT).state, 'pending');
  });

  it('recognises the one call that leaves no log row, a call that changed nothing, only on the final look and only for an identical row at the expected revision', async () => {
    const a = { ...(await callArgs()), expectedRev: 3 };
    const same = rowFor(a, { rev: 3 });
    assert.equal(callResult(a, REQ, [], [same], AGENT).state, 'pending');
    const r = callResult(a, REQ, [], [same], AGENT, true);
    assert.equal(r.state, 'unchanged');
    assert.equal(callResult(a, REQ, [], [{ ...same, rationale: 'different' }], AGENT, true).state, 'refused');
    assert.equal(callResult(a, REQ, [], [{ ...same, affects: ['s3_timeline'] }], AGENT, true).state, 'refused');
    assert.equal(callResult(a, REQ, [], [{ ...same, rev: 4 }], AGENT, true).state, 'refused');
    assert.equal(callResult(a, REQ, [], [{ ...same, current: false }], AGENT, true).state, 'refused');
    assert.equal(callResult({ ...a, expectedRev: 0 }, REQ, [], [{ ...same, rev: 0 }], AGENT, true).state, 'refused', 'a create always writes');
  });
});

describe('what a person can see of what was not used', () => {
  it('puts the held proposal in the comment with its source, quote, why, and the call that would use it', async () => {
    const { outcome, calls } = buildOutcome(await input());
    outcome.recorded = calls.map((c) => ({ targetKey: c.targetKey, key: c.args.key, rev: 1, assumptionId: 9 }));
    const body = commentFor(outcome)!;
    assert.match(body, /Held for a person \(1\)/);
    assert.match(body, /Re-inspection and test after retrofit/);
    assert.match(body, /https:\/\/avbrief\.com\//);
    assert.match(body, /confidence low/);
    assert.match(body, /Why held: the agent rates its own confidence as low/);
    assert.match(body, /record an assumption on cost:ECR-0417:retrofit:re-inspection-and-test-after-retrofit with \{"kind":"lognormal"/);
    assert.match(body, /Rejected \(2\)/);
    assert.match(body, /the quote does not appear in the page text/);
    assert.match(body, /Used, and worth a read \(1\)/);
    assert.ok(body.length <= 4000);
  });

  it('is attached to the cost run it came from, on the ECR', async () => {
    const { outcome } = buildOutcome(await input());
    const c = commentArgs(outcome, PR)!;
    assert.deepEqual(Object.keys(c).sort(), ['anchor', 'body', 'prId']);
    assert.equal(c.anchor, 'check_run:11');
    const typed: Parameters<DbConnection['reducers']['addComment']>[0] = { ...c, meta: { requestId: 'r', spawnedBy: 'Norn' } };
    assert.ok(typed);
  });

  it('says nothing when every proposal was used and none was flagged', async () => {
    const base = await input();
    const clean = buildOutcome({ ...base, agentOutput: { proposals: [], unresolved: [] }, verdicts: [] });
    assert.equal(commentFor(clean.outcome), null);
  });

  it('says when the ECR moved on and nothing was recorded, and when an accepted proposal could not be recorded', async () => {
    const { outcome } = buildOutcome(await input());
    outcome.superseded = 'the ECR has a newer change-request revision, so these numbers were not recorded';
    outcome.failed.push({ targetKey: 'T1', key: 'recovery:BW-5120-210', why: 'record_assumption refused: the ECR is approved' });
    const body = commentFor(outcome)!;
    assert.match(body, /Not used: the ECR has a newer change-request revision/);
    assert.match(body, /Accepted but not recorded:/);
    assert.match(body, /the ECR is approved/);
  });

  it('keeps the whole record of every proposal in the stored result, with the unit and the distribution a person could record', async () => {
    const { outcome } = buildOutcome(await input());
    const held = outcome.proposals[1]!;
    assert.equal(held.status, 'needs_person');
    assert.equal(held.unit, 'usd');
    assert.ok(held.sourceUrl && held.quote && held.retrievedAt && held.confidence === 'low');
    assert.ok(held.proposed && held.distJson);
    assert.equal(JSON.parse(JSON.stringify(outcome)).kind, 'norn-research-result');
  });
});

describe('--replay', () => {
  it('plans the same calls as a live run would, labels every line RECORDED, and reads no database', async () => {
    const { rec } = await recorded();
    const plan = await replayPlan(rec, company);
    assert.equal(plan.outcome.mode, 'RECORDED');
    assert.equal(plan.calls.length, 1);
    const text = renderReplay(rec, plan);
    for (const line of text.split('\n')) assert.ok(line.startsWith('RECORDED | '), line);
    assert.match(text, /"key": "recovery:BW-5120-210"/);
    assert.match(text, /Held for a person \(1\)/);
  });

  it('works end to end from the command line', () => {
    const tsx = here('../../node_modules/tsx/dist/cli.mjs');
    const out = execFileSync(process.execPath, [tsx, 'src/worker.ts', '--replay', 'recordings/ecr-0417.recording.json'], { cwd: here('..'), encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    assert.ok(out.trim().split('\n').every((l) => l.startsWith('RECORDED | ')));
    assert.match(out, /record_assumption calls \(1\)/);
  });
});
