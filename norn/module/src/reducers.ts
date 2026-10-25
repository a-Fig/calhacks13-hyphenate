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
import spacetimedb, { StatementAssumption, StatementClaim, StatementNumber, TestAnswer, reaperSchedule } from './schema';
import './scope'; // registers the job-scope rule with the policy gate
import { assertReleasable, codeStagesNotDone, companyConfig, endApproval, recordApproval, recordPlmApproval, recordRecommendation, settleApproval, standingApproval } from './gate';
import { PLM_DECISIONS, personForLogin, type PlmDecision } from './plm-decision'; // registers the rule for who may report a PLM decision // registers the company rule, after the job-scope rule
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
  currentBaseline,
  currentMain,
  currentRevision,
  decisionText,
  approvalDigest,
  effectiveAssumptions,
  enqueueDeepOnOpen,
  fnv1a64,
  getPr,
  getRun,
  insertRun,
  logAction,
  missingDeps,
  Refusal,
  plusMs,
  reconcile,
  reconcileAllOpen,
  resolveActor,
  settleBlocked,
  stageDef,
  stageInfos,
  write,
  type Actor,
  type Call,
  type Ctx,
  type Logged,
  type Pr,
  type PrStatus,
} from './core';
import { COMPANY_CONFIG_KEY, checkCompanyConfig } from './company-config';

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
  // The whole company config (#59) is accepted next to the knobs but is not one of CONFIG_DEFAULTS:
  // it has no default, and its row appears when the first one is stored. See company-config.ts.
  if (a.key === COMPANY_CONFIG_KEY) {
    const stored = ctx.db.nornConfig.key.find(a.key);
    const check = checkCompanyConfig(a.value, stored?.value);
    if (!check.ok) throw new SenderError(check.error);
    if (check.unchanged) return null;
    if (stored) ctx.db.nornConfig.key.update({ key: a.key, value: a.value });
    else ctx.db.nornConfig.insert({ key: a.key, value: a.value });
    // The cost measure is an input of the cost check, and the tiers decide what an approval stands on:
    // every open ECR is brought up to date, and an approval whose tier moved is withdrawn.
    const n = reconcileAllOpen(ctx, call, 'company configuration changed');
    return { entity: `norn_config:${a.key}`, summary: `${check.summary}; re-checked ${n} open ECR(s)`, detail: check.detail };
  }
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
type RevisionIn = { changeRequestJson: string; source: string; sourceRef: string };

// Open an ECR, with its first change request if one came with it, in the caller's transaction.
function openPr(ctx: Ctx, a: { plmEcrNumber: string; title: string; description: string }, first?: RevisionIn, call?: Call) {
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
  if (first) insertRevision(ctx, pr.id, first, checkedChangeRequest(first.changeRequestJson, plm));
  // Start with the digest of its inputs so the first reconcile only enqueues, not "revises".
  ctx.db.pullRequest.id.update({
    ...pr,
    plmEcrNumber: plm || `NORN-${pr.id}`,
    inputsDigest: approvalDigest(ctx, pr),
  });
  const outcome = reconcile(ctx, pr.id);
  const deep = enqueueDeepOnOpen(ctx, pr.id);
  // The other open ECRs compare themselves with this one in s4: re-run them.
  const others = first && call ? reconcileAllOpen(ctx, call, `ECR ${pr.id} filed`, pr.id) : 0;
  return {
    prId: pr.id,
    entity: `pull_request:${pr.id}`,
    summary: `opened ECR '${title}' (${plm || `NORN-${pr.id}`}) on baseline v${base}${first ? ', change request rev 1' : ''}; ${outcome}${deep ? `; ${deep} deep run(s) requested by config` : ''}${others ? `; ${others} other open ECR(s) checked against it` : ''}`,
  };
}

export const createPr = write(
  'create_pr',
  { plmEcrNumber: t.string(), title: t.string(), description: t.string() },
  (ctx, a, call) => openPr(ctx, a, undefined, call)
);

// A change request must be a JSON object naming the ECR it belongs to (the checks library's
// ChangeRequest: id, program, itemChanges, ...). Shape beyond that is the checks' business.
const MAX_CHANGE_REQUEST = 200_000;
function checkedChangeRequest(json: string, plmEcrNumber: string): string {
  if (json.length > MAX_CHANGE_REQUEST) throw new SenderError(`changeRequestJson is too long (max ${MAX_CHANGE_REQUEST} characters)`);
  const cr = parseJson(json, 'changeRequestJson');
  if (!cr || typeof cr !== 'object' || Array.isArray(cr)) throw new SenderError('changeRequestJson must be a JSON object');
  if (typeof cr.id !== 'string' || !cr.id) throw new SenderError('changeRequestJson needs the ECR number in `id`');
  if (plmEcrNumber && cr.id !== plmEcrNumber) throw new SenderError(`changeRequestJson is for '${cr.id}', not '${plmEcrNumber}'`);
  return fnv1a64(json);
}

