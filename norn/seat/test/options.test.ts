import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck } from '../../checks/src/index.ts';
import { evaluateOptions, type OptionsReport } from '../src/options.ts';

const get = (id: string) => bowman.ecrs.find((e) => e.id === id)!;
const run = (id: string, draws = 2000): OptionsReport =>
  evaluateOptions(bowman, get(id), { seed: 'test-seed', draws, ncrs: bowman.ncrs, peers: bowman.ecrs.filter((e) => e.status === 'submitted' && e.id !== id) });
const r17 = run('ECR-0417');
const r19 = run('ECR-0419');
const opt = (r: OptionsReport, id: string) => r.options.find((o) => o.id === id)!;

test('ECR-0417: options are the disposition and retrofit decisions, duplicates removed', () => {
  assert.ok(r17.options.some((o) => o.asFiled));
  const ids = r17.options.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('retrofit-none'));
  assert.ok(ids.some((i) => i.startsWith('disposition-use_up_all')));
  // Scrap-all behaves exactly as the filed proposal here, so it is not listed twice.
  assert.ok(!ids.some((i) => i.includes('scrap_all')));
});

test('options are paired: the same seed gives the filed option the standalone cost check numbers', () => {
  const alone = costCheck(bowman, get('ECR-0417'), { seed: 'test-seed', draws: 2000 });
  const filed = opt(r17, 'as-filed');
  assert.equal(filed.oneTime.p50, Math.round(alone.headline.oneTimeTotal.p50 * 100) / 100);
  assert.equal(filed.vsFiled.oneTime, 0);
  // Dropping the retrofit removes exactly its rows: the difference is the same on every horizon.
  const nr = opt(r17, 'retrofit-none');
  assert.ok(Math.abs(nr.vsFiled.oneTime - nr.vsFiled.window12) < 500); // the same rows, so equal up to draw noise
  assert.ok(nr.vsFiled.oneTime < -50_000);
  assert.deepEqual(run('ECR-0417').options.map((o) => o.oneTime), r17.options.map((o) => o.oneTime));
});

test('ECR-0417: using the old stock up is cheapest but excluded for the fatigue crack, with the text quoted', () => {
  const up = opt(r17, 'disposition-use_up_all+cut_in-after_use_up');
  assert.ok(up.vsFiled.oneTime < -30_000, `use-up swing ${up.vsFiled.oneTime}`);
  assert.equal(up.eligible, false);
  const ex = up.exclusions.find((e) => e.rule === 'no-old-design-after-failure')!;
  assert.ok(ex.evidence.some((e) => /crack/i.test(e.quote) && e.source.startsWith('ECR-0417')));
  assert.ok(ex.evidence.some((e) => e.source.startsWith('NCR-0119') && /not acceptable for flight/.test(e.quote)));
  // The cut-in moves after the stock is used up, as a serial override and not a money value.
  assert.ok(up.cutIn.serial! > 15);
});

test('a retrofit the ECR makes mandatory cannot be dropped', () => {
  const nr = opt(r17, 'retrofit-none');
  assert.equal(nr.eligible, false);
  const ex = nr.exclusions.find((e) => e.rule === 'retrofit-is-mandatory')!;
  assert.ok(ex.evidence.some((e) => /Replace Rev B on S\/N 001-010/.test(e.quote)));
});

test('recommendation is the cheapest eligible option, and says what it passed over', () => {
  assert.equal(r17.recommended, 'as-filed');
  const rec = r17.options.filter((o) => o.eligible).sort((a, b) => a.window12.p50 - b.window12.p50)[0];
  assert.equal(rec.id, r17.recommended);
  assert.ok(r17.options.some((o) => !o.eligible && o.window12.p50 < rec.window12.p50));
  assert.match(r17.recommendation!.text, /Cheaper but not allowed/);
});

test('ECR-0419: bundling with ECR-0421 is offered, wins, and shows the peer cost; certification acceptance is quoted', () => {
  const b = r19.options.find((o) => o.bundle)!;
  assert.equal(b.bundle!.peer, 'ECR-0421');
  assert.ok(b.vsFiled.oneTime < -50_000);
  assert.ok((b.bundle!.peerShiftWeeks ?? 0) > 0);
  assert.equal(r19.recommended, b.id);
  const filed = opt(r19, 'as-filed');
  assert.equal(filed.eligible, true);
  assert.ok(filed.notes.some((n) => /NCR-0115 disposition: "Use as is/.test(n)));
});

test('no option carries a typed money value', () => {
  for (const o of [...r17.options, ...r19.options]) {
    assert.ok(o.overrides.every((x) => x.id.startsWith('effectivity:') && typeof x.value === 'number' && !x.dist));
    assert.ok(o.decisions.every((d) => Object.values(d).every((v) => typeof v !== 'number' || d.kind === 'cut_in')));
  }
});
