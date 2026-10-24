# Server Script: ECR and ECO, Before Discard.
# Every ECR and ECO has docstatus 0, so Frappe's whitelisted Document.discard() applies to all of
# them. It needs only write permission, skips Before Validate and the workflow, and sets docstatus 2:
# an Approved ECR would still read Approved but reject every later save, and an ECO could be
# cancelled while its ECR keeps the release link. Nobody discards change records here; they are
# deleted by Administrator if at all. Norn Integration, the release bot, CM Analyst and CCB Chair
# all hold write permission, so this refuses everyone but Administrator.
if frappe.session.user != "Administrator":
    frappe.throw("Change records cannot be discarded.", frappe.PermissionError)
