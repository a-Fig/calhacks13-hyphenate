// Shows that segregation of duties holds in ERPNext: Fern can save a draft but cannot submit it. It takes one of Fern's drafts
// for an ECO and tries to submit it with Fern's own credentials (the Norn Agent user's API token from .env), two ways: the
// submit call and an update that sets docstatus to 1. ERPNext refuses both, and the draft is read back still a draft.
// Fern drafts, people submit (Tyler, 2026-10-25, reversing #71); the role's grants are in bootstrap.mjs.
//
//   node bowman/erp/prove-no-submit.ts ECO-0319            try a draft BOM, else a draft journal entry, of the ECO
//   node bowman/erp/prove-no-submit.ts ECO-0319 "Journal Entry"
//
// Exit code 0 when every attempt is refused and the document is still a draft; 1 when ERPNext accepted a submit (the role
// is wrong: run bootstrap.mjs) or there is no draft to try. Needs ERPNEXT_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET
// (ENV_FILE or the repo-root .env). Prints no secret. Node 24, erasable TypeScript syntax only.
import { connectionFromEnv, loadEnvFile } from '../../norn/connectors/erpnext/src/index.ts';

const eco = process.argv[2] ?? 'ECO-0319';
const only = process.argv[3];
loadEnvFile();
const conn = connectionFromEnv();
const base = conn.url.replace(/\/+$/, '');
const headers = { Authorization: `token ${conn.apiKey}:${conn.apiSecret}`, Accept: 'application/json', 'Content-Type': 'application/json' };

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text.slice(0, 300) }; }
}
const said = (b: any): string => {
  let msg = '';
  try { msg = JSON.parse(b._server_messages).map((m: string) => JSON.parse(m).message).join(' | ').replace(/<[^>]+>/g, ''); } catch { /* none */ }
  return [b?.exc_type, msg].filter(Boolean).join(': ') || (typeof b === 'string' ? b : '');
};
const enc = encodeURIComponent;

const who = await call('GET', '/api/method/frappe.auth.get_logged_user');
console.log(`Signed in to ${base} as ${who.body?.message} (Fern's own API token).`);

let target: { doctype: string; name: string } | undefined;
for (const doctype of only ? [only] : ['BOM', 'Journal Entry']) {
  const r = await call('GET', `/api/resource/${enc(doctype)}?${new URLSearchParams({ filters: JSON.stringify([['bw_eco', '=', eco], ['docstatus', '=', 0]]), fields: JSON.stringify(['name']), limit_page_length: '1' })}`);
  if (r.body?.data?.[0]) { target = { doctype, name: r.body.data[0].name }; break; }
}
if (!target) { console.log(`No draft of ${eco} to try. Release the ECO (or run eco-package.ts --draft) first.`); process.exit(1); }
const path = `/api/resource/${enc(target.doctype)}/${enc(target.name)}`;
const doc = (await call('GET', path)).body.data;
console.log(`Trying to submit ${target.doctype} ${target.name} (docstatus ${doc.docstatus}, Released by ECO ${doc.bw_eco}).\n`);

let accepted = 0;
const attempts: [string, () => Promise<{ status: number; body: any }>][] = [
  ['frappe.client.submit', () => call('POST', '/api/method/frappe.client.submit', { doc })],
  [`PUT ${target.doctype} with docstatus 1`, () => call('PUT', path, { docstatus: 1 })],
];
for (const [what, run] of attempts) {
  const r = await run();
  const ok = r.status < 400;
  if (ok) accepted++;
  console.log(`${what}: HTTP ${r.status} ${ok ? 'ACCEPTED' : 'refused'}${ok ? '' : ` - ${said(r.body)}`}`);
}
const after = (await call('GET', path)).body.data;
console.log(`\n${target.doctype} ${target.name} now: docstatus ${after.docstatus} (${after.docstatus === 0 ? 'still a draft' : 'NOT a draft'}). ${base}/app/${target.doctype.toLowerCase().replace(/\s+/g, '-')}/${enc(target.name)}`);
const held = accepted === 0 && after.docstatus === 0;
console.log(held ? 'Segregation of duties holds: Fern drafts, a person submits.' : 'ERPNext let Fern submit. Run bowman/erp/bootstrap.mjs to fix the role.');
process.exit(held ? 0 : 1);
