// The publisher's idempotency (publisher.ts), against a fake PLM that behaves like the real one:
// it keeps the fields it was given and answers with them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statementToPlmFields, type Provenance, type StatementDoc } from './format.ts';
import type { ImpactFields, ImpactState, PlmApi } from './plm.ts';
import { gather, pickStatement, publishStatement, type Lease } from './publisher.ts';

class FakePlm implements PlmApi {
  ecrs = new Map<string, ImpactState>();
  writes: { ecr: string; fields: ImpactFields }[] = [];
  reads = 0;
  comments: string[] = [];
  constructor(...names: string[]) {
    for (const n of names) this.ecrs.set(n, {});
  }
  async readImpact(ecr: string) {
    this.reads++;
    const s = this.ecrs.get(ecr);
    return s ? { ...s } : null;
  }
  async writeImpact(ecr: string, fields: ImpactFields) {
    this.writes.push({ ecr, fields });
    const s = this.ecrs.get(ecr)!;
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined || v === '') delete (s as Record<string, string>)[k];
      else (s as Record<string, string>)[k] = String(v);
    }
    return { ...s };
  }
  async postComment(_ecr: string, html: string) {
    this.comments.push(html);
    return { name: `c${this.comments.length}` };
  }
}

const statement = (id: number, headline = 'ECR-0417 costs about $157,000 over twelve months.'): StatementDoc => ({
  id,
  level: 1,
  prRevision: 1,
  createdAtIso: '2026-10-24T20:42:11.000Z',
  changeClass: 'Class I',
  route: "Pending Norn's routing",
  headline,
  numbers: [{ key: 'net_total_year_one', label: 'Net cost, year one', unit: 'USD', p10: 150665, p50: 157150, p90: 164489, evidence: 'computation', resultKey: 'net_total_year_one' }],
  drivers: [],
  assumptions: [],
  claims: [{ text: 'Recommendation: Approve with conditions. Blank lines remain.', evidence: 'judgment' }],
});
const prov: Provenance = { baseline: 'ERPNext baseline 2c02958e, as of 2026-10-24', changeRequest: 'change request rev 1 from the PLM', formulas: {}, mock: false };
const fmt = (s: StatementDoc) => statementToPlmFields(s, { number: 'ECR-0417', title: 't', revision: 1 }, prov, { nornBaseUrl: 'http://127.0.0.1:5173' });
const deps = (plm: PlmApi, comment = false) => ({ plm, comment, log: () => {} });

test('the same statement is written once, however often the publisher looks', async () => {
  const plm = new FakePlm('ECR-0417');
  const d = deps(plm);
  const f = fmt(statement(12));
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'written');
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'unchanged');
  assert.equal(await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov), 'unchanged');
  assert.equal(plm.writes.length, 1);
  assert.equal(plm.reads, 3, 'the PLM is read every time: no remembered ref stands in for it');
});

test('after a restart (memory gone) the PLM itself says it is already there, so nothing is written again', async () => {
  const plm = new FakePlm('ECR-0417');
  await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(plm.writes.length, 1);
  const restarted = deps(plm);
  assert.equal(await publishStatement(restarted, 'ECR-0417', fmt(statement(12)), prov), 'unchanged');
  assert.equal(plm.writes.length, 1);
});

test('a second publisher, or a reset scratch database that re-posts the identical statement, writes nothing either', async () => {
  const plm = new FakePlm('ECR-0417');
  await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov), 'unchanged');
  assert.equal(plm.writes.length, 1);
});

