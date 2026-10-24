// Client Script: Engineering BOM, List view. The PLM's Engineering BOM is the EBOM, the aircraft as
// designed; ERPNext holds the MBOM. The DocType's name stays "Engineering BOM" (the API path), so
// the title says what it is.
frappe.listview_settings['Engineering BOM'] = Object.assign(frappe.listview_settings['Engineering BOM'] || {}, {
  onload(listview) { listview.page.set_title(__('Engineering BOM (EBOM)')); },
  refresh(listview) { listview.page.set_title(__('Engineering BOM (EBOM)')); },
});
