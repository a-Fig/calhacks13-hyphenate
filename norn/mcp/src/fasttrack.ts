// The fast track, as an agent meets it: the signal get_impact carries (should I ask?) and the words the
// request_fast_track_approval tool answers in. The decisions are the module's and the configuration's:
// the signal is gate-logic.ts's fastTrackSignal run on this mirror's rows through the same factsFromRows the
// gate uses, and the answer is read back from the approval and recommendation rows the gate wrote.
import type { ActionLog, Approval, PullRequest, Recommendation } from '@norn/bindings/types';
import { COMPANY_CONFIG_KEY } from '../../config/src/stored.ts';
import type { CompanyConfig } from '../../config/src/schema.ts';
import {
  configActor,
  factsFromRows,
  fastTrackSignal,
  readCompanyConfig,
  readFastTrackRequest,
  resolveClasses,
  statementCompanyClass,
  type ClassSource,
  type FastTrackRequest,
  type FastTrackSignal,
  type GateDetail,
  type LoadedConfig,
  type ResultRow,
} from '../../module/src/gate-logic.ts';
import { maxLevelFor, type Norn } from './norn.ts';
import type { Claims } from './token.ts';

// ---------------------------------------------------------------------------------------------
// The stored configuration, read from the mirror
// ---------------------------------------------------------------------------------------------

let read: { text: string; loaded: LoadedConfig } | undefined;
export function companyConfigOf(norn: Norn): LoadedConfig {
  const text = norn.db.nornConfig.key.find(COMPANY_CONFIG_KEY)?.value;
  if (text === undefined) return { state: 'none' };
  if (read?.text === text) return read.loaded;
  read = { text, loaded: readCompanyConfig(text) };
  return read.loaded;
}

// ---------------------------------------------------------------------------------------------
// The signal
// ---------------------------------------------------------------------------------------------

const CODE_STAGES = ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'];

// The rows of a stage's newest finished run. The mirror reads a run as current when its status is done (the
// module marks a run stale as soon as its inputs change), as get_impact does.
function rowsOf(norn: Norn, pr: PullRequest, stage: string): ResultRow[] {
  let best: { id: bigint } | undefined;
  for (const r of norn.db.checkRun.prId.filter(pr.id)) if (r.stage === stage && r.status === 'done' && (!best || r.id > best.id)) best = r;
  return best ? [...norn.db.checkResult.prId.filter(pr.id)].filter(x => x.checkRunId === best!.id) : [];
}

/** The gate's facts about the ECR from the mirror's rows, built by the same function the module's gate uses. */
export function factsOf(norn: Norn, pr: PullRequest, config: CompanyConfig) {
  let reportLevel = 0;
  for (const s of norn.db.impactStatement.prId.filter(pr.id)) if (s.prRevision === pr.revision && s.level > reportLevel) reportLevel = s.level;
  return factsFromRows({ ecrId: pr.plmEcrNumber, costRows: rowsOf(norn, pr, 's2_cost'), slipRows: rowsOf(norn, pr, 's3_timeline'), reportLevel }, config);
}

/** Norn's own company class for the ECR's current revision: the class on its statement (see statementCompanyClass). */
export function statementClassOf(norn: Norn, pr: PullRequest, config: CompanyConfig): string | undefined {
  return statementCompanyClass(config, [...norn.db.impactStatement.prId.filter(pr.id)], pr.revision);
}

export function actorOf(config: CompanyConfig, claims: Pick<Claims, 'actor' | 'onBehalfOf'>) {
  return configActor(config, { kind: 'agent', name: claims.actor, onBehalfOf: claims.onBehalfOf })!;
}

/** Whether the ECR has a finished run of every code check. */
export function checksFinished(norn: Norn, pr: PullRequest): boolean {
  const done = new Set([...norn.db.checkRun.prId.filter(pr.id)].filter(r => r.status === 'done').map(r => r.stage));
  return CODE_STAGES.every(s => done.has(s));
}

export function signalOf(norn: Norn, pr: PullRequest, claims: Pick<Claims, 'kind' | 'role' | 'actor' | 'onBehalfOf'>): FastTrackSignal | { none: string } {
  const loaded = companyConfigOf(norn);
  if (loaded.state === 'none') return { none: 'No company configuration is stored in Fern, so there is no fast track to ask for.' };
  if (loaded.state === 'unreadable') return { none: `Fern cannot read the company configuration (${loaded.why}), so it takes no fast-track decision.` };
  return fastTrackSignal(loaded.config, {
    facts: factsOf(norn, pr, loaded.config),
    actor: actorOf(loaded.config, claims),
    status: pr.status,
    checksFinished: checksFinished(norn, pr),
    maxReportLevel: maxLevelFor(claims),
    statementCompany: statementClassOf(norn, pr, loaded.config),
  });
}

