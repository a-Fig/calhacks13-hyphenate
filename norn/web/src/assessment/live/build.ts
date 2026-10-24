// Live rows in, the screens' view-model out. Pure: it reads a snapshot of the tables the web client
// subscribes to and builds an EcrSummary or an ImpactAssessment. Everything the checks produce goes
// through fromChecks() (./adapter.ts), unchanged. The rest is read from the module's own tables: the
// change request (ecr_revision), runs, impact statements, comments, the action log and the agent
// event stream. What the module does not hold yet (reviewers, the approval route as steps) is a
// labelled mock built from the change request's seats.
import type { CheckResultRow } from '../../../../checks/src/rows.ts';
import { fromChecks, monthLabel, type ChecksView } from '../adapter.ts';
import { likelihoodWord } from '../fit.ts';
import type {
  ActivityEvent, ActorKind, AgentRun, ChangeClass, Check, CutIn, EcrSummary, Evidence, Figure, ImpactAssessment,
  MockSection, Origin, Revision, RouteStep, StatementView, Supply, Trace,
} from '../types.ts';
import { changedItems } from './changes.ts';
import { dateTime, staleNote } from '../../ui/fmt.ts';
import { personOf, SEATS } from './directory.ts';

// ---------------------------------------------------------------- the rows, as much of them as we read

interface Ts { microsSinceUnixEpoch: bigint; toDate(): Date }
interface Id { toHexString(): string }
export interface PrRow { id: bigint; plmEcrNumber: string; title: string; description: string; status: string; revision: number; createdBy: Id; createdAt: Ts; updatedAt: Ts }
export interface RevisionRow { id: bigint; prId: bigint; seq: number; changeRequestJson: string; source: string; current: boolean; createdBy: Id; createdAt: Ts }
export interface RunRow { id: bigint; prId: bigint; stage: string; status: string; note: string; createdAt: Ts; finishedAt: Ts | undefined }
export interface ResultRow { id: bigint; checkRunId: bigint; prId: bigint; key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string; mock: boolean }
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