function insertRevision(ctx: Ctx, prId: bigint, r: RevisionIn, digest: string) {
  const source = nonEmpty(r.source, 'source', 32);
  if (r.sourceRef.length > 128) throw new SenderError('sourceRef is too long (max 128 characters)');
  let seq = 0;
  for (const old of [...ctx.db.ecrRevision.prId.filter(prId)]) {
    seq = Math.max(seq, old.seq);
    if (old.current) ctx.db.ecrRevision.id.update({ ...old, current: false });
  }
  return ctx.db.ecrRevision.insert({
    id: 0n,
    prId,
    seq: seq + 1,
    changeRequestJson: r.changeRequestJson,
    digest,
    source,
    sourceRef: r.sourceRef,
    current: true,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
  });
}

// The ingest path (#40): an ECR the PLM reports, new or changed, in one transaction. Opens the ECR
// if Norn has not seen its number, else updates its title, text and change request. Anything that
// actually changed re-checks it through reconcile; reporting the same thing again writes nothing,
// so a poller can repeat itself freely.
export const ingestEcr = write(
  'ingest_ecr',
  { plmEcrNumber: t.string(), title: t.string(), description: t.string(), changeRequestJson: t.string(), source: t.string(), sourceRef: t.string() },
  (ctx, a, call) => {
    const plm = nonEmpty(a.plmEcrNumber, 'plmEcrNumber', 64);
    const rev: RevisionIn = { changeRequestJson: a.changeRequestJson, source: a.source, sourceRef: a.sourceRef };
    const existing = ctx.db.pullRequest.plmEcrNumber.find(plm);
    if (!existing) return openPr(ctx, { plmEcrNumber: plm, title: a.title, description: a.description }, rev, call);

    const digest = checkedChangeRequest(a.changeRequestJson, plm);
    const title = nonEmpty(a.title, 'title', 200);
    if (a.description.length > 20000) throw new SenderError('description is too long (max 20000 characters)');
    const cur = currentRevision(ctx, existing.id);
    const textChanged = title !== existing.title || a.description !== existing.description;
    const crChanged = cur?.digest !== digest;
    if (!textChanged && !crChanged) return null;
    if (!OPEN_PR.includes(existing.status as PrStatus))
      throw new SenderError(`ECR ${existing.id} (${plm}) is ${existing.status}; the PLM's later edits are not taken in`);

    const what: string[] = [];
    if (textChanged) {
      ctx.db.pullRequest.id.update({ ...existing, title, description: a.description, updatedAt: ctx.timestamp });
      what.push('text');
    }
    if (crChanged) {
      const row = insertRevision(ctx, existing.id, rev, digest);
      what.push(`change request rev ${row.seq}`);
    }
    const own = reconcile(ctx, existing.id);
    // A new change request is what the other open ECRs compare themselves with in s4.
    const others = crChanged ? reconcileAllOpen(ctx, call, `${plm} change request rev updated`, existing.id) : 0;
    return {
      prId: existing.id,
      entity: `pull_request:${existing.id}`,
      summary: `${plm} from ${rev.source}: ${what.join(' and ')} updated; ${own}${others ? `; ${others} other open ECR(s) checked against it` : ''}`,
    };
  }
);

// A worker read the ERP baseline. A hash Norn has not seen as current becomes current and every
// open ECR is re-checked against it; the same hash again only moves lastReadAt.
export const recordBaseline = write(
  'record_baseline',
  { hash: t.string(), asOf: t.string(), source: t.string(), countsJson: t.string(), warningsJson: t.string() },
  (ctx, a, call) => {
    const hash = nonEmpty(a.hash, 'hash', 128);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.asOf)) throw new SenderError(`asOf must be 'YYYY-MM-DD', got '${a.asOf}'`);
    const source = nonEmpty(a.source, 'source', 32);
    parseJson(a.countsJson, 'countsJson');
    parseJson(a.warningsJson, 'warningsJson');
    if (a.countsJson.length + a.warningsJson.length > 20000) throw new SenderError('countsJson and warningsJson are too long (max 20000 characters together)');
    const cur = currentBaseline(ctx);
    if (cur?.hash === hash) {
      ctx.db.baselineSnapshot.hash.update({ ...cur, lastReadAt: ctx.timestamp });
      return null;
    }
    if (cur) ctx.db.baselineSnapshot.hash.update({ ...cur, current: false });
    const seen = ctx.db.baselineSnapshot.hash.find(hash);
    const row = { hash, asOf: a.asOf, source, countsJson: a.countsJson, warningsJson: a.warningsJson, current: true, lastReadAt: ctx.timestamp, recordedBy: ctx.sender };
    if (seen) ctx.db.baselineSnapshot.hash.update({ ...seen, ...row });
    else ctx.db.baselineSnapshot.insert({ ...row, firstReadAt: ctx.timestamp });
    const n = reconcileAllOpen(ctx, call, `ERP baseline ${hash.slice(0, 12)}`);
    return {
      entity: `baseline_snapshot:${hash.slice(0, 12)}`,
      summary: `ERP baseline ${cur ? `${cur.hash.slice(0, 12)} -> ` : ''}${hash.slice(0, 12)} (as of ${a.asOf}, ${source}); re-checked ${n} open ECR(s)`,
    };
  }
);

