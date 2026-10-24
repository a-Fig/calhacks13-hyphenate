// Screenshots of the PLM as a person sees it, with the installed Edge, through the SSH tunnel.
//
//   ENV_FILE=<repo>/.env node bowman/plm/screenshots.ts <label> [user-email] [--extra]
//
// Writes bowman/plm/screenshots/<label>-*.png. Logs in as the CCB chair unless a user is given.
// Browses http://localhost:<port> rather than 127.0.0.1 so the session cookie does not collide with
// the ERP, which the same laptop reaches at 127.0.0.1:8081.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Plm, readEnv } from './client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const env = readEnv();
const label = process.argv[2] ?? 'shot';
const user = process.argv[3] ?? 'rafael.quintero@bowman-aviation.example';
const apiBase = env.PLM_URL || 'http://127.0.0.1:8082';
const siteUrl = apiBase.replace('127.0.0.1', 'localhost');
const out = resolve(here, 'screenshots');
mkdirSync(out, { recursive: true });

const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const plm = new Plm(apiBase);
await plm.login(user, env.PLM_USER_PASSWORD);
const sid = plm.cookie.match(/sid=([^;]+)/)?.[1];
if (!sid) throw new Error('no session cookie');

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: 'sid', value: sid, url: siteUrl }]);
const page = await ctx.newPage();

async function shot(name: string, path: string, after?: () => Promise<void>, full = false) {
  await page.goto(siteUrl + path, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  if (after) await after();
  const file = resolve(out, `${label}-${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log('saved', file);
}

const tabTo = (name: string) => async () => {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(800);
};

const extra = process.argv.includes('--extra');
if (extra) {
  // Screens added with released_eco, supplier quote firmness and the EBOM label.
  await shot('ecr-0319-released-eco', '/desk/ecr/ECR-0319');
  await shot('ecr-0409-quotes', '/desk/ecr/ECR-0409', tabTo('Affected items'), true);
  await shot('ebom-list', '/desk/engineering-bom');
  await shot('home', '/desk/bowman-plm');
  await browser.close();
  process.exit(0);
}
await shot('home', '/desk');
await shot('ecr-list', '/desk/ecr');
await shot('ecr-0417-request', '/desk/ecr/ECR-0417');
await shot('ecr-0417-impact', '/desk/ecr/ECR-0417', tabTo('Impact assessment'));
await shot('ecr-0417-affected', '/desk/ecr/ECR-0417', tabTo('Affected items'));
await shot('ecr-0417-cost', '/desk/ecr/ECR-0417', tabTo('Cost page'));
await shot('part-list', '/desk/part');
await shot('part-bracket', '/desk/part/BW-5120-210');
await shot('ebom-vesper', '/desk/engineering-bom/EBOM-BW-0001-000');
await shot('ncr-list', '/desk/ncr');
await shot('eco-list', '/desk/eco');
await browser.close();
