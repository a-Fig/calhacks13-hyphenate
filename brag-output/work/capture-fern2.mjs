import { createRequire } from 'node:module';
const require = createRequire('C:/Users/smash/Desktop/Claude Work Space/w-live/norn/web/package.json');
const { chromium } = require('playwright-core');
const out = 'C:/Users/smash/Desktop/Claude Work Space/calhacks13-hyphenate/brag-output/work/shots';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
for (const ecr of ['ECR-0421', 'ECR-0419', 'ECR-0417']) {
  await page.goto(`http://127.0.0.1:5180/ecr/${ecr}/impact`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  await page.getByText('Supply risk', { exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/fern-${ecr.toLowerCase()}-supply-full.png`, fullPage: true }); console.log('supply', ecr, page.url());
  await page.getByText('Time to the line', { exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/fern-${ecr.toLowerCase()}-time-full.png`, fullPage: true });
}
// Positions of key blocks on ECR-0417's conversation page
await page.goto('http://127.0.0.1:5180/ecr/ECR-0417', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
const boxes = await page.$$eval('h2, h3, .nx-h3, strong', els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top + scrollY), e.textContent.trim().slice(0, 70)]; }).filter(x => x[1]));
console.log(JSON.stringify(boxes));
await browser.close();
