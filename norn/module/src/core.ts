// Shared logic for the reducers: constants, config, input hashing, the baseline history, actor
// identity, the policy gate, the action log helper, the write() wrapper every write reducer goes
// through, and the reconcile loop that keeps check runs in step with their inputs.
import { SenderError, t } from 'spacetimedb/server';
import type { InferSchema, InferTypeOfRow, ReducerCtx, ReducerExport, RowObj } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type Pr = NonNullable<ReturnType<Ctx['db']['pullRequest']['id']['find']>>;
export type Run = NonNullable<ReturnType<Ctx['db']['checkRun']['id']['find']>>;
export type MainRow = NonNullable<ReturnType<Ctx['db']['mainVersion']['version']['find']>>;
type Identity = Ctx['sender'];

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

export const PR_STATUSES = ['draft', 'review', 'approved', 'merged', 'closed'] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

// Allowed moves. Approval additionally needs current, finished code checks (see setPrStatus).
export const PR_TRANSITIONS: Record<PrStatus, PrStatus[]> = {
  draft: ['review', 'closed'],
  review: ['draft', 'approved', 'closed'],
  approved: ['review', 'merged', 'closed'],
  merged: [],
  closed: ['draft'],
};

export const OPEN_PR: PrStatus[] = ['draft', 'review', 'approved'];

export const TRIGGERS = ['automatic', 'requested'] as const;
export const SOURCES = ['given', 'default', 'agent_estimated'] as const;

// Statuses of a run that still stand for its inputs (everything but stale and cancelled).
const STANDING = ['queued', 'running', 'done', 'blocked', 'failed'];
export const LIVE = ['queued', 'running', 'done', 'blocked'];

export type Tier = 'code' | 'deep';

// The forecast pipeline, ARCHITECTURE.md section 5, in dependency order. `code` stages are cheap
// and re-run on every input change; `deep` stages are agent-heavy and run only when requested
// (#10): they go stale when their inputs change and are never recomputed automatically.
// `seeded` stages read the random seed.
export const STAGE_ORDER = ['s0_extract', 's1_bom_delta', 's2_cost', 's3_timeline', 's4_supply', 's5_card'];
export const STAGES: Record<string, { tier: Tier; deps: string[]; seeded: boolean }> = {
  s0_extract: { tier: 'deep', deps: [], seeded: false },
  s1_bom_delta: { tier: 'code', deps: [], seeded: true },
  s2_cost: { tier: 'code', deps: ['s1_bom_delta'], seeded: true },
  s3_timeline: { tier: 'code', deps: ['s1_bom_delta'], seeded: true },
  s4_supply: { tier: 'code', deps: ['s1_bom_delta'], seeded: true },
  s5_card: { tier: 'deep', deps: ['s2_cost', 's3_timeline', 's4_supply'], seeded: false },
};

