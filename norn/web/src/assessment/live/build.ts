// Live rows in, the screens' view-model out. Pure: it reads a snapshot of the tables the web client
// subscribes to and builds an EcrSummary or an ImpactAssessment. Everything the checks produce goes
// through fromChecks() (./adapter.ts), unchanged. The rest is read from the module's own tables: the
// change request (ecr_revision), runs, impact statements, comments, the action log and the agent
// event stream. What the module does not hold yet is a labelled mock: the reviewer seats (named from the
// change request's routing, with no per-seat review records) and the stand-in S3/S4 stages. The deciding
// body's step comes from the approval rows alone.
import type { CheckResultRow } from '../../../../checks/src/rows.ts';
import { fromChecks, monthLabel, type ChecksView } from '../adapter.ts';
import type {
  ActivityEvent, ActorKind, AgentRun, ChangeClass, Check, CutIn, EcrSummary, Evidence, ImpactAssessment,
  MockSection, Origin, Revision, RouteStep, StatementView, Supply, Trace,
} from '../types.ts';
import { changedItems } from './changes.ts';
import { dateTime, staleNote } from '../../ui/fmt.ts';
import { personOf, SEATS } from './directory.ts';
import { buildGate, plainOf, type ApprovalView, type GateRows, type GateView } from './gate.ts';
import { readMockSupply, readMockTimeline, readSupply, readTimeline, type StageRow, type SupplyRead, type TimelineRead } from './stages.ts';
import { plainReason } from './words.ts';

// ---------------------------------------------------------------- the rows, as much of them as we read

interface Ts { microsSinceUnixEpoch: bigint; toDate(): Date }
interface Id { toHexString(): string }
export interface PrRow { id: bigint; plmEcrNumber: string; title: string; description: string; status: string; revision: number; createdBy: Id; createdAt: Ts; updatedAt: Ts }
export interface RevisionRow { id: bigint; prId: bigint; seq: number; changeRequestJson: string; source: string; current: boolean; createdBy: Id; createdAt: Ts }
export interface RunRow { id: bigint; prId: bigint; stage: string; status: string; note: string; createdAt: Ts; finishedAt: Ts | undefined }
export interface ResultRow { id: bigint; checkRunId: bigint; prId: bigint; key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string; mock: boolean; createdAt?: Ts }
export interface StatementRow {
  id: bigint; prId: bigint; level: number; prRevision: number; changeClass: string; route: string; headline: string;
  numbers: { key: string; label: string; unit: string; p10: number; p50: number; p90: number; evidence: string; resultKey: string }[];
  drivers: { text: string; evidence: string }[]; assumptions: { key: string; source: string; note: string }[]; claims: { text: string; evidence: string }[];
  author: Id; createdAt: Ts;
}
export interface CommentRow { id: bigint; prId: bigint; author: Id; anchor: string; body: string; createdAt: Ts }
export interface ActionRow { id: bigint; at: Ts; prId: bigint; reducer: string; outcome: string; entity: string; summary: string; detailJson: string; actorKind: string; actorName: string; actorOrigin: string; onBehalfOf: string | undefined; spawnedBy: string; policy: string }
export interface AgentEventRow { id: bigint; jobId: string; seq: number; prId: bigint; ts: Ts; role: string; actor: string; onBehalfOf: string | undefined; eventType: string; payloadJson: string }
export interface PrincipalRow { identity: Id; name: string; kind: string; origin: string; onBehalfOf: string | undefined }

export interface Snapshot extends GateRows {
  prs: PrRow[]; revisions: RevisionRow[]; runs: RunRow[]; results: ResultRow[]; statements: StatementRow[];
  comments: CommentRow[]; actions: ActionRow[]; events: AgentEventRow[]; principals: PrincipalRow[];
}

