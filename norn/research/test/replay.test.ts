import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { renderReport } from '../src/report.ts';
import { recordedFetcher } from '../src/pages.ts';
import { loadRecording } from '../src/recording.ts';
import { finish, prepare, type Company } from '../src/run.ts';
import { reviewProposals } from '../src/guardrails.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const REC = here('../recordings/ecr-0417.recording.json');
const company = bowman as unknown as Company;

async function replay() {
  const rec = await loadRecording(REC);
  const prep = prepare(company, { ecrId: rec.ecr, seed: rec.seed, n: rec.n, ...(rec.context ? { context: rec.context } : {}) });
  const out = await finish(prep, { mode: 'RECORDED', provenance: [rec.label], agentOutput: rec.agentOutput, fetcher: recordedFetcher(rec.pages), guardrails: { today: rec.recordedOn } });
  return { rec, prep, ...out };
}

describe('replay of the ECR-0417 recording', () => {
  it('accepts the real scrap-price proposal, holds the low-confidence one, and rejects the two planted ones for the right reasons', async () => {
    const { verdicts } = await replay();
    assert.deepEqual(verdicts.map((v) => v.status), ['accepted', 'needs_person', 'rejected', 'rejected']);
    assert.deepEqual(verdicts[0]!.flags.map((f) => f.code), ['disagrees_with_current']);
    assert.deepEqual(verdicts[1]!.reasons.map((r) => r.code), ['low_confidence']);
    assert.deepEqual(verdicts[2]!.reasons.map((r) => r.code), ['quote_not_found']);
    assert.deepEqual(verdicts[3]!.reasons.map((r) => r.code), ['leak', 'leak']);
  });

  it('moves the headline numbers only through the accepted assumption, and attributes the move to it', async () => {
    const { report } = await replay();
    assert.deepEqual(report.changes.map((c) => c.key), ['oneTimeTotal', 'windowTotal', 'planTotal']);
    for (const c of report.changes) {
      assert.ok(c.after.p50 > c.before.p50, c.key);
      assert.deepEqual(c.movedBy.map((m) => m.targetKey), ['T1']);
    }
    const one = report.changes.find((c) => c.key === 'oneTimeTotal')!;
    // Scrap recovery falls from about 1.8% to about 0.4% of 324 scrapped brackets at $186.40: about $900 more.
    assert.ok(one.after.p50 - one.before.p50 > 800 && one.after.p50 - one.before.p50 < 1000);
    assert.equal(report.unchangedHeadlines, 3);
    assert.deepEqual(report.notApplied, []);
    assert.deepEqual(report.convergence, { before: true, after: true });
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

  it('an unapplied accepted assumption is reported, not hidden', async () => {
    const { prep, rec } = await replay();
    const bad = structuredClone(prep.targets);
    bad[0]!.inputId = 'recovery:NO-SUCH-ITEM';
    const verdicts = await reviewProposals(rec.agentOutput.proposals.slice(0, 1), bad, recordedFetcher(rec.pages), { today: rec.recordedOn, identifiers: prep.identifiers });
    assert.equal(verdicts[0]!.status, 'accepted');
    const { applyAndReport } = await import('../src/apply.ts');
    const r = applyAndReport({ mode: 'RECORDED', ecr: 'ECR-0417', seed: rec.seed, provenance: [], targets: bad, verdicts, run: prep.run });
    assert.equal(r.notApplied.length, 1);
    assert.match(r.notApplied[0]!.message, /no input of this check has that id/);
    assert.equal(r.changes.length, 0);
  });

  it('runs offline from the command line and exits 0', () => {
    const out = execFileSync('node', [here('../src/cli.ts'), '--replay', REC], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    assert.match(out, /ACCEPTED/);
    assert.match(out, /NEEDS_PERSON/);
    assert.match(out, /REJECTED/);
    assert.match(out, /Net total, year one/);
    assert.match(out, /proposal #3 is planted to test the guardrails: a fabricated quote/);
    assert.match(out, /proposal #4 is planted/);
    assert.ok(!/\bLIVE\b/.test(out));
  });

  it('--live without the token stops at once and says which variable is missing', () => {
    let err = '';
    try {
      execFileSync('node', [here('../src/cli.ts'), '--live', 'ECR-0417'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' });
    } catch (e) {
      err = String((e as { stderr?: string }).stderr);
    }
    assert.match(err, /BRIGHT_DATA_API_TOKEN is not set/);
  });
});
