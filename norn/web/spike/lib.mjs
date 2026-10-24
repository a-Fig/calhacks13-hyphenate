// Helpers for the browser spikes: run the CLI, start and stop workers, reset and reseed.
import { execSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const NORN = join(here, '..', '..');
export const OUT = join(NORN, 'spike-out');
mkdirSync(OUT, { recursive: true });

// Windows keeps the variable as 'Path'; adding a second 'PATH' key would be ignored by cmd.exe.
const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
const env = { ...process.env, [pathKey]: `${process.env[pathKey]};${join(process.env.LOCALAPPDATA ?? '', 'SpacetimeDB')}` };

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function sh(cmd, cwd = NORN) {
  return execSync(cmd, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function sql(query) {
  return sh(`spacetime sql norn "${query}" --no-config --server local`);
}

export function resetAndSeed() {
  const t0 = Date.now();
  sh('npm run db:reset');
  const t1 = Date.now();
  sh('npm run seed');
  return { resetMs: t1 - t0, seedMs: Date.now() - t1 };
}

const workers = new Map();

export function startWorker(name, extraEnv = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
    cwd: join(NORN, 'workers'),
    env: { ...env, WORKER_NAME: name, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(OUT, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  workers.set(name, child);
  return child;
}

export function killWorker(name) {
  const child = workers.get(name);
  if (child && child.exitCode === null) child.kill('SIGKILL'); // TerminateProcess on Windows: no cleanup runs
  workers.delete(name);
}

export function stopAll() {
  for (const n of [...workers.keys()]) killWorker(n);
}

export const percentile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

// Injected into every page before it loads: records what the user would see, each time the DOM
// changes, plus long main-thread tasks.
export const RECORDER = `
(() => {
  const snaps = []; window.__snaps = snaps; window.__long = [];
  const q = id => document.querySelector('[data-testid="' + id + '"]');
  const run = s => { const e = q('run-' + s); return e ? e.dataset.run + ':' + e.dataset.status + ':' + e.dataset.pr : null; };
  let last = '';
  function snap() {
    const page = q('pr-page');
    const s = {
      pr: page ? page.dataset.pr : null,
      loadingFor: page ? page.dataset.loadingFor : null,
      status: (q('pr-status') || {}).textContent || null,
      revision: (q('pr-revision') || {}).textContent || null,
      rev: Object.fromEntries([...document.querySelectorAll('[data-testid^="rev-"]')].map(e => [e.dataset.testid.slice(4), e.textContent])),
      runs: Object.fromEntries(['s1_bom_delta','s2_cost','s3_timeline','s4_supply','s0_extract','s5_card'].map(k => [k, run(k)])),
      progress: (q('progress') || {dataset: {}}).dataset.done || null,
    };
    const key = JSON.stringify(s);
    if (key !== last) { last = key; snaps.push({ t: Date.now(), ...s }); }
  }
  const start = () => { new MutationObserver(snap).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); snap(); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push({ at: Date.now(), ms: Math.round(e.duration) }))).observe({ entryTypes: ['longtask'] }); } catch {}
})();
`;
