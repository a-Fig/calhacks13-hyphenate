// Screenshots of the gate and ERP-package views in live mode. Needs  VITE_NORN_SOURCE=live VITE_NORN_DB=<scratch db> npx vite --port 5183
//   NORN_WEB=http://127.0.0.1:5183 node web/screenshots/capture-gate.mjs <outDir> [ECR-0423 ECR-0417 ...]
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = process.env.NORN_WEB ?? 'http://127.0.0.1:5173';
const out = process.argv[2];
const ids = process.argv.slice(3);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => m.type() === 'error' && console.log('[console.error]', m.text()));
for (const id of ids) {
  await page.goto(`${BASE}/ecr/${id}`);
  await page.waitForSelector('.nx-thread', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${id}-conversation-live.png`), fullPage: true });
  console.log('wrote', id);
}
await browser.close();
