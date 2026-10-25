// node render.mjs stills t1 t2 ...   |   node render.mjs frames <worker> <workers>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/smash/Desktop/Claude Work Space/w-live/norn/web/package.json');
const { chromium } = require('playwright-core');
const ROOT = 'C:/Users/smash/Desktop/Claude Work Space/calhacks13-hyphenate/brag-output';
const [mode, ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('file:///' + ROOT + '/composition/index.html');
const info = await page.evaluate(() => window.ready);
if (info.missing.length) console.log('MISSING WORDS', info.missing);
const stage = await page.$('#stage');
if (mode === 'stills') {
  mkdirSync(ROOT + '/work/stills', { recursive: true });
  for (const t of rest) { await page.evaluate(t => seek(t), +t); await stage.screenshot({ path: `${ROOT}/work/stills/t${(+t).toFixed(2)}.jpg`, quality: 80, type: 'jpeg' }); }
  console.log('stills', rest.length);
} else {
  const [w, n] = rest.map(Number), fps = 30, N = Math.ceil(info.end * fps);
  mkdirSync(ROOT + '/work/frames', { recursive: true });
  const per = Math.ceil(N / n), a = w * per, b = Math.min(N, a + per);
  for (let i = a; i < b; i++) {
    await page.evaluate(t => seek(t), i / fps);
    await stage.screenshot({ path: `${ROOT}/work/frames/${String(i).padStart(5, '0')}.jpg`, quality: 93, type: 'jpeg' });
    if ((i - a) % 300 === 0) console.log('w' + w, i, '/', b);
  }
  console.log('done w' + w, a, b);
}
await browser.close();
