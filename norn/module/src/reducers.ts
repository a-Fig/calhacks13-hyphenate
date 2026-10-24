// The narrow write API (ARCHITECTURE.md section 9). Workers and the UI change state only through
// these reducers. Every one is defined with write() (core.ts), which resolves the actor, asks the
// policy gate, runs the body and writes the action log through one helper (#34). Only reducers
// and lifecycle hooks are exported from this file: named exports of a module entry are
// registered with SpacetimeDB.
//
// Errors a worker has to tell apart carry a code at the start of the message: [stale] (the inputs
// changed, discard the work), [lost] (the run is no longer yours), [invalid] (your result was
// refused).
import { SenderError, t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import spacetimedb, { reaperSchedule } from './schema';
import {
  CONFIG_DEFAULTS,
  OPEN_PR,
  PR_STATUSES,
  PR_TRANSITIONS,
  SOURCES,
  STAGES,
  STAGE_ORDER,
  TRIGGERS,
  appendMain,
  authorize,
  cfg,
  cfgInt,
  clearProgress,
  currentMain,
  decisionText,
  digestOf,
  enqueueDeepOnOpen,
  getPr,
  getRun,
  insertRun,
  logAction,
  missingDeps,
  plusMs,
  reconcile,
  reconcileAllOpen,
  resolveActor,
  settleBlocked,
  stageDef,
  stageInfos,
  write,
  type Actor,
  type Ctx,
  type PrStatus,
} from './core';

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
  ctx.db.mainVersion.insert({
    version: 1,
    parent: 0,
    cause: 'initial',
    mergedPrId: 0n,
    effectivity: undefined,
    at: ctx.timestamp,
    by: ctx.sender,
    note: 'initial baseline',
  });
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) ctx.db.nornConfig.insert({ key, value });
  ctx.db.reaperSchedule.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(5_000_000n) });
  // The publisher's identity is not registered; say what it is rather than "unregistered".
  const publisher: Actor = { kind: 'unknown', name: 'publisher', origin: 'cli', onBehalfOf: null };
  logAction(ctx, publisher, { requestId: '', spawnedBy: 'spacetime publish', policy: 'allow (system)' }, 'init', {
    entity: 'module',
    summary: 'module published: seeded main_version, config and the lease reaper',
  });
});

// ---------------------------------------------------------------------------------------------
// Identity (#34)
// ---------------------------------------------------------------------------------------------

// Declare who this connection is. Self-declared for now; once real auth lands the claims should
// be checked against the JWT in ctx.senderAuth. `kind` and `origin` are fixed by the first call: a
// connection cannot start as an agent and later present as a person. What started each call
// (spawnedBy) travels with the call, not with the connection.
export const registerActor = write(
  'register_actor',
  {
    kind: t.string(), // person | agent
    name: t.string(),
    origin: t.string(), // human | norn | external
    onBehalfOf: t.option(t.string()),
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

    const existing = ctx.db.principal.identity.find(ctx.sender);
    if (existing && (existing.kind !== kind || existing.origin !== a.origin))
      throw new SenderError(
        `this connection is registered as ${existing.kind} (${existing.origin}); kind and origin cannot change. Connect with a new identity.`
      );
    const row = { identity: ctx.sender, kind, name, origin: a.origin, onBehalfOf, registeredAt: existing?.registeredAt ?? ctx.timestamp };
    if (existing) ctx.db.principal.identity.update(row);
    else ctx.db.principal.insert(row);
    return {
      entity: `principal:${ctx.sender.toHexString().slice(0, 8)}`,
      summary: `${existing ? 're-registered' : 'registered'} ${kind} '${name}' (${a.origin})${onBehalfOf ? ` for ${onBehalfOf}` : ''}`,
    };
  }
);

// Policy knobs, e.g. Bowman's deep_review_mode. Only known keys.
export const setConfig = write('set_config', { key: t.string(), value: t.string() }, (ctx, a, call) => {
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
  // Only the code version and the seed are inputs of the hashes. Switching deep review to 'auto'
  // changes what a new ECR gets, nothing already filed.
  let extra = '';
  if (a.key === 'code_version' || a.key === 'seed') extra = ` (re-checked ${reconcileAllOpen(ctx, call, `${a.key} changed`)} open ECR(s))`;
  return { entity: `norn_config:${a.key}`, summary: `${a.key}: ${old} -> ${a.value}${extra}` };
});

// ---------------------------------------------------------------------------------------------
// ECRs
// ---------------------------------------------------------------------------------------------

