// Seed Bowman's PLM from bowman/data/bowman.json through the PLM's REST API. Re-runnable: existing
// parts and BOMs are updated; existing NCRs, ECRs and ECOs are left alone (their workflow history
// is not replayed twice).
//
//   ENV_FILE=<repo>/.env node bowman/plm/seed.ts [--live] [--skip ECR-0417,...] [--only ECR-0417,...]
//
// By default the webhooks are switched off while seeding, so Norn is not sent a hundred historical
// events, and restored afterwards. --live leaves them on (use it to file the demo ECR for real).
// --reset first deletes every ECO, ECR and NCR (development only; parts and BOMs are updated in place).
// --skip / --only pick which open ECRs are filed, so ECR-0417 can be filed on stage.
// Needs: setup.ts has run, and PLM_ADMIN_PASSWORD and PLM_USER_PASSWORD are in .env. Prints no secret.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plm, PlmError, enc, readEnv } from './client.ts';
import { ROLES } from './model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../data/bowman.json'), 'utf8'));
const log = (...a: unknown[]) => console.log(...a);
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const listArg = (n: string) => (args.includes(n) ? (args[args.indexOf(n) + 1] ?? '').split(',').filter(Boolean) : []);
const live = flag('--live');
const reset = flag('--reset');
const skip = new Set(listArg('--skip'));
const only = new Set(listArg('--only'));

const env = readEnv();
if (!env.PLM_ADMIN_PASSWORD || !env.PLM_USER_PASSWORD) throw new Error('PLM_ADMIN_PASSWORD or PLM_USER_PASSWORD missing in .env; run setup.ts first');
const base = env.PLM_URL || 'http://127.0.0.1:8082';
const admin = new Plm(base);

// ---------------------------------------------------------------- mappings

const PROGRAM: Record<string, string> = { vesper: 'Vesper V4', meridian: 'Meridian M6' };
const programOf = (ids: string[]) => (ids.length > 1 ? 'Both programs' : (PROGRAM[ids[0]] ?? ''));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CLASS: Record<string, string> = { I: 'Class I', II: 'Class II' };
const OP: Record<string, string> = { revise: 'Revise', add: 'Add', remove: 'Remove' };
const BOMOP: Record<string, string> = { add: 'Add', remove: 'Remove', set_qty: 'Set quantity' };
const BASIS: Record<string, string> = { serial: 'Serial', date: 'Date', lot: 'Lot', tbd: 'TBD' };
const LOCATION: Record<string, string> = { stores: 'Stores', wip: 'WIP', finished_goods: 'Finished goods', supplier_finished: 'Supplier finished', on_order: 'On order', in_field: 'In field' };
const DISPOSITION: Record<string, string> = { use_until_depleted: 'Use until depleted', mandatory_install: 'Mandatory install', rework: 'Rework', scrap: 'Scrap', cancel: 'Cancel', tbd: 'TBD' };
const COST_BASIS: Record<string, string> = { supplier_quote: 'Supplier quote', engineer_estimate: 'Engineer estimate', not_provided: 'Not provided' };
const SEAT_FUNCTION: Record<string, string> = { cm_analyst: 'CM analyst', cost_engineer: 'Cost engineer', buyer: 'Buyer', production_planner: 'Production planner', cost_accountant: 'Cost accountant', quality: 'Quality', certification: 'Certification', manufacturing_engineer: 'Manufacturing engineer' };
const NCR_STATUS: Record<string, string> = { open: 'Open', closed_to_ecr: 'Closed to ECR', closed: 'Closed' };

const person = new Map<string, any>(data.people.map((p: any) => [p.id, p]));
const emailOf = (id: string) => person.get(id)?.email;
const supplierName = new Map<string, string>(data.suppliers.map((s: any) => [s.id, s.name]));
const fv = (v: unknown) => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------- plumbing

const sessions = new Map<string, Plm>();
async function as(email: string): Promise<Plm> {
  let s = sessions.get(email);
  if (!s) {
    s = new Plm(base);
    await s.login(email, env.PLM_USER_PASSWORD);
    sessions.set(email, s);
  }
  return s;
}