const iso = (t: Ts) => t.toDate().toISOString();
const parse = (s: string): any => {
  try { return JSON.parse(s); } catch { return {}; }
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const STATUS: Record<string, EcrSummary['status']> = { draft: 'Submitted', review: 'In review', approved: 'Approved', merged: 'ECO released', closed: 'Rejected' };

function newest<T extends { id: bigint }>(rows: T[], pred: (r: T) => boolean): T | undefined {
  let best: T | undefined;
  for (const r of rows) if (pred(r) && (!best || r.id > best.id)) best = r;
  return best;
}
const live = (r: RunRow) => r.status !== 'stale' && r.status !== 'cancelled';
const toRow = (r: ResultRow): CheckResultRow => ({ key: r.key, label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, detailJson: r.detailJson });

function currentCr(s: Snapshot, pr: PrRow): any {
  const row = s.revisions.find(r => r.prId === pr.id && r.current) ?? newest(s.revisions.filter(r => r.prId === pr.id), () => true);
  return row ? parse(row.changeRequestJson) : {};
}

// ---------------------------------------------------------------- the cost run behind a page

const COST_ROWS = ['detail', 'net_total_year_one', 'one_time_total', 'recurring_year_one'];

/**
 * The cost page of one run's rows, or why there is none. A cost run that returns only a per-unit estimate
 * (the worker's fallback for an ECR without a structured revision) has no `detail` row, and fromChecks()
 * would throw; the page then shows "not available" instead.
 */
export function costViewOf(rows: CheckResultRow[]): { view: ChecksView; why?: undefined } | { view?: undefined; why: string } {
  const keys = new Set(rows.map(r => r.key));
  if (COST_ROWS.some(k => !keys.has(k))) {
    return { why: 'Cost not available for this revision: the cost check returned a per-unit estimate only, with no itemised cost page.' };
  }
  try {
    return { view: fromChecks(rows) };
  } catch (e) {
    return { why: `Cost not available for this revision: Norn could not read the cost check's output (${e instanceof Error ? e.message : String(e)}).` };
  }
}

interface CostPick {
  run?: RunRow;
  /** The numbers are from a run an input change has replaced. */
  stale?: 'rechecking' | 'failed';
  view?: ChecksView;
  why?: string;
}

/**
 * The cost run a page shows: the newest finished one. While a replacement waits for a worker, the page keeps
 * the last numbers (the newest stale run that has results) and says so; when the replacement failed or was
 * blocked, it keeps them and says that instead.
 */
function costFor(s: Snapshot, runs: RunRow[]): CostPick {
  const hasResults = (r: RunRow) => s.results.some(x => x.checkRunId === r.id);
  const done = newest(runs, r => r.stage === 's2_cost' && r.status === 'done');
  const prev = done ? undefined : newest(runs, r => r.stage === 's2_cost' && r.status === 'stale' && hasResults(r));
  const run = done ?? prev;
  if (!run) return {};
  let stale: CostPick['stale'];
  if (prev) {
    const next = newest(runs, r => r.stage === 's2_cost' && live(r));
    stale = next && (next.status === 'queued' || next.status === 'running') ? 'rechecking' : 'failed';
  }
  return { run, stale, ...costViewOf(s.results.filter(r => r.checkRunId === run.id).map(toRow)) };
}

// ---------------------------------------------------------------- the S3/S4 runs behind a page

interface StagePick {
  /** The run whose rows the page shows: the newest finished one, else the newest replaced one that has rows. */
  run?: RunRow;
  rows: ResultRow[];
  /** The rows are from a run an input change has replaced. */
  stale?: 'rechecking' | 'failed';
  /** The newest run that still stands, finished or not: it says what the check is doing now. */
  latest?: RunRow;
}

/** Same rule as the cost page (costFor): keep the last numbers while a replacement waits, and say so. */
function stageFor(s: Snapshot, runs: RunRow[], stage: string): StagePick {
  const hasResults = (r: RunRow) => s.results.some(x => x.checkRunId === r.id);
  const done = newest(runs, r => r.stage === stage && r.status === 'done');
  const prev = done ? undefined : newest(runs, r => r.stage === stage && r.status === 'stale' && hasResults(r));
  const run = done ?? prev;
  const latest = newest(runs, r => r.stage === stage && live(r)) ?? newest(runs, r => r.stage === stage);
  let stale: StagePick['stale'];
  if (prev) stale = latest && latest.id !== prev.id && (latest.status === 'queued' || latest.status === 'running') ? 'rechecking' : 'failed';
  return { run, latest, stale, rows: run ? s.results.filter(r => r.checkRunId === run.id) : [] };
}

const toStage = (r: ResultRow): StageRow => ({ key: r.key, label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, detailJson: r.detailJson, mock: r.mock });

/** Whether a finished real S3/S4 run asks for a look: a warning flag, or a date that is only a lower bound. */
function stageNeedsLook(rows: ResultRow[]): boolean {
  const detail = rows.find(r => r.key === 'detail' && !r.mock);
  if (!detail) return false;
  const d = parse(detail.detailJson);
  return d.readiness === 'materials_only' || (Array.isArray(d.flags) ? d.flags : []).some((f: any) => f?.severity === 'warn');
}

/** A check with no usable rows: what it is doing, in words. */
function waitingWords(name: string, r: RunRow | undefined): string {
  if (!r) return 'Not assessed yet';
  const note = r.note ? `: ${r.note.replace(/\s+/g, ' ').slice(0, 160)}` : '';
  if (r.status === 'queued') return 'Waiting for a worker';
  if (r.status === 'running') return 'Running';
  if (r.status === 'failed') return `The ${name.toLowerCase()} check failed${note}. There is no result to show`;
  if (r.status === 'blocked') return `The ${name.toLowerCase()} check is blocked${note}`;
  if (r.status === 'done') return `The ${name.toLowerCase()} check finished with no result rows`;
  return 'Not assessed yet';
}

/**
 * A stage's check line. A finished run with usable rows is as good as its flags; a run that finished with
 * nothing readable needs attention rather than passing; a stage with no rows says what it is doing instead.
 */
function stageCheck(id: 'timeline' | 'supply', name: string, pick: StagePick, read: { summary: string; attention: boolean } | undefined, why: string | undefined, mock: boolean): Check {
  const by = id === 'timeline' ? 'Norn timeline check' : 'Norn supply check';
  const staleLine = pick.stale ? ` ${staleNote(pick.stale)}` : '';
  if (read) {
    const newer = pick.latest && pick.run && pick.latest.id !== pick.run.id ? pick.latest : undefined;
    const state = newer ? runState(newer) : read.attention ? 'attention' : 'passed';
    return { id, name, state, mock: mock || undefined, summary: `${read.summary}${staleLine}`, by: mock ? undefined : by };
  }
  if (pick.run) {
    const reason = pick.rows.length ? why ?? `The ${name.toLowerCase()} check's rows could not be read` : waitingWords(name, pick.run);
    return { id, name, state: 'attention', summary: `${reason}${staleLine}`, by };
  }
  return { id, name, state: runState(pick.latest), summary: waitingWords(name, pick.latest), by: pick.latest ? by : undefined };
}

// ---------------------------------------------------------------- the approval route

const when = (at: string) => dateTime(at);

/**
 * The route's steps from what is recorded. The reviewer seats (cost engineering, quality, ...) have no
 * per-seat review records in the module, so each stays pending with a note saying so. The deciding body's
 * step comes from the approval rows: the standing approval (who, when, on which revision), a withdrawn one,
 * or nothing. A fast track is one approval by one actor, so no board step and no chair are added.
 */
export function routeSteps(routedTo: string[], gate: GateView, pr: PrRow): RouteStep[] {
  const steps: RouteStep[] = routedTo.filter(r => SEATS[r]).map(r => ({
    role: SEATS[r].role, person: SEATS[r].person, state: 'pending' as const, note: 'No review is recorded for this seat',
  }));
  const standing: ApprovalView | undefined = gate.approvals.find(a => a.state !== 'withdrawn');
  const revWords = (n: number) => `revision ${n}`;
  if (standing) {
    const onBehalf = standing.onBehalfOf ? ` for ${standing.onBehalfOf}` : '';
    const notes: string[] = [];
    if (standing.fastTrack) notes.push('Fast track: no board decision is recorded');
    if (standing.state === 'pending_recheck') notes.push(`Approved on ${revWords(standing.revision)}; the approval is waiting for a re-check`);
    else if (standing.revision !== pr.revision) notes.push(`Approved on ${revWords(standing.revision)}; the ECR is now at ${revWords(pr.revision)}`);
    steps.push({
      role: standing.fastTrack ? 'Fast track' : /^(ccb|change control board)$/i.test(standing.role) ? 'CCB' : standing.role,
      person: standing.who,
      by: onBehalf ? `${standing.who}${onBehalf}` : undefined,
      state: standing.state === 'pending_recheck' ? 'pending' : 'approved',
      when: when(standing.at),
      revision: revWords(standing.revision),
      ...(notes.length ? { note: notes.join('. ') } : {}),
    });
    return steps;
  }
  const withdrawn = gate.approvals[0];
  steps.push({
    role: 'CCB', state: 'waiting',
    note: withdrawn
      ? `The approval by ${withdrawn.who} on ${revWords(withdrawn.revision)} was withdrawn${withdrawn.endedAt ? ` ${when(withdrawn.endedAt)}` : ''}${withdrawn.endedReason ? `: ${withdrawn.endedReason}` : ''}`
      : pr.status === 'approved' || pr.status === 'merged' ? 'The ECR is marked approved, but no approval is recorded' : 'No decision is recorded',
  });
  return steps;
}

/** The reducers' status words, in the business's words. */
const STATUS_WORD: Record<string, string> = { draft: 'submitted', review: 'in review', approved: 'approved', merged: 'released', closed: 'rejected' };
const STATUS_RE = Object.keys(STATUS_WORD).join('|');

/** A reducer's log summary, with status changes ("approved -> merged") in the business's words. */
export function plainSummary(text: string): string {
  return plainReason(text
    .replace(new RegExp(`\\b(${STATUS_RE}) -> (${STATUS_RE})\\b`, 'g'), (_m, from: string, to: string) => `moved from ${STATUS_WORD[from]} to ${STATUS_WORD[to]}`)
    .replace(/\bmerged\b/g, 'released')
    .replace(/ -> /g, ' to '));
}

// The module's action names, in the words a person at Bowman would use.
const ACTION_WORD: Record<string, string> = {
  ingest_ecr: 'take in the ECR', complete_check: 'record a check result', record_assumption: 'record an assumption',
  set_pr_status: 'change the ECR status', post_impact_statement: 'post an impact statement', set_config: 'change the company config',
  edit_pr_text: 'edit the ECR text',
};

const principalName = (s: Snapshot, id: Id) => s.principals.find(p => p.identity.toHexString() === id.toHexString())?.name ?? id.toHexString().slice(0, 8);

// ---------------------------------------------------------------- the list

export function buildSummary(s: Snapshot, pr: PrRow): EcrSummary {
  const cr = currentCr(s, pr);
  const runs = s.runs.filter(r => r.prId === pr.id);
  const pick = costFor(s, runs);
  const s2 = pick.run;
  const net = s2 && pick.view ? s.results.find(r => r.checkRunId === s2.id && r.key === 'net_total_year_one') : undefined;
  const detail = s2 && pick.view ? s.results.find(r => r.checkRunId === s2.id && r.key === 'detail') : undefined;
  const d = detail ? parse(detail.detailJson) : undefined;
  const need = (d?.flags ?? []).filter((f: any) => f.kind === 'needs_estimate').length;
  const stmt = newest(s.statements.filter(x => x.prId === pr.id), () => true);
  const latest = newest(s.actions.filter(a => a.prId === pr.id && a.reducer !== 'report_progress' && a.reducer !== 'heartbeat_check'), () => true);
  const active = runs.filter(live);
  // A real S3/S4 run that failed, finished with nothing readable, or flagged a warning also asks for a look.
  const stageLook = ['s3_timeline', 's4_supply'].some(stage => {
    const p = stageFor(s, runs, stage);
    if (p.run) return !p.rows.some(r => r.mock) && (p.stale === 'failed' || !p.rows.some(r => r.key === 'detail') || stageNeedsLook(p.rows));
    return p.latest?.status === 'failed';
  });
  const checks: EcrSummary['checks'] = active.some(r => r.status === 'queued' || r.status === 'running') ? 'running' : pick.why || pick.stale === 'failed' || need > 0 || d?.bomDelta?.ok === false || stageLook ? 'attention' : s2 ? 'passed' : undefined;
  const nComments = s.comments.filter(c => c.prId === pr.id).length;
  const companyClass = /Class\s+(I{1,2})\b/.exec(stmt?.changeClass ?? '')?.[1] ?? cr.companyClass ?? 'I';
  const faa = /\b(major|minor)\b/i.exec(stmt?.changeClass ?? '')?.[1]?.toLowerCase() ?? cr.faaClass ?? 'minor';
  const mainItem = cr.itemChanges?.[0];
  return {
    id: pr.plmEcrNumber,
    title: pr.title,
    program: cr.program === 'meridian' ? 'Meridian' : 'Vesper',
    partNumber: mainItem?.item,
    companyClass: companyClass as 'I' | 'II',
    faa: faa as 'major' | 'minor',
    priority: cr.priority === 'urgent' ? 'Urgent' : cr.priority === 'emergency' ? 'Emergency' : 'Routine',
    status: STATUS[pr.status] ?? 'Submitted',
    cost: net && d ? { p10: net.p10, p50: net.p50, p90: net.p90, point: parse(net.detailJson).point, from: d.window?.from } : undefined,
    level: stmt ? (stmt.level as 1 | 2 | 3) : undefined,
    lastActivity: latest ? iso(latest.at) : iso(pr.updatedAt),
    lastActivityBy: latest ? plainSummary(latest.summary).slice(0, 60) : 'Opened',
    originator: personOf(cr.originator),
    filedOn: cr.filedOn ?? iso(pr.createdAt).slice(0, 10),
    flag: need > 0 ? `${need} cost line${need > 1 ? 's need' : ' needs'} an estimate` : d?.bomDelta?.ok === false ? 'Conflicts with the baseline' : undefined,
    staleCost: pick.stale,
    costNote: pick.why,
    comments: nComments,
    checks,
    change: mainItem ? `${mainItem.item}${mainItem.fromRev ? ` from Rev ${mainItem.fromRev} to Rev ${mainItem.toRev}` : ''}` : undefined,
    hasAssessment: !!pick.view,
  };
}

// ---------------------------------------------------------------- one ECR

const CHECK_STAGES: Record<string, { id: Check['id']; name: string }> = {
  s1_bom_delta: { id: 'bom', name: 'BOM delta' },
  s2_cost: { id: 'cost', name: 'Cost' },
  s3_timeline: { id: 'timeline', name: 'Time to the line' },
  s4_supply: { id: 'supply', name: 'Supply risk' },
};

function runState(r: RunRow | undefined): Check['state'] {
  if (!r) return 'pending';
  if (r.status === 'done') return 'passed';
  if (r.status === 'running') return 'running';
  if (r.status === 'queued') return 'queued';
  if (r.status === 'failed') return 'attention';
  return 'pending'; // blocked
}

const traceFor = (id: string, title: string, evidence: Evidence, summary: string, value: { text: string; range?: string } | undefined, by: string, at: string, check: string): Trace => ({
  id, title, evidence, summary, value, inputs: [], assumptions: [], producedBy: { check, actor: by, at },
});

/** Where a statement's check-result numbers can be opened: the run the page shows, the run it was written on, or nowhere. */
type StatementRun = { kind: 'same' } | { kind: 'earlier'; view: ChecksView; finishedAt: string } | { kind: 'gone' };

/** The cost run a statement was written on: the newest one that had finished when it was posted. */
function runForStatement(s: Snapshot, runs: RunRow[], st: StatementRow, shown: RunRow): StatementRun {
  const posted = st.createdAt.microsSinceUnixEpoch;
  // When a run's results were written. Not finishedAt: the module overwrites that when it marks the run stale.
  const doneAt = (r: RunRow): bigint | undefined => {
    const own = s.results.filter(x => x.checkRunId === r.id);
    if (!own.length) return undefined;
    const at = own.map(x => x.createdAt?.microsSinceUnixEpoch).filter((x): x is bigint => x !== undefined);
    return at.length ? at.reduce((m, x) => (x > m ? x : m)) : (r.finishedAt ?? r.createdAt).microsSinceUnixEpoch;
  };
  const candidates = runs.filter(r => r.stage === 's2_cost' && (r.status === 'done' || r.status === 'stale'))
    .map(r => ({ r, at: doneAt(r) })).filter((x): x is { r: RunRow; at: bigint } => x.at !== undefined && x.at <= posted);
  const run = candidates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]?.r;
  if (!run) return { kind: 'gone' };
  if (run.id === shown.id) return { kind: 'same' };
  const c = costViewOf(s.results.filter(r => r.checkRunId === run.id).map(toRow));
  return c.view ? { kind: 'earlier', view: c.view, finishedAt: iso(run.finishedAt ?? run.createdAt) } : { kind: 'gone' };
}