// plmEcrNumber is the PLM's number for the ECR; '' means Norn originated it and it is stored as
// 'NORN-<id>' until the PLM assigns one.
export const createPr = write(
  'create_pr',
  { plmEcrNumber: t.string(), title: t.string(), description: t.string() },
  (ctx, a) => {
    const title = nonEmpty(a.title, 'title', 200);
    if (a.description.length > 20000) throw new SenderError('description is too long (max 20000 characters)');
    const plm = a.plmEcrNumber.trim();
    if (plm.length > 64) throw new SenderError('plmEcrNumber is too long (max 64 characters)');
    if (plm) {
      const taken = ctx.db.pullRequest.plmEcrNumber.find(plm);
      if (taken) throw new SenderError(`PLM ECR number '${plm}' is already filed as ECR-${taken.id}`);
    }
    const base = currentMain(ctx).version;
    const pr = ctx.db.pullRequest.insert({
      id: 0n,
      kind: 'ecr',
      plmEcrNumber: plm || `pending-${ctx.newUuidV4().toString()}`,
      title,
      description: a.description,
      status: 'draft',
      baseVersion: base,
      revision: 1,
      inputsDigest: '',
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      mergedVersion: undefined,
    });
    // Start with the digest of its inputs so the first reconcile only enqueues, not "revises".
    ctx.db.pullRequest.id.update({
      ...pr,
      plmEcrNumber: plm || `NORN-${pr.id}`,
      inputsDigest: digestOf(stageInfos(ctx, pr)),
    });
    const outcome = reconcile(ctx, pr.id);
    const deep = enqueueDeepOnOpen(ctx, pr.id);
    return {
      prId: pr.id,
      entity: `pull_request:${pr.id}`,
      summary: `opened ECR '${title}' (${plm || `NORN-${pr.id}`}) on baseline v${base}; ${outcome}${deep ? `; ${deep} deep run(s) requested by config` : ''}`,
    };
  }
);

// The ECR text is what the extraction stage reads, so an edit makes a finished extraction stale.
export const editPrText = write('edit_pr_text', { prId: t.u64(), description: t.string() }, (ctx, a) => {
  const pr = getPr(ctx, a.prId);
  if (!OPEN_PR.includes(pr.status as PrStatus)) throw new SenderError(`ECR ${pr.id} is ${pr.status}; its text is frozen`);
  if (a.description.length > 20000) throw new SenderError('description is too long (max 20000 characters)');
  if (a.description === pr.description) return null;
  ctx.db.pullRequest.id.update({ ...pr, description: a.description, updatedAt: ctx.timestamp });
  return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `edited the ECR text; ${reconcile(ctx, pr.id)}` };
});