export function stageDef(stage: string) {
  const def = STAGES[stage];
  if (!def) throw new SenderError(`unknown stage '${stage}' (expected one of ${STAGE_ORDER.join(', ')})`);
  return def;
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export const CONFIG_DEFAULTS: Record<string, string> = {
  // 'on_request' (Bowman's default) or 'auto': whether a new ECR gets its deep stages queued once,
  // when it is filed. Deep stages are never re-queued automatically after an edit, in either mode.
  deep_review_mode: 'on_request',
  // Requested runs of one deep stage on the same inputs, failures included ("once or at most
  // twice", #10). New inputs start a fresh count; a run made stale by an edit does not count.
  deep_review_limit: '2',
  max_attempts: '3',
  lease_default_ms: '15000',
  // Part of every input hash: bump it when worker logic changes so old results go stale.
  code_version: 'dev-1',
  seed: 'norn-seed-1',
};

export function cfg(ctx: Ctx, key: string): string {
  return ctx.db.nornConfig.key.find(key)?.value ?? CONFIG_DEFAULTS[key] ?? '';
}

export function cfgInt(ctx: Ctx, key: string): number {
  return Number.parseInt(cfg(ctx, key), 10);
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

export function plusMs(ts: Timestamp, ms: number): Timestamp {
  return new Timestamp(ts.microsSinceUnixEpoch + BigInt(Math.round(ms)) * 1000n);
}

// ---------------------------------------------------------------------------------------------
// The production baseline's history
// ---------------------------------------------------------------------------------------------

export function currentMain(ctx: Ctx): MainRow {
  let best: MainRow | undefined;
  for (const v of ctx.db.mainVersion.iter()) if (!best || v.version > best.version) best = v;
  if (!best) throw new SenderError('the baseline has no history: the module was not initialised');
  return best;
}

// Only 'initial' and 'eco' rows change the bill of materials. A baseline assumption edit moves
// the version too, but the BOM at that version is the one of the nearest earlier eco/initial row.
export function bomVersion(ctx: Ctx, version: number): number {
  let row = ctx.db.mainVersion.version.find(version);
  while (row && row.cause === 'assumption') row = ctx.db.mainVersion.version.find(row.parent);
  return row ? row.version : version;
}

export function appendMain(ctx: Ctx, a: { cause: 'eco' | 'assumption'; mergedPrId: bigint; note: string }): MainRow {
  const parent = currentMain(ctx);
  return ctx.db.mainVersion.insert({
    version: parent.version + 1,
    parent: parent.version,
    cause: a.cause,
    mergedPrId: a.mergedPrId,
    effectivity: undefined,
    at: ctx.timestamp,
    by: ctx.sender,
    note: a.note,
  });
}

// ---------------------------------------------------------------------------------------------
// Input hashing (ARCHITECTURE.md section 8): same inputs, same hash; "is this current" is a
// string comparison. FNV-1a 64-bit: not cryptographic, only a change detector.
//
// A stage's hash covers what that stage itself reads plus the hashes of the stages it reads from,
// so a change anywhere upstream changes everything downstream of it, and only that.
// ---------------------------------------------------------------------------------------------

export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

// The assumptions a PR sees: the baseline's current rows, with the PR's own rows on top.
export function effectiveAssumptions(ctx: Ctx, prId: bigint) {
  const byKey = new Map<string, NonNullable<ReturnType<typeof ctx.db.assumption.id.find>>>();
  for (const a of ctx.db.assumption.prId.filter(0n)) if (a.current) byKey.set(a.key, a);
  if (prId !== 0n) for (const a of ctx.db.assumption.prId.filter(prId)) if (a.current) byKey.set(a.key, a);
  return [...byKey.values()];
}

export type StageInputs = {
  stage: string;
  codeVersion: string;
  seed?: string;
  text?: string; // s0: digest of the ECR text
  bomVersion?: number; // s1: the baseline's bill of materials
  // Code stages: the digest of the ECR's current change request (ecr_revision). Until an ECR has
  // one, the ECR's id stands in for it, so two ECRs never share a hash.
  overlay?: string;
  revision?: number; // code stages: the ecr_revision seq the overlay digest belongs to
  erpBaseline?: string; // code stages: the hash of the current ERP baseline (baseline_snapshot)
  assumptions?: { id: string; key: string; rev: number }[]; // code stages: the assumptions that feed it
  upstream?: Record<string, string>; // stage -> its hash, for the stages this one reads
};
export type StageInfo = { hash: string; inputs: StageInputs };

// The ECR's current change request, if the PLM has sent one.
export function currentRevision(ctx: Ctx, prId: bigint) {
  for (const r of ctx.db.ecrRevision.prId.filter(prId)) if (r.current) return r;
  return undefined;
}

// The latest ERP baseline a worker recorded, if any.
export function currentBaseline(ctx: Ctx) {
  for (const b of ctx.db.baselineSnapshot.iter()) if (b.current) return b;
  return undefined;
}

export function stageInfos(ctx: Ctx, pr: Pick<Pr, 'id' | 'baseVersion' | 'title' | 'description'>): Record<string, StageInfo> {
  const out: Record<string, StageInfo> = {};
  const assumptions = effectiveAssumptions(ctx, pr.id);
  const rev = currentRevision(ctx, pr.id);
  const erp = currentBaseline(ctx);
  for (const stage of STAGE_ORDER) {
    const def = STAGES[stage]!;
    const inputs: StageInputs = { stage, codeVersion: cfg(ctx, 'code_version') };
    if (def.seeded) inputs.seed = cfg(ctx, 'seed');
    if (stage === 's0_extract') inputs.text = fnv1a64(`${pr.title}\n${pr.description}`);
    if (stage === 's1_bom_delta') {
      inputs.bomVersion = bomVersion(ctx, pr.baseVersion);
      if (!rev) inputs.overlay = String(pr.id);
    }
    if (def.tier === 'code') {
      // Every code stage reads the change request and the ERP baseline, so it names them itself:
      // a worker computes on exactly what the run's inputs say.
      if (rev) {
        inputs.overlay = rev.digest;
        inputs.revision = rev.seq;
      }
      if (erp) inputs.erpBaseline = erp.hash;
      inputs.assumptions = assumptions
        .filter(a => a.affects.length === 0 || a.affects.includes(stage))
        .map(a => ({ id: String(a.id), key: a.key, rev: a.rev }))
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    }
    if (def.deps.length) inputs.upstream = Object.fromEntries(def.deps.map(d => [d, out[d]!.hash]));
    out[stage] = { hash: fnv1a64(JSON.stringify(inputs)), inputs };
  }
  return out;
}

export function inputHash(ctx: Ctx, pr: Pick<Pr, 'id' | 'baseVersion' | 'title' | 'description'>, stage: string): string {
  return stageInfos(ctx, pr)[stage]!.hash;
}

export function digestOf(infos: Record<string, StageInfo>): string {
  return fnv1a64(JSON.stringify(STAGE_ORDER.map(s => infos[s]!.hash)));
}

// ---------------------------------------------------------------------------------------------
// Actors (#34)
// ---------------------------------------------------------------------------------------------

// What a credential lets this connection write to (actor_scope, written by grant_scope). Set for
// agents that come in through Norn's MCP server; null for workers and the UI, which have no limit
// of this kind. expiresAtMicros is microseconds since the Unix epoch.
export type ActorScope = { jobId: string; anyEcr: boolean; prIds: bigint[]; expiresAtMicros: bigint };

export type Actor = {
  kind: 'person' | 'agent' | 'unknown';
  name: string;
  origin: string;
  onBehalfOf: string | null;
  scope?: ActorScope | null;
};

export function resolveActor(ctx: Ctx): Actor {
  // Scheduled reducers are called by the module's own identity.
  if (ctx.sender.isEqual(ctx.databaseIdentity)) {
    return { kind: 'agent', name: 'norn-scheduler', origin: 'norn', onBehalfOf: null };
  }
  const p = ctx.db.principal.identity.find(ctx.sender);
  const s = ctx.db.actorScope.identity.find(ctx.sender);
  const scope: ActorScope | null = s ? { jobId: s.jobId, anyEcr: s.anyEcr, prIds: s.prIds, expiresAtMicros: s.expiresAt.microsSinceUnixEpoch } : null;
  if (p) return { kind: p.kind as Actor['kind'], name: p.name, origin: p.origin, onBehalfOf: p.onBehalfOf ?? null, scope };
  return { kind: 'unknown', name: `unregistered:${ctx.sender.toHexString().slice(0, 8)}`, origin: 'unknown', onBehalfOf: null, scope };
}

// ---------------------------------------------------------------------------------------------
// The policy gate (#43 fills it with rules). authorize() runs before every write reducer and
// returns a decision: allow, deny, or downgrade (do a weaker thing, e.g. record a recommendation
// instead of approving). write() honours it.
// ---------------------------------------------------------------------------------------------

export type Decision = { effect: 'allow' | 'deny' | 'downgrade'; reason: string; downgradeTo?: string };
export type PolicyRule = (ctx: Ctx, actor: Actor, reducer: string, args: Record<string, any>) => Decision | null;

// Empty in the real module: there are no rules yet. The test module registers some to exercise the gate.
export const POLICY_RULES: PolicyRule[] = [];

// The first rule that denies or downgrades decides. If none does, the first rule that explicitly
// allowed gives its reason (so the log says why, e.g. "job scope: ..."), else 'no rules yet'.
export function authorize(ctx: Ctx, actor: Actor, reducer: string, args: Record<string, any>): Decision {
  let allowed: Decision | undefined;
  for (const rule of POLICY_RULES) {
    const d = rule(ctx, actor, reducer, args);
    if (!d) continue;
    if (d.effect !== 'allow') return d;
    allowed ??= d;
  }
  return allowed ?? { effect: 'allow', reason: 'no rules yet' };
}

export function decisionText(d: Decision): string {
  if (d.effect === 'allow') return `allow (${d.reason})`;
  if (d.effect === 'deny') return `deny: ${d.reason}`;
  return `downgrade to ${d.downgradeTo ?? 'a weaker action'}: ${d.reason}`;
}

// ---------------------------------------------------------------------------------------------
// The action log
// ---------------------------------------------------------------------------------------------

export type Logged = {
  prId?: bigint;
  entity: string;
  summary: string;
  detail?: unknown;
  /** Overrides the caller's spawnedBy (worker calls on a run say 'check_run:<id>'). */
  spawnedBy?: string;
  outcome?: 'applied' | 'denied' | 'downgraded';
};

export type LogWho = { requestId: string; spawnedBy: string; policy: string };

// The one helper every reducer writes the action log through.
export function logAction(ctx: Ctx, actor: Actor, who: LogWho, reducer: string, e: Logged): void {
  ctx.db.actionLog.insert({
    id: 0n,
    at: ctx.timestamp,
    prId: e.prId ?? 0n,
    requestId: who.requestId,
    reducer,
    outcome: e.outcome ?? 'applied',
    entity: e.entity,
    summary: e.summary,
    detailJson: e.detail === undefined ? '' : JSON.stringify(e.detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    sender: ctx.sender,
    actorKind: actor.kind,
    actorName: actor.name,
    actorOrigin: actor.origin,
    onBehalfOf: actor.onBehalfOf ?? undefined,
    spawnedBy: e.spawnedBy ?? who.spawnedBy,
    policy: who.policy,
  });
}

// ---------------------------------------------------------------------------------------------
// write(): the single path from a reducer body to the action log
// ---------------------------------------------------------------------------------------------

// Every write reducer takes this first. requestId is the caller's own id, to match its call to
// the outcome in action_log (a denial returns normally, so the log is where it shows up).
// spawnedBy says what started this call: 'Norn', a parent agent run, ...
export const CallMeta = t.object('CallMeta', { requestId: t.string(), spawnedBy: t.string() });

export type Call = {
  name: string;
  actor: Actor;
  requestId: string;
  spawnedBy: string;
  decision: Decision;
  /** Write an extra log row with this call's actor, policy and request id (e.g. one per affected ECR). */
  log: (e: Logged) => void;
};

type Body<P extends RowObj> = (ctx: Ctx, args: InferTypeOfRow<P>, call: Call) => Logged | null;
type WriteOpts<P extends RowObj> = {
  /** For which arguments a 'downgrade' decision is something the body can honour. Otherwise it is a denial. */
  downgradable?: (args: InferTypeOfRow<P>) => boolean;
};

function validMeta(meta: { requestId: string; spawnedBy: string }) {
  const requestId = meta.requestId.trim();
  const spawnedBy = meta.spawnedBy.trim();
  if (requestId.length > 64) throw new SenderError('meta.requestId is too long (max 64 characters)');
  if (!spawnedBy) throw new SenderError('meta.spawnedBy is required (say what started this call, e.g. "Norn")');
  if (spawnedBy.length > 64) throw new SenderError('meta.spawnedBy is too long (max 64 characters)');
  return { requestId, spawnedBy };
}

// Return null from a body that wrote nothing worth recording: an idempotent no-op, or ephemeral
// state written many times a second (lease extensions, progress ticks).
export function write<P extends RowObj>(name: string, params: P, body: Body<P>, opts: WriteOpts<P> = {}): ReducerExport<any, any> {
  return spacetimedb.reducer({ name }, { meta: CallMeta, ...params } as any, ((ctx: Ctx, all: InferTypeOfRow<P> & { meta: { requestId: string; spawnedBy: string } }) => {
    const { meta, ...args } = all as any;
    const m = validMeta(meta);
    const first = resolveActor(ctx);
    const decision = authorize(ctx, first, name, args);
    const policy = decisionText(decision);
    const prId = typeof args.prId === 'bigint' ? (args.prId as bigint) : 0n;
    const who: LogWho = { requestId: m.requestId, spawnedBy: m.spawnedBy, policy };

    const downgradeOk = decision.effect === 'downgrade' && opts.downgradable?.(args as InferTypeOfRow<P>) === true;
    if (decision.effect === 'deny' || (decision.effect === 'downgrade' && !downgradeOk)) {
      // A denial is an outcome, not an error: return normally so the log row is kept.
      const why = decision.effect === 'deny' ? decision.reason : `no weaker action is available here (${decision.reason})`;
      logAction(ctx, first, who, name, { prId, entity: 'denied', summary: `${name} refused: ${why}`, outcome: 'denied' });
      return;
    }

    const call: Call = {
      name,
      actor: first,
      requestId: m.requestId,
      spawnedBy: m.spawnedBy,
      decision,
      log: e => logAction(ctx, resolveActor(ctx), who, name, e),
    };
    const entry = body(ctx, args as InferTypeOfRow<P>, call);
    // Resolve the actor again: register_actor changes who the sender is mid-call.
    if (entry) logAction(ctx, resolveActor(ctx), who, name, { ...entry, outcome: entry.outcome ?? (downgradeOk ? 'downgraded' : 'applied') });
  }) as any);
}

// ---------------------------------------------------------------------------------------------
// Check run helpers
// ---------------------------------------------------------------------------------------------

export function getPr(ctx: Ctx, prId: bigint): Pr {
  const pr = ctx.db.pullRequest.id.find(prId);
  if (!pr) throw new SenderError(`ECR ${prId} does not exist`);
  return pr;
}

export function getRun(ctx: Ctx, id: bigint): Run {
  const run = ctx.db.checkRun.id.find(id);
  if (!run) throw new SenderError(`check run ${id} does not exist`);
  return run;
}

export function clearProgress(ctx: Ctx, runId: bigint) {
  ctx.db.checkProgress.checkRunId.delete(runId);
}

// The newest run of a stage on exactly these inputs, whatever state it is in (except stale or cancelled).
function runOnInputs(ctx: Ctx, prId: bigint, stage: string, hash: string): Run | undefined {
  let best: Run | undefined;
  for (const r of ctx.db.checkRun.prId.filter(prId)) {
    if (r.stage === stage && r.inputHash === hash && STANDING.includes(r.status) && (!best || r.id > best.id)) best = r;
  }
  return best;
}

// A stage may be claimed only when every stage it reads from has finished on the current inputs.
export function missingDeps(ctx: Ctx, pr: Pr, stage: string): string[] {
  const infos = stageInfos(ctx, pr);
  return stageDef(stage).deps.filter(dep => runOnInputs(ctx, pr.id, dep, infos[dep]!.hash)?.status !== 'done');
}

export function insertRun(ctx: Ctx, pr: Pr, stage: string, trigger: 'automatic' | 'requested', note = '') {
  const info = stageInfos(ctx, pr)[stage]!;
  return ctx.db.checkRun.insert({
    id: 0n,
    prId: pr.id,
    stage,
    tier: stageDef(stage).tier,
    trigger,
    inputHash: info.hash,
    inputsJson: JSON.stringify({ baseVersion: pr.baseVersion, ...info.inputs }),
    status: 'queued',
    attempts: 0,
    maxAttempts: cfgInt(ctx, 'max_attempts'),
    claimedBy: undefined,
    leaseExpiresAt: undefined,
    requestedBy: ctx.sender,
    note,
    createdAt: ctx.timestamp,
    startedAt: undefined,
    finishedAt: undefined,
  });
}

// A queued run whose upstream stage failed (or is itself blocked) can never be claimed. Mark it
// blocked, with the reason, so nobody waits on it; when the upstream stage is requested again and
// is no longer failed, put it back in the queue. Idempotent; call after anything that can change
// a run's status.
export function settleBlocked(ctx: Ctx, prId: bigint): void {
  const pr = ctx.db.pullRequest.id.find(prId);
  if (!pr) return;
  const infos = stageInfos(ctx, pr);
  for (const stage of STAGE_ORDER) {
    const run = runOnInputs(ctx, pr.id, stage, infos[stage]!.hash);
    if (!run || (run.status !== 'queued' && run.status !== 'blocked')) continue;
    let problem = '';
    for (const dep of stageDef(stage).deps) {
      const up = runOnInputs(ctx, pr.id, dep, infos[dep]!.hash);
      if (up?.status === 'failed') {
        problem = `${dep} failed${up.note ? `: ${up.note}` : ''}`;
        break;
      }
      if (up?.status === 'blocked') {
        problem = `${dep} is blocked`;
        break;
      }
    }
    if (problem && run.status === 'queued') ctx.db.checkRun.id.update({ ...run, status: 'blocked', note: `blocked: ${problem}` });
    else if (!problem && run.status === 'blocked') ctx.db.checkRun.id.update({ ...run, status: 'queued', note: '' });
  }
}

// Bring one ECR in step with the baseline and its inputs, inside the caller's transaction:
//  0. move it onto the current baseline version;
//  1. if its inputs changed, bump the revision and withdraw any approval (approval is of a
//     specific forecast);
//  2. mark every run whose hash no longer matches as stale (queued, running, done and blocked alike);
//  3. enqueue a fresh automatic run for each code stage that has no run on the current inputs.
//     Deep stages are never enqueued here: they go stale and wait to be requested again (#10).
//  4. block or unblock queued runs by the state of their upstream stages.
// Because hashes are pure functions of the inputs, calling this twice changes nothing.
// Returns a short description of what changed, for the action log ('no change' when nothing did).
export function reconcile(ctx: Ctx, prId: bigint): string {
  let pr = getPr(ctx, prId);
  if (!OPEN_PR.includes(pr.status as PrStatus)) return 'not open';

  const notes: string[] = [];
  const main = currentMain(ctx);
  if (pr.baseVersion !== main.version) {
    notes.push(`rebased baseline v${pr.baseVersion} -> v${main.version}`);
    pr = { ...pr, baseVersion: main.version };
    ctx.db.pullRequest.id.update({ ...pr, updatedAt: ctx.timestamp });
  }

  const infos = stageInfos(ctx, pr);
  const digest = digestOf(infos);
  if (digest !== pr.inputsDigest) {
    const withdrawn = pr.status === 'approved';
    pr = { ...pr, inputsDigest: digest, revision: pr.revision + 1, status: withdrawn ? 'review' : pr.status };
    ctx.db.pullRequest.id.update({ ...pr, updatedAt: ctx.timestamp });
    notes.push(`revision ${pr.revision}${withdrawn ? ', approval withdrawn' : ''}`);
  }

  let staled = 0;
  let enqueued = 0;
  for (const stage of STAGE_ORDER) {
    const want = infos[stage]!.hash;
    let hasCurrent = false;
    for (const r of [...ctx.db.checkRun.prId.filter(prId)]) {
      if (r.stage !== stage) continue;
      if (r.inputHash === want) {
        // A failed run on the current inputs counts as handled: no endless automatic retry loop.
        if (STANDING.includes(r.status)) hasCurrent = true;
      } else if (LIVE.includes(r.status)) {
        ctx.db.checkRun.id.update({
          ...r,
          status: 'stale',
          claimedBy: undefined,
          leaseExpiresAt: undefined,
          finishedAt: ctx.timestamp,
          note: 'inputs changed',
        });
        clearProgress(ctx, r.id);
        staled++;
      }
    }
    if (!hasCurrent && stageDef(stage).tier === 'code') {
      insertRun(ctx, pr, stage, 'automatic');
      enqueued++;
    }
  }
  settleBlocked(ctx, prId);
  if (staled) notes.push(`${staled} run(s) stale`);
  if (enqueued) notes.push(`${enqueued} run(s) enqueued`);
  return notes.length ? notes.join('; ') : 'no change';
}

// With deep_review_mode 'auto', a new ECR gets its deep stages queued once, when it is filed. They
// count as requested (by the config) towards the cap, and are never re-queued after an edit.
export function enqueueDeepOnOpen(ctx: Ctx, prId: bigint): number {
  if (cfg(ctx, 'deep_review_mode') !== 'auto') return 0;
  const pr = getPr(ctx, prId);
  let n = 0;
  for (const stage of STAGE_ORDER) {
    if (stageDef(stage).tier !== 'deep') continue;
    insertRun(ctx, pr, stage, 'requested', 'requested by config: deep_review_mode=auto');
    n++;
  }
  settleBlocked(ctx, prId);
  return n;
}

// Reconcile every open ECR (the baseline moved, or a config knob changed) and write one action-log
// row for each ECR that changed, so a reader filtering by ECR sees why its state moved.
export function reconcileAllOpen(ctx: Ctx, call: Call, cause: string): number {
  let n = 0;
  for (const pr of [...ctx.db.pullRequest.iter()]) {
    if (!OPEN_PR.includes(pr.status as PrStatus)) continue;
    const outcome = reconcile(ctx, pr.id);
    n++;
    if (outcome !== 'no change') call.log({ prId: pr.id, entity: `pull_request:${pr.id}`, summary: `${cause}: ${outcome}` });
  }
  return n;
}