// The PLM has released the change order for this ECR (#72): its number, by the PLM's ECR number, as
// the ingest loop reports it. A worker puts the ERP change package on it once the ECR is released in
// Norn too (status merged).
export const recordEcoRelease = write(
  'record_eco_release',
  { plmEcrNumber: t.string(), ecoNumber: t.string(), source: t.string(), sourceRef: t.string() },
  (ctx, a) => {
    const plm = nonEmpty(a.plmEcrNumber, 'plmEcrNumber', 64);
    const found = ctx.db.pullRequest.plmEcrNumber.find(plm);
    if (!found) throw new SenderError(`Norn has no ECR ${plm}`);
    const pr = getPr(ctx, found.id);
    const ecoNumber = nonEmpty(a.ecoNumber, 'ecoNumber', 64);
    const source = nonEmpty(a.source, 'source', 32);
    if (a.sourceRef.length > 200) throw new SenderError('sourceRef is too long (max 200 characters)');
    if (pr.status === 'closed') throw new SenderError(`ECR ${pr.id} is closed; a closed ECR has no change order`);
    const seen = ctx.db.ecoRelease.prId.find(pr.id);
    if (seen?.ecoNumber === ecoNumber) return null;
    if (seen) throw new SenderError(`ECR ${pr.id} was released as ${seen.ecoNumber}; a released change order keeps its number, so ${ecoNumber} is refused`);
    ctx.db.ecoRelease.insert({ prId: pr.id, ecoNumber, source, sourceRef: a.sourceRef, recordedBy: ctx.sender, recordedAt: ctx.timestamp });
    return { prId: pr.id, entity: `eco_release:${pr.id}`, summary: `change order ${ecoNumber} released (${source})` };
  }
);