function statementView(s: Snapshot, st: StatementRow, pr: PrRow, src: StatementRun, traces: Record<string, Trace>): StatementView {
  const author = principalName(s, st.author);
  const log = s.actions.find(a => a.entity === `impact_statement:${st.id}`);
  const authorKind: ActorKind = log?.actorOrigin === 'external' ? 'person_agent' : 'norn';
  const at = iso(st.createdAt);
  const check = `Impact statement, Level ${st.level}`;
  const synth = (suffix: string, title: string, evidence: Evidence, summary: string, value?: { text: string; range?: string }) => {
    const id = `stmt:${st.id}:${suffix}`;
    traces[id] = traceFor(id, title, evidence, summary, value, author, at, check);
    return id;
  };
  const e = (x: string): Evidence => (['fact', 'assumption', 'computation', 'judgment'].includes(x) ? (x as Evidence) : 'judgment');
  // A number from the check results opens the trace of the run the statement was written on, not the newest run's.
  const resultTrace = (key: string, value: { text: string; range?: string }): string | undefined => {
    if (src.kind === 'same') return traces[key] ? key : undefined;
    if (src.kind === 'gone') return undefined;
    const t = src.view.traces[key];
    if (!t) return undefined;
    const id = `stmt:${st.id}:run:${key}`;
    traces[id] = { ...t, id, value, summary: `From the cost run before the ECR changed (finished ${dateTime(src.finishedAt)}), not the one on the Impact tab. ${t.summary}`, inputs: t.inputs.map(i => ({ ...i, traceId: undefined })) };
    return id;
  };
  const fmt = (n: StatementRow['numbers'][number], x: number) =>
    n.unit === 'USD' ? (Math.abs(x) >= 1000 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toFixed(2)}`) : `${x}${n.unit ? ` ${n.unit}` : ''}`;
  return {
    id: String(st.id), level: st.level as 1 | 2 | 3, at, author, authorKind, headline: st.headline, changeClass: st.changeClass, route: st.route,
    numbers: st.numbers.map((n, i) => ({
      key: n.key, label: n.label, unit: n.unit, p10: n.p10, p50: n.p50, p90: n.p90, evidence: e(n.evidence),
      traceId: n.resultKey && src.kind !== 'same'
        ? resultTrace(n.resultKey, { text: fmt(n, n.p50), range: n.p10 !== n.p90 ? `${fmt(n, n.p10)} – ${fmt(n, n.p90)}` : undefined })
        : n.resultKey && traces[n.resultKey]
          ? n.resultKey
          : synth(`n${i}`, n.label, e(n.evidence), `Stated in Norn's Level ${st.level} impact statement. It is not a check result.`, { text: fmt(n, n.p50), range: n.p10 !== n.p90 ? `${fmt(n, n.p10)} – ${fmt(n, n.p90)}` : undefined }),
    })),
    drivers: st.drivers.map((d, i) => ({ text: d.text, evidence: e(d.evidence), traceId: synth(`d${i}`, 'A driver', e(d.evidence), d.text) })),
    claims: st.claims.map((c, i) => ({ text: c.text, evidence: e(c.evidence), traceId: synth(`c${i}`, 'A claim', e(c.evidence), c.text) })),
    assumptions: st.assumptions.map(a => ({
      key: a.key,
      label: traces[`in:${a.key}`]?.title ?? a.key,
      source: a.source as Origin,
      note: a.note,
      traceId: traces[`in:${a.key}`] ? `in:${a.key}` : undefined,
    })),
    outdated: st.prRevision < pr.revision,
    numbersNote: !st.numbers.some(n => n.resultKey) ? undefined
      : src.kind === 'earlier' ? 'These figures come from an earlier cost run than the one on the Impact tab. Opening one shows that earlier run.'
      : src.kind === 'gone' ? 'These figures come from a cost run that is no longer stored, so they cannot be opened to see where they came from.'
      : undefined,
  };
}

