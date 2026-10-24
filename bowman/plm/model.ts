// Bowman PLM data model: custom DocTypes, roles and the ECR workflow, as plain data.
// setup.ts turns this into REST calls. Field shapes follow bowman/data/types.ts; enumerations keep
// the dataset's value sets but are spelled for people ("Urgent", "Class I") because this is what an
// engineer reads. NOTES.md has the mapping.

export type Field = Record<string, any>;

// ---------------------------------------------------------------- roles

export const ROLES = {
  designer: 'Design Engineer',
  cm: 'CM Analyst',
  member: 'CCB Member',
  chair: 'CCB Chair',
  viewer: 'PLM Viewer',
  norn: 'Norn Integration',
  releaser: 'ECO Release Automation',
} as const;

export const NORN_USER = 'norn@bowman-aviation.example';
export const RELEASE_BOT = 'eco-release@bowman-aviation.example';
export const MODULE = 'Bowman PLM';

// ---------------------------------------------------------------- value sets

export const PROGRAMS = ['Vesper V4', 'Meridian M6'];
export const PROGRAMS_OR_BOTH = [...PROGRAMS, 'Both programs'];
export const PRIORITIES = ['Emergency', 'Urgent', 'Routine'];
export const JUSTIFICATION = ['B', 'C', 'D', 'O', 'P', 'R', 'S', 'V'];
export const CLASSES = ['Class I', 'Class II'];
export const FAA = ['Minor', 'Major'];
export const EFFECTIVITY_BASIS = ['Serial', 'Date', 'Lot', 'TBD'];
export const LOCATIONS = ['Stores', 'WIP', 'Finished goods', 'Supplier finished', 'On order', 'In field'];
export const DISPOSITIONS = ['Use until depleted', 'Mandatory install', 'Rework', 'Scrap', 'Cancel', 'TBD'];
export const COST_BASIS = ['Supplier quote', 'Engineer estimate', 'Not provided'];
export const RECOMMENDATIONS = ['Approve', 'Approve with conditions', 'Send back', 'Reject'];

/** Fields on the ECR only the Norn integration user can write (permlevel 1). Keep in step with server-scripts/ecr-guard.py. */
export const IMPACT_FIELDS = [
  'impact_report_level',
  'impact_recommendation',
  'impact_change_class',
  'impact_approval_route',
  'impact_norn_url',
  'impact_updated_on',
  'impact_statement',
];

// ---------------------------------------------------------------- builders

const opts = (a: string[], blankFirst = false) => (blankFirst ? ['', ...a] : a).join('\n');
const f = (fieldtype: string, fieldname: string, label: string, o: Field = {}): Field => ({ fieldtype, fieldname, label, ...o });
const sec = (label?: string, o: Field = {}): Field => ({ fieldtype: 'Section Break', ...(label ? { label } : {}), ...o });
const col = (): Field => ({ fieldtype: 'Column Break' });
const tab = (label: string): Field => ({ fieldtype: 'Tab Break', label });

/** Give every layout break a unique fieldname. */
function finish(fields: Field[]): Field[] {
  let n = 0;
  return fields.map((x) => {
    if (x.fieldname) return x;
    n += 1;
    const kind = String(x.fieldtype).split(' ')[0].toLowerCase();
    return { ...x, fieldname: `${kind}_${n}` };
  });
}

export interface PermRow {
  role: string;
  permlevel?: number;
  read?: 1; write?: 1; create?: 1; delete?: 1; report?: 1; export?: 1; print?: 1; email?: 1; share?: 1; if_owner?: 1;
}
const R = { read: 1, report: 1, export: 1, print: 1, email: 1, share: 1 } as const;
const RW = { ...R, write: 1 } as const;
const RWC = { ...RW, create: 1 } as const;

export interface DocTypeDef {
  name: string;
  istable?: boolean;
  autoname?: string;
  fields: Field[];
  permissions?: PermRow[];
  /** DocType-level properties merged in as is. */
  props?: Field;
  /** Connections shown on the form's dashboard. Applied after every DocType exists. */
  links?: Field[];
}

