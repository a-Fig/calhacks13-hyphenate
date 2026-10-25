import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { renderReport } from '../src/report.ts';
import { recordedFetcher, type RecordedPage } from '../src/pages.ts';
import { loadRecording } from '../src/recording.ts';
import { finish, prepare, type Company } from '../src/run.ts';
import { applyAndReport } from '../src/apply.ts';
import { reviewProposals } from '../src/guardrails.ts';
import type { AgentOutput, Verdict } from '../src/types.ts';
import { guardTier } from '../src/run.ts';
import bowmanConfig from '../../../bowman/norn-config/bowman.config.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const REC = here('../recordings/ecr-0417.recording.json');
const company = bowman as unknown as Company;

/** A page that states a share outright, for the tests of what is applied: the recording's own pages state no share. */
const RECOVERY_PAGE: RecordedPage = {
  url: 'https://example.test/recovery-rate', retrievedAt: '2026-10-25', fetchedBy: 'a test', excerpt: false,
  text: 'Typical recovery rate on sold machined aluminum scrap: 1.0% of the purchase price. Updated 2026-10-01.',
};

async function replay(agentOutput?: (rec: Awaited<ReturnType<typeof loadRecording>>) => AgentOutput) {
  const rec = await loadRecording(REC);
  const prep = prepare(company, { config: bowmanConfig, ecrId: rec.ecr, seed: rec.seed, n: rec.n, ...(rec.context ? { context: rec.context } : {}) });
  const out = await finish(prep, { mode: 'RECORDED', provenance: [rec.label], agentOutput: agentOutput ? agentOutput(rec) : rec.agentOutput, fetcher: recordedFetcher([...rec.pages, RECOVERY_PAGE]), guardrails: { today: rec.recordedOn } });
  return { rec, prep, ...out };
}

/** The recording's first proposal with a share close to the default's 1.8 percent, quoting a page that states it (1.0%): nothing holds it. */
const modestFirst = (rec: Awaited<ReturnType<typeof loadRecording>>): AgentOutput => ({
  proposals: [{
    ...(rec.agentOutput.proposals[0] as object),
    sourceUrl: RECOVERY_PAGE.url,
    quote: 'recovery rate on sold machined aluminum scrap: 1.0% of the purchase price',
    sourceDate: '2026-10-01',
    dist: { kind: 'pert', min: 0.006, mode: 0.01, max: 0.02 },
  }],
  unresolved: [],
});

