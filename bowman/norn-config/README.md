# Bowman's configuration of Norn

How Norn is tuned for Bowman. Norn is general (#34); this is the one place that makes it Bowman's.
Written 2026-10-24, before the file existed.

The configuration is a file in the repo, checked against Norn's config schema when Norn starts.
There is no settings screen: changing Bowman's setup is a reviewed change to this file, which is
also how a real deployment team would keep it.

## What it sets

- **Vocabulary.** The names Bowman's people see: NCR, ECR, ECO, CCB, impact assessment.
- **The ECR form.** Bowman's fields, modelled on the defense ECP (#6): class, justification code,
  priority, affected items, effectivity, and the cost page (production, retrofit, logistics
  support, other; one-time and recurring).
- **Change classes** and how they're assigned (#33): company Class I or II, and FAA major or minor,
  set separately.
- **The approval matrix.** Who approves what: the fast track for small changes, and the CCB tiers
  by cost. The published tiers of $150,000 and $2,000,000 (`docs/IN-PRACTICE.md`) are the
  starting point, plus the kinds of change that never fast-track.
- **Roles and people.** Who can file, review and approve each kind of change.
- **Agent autonomy** (#22, #24). Per kind of action (approve a fast-track ECR, write a BOM, post a
  journal entry), whether Norn's agents may approve, approve with a sampled second check,
  recommend only, or escalate. An agent acting for a person is also held to that person's limits.
- **Review depth** (#10, #26). Whether the full impact assessment starts on its own for some kinds
  of change, and how many deep passes an ECR may use.
- **Materiality** (#30). How big a difference must be before Norn raises it.
- **Posting standards** (#35). What every agent post must contain before it goes up: cited sources,
  evidence colours, ICD 203 likelihood words.

Issues: label `area: bowman`.
