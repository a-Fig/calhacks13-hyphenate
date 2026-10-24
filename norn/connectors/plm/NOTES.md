# PLM connector

Written 2026-10-24 for issue #40 (the PLM half; the ERPNext half is `norn/connectors/erpnext/`). Norn's view of a company's PLM: one call returns a change request (ECR) in the shape the checks library reads, a poller and a webhook receiver tell Norn when one is filed or changes, and two writes put Norn's impact assessment back on the ECR. Plain TypeScript on Node 24 (erasable syntax), no runtime dependencies. Nothing in `src/` names a company; a company supplies its spellings as settings (Bowman's: `bowman/norn-config/plm.ts`). The types are imported from `norn/checks/src/types.ts`, not copied.

## Run it

The PLM is on Tyler's home-server Mac, reachable only through the laptop's SSH tunnel on `localhost:8082` (`bowman/plm/up.sh tunnel`; `bowman/plm/NOTES.md` has the rest). The connector reads `PLM_URL`, `PLM_API_KEY` and `PLM_API_SECRET` (the Norn Integration user's token, never Administrator) and `PLM_WEBHOOK_SECRET` from the environment or from `ENV_FILE`, default the `.env` at the repo root. A worktree has no `.env`: point `ENV_FILE` at the main checkout's.

```
cd norn/connectors/plm && npm install       # typescript and @types/node only
npm run typecheck                           # tsc, strict, erasableSyntaxOnly
npm test                                    # offline: 58 tests, a stubbed REST API, no PLM needed
# from the repo root, with the tunnel open (writes to the PLM: see "check.ts" below):
ENV_FILE=<main checkout>/.env node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON norn/connectors/plm/check.ts --config bowman/norn-config/plm.ts
#   --read-only   stop after the reads and the webhook round trip; writes nothing
#   --reference   compare with another dataset file (used for the negative control)
```

`check.ts` also needs `PLM_ADMIN_PASSWORD`, for the throwaway ECR only.

## API (`src/index.ts`)

`opts` is `PlmSettings & PlmConnection` (`src/options.ts`, each field commented): `{ ...plm, ...connectionFromEnv() }`.

```ts
readChangeRequest(opts, 'ECR-0417')      -> { change: PlmChangeRequest, record: EcrRecord, modified }
listEcrs(opts, { since? })               -> EcrListing[]   // { name, title, workflowState, modified, modifiedBy }, oldest change first
watchEcrs(opts, onChange, { intervalMs, since?, stateFile?, overlapMs?, maxAttempts?, onError? })
                                         -> EcrWatcher     // ready(), highWater(), tick(), stop(); onChange only when the assessment inputs changed
verifyWebhook(rawBody, signatureHeader, secret)  -> boolean
createWebhookHandler(secret, onEvent, { plm, eventHeader?, maxBytes?, onError? })  -> (req, res) => void   // onEvent(event, current)
writeImpact(opts, 'ECR-0417', fields)    -> { impact, modified }   // the seven impact_* fields only
postComment(opts, 'ECR-0417', html)      -> { name }
mapEcr(settings, doc, eco?)              // the pure mapping, for a webhook body's `doc`
inputsHash(readResult)                   // fingerprint of what an assessment is made from (everything but the impact fields and the stamps)
connectionFromEnv(), loadEnvFile(), webhookSecretFromEnv()
```

`change` is the checks library's `ChangeRequest`. `record` is what Norn shows and the checks do not use: title, workflow state, originator (the PLM login), priority, company class, FAA class, justification code, ECP revision, originating NCR, the ECO, review functions routed to, dates (filed, needed by, decided, created, modified), the prose (description, need, consequences of disapproval, alternatives, failure data, test and requalification, FAA rationale, classification note), each quote's received and valid-until dates, the impact assessment as it stands, and `warnings` (data that could not be placed). `modified` is the document's stamp when read.

`PlmChangeRequest` is `ChangeRequest & { eco?: string }`. The checks library's `ChangeRequest` has no `eco` field (checked on `main` and on the pipeline branch, 2026-10-24), so the connector adds it, set only when the PLM has an ECO for the request. Drop the intersection if the library adds the field.

Start-up recipe for a worker, so nothing falls between the first listing and the watch:

```ts
const all = await listEcrs(opts);                       // every ECR, once
const mark = all.at(-1)?.modified;                      // newest change seen
for (const e of all.filter(open)) ingest(await readChangeRequest(opts, e.name));
watchEcrs(opts, async (c) => ingest(await readChangeRequest(opts, c.name)), { since: mark, stateFile: 'plm-mark.txt' });
```

A webhook receiver: `http.createServer(createWebhookHandler(webhookSecretFromEnv(), (event, current) => ..., { plm: opts })).listen(port)`. Assess `current`, the `{ change, record, modified }` the handler read from the PLM by name, not `event.doc`: the PLM signs its bodies but sends no timestamp, so signed bytes captured once can be replayed later with an obsolete document (below). `mapEcr(opts, event.doc)` still gives the same shape from the body, for a comparison.

## Mapping

| ChangeRequest | From the PLM's ECR |
|---|---|
| `id`, `filedOn` | `name`, `filed_on` |
| `program` | `program` through `programs` (`Vesper V4` to `vesper`) |
| `itemChanges` | `affected_items` in order: `part`, `change_type` through `itemOps`, `from_revision`, `to_revision` (blank is absent). `changes` are the `field_changes` rows of that part, in order. |
| redline `from` / `to` | Stored as text. On the characteristics the checks compute with, `unit_price_usd` and `labor_hours` (the checks' `PRICE_FIELD` and `HOURS_FIELD`, plus any named in the `numericFields` setting), the value is always a number: `"34.60"` is 34.6, `""` is `null`, and anything else (`"$34.60"`, `"TBD"`, `"1,200"`) is a `PlmMappingError` naming the ECR, part and field. The checks apply a price or hours change only when it is a number, so a price left as text would leave the assessed cost at the old price with no conflict. On every other characteristic the value is carried as the PLM stores it (the checks only copy it to the head item's spec): `""` is `null`, `true`/`false` are booleans, and text that prints back identically as a number (`"1.25"`) is a number; `"1.0"` and `"007"` stay text. A field spelled like a numeric one but not exactly (`Unit_Price_USD`) is read as text and put in `record.warnings`. |
| `bomChanges` | `bom_changes` with `op` through `bomOps`. Only the quantity an operation uses is read (add: to; remove: from), because the PLM stores an unused quantity as 0. |
| `supplierQuotes` | `supplier_quotes` has one row per quote line with the header repeated. Rows are grouped by `quote_id`, in order. `supplier` through `supplier`, `item` is `part`, `leadTimeWeeks` is the header's, `note` is the first non-empty note (the seed writes it on the first line). `firmness` is the rows' `firmness` through the `firmness` setting (`Firm` to `firm`, `Budgetary` to `budgetary`; the header repeats on every row, and one budgetary row makes the quote budgetary). Blank, or no `firmness` setting, leaves it unset and the checks read the note; an unknown spelling is a `PlmMappingError`. |
| quote line | `description`, `unit_price`, `qty`, `one_time`. A 0 is read as not given, because the PLM cannot hold a blank number. This goes for every number column (quote lines, lead time, BOM quantities, cost rows): a value that is not a finite number is a `PlmMappingError`, not "not given". |
| `effectivity` | `production_*` and `retrofit_*`; the retrofit exists only when `retrofit_basis` is set. `basis` through `effectivityBasis`. `interchangeable` is the check box. A draft with no production basis reads as `tbd` with a warning. |
| `inventoryProposal` | `inventory`: `part`, `location` through `locations`, `disposition` through `dispositions`, `note`. |
| `costPage` | `cost_production`, `cost_retrofit`, `cost_logistics`, `cost_other` to `production`, `retrofit`, `logisticsSupport`, `other`. `basis` through `costBasis`; `one_time`, `unit_cost`, `quantity` with 0 read as not given. **`id` is the child row's `name`**, which stays with the row when the table is reordered or other rows change. `note` as is. |
| `eco` | The ECR's own `released_eco` (a read-only link the PLM's release automation sets when it creates the ECO), plus one request for that ECO's release date. An ECR with no link yet (the second or two after approval, or an older PLM) falls back to the ECO whose `ecr` is this request. A blank link is no ECO. `mapEcr` on a webhook body's `doc` reads `released_eco` too. |

