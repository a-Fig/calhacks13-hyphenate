// The Level 1 dispatcher (#42): a long-running process that starts one agent session per ECR
// revision once the cost check has finished, and nothing else.
//
//   NORN_DB=norn-l1 npm run level1:dispatcher -w @norn/workers      (from norn/)
//
// Needs: SpacetimeDB, Norn's MCP server for the same database (`NORN_DB=norn-l1 npm run start -w
// @norn/mcp`, with NORN_MCP_PORT/NORN_MCP_URL if it is not on 3917), the signing key
// (NORN_MCP_SIGNING_KEY, in the environment or the main checkout's .env), and this machine's Claude
// login (the runner uses it; no API key). Run ONE dispatcher per database.
//
//   NORN_L1_MODEL         model for the session (default claude-haiku-5-5)
//   NORN_L1_MAX_TURNS     default 12            NORN_L1_TIMEOUT_MS   default 240000
//   NORN_L1_MAX_ATTEMPTS  default 2             NORN_L1_RETRY_DELAY_MS default 60000
//   NORN_L1_CONCURRENCY   default 1
//
// What starts a session, and what stops a second one, is in plan.ts. In short: the ECR's current
// change-request revision has a finished s2_cost run and no statement yet, and no session for that
// revision is running or has already used up its attempts. The sessions' events go to agent_event
// through record_agent_events, and that table is the record the next look reads, so a restart starts
// nothing twice.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DbConnection } from '@norn/bindings';
import { NORN_MCP_SERVER_NAME, loadSigningKey, nornMcpFor, nornMcpUrl, nornTools } from '../../../mcp/src/index.ts';
import { Runner, jsonlFileSink, teeSink, type JobSpec } from '../../../runner/src/index.ts';
import { connect, subscribe } from '../connect.ts';
import { provenanceOf, type Inputs } from '../impact.ts';
import { agentEventWriter } from './agent-events.ts';
import { actorFor, decide, jobIdFor, jobsFromEvents, spawnedByFor, supersededJobs, type EcrFacts, type EventRow } from './plan.ts';
import { deriveRecommendation, ruleInputOf } from './recommendation.ts';
import { jobPrompt, systemPromptFor, screenDetail, type Detail, type HeadlineKey } from './prompt.ts';
import { costCheckOf, routeFor, storedCompanyConfig } from './routing.ts';
import { settingsFromEnv, type Level1Settings } from './settings.ts';
import { SIBLING_STAGES, siblingCutoffUs, siblingOf } from './siblings.ts';
import { crSeqOfRun, failedChecksForRun, runRowsOf, siblingsForRun, toRunRow } from './source.ts';
import { ruleCheckOf, timelineSupplyFacts } from './timeline-supply.ts';

type Db = DbConnection['db'];
type Pr = NonNullable<ReturnType<Db['pullRequest']['id']['find']>>;

const ms = (t: { toDate(): Date }) => t.toDate().getTime();
const jsonOr = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

/** The tools a Level 1 session may use: read the ECR and its numbers, post one statement. Nothing else. */
export const LEVEL1_TOOLS = nornTools('get_ecr', 'get_impact', 'list_assumptions', 'post_impact_statement');

/** What `decide` needs to know about one ECR, from the client cache. */
export function factsOf(db: Db, pr: Pr, role: string): EcrFacts {
  const cur = [...db.ecrRevision.prId.filter(pr.id)].find(r => r.current);
  const results = [...db.checkResult.prId.filter(pr.id)];
  const runs = runRowsOf(db, pr.id);
  const s2Done = [...db.checkRun.prId.filter(pr.id)]
    .filter(r => r.stage === 's2_cost' && r.status === 'done')
    .sort((a, b) => Number(a.id - b.id))
    .map(r => {
      const own = runs.find(x => x.id === r.id) ?? toRunRow(r);
      return {
        id: Number(r.id),
        inputsRevision: typeof jsonOr<Inputs>(r.inputsJson, {}).revision === 'number' ? jsonOr<Inputs>(r.inputsJson, {}).revision! : null,
        mock: results.some(x => x.checkRunId === r.id && x.mock),
        // Whether the timeline and supply checks of this run's snapshot have settled (siblings.ts).
        siblings: { pending: SIBLING_STAGES.some(stage => siblingOf(runs, own, stage).state === 'pending'), cutoffUs: siblingCutoffUs(own) },
      };
    });
  const events: EventRow[] = [...db.agentEvent.prId.filter(pr.id)].filter(e => e.role === role).map(e => ({ jobId: e.jobId, eventType: e.eventType, tsMs: ms(e.ts), payloadJson: e.payloadJson }));
  return {
    number: pr.plmEcrNumber,
    status: pr.status,
    crSeq: cur?.seq ?? null,
    crCreatedMs: cur ? ms(cur.createdAt) : null,
    s2Done,
    // The revision of the run a statement was written from (the module records it), not of the moment it was posted.
    statements: [...db.impactStatement.prId.filter(pr.id)].map(s => ({ level: s.level, createdMs: ms(s.createdAt), crSeq: crSeqOfRun(db, s.checkRunId) })),
    jobs: jobsFromEvents(events),
  };
}

