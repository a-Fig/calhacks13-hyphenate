# Bowman's PLM

The product lifecycle management system where Bowman's engineers keep parts and file changes. It
stands in for Siemens Teamcenter, which Archer runs (#21). Written 2026-10-24, before it was
built.

It's part of Bowman's world, not our product. We build it only because no open-source PLM we
could run this weekend fits (`docs/research/software-options.md`), and we never pitch it (Tyler,
#19). It should look and behave like a real PLM, so Norn isn't tested against something built
to suit it: Norn talks to it only through the interfaces a real PLM exposes.

## Responsibilities

- **Parts with revisions,** and the engineering BOM for each assembly.
- **Change records:** NCRs, ECRs and ECOs, with Bowman's ECR form (#6) and the links between them
  (an ECR cites its NCR; an ECO releases an ECR).
- **The approval workflow:** draft, submitted, in review, CCB decision (approve, reject, send back),
  ECO released with its effectivity. Users and roles decide who can do each step.
- **An API and webhooks:** REST reads and writes of parts, BOMs and change records, and a webhook
  to Norn when an NCR or ECR is created or changes.
- **A place for Norn's results:** the impact statement, change class and approval route appear on
  the ECR page, written through the API the way a real integration writes to Teamcenter.

Not its job: CAD, a document vault, MRP or costs (those are ERPNext's), or feature parity with
Teamcenter. We build the features Bowman's change process uses, and stop there.

## Tech

Frappe, ERPNext's own framework, as its own stack with only the framework installed (decided
2026-10-24, #21). It has custom record types, Frappe's workflow engine and roles, and webhooks,
and it's branded "Bowman PLM" so it doesn't look like the ERP. Frappe brings a mature enterprise
UI with forms, list views, workflow buttons, comments and version history, so we copy proven
screens instead of designing them (#50). It runs next to ERPNext on Tyler's home server, on port
8082.

Issues: label `area: plm`.
