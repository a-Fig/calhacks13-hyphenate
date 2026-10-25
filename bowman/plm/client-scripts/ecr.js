// Client Script: ECR, Form.
// Puts Fern's impact assessment where the CCB looks first: a one-line summary above the tabs.
// Recomputes the cost page as you type (the server recomputes on save).
const BLOCKS = ['cost_production', 'cost_retrofit', 'cost_logistics', 'cost_other'];

function norn_summary(frm) {
  const d = frm.doc;
  if (!d.impact_report_level && !d.impact_statement) {
    return '<span class="indicator-pill gray">No impact assessment yet</span> <span class="text-muted">Fern posts it on the Impact assessment tab when this ECR is filed.</span>';
  }
  const level = { 1: 'blue', 2: 'orange', 3: 'green' }[d.impact_report_level] || 'gray';
  const when = d.impact_updated_on ? frappe.datetime.comment_when(d.impact_updated_on) : '';
  const bits = [
    `<span class="indicator-pill ${level}">Impact assessment, level ${frappe.utils.escape_html(d.impact_report_level || '?')}</span>`,
  ];
  if (d.impact_recommendation) bits.push(`Fern recommends <b>${frappe.utils.escape_html(d.impact_recommendation.toLowerCase())}</b>`);
  if (d.impact_change_class) bits.push(`proposed <b>${frappe.utils.escape_html(d.impact_change_class)}</b>`);
  if (d.impact_approval_route) bits.push(`route: ${frappe.utils.escape_html(d.impact_approval_route)}`);
  if (when) bits.push(`<span class="text-muted">${when}</span>`);
  return bits.join(' &nbsp;·&nbsp; ');
}

function recalc_row(frm, cdt, cdn) {
  const row = locals[cdt][cdn];
  const recurring = flt(row.unit_cost) * flt(row.quantity);
  frappe.model.set_value(cdt, cdn, 'recurring_total', recurring);
  frappe.model.set_value(cdt, cdn, 'line_total', flt(row.one_time) + recurring);
  recalc_net(frm);
}

function recalc_net(frm) {
  let one = 0, rec = 0;
  BLOCKS.forEach((t) => (frm.doc[t] || []).forEach((r) => {
    one += flt(r.one_time);
    rec += flt(r.unit_cost) * flt(r.quantity);
  }));
  frm.set_value('net_one_time', one);
  frm.set_value('net_recurring', rec);
  frm.set_value('net_total', one + rec);
}

frappe.ui.form.on('ECR', {
  refresh(frm) {
    if (frm.is_new()) return;
    frm.dashboard.set_headline(norn_summary(frm));
    if (frm.doc.impact_norn_url) {
      frm.add_custom_button(__('Open in Fern'), () => window.open(frm.doc.impact_norn_url, '_blank'));
    }
    if (frm.doc.originating_ncr) {
      frm.add_custom_button(__('NCR ' + frm.doc.originating_ncr), () => frappe.set_route('Form', 'NCR', frm.doc.originating_ncr), __('Related'));
    }
  },
});

frappe.ui.form.on('ECR Cost Line', {
  one_time: recalc_row,
  unit_cost: recalc_row,
  quantity: recalc_row,
});
