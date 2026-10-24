# Server Script: ECR, Before Validate.
# The Norn Integration user may write only the impact assessment fields. Frappe needs it to hold
# write permission on the whole document, so this script is what limits it to those fields: any
# other change (a field, a table row, the workflow status) is refused with a 403.
# It also stamps "Last updated" when the impact assessment changes and Norn did not send a time.
# Keep IMPACT in step with IMPACT_FIELDS in model.ts.
NORN = "norn@bowman-aviation.example"
IMPACT = [
    "impact_report_level", "impact_recommendation", "impact_change_class", "impact_approval_route",
    "impact_norn_url", "impact_updated_on", "impact_statement",
]
SKIP = ["modified", "modified_by", "creation", "owner"]

before = doc.get_doc_before_save()

if frappe.session.user == NORN and not before:
    frappe.throw("The Norn integration cannot create ECRs.", frappe.PermissionError)

if before:
    old = before.as_dict()
    new = doc.as_dict()
    bad = []
    for key in new:
        if key in SKIP or key in IMPACT:
            continue
        a = old.get(key)
        b = new.get(key)
        if isinstance(b, list):
            if len(b) != len(a or []):
                bad.append(key)
                continue
            for i in range(len(b)):
                for k in b[i]:
                    if k not in SKIP and b[i].get(k) != a[i].get(k):
                        bad.append(key)
        elif a != b:
            bad.append(key)

    if frappe.session.user == NORN and bad:
        frappe.throw(
            "The Norn integration may write only the impact assessment fields. Not allowed to change: "
            + ", ".join(sorted(set(bad))),
            frappe.PermissionError,
        )

    changed = [k for k in IMPACT if k != "impact_updated_on" and old.get(k) != new.get(k)]
    if changed and old.get("impact_updated_on") == new.get("impact_updated_on"):
        doc.impact_updated_on = frappe.utils.now_datetime()