/** The job prompt's facts for one finished s2_cost run. */
export function jobFactsOf(db: Db, pr: Pr, revision: number, s2RunId: number) {
  const run = db.checkRun.id.find(BigInt(s2RunId))!;
  const inputs = jsonOr<Inputs>(run.inputsJson, {});
  const p = provenanceOf(inputs);
  const rows = [...db.checkResult.prId.filter(pr.id)].filter(r => r.checkRunId === run.id);
  const numbers: HeadlineKey[] = rows
    .filter(r => r.key.startsWith('unit_cost_delta:') || r.key === 'one_time_total' || r.key === 'net_total_year_one')
    .sort((a, b) => Number(a.id - b.id))
    .map(r => ({ key: r.key.replace(/[^A-Za-z0-9_]/g, '_'), resultKey: r.key, label: r.label }));
  const year = rows.find(r => r.key === 'net_total_year_one');
  const detail = jsonOr<Detail>(rows.find(r => r.key === 'detail')?.detailJson ?? '{}', {});
  const screened = screenDetail(detail, year ? year.p90 - year.p10 : 0);
  const routing = routeFor(
    { number: pr.plmEcrNumber, title: pr.title, revision },
    { numbers: Object.fromEntries(rows.filter(r => r.key !== 'detail').map(r => [r.key, { p10: r.p10, p50: r.p50, p90: r.p90, unit: r.unit }])), costCheck: costCheckOf(rows) },
    storedCompanyConfig(db)
  );
  // The same rule and the same rows the publisher applies, so the agent is told what the PLM will say.
  // The timeline and supply checks of the same snapshot the publisher will read (siblings.ts). The agent posts none of
  // their numbers (the module would check them against the newest finished runs, which a later re-run can change
  // under it); the publisher shows them from these runs. The agent gets sentences built from the same rows.
  const siblings = siblingsForRun(db, pr.id, run.id);
  const recommendation = deriveRecommendation(ruleInputOf(rows, failedChecksForRun(db, pr.id, run.id), siblings ? { timeline: ruleCheckOf(siblings.timeline), supply: ruleCheckOf(siblings.supply) } : {}));
  return {
    ecr: pr.plmEcrNumber,
    title: pr.title,
    revision,
    s2RunId,
    baseline: p.baseline,
    changeRequest: p.changeRequest,
    numbers,
    screened,
    routing,
    recommendation,
    ...(siblings ? { timelineSupply: timelineSupplyFacts(siblings.timeline, siblings.supply) } : {}),
  };
}