// The ERP change package on a released ECO (#72), from a worker: what a person enters in the ERP, with
// each line's status on the ERP read named. Norn never writes to the ERP (#71). Recording the same
// package again on a new ERP read only moves erpBaseline, and adds no log row.
export const recordErpPackage = write(
  'record_erp_package',
  {
    prId: t.u64(),
    ecoNumber: t.string(),
    s2RunId: t.u64(),
    erpBaseline: t.string(),
    releaseJson: t.string(),
    packageJson: t.string(),
    lines: t.u32(),
    entered: t.u32(),
    conflicts: t.u32(),
    notesJson: t.string(),
  },
  (ctx, a) => {
    const pr = getPr(ctx, a.prId);
    if (pr.status !== 'merged') throw new SenderError(`ECR ${pr.id} is ${pr.status}; an ERP change package is for a released ECO`);
    const eco = ctx.db.ecoRelease.prId.find(pr.id);
    if (!eco) throw new SenderError(`ECR ${pr.id} has no change order number from the PLM yet`);
    if (eco.ecoNumber !== a.ecoNumber) throw new SenderError(`ECR ${pr.id} was released as ${eco.ecoNumber}, not ${a.ecoNumber}`);
    const run = ctx.db.checkRun.id.find(a.s2RunId);
    if (!run || run.prId !== pr.id || run.stage !== 's2_cost' || run.status !== 'done')
      throw new SenderError(`check run ${a.s2RunId} is not a finished s2_cost run of ECR ${pr.id}`);
    const erpBaseline = nonEmpty(a.erpBaseline, 'erpBaseline', 128);
    if (!ctx.db.baselineSnapshot.hash.find(erpBaseline)) throw new SenderError(`ERP baseline ${erpBaseline.slice(0, 12)} has not been recorded`);
    for (const [what, v] of [['releaseJson', a.releaseJson], ['packageJson', a.packageJson], ['notesJson', a.notesJson]] as const) parseJson(v, what);
    // A package lists every line of every BOM it versions, so a large assembly runs to a few hundred KB.
    if (a.releaseJson.length + a.packageJson.length + a.notesJson.length > 2_000_000)
      throw new SenderError('releaseJson, packageJson and notesJson are too long (max 2,000,000 characters together)');
    if (a.entered + a.conflicts > a.lines) throw new SenderError(`${a.entered} entered and ${a.conflicts} in conflict is more than the ${a.lines} line(s)`);

    const prev = ctx.db.erpPackage.prId.find(pr.id);
    const row = {
      prId: pr.id,
      ecoNumber: a.ecoNumber,
      s2RunId: a.s2RunId,
      erpBaseline,
      releaseJson: a.releaseJson,
      packageJson: a.packageJson,
      lines: a.lines,
      entered: a.entered,
      conflicts: a.conflicts,
      notesJson: a.notesJson,
      builtBy: ctx.sender,
      updatedAt: ctx.timestamp,
    };
    if (prev) {
      const same = prev.s2RunId === row.s2RunId && prev.releaseJson === row.releaseJson && prev.packageJson === row.packageJson && prev.notesJson === row.notesJson;
      ctx.db.erpPackage.prId.update({ ...prev, ...row });
      if (same) return null;
    } else {
      ctx.db.erpPackage.insert({ ...row, builtAt: ctx.timestamp });
    }
    const state = a.lines === 0 ? 'nothing to enter' : `${a.entered} of ${a.lines} line(s) entered${a.conflicts ? `, ${a.conflicts} in conflict` : ''}`;
    return { prId: pr.id, entity: `erp_package:${pr.id}`, summary: `ERP change package for ${a.ecoNumber}: ${state} (ERP ${erpBaseline.slice(0, 12)})` };
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

// The move itself, once the checks on it have passed: the status, the approval record that follows it, and what a
// release or a closing does to the checks and to the other open ECRs. setPrStatus and record_plm_decision both end here.
// `onApproved` writes the approval row (setPrStatus: the gate's; a decision taken in the PLM: that person's).
// Returns the summary of what moved.
function applyTransition(ctx: Ctx, call: Call, pr: Pr, to: PrStatus, onApproved: () => void = () => recordApproval(ctx, call, pr, 'tier')): string {
  const from = pr.status as PrStatus;
  // Finish with this ECR's own row first, so the re-check of other ECRs below never touches it.
  ctx.db.pullRequest.id.update({ ...pr, status: to, updatedAt: ctx.timestamp });
  // The approval record follows the status: one is made when the ECR is approved, and one that
  // stands ends when the ECR leaves 'approved' (a release ends it below, with the version it made).
  if (to === 'approved') onApproved();
  else if (from === 'approved' && to !== 'merged') {
    const standing = standingApproval(ctx, pr.id);
    if (standing) endApproval(ctx, standing, 'withdrawn', to === 'closed' ? 'the ECR was closed' : `moved back to ${to} by ${call.actor.name}`);
  }

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
    const standing = standingApproval(ctx, pr.id);
    if (standing) endApproval(ctx, standing, 'released', `released as baseline v${row.version}`);
    const n = reconcileAllOpen(ctx, call, `ECR ${pr.id} released as baseline v${row.version}`);
    extra = `; baseline v${row.parent} -> v${row.version}, re-checked ${n} other open ECR(s)`;
  } else if (from === 'closed') {
    // Reopening: move onto today's baseline and replace whatever went out of date meanwhile.
    extra = `; ${reconcile(ctx, pr.id)}`;
    reconcileAllOpen(ctx, call, `ECR ${pr.id} reopened`, pr.id); // its change request is a peer again
  } else if (to === 'closed') {
    reconcileAllOpen(ctx, call, `ECR ${pr.id} closed`, pr.id); // no longer a peer
  }
  return `${from} -> ${to}${extra}`;
}

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
      const notReady = codeStagesNotDone(ctx, pr);
      if (notReady.length)
        throw new SenderError(`cannot approve ECR ${pr.id}: checks not finished on current inputs (${notReady.join(', ')})`);
      if (call.decision.effect === 'downgrade') {
        // The policy gate allows a recommendation but not an approval: file it, with who and why.
        recordRecommendation(ctx, call, pr, 'approve_ecr_at_tier');
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
      // Never released on checks that have not finished on its current inputs, nor at a tier other than the one it was approved at.
      assertReleasable(ctx, pr);
      if (call.decision.effect === 'downgrade') {
        recordRecommendation(ctx, call, pr, 'release_eco');
        return {
          prId: pr.id,
          entity: `pull_request:${pr.id}`,
          summary: `recommends release; not released (${call.decision.reason})`,
          outcome: 'downgraded',
        };
      }
    }

    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: applyTransition(ctx, call, pr, to) };
  },
  { downgradable: a => a.status === 'approved' || a.status === 'merged' }
);