/** What get_impact carries. Exactly these three keys. */
export function fastTrackField(norn: Norn, pr: PullRequest, claims: Pick<Claims, 'kind' | 'role' | 'actor' | 'onBehalfOf'>) {
  const s = signalOf(norn, pr, claims);
  if ('none' in s) return { candidate: false, why: s.none, tests: [] as FastTrackSignal['tests'] };
  return { candidate: s.candidate, why: s.why, tests: s.tests };
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

export interface FastTrackArgs {
  answers: { testId: string; holds: boolean; evidence: string }[];
  companyClass?: string;
  regulatoryClass?: string;
  triggers?: string[];
}

/**
 * Checks the arguments against the configuration before anything is sent, and settles the classes the way the
 * module's gate will (resolveClasses): a company class left out is Norn's own, from the ECR's current statement;
 * one the agent sends may not be more permissive than that. The FAA class has no Norn source, so the agent
 * states it. Nothing is ever filled in with whichever class would let the fast track apply. Returns the request
 * as the module takes it, or the reason it is not sent.
 */
export function prepareRequest(
  config: CompanyConfig,
  args: FastTrackArgs,
  statementCompany: string | undefined,
): { ok: true; request: FastTrackRequest } | { ok: false; message: string } {
  const sentNothing = (why: string) => ({ ok: false as const, message: `Nothing was sent to Fern: ${why}` });
  const company = args.companyClass?.trim() ?? '';
  const regulatory = args.regulatoryClass?.trim() ?? '';
  const r = readFastTrackRequest(config, { answers: args.answers, companyClass: company, regulatoryClass: regulatory, triggers: args.triggers ?? [] });
  if (!r.ok) return sentNothing(`${r.why}. Answer the tests get_impact lists under fastTrack.tests, by id, once each, with evidence.`);
  if (!company && !statementCompany)
    return sentNothing(`Fern has no change class for this revision: the ECR's current statement proposes none. State the change class and the regulatory class, with evidence: post your Level 1 statement with the change class you can support and a one-line reason, then ask again with regulatoryClass.`);
  if (!regulatory)
    return sentNothing(`state the regulatory (FAA) class in regulatoryClass, with the evidence you rest it on in your answer. Fern holds no FAA class of its own for this ECR and will not assume one.`);
  const classes = resolveClasses(config, r.request.classes, statementCompany);
  if (!classes.ok) return sentNothing(`${classes.why}. Leave companyClass out to use the statement's, or post a statement that proposes the class you can support, with a one-line reason.`);
  return { ok: true, request: { ...r.request, classes: classes.classes, classSources: classes.sources } };
}

const SOURCE_TEXT: Record<ClassSource, string> = {
  statement: "Fern's own, from the ECR's current statement",
  agent_stricter: "yours, and no more permissive than Fern's",
  agent: 'yours; Fern holds no class of its own for this axis to check it against',
  none: 'none was given, so the stricter default applied',
};

/** The classes a decision rests on and where each came from, for the agent's answer. */
export function classReport(config: CompanyConfig, req: Pick<FastTrackRequest, 'classes' | 'classSources'> | undefined) {
  if (!req?.classSources) return {};
  const axis = (a: 'company' | 'regulatory') => {
    const given = req.classes[a];
    const id = given || config.changeClasses[a].whenUnsure;
    const label = config.changeClasses[a].values.find(v => v.id === id)?.label ?? id;
    return { id, label, source: req.classSources![a] };
  };
  const company = axis('company');
  const regulatory = axis('regulatory');
  return {
    classes: { company, regulatory },
    classesNote: `Decided on ${company.label} (${SOURCE_TEXT[company.source]}) and ${regulatory.label} (${SOURCE_TEXT[regulatory.source]}). Say so in your answer.`,
  };
}

/** The reducer's own refusals, in words an agent can act on. Undefined for a message that is not one of them. */
export function explainRefusal(message: string, ecr: string): string | undefined {
  const status = /ECR \d+ is (\w+); the fast track decides ECRs in review/.exec(message);
  if (status) return `${ecr} is ${status[1]}, not in review. The fast track decides ECRs in review only. Nothing was changed.`;
  if (/no company configuration is stored/.test(message)) return 'No company configuration is stored in Fern, so there is no fast track rule to apply. Nothing was changed.';
  const stages = /checks not finished on current inputs \(([^)]*)\)/.exec(message);
  if (stages) return `The checks on ${ecr} have not finished on its current inputs (${stages[1]}). Call get_impact to see their state, and ask again once they are current. Nothing was changed.`;
  return undefined;
}

