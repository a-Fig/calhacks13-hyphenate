// Offline audit evidence on computed rows, using the same Edge capture workflow as capture.mjs.
// BEFORE_URL=http://127.0.0.1:5193 AFTER_URL=http://127.0.0.1:5192 node --import tsx web/screenshots/audit.mjs <output-dir> <baseline-web-dir>
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bowman } from '../../../bowman/data/index.ts';
import { costAssessment, timelineCheck, timelineRows, supplyCheck, supplyCheckRows, bomDelta, bomDeltaRows } from '../../checks/src/index.ts';

const dir = process.argv[2];
const baselineWeb = process.argv[3];
if (!dir || !baselineWeb) throw new Error('Pass a new output directory and the baseline web directory');
mkdirSync(dir, { recursive: true });
const ecr = bowman.ecrs.find(e => e.id === 'ECR-0417');
const seed = 'norn-seed-1';
const rows = [bomDeltaRows(bomDelta(bowman, ecr)), costAssessment(bowman, ecr, { seed }).rows,
  timelineRows(timelineCheck(bowman, ecr, { seed })), supplyCheckRows(supplyCheck(bowman, ecr, { seed }))];
const fixture = { ecr, rows };
writeFileSync(join(dir, 'audit-inputs.json'), JSON.stringify(fixture));
const here = dirname(fileURLToPath(import.meta.url));
const beforeHarnessName = `audit-render-${randomUUID()}.tsx`;
const beforeHarnessPath = join(baselineWeb, 'screenshots', beforeHarnessName);
writeFileSync(beforeHarnessPath, readFileSync(join(here, 'audit-view.tsx')), { flag: 'wx' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [label, url] of [['before', process.env.BEFORE_URL ?? 'http://127.0.0.1:5193'], ['after', process.env.AFTER_URL ?? 'http://127.0.0.1:5192']]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('[data-testid="ecr-table"]');
    const harness = `/screenshots/${label === 'before' ? beforeHarnessName : 'audit-view.tsx'}`;
    for (const check of ['cost', 'timeline', 'supply', 'class', 'conversation']) {
      await page.evaluate(async ({ harness, fixture, check }) => (await import(harness)).render(fixture, check), { harness, fixture, check });
      await page.waitForSelector(check === 'conversation' ? '#audit-component .nx-thread' : '#audit-component .nx-checks');
      await page.waitForTimeout(250);
      if (label === 'after' && check === 'conversation' && await page.getByText('The CCB approved this ECR', { exact: true }).count()) throw new Error('Conversation invented a board approval');
      await page.screenshot({ path: join(dir, `${label}-${check}.png`), fullPage: true });
      if (label === 'after') await page.screenshot({ path: join(dir, `flow-${check}.png`) });
    }
    if (label === 'after') {
      await page.evaluate(async ({ harness, fixture }) => (await import(harness)).render(fixture, 'cost'), { harness, fixture });
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(dir, 'interaction-0.png') });
      for (const [i, name] of ['Time to the line', 'Supply risk', 'Classification'].entries()) {
        await page.locator('#audit-component .nx-checks-list').getByText(name, { exact: true }).click();
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(dir, `interaction-${i + 1}.png`) });
      }
    }
    if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`);
    await context.close();
  }
} finally { await browser.close(); unlinkSync(beforeHarnessPath); }
console.log(dir);
