// The publisher's idempotency (publisher.ts), against a fake PLM that behaves like the real one:
// it keeps the fields it was given and answers with them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statementToPlmFields, type Provenance, type StatementDoc } from './format.ts';
import type { ImpactFields, ImpactState, PlmApi } from './plm.ts';
import { publishStatement } from './publisher.ts';

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
const deps = (plm: PlmApi, published = new Map<string, string>(), comment = false) => ({ plm, published, comment, log: () => {} });

test('the same statement is written once, however often the publisher looks', async () => {
  const plm = new FakePlm('ECR-0417');
  const d = deps(plm);
  const f = fmt(statement(12));
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'written');
  assert.equal(await publishStatement(d, 'ECR-0417', f, prov), 'unchanged');
  assert.equal(await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov), 'unchanged');
  assert.equal(plm.writes.length, 1);
  assert.equal(plm.reads, 1, 'a steady state costs no requests: the ref is remembered');
});

test('after a restart (memory gone) the PLM itself says it is already there, so nothing is written again', async () => {
  const plm = new FakePlm('ECR-0417');
  await publishStatement(deps(plm), 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(plm.writes.length, 1);
  const restarted = deps(plm, new Map());
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
  const d = deps(on, new Map(), true);
  await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov);
  await publishStatement(d, 'ECR-0417', fmt(statement(12)), prov);
  assert.equal(on.comments.length, 1);
  assert.ok(on.comments[0]!.includes('Approve with conditions'));
});
