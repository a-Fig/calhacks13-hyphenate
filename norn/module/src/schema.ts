// Norn state layer: tables only. Reducers live in reducers.ts, shared logic in core.ts.
//
// Naming: TypeScript keys are camelCase; SpacetimeDB stores columns as snake_case
// (`prId` -> `pr_id`), which is what SQL subscriptions use.
//
// Strings stand in for enums on purpose: they read plainly in `spacetime sql` and in
// subscription filters, where tagged unions are awkward. The reducers validate them.
//
// Who did something is stored as an Identity (the connection the server vouches for), never as a
// display name: names live in `principal` and can change, the audit trail cannot.
import { schema, table, t } from 'spacetimedb/server';

// Who is connected. Self-declared via register_actor until real auth lands (#34); `kind` and
// `origin` are fixed at first registration. Keyed by the connection's Identity, which the server
// vouches for; the name and the on-behalf-of person are claims.
const principal = table(
  { name: 'principal', public: true },
  {
    identity: t.identity().primaryKey(),
    kind: t.string(), // 'person' | 'agent'
    name: t.string(),
    origin: t.string(), // 'human' | 'norn' (Norn's own agent) | 'external' (a person's own agent)
    onBehalfOf: t.option(t.string()), // the person an agent acts for
    registeredAt: t.timestamp(),
  }
);

// Append-only history of the production baseline. The current version is the highest row.
// `cause` says why it moved: 'initial', 'eco' (an ECR was released) or 'assumption' (a baseline
// assumption was edited). Only 'initial' and 'eco' change the bill of materials.
const mainVersion = table(
  { name: 'main_version', public: true },
  {
    version: t.u32().primaryKey(),
    parent: t.u32(), // 0 for the first
    cause: t.string(),
    mergedPrId: t.u64(), // the released ECR, 0 when none
    effectivity: t.option(t.timestamp()), // when the change reaches the line; set from the timeline stage later
    at: t.timestamp(),
    by: t.identity(),
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
    kind: t.string(), // 'ecr' | 'integration' (the backlog roll-up, not built yet)
    plmEcrNumber: t.string().unique(), // the PLM's ECR number; 'NORN-<id>' until the PLM assigns one
    title: t.string(),
    description: t.string(), // the ECR text
    status: t.string().index('btree'), // draft | review | approved | merged | closed
    baseVersion: t.u32(), // main_version this ECR was last checked against
    revision: t.u32(), // bumped whenever the inputs to its checks change
    inputsDigest: t.string(), // digest of everything that feeds any check
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    mergedVersion: t.option(t.u32()), // main_version produced by the ECO, once released
  }
);

// Baseline part list; only the key the connectors will match on exists so far.
const part = table(
  { name: 'part', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    partNumber: t.string().unique(), // the PLM/ERP item number
    name: t.string(),
    category: t.string(),
    specJson: t.string(),
    updatedAt: t.timestamp(),
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
    createdBy: t.identity(),
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
    // What the hash was computed from: base version, code version, seed, the assumption ids and
    // revisions, and the hashes of the stages it reads (ARCHITECTURE.md section 11).
    inputsJson: t.string(),
    // queued | running | done | failed | stale | cancelled | blocked (an upstream stage failed)
    status: t.string().index('btree'),
    attempts: t.u32(),
    maxAttempts: t.u32(),
    claimedBy: t.option(t.identity()),
    leaseExpiresAt: t.option(t.timestamp()),
    requestedBy: t.identity(),
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
    mock: t.bool(), // true until a worker computes something real
  }
);

const comment = table(
  { name: 'comment', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    author: t.identity(),
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
    requestId: t.string().index('btree'), // the caller's id for this call; matches a call to its outcome
    reducer: t.string(),
    outcome: t.string(), // applied | denied | downgraded | rejected (a job-scoped agent's validation failure)
    entity: t.string(), // what was written, e.g. 'check_run:7'
    summary: t.string(),
    detailJson: t.string(),
    sender: t.identity(), // the authenticated connection
    actorKind: t.string(), // person | agent | unknown
    actorName: t.string(),
    actorOrigin: t.string(),
    onBehalfOf: t.option(t.string()),
    spawnedBy: t.string(), // 'Norn', a parent agent run, or 'check_run:<id>' for a worker's calls on that run
    policy: t.string(), // the policy decision that allowed (or refused) it
  }
);

