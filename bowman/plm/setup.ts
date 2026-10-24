// One-time (and re-runnable) setup of Bowman's PLM over REST: roles, custom DocTypes, the ECR
// workflow, server and client scripts, the Norn integration user, webhooks, branding and the
// home workspace.
//
//   ENV_FILE=<repo>/.env node bowman/plm/setup.ts        (tunnel to 127.0.0.1:8082 must be open; see NOTES.md)
//
// Reads PLM_URL, PLM_ADMIN_PASSWORD (and optionally NORN_WEBHOOK_URL) from the repo-root .env.
// Writes PLM_API_KEY, PLM_API_SECRET, PLM_WEBHOOK_SECRET and PLM_USER_PASSWORD to the same file when
// they are empty. Prints no secret.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Plm, PlmError, enc, readEnv, setEnv, sleep } from './client.ts';
import {
  DOCTYPES, MODULE, NORN_USER, RELEASE_BOT, REVIEW_FUNCTIONS, ROLES, WORKFLOW,
  type DocTypeDef, type Field,
} from './model.ts';
import { applyBranding, applyWorkspace } from './branding.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');
const log = (...a: unknown[]) => console.log(...a);

const env = readEnv();
const base = env.PLM_URL || 'http://127.0.0.1:8082';
if (!env.PLM_ADMIN_PASSWORD) throw new Error('PLM_ADMIN_PASSWORD is empty in .env; run bowman/plm/up.sh first');
const plm = new Plm(base);

function secret(n = 32): string {
  return randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
}
/** Put a fresh random value in .env unless the key already has one. Prints nothing. */
function ensureSecret(key: string): string {
  const cur = readEnv()[key];
  if (cur) return cur;
  const v = secret();
  setEnv(key, v);
  return v;
}

// ---------------------------------------------------------------- helpers

async function ensure(doctype: string, name: string, doc: Field, update = false) {
  if (await plm.exists(doctype, name)) {
    if (update) {
      await plm.put(`/api/resource/${enc(doctype)}/${enc(name)}`, doc);
      return log(`  ${doctype} "${name}": updated`);
    }
    return log(`  ${doctype} "${name}": exists`);
  }
  await plm.post(`/api/resource/${enc(doctype)}`, { doctype, name, ...doc });
  log(`  ${doctype} "${name}": created`);
}

const NAMING_RULE: Record<string, string> = { field: 'By fieldname', format: 'Expression' };

function doctypeDoc(def: DocTypeDef, fields: Field[], withLinks: boolean): Field {
  const autoname = def.autoname;
  const prefix = autoname?.split(':')[0];
  const naming_rule = autoname ? NAMING_RULE[prefix ?? ''] ?? 'Expression (old style)' : undefined;
  return {
    name: def.name,
    module: MODULE,
    custom: 1,
    istable: def.istable ? 1 : 0,
    editable_grid: def.istable ? 1 : 0,
    ...(autoname ? { autoname, naming_rule } : {}),
    fields: fields.map((x, i) => ({ ...x, idx: i + 1 })),
    permissions: def.permissions ?? [],
    links: withLinks ? def.links ?? [] : [],
    ...(def.props ?? {}),
  };
}

// ---------------------------------------------------------------- steps

