// The narrow write API (ARCHITECTURE.md section 9). Workers and the UI change state only through
// these reducers. Every one is defined with write(), which resolves the actor, runs the policy
// check, runs the body, and writes the action log through one helper (#34). Only reducers are
// exported from this file: named exports of a module entry are registered with SpacetimeDB.
import { SenderError, t } from 'spacetimedb/server';
import type { ReducerExport } from 'spacetimedb/server';
import type { InferTypeOfRow, RowObj } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb, { reaperSchedule } from './schema';
import {
  CONFIG_DEFAULTS,
  OPEN_PR,
  PR_STATUSES,
  PR_TRANSITIONS,
  SOURCES,
  STAGES,
  TRIGGERS,
  authorize,
  cfg,
  cfgInt,
  clearProgress,
  getPr,
  getRun,
  inputHash,
  insertRun,
  logAction,
  missingDeps,
  plusMs,
  reconcile,
  reconcileAllOpen,
  resolveActor,
  stageDef,
  type Actor,
  type Ctx,
  type Logged,
  type PrStatus,
} from './core';

// ---------------------------------------------------------------------------------------------
// write(): the single path from a reducer body to the action log
// ---------------------------------------------------------------------------------------------

type Body<P extends RowObj> = (ctx: Ctx, args: InferTypeOfRow<P>, actor: Actor) => Logged | null;

// Return null from a body that wrote nothing worth recording: an idempotent no-op, or ephemeral
// state written many times a second (lease extensions, progress ticks).
function write<P extends RowObj>(name: string, params: P, body: Body<P>): ReducerExport<any, any> {
  return spacetimedb.reducer({ name }, params as any, ((ctx: Ctx, args: InferTypeOfRow<P>) => {
    const policy = authorize(ctx, resolveActor(ctx), name, args);
    const entry = body(ctx, args, resolveActor(ctx));
    // Resolve again: register_actor changes who the sender is mid-call.
    if (entry) logAction(ctx, resolveActor(ctx), policy, name, entry);
  }) as any);
}

function nonEmpty(s: string, what: string, max: number) {
  const v = s.trim();
  if (!v) throw new SenderError(`${what} is required`);
  if (v.length > max) throw new SenderError(`${what} is too long (max ${max} characters)`);
  return v;
}

function parseJson(s: string, what: string) {
  try {
    return JSON.parse(s);
  } catch {
    throw new SenderError(`${what} is not valid JSON`);
  }
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  ctx.db.mainVersion.insert({ id: 0, version: 1, updatedAt: ctx.timestamp, note: 'initial baseline' });
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) ctx.db.nornConfig.insert({ key, value });
  ctx.db.reaperSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(5_000_000n) });
  // The publisher's identity is not registered; say what it is rather than "unregistered".
  const publisher: Actor = { kind: 'unknown', name: 'publisher', origin: 'cli', onBehalfOf: null, spawnedBy: 'spacetime publish' };
  logAction(ctx, publisher, 'allow (no rules yet)', 'init', {
    entity: 'module',
    summary: 'module published: seeded main_version, config and the lease reaper',
  });
});

// ---------------------------------------------------------------------------------------------
// Identity (#34)
// ---------------------------------------------------------------------------------------------

