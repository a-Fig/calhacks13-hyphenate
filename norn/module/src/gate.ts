// The company gate (#43): the policy rule that holds Norn's writes to the company's configuration, and
// the approvals and recommendations it leaves behind.
//
// The decisions are config/src/route.ts's (decideAction, routeEcr), reached through gate-logic.ts. This
// file reads the tables the decision needs, registers the rule, and writes the records:
//
//   gateRule           registered after the job-scope rule (scope.ts). Maps the write to one of the
//                      company's actions, builds the facts about the ECR from module state on its
//                      CURRENT inputs, and returns allow, deny or downgrade with the reasons.
//   approval           one row per approval; stands until withdrawn or released. Remembers the tier it
//                      was given at and the fingerprint of the ECR's own inputs.
//   recommendation     what the gate files instead of an approval it will not let the actor give.
//   settleApproval     once an approved ECR's checks have finished again, keeps or withdraws the approval.
//
// With no company configuration stored the gate allows (and says so): the module then has no company
// limits to apply, as before #43. A configuration that is stored but does not validate fails closed
// for the gated actions.
import { SenderError } from 'spacetimedb/server';
import {
  APPROVAL_HOOKS,
  POLICY_RULES,
  STAGES,
  STAGE_ORDER,
  currentRevision,
  fnv1a64,
  stageInfos,
  type Call,
  type Ctx,
  type Pr,
  type PolicyRule,
} from './core';
import { COMPANY_CONFIG_KEY } from './company-config';
import type { CompanyConfig } from '../../config/src/schema';
import type { EcrFacts } from '../../config/src/route';
import {
  actionFor,
  configActor,
  judge,
  readCompanyConfig,
  readFastTrackRequest,
  tierVerdict,
  type ApprovedAt,
  costFromRows,
  slipFromRows,
  type FastTrackRequest,
  type GateDetail,
  type LoadedConfig,
  type ResultRow,
} from './gate-logic';

export type { GateDetail, FastTrackRequest };

// ---------------------------------------------------------------------------------------------
// The stored configuration
// ---------------------------------------------------------------------------------------------

// Reading validates a 20 KB document, so keep the last result for the text it was made from.
let read: { text: string; loaded: LoadedConfig } | undefined;
export function companyConfig(ctx: Ctx): LoadedConfig {
  const text = ctx.db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value;
  if (text === undefined) return { state: 'none' };
  if (read?.text === text) return read.loaded;
  read = { text, loaded: readCompanyConfig(text) };
  return read.loaded;
}

// ---------------------------------------------------------------------------------------------
// The facts about an ECR, on its current inputs
// ---------------------------------------------------------------------------------------------

type Approval = NonNullable<ReturnType<Ctx['db']['approval']['id']['find']>>;

// The code stages whose finished run is not on the ECR's current inputs. An approval, and a release,
// rest on all of them.
export function codeStagesNotDone(ctx: Ctx, pr: Pr): string[] {
  const infos = stageInfos(ctx, pr);
  const runs = [...ctx.db.checkRun.prId.filter(pr.id)];
  return STAGE_ORDER.filter(s => STAGES[s]!.tier === 'code').filter(s => !runs.some(r => r.stage === s && r.status === 'done' && r.inputHash === infos[s]!.hash));
}

// The rows of a stage's newest finished run on the ECR's current inputs; empty when there is none.
function currentRows(ctx: Ctx, pr: Pr, stage: string): ResultRow[] {
  const hash = stageInfos(ctx, pr)[stage]!.hash;
  let best: { id: bigint } | undefined;
  for (const r of ctx.db.checkRun.prId.filter(pr.id)) if (r.stage === stage && r.status === 'done' && r.inputHash === hash && (!best || r.id > best.id)) best = r;
  return best ? [...ctx.db.checkResult.checkRunId.filter(best.id)] : [];
}

