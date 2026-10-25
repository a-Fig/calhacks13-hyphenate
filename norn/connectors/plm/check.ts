// Checks the PLM connector against the live PLM, as the integration user in the environment, and prints one
// pass/fail line per check. Exits 1 on any failure.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON norn/connectors/plm/check.ts --config <settings.ts>
//
// 1. Every ECR in the reference dataset is read and compared with it, field by field.
// 2. A signed webhook round trip against a local receiver, with the real secret (nothing is sent to the PLM).
// 3. The poller's latency: Administrator files a throwaway ECR, submits it and edits it; the poller (as the
//    integration user) reports each change; the throwaway is deleted and the naming series put back.
// 4. The integration user writes the impact fields on the demo ECR, reads them back and clears them again.
//
// --reference  a dataset file to compare with instead of plmCheck.reference (used for a negative control).
// --read-only  stop after the reads and the webhook round trip: nothing is written to the PLM.
// --config  a module exporting `plm` (PlmSettings) and `plmCheck`: { reference: dataset path relative to the
//           repo root, demoEcr, throwaway: { doc, submitAction, seriesPrefix } }.
// Needs PLM_URL, PLM_API_KEY, PLM_API_SECRET, PLM_WEBHOOK_SECRET and PLM_ADMIN_PASSWORD in the environment or in
// ENV_FILE (default: the .env at the repo root). Never prints a secret.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChangeRequest } from '../../checks/src/types.ts';
import { PlmClient, enc } from './src/client.ts';
import type { EcrListing, EcrRecord, PlmDoc, PlmOptions, PlmSettings, ReadResult, WebhookEvent } from './src/index.ts';
import {
  IMPACT_FIELDS, connectionFromEnv, createWebhookHandler, inputsHash, loadEnvFile, mapEcr, postComment, readChangeRequest, watchEcrs, webhookSecretFromEnv, writeImpact,
} from './src/index.ts';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const configFile = arg('config');
if (!configFile) { console.error('usage: node check.ts --config <settings module>'); process.exit(2); }
const mod = await import(pathToFileURL(resolve(configFile)).href);
const settings: PlmSettings = mod.plm;
const spec: {
  reference: string; demoEcr: string;
  throwaway: { doc: Record<string, any>; submitAction: string; seriesPrefix: string };
} = mod.plmCheck;
if (!settings || !spec) { console.error('the config module must export `plm` and `plmCheck`'); process.exit(2); }

const root = resolve(import.meta.dirname, '../../..');
const ref = JSON.parse(readFileSync(arg('reference') ?? resolve(root, spec.reference), 'utf8'));

loadEnvFile();
const opts: PlmOptions = { ...settings, ...connectionFromEnv() };

