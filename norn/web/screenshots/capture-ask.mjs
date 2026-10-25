// Screenshots of the Ask Norn panel on ECR-0417 (saved runs, so Ask Norn is unavailable and the
// RECORDED example is shown). Needs the Vite dev server (npm run web). Set NORN_BROWSER to a Chrome binary.
//   node web/screenshots/capture-ask.mjs
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NORN_WEB ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch(process.env.NORN_BROWSER ? { executablePath: process.env.NORN_BROWSER, headless: true } : { channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => m.type() === 'error' && console.log('[console.error]', m.text()));
const shot = async (name, opts = {}) => (await page.screenshot({ path: join(here, `${name}.png`), ...opts }), console.log('wrote', name));

await page.goto(`${BASE}/ecr/ECR-0417`);
await page.waitForSelector('.nx-thread');
await page.waitForSelector('[data-testid="ask-norn"]');
await page.waitForTimeout(400);

// Before: the page as it was, with the panel hidden.
await page.addStyleTag({ content: '.nx-ask{display:none}' });
await shot('before-ask-ecr-page-full', { fullPage: true });
await page.reload();
await page.waitForSelector('[data-testid="ask-norn"]');
await page.waitForTimeout(400);

// After, offline: the panel says Ask Norn is unavailable.
const panel = page.locator('[data-testid="ask-norn"]');
await panel.scrollIntoViewIfNeeded();
await shot('ask-norn-unavailable', { fullPage: true });

// The recorded example, labelled RECORDED, with its citation chips.
await page.getByRole('button', { name: 'Show a recorded example' }).click();
await page.waitForSelector('.nx-ask-chip');
await panel.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await panel.screenshot({ path: join(here, 'ask-norn-recorded.png') });
console.log('wrote ask-norn-recorded');

// A chip opens the same "why" panel as the numbers on the page.
await page.locator('button.nx-ask-chip', { hasText: 'Cancellation charge' }).click();
await page.waitForSelector('[data-testid="why-panel"]');
await page.waitForTimeout(500);
await shot('ask-norn-chip-why');
await browser.close();
