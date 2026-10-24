// Client Script: Engineering BOM, Form.
// "Full structure" shows the indented, multi-level bill of materials for this assembly, the way a
// PLM structure manager does. Each assembly's own BOM is a separate record; this walks them.
const esc = (s) => frappe.utils.escape_html(s == null ? '' : String(s));

async function load_all_lines() {
  const lines = await frappe.db.get_list('Engineering BOM Line', {
    parent: 'Engineering BOM',
    fields: ['parent', 'seq', 'part', 'part_name', 'revision', 'qty', 'uom', 'make_buy'],
    limit: 0,
    order_by: 'seq asc',
  });
  const by_parent = {};
  lines.forEach((l) => { (by_parent[l.parent] = by_parent[l.parent] || []).push(l); });
  return by_parent;
}

function rows_for(by_parent, bom, depth, seen) {
  const out = [];
  (by_parent[bom] || []).forEach((l) => {
    const child_bom = 'EBOM-' + l.part;
    const expandable = !!by_parent[child_bom] && !seen.includes(child_bom);
    out.push({ ...l, depth, expandable, key: bom + '/' + l.seq });
    if (expandable) out.push(...rows_for(by_parent, child_bom, depth + 1, [...seen, child_bom]));
  });
  return out;
}

function render(rows) {
  const body = rows.map((r) => `
    <tr data-depth="${r.depth}">
      <td style="padding-left:${8 + r.depth * 22}px; white-space:nowrap">
        ${r.expandable ? '<span class="text-muted">▾</span>' : '<span class="text-muted" style="opacity:.3">•</span>'}
        <a href="/desk/part/${encodeURIComponent(r.part)}"><b>${esc(r.part)}</b></a>
      </td>
      <td>${esc(r.part_name)}</td>
      <td>${esc(r.revision)}</td>
      <td class="text-right">${esc(r.qty)}</td>
      <td>${esc(r.uom)}</td>
      <td><span class="indicator-pill ${r.make_buy === 'Make' ? 'blue' : 'gray'}">${esc(r.make_buy)}</span></td>
    </tr>`).join('');
  return `<div style="max-height:60vh;overflow:auto"><table class="table table-sm table-hover">
    <thead><tr><th>Part</th><th>Name</th><th>Rev</th><th class="text-right">Qty</th><th>UoM</th><th>Source</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

frappe.ui.form.on('Engineering BOM', {
  refresh(frm) {
    if (frm.is_new()) return;
    frm.add_custom_button(__('Full structure'), async () => {
      const by_parent = await load_all_lines();
      const rows = rows_for(by_parent, frm.doc.name, 0, [frm.doc.name]);
      const d = new frappe.ui.Dialog({
        title: __('Structure of {0}, {1} lines', [frm.doc.part_name || frm.doc.part, rows.length]),
        size: 'extra-large',
        fields: [{ fieldtype: 'HTML', fieldname: 'tree' }],
      });
      d.fields_dict.tree.$wrapper.html(render(rows));
      d.show();
    });
  },
});
