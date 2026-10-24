# Norn's workers

Processes that do Norn's work outside the database, through its reducers. Written 2026-10-24.

- **The worker** (`src/worker.ts`) claims queued check runs and stores their results.
  - s1 (BOM delta), s2 (cost), s3 (timeline) and s4 (supply) run Norn's impact checks
    (`../checks`) on ECRs that have a change request from the PLM.
  - Every other stage, and every ECR with no change request, is mock compute. Its results say
    `mock: true`.
- **The ingest loop** (`src/ingest.ts`) reports the ECRs a change-request source has to Norn.
- **The company config** (`src/config.ts`): at start-up the worker loads and validates the file in
  `NORN_COMPANY_CONFIG`, refuses to start on a malformed one, and stores the config through
  `set_config` when it differs from what is stored. How it works and what the module checks are in
  `../config/README.md`.

```
npm run worker                                       # from norn/: the worker, on the database NORN_DB (default norn)
npm run ingest                                       # the ingest loop (needs NORN_INGEST_SOURCE)
NORN_DB=norn-pipe npm run check:pipeline             # end to end on a scratch database: ingest, real checks, revisions, assumptions, baseline change
npm run test:workers                                 # offline tests of the start-up config and of the module's company_config checks
NORN_DB=norn-cfg npm run check:config                # end to end on a scratch database you named: start-up config stored once, a re-run stores nothing, a malformed file stops the worker
```

## How an ECR gets its numbers

1. **Ingest.** `ingest_ecr` takes the PLM's ECR number, title, text and change request (the
   checks library's `ChangeRequest`, as JSON), in one transaction.
   - It opens the ECR if Norn hasn't seen the number. Otherwise it records the change as a new
     `ecr_revision` and re-checks the ECR.
   - Reporting the same thing again writes nothing, so the loop just repeats.
2. **Baseline.** The worker reads the baseline from the ERP when it starts and every
   `NORN_BASELINE_POLL_MS` (default 60 s). It records each read with `record_baseline`, by the
   connector's content hash.
   - A hash Norn hasn't seen as current re-checks every open ECR.
   - The JSON stays on the workers, cached by hash in memory and in `.cache/baselines`.
3. **Inputs.** Every code stage's inputs name what it reads: the change request (`revision` and its
   digest, `overlay`), the baseline hash (`erpBaseline`), the seed, and the assumptions.
   - A new revision, a new baseline, or an assumption edit makes the old runs stale and queues new
     ones, through the module's `reconcile`.
   - The worker computes on exactly what the run names. If the ERP has moved on in the meantime, the
     worker records the new baseline, which makes the run stale, and drops it.
4. **Results.** s1 stores `bomDeltaRows`, s2 `costCheckRows`, s3 `timelineRows` and s4
   `supplyCheckRows`. All go into `check_result` unchanged, with `mock: false`.
   - That includes the `detail` row (unit `json`), which holds every input the traces name.
     `get_impact` returns them.
   - An assumption the library can't take is reported in an `assumption_errors` row, not dropped.
   - The trace names where the baseline and the change request came from (`ERPNext baseline 2c02958e,
     as of 2026-10-24`, or `file baseline … (not the ERP)`). The run's inputs carry the same:
     `erpBaselineSource`, `erpBaselineAsOf` and `revisionSource`.
5. **Workers that can't serve a run.** A worker with no baseline source leaves s1 to s4 runs it
   has no baseline for to a worker that has one, instead of failing them.
   **Peers (s4).** s4 also reads the other open ECRs' change requests, to show what two changes to
   one supplier do to each other. The run's inputs name them (each open ECR's id, revision number
   and digest), and the worker reads exactly those revisions, so the same inputs always give the
   same rows. Filing, editing, closing or reopening another ECR changes the list and re-runs s4 on
   every other open ECR; the module cannot tell which share a supplier, so all are named and the
   check decides. This does not change the ECR's own revision or withdraw an approval: the peer list
   is left out of the digest an approval stands on. A named revision the worker doesn't have, or has
   with another digest, drops the run (stale). The `detail` row lists the peers it compared with.
   Each named peer also carries its own assumptions that s4 applies (a decision lag recorded on it,
   say), by id and revision. The worker reads them with the ECR's own, the ECR's own winning a key
   they share, so an assumption recorded on one ECR re-runs s4 on every other open ECR. A peer it
   cannot read is skipped and flagged, not fatal.
6. **Code version.** `code_version` (default `checks-0.3.0`) is part of every hash. Set it to the
   checks library's `CHECKS_CODE_VERSION` when the library changes. The worker warns when the two
   disagree.

**For whatever waits on the numbers (#42).** Wait for the ECR's newest `s2_cost` run that isn't
`stale` or `cancelled` to be `done`, then read that run's `check_result` rows. On an open ECR,
`reconcile` makes every run stale the moment any of its inputs changes: the change request, the
baseline, an assumption, the seed or the code version. So a run that is `done` and not stale is
current. A matching `revision` alone isn't enough, because the baseline or an assumption may have
moved under the same revision.
- A conflicted ECR still finishes `done`, with `bomDelta.ok: false` in the detail row.
- `failed` means the run can't succeed, and its `note` says why.

**Assumptions.** An assumption's `key` is the checks library's input id, such as
`cost:<ECR>:other:<row slug>`, `recovery:<item>` or `effectivity:<ECR>:<program>`. Its `distJson`
takes one of these shapes, any of which may add `replacesGiven: true` to replace a number someone
stated:
- `{ kind: 'fixed', value }`;
- `{ kind: 'lognormal', p10, p50, p90 }`, or `{ kind: 'lognormal', median, sigma }`;
- `{ kind: 'pert' | 'triangular', min, mode, max }`;
- `{ value }`, for a serial number or a month.

## Settings

| Variable | For | Meaning |
|---|---|---|
| `NORN_COMPANY_CONFIG` | worker | The company's configuration file: a module that default-exports it, or a `.json` file (for Bowman, `../../bowman/norn-config/bowman.config.ts` from `norn/workers`). Unset: the worker warns and keeps the stored config. Malformed: it exits with code 1 and prints the problems. A relative path is relative to where the worker starts (`norn/workers` for `npm run worker`). |
| `NORN_ERP_SETTINGS` | worker | A module exporting the company's `erpnext` settings, for example `../bowman/norn-config/erpnext.ts`. The connection comes from `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` (the .env, or `ENV_FILE`). |
| `NORN_BASELINE_FILE` | worker | A baseline JSON file instead of the ERP, for tests. Recorded with source `file`. |
| `NORN_BASELINE_POLL_MS` | worker | How often to re-read the baseline. |
| `NORN_BASELINE_CACHE_DIR` | worker | Where baselines are cached by hash (default `norn/workers/.cache/baselines`). |
| `NORN_INGEST_SOURCE` | ingest | `plm`, which needs the PLM connector and isn't wired yet, or `stub`. |
| `NORN_STUB_ECR_DIR` | ingest | For `stub`: a directory of change-request JSON files. A test feed, recorded with source `stub`. |
| `NORN_DB`, `NORN_URI` | both | The database, and the server (default `ws://127.0.0.1:3000`). |