async function waitForSite() {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/method/ping`)).ok) return;
    } catch { /* tunnel or site not up yet */ }
    if (i > 30) throw new Error(`no answer from ${base}; is the tunnel open?`);
    await sleep(5000);
  }
}

async function systemSettings() {
  // The wizard has to run once, otherwise the desk redirects to it.
  const s = (await plm.get('/api/resource/System Settings/System Settings')).body.data;
  if (!s.setup_complete) {
    await plm.post('/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete', {
      args: JSON.stringify({ language: 'English', country: 'United States', timezone: 'America/Los_Angeles', currency: 'USD', enable_telemetry: 0 }),
    });
    log('  setup wizard: done');
  }
  await plm.put('/api/resource/System Settings/System Settings', {
    app_name: 'Bowman PLM',
    country: 'United States',
    time_zone: 'America/Los_Angeles',
    currency: 'USD',
    number_format: '#,###.##',
    date_format: 'mm-dd-yyyy',
    enable_telemetry: 0,
    disable_system_update_notification: 1,
    allow_older_web_view_links: 0,
    enable_onboarding: 0,
    session_expiry: '240:00',
  });
  log('  System Settings: app name "Bowman PLM", USD, Pacific time');
}

async function roles() {
  for (const r of Object.values(ROLES)) await ensure('Role', r, { role_name: r, desk_access: 1, is_custom: 1 });
}

async function doctypes() {
  await ensure('Module Def', MODULE, { module_name: MODULE, custom: 1, app_name: 'frappe' });
  const created = new Set<string>();
  const custom = new Set(DOCTYPES.map((d) => d.name));
  // Pass 1: create each DocType, leaving out Links and Tables to custom DocTypes that do not exist yet.
  for (const def of DOCTYPES) {
    const fields = def.fields.filter((x) => !(['Link', 'Table', 'Table MultiSelect'].includes(x.fieldtype) && custom.has(x.options) && !created.has(x.options)));
    const doc = doctypeDoc(def, fields, false);
    if (await plm.exists('DocType', def.name)) await plm.put(`/api/resource/DocType/${enc(def.name)}`, doc);
    else await plm.post('/api/resource/DocType', { doctype: 'DocType', ...doc });
    created.add(def.name);
    log(`  DocType "${def.name}": ${fields.length} fields`);
  }
  // Pass 2: full field lists and the Connections.
  for (const def of DOCTYPES) {
    await plm.put(`/api/resource/DocType/${enc(def.name)}`, doctypeDoc(def, def.fields, true));
  }
  log(`  ${DOCTYPES.length} DocTypes complete`);
  for (const fn of REVIEW_FUNCTIONS) await ensure('Review Function', fn, { function_name: fn });
}

async function workflow() {
  for (const s of WORKFLOW.states) await ensure('Workflow State', s.state, { workflow_state_name: s.state, style: s.style }, true);
  for (const t of WORKFLOW.transitions) await ensure('Workflow Action Master', t.action, { workflow_action_name: t.action });
  const doc = {
    workflow_name: WORKFLOW.name,
    document_type: 'ECR',
    is_active: 1,
    workflow_state_field: 'workflow_state',
    override_status: 0,
    send_email_alert: 0,
    states: WORKFLOW.states.map((s) => ({
      state: s.state,
      doc_status: '0',
      allow_edit: s.edit,
      ...(s.stamp ? { update_field: 'decided_on', update_value: 'frappe.utils.today()', evaluate_as_expression: 1 } : {}),
    })),
    transitions: WORKFLOW.transitions.map((t) => ({
      state: t.state,
      action: t.action,
      next_state: t.next,
      allowed: t.allowed,
      allow_self_approval: t.self ?? 0,
      ...(t.condition ? { condition: t.condition } : {}),
    })),
  };
  // Other workflows on ECR must be inactive (Frappe allows one active workflow per DocType).
  await ensure('Workflow', WORKFLOW.name, doc, true);
}

async function scripts() {
  const server: [string, string, string, string][] = [
    ['ECR: Norn writes only the impact assessment', 'ECR', 'Before Validate', 'server-scripts/ecr-guard.py'],
    ['ECR: cost page totals', 'ECR', 'Before Save', 'server-scripts/ecr-totals.py'],
    ['Engineering BOM: component count', 'Engineering BOM', 'Before Save', 'server-scripts/bom-count.py'],
  ];
  for (const [name, dt, event, file] of server) {
    await ensure('Server Script', name, { script_type: 'DocType Event', reference_doctype: dt, doctype_event: event, script: read(file), disabled: 0 }, true);
  }
  const client: [string, string, string][] = [
    ['ECR form', 'ECR', 'client-scripts/ecr.js'],
    ['Part form', 'Part', 'client-scripts/part.js'],
    ['Engineering BOM form', 'Engineering BOM', 'client-scripts/ebom.js'],
  ];
  for (const [name, dt, file] of client) {
    await ensure('Client Script', name, { dt, view: 'Form', enabled: 1, script: read(file) }, true);
  }
}

async function integrationUsers() {
  // Norn's user and its API key. A key is generated only once, so re-running setup never rotates it.
  await ensure('User', NORN_USER, {
    email: NORN_USER, first_name: 'Norn', last_name: 'Integration', enabled: 1, send_welcome_email: 0,
    user_type: 'System User', roles: [{ role: ROLES.norn }],
  });
  const e = readEnv();
  if (!e.PLM_API_KEY || !e.PLM_API_SECRET) {
    const m = await plm.call('frappe.core.doctype.user.user.generate_keys', { user: NORN_USER });
    setEnv('PLM_API_KEY', m.api_key);
    setEnv('PLM_API_SECRET', m.api_secret);
    log('  Norn API key and secret generated and written to .env (not shown)');
  } else log('  Norn API key and secret already in .env; left alone');
  if (!readEnv().PLM_URL) setEnv('PLM_URL', base);

  // The ECO release automation user: the PLM's own webhook creates the ECO as this user when an ECR is approved.
  await ensure('User', RELEASE_BOT, {
    email: RELEASE_BOT, first_name: 'ECO Release', last_name: 'Automation', enabled: 1, send_welcome_email: 0,
    user_type: 'System User', roles: [{ role: ROLES.releaser }],
  });
}

async function webhooks() {
  const norn = readEnv().NORN_WEBHOOK_URL;
  const key = ensureSecret('PLM_WEBHOOK_SECRET');
  const url = norn || 'http://norn.invalid/plm-webhook'; // placeholder keeps the hooks defined but disabled until a URL is set
  const enabled = norn ? 1 : 0;
  const payload = (event: string) => `{
  "event": "${event}",
  "doctype": "{{ doc.doctype }}",
  "name": "{{ doc.name }}",
  "modified": "{{ doc.modified }}",
  "modified_by": "{{ doc.modified_by }}",
  "workflow_state": {{ (doc.workflow_state or "") | tojson }},
  "doc": {{ doc | tojson }}
}`;
  const specs = [
    { doctype: 'NCR', event: 'after_insert', label: 'ncr.inserted' },
    { doctype: 'NCR', event: 'on_update', label: 'ncr.updated' },
    { doctype: 'ECR', event: 'after_insert', label: 'ecr.inserted' },
    { doctype: 'ECR', event: 'on_update', label: 'ecr.updated' },
    { doctype: 'ECO', event: 'after_insert', label: 'eco.released' },
  ];
  // Norn's own writes do not echo back to it: the hook skips updates made by the Norn user.
  const condition = `doc.modified_by != "${NORN_USER}"`;
  for (const s of specs) {
    const doc = {
      webhook_doctype: s.doctype,
      webhook_docevent: s.event,
      condition,
      request_url: url,
      request_method: 'POST',
      request_structure: 'JSON',
      webhook_json: payload(s.label),
      webhook_headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Bowman-PLM-Event', value: s.label }],
      enable_security: 1,
      webhook_secret: key,
      timeout: 5,
      enabled,
    };
    const how = await plm.upsert('Webhook', s.label, doc);
    log(`  Webhook ${s.label}: ${how}, ${enabled ? 'enabled' : 'disabled (set NORN_WEBHOOK_URL in .env and re-run setup)'}`);
  }

  // Release automation: when an ECR is approved, create its ECO through the PLM's own REST API.
  const m = await plm.call('frappe.core.doctype.user.user.generate_keys', { user: RELEASE_BOT });
  const botKey = (await plm.get(`/api/resource/User/${enc(RELEASE_BOT)}`)).body.data.api_key;
  const releaseJson = `{
  "ecr": "{{ doc.name }}",
  "title": {{ doc.title | tojson }},
  "program": {{ doc.program | tojson }},
  "status": "Released",
  "released_on": "{{ utils.today() }}",
  "released_by": "{{ doc.modified_by }}",
  "decided_by": "{{ 'Fast track' if doc.company_class == 'Class II' and doc.faa_class == 'Minor' else 'CCB' }}",
  "company_class": {{ doc.company_class | tojson }},
  "faa_class": {{ doc.faa_class | tojson }},
  "justification_code": {{ doc.justification_code | tojson }},
  "originator": {{ doc.originator | tojson }},
  "filed_on": {{ (doc.filed_on or "") | tojson }},
  "approved_on": "{{ utils.today() }}",
  "summary": {{ (doc.description or "") | tojson }},
  "production_basis": {{ (doc.production_basis or "") | tojson }},
  "production_from": {{ (doc.production_from or "") | tojson }},
  "production_note": {{ (doc.production_note or "") | tojson }},
  "retrofit_basis": {{ (doc.retrofit_basis or "") | tojson }},
  "retrofit_from": {{ (doc.retrofit_from or "") | tojson }},
  "retrofit_to": {{ (doc.retrofit_to or "") | tojson }},
  "interchangeable": {{ 1 if doc.interchangeable else 0 }},
  "affected_items": [{% for i in doc.affected_items %}{"part": {{ i.part | tojson }}, "change_type": {{ i.change_type | tojson }}, "from_revision": {{ (i.from_revision or "") | tojson }}, "to_revision": {{ (i.to_revision or "") | tojson }}}{% if not loop.last %},{% endif %}{% endfor %}]
}`;
  const rel = {
    webhook_doctype: 'ECR',
    webhook_docevent: 'workflow_transition',
    condition: 'doc.workflow_state == "Approved"',
    request_url: 'http://frontend:8080/api/resource/ECO',
    request_method: 'POST',
    request_structure: 'JSON',
    webhook_json: releaseJson,
    webhook_headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Authorization', value: `token ${botKey}:${m.api_secret}` }, { key: 'Host', value: 'frontend' }],
    enable_security: 0,
    timeout: 20,
    enabled: 1,
  };
  const how2 = await plm.upsert('Webhook', 'ecr.approved', rel);
  log('  Webhook "ecr.approved" (release the ECO): ' + how2 + ' (bot key rotated, not shown)');
}

async function main() {
  await waitForSite();
  await plm.login('Administrator', env.PLM_ADMIN_PASSWORD);
  log('1. System settings'); await systemSettings();
  log('2. Roles'); await roles();
  log('3. DocTypes'); await doctypes();
  log('4. ECR workflow'); await workflow();
  log('5. Scripts'); await scripts();
  log('6. Integration users'); await integrationUsers();
  ensureSecret('PLM_USER_PASSWORD');
  log('7. Webhooks'); await webhooks();
  log('8. Branding and home'); await applyBranding(plm, log); await applyWorkspace(plm, log);
  log('Done.');
}

main().catch((e) => {
  console.error(e instanceof PlmError ? e.message : e);
  process.exit(1);
});
