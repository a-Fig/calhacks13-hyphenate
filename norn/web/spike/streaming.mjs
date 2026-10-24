// Spike 3: streaming progress. A dummy Monte Carlo worker reports progress with percentile and
// histogram arrays about twice a second; two browsers watch. Then the same at ~20 a second.
// Measures what the screen shows, not just what the server sent.
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync } from 'node:fs';
import { OUT, RECORDER, killWorker, percentile, resetAndSeed, sleep, startWorker, stopAll } from './lib.mjs';

const BASE = 'http://127.0.0.1:5173';
const report = { checks: [], phases: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};

report.seed = resetAndSeed();
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${name} pageerror]`, e.message));
  await page.goto(`${BASE}/?as=${name}`);
  await page.waitForSelector('[data-testid="conn"][data-status="connected"]');
  await page.click('[data-testid="ecr-1"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="pr-page"]')?.dataset.loadingFor === '');
  return page;
}

function summarize(label, pages, expectedUpdates, expectedMs) {
  return Promise.all(
    pages.map(async ([name, p]) => {
      const data = await p.evaluate(() => ({
        samples: window.__norn.progressRenders ?? [],
        counts: window.__norn.counts,
        snaps: window.__snaps.filter(s => s.progress !== null).map(s => ({ t: s.t, done: Number(s.progress) })),
        long: window.__long,
      }));
      const lags = data.samples.map(s => s.lagMs);
      const warm = lags.slice(5);
      const dones = data.snaps.map(s => s.done);
      let monotonic = true;
      for (let i = 1; i < dones.length; i++) if (dones[i] < dones[i - 1]) monotonic = false;
      const gaps = data.snaps.slice(1).map((s, i) => s.t - data.snaps[i].t);
      const span = data.snaps.length > 1 ? data.snaps.at(-1).t - data.snaps[0].t : 0;
      const row = {
        label, browser: name,
        progressEventsReceived: (data.counts['checkProgress.update'] ?? 0) + (data.counts['checkProgress.insert'] ?? 0),
        distinctScreensShown: dones.length,
        expectedUpdates,
        spanMs: span,
        updatesPerSecondOnScreen: span ? +(((dones.length - 1) * 1000) / span).toFixed(2) : null,
        lastDone: dones.at(-1),
        monotonic,
        lagMs: { p50: percentile(lags, 0.5), p95: percentile(lags, 0.95), max: Math.max(...lags) },
        lagFirst5Ms: lags.slice(0, 5),
        lagAfterFirst5Ms: { p50: percentile(warm, 0.5), p95: percentile(warm, 0.95), max: Math.max(...warm) },
        lagAll: lags,
        gapBetweenScreensMs: { p50: percentile(gaps, 0.5), p95: percentile(gaps, 0.95), max: Math.max(...gaps) },
        longTasksOver50ms: data.long.length,
        longestTaskMs: data.long.reduce((m, l) => Math.max(m, l.ms), 0),
      };
      console.log(JSON.stringify({ ...row, lagAll: undefined }));
      return row;
    })
  );
}

try {
  const A = await open('Alice');
  const B = await open('Bob');

  // ---- phase 1: 40 reports at 2 per second
  startWorker('w1'); // defaults: 20000 draws, 40 ticks, 500 ms
  const t0 = Date.now();
  for (const p of [A, B])
    await p.waitForFunction(() => document.querySelector('[data-testid="run-s4_supply"]')?.dataset.status === 'done', null, { timeout: 120000 });
  const took = Date.now() - t0;
  await sleep(500);
  const rows1 = await summarize('2 per second', [['Alice', A], ['Bob', B]], 40, 20000);
  report.phases.push({ name: '2/s', tookMs: took, rows: rows1 });
  const ok1 = rows1.every(r => r.monotonic && r.lagAfterFirst5Ms.p95 < 250 && r.progressEventsReceived >= 38 && r.distinctScreensShown >= 38);
  check('2 progress reports a second, percentile and histogram arrays: every update reached both screens, in order, p95 lag under 250 ms once warm', ok1, `run took ${took} ms; ${JSON.stringify(rows1.map(r => [r.browser, r.progressEventsReceived, r.distinctScreensShown, r.lagMs.p95, r.longTasksOver50ms]))}`);
  await A.screenshot({ path: `${OUT}/streaming-final.png`, fullPage: false });
  const log1 = readFileSync(`${OUT}/w1.log`, 'utf8').split('\n').filter(l => l.includes('progress reports'));
  console.log(log1.join('\n'));
  report.workerRoundTrip2ps = log1;

  // ---- phase 2: about 20 reports a second, two streams at once (the worker runs two runs at a time)
  killWorker('w1');
  await sleep(500);
  for (const p of [A, B]) await p.evaluate(() => { window.__norn.progressRenders = []; window.__norn.counts = {}; window.__snaps.length = 0; window.__long.length = 0; });
  startWorker('w2', { NORN_MC_TICKS: '400', NORN_MC_TICK_MS: '50' });
  await sleep(1500);
  // a baseline edit that feeds the supply-risk check re-queues it on every ECR
  const KEY = 'disruption_rate_per_year';
  const t1 = Date.now();
  await A.fill(`[data-testid="input-${KEY}"]`, '{"kind":"fixed","value":0.21}');
  await A.click(`[data-testid="save-baseline-${KEY}"]`);
  await A.waitForFunction(() => document.querySelector('[data-testid="run-s4_supply"]')?.dataset.status === 'running', null, { timeout: 30000 });
  for (const p of [A, B])
    await p.waitForFunction(() => { const e = document.querySelector('[data-testid="run-s4_supply"]'); return e?.dataset.status === 'done'; }, null, { timeout: 180000 });
  const took2 = Date.now() - t1;
  await sleep(500);
  const rows2 = await summarize('20 per second', [['Alice', A], ['Bob', B]], 400, 20000);
  report.phases.push({ name: '20/s', tookMs: took2, rows: rows2 });
  const ok2 = rows2.every(r => r.monotonic && r.lagMs.p95 < 500);
  check('20 progress reports a second: screens stay in order and within 500 ms (p95) of the server', ok2, `run took ${took2} ms; ${JSON.stringify(rows2.map(r => [r.browser, r.progressEventsReceived, r.distinctScreensShown, r.lagMs.p95, r.lagMs.max, r.longTasksOver50ms]))}`);
  const log2 = readFileSync(`${OUT}/w2.log`, 'utf8').split('\n').filter(l => l.includes('progress reports'));
  console.log(log2.join('\n'));
  report.workerRoundTrip20ps = log2;
} catch (e) {
  check('script ran to the end', false, e.stack ?? String(e));
} finally {
  await browser.close();
  stopAll();
  writeFileSync(`${OUT}/streaming.json`, JSON.stringify(report, null, 2));
  const failed = report.checks.filter(c => !c.ok).length;
  console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}
