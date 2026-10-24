// Shared by the gate check and the end-to-end test: build the separate `norn-mcp` database from the
// real module, seed it through the real reducers, run the skeleton's mock worker until ECR-0417's
// cheap checks have finished, and a small assertion recorder. Never touches the `norn` database.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '@norn/bindings';
import type { Identity } from 'spacetimedb';

const here = dirname(fileURLToPath(import.meta.url));
export const nornDir = resolve(here, '..', '..');
/** The only database these tests use. */
export const DB = 'norn-mcp';
export const URI = process.env.NORN_URI ?? 'ws://127.0.0.1:3000';
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function recorder() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  return {
    checks,
    check(name: string, ok: boolean, detail = '') {
      checks.push({ name, ok, detail });
      console.log(ok ? 'PASS' : 'FAIL', name, detail ? `(${detail})` : '');
    },
    finish() {
      const failed = checks.filter(c => !c.ok).length;
      console.log(failed ? `${failed} CHECK(S) FAILED of ${checks.length}` : `ALL ${checks.length} CHECKS PASSED`);
      return failed === 0;
    },
  };
}

function spacetimeBin(): string {
  const local = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe') : '';
  return local && existsSync(local) ? local : 'spacetime';
}

const tsxCli = join(nornDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const childEnv = { ...process.env, NORN_DB: DB, NORN_URI: URI };

/** Publish the real module as `norn-mcp` (wiping it), seed it, and start the mock worker. */
export async function resetDatabase(log: (m: string) => void = console.log): Promise<{ stopWorker: () => void }> {
  log(`publishing the module as '${DB}' (data wiped)`);
  // The database name is a literal on purpose: this must never be able to reach `norn`.
  execFileSync(spacetimeBin(), ['publish', 'norn-mcp', '--no-config', '--module-path', 'module', '--server', 'local', '--delete-data=always', '--yes'], { cwd: nornDir, stdio: 'ignore' });
  log('seeding ECR-0417, 0418 and 0419 through the reducers');
  execFileSync(process.execPath, [tsxCli, 'src/seed.ts'], { cwd: join(nornDir, 'workers'), env: childEnv, stdio: 'ignore' });
  log('starting the skeleton\'s mock worker (its results are labelled mock)');
  const worker: ChildProcess = spawn(process.execPath, [tsxCli, 'src/worker.ts'], { cwd: join(nornDir, 'workers'), env: childEnv, stdio: 'ignore' });
  return { stopWorker: () => void worker.kill() };
}

/** Resolves once the mirror shows every cheap check of the ECR finished. */
export async function waitForChecks(norn: { db: DbConnection['db'] }, plm: string, ms = 90_000) {
  const t0 = Date.now();
  for (;;) {
    const pr = [...norn.db.pullRequest.iter()].find(p => p.plmEcrNumber === plm);
    if (pr) {
      const done = new Set([...norn.db.checkRun.prId.filter(pr.id)].filter(r => r.status === 'done').map(r => r.stage));
      if (['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'].every(s => done.has(s))) return pr;
    }
    if (Date.now() - t0 > ms) throw new Error(`the cheap checks of ${plm} did not finish within ${ms / 1000} s (is the worker running?)`);
    await sleep(300);
  }
}

/** A plain SDK connection that is not behind the MCP server: for checks of the module itself. */
export function rawClient(): Promise<{ conn: DbConnection; identity: Identity; R: Record<string, (a: any) => Promise<void>> }> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn, identity) => resolve({ conn, identity, R: conn.reducers as any }))
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

let n = 0;
export const meta = (label: string) => ({ requestId: `${label}-${++n}-${Math.random().toString(36).slice(2, 5)}`, spawnedBy: 'raw-check' });