// The PLM has decided the ECR: its board approved or rejected it there, and Norn mirrors that (the PLM is the system of
// record for the decision). Approved: the ECR goes to approved and then merged, on the module's own rules for those moves
// (set_pr_status), with the approval row naming the person the PLM names, not the connection that reported it. Rejected:
// closed. When Norn cannot follow (the checks have not finished on current inputs, the baseline has moved, the ECR is
// closed or already released), it records that and why, and moves nothing: it never shows an ECR as released that it did
// not release. The same decision again changes nothing. Who may report it is plm-decision.ts's rule.
export const recordPlmDecision = write(
  'record_plm_decision',
  { plmEcrNumber: t.string(), decision: t.string(), decidedBy: t.string(), decidedOn: t.string(), source: t.string(), sourceRef: t.string() },
  (ctx, a, call) => {
    const plm = nonEmpty(a.plmEcrNumber, 'plmEcrNumber', 64);
    if (!PLM_DECISIONS.includes(a.decision as PlmDecision)) throw new SenderError(`decision must be one of ${PLM_DECISIONS.join(', ')}`);
    const decision = a.decision as PlmDecision;
    const decidedBy = nonEmpty(a.decidedBy, 'decidedBy', 128);
    const decidedOn = nonEmpty(a.decidedOn, 'decidedOn', 40);
    const source = nonEmpty(a.source, 'source', 32);
    if (a.sourceRef.length > 200) throw new SenderError('sourceRef is too long (max 200 characters)');
    const found = ctx.db.pullRequest.plmEcrNumber.find(plm);
    if (!found) throw new SenderError(`Norn has no ECR ${plm}`);
    const pr = getPr(ctx, found.id);

    const loaded = companyConfig(ctx);
    const person = loaded.state === 'ok' ? personForLogin(loaded.config.people, decidedBy) : undefined;
    const where = source === 'plm' ? 'the PLM' : `${source} (a test feed, not the PLM)`;
    const who = person ? `${person.name} (${decidedBy})` : decidedBy;
    const headline = `${decision} in ${where} by ${who} on ${decidedOn}, reported by ${call.actor.name}`;
    const detail = { decision, decidedBy, decidedOn, person: person?.id ?? null, source, sourceRef: a.sourceRef, reportedBy: call.actor.name };
    // A decision Norn cannot follow is logged once: the same reason again adds no row.
    const noFollow = (why: string): Logged | null => {
      const summary = `${headline}; Norn did not follow it: ${why}`;
      const last = [...ctx.db.actionLog.prId.filter(pr.id)].filter(l => l.reducer === 'record_plm_decision' && l.summary.startsWith(`${decision} in `)).sort((x, y) => Number(x.id - y.id)).at(-1);
      if (last?.summary === summary) return null;
      return { prId: pr.id, entity: `plm_decision:${pr.id}`, summary, detail, outcome: 'downgraded' };
    };

    if (decision === 'rejected') {
      if (pr.status === 'closed') return null;
      if (pr.status === 'merged') return noFollow(`ECR ${pr.id} is already released in Norn`);
      const standing = standingApproval(ctx, pr.id);
      if (standing) endApproval(ctx, standing, 'withdrawn', `rejected in ${where} by ${who}`);
      const moved = applyTransition(ctx, call, pr, 'closed');
      return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `${headline}; ${moved}`, detail };
    }

    if (pr.status === 'merged') return null;
    if (pr.status === 'closed') return noFollow(`ECR ${pr.id} is closed in Norn`);
    const notReady = codeStagesNotDone(ctx, pr);
    if (notReady.length) return noFollow(`its checks have not finished on current inputs (${notReady.join(', ')}), so Norn cannot release it`);
    const main = currentMain(ctx);
    if (pr.baseVersion !== main.version) return noFollow(`it is based on baseline v${pr.baseVersion} but the baseline is at v${main.version}, so it must be re-checked first`);

    // From here the move is certain. The PLM's decision stands in for the approval; an approval Norn had given is replaced.
    const standing = standingApproval(ctx, pr.id);
    if (standing) endApproval(ctx, standing, 'withdrawn', `replaced by the approval taken in ${where} by ${who}`);
    const record = () =>
      recordPlmApproval(ctx, pr, {
        name: person?.name ?? decidedBy,
        decisionJson: JSON.stringify({
          reason: `approved in ${where} by ${who}`,
          route: { bodyName: person?.title ?? 'Approver in the PLM' },
          reasons: [{ rule: 'plm', text: `Approved in ${where} by ${who} on ${decidedOn}. Norn mirrors the PLM's decision and applies no tier of its own to it.` }],
          ...detail,
        }),
      });
    let from = pr;
    const moves: string[] = [];
    if (pr.status === 'draft') {
      from = { ...pr, status: 'review' };
      ctx.db.pullRequest.id.update({ ...from, updatedAt: ctx.timestamp });
      moves.push('draft -> review');
    }
    if (from.status === 'approved') record();
    else moves.push(applyTransition(ctx, call, from, 'approved', record));
    moves.push(applyTransition(ctx, call, getPr(ctx, pr.id), 'merged'));
    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `${headline}; ${moves.join('; ')}`, detail };
  }
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
// The fast track (#22, #43). An agent (or a person) asks to approve an ECR on the fast track and
// brings its answers to the configuration's tests, with the classes it proposes. The gate decides
// from the company's rules: approve, approve with a draw for the blind second check, recommend (to
// the people who decide), or escalate. The answers are stored with the decision either way.
// ---------------------------------------------------------------------------------------------

