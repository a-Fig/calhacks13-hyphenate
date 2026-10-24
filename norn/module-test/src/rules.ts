// Policy rules for the test module. The real module has none (#43 writes them); these exist so
// the gate (allow, deny, downgrade, and what write() does with each) can be tested.
import { POLICY_RULES } from '../../module/src/core';

POLICY_RULES.push((_ctx, actor, reducer, args) => {
  // deny: a comment that starts with "policy:deny"
  if (reducer === 'add_comment' && String(args.body).startsWith('policy:deny'))
    return { effect: 'deny', reason: 'test rule: comments that start with "policy:deny" are refused' };
  // downgrade: an outside agent may recommend an approval but not make it
  if (reducer === 'set_pr_status' && args.status === 'approved' && actor.kind === 'agent' && actor.origin === 'external')
    return { effect: 'downgrade', downgradeTo: 'recommendation', reason: 'test rule: outside agents recommend, a person approves' };
  // a downgrade for an action that has no weaker form must become a refusal
  if (reducer === 'set_pr_status' && args.status === 'closed' && actor.name === 'test-downgrader')
    return { effect: 'downgrade', downgradeTo: 'nothing', reason: 'test rule: closing has no weaker form' };
  return null;
});
