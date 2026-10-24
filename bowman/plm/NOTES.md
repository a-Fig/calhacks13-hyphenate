# Bowman PLM: notes

Written 2026-10-24 (Saturday). Bowman's PLM, standing in for Siemens Teamcenter. Part of Bowman's world, never pitched (#19, #21). Norn talks to it only through REST, webhooks and comments.

## EBOM and MBOM

The PLM holds the **EBOM**, the aircraft as designed: the Engineering BOM records here (47 assemblies, 257 lines, labelled "Engineering BOM (EBOM)" in the sidebar, the list and the home page; the DocType keeps the name `Engineering BOM` because that is its API path). **ERPNext holds the MBOM** (#70, built separately): the same parts, with the top level regrouped into build stations. Norn never writes to the ERP (#71, #72); changes reach it by people or by the plant's own gateway. `verify.ts` checks that the PLM's EBOM equals `bowman/data`'s `bom` line for line (assembly, find number, part, quantity). #69.

## What runs where

A second Frappe site (Frappe v16.53.0, `frappe/erpnext:v16.52.1` image, only the `frappe` app installed) on Tyler's home-server Mac, compose project `bowman-plm`, directory `~/bowman/plm`, port `127.0.0.1:8082`. The ERP (`bowman-erp`, 8081) is a separate stack: its own database, Redis and volumes. Nothing of it was touched.

```
ENV_FILE=<repo>/.env bash bowman/plm/up.sh          # copy compose.yml, start (idempotent), install the brand files
bash bowman/plm/up.sh stop | status | tunnel | brand
ENV_FILE=<repo>/.env node bowman/plm/setup.ts       # roles, DocTypes, workflow, scripts, Norn user, webhooks, branding, home
ENV_FILE=<repo>/.env node bowman/plm/seed.ts        # from bowman/data/bowman.json, over REST
ENV_FILE=<repo>/.env node bowman/plm/verify.ts      # the real-path checks below
ENV_FILE=<repo>/.env node bowman/plm/screenshots.ts <label>
```

`ENV_FILE` is only needed outside the main checkout (the default is the repo-root `.env`). `npm install` in `bowman/plm` once for `playwright-core`; screenshots use the installed Edge.

Order from empty: `up.sh`, tunnel, `setup.ts`, `seed.ts`. All three re-run safely. `seed.ts --reset` deletes every ECO, ECR and NCR first (development only); `--skip ECR-0417` and `--only ECR-0417` choose which open ECRs are filed, so the demo ECR can be filed on stage; `--live` leaves the webhooks on while seeding (by default they are paused and restored, so Norn is not sent 40 historical events).

## Tunnel and login

`ssh -N -L 8082:127.0.0.1:8082 <BOWMAN_PLM_SSH>` (or `up.sh tunnel`). Browse **http://localhost:8082**, not 127.0.0.1: the ERP is at 127.0.0.1:8081 and a browser shares cookies across ports of one host, so the two would log each other out.

| Who | Login | Password |
|---|---|---|
| Administrator | `Administrator` | `PLM_ADMIN_PASSWORD` in `.env` |
| Any of Bowman's 18 people | their `@bowman-aviation.example` address from the dataset | one generated value, `PLM_USER_PASSWORD` in `.env` |
| Norn | `norn@bowman-aviation.example` | API key and secret only: `PLM_API_KEY`, `PLM_API_SECRET` |

Useful people: Jeff Hargrove (design engineer, filed ECR-0417), Dana Okafor (CM analyst), Rafael Quintero (CCB chair). `.env` keys the PLM adds: `PLM_URL`, `PLM_ADMIN_PASSWORD`, `PLM_API_KEY`, `PLM_API_SECRET`, `PLM_USER_PASSWORD`, `PLM_WEBHOOK_SECRET`, optional `NORN_WEBHOOK_URL`, `BOWMAN_PLM_SSH` (falls back to `BOWMAN_ERP_SSH`, the same Mac). Never printed by any script.

## What is in it (seeded 2026-10-24)

| | Count |
|---|---|
| Users | 18 people, `norn@`, `eco-release@` (a bot used only by the release automation) |
| Parts | 214 (211 Released, 3 Proposed), with revision history |
| Engineering BOMs | 47 assemblies, 257 lines. Vesper V4 top `EBOM-BW-0001-000` (12 lines), Meridian M6 top `EBOM-BW-M000-000`. One record per assembly; the form's **Full structure** button shows the indented multi-level tree |
| NCRs | 5 (NCR-0112, 0113, 0115, 0119 closed to their ECR; NCR-0124 open, no ECR) |
| ECRs | 20: ten open as in the dataset (nine Submitted, ECR-0412 In CM Review) and ten Approved ECRs, one per released ECO |
| ECOs | 10, ECO-0231 to ECO-0318, each with forecast and actual in the collapsed "Post-release review" section |

ECR-0417, ECR-0409 and ECR-0423 are Submitted, as in the dataset. Naming series continue after the dataset: next ECR-0424, NCR-0125, ECO-0319. The ten Approved ECRs are stubs built from the ECO's own facts (title, class, affected items, summary); the dataset keeps nothing else about them.

## Data model (custom DocTypes in module "Bowman PLM")

Field shapes follow `bowman/data/types.ts`; enumerations keep the dataset's value sets but are spelled for readers:

| Dataset | PLM |
|---|---|
| priority `emergency/urgent/routine` | `Emergency`, `Urgent`, `Routine` |
| companyClass `I`/`II` | `Class I`, `Class II` |
| faaClass `minor/major` | `Minor`, `Major` |
| justificationCode `B C D O P R S V` | unchanged |
| program `vesper`, `meridian` (arrays on items and ECOs) | `Vesper V4`, `Meridian M6`, `Both programs` |
| effectivity basis `serial/date/lot/tbd` | `Serial`, `Date`, `Lot`, `TBD` |
| cost basis `supplier_quote/engineer_estimate/not_provided` | `Supplier quote`, `Engineer estimate`, `Not provided` |
| inventory location and disposition | `Stores`, `WIP`, `Finished goods`, `Supplier finished`, `On order`, `In field`; `Use until depleted`, `Mandatory install`, `Rework`, `Scrap`, `Cancel`, `TBD` |
| `ItemChange.changes[]` `{field, from, to}` | `field_changes` rows `{part, field, from_value, to_value}` (values as text) |
| `SupplierQuote.lines[]` | `supplier_quotes` rows, one per line, quote header repeated (`quote_id`, `supplier`, `valid_until`, `lead_time_weeks`) plus `firmness`: `Firm` or `Budgetary`. The dataset has no such field: a quote is Budgetary where its own note says so (ECR-0409's Halvorsen quote, "Budgetary, plus or minus 20%"), Firm otherwise |

- **Part** `part_number` (the record name), `part_name`, `revision`, `lifecycle_state` (Proposed/Released/Obsolete), `make_buy`, `kind`, `program`, `design_owner`, `safety_critical`, `uom`, `default_supplier`, `revision_history` rows `{revision, released_on, eco, note}`. The dataset has no owner: `design_owner` is invented by area, and the originator of an open ECR owns the parts it revises. The form's Connections show the part's BOM, where it is used, and ECRs and NCRs that touch it.
- **Engineering BOM** named `EBOM-<part>`: `part`, `status`, `line_count`, `lines` rows `{seq, part, qty, ...fetched name, revision, uom, make_buy}`.
- **NCR** `NCR-nnnn`: `part`, `part_revision`, `location_found`, `quantity_affected`, `status`, `opened_on`, `opened_by`, `description`, `mrb_disposition`, `linked_ecr`.
- **ECR** `ECR-nnnn`, five tabs:
  - *Request*: title, program, originator, filed on, needed by, originating NCR, ECP revision, status, **released ECO** (`released_eco`, a read-only Link to the ECO; permission level 3: everyone reads it including Norn, only the release automation writes it), priority, justification code, company class, FAA class, FAA rationale, classification note, description, need, consequences of disapproval, alternatives, failure data, test and requalification.
  - *Impact assessment* (below).
  - *Affected items*: `affected_items` `{part, change_type, from_revision, to_revision}`, `field_changes`, `bom_changes`, effectivity (`production_basis/from/note`, `retrofit_basis/from/to/note`, `interchangeable`), `inventory`, `supplier_quotes`.
  - *Cost page*: four tables, `cost_production`, `cost_retrofit`, `cost_logistics`, `cost_other`, rows `{label, basis, one_time, unit_cost, quantity, recurring_total, line_total, note}`, then `net_one_time`, `net_recurring`, `net_total`. Totals are computed on the server (one-time plus unit cost times quantity; savings negative; "Not provided" rows count as zero, so ECR-0417 reads $87,605 until the blank rows are filled).
  - *Review and decision*: `routed_to` (the functions the CM analyst asked for input), `ccb_meeting`, `decision_note`.
- **ECO** `ECO-nnnn`: `ecr`, `title`, `status`, `released_on`, `released_by`, `decided_by` (CCB or Fast track), classes, `affected_items`, effectivity, forecast and actual.

**Impact assessment** (ECR fields, permission level 1, so people see them read-only): `impact_report_level` (`1`, `2`, `3`), `impact_recommendation` (`Approve`, `Approve with conditions`, `Send back`, `Reject`), `impact_change_class` (`Class I`/`Class II`), `impact_approval_route` (free text), `impact_norn_url`, `impact_updated_on`, `impact_statement` (rich text; the sanitiser kept tables, headings, bold, lists, links and inline colour in the test). A one-line summary of these sits above the tabs on every ECR, with an "Open in Norn" button.

## Workflow "ECR Approval"

Draft, Submitted, In CM Review, CCB Review, Approved, Rejected, Sent Back.

| From | Action | To | Who |
|---|---|---|---|
| Draft | Submit | Submitted | Design Engineer |
| Submitted | Start CM review | In CM Review | CM Analyst |
| In CM Review | Send to CCB | CCB Review | CM Analyst |
| In CM Review | Fast-track approve | Approved | CM Analyst, only Class II and FAA Minor |
| In CM Review, CCB Review | Send back | Sent Back | CM Analyst, CCB Chair |
| CCB Review | Approve, Reject | Approved, Rejected | CCB Chair |
| Sent Back | Resubmit | Submitted | Design Engineer |

Approval releases the ECO in two steps, both as the release-automation user (`eco-release@`): the transition runs the `ecr.approved` webhook as a workflow task, which POSTs the new ECO to the PLM's own REST API; the ECO's insert then fires `eco.link-back`, a second self-webhook that PUTs `released_eco` onto the ECR. Frappe's sandbox cannot write two documents from one hook, so the link-back is a chained second step, normally within a second or two. It also moves the ECR's `modified` and `modified_by` to the bot, so a poller of ECRs reports the release and can tell it from Norn's own writes. Until then the ECR is Approved with an empty `released_eco`. `released_by` is the approver. Only the release automation and Administrator create ECOs: CM Analyst and CCB Chair can read and edit one (post-release review fields) but not create one, and the guard lets the bot set `released_eco` only to the ECO whose `ecr` is that ECR, and only while the ECR is Approved. Without both, a person could insert an ECO against an ECR still awaiting the CCB and the link-back webhook would write it onto the ECR with the bot's credentials, which permission level 3 was meant to prevent (a review finding on PR #81, closed 2026-10-24). A second route, `Document.discard()` through `run_doc_method`, needs only write permission, skips the guard and the workflow and sets docstatus 2 (every ECR and ECO has docstatus 0), so Norn could cancel an Approved ECR or a CM analyst an ECO whose ECR keeps the link. Frappe v16 has a Before Discard Server Script event, `Document.rename(force=True)` is the same kind of hole: it ignores `allow_rename`, skips the guard and changes a record's name, so the release bot could rename an Approved ECR. Frappe v16 has Before Discard and Before Rename Server Script events, and one file, `server-scripts/no-discard-or-rename.py`, is applied to both on Part, Engineering BOM, NCR, ECR and ECO (ten scripts, "<DocType>: no discard" and "<DocType>: no rename") and refuses everyone but Administrator. The other whitelisted `Document` methods in v16 (`submit`, `cancel`, `add_comment`) were checked on a throwaway ECR as Norn: `submit` is refused (403), `cancel` of a draft is refused (417, invalid docstatus change); `add_comment` only inserts a Comment, which for Norn the author script already controls, and changes no identity or docstatus. Roles: Design Engineer (reads all; creates and edits their own ECRs), CM Analyst, CCB Member (reads; files NCRs), CCB Chair, PLM Viewer (the CFO, read-only), Norn Integration, ECO Release Automation. Role of each person comes from the dataset's seat and CCB role; anyone who files an ECR (the cost engineer files three) also gets Design Engineer.

## The Norn user and its permissions

`norn@bowman-aviation.example`, role Norn Integration, token auth: `Authorization: token <PLM_API_KEY>:<PLM_API_SECRET>`.

- Reads Part, Engineering BOM, NCR, ECR, ECO and comments. It does not read the CCB's decision note or meeting date on the ECR (permission level 2), nor the version history, which would show them.
- Writes only the seven impact fields on an ECR, and adds comments. It cannot create, delete, rename, attach files to, assign or transition anything, and cannot write any other DocType.
- Frappe needs document-level write for the PUT to be accepted, so a Server Script ("ECR: Norn writes only the impact assessment", `server-scripts/ecr-guard.py`) compares the saved and incoming document and refuses any other change with 403. People are limited by permission level, not by that script. Operations that need only the write right, not a save, are closed separately: `allow_rename` is off on every PLM DocType (a forced rename is refused by the Before Rename script above), and Before Insert Server Scripts refuse Norn's File and ToDo rows against change records (403) and overwrite the author of Norn's comments with Norn (and refuse comments of any type but Comment), so a spoofed `comment_by` lands as Norn.
- Norn's own writes do not fire the ECR webhook back at it (the hook's condition skips `modified_by` = Norn). `impact_updated_on` is stamped by the server when Norn does not send it.

## Webhooks

Five, named by their `X-Bowman-PLM-Event` header: `ncr.inserted`, `ncr.updated`, `ecr.inserted`, `ecr.updated`, `eco.released`. **They are disabled until `NORN_WEBHOOK_URL` is set in `.env` and `setup.ts` is re-run** (Norn's receiver does not exist yet). Delivery: `POST`, `Content-Type: application/json`, header `X-Frappe-Webhook-Signature` = base64 HMAC-SHA256 of the raw body with `PLM_WEBHOOK_SECRET`, three tries over about 5 seconds. Body (the ECR's document leaves out `decision_note` and `ccb_meeting`):

```
{ "event": "ecr.updated", "doctype": "ECR", "name": "ECR-0417", "modified": "...", "modified_by": "dana.okafor@...",
  "workflow_state": "Submitted", "doc": { ...the whole document with its child tables... } }
```

Filing an ECR sends `ecr.inserted` (state Draft) and then `ecr.updated` for each workflow step, so Norn learns "Submitted" from an `ecr.updated` with `workflow_state: "Submitted"`. Failed deliveries are in the desk under Webhook Request Log.

## Verified calls (`verify.ts`, 38 checks, 2026-10-24, all passed)

As Norn:

1. `GET /api/resource/Part/BW-5120-000` then `GET /api/resource/Engineering BOM/EBOM-BW-5120-000` (URL-encode the space): the bracket's parent assembly and its three lines, one of them `BW-5120-210`.
2. `GET /api/resource/ECR/ECR-0417`: Submitted, Urgent, Class I / Minor, `affected_items: [{part: "BW-5120-210", change_type: "Revise", from_revision: "B", to_revision: "C"}]`, `originating_ncr: "NCR-0119"`.
3. `PUT /api/resource/ECR/ECR-0417` with `{impact_report_level: "1", impact_recommendation: "Approve with conditions", impact_change_class: "Class I", impact_approval_route: "CCB, 2026-11-12", impact_norn_url: "...", impact_statement: "<html>"}` returned 200; nothing else on the ECR changed. (The text written is labelled a test posting, and was cleared afterwards.)
4. Refused: `PUT` of `description`, `priority`, `workflow_state` or a cost row (403 "may write only the impact assessment fields"); `POST /api/resource/ECR` (403); `DELETE` the ECR (403); `PUT /api/resource/Part/BW-5120-210` (403); `apply_workflow` Approve (417). ECR-0417 was identical afterwards.
5. `POST /api/resource/Comment {comment_type: "Comment", reference_doctype: "ECR", reference_name: "ECR-0417", content}` returned 200.
6. Webhook: with the hooks pointed at a throwaway receiver on the Mac's PLM network (`webhook-sink.mjs`), Dana's edit of ECR-0417 delivered `ecr.updated` with a valid signature; Norn's own `PUT` delivered nothing.
7. Approval: a temporary ECR went Draft to Approved through four people; ECO-0319 appeared, released by Rafael. ECR and ECO were deleted and the naming series put back.
9. `released_eco`: a throwaway ECR approved through four people carried `released_eco` = its ECO on the first read after the ECO appeared, with `modified_by` = the release bot; Norn read it, and its own `PUT` of the field was ignored (Frappe drops writes to a permission level the user cannot write). The link was cleared, the ECO and ECR deleted, the series restored. Also checked: the PLM's EBOM equals `bowman/data`'s `bom` line for line, and quote firmness (ECR-0409 Budgetary, ECR-0417 Firm).
10. Bypass of `released_eco` through ECO creation: on a throwaway ECR left In CM Review, Dana (CM analyst) and Rafael (chair) POSTing an ECO get 403 (before the fix, Dana got 200 and the ECR was linked); an ECO made as Administrator on that unapproved ECR is not linked by the bot (the guard refuses the write). ECR, ECO and the series cleaned up as in 7.
11. `discard`: `run_doc_method` with `method: discard` as Norn on an ECR and as a CM analyst on an ECO returns 403 and leaves docstatus 0 (before the fix, 200 and docstatus 2). Throwaway records, deleted, series restored.
12. Forced rename: `run_doc_method` with `method: rename` and `args: {name, force: true}` as the release bot on an ECR and as a CM analyst on an NCR returns 403 and the names are unchanged (before the fix, 200 and both were renamed). Throwaway records deleted, series restored.
8. Holes an Opus review found, each reproduced with the Norn token and now refused (on a throwaway ECR made as Administrator): `rename_doc` (417), `upload_file` against the ECR (403), `assign_to.add` (403), a comment sent as another user (stored as Norn), a comment of type Edit (refused), a read of `decision_note` and `ccb_meeting` (absent), and the version history (403).

Screenshots in `screenshots/`, taken as Rafael through the tunnel: `before-*` (ECR-0417 with no assessment) and `after-*` (after the Norn write above): `ecr-list`, `ecr-0417-request`, `-impact`, `-affected`, `-cost`, plus `home`, `part-list`, `part-bracket`, `ebom-vesper`, `ncr-list`, `eco-list`.

## Design calls

- **Frappe custom DocTypes, no custom app.** Everything is data applied over REST, so setup re-runs. The price is the sandbox: Server Scripts cannot create other documents, which is why ECO release is a webhook the PLM sends to itself.
- **Server Scripts are enabled bench-wide** (`server_script_enabled` in this stack's `common_site_config.json`; Frappe reads it nowhere else). Small scripts: Norn's guard, the cost totals, the BOM line count, and the discard and rename block on the five DocTypes.
- **One Engineering BOM record per assembly**, not one document with 257 lines; this is how a PLM stores a structure, and the tree is walked by the "Full structure" button.
- **The desk theme** is a CSS and JS file in the site's public files, registered through `app_include_css/js` in `common_site_config.json` by `up.sh brand` (no custom app). Petrol sidebar and amber rule against the ERP's black and white. `/desk` redirects to the PLM home because Frappe's empty app grid is all that would show.
- **Webhook payload carries the whole document**, so Norn does not need a second call; it can still `GET` the record.
- **`decided_by` on an auto-released ECO** is "Fast track" for Class II and Minor, otherwise "CCB". The workflow cannot tell which approval button was used.
- Historical Approved ECRs are stubs; `design_owner`, and which ECR has which owner, are invented by area (marked in `seed.ts`).

## Not done or not tested

- Releasing an ECO does not revise the Part record or the BOM. Norn reads the ECO's affected items and writes to the ERP; the PLM's own parts stay at the old revision.
- Creating an ECR does not close its NCR automatically; the seed sets `linked_ecr` and status for the dataset's NCRs.
- Record timestamps (`creation`) are seed time; the real filing date is `filed_on`. Frappe ignores a backdated `creation`.
- Not tested: email notifications (off), file attachments, the workflow's per-state edit lock for each role (the chair sees "not editable" in Submitted; other roles' lock was not exercised), the Meridian tree view, and a rebuild from empty volumes (wiping needs Tyler's OK; `up.sh`, `setup.ts` and `seed.ts` were each re-run on the live stack and the stack was created once from scratch by `up.sh`). `server_script_enabled` was first applied by hand, then moved into `compose.yml`; the compose edit ran once through `up.sh`.
- The Webhook DocType stores the release automation's API key in its header row; it is rotated on every `setup.ts` run.

## Where the written README is out of date

`bowman/plm/README.md` (PR #47) says the tech is open and the starting idea is a second Frappe site; it is decided and built. `CLAUDE.md` says there is no code yet and asks for a Commands block: the block above is the PLM's.