describe('replay of the ECR-0417 recording', () => {
  it('holds the real scrap-price proposal for a person (its quote does not state the share), holds the low-confidence one, and rejects the two planted ones for the right reasons', async () => {
    const { verdicts } = await replay();
    assert.deepEqual(verdicts.map((v) => v.status), ['needs_person', 'needs_person', 'rejected', 'rejected']);
    assert.deepEqual(verdicts[0]!.reasons.map((r) => r.code), ['quote_value']);
    assert.match(verdicts[0]!.reasons[0]!.message, /^quote does not state the proposed value/);
    assert.equal(verdicts[0]!.override, undefined);
    assert.equal(verdicts[0]!.verifiedAgainst?.url, 'https://rockawayrecycling.com/metal/al-machine-cuts/');
    assert.deepEqual(verdicts[1]!.reasons.map((r) => r.code), ['quote_value', 'low_confidence']);
    assert.deepEqual(verdicts[2]!.reasons.map((r) => r.code), ['quote_not_found']);
    assert.deepEqual(verdicts[3]!.reasons.map((r) => r.code), ['leak', 'leak', 'quote_value']);
  });

  it('applies nothing the guardrails hold: no assumption, no headline moves', async () => {
    const { report } = await replay();
    assert.deepEqual(report.changes, []);
    assert.equal(report.unchangedHeadlines, 6);
    assert.deepEqual(report.notApplied, []);
    assert.deepEqual(report.convergence, { before: true, after: true });
  });

  it('moves the headline numbers only through an accepted assumption, and attributes the move to it', async () => {
    const { report, verdicts } = await replay(modestFirst);
    assert.equal(verdicts[0]!.status, 'accepted');
    assert.deepEqual(report.changes.map((c) => c.key), ['oneTimeTotal', 'windowTotal', 'planTotal']);
    for (const c of report.changes) {
      assert.ok(c.after.p50 > c.before.p50, c.key);
      assert.deepEqual(c.movedBy.map((m) => m.targetKey), ['T1']);
    }
    assert.equal(report.unchangedHeadlines, 3);
    assert.deepEqual(report.notApplied, []);
  });

  it('shows, apart and labelled, what approving the held proposals would do, and applies none of it', async () => {
    const { report } = await replay();
    assert.deepEqual(report.ifApproved!.targets, ['T1', 'T2']);
    assert.deepEqual(report.ifApproved!.changes.map((c) => c.key), ['oneTimeTotal', 'windowTotal', 'planTotal']);
    assert.equal(report.ifApproved!.tier!.tierId, report.tier!.after.tierId);
    assert.deepEqual(report.changes, []);
    assert.match(renderReport(report), /WHAT IF a person approved the held proposals T1, T2 \[RECORDED\]\. Not applied/);
  });

  it('a clean accepted proposal leaves the approval tier alone', async () => {
    const { report } = await replay(modestFirst);
    assert.equal(report.tier!.before.tierId, report.tier!.after.tierId);
  });

  it('probe 1: a proposal that moves the approval tier is held even when every other check passes', async () => {
    const page: RecordedPage = { ...RECOVERY_PAGE, url: 'https://example.test/rate95', text: 'Scrap recovery on aerospace parts: 95% of the purchase price. Updated 2026-10-01.' };
    const mk = (rec: Awaited<ReturnType<typeof loadRecording>>): AgentOutput => ({
      proposals: [{ ...(rec.agentOutput.proposals[0] as object), sourceUrl: page.url, quote: 'Scrap recovery on aerospace parts: 95% of the purchase price', sourceDate: '2026-10-01', dist: { kind: 'pert', min: 0.9, mode: 0.95, max: 1 }, confidence: 'high' }],
      unresolved: [],
    });
    const rec = await loadRecording(REC);
    const prep = prepare(company, { config: bowmanConfig, ecrId: rec.ecr, seed: rec.seed, n: rec.n, ...(rec.context ? { context: rec.context } : {}) });
    const run = (p: typeof prep) => finish(p, { mode: 'RECORDED', provenance: ['probe'], agentOutput: mk(rec), fetcher: recordedFetcher([page]), guardrails: { today: rec.recordedOn, disagreementFactor: { share: 1e9, usd: 1e9, weeks: 1e9 } } });
    // Without the guard it is accepted, and the tier really changes: that is the probe.
    const { tierOf: _t, ...noTier } = prep;
    void _t;
    const unguarded = await run(noTier as typeof prep);
    assert.equal(unguarded.verdicts[0]!.status, 'accepted');
    const before = prep.tierOf!([]);
    const after = prep.tierOf!([unguarded.verdicts[0]!.override!]);
    assert.notEqual(after.tierId, before.tierId);
    assert.ok(before.size! > 150000 && after.size! < 150000);
    // With it, a person decides, nothing is applied, and the what-if says the tier would change.
    const guarded = await run(prep);
    assert.equal(guarded.verdicts[0]!.status, 'needs_person');
    assert.deepEqual(guarded.verdicts[0]!.reasons.map((r) => r.code), ['changes_tier']);
    assert.equal(guarded.verdicts[0]!.override, undefined);
    assert.deepEqual(guarded.report.changes, []);
    assert.equal(guarded.report.tier!.after.tierId, before.tierId);
    assert.equal(guarded.report.ifApproved!.tier!.tierId, after.tierId);
    assert.match(renderReport(guarded.report), /\(CHANGED\)/);
  });

  it('guardTier holds each tier-changing proposal alone, and a set that changes the tier together', () => {
    const mk = (id: string): Verdict => ({ index: 0, targetId: id, status: 'accepted', reasons: [], flags: [], override: { id, source: 'agent_estimated', rationale: 'r' } });
    const alone = [mk('a'), mk('b')];
    guardTier(alone, (a) => ({ tierId: a.some((x) => x.id === 'a') ? 'top' : 'low', body: 'B', size: 1 }));
    assert.deepEqual(alone.map((v) => v.status), ['needs_person', 'accepted']);
    const together = [mk('a'), mk('b')];
    guardTier(together, (a) => ({ tierId: a.length >= 2 ? 'top' : 'low', body: 'B', size: 1 }));
    assert.deepEqual(together.map((v) => v.status), ['needs_person', 'needs_person']);
    assert.ok(together.every((v) => v.reasons[0]!.code === 'changes_tier' && v.override === undefined && v.heldOverride));
    const fine = [mk('a')];
    guardTier(fine, () => ({ tierId: 'same', body: 'S', size: 1 }));
    assert.equal(fine[0]!.status, 'accepted');
  });

  it('is deterministic: two replays give identical reports', async () => {
    const a = await replay();
    const b = await replay();
    assert.equal(JSON.stringify(a.report), JSON.stringify(b.report));
    assert.equal(renderReport(a.report), renderReport(b.report));
  });

  it('labels everything RECORDED and never LIVE', async () => {
    const { report } = await replay();
    const text = renderReport(report);
    assert.equal(report.mode, 'RECORDED');
    assert.match(text, /\[RECORDED\]/);
    assert.match(text, /not a live run/);
    assert.ok(!/\bLIVE\b/.test(text));
  });

  it('does not say "PR author" or name a pull request anywhere a reader sees it', async () => {
    const rec = await loadRecording(REC);
    const shown = JSON.stringify(rec);
    assert.ok(!/PR author|pull request|\bPR\b/.test(shown));
    assert.match(shown, /research engineer/);
  });

  it('an unapplied accepted assumption is reported, not hidden', async () => {
    const { prep, rec } = await replay();
    const bad = structuredClone(prep.targets);
    bad[0]!.inputId = 'recovery:NO-SUCH-ITEM';
    const verdicts = await reviewProposals(modestFirst(rec).proposals, bad, recordedFetcher([...rec.pages, RECOVERY_PAGE]), { today: rec.recordedOn, identifiers: prep.identifiers });
    assert.equal(verdicts[0]!.status, 'accepted');
    const r = applyAndReport({ mode: 'RECORDED', ecr: 'ECR-0417', seed: rec.seed, provenance: [], targets: bad, verdicts, run: prep.run });
    assert.equal(r.notApplied.length, 1);
    assert.match(r.notApplied[0]!.message, /no input of this check has that id/);
    assert.equal(r.changes.length, 0);
  });

  it('never applies a flagged verdict even if one reaches it marked accepted', async () => {
    const { prep, rec, verdicts } = await replay(modestFirst);
    const flagged = structuredClone(verdicts);
    flagged[0]!.flags = [{ code: 'wide_range', message: 'p90 is 9 times p10' }];
    const r = applyAndReport({ mode: 'RECORDED', ecr: 'ECR-0417', seed: rec.seed, provenance: [], targets: prep.targets, verdicts: flagged, run: prep.run });
    assert.deepEqual(r.changes, []);
  });
});