// The agent runner's event stream (norn/runner, PR #53): one row per event, keyed by
// (jobId, seq). `eventKey` is that pair as a string so the database enforces it is unique
// (SpacetimeDB constraints are single-column). Rows are written in batches and are not
// mirrored into action_log: each row names its actor, and the batch's sender is stored.
const agentEvent = table(
  { name: 'agent_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    eventKey: t.string().unique(), // '<jobId>#<seq>'
    jobId: t.string().index('btree'), // a check run ('check_run:12') or any runner job id
    seq: t.u32(),
    checkRunId: t.u64().index('btree'), // 0 when the job is not a check run
    prId: t.u64().index('btree'), // 0 when unknown
    ts: t.timestamp(), // when the runner saw the event
    role: t.string(),
    actor: t.string(), // the runner's identity.actor, e.g. 'agent:norn/level1/ECR-0417'
    onBehalfOf: t.option(t.string()),
    spawnedBy: t.string(),
    sessionId: t.option(t.string()),
    eventType: t.string(), // the runner's `type`
    payloadJson: t.string(), // the rest of the event
    sender: t.identity(),
    recordedAt: t.timestamp(),
  }
);

// What a credential lets an agent write to. Norn's MCP server verifies a job's (or a person's
// agent's) signed token, then records the scope it names here for that agent's own identity, and
// the policy gate (scope.ts) checks every write against it. Absent for workers and the UI.
// Self-declared by the connection, like register_actor: see mcp/NOTES.md for what that does and
// does not protect against.
const actorScope = table(
  { name: 'actor_scope', public: true },
  {
    identity: t.identity().primaryKey(),
    jobId: t.string(), // the job (or credential) the grant is for
    anyEcr: t.bool(), // true: any ECR (a person's agent); the baseline is never writable
    prIds: t.array(t.u64()), // the ECRs it may write to
    maxLevel: t.u8(), // the highest impact-statement level it may post (0: none); derived from the job's role and origin
    expiresAt: t.timestamp(),
    grantedAt: t.timestamp(),
  }
);

// The structured parts of an impact statement. 'evidence' is one of fact | assumption |
// computation | judgment (docs/GLOSSARY.md). A 'computation' number must equal a current
// check_result of the ECR, key and p10/p50/p90 (post_impact_statement checks it).
export const StatementNumber = t.object('StatementNumber', {
  key: t.string(),
  label: t.string(),
  unit: t.string(),
  p10: t.f64(),
  p50: t.f64(),
  p90: t.f64(),
  evidence: t.string(),
  resultKey: t.string(), // the check_result key it comes from; required for 'computation', else may be empty
});
export const StatementClaim = t.object('StatementClaim', { text: t.string(), evidence: t.string() });
export const StatementAssumption = t.object('StatementAssumption', {
  key: t.string(), // an assumption the ECR sees
  source: t.string(), // given | default | agent_estimated; must match the assumption's own source
  note: t.string(), // how the statement leans on it
});

// A Level 1-3 impact statement (#42). Append-only: a newer one for the same ECR and level
// supersedes an older one in the reader's eyes. prRevision is the ECR's own revision counter when
// it was written, so a reader can tell it has since gone out of date. checkRunId is the check run
// the statement was written from. post_impact_statement records it and the agent cannot set it: the
// run that started the session when the call's spawnedBy names one ('...check_run:<id>'), else the
// run its first 'computation' number was copied from, else 0. That run's inputs name the
// change-request revision and the ERP baseline, so a reader never has to guess them from numbers.
// snapshotUs is the database time (microseconds since the epoch) the session's timeline and supply checks were read
// at, taken from the signed credential's ':snap:' part: the publisher binds the same runs the session was told
// about from it (workers/src/level1/siblings.ts). 0: none (a statement outside a session, or an older credential).
const impactStatement = table(
  { name: 'impact_statement', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    level: t.u8(), // 1 | 2 | 3
    prRevision: t.u32(),
    checkRunId: t.u64(), // 0: no check run behind it (judgment only, posted outside a session)
    snapshotUs: t.u64(), // 0: no snapshot named; see above
    changeClass: t.string(),
    route: t.string(), // the proposed approval route
    headline: t.string(),
    numbers: t.array(StatementNumber),
    drivers: t.array(StatementClaim),
    assumptions: t.array(StatementAssumption),
    claims: t.array(StatementClaim),
    author: t.identity(),
    createdAt: t.timestamp(),
  }
);