// Declare who this connection is. Self-declared for now; once real auth lands the claims should
// be checked against the JWT in ctx.senderAuth. A worker calls this again at the start of each
// run to set spawned_by to that run (e.g. 'check_run:12').
export const registerActor = write(
  'register_actor',
  {
    kind: t.string(), // person | agent
    name: t.string(),
    origin: t.string(), // human | norn | external
    onBehalfOf: t.option(t.string()),
    spawnedBy: t.string(),
  },
  (ctx, a) => {
    const kind = a.kind;
    if (kind !== 'person' && kind !== 'agent') throw new SenderError(`kind must be 'person' or 'agent'`);
    const name = nonEmpty(a.name, 'name', 64);
    if (kind === 'person' && a.origin !== 'human') throw new SenderError(`a person has origin 'human'`);
    if (kind === 'agent' && a.origin !== 'norn' && a.origin !== 'external')
      throw new SenderError(`an agent has origin 'norn' (Norn's own) or 'external' (a person's own agent)`);
    const onBehalfOf = a.onBehalfOf?.trim() || undefined;
    if (kind === 'agent' && a.origin === 'external' && !onBehalfOf)
      throw new SenderError(`an external agent must say which person it acts for (onBehalfOf)`);
    if (kind === 'person' && onBehalfOf) throw new SenderError(`a person does not act on behalf of anyone`);
    const spawnedBy = nonEmpty(a.spawnedBy, 'spawnedBy', 64);

    const row = { identity: ctx.sender, kind, name, origin: a.origin, onBehalfOf, spawnedBy, registeredAt: ctx.timestamp };
    if (ctx.db.principal.identity.find(ctx.sender)) ctx.db.principal.identity.update(row);
    else ctx.db.principal.insert(row);
    return {
      entity: `principal:${ctx.sender.toHexString().slice(0, 8)}`,
      summary: `registered ${kind} '${name}' (${a.origin})${onBehalfOf ? ` for ${onBehalfOf}` : ''}, spawned by ${spawnedBy}`,
    };
  }
);

// Policy knobs, e.g. Bowman's deep_review_mode. Only known keys.
export const setConfig = write('set_config', { key: t.string(), value: t.string() }, (ctx, a) => {
  if (!(a.key in CONFIG_DEFAULTS)) throw new SenderError(`unknown config key '${a.key}'`);
  if (a.key === 'deep_review_mode' && a.value !== 'auto' && a.value !== 'on_request')
    throw new SenderError(`deep_review_mode is 'auto' or 'on_request'`);
  if (['deep_review_limit', 'max_attempts', 'lease_default_ms'].includes(a.key) && !/^[1-9]\d{0,8}$/.test(a.value))
    throw new SenderError(`${a.key} must be a positive integer`);
  const old = cfg(ctx, a.key);
  if (old === a.value) return null;
  const row = { key: a.key, value: a.value };
  if (ctx.db.nornConfig.key.find(a.key)) ctx.db.nornConfig.key.update(row);
  else ctx.db.nornConfig.insert(row);
  // Changing the code version or the seed changes every hash; switching deep review to 'auto'
  // enqueues the deep stages. Reconcile covers both.
  const n = reconcileAllOpen(ctx, 'config change');
  return { entity: `norn_config:${a.key}`, summary: `${a.key}: ${old} -> ${a.value} (reconciled ${n} open ECR(s))` };
});

// ---------------------------------------------------------------------------------------------
// ECRs
// ---------------------------------------------------------------------------------------------

export const createPr = write(
  'create_pr',
  { title: t.string(), description: t.string() },
  (ctx, a, actor) => {
    const title = nonEmpty(a.title, 'title', 200);
    if (a.description.length > 20000) throw new SenderError('description is too long (max 20000 characters)');
    const base = ctx.db.mainVersion.id.find(0)!.version;
    const draft = {
      id: 0n,
      title,
      description: a.description,
      status: 'draft',
      baseVersion: base,
      revision: 1,
      inputsDigest: '',
      createdBy: actor.name,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      mergedVersion: undefined,
    };
    const pr = ctx.db.pullRequest.insert(draft);
    // Start with the digest of its inputs so the first reconcile only enqueues, not "revises".
    ctx.db.pullRequest.id.update({ ...pr, inputsDigest: inputHash(ctx, pr, '*') });
    const outcome = reconcile(ctx, pr.id, actor.name);
    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `opened ECR '${title}' on baseline v${base}; ${outcome}` };
  }
);

