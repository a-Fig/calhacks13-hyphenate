// The PLM's decision, mirrored (record_plm_decision in reducers.ts).
//
// The PLM is the system of record for who decided an ECR: the board approves or rejects it there, and
// Norn's ingest reports it. This file holds the policy rule for that one reducer and the pure helpers
// it uses, so that neither depends on the tables.
//
// The rule says who may report: a person, or Norn's own ingest (an agent of origin 'norn'). It applies
// no company limit, because the decision is not Norn's: it is a person's, taken in the PLM, and the
// company's approval matrix (gate.ts) governs what Norn and its agents may decide, not what the board
// decided elsewhere. An agent that works under a job scope is held out by the job-scope rule (scope.ts)
// before this one is asked; an outside agent (origin 'external') and a connection that has not said who
// it is are refused here. An agent never approves in its own name: the approver it records is always
// the person the PLM names, never the caller.
//
// What this does not do is prove who is calling. Every principal is self-declared through register_actor until real
// authentication lands (#34, schema.ts), so a connection that registers as an agent with origin 'norn', or as a person, passes
// this rule. That is the same weakness the ordinary path already has: a connection that registers as the person the company's
// approval matrix names (Bowman's CFO, say) can approve through set_pr_status, and one registered as the CM analyst can then
// release it (check:gate does exactly that). This reducer adds no new kind of hole, but it does not close that one either. The
// two differences: it needs no matching name (any registered person, or a 'norn' agent, may report), and it has no tier or cost
// measure to meet. It does check that the ECR is the one Norn assessed (its content digest) and that Norn's checks are done.
import { POLICY_RULES, type PolicyRule } from './core';
import type { CompanyConfig } from '../../config/src/schema';

export const PLM_DECISIONS = ['approved', 'rejected'] as const;
export type PlmDecision = (typeof PLM_DECISIONS)[number];

export const plmDecisionRule: PolicyRule = (_ctx, actor, reducer, args) => {
  if (reducer !== 'record_plm_decision') return null;
  const by = String(args.decidedBy ?? '').trim() || 'someone';
  if (actor.kind === 'person') return { effect: 'allow', reason: `${actor.name} reports a decision taken in the PLM by ${by}; Norn applies no limit of its own to it` };
  if (actor.kind === 'agent' && actor.origin === 'norn') return { effect: 'allow', reason: `Norn's ingest reports a decision a person took in the PLM (${by}); the agent decides nothing` };
  const who = actor.kind === 'agent' ? `${actor.name} (an outside agent)` : `${actor.name} (not registered as a person or an agent)`;
  return { effect: 'deny', reason: `${who} may not report a PLM decision: only a person, or Norn's own ingest reporting what a person decided in the PLM, can` };
};
POLICY_RULES.push(plmDecisionRule);

type Person = CompanyConfig['people'][number];

const squash = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, '');

/**
 * The company's person for a PLM login, if there is one. A login is usually an address
 * ('rafael.quintero@bowman-aviation.example'); its part before the '@' is matched, with dots, dashes,
 * underscores and spaces ignored, against each person's id and name. Nothing is guessed beyond that: a
 * login that matches nobody (or two people) is not a person Norn can name.
 */
export function personForLogin(people: readonly Person[], login: string): Person | undefined {
  const key = squash(login.split('@')[0] ?? '');
  if (!key) return undefined;
  const hits = people.filter(p => squash(p.id) === key || squash(p.name) === key);
  return hits.length === 1 ? hits[0] : undefined;
}
