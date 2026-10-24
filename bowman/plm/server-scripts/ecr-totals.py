# Server Script: ECR, Before Save.
# Cost page arithmetic, the ECP way: each row is a one-time cost plus unit cost x quantity
# (recurring). Savings are negative. Rows nobody filled in ("Not provided") count as zero.
flt = frappe.utils.flt
one_time = 0
recurring = 0
for table in ["cost_production", "cost_retrofit", "cost_logistics", "cost_other"]:
    for row in doc.get(table):
        rec = flt(row.unit_cost) * flt(row.quantity)
        row.recurring_total = rec
        row.line_total = flt(row.one_time) + rec
        one_time += flt(row.one_time)
        recurring += rec
doc.net_one_time = one_time
doc.net_recurring = recurring
doc.net_total = one_time + recurring