export const setPrStatus = write(
  'set_pr_status',
  { prId: t.u64(), status: t.string() },
  (ctx, a, actor) => {
    const pr = getPr(ctx, a.prId);
    const to = a.status as PrStatus;
    if (!PR_STATUSES.includes(to)) throw new SenderError(`status must be one of ${PR_STATUSES.join(', ')}`);
    const from = pr.status as PrStatus;
    if (!PR_TRANSITIONS[from].includes(to))
      throw new SenderError(`ECR ${pr.id} is ${from}; it cannot go straight to ${to}`);

    if (to === 'approved') {
      // Approval is of a specific forecast: every cheap check must have finished on today's inputs.
      const notReady = Object.entries(STAGES)
        .filter(([, d]) => d.tier === 'code')
        .map(([s]) => s)
        .filter(s => {
          const want = inputHash(ctx, pr, s);
          return ![...ctx.db.checkRun.prId.filter(pr.id)].some(r => r.stage === s && r.status === 'done' && r.inputHash === want);
        });
      if (notReady.length)
        throw new SenderError(`cannot approve ECR ${pr.id}: checks not finished on current inputs (${notReady.join(', ')})`);
    }

    // Finish with this ECR's own row first, so the re-check of other ECRs below never touches it.
    const mv = ctx.db.mainVersion.id.find(0)!;
    const mergedVersion = to === 'merged' ? mv.version + 1 : pr.mergedVersion;
    ctx.db.pullRequest.id.update({ ...pr, status: to, updatedAt: ctx.timestamp, mergedVersion });

    if (to === 'merged' || to === 'closed') {
      // Nothing left to compute for an ECR that is released or abandoned.
      for (const r of [...ctx.db.checkRun.prId.filter(pr.id)]) {
        if (r.status === 'queued' || r.status === 'running') {
          ctx.db.checkRun.id.update({
            ...r,
            status: 'cancelled',
            claimedBy: undefined,
            claimedByName: undefined,
            leaseExpiresAt: undefined,
            finishedAt: ctx.timestamp,
            note: `ECR ${to}`,
          });
          clearProgress(ctx, r.id);
        }
      }
    }
    let extra = '';
    if (to === 'merged') {
      // The ECO is released: the baseline moves, and every other open ECR is re-checked against it.
      const next = mv.version + 1;
      ctx.db.mainVersion.id.update({ ...mv, version: next, updatedAt: ctx.timestamp, note: `ECO from ECR ${pr.id}: ${pr.title}` });
      for (const other of [...ctx.db.pullRequest.iter()]) {
        if (OPEN_PR.includes(other.status as PrStatus)) ctx.db.pullRequest.id.update({ ...other, baseVersion: next });
      }
      const n = reconcileAllOpen(ctx, actor.name);
      extra = `; baseline v${mv.version} -> v${next}, re-checked ${n} other open ECR(s)`;
    } else if (from === 'closed') {
      extra = `; ${reconcile(ctx, pr.id, actor.name)}`;
    }
    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `${from} -> ${to}${extra}` };
  }
);

export const addComment = write(
  'add_comment',
  { prId: t.u64(), anchor: t.string(), body: t.string() },
  (ctx, a, actor) => {
    getPr(ctx, a.prId);
    const body = nonEmpty(a.body, 'comment', 4000);
    const c = ctx.db.comment.insert({
      id: 0n,
      prId: a.prId,
      authorName: actor.name,
      authorKind: actor.kind,
      anchor: a.anchor.trim(),
      body,
      createdAt: ctx.timestamp,
    });
    return { prId: a.prId, entity: `comment:${c.id}`, summary: `commented${c.anchor ? ` on ${c.anchor}` : ''}` };
  }
);

// ---------------------------------------------------------------------------------------------
// Assumptions: one transaction edits the value, invalidates the checks that read it, and
// enqueues their replacements, so every viewer sees a single consistent update.
// ---------------------------------------------------------------------------------------------

