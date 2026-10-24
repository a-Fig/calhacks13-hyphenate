# Server Script: Comment, Before Insert.
# A comment shows the author in comment_by and comment_email, which the sender can set. Whatever
# the Norn Integration user sends, its comments are shown as Norn's, and only plain comments are
# allowed (not the system's own Edit, Workflow or Assignment entries).
NORN = "norn@bowman-aviation.example"
if frappe.session.user == NORN:
    if doc.comment_type != "Comment":
        frappe.throw("The Norn integration may add only plain comments.", frappe.PermissionError)
    doc.comment_email = NORN
    doc.comment_by = frappe.get_fullname(NORN)