export const requestFastTrackApproval = write(
  'request_fast_track_approval',
  {
    prId: t.u64(),
    answers: t.array(TestAnswer),
    companyClass: t.string(), // the company class the agent proposes; '' for none
    regulatoryClass: t.string(),
    triggers: t.array(t.string()), // the named conditions the agent saw on the ECR (its own report)
  },
  (ctx, a, call) => {
    const pr = getPr(ctx, a.prId);
    if (pr.status !== 'review') throw new SenderError(`ECR ${pr.id} is ${pr.status}; the fast track decides ECRs in review`);
    if (call.decision.detail === undefined)
      throw new SenderError("no company configuration is stored: the fast track is the company's rule, and there is none to apply");
    const notReady = codeStagesNotDone(ctx, pr);
    if (notReady.length) throw new SenderError(`cannot approve ECR ${pr.id}: checks not finished on current inputs (${notReady.join(', ')})`);
    if (call.decision.effect === 'downgrade') {
      recordRecommendation(ctx, call, pr, 'approve_fast_track_ecr');
      return {
        prId: pr.id,
        entity: `pull_request:${pr.id}`,
        summary: `recommends approval; not approved (${call.decision.reason})`,
        outcome: 'downgraded',
      };
    }
    ctx.db.pullRequest.id.update({ ...pr, status: 'approved', updatedAt: ctx.timestamp });
    recordApproval(ctx, call, pr, 'fast_track');
    return { prId: pr.id, entity: `pull_request:${pr.id}`, summary: `review -> approved on the fast track (${call.decision.reason})` };
  },
  { downgradable: () => true }
);

// ---------------------------------------------------------------------------------------------
// Job scope (#56). Norn's MCP server verifies an agent's signed credential, then records here what
// it may write to. The policy gate (scope.ts) holds every later write to it.
// ---------------------------------------------------------------------------------------------

export const grantScope = write(
  'grant_scope',
  { jobId: t.string(), anyEcr: t.bool(), prIds: t.array(t.u64()), maxLevel: t.u8(), expiresAt: t.timestamp() },
  (ctx, a) => {
    const jobId = nonEmpty(a.jobId, 'jobId', 64);
    if (a.prIds.length > 50) throw new SenderError('a grant names at most 50 ECRs');
    if (a.maxLevel > 3) throw new SenderError('maxLevel is 0 (no statements) to 3');
    const labels = a.prIds.map(id => getPr(ctx, id).plmEcrNumber);
    const ahead = a.expiresAt.microsSinceUnixEpoch - ctx.timestamp.microsSinceUnixEpoch;
    if (ahead <= 0n) throw new SenderError('expiresAt is already past');
    if (ahead > 24n * 3600n * 1_000_000n) throw new SenderError('a grant lasts at most 24 hours');
    const row = { identity: ctx.sender, jobId, anyEcr: a.anyEcr, prIds: [...new Set(a.prIds)], maxLevel: a.maxLevel, expiresAt: a.expiresAt, grantedAt: ctx.timestamp };
    if (ctx.db.actorScope.identity.find(ctx.sender)) ctx.db.actorScope.identity.update(row);
    else ctx.db.actorScope.insert(row);
    return {
      entity: `actor_scope:${ctx.sender.toHexString().slice(0, 8)}`,
      summary: `granted job ${jobId} write scope: ${a.anyEcr ? 'any ECR' : labels.join(', ') || 'no ECR'}, statements up to Level ${a.maxLevel}, until ${a.expiresAt.toISOString()}`,
      detail: { jobId, anyEcr: a.anyEcr, prIds: a.prIds, maxLevel: a.maxLevel },
    };
  }
);

// ---------------------------------------------------------------------------------------------
// Impact statements (#42). The agent that writes the statement narrates; it does not compute: a
// number marked 'computation' must be a current check result of this ECR, to the digit, and an
// assumption's source must be the one the assumption actually has.
// ---------------------------------------------------------------------------------------------

const EVIDENCE = ['fact', 'assumption', 'computation', 'judgment'];