// What the gate knows about the ECR, built from the tables on its current inputs. Not here, on purpose:
// the owner of the changed item (an agent's say-so is not evidence), and detected triggers (nothing in
// the module detects them yet; an agent's fast-track request lists the ones it saw, labelled as its own).
export function buildFacts(ctx: Ctx, pr: Pr, config: CompanyConfig, request?: FastTrackRequest): EcrFacts {
  const cost = costFromRows(currentRows(ctx, pr, 's2_cost'), config);
  const slip = slipFromRows(currentRows(ctx, pr, 's3_timeline'));
  let level = 0;
  for (const s of ctx.db.impactStatement.prId.filter(pr.id)) if (s.prRevision === pr.revision && s.level > level) level = s.level;
  const approved = standingApproval(ctx, pr.id);
  const facts: EcrFacts = { ecrId: pr.plmEcrNumber };
  if (cost) facts.cost = cost;
  if (slip !== undefined) facts.slipP90Days = slip;
  if (level >= 1 && level <= 3) facts.reportLevel = level as 1 | 2 | 3;
  if (approved?.bodyId) facts.approvedBy = approved.bodyId;
  if (request) {
    facts.classes = {
      ...(request.classes.company ? { company: request.classes.company } : {}),
      ...(request.classes.regulatory ? { regulatory: request.classes.regulatory } : {}),
    };
    facts.answers = Object.fromEntries(request.answers.map(a => [a.testId, a.holds]));
    facts.triggers = request.triggers;
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------------------------

const NO_CONFIG = 'no company configuration is stored, so no company limits apply';

export const gateRule: PolicyRule = (ctx, actor, reducer, args) => {
  const action = actionFor(reducer, args);
  const loaded = companyConfig(ctx);
  if (loaded.state === 'none') return { effect: 'allow', reason: NO_CONFIG };
  if (!action) return { effect: 'allow', reason: `${reducer} is not gated by the company's configuration` };
  if (loaded.state === 'unreadable') return { effect: 'deny', reason: `${loaded.why}; Norn takes no ${action} decision on a configuration it cannot read` };
  const who = configActor(loaded.config, actor);
  if (!who) return { effect: 'deny', reason: `${actor.name} has not registered as a person or an agent, so the company's rules cannot be applied to it` };
  const pr = typeof args.prId === 'bigint' ? ctx.db.pullRequest.id.find(args.prId) : undefined;
  if (!pr) return { effect: 'allow', reason: `${reducer} names no ECR that exists; the reducer says so` };

  let request: FastTrackRequest | undefined;
  if (reducer === 'request_fast_track_approval') {
    const r = readFastTrackRequest(loaded.config, { answers: args.answers, companyClass: args.companyClass, regulatoryClass: args.regulatoryClass, triggers: args.triggers });
    if (!r.ok) return { effect: 'deny', reason: `the fast-track request is refused: ${r.why}` };
    request = r.request;
  }
  const v = judge(loaded.config, loaded.hash, { action, actor: who, facts: buildFacts(ctx, pr, loaded.config, request), request });
  return { effect: v.effect, reason: v.reason, downgradeTo: v.downgradeTo, detail: v.detail };
};
POLICY_RULES.push(gateRule);

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

export function standingApproval(ctx: Ctx, prId: bigint): Approval | undefined {
  for (const a of ctx.db.approval.prId.filter(prId)) if (a.status === 'standing') return a;
  return undefined;
}

// A fingerprint of what is the ECR's own, as opposed to the baseline's: its title and text, its
// current change request and the assumptions recorded on it. A change to any of these is a change to
// the ECR's revision, and withdraws its approval.
export function ownDigest(ctx: Ctx, pr: Pr): string {
  const own = [...ctx.db.assumption.prId.filter(pr.id)].filter(a => a.current).map(a => `${a.key}@${a.rev}`).sort();
  return fnv1a64(JSON.stringify([pr.title, pr.description, currentRevision(ctx, pr.id)?.digest ?? '', own]));
}

function actorColumns(call: Call) {
  return { kind: call.actor.kind, name: call.actor.name, origin: call.actor.origin, onBehalfOf: call.actor.onBehalfOf ?? undefined };
}

// Record an approval the gate allowed (or, with no configuration, one nothing held to a tier).
export function recordApproval(ctx: Ctx, call: Call, pr: Pr, kind: 'fast_track' | 'tier'): void {
  const d = call.decision.detail as GateDetail | undefined;
  const a = actorColumns(call);
  ctx.db.approval.insert({
    id: 0n,
    prId: pr.id,
    prRevision: pr.revision,
    kind,
    bodyId: kind === 'fast_track' ? 'fast_track' : (d?.route.bodyId ?? ''),
    tierId: d?.route.tierId ?? '',
    tierIndex: d?.route.tierIndex ?? -1,
    costSize: d?.route.costSize ?? -1,
    costBasis: d?.route.costBasis ?? 'none',
    ownDigest: ownDigest(ctx, pr),
    decisionJson: JSON.stringify(d ?? { reason: call.decision.reason }),
    answersJson: d?.request ? JSON.stringify(d.request) : '',
    status: 'standing',
    pendingRecheck: false,
    approverKind: a.kind,
    approverName: a.name,
    approverOrigin: a.origin,
    onBehalfOf: a.onBehalfOf,
    sender: ctx.sender,
    at: ctx.timestamp,
    endedAt: undefined,
    endedReason: '',
  });
}

// The approval a person gave in the PLM, which Norn mirrors (record_plm_decision). Not the gate's decision, so it has no tier
// or body of its own (tierIndex -1, as an approval made without a configuration): the board that approved it is the PLM's.
// The approver is the person the PLM names, not the connection that reported it; `sender` is still that connection.
export function recordPlmApproval(ctx: Ctx, pr: Pr, a: { name: string; decisionJson: string }): void {
  ctx.db.approval.insert({
    id: 0n,
    prId: pr.id,
    prRevision: pr.revision,
    kind: 'plm',
    bodyId: '',
    tierId: '',
    tierIndex: -1,
    costSize: -1,
    costBasis: 'none',
    ownDigest: ownDigest(ctx, pr),
    decisionJson: a.decisionJson,
    answersJson: '',
    status: 'standing',
    pendingRecheck: false,
    approverKind: 'person',
    approverName: a.name,
    approverOrigin: 'human',
    onBehalfOf: undefined,
    sender: ctx.sender,
    at: ctx.timestamp,
    endedAt: undefined,
    endedReason: '',
  });
}

export function endApproval(ctx: Ctx, a: Approval, status: 'withdrawn' | 'released', reason: string): void {
  ctx.db.approval.id.update({ ...a, status, pendingRecheck: false, endedAt: ctx.timestamp, endedReason: reason });
}

// A recommendation the gate filed in place of an approval or a release.
export function recordRecommendation(ctx: Ctx, call: Call, pr: Pr, fallbackAction: string): void {
  const d = call.decision.detail as GateDetail | undefined;
  const a = actorColumns(call);
  ctx.db.recommendation.insert({
    id: 0n,
    prId: pr.id,
    prRevision: pr.revision,
    action: d?.action ?? fallbackAction,
    outcome: d ? (d.awaitingSecondCheck ? 'sampled' : d.outcome) : 'recommend',
    recommenderKind: a.kind,
    recommenderName: a.name,
    recommenderOrigin: a.origin,
    onBehalfOf: a.onBehalfOf,
    sender: ctx.sender,
    reasons: d?.reasons ?? [{ rule: 'policy', text: call.decision.reason }],
    recipients: d?.recipients ?? [],
    answersJson: d?.request ? JSON.stringify(d.request) : '',
    decisionJson: JSON.stringify(d ?? { reason: call.decision.reason }),
    awaitingSecondCheck: d?.awaitingSecondCheck ?? false,
    at: ctx.timestamp,
  });
}

// ---------------------------------------------------------------------------------------------
// An approval across a change of inputs
//
// The rule: an approval stays when only the baseline changed, and is withdrawn, with the reason
// logged, if the re-checked numbers move the ECR to a different approval tier or the ECR's own
// revision changes.
//
// While the checks are repeated the approval stands but is "pending a re-check": the approval row says
// so (pendingRecheck), and set_pr_status refuses to release the ECR until every code stage has
// finished on the current inputs. When the last one finishes, settleApproval compares the tier the
// new numbers point to with the one the approval was given at.
// ---------------------------------------------------------------------------------------------

// Called by reconcile when an approved ECR's inputs changed. Returns why the approval is withdrawn, or
// null when it stands (and then waits for its re-check).
function onInputsChanged(ctx: Ctx, pr: Pr): string | null {
  const a = standingApproval(ctx, pr.id);
  const withdraw = (reason: string) => {
    if (a) endApproval(ctx, a, 'withdrawn', reason);
    return reason;
  };
  if (!a) return withdraw('its inputs changed');
  if (a.tierIndex < 0) return withdraw('its inputs changed, and it was approved without a company configuration, so there is no tier to hold it to');
  if (companyConfig(ctx).state !== 'ok') return withdraw('its inputs changed, and the company configuration is not available to hold it to its tier');
  if (ownDigest(ctx, pr) !== a.ownDigest) return withdraw("the ECR's own revision changed (its text, change request or assumptions)");
  ctx.db.approval.id.update({ ...a, pendingRecheck: true });
  return null;
}

// The tier and body an approval was given at. A fast-track approval has no body of its own, so it is
// held to the body its tier had then, from the decision stored with it.
function approvedAtOf(a: Approval): ApprovedAt {
  let bodyId: string | undefined = a.kind === 'tier' ? a.bodyId : undefined;
  if (bodyId === undefined) {
    try {
      const b = JSON.parse(a.decisionJson)?.route?.bodyId;
      if (typeof b === 'string' && b) bodyId = b;
    } catch {
      // No decision to read a body from: the tier id alone is held.
    }
  }
  return { tierId: a.tierId, tierIndex: a.tierIndex, ...(bodyId ? { bodyId } : {}) };
}

// Called when an approved ECR may have all its checks again (after a check finishes, and at the end of
// a reconcile). If they have: keep the approval if the tier is the one it was given at, else withdraw it.
// Returns what happened, for the log row of the call that caused it ('' when nothing).
export function settleApproval(ctx: Ctx, prId: bigint): string {
  const pr = ctx.db.pullRequest.id.find(prId);
  if (!pr || pr.status !== 'approved') return '';
  const a = standingApproval(ctx, prId);
  if (!a || a.tierIndex < 0) return '';
  if (codeStagesNotDone(ctx, pr).length > 0) {
    // Some check is being repeated (the baseline moved, or another ECR changed what s4 compares): the
    // approval waits for it, and cannot be released until it has finished.
    if (!a.pendingRecheck) ctx.db.approval.id.update({ ...a, pendingRecheck: true });
    return '';
  }
  const loaded = companyConfig(ctx);
  let reason: string | null = null;
  if (loaded.state !== 'ok') {
    reason = 'the company configuration is not available, so the tier the approval was given at cannot be confirmed';
  } else {
    const v = tierVerdict(loaded.config, buildFacts(ctx, pr, loaded.config), approvedAtOf(a));
    if (v.verdict === 'withdraw') reason = v.reason;
    else if (v.verdict === 'unconfirmed') {
      // The tier cannot be confirmed without an exact cost measure: the approval waits, and a release is refused.
      if (!a.pendingRecheck) ctx.db.approval.id.update({ ...a, pendingRecheck: true });
      return `re-check finished without an exact cost: approval still pending (${v.reason})`;
    }
  }
  if (reason === null) {
    if (!a.pendingRecheck) return '';
    ctx.db.approval.id.update({ ...a, pendingRecheck: false });
    return `re-check finished: approval stands (still the ${a.tierId} tier)`;
  }
  ctx.db.pullRequest.id.update({ ...pr, status: 'review', updatedAt: ctx.timestamp });
  endApproval(ctx, a, 'withdrawn', reason);
  return `approval withdrawn: ${reason}`;
}

// A release rests on checks that have finished on the ECR's current inputs and on the tier it was
// approved at still being the tier its numbers point to. Throws, before the release writes anything.
export function assertReleasable(ctx: Ctx, pr: Pr): void {
  const notDone = codeStagesNotDone(ctx, pr);
  if (notDone.length) throw new SenderError(`cannot release ECR ${pr.id}: checks not finished on current inputs (${notDone.join(', ')})`);
  const a = standingApproval(ctx, pr.id);
  if (!a || a.tierIndex < 0) return;
  const loaded = companyConfig(ctx);
  if (loaded.state !== 'ok') throw new SenderError(`cannot release ECR ${pr.id}: the company configuration is not available, so the tier it was approved at cannot be confirmed`);
  const v = tierVerdict(loaded.config, buildFacts(ctx, pr, loaded.config), approvedAtOf(a));
  if (v.verdict !== 'stands') throw new SenderError(`cannot release ECR ${pr.id}: ${v.verdict === 'unconfirmed' ? 'its approval is pending a re-check, and ' : ''}${v.reason}`);
}

APPROVAL_HOOKS.onInputsChanged = onInputsChanged;
APPROVAL_HOOKS.settle = settleApproval;