export const recordAssumption = write(
  'record_assumption',
  {
    prId: t.u64(), // 0 = the production baseline
    key: t.string(),
    distJson: t.string(),
    source: t.string(),
    rationale: t.string(),
    affects: t.array(t.string()),
    expectedRev: t.u32(), // the revision the editor saw; 0 when creating
  },
  (ctx, a, actor) => {
    if (a.prId !== 0n) getPr(ctx, a.prId);
    const key = nonEmpty(a.key, 'key', 80);
    parseJson(a.distJson, 'distJson');
    if (a.distJson.length > 4000) throw new SenderError('distJson is too long (max 4000 characters)');
    if (!(SOURCES as readonly string[]).includes(a.source)) throw new SenderError(`source must be one of ${SOURCES.join(', ')}`);
    for (const s of a.affects) stageDef(s);
    if (a.prId !== 0n) {
      const status = getPr(ctx, a.prId).status as PrStatus;
      if (!OPEN_PR.includes(status)) throw new SenderError(`ECR ${a.prId} is ${status}; its assumptions are frozen`);
    }

    let cur: ReturnType<typeof ctx.db.assumption.id.find> | undefined;
    for (const r of ctx.db.assumption.prId.filter(a.prId)) if (r.key === key && r.current) cur = r;
    const curRev = cur?.rev ?? 0;
    if (a.expectedRev !== curRev)
      throw new SenderError(`'${key}' is at revision ${curRev}, not ${a.expectedRev}: someone else edited it; reload and retry`);
    if (
      cur &&
      cur.distJson === a.distJson &&
      cur.source === a.source &&
      cur.rationale === a.rationale &&
      cur.affects.join() === a.affects.join()
    )
      return null; // nothing changed: do not invalidate anything

    if (cur) ctx.db.assumption.id.update({ ...cur, current: false });
    const row = ctx.db.assumption.insert({
      id: 0n,
      prId: a.prId,
      key,
      distJson: a.distJson,
      source: a.source,
      rationale: a.rationale,
      rev: curRev + 1,
      current: true,
      affects: a.affects,
      createdBy: actor.name,
      createdAt: ctx.timestamp,
    });

    // prId 0 edits the baseline, which every open ECR sees.
    let outcome: string;
    if (a.prId === 0n) outcome = `re-checked ${reconcileAllOpen(ctx, actor.name)} open ECR(s)`;
    else outcome = reconcile(ctx, a.prId, actor.name);
    return {
      prId: a.prId,
      entity: `assumption:${row.id}`,
      summary: `${key} -> rev ${row.rev} (${a.source}); ${outcome}`,
      detail: { key, rev: row.rev, previous: cur?.distJson, value: a.distJson, affects: a.affects },
    };
  }
);

// ---------------------------------------------------------------------------------------------
// The check queue
// ---------------------------------------------------------------------------------------------

// Ask for a run of a stage on the ECR's current inputs. Idempotent: if a live run with the same
// input hash exists, nothing is written. Code stages are enqueued automatically by reconcile;
// this is how deep (agent) stages get requested, and how a failed run is retried.
export const enqueueCheck = write(
  'enqueue_check',
  { prId: t.u64(), stage: t.string(), trigger: t.string() },
  (ctx, a, actor) => {
    const pr = getPr(ctx, a.prId);
    const def = stageDef(a.stage);
    if (!(TRIGGERS as readonly string[]).includes(a.trigger)) throw new SenderError(`trigger must be 'automatic' or 'requested'`);
    const trigger = a.trigger as 'automatic' | 'requested';
    if (!OPEN_PR.includes(pr.status as PrStatus)) throw new SenderError(`ECR ${pr.id} is ${pr.status}`);
    if (def.tier === 'deep' && trigger === 'automatic' && cfg(ctx, 'deep_review_mode') !== 'auto')
      throw new SenderError(`${a.stage} is a deep review stage: it runs only when requested`);

    const want = inputHash(ctx, pr, a.stage);
    const runs = [...ctx.db.checkRun.prId.filter(pr.id)].filter(r => r.stage === a.stage);
    if (runs.some(r => r.inputHash === want && (r.status === 'queued' || r.status === 'running' || r.status === 'done')))
      return null;
    if (def.tier === 'deep' && trigger === 'requested') {
      const limit = cfgInt(ctx, 'deep_review_limit');
      const used = runs.filter(r => r.trigger === 'requested' && r.status !== 'cancelled').length;
      if (used >= limit)
        throw new SenderError(`${a.stage} has already been requested ${used} time(s) on ECR ${pr.id} (limit ${limit})`);
    }
    const run = insertRun(ctx, pr, a.stage, trigger, actor.name);
    return { prId: pr.id, entity: `check_run:${run.id}`, summary: `queued ${a.stage} (${trigger})` };
  }
);