export function jobSpecFor(opts: { jobId: string; ecr: string; s2RunId: number; prompt: string; settings: Level1Settings; signingKey?: string; mcpUrl?: string }): JobSpec {
  const identity = { actor: actorFor(opts.jobId), onBehalfOf: null, spawnedBy: spawnedByFor(opts.s2RunId) };
  return {
    id: opts.jobId,
    role: opts.settings.role,
    model: opts.settings.model,
    maxTurns: opts.settings.maxTurns,
    timeoutMs: opts.settings.timeoutMs,
    systemPrompt: systemPromptFor(LEVEL1_TOOLS),
    prompt: opts.prompt,
    identity,
    mcpServers: { [NORN_MCP_SERVER_NAME]: nornMcpFor(identity, { jobId: opts.jobId, role: opts.settings.role, ecrs: [opts.ecr], ttlSeconds: opts.settings.tokenTtlSeconds, signingKey: opts.signingKey, url: opts.mcpUrl }) },
    // TODO(fast track): when the MCP tool `request_fast_track_approval` lands on main, add it here (nornTools(...,
    // 'request_fast_track_approval')) so the agent can call it when get_impact's fastTrack.candidate is true. The
    // system prompt already says when to call it. Until it is allowed, a candidate ECR's session cannot call it.
    allowedTools: LEVEL1_TOOLS,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const name = process.env.WORKER_NAME ?? 'level1-dispatcher';
  const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 23)} [${name}] ${m}`);
  const settings = settingsFromEnv();
  const signingKey = loadSigningKey();
  if (!signingKey) throw new Error('NORN_MCP_SIGNING_KEY is not set (environment or the main checkout\'s .env): run `npm run key:ensure -w @norn/mcp`');

  const client = await connect({ kind: 'agent', name, origin: 'norn', spawnedBy: 'Norn' });
  const { conn, R } = client;
  await subscribe(conn, [
    'SELECT * FROM pull_request',
    'SELECT * FROM ecr_revision',
    'SELECT * FROM check_run',
    'SELECT * FROM check_result',
    'SELECT * FROM impact_statement',
    'SELECT * FROM norn_config',
  ]);
  // Only the events that mark a session's life, for Level 1 sessions: not every tool call of every job.
  const markers = ['job_queued', 'job_started', 'job_finished'].map(t => `SELECT * FROM agent_event WHERE role = '${settings.role}' AND event_type = '${t}'`);
  await subscribe(conn, markers);

  const logDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'level1');
  mkdirSync(logDir, { recursive: true });
  const jsonl = jsonlFileSink(join(logDir, `${process.env.NORN_DB ?? 'norn'}-events.jsonl`));
  const runIdOf = new Map<string, bigint>();
  const writer = agentEventWriter(R, id => runIdOf.get(id) ?? 0n, log);
  const runner = new Runner({ sink: teeSink(jsonl, writer.sink), config: { concurrency: settings.concurrency } });

  const running = new Set<string>();
  const lingering = new Map<string, NodeJS.Timeout>();
  // A session that cannot even start (no signing key, a bad spec) is not retried forever.
  const startFailures = new Map<string, number>();
  let sweeping = false;
  let again = false;

  async function startJob(pr: Pr, revision: number, attempt: number, s2RunId: number) {
    const jobId = jobIdFor(pr.plmEcrNumber, revision, attempt);
    running.add(jobId);
    runIdOf.set(jobId, BigInt(s2RunId));
    try {
      const facts = jobFactsOf(conn.db, pr, revision, s2RunId);
      const spec = jobSpecFor({ jobId, ecr: pr.plmEcrNumber, s2RunId, prompt: jobPrompt(facts), settings, signingKey });
      log(`starting ${jobId} (${settings.model}) for ${pr.plmEcrNumber} revision ${revision}, attempt ${attempt}, on check run ${s2RunId}`);
      const r = await runner.run(spec);
      const stored = await writer.drain();
      const posted = [...conn.db.impactStatement.prId.filter(pr.id)].length;
      log(`${jobId} ${r.status} in ${(r.durationMs / 1000).toFixed(1)} s, ${r.numTurns} turn(s)${r.error ? `, ${r.error.kind}: ${r.error.message}` : ''}; events ${stored ? 'stored' : 'NOT all stored'}; ${posted} statement(s) on the ECR`);
    } catch (e) {
      startFailures.set(`${pr.plmEcrNumber}:${revision}`, (startFailures.get(`${pr.plmEcrNumber}:${revision}`) ?? 0) + 1);
      log(`${jobId} could not start: ${(e as Error).message}`);
    } finally {
      // Keep counting it as running a little longer, so the finished event and the statement reach this cache before the next look.
      lingering.set(jobId, setTimeout(() => (running.delete(jobId), lingering.delete(jobId), schedule()), 15_000));
      schedule();
    }
  }

  async function sweep() {
    if (sweeping) {
      again = true;
      return;
    }
    sweeping = true;
    try {
      do {
        again = false;
        for (const pr of conn.db.pullRequest.iter()) {
          const facts = factsOf(conn.db, pr, settings.role);
          // A session for an earlier revision is out of date the moment the next one arrives: stop it.
          for (const id of supersededJobs(facts, running)) if (runner.cancel(id)) log(`${id} stopped: ${pr.plmEcrNumber} is now on change-request revision ${facts.crSeq}`);
          const d = decide(facts, { nowMs: Date.now(), maxAttempts: settings.maxAttempts, retryDelayMs: settings.retryDelayMs, orphanMs: settings.orphanMs, running });
          if (d.action !== 'dispatch') continue;
          if ((startFailures.get(`${pr.plmEcrNumber}:${d.revision}`) ?? 0) >= 3) continue; // gave up until a restart
          void startJob(pr, d.revision, d.attempt, d.s2RunId);
        }
      } while (again);
    } catch (e) {
      log(`look failed: ${(e as Error).message}`);
    } finally {
      sweeping = false;
    }
  }
  let timer: NodeJS.Timeout | undefined;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void sweep(), 250);
  }

  try {
    await fetch(nornMcpUrl(), { method: 'GET', signal: AbortSignal.timeout(3000) });
  } catch {
    log(`WARNING: Norn's MCP server is not answering at ${nornMcpUrl()}; sessions will start but cannot use their tools. Start it: NORN_DB=${process.env.NORN_DB ?? 'norn'} npm run start -w @norn/mcp`);
  }
  log(`watching '${process.env.NORN_DB ?? 'norn'}' for ECR revisions with finished cost checks; model ${settings.model}, up to ${settings.maxTurns} turns and ${settings.timeoutMs / 1000} s, ${settings.maxAttempts} attempt(s) per revision`);
  for (const t of [conn.db.checkRun, conn.db.impactStatement, conn.db.ecrRevision, conn.db.agentEvent] as any[]) {
    t.onInsert(schedule);
    t.onUpdate?.(schedule);
  }
  setInterval(schedule, settings.pollMs);
  schedule();

  const shutdown = async () => {
    log('shutting down; sessions in progress are stopped by their own timeout, and their events so far are stored');
    await writer.drain(5000);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
