// End-to-end check of the company config at start-up (#59) against a real module, through the real
// worker process: a valid file is stored once, a second start stores nothing, a changed file stores
// only what changed, a malformed file stops the worker before it connects, an unset variable keeps
// what is stored, and the action log names each change without embedding the JSON.
//
// It changes the stored company config, so it needs a scratch database that you publish yourself
// and name in NORN_DB (it will not run against the default `norn`). It can run more than once on the
// same database. It starts a few worker processes and stops each; do not run it next to a worker you
// care about on that database.
//   cd norn/module && spacetime publish -s local -p . norn-cfg -y
//   NORN_DB=norn-cfg npm run check:config      (from norn/)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'spacetimedb';
import { COMPANY_CONFIG_KEY, canonicalJson, configHash, loadConfigFile } from '../../config/src/index.ts';
import { COMPANY_CONFIG_ENV, applyStartupConfig, loadStartupConfig } from './config.ts';
import { DB, connect, subscribe, type Client } from './connect.ts';
import { TABLES, kit, recorder, rejects } from './testkit.ts';

if (!process.env.NORN_DB || DB === 'norn') {
  console.error('check:config changes the stored company config. Publish a scratch database and name it, for example: NORN_DB=norn-cfg npm run check:config');
  process.exit(2);
}

const { check, finish } = recorder();
const WORKERS = fileURLToPath(new URL('..', import.meta.url));
const BOWMAN = fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'norn-cfg-check-'));
const stamp = Date.now().toString(36);
console.log(`checking database '${DB}'`);

// ---- fixtures: the real example config, changed in ways that stay valid ---------------------------
const base = await loadConfigFile(BOWMAN);
if (!base.ok) throw new Error(`the example configuration is not valid: ${base.issues.map((i) => i.message).join('; ')}`);
const edited = (edit: (c: Record<string, any>) => void) => {
  const copy = JSON.parse(canonicalJson(base.config));
  edit(copy);
  return copy;
};
const write = (name: string, value: unknown) => {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
};
// v1 is unique to this run so that "stored once" holds on a database a previous run used.
const v1 = edited((c) => {
  c.company.name = `${c.company.name} (config check ${stamp})`;
  c.reviewDepth.deepReview.maxPasses = 2;
});
const v2 = edited((c) => {
  Object.assign(c, JSON.parse(canonicalJson(v1)));
  c.materiality.cutInSlipDays += 1;
  c.reviewDepth.deepReview.maxPasses = 3;
});
const malformed = edited((c) => {
  Object.assign(c, JSON.parse(canonicalJson(v1)));
  delete c.materiality;
  c.reviewDepth.deepReview.maxPasses = 0;
});
const [t1, t2] = [canonicalJson(v1), canonicalJson(v2)];
const files = { v1: write('v1.json', v1), v2: write('v2.json', v2), malformed: write('malformed.json', malformed) };
for (const [name, path] of Object.entries(files)) {
  const r = await loadConfigFile(path);
  if ((name === 'malformed') === r.ok) throw new Error(`fixture ${name} should be ${name === 'malformed' ? 'invalid' : 'valid'}`);
}
check('the fixtures are what the checks below assume: v1 and v2 pass the validator, the malformed one does not', true);

// ---- the real worker, as a process --------------------------------------------------------------
type Ran = { code: number | null; out: string; err: string };
/** Starts the worker with the variable set to `file` (or unset). Stops it once `waitFor` shows, or waits for it to exit by itself. */
function startWorker(label: string, file: string | undefined, waitFor?: RegExp): Promise<Ran> {
  const env: Record<string, string | undefined> = { ...process.env, WORKER_NAME: `cfgcheck-${label}`, NORN_DB: DB };
  env[COMPANY_CONFIG_ENV] = file;
  for (const k of ['NORN_ERP_SETTINGS', 'NORN_BASELINE_FILE', 'NORN_STAGES']) delete env[k];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd: WORKERS, env, windowsHide: true });
  let out = '';
  let err = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`worker '${label}' neither showed ${waitFor ?? 'an exit'} nor exited in 40 s.\nstdout: ${out}\nstderr: ${err}`));
    }, 40_000);
    child.stdout.on('data', (d) => {
      out += d;
      if (waitFor?.test(out)) child.kill();
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.on('error', reject);
  });
}

// ---- an observer on the database ------------------------------------------------------------------
const O = await connect({ kind: 'agent', name: 'check-config-observer', origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
await subscribe(O.conn, TABLES);
const { db, until, holds, logs } = kit(O);
const storedConfig = () => db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value;
const knob = (key: string) => db.nornConfig.key.find(key)?.value;
const lastLogId = () => logs(() => true).at(-1)?.id ?? 0n;
const setConfigRows = (after: bigint) => logs((l) => l.id > after && l.reducer === 'set_config' && l.outcome === 'applied');
const anyRows = (after: bigint) => logs((l) => l.id > after);
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms)); // let late rows reach the observer's cache

