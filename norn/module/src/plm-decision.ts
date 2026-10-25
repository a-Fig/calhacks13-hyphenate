// The PLM's decision, mirrored (record_plm_decision in reducers.ts).
//
// The PLM is the system of record for who decided an ECR: the board approves or rejects it there, and
// Norn's ingest reports it. This file holds the policy rule for that one reducer and the pure helper
// it uses.
//
// The rule says who may report: a person who is in the company's configuration, or Norn's own ingest (an agent of origin
// 'norn'). A job-scoped agent is held out by the job-scope rule (scope.ts) before this one is asked; an outside agent (origin
// 'external'), a person the company does not list and a connection that has not said who it is are refused here. An agent
// never approves in its own name: the approver it records is always the person the PLM names, never the caller.
//
// This path is a policy bypass, on purpose and with a known weakness. The ordinary path (set_pr_status) still enforces the
// company's approval matrix (the body that decides the ECR, its chair) and the exact-cost rule, on every person, self-declared
// or not. This one applies neither, because the decision is not Norn's: the board took it in the PLM, and Norn mirrors it. What
// stands in for the matrix is trust in the reporter, and the reporter is whoever registers (register_actor) as an agent of
// origin 'norn', or as a person the company lists. Until real authentication lands (#34, schema.ts) that is a claim, not a
// proof, so a connection that makes the claim can fabricate an approval Norn would otherwise have to earn through the matrix.
// It is fine for a demo with no hostile clients. The fix is #34: an authenticated identity for Norn's ingest, after which
// this rule should accept that identity alone. What the reducer does still check is that the ECR is the one Norn assessed
// (its content digest), that Norn's checks are done and that the baseline is current.
import { POLICY_RULES, type PolicyRule } from './core';
import { companyConfig } from './gate';
import { personRef } from './gate-logic';
import type { CompanyConfig } from '../../config/src/schema';

export const PLM_DECISIONS = ['approved', 'rejected'] as const;
export type PlmDecision = (typeof PLM_DECISIONS)[number];

export const plmDecisionRule: PolicyRule = (ctx, actor, reducer, args) => {
  if (reducer !== 'record_plm_decision') return null;
  const by = String(args.decidedBy ?? '').trim() || 'someone';
  if (actor.kind === 'person') {
    // A person must be one the company lists, so that a made-up name cannot report. With no readable list, no person may (fail closed).
    const loaded = companyConfig(ctx);
    if (loaded.state === 'none') return { effect: 'deny', reason: 'no company configuration is stored, so Norn cannot tell who may report a PLM decision' };
    if (loaded.state === 'unreadable') return { effect: 'deny', reason: `${loaded.why}; Norn takes no PLM decision on a configuration it cannot read` };
    const ref = personRef(loaded.config, actor.name);
    if (!loaded.config.people.some(p => p.id === ref)) return { effect: 'deny', reason: `${actor.name} is not a person in this configuration, so may not report a PLM decision` };
    return { effect: 'allow', reason: `${actor.name} reports a decision taken in the PLM by ${by}; Norn applies no limit of its own to it` };
  }
  if (actor.kind === 'agent' && actor.origin === 'norn') return { effect: 'allow', reason: `Norn's ingest reports a decision a person took in the PLM (${by}); the agent decides nothing` };
  const who = actor.kind === 'agent' ? `${actor.name} (an outside agent)` : `${actor.name} (not registered as a person or an agent)`;
  return { effect: 'deny', reason: `${who} may not report a PLM decision: only a person the company lists, or Norn's own ingest reporting what a person decided in the PLM, can` };
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