An enum spelling the settings do not know stops the read with a `PlmMappingError` that names the ECR, the field and the value. Nothing is guessed.

### Ids

- **Items** are the PLM's `part_number`, the record name, which is also the ERP's item code (the dataset's code).
- **Suppliers** are ERPNext's supplier names (`Tarn Composites`), as the ERP connector uses them and as the checks need to correlate a quote with that supplier's price index. The PLM's quote rows already carry that name (`seed.ts` writes the dataset's supplier name there), so Bowman's `supplier` setting is the identity function. The setting exists for a PLM that spells a supplier differently: a record or a function from the PLM's name to the ERP's. The dataset's own ids (`SUP-TARN`) exist only in the dataset; `check.ts` maps them to names before comparing.
- **Programs** are the dataset's ids (`vesper`, `meridian`), as the ERP connector derives them.
- **Quote ids** are the PLM's `quote_id` (`Q-HAL-26-1187`); **cost rows** the row `name` (random, 10 characters, e.g. `29a7hi4fmj`), which differs between seeds, so the dataset has none and `check.ts` compares rows without it.

## The poller (`src/watch.ts`)

The demo path: the PLM may run where Norn's receiver cannot be reached. Every `intervalMs` (default 2000) it asks the list endpoint for ECRs with `modified >` its high-water mark, one request, and calls `onChange` for each, oldest first.

