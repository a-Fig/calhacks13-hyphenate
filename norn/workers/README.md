# Norn's workers

Processes that do Norn's work outside the database, through its reducers. Written 2026-10-24.

- **The worker** (`src/worker.ts`) claims queued check runs and stores their results.
  - s1 (BOM delta) and s2 (cost) run Norn's impact checks (`../checks`) on ECRs that have a change
    request from the PLM.
  - Every other stage, and every ECR with no change request, is mock compute. Its results say
    `mock: true`.
- **The ingest loop** (`src/ingest.ts`) reports the ECRs a change-request source has to Norn.

```
npm run worker                                       # from norn/: the worker, on the database NORN_DB (default norn)
npm run ingest                                       # the ingest loop (needs NORN_INGEST_SOURCE)
NORN_DB=norn-pipe npm run check:pipeline             # end to end on a scratch database: ingest, real checks, revisions, assumptions, baseline change
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
4. **Results.** s1 stores `bomDeltaRows`, and s2 stores `costCheckRows`. Both go into `check_result`
   unchanged, with `mock: false`.
   - That includes the `detail` row (unit `json`), which holds every input the traces name.
     `get_impact` returns them.
   - An assumption the library can't take is reported in an `assumption_errors` row, not dropped.

**For whatever waits on the numbers (#42).** Wait for the ECR's current `s2_cost` run to be `done`:
`inputHash` equal to the module's current hash, or `inputsJson.revision` equal to the current
`ecr_revision.seq`. Then read that run's `check_result` rows.
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
| `NORN_ERP_SETTINGS` | worker | A module exporting the company's `erpnext` settings, for example `../bowman/norn-config/erpnext.ts`. The connection comes from `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` (the .env, or `ENV_FILE`). |
| `NORN_BASELINE_FILE` | worker | A baseline JSON file instead of the ERP, for tests. Recorded with source `file`. |
| `NORN_BASELINE_POLL_MS` | worker | How often to re-read the baseline. |
| `NORN_INGEST_SOURCE` | ingest | `plm`, which needs the PLM connector and isn't wired yet, or `stub`. |
| `NORN_STUB_ECR_DIR` | ingest | For `stub`: a directory of change-request JSON files. A test feed, recorded with source `stub`. |
| `NORN_DB`, `NORN_URI` | both | The database, and the server (default `ws://127.0.0.1:3000`). |