export const setPrStatus = write(
  'set_pr_status',
  { prId: t.u64(), status: t.string() },
  (ctx, a, call) => {
    const pr = getPr(ctx, a.prId);
    const to = a.status as PrStatus;
    if (!PR_STATUSES.includes(to)) throw new SenderError(`status must be one of ${PR_STATUSES.join(', ')}`);
    const from = pr.status as PrStatus;
    if (!PR_TRANSITIONS[from].includes(to))
      throw new SenderError(`ECR ${pr.id} is ${from}; it cannot go straight to ${to}`);

    if (to === 'approved') {
      // Approval is of a specific forecast: every cheap check must have finished on today's inputs.
      const infos = stageInfos(ctx, pr);
      const notReady = STAGE_ORDER.filter(s => STAGES[s]!.tier === 'code').filter(
        s => ![...ctx.db.checkRun.prId.filter(pr.id)].some(r => r.stage === s && r.status === 'done' && r.inputHash === infos[s]!.hash)
      );
      if (notReady.length)
        throw new SenderError(`cannot approve ECR ${pr.id}: checks not finished on current inputs (${notReady.join(', ')})`);
      if (call.decision.effect === 'downgrade') {
        // The policy gate allows a recommendation but not an approval. The recommendation record
        // itself comes with #43; for now the log row is the record.
        return {
          prId: pr.id,
          entity: `pull_request:${pr.id}`,
          summary: `recommends approval; not approved (${call.decision.reason})`,
          outcome: 'downgraded',
        };
      }
    }

    if (to === 'merged') {
      const main = currentMain(ctx);
      if (pr.baseVersion !== main.version)
        throw new SenderError(`ECR ${pr.id} is based on baseline v${pr.baseVersion}, but the baseline is at v${main.version}; it must be re-checked first`);
    }

    // Finish with this ECR's own row first, so the re-check of other ECRs below never touches it.
    ctx.db.pullRequest.id.update({ ...pr, status: to, updatedAt: ctx.timestamp });

    if (to === 'merged' || to === 'closed') {
      // Nothing left to compute for an ECR that is released or abandoned.
      for (const r of [...ctx.db.checkRun.prId.filter(pr.id)]) {
        if (r.status === 'queued' || r.status === 'running' || r.status === 'blocked') {
          ctx.db.checkRun.id.update({
            ...r,
            status: 'cancelled',
            claimedBy: undefined,
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
      // The ECO is released: the baseline moves, and every other open ECR is re-checked against
      // it, with a log row on each ECR whose state changed.
      const row = appendMain(ctx, { cause: 'eco', mergedPrId: pr.id, note: `ECO from ECR ${pr.id}: ${pr.title}` });
      ctx.db.pullRequest.id.update({ ...getPr(ctx, pr.id), mergedVersion: row.version });
      const n = reconcileAllOpen(ctx, call, `ECR ${pr.id} released as baseline v${row.version}`);
      extra = `; baseline v${row.parent} -> v${row.version}, re-checked ${n} other open ECR(s)`;
    } else if (from === 'closed') {
      // Reopening: move onto today's baseline and replace whatever went out of date meanwhile.
      extra = `; ${reconcile(ctx, pr.id)}`;
    }
    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `${from} -> ${to}${extra}` };
  },
  { downgradable: a => a.status === 'approved' }
);

export const addComment = write(
  'add_comment',
  { prId: t.u64(), anchor: t.string(), body: t.string() },
  (ctx, a) => {
    getPr(ctx, a.prId);
    const body = nonEmpty(a.body, 'comment', 4000);
    const c = ctx.db.comment.insert({
      id: 0n,
      prId: a.prId,
      author: ctx.sender,
      anchor: a.anchor.trim(),
      body,
      createdAt: ctx.timestamp,
    });
    return { prId: a.prId, entity: `comment:${c.id}`, summary: `commented${c.anchor ? ` on ${c.anchor}` : ''}` };
  }
);

// ---------------------------------------------------------------------------------------------
// Baseline parts (the connectors fill this in; only the external key exists so far)
// ---------------------------------------------------------------------------------------------

export const upsertPart = write(
  'upsert_part',
  { partNumber: t.string(), name: t.string(), category: t.string(), specJson: t.string() },
  (ctx, a) => {
    const partNumber = nonEmpty(a.partNumber, 'partNumber', 64);
    const name = nonEmpty(a.name, 'name', 200);
    if (a.specJson) parseJson(a.specJson, 'specJson');
    const row = { partNumber, name, category: a.category.trim(), specJson: a.specJson, updatedAt: ctx.timestamp };
    const existing = ctx.db.part.partNumber.find(partNumber);
    if (existing) ctx.db.part.id.update({ ...existing, ...row });
    else ctx.db.part.insert({ id: 0n, ...row });
    return { entity: `part:${partNumber}`, summary: `${existing ? 'updated' : 'added'} part ${partNumber}` };
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
  (ctx, a, call) => {
    if (a.prId !== 0n) {
      const status = getPr(ctx, a.prId).status as PrStatus;
      if (!OPEN_PR.includes(status)) throw new SenderError(`ECR ${a.prId} is ${status}; its assumptions are frozen`);
    }
    const key = nonEmpty(a.key, 'key', 80);
    parseJson(a.distJson, 'distJson');
    if (a.distJson.length > 4000) throw new SenderError('distJson is too long (max 4000 characters)');
    if (!(SOURCES as readonly string[]).includes(a.source)) throw new SenderError(`source must be one of ${SOURCES.join(', ')}`);
    for (const s of a.affects) stageDef(s);

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
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });

    let outcome: string;
    if (a.prId === 0n) {
      // The baseline moves (history row), and every open ECR is re-checked against it.
      const main = appendMain(ctx, { cause: 'assumption', mergedPrId: 0n, note: `${key} rev ${row.rev}` });
      outcome = `baseline v${main.parent} -> v${main.version}, re-checked ${reconcileAllOpen(ctx, call, `baseline assumption ${key} rev ${row.rev}`)} open ECR(s)`;
    } else {
      outcome = reconcile(ctx, a.prId);
    }
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

// Ask for a run of a stage on the ECR's current inputs. Idempotent: if a standing run with the same
// input hash exists, nothing is written. Code stages are enqueued automatically by reconcile; this
// is how deep (agent) stages get requested, and how a failed run is retried (which also releases
// the stages that were blocked behind it).
export const enqueueCheck = write(
  'enqueue_check',
  { prId: t.u64(), stage: t.string(), trigger: t.string() },
  (ctx, a) => {
    const pr = getPr(ctx, a.prId);
    const def = stageDef(a.stage);
    if (!(TRIGGERS as readonly string[]).includes(a.trigger)) throw new SenderError(`trigger must be 'automatic' or 'requested'`);
    const trigger = a.trigger as 'automatic' | 'requested';
    if (!OPEN_PR.includes(pr.status as PrStatus)) throw new SenderError(`ECR ${pr.id} is ${pr.status}`);
    if (def.tier === 'deep' && trigger === 'automatic')
      throw new SenderError(`${a.stage} is a deep review stage: it runs only when requested, never automatically`);

    const want = stageInfos(ctx, pr)[a.stage]!.hash;
    const onThese = [...ctx.db.checkRun.prId.filter(pr.id)].filter(r => r.stage === a.stage && r.inputHash === want);
    if (onThese.some(r => r.status === 'queued' || r.status === 'running' || r.status === 'done' || r.status === 'blocked')) return null;
    if (def.tier === 'deep') {
      // The cap is per set of inputs: a failed run counts, a run made stale by an edit does not,
      // so an ECR that keeps changing is never locked out of a review of its latest inputs.
      const limit = cfgInt(ctx, 'deep_review_limit');
      const used = onThese.filter(r => r.trigger === 'requested' && r.status !== 'cancelled').length;
      if (used >= limit)
        throw new SenderError(`${a.stage} has already been requested ${used} time(s) on these inputs of ECR ${pr.id} (limit ${limit})`);
    }
    const run = insertRun(ctx, pr, a.stage, trigger);
    settleBlocked(ctx, pr.id);
    return { prId: pr.id, entity: `check_run:${run.id}`, summary: `queued ${a.stage} (${trigger})` };
  }
);

// Take a queued run. The loser of a race gets a SenderError. Progress and the final result are
// reported against (run, attempt): the attempt number fences out a worker whose lease expired.
export const claimCheck = write(
  'claim_check',
  { checkRunId: t.u64(), leaseMs: t.u32() },
  (ctx, a) => {
    const run = getRun(ctx, a.checkRunId);
    if (run.status !== 'queued') throw new SenderError(`check run ${run.id} is ${run.status}, not queued${run.note ? ` (${run.note})` : ''}`);
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
      leaseExpiresAt: plusMs(ctx.timestamp, leaseMs),
      startedAt: ctx.timestamp,
      note: '',
    });
    return {
      prId: run.prId,
      entity: `check_run:${run.id}`,
      summary: `claimed ${run.stage}, attempt ${run.attempts + 1}/${run.maxAttempts}, lease ${leaseMs} ms`,
      spawnedBy: `check_run:${run.id}`,
    };
  }
);

function ownRun(ctx: Ctx, id: bigint, attempt: number) {
  const run = getRun(ctx, id);
  if (run.status === 'stale') throw new SenderError(`[stale] check run ${id} is stale (${run.note}); discard your work`);
  if (run.status !== 'running') throw new SenderError(`[lost] check run ${id} is ${run.status}, not running`);
  if (run.attempts !== attempt) throw new SenderError(`[lost] check run ${id} has been re-claimed (now attempt ${run.attempts}, you hold ${attempt})`);
  if (!run.claimedBy || !run.claimedBy.isEqual(ctx.sender)) throw new SenderError(`[lost] check run ${id} is claimed by another worker`);
  return run;
}

// Extend the lease of a run that is working but not reporting progress (an agent stage).
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
    return { prId: run.prId, entity: `check_run:${run.id}`, summary: `started reporting progress (${a.done}/${a.total})`, spawnedBy: `check_run:${run.id}` };
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
        throw new SenderError(`[invalid] result '${r.key}': need finite p10 <= p50 <= p90`);
      if (r.detailJson) {
        try {
          JSON.parse(r.detailJson);
        } catch {
          throw new SenderError(`[invalid] result '${r.key}': detailJson is not valid JSON`);
        }
      }
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
        mock: true, // no worker computes anything real yet
      });
    }
    ctx.db.checkRun.id.update({ ...run, status: 'done', leaseExpiresAt: undefined, finishedAt: ctx.timestamp, note: '' });
    clearProgress(ctx, run.id);
    return { prId: run.prId, entity: `check_run:${run.id}`, summary: `${run.stage} done: ${a.results.length} result(s)`, spawnedBy: `check_run:${run.id}` };
  }
);