- **What is delivered.** A change is delivered when what an assessment is made from differs from what was last delivered for that ECR, not by who saved it last. For each changed ECR the poller reads it (`readChangeRequest`, two requests, about 150 ms), takes `inputsHash` of it (the mapped `ChangeRequest` and the `record`, minus the `impact` fields, `modified`, `modifiedBy` and `warnings`) and compares. The first time it sees an ECR there is nothing to compare, so it delivers. Changed state, prose, costs, quotes, redlines or the linked ECO deliver; a save that changes none of them does not.
- **The mark** is the newest `modified` it has delivered or skipped, in the PLM's own clock (no local clock is involved). Without `since` it starts at the newest change in the PLM now, so only what happens from then on is delivered; `since: '1970-01-01 00:00:00'` replays everything. `highWater()` is the value to keep; `stateFile` keeps it for you, so a restart replays nothing and delivers what happened while it was down.
- **Norn's own writes** change only the impact fields, which the fingerprint leaves out, so they are not delivered and cannot start a loop, and the mark moves past them. `modified_by` is not consulted. A person's edit that Norn's write lands on before the next pass (a person changes a cost, the publisher then writes the assessment of the old cost) shows the poller only Norn's stamp, but the fingerprint differs from the last delivery, so it is delivered. This was a gap in the first version, which skipped every row Norn modified last. Fingerprints are in memory: after a restart an ECR the poller has not seen is delivered once even if Norn's write is the newest change on it (one repeated assessment, never a missed one); a worker that delivers an ECR first is not affected.
- **Late commits.** Each pass looks `overlapMs` (5000) behind the mark and remembers what it has delivered, because a change saved just before another can commit just after it. It is delivered once.
- **At least once.** If the read or `onChange` throws (a value the settings do not map, a price that is not a number), the change is offered again on the next pass, up to `maxAttempts` (3), then given up on (reported through `onError`) so one bad request cannot stall the rest. A failed pass (tunnel down) is reported and the next one carries on from the same mark. Requests time out after 3 intervals (at least 5 s).
- A person's comment does not change the ECR's `modified`, so the poller does not see comments. The creation of an ECO does show: the PLM links it onto the ECR as `released_eco`, which moves the ECR's `modified` to the release bot (`eco-release@`), so the poller delivers the approved ECR with its ECO a second or two after approval (below).

Latency, measured by `check.ts` against the live PLM through the tunnel at a 2000 ms interval: Administrator's request returns, and the poller (as Norn) reports the ECR after 123 ms at best, 731 ms median and 1940 ms at worst over 9 changes (a new ECR, its submission, and 7 edits). Three runs gave medians of 1.29, 1.09 and 0.73 s and a worst case of 2.28 s. The delay is the position in the poll cycle plus about 150 ms for the list request (these figures are from before the poller read each ECR to fingerprint it, which adds its two requests, about 150 to 270 ms; the run below measured them again). A submitted ECR was a complete `ChangeRequest` in hand 1.2 to 1.8 s after the PLM answered (the read takes about 120 ms). After that change, one run (9 changes) gave 244 ms at best, a median of 1461 ms and 2012 ms at worst. An interval of 1000 ms would halve these and costs one small request a second; 2000 is the default as briefed.

## Webhooks (`src/webhook.ts`)

The production path. The PLM POSTs JSON with `X-Frappe-Webhook-Signature`, the base64 HMAC-SHA256 of the raw body under `PLM_WEBHOOK_SECRET`; five events (`ncr.inserted`, `ncr.updated`, `ecr.inserted`, `ecr.updated`, `eco.released`), named in the body's `event` and in the `X-Bowman-PLM-Event` header (a setting, `webhook.eventHeader`, so the code does not name the company). The body is `{ event, doctype, name, modified, modified_by, workflow_state, doc }`.

