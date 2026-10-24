# Server Script: every Bowman DocType (Part, Engineering BOM, NCR, ECR, ECO), Before Discard and
# Before Rename. One file, applied to both events.
# Frappe's whitelisted Document.discard() and Document.rename() need only write permission. Both
# skip Before Validate and the workflow: discard sets docstatus 2 (every record here has docstatus
# 0, so an Approved ECR would still read Approved but reject every later save), and rename with
# force=True ignores allow_rename and changes the record's identity. Norn Integration, the release
# bot, CM Analyst and CCB Chair all hold write on some of these, so this refuses everyone but
# Administrator. Both events run before anything is changed.
if frappe.session.user != "Administrator":
    frappe.throw("Change records and parts cannot be discarded or renamed.", frappe.PermissionError)