// Take a queued run. The loser of a race gets a SenderError. Progress and the final result are
// reported against (run, attempt): the attempt number fences out a worker whose lease expired.
export const claimCheck = write(
  'claim_check',
  { checkRunId: t.u64(), leaseMs: t.u32() },
  (ctx, a, actor) => {
    const run = getRun(ctx, a.checkRunId);
    if (run.status !== 'queued') throw new SenderError(`check run ${run.id} is ${run.status}, not queued`);
    const pr = getPr(ctx, run.prId);
    if (!OPEN_PR.includes(pr.status as PrStatus)) throw new SenderError(`ECR ${pr.id} is ${pr.status}`);
    const missing = missingDeps(ctx, pr, run.stage);
    if (missing.length) throw new SenderError(`check run ${run.id} (${run.stage}) is waiting for ${missing.join(', ')}`);
    const leaseMs = Math.min(Math.max(a.leaseMs || cfgInt(ctx, 'lease_default_ms'), 1000), 300000);
    ctx.db.checkRun.id.update({
      ...run,
      status: 'running',
      attempts: run.attempts + 1,
      claimedBy: ctx.sender,
      claimedByName: actor.name,
      leaseExpiresAt: plusMs(ctx.timestamp, leaseMs),
      startedAt: ctx.timestamp,
      note: '',
    });
    return {
      prId: run.prId,
      entity: `check_run:${run.id}`,
      summary: `claimed ${run.stage}, attempt ${run.attempts + 1}/${run.maxAttempts}, lease ${leaseMs} ms`,
    };
  }
);

function ownRun(ctx: Ctx, id: bigint, attempt: number) {
  const run = getRun(ctx, id);
  if (run.status === 'stale') throw new SenderError(`check run ${id} is stale (${run.note}); discard your work`);
  if (run.status !== 'running') throw new SenderError(`check run ${id} is ${run.status}, not running`);
  if (run.attempts !== attempt) throw new SenderError(`check run ${id} has been re-claimed (now attempt ${run.attempts}, you hold ${attempt})`);
  if (!run.claimedBy || !run.claimedBy.isEqual(ctx.sender)) throw new SenderError(`check run ${id} is claimed by another worker`);
  return run;
}

export const heartbeatCheck = write(
  'heartbeat_check',
  { checkRunId: t.u64(), attempt: t.u32(), leaseMs: t.u32() },
  (ctx, a) => {
    const run = ownRun(ctx, a.checkRunId, a.attempt);
    const leaseMs = Math.min(Math.max(a.leaseMs || cfgInt(ctx, 'lease_default_ms'), 1000), 300000);
    ctx.db.checkRun.id.update({ ...run, leaseExpiresAt: plusMs(ctx.timestamp, leaseMs) });
    return null; // ephemeral: claim_check and complete_check already say who held the run
  }
);

// Stream progress of a long run. Also extends the lease, so a worker that is reporting is alive.
export const reportProgress = write(
  'report_progress',
  {
    checkRunId: t.u64(),
    attempt: t.u32(),
    done: t.u32(),
    total: t.u32(),
    percentiles: t.array(t.f64()),
    histogram: t.array(t.u32()),
    histMin: t.f64(),
    histMax: t.f64(),
    leaseMs: t.u32(),
  },
  (ctx, a) => {
    const run = ownRun(ctx, a.checkRunId, a.attempt);
    if (a.percentiles.length > 64 || a.histogram.length > 256) throw new SenderError('progress arrays are too long');
    if (![...a.percentiles, a.histMin, a.histMax].every(Number.isFinite)) throw new SenderError('progress values must be finite');
    const leaseMs = Math.min(Math.max(a.leaseMs || cfgInt(ctx, 'lease_default_ms'), 1000), 300000);
    ctx.db.checkRun.id.update({ ...run, leaseExpiresAt: plusMs(ctx.timestamp, leaseMs) });
    const row = {
      checkRunId: run.id,
      prId: run.prId,
      done: a.done,
      total: a.total,
      percentiles: a.percentiles,
      histogram: a.histogram,
      histMin: a.histMin,
      histMax: a.histMax,
      updatedAt: ctx.timestamp,
    };
    if (ctx.db.checkProgress.checkRunId.find(run.id)) {
      ctx.db.checkProgress.checkRunId.update(row);
      return null; // ephemeral and 2 per second: only the first report of a run is logged
    }
    ctx.db.checkProgress.insert(row);
    return { prId: run.prId, entity: `check_run:${run.id}`, summary: `started reporting progress (${a.done}/${a.total})` };
  }
);