/** Make the next document in a naming series come out as `${prefix}${n}`, e.g. ECR-0417. */
async function setSeries(prefix: string, next: number) {
  const cur = (await admin.get('/api/resource/Document Naming Settings/Document Naming Settings')).body.data;
  await admin.post('/api/method/run_doc_method', {
    docs: JSON.stringify({ ...cur, transaction_type: 'x', prefix, current_value: next - 1 }),
    method: 'update_series_start',
  });
}

async function createWithId(doctype: string, prefix: string, id: string, by: Plm, doc: Record<string, unknown>) {
  const n = Number(id.slice(prefix.length));
  await setSeries(prefix, n);
  const r = await by.post(`/api/resource/${enc(doctype)}`, { doctype, ...doc });
  if (r.body.data.name !== id) throw new Error(`${doctype} came out as ${r.body.data.name}, expected ${id}`);
}

async function applyAction(who: Plm, doctype: string, name: string, action: string) {
  const doc = (await who.get(`/api/resource/${enc(doctype)}/${enc(name)}`)).body.data;
  await who.post('/api/method/frappe.model.workflow.apply_workflow', { doc: JSON.stringify(doc), action });
}

// ---------------------------------------------------------------- people

const SEAT_ROLES: Record<string, string[]> = {
  design_engineer: [ROLES.designer],
  cm_analyst: [ROLES.cm],
  ccb_chair: [ROLES.chair, ROLES.member],
  cfo: [ROLES.viewer],
};

async function people() {
  let made = 0;
  // Anyone who files an ECR needs the Design Engineer role to submit it (the cost engineer files cost-reduction ECRs).
  const filers = new Set<string>(data.ecrs.map((e: any) => e.originator));
  for (const p of data.people) {
    const base = SEAT_ROLES[p.seat] ?? (p.ccbRole ? [ROLES.member] : [ROLES.viewer]);
    const roles = filers.has(p.id) && !base.includes(ROLES.designer) ? [ROLES.designer, ...base.filter((r) => r !== ROLES.viewer)] : base;
    if (await admin.exists('User', p.email)) {
      await admin.put(`/api/resource/User/${enc(p.email)}`, { roles: roles.map((role) => ({ role })), enabled: 1 });
      continue;
    }
    const [first, ...rest] = p.name.split(' ');
    await admin.post('/api/resource/User', {
      doctype: 'User', email: p.email, first_name: first, last_name: rest.join(' '), enabled: 1, send_welcome_email: 0,
      user_type: 'System User', new_password: env.PLM_USER_PASSWORD, roles: roles.map((role) => ({ role })),
      ...(p.title ? { bio: p.title } : {}),
    });
    made++;
  }
  log(`  people: ${data.people.length} users (${made} created), roles from their CCB seat`);
}

// ---------------------------------------------------------------- parts and BOMs

/** Design owner by area. The dataset has no owner field: this is invented, and the originator wins where an ECR names one. */
function ownerOf(item: any, originators: Map<string, string>): string {
  if (originators.has(item.code)) return originators.get(item.code)!;
  const d = (id: string) => emailOf(id);
  if (item.programs.length === 1 && item.programs[0] === 'meridian') return d('EMP-17');
  if (/^BW-5/.test(item.code)) return d('EMP-03'); // motor controllers and power electronics
  switch (item.costGroup) {
    case 'powertrain': case 'battery': return d('EMP-04');
    case 'avionics': return d('EMP-07');
    case 'actuation_thermal': return d('EMP-06');
    default: return /^BW-(1|2)/.test(item.code) ? d('EMP-06') : d('EMP-07');
  }
}

