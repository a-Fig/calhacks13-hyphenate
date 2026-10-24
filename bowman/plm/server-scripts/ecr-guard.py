# Server Script: ECR, Before Validate.
# Two service users are limited to named fields: the Norn Integration user to the impact assessment
# fields, and the ECO release automation to released_eco. Frappe needs each to hold write
# permission on the whole document, so this script is what limits it to those fields: any other
# change (a field, a table row, the workflow status) is refused with a 403.
# The bot's one field is further limited to the ECO that releases an Approved ECR (see below).
# It also stamps "Last updated" when the impact assessment changes and Norn did not send a time.
# Keep IMPACT in step with IMPACT_FIELDS in model.ts.
NORN = "norn@bowman-aviation.example"
IMPACT = [
    "impact_report_level", "impact_recommendation", "impact_change_class", "impact_approval_route",
    "impact_norn_url", "impact_updated_on", "impact_statement",
]
BOT = "eco-release@bowman-aviation.example"
SKIP = ["modified", "modified_by", "creation", "owner"]
LIMITS = {NORN: IMPACT, BOT: ["released_eco"]}
user = frappe.session.user
limit = LIMITS.get(user)

before = doc.get_doc_before_save()

if limit and not before:
    frappe.throw("This service user cannot create ECRs.", frappe.PermissionError)

if before:
    old = before.as_dict()
    new = doc.as_dict()
    bad = []
    for key in new:
        if key in SKIP or (limit and key in limit):
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

    if limit and bad:
        frappe.throw(
            "This integration may write only " + ("the impact assessment fields" if user == NORN else "released_eco") + ". Not allowed to change: "
            + ", ".join(sorted(set(bad))),
            frappe.PermissionError,
        )

    # The release bot may set released_eco only to the ECO that releases this ECR, and only once it is Approved.
    if user == BOT and old.get("released_eco") != new.get("released_eco"):
        if doc.workflow_state != "Approved" or not doc.released_eco or frappe.db.get_value("ECO", doc.released_eco, "ecr") != doc.name:
            frappe.throw("released_eco must be the ECO of this ECR, and the ECR must be Approved.", frappe.PermissionError)

    changed = [k for k in IMPACT if k != "impact_updated_on" and old.get(k) != new.get(k)]
    if changed and old.get("impact_updated_on") == new.get("impact_updated_on"):
        doc.impact_updated_on = frappe.utils.now_datetime()
