// The worker's whole research step on a recording, with nothing live: the targets, the guardrails
// against the recorded pages, and the record_assumption calls the worker would make. It touches no
// database. Every line it prints starts with RECORDED.

import { reviewProposals } from '../guardrails.ts';
import type { Recording } from '../recording.ts';
import { recordedFetcher } from '../pages.ts';
import { prepare, type Company } from '../run.ts';
import { buildOutcome, commentFor, type Outcome } from './outcome.ts';
import type { RecordAssumptionArgs } from './assumptions.ts';

export interface ReplayPlan {
  outcome: Outcome;
  calls: { targetKey: string; args: RecordAssumptionArgs }[];
  comment: string | null;
}

/** The id the placeholder ECR gets in a replay: no database was read. */
export const REPLAY_PR_ID = 0n;

export async function replayPlan(rec: Recording, company: Company): Promise<ReplayPlan> {
  const prep = prepare(company, { ecrId: rec.ecr, seed: rec.seed, n: rec.n, ...(rec.context ? { context: rec.context } : {}) });
  const verdicts = await reviewProposals(rec.agentOutput.proposals, prep.targets, recordedFetcher(rec.pages), { today: rec.recordedOn, identifiers: prep.identifiers });
  const { outcome, calls } = buildOutcome({
    mode: 'RECORDED',
    key: `${rec.ecr}@recorded`,
    ecr: rec.ecr,
    prId: REPLAY_PR_ID,
    revision: 0,
    digest: 'recorded',
    s2RunId: 0n,
    jobId: `replay-${rec.ecr}`,
    now: rec.recordedOn,
    targets: prep.targets,
    agentOutput: rec.agentOutput,
    verdicts,
    existing: [],
    agentHex: 'recorded',
  });
  // Nothing was written, so nothing is "recorded" in the outcome's sense; the comment is what it would say if every call took effect.
  const asIfRecorded: Outcome = { ...outcome, recorded: calls.map((c) => ({ targetKey: c.targetKey, key: c.args.key, rev: 1, assumptionId: 0 })) };
  return { outcome, calls, comment: commentFor(asIfRecorded) };
}

const stringify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

export function renderReplay(rec: Recording, plan: ReplayPlan): string {
  const out: string[] = [];
  const say = (s = '') => out.push(...s.split('\n').map((l) => `RECORDED | ${l}`));
  say(rec.label);
  say('Nothing here was researched live and no database was read or written. The calls below are what the worker would make.');
  for (const [i, what] of Object.entries(rec.planted)) say(`Proposal #${Number(i) + 1} is planted to test the guardrails: ${what}`);
  say();
  for (const p of plan.outcome.proposals) {
    say(`proposal ${p.index + 1} (${p.targetKey ?? 'no target'}, ${p.label ?? 'unknown'}): ${p.status.toUpperCase()}${p.flags.length ? ` + ${p.flags.length} flag(s)` : ''}`);
    for (const r of p.reasons) say(`  reason: ${r.message}`);
  }
  say();
  say(`record_assumption calls (${plan.calls.length}), as the worker would make them, prId ${REPLAY_PR_ID} standing for ${rec.ecr}:`);
  for (const c of plan.calls) say(stringify(c.args));
  if (plan.outcome.notRecorded.length) for (const n of plan.outcome.notRecorded) say(`not recorded: ${n.targetKey}: ${n.why}`);
  say();
  say(plan.comment ? `comment on the ECR (add_comment, anchor check_run:0):\n${plan.comment}` : 'no comment on the ECR: nothing was held, rejected or flagged');
  return out.join('\n');
}