async function parts() {
  const originators = new Map<string, string>();
  for (const e of data.ecrs) for (const c of e.itemChanges) if (c.op === 'revise') originators.set(c.item, emailOf(e.originator));
  const have = new Set((await admin.list('Part', { fields: ['name'] })).map((r: any) => r.name));
  let created = 0;
  for (const it of data.items) {
    const doc = {
      part_number: it.code,
      part_name: it.name,
      revision: it.rev,
      lifecycle_state: it.status === 'released' ? 'Released' : 'Proposed',
      make_buy: cap(it.makeBuy),
      kind: cap(it.kind),
      program: programOf(it.programs),
      design_owner: ownerOf(it, originators),
      safety_critical: it.safetyCritical ? 1 : 0,
      uom: it.uom,
      default_supplier: it.defaultSupplier ? supplierName.get(it.defaultSupplier) : null,
      revision_history: it.revHistory.map((r: any) => ({ revision: r.rev, released_on: r.date, eco: r.eco ?? '', note: r.note })),
    };
    if (have.has(it.code)) await admin.put(`/api/resource/Part/${enc(it.code)}`, doc);
    else { await admin.post('/api/resource/Part', { doctype: 'Part', ...doc }); created++; }
  }
  log(`  parts: ${data.items.length} (${created} created)`);
}

async function boms() {
  const byParent = new Map<string, any[]>();
  for (const l of data.bom) byParent.set(l.parent, [...(byParent.get(l.parent) ?? []), l]);
  const item = new Map<string, any>(data.items.map((i: any) => [i.code, i]));
  const have = new Set((await admin.list('Engineering BOM', { fields: ['name'] })).map((r: any) => r.name));
  let created = 0, lines = 0;
  for (const [parent, ls] of byParent) {
    const doc = {
      part: parent,
      status: 'Released',
      lines: ls.sort((a, b) => a.seq - b.seq).map((l) => {
        const c = item.get(l.child);
        return { seq: l.seq, part: l.child, qty: l.qty, part_name: c.name, revision: c.rev, uom: c.uom, make_buy: cap(c.makeBuy) };
      }),
    };
    lines += ls.length;
    const name = `EBOM-${parent}`;
    if (have.has(name)) await admin.put(`/api/resource/Engineering BOM/${enc(name)}`, doc);
    else { await admin.post('/api/resource/Engineering BOM', { doctype: 'Engineering BOM', ...doc }); created++; }
  }
  log(`  engineering BOMs: ${byParent.size} assemblies, ${lines} lines (${created} created); Vesper top ${data.programs[0].topItem}, Meridian top ${data.programs[1].topItem}`);
}

// ---------------------------------------------------------------- change records

const affected = (changes: any[]) => changes.map((c) => ({ part: c.item, change_type: OP[c.op], from_revision: c.fromRev ?? '', to_revision: c.toRev ?? '' }));
const redlines = (changes: any[]) => changes.flatMap((c) => (c.changes ?? []).map((x: any) => ({ part: c.item, field: x.field, from_value: fv(x.from), to_value: fv(x.to) })));
const money = (c: any) => ({ label: c.label, basis: COST_BASIS[c.basis], one_time: c.oneTime ?? 0, unit_cost: c.unitCost ?? 0, quantity: c.quantity ?? 0, note: c.note ?? '' });

async function ncrs() {
  let made = 0;
  for (const n of data.ncrs) {
    if (await admin.exists('NCR', n.id)) continue;
    await createWithId('NCR', 'NCR-', n.id, admin, {
      part: n.item, part_revision: n.rev, location_found: n.where, quantity_affected: n.quantityAffected,
      status: NCR_STATUS[n.status], opened_on: n.openedOn, opened_by: emailOf(n.openedBy),
      description: n.description, mrb_disposition: n.mrbDisposition ?? '',
    });
    made++;
  }
  log(`  NCRs: ${data.ncrs.length} (${made} created)`);
}

const cm = () => as(emailOf('EMP-02'));
const chair = () => as(emailOf('EMP-01'));

/** Move an ECR along the workflow to , each step taken by the person who would take it. Safe to re-run. */
async function toState(name: string, originator: string, target: string, fast = false) {
  for (let i = 0; i < 8; i++) {
    const cur = (await admin.get(`/api/resource/ECR/${enc(name)}`)).body.data.workflow_state;
    if (cur === target) return;
    if (cur === 'Draft') await applyAction(await as(originator), 'ECR', name, 'Submit');
    else if (cur === 'Submitted') await applyAction(await cm(), 'ECR', name, 'Start CM review');
    else if (cur === 'In CM Review') await applyAction(await cm(), 'ECR', name, fast && target === 'Approved' ? 'Fast-track approve' : 'Send to CCB');
    else if (cur === 'CCB Review') await applyAction(await chair(), 'ECR', name, 'Approve');
    else throw new Error(`${name} is in ${cur}; cannot reach ${target}`);
  }
  throw new Error(`${name} did not reach ${target}`);
}