export const postImpactStatement = write(
  'post_impact_statement',
  {
    prId: t.u64(),
    level: t.u8(),
    changeClass: t.string(),
    route: t.string(),
    headline: t.string(),
    numbers: t.array(StatementNumber),
    drivers: t.array(StatementClaim),
    assumptions: t.array(StatementAssumption),
    claims: t.array(StatementClaim),
  },
  (ctx, a, call) => {
    const required = (v: string, what: string, max: number) => {
      try {
        return nonEmpty(v, what, max);
      } catch (e) {
        throw new Refusal((e as Error).message);
      }
    };
    const pr = getPr(ctx, a.prId);
    if (!OPEN_PR.includes(pr.status as PrStatus)) throw new Refusal(`${pr.plmEcrNumber} is ${pr.status}; its statement is frozen`);
    if (a.level < 1 || a.level > 3) throw new Refusal('level must be 1, 2 or 3');
    const changeClass = required(a.changeClass, 'changeClass', 80);
    const route = required(a.route, 'route', 200);
    const headline = required(a.headline, 'headline', 600);
    if (a.numbers.length < 1 || a.numbers.length > 12) throw new Refusal('a statement has 1 to 12 headline numbers');
    if (a.drivers.length > 8) throw new Refusal('a statement has at most 8 drivers');
    if (a.claims.length > 12) throw new Refusal('a statement has at most 12 claims');
    if (a.assumptions.length > 20) throw new Refusal('a statement lists at most 20 assumptions');
    const evidence = (e: string, what: string) => {
      if (!EVIDENCE.includes(e)) throw new Refusal(`${what}: evidence must be one of ${EVIDENCE.join(', ')}`);
    };

    // A session started by a check run ('norn:check_run:7') may post only while that run still stands:
    // the ECR's inputs have not changed since it read them. A session left over from an earlier
    // change-request revision (or baseline) is refused even if some of its numbers happen to match.
    // spawnedBy comes from the signed credential, not from the agent.
    let checkRunId = 0n;
    const started = /(?:^|:)check_run:(\d+)$/.exec(call.spawnedBy);
    if (started) {
      const run = ctx.db.checkRun.id.find(BigInt(started[1]!));
      if (!run || run.prId !== pr.id) throw new Refusal(`this session was started by check run ${started[1]}, which is not a check run of ${pr.plmEcrNumber}`);
      if (run.status !== 'done')
        throw new Refusal(`check run ${run.id}, which started this session, is ${run.status}: ${pr.plmEcrNumber}'s inputs changed after the session read them (a new change-request revision, baseline or assumption), so its numbers are out of date. Post nothing; Norn starts a new session on the current numbers`);
      checkRunId = run.id;
    }

    // The newest result per key among runs that are still current ('done'; a stale run's are not).
    const current = new Map<string, { id: bigint; checkRunId: bigint; label: string; unit: string; p10: number; p50: number; p90: number }>();
    for (const r of ctx.db.checkResult.prId.filter(pr.id)) {
      if (ctx.db.checkRun.id.find(r.checkRunId)?.status !== 'done') continue;
      const seen = current.get(r.key);
      if (!seen || r.id > seen.id) current.set(r.key, r);
    }
    for (const n of a.numbers) {
      const what = `number '${n.key}'`;
      required(n.key, `${what} key`, 80);
      required(n.label, `${what} label`, 200);
      if (n.unit.length > 24) throw new Refusal(`${what}: unit is too long (max 24 characters)`);
      if (![n.p10, n.p50, n.p90].every(Number.isFinite) || !(n.p10 <= n.p50 && n.p50 <= n.p90))
        throw new Refusal(`${what}: need finite p10 <= p50 <= p90`);
      evidence(n.evidence, what);
      if (n.evidence === 'computation') {
        const r = current.get(n.resultKey);
        if (!r) throw new Refusal(`${what} is marked computation, but ${pr.plmEcrNumber} has no current check result '${n.resultKey}'`);
        if (n.label !== r.label || n.unit !== r.unit)
          throw new Refusal(`${what} is marked computation, so it keeps the label and unit of check result '${n.resultKey}' ('${r.label}', '${r.unit}'), not '${n.label}', '${n.unit}'`);
        if (r.p10 !== n.p10 || r.p50 !== n.p50 || r.p90 !== n.p90)
          throw new Refusal(`${what} is marked computation but differs from check result '${n.resultKey}' (${r.p10} / ${r.p50} / ${r.p90}); quote it exactly or mark it judgment`);
        if (checkRunId === 0n) checkRunId = r.checkRunId; // no session run named: the run its first computation number came from
      }
    }
    for (const c of [...a.drivers, ...a.claims]) {
      required(c.text, 'a driver or claim text', 600);
      evidence(c.evidence, 'a driver or claim');
    }
    const seen = new Map(effectiveAssumptions(ctx, pr.id).map(x => [x.key, x]));
    for (const x of a.assumptions) {
      const known = seen.get(x.key);
      if (!known) throw new Refusal(`assumption '${x.key}' is not one this ECR sees`);
      if (known.source !== x.source)
        throw new Refusal(`assumption '${x.key}' is ${known.source}, not ${x.source}; a statement may not relabel an assumption's source`);
      if (x.note.length > 400) throw new Refusal(`assumption '${x.key}': note is too long (max 400 characters)`);
    }

    const row = ctx.db.impactStatement.insert({
      id: 0n,
      prId: pr.id,
      level: a.level,
      prRevision: pr.revision,
      checkRunId,
      changeClass,
      route,
      headline,
      numbers: a.numbers,
      drivers: a.drivers,
      assumptions: a.assumptions,
      claims: a.claims,
      author: ctx.sender,
      createdAt: ctx.timestamp,
    });
    return {
      prId: pr.id,
      entity: `impact_statement:${row.id}`,
      summary: `posted Level ${a.level} impact statement on ${pr.plmEcrNumber} (revision ${pr.revision}): ${headline.slice(0, 100)}`,
      detail: { level: a.level, numbers: a.numbers.length, drivers: a.drivers.length, assumptions: a.assumptions.length, claims: a.claims.length, checkRunId },
    };
  }
);

// ---------------------------------------------------------------------------------------------
// Publication lease (#42). The publisher writes a statement into the PLM, which cannot refuse a
// second identical write, so the write is taken in turns: claim, read the PLM, write, release.
// A lease that is not released (the holder died) ends by itself.
// ---------------------------------------------------------------------------------------------

