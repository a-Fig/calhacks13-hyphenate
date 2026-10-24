// A screenshot of an ECR's Impact assessment tab in the PLM, as a person sees it: headless Edge, logged in
// as one of Bowman's people (default the CCB chair) with the shared PLM_USER_PASSWORD. Browses
// http://localhost:<port>, not 127.0.0.1, so the session cookie does not collide with the ERP's.
//   npx tsx src/level1/screenshot.ts ECR-0417 out.png [user@bowman-aviation.example]   (from norn/workers)
// Never prints the password or the session id.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { userPasswordFromEnv } from './plm.ts';

const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function shootImpactTab(opts: { ecr: string; out: string; user?: string; plmUrl?: string; fullPage?: boolean }): Promise<string> {
  const user = opts.user ?? 'rafael.quintero@bowman-aviation.example';
  const api = (opts.plmUrl ?? process.env.PLM_URL ?? 'http://127.0.0.1:8082').replace(/\/+$/, '');
  const site = api.replace('127.0.0.1', 'localhost');
  const login = await fetch(`${api}/api/method/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usr: user, pwd: userPasswordFromEnv() }) });
  if (!login.ok) throw new Error(`PLM login as ${user} failed: ${login.status}`);
  const sid = login.headers.getSetCookie().map(c => c.split(';')[0]).join(';').match(/sid=([^;]+)/)?.[1];
  if (!sid) throw new Error('the PLM gave no session cookie');
  const out = resolve(opts.out);
  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'sid', value: sid, url: site }]);
    const page = await ctx.newPage();
    await page.goto(`${site}/desk/ecr/${encodeURIComponent(opts.ecr)}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.getByRole('tab', { name: 'Impact assessment' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out, fullPage: opts.fullPage ?? true });
  } finally {
    await browser.close();
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [ecr, out, user] = process.argv.slice(2);
  if (!ecr || !out) throw new Error('usage: screenshot.ts <ECR number> <out.png> [user email]');
  console.log('saved', await shootImpactTab({ ecr, out, user }));
}
