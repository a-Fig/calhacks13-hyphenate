// Spike 2: two browsers on one ECR. An assumption edit must invalidate the checks that read it,
// atomically, on both screens; switching ECRs must be clean. Drives the installed Edge.
// Needs: SpacetimeDB running, module published, Vite dev server on :5173.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { OUT, RECORDER, resetAndSeed, sleep, startWorker, stopAll } from './lib.mjs';

const BASE = 'http://127.0.0.1:5173';
const KEY = 'second_source_qualification_weeks';
const STAGES = ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'];
const report = { checks: [], timings: {} };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};
const runId = s => (s ? s.split(':')[0] : null);
const runPr = s => (s ? s.split(':')[2] : null);

report.timings.seed = resetAndSeed();
startWorker('w1', { NORN_MC_TICKS: '4', NORN_MC_TICK_MS: '100' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function open(name, path = '/spike') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${name} pageerror]`, e.message));
  await page.goto(`${BASE}${path}?as=${name}`);
  return page;
}
const snaps = page => page.evaluate('window.__snaps');
const onPage = (page, n) =>
  page.waitForFunction(
    n => {
      const p = document.querySelector('[data-testid="pr-page"]');
      return p && p.dataset.pr === n && p.dataset.loadingFor === '';
    },
    String(n),
    { timeout: 20000 }
  );
const allDone = (p, stages) =>
  p.waitForFunction(
    stages => stages.every(s => document.querySelector(`[data-testid="run-${s}"]`)?.dataset.status === 'done'),
    stages,
    { timeout: 60000 }
  );
const revIs = (p, r) =>
  p.waitForFunction(([k, r]) => document.querySelector(`[data-testid="rev-${k}"]`)?.textContent === r, [KEY, r], { timeout: 10000 });

try {
  const A = await open('Alice');
  const B = await open('Bob');
  for (const p of [A, B]) {
    await p.waitForSelector('[data-testid="conn"][data-status="connected"]');
    await p.click('[data-testid="ecr-2"]');
    await onPage(p, 2);
    await allDone(p, STAGES);
  }
  check('both browsers show ECR-2 with all four impact screens done', true);

  // ---- 1. an edit invalidates exactly the checks that read the assumption, on both screens
  const before = (await snaps(A)).at(-1);
  const oldS3 = runId(before.runs.s3_timeline);
  const oldS2 = runId(before.runs.s2_cost);
  const rev0 = before.rev[KEY];
  await A.fill(`[data-testid="input-${KEY}"]`, '{"kind":"triangular","min":20,"mode":34,"max":60}');
  const t0 = Date.now();
  await A.click(`[data-testid="save-${KEY}"]`);
  const newRev = String(Number(rev0) + 1);
  for (const p of [A, B]) await revIs(p, newRev);
  await sleep(300);
  let torn = 0;
  const seen = {};
  for (const [name, p] of [['Alice', A], ['Bob', B]]) {
    const win = (await snaps(p)).filter(s => s.t >= t0 - 20);
    for (const s of win) {
      const s3Changed = runId(s.runs.s3_timeline) !== oldS3;
      const revNew = s.rev[KEY] === newRev;
      if (s3Changed !== revNew) torn++; // assumption and the replaced run must appear together
      if (runId(s.runs.s2_cost) !== oldS2) torn++; // an unrelated stage must not be touched
      if (runPr(s.runs.s3_timeline) !== '2') torn++;
    }
    const first = win.find(s => s.rev[KEY] === newRev);
    seen[name] = first ? first.t - t0 : null;
  }
  check(
    'edit and invalidation arrive in one step on both screens (no torn DOM snapshot)',
    torn === 0,
    `torn snapshots: ${torn}; time from click to new revision on screen: ${JSON.stringify(seen)} ms`
  );
  report.timings.editToScreenMs = seen;
  const bAfter = (await snaps(B)).find(s => s.rev[KEY] === newRev);
  check(
    'selective: Time-to-the-line replaced, Unit cost kept (same run id)',
    runId(bAfter.runs.s3_timeline) !== oldS3 && runId(bAfter.runs.s2_cost) === oldS2,
    `s3 ${oldS3} -> ${bAfter.runs.s3_timeline} ; s2 stays ${oldS2}`
  );
  for (const p of [A, B])
    await p.waitForFunction(() => document.querySelector('[data-testid="run-s3_timeline"]')?.dataset.status === 'done', null, { timeout: 30000 });
  report.timings.recomputeDoneMs = Date.now() - t0;
  check('the worker recomputed the replaced check and both screens show it done', true, `${report.timings.recomputeDoneMs} ms after the click`);

  // ---- 2. approval is withdrawn in the same step as the edit that outdates it
  await A.click('[data-testid="submit"]');
  await A.waitForSelector('[data-testid="approve"]');
  await A.click('[data-testid="approve"]');
  for (const p of [A, B])
    await p.waitForFunction(() => document.querySelector('[data-testid="pr-status"]')?.textContent === 'Approved', null, { timeout: 10000 });
  const pre = (await snaps(B)).at(-1);
  const t1 = Date.now();
  await B.fill(`[data-testid="input-${KEY}"]`, '{"kind":"triangular","min":22,"mode":36,"max":64}');
  await B.click(`[data-testid="save-${KEY}"]`);
  const rev2 = String(Number(newRev) + 1);
  for (const p of [A, B]) await revIs(p, rev2);
  await sleep(300);
  let tornApproval = 0;
  for (const p of [A, B]) {
    for (const s of (await snaps(p)).filter(s => s.t >= t1 - 20)) {
      const edited = s.rev[KEY] === rev2;
      const withdrawn = s.status === 'In review';
      if (edited !== withdrawn) tornApproval++;
    }
  }
  check(
    'an edit after approval withdraws the approval in the same step (no screen shows Approved with the new assumption)',
    tornApproval === 0,
    `torn snapshots: ${tornApproval}; before the edit: ${pre.status} ${pre.revision}`
  );

  // ---- 3. two reviewers edit the same assumption at once: one wins, the other is told
  for (const p of [A, B])
    await p.waitForFunction(() => document.querySelector('[data-testid="run-s3_timeline"]')?.dataset.status === 'done', null, { timeout: 30000 });
  await A.fill(`[data-testid="input-${KEY}"]`, '{"kind":"triangular","min":1,"mode":2,"max":3}');
  await B.fill(`[data-testid="input-${KEY}"]`, '{"kind":"triangular","min":4,"mode":5,"max":6}');
  await Promise.all([A.click(`[data-testid="save-${KEY}"]`), B.click(`[data-testid="save-${KEY}"]`)]);
  await sleep(1500);
  const errs = [];
  for (const [n, p] of [['Alice', A], ['Bob', B]]) {
    if (await p.locator(`[data-testid="error-${KEY}"]`).count())
      errs.push([n, await p.locator(`[data-testid="error-${KEY}"]`).innerText()]);
  }
  const revNow = await A.locator(`[data-testid="rev-${KEY}"]`).innerText();
  check(
    'simultaneous edits: exactly one saved, the loser sees the conflict message',
    errs.length === 1 && revNow === String(Number(rev2) + 1),
    `losers: ${JSON.stringify(errs)}; revision now ${revNow} (expected ${Number(rev2) + 1})`
  );

  // ---- 4. switching ECRs
  const sw = [];
  async function switchTo(n) {
    const t = Date.now();
    await A.click(`[data-testid="ecr-${n}"]`);
    await onPage(A, n);
    return Date.now() - t;
  }
  const tSwitch0 = Date.now();
  for (const n of [1, 3, 2, 1]) sw.push({ to: n, ms: await switchTo(n) });
  report.timings.switchMs = sw;
  for (const n of [3, 1, 3, 2]) await A.click(`[data-testid="ecr-${n}"]`); // rapid, no waiting
  await onPage(A, 2);
  await sleep(500); // let the last unsubscribe land
  const cache = await A.evaluate('window.__norn.cacheByPr()');
  const cachePrs = Object.keys(cache).sort();
  check(
    'after switching (4 slow, then 4 rapid clicks) the cache holds only baseline and the selected ECR',
    JSON.stringify(cachePrs) === JSON.stringify(['0', '2']),
    `ECRs with rows in the cache: ${JSON.stringify(cachePrs)}`
  );
  let mixed = 0, blank = 0, wasLoading = 0;
  for (const s of (await snaps(A)).filter(s => s.t >= tSwitch0)) {
    if (s.pr === null) blank++;
    for (const k of Object.keys(s.runs)) if (s.runs[k] && runPr(s.runs[k]) && runPr(s.runs[k]) !== s.pr) mixed++; // '' = a stage with no run yet
    if (s.loadingFor) wasLoading++;
  }
  check(
    'no snapshot mixed rows of two ECRs and the page never blanked during a switch',
    mixed === 0 && blank === 0,
    `mixed ${mixed}, blank ${blank}, snapshots showing the loading marker ${wasLoading}`
  );
  console.log('switch times (ms):', JSON.stringify(sw));

  await A.screenshot({ path: `${OUT}/two-browsers-alice.png`, fullPage: true });
  await B.screenshot({ path: `${OUT}/two-browsers-bob.png`, fullPage: true });

  // ---- 5. the SDK's own useTable hook, for comparison
  const P = await open('Probe', '/probe.html');
  await P.waitForSelector('[data-testid="probe"][data-ready="true"]', { timeout: 15000 });
  const flashes = [];
  for (const n of [2, 3, 1, 2]) {
    const mark = await P.evaluate('window.__probe.length');
    const t = Date.now();
    await P.click(`[data-testid="go-${n}"]`);
    await P.waitForFunction(
      n => {
        const e = document.querySelector('[data-testid="probe"]');
        return e.dataset.pr === n && e.dataset.ready === 'true' && Number(e.dataset.rows) > 0;
      },
      String(n),
      { timeout: 15000 }
    );
    const rs = (await P.evaluate('window.__probe')).slice(mark);
    flashes.push({
      to: n,
      ms: Date.now() - t,
      renders: rs.length,
      emptyOrNotReadyRenders: rs.filter(r => !r.ready || r.rows === 0).length,
      oldRowsShownUnderNewQuery: rs.filter(r => r.rowPrs.some(p => p !== r.pr)).length,
    });
  }
  report.timings.stockUseTable = flashes;
  console.log('stock useTable on switch:', JSON.stringify(flashes));
} catch (e) {
  check('script ran to the end', false, e.stack ?? String(e));
} finally {
  await browser.close();
  stopAll();
  writeFileSync(`${OUT}/two-browsers.json`, JSON.stringify(report, null, 2));
  const failed = report.checks.filter(c => !c.ok).length;
  console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}