test('a different statement is written over it, and a person editing a plain field gets it put back', async () => {
  const plm = new FakePlm('ECR-0417');
  const d = deps(plm);
  await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(await publishStatement(d, 'ECR-0417', fmt(statement(13, 'A newer bottom line.')), prov), 'written');
  assert.equal(plm.writes.length, 2);
  assert.ok((plm.ecrs.get('ECR-0417')!.impact_statement ?? '').includes('A newer bottom line.'));
  // someone changes the recommendation by hand in the PLM; a fresh publisher notices
  plm.ecrs.get('ECR-0417')!.impact_recommendation = 'Reject';
  assert.equal(await publishStatement(deps(plm), 'ECR-0417', fmt(statement(13, 'A newer bottom line.')), prov), 'written');
  assert.equal(plm.ecrs.get('ECR-0417')!.impact_recommendation, 'Approve with conditions');
});

test('only the seven impact fields are ever sent', async () => {
  const plm = new FakePlm('ECR-0417');
  await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov);
  const allowed = new Set(['impact_report_level', 'impact_recommendation', 'impact_change_class', 'impact_approval_route', 'impact_norn_url', 'impact_updated_on', 'impact_statement']);
  for (const k of Object.keys(plm.writes[0]!.fields)) assert.ok(allowed.has(k), k);
});

test('an ECR the PLM does not have is not written, and mock numbers never reach the PLM', async () => {
  const plm = new FakePlm();
  assert.equal(await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov), 'missing');
  const plm2 = new FakePlm('ECR-0417');
  assert.equal(await publishStatement(deps(plm2), 'ECR-0417', fmt(statement(12)), { ...prov, mock: true }), 'mock');
  assert.equal(plm.writes.length + plm2.writes.length, 0);
});

test('a comment is posted with a write, once, and only when switched on', async () => {
  const off = new FakePlm('ECR-0417');
  await publishStatement(deps(off), 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(off.comments.length, 0);
  const on = new FakePlm('ECR-0417');
  const d = deps(on, true);
  await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov);
  await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(on.comments.length, 1);
  assert.ok(on.comments[0]!.includes('Approve with conditions'));
});

// ---- review findings on #80 -----------------------------------------------------------------------

/** A PLM that takes a moment to answer, as a real one does: the gap in which two publishers both see "not there yet". */
class SlowPlm extends FakePlm {
  async readImpact(ecr: string) {
    const s = await super.readImpact(ecr);
    await new Promise(r => setTimeout(r, 15));
    return s;
  }
  async writeImpact(ecr: string, fields: ImpactFields) {
    await new Promise(r => setTimeout(r, 15));
    return super.writeImpact(ecr, fields);
  }
}

/** The module's publication_claim, in memory: one holder per ECR at a time. */
class FakeClaims {
  held = new Map<string, string>();
  lease(ecr: string, holder: string): Lease {
    return {
      claim: async () => {
        const h = this.held.get(ecr);
        if (h && h !== holder) return false;
        this.held.set(ecr, holder);
        return true;
      },
      release: async () => void (this.held.get(ecr) === holder && this.held.delete(ecr)),
    };
  }
}

test('without a lease, two publishers looking at the same moment both write (the reproduced race)', async () => {
  const plm = new SlowPlm('ECR-0417');
  const f = fmt(statement(12));
  await Promise.all([publishStatement(deps(plm), 'ECR-0417', f, prov), publishStatement(deps(plm), 'ECR-0417', f, prov)]);
  assert.equal(plm.writes.length, 2, 'both read "not there yet" before either wrote');
});

test('with the lease, two publishers at the same moment write once; the loser looks again later and finds it there', async () => {
  const plm = new SlowPlm('ECR-0417');
  const claims = new FakeClaims();
  const f = fmt(statement(12));
  const a = { ...deps(plm, true), lease: claims.lease('ECR-0417', 'A') };
  const b = { ...deps(plm, true), lease: claims.lease('ECR-0417', 'B') };
  const [ra, rb] = await Promise.all([publishStatement(a, 'ECR-0417', f, prov), publishStatement(b, 'ECR-0417', f, prov)]);
  assert.deepEqual([ra, rb].sort(), ['busy', 'written']);
  assert.equal(plm.writes.length, 1);
  assert.equal(plm.comments.length, 1);
  assert.equal(claims.held.size, 0, 'the winner released the lease');
  assert.equal(await publishStatement(b, 'ECR-0417', f, prov), 'unchanged', "the loser's next sweep: the PLM shows the ref");
  assert.equal(plm.writes.length, 1);
});