/** The ten released ECOs, each with a stub ECR in Approved: the dataset keeps only the ECO's own facts. */
async function history() {
  let made = 0;
  for (const h of data.history) {
    const who = emailOf(h.originator);
    const prog = programOf(h.program);
    if (!(await admin.exists('ECR', h.ecr))) {
      await createWithId('ECR', 'ECR-', h.ecr, await as(who), {
        title: h.title, program: prog === 'Both programs' ? 'Vesper V4' : prog, originator: who, filed_on: h.fileDate,
        priority: 'Routine', justification_code: h.justificationCode, company_class: CLASS[h.companyClass], faa_class: cap(h.faaClass),
        description: h.summary, need: `Released as ${h.id}. The original request is archived.`,
        affected_items: affected(h.itemChanges), field_changes: redlines(h.itemChanges),
      });
    }
    await toState(h.ecr, who, 'Approved', h.decidedBy === 'fast_track');
    await admin.put(`/api/resource/ECR/${enc(h.ecr)}`, { decided_on: h.approvedOn });
    if (await admin.exists('ECO', h.id)) continue;
    const serial = h.actual.cutInSerial;
    await createWithId('ECO', 'ECO-', h.id, admin, {
      ecr: h.ecr, title: h.title, program: prog, status: 'Released', released_on: h.releasedOn,
      released_by: emailOf(h.decidedBy === 'fast_track' ? 'EMP-02' : 'EMP-01'),
      decided_by: h.decidedBy === 'fast_track' ? 'Fast track' : 'CCB',
      company_class: CLASS[h.companyClass], faa_class: cap(h.faaClass), justification_code: h.justificationCode,
      summary: h.summary, affected_items: affected(h.itemChanges),
      production_basis: serial ? 'Serial' : 'Date', production_from: serial ? String(serial) : h.actual.cutInDate,
      interchangeable: 1, originator: who, filed_on: h.fileDate, approved_on: h.approvedOn,
      forecast_unit_cost_delta: h.forecast.unitCostDeltaUsd, forecast_one_time_cost: h.forecast.oneTimeCostUsd,
      forecast_cut_in_date: h.forecast.cutInDate, forecast_cut_in_serial: h.forecast.cutInSerial ?? null, forecast_notes: h.forecast.notes ?? '',
      actual_unit_cost_delta: h.actual.unitCostDeltaUsd, actual_one_time_cost: h.actual.oneTimeCostUsd,
      actual_cut_in_date: h.actual.cutInDate, actual_cut_in_serial: serial ?? null, variance: h.actual.variance,
    });
    made++;
  }
  log(`  released ECOs: ${data.history.length} (${made} created), each with its Approved ECR`);
}

const STATE: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', in_review: 'In CM Review' };