const sysman: PermRow = { role: 'System Manager', read: 1, write: 1, create: 1, delete: 1, report: 1, export: 1, print: 1, email: 1, share: 1 };
const everyoneReads = [ROLES.designer, ROLES.cm, ROLES.member, ROLES.chair, ROLES.viewer, ROLES.norn];

// ---------------------------------------------------------------- child tables

const partRevision: DocTypeDef = {
  name: 'Part Revision',
  istable: true,
  fields: finish([
    f('Data', 'revision', 'Revision', { reqd: 1, in_list_view: 1, columns: 1 }),
    f('Date', 'released_on', 'Released on', { in_list_view: 1, columns: 2 }),
    f('Data', 'eco', 'ECO', { in_list_view: 1, columns: 2 }),
    f('Small Text', 'note', 'What changed', { in_list_view: 1, columns: 5 }),
  ]),
};

const bomLine: DocTypeDef = {
  name: 'Engineering BOM Line',
  istable: true,
  fields: finish([
    f('Int', 'seq', 'Find no.', { in_list_view: 1, columns: 1 }),
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 2 }),
    f('Data', 'part_name', 'Name', { fetch_from: 'part.part_name', read_only: 1, in_list_view: 1, columns: 4 }),
    f('Data', 'revision', 'Rev', { fetch_from: 'part.revision', read_only: 1, in_list_view: 1, columns: 1 }),
    f('Float', 'qty', 'Qty', { reqd: 1, in_list_view: 1, columns: 1, precision: '2' }),
    f('Data', 'uom', 'UoM', { fetch_from: 'part.uom', read_only: 1, in_list_view: 1, columns: 1 }),
    f('Data', 'make_buy', 'Make/Buy', { fetch_from: 'part.make_buy', read_only: 1 }),
  ]),
};

const affectedItem: DocTypeDef = {
  name: 'ECR Affected Item',
  istable: true,
  fields: finish([
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 2 }),
    f('Data', 'part_name', 'Name', { fetch_from: 'part.part_name', read_only: 1, in_list_view: 1, columns: 4 }),
    f('Select', 'change_type', 'Change', { options: opts(['Revise', 'Add', 'Remove']), reqd: 1, in_list_view: 1, columns: 1, default: 'Revise' }),
    f('Data', 'from_revision', 'Old rev', { in_list_view: 1, columns: 1 }),
    f('Data', 'to_revision', 'New rev', { in_list_view: 1, columns: 1 }),
  ]),
};

const fieldChange: DocTypeDef = {
  name: 'ECR Field Change',
  istable: true,
  fields: finish([
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 2 }),
    f('Data', 'field', 'Characteristic', { reqd: 1, in_list_view: 1, columns: 3 }),
    f('Data', 'from_value', 'From', { in_list_view: 1, columns: 2 }),
    f('Data', 'to_value', 'To', { in_list_view: 1, columns: 2 }),
  ]),
};

const bomChange: DocTypeDef = {
  name: 'ECR BOM Change',
  istable: true,
  fields: finish([
    f('Select', 'op', 'Change', { options: opts(['Add', 'Remove', 'Set quantity']), reqd: 1, in_list_view: 1, columns: 2 }),
    f('Link', 'parent_part', 'In assembly', { options: 'Part', reqd: 1, in_list_view: 1, columns: 3 }),
    f('Link', 'child_part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 3 }),
    f('Float', 'qty_from', 'Qty from', { in_list_view: 1, columns: 1 }),
    f('Float', 'qty_to', 'Qty to', { in_list_view: 1, columns: 1 }),
  ]),
};

const supplierQuote: DocTypeDef = {
  name: 'ECR Supplier Quote',
  istable: true,
  fields: finish([
    f('Data', 'quote_id', 'Quote', { in_list_view: 1, columns: 2 }),
    f('Data', 'supplier', 'Supplier', { in_list_view: 1, columns: 2 }),
    f('Data', 'description', 'Line', { reqd: 1, in_list_view: 1, columns: 3 }),
    f('Currency', 'unit_price', 'Unit price', { in_list_view: 1, columns: 1 }),
    f('Float', 'qty', 'Qty', { in_list_view: 1, columns: 1 }),
    f('Currency', 'one_time', 'One-time', { in_list_view: 1, columns: 1 }),
    f('Link', 'part', 'Part', { options: 'Part' }),
    f('Date', 'received_on', 'Received on'),
    f('Date', 'valid_until', 'Valid until'),
    f('Int', 'lead_time_weeks', 'Lead time (weeks)'),
    f('Small Text', 'note', 'Note'),
  ]),
};

const inventoryLine: DocTypeDef = {
  name: 'ECR Inventory Line',
  istable: true,
  fields: finish([
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 2 }),
    f('Select', 'location', 'Where', { options: opts(LOCATIONS), reqd: 1, in_list_view: 1, columns: 2 }),
    f('Select', 'disposition', 'Proposed disposition', { options: opts(DISPOSITIONS), reqd: 1, in_list_view: 1, columns: 2 }),
    f('Small Text', 'note', 'Note', { in_list_view: 1, columns: 4 }),
  ]),
};