test('a publisher that got the lease reads the PLM again before writing', async () => {
  const plm = new FakePlm('ECR-0417');
  const f = fmt(statement(12));
  const claims = new FakeClaims();
  // the PLM shows nothing when B first looks; A then writes and releases before B claims
  const read = plm.readImpact.bind(plm);
  let first = true;
  plm.readImpact = async (e: string) => {
    const s = await read(e);
    if (first) {
      first = false;
      await publishStatement({ ...deps(plm), lease: claims.lease('ECR-0417', 'A') }, 'ECR-0417', f, prov);
    }
    return s;
  };
  assert.equal(await publishStatement({ ...deps(plm), lease: claims.lease('ECR-0417', 'B') }, 'ECR-0417', f, prov), 'unchanged');
  assert.equal(plm.writes.length, 1);
});

test('the lease is released when the write fails, so the next sweep can try', async () => {
  const plm = new FakePlm('ECR-0417');
  plm.writeImpact = async () => {
    throw new Error('PLM down');
  };
  const claims = new FakeClaims();
  const d = { ...deps(plm), lease: claims.lease('ECR-0417', 'A') };
  await assert.rejects(publishStatement(d, 'ECR-0417', fmt(statement(12)), prov), /PLM down/);
  assert.equal(claims.held.size, 0);
});

// ---- which statement, and where it came from ----

const t = (ms: number) => ({ toDate: () => new Date(ms) });
const cand = (id: number, level: number, crSeq: number | null, prRevision = 5) => ({ id: BigInt(id), level, crSeq, prRevision });

test("an earlier revision's Level 2 does not beat the current revision's Level 1", () => {
  const cur = { seq: 2, prRevision: 5 };
  assert.equal(pickStatement([cand(1, 2, 1), cand(2, 1, 2)], cur)?.id, 2n);
  assert.equal(pickStatement([cand(1, 1, 1), cand(2, 1, 2), cand(3, 2, 2), cand(4, 1, 2)], cur)?.id, 3n, 'within the revision: highest level, then newest');
  assert.equal(pickStatement([cand(1, 2, 1)], cur), undefined, 'none for the current revision: nothing to publish');
  assert.equal(pickStatement([cand(1, 2, 1), cand(2, 1, 1)], { seq: null, prRevision: 5 }), undefined, 'a run-bound statement of an ECR with no change request is not current');
  assert.equal(pickStatement([cand(1, 2, null, 4), cand(2, 1, null, 5)], cur)?.id, 2n, 'no run behind it: current only if the ECR has not changed since it was posted');
});

/** Just enough of the client cache for gather(): tables keyed by index. */
function fakeDb(o: { current: { seq: number }; runs: { id: bigint; inputs: object }[]; results: { id: bigint; run: bigint; key: string; p: [number, number, number]; mock?: boolean; detail?: object }[]; statements: any[] }) {
  const by = <T>(rows: T[], f: (r: T) => bigint) => ({ filter: (id: bigint) => rows.filter(r => f(r) === id) });
  return {
    ecrRevision: { prId: by([{ seq: o.current.seq, current: true, createdAt: t(0), prId: 1n }], r => r.prId) },
    impactStatement: { prId: by(o.statements.map(s => ({ ...s, prId: 1n })), r => r.prId) },
    checkRun: { id: { find: (id: bigint) => o.runs.map(r => ({ id: r.id, inputsJson: JSON.stringify(r.inputs) })).find(r => r.id === id) } },
    checkResult: { prId: by(o.results.map(r => ({ id: r.id, checkRunId: r.run, key: r.key, p10: r.p[0], p50: r.p[1], p90: r.p[2], mock: r.mock ?? false, detailJson: JSON.stringify(r.detail ?? {}), prId: 1n })), r => r.prId) },
  } as any;
}
const stRow = (id: number, checkRunId: bigint, over: object = {}) => ({
  id: BigInt(id), level: 1, prRevision: 5, checkRunId, createdAt: t(2000 + id), changeClass: 'Class I', route: 'r', headline: 'h', author: null,
  numbers: [{ key: 'net', label: 'Net', unit: 'USD', p10: 1, p50: 2, p90: 3, evidence: 'computation', resultKey: 'net_total_year_one' }], drivers: [], assumptions: [], claims: [], ...over,
});
const inputsOf = (revision: number, baseline: string) => ({ revision, revisionSource: 'plm', erpBaseline: baseline, erpBaselineSource: 'erp', erpBaselineAsOf: '2026-10-24' });
const pr = { id: 1n, plmEcrNumber: 'ECR-0417', title: 't', revision: 5 } as any; // the stRow statements were posted at prRevision 5