let failed = 0;
let total = 0;
function check(ok: boolean, what: string, detail = '') {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (n: number) => `${Math.round(n)} ms`;

/** Paths where `got` differs from `want`. Missing and extra keys count; undefined and absent are the same. */
function diff(want: any, got: any, path: string, out: string[] = []): string[] {
  if (Array.isArray(want) || Array.isArray(got)) {
    if (!Array.isArray(want) || !Array.isArray(got)) { out.push(`${path}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`); return out; }
    if (want.length !== got.length) out.push(`${path}: ${got.length} rows vs ${want.length}`);
    for (let i = 0; i < Math.min(want.length, got.length); i++) diff(want[i], got[i], `${path}[${i}]`, out);
    return out;
  }
  if (want && got && typeof want === 'object' && typeof got === 'object') {
    for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) diff(want[k], got[k], `${path}.${k}`, out);
    return out;
  }
  if (want !== got) out.push(`${path}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
  return out;
}
const same = (what: string, n: number, diffs: string[]) => check(diffs.length === 0, `${what}: ${n - new Set(diffs.map((d) => d.split(/[.[:]/)[0])).size} of ${n} ECRs match`, diffs.slice(0, 4).join('; '));

// ---------------------------------------------------------------- the dataset's side

const supplierName = new Map<string, string>(ref.suppliers.map((s: any) => [s.id, s.name]));
const person = new Map<string, any>(ref.people.map((p: any) => [p.id, p]));
const STATE: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', in_review: 'In CM Review' };

/** The dataset's ECR as the checks read it: the same fields as ChangeRequest, with the supplier's name as its id. */
function expectedChange(e: any): ChangeRequest {
  return JSON.parse(JSON.stringify({
    id: e.id, program: e.program, filedOn: e.filedOn,
    itemChanges: e.itemChanges, bomChanges: e.bomChanges,
    supplierQuotes: e.supplierQuotes.map((q: any) => ({ id: q.id, supplier: supplierName.get(q.supplier) ?? q.supplier, item: q.item, lines: q.lines, leadTimeWeeks: q.leadTimeWeeks, note: q.note })),
    effectivity: e.effectivity, inventoryProposal: e.inventoryProposal, costPage: e.costPage,
  }));
}

/** The record fields the dataset also holds. */
function expectedRecord(e: any): Partial<EcrRecord> {
  return JSON.parse(JSON.stringify({
    id: e.id, title: e.title, workflowState: STATE[e.status], originator: person.get(e.originator)?.email,
    priority: e.priority, companyClass: e.companyClass, faaClass: e.faaClass, justificationCode: e.justificationCode,
    ecpRevision: e.rev, originatingNcr: e.originatingNcr,
    routedTo: e.routedTo,
    dates: { filedOn: e.filedOn, neededBy: e.neededBy },
    text: {
      description: e.description, need: e.need, consequencesIfDisapproved: e.consequencesIfDisapproved, alternativesConsidered: e.alternativesConsidered,
      failureData: e.failureData, testAndQualification: e.testAndQualification, faaRationale: e.faaRationale, classificationNote: e.classificationNote,
    },
    quotes: e.supplierQuotes.map((q: any) => ({ id: q.id, receivedOn: q.receivedOn, validUntil: q.validUntil })),
  }));
}

// ---------------------------------------------------------------- 1. read every ECR and compare

console.log('1. Read every ECR in the dataset and compare it with the dataset');
const listing = await new PlmClient(opts).list('ECR', { fields: ['name', 'workflow_state'], orderBy: 'name asc' });
const inPlm = new Map(listing.map((r) => [String(r.name), String(r.workflow_state)]));
const OPEN = new Set(['Draft', 'Submitted', 'In CM Review', 'CCB Review', 'Sent Back']);
const openInPlm = listing.filter((r) => OPEN.has(String(r.workflow_state))).map((r) => String(r.name));
const refIds: string[] = ref.ecrs.map((e: any) => e.id);
check(refIds.every((id) => inPlm.has(id)), `all ${refIds.length} dataset ECRs are in the PLM`, refIds.filter((id) => !inPlm.has(id)).join(', '));
const extra = openInPlm.filter((id) => !refIds.includes(id));
console.log(`info ${openInPlm.length} open ECRs in the PLM, ${extra.length} not in the dataset${extra.length ? `: ${extra.join(', ')}` : ''}`);

const t0 = performance.now();
const reads = new Map<string, Awaited<ReturnType<typeof readChangeRequest>>>();
for (let i = 0; i < refIds.length; i += 5) {
  await Promise.all(refIds.slice(i, i + 5).filter((id) => inPlm.has(id)).map(async (id) => { reads.set(id, await readChangeRequest(opts, id)); }));
}
console.log(`info read ${reads.size} ECRs in ${ms(performance.now() - t0)} (2 requests each, 5 at a time)`);

const sections: [string, (c: any) => any][] = [
  ['identity (id, program, filed on)', (c) => ({ id: c.id, program: c.program, filedOn: c.filedOn })],
  ['item changes (item, op, revisions, field redlines)', (c) => c.itemChanges],
  ['BOM changes', (c) => c.bomChanges],
  // Firmness is not in the dataset (the PLM derives it from the note); it has its own check below.
  ['supplier quotes (id, supplier, item, lines, lead time, note)', (c) => c.supplierQuotes.map(({ firmness, ...q }: any) => q)],
  ['effectivity (production, retrofit, interchangeable)', (c) => c.effectivity],
  ['inventory proposal', (c) => c.inventoryProposal],
  ['cost page (4 blocks, rows in order)', (c) => c.costPage],
];
const stripIds = (c: any) => ({ ...c, costPage: Object.fromEntries(Object.entries(c.costPage).map(([b, rows]) => [b, (rows as any[]).map(({ id: _id, ...r }) => r)])) });
for (const [what, pick] of sections) {
  const diffs: string[] = [];
  for (const e of ref.ecrs) {
    const got = reads.get(e.id);
    if (!got) { diffs.push(`${e.id}: not read`); continue; }
    diff(pick(expectedChange(e)), pick(stripIds(got.change)), e.id, diffs);
  }
  same(what, ref.ecrs.length, diffs);
}
{
  const diffs: string[] = [];
  for (const e of ref.ecrs) {
    const got = reads.get(e.id);
    if (!got) continue;
    const r = got.record as any;
    const mine = { ...r, routedTo: r.routedTo, dates: { filedOn: r.dates.filedOn, neededBy: r.dates.neededBy } };
    diff(expectedRecord(e), Object.fromEntries(Object.keys(expectedRecord(e)).map((k) => [k, mine[k]])), e.id, diffs);
  }
  same('record (title, state, originator, priority, classes, justification, NCR, dates, prose, routing, quote dates)', ref.ecrs.length, diffs);
}
{
  const bad: string[] = [];
  let rowsSeen = 0;
  for (const [id, r] of reads) {
    const ids = Object.values(r.change.costPage).flat().map((row) => row.id);
    rowsSeen += ids.length;
    if (ids.some((x) => !x) || new Set(ids).size !== ids.length) bad.push(id);
  }
  check(bad.length === 0, `cost-page row ids: ${rowsSeen} rows, each has the PLM's row name and no two in an ECR share one`, bad.join(', '));
}
{
  const bad = [...reads].filter(([, r]) => r.change.eco !== undefined || r.record.eco !== undefined).map(([id]) => id);
  check(bad.length === 0, 'open ECRs have no ECO', bad.join(', '));
  // Firmness: the dataset marks a quote budgetary only in its note ("Budgetary, plus or minus 20%"), which is what the PLM was seeded from.
  const wrong: string[] = [];
  let quotesSeen = 0;
  for (const e of ref.ecrs) {
    const got = reads.get(e.id)?.change.supplierQuotes ?? [];
    for (const q of e.supplierQuotes) {
      quotesSeen++;
      const want = /^budgetary/i.test(q.note ?? '') ? 'budgetary' : 'firm';
      const have = got.find((x) => x.id === q.id)?.firmness;
      if (have !== want) wrong.push(`${e.id} ${q.id}: ${have} not ${want}`);
    }
  }
  check(wrong.length === 0 && quotesSeen > 0, `quote firmness: all ${quotesSeen} quotes carry it, ECR-0409's is budgetary`, wrong.join('; '));
  const warned = [...reads].filter(([, r]) => r.record.warnings.length).map(([id, r]) => `${id}: ${r.record.warnings.join('; ')}`);
  check(warned.length === 0, 'nothing in the PLM data went unplaced (record.warnings is empty)', warned.join('; '));
}
{
  const a = await readChangeRequest(opts, spec.demoEcr);
  const b = await readChangeRequest(opts, spec.demoEcr);
  check(JSON.stringify(a.change) === JSON.stringify(b.change), `${spec.demoEcr} reads the same twice, row ids included`);
}
{
  // An approved ECR carries its ECO through the PLM's released_eco link: each of the dataset's released ECOs is on its ECR.
  const wrongEco: string[] = [];
  for (const h of ref.history) {
    if (!inPlm.has(h.ecr)) { wrongEco.push(`${h.ecr} missing`); continue; }
    const got = await readChangeRequest(opts, h.ecr);
    if (got.change.eco !== h.id || got.record.eco !== h.id || !got.record.ecoReleasedOn) wrongEco.push(`${h.ecr}: ${got.change.eco} not ${h.id}`);
  }
  check(wrongEco.length === 0 && ref.history.length > 0, `approved ECRs carry their ECO: ${ref.history.length} of ${ref.history.length} released ECOs found through released_eco`, wrongEco.join('; '));
}

// ---------------------------------------------------------------- 2. webhook round trip

console.log('2. A signed webhook, against a local receiver');
{
  const secret = webhookSecretFromEnv();
  const client = new PlmClient(opts);
  const doc = (await client.get<{ data: PlmDoc }>(`/api/resource/ECR/${enc(spec.demoEcr)}`)).data;
  const body = JSON.stringify({ event: 'ecr.updated', doctype: 'ECR', name: doc.name, modified: doc.modified, modified_by: doc.modified_by, workflow_state: doc.workflow_state, doc });
  const got: { event: WebhookEvent; current?: ReadResult }[] = [];
  const server = createServer(createWebhookHandler(secret, (event, current) => { got.push({ event, current }); }, { plm: opts, onError: () => {} }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const sign = (b: string, s = secret) => createHmac('sha256', s).update(b).digest('base64');
  const post = async (b: string, headers: Record<string, string>) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: b })).status;
  try {
    const ev = settings.webhook?.eventHeader ?? 'X-Event';
    const good = await post(body, { 'X-Frappe-Webhook-Signature': sign(body), [ev]: 'ecr.updated' });
    check(good === 200 && got.length === 1 && got[0].event.name === spec.demoEcr, 'a correctly signed ecr.updated is accepted', `${good}`);
    check((await post(body, { [ev]: 'ecr.updated' })) === 401, 'no signature: 401');
    check((await post(body, { 'X-Frappe-Webhook-Signature': sign(body, 'not the secret'), [ev]: 'ecr.updated' })) === 401, 'signed with another secret: 401');
    const tampered = body.replace('"ecr.updated"', '"ecr.inserted"');
    check((await post(tampered, { 'X-Frappe-Webhook-Signature': sign(body), [ev]: 'ecr.inserted' })) === 401, 'body changed after signing: 401');
    check((await post(body, { 'X-Frappe-Webhook-Signature': sign(body), [ev]: 'eco.released' })) === 400, 'event header that disagrees with the signed body: 400');
    check(got.length === 1, 'only the good request reached the handler');
    if (got[0]) {
      const viaHook = mapEcr(opts, got[0].event.doc).change;
      const viaRest = (await readChangeRequest(opts, spec.demoEcr)).change;
      check(JSON.stringify(viaHook) === JSON.stringify(viaRest), 'the webhook body maps to the same ChangeRequest as the REST read');
      check(JSON.stringify(got[0].current?.change) === JSON.stringify(viaRest), 'the handler passes the request it read from the PLM by name');
    }
    // Replay: a body that was true once (an old stamp, a stale title and cost) signed with the real secret.
    const stale = JSON.stringify({ ...JSON.parse(body), modified: '2020-01-01 00:00:00.000000', doc: { ...doc, modified: '2020-01-01 00:00:00.000000', title: 'STALE TITLE FROM A REPLAYED REQUEST' } });
    const server2 = createServer(createWebhookHandler(secret, (event, current) => { got.push({ event, current }); }, { plm: opts, onError: () => {} }));
    await new Promise<void>((r) => server2.listen(0, '127.0.0.1', r));
    try {
      const n = got.length;
      const replayed = (await fetch(`http://127.0.0.1:${(server2.address() as AddressInfo).port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Frappe-Webhook-Signature': sign(stale), [ev]: 'ecr.updated' }, body: stale })).status;
      const seen = got[n];
      check(replayed === 200 && !!seen && seen.event.doc.title === 'STALE TITLE FROM A REPLAYED REQUEST' && seen.current?.record.title === doc.title, 'a replayed old body is delivered with the live request alongside, which has the live title');
    } finally {
      await new Promise((r) => server2.close(r));
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
}

if (process.argv.includes('--read-only')) {
  console.log(failed ? `
${failed} of ${total} checks FAILED (read-only run: no writes to the PLM)` : `
All ${total} checks passed (read-only run: no writes to the PLM)`);
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------- admin session (throwaway ECR only)

/** Administrator's cookie session, used only to file, edit and delete the throwaway ECR and restore its naming series. */
class Admin {
  #cookie = '';
  #csrf = '';
  base: string;
  constructor(base: string) { this.base = base; }
  async login(password: string) {
    const r = await fetch(`${this.base}/api/method/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usr: 'Administrator', pwd: password }) });
    if (!r.ok) throw new Error(`Administrator login failed: ${r.status}`);
    this.#cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const html = await (await fetch(`${this.base}/desk`, { headers: { Cookie: this.#cookie } })).text();
    this.#csrf = html.match(/csrf_token\s*=\s*"([^"]+)"/)?.[1] ?? '';
  }
  async req(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}): Promise<any> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const r = await fetch(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: this.#cookie, 'X-Frappe-CSRF-Token': this.#csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    let j: any; try { j = JSON.parse(t); } catch { j = {}; }
    if (!r.ok) throw new Error(`${method} ${decodeURIComponent(url.pathname)} -> ${r.status} ${j.exc_type ?? ''}`);
    return j;
  }
  /** Make the next document in a naming series come out as `${prefix}${next}`. */
  async setSeries(prefix: string, next: number) {
    const cur = (await this.req('GET', '/api/resource/Document Naming Settings/Document Naming Settings')).data;
    await this.req('POST', '/api/method/run_doc_method', { docs: JSON.stringify({ ...cur, transaction_type: 'x', prefix, current_value: next - 1 }), method: 'update_series_start' });
  }
}

