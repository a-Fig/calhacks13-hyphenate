# The demo: runbook

How to bring up Fern's live stack for Bowman, rehearse, and walk the demo. Updated 2026-10-25 ~02:45 PT from the
final rerun on the wiped `norn`: `main` at 35e2039, with the Fern rename (#184), the settled supply binding (#187) and
research on. The numbers below are from that run.

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
5. **ERP account.** Fern's ERPNext account is read-only: `bowman/erp/bootstrap.mjs` was re-run on 2026-10-24 and
   ERPNext refuses its writes. Fern's code has no ERP write path either way.

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

What it writes: Fern's database, and in the PLM only the seven `impact_*` fields of each ECR it takes in. It never
writes to the ERP.

## The demo, in order

1. **ECR-0417, the bracket (Level 1 in the PLM).** Open ECR-0417 in the PLM (Submitted). About a minute after Fern
   takes it in (the Level 1 session took 53 s on the final rerun; with `--research`, the first session also waits up
   to 10 minutes for the ECR's research result), its Impact assessment tab fills: unit cost, one-time
   cost and 12-month total as ranges, the drivers, the route ("Change Control Board, with Technical Review Committee
   review (p90 cost about 164,556 USD, above 150,000 USD)") and a recommendation from the stated rule (#112): send
   back on a blocker, approve with conditions that name the gaps, otherwise approve. The rerun's numbers: about +$415
   per Vesper ($407 to $432) and +$277 per Meridian ($271 to $288); one-time $142,085 to $155,886; 12-month net
   $150,682 to $164,556 (median $157,161); the top driver, use up or scrap the old brackets, a $60,588 swing; cut-in
   2027-02-16 at the median (p10 2027-01-13, p90 2027-04-11), S/N 15, about 13 weeks after the stated date.
   The recommendation is "Approve with conditions", with nine conditions: six cost lines unestimated (counted as $0),
   qualification and release and retrofit work not assessed, and the CCB to accept the cut-in slip to 2027-02-16
   (S/N 15) against the need at S/N 11, or expedite. The statement has a Timeline and supply section: one qualified
   source for BW-5120-210 (Halden Precision), 14 weeks' lead time.
   On Fern's page for it (masthead "fern.", #105): Jeff Hargrove as originator, its seven reviewer seats and
   "Needed by November 12", all read from the PLM's form since #167 (they were blank on 2026-10-24); the cost with
   its budget, runway and schedule exposure (#143; the exposure is outside every total); each number traceable.
2. **ECR-0423, the closeout panel (fast track, #128).** A measured $622.27 and no stated deadline, so Bowman's
   configuration lets Fern's Level 1 agent approve it on the fast track. One in five fast-track approvals waits for a
   blind second read; the draw is fixed by the configuration's seed and the ECR number, and ECR-0423 draws 0.5386
   against 0.2, so it is approved outright, every run. Fern's ECR page shows "Approved on the fast track" with the
   reasons (#114). The approval is Fern's: the PLM still shows the ECR as Submitted.
3. **ECR-0419 and ECR-0421, the shared supplier.** Both need Orrin magnets, and Orrin qualifies one lot a quarter.
   On Fern's Supply tab for each (#147): ECR-0421 waits 13 weeks behind ECR-0419, which makes it miss its 2027-06-01
   effectivity (100% of draws), and qualifying both in one lot saves about $180k across the pair (median $180,198,
   p10 to p90 $154,017 to $213,625; the bundles are $119,887 for ECR-0419 and $60,252 for ECR-0421). The PLM
   statements say it too: ECR-0421's Supply line says that with ECR-0419 ahead of it at Orrin Magnetics its cut-in
   moves 13 weeks, and its seventh condition is "resolve supplier slot conflict with ECR-0419".
4. **A released ECO and its ERP change package (#129).** In the PLM: the CM analyst (Dana Okafor) runs "Start CM
   review" and "Send to CCB"; the CCB chair (Rafael Quintero) runs "Approve". The PLM releases the ECO and links it
   back within about 2.5 s. Fern records the decision with Rafael as approver, marks the ECR released, and puts
   the ERP change package on it: every line a person enters in the ERP, with exact values, and which are already
   entered. The ECR page shows "ECO released · Approved by Rafael Quintero", the package, its counts and its
   problems (#114). Rehearsed on ECR-0412 (2026-10-25): ECO-0319 released, and the package followed 17 s later with
   8 lines (2 standard costs, 6 BOM steps), none entered yet, no problems.
   **An approval in the PLM cannot be undone** without rebuilding the PLM (which needs Tyler). So rehearse this step
   on an ECR the demo does not show, and keep ECR-0417 Submitted for the demo itself (see "Rehearsal" below).

## Ask Fern

On any ECR page, a person can ask a question in words. Each one starts a read-only Claude session over Fern's tools,
and the answer marks any number it could not find in what it cited. `npm run demo` starts it on port 3918 and allows
the screens' origin (#182). On the final rerun, "What moves the 12-month net cost most, and by how much?" on ECR-0417
was answered in 12.3 s: the $60,588 swing between $96,233 and $156,821, then $7,157 and $5,946, all six numbers cited
to the statement's drivers and verified. The first try of the same question failed with "Fern gave an answer in a form
it cannot check"; asking again answered it.

## The rerun, as one command list

Each rerun needs Tyler's yes to the republish and wipe of `norn`. From a worktree on the new `main`, in Git Bash;
`REPO` is the main checkout. A Level 1 session takes 50 s to 2 minutes. The nine open ECRs took 15 minutes from the
first ingest to the last statement with `--research` (8.5 minutes without it, on b17bb18): research runs at most 4
an hour, in ECR order, and each ECR it skips waits the full 10 minutes for it.

```
# 0. Nothing else on `norn`: no old demo stack (check: no node process from an old worktree, ports 5180 and 3917 free)
cd ../w-live && git fetch origin && git checkout --detach origin/main && cd norn && npm ci
export ENV_FILE="$(cd "$REPO" && pwd -W)/.env"
export PATH="$LOCALAPPDATA/SpacetimeDB:$PATH"
bash ../bowman/plm/up.sh tunnel &                               # the PLM on 8082 (skip if one is up); the ERP tunnel in its own terminal
# 1. Republish and wipe `norn` (Tyler's OK): every ECR, check run, statement, approval and log row goes
npm run db:reset
# 2. Empty the PLM's impact fields, so nothing from the last run shows until Fern writes it again
for e in ECR-0406 ECR-0407 ECR-0409 ECR-0410 ECR-0412 ECR-0415 ECR-0417 ECR-0419 ECR-0421 ECR-0423; do (cd workers && npx tsx src/level1/plm-impact.ts clear $e); done
# 3. Start (checks first), every open ECR
npm run demo -w @norn/workers -- --check && npm run demo -w @norn/workers
```

Then, with the stack up (http://127.0.0.1:5180, the PLM at http://localhost:8082):

1. **Step 1:** ECR-0417 in the PLM and in Fern, as above. Note the time from "opened the ECR" to the statement in
   the PLM, the p90 in the route, the recommendation and its conditions, and the originator, reviewers and need date
   on Fern's page.
2. **Step 2:** ECR-0423's Fern page shows "Approved on the fast track".
3. **Step 3:** the Supply tab of ECR-0421 and ECR-0419: the shift, the miss, the pair saving; and the Supply line in
   the PLM statements of ECR-0417, ECR-0419 and ECR-0421.
4. **Peer flags (#151):** ECR-0423's Supply tab lists only its own lines (on the final rerun: its no-effectivity note
   and "ECR-0423 shares Stratus Aerosystems with ECR-0406").
5. **Ask Fern:** one question on ECR-0417.
6. **Record:** screenshots of each step for the demo, including the three PLM statements. ECR-0412 is closed, so the
   ingest no longer takes it in, and step 4 needs another spare ECR (below).

## Rehearsal

Step 4 consumes the ECR it is run on. It was rehearsed on **ECR-0412** (2026-10-25), which is now Approved with
ECO-0319 for good. **ECR-0417** stays Submitted, to be approved live at the end of the demo, so the one ECR goes end
to end. The rest of the rehearsal changes nothing that cannot be repeated: a rerun is the command list above again.

**Placeholder, a live filing (#161's beat 4, #171).** If Tyler keeps the beat where a judge files a new ECR and Norn
assesses or fast-tracks it in about a minute, the rerun also needs: a ready-to-file ECR in the PLM (the
template, its fields, and whose login files it), the time from Submit to the statement in the PLM, measured on the
rerun, and a note that each live filing takes the next ECR number, for good. Not written yet (2026-10-25).

## Known gaps (2026-10-25)

- **Research skipped ECR-0417** on the final rerun: at 4 runs an hour in ECR order, it researched ECR-0406, 0407,
  0409 and 0410 (none recorded an assumption), and the rest were assessed without it.
- **ECR-0410's PLM statement has no Supply line,** though its footer cites the supply run and Fern's Supply tab for
  it says "Needs attention". The other eight have one.
- **Ask Fern** failed to parse one answer in two tries on the final rerun (above).
- **"norn" a judge can see on Fern's pages:** the poster of a Level 1 statement shows as the agent's identity
  (`agent:norn/level1/l1-ECR-0417-r1-e1-a1`), and the methods line names the seed `norn-seed-1`. In the PLM, the
  Impact assessment tab's description, the field and button that open the ECR in Fern, and the recommendation line
  on the form still carry the old name: they come from the PLM model and its form script (`bowman/plm/model.ts`, `client-scripts/ecr.js`): changing them is a PLM migration. The
  PLM and ERPNext users show as "Fern", and the ERPNext fields as "Fern decision", since 2026-10-25 (set live; the
  old values are in a local backup). Comments written before that keep "Fern Integration" as their author.
- **#147's PLM child tables** (implementation tasks, cost factors) are not applied to the live PLM; that is the PLM
  owner's migration, asked of Tyler 2026-10-25. The demo's ECRs have no implementation plan in the dataset either way,
  so their numbers do not depend on it.
- **Live runs on `norn`:** a dry run (2026-10-24, e76f0c3), a rerun (2026-10-25, b17bb18) and the final rerun
  (2026-10-25, 35e2039). On the final rerun all nine open ECRs' statements were written with no errors or refusals,
  none says the supply check had not finished, and steps 1 to 3 worked.
