// Screenshots of the ECR screens reading Norn's database (VITE_NORN_SOURCE=live). Needs the dev server
// started as  VITE_NORN_SOURCE=live VITE_NORN_DB=norn-ui npx vite  and Edge.
//   node web/screenshots/capture-live.mjs
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NORN_WEB ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => m.type() === 'error' && console.log('[console.error]', m.text()));
const shot = async (name, opts = {}) => { await page.screenshot({ path: join(here, `${name}.png`), ...opts }); console.log('wrote', name); };
const open = async (path, ready) => { await page.goto(`${BASE}${path}`); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(600); };

await open('/', '[data-testid="ecr-table"]');
await shot('ecr-list-live');
await open('/ecr/ECR-0417', '.nx-thread');
await shot('ecr-0417-conversation-live');
await shot('ecr-0417-conversation-live-full', { fullPage: true });
await open('/ecr/ECR-0417/impact/cost', '.nx-checks');
await shot('ecr-0417-impact-live');
await shot('ecr-0417-impact-live-full', { fullPage: true });
await browser.close();
