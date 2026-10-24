// The job-scope rule for the policy gate. An agent that comes in through Norn's MCP server has an
// actor_scope row (see grant_scope): the ECRs its credential names, the highest statement level it
// may post, and when the grant ends. This rule runs inside authorize(), so a write outside that
// scope is refused by the gate itself and the refusal is a row in the action log (outcome
// 'denied', with the reason below), not a message the MCP server made up.
//
// Scoped actors are deny-by-default: they may comment, record agent-estimated assumptions and post
// impact statements on the ECRs in their scope, and nothing else. Actors without a scope row
// (workers, the UI, people) are not affected. #43 will replace the gate's rules with Bowman's
// configuration; this rule is about the credential, not the company, and should survive that.
import { POLICY_RULES, effectiveAssumptions, type ActorScope, type Ctx, type PolicyRule } from './core';

// Reducers a scoped actor may call, with an ECR in `prId`.
const SCOPED_WRITES = new Set(['add_comment', 'record_assumption', 'post_impact_statement']);

function ecrLabel(ctx: Ctx, prId: bigint): string {
  return ctx.db.pullRequest.id.find(prId)?.plmEcrNumber ?? `ECR ${prId}`;
}

function scopeText(ctx: Ctx, s: ActorScope): string {
  return s.anyEcr ? 'any ECR' : s.prIds.length ? s.prIds.map(id => ecrLabel(ctx, id)).join(', ') : 'no ECR';
}

const deny = (reason: string) => ({ effect: 'deny' as const, reason });

type Evidenced = { evidence?: string };

export const scopeRule: PolicyRule = (ctx, actor, reducer, args) => {
  const s = actor.scope;
  if (!s) return null;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const live = now < s.expiresAtMicros;

  if (reducer === 'register_actor') {
    // While a job holds this actor, nobody (a second job, a retry with another token) may change who
    // it is or whom it acts for: history would then show the first job's work as someone else's.
    const onBehalfOf = (args.onBehalfOf as string | undefined)?.trim() || null;
    if (live && actor.kind !== 'unknown' && (String(args.name).trim() !== actor.name || onBehalfOf !== actor.onBehalfOf))
      return deny(`${actor.name} is held by job ${s.jobId}; it cannot be registered under another name or for ${onBehalfOf ?? 'no one'} until that grant expires`);
    return null;
  }

  if (reducer === 'grant_scope') {
    // A live grant can't be replaced by a different job, or widened, by the connection it limits.
    if (!live) return null;
    const widens =
      (args.anyEcr && !s.anyEcr) || (!s.anyEcr && (args.prIds as bigint[]).some(id => !s.prIds.includes(id))) || Number(args.maxLevel) > s.maxLevel;
    if (args.jobId !== s.jobId || widens)
      return deny(`${actor.name} holds a live grant from job ${s.jobId} (${scopeText(ctx, s)}); it cannot be given to another job or widened until it expires`);
    return null;
  }

  if (!live) return deny(`the grant from job ${s.jobId} has expired`);
  if (!SCOPED_WRITES.has(reducer))
    return deny(`${reducer} is not open to an agent working under job ${s.jobId}; it may comment, propose assumptions and post impact statements on its ECRs`);

  const prId = typeof args.prId === 'bigint' ? (args.prId as bigint) : 0n;
  if (prId === 0n) return deny(`the production baseline is not writable under job ${s.jobId}`);
  if (!s.anyEcr && !s.prIds.includes(prId))
    return deny(`outside the scope of job ${s.jobId}: it may write to ${scopeText(ctx, s)}, not ${ecrLabel(ctx, prId)}`);

  if (reducer === 'record_assumption') {
    if (args.source !== 'agent_estimated')
      return deny(`an agent records agent_estimated assumptions only, not '${args.source}'`);
    // Any assumption change re-checks the ECR and takes an approval back to review.
    if (ctx.db.pullRequest.id.find(prId)?.status === 'approved')
      return deny(`${ecrLabel(ctx, prId)} is approved; changing an assumption would withdraw the approval. Comment on the assumption instead`);
    const key = String(args.key).trim();
    const effective = effectiveAssumptions(ctx, prId).find(a => a.key === key);
    if (effective?.source === 'given')
      return deny(`'${key}' is a given value; an agent may not replace it (comment on it instead)`);
  }

  if (reducer === 'post_impact_statement') {
    const level = Number(args.level);
    if (s.maxLevel < 1) return deny(`job ${s.jobId} may not post impact statements`);
    if (level > s.maxLevel) return deny(`job ${s.jobId} may post up to Level ${s.maxLevel}, not Level ${level}`);
    const items: Evidenced[] = [...(args.numbers as Evidenced[]), ...(args.drivers as Evidenced[]), ...(args.claims as Evidenced[])];
    if (items.some(i => i.evidence === 'fact'))
      return deny("an agent cannot mark its own number or claim as fact: a fact is read from a source Norn can check. Use computation (a check result), assumption or judgment");
  }

  return { effect: 'allow', reason: `job scope: job ${s.jobId} may write to ${ecrLabel(ctx, prId)}` };
};

POLICY_RULES.push(scopeRule);
