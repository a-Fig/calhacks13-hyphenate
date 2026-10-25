// Verifies the PLM on the real path: REST calls as the Norn integration user, one of each kind,
// plus the webhook and the ECO release. Prints what it did; never prints a secret.
//
//   ENV_FILE=<repo>/.env node bowman/plm/verify.ts           run every check
//   ENV_FILE=<repo>/.env node bowman/plm/verify.ts --clear   remove the test impact assessment from ECR-0417
//
// The impact assessment it writes is labelled as a test posting, not a Norn result.
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plm, PlmError, enc, readEnv, sleep } from './client.ts';
import { IMPACT_FIELDS } from './model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../data/bowman.json'), 'utf8'));
const env = readEnv();
const base = env.PLM_URL || 'http://127.0.0.1:8082';
const norn = new Plm(base, { token: `${env.PLM_API_KEY}:${env.PLM_API_SECRET}` });
const admin = new Plm(base);
const log = (...a: unknown[]) => console.log(...a);
const show = (o: unknown, n = 600) => JSON.stringify(o).slice(0, n);
let failures = 0;
const check = (ok: boolean, what: string) => { log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };
// Every record and comment this run creates carries RUN, so cleanup can tell them from anyone else's: the six accounts
// it uses are shared, so an owner or a timestamp cannot.
const RUN = randomBytes(4).toString('hex');
const MARK = `[verify.ts run ${RUN}]`;

const mac = env.BOWMAN_PLM_SSH || env.BOWMAN_ERP_SSH;
const ssh = (cmd: string, input?: string) =>
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', mac, `export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; ${cmd}`], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });

const STATEMENT = `
<p><b>Test posting from bowman/plm/verify.ts. This is not a Norn assessment.</b></p>
<h4>Cost, Rev B to Rev C (sample numbers)</h4>
<table class="table table-bordered"><thead><tr><th>Item</th><th>Low</th><th>Likely</th><th>High</th></tr></thead>
<tbody><tr><td>Unit cost change</td><td>+$25</td><td><b>+$34.60</b></td><td>+$49</td></tr>
<tr><td>One-time cost</td><td>$97k</td><td>$111k</td><td>$140k</td></tr></tbody></table>
<ul><li>Single source: <span style="color:#b91c1c">Halden Precision</span></li><li>Cut-in: S/N 011</li></ul>
<p>See <a href="https://example.com/norn/ECR-0417">the full report</a>.</p>`;
const TAGS = ['<table', '<thead', '<h4', '<b>', '<ul', '<li>', 'color:#b91c1c', '<a href'];

async function clear() {
  await norn.put('/api/resource/ECR/ECR-0417', Object.fromEntries(IMPACT_FIELDS.map((k) => [k, null])));
  await admin.login('Administrator', env.PLM_ADMIN_PASSWORD);
  const test = await admin.list('Comment', { fields: ['name'], filters: [['reference_name', '=', 'ECR-0417'], ['content', 'like', '%from verify.ts%']] });
  for (const c of test) await admin.del(`/api/resource/Comment/${c.name}`);
  log(`Cleared the test impact assessment and ${test.length} test comment(s) on ECR-0417.`);
}

