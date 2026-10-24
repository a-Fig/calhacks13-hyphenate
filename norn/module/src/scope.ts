// The job-scope rule for the policy gate. An agent that comes in through Norn's MCP server has an
// actor_scope row (see grant_scope): the ECRs its credential names and when the grant ends. This
// rule runs inside authorize(), so a write outside that scope is refused by the gate itself and
// the refusal is a row in the action log (outcome 'denied', with the reason below), not a message
// the MCP server made up.
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

export const scopeRule: PolicyRule = (ctx, actor, reducer, args) => {
  const s = actor.scope;
  if (!s) return null;
  if (reducer === 'register_actor') return null;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const live = now < s.expiresAtMicros;

  if (reducer === 'grant_scope') {
    // A live grant can't be replaced by a different job, or widened, by the connection it limits.
    if (!live) return null;
    const widens = (args.anyEcr && !s.anyEcr) || (!s.anyEcr && (args.prIds as bigint[]).some(id => !s.prIds.includes(id)));
    if (args.jobId !== s.jobId || widens)
      return deny(`${actor.name} holds a live grant from job ${s.jobId} (${scopeText(ctx, s)}); it cannot be changed to job ${args.jobId} or widened until it expires`);
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
    const key = String(args.key).trim();
    const effective = effectiveAssumptions(ctx, prId).find(a => a.key === key);
    if (effective?.source === 'given')
      return deny(`'${key}' is a given value; an agent may not replace it (comment on it instead)`);
  }

  return { effect: 'allow', reason: `job scope: job ${s.jobId} may write to ${ecrLabel(ctx, prId)}` };
};

POLICY_RULES.push(scopeRule);