function agentRuns(s: Snapshot, pr: PrRow): ActivityEvent[] {
  const byJob = new Map<string, AgentEventRow[]>();
  for (const ev of s.events.filter(x => x.prId === pr.id)) byJob.set(ev.jobId, [...(byJob.get(ev.jobId) ?? []), ev]);
  const out: ActivityEvent[] = [];
  for (const [jobId, evs] of byJob) {
    evs.sort((a, b) => a.seq - b.seq);
    const lines: AgentRun['lines'] = [];
    let state: AgentRun['state'] = 'running';
    for (const ev of evs) {
      const p = parse(ev.payloadJson);
      const at = iso(ev.ts);
      switch (ev.eventType) {
        case 'job_started': lines.push({ at, kind: 'start', text: `Started${p.model ? ` on ${p.model}` : ''}` }); break;
        case 'assistant_text': lines.push({ at, kind: 'text', text: String(p.text ?? '').slice(0, 280) }); break;
        case 'tool_call': lines.push({ at, kind: 'tool', text: `${p.tool}${p.input ? ` ${JSON.stringify(p.input).slice(0, 90)}` : ''}` }); break;
        case 'tool_result': lines.push({ at, kind: 'result', text: String(p.content ?? '').split('\n')[0].slice(0, 160) || 'done', error: !!p.isError }); break;
        case 'permission_denied': lines.push({ at, kind: 'result', text: `${p.tool} was not allowed: ${p.reason ?? 'by the role'}`, error: true }); break;
        case 'job_finished':
          state = p.status === 'succeeded' || p.status === 'completed' ? 'done' : 'failed';
          lines.push({ at, kind: 'end', text: `Finished: ${p.status}`, error: state === 'failed' });
          break;
        default: break;
      }
    }
    const first = evs[0];
    const role = first.role || 'agent';
    const actor = `Norn ${role} agent`;
    out.push({
      id: `run:${jobId}`, at: iso(first.ts), actor, actorKind: 'norn', onBehalfOf: first.onBehalfOf, kind: 'research',
      text: state === 'running' ? 'is working' : state === 'done' ? 'finished its work' : 'stopped with an error',
      state: state === 'running' ? 'running' : 'done',
      run: { id: jobId, title: `${actor}, ${pr.plmEcrNumber}`, actor, onBehalfOf: first.onBehalfOf, startedAt: iso(first.ts), state, lines },
    });
  }
  return out;
}

