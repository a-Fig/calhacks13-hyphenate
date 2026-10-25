// Captures Bowman's PLM (Frappe) ECR pages as Jeff Hargrove. Password read from .env, never printed.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('C:/Users/smash/Desktop/Claude Work Space/w-live/norn/web/package.json');
const { chromium } = require('playwright-core');
const env = Object.fromEntries(readFileSync('C:/Users/smash/Desktop/Claude Work Space/calhacks13-hyphenate/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const out = 'C:/Users/smash/Desktop/Claude Work Space/calhacks13-hyphenate/brag-output/work/shots';
const BASE = 'http://localhost:8082';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const r = await ctx.request.post(`${BASE}/api/method/login`, { form: { usr: 'jeff.hargrove@bowman-aviation.example', pwd: env.PLM_USER_PASSWORD } });
console.log('login', r.status());
const page = await ctx.newPage();
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${out}/${name}.png`, ...opts }); console.log('wrote', name); };
for (const path of ['/app/ecr', '/app/ecr/ECR-0417']) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
  const name = 'plm' + path.replace(/\//g, '-').toLowerCase();
  await shot(name); await shot(name + '-full', { fullPage: true });
}
// The ECR form's tabs: list them, then open the impact one
const tabs = await page.$$eval('.form-tabs .nav-link, .form-tabs-list a', els => els.map(e => e.textContent.trim()));
console.log('tabs', JSON.stringify(tabs));
const imp = page.locator('.form-tabs .nav-link, .form-tabs-list a').filter({ hasText: /impact/i }).first();
if (await imp.count()) { await imp.click(); await page.waitForTimeout(1500); await shot('plm-ecr-0417-impact'); await shot('plm-ecr-0417-impact-full', { fullPage: true }); }
await browser.close();
