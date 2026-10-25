# The demo: runbook

How to bring up Norn's live stack for Bowman, rehearse, and walk the demo. Updated 2026-10-25 ~01:30 PT for `main`
at dba7cc8 (#128 fast track, #129 PLM decisions, #143 budget and delay exposure, #147 audit fixes, #167 the PLM form's
fields), with #123 still open. Numbers marked **[confirm]** come from earlier live runs or from the offline dataset;
the rerun below confirms or replaces each one, here and in `docs/DEVPOST.md`.

## Before you start

1. **SpacetimeDB.** `npm run db:start` from `norn/` (it listens on 127.0.0.1:3000). The demo instance is the
   database `norn`. A module change on `main` needs `npm run db:publish`, which keeps its data; `npm run db:reset`
   republishes and wipes it. Either one on `norn` needs Tyler's OK (`docs/WORKFLOW.md`). Never run `npm run seed`
   on `norn`: it adds the mock baseline assumptions that made every ECR's recommendation carry three
   "assumption not applied" conditions in the 2026-10-24 dry run.
2. **Tunnels** to Tyler's home server, one terminal each, left open:
   - ERP: `ssh -N -L 8081:127.0.0.1:8081 <BOWMAN_ERP_SSH>` (`bowman/erp/README.md`);
   - PLM: `bash bowman/plm/up.sh tunnel` (`bowman/plm/NOTES.md`), which uses the same host as the ERP.
   - Browse the PLM at **http://localhost:8082** and the ERP at **http://127.0.0.1:8081**. Different host names keep
     their logins apart. People log in to the PLM with their Bowman address and `PLM_USER_PASSWORD` from `.env`.
3. **Claude login** on this machine (`claude`, then `/login` once). Level 1 runs one Claude session per ECR revision.
4. **From a worktree,** set `ENV_FILE` to the main checkout's `.env`: a worktree has none.
5. **ERP account.** Norn's ERPNext account is read-only: `bowman/erp/bootstrap.mjs` was re-run on 2026-10-24 and
   ERPNext refuses its writes. Norn's code has no ERP write path either way.

## Start

```
cd norn
npm run demo -w @norn/workers -- --check                       # checks only: SpacetimeDB, tunnels, .env keys, Claude login, ports
npm run demo -w @norn/workers                                  # everything, on the database `norn`, every open ECR
npm run demo -w @norn/workers -- --ecrs ECR-0417,ECR-0423,ECR-0419,ECR-0421   # only the demo's ECRs in the PLM
```

It starts, from this checkout, on one database: the MCP server, the worker (ERPNext baseline read only, Bowman's
company config, which it stores in the database), the PLM ingest, the Level 1 dispatcher and publisher, and the
screens at **http://127.0.0.1:5180**. Each line of output starts with the process's name. Ctrl-C stops all of them;
on Windows check afterwards that no `node` process from this checkout is left (the 2026-10-24 run left all six).

What it writes: Norn's database, and in the PLM only the seven `impact_*` fields of each ECR it takes in. It never
writes to the ERP.

## The demo, in order