const ResultInput = t.object('ResultInput', {
  key: t.string(),
  label: t.string(),
  unit: t.string(),
  p10: t.f64(),
  p50: t.f64(),
  p90: t.f64(),
  detailJson: t.string(),
});

// Finish a run and store its results in the same transaction. If any result is invalid the whole
// call rolls back: no partial results, and the run stays running.
export const completeCheck = write(
  'complete_check',
  { checkRunId: t.u64(), attempt: t.u32(), results: t.array(ResultInput) },
  (ctx, a) => {
    const run = ownRun(ctx, a.checkRunId, a.attempt);
    for (const r of a.results) {
      if (![r.p10, r.p50, r.p90].every(Number.isFinite) || !(r.p10 <= r.p50 && r.p50 <= r.p90))
        throw new SenderError(`result '${r.key}': need finite p10 <= p50 <= p90`);
      if (r.detailJson) parseJson(r.detailJson, `result '${r.key}' detailJson`);
      ctx.db.checkResult.insert({
        id: 0n,
        checkRunId: run.id,
        prId: run.prId,
        key: r.key,
        label: r.label,
        unit: r.unit,
        p10: r.p10,
        p50: r.p50,
        p90: r.p90,
        detailJson: r.detailJson,
        createdAt: ctx.timestamp,
      });
    }
    ctx.db.checkRun.id.update({ ...run, status: 'done', leaseExpiresAt: undefined, finishedAt: ctx.timestamp, note: '' });
    clearProgress(ctx, run.id);
    return { prId: run.prId, entity: `check_run:${run.id}`, summary: `${run.stage} done: ${a.results.length} result(s)` };
  }
);

// The worker gives up on a run. retryable puts it back in the queue while attempts remain.
export const failCheck = write(
  'fail_check',
  { checkRunId: t.u64(), attempt: t.u32(), error: t.string(), retryable: t.bool() },
  (ctx, a) => {
    const run = ownRun(ctx, a.checkRunId, a.attempt);
    const requeue = a.retryable && run.attempts < run.maxAttempts;
    ctx.db.checkRun.id.update({
      ...run,
      status: requeue ? 'queued' : 'failed',
      claimedBy: undefined,
      claimedByName: undefined,
      leaseExpiresAt: undefined,
      finishedAt: requeue ? undefined : ctx.timestamp,
      note: a.error.slice(0, 500),
    });
    clearProgress(ctx, run.id);
    return {
      prId: run.prId,
      entity: `check_run:${run.id}`,
      summary: `${run.stage} ${requeue ? 'returned to the queue' : 'failed'}: ${a.error.slice(0, 120)}`,
    };
  }
);

// Scheduled every 5 s. A worker that died holds a run until its lease runs out; this gives the
// run back (or fails it once attempts are used up).
export const reapExpiredLeases = spacetimedb.reducer(
  { name: 'reap_expired_leases', onSchedule: reaperSchedule },
  { timer: reaperSchedule.rowType },
  (ctx, _args) => {
    // Scheduled reducers are also callable by clients; only the module itself may run this one.
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('only the scheduler may call this');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const reaped: string[] = [];
    for (const r of [...ctx.db.checkRun.status.filter('running')]) {
      if (!r.leaseExpiresAt || r.leaseExpiresAt.microsSinceUnixEpoch > now) continue;
      const exhausted = r.attempts >= r.maxAttempts;
      ctx.db.checkRun.id.update({
        ...r,
        status: exhausted ? 'failed' : 'queued',
        claimedBy: undefined,
        claimedByName: undefined,
        leaseExpiresAt: undefined,
        finishedAt: exhausted ? ctx.timestamp : undefined,
        note: `lease expired on attempt ${r.attempts}/${r.maxAttempts}${exhausted ? '; giving up' : '; requeued'}`,
      });
      clearProgress(ctx, r.id);
      reaped.push(`${r.id}:${r.stage}${exhausted ? ':failed' : ':requeued'}`);
    }
    if (reaped.length)
      logAction(ctx, resolveActor(ctx), authorize(ctx, resolveActor(ctx), 'reap_expired_leases', null), 'reap_expired_leases', {
        entity: `check_run:${reaped.map(s => s.split(':')[0]).join(',')}`,
        summary: `expired lease(s): ${reaped.join(' ')}`,
      });
  }
);
