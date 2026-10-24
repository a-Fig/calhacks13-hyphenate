// Minimal check that the page loads, connects and shows an ECR. Uses the installed Edge.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5173/spike?as=Smoke');
await page.waitForSelector('[data-testid="conn"][data-status="connected"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="ecr-1"]', { timeout: 15000 });
await page.click('[data-testid="ecr-1"]');
await page.waitForSelector('[data-testid="pr-page"][data-ready="true"]', { timeout: 15000 });
console.log(await page.locator('[data-testid="runs"]').innerText());
await page.screenshot({ path: '../spike-out/smoke.png', fullPage: true });
await browser.close();
