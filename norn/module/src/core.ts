// Shared logic for the reducers: constants, config, input hashing, actor identity, the action
// log helper, and the reconcile loop that keeps check runs in step with their inputs.
import { SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

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

export type Tier = 'code' | 'deep';

// The forecast pipeline, ARCHITECTURE.md section 5. `code` stages are cheap and re-run on every
// input change; `deep` stages are agent-heavy and run when requested (#10).
export const STAGES: Record<string, { tier: Tier; deps: string[] }> = {
  s0_extract: { tier: 'deep', deps: [] },
  s1_bom_delta: { tier: 'code', deps: [] },
  s2_cost: { tier: 'code', deps: ['s1_bom_delta'] },
  s3_timeline: { tier: 'code', deps: ['s1_bom_delta'] },
  s4_supply: { tier: 'code', deps: ['s1_bom_delta'] },
  s5_card: { tier: 'deep', deps: ['s2_cost', 's3_timeline', 's4_supply'] },
};

export function stageDef(stage: string) {
  const def = STAGES[stage];
  if (!def) throw new SenderError(`unknown stage '${stage}' (expected one of ${Object.keys(STAGES).join(', ')})`);
  return def;
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export const CONFIG_DEFAULTS: Record<string, string> = {
  // 'on_request' (Bowman's default) or 'auto': whether deep stages are enqueued automatically.
  deep_review_mode: 'on_request',
  // Requested runs of one deep stage per ECR ("once or at most twice", #10).
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
// Input hashing (ARCHITECTURE.md section 8): same inputs, same hash; "is this current" is a
// string comparison. FNV-1a 64-bit: not cryptographic, only a change detector.
// ---------------------------------------------------------------------------------------------

function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

// The assumptions a PR sees: the baseline's current rows, with the PR's own rows on top.
export function effectiveAssumptions(ctx: Ctx, prId: bigint) {
  const byKey = new Map<string, ReturnType<typeof ctx.db.assumption.id.find> & {}>();
  for (const a of ctx.db.assumption.prId.filter(0n)) if (a.current) byKey.set(a.key, a);
  if (prId !== 0n) for (const a of ctx.db.assumption.prId.filter(prId)) if (a.current) byKey.set(a.key, a);
  return [...byKey.values()];
}

// stage '*' hashes everything, whichever stage reads it (used for the PR's digest).
export function inputHash(ctx: Ctx, pr: { id: bigint; baseVersion: number }, stage: string): string {
  const ids = effectiveAssumptions(ctx, pr.id)
    .filter(a => stage === '*' || a.affects.length === 0 || a.affects.includes(stage))
    .map(a => `${a.key}#${a.id}`)
    .sort();
  // The overlay is not modelled yet: the ECR's id stands in for it, so two ECRs never share a hash.
  // When Change/Commit tables exist, the ECR's head commit id replaces it.
  return fnv1a64(JSON.stringify([cfg(ctx, 'code_version'), cfg(ctx, 'seed'), stage, pr.baseVersion, String(pr.id), ids]));
}

// ---------------------------------------------------------------------------------------------
// Actors, policy and the action log (#34)
// ---------------------------------------------------------------------------------------------

export type Actor = {
  kind: 'person' | 'agent' | 'unknown';
  name: string;
  origin: string;
  onBehalfOf: string | null;
  spawnedBy: string;
};

export function resolveActor(ctx: Ctx): Actor {
  // Scheduled reducers are called by the module's own identity.
  if (ctx.sender.isEqual(ctx.databaseIdentity)) {
    return { kind: 'agent', name: 'norn-scheduler', origin: 'norn', onBehalfOf: null, spawnedBy: 'Norn' };
  }
  const p = ctx.db.principal.identity.find(ctx.sender);
  if (p) {
    return {
      kind: p.kind as Actor['kind'],
      name: p.name,
      origin: p.origin,
      onBehalfOf: p.onBehalfOf ?? null,
      spawnedBy: p.spawnedBy,
    };
  }
  return {
    kind: 'unknown',
    name: `unregistered:${ctx.sender.toHexString().slice(0, 8)}`,
    origin: 'unknown',
    onBehalfOf: null,
    spawnedBy: 'unknown',
  };
}

// The one place policy will live. No rules yet: everything is allowed, and the log says so.
// Throw SenderError from here to deny. (A denial rolls back the whole transaction, including any
// log row, so denied attempts cannot be logged from inside the reducer; see NOTES.md.)
export function authorize(_ctx: Ctx, _actor: Actor, _reducer: string, _args: unknown): string {
  return 'allow (no rules yet)';
}

export type Logged = {
  prId?: bigint;
  entity: string;
  summary: string;
  detail?: unknown;
};

// The one helper every reducer writes the action log through.
export function logAction(ctx: Ctx, actor: Actor, policy: string, reducer: string, e: Logged): void {
  ctx.db.actionLog.insert({
    id: 0n,
    at: ctx.timestamp,
    prId: e.prId ?? 0n,
    reducer,
    entity: e.entity,
    summary: e.summary,
    detailJson: e.detail === undefined ? '' : JSON.stringify(e.detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    sender: ctx.sender,
    actorKind: actor.kind,
    actorName: actor.name,
    actorOrigin: actor.origin,
    onBehalfOf: actor.onBehalfOf ?? undefined,
    spawnedBy: actor.spawnedBy,
    policy,
  });
}

// ---------------------------------------------------------------------------------------------
// Check run helpers
// ---------------------------------------------------------------------------------------------

export function getPr(ctx: Ctx, prId: bigint) {
  const pr = ctx.db.pullRequest.id.find(prId);
  if (!pr) throw new SenderError(`ECR ${prId} does not exist`);
  return pr;
}

export function getRun(ctx: Ctx, id: bigint) {
  const run = ctx.db.checkRun.id.find(id);
  if (!run) throw new SenderError(`check run ${id} does not exist`);
  return run;
}

export function clearProgress(ctx: Ctx, runId: bigint) {
  ctx.db.checkProgress.checkRunId.delete(runId);
}

// A stage may be claimed only when every stage it depends on has finished on the current inputs.
export function missingDeps(ctx: Ctx, pr: { id: bigint; baseVersion: number }, stage: string): string[] {
  const missing: string[] = [];
  for (const dep of stageDef(stage).deps) {
    const want = inputHash(ctx, pr, dep);
    let ok = false;
    for (const r of ctx.db.checkRun.prId.filter(pr.id)) {
      if (r.stage === dep && r.status === 'done' && r.inputHash === want) {
        ok = true;
        break;
      }
    }
    if (!ok) missing.push(dep);
  }
  return missing;
}

export function insertRun(
  ctx: Ctx,
  pr: { id: bigint; baseVersion: number },
  stage: string,
  trigger: 'automatic' | 'requested',
  requestedBy: string
) {
  return ctx.db.checkRun.insert({
    id: 0n,
    prId: pr.id,
    stage,
    tier: stageDef(stage).tier,
    trigger,
    inputHash: inputHash(ctx, pr, stage),
    status: 'queued',
    attempts: 0,
    maxAttempts: cfgInt(ctx, 'max_attempts'),
    claimedBy: undefined,
    claimedByName: undefined,
    leaseExpiresAt: undefined,
    requestedBy,
    note: '',
    createdAt: ctx.timestamp,
    startedAt: undefined,
    finishedAt: undefined,
  });
}

// Bring one ECR in step with its inputs, inside the caller's transaction:
//  1. if its inputs changed, bump the revision and withdraw any approval (approval is of a
//     specific forecast);
//  2. mark every live run whose hash no longer matches as stale (queued, running and done alike);
//  3. enqueue a fresh automatic run for each code stage that has no current run. Deep stages are
//     only enqueued here when config deep_review_mode is 'auto'.
// Because hashes are pure functions of the inputs, calling this twice changes nothing.
// Returns a short description of what changed, for the action log.
export function reconcile(ctx: Ctx, prId: bigint, requestedBy: string): string {
  const pr = getPr(ctx, prId);
  if (!OPEN_PR.includes(pr.status as PrStatus)) return 'not open';

  const notes: string[] = [];
  const digest = inputHash(ctx, pr, '*');
  if (digest !== pr.inputsDigest) {
    const withdrawn = pr.status === 'approved';
    ctx.db.pullRequest.id.update({
      ...pr,
      inputsDigest: digest,
      revision: pr.revision + 1,
      status: withdrawn ? 'review' : pr.status,
      updatedAt: ctx.timestamp,
    });
    notes.push(`revision ${pr.revision + 1}${withdrawn ? ', approval withdrawn' : ''}`);
  }

  const autoDeep = cfg(ctx, 'deep_review_mode') === 'auto';
  let staled = 0;
  let enqueued = 0;
  for (const stage of Object.keys(STAGES)) {
    const want = inputHash(ctx, pr, stage);
    let hasCurrent = false;
    for (const r of [...ctx.db.checkRun.prId.filter(prId)]) {
      if (r.stage !== stage) continue;
      const live = r.status === 'queued' || r.status === 'running' || r.status === 'done';
      if (r.inputHash === want) {
        // failed runs on the current inputs count as handled: no endless automatic retry loop
        if (live || r.status === 'failed') hasCurrent = true;
      } else if (live) {
        ctx.db.checkRun.id.update({
          ...r,
          status: 'stale',
          claimedBy: undefined,
          claimedByName: undefined,
          leaseExpiresAt: undefined,
          finishedAt: ctx.timestamp,
          note: 'inputs changed',
        });
        clearProgress(ctx, r.id);
        staled++;
      }
    }
    const def = stageDef(stage);
    if (!hasCurrent && (def.tier === 'code' || autoDeep)) {
      insertRun(ctx, pr, stage, 'automatic', requestedBy);
      enqueued++;
    }
  }
  if (staled) notes.push(`${staled} run(s) stale`);
  if (enqueued) notes.push(`${enqueued} run(s) enqueued`);
  return notes.length ? notes.join('; ') : 'no change';
}

export function reconcileAllOpen(ctx: Ctx, requestedBy: string): number {
  let n = 0;
  for (const pr of [...ctx.db.pullRequest.iter()]) {
    if (OPEN_PR.includes(pr.status as PrStatus)) {
      reconcile(ctx, pr.id, requestedBy);
      n++;
    }
  }
  return n;
}