async function main() {
  if (process.argv.includes('--clear')) return clear();

  log('1. Read a Part with its BOM (as Norn)');
  const parent = data.bom.find((b: any) => b.child === 'BW-5120-210').parent;
  const part = (await norn.get(`/api/resource/Part/${enc(parent)}`)).body.data;
  const bom = (await norn.get(`/api/resource/${enc('Engineering BOM')}/${enc('EBOM-' + parent)}`)).body.data;
  log(`  GET /api/resource/Part/${parent} -> ${part.part_name}, rev ${part.revision}, ${part.lifecycle_state}`);
  log(`  GET /api/resource/Engineering BOM/EBOM-${parent} -> ${bom.line_count} lines; first: ${show(bom.lines[0], 160)}`);
  check(part.name === parent && bom.lines.length === bom.line_count && bom.lines.some((l: any) => l.part === 'BW-5120-210'), 'Part and its BOM read; the BOM lists BW-5120-210');
  const bracket = (await norn.get('/api/resource/Part/BW-5120-210')).body.data;
  check(bracket.revision_history.length === 2, 'BW-5120-210 revision history has 2 entries (A, B)');

  log('2. Read ECR-0417 with its affected items');
  const e = (await norn.get('/api/resource/ECR/ECR-0417')).body.data;
  log(`  GET /api/resource/ECR/ECR-0417 -> ${e.workflow_state}, ${e.priority}, ${e.company_class}/${e.faa_class}, originator ${e.originator}`);
  log(`  affected_items: ${show(e.affected_items.map((i: any) => ({ part: i.part, change_type: i.change_type, from: i.from_revision, to: i.to_revision })))}`);
  check(e.affected_items.length === 1 && e.affected_items[0].to_revision === 'C' && e.originating_ncr === 'NCR-0119', 'ECR-0417 affected item BW-5120-210 B -> C, NCR-0119');

  const lines = (await norn.get('/api/resource/Engineering BOM Line', { parent: 'Engineering BOM', fields: ['parent', 'seq', 'part', 'qty'], limit_page_length: 0 })).body.data;
  const got = lines.map((l: any) => `${l.parent}|${l.seq}|${l.part}|${l.qty}`).sort();
  const want = data.bom.map((l: any) => `EBOM-${l.parent}|${l.seq}|${l.child}|${l.qty}`).sort();
  const boms = await norn.list('Engineering BOM', { fields: ['name'] });
  log(`  Engineering BOM (EBOM): ${boms.length} assemblies, ${lines.length} lines in the PLM; ${new Set(data.bom.map((l: any) => l.parent)).size} assemblies, ${data.bom.length} lines in bowman/data`);
  check(got.length === want.length && got.every((x: string, i: number) => x === want[i]), "the PLM's EBOM equals bowman/data's bom, line for line (assembly, find number, part, quantity)");
  const q409 = (await norn.get('/api/resource/ECR/ECR-0409')).body.data.supplier_quotes;
  check(q409.length > 0 && q409.every((r: any) => r.firmness === 'Budgetary') && e.supplier_quotes.every((r: any) => r.firmness === 'Firm'), 'supplier quote firmness: ECR-0409 Budgetary, ECR-0417 Firm, read by Norn');

  log('3. Write its impact assessment (the only thing Norn may write)');
  const body = {
    impact_report_level: '1', impact_recommendation: 'Approve with conditions', impact_change_class: 'Class I',
    impact_approval_route: 'CCB, 2026-11-12', impact_norn_url: 'https://example.com/norn/ECR-0417', impact_statement: STATEMENT,
  };
  const put = await norn.put('/api/resource/ECR/ECR-0417', body);
  const after = (await norn.get('/api/resource/ECR/ECR-0417')).body.data;
  log(`  PUT /api/resource/ECR/ECR-0417 {${Object.keys(body).join(', ')}} -> ${put.status}`);
  log(`  stored: level ${after.impact_report_level}, "${after.impact_recommendation}", ${after.impact_change_class}, route "${after.impact_approval_route}", last updated ${after.impact_updated_on}`);
  const kept = TAGS.filter((t) => after.impact_statement.includes(t));
  log(`  HTML kept by Frappe's sanitiser: ${kept.join(' ')}; dropped: ${TAGS.filter((t) => !kept.includes(t)).join(' ') || 'none'}`);
  check(put.status === 200 && after.impact_report_level === '1' && !!after.impact_updated_on && after.impact_statement.includes('<table'), 'impact assessment stored, last-updated stamped, table kept');
  check(after.workflow_state === 'Submitted' && after.description === e.description, 'nothing else on the ECR changed');

  log('4. Norn cannot change anything else');
  const tries: [string, () => Promise<{ status: number; body: any }>][] = [
    ['PUT description', () => norn.put('/api/resource/ECR/ECR-0417', { description: 'edited by Norn' }, { allow: true })],
    ['PUT priority', () => norn.put('/api/resource/ECR/ECR-0417', { priority: 'Emergency' }, { allow: true })],
    ['PUT workflow_state to Approved', () => norn.put('/api/resource/ECR/ECR-0417', { workflow_state: 'Approved' }, { allow: true })],
    ['PUT a cost row', () => norn.put('/api/resource/ECR/ECR-0417', { cost_production: [{ label: 'x', basis: 'Not provided' }] }, { allow: true })],
    ['apply workflow action Approve', () => norn.post('/api/method/frappe.model.workflow.apply_workflow', { doc: JSON.stringify(after), action: 'Approve' }, { allow: true })],
    ['POST a new ECR', () => norn.post('/api/resource/ECR', { doctype: 'ECR', title: 'x', program: 'Vesper V4' }, { allow: true })],
    ['DELETE the ECR', () => norn.del('/api/resource/ECR/ECR-0417', { allow: true })],
    ['PUT a Part', () => norn.put('/api/resource/Part/BW-5120-210', { revision: 'Z' }, { allow: true })],
  ];
  for (const [what, fn] of tries) {
    const r = await fn();
    let msg = '';
    try { msg = JSON.parse(r.body._server_messages ?? '[]').map((m: string) => JSON.parse(m).message).join(' ').replace(/<[^>]+>/g, ''); } catch { /* none */ }
    log(`  ${what} -> ${r.status} ${r.body.exc_type ?? ''} ${msg.slice(0, 140)}`);
    check(r.status >= 400, `${what} refused`);
  }
  const still = (await norn.get('/api/resource/ECR/ECR-0417')).body.data;
  check(still.description === e.description && still.priority === e.priority && still.workflow_state === 'Submitted' && still.cost_production.length === e.cost_production.length, 'ECR-0417 unchanged after the refused writes');

  log('5. Norn adds a comment');
  const c = await norn.post('/api/resource/Comment', { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'ECR', reference_name: 'ECR-0417', content: `Test comment from verify.ts (not a Norn result). ${MARK}` }, { allow: true });
  log(`  POST /api/resource/Comment {comment_type: Comment, reference_doctype: ECR, reference_name: ECR-0417, content} -> ${c.status}`);
  check(c.status === 200, 'comment added by the Norn user');

  log('6. Webhook fires on an ECR update (throwaway receiver on the Mac)');
  await admin.login('Administrator', env.PLM_ADMIN_PASSWORD);
  ssh('mkdir -p ~/bowman/plm && cat > ~/bowman/plm/webhook-sink.mjs', readFileSync(resolve(here, 'webhook-sink.mjs'), 'utf8'));
  try { ssh('docker rm -f bowman-plm-webhook-sink'); } catch { /* none running */ }
  ssh('docker run -d --rm --name bowman-plm-webhook-sink --network bowman-plm_frappe_network --network-alias webhook-sink -v $HOME/bowman/plm/webhook-sink.mjs:/sink.mjs:ro node:24-bookworm-slim node /sink.mjs');
  const hooks = ['ncr.inserted', 'ncr.updated', 'ecr.inserted', 'ecr.updated'];
  const before: Record<string, any> = {};
  for (const h of hooks) {
    before[h] = (await admin.get(`/api/resource/Webhook/${enc(h)}`)).body.data;
    await admin.put(`/api/resource/Webhook/${enc(h)}`, { request_url: 'http://webhook-sink:9999/plm', enabled: 1 });
  }
  try {
    await sleep(1500);
    const dana = new Plm(base); await dana.login('dana.okafor@bowman-aviation.example', env.PLM_USER_PASSWORD);
    const cur = (await dana.get('/api/resource/ECR/ECR-0417')).body.data;
    // A real edit by a person: the CM analyst records the CCB meeting date for the ECR.
    await dana.put('/api/resource/ECR/ECR-0417', { ccb_meeting: '2026-11-12', modified: cur.modified });
    // Norn's own write must not echo back to Norn.
    await norn.put('/api/resource/ECR/ECR-0417', { impact_approval_route: 'CCB, 2026-11-12 meeting' });
    await sleep(6000);
    const lines = ssh('docker logs bowman-plm-webhook-sink').split('\n').filter((l) => l.startsWith('{"at"')).map((l) => JSON.parse(l));
    log(`  receiver got ${lines.length} request(s): ${lines.map((l) => l.headers['x-bowman-plm-event']).join(', ')}`);
    const hit = lines.find((l) => l.headers['x-bowman-plm-event'] === 'ecr.updated');
    if (hit) {
      const p = JSON.parse(hit.body);
      const sig = createHmac('sha256', env.PLM_WEBHOOK_SECRET).update(hit.body).digest('base64');
      log(`  POST ${hit.url} headers {content-type: ${hit.headers['content-type']}, x-bowman-plm-event: ${hit.headers['x-bowman-plm-event']}, x-frappe-webhook-signature: <${hit.headers['x-frappe-webhook-signature']?.length} chars>}`);
      log(`  body keys: ${Object.keys(p).join(', ')}; name ${p.name}, modified_by ${p.modified_by}, doc has ${Object.keys(p.doc).length} fields incl. ${['affected_items', 'cost_production', 'impact_statement'].filter((k) => k in p.doc).join(', ')}`);
      check(p.name === 'ECR-0417' && p.doctype === 'ECR' && sig === hit.headers['x-frappe-webhook-signature'], 'ecr.updated delivered with a valid HMAC signature');
      check(!('ccb_meeting' in p.doc) && !('decision_note' in p.doc), "the webhook's document leaves out the CCB's private fields (ccb_meeting, decision_note)");
    } else check(false, 'ecr.updated delivered');
    check(lines.filter((l) => l.headers['x-bowman-plm-event'] === 'ecr.updated').length === 1, "Norn's own write did not echo back (one ecr.updated, from the person's edit)");
    await dana.put('/api/resource/ECR/ECR-0417', { ccb_meeting: null }); // leave the demo record as found
  } finally {
    for (const h of hooks) await admin.put(`/api/resource/Webhook/${enc(h)}`, { request_url: before[h].request_url, enabled: before[h].enabled });
    try { ssh('docker rm -f bowman-plm-webhook-sink'); } catch { /* gone */ }
  }

  // Steps 7 to 12 make throwaway records. Each step lists what it made, in creation order, as soon as it exists, and its
  // finally block removes them. Only records carrying this run's mark are removed, plus the release bot's ECO for a
  // probe of this run's (made by the bot, after the probe, on that probe), and only the comments this run posted, by the
  // names their creates returned, are deleted. Anything else is left, and fails the step by name; so is a probe that
  // carries a comment or File this run did not make, since deleting the probe would take it along. A person's comment
  // can quote the mark, so it is never matched by text. A failed delete is not ignored either. The naming series are
  // never rewound here: Frappe winds a series back itself when the deleted record is the last in it, and a rewind of
  // ours could hand out a number someone filed meanwhile.
  type Made = [doctype: string, name: string][];
  const BOT = 'eco-release@bowman-aviation.example';
  const runUsers = new Set(['Administrator', 'norn@bowman-aviation.example', 'jeff.hargrove@bowman-aviation.example', 'dana.okafor@bowman-aviation.example', 'rafael.quintero@bowman-aviation.example', BOT]);
  const ownComments = new Set<string>(); // names returned by this run's own comment creates on its probes
  const reason = (e: unknown) => (e instanceof PlmError ? `HTTP ${e.status}` : String(e)).slice(0, 80);
  const marked = (dt: string, doc: any) => String((dt === 'NCR' ? doc.description : dt === 'File' ? doc.file_name : doc.title) ?? '').includes(RUN);
  const ours = async (dt: string, nm: string) => {
    const r = await admin.get(`/api/resource/${enc(dt)}/${enc(nm)}`, undefined, { allow: true });
    return r.status === 200 && marked(dt, r.body.data);
  };
  const removeProbes = async (made: Made) => {
    const left: string[] = [];
    const keep = new Set<string>(); // left in place: not this run's, or carrying something that is not
    const botEcos = new Set<string>();
    const comments: string[] = [];
    let system = 0;
    // `made` grows while this runs: the bot's ECOs are added, and checked in turn.
    for (let i = 0; i < made.length; i++) {
      const [dt, nm] = made[i];
      try {
        const r = await admin.get(`/api/resource/${enc(dt)}/${enc(nm)}`, undefined, { allow: true });
        if (r.status === 404) continue;
        if (r.status !== 200) throw new PlmError(r.status, 'GET', `/api/resource/${dt}/${nm}`, r.body);
        const doc = r.body.data;
        if (!botEcos.has(nm) && !marked(dt, doc)) { keep.add(`${dt} ${nm}`); left.push(`${dt} ${nm}, kept because it does not carry this run's mark`); continue; }
        const since = doc.creation as string; // the server's clock, comparable to the rows below
        const foreign: string[] = [];
        if (dt === 'ECR') {
          for (const x of await admin.list('ECO', { fields: ['name', 'owner', 'creation', 'title', 'ecr'], filters: [['ecr', '=', nm]] })) {
            if (made.some(([d, n]) => d === 'ECO' && n === x.name)) continue;
            if (marked('ECO', x)) made.push(['ECO', x.name]);
            else if (x.owner === BOT && x.creation >= since && x.ecr === nm) { botEcos.add(x.name); made.push(['ECO', x.name]); }
            else foreign.push(`ECO ${x.name} by ${x.owner}`);
          }
        }
        for (const c of await admin.list('Comment', { fields: ['name', 'owner', 'creation', 'comment_type'], filters: [['reference_doctype', '=', dt], ['reference_name', '=', nm]] })) {
          if (ownComments.has(c.name)) comments.push(c.name);
          // Frappe's log line for a workflow step this run took on its probe (steps 7 and 9; the only type they write,
          // read on the live PLM 2026-10-24). Frappe removes it in a job after the probe is deleted.
          else if (c.comment_type === 'Workflow' && runUsers.has(c.owner) && c.creation >= since) system++;
          else foreign.push(`Comment ${c.name} (${c.comment_type}) by ${c.owner}`);
        }
        // Deleting a record deletes the Files attached to it, so a File this run did not make keeps the probe.
        for (const f of await admin.list('File', { fields: ['name', 'owner'], filters: [['attached_to_doctype', '=', dt], ['attached_to_name', '=', nm]] }))
          if (!made.some(([d, n]) => d === 'File' && n === f.name)) foreign.push(`File ${f.name} by ${f.owner}`);
        if (foreign.length) { keep.add(`${dt} ${nm}`); left.push(`${dt} ${nm}, kept because it carries records this run did not make: ${foreign.join(', ')}`); }
      } catch (e) { keep.add(`${dt} ${nm}`); left.push(`${dt} ${nm} (${reason(e)})`); }
    }
    if (system) log(`  ${system} log comment(s) Frappe wrote for this run's actions go with their probes`);
    const removable = new Set(made.map(([d, n]) => `${d} ${n}`).filter((k) => !keep.has(k)));
    try {
      for (const name of comments) await admin.del(`/api/resource/Comment/${enc(name)}`);
      // An ECO cannot be deleted while an ECR links to it. Only a link to an ECO this run removes is cleared.
      for (const [, nm] of made.filter(([d]) => d === 'ECR')) {
        if (!removable.has(`ECR ${nm}`)) continue;
        const r = await admin.get(`/api/resource/ECR/${enc(nm)}`, undefined, { allow: true });
        const eco = r.status === 200 ? r.body.data.released_eco : undefined;
        if (eco && removable.has(`ECO ${eco}`)) await admin.put(`/api/resource/ECR/${enc(nm)}`, { released_eco: null });
      }
    } catch (e) { left.push(`comments or ECO links on this step's probes (${reason(e)})`); }
    for (const [dt, nm] of [...made].reverse()) {
      if (!removable.has(`${dt} ${nm}`)) continue;
      try {
        if (!(await admin.exists(dt, nm))) continue;
        await admin.del(`/api/resource/${enc(dt)}/${enc(nm)}`, { allow: true });
        if (await admin.exists(dt, nm)) left.push(`${dt} ${nm}`);
      } catch (e) { left.push(`${dt} ${nm} (${reason(e)})`); }
    }
    return left;
  };
  const probeCleanup = async (made: Made) => {
    const left = await removeProbes(made);
    check(left.length === 0, left.length ? `probe records left behind, remove by hand: ${left.join('; ')}` : `probe records removed (${made.map(([, n]) => n).join(', ') || 'none made'})`);
  };
  const probeEcr = (title: string, extra: object = {}) => admin.post('/api/resource/ECR', { doctype: 'ECR', title: `${title} ${MARK}`, program: 'Vesper V4', priority: 'Routine', justification_code: 'D', company_class: 'Class I', faa_class: 'Minor', description: 'probe', need: 'probe', ...extra });
  const refusal = (r: { status: number; body: any }) => {
    let msg = '';
    try { msg = JSON.parse(r.body._server_messages ?? '[]').map((m: string) => JSON.parse(m).message).join(' ').replace(/<[^>]+>/g, ''); } catch { /* none */ }
    return `${r.status} ${r.body.exc_type ?? ''} ${msg.slice(0, 110)}`;
  };

  log('7. Approving an ECR releases its ECO (temporary ECR, removed afterwards)');
  const jeff = new Plm(base); await jeff.login('jeff.hargrove@bowman-aviation.example', env.PLM_USER_PASSWORD);
  const dana = new Plm(base); await dana.login('dana.okafor@bowman-aviation.example', env.PLM_USER_PASSWORD);
  const rafael = new Plm(base); await rafael.login('rafael.quintero@bowman-aviation.example', env.PLM_USER_PASSWORD);
  const made7: Made = [];
  try {
    const t = (await jeff.post('/api/resource/ECR', { doctype: 'ECR', title: `Verification ECR (deleted after the test) ${MARK}`, program: 'Vesper V4', priority: 'Routine', justification_code: 'D', company_class: 'Class I', faa_class: 'Minor', description: 'test', need: 'test', affected_items: [{ part: 'BW-5120-210', change_type: 'Revise', from_revision: 'B', to_revision: 'C' }] })).body.data;
    made7.push(['ECR', t.name]);
    const act = async (who: Plm, action: string) => { const d = (await who.get(`/api/resource/ECR/${t.name}`)).body.data; await who.post('/api/method/frappe.model.workflow.apply_workflow', { doc: JSON.stringify(d), action }); };
    await act(jeff, 'Submit'); await act(dana, 'Start CM review'); await act(dana, 'Send to CCB'); await act(rafael, 'Approve');
    let ecos: any[] = [];
    for (let i = 0; i < 10 && !ecos.length; i++) { await sleep(2000); ecos = await admin.list('ECO', { fields: ['name', 'ecr', 'status', 'released_on', 'released_by', 'decided_by'], filters: [['ecr', '=', t.name]] }); }
    log(`  ${t.name}: Draft -> Submitted -> In CM Review -> CCB Review -> Approved; ECO: ${show(ecos)}`);
    check(ecos.length === 1 && ecos[0].released_by === 'rafael.quintero@bowman-aviation.example' && ecos[0].status === 'Released', 'ECO released by the approving chair');
    // The ECO is linked back onto the ECR by the same bot, so a poller of ECRs sees the release.
    const approvedAt = Date.now();
    let linked: any = {};
    for (let i = 0; i < 15 && !linked.released_eco; i++) { linked = (await norn.get(`/api/resource/ECR/${t.name}`)).body.data; if (!linked.released_eco) await sleep(1000); }
    log(`  ECR after release: released_eco ${linked.released_eco}, modified_by ${linked.modified_by}, state ${linked.workflow_state} (first read ${Math.round((Date.now() - approvedAt) / 1000)} s after the ECO was seen)`);
    check(linked.released_eco === ecos[0]?.name, 'the ECR carries released_eco = its ECO, read by Norn');
    check(linked.modified_by === 'eco-release@bowman-aviation.example', "the link moved the ECR's modified_by to the release bot (not Norn), so a poller reports it");
    const wr = await norn.put(`/api/resource/ECR/${t.name}`, { released_eco: 'ECO-0001' }, { allow: true });
    const still7 = (await norn.get(`/api/resource/ECR/${t.name}`)).body.data;
    log(`  PUT released_eco as Norn -> ${wr.status} (Frappe drops writes to a permission level the user cannot write); released_eco is still ${still7.released_eco}`);
    check(still7.released_eco === ecos[0]?.name, 'Norn cannot change released_eco (the write is ignored)');
  } finally {
    await probeCleanup(made7);
  }

  log('8. Holes a review found, now closed (throwaway ECR made as Administrator, deleted afterwards)');
  const made8: Made = [];
  try {
    const probe = (await probeEcr('Permission probe (deleted after the test)', { decision_note: 'CCB private deliberation (test)', ccb_meeting: '2026-11-12' })).body.data;
    made8.push(['ECR', probe.name]);
    // The rename target must be free beforehand, so a rename that worked is this run's record and is removed with the probe.
    if (await admin.exists('ECR', 'ECR-9999')) check(false, 'the rename target ECR-9999 is free (it is not, so the rename was not tried)');
    else {
      const rn = await norn.post('/api/method/frappe.client.rename_doc', { doctype: 'ECR', old_name: probe.name, new_name: 'ECR-9999' }, { allow: true });
      if (await ours('ECR', 'ECR-9999')) made8.push(['ECR', 'ECR-9999']);
      log(`  rename_doc -> ${refusal(rn)}`);
      check(rn.status >= 400 && (await admin.exists('ECR', probe.name)) && !(await admin.exists('ECR', 'ECR-9999')), 'rename refused, the ECR keeps its number');
    }

    const form = new FormData();
    form.append('file', new Blob(['probe'], { type: 'text/plain' }), 'probe.txt');
    form.append('is_private', '1'); form.append('doctype', 'ECR'); form.append('docname', probe.name);
    const up = await norn.req('POST', '/api/method/upload_file', { form, allow: true });
    log(`  upload_file against the ECR -> ${refusal(up)}`);
    check(up.status >= 400 && (await admin.list('File', { fields: ['name'], filters: [['attached_to_name', '=', probe.name]] })).length === 0, 'attaching a file refused, no File row');

    const as = await norn.post('/api/method/frappe.desk.form.assign_to.add', { doctype: 'ECR', name: probe.name, assign_to: JSON.stringify(['dana.okafor@bowman-aviation.example']), description: 'probe' }, { allow: true });
    log(`  assign_to.add -> ${refusal(as)}`);
    check(as.status >= 400 && (await admin.list('ToDo', { fields: ['name'], filters: [['reference_name', '=', probe.name]] })).length === 0, 'assignment refused, no ToDo');

    const sp = await norn.post('/api/resource/Comment', { doctype: 'Comment', comment_type: 'Comment', reference_doctype: 'ECR', reference_name: probe.name, content: `Spoof probe (not a Norn result). ${MARK}`, comment_by: 'Rafael Quintero', comment_email: 'rafael.quintero@bowman-aviation.example' }, { allow: true });
    if (sp.status === 200) ownComments.add(sp.body.data.name);
    const stored = sp.status === 200 ? (await admin.get(`/api/resource/Comment/${enc(sp.body.data.name)}`)).body.data : {};
    log(`  Comment sent as Rafael Quintero -> ${sp.status}; stored author "${stored.comment_by}" <${stored.comment_email}>`);
    check(sp.status === 200 && stored.comment_email === 'norn@bowman-aviation.example' && stored.comment_by !== 'Rafael Quintero', 'a spoofed comment author lands as Norn');
    const odd = await norn.post('/api/resource/Comment', { doctype: 'Comment', comment_type: 'Edit', reference_doctype: 'ECR', reference_name: probe.name, content: `x ${MARK}` }, { allow: true });
    if (odd.status === 200) ownComments.add(odd.body.data.name);
    check(odd.status >= 400, 'a comment of another type (Edit) refused');

    const g = (await norn.get(`/api/resource/ECR/${probe.name}`)).body.data;
    const gl = await norn.get('/api/resource/ECR', { fields: ['name', 'decision_note'], filters: [['name', '=', probe.name]] }, { allow: true });
    log(`  GET ECR as Norn: decision_note ${'decision_note' in g ? 'present' : 'absent'}, ccb_meeting ${'ccb_meeting' in g ? 'present' : 'absent'}; list with fields=[decision_note] -> ${gl.status}`);
    check(!('decision_note' in g) && !('ccb_meeting' in g) && (gl.status >= 400 || !('decision_note' in (gl.body.data?.[0] ?? {}))), "Norn cannot read the CCB's decision note or meeting date");
    await admin.put(`/api/resource/ECR/${probe.name}`, { decision_note: 'revised private note (test)' });
    const vers = await norn.get('/api/resource/Version', { fields: ['name', 'data'], filters: [['ref_doctype', '=', 'ECR'], ['docname', '=', probe.name]] }, { allow: true });
    const leak = vers.status === 200 && JSON.stringify(vers.body.data).includes('decision_note');
    log(`  Version history as Norn -> ${vers.status}, ${leak ? 'shows decision_note' : 'no decision_note'}`);
    check(!leak, "the version history does not show the CCB's decision note to Norn");
  } finally {
    await probeCleanup(made8);
  }

  log('9. released_eco cannot be reached through ECO creation (throwaway ECR kept In CM Review, removed afterwards)');
  const made9: Made = [];
  try {
    const t9 = (await jeff.post('/api/resource/ECR', { doctype: 'ECR', title: `Bypass probe ECR (deleted after the test) ${MARK}`, program: 'Vesper V4', priority: 'Routine', justification_code: 'D', company_class: 'Class I', faa_class: 'Minor', description: 'test', need: 'test', affected_items: [{ part: 'BW-5120-210', change_type: 'Revise', from_revision: 'B', to_revision: 'C' }] })).body.data;
    made9.push(['ECR', t9.name]);
    const act9 = async (who: Plm, action: string) => { const d = (await who.get(`/api/resource/ECR/${t9.name}`)).body.data; await who.post('/api/method/frappe.model.workflow.apply_workflow', { doc: JSON.stringify(d), action }); };
    await act9(jeff, 'Submit'); await act9(dana, 'Start CM review'); // In CM Review: not approved, and not sent on to the CCB
    const eco9 = { doctype: 'ECO', ecr: t9.name, title: `Bypass probe (deleted after the test) ${MARK}`, status: 'Released' };
    const asDana = await dana.post('/api/resource/ECO', eco9, { allow: true });
    const asRafael = await rafael.post('/api/resource/ECO', eco9, { allow: true });
    log(`  POST /api/resource/ECO for the unapproved ${t9.name}: as the CM analyst -> ${asDana.status}, as the CCB chair -> ${asRafael.status}`);
    check(asDana.status >= 400 && asRafael.status >= 400, 'the CM analyst and the CCB chair cannot create an ECO');
    check((await admin.list('ECO', { fields: ['name'], filters: [['ecr', '=', t9.name]] })).length === 0, 'no ECO exists for the unapproved ECR');
    // Second line of defence: an ECO that does exist (made here as Administrator) is not linked by the bot while its ECR is unapproved.
    const made = (await admin.post('/api/resource/ECO', eco9)).body.data;
    made9.push(['ECO', made.name]);
    await sleep(8000); // the link-back webhook tries three times over about 5 seconds
    const after9 = (await norn.get(`/api/resource/ECR/${t9.name}`)).body.data;
    log(`  ${made.name} made on the unapproved ECR by Administrator; ECR released_eco afterwards: ${after9.released_eco ?? 'empty'}, state ${after9.workflow_state}`);
    check(!after9.released_eco && after9.workflow_state === 'In CM Review', 'the release bot does not link an ECO onto an unapproved ECR');
  } finally {
    await probeCleanup(made9);
  }

  log('10. Document.discard is refused (throwaway ECR and ECO made as Administrator, removed afterwards)');
  const made10: Made = [];
  try {
    const d10 = (await probeEcr('Discard probe ECR (deleted after the test)')).body.data;
    made10.push(['ECR', d10.name]);
    const eco10 = (await admin.post('/api/resource/ECO', { doctype: 'ECO', ecr: d10.name, title: `Discard probe (deleted after the test) ${MARK}`, status: 'Released' })).body.data;
    made10.push(['ECO', eco10.name]);
    // discard needs only write permission, skips Before Validate and the workflow, and sets docstatus 2 (cancelled).
    const discard = (who: Plm, doc: any) => who.post('/api/method/run_doc_method', { docs: JSON.stringify(doc), method: 'discard' }, { allow: true });
    const asNorn = await discard(norn, (await norn.get(`/api/resource/ECR/${d10.name}`)).body.data);
    const asCm = await discard(dana, (await dana.get(`/api/resource/ECO/${eco10.name}`)).body.data);
    const ecrDoc = (await admin.get(`/api/resource/ECR/${d10.name}`)).body.data;
    const ecoDoc = (await admin.get(`/api/resource/ECO/${eco10.name}`)).body.data;
    log(`  run_doc_method discard: ECR ${d10.name} as Norn -> ${refusal(asNorn)}; ECO ${eco10.name} as the CM analyst -> ${refusal(asCm)}; docstatus afterwards ${ecrDoc.docstatus} and ${ecoDoc.docstatus}`);
    check(asNorn.status >= 400 && ecrDoc.docstatus === 0, 'Norn cannot discard an ECR');
    check(asCm.status >= 400 && ecoDoc.docstatus === 0, 'a CM analyst cannot discard an ECO');
  } finally {
    await probeCleanup(made10);
  }

  log('11. A forced rename is refused (throwaway ECR and NCR made as Administrator, removed afterwards)');
  // Document.rename(force=True) ignores allow_rename and skips Before Validate; the release bot holds write on ECR, a CM analyst on NCR.
  // The rename targets must be free beforehand; only names this run created (a rename that worked) are ever deleted.
  const made11: Made = [];
  try {
    const hdrs = (await admin.get('/api/resource/Webhook/ecr.approved')).body.data.webhook_headers as { key: string; value: string }[];
    const bot = new Plm(base, { token: hdrs.find((h) => h.key === 'Authorization')!.value.replace(/^token /, '') });
    const free = !(await admin.exists('ECR', 'ECR-9999')) && !(await admin.exists('NCR', 'NCR-9999'));
    check(free, 'the rename targets ECR-9999 and NCR-9999 are free (otherwise this step does not run, and touches neither)');
    if (free) {
      const r11 = (await probeEcr('Rename probe ECR (deleted after the test)')).body.data;
      made11.push(['ECR', r11.name]);
      const n11 = (await admin.post('/api/resource/NCR', { doctype: 'NCR', part: 'BW-5120-210', status: 'Open', description: `rename probe (deleted after the test) ${MARK}` })).body.data;
      made11.push(['NCR', n11.name]);
      const forceRename = (who: Plm, doc: any, to: string) =>
        who.post('/api/method/run_doc_method', { docs: JSON.stringify(doc), method: 'rename', args: JSON.stringify({ name: to, force: true }) }, { allow: true });
      const botTry = await forceRename(bot, (await bot.get(`/api/resource/ECR/${r11.name}`)).body.data, 'ECR-9999');
      if (await ours('ECR', 'ECR-9999')) made11.push(['ECR', 'ECR-9999']);
      const danaTry = await forceRename(dana, (await dana.get(`/api/resource/NCR/${n11.name}`)).body.data, 'NCR-9999');
      if (await ours('NCR', 'NCR-9999')) made11.push(['NCR', 'NCR-9999']);
      const kept = (await admin.exists('ECR', r11.name)) && !(await admin.exists('ECR', 'ECR-9999')) && (await admin.exists('NCR', n11.name)) && !(await admin.exists('NCR', 'NCR-9999'));
      log(`  run_doc_method rename force=true: ECR ${r11.name} as the release bot -> ${refusal(botTry)}; NCR ${n11.name} as the CM analyst -> ${refusal(danaTry)}; names unchanged: ${kept}`);
      check(botTry.status === 403 && (await admin.exists('ECR', r11.name)) && !(await admin.exists('ECR', 'ECR-9999')), 'the release bot cannot rename an ECR, even forced');
      check(danaTry.status === 403 && (await admin.exists('NCR', n11.name)) && !(await admin.exists('NCR', 'NCR-9999')), 'a CM analyst cannot rename an NCR, even forced');
    }
  } finally {
    await probeCleanup(made11);
  }

  log('12. Child rows cannot be discarded or renamed, and a File cannot be moved onto an ECR (throwaway ECR, removed afterwards)');
  // A child row inherits its parent's permissions, so the parent's guards do not cover a call made on the row itself.
  const made12: Made = [];
  try {
    const c12 = (await probeEcr('Child row probe ECR (deleted after the test)', { affected_items: [{ part: 'BW-5120-210', change_type: 'Revise', from_revision: 'B', to_revision: 'C' }] })).body.data;
    made12.push(['ECR', c12.name]);
    const row = c12.affected_items[0];
    const targetFree = !(await admin.exists('ECR Affected Item', 'probe-row-9999'));
    check(targetFree, 'the child rename target probe-row-9999 is free');
    const call = (method: string, args?: object) => norn.post('/api/method/run_doc_method', { docs: JSON.stringify(row), method, ...(args ? { args: JSON.stringify(args) } : {}) }, { allow: true });
    const rn = targetFree ? await call('rename', { name: 'probe-row-9999', force: true }) : { status: 0, body: {} };
    const dc = await call('discard');
    const rowAfter = (await admin.get(`/api/resource/ECR/${c12.name}`)).body.data.affected_items;
    log(`  ECR Affected Item ${row.name} as Norn: forced rename -> ${refusal(rn)}; discard -> ${refusal(dc)}; row afterwards: ${rowAfter.map((r: any) => `${r.name} docstatus ${r.docstatus}`).join(', ')}`);
    check(rn.status === 403 && dc.status === 403 && rowAfter.length === 1 && rowAfter[0].name === row.name && rowAfter[0].docstatus === 0, 'Norn cannot rename or discard an ECR child row');

    // The re-attach is only tried on a File Norn made itself. If Norn cannot make one, the check fails rather than
    // passing on the create's refusal: the update it is about was never attempted.
    const f = await norn.post('/api/resource/File', { doctype: 'File', file_name: `probe-${RUN}.txt`, content: 'probe', is_private: 1 }, { allow: true });
    if (f.status !== 200) {
      log(`  Norn creates an unattached File -> ${refusal(f)}; the re-attach was not tried`);
      check(false, 'Norn cannot attach a File to an ECR by updating it (not tried: Norn could not create the probe File)');
    } else {
      made12.push(['File', f.body.data.name]);
      const mv = await norn.put(`/api/resource/File/${enc(f.body.data.name)}`, { attached_to_doctype: 'ECR', attached_to_name: c12.name }, { allow: true });
      const fileAfter = (await admin.get(`/api/resource/File/${enc(f.body.data.name)}`)).body.data;
      log(`  Norn creates an unattached File -> ${f.status}; points it at ${c12.name} -> ${refusal(mv)}; attached_to_doctype afterwards: ${fileAfter.attached_to_doctype ?? 'empty'}`);
      check(mv.status >= 400 && fileAfter.attached_to_doctype !== 'ECR', 'Norn cannot attach a File to an ECR by updating it');
    }
  } finally {
    await probeCleanup(made12);
  }

  log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed. ECR-0417 now carries the test impact assessment; run with --clear to remove it.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e instanceof PlmError ? e.message : e); process.exit(1); });