- `verifyWebhook` compares the base64 strings with `timingSafeEqual` over the raw bytes. A missing, empty, truncated, hex, repeated or wrong signature is false, and so is any signature when the secret is empty.
- The handler answers 405 for anything but POST, 413 for a body over 5 MB, 401 for a missing or wrong signature (nothing else about the body is looked at first), 400 for a signed body that is not JSON, not an event, or whose event disagrees with the header, 500 when `onEvent` throws or the read of the current ECR fails (the PLM tries three times over about 5 seconds), and 200 once `onEvent` has finished.
- **Replays.** The PLM sends no timestamp or nonce, so signed bytes captured once verify for ever. The handler therefore does not trust the body's `doc` for what the request looks like now. For an ECR event, and an ECO release (through the ECO's `ecr`), it reads the ECR by name from the PLM (4 s unless `plm.timeoutMs` is set, inside the PLM's own wait) and calls `onEvent(event, current)`; NCR events have no `current`. A replay then shows Norn today's request, and costs a repeat of work, not an obsolete assessment. There is no "already seen" memory: one keyed on `modified` dropped a real second update that shared a timestamp, and raced between concurrent requests (review of 6cef498). Every verified event is re-read and delivered; a consumer stays idempotent on the request's content. A consumer that wants to skip Norn's own writes compares `inputsHash(current)` with the last one it assessed, as the poller does.
- **Never delivered by the real PLM yet.** The hooks are disabled until `NORN_WEBHOOK_URL` is set and `setup.ts` re-run, which this work was told not to do. The tests and `check.ts` use payloads signed here, in the format `bowman/plm/NOTES.md` gives, built from a real ECR-0417 document. `check.ts` shows that body maps to the same `ChangeRequest` as the REST read, that the handler hands `onEvent` the request it read by name, and that a replayed body with a stale title and an old stamp, signed with the real secret, reaches `onEvent` beside the live request, which has the live title.

## Writes (`src/write.ts`)

- `writeImpact(opts, 'ECR-0417', fields)`: `impact_report_level`, `impact_recommendation`, `impact_change_class`, `impact_approval_route`, `impact_norn_url`, `impact_updated_on`, `impact_statement` (HTML), under the PLM's own names, as strings or numbers; `null` clears one. Any other key throws a `RangeError` before a request is made (tested with a counting `fetch`: zero calls), and the PLM's guard would refuse it again with a 403. Only the fields given are sent. The result is the assessment as stored; `impact_updated_on` is stamped by the PLM when not sent.
- `postComment(opts, 'ECR-0417', html)`: a `Comment` of type Comment on the ECR, as Norn.
- The client has no DELETE, no way to send a workflow action, and an ECR number that is not a plain id is refused.

## check.ts, run 2026-10-24 (after the review fixes): 37 of 37 pass

1. **Every dataset ECR against the live PLM, field by field** (10 of 10 match in each section): identity, item changes with their redlines, BOM changes, supplier quotes, effectivity, inventory proposal, the cost page (four blocks, rows in order), and the record fields the dataset also holds (title, state, originator, priority, classes, justification, NCR, dates, all the prose, routing, quote dates). All ten read in 0.8 s (two requests each). **No ECR field failed to map.** Also: 40 cost rows each have a distinct row name; ECR-0417 reads the same twice with the same ids; no unplaced data; each of the dataset's 10 released ECOs is found through `released_eco` on its ECR (`ECR-0288` to `ECO-0231`, and the rest), with its release date; the 9 quotes all carry a firmness, ECR-0409's budgetary (the dataset has none: a quote is budgetary where its note starts "Budgetary", and the check compares with that rule). The supplier-quote comparison leaves `firmness` out for that reason.
2. **Webhook round trip** with the real secret against a local receiver: signed is 200, unsigned, other secret and tampered body are 401, a header that disagrees with the body is 400; the handler passes the request it read by name; a replayed body with a stale title is delivered beside the live request.
3. **Poller latency** as above, then Norn writes impact fields and a comment on the throwaway ECR: not reported; Administrator's next edit: reported. The throwaway (ECR-0424) and its comments are deleted and the naming series put back (next ECR-0424).
4. **ECR-0417**: starts clean; a write naming a field outside the seven is refused with no request; the seven fields written as Norn read back as written, `impact_updated_on` stamped by the PLM and the table kept; the whole `ChangeRequest` is identical before and after; the fingerprint with and without the impact fields is identical; then all seven cleared, the ChangeRequest unchanged. The poller had not seen ECR-0417 in that run, so it reported Norn's first write once (nothing to compare with) and not the clearing. The ECR's `modified` stamp and `modified_by` (now Norn) have moved, which cannot be undone.

Negative control: a copy of the dataset with seven values changed (a redline, a BOM quantity, a quote price, a retrofit range, a disposition, a cost basis, a title) failed exactly the seven matching checks.

## Tested offline (`npm test`, 58 tests)

- **Mapping** (20): the unit price and labour hours as numbers however written, text that is not a number refused, extra numeric fields from the settings, a near-miss spelling warned about, an ECR-0417 price change of `"186.40"` to `"221.00"` reaching the head item through the checks' `bomDelta` with no conflict, a number column holding text refused; the whole document; quote grouping, supplier setting as a record, a function and absent; zero as not given; cost rows keep their ids when reordered; an unmapped spelling names ECR, field and value; no retrofit; a draft with no cut-in; a redline on a part that is not affected; text to value; the ECO (passed in, or from `released_eco`); quote firmness (through the setting, one budgetary row, blank, no setting, unknown spelling); the impact fields read back; the webhook body (JSON round trip, numbers as text); `readChangeRequest` makes two requests with the token, and an error carries neither token nor secret.
- **Webhook** (15): replays (the current request is passed, not the body's; a replayed old event and an update sharing a stamp are both delivered with the current state; a failed event is handled on retry; an unreadable ECR is a 500; an ECO release reads its ECR and an NCR reads nothing); a published HMAC-SHA256 vector; good, wrong secret, missing, empty, tampered, truncated, longer, a repeated header, an empty secret, hex; the bytes are signed, not a re-encoding; the handler for 200, 401 (missing, empty, wrong, tampered, garbage), 405, 400, the event header, 500, 413, and no secret.
- **Poller** (14): `listEcrs`; the stamp arithmetic; starts at the newest change; the mark and a restart from it; a state file; Norn's writes not delivered and a person's edit after one delivered; the race (a person's edit with Norn's write on top of it is delivered); a save that changes nothing is not; an unreadable ECR is retried then given up on; a late commit delivered once; a throwing `onChange` retried then given up on; a failed pass; the timer loop and `stop()`; the request each pass makes.
- **Reads** (4): a linked ECR names its ECO and looks it up by name; no link yet falls back to the lookup by `ecr`; a link to an ECO the lookup cannot find still names it; an open ECR has no ECO.
- **Writes** (5): only the given fields, as strings; all seven and null; thirteen disallowed keys refused with zero requests; the comment; a refusal from the PLM.
- Mutating the code (signature compare, fingerprint comparison, the Norn-modifier skip, numeric parsing, the webhook re-read, mark, field guard, row id, dedupe) made the tests fail each time.

## What the PLM now provides, and what could still change

- _Done on the PLM's `claude/plm-ebom` branch (the `verify.ts` run on 2026-10-24 passed 31 of 31):_ `released_eco`, a read-only link on the ECR that the release automation sets when it creates the ECO, and `firmness` (`Firm`/`Budgetary`) on each quote row. Both are read here. A poll that fires on the approval can still see the ECR a second or two before the link (the link-back is a second self-webhook, `bowman/plm/NOTES.md`); the read then falls back to the lookup by `ecr`, and the link, when it lands, moves `modified` and the poller delivers the ECR again.
- **Redline values are text**, so a number-looking string (an alloy `"6061"`) would come back as a number. None of the dataset's 72 redline values is one. If it matters: a `value_type` column on `ECR Field Change` (`bowman/plm/model.ts`, written by `seed.ts`).
- A quote's `note` sits on the first line of each quote only (as `seed.ts` writes it); the connector takes the first non-empty one.

## Not done

- Reads of Part, Engineering BOM, NCR and ECO as documents. The baseline comes from ERPNext, an NCR is a number on the ECR, and the ECO is read through the ECR's `released_eco`. The Norn user can read them all (`bowman/plm/NOTES.md`).
- A listing or watch for ECOs (`eco.released` arrives by webhook only).
- A webhook delivered by the real PLM, a Mac or Colima restart mid-poll, and a tunnel drop mid-read: not tried. The client throws `PlmError` (status and path, never a header) after its timeout and does not retry; the poller carries on at the next pass.
