// Captures Fern's live screens (no login) for the video.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/smash/Desktop/Claude Work Space/w-live/norn/web/package.json');
const { chromium } = require('playwright-core');
const out = 'C:/Users/smash/Desktop/Claude Work Space/calhacks13-hyphenate/brag-output/work/shots';
const BASE = 'http://127.0.0.1:5180';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${out}/${name}.png`, ...opts }); console.log('wrote', name); };
const open = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500); };
for (const [name, path] of [
  ['fern-list', '/'],
  ['fern-0417', '/ecr/ECR-0417'],
  ['fern-0417-impact', '/ecr/ECR-0417/impact'],
  ['fern-0423', '/ecr/ECR-0423'],
  ['fern-0421-impact', '/ecr/ECR-0421/impact'],
  ['fern-0419-impact', '/ecr/ECR-0419/impact'],
]) { await open(path); await shot(name); await shot(name + '-full', { fullPage: true }); }
await browser.close();