describe('a fabricated cost for a blank row (review round 2)', () => {
  it('is held with no override, and moves nothing: $400,000 for T2, high confidence, quoting a scrap price', async () => {
    const { report, verdicts, prep } = await replay((rec) => ({
      proposals: [{ ...(rec.agentOutput.proposals[0] as object), targetId: 'T2', unit: 'usd', dist: undefined, value: 400_000, confidence: 'high' }],
      unresolved: [],
    }));
    assert.equal(prep.targets[1]!.key, 'T2');
    assert.equal(verdicts[0]!.status, 'needs_person');
    assert.equal(verdicts[0]!.override, undefined);
    assert.deepEqual(verdicts[0]!.reasons.map((r) => r.code), ['quote_value']);
    assert.match(verdicts[0]!.reasons[0]!.message, /quote does not state the proposed value/);
    assert.deepEqual(report.changes, []);
    assert.equal(report.unchangedHeadlines, 6);
  });
});

describe('unresolved answers (review finding 5)', () => {
  const REASON = 'Could not find credible public evidence';
  const only = (): AgentOutput => ({ proposals: [], unresolved: [{ targetId: 'T1', reason: REASON }] });

  it('keeps the agent\'s reason in the report and the text, and lists the targets that got no answer at all', async () => {
    const { report, prep } = await replay(only);
    assert.deepEqual(report.unresolved, [{ targetKey: 'T1', label: prep.targets[0]!.label, reason: REASON }]);
    assert.deepEqual(report.unanswered.map((u) => u.key), prep.targets.slice(1).map((t) => t.key));
    const text = renderReport(report);
    assert.match(text, /Unresolved and unanswered \[RECORDED\]/);
    assert.ok(text.includes(`T1  UNRESOLVED  (${prep.targets[0]!.label}): ${REASON}`));
    for (const t of prep.targets.slice(1)) assert.ok(text.includes(`${t.key}  NO ANSWER`), t.key);
    assert.deepEqual(report.changes, []);
  });

  it('counts a rejected or held proposal as an answer, not as silence', async () => {
    const { report } = await replay();
    assert.deepEqual(report.unanswered, []);
    assert.deepEqual(report.unresolved, []);
    assert.ok(!renderReport(report).includes('Unresolved and unanswered'));
  });

  it('keeps an entry for a key that is not a target, and prints agent text safely', async () => {
    const { report } = await replay(() => ({ proposals: [], unresolved: [{ targetId: 'T9', reason: 'no\u001b[31m such\u0007 thing\n'.repeat(200) }] }));
    assert.equal(report.unresolved[0]!.label, null);
    assert.ok(report.unresolved[0]!.reason.length <= 500);
    assert.ok(!/[\u0000-\u001f]/.test(report.unresolved[0]!.reason));
    assert.match(renderReport(report), /T9  UNRESOLVED  \(not one of the targets\)/);
  });

  it('is in the JSON report', async () => {
    const { report } = await replay(only);
    const json = JSON.parse(JSON.stringify(report)) as typeof report;
    assert.equal(json.unresolved[0]!.reason, REASON);
    assert.equal(json.unanswered.length, 3);
  });
});

describe('the command line', () => {
  it('runs offline from the command line, exits 0, and says the company is fictional', () => {
    const out = execFileSync('node', [here('../src/cli.ts'), '--replay', REC], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    assert.match(out, /NEEDS_PERSON/);
    assert.match(out, /REJECTED/);
    assert.match(out, /held for a person/);
    assert.match(out, /No headline number changed/);
    assert.match(out, /Bowman Aviation and everything about it .* is FICTIONAL/);
    assert.match(out, /proposal #3 is planted to test the guardrails: a fabricated quote/);
    assert.match(out, /proposal #4 is planted/);
    assert.ok(!/\bLIVE\b/.test(out));
    assert.ok(!/PR author/.test(out));
  });

  it('--live without the token stops at once, says which variable is missing, and says the company is fictional', () => {
    let err = '';
    try {
      execFileSync('node', [here('../src/cli.ts'), '--live', 'ECR-0417'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' });
    } catch (e) {
      err = String((e as { stderr?: string }).stderr);
    }
    assert.match(err, /BRIGHT_DATA_API_TOKEN is not set/);
    assert.match(err, /FICTIONAL/);
  });
});