// The worker gives up on a run. retryable puts it back in the queue while attempts remain; a
// final failure blocks the stages that read from it, with the reason.
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
      leaseExpiresAt: undefined,
      finishedAt: requeue ? undefined : ctx.timestamp,
      note: a.error.slice(0, 500),
    });
    clearProgress(ctx, run.id);
    if (!requeue) settleBlocked(ctx, run.prId);
    return {
      prId: run.prId,
      entity: `check_run:${run.id}`,
      summary: `${run.stage} ${requeue ? 'returned to the queue' : 'failed'}: ${a.error.slice(0, 120)}`,
      spawnedBy: `check_run:${run.id}`,
    };
  }
);

// Scheduled every 5 s. A worker that died holds a run until its lease runs out; this gives the
// run back (or fails it once attempts are used up, which blocks what reads from it).
export const reapExpiredLeases = spacetimedb.reducer(
  { name: 'reap_expired_leases', onSchedule: reaperSchedule },
  { timer: reaperSchedule.rowType },
  (ctx, _args) => {
    // Scheduled reducers are also callable by clients; only the module itself may run this one.
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('only the scheduler may call this');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const reaped: string[] = [];
    const touched = new Set<bigint>();
    for (const r of [...ctx.db.checkRun.status.filter('running')]) {
      if (!r.leaseExpiresAt || r.leaseExpiresAt.microsSinceUnixEpoch > now) continue;
      const exhausted = r.attempts >= r.maxAttempts;
      ctx.db.checkRun.id.update({
        ...r,
        status: exhausted ? 'failed' : 'queued',
        claimedBy: undefined,
        leaseExpiresAt: undefined,
        finishedAt: exhausted ? ctx.timestamp : undefined,
        note: `lease expired on attempt ${r.attempts}/${r.maxAttempts}${exhausted ? '; giving up' : '; requeued'}`,
      });
      clearProgress(ctx, r.id);
      if (exhausted) touched.add(r.prId);
      reaped.push(`${r.id}:${r.stage}${exhausted ? ':failed' : ':requeued'}`);
    }
    for (const prId of touched) settleBlocked(ctx, prId);
    if (reaped.length) {
      const actor = resolveActor(ctx);
      const policy = decisionText(authorize(ctx, actor, 'reap_expired_leases', {}));
      logAction(ctx, actor, { requestId: '', spawnedBy: 'Norn', policy }, 'reap_expired_leases', {
        entity: `check_run:${reaped.map(s => s.split(':')[0]).join(',')}`,
        summary: `expired lease(s): ${reaped.join(' ')}`,
      });
    }
  }
);

