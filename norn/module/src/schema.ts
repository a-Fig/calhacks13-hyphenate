// Norn state layer: tables only. Reducers live in reducers.ts, shared logic in core.ts.
//
// Naming: TypeScript keys are camelCase; SpacetimeDB stores columns as snake_case
// (`prId` -> `pr_id`), which is what SQL subscriptions use.
//
// Strings stand in for enums on purpose: they read plainly in `spacetime sql` and in
// subscription filters, where tagged unions are awkward. The reducers validate them.
import { schema, table, t } from 'spacetimedb/server';

// Who is connected. Self-declared via register_actor until real auth lands (#34).
// Keyed by the connection's Identity, which the server vouches for; the name and the
// on-behalf-of person are claims.
const principal = table(
  { name: 'principal', public: true },
  {
    identity: t.identity().primaryKey(),
    kind: t.string(), // 'person' | 'agent'
    name: t.string(),
    origin: t.string(), // 'human' | 'norn' (Norn's own agent) | 'external' (a person's own agent)
    onBehalfOf: t.option(t.string()), // the person an agent acts for
    spawnedBy: t.string(), // 'Norn', or a parent agent run such as 'check_run:12'
    registeredAt: t.timestamp(),
  }
);

// One row (id 0): the production baseline's version. Bumped when an ECO is released.
const mainVersion = table(
  { name: 'main_version', public: true },
  {
    id: t.u32().primaryKey(),
    version: t.u32(),
    updatedAt: t.timestamp(),
    note: t.string(),
  }
);

// Policy knobs and the code version that goes into every input hash.
const nornConfig = table(
  { name: 'norn_config', public: true },
  {
    key: t.string().primaryKey(),
    value: t.string(),
  }
);

// An ECR. Internally a pull request: a base pointer into `main` plus (later) an overlay.
const pullRequest = table(
  { name: 'pull_request', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    description: t.string(), // the ECR text
    status: t.string().index('btree'), // draft | review | approved | merged | closed
    baseVersion: t.u32(), // main_version this ECR was last checked against
    revision: t.u32(), // bumped whenever the inputs to its checks change
    inputsDigest: t.string(), // digest of everything that feeds any check
    createdBy: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    mergedVersion: t.option(t.u32()), // main_version produced by the ECO, once released
  }
);

// Versioned: an edit appends a row and clears `current` on the previous one.
// prId 0 is the production baseline; a row with the same key on a PR overrides it.
const assumption = table(
  { name: 'assumption', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    key: t.string(),
    distJson: t.string(), // value or distribution, JSON
    source: t.string(), // given | default | agent_estimated
    rationale: t.string(),
    rev: t.u32(), // 1, 2, ... per (prId, key)
    current: t.bool(),
    affects: t.array(t.string()), // stages that read this assumption; empty = all
    createdBy: t.string(),
    createdAt: t.timestamp(),
  }
);

// The work queue and its history. Rows are never deleted; a superseded run becomes 'stale'.
const checkRun = table(
  { name: 'check_run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    stage: t.string(),
    tier: t.string(), // code (cheap, automatic) | deep (agent-heavy, on request)
    trigger: t.string(), // automatic | requested
    inputHash: t.string(),
    status: t.string().index('btree'), // queued | running | done | failed | stale | cancelled
    attempts: t.u32(),
    maxAttempts: t.u32(),
    claimedBy: t.option(t.identity()),
    claimedByName: t.option(t.string()),
    leaseExpiresAt: t.option(t.timestamp()),
    requestedBy: t.string(),
    note: t.string(),
    createdAt: t.timestamp(),
    startedAt: t.option(t.timestamp()),
    finishedAt: t.option(t.timestamp()),
  }
);

// Live progress of a running check. One row per run, updated in place, removed when the run ends.
const checkProgress = table(
  { name: 'check_progress', public: true },
  {
    checkRunId: t.u64().primaryKey(),
    prId: t.u64().index('btree'),
    done: t.u32(),
    total: t.u32(),
    percentiles: t.array(t.f64()), // p05 p10 p25 p50 p75 p90 p95 of the metric so far
    histogram: t.array(t.u32()),
    histMin: t.f64(),
    histMax: t.f64(),
    updatedAt: t.timestamp(),
  }
);

// Summary statistics, never raw samples (ARCHITECTURE.md section 4).
const checkResult = table(
  { name: 'check_result', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    checkRunId: t.u64().index('btree'),
    prId: t.u64().index('btree'),
    key: t.string(),
    label: t.string(),
    unit: t.string(),
    p10: t.f64(),
    p50: t.f64(),
    p90: t.f64(),
    detailJson: t.string(),
    createdAt: t.timestamp(),
  }
);

const comment = table(
  { name: 'comment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    authorName: t.string(),
    authorKind: t.string(),
    anchor: t.string(), // what it is about, e.g. 'assumption:12' or 'check_run:7'; empty = the ECR
    body: t.string(),
    createdAt: t.timestamp(),
  }
);

// Append-only: nothing in the module updates or deletes rows here. Every reducer writes it
// through logAction() in core.ts (#34).
const actionLog = table(
  { name: 'action_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    prId: t.u64().index('btree'), // 0 when the action is not about one ECR
    reducer: t.string(),
    entity: t.string(), // what was written, e.g. 'check_run:7'
    summary: t.string(),
    detailJson: t.string(),
    sender: t.identity(), // the authenticated connection
    actorKind: t.string(), // person | agent | unknown
    actorName: t.string(),
    actorOrigin: t.string(),
    onBehalfOf: t.option(t.string()),
    spawnedBy: t.string(),
    policy: t.string(), // the policy decision that allowed it
  }
);

// Drives reap_expired_leases. Private: clients have no use for it.
const reaperSchedule = table(
  { name: 'reaper_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({
  principal,
  mainVersion,
  nornConfig,
  pullRequest,
  assumption,
  checkRun,
  checkProgress,
  checkResult,
  comment,
  actionLog,
  reaperSchedule,
});

export default spacetimedb;
export { reaperSchedule };