1. **ECR-0417, the bracket (Level 1 in the PLM).** Open ECR-0417 in the PLM (Submitted). Within about 40 s
   **[confirm]** of Norn taking it in, its Impact assessment tab fills: unit cost, one-time cost and 12-month total
   as ranges, the drivers, the route ("Change Control Board, with Technical Review Committee review (p90 cost about
   164,556 USD, above 150,000 USD)" **[confirm]**: 164,556 was the live ERP on 2026-10-24, 164,488.66 is the offline
   dataset) and a recommendation from the stated rule (#112): send back on a blocker, approve with conditions that
   name the gaps, otherwise approve. Expect "Approve with conditions" **[confirm]**: the three blank cost lines, and
   since #147 the qualification, release or retrofit prerequisites that are not assessed.
   On Norn's page for it (masthead "norn.", #105): Jeff Hargrove as originator, its seven reviewer seats and
   "Needed by November 12", all read from the PLM's form since #167 (they were blank on 2026-10-24); the cost with
   its budget, runway and schedule exposure (#143; the exposure is outside every total); each number traceable.
2. **ECR-0423, the closeout panel (fast track, #128).** About $622 **[confirm]** and no stated deadline, so Bowman's
   configuration lets Norn's Level 1 agent approve it on the fast track. One in five fast-track approvals waits for a
   blind second read; the draw is fixed by the configuration's seed and the ECR number, and ECR-0423 draws 0.5386
   against 0.2, so it is approved outright, every run. Norn's ECR page shows "Approved on the fast track" with the
   reasons (#114). The approval is Norn's: the PLM still shows the ECR as Submitted.
3. **ECR-0419 and ECR-0421, the shared supplier.** Both need Orrin magnets, and Orrin qualifies one lot a quarter.
   On Norn's Supply tab for each (#147): ECR-0421 waits about 13 weeks behind ECR-0419 **[confirm]**, which makes it
   miss its 2027-06-01 effectivity, and qualifying both in one lot saves about $180k across the pair **[confirm]**
   (s4 on `norn`, 2026-10-24: 13 weeks, p10 to p90 $154k to $214k). The PLM statements say it too once #123 is on
   `main`; before #123 they carry cost only.
4. **A released ECO and its ERP change package (#129).** In the PLM: the CM analyst (Dana Okafor) runs "Start CM
   review" and "Send to CCB"; the CCB chair (Rafael Quintero) runs "Approve". The PLM releases the ECO and links it
   back within a second or two. Norn records the decision with Rafael as approver, marks the ECR released, and puts
   the ERP change package on it: every line a person enters in the ERP, with exact values, and which are already
   entered. The ECR page shows the package, its counts and its problems (#114).
   **An approval in the PLM cannot be undone** without rebuilding the PLM (which needs Tyler). So rehearse this step
   on an ECR the demo does not show, and keep ECR-0417 Submitted for the demo itself (see "Rehearsal" below).

## The rerun, as one command list

For when Tyler has said yes to the republish and wipe of `norn` (asked 2026-10-25) and #123 is on `main`. From a
worktree on the new `main`, in Git Bash; `REPO` is the main checkout.

```
# 0. Nothing else on `norn`: no old demo stack (check: no node process from an old worktree, ports 5180 and 3917 free)
cd ../w-live && git fetch origin && git checkout --detach origin/main && cd norn && npm ci
export ENV_FILE="$(cd "$REPO" && pwd -W)/.env"
export PATH="$LOCALAPPDATA/SpacetimeDB:$PATH"
bash ../bowman/plm/up.sh tunnel &                               # the PLM on 8082 (skip if one is up); the ERP tunnel in its own terminal
# 1. Republish and wipe `norn` (Tyler's OK): every ECR, check run, statement, approval and log row goes
npm run db:reset
# 2. Empty the PLM's impact fields, so nothing from the last run shows until Norn writes it again
for e in ECR-0406 ECR-0407 ECR-0409 ECR-0410 ECR-0412 ECR-0415 ECR-0417 ECR-0419 ECR-0421 ECR-0423; do (cd workers && npx tsx src/level1/plm-impact.ts clear $e); done
# 3. Start (checks first), every open ECR
npm run demo -w @norn/workers -- --check && npm run demo -w @norn/workers
```

Then, with the stack up (http://127.0.0.1:5180, the PLM at http://localhost:8082):

1. **Step 1:** ECR-0417 in the PLM and in Norn, as above. Note the time from "opened the ECR" to the statement in
   the PLM, the p90 in the route, the recommendation and its conditions, and the originator, reviewers and need date
   on Norn's page.
2. **Step 2:** ECR-0423's Norn page shows "Approved on the fast track". If it shows a refusal asking for the FAA class,
   the Level 1 prompt is not passing `regulatoryClass` (#123 adds that line).
3. **Step 3:** the Supply tab of ECR-0421 and ECR-0419: the shift, the miss, the pair saving.
4. **#151 check:** on ECR-0423's Impact page, does any flag or condition name another ECR (for example
   `implementation:ECR-0406`)? If it does, tell the main session: #151 becomes before-demo.
5. **Step 4 rehearsal** on a spare ECR (below).
6. **Record:** screenshots of each step for #167's PR (originator, reviewers, need date) and for the demo; every
   **[confirm]** number here and in `docs/DEVPOST.md`, confirmed or replaced.

## Rehearsal

Step 4 consumes the ECR it is run on. **To decide (Tyler):** which ECR to rehearse on, and which to approve live.
The suggestion: rehearse on **ECR-0412** (urgent, already In CM Review, so one step shorter, and not in steps 1 to 3),
and approve **ECR-0417** live at the end of the demo, so the one ECR goes end to end. The rest of the rehearsal
changes nothing that cannot be repeated: a rerun is the command list above again.

**Placeholder, a live filing (#161's beat 4, #171).** If Tyler keeps the beat where a judge files a new ECR and Norn
assesses or fast-tracks it in about 35 s **[confirm]**, the rerun also needs: a ready-to-file ECR in the PLM (the
template, its fields, and whose login files it), the time from Submit to the statement in the PLM, measured on the
rerun, and a note that each live filing takes the next ECR number, for good. Not written yet (2026-10-25).

## Known gaps (2026-10-25)

- **#123** (Level 1 timeline and supply in the statement) is not on `main` yet: until it is, PLM statements carry
  cost only, and the Level 1 prompt does not tell the agent to pass the FAA class for the fast track.
- **#151:** the supply check can carry another ECR's flags into an ECR's detail (seen in ECR-0423's s4); #123 filters
  them out of the recommendation. Whether the Impact page shows them is the check in the rerun.
- **#147's PLM child tables** (implementation tasks, cost factors) are not applied to the live PLM; that is the PLM
  owner's migration, asked of Tyler 2026-10-25. The demo's ECRs have no implementation plan in the dataset either way,
  so their numbers do not depend on it.
- **One full dry run** happened on `norn` (2026-10-24, `main` at e76f0c3): step 1 worked, steps 2 and 4 were not on
  `main` yet, and step 3's interaction was computed but not shown. Nothing since has been run live.