const costLine: DocTypeDef = {
  name: 'ECR Cost Line',
  istable: true,
  fields: finish([
    f('Data', 'label', 'Cost element', { reqd: 1, in_list_view: 1, columns: 3 }),
    f('Select', 'basis', 'Basis', { options: opts(COST_BASIS), reqd: 1, default: 'Not provided', in_list_view: 1, columns: 2 }),
    f('Currency', 'one_time', 'One-time', { in_list_view: 1, columns: 1 }),
    f('Currency', 'unit_cost', 'Unit cost', { in_list_view: 1, columns: 1 }),
    f('Float', 'quantity', 'Qty', { in_list_view: 1, columns: 1, precision: '2' }),
    f('Currency', 'recurring_total', 'Recurring', { read_only: 1, in_list_view: 1, columns: 1 }),
    f('Currency', 'line_total', 'Total', { read_only: 1, in_list_view: 1, columns: 1 }),
    f('Small Text', 'note', 'Note'),
  ]),
};

const ecoAffectedItem: DocTypeDef = {
  name: 'ECO Affected Item',
  istable: true,
  fields: finish([
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, columns: 2 }),
    f('Data', 'part_name', 'Name', { fetch_from: 'part.part_name', read_only: 1, in_list_view: 1, columns: 4 }),
    f('Select', 'change_type', 'Change', { options: opts(['Revise', 'Add', 'Remove']), reqd: 1, in_list_view: 1, columns: 1, default: 'Revise' }),
    f('Data', 'from_revision', 'Old rev', { in_list_view: 1, columns: 1 }),
    f('Data', 'to_revision', 'New rev', { in_list_view: 1, columns: 1 }),
  ]),
};

const reviewFunction: DocTypeDef = {
  name: 'Review Function',
  autoname: 'field:function_name',
  fields: finish([f('Data', 'function_name', 'Function', { reqd: 1, unique: 1, in_list_view: 1 })]),
  permissions: [...everyoneReads.map((role) => ({ role, ...R })), sysman],
  props: { module: MODULE },
};

const ecrRouting: DocTypeDef = {
  name: 'ECR Routing',
  istable: true,
  fields: finish([f('Link', 'review_function', 'Function', { options: 'Review Function', reqd: 1, in_list_view: 1 })]),
};

// ---------------------------------------------------------------- Part and Engineering BOM

