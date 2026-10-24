# Server Script: ToDo, Before Insert.
# Assigning a document creates a ToDo and sets _assign on it, and only needs the write right the
# Norn Integration user holds on the ECR. Refuse assignments the Norn user makes on change records.
NORN = "norn@bowman-aviation.example"
RECORDS = ["ECR", "NCR", "ECO", "Part", "Engineering BOM"]
if frappe.session.user == NORN and doc.reference_type in RECORDS:
    frappe.throw("The Norn integration cannot assign " + doc.reference_type + " records.", frappe.PermissionError)