// A short lease on writing one ECR's impact statement to the PLM (#42). The PLM has no
// compare-and-set, so two publishers that each read "not there yet" would both write. The one
// atomic step is claim_publication: it refuses while another holder's unexpired lease stands.
// The holder is the caller's identity (taken from the connection, never from the arguments), so only
// it can renew or release. `processId` is a random id per publisher process, because processes of
// one name share a saved identity and must still take turns.
const publicationClaim = table(
  { name: 'publication_claim', public: true },
  {
    prId: t.u64().primaryKey(),
    statementId: t.u64(),
    holder: t.identity(),
    processId: t.string(),
    expiresAt: t.timestamp(),
  }
);

// What the ECR proposes, as the checks read it: the PLM connector's change request (the checks
// library's `ChangeRequest`), one row per revision. Append-only: a new revision clears `current` on
// the previous one. The current row's digest is an input of the code stages, so a new revision
// makes their runs stale and queues fresh ones (core.ts stageInfos).
const ecrRevision = table(
  { name: 'ecr_revision', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    seq: t.u32(), // 1, 2, ... per ECR
    changeRequestJson: t.string(),
    digest: t.string(), // fnv1a64 of changeRequestJson
    source: t.string(), // where it came from: 'plm', or 'stub' for a test feed
    sourceRef: t.string(), // the source's own version marker, e.g. the PLM document's modified time
    current: t.bool(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

// The production baseline as read from the ERP, by content hash. The JSON itself stays with the
// workers (cached by hash); the module records which baseline the checks ran on, so a result
// points at exact data, and a new hash re-checks every open ECR. `current` marks the latest read.
const baselineSnapshot = table(
  { name: 'baseline_snapshot', public: true },
  {
    hash: t.string().primaryKey(), // the connector's content hash (sha256 hex)
    asOf: t.string(), // the date the baseline is as of, 'YYYY-MM-DD'
    source: t.string(), // 'erp', or 'file' for a test baseline
    countsJson: t.string(), // rows per part of the baseline
    warningsJson: t.string(), // the connector's warnings for this read
    current: t.bool(),
    firstReadAt: t.timestamp(),
    lastReadAt: t.timestamp(),
    recordedBy: t.identity(),
  }
);

// An agent's answer to one of the configuration's fast-track tests: whether the test's text is true of the
// ECR, and what it rests on (request_fast_track_approval).
export const TestAnswer = t.object('TestAnswer', { testId: t.string(), holds: t.bool(), evidence: t.string() });

// One line of why: the rule in the company's configuration (a path or id), and what it says.
export const GateReason = t.object('GateReason', { rule: t.string(), text: t.string() });

// An approval, standing until it is withdrawn or the ECR is released (#43). One row per approval
// event, kept after it ends: the history of who approved what on which numbers. At most one row per
// ECR is 'standing'. It records what the approval rested on, so a later change can be judged against
// it: `ownDigest` (the ECR's own title, text, change request and assumptions) and the approval tier
// the cost pointed to. A change to the first withdraws the approval; a change to the baseline keeps
// it unless the re-checked numbers point to a different tier (gate.ts, settleApproval).
const approval = table(
  { name: 'approval', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    prRevision: t.u32(), // the ECR's revision when it was approved
    kind: t.string(), // 'fast_track' | 'tier' | 'plm' (a person's approval taken in the PLM and mirrored by Norn)
    bodyId: t.string(), // 'fast_track', or the approval body that decided; '' when there was no company configuration
    tierId: t.string(), // the tier the cost pointed to; '' without a configuration
    tierIndex: t.i32(), // its position in the configuration's tiers; -1 without one
    costSize: t.f64(), // the measured size of the change the tier rests on; -1 when it was not measured
    costBasis: t.string(), // 'measured' | 'estimated' | 'lower_bound' | 'unmeasured' | 'none'
    ownDigest: t.string(), // fingerprint of the ECR's own inputs when it was approved
    decisionJson: t.string(), // the gate's decision: reasons, limits, sample, route
    answersJson: t.string(), // a fast-track approval's answers to the configuration's tests, and the classes proposed
    status: t.string().index('btree'), // standing | withdrawn | released
    // True while the ECR's inputs have changed under a standing approval and its checks have not all
    // finished again. The ECR cannot be released until they have (set_pr_status checks the runs, not this flag).
    pendingRecheck: t.bool(),
    approverKind: t.string(),
    approverName: t.string(),
    approverOrigin: t.string(),
    onBehalfOf: t.option(t.string()),
    sender: t.identity(),
    at: t.timestamp(),
    endedAt: t.option(t.timestamp()),
    endedReason: t.string(), // why it was withdrawn (or 'released as baseline vN')
  }
);

// What the gate did instead of an approval it would not allow the actor to give: a recommendation
// to the people who decide (#43). Append-only. `outcome` is the decision's: 'recommend', 'escalate',
// or 'sampled' (drawn for the blind second check, which is not built yet, so it waits).
const recommendation = table(
  { name: 'recommendation', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    prId: t.u64().index('btree'),
    prRevision: t.u32(), // the ECR's revision it was made on; a reader can tell it is out of date
    action: t.string(), // the company's action id, e.g. 'approve_ecr_at_tier'
    outcome: t.string(),
    recommenderKind: t.string(),
    recommenderName: t.string(),
    recommenderOrigin: t.string(),
    onBehalfOf: t.option(t.string()),
    sender: t.identity(),
    reasons: t.array(GateReason),
    recipients: t.array(t.string()), // role ids that get it
    answersJson: t.string(), // the fast-track answers and proposed classes the agent gave, '' for other actions
    decisionJson: t.string(), // the gate's whole decision
    awaitingSecondCheck: t.bool(),
    at: t.timestamp(),
  }
);

// The change order the PLM released for an ECR: its number, and where Norn learned it. One per ECR;
// a released change order keeps its number.
const ecoRelease = table(
  { name: 'eco_release', public: true },
  {
    prId: t.u64().primaryKey(),
    ecoNumber: t.string(), // the PLM's number, e.g. ECO-0319
    source: t.string(), // 'plm', or 'stub' for a test feed
    sourceRef: t.string(),
    recordedBy: t.identity(),
    recordedAt: t.timestamp(),
  }
);

// The ERP change package on a released ECO (#72): every line a person enters in the ERP to carry the
// change out, with the values, traced to the ECO and the assessment. Norn never writes to the ERP
// (#71). A worker builds it from the ECR's assessment and the ERP as read, and checks it again on each
// new ERP read, so every line's status (entered, to enter, conflict) follows what people have entered.
const erpPackage = table(
  { name: 'erp_package', public: true },
  {
    prId: t.u64().primaryKey(),
    ecoNumber: t.string(),
    s2RunId: t.u64(), // the s2_cost run the amounts come from
    erpBaseline: t.string(), // hash of the ERP read the package was last checked against
    releaseJson: t.string(), // what the ECO changes in the ERP, from the assessment (the connector's EcoRelease)
    packageJson: t.string(), // the lines to enter and their status (the connector's change package)
    lines: t.u32(),
    entered: t.u32(),
    conflicts: t.u32(),
    notesJson: t.string(), // what the package leaves out and why, and anything that kept it from being complete
    builtBy: t.identity(),
    builtAt: t.timestamp(),
    updatedAt: t.timestamp(),
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
  part,
  assumption,
  checkRun,
  checkProgress,
  checkResult,
  comment,
  actionLog,
  agentEvent,
  actorScope,
  impactStatement,
  publicationClaim,
  ecrRevision,
  baselineSnapshot,
  approval,
  recommendation,
  ecoRelease,
  erpPackage,
  reaperSchedule,
});

export default spacetimedb;
export { reaperSchedule };