// ---------------------------------------------------------------------------------------------
// The agent runner's event stream (norn/runner emits these)
// ---------------------------------------------------------------------------------------------

const AgentEventInput = t.object('AgentEventInput', {
  jobId: t.string(),
  seq: t.u32(),
  ts: t.timestamp(),
  role: t.string(),
  actor: t.string(),
  onBehalfOf: t.option(t.string()),
  spawnedBy: t.string(),
  sessionId: t.option(t.string()),
  eventType: t.string(),
  payloadJson: t.string(), // everything in the runner's event that is not one of the fields above
});

// A batch of events from one job, in any order. Idempotent on (jobId, seq): a batch sent again
// after an UnknownCallResultError adds nothing. checkRunId is 0 for a job that is not a check run.
// Not mirrored into action_log: every row names its actor, and there can be hundreds per job.
export const recordAgentEvents = write(
  'record_agent_events',
  { checkRunId: t.u64(), events: t.array(AgentEventInput) },
  (ctx, a) => {
    if (a.events.length > 200) throw new SenderError('send at most 200 events per call');
    const prId = a.checkRunId === 0n ? 0n : getRun(ctx, a.checkRunId).prId;
    for (const e of a.events) {
      const jobId = nonEmpty(e.jobId, 'jobId', 128);
      if (e.payloadJson.length > 200_000) throw new SenderError(`event ${jobId}#${e.seq}: payload is too large (max 200000 characters)`);
      parseJson(e.payloadJson, `event ${jobId}#${e.seq} payloadJson`);
      const eventKey = `${jobId}#${e.seq}`;
      if (ctx.db.agentEvent.eventKey.find(eventKey)) continue;
      ctx.db.agentEvent.insert({
        id: 0n,
        eventKey,
        jobId,
        seq: e.seq,
        checkRunId: a.checkRunId,
        prId,
        ts: e.ts,
        role: e.role,
        actor: e.actor,
        onBehalfOf: e.onBehalfOf,
        spawnedBy: e.spawnedBy,
        sessionId: e.sessionId,
        eventType: e.eventType,
        payloadJson: e.payloadJson,
        sender: ctx.sender,
        recordedAt: ctx.timestamp,
      });
    }
    return null;
  }
);