export function buildAssessment(s: Snapshot, pr: PrRow): ImpactAssessment | undefined {
  const runs = s.runs.filter(r => r.prId === pr.id);
  // While a new run waits for a worker, the page keeps the last numbers (the newest stale run that has
  // results) and shows its checks as queued or running; with no results, or no readable cost page, there is
  // no page (the list row says why).
  const pick = costFor(s, runs);
  const s2 = pick.run;
  const v = pick.view;
  if (!s2 || !v) return undefined;
  const cr = currentCr(s, pr);
  const traces: Record<string, Trace> = { ...v.traces };
  const summary = buildSummary(s, pr);

  // ---- statements: the newest is Norn's bot comment, the earlier levels go in the timeline
  const stmts = s.statements.filter(x => x.prId === pr.id).sort((a, b) => Number(a.id - b.id));
  const latest = stmts[stmts.length - 1];
  const statement = latest ? statementView(s, latest, pr, runForStatement(s, runs, latest, s2), traces) : undefined;
  if (statement) {
    traces['stmt-class'] = traceFor('stmt-class', 'Change class and approval route', 'judgment', `${statement.changeClass}. Proposed route: ${statement.route}.`, { text: statement.changeClass }, statement.author, statement.at, `Impact statement, Level ${statement.level}`);
  }

  // ---- checks, from the runs of this revision
  const stageRun = (stage: string) => newest(runs, r => r.stage === stage && live(r)) ?? newest(runs, r => r.stage === stage);
  const resOf = (run: RunRow | undefined) => (run ? s.results.filter(r => r.checkRunId === run.id) : []);
  const bomRun = stageRun('s1_bom_delta'), costRun = stageRun('s2_cost');
  const bomRes = resOf(bomRun);
  const num = (k: string) => bomRes.find(r => r.key === k)?.p50 ?? 0;
  const need = v.cost.needsEstimate.length;

  // S3 and S4: the real checks' rows are read in full (./stages.ts); the stand-in stages' rows are labelled mock.
  // Nothing is chosen by `mock` alone: a finished real run without a readable page says so instead of passing.
  const timePick = stageFor(s, runs, 's3_timeline'), supplyPick = stageFor(s, runs, 's4_supply');
  const srcOf = (pick: StagePick, check: string, actor: string) => ({ check, actor, at: iso(pick.run?.finishedAt ?? pick.run?.createdAt ?? s2.createdAt), note: pick.run ? `Run ${pick.run.id}` : '' });
  const timeMock = timePick.rows.some(r => r.mock), supplyMock = supplyPick.rows.some(r => r.mock);
  const whyOf = (e: unknown) => `Norn could not read the check's output (${e instanceof Error ? e.message : String(e)})`;
  let timeRead: TimelineRead | undefined, timeWhy: string | undefined;
  if (timePick.run && !timeMock) {
    try { timeRead = readTimeline(timePick.rows.map(toStage), traces, srcOf(timePick, 'Time to the line (S3)', 'Norn timeline check'), timePick.stale); } catch (e) { timeWhy = whyOf(e); }
  }
  let supplyRead: SupplyRead | undefined, supplyWhy: string | undefined;
  if (supplyPick.run && !supplyMock) {
    try { supplyRead = readSupply(supplyPick.rows.map(toStage), traces, srcOf(supplyPick, 'Supply risk (S4)', 'Norn supply check'), supplyPick.stale); } catch (e) { supplyWhy = whyOf(e); }
  }
  const mockTime = timeMock ? timePick.rows.find(r => r.key === 'effectivity_weeks') : undefined;
  const mockMiss = supplyMock ? supplyPick.rows.find(r => r.key === 'p_miss_effectivity') : undefined;
  const mockRisk = supplyMock ? supplyPick.rows.find(r => r.key === 'cost_at_risk') : undefined;
  const mockTimeSummary = mockTime ? { summary: `${Math.round(mockTime.p50)} weeks until the change reaches the line (mock compute)`, attention: false } : undefined;
  const mockSupplySummary = mockMiss || mockRisk ? { summary: 'Chance of missing the effectivity date and the cost at risk (mock compute)', attention: false } : undefined;
  const checks: Check[] = [
    {
      id: 'bom', name: 'BOM delta', state: runState(bomRun) === 'passed' && num('conflicts') > 0 ? 'attention' : runState(bomRun),
      summary: bomRes.length ? `${num('items_changed')} item${num('items_changed') === 1 ? '' : 's'} revised, ${num('bom_lines_changed')} BOM line${num('bom_lines_changed') === 1 ? '' : 's'} changed${num('conflicts') ? `, ${num('conflicts')} conflicts` : ''}` : 'Waiting for the run',
      by: 'Norn BOM check',
    },
    {
      id: 'cost', name: 'Cost', state: costRun && costRun.status !== 'done' ? runState(costRun) : need > 0 ? 'attention' : 'passed',
      summary: `Net ${v.headline.year1.point !== undefined ? `$${Math.round(v.headline.year1.point).toLocaleString('en-US')}` : ''} in ${v.cost.window.label}${v.cost.scenarios ? ', at the requested effectivity' : ''}${need ? `; ${need} line${need > 1 ? 's need' : ' needs'} an estimate` : ''}${pick.stale ? `. ${staleNote(pick.stale)}` : ''}`,
      by: 'Norn cost check',
    },
    stageCheck('timeline', 'Time to the line', timePick, timeRead ?? mockTimeSummary, timeWhy, timeMock),
    stageCheck('supply', 'Supply risk', supplyPick, supplyRead ?? mockSupplySummary, supplyWhy, supplyMock),
    {
      id: 'class', name: 'Classification', state: statement ? 'passed' : 'pending',
      summary: statement ? `${statement.changeClass}; route: ${statement.route}` : 'Not assessed yet. It comes with the impact statement',
      by: statement?.author,
    },
  ];

  // ---- cut-in estimate and supply: the real checks' pages, or the stand-in stages' numbers labelled mock
  const mock: MockSection[] = ['route'];
  const cutIn: CutIn = { ...v.cutIn };
  if (timeRead) {
    if (timeRead.estimate) cutIn.estimate = timeRead.estimate;
    cutIn.timeline = timeRead.view;
  } else if (mockTime) {
    cutIn.estimate = readMockTimeline(mockTime, traces, iso(s2.createdAt));
    mock.push('cutInEstimate');
  }
  let supply: Supply | undefined;
  if (supplyRead) supply = supplyRead.view;
  else if (mockMiss) {
    supply = readMockSupply(mockMiss, mockRisk, traces, iso(s2.createdAt));
    mock.push('supply');
  }

  // ---- class and route
  const cls = /Class\s+(I{1,2})\b/.exec(statement?.changeClass ?? '')?.[1] ?? summary.companyClass;
  const faa = (/\b(major|minor)\b/i.exec(statement?.changeClass ?? '')?.[1]?.toLowerCase() ?? summary.faa) as 'major' | 'minor';
  const changeClass: ChangeClass = {
    company: cls as 'I' | 'II', companyWhy: statement ? '' : 'As filed by the originator', faa, faaWhy: '', evidence: 'judgment', traceId: statement ? 'stmt-class' : (Object.keys(traces)[0] ?? ''),
  };
  const gate = buildGate(s, pr);
  const steps = routeSteps((cr.routedTo ?? []) as string[], gate, pr);

  // ---- the timeline: who did what, for whom, and why it was allowed
  const events: ActivityEvent[] = [];
  const actorKind = (a: ActionRow): ActorKind => (a.actorOrigin === 'norn' ? 'norn' : a.actorOrigin === 'external' ? 'person_agent' : 'person');
  const allowed = (p: string) => p.replace(/^allow\b/, 'Allowed');
  // The log's policy and summary lines carry the gate's ids and configuration paths; the timeline says them in words.
  const plain = plainOf(s);
  const sum = (t: string) => plain(plainSummary(t));
  events.push({
    id: 'filed', at: cr.filedOn ? `${cr.filedOn}T12:00:00-07:00` : iso(pr.createdAt), actor: personOf(cr.originator) || 'Bowman PLM', actorKind: personOf(cr.originator) ? 'person' : 'system', kind: 'filed',
    text: 'filed the ECR', detail: cr.originatingNcr ? `From ${cr.originatingNcr}.` : undefined,
  });
  for (const a of s.actions.filter(x => x.prId === pr.id)) {
    const base = { id: `log:${a.id}`, at: iso(a.at), actor: a.actorName, actorKind: actorKind(a), onBehalfOf: a.onBehalfOf, spawnedBy: a.spawnedBy };
    const why = plain(`${allowed(a.policy)} · ${ACTION_WORD[a.reducer] ?? a.reducer.replace(/_/g, ' ')}${a.outcome !== 'applied' ? `, ${a.outcome}` : ''}`);
    if (a.reducer === 'ingest_ecr') events.push({ ...base, kind: 'policy', text: 'opened the ECR in Norn from the feed', detail: `${sum(a.summary)}. ${why}` });
    else if (a.reducer === 'complete_check' && /^s[12]_/.test(a.summary)) {
      // A run an input change has since replaced is not shown: the timeline keeps the checks that stand.
      const ran = runs.find(r => `check_run:${r.id}` === a.entity);
      if (ran && !live(ran)) continue;
      const stage = /^(s\d_\w+)/.exec(a.summary)?.[1] ?? '';
      events.push({ ...base, kind: 'ran_checks', text: `ran the ${CHECK_STAGES[stage]?.name.toLowerCase() ?? stage} check`, detail: `${sum(a.summary)}. ${why}` });
    } else if (a.reducer === 'record_assumption') events.push({ ...base, kind: 'research', text: 'recorded an assumption', detail: `${sum(a.summary)}. ${why}` });
    else if (a.reducer === 'set_pr_status') events.push({ ...base, kind: a.outcome === 'applied' && /-> approved\b/.test(a.summary) ? 'approved' : 'policy', text: sum(a.summary), detail: why });
    else if (a.reducer === 'post_impact_statement') {
      const st = stmts.find(x => `impact_statement:${x.id}` === a.entity);
      if (a.outcome === 'applied' && st) events.push({ ...base, kind: 'report', text: `posted the impact statement, Level ${st.level}`, detail: `${st.headline.slice(0, 160)} ${why}`, level: st.level as 1 | 2 | 3 });
      else if (a.outcome !== 'applied') events.push({ ...base, kind: 'changes_requested', text: `was refused: ${sum(a.summary).slice(0, 120)}`, detail: why });
    } else if (a.reducer === 'set_config' || a.reducer === 'edit_pr_text') events.push({ ...base, kind: 'policy', text: sum(a.summary).slice(0, 120), detail: why });
  }
  for (const c of s.comments.filter(x => x.prId === pr.id)) {
    const p = s.principals.find(x => x.identity.toHexString() === c.author.toHexString());
    events.push({ id: `comment:${c.id}`, at: iso(c.createdAt), actor: p?.name ?? 'Someone', actorKind: p?.origin === 'norn' ? 'norn' : p?.origin === 'external' ? 'person_agent' : 'person', onBehalfOf: p?.onBehalfOf, kind: 'comment', text: 'commented', detail: c.body, ...(c.anchor ? { anchor: c.anchor } : {}) });
  }
  // A queued or running check is an event too, so the page shows the run that is still going.
  for (const r of runs.filter(live).filter(x => x.status === 'queued' || x.status === 'running')) {
    if (!CHECK_STAGES[r.stage]) continue;
    events.push({ id: `run-pending:${r.id}`, at: iso(r.createdAt), actor: 'Norn', actorKind: 'norn', kind: 'ran_checks', text: `${r.status === 'running' ? 'is running' : 'queued'} the ${CHECK_STAGES[r.stage].name.toLowerCase()} check`, state: 'running' });
  }
  events.push(...gate.events, ...agentRuns(s, pr));
  events.sort((a, b) => a.at.localeCompare(b.at));

  const revisions: Revision[] = s.revisions.filter(r => r.prId === pr.id).sort((a, b) => b.seq - a.seq).map(r => ({
    id: `r${r.seq}`, message: r.seq === 1 ? `Change request from the ${r.source === 'plm' ? 'PLM' : `${r.source} feed`}` : `Change request updated from the ${r.source === 'plm' ? 'PLM' : `${r.source} feed`}`,
    author: principalName(s, r.createdBy), at: iso(r.createdAt),
  }));

  const body = [
    { heading: 'Change', text: String(cr.description ?? pr.description) },
    ...(cr.need ? [{ heading: 'Need', text: String(cr.need) }] : []),
    ...(cr.consequencesIfDisapproved ? [{ heading: 'If not approved', text: String(cr.consequencesIfDisapproved) }] : []),
    ...(cr.alternativesConsidered ? [{ heading: 'Alternatives considered', text: String(cr.alternativesConsidered) }] : []),
  ].filter(b => b.text);

  const linked: ImpactAssessment['linked'] = [];
  if (cr.originatingNcr) linked.push({ kind: 'NCR', ref: cr.originatingNcr, title: 'The non-conformance this ECR answers', state: 'closed' });
  for (const q of cr.supplierQuotes ?? []) linked.push({ kind: 'Quote', ref: q.id, title: q.supplier, state: 'valid' });

  const needed = cr.neededBy ? new Date(`${cr.neededBy}T12:00:00-07:00`) : undefined;

  return {
    ecr: summary,
    source: 'live',
    level: statement?.level,
    statement,
    headline: v.headline,
    cost: v.cost,
    cutIn,
    supply,
    sCurve: need > 0 ? undefined : v.sCurve,
    drivers: v.drivers,
    scenarios: [],
    changeClass,
    route: { tier: statement?.route ?? 'Route proposed with the impact statement', steps },
    recommendation: statement
      ? { verdict: 'none', headline: `Level ${statement.level} impact statement`, reasons: statement.claims.slice(0, 4).map(c => ({ text: c.text, evidence: c.evidence })), traceId: 'stmt-class' }
      : { verdict: 'none', headline: 'No impact statement yet', reasons: [], traceId: Object.keys(traces)[0] ?? '' },
    needed: [],
    activity: events,
    body,
    checks,
    changes: changedItems(cr),
    revisions,
    linked,
    meeting: { label: needed ? `Needed by ${needed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })}` : 'No date set', date: cr.neededBy ?? '' },
    gate,
    mock,
    traces,
  };
}

// Used by the store to name a month in a log line without importing the adapter twice.
export { monthLabel };