const sameMoment = (a: { microsSinceUnixEpoch: bigint }, b: { microsSinceUnixEpoch: bigint }) => a.microsSinceUnixEpoch === b.microsSinceUnixEpoch;

/** The approval or recommendation the gate wrote in the same transaction as this log row. */
export function recordOf(norn: Norn, pr: PullRequest, row: ActionLog): { approval?: Approval; recommendation?: Recommendation } {
  const approval = [...norn.db.approval.prId.filter(pr.id)].filter(a => sameMoment(a.at, row.at)).sort((a, b) => Number(b.id - a.id))[0];
  const recommendation = [...norn.db.recommendation.prId.filter(pr.id)].filter(r => sameMoment(r.at, row.at)).sort((a, b) => Number(b.id - a.id))[0];
  return { approval, recommendation };
}

function parse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** What the gate decided, in words and fields an agent can act on. */
export function outcomeOf(
  config: CompanyConfig,
  ecr: string,
  row: Pick<ActionLog, 'id' | 'outcome'>,
  rec: { approval?: Approval; recommendation?: Recommendation },
  request: Pick<FastTrackRequest, 'classes' | 'classSources'> | undefined,
) {
  const roleLabel = (id: string) => config.roles.find(r => r.id === id)?.label ?? id;
  const classOf = (d?: GateDetail) => classReport(config, d?.request ?? request);
  const common = { ecr, actionLogEntry: Number(row.id) };
  if (rec.approval) {
    const d = parse<GateDetail>(rec.approval.decisionJson);
    const drawn = d?.sample ? (d.sample.sampled ? 'drawn' : 'not drawn') : 'none';
    return {
      decision: 'approved',
      ecrStatus: 'approved',
      summary: `${ecr} is approved on the fast track${d?.sample ? ` (it was not drawn for the blind second check: ${d.sample.value.toFixed(4)} is not under ${d.sample.rate})` : ''}.`,
      secondCheck: drawn,
      reasons: (d?.reasons ?? []).map(r => r.text),
      limits: (d?.limits ?? []).map(l => ({ limit: l.limit, held: l.held, text: l.text })),
      ...common,
      ...classOf(d),
    };
  }
  if (rec.recommendation) {
    const r = rec.recommendation;
    const d = parse<GateDetail>(r.decisionJson);
    const to = r.recipients.map(id => ({ role: id, label: roleLabel(id) }));
    const toText = to.length ? ` for ${to.map(x => x.label).join(', ')}` : '';
    const ordinary = r.action !== 'approve_fast_track_ecr';
    const reasons = r.reasons.map(x => x.text);
    if (r.awaitingSecondCheck)
      return {
        decision: 'held_for_second_check',
        ecrStatus: 'review',
        summary: `${ecr} is NOT approved yet. It was drawn for the blind second check, so Fern filed your approval as a recommendation${toText} and it waits for that check.`,
        secondCheck: 'drawn',
        recipients: to,
        reasons,
        ...common,
        ...classOf(d),
      };
    if (r.outcome === 'escalate')
      return { decision: 'escalated', ecrStatus: 'review', summary: `${ecr} is NOT approved. Fern handed it${toText} with your work.`, recipients: to, reasons, ...common, ...classOf(d) };
    return {
      decision: 'recommended',
      ecrStatus: 'review',
      route: ordinary ? 'ordinary' : 'fast_track',
      summary: ordinary
        ? `${ecr} cannot take the fast track, so it is NOT approved. Fern filed your approval as a recommendation on the ordinary route${d?.route ? ` (${d.route.bodyName})` : ''}${toText}.`
        : `${ecr} is NOT approved. It is past a fast-track limit, so Fern filed your approval as a recommendation${toText}.`,
      recipients: to,
      reasons,
      ...common,
      ...classOf(d),
    };
  }
  return { decision: 'unconfirmed', summary: `Fern accepted the call but the decision is not visible yet. Call get_ecr_history for ${ecr} before asking again.`, ...common, ...classReport(config, request) };
}