export interface Snapshot {
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

/** The reducers' status words, in the business's words. */
const STATUS_WORD: Record<string, string> = { draft: 'submitted', review: 'in review', approved: 'approved', merged: 'released', closed: 'rejected' };
const STATUS_RE = Object.keys(STATUS_WORD).join('|');

/** A reducer's log summary, with status changes ("approved -> merged") in the business's words. */
export function plainSummary(text: string): string {
  return text
    .replace(new RegExp(`\\b(${STATUS_RE}) -> (${STATUS_RE})\\b`, 'g'), (_m, from: string, to: string) => `moved from ${STATUS_WORD[from]} to ${STATUS_WORD[to]}`)
    .replace(/\bmerged\b/g, 'released')
    .replace(/ -> /g, ' to ');
}

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
  const checks: EcrSummary['checks'] = active.some(r => r.status === 'queued' || r.status === 'running') ? 'running' : pick.why || pick.stale === 'failed' || need > 0 || d?.bomDelta?.ok === false ? 'attention' : s2 ? 'passed' : undefined;
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
  const run = newest(runs, r => r.stage === 's2_cost' && (r.status === 'done' || r.status === 'stale') && (r.finishedAt ?? r.createdAt).microsSinceUnixEpoch <= posted
    && s.results.some(x => x.checkRunId === r.id));
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
  const resultTrace = (key: string): string | undefined => {
    if (src.kind === 'same') return traces[key] ? key : undefined;
    if (src.kind === 'gone') return undefined;
    const t = src.view.traces[key];
    if (!t) return undefined;
    const id = `stmt:${st.id}:run:${key}`;
    traces[id] = { ...t, id, summary: `From the cost run before the ECR changed (finished ${dateTime(src.finishedAt)}), not the one on the Impact tab. ${t.summary}`, inputs: t.inputs.map(i => ({ ...i, traceId: undefined })) };
    return id;
  };
  const fmt = (n: StatementRow['numbers'][number], x: number) =>
    n.unit === 'USD' ? (Math.abs(x) >= 1000 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toFixed(2)}`) : `${x}${n.unit ? ` ${n.unit}` : ''}`;
  return {
    id: String(st.id), level: st.level as 1 | 2 | 3, at, author, authorKind, headline: st.headline, changeClass: st.changeClass, route: st.route,
    numbers: st.numbers.map((n, i) => ({
      key: n.key, label: n.label, unit: n.unit, p10: n.p10, p50: n.p50, p90: n.p90, evidence: e(n.evidence),
      traceId: n.resultKey && src.kind !== 'same'
        ? resultTrace(n.resultKey)
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
  const bomRun = stageRun('s1_bom_delta'), costRun = stageRun('s2_cost'), timeRun = stageRun('s3_timeline'), supplyRun = stageRun('s4_supply');
  const bomRes = resOf(bomRun);
  const num = (k: string) => bomRes.find(r => r.key === k)?.p50 ?? 0;
  const timeRes = resOf(timeRun).find(r => r.mock), supplyRes = resOf(supplyRun);
  const need = v.cost.needsEstimate.length;
  const checks: Check[] = [
    {
      id: 'bom', name: 'BOM delta', state: runState(bomRun) === 'passed' && num('conflicts') > 0 ? 'attention' : runState(bomRun),
      summary: bomRes.length ? `${num('items_changed')} item${num('items_changed') === 1 ? '' : 's'} revised, ${num('bom_lines_changed')} BOM line${num('bom_lines_changed') === 1 ? '' : 's'} changed${num('conflicts') ? `, ${num('conflicts')} conflicts` : ''}` : 'Waiting for the run',
      by: 'Norn BOM check',
    },
    {
      id: 'cost', name: 'Cost', state: costRun && costRun.status !== 'done' ? runState(costRun) : need > 0 ? 'attention' : 'passed',
      summary: `Net ${v.headline.year1.point !== undefined ? `$${Math.round(v.headline.year1.point).toLocaleString('en-US')}` : ''} in ${v.cost.window.label}${need ? `; ${need} line${need > 1 ? 's need' : ' needs'} an estimate` : ''}${pick.stale ? `. ${staleNote(pick.stale)}` : ''}`,
      by: 'Norn cost check',
    },
    {
      id: 'timeline', name: 'Time to the line', state: timeRun ? runState(timeRun) : 'pending', mock: !!timeRes,
      summary: timeRes ? `${Math.round(timeRes.p50)} weeks until the change reaches the line (mock compute)` : 'Not assessed yet',
    },
    {
      id: 'supply', name: 'Supply risk', state: supplyRun ? runState(supplyRun) : 'pending', mock: supplyRes.some(r => r.mock),
      summary: supplyRes.length ? 'Chance of missing the effectivity date and the cost at risk (mock compute)' : 'Not assessed yet',
    },
    {
      id: 'class', name: 'Classification', state: statement ? 'passed' : 'pending',
      summary: statement ? `${statement.changeClass}; route: ${statement.route}` : 'Not assessed yet. It comes with the impact statement',
      by: statement?.author,
    },
  ];

  // ---- cut-in estimate and supply: the stages that are still mock compute, labelled so
  const mock: MockSection[] = ['route'];
  const cutIn: CutIn = { ...v.cutIn };
  if (timeRes) {
    const f: Figure = { id: 'x:effectivity_weeks', unit: 'weeks', p10: timeRes.p10, p50: timeRes.p50, p90: timeRes.p90, evidence: 'computation' };
    cutIn.estimate = { figure: f, note: 'Weeks until the change reaches the line, from the timeline stage (mock compute)' };
    traces[f.id] = traceFor(f.id, 'Weeks until the change reaches the line', 'computation', 'Mock compute: the timeline stage is not built yet, and its numbers are made up.', { text: `${Math.round(timeRes.p50)} wk`, range: `${Math.round(timeRes.p10)} – ${Math.round(timeRes.p90)} wk` }, 'Norn worker', iso(timeRes.id ? s2.createdAt : s2.createdAt), 'Time to the line (S3, mock)');
    mock.push('cutInEstimate');
  }
  let supply: Supply | undefined;
  const pMiss = supplyRes.find(r => r.key === 'p_miss_effectivity' && r.mock);
  const atRisk = supplyRes.find(r => r.key === 'cost_at_risk' && r.mock);
  if (pMiss) {
    supply = {
      id: 'supply', level: pMiss.p50 < 0.1 ? 'low' : pMiss.p50 < 0.3 ? 'moderate' : 'high', evidence: 'computation',
      note: atRisk ? `Cost at risk about $${Math.round(atRisk.p50).toLocaleString('en-US')} per unit` : 'Supply risk (mock compute)',
      likelihood: { word: likelihoodWord(pMiss.p50), event: 'of missing the effectivity date', probability: pMiss.p50 },
    };
    traces['supply'] = traceFor('supply', 'Supply risk', 'computation', 'Mock compute: the supply stage is not built yet, and its numbers are made up.', { text: cap(supply.level), range: supply.note }, 'Norn worker', iso(s2.createdAt), 'Supply risk (S4, mock)');
    mock.push('supply');
  }

  // ---- class and route
  const cls = /Class\s+(I{1,2})\b/.exec(statement?.changeClass ?? '')?.[1] ?? summary.companyClass;
  const faa = (/\b(major|minor)\b/i.exec(statement?.changeClass ?? '')?.[1]?.toLowerCase() ?? summary.faa) as 'major' | 'minor';
  const changeClass: ChangeClass = {
    company: cls as 'I' | 'II', companyWhy: statement ? '' : 'As filed by the originator', faa, faaWhy: '', evidence: 'judgment', traceId: statement ? 'stmt-class' : (Object.keys(traces)[0] ?? ''),
  };
  const steps: RouteStep[] = ((cr.routedTo ?? []) as string[]).filter(r => SEATS[r]).map(r => ({
    role: SEATS[r].role, person: SEATS[r].person, state: pr.status === 'approved' || pr.status === 'merged' ? 'approved' as const : 'pending' as const,
  }));
  steps.push({ role: 'CCB', person: 'Rafael Quintero, chair', state: pr.status === 'approved' || pr.status === 'merged' ? 'approved' : 'waiting' });

  // ---- the timeline: who did what, for whom, and why it was allowed
  const events: ActivityEvent[] = [];
  const actorKind = (a: ActionRow): ActorKind => (a.actorOrigin === 'norn' ? 'norn' : a.actorOrigin === 'external' ? 'person_agent' : 'person');
  const allowed = (p: string) => p.replace(/^allow\b/, 'Allowed');
  events.push({
    id: 'filed', at: cr.filedOn ? `${cr.filedOn}T12:00:00-07:00` : iso(pr.createdAt), actor: personOf(cr.originator), actorKind: 'person', kind: 'filed',
    text: 'filed the ECR', detail: cr.originatingNcr ? `From ${cr.originatingNcr}.` : undefined,
  });
  for (const a of s.actions.filter(x => x.prId === pr.id)) {
    const base = { id: `log:${a.id}`, at: iso(a.at), actor: a.actorName, actorKind: actorKind(a), onBehalfOf: a.onBehalfOf, spawnedBy: a.spawnedBy };
    const why = `${allowed(a.policy)} · ${a.reducer}${a.outcome !== 'applied' ? `, ${a.outcome}` : ''}`;
    if (a.reducer === 'ingest_ecr') events.push({ ...base, kind: 'policy', text: 'opened the ECR in Norn from the feed', detail: `${plainSummary(a.summary)}. ${why}` });
    else if (a.reducer === 'complete_check' && /^s[12]_/.test(a.summary)) {
      // A run an input change has since replaced is not shown: the timeline keeps the checks that stand.
      const ran = runs.find(r => `check_run:${r.id}` === a.entity);
      if (ran && !live(ran)) continue;
      const stage = /^(s\d_\w+)/.exec(a.summary)?.[1] ?? '';
      events.push({ ...base, kind: 'ran_checks', text: `ran the ${CHECK_STAGES[stage]?.name.toLowerCase() ?? stage} check`, detail: `${plainSummary(a.summary)}. ${why}` });
    } else if (a.reducer === 'record_assumption') events.push({ ...base, kind: 'research', text: 'recorded an assumption', detail: `${plainSummary(a.summary)}. ${why}` });
    else if (a.reducer === 'set_pr_status') events.push({ ...base, kind: a.outcome === 'applied' && /-> approved\b/.test(a.summary) ? 'approved' : 'policy', text: plainSummary(a.summary), detail: why });
    else if (a.reducer === 'post_impact_statement') {
      const st = stmts.find(x => `impact_statement:${x.id}` === a.entity);
      if (a.outcome === 'applied' && st) events.push({ ...base, kind: 'report', text: `posted the impact statement, Level ${st.level}`, detail: `${st.headline.slice(0, 160)} ${why}`, level: st.level as 1 | 2 | 3 });
      else if (a.outcome !== 'applied') events.push({ ...base, kind: 'changes_requested', text: `was refused: ${plainSummary(a.summary).slice(0, 120)}`, detail: why });
    } else if (a.reducer === 'set_config' || a.reducer === 'edit_pr_text') events.push({ ...base, kind: 'policy', text: plainSummary(a.summary).slice(0, 120), detail: why });
  }
  for (const c of s.comments.filter(x => x.prId === pr.id)) {
    const p = s.principals.find(x => x.identity.toHexString() === c.author.toHexString());
    events.push({ id: `comment:${c.id}`, at: iso(c.createdAt), actor: p?.name ?? 'Someone', actorKind: p?.origin === 'norn' ? 'norn' : p?.origin === 'external' ? 'person_agent' : 'person', onBehalfOf: p?.onBehalfOf, kind: 'comment', text: 'commented', detail: c.body });
  }
  // A queued or running check is an event too, so the page shows the run that is still going.
  for (const r of runs.filter(live).filter(x => x.status === 'queued' || x.status === 'running')) {
    if (!CHECK_STAGES[r.stage]) continue;
    events.push({ id: `run-pending:${r.id}`, at: iso(r.createdAt), actor: 'Norn', actorKind: 'norn', kind: 'ran_checks', text: `${r.status === 'running' ? 'is running' : 'queued'} the ${CHECK_STAGES[r.stage].name.toLowerCase()} check`, state: 'running' });
  }
  events.push(...agentRuns(s, pr));
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
    mock,
    traces,
  };
}

// Used by the store to name a month in a log line without importing the adapter twice.
export { monthLabel };