// ---------------------------------------------------------------- 3. the poller, against a throwaway ECR

console.log('3. The poller: Administrator files a throwaway ECR, submits and edits it');
const INTERVAL = 2000;
const latencies: { what: string; ms: number }[] = [];
{
  const admin = new Admin(opts.url.replace(/\/+$/, ''));
  await admin.login(process.env.PLM_ADMIN_PASSWORD ?? '');
  const events: (EcrListing & { at: number })[] = [];
  const watcher = watchEcrs(opts, (c) => { events.push({ ...c, at: performance.now() }); }, { intervalMs: INTERVAL });
  let name = '';
  let number = 0;
  try {
    await watcher.ready();
    try {
    const waitFor = async (pred: (e: EcrListing & { at: number }) => boolean, what: string, timeout = 20_000) => {
      const t = performance.now();
      while (performance.now() - t < timeout) { const hit = events.find(pred); if (hit) return hit; await sleep(10); }
      throw new Error(`the poller did not report: ${what}`);
    };
    const sample = (what: string, since: number, e: { at: number }) => { latencies.push({ what, ms: e.at - since }); console.log(`info ${what}: reported ${ms(e.at - since)} after the PLM answered`); };

    // file it
    await sleep(200 + Math.random() * INTERVAL);
    const created = (await admin.req('POST', '/api/resource/ECR', spec.throwaway.doc)).data;
    const tCreated = performance.now();
    name = created.name;
    number = Number(name.slice(spec.throwaway.seriesPrefix.length));
    sample('filed (Draft)', tCreated, await waitFor((e) => e.name === name, 'the new ECR'));

    // submit it: this is the event the demo waits for
    await sleep(200 + Math.random() * INTERVAL);
    const doc = (await admin.req('GET', `/api/resource/ECR/${enc(name)}`)).data;
    await admin.req('POST', '/api/method/frappe.model.workflow.apply_workflow', { doc: JSON.stringify(doc), action: spec.throwaway.submitAction });
    const tSubmitted = performance.now();
    const submitted = await waitFor((e) => e.name === name && e.workflowState === 'Submitted', 'the ECR in Submitted');
    sample('submitted', tSubmitted, submitted);
    const tRead = performance.now();
    const read = await readChangeRequest(opts, name);
    const readMs = performance.now() - tRead;
    check(read.record.workflowState === 'Submitted' && read.change.itemChanges.length === 1 && read.change.itemChanges[0].item === spec.throwaway.doc.affected_items[0].part, `the submitted ECR reads back with its affected item`, `read took ${ms(readMs)}; filed-to-ChangeRequest ${ms(submitted.at - tSubmitted + readMs)}`);

    // edit it a few more times, at random phases of the poll cycle
    for (let i = 1; i <= 6; i++) {
      await sleep(200 + Math.random() * INTERVAL);
      const put = (await admin.req('PUT', `/api/resource/ECR/${enc(name)}`, { title: `Connector latency probe ${i} (deleted after the test)` })).data;
      const t = performance.now();
      sample(`edit ${i}`, t, await waitFor((e) => e.name === name && e.modified === put.modified, `edit ${i}`));
    }

    // Norn's own writes are not reported
    const before = events.length;
    const w = await writeImpact(opts, name, { impact_report_level: '1', impact_recommendation: 'Approve', impact_change_class: 'Class II', impact_approval_route: 'Fast track', impact_statement: '<p>Probe; not a Fern result.</p>' });
    const c = await postComment(opts, name, '<p>Probe comment from the connector check; not a Fern result.</p>');
    await sleep(INTERVAL * 2 + 1500);
    const mine = events.slice(before).filter((e) => e.name === name);
    check(w.impact.impact_report_level === '1' && !!c.name && mine.length === 0, `Fern's own writes (impact fields, then a comment) were not reported`, `${mine.length} events after them`);
    const comment = (await admin.req('GET', '/api/resource/Comment', undefined, { fields: ['name', 'comment_email'], filters: [['reference_name', '=', name], ['comment_type', '=', 'Comment']] })).data;
    check(comment.length === 1 && comment[0].comment_email === settings.nornUser, 'the comment is on the ECR and is Fern\'s');

    // a person's edit right after Norn's write is reported
    const put = (await admin.req('PUT', `/api/resource/ECR/${enc(name)}`, { title: 'Connector latency probe 7 (deleted after the test)' })).data;
    const t = performance.now();
    sample('edit after Fern\'s write', t, await waitFor((e) => e.name === name && e.modified === put.modified, 'the edit after Fern\'s write'));
    } catch (e) {
      check(false, 'the throwaway ECR test stopped', e instanceof Error ? e.message : String(e));
    }

    // ---- 4. the demo ECR: write the impact fields, read them back, clear them
    console.log(`4. ${spec.demoEcr}: write the impact fields as Fern, read them back, clear them`);
    const demoBefore = events.filter((e) => e.name === spec.demoEcr).length;
    const baseline = await readChangeRequest(opts, spec.demoEcr);
    check(Object.keys(baseline.record.impact).length === 0, `${spec.demoEcr} starts with no impact assessment`);
    const wrote = {
      impact_report_level: '1', impact_recommendation: 'Approve with conditions', impact_change_class: 'Class I', impact_approval_route: 'CCB, 2026-11-12',
      impact_norn_url: 'https://example.com/norn/connector-check',
      impact_statement: '<p><b>Connector check: not a Fern assessment.</b></p><table class="table"><tr><td>x</td></tr></table>',
    };
    let cleared = false;
    let afterWrite = demoBefore;
    try {
      const rej = await (async () => {
        let calls = 0;
        const real = globalThis.fetch;
        globalThis.fetch = ((...a: Parameters<typeof fetch>) => { calls++; return real(...a); }) as typeof fetch;
        try { await writeImpact(opts, spec.demoEcr, { ...wrote, description: 'edited by Fern' } as any); return { threw: false, calls }; } catch { return { threw: true, calls }; } finally { globalThis.fetch = real; }
      })();
      check(rej.threw && rej.calls === 0, 'a write that names a field outside the seven is refused before any request');
      const res = await writeImpact(opts, spec.demoEcr, wrote);
      const back = await readChangeRequest(opts, spec.demoEcr);
      const fieldsBack = IMPACT_FIELDS.filter((f) => back.record.impact[f] !== undefined);
      const exact = Object.entries(wrote).filter(([k]) => k !== 'impact_statement').every(([k, v]) => (back.record.impact as any)[k] === v);
      check(exact && !!back.record.impact.impact_updated_on && !!back.record.impact.impact_statement?.includes('<table'), 'the impact fields read back as written, the PLM stamped impact_updated_on and kept the table', `${fieldsBack.length} of 7 fields set`);
      check(res.impact.impact_report_level === '1' && JSON.stringify(res.impact) === JSON.stringify(back.record.impact), 'writeImpact returns what was stored');
      check(JSON.stringify(back.change) === JSON.stringify(baseline.change), `nothing else on ${spec.demoEcr} changed (the whole ChangeRequest is identical)`);
      check(JSON.stringify({ ...back.record, impact: 0, dates: 0, modifiedBy: 0 }) === JSON.stringify({ ...baseline.record, impact: 0, dates: 0, modifiedBy: 0 }), `the record is identical apart from the impact fields and the modified stamp`);
      check(inputsHash(back) === inputsHash(baseline), `the assessment inputs fingerprint is the same with and without Fern's impact fields`);
      await sleep(INTERVAL * 2 + 500);
      afterWrite = events.filter((e) => e.name === spec.demoEcr).length;
    } finally {
      const nullAll = Object.fromEntries(IMPACT_FIELDS.map((f) => [f, null]));
      await writeImpact(opts, spec.demoEcr, nullAll);
      const after = await readChangeRequest(opts, spec.demoEcr);
      cleared = Object.keys(after.record.impact).length === 0 && JSON.stringify(after.change) === JSON.stringify(baseline.change);
      check(cleared, `${spec.demoEcr} is clean again: no impact field set, ChangeRequest unchanged`, JSON.stringify(after.record.impact).slice(0, 120));
    }
    await sleep(INTERVAL * 2 + 500);
    // The poller had not seen this ECR in this run, so it has no fingerprint to compare Norn's first write with and reports that once;
    // clearing the fields changes nothing an assessment is made from, and must not be reported.
    const demoNow = events.filter((e) => e.name === spec.demoEcr).length;
    check(afterWrite - demoBefore <= 1 && demoNow === afterWrite, `Fern's writes on ${spec.demoEcr}: the first sighting is reported at most once (${afterWrite - demoBefore}), clearing the fields is not`);
  } finally {
    await watcher.stop();
    // clean up the throwaway
    if (name) {
      try {
        for (const c of (await admin.req('GET', '/api/resource/Comment', undefined, { fields: ['name'], filters: [['reference_name', '=', name]], limit_page_length: 0 })).data) await admin.req('DELETE', `/api/resource/Comment/${enc(c.name)}`);
        await admin.req('DELETE', `/api/resource/ECR/${enc(name)}`);
        const left = (await admin.req('GET', '/api/resource/ECR', undefined, { fields: ['name'], limit_page_length: 0 })).data.map((r: any) => Number(String(r.name).slice(spec.throwaway.seriesPrefix.length)));
        const higher = left.filter((n: number) => n >= number);
        if (higher.length === 0) await admin.setSeries(spec.throwaway.seriesPrefix, number);
        console.log(`info throwaway ${name} deleted; ${higher.length === 0 ? `naming series put back (next ${spec.throwaway.seriesPrefix}${String(number).padStart(4, '0')})` : 'naming series left as it is, another ECR has taken a later number'}`);
      } catch (e) {
        console.log(`FAIL cleanup of ${name} failed: ${e instanceof Error ? e.message : e}`);
        failed++; total++;
      }
    }
  }
  const sorted = latencies.map((l) => l.ms).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
  check(sorted.length >= 8 && sorted[sorted.length - 1] < INTERVAL + 1500, `poller latency over ${sorted.length} changes at a ${INTERVAL} ms interval`, `min ${ms(sorted[0])}, median ${ms(median)}, max ${ms(sorted[sorted.length - 1])}`);
}

console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
process.exit(failed ? 1 : 0);
