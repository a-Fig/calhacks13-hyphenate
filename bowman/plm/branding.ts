// Branding and the home page, applied over REST by setup.ts. The CSS and JS themselves are installed by
// `up.sh brand` (Frappe has no REST path for them); this file sets the logo, the app name, the
// Home workspace with its number cards, and the left sidebar.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enc, type Plm } from './client.ts';

const here = dirname(fileURLToPath(import.meta.url));
type Log = (...a: unknown[]) => void;

async function upload(plm: Plm, file: string, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(resolve(here, file))], { type: 'image/svg+xml' }), name);
  form.append('is_private', '0');
  form.append('folder', 'Home');
  form.append('optimize', '0');
  // Same name, same URL: remove an earlier upload so re-running setup does not pile up copies.
  const old = await plm.list('File', { fields: ['name'], filters: [['file_name', '=', name]] });
  for (const f of old) await plm.del(`/api/resource/File/${enc(f.name)}`, { allow: true });
  const r = await plm.req('POST', '/api/method/upload_file', { form });
  return r.body.message.file_url as string;
}

export async function applyBranding(plm: Plm, log: Log) {
  const logo = await upload(plm, 'brand/logo.svg', 'bowman-plm-logo.svg');
  const icon = await upload(plm, 'brand/favicon.svg', 'bowman-plm-favicon.svg');
  await plm.put('/api/resource/Website Settings/Website Settings', {
    app_name: 'Bowman PLM', app_logo: logo, favicon: icon, splash_image: logo,
    hide_footer_signup: 1, disable_signup: 1, brand_html: 'Bowman PLM',
    footer_powered: 'Bowman Aviation engineering',
  });
  await plm.put('/api/resource/Navbar Settings/Navbar Settings', { app_logo: logo });
  // Show people's names, not their email addresses, wherever a Link points at a User.
  for (const [property, value, property_type] of [['show_title_field_in_link', '1', 'Check']]) {
    const name = `User-main-${property}`;
    const doc = { doc_type: 'User', doctype_or_field: 'DocType', property, value, property_type };
    if (await plm.exists('Property Setter', name)) await plm.put(`/api/resource/Property Setter/${enc(name)}`, doc);
    else await plm.post('/api/resource/Property Setter', { doctype: 'Property Setter', name, ...doc });
  }
  log('  logo, favicon, app name "Bowman PLM", names shown for users');
}

const ECR_OPEN = ['Submitted', 'In CM Review', 'CCB Review'];

export async function applyWorkspace(plm: Plm, log: Log) {
  const card = (label: string, document_type: string, filters: unknown[], color: string) => ({
    doctype: 'Number Card', name: label, label, document_type, type: 'Document Type', function: 'Count', is_public: 1,
    show_percentage_stats: 0, color, filters_json: JSON.stringify(filters), module: 'Bowman PLM',
  });
  const cards = [
    card('ECRs awaiting CM review', 'ECR', [['ECR', 'workflow_state', 'in', ['Submitted', 'In CM Review']]], '#0e7490'),
    card('ECRs awaiting the CCB', 'ECR', [['ECR', 'workflow_state', '=', 'CCB Review']], '#d97706'),
    card('Open NCRs', 'NCR', [['NCR', 'status', '=', 'Open']], '#dc2626'),
    card('Assessed by Norn', 'ECR', [['ECR', 'impact_report_level', 'is', 'set'], ['ECR', 'workflow_state', 'in', ECR_OPEN]], '#059669'),
    card('ECOs released', 'ECO', [['ECO', 'status', '=', 'Released']], '#475569'),
  ];
  for (const c of cards) await plm.upsert('Number Card', c.name, c);

  await plm.upsert('Dashboard Chart', 'ECRs by status', {
    chart_name: 'ECRs by status', chart_type: 'Group By', document_type: 'ECR', group_by_type: 'Count',
    group_by_based_on: 'workflow_state', type: 'Donut', is_public: 1, filters_json: '[]', module: 'Bowman PLM', timeseries: 0,
  });

  const shortcuts = [
    ['Parts', 'Part'], ['Engineering BOM (EBOM)', 'Engineering BOM'], ['NCRs', 'NCR'], ['ECRs', 'ECR'], ['ECOs', 'ECO'],
  ].map(([label, link_to]) => ({ label, type: 'DocType', link_to, doc_view: 'List' }));

  const block = (type: string, data: Record<string, unknown>, id: string) => ({ id, type, data });
  const content = [
    block('header', { text: '<span class="h4"><b>Change control</b></span>', col: 12 }, 'h1'),
    ...cards.map((c, i) => block('number_card', { number_card_name: c.name, col: 4 }, `n${i}`)),
    block('spacer', { col: 12 }, 's1'),
    block('chart', { chart_name: 'ECRs by status', col: 12 }, 'c1'),
    block('header', { text: '<span class="h4"><b>Records</b></span>', col: 12 }, 'h2'),
    ...shortcuts.map((s, i) => block('shortcut', { shortcut_name: s.label, col: 3 }, `k${i}`)),
  ];
  await plm.put('/api/resource/Workspace/Bowman PLM', {
    label: 'Bowman PLM', title: 'Bowman PLM', public: 1, is_hidden: 0,
    content: JSON.stringify(content),
    shortcuts,
    number_cards: cards.map((c) => ({ label: c.label, number_card_name: c.name })),
    charts: [{ label: 'ECRs by status', chart_name: 'ECRs by status' }],
  });

  // Keep the rail to this one app: the ERP-style module workspaces (Build, Users, Email...) are for administrators.
  const others = (await plm.list('Workspace', { fields: ['name'] })).map((w: any) => w.name).filter((n: string) => n !== 'Bowman PLM');
  for (const n of others) await plm.put(`/api/resource/Workspace/${enc(n)}`, { is_hidden: 1 });

  const items = [
    { label: 'Home', type: 'Link', link_type: 'Workspace', link_to: 'Bowman PLM', icon: 'home', is_default_module: 1 },
    { label: 'Parts', type: 'Link', link_type: 'DocType', link_to: 'Part', icon: 'package' },
    { label: 'Engineering BOM (EBOM)', type: 'Link', link_type: 'DocType', link_to: 'Engineering BOM', icon: 'list-tree' },
    { label: 'NCRs', type: 'Link', link_type: 'DocType', link_to: 'NCR', icon: 'triangle-alert' },
    { label: 'ECRs', type: 'Link', link_type: 'DocType', link_to: 'ECR', icon: 'file-pen-line' },
    { label: 'ECOs', type: 'Link', link_type: 'DocType', link_to: 'ECO', icon: 'badge-check' },
    { label: 'Review Function', type: 'Link', link_type: 'DocType', link_to: 'Review Function', hidden: 1 },
  ];
  // v16: a site changes a module's sidebar with a Custom Sidebar, not by editing the Sidebar record.
  const custom = { module: 'Bowman PLM', label: 'Bowman PLM', sidebar_items: items };
  const have = await plm.list('Custom Sidebar', { fields: ['name'], filters: [['module', '=', 'Bowman PLM']] });
  if (have.length) await plm.put(`/api/resource/Custom Sidebar/${enc(have[0].name)}`, custom);
  else await plm.post('/api/resource/Custom Sidebar', { doctype: 'Custom Sidebar', ...custom });
  log(`  Home workspace: ${cards.length} number cards, 1 chart, ${shortcuts.length} shortcuts; sidebar with ${items.length} entries; ${others.length} module workspaces hidden`);
}