// Only Norn's own agents publish. The module has no stronger notion of "Norn" than a registered
// agent principal with origin 'norn' (register_actor does not prove it), so this keeps out people,
// outside agents, unregistered connections and job-scoped agents (the scope rule already denies
// those every reducer but comments, assumptions and statements).
const isNornAgent = (a: { kind: string; origin: string }) => a.kind === 'agent' && a.origin === 'norn';

export const claimPublication = write(
  'claim_publication',
  { prId: t.u64(), statementId: t.u64(), processId: t.string(), leaseMs: t.u32() },
  (ctx, a, call) => {
    if (!isNornAgent(call.actor)) throw new SenderError(`[forbidden] ${call.actor.name} is not one of Norn's own agents; only they publish to the PLM`);
    const pr = getPr(ctx, a.prId);
    if (!ctx.db.impactStatement.id.find(a.statementId)) throw new SenderError(`statement ${a.statementId} does not exist`);
    const processId = nonEmpty(a.processId, 'processId', 64);
    if (a.leaseMs < 1000 || a.leaseMs > 300_000) throw new SenderError('a publication lease lasts 1 to 300 seconds');
    const held = ctx.db.publicationClaim.prId.find(pr.id);
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const mine = held && held.holder.isEqual(ctx.sender) && held.processId === processId;
    // A thrown SenderError is the answer "someone else is writing": the caller's call rejects, atomically.
    if (held && !mine && held.expiresAt.microsSinceUnixEpoch > now)
      throw new SenderError(`[held] ${pr.plmEcrNumber} is being published by another holder until ${held.expiresAt.toISOString()}`);
    const row = { prId: pr.id, statementId: a.statementId, holder: ctx.sender, processId, expiresAt: plusMs(ctx.timestamp, a.leaseMs) };
    if (held) ctx.db.publicationClaim.prId.update(row);
    else ctx.db.publicationClaim.insert(row);
    return { prId: pr.id, entity: `publication_claim:${pr.id}`, summary: `claimed publishing statement ${a.statementId} to the PLM for ${a.leaseMs} ms` };
  }
);

// Released by the connection that took it (and the process that took it); anyone else's release does
// nothing. A lease that has run out may be cleared by any of Norn's agents, though claiming over it
// works without that.
export const releasePublication = write('release_publication', { prId: t.u64(), processId: t.string() }, (ctx, a, call) => {
  const held = ctx.db.publicationClaim.prId.find(a.prId);
  if (!held) return null;
  const mine = held.holder.isEqual(ctx.sender) && held.processId === a.processId;
  const expired = held.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch;
  if (!mine && !(expired && isNornAgent(call.actor))) return null;
  ctx.db.publicationClaim.prId.delete(a.prId);
  return null;
});

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
      const pr = getPr(ctx, a.prId);
      if (!OPEN_PR.includes(pr.status as PrStatus)) throw new Refusal(`${pr.plmEcrNumber} is ${pr.status}; its assumptions are frozen`);
    }
    const key = nonEmpty(a.key, 'key', 80);
    parseJson(a.distJson, 'distJson');
    if (a.distJson.length > 4000) throw new Refusal('distJson is too long (max 4000 characters)');
    if (!(SOURCES as readonly string[]).includes(a.source)) throw new Refusal(`source must be one of ${SOURCES.join(', ')}`);
    for (const s of a.affects) stageDef(s);

    let cur: ReturnType<typeof ctx.db.assumption.id.find> | undefined;
    for (const r of ctx.db.assumption.prId.filter(a.prId)) if (r.key === key && r.current) cur = r;
    const curRev = cur?.rev ?? 0;
    if (a.expectedRev !== curRev)
      throw new Refusal(`'${key}' is at revision ${curRev}, not ${a.expectedRev}: someone else edited it; reload and retry`);
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
      // The other open ECRs' s4 compares them with this one under its assumptions.
      const others = reconcileAllOpen(ctx, call, `ECR ${a.prId} assumption ${key} rev ${row.rev}`, a.prId);
      if (others) outcome += `; ${others} other open ECR(s) checked against it`;
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
  mock: t.bool(), // true for stand-in output; false only for numbers a worker actually computed
});

// Finish a run and store its results in the same transaction. If any result is invalid the whole
// call rolls back: no partial results, and the run stays running.
export const completeCheck = write(
  'complete_check',
  { checkRunId: t.u64(), attempt: t.u32(), results: t.array(ResultInput) },
  (ctx, a, call) => {
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
        mock: r.mock,
      });
    }
    ctx.db.checkRun.id.update({ ...run, status: 'done', leaseExpiresAt: undefined, finishedAt: ctx.timestamp, note: '' });
    clearProgress(ctx, run.id);
    // The last code check of an approved ECR whose inputs changed ends its re-check: the approval stands
    // or is withdrawn now, and the log says which and why.
    const settled = STAGES[run.stage]?.tier === 'code' ? settleApproval(ctx, run.prId) : '';
    if (settled) call.log({ prId: run.prId, entity: `pull_request:${run.prId}`, summary: settled, spawnedBy: `check_run:${run.id}` });
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

