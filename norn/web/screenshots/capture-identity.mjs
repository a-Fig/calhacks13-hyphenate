// Read-only visual audit of the saved-run demo. Needs Edge and `npm run web -- --port 5186`.
// node web/screenshots/capture-identity.mjs before C:/path/to/media
// node web/screenshots/capture-identity.mjs after C:/path/to/media --gif
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const [phase, out] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(phase) && out, 'usage: capture-identity.mjs before|after OUTPUT [--gif]');
mkdirSync(out, { recursive: true });
const base = process.env.NORN_WEB ?? 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const screenshots = [];
const shot = async name => {
  const file = join(out, `${phase}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
};
const open = async (path, ready) => {
  await page.goto(base + path);
  await page.locator(ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
};

try {
  await open('/', '[data-testid="ecr-table"]');
  await shot('list');
  await page.getByRole('button', { name: /^Closed/ }).click();
  await shot('closed');
  for (const [name, route, ready] of [
    ['conversation', '/ecr/ECR-0417', '.nx-thread'],
    ['provisional', '/ecr/ECR-0409', '.nx-thread'],
    ['released', '/ecr/ECR-0423', '.nx-erp'],
    ...['cost', 'bom', 'timeline', 'supply', 'class'].map(id => [id, `/ecr/ECR-0417/impact/${id}`, '.nx-check-pane']),
    ['changes', '/ecr/ECR-0417/changes', '.nx-diff'],
    ['revisions', '/ecr/ECR-0417/revisions', '.nx-revs'],
    ['summary', '/ecr/ECR-0419', '.nx-tabbody'],
  ]) {
    await open(route, ready);
    await shot(name);
  }
  await open('/ecr/ECR-0417/impact/cost', '.nx-cost');
  await page.locator('.nx-cost .nx-mark').first().click();
  await page.getByTestId('why-panel').waitFor();
  await shot('why');
  await page.keyboard.press('Escape');

  if (phase === 'after') {
    // The visible demo and its controls retain their behavior after the identity change.
    await open('/', '[data-testid="ecr-table"]');
    const search = page.getByRole('textbox', { name: 'Search ECRs' });
    await search.fill('is:open ECR-0417');
    assert.equal(await page.locator('.nx-row').count(), 1);
    await page.getByTestId('row-ECR-0417').getByRole('link').first().click();
    await page.locator('.nx-thread').waitFor();
    await page.getByRole('link', { name: /^Changes/ }).click();
    const collapse = page.getByRole('button', { name: /^Collapse/ }).first();
    await collapse.click();
    await page.getByRole('button', { name: /^Expand/ }).first().click();
    await page.getByRole('link', { name: /^Impact/ }).first().click();
    await page.locator('.nx-check-pane').waitFor();
    assert.equal(await page.locator('[data-component="StateLabel"] svg.octicon').count(), 0);
    assert.equal(await page.locator('svg.octicon-git-pull-request, svg.octicon-git-merge, svg.octicon-git-commit, svg.octicon-file-diff, svg.octicon-repo').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await open('/', '[data-testid="ecr-table"]');
    await shot('mobile-list');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'list overflows mobile viewport');
    await open('/ecr/ECR-0417', '.nx-thread');
    await shot('mobile-conversation');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'conversation overflows mobile viewport');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  if (process.argv.includes('--gif')) {
    const dir = mkdtempSync(join(tmpdir(), 'norn-identity-frames-'));
    const frames = [];
    const frame = async ms => {
      const file = join(dir, `f${frames.length}.png`);
      await page.screenshot({ path: file });
      frames.push({ file, ms });
    };
    await open('/', '[data-testid="ecr-table"]');
    await frame(1300);
    await page.getByTestId('row-ECR-0417').getByRole('link').first().click();
    await page.locator('.nx-thread').waitFor();
    await frame(1800);
    await page.getByRole('link', { name: /^Impact/ }).first().click();
    await page.locator('.nx-cost').waitFor();
    await frame(1800);
    await page.locator('.nx-cost .nx-mark').first().click();
    await page.getByTestId('why-panel').waitFor();
    await frame(2000);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: /^Changes/ }).click();
    await page.locator('.nx-diff').first().waitFor();
    await frame(1600);
    await page.getByRole('link', { name: /^Revisions/ }).click();
    await page.locator('.nx-revs').waitFor();
    await frame(1600);
    const manifest = join(dir, 'frames.json');
    writeFileSync(manifest, JSON.stringify(frames));
    execFileSync('python', [join(dirname(fileURLToPath(import.meta.url)), 'make-gif.py'), manifest, join(out, `${phase}-flow.gif`), '1100'], { stdio: 'inherit' });
  }
  assert.deepEqual(errors, [], 'browser errors');
  writeFileSync(join(out, `${phase}-audit.json`), JSON.stringify({ screenshots, errors, mode: 'saved runs plus labelled mock narrative' }, null, 2));
  console.log(`${phase}: ${screenshots.length} screens captured; no browser errors`);
} finally {
  await browser.close();
}