const part: DocTypeDef = {
  name: 'Part',
  autoname: 'field:part_number',
  fields: finish([
    sec('Identification'),
    f('Data', 'part_number', 'Part number', { reqd: 1, unique: 1, in_list_view: 1, bold: 1, set_only_once: 1 }),
    f('Data', 'part_name', 'Name', { reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Data', 'revision', 'Rev', { reqd: 1, default: 'A', in_list_view: 1 }),
    col(),
    f('Select', 'lifecycle_state', 'Lifecycle', { options: opts(['Proposed', 'Released', 'Obsolete']), reqd: 1, default: 'Released', in_list_view: 1, in_standard_filter: 1 }),
    f('Select', 'make_buy', 'Make / buy', { options: opts(['Make', 'Buy']), reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Select', 'kind', 'Type', { options: opts(['Aircraft', 'Assembly', 'Part', 'Material']), in_standard_filter: 1 }),
    col(),
    f('Select', 'program', 'Program', { options: opts(PROGRAMS_OR_BOTH), in_list_view: 1, in_standard_filter: 1 }),
    f('Link', 'design_owner', 'Design owner', { options: 'User', in_list_view: 1, in_standard_filter: 1 }),
    f('Check', 'safety_critical', 'Flight-safety part', { description: 'Never fast-tracked. Any change goes to the CCB.' }),
    sec('Sourcing'),
    f('Data', 'uom', 'Unit of measure'),
    col(),
    f('Data', 'default_supplier', 'Approved source', { depends_on: "eval:doc.make_buy=='Buy'", description: 'Supplier on the approved source list' }),
    sec('Revision history'),
    f('Table', 'revision_history', 'Revisions', { options: 'Part Revision' }),
  ]),
  permissions: [
    { role: ROLES.designer, ...RWC },
    { role: ROLES.cm, ...RWC },
    ...[ROLES.member, ROLES.chair, ROLES.viewer, ROLES.norn].map((role) => ({ role, ...R })),
    sysman,
  ],
  props: { module: MODULE, track_changes: 1, sort_field: 'modified', sort_order: 'DESC', search_fields: 'part_name,program' },
  links: [
    { link_doctype: 'Engineering BOM', link_fieldname: 'part', group: 'Structure' },
    { link_doctype: 'Engineering BOM Line', link_fieldname: 'part', parent_doctype: 'Engineering BOM', table_fieldname: 'lines', is_child_table: 1, group: 'Where used' },
    { link_doctype: 'ECR Affected Item', link_fieldname: 'part', parent_doctype: 'ECR', table_fieldname: 'affected_items', is_child_table: 1, group: 'Changes' },
    { link_doctype: 'NCR', link_fieldname: 'part', group: 'Changes' },
  ],
};

const ebom: DocTypeDef = {
  name: 'Engineering BOM',
  autoname: 'format:EBOM-{part}',
  fields: finish([
    sec('Assembly'),
    f('Link', 'part', 'Assembly', { options: 'Part', reqd: 1, unique: 1, in_list_view: 1, set_only_once: 1 }),
    f('Data', 'part_name', 'Name', { fetch_from: 'part.part_name', read_only: 1, in_list_view: 1 }),
    f('Data', 'revision', 'Rev', { fetch_from: 'part.revision', read_only: 1, in_list_view: 1 }),
    col(),
    f('Select', 'status', 'Status', { options: opts(['Draft', 'Released', 'Obsolete']), default: 'Released', reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Select', 'program', 'Program', { options: opts(PROGRAMS_OR_BOTH), fetch_from: 'part.program', in_list_view: 1, in_standard_filter: 1 }),
    f('Int', 'line_count', 'Components', { read_only: 1, in_list_view: 1 }),
    sec('Bill of materials'),
    f('Table', 'lines', 'Components', { options: 'Engineering BOM Line' }),
  ]),
  permissions: [
    { role: ROLES.designer, ...RWC },
    { role: ROLES.cm, ...RWC },
    ...[ROLES.member, ROLES.chair, ROLES.viewer, ROLES.norn].map((role) => ({ role, ...R })),
    sysman,
  ],
  props: { module: MODULE, track_changes: 1, sort_field: 'modified', sort_order: 'DESC' },
};

// ---------------------------------------------------------------- NCR

const ncr: DocTypeDef = {
  name: 'NCR',
  autoname: 'NCR-.####',
  fields: finish([
    sec('Nonconformance'),
    f('Data', 'title', 'Title', { read_only: 1, in_list_view: 1, bold: 1, depends_on: 'eval:!doc.__islocal', description: 'Set from the NCR number and part name.' }),
    f('Link', 'part', 'Part', { options: 'Part', reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Data', 'part_name', 'Part name', { fetch_from: 'part.part_name', read_only: 1 }),
    f('Data', 'part_revision', 'Rev'),
    f('Data', 'location_found', 'Where found', { in_list_view: 1 }),
    col(),
    f('Select', 'status', 'Status', { options: opts(['Open', 'Closed to ECR', 'Closed']), default: 'Open', reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Select', 'program', 'Program', { options: opts(PROGRAMS_OR_BOTH), fetch_from: 'part.program', in_standard_filter: 1 }),
    f('Int', 'quantity_affected', 'Quantity affected', { in_list_view: 1 }),
    col(),
    f('Date', 'opened_on', 'Opened on', { default: 'Today', reqd: 1, in_list_view: 1 }),
    f('Link', 'opened_by', 'Opened by', { options: 'User', default: '__user', reqd: 1, in_standard_filter: 1 }),
    f('Link', 'linked_ecr', 'Change request (ECR)', { options: 'ECR', in_list_view: 1, in_standard_filter: 1 }),
    sec('What was found'),
    f('Text', 'description', 'Description', { reqd: 1 }),
    sec('Material review board'),
    f('Text', 'mrb_disposition', 'MRB disposition'),
  ]),
  permissions: [
    { role: ROLES.designer, ...RWC },
    { role: ROLES.cm, ...RWC },
    { role: ROLES.member, ...RWC }, // quality engineers file NCRs
    ...[ROLES.chair, ROLES.viewer, ROLES.norn].map((role) => ({ role, ...R })),
    sysman,
  ],
  props: { module: MODULE, track_changes: 1, sort_field: 'modified', sort_order: 'DESC', search_fields: 'part,part_name,location_found', title_field: 'title', show_title_field_in_link: 1 },
  links: [{ link_doctype: 'ECR', link_fieldname: 'originating_ncr', group: 'Changes' }],
};

// ---------------------------------------------------------------- ECR

const costTable = (fieldname: string, label: string): Field[] => [sec(label), f('Table', fieldname, label, { options: 'ECR Cost Line' })];

const ecr: DocTypeDef = {
  name: 'ECR',
  autoname: 'ECR-.####',
  fields: finish([
    // ---- Request
    tab('Request'),
    sec('Identification'),
    f('Data', 'title', 'Title', { reqd: 1, in_list_view: 1, bold: 1, length: 240 }),
    f('Select', 'program', 'Program', { options: opts(PROGRAMS), reqd: 1, in_standard_filter: 1 }),
    f('Link', 'originating_ncr', 'Originating NCR', { options: 'NCR' }),
    col(),
    f('Link', 'originator', 'Originator', { options: 'User', reqd: 1, default: '__user', in_standard_filter: 1 }),
    f('Date', 'filed_on', 'Filed on', { default: 'Today', reqd: 1 }),
    f('Date', 'needed_by', 'Needed by'),
    col(),
    f('Data', 'ecr_revision', 'ECP revision', { default: 'A' }),
    f('Link', 'workflow_state', 'Status', { options: 'Workflow State', read_only: 1, no_copy: 1, allow_on_submit: 1, in_standard_filter: 1 }),
    f('Datetime', 'decided_on', 'Decided on', { read_only: 1 }),
    sec('Classification'),
    f('Select', 'priority', 'Priority', { options: opts(PRIORITIES), reqd: 1, default: 'Routine', in_list_view: 1, in_standard_filter: 1, description: 'Emergency: line stopper now. Urgent: within 30 days. Routine: everything else.' }),
    f('Select', 'justification_code', 'Justification code', { options: opts(JUSTIFICATION), reqd: 1, description: 'B interface, C compatibility, D deficiency, O operational, P production stoppage, R cost reduction, S safety, V value engineering.' }),
    col(),
    f('Select', 'company_class', 'Company class', { options: opts(CLASSES), reqd: 1, in_list_view: 1, in_standard_filter: 1, description: 'Class I: form, fit, function, cost, schedule, safety, interchangeability or retrofit of built aircraft. Class II: everything else.' }),
    f('Select', 'faa_class', 'FAA class', { options: opts(FAA), reqd: 1, in_list_view: 1, description: "Bowman's proposal under 14 CFR 21.93. Certification decides." }),
    col(),
    f('Small Text', 'faa_rationale', 'FAA class rationale'),
    f('Small Text', 'classification_note', 'Classification note'),
    sec('What and why'),
    f('Text', 'description', 'Description of change', { reqd: 1 }),
    f('Text', 'need', 'Need for change', { reqd: 1 }),
    f('Text', 'consequences_if_disapproved', 'Consequences of disapproval'),
    f('Text', 'alternatives_considered', 'Alternatives considered'),
    f('Text', 'failure_data', 'Failure data'),
    f('Text', 'test_and_qualification', 'Test and requalification expected'),

    // ---- Impact assessment (Norn writes; permlevel 1)
    tab('Impact assessment'),
    sec('Impact assessment', { description: 'Posted by Norn through the PLM API. Read-only for people: ask Norn to refresh it.' }),
    f('HTML', 'impact_empty', '', { depends_on: 'eval:!doc.impact_report_level && !doc.impact_statement', options: '<div style="padding:28px 0;text-align:center;color:var(--text-muted)"><div style="font-size:15px;font-weight:600">No impact assessment yet</div><div>Norn reads the ECR when it is filed and posts its assessment here.</div></div>' }),
    f('Select', 'impact_report_level', 'Report level', { options: opts(['1', '2', '3'], true), permlevel: 1, in_list_view: 1, in_standard_filter: 1, description: '1 provisional, 2 reviewed, 3 final verdict' }),
    f('Select', 'impact_recommendation', 'Recommendation', { options: opts(RECOMMENDATIONS, true), permlevel: 1, in_list_view: 1 }),
    col(),
    f('Select', 'impact_change_class', 'Change class proposed', { options: opts(CLASSES, true), permlevel: 1 }),
    f('Data', 'impact_approval_route', 'Approval route proposed', { permlevel: 1 }),
    col(),
    f('Data', 'impact_norn_url', 'Open in Norn', { options: 'URL', permlevel: 1 }),
    f('Datetime', 'impact_updated_on', 'Last updated', { permlevel: 1 }),
    sec('Statement'),
    f('Text Editor', 'impact_statement', 'Impact statement', { permlevel: 1 }),

    // ---- Affected items
    tab('Affected items'),
    sec('Affected items'),
    f('Table', 'affected_items', 'Affected items', { options: 'ECR Affected Item' }),
    sec('Redlines', { collapsible: 1 }),
    f('Table', 'field_changes', 'Characteristic changes', { options: 'ECR Field Change' }),
    sec('Structure changes', { collapsible: 1 }),
    f('Table', 'bom_changes', 'BOM changes', { options: 'ECR BOM Change' }),
    sec('Effectivity'),
    f('Select', 'production_basis', 'Production cut-in by', { options: opts(EFFECTIVITY_BASIS, true) }),
    f('Data', 'production_from', 'Cut-in at'),
    f('Small Text', 'production_note', 'Production note'),
    col(),
    f('Select', 'retrofit_basis', 'Retrofit by', { options: opts(EFFECTIVITY_BASIS, true) }),
    f('Data', 'retrofit_from', 'Retrofit from'),
    f('Data', 'retrofit_to', 'Retrofit to'),
    f('Small Text', 'retrofit_note', 'Retrofit note'),
    col(),
    f('Check', 'interchangeable', 'Interchangeable', { description: 'New revision can replace the old one without other changes.' }),
    sec('Inventory proposal'),
    f('Table', 'inventory', 'Inventory proposal', { options: 'ECR Inventory Line' }),
    sec('Supplier quotes'),
    f('Table', 'supplier_quotes', 'Supplier quotes', { options: 'ECR Supplier Quote' }),

    // ---- Cost page
    tab('Cost page'),
    ...costTable('cost_production', 'Production'),
    ...costTable('cost_retrofit', 'Retrofit'),
    ...costTable('cost_logistics', 'Logistics support'),
    ...costTable('cost_other', 'Other'),
    sec('Net cost impact'),
    f('Currency', 'net_one_time', 'One-time', { read_only: 1, bold: 1 }),
    col(),
    f('Currency', 'net_recurring', 'Recurring', { read_only: 1, bold: 1 }),
    col(),
    f('Currency', 'net_total', 'Net total', { read_only: 1, bold: 1, description: 'Rows marked Not provided stay blank until someone fills them. Savings are negative.' }),

    // ---- Review and decision
    tab('Review and decision'),
    sec('Routing'),
    f('Table MultiSelect', 'routed_to', 'Routed to', { options: 'ECR Routing', description: 'Functions the CM analyst asked for an impact input.' }),
    sec('CCB decision'),
    f('Date', 'ccb_meeting', 'CCB meeting', { permlevel: 2 }),
    f('Text', 'decision_note', 'Decision and conditions', { permlevel: 2 }),
  ]),
  permissions: [
    // Everyone reads every field. Only the Norn integration writes permlevel 1; the CM analyst and chair write permlevel 2.
    { role: ROLES.designer, ...R },
    { role: ROLES.designer, read: 1, write: 1, create: 1, if_owner: 1 },
    { role: ROLES.cm, ...RWC },
    { role: ROLES.member, ...R },
    { role: ROLES.chair, ...RW },
    { role: ROLES.viewer, ...R },
    { role: ROLES.norn, ...RW },
    { role: ROLES.releaser, read: 1 },
    ...[ROLES.designer, ROLES.cm, ROLES.member, ROLES.chair, ROLES.viewer].map((role) => ({ role, permlevel: 1, read: 1 }) as PermRow),
    { role: ROLES.norn, permlevel: 1, read: 1, write: 1 },
    ...[ROLES.designer, ROLES.member, ROLES.viewer, ROLES.norn].map((role) => ({ role, permlevel: 2, read: 1 }) as PermRow),
    { role: ROLES.cm, permlevel: 2, read: 1, write: 1 },
    { role: ROLES.chair, permlevel: 2, read: 1, write: 1 },
    sysman,
    { role: 'System Manager', permlevel: 1, read: 1, write: 1 },
    { role: 'System Manager', permlevel: 2, read: 1, write: 1 },
  ],
  props: {
    module: MODULE,
    track_changes: 1,
    sort_field: 'modified',
    sort_order: 'DESC',
    search_fields: 'title,program,priority',
    title_field: 'title',
    show_title_field_in_link: 1,
  },
  links: [
    { link_doctype: 'ECO', link_fieldname: 'ecr', group: 'Release' },
    { link_doctype: 'NCR', link_fieldname: 'linked_ecr', group: 'Changes' },
  ],
};

// ---------------------------------------------------------------- ECO

const eco: DocTypeDef = {
  name: 'ECO',
  autoname: 'ECO-.####',
  fields: finish([
    sec('Release'),
    f('Link', 'ecr', 'Released from (ECR)', { options: 'ECR', reqd: 1, unique: 1, in_list_view: 1, in_standard_filter: 1, set_only_once: 1 }),
    f('Data', 'title', 'Title', { reqd: 1, in_list_view: 1, bold: 1, length: 240 }),
    f('Select', 'program', 'Program', { options: opts(PROGRAMS_OR_BOTH), in_list_view: 1, in_standard_filter: 1 }),
    col(),
    f('Select', 'status', 'Status', { options: opts(['Released', 'Cancelled']), default: 'Released', reqd: 1, in_list_view: 1, in_standard_filter: 1 }),
    f('Date', 'released_on', 'Release date', { reqd: 1, default: 'Today', in_list_view: 1 }),
    f('Link', 'released_by', 'Released by', { options: 'User', default: '__user', in_list_view: 1 }),
    f('Select', 'decided_by', 'Decided by', { options: opts(['CCB', 'Fast track'], true), in_standard_filter: 1 }),
    col(),
    f('Select', 'company_class', 'Company class', { options: opts(CLASSES, true) }),
    f('Select', 'faa_class', 'FAA class', { options: opts(FAA, true) }),
    f('Select', 'justification_code', 'Justification code', { options: opts(JUSTIFICATION, true) }),
    sec('Summary'),
    f('Text', 'summary', 'What was released'),
    sec('Affected items'),
    f('Table', 'affected_items', 'Affected items', { options: 'ECO Affected Item' }),
    sec('Effectivity'),
    f('Select', 'production_basis', 'Production cut-in by', { options: opts(EFFECTIVITY_BASIS, true) }),
    f('Data', 'production_from', 'Cut-in at'),
    f('Small Text', 'production_note', 'Production note'),
    col(),
    f('Select', 'retrofit_basis', 'Retrofit by', { options: opts(EFFECTIVITY_BASIS, true) }),
    f('Data', 'retrofit_from', 'Retrofit from'),
    f('Data', 'retrofit_to', 'Retrofit to'),
    col(),
    f('Check', 'interchangeable', 'Interchangeable'),
    sec('Dates'),
    f('Link', 'originator', 'Originator', { options: 'User' }),
    f('Date', 'filed_on', 'ECR filed on'),
    col(),
    f('Date', 'approved_on', 'Approved on'),
    sec('Post-release review', { collapsible: 1, description: 'Forecast at approval against what happened. Filled in after cut-in.' }),
    f('Currency', 'forecast_unit_cost_delta', 'Forecast unit cost change'),
    f('Currency', 'forecast_one_time_cost', 'Forecast one-time cost'),
    f('Date', 'forecast_cut_in_date', 'Forecast cut-in date'),
    f('Int', 'forecast_cut_in_serial', 'Forecast cut-in serial'),
    f('Small Text', 'forecast_notes', 'Forecast notes'),
    col(),
    f('Currency', 'actual_unit_cost_delta', 'Actual unit cost change'),
    f('Currency', 'actual_one_time_cost', 'Actual one-time cost'),
    f('Date', 'actual_cut_in_date', 'Actual cut-in date'),
    f('Int', 'actual_cut_in_serial', 'Actual cut-in serial'),
    f('Small Text', 'variance', 'Why it differed'),
  ]),
  permissions: [
    ...[ROLES.designer, ROLES.member, ROLES.viewer, ROLES.norn].map((role) => ({ role, ...R })),
    { role: ROLES.cm, ...RWC },
    { role: ROLES.chair, ...RWC },
    { role: ROLES.releaser, ...RWC },
    sysman,
  ],
  props: { module: MODULE, track_changes: 1, sort_field: 'modified', sort_order: 'DESC', search_fields: 'title,program' },
};

/** Creation order matters: a DocType must exist before a Link or Table points at it. ECR and NCR link to each other, so NCR.linked_ecr is added in a second pass (setup.ts defers any Link to a DocType that does not exist yet). */
export const DOCTYPES: DocTypeDef[] = [
  partRevision, bomLine, affectedItem, fieldChange, bomChange, supplierQuote, inventoryLine, costLine, ecoAffectedItem,
  reviewFunction, ecrRouting,
  part, ebom, ncr, ecr, eco,
];

export const REVIEW_FUNCTIONS = ['CM analyst', 'Cost engineer', 'Buyer', 'Production planner', 'Cost accountant', 'Quality', 'Certification', 'Manufacturing engineer'];

// ---------------------------------------------------------------- workflow

export const WORKFLOW = {
  name: 'ECR Approval',
  states: [
    { state: 'Draft', style: 'Inverse', edit: ROLES.designer },
    { state: 'Submitted', style: 'Info', edit: ROLES.cm },
    { state: 'In CM Review', style: 'Primary', edit: ROLES.cm },
    { state: 'CCB Review', style: 'Warning', edit: ROLES.chair },
    { state: 'Approved', style: 'Success', edit: ROLES.chair, stamp: true },
    { state: 'Rejected', style: 'Danger', edit: ROLES.chair, stamp: true },
    { state: 'Sent Back', style: 'Warning', edit: ROLES.designer },
  ],
  transitions: [
    { state: 'Draft', action: 'Submit', next: 'Submitted', allowed: ROLES.designer, self: 1 },
    { state: 'Submitted', action: 'Start CM review', next: 'In CM Review', allowed: ROLES.cm },
    { state: 'In CM Review', action: 'Send to CCB', next: 'CCB Review', allowed: ROLES.cm },
    { state: 'In CM Review', action: 'Fast-track approve', next: 'Approved', allowed: ROLES.cm, condition: "doc.company_class == 'Class II' and doc.faa_class == 'Minor'" },
    { state: 'In CM Review', action: 'Send back', next: 'Sent Back', allowed: ROLES.cm },
    { state: 'CCB Review', action: 'Approve', next: 'Approved', allowed: ROLES.chair },
    { state: 'CCB Review', action: 'Reject', next: 'Rejected', allowed: ROLES.chair },
    { state: 'CCB Review', action: 'Send back', next: 'Sent Back', allowed: ROLES.chair },
    { state: 'Sent Back', action: 'Resubmit', next: 'Submitted', allowed: ROLES.designer, self: 1 },
  ],
};
