# Server Script: File, Before Insert and Before Save (one file, two scripts). Before Insert does not
# run again on update, so without Before Save Norn could make an unattached File and then point its
# attached_to_doctype / attached_to_name at a change record.
# The Norn Integration user holds document-level write on the ECR (Frappe needs it for the impact
# fields), and attaching a file only checks that right. So files are refused here for the user that
# must not change change records. Same 403 as the ECR guard.
NORN = "norn@bowman-aviation.example"
RECORDS = ["ECR", "NCR", "ECO", "Part", "Engineering BOM"]
if frappe.session.user == NORN and doc.attached_to_doctype in RECORDS:
    frappe.throw("The Norn integration cannot attach files to " + doc.attached_to_doctype + " records.", frappe.PermissionError)
