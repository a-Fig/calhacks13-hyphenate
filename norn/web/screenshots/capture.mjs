// Screenshots and the flow GIF for the ECR screens. Needs the Vite dev server (npm run web) and Edge.
//   node web/screenshots/capture.mjs            # PNGs only
//   node web/screenshots/capture.mjs --gif      # also records the flow and writes ecr-flow.gif
//   node web/screenshots/capture.mjs --only=impact   # only the shots whose name contains "impact"
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NORN_WEB ?? 'http://127.0.0.1:5173';
const W = 1440, H = 900;
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => m.type() === 'error' && console.log('[console.error]', m.text()));

const shot = async (name, opts = {}) => {
  if (only && !name.includes(only)) return;
  await page.screenshot({ path: join(here, `${name}.png`), ...opts });
  console.log('wrote', name);
};
const open = async (path, ready) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector(ready);
  await page.waitForTimeout(350);
};

// The list, then ECR-0417 on each tab.
await open('/', '[data-testid="ecr-table"]');
await shot('ecr-list');

await open('/ecr/ECR-0417', '.nx-thread');
await shot('ecr-page');
await shot('ecr-page-full', { fullPage: true });

await open('/ecr/ECR-0417/impact/cost', '.nx-checks');
await shot('ecr-impact');
await shot('ecr-impact-full', { fullPage: true });

await open('/ecr/ECR-0417/changes', '.nx-diff');
await shot('ecr-changes');

await open('/ecr/ECR-0417/revisions', '.nx-rev-list');
await shot('ecr-revisions');

// The "why" panel on the hold cost, the line most worth questioning.
await open('/ecr/ECR-0417/impact/cost', '.nx-checks');
const hold = page.locator('tr', { hasText: 'Hold on S/N 011' }).locator('.nx-mark').first();
await hold.scrollIntoViewIfNeeded();
await hold.click();
await page.waitForSelector('[data-testid="why-panel"]');
await page.waitForTimeout(500);
await shot('why-drawer');

// The other two full pages: a provisional Level 1 that waits, and a fast-track approval.
for (const id of ['ECR-0409', 'ECR-0423']) {
  await open(`/ecr/${id}`, '.nx-thread');
  await shot(`${id.toLowerCase()}-full`, { fullPage: true });
}
await open('/', '[data-testid="ecr-table"]');
await page.getByRole('button', { name: /Closed/ }).first().click();
await page.waitForTimeout(250);
await shot('ecr-list-closed');

// The flow GIF: list, open ECR-0417, Impact tab, click a number, drill one level into its inputs.
if (process.argv.includes('--gif')) {
  const dir = mkdtempSync(join(tmpdir(), 'norn-gif-'));
  const gctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // Headless screenshots have no pointer, so draw one.
  await gctx.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;transform:translate(-100px,-100px)';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8.2-6.2 1.6L8 18z" fill="#1f2328" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    });
  });
  const g = await gctx.newPage();
  const frames = [];
  const frame = async ms => {
    const file = join(dir, `f${String(frames.length).padStart(3, '0')}.png`);
    await g.screenshot({ path: file });
    frames.push({ file, ms });
  };
  const centre = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const glide = async (loc, offsetX = 0) => {
    const t = await centre(loc);
    await g.mouse.move(t.x + offsetX - 140, t.y + 60, { steps: 4 });
    await frame(110);
    await g.mouse.move(t.x + offsetX, t.y, { steps: 8 });
    await g.waitForTimeout(120);
  };

  await g.goto(`${BASE}/`);
  await g.waitForSelector('[data-testid="ecr-table"]');
  await g.mouse.move(900, 130);
  await g.waitForTimeout(300);
  await frame(1200);
  const row = g.locator('[data-testid="row-ECR-0417"]');
  await glide(row, -200);
  await frame(600);
  await row.click();
  await g.waitForSelector('.nx-thread');
  await g.waitForTimeout(400);
  await frame(2200);
  const tab = g.locator('.nx-pr-head a', { hasText: 'Impact' }).first();
  await glide(tab);
  await frame(500);
  await tab.click();
  await g.waitForSelector('.nx-checks');
  await g.waitForTimeout(400);
  await frame(1800);
  const hold = g.locator('tr', { hasText: 'Hold on S/N 011' }).locator('.nx-mark').first();
  await hold.scrollIntoViewIfNeeded();
  await g.waitForTimeout(250);
  await frame(900);
  await glide(hold);
  await frame(600);
  await hold.click();
  await g.waitForSelector('[data-testid="why-panel"]');
  await g.waitForTimeout(500);
  await frame(2800);
  const input = g.locator('[data-testid="why-panel"] li', { hasText: 'Cost of capital' }).first();
  await glide(input);
  await frame(500);
  await input.click();
  await g.waitForTimeout(450);
  await frame(2400);
  const back = g.getByRole('button', { name: /^Back to/ });
  await glide(back);
  await back.click();
  await g.waitForTimeout(400);
  await frame(1500);

  writeFileSync(join(dir, 'frames.json'), JSON.stringify(frames));
  const out = join(here, 'ecr-flow.gif');
  execFileSync('python', [join(here, 'make-gif.py'), join(dir, 'frames.json'), out, '1100'], { stdio: 'inherit' });
  console.log('wrote ecr-flow.gif from', frames.length, 'frames');
}

await browser.close();
