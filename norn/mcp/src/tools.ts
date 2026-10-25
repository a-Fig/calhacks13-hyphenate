// The tools. Descriptions are written for the agent that reads them: short, what comes back, and
// which evidence class the answer belongs to (fact, assumption, computation, judgment; see
// docs/GLOSSARY.md). Reads answer from the mirror. Writes go through the verified actor's own
// connection and the module's reducers, so the policy gate decides and the action log records the
// result, refusals included. The tools take no identity: who is acting comes from the token.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActionLog, PullRequest } from '@norn/bindings/types';
import { z } from 'zod';
import { registerErpTools } from './erp.ts';
import { companyConfigOf, explainRefusal, fastTrackField, outcomeOf, prepareRequest, recordOf, statementClassOf } from './fasttrack.ts';
import type { ActorHandle, Norn } from './norn.ts';
import type { Claims } from './token.ts';
import { affectedParts, assumptionView, bareResultKey, currentResult, currentResultKeys, ecrSummary, ecrView, effectiveAssumptions, historyOf, impactOf, partView, provenanceIndex } from './views.ts';

export interface ToolContext {
  norn: Norn;
  claims: Claims;
  actor: ActorHandle;
  log: (message: string) => void;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }] });
const fail = (message: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

// What an agent may label its own numbers and claims. 'fact' is not offered: a fact is read from a
// source Norn can check, and an agent's say-so is not one (the policy gate refuses it too).
const Evidence = z.enum(['assumption', 'computation', 'judgment']);
const ECR = z.string().min(1).describe('The ECR number as list_ecrs shows it, e.g. "BWM-ECR-0417". A unique tail such as "ECR-0417" also works.');

class ToolFailure extends Error {}

function ecrOf(ctx: ToolContext, ref: string): PullRequest {
  const { pr, known } = ctx.norn.findEcr(ref);
  if (!pr) throw new ToolFailure(`No single ECR matches '${ref}'. ECRs: ${known.join(', ') || 'none'}.`);
  return pr;
}

/** Runs a tool body, turning a thrown ToolFailure into a clear error result and anything else into a generic one. */
function tool(ctx: ToolContext, name: string, body: (...args: any[]) => Promise<ToolResult> | ToolResult) {
  return async (...args: any[]): Promise<ToolResult> => {
    const t0 = Date.now();
    let result: ToolResult;
    try {
      result = await body(...args);
    } catch (e) {
      if (e instanceof ToolFailure) result = fail(e.message);
      else {
        ctx.log(`tool ${name} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        result = fail('Norn hit an internal error handling this call. Nothing was reported as done. Say so in your answer.');
      }
    }
    ctx.log(`tool ${name} actor=${ctx.claims.actor} job=${ctx.claims.jobId} ${result.isError ? 'error' : 'ok'} ${Date.now() - t0}ms`);
    return result;
  };
}

/**
 * Send one write through the actor's connection and report what the gate did. A refusal is not an
 * error to retry: it is the answer, and it is already in Norn's action log.
 */
async function sendWrite(ctx: ToolContext, reducer: string, args: Record<string, unknown>, explain?: (message: string) => string | undefined): Promise<{ failed: ToolResult } | { row: ActionLog }> {
  const r = await ctx.norn.call(ctx.actor, ctx.claims, reducer, args);
  const failed = (message: string) => ({ failed: fail(message) });
  if (r.error) {
    if (r.error.kind === 'rejected') return failed(explain?.(r.error.message) ?? `Norn rejected this: ${r.error.message}`);
    if (r.error.kind === 'unknown_result') return failed('Norn did not confirm whether this was saved. Call get_ecr_history before trying again, so you do not post it twice.');
    return failed(`Norn could not take this write right now (${r.error.kind}). Nothing was saved. Try once more; if it fails again, say so in your answer.`);
  }
  if (!r.row) return failed('Norn accepted the call but has not confirmed it yet. Call get_ecr_history before trying again, so you do not post it twice.');
  if (r.row.outcome === 'rejected') return failed(`Norn rejected this: ${r.row.summary.replace(/^S+ rejected: /, '')}. Nothing was saved (entry ${r.row.id} in the action log).`);
  if (r.row.outcome === 'denied')
    return failed(
      `Refused by Norn's policy gate: ${r.row.policy.replace(/^deny: /, '')}. The refusal is recorded in Norn's action log (entry ${r.row.id}). Do not retry or look for another way; report that you were refused.`
    );
  return { row: r.row };
}

async function write(ctx: ToolContext, reducer: string, args: Record<string, unknown>, done: (entity: string) => Record<string, unknown>): Promise<ToolResult> {
  const r = await sendWrite(ctx, reducer, args);
  if ('failed' in r) return r.failed;
  return ok({ saved: true, recordedAs: { actor: r.row.actorName, onBehalfOf: r.row.onBehalfOf ?? null, spawnedBy: r.row.spawnedBy }, allowedBecause: r.row.policy, actionLogEntry: Number(r.row.id), ...done(r.row.entity) });
}

export const INSTRUCTIONS = [
  "Norn's tools for engineering change requests (ECRs) at Bowman.",
  'Numbers come from checks that code ran; read them with get_impact and quote them as they are. If a result says mock, it is placeholder data and you must say so.',
  'Label what you write by evidence class: assumption, computation (copied from a check result) or judgment (your conclusion). You cannot label your own claim a fact; facts are what Norn holds from its sources.',
  'You act under your own name for the person named in your credential, and only on the ECRs your job names. A refusal is final; report it.',
].join(' ');

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { norn } = ctx;

  // ---- reads ----------------------------------------------------------------------------------

  server.registerTool(
    'list_ecrs',
    {
      description: 'List the ECRs: number, title, status, revision, whether impact results exist (impactState: no_results, partial, current or stale) and which statement levels are posted. Evidence class: fact.',
      inputSchema: { status: z.enum(['draft', 'review', 'approved', 'merged', 'closed']).optional().describe('Only ECRs in this status.') },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'list_ecrs', async ({ status }: { status?: string }) => {
      const rows = [...norn.db.pullRequest.iter()].filter(p => !status || p.status === status).sort((a, b) => Number(a.id - b.id));
      return ok({ ecrs: rows.map(p => ecrSummary(norn, p)) });
    })
  );

  server.registerTool(
    'get_ecr',
    {
      description:
        'Read one ECR: its text, status, revision, base version, affected parts, whether impact results exist, and the newest impact statement of each level. The text and status are facts. Affected parts are matched from the text and check details, so they can be incomplete.',
      inputSchema: { ecr: ECR },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'get_ecr', async ({ ecr }: { ecr: string }) => ok(ecrView(norn, ecrOf(ctx, ecr))))
  );

  server.registerTool(
    'get_impact',
    {
      description:
        'The latest check results for an ECR, by stage. Each number has p10/p50/p90, a unit and its trace: the formula, what it used, and the assumptions the run read with their sources. Evidence class: computation. state says no_results, partial, current or stale; stale numbers are out of date. mock: true means placeholder numbers, not real forecasts. Pass key to get one result with its full trace. fastTrack says whether to ask for the fast track: candidate is true when only your answers to fastTrack.tests stand between this ECR and it (why says so in a sentence); see request_fast_track_approval.',
      inputSchema: { ecr: ECR, key: z.string().optional().describe('A result key, to get its full trace.') },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'get_impact', async ({ ecr, key }: { ecr: string; key?: string }) => {
      const pr = ecrOf(ctx, ecr);
      return ok({ ecr: pr.plmEcrNumber, ...impactOf(norn, pr, { key }), fastTrack: fastTrackField(norn, pr, ctx.claims) });
    })
  );

  server.registerTool(
    'get_part',
    {
      description: 'Read one part by part number: name, category and spec, and the ECRs whose text names it. Evidence class: fact (as held in Norn; the ERP connector is not wired in yet).',
      inputSchema: { part: z.string().min(1).describe('The part number, e.g. "BWM-1042-01".') },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'get_part', async ({ part }: { part: string }) => {
      const want = part.trim().toLowerCase();
      const p = [...norn.db.part.iter()].find(x => x.partNumber.toLowerCase() === want);
      if (!p) return fail(`No part '${part}' in Norn. Part numbers: ${[...norn.db.part.iter()].map(x => x.partNumber).sort().join(', ') || 'none'}.`);
      const ecrs = [...norn.db.pullRequest.iter()].filter(pr => affectedParts(norn, pr).some(a => a.partNumber === p.partNumber)).map(pr => pr.plmEcrNumber);
      return ok({ ...partView(p), namedInEcrs: ecrs });
    })
  );

  server.registerTool(
    'list_assumptions',
    {
      description:
        'The assumptions an ECR sees: Bowman\'s baseline ones, with the ECR\'s own on top. Each has a value or distribution, a source and a rationale. source given = fact; default = a category default (assumption); agent_estimated = an agent\'s estimate (assumption). Without ecr, only the baseline ones.',
      inputSchema: { ecr: ECR.optional() },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'list_assumptions', async ({ ecr }: { ecr?: string }) => {
      const pr = ecr ? ecrOf(ctx, ecr) : undefined;
      const prov = [provenanceIndex(norn, 0n), pr ? provenanceIndex(norn, pr.id) : new Map()];
      return ok({ ecr: pr?.plmEcrNumber ?? null, assumptions: effectiveAssumptions(norn, pr?.id ?? 0n).map(a => assumptionView(norn, a, prov[a.prId === 0n ? 0 : 1]!)) });
    })
  );

  server.registerTool(
    'get_ecr_history',
    {
      description:
        'The ECR\'s comments and the actions taken on it, oldest first: who did it, for whom, what started it and the outcome. A refusal shows as outcome denied (the policy gate) or rejected (the write was invalid), with the reason. Evidence class: fact. Default last 40 entries.',
      inputSchema: { ecr: ECR, limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    tool(ctx, 'get_ecr_history', async ({ ecr, limit }: { ecr: string; limit?: number }) => ok(historyOf(norn, ecrOf(ctx, ecr), limit ?? 40)))
  );

  // ---- writes ---------------------------------------------------------------------------------

  server.registerTool(
    'add_comment',
    {
      description: 'Post a comment on an ECR under your own name. Keep it short and say what it rests on. Returns the comment id. Refused if the ECR is outside your job.',
      inputSchema: {
        ecr: ECR,
        body: z.string().min(1).max(4000),
        anchor: z.string().max(80).optional().describe('What it is about, e.g. "check_run:7" or "assumption:12". Leave out for the ECR as a whole.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    tool(ctx, 'add_comment', async ({ ecr, body, anchor }: { ecr: string; body: string; anchor?: string }) => {
      const pr = ecrOf(ctx, ecr);
      return write(ctx, 'addComment', { prId: pr.id, anchor: anchor ?? '', body }, entity => ({ ecr: pr.plmEcrNumber, commentId: Number(entity.split(':')[1]) }));
    })
  );

  const Dist = z.union([
    z.number().describe('A fixed value.'),
    z.object({ kind: z.literal('fixed'), value: z.number() }),
    z.object({ kind: z.literal('triangular'), min: z.number(), mode: z.number(), max: z.number() }),
  ]);
  server.registerTool(
    'propose_assumption',
    {
      description:
        'Propose a value for an assumption on an ECR, with your rationale and sources. It is recorded as agent_estimated (an assumption, never a fact) and the ECR\'s checks re-run on it. Give a number, or a triangular range {kind:"triangular",min,mode,max}. Sources: what you read, e.g. URLs or "ECR text". Refused for a key whose value is given.',
      inputSchema: {
        ecr: ECR,
        key: z.string().min(1).max(80).describe('The assumption key, as list_assumptions shows it, or a new one.'),
        value: Dist,
        rationale: z.string().min(1).max(1500),
        sources: z.array(z.string().min(1).max(300)).min(1).max(8),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    tool(ctx, 'propose_assumption', async (a: { ecr: string; key: string; value: z.infer<typeof Dist>; rationale: string; sources: string[] }) => {
      const pr = ecrOf(ctx, a.ecr);
      const dist = typeof a.value === 'number' ? { kind: 'fixed' as const, value: a.value } : a.value;
      if (dist.kind === 'triangular' && !(dist.min <= dist.mode && dist.mode <= dist.max)) return fail('A triangular value needs min <= mode <= max.');
      const key = a.key.trim();
      const own = [...norn.db.assumption.prId.filter(pr.id)].find(r => r.key === key && r.current);
      const base = [...norn.db.assumption.prId.filter(0n)].find(r => r.key === key && r.current);
      const rationale = `${a.rationale.trim()}\n\nSources:\n${a.sources.map(s => `- ${s.trim()}`).join('\n')}`;
      const send = () =>
        write(
          ctx,
          'recordAssumption',
          { prId: pr.id, key, distJson: JSON.stringify(dist), source: 'agent_estimated', rationale, affects: own?.affects ?? base?.affects ?? [], expectedRev: own?.rev ?? 0 },
          entity => ({ ecr: pr.plmEcrNumber, key, source: 'agent_estimated', assumptionId: Number(entity.split(':')[1]), note: 'The ECR\'s checks will re-run on this value.' })
        );
      return send();
    })
  );

  const Claim = z.object({ text: z.string().min(1).max(600), evidence: Evidence });
  server.registerTool(
    'post_impact_statement',
    {
      description:
        'Post a structured impact statement (level 1 to 3) on an ECR: change class, proposed approval route, a headline, headline numbers with p10/p50/p90, drivers, the assumptions it rests on, and claims, each with an evidence class. A number with evidence "computation" must name the key of a result from get_impact (e.g. "unit_cost_delta") and is copied from that result, with its label and unit: do not type them. You cannot post evidence "fact". Any other number needs p10, p50 and p90. Assumption sources are filled in from Norn\'s record. Use fixed likelihood words in prose (almost no chance, very unlikely, unlikely, roughly even, likely, very likely, almost certain).',
      inputSchema: {
        ecr: ECR,
        level: z.number().int().min(1).max(3).describe('1 = impact screen, 2 = researched, 3 = Norn\'s final verdict.'),
        changeClass: z.string().min(1).max(80).describe('The change class, e.g. "Class I".'),
        route: z.string().min(1).max(200).describe('The proposed approval route, e.g. "CCB".'),
        headline: z.string().min(1).max(600).describe('One or two plain sentences.'),
        numbers: z
          .array(
            z.object({
              key: z.string().min(1).max(80),
              evidence: Evidence,
              resultKey: z.string().optional().describe('Required for computation: the get_impact result key.'),
              label: z.string().max(200).optional(),
              unit: z.string().max(24).optional(),
              p10: z.number().optional(),
              p50: z.number().optional(),
              p90: z.number().optional(),
            })
          )
          .min(1)
          .max(12),
        drivers: z.array(Claim).max(8).describe('What moves the numbers most.'),
        assumptions: z.array(z.object({ key: z.string().min(1), note: z.string().max(400).describe('How the statement leans on it.') })).max(20),
        claims: z.array(Claim).max(12),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    tool(ctx, 'post_impact_statement', async (a: any) => {
      const pr = ecrOf(ctx, a.ecr);
      const numbers = (a.numbers as any[]).map(n => {
        if (n.evidence === 'computation') {
          if (!n.resultKey) throw new ToolFailure(`Number '${n.key}' is a computation, so it needs resultKey (a key from get_impact).`);
          const resultKey = bareResultKey(n.resultKey);
          const r = currentResult(norn, pr.id, resultKey);
          if (!r) {
            const keys = currentResultKeys(norn, pr.id);
            throw new ToolFailure(`Number '${n.key}': ${pr.plmEcrNumber} has no current check result '${n.resultKey}'. ${keys.length ? `Current result keys: ${keys.join(', ')}.` : 'It has no current results; call get_impact, and if they are missing or stale do not present the number as a computation.'}`);
          }
          // A computation is the check's number under the check's own label and unit; the agent's are ignored.
          return { key: n.key, label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, evidence: 'computation', resultKey };
        }
        if (![n.p10, n.p50, n.p90].every((x: unknown) => typeof x === 'number')) throw new ToolFailure(`Number '${n.key}' is a ${n.evidence}, so it needs p10, p50 and p90.`);
        return { key: n.key, label: n.label ?? n.key, unit: n.unit ?? '', p10: n.p10, p50: n.p50, p90: n.p90, evidence: n.evidence, resultKey: n.resultKey ?? '' };
      });
      const seen = new Map(effectiveAssumptions(norn, pr.id).map(x => [x.key, x]));
      const assumptions = (a.assumptions as { key: string; note: string }[]).map(x => {
        const known = seen.get(x.key);
        if (!known) throw new ToolFailure(`Assumption '${x.key}' is not one ${pr.plmEcrNumber} sees. Call list_assumptions for the keys.`);
        return { key: x.key, source: known.source, note: x.note };
      });
      return write(
        ctx,
        'postImpactStatement',
        { prId: pr.id, level: a.level, changeClass: a.changeClass, route: a.route, headline: a.headline, numbers, drivers: a.drivers, assumptions, claims: a.claims },
        entity => ({ ecr: pr.plmEcrNumber, level: a.level, statementId: Number(entity.split(':')[1]), writtenAtRevision: pr.revision })
      );
    })
  );

  const Answer = z.object({
    testId: z.string().min(1).max(80).describe('A test id from get_impact fastTrack.tests.'),
    holds: z.boolean().describe("Whether the test's text is true of this ECR."),
    evidence: z.string().min(1).max(400).describe('What you read that shows it: a short quote or pointer into get_ecr, get_impact or list_assumptions.'),
  });
  server.registerTool(
    'request_fast_track_approval',
    {
      description:
        "Ask Norn to approve an ECR on the fast track, with your answers to the company's fast-track tests (get_impact fastTrack.tests; ask only when fastTrack.candidate is true). Answer every test, once, honestly, with evidence: a test you mark true without evidence is a false statement under your name. Norn's gate decides from the company's rules and the numbers, not from you: the answer says approved, held for a blind second check (not approved yet), recommended to a named role, or refused, each with the reasons. Call it once and report the outcome as it is. Classes: leave companyClass out and Norn uses the change class on your current statement for this revision (post your Level 1 statement first, stating Class I or Class II with a reason; Norn never picks a class for you, and a class more permissive than your statement's is refused). Always state regulatoryClass (the FAA class, e.g. \"minor\" or \"major\") and say in your answer what you rest it on; Norn holds no FAA class of its own. The answer reports where each class came from. Optional triggers: named conditions you saw (safety_part, new_supplier, conflicting_open_ecr, shared_supplier_exposure, linchpin_assumption_agent_estimated, sources_conflict, stale_data, checker_disagrees); any of them sends the ECR to a person. Refused if the ECR is outside your job, not in review, or its checks have not finished.",
      inputSchema: {
        ecr: ECR,
        answers: z.array(Answer).min(1).max(30),
        companyClass: z.string().max(40).optional(),
        regulatoryClass: z.string().max(40).optional(),
        triggers: z.array(z.string().max(80)).max(10).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    tool(ctx, 'request_fast_track_approval', async (a: { ecr: string; answers: { testId: string; holds: boolean; evidence: string }[]; companyClass?: string; regulatoryClass?: string; triggers?: string[] }) => {
      const pr = ecrOf(ctx, a.ecr);
      const loaded = companyConfigOf(norn);
      if (loaded.state === 'none') return fail('No company configuration is stored in Norn, so there is no fast track rule to apply. Nothing was sent.');
      if (loaded.state === 'unreadable') return fail(`Norn cannot read the company configuration (${loaded.why}), so it takes no fast-track decision. Nothing was sent.`);
      const prepared = prepareRequest(loaded.config, a, statementClassOf(norn, pr, loaded.config));
      if (!prepared.ok) return fail(prepared.message);
      const { request } = prepared;
      const sent = await sendWrite(
        ctx,
        'requestFastTrackApproval',
        { prId: pr.id, answers: request.answers, companyClass: request.classes.company, regulatoryClass: request.classes.regulatory, triggers: request.triggers },
        message => explainRefusal(message, pr.plmEcrNumber)
      );
      if ('failed' in sent) return sent.failed;
      return ok(outcomeOf(loaded.config, pr.plmEcrNumber, sent.row, recordOf(norn, pr, sent.row), request));
    })
  );

  registerErpTools(server, ctx);
}

export const TOOL_NAMES = ['list_ecrs', 'get_ecr', 'get_impact', 'get_part', 'list_assumptions', 'get_ecr_history', 'add_comment', 'propose_assumption', 'post_impact_statement', 'request_fast_track_approval'] as const;