test('provenance is the run the statement was written from, not the newest run with the same numbers', () => {
  // run 7 and run 15 are both revision 1 (a baseline-only re-check) and produce identical totals
  const runs = [{ id: 7n, inputs: inputsOf(1, 'aaaaaaaa11') }, { id: 15n, inputs: inputsOf(1, 'bbbbbbbb22') }];
  const cur = { seq: 1 };
  const db = fakeDb({
    current: cur,
    runs,
    results: [
      { id: 70n, run: 7n, key: 'net_total_year_one', p: [1, 2, 3], detail: { trace: { formula: 'old formula' } } },
      { id: 150n, run: 15n, key: 'net_total_year_one', p: [1, 2, 3], detail: { trace: { formula: 'new formula' } } },
      { id: 71n, run: 7n, key: 'detail', p: [0, 0, 0], detail: { codeVersion: 'checks-old', draws: 1000 } },
    ],
    statements: [stRow(12, 7n)],
  });
  const g = gather(db, pr)!;
  assert.match(g.prov.baseline, /aaaaaaaa/, 'baseline of run 7');
  assert.equal(g.prov.s2RunId, 7);
  assert.equal(g.prov.codeVersion, 'checks-old');
  assert.equal(g.prov.formulas.net_total_year_one, 'old formula');
  assert.equal(g.ecr.revision, 1);
  // the run the statement names decides, even when it is not the newest
  const g2 = gather(fakeDb({ current: cur, runs, results: [], statements: [stRow(13, 15n, { numbers: [] })] }), pr)!;
  assert.match(g2.prov.baseline, /bbbbbbbb/);
});

test("a statement from revision 1 is never labelled revision 2, and loses to revision 2's own", () => {
  const runs = [{ id: 7n, inputs: inputsOf(1, 'aaaaaaaa11') }, { id: 15n, inputs: inputsOf(2, 'bbbbbbbb22') }];
  const results = [
    { id: 70n, run: 7n, key: 'net_total_year_one', p: [1, 2, 3] as [number, number, number] },
    { id: 150n, run: 15n, key: 'net_total_year_one', p: [1, 2, 3] as [number, number, number] }, // same totals
  ];
  const cur = { seq: 2 };
  // only a revision-1 statement exists (Level 2): nothing is published for revision 2
  assert.equal(gather(fakeDb({ current: cur, runs, results, statements: [stRow(12, 7n, { level: 2 })] }), pr), null);
  // revision 2's Level 1 wins over it and is labelled with its own run
  const g = gather(fakeDb({ current: cur, runs, results, statements: [stRow(12, 7n, { level: 2 }), stRow(13, 15n)] }), pr)!;
  assert.equal(g.statement.id, 13);
  assert.equal(g.ecr.revision, 2);
  assert.match(g.prov.changeRequest, /rev 2/);
  assert.match(g.prov.baseline, /bbbbbbbb/);
  // were the revision-1 statement the one published, it says revision 1 and its own baseline
  const g1 = gather(fakeDb({ current: { seq: 1 }, runs, results, statements: [stRow(12, 7n)] }), pr)!;
  assert.equal(g1.ecr.revision, 1);
  assert.match(g1.prov.baseline, /aaaaaaaa/);
});

