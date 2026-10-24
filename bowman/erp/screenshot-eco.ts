// Screenshots of the ERPNext pages a finance user opens to follow an ECO back to Norn's decision, taken with headless Edge
// logged in as Administrator, at desktop width.
//
//   node bowman/erp/screenshot-eco.ts ECO-0319 <output folder>
//
// Finds the documents entered for the ECO and tagged with its number, so run it between entering the change package and the reset. Drives Edge over
// the DevTools protocol with Node's built-in WebSocket (no dependencies). Needs the tunnel and ERPNEXT_ADMIN_PASSWORD (ENV_FILE or
// the repo-root .env). Node 24, erasable TypeScript syntax only.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-ignore: plain JS module
import { Erp, readEnv, enc } from "./erp.mjs";

const [eco, outDir] = process.argv.slice(2);
if (!eco || !outDir) { console.error("usage: node bowman/erp/screenshot-eco.ts <ECO number> <output folder>"); process.exit(2); }
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const WIDTH = 1440, HEIGHT = 1000;

const env = readEnv();
const base = (env.ERPNEXT_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
const erp = new Erp(base);
await erp.login("Administrator", env.ERPNEXT_ADMIN_PASSWORD);
const list = async (doctype: string, filters: unknown[], fields: string[]): Promise<any[]> =>
  (await erp.get(`/api/resource/${enc(doctype)}`, { filters, fields, limit_page_length: 0 })).body.data;

// What to shoot: file name, path, text the page must show before the picture is taken, a form tab to open, and a field to scroll to.
interface Shot { name: string; path: string; wait?: string; tab?: string; scroll?: string }
const shots: Shot[] = [];
for (const b of await list("BOM", [["bw_eco", "=", eco], ["docstatus", "=", 1]], ["name", "item"])) {
  const s = { path: `/app/bom/${enc(b.name)}`, wait: b.name };
  shots.push({ ...s, name: `bom-${b.item}-details` }, { ...s, name: `bom-${b.item}-costing`, tab: "Costing" }, { ...s, name: `bom-${b.item}-items`, tab: "Production Item" });
}
for (const p of await list("Item Price", [["bw_eco", "=", eco]], ["name", "item_code"])) shots.push({ name: `item-price-${p.item_code}`, path: `/app/item-price/${enc(p.name)}`, wait: p.item_code, scroll: "price_list" });
for (const j of await list("Journal Entry", [["bw_eco", "=", eco]], ["name", "bw_eco_entry"])) shots.push({ name: `journal-entry-${j.bw_eco_entry}`, path: `/app/journal-entry/${enc(j.name)}`, wait: j.name });
shots.push({ name: "journal-entry-list", path: `/app/journal-entry?bw_eco=${enc(eco)}` });
for (const top of ["BW-0001-000", "BW-M000-000"]) {
  const b = (await list("BOM", [["item", "=", top], ["is_default", "=", 1], ["docstatus", "=", 1]], ["name"]))[0];
  if (b) shots.push({ name: `bom-${top}-costing`, path: `/app/bom/${enc(b.name)}`, wait: b.name, tab: "Costing" });
}
if (!shots.length) throw new Error(`nothing in ERPNext is tagged ${eco}`);

// ---- Edge over the DevTools protocol ----------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "edge-shot-"));
const port = 9300 + Math.floor(Math.random() * 500);
const edge = spawn(EDGE, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, "--hide-scrollbars", "--disable-gpu", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  let target: any;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(300);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t: any) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); pending.get(d.id)?.(d); };
  const cdp = (method: string, params: object = {}): Promise<any> => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result?.value;

  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  for (const c of String(erp.cookie).split("; ")) {
    const [name, ...v] = c.split("=");
    await cdp("Network.setCookie", { name, value: v.join("="), url: base });
  }
  mkdirSync(outDir, { recursive: true });
  for (const { name, path, wait: mustShow, tab, scroll } of shots) {
    await cdp("Page.navigate", { url: base + path });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evaluate(`!!document.querySelector('.layout-main-section, .form-layout') && !document.querySelector('.page-container .freeze') && ${mustShow ? `document.body.innerText.includes(${JSON.stringify(mustShow)})` : "document.querySelectorAll('.list-row, .result').length > 0"}`);
    }
    if (!ready) console.log(`  (${name}: page did not finish loading, shooting anyway)`);
    await sleep(1500);
    if (tab) {
      await evaluate(`[...document.querySelectorAll('.form-tabs .nav-link')].find((a) => a.textContent.trim() === ${JSON.stringify(tab)})?.click()`);
      await sleep(1000);
    }
    if (scroll) {
      await evaluate(`document.querySelector('[data-fieldname="${scroll}"]')?.scrollIntoView()`);
      await sleep(500);
    }
    // Grow the window to the page so the whole form is in one picture.
    const height = scroll ? HEIGHT : Math.min(3000, Math.max(HEIGHT, Number(await evaluate("Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, (document.querySelector('.layout-main-section')?.scrollHeight ?? 0) + 200)"))));
    await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    const file = resolve(outDir, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`  ${file}`);
    await cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  }
  ws.close();
} finally {
  edge.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold the folder */ }
}