try {
  // A. a valid file is stored, once
  const a0 = lastLogId();
  const a = await startWorker('a', files.v1, /company config .*(stored|already stored)/);
  await until(() => storedConfig() === t1, 5000, 'the config in norn_config');
  await settle();
  const aRows = setConfigRows(a0);
  const aCfg = aRows.filter((l) => l.entity === `norn_config:${COMPANY_CONFIG_KEY}`);
  check('a valid file is stored at start-up: norn_config holds the canonical JSON the loader makes', storedConfig() === t1, `${t1.length} characters, hash ${configHash(t1)}`);
  check('...in exactly one set_config call for company_config, and the worker says what it stored', aCfg.length === 1 && aRows.every((l) => l.entity.startsWith('norn_config:')) && /stored company_config \S+ -> /.test(a.out), a.out.split('\n').find((l) => l.includes('company config')) ?? a.out);
  check('...the knobs from the config\'s review depth match it (deep_review_mode on_request, deep_review_limit 2)', knob('deep_review_mode') === 'on_request' && knob('deep_review_limit') === '2', `${knob('deep_review_mode')}, ${knob('deep_review_limit')}`);
  const first = aCfg[0]!;
  check('the action-log summary names the change by hash and size, and holds neither JSON text', first.summary.startsWith('company_config: ') && first.summary.includes(`-> ${configHash(t1)} (`) && first.summary.length < 400 && !first.summary.includes(t1.slice(0, 100)) && !first.detailJson.includes(t1.slice(0, 100)) && first.detailJson.length < 1000, `${first.summary.length} chars: ${first.summary}`);
  check('...and the row names who stored it: the worker, as Norn', first.actorName === 'cfgcheck-a' && first.actorKind === 'agent' && first.actorOrigin === 'norn' && first.spawnedBy === 'Norn', `${first.actorName}/${first.actorKind}/${first.actorOrigin}, spawned by ${first.spawnedBy}`);

  // B. a second start with the same file stores nothing
  const b0 = lastLogId();
  const b = await startWorker('b', files.v1, /company config .*(stored|already stored)/);
  await settle();
  check('starting again with the same file stores nothing: the worker says so and no set_config row is written', /already stored, nothing to change/.test(b.out) && setConfigRows(b0).length === 0 && storedConfig() === t1, b.out.split('\n').find((l) => l.includes('company config')) ?? b.out);

  // C. a changed file stores only what changed
  const c0 = lastLogId();
  const c = await startWorker('c', files.v2, /company config .*(stored|already stored)/);
  await until(() => storedConfig() === t2 && knob('deep_review_limit') === '3', 5000, 'the changed config');
  await settle();
  const cRows = setConfigRows(c0);
  const cCfg = cRows.find((l) => l.entity === `norn_config:${COMPANY_CONFIG_KEY}`);
  check('a changed file stores the config and the one knob that changed (deep_review_limit 2 -> 3), and not deep_review_mode', cRows.length === 2 && cRows.some((l) => l.entity === 'norn_config:deep_review_limit' && l.summary === 'deep_review_limit: 2 -> 3') && knob('deep_review_mode') === 'on_request', cRows.map((l) => l.entity).join(', '));
  check('the summary names the old and new hash and the top-level sections that changed (materiality, reviewDepth)', cCfg !== undefined && cCfg.summary.startsWith(`company_config: ${configHash(t1)} -> ${configHash(t2)} (`) && /; changed: materiality, reviewDepth; re-checked \d+ open ECR\(s\)$/.test(cCfg.summary), cCfg?.summary);
  check('...without embedding the old or the new JSON (about 20 KB each) in the summary or the detail', cCfg !== undefined && cCfg.summary.length < 400 && cCfg.detailJson.length < 1000 && ![t1, t2].some((t) => cCfg.summary.includes(t.slice(0, 100)) || cCfg.detailJson.includes(t.slice(0, 100))), `summary ${cCfg?.summary.length} chars, detail ${cCfg?.detailJson.length} chars, config ${t2.length} chars`);
  check('...and the worker reported the same hashes', c.out.includes(`company_config ${configHash(t1)} -> ${configHash(t2)}`) && c.out.includes('deep_review_limit 2 -> 3'), c.out.split('\n').find((l) => l.includes('company config')) ?? c.out);

  // D. a malformed file stops the worker before it connects
  const d0 = lastLogId();
  const d = await startWorker('d', files.malformed);
  await settle();
  check('a malformed file stops the worker with exit code 1', d.code === 1, `exit ${d.code}`);
  check('...printing the validator\'s problems, one per line, and saying Norn did not start', d.err.includes('2 problems') && d.err.includes('materiality: required section, but missing') && d.err.includes('reviewDepth.deepReview.maxPasses') && d.err.includes('Norn did not start'), d.err.trim().split('\n').join(' | '));
  check('...before it connected: no "connected" line, and not one new row in the action log (not even register_actor)', !d.out.includes('connected as') && anyRows(d0).length === 0, `${anyRows(d0).length} new rows`);
  check('...and the stored config is untouched', storedConfig() === t2);
  const missing = await startWorker('d2', join(dir, 'does-not-exist.json'));
  check('a file that does not exist stops the worker too, naming the path', missing.code === 1 && missing.err.includes('does-not-exist.json') && missing.err.includes('no such file'), missing.err.trim().split('\n')[0]);

  // E. no variable: warn, keep what is stored
  const e0 = lastLogId();
  const e = await startWorker('e', undefined, /WARNING: NORN_COMPANY_CONFIG is not set/);
  await settle();
  check('with the variable unset the worker warns, names the stored config, and changes nothing', e.out.includes(`WARNING: NORN_COMPANY_CONFIG is not set; keeping the stored company config (${configHash(t2)}`) && setConfigRows(e0).length === 0 && storedConfig() === t2, e.out.split('\n').find((l) => l.includes('WARNING')) ?? e.out);

  // F. the module's own checks, for a caller that skips the loader
  const before = lastLogId();
  const refusals: [string, string, RegExp][] = [
    ['text that is not JSON', '{"schemaVersion":1', /not valid JSON/],
    ['JSON that is not an object', '[1,2]', /JSON object/],
    ['an object with no schemaVersion', '{"a":1}', /no schemaVersion/],
    ['JSON that is not canonical', JSON.stringify(v2, null, 2), /canonical JSON/],
    ['more than 256 KB', canonicalJson({ pad: 'x'.repeat(262_200), schemaVersion: 1 }), /over the limit/],
    ['an empty value', '', /empty/],
  ];
  for (const [what, value, pattern] of refusals) {
    const r = await rejects(O.R.setConfig({ key: COMPANY_CONFIG_KEY, value }));
    check(`the module refuses company_config given as ${what}`, r?.name === 'SenderError' && pattern.test(r.message), r?.message.slice(0, 140));
  }
  const unknown = await rejects(O.R.setConfig({ key: 'company_confg', value: '1' }));
  check('other unknown keys are still refused', unknown?.message.includes("unknown config key 'company_confg'") === true, unknown?.message);
  await settle();
  check('...and none of the refused calls changed the stored config or wrote a set_config row', storedConfig() === t2 && setConfigRows(before).length === 0);
  await O.R.setConfig({ key: COMPANY_CONFIG_KEY, value: t2 });
  await settle();
  check('storing the text that is already stored through set_config is a no-op that writes no row', setConfigRows(before).length === 0);

  // G. leave the scratch database on v1 again (deep_review_limit back to 2)
  await startWorker('g', files.v1, /company config .*(stored|already stored)/);
  check('a start with the earlier file puts the earlier config and deep_review_limit 2 back', await holds(() => storedConfig() === t1 && knob('deep_review_limit') === '2', 5000));

  // H. a call the policy gate denies resolves normally; start-up must not report it as stored
  const scoped = await connect({ kind: 'agent', name: `cfgcheck-scoped-${stamp}`, origin: 'norn', spawnedBy: 'Norn' }, { persistToken: false, quiet: true });
  try {
    await subscribe(scoped.conn, ['SELECT * FROM norn_config']);
    await scoped.R.grantScope({ jobId: `cfgcheck-${stamp}`, anyEcr: false, prIds: [], maxLevel: 0, expiresAt: Timestamp.fromDate(new Date(Date.now() + 3_600_000)) });
    const h0 = lastLogId();
    const startup = await loadStartupConfig({ [COMPANY_CONFIG_ENV]: files.v2 });
    if (startup.kind !== 'loaded') throw new Error('the v2 fixture should load');
    const lines: string[] = [];
    const outcome = await applyStartupConfig(scoped as unknown as Client, startup, (m) => lines.push(m), { timeoutMs: 2000 }).then(() => null, (e: Error) => e);
    await settle();
    const denial = logs((l) => l.id > h0 && l.reducer === 'set_config')[0];
    check("a worker whose set_config the policy gate denies (job scope) fails start-up with the gate's reason and logs no success", outcome !== null && /set_config was denied for company_config: .*job cfgcheck-/.test(outcome.message) && lines.length === 0, outcome?.message ?? `no error; log: ${lines.join(' | ')}`);
    check('...the action log holds the denial, and nothing was stored', denial?.outcome === 'denied' && storedConfig() === t1, `${denial?.outcome}: ${denial?.summary}`);
  } finally {
    scoped.close();
  }
} finally {
  O.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(finish() ? 0 : 1);
