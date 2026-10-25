# The demo: runbook

How to bring up Norn's live stack for Bowman and walk the demo. Written 2026-10-24 (Sat evening).
What is not yet on `main` is marked, with its PR.

## Before you start

1. **SpacetimeDB.** `npm run db:start` from `norn/` (it listens on 127.0.0.1:3000). The demo instance
   is the database `norn`. After a schema change on `main` it needs `npm run db:publish`, which keeps
   its data. It is never reset or used for tests (`docs/WORKFLOW.md`).
2. **Tunnels** to Tyler's home server, one terminal each, left open:
   - ERP: `ssh -N -L 8081:127.0.0.1:8081 <BOWMAN_ERP_SSH>` (`bowman/erp/README.md`);
   - PLM: `ssh -N -L 8082:127.0.0.1:8082 <BOWMAN_PLM_SSH>`, or `bash bowman/plm/up.sh tunnel`
     (`bowman/plm/NOTES.md`). `.env` has no `BOWMAN_PLM_SSH` today; the same host as
     `BOWMAN_ERP_SSH` works.
   - Browse the PLM at **http://localhost:8082** and the ERP at **http://127.0.0.1:8081**. Different
     host names keep their logins apart.
3. **Claude login** on this machine (`claude`, then `/login` once). Level 1 runs one Claude session per
   ECR revision on it.
4. **A clean demo record.** `npx tsx src/level1/plm-impact.ts read ECR-0417` (from `norn/workers`)
   shows the seven impact fields; `clear ECR-0417` empties them.

## Start

```
cd norn
npm run demo -w @norn/workers -- --check                       # checks only: SpacetimeDB, tunnels, .env keys, Claude login, ports
npm run demo -w @norn/workers                                  # everything, on the database `norn`, every open ECR
npm run demo -w @norn/workers -- --ecrs ECR-0417,ECR-0423,ECR-0419,ECR-0421   # only the demo's ECRs in the PLM
```

It starts, from this checkout, on one database: the MCP server, the worker (ERPNext baseline read
only, Bowman's company config), the PLM ingest, the Level 1 dispatcher and publisher, and the screens
at **http://127.0.0.1:5180**. Each line of output starts with the process's name. Ctrl-C stops all of
them. It refuses to start if a check fails, and says which.

What it writes: Norn's database, and in the PLM only the seven `impact_*` fields of each ECR it takes
in. It never writes to the ERP.

## The demo, in order

1. **ECR-0417, the bracket (Level 1 in the PLM).** Open ECR-0417 in the PLM (Submitted). Within about
   40 s of Norn taking it in, its Impact assessment tab fills: unit cost, one-time cost, 12-month
   total as ranges, the drivers, the route ("Change Control Board, with Technical Review Committee
   review (p90 cost about 164,556 USD, above 150,000 USD)", seen 2026-10-24 on the live ERP) and a
   recommendation. The same numbers are on its page in Norn's screens, each traceable.
2. **ECR-0423, the closeout panel (fast track).** About $622 and no stated deadline, so Bowman's
   configuration lets Norn approve it on the fast track (one in five gets a blind second read). Norn's
   ECR page shows it approved, with the reasons. *Needs the fast-track tool (`claude/fast-track-tool`)
   and the Level 1 prompt calling it (`claude/level1-recommendation`); neither is on `main` yet.*
   The approval is Norn's; the PLM still shows the ECR as Submitted.
3. **ECR-0419 and ECR-0421, the shared supplier.** Both need Orrin magnets, and Orrin has one
   qualification slot a quarter. Their supply checks show the interaction: which ECR waits for the
   other, and the saving if both are qualified in one lot.
4. **A released ECO and its ERP change package.** Approve an ECR in the PLM as the CCB chair. The PLM
   releases the ECO and links it back. Norn marks the ECR released and puts the ERP change package on
   it: every line a person enters in the ERP, with exact values, and which are already entered.
   *Needs `record_plm_decision` (`claude/plm-decision`); on `main` today a PLM approval records only
   the ECO number, so no package is built.*

## Known gaps (2026-10-24)

- The Level 1 recommendation varied between two runs on the same inputs ("approve with conditions",
  then "send back"). The lead session is making it follow a stated rule.
- The live `norn` database needs a worker started from `main` once, to store Bowman's company config.
  Until then the gate has no rules ("no config stored").
- Nothing here has had a full dry run on `norn` yet.