test('the same statement text from another baseline is a different publication (the digest follows the real source)', () => {
  const a = fmt(statement(12));
  const b = statementToPlmFields(statement(12), { number: 'ECR-0417', title: 't', revision: 2 }, { ...prov, baseline: 'ERPNext baseline ffffffff, as of 2026-10-25' }, { nornBaseUrl: 'http://127.0.0.1:5173' });
  assert.notEqual(a.ref, b.ref);
});

test('a statement with no run, posted by a scoped agent after the ECR changed, is not published; one posted at the current revision is', () => {
  const runs = [{ id: 15n, inputs: inputsOf(2, 'bbbbbbbb22') }];
  const judgment = (id: number, prRevision: number) => stRow(id, 0n, { prRevision, level: 2, numbers: [{ key: 'j', label: 'Effort', unit: 'h', p10: 1, p50: 2, p90: 3, evidence: 'judgment', resultKey: '' }] });
  // the ECR is at revision 7 now; a judgment-only Level 2 posted at 5 is out of date and does not beat revision 2's Level 1
  const db7 = (statements: any[]) => fakeDb({ current: { seq: 2 }, runs, results: [], statements });
  const at7 = { ...pr, revision: 7 };
  assert.equal(gather(db7([judgment(12, 5)]), at7), null);
  assert.equal(gather(db7([judgment(12, 5), stRow(13, 15n)]), at7)?.statement.id, 13);
  // posted when the module saw revision 7: current, and published
  assert.equal(gather(db7([judgment(14, 7)]), at7)?.statement.id, 14);
});

test('a publisher that waited for the lease with an older candidate does not overwrite the newer one another wrote', async () => {
  const plm = new FakePlm('ECR-0417');
  const old = fmt(statement(12));
  const newer = fmt(statement(13, 'The newer bottom line.'));
  const claims = new FakeClaims();
  // A decided on statement 12; B publishes 13; then A gets the lease. A picks again and finds 13 is the newest.
  await publishStatement({ ...deps(plm), lease: claims.lease('ECR-0417', 'B') }, 'ECR-0417', newer, prov, () => ({ f: newer, prov }));
  assert.equal(await publishStatement({ ...deps(plm), lease: claims.lease('ECR-0417', 'A') }, 'ECR-0417', old, prov, () => ({ f: newer, prov })), 'unchanged');
  assert.equal(plm.writes.length, 1);
  assert.ok((plm.ecrs.get('ECR-0417')!.impact_statement ?? '').includes('The newer bottom line.'));
  // and if the PLM does not yet show the newest, it is the newest that is written, not A's candidate
  const plm2 = new FakePlm('ECR-0417');
  assert.equal(await publishStatement({ ...deps(plm2), lease: new FakeClaims().lease('ECR-0417', 'A') }, 'ECR-0417', old, prov, () => ({ f: newer, prov })), 'written');
  assert.ok((plm2.ecrs.get('ECR-0417')!.impact_statement ?? '').includes('The newer bottom line.'));
  assert.equal(plm2.writes.length, 1);
});

test('no remembered ref hides a change: if the PLM no longer shows the statement, the next look writes it back', async () => {
  const plm = new FakePlm('ECR-0417');
  const d = deps(plm);
  const f = fmt(statement(12));
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'written');
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'unchanged');
  // another publisher (older, or a person) overwrites the fields, then goes away
  plm.ecrs.set('ECR-0417', { impact_statement: '<p>stale text</p>' });
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'written');
  assert.equal(plm.writes.length, 2);
});
