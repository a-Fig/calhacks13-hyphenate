// Client Script: Part, Form. Jump to the part's own bill of materials when it has one.
frappe.ui.form.on('Part', {
  refresh(frm) {
    if (frm.is_new()) return;
    frappe.db.exists('Engineering BOM', 'EBOM-' + frm.doc.name).then((has) => {
      if (has) frm.add_custom_button(__('Bill of materials'), () => frappe.set_route('Form', 'Engineering BOM', 'EBOM-' + frm.doc.name));
    });
  },
});