async function openEcrs() {
  const filed: string[] = [];
  for (const e of data.ecrs) {
    if ((only.size && !only.has(e.id)) || skip.has(e.id)) continue;
    const who = emailOf(e.originator);
    if (await admin.exists('ECR', e.id)) { await toState(e.id, who, STATE[e.status]); filed.push(`${e.id} (exists)`); continue; }
    const quotes = e.supplierQuotes.flatMap((q: any) => q.lines.map((l: any, i: number) => ({
      quote_id: q.id, supplier: supplierName.get(q.supplier) ?? q.supplier, part: q.item, received_on: q.receivedOn, valid_until: q.validUntil ?? null,
      lead_time_weeks: q.leadTimeWeeks ?? null, note: i === 0 ? (q.note ?? '') : '',
      description: l.description, unit_price: l.unitPrice ?? 0, qty: l.qty ?? 0, one_time: l.oneTime ?? 0,
    })));
    const eff = e.effectivity;
    await createWithId('ECR', 'ECR-', e.id, await as(who), {
      title: e.title, program: PROGRAM[e.program], originator: who, filed_on: e.filedOn, needed_by: e.neededBy ?? null,
      originating_ncr: e.originatingNcr ?? null, ecr_revision: e.rev,
      priority: cap(e.priority), justification_code: e.justificationCode, company_class: CLASS[e.companyClass], faa_class: cap(e.faaClass),
      faa_rationale: e.faaRationale, classification_note: e.classificationNote ?? '',
      description: e.description, need: e.need, consequences_if_disapproved: e.consequencesIfDisapproved,
      alternatives_considered: e.alternativesConsidered, failure_data: e.failureData ?? '', test_and_qualification: e.testAndQualification,
      affected_items: affected(e.itemChanges), field_changes: redlines(e.itemChanges),
      bom_changes: e.bomChanges.map((b: any) => ({ op: BOMOP[b.op], parent_part: b.parent, child_part: b.child, qty_from: b.qtyFrom ?? null, qty_to: b.qtyTo ?? null })),
      supplier_quotes: quotes,
      inventory: e.inventoryProposal.map((i: any) => ({ part: i.item, location: LOCATION[i.location], disposition: DISPOSITION[i.disposition], note: i.note ?? '' })),
      production_basis: BASIS[eff.production.basis], production_from: eff.production.from, production_note: eff.production.note,
      ...(eff.retrofit ? { retrofit_basis: BASIS[eff.retrofit.basis], retrofit_from: eff.retrofit.from, retrofit_to: eff.retrofit.to ?? '', retrofit_note: eff.retrofit.note } : {}),
      interchangeable: eff.interchangeable ? 1 : 0,
      cost_production: e.costPage.production.map(money), cost_retrofit: e.costPage.retrofit.map(money),
      cost_logistics: e.costPage.logisticsSupport.map(money), cost_other: e.costPage.other.map(money),
      routed_to: e.routedTo.map((s: string) => ({ review_function: SEAT_FUNCTION[s] })),
    });
    await toState(e.id, who, STATE[e.status]);
    filed.push(e.id);
  }
  // Close the loop on the NCRs: the NCR names the ECR that answers it.
  for (const n of data.ncrs) {
    if (n.linkedEcr && (await admin.exists('ECR', n.linkedEcr))) await admin.put(`/api/resource/NCR/${enc(n.id)}`, { linked_ecr: n.linkedEcr });
  }
  log(`  open ECRs: ${filed.join(', ')}`);
}

// ---------------------------------------------------------------- webhooks off while seeding

async function withWebhooksPaused<T>(fn: () => Promise<T>): Promise<T> {
  if (live) return fn();
  const on = (await admin.list('Webhook', { fields: ['name', 'enabled'], filters: [['enabled', '=', 1]] })).map((w: any) => w.name);
  for (const n of on) await admin.put(`/api/resource/Webhook/${enc(n)}`, { enabled: 0 });
  try { return await fn(); }
  finally { for (const n of on) await admin.put(`/api/resource/Webhook/${enc(n)}`, { enabled: 1 }); log(`  webhooks: ${on.length} restored`); }
}

async function wipeChanges() {
  for (const dt of ['ECO', 'ECR', 'NCR']) {
    if (dt === 'ECR') for (const n of await admin.list('NCR', { fields: ['name'] })) await admin.put(`/api/resource/NCR/${enc(n.name)}`, { linked_ecr: null });
    for (const r of await admin.list(dt, { fields: ['name'] })) await admin.del(`/api/resource/${enc(dt)}/${enc(r.name)}`);
  }
  log('  reset: all ECOs, ECRs and NCRs deleted');
}

async function main() {
  await admin.login('Administrator', env.PLM_ADMIN_PASSWORD);
  await withWebhooksPaused(async () => {
    if (reset) await wipeChanges();
    log('1. People'); await people();
    log('2. Parts'); await parts();
    log('3. Engineering BOMs'); await boms();
    log('4. NCRs'); await ncrs();
    log('5. Released ECOs'); await history();
    log('6. Open ECRs'); await openEcrs();
    // New records continue after the dataset's highest numbers.
    await setSeries('ECR-', 424); await setSeries('NCR-', 125); await setSeries('ECO-', 319);
    log('  naming series: next ECR-0424, NCR-0125, ECO-0319');
  });
  log('Done.');
}

main().catch((e) => {
  console.error(e instanceof PlmError ? e.message : e);
  process.exit(1);
});
