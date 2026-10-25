// Live rows of the company gate and the ERP change package, in the view-model the Conversation tab draws.
// Pure, like build.ts: it reads a snapshot of four tables and returns a GateView.
//
//   approval        who approved, at which tier, and whether it still stands or waits for a re-check (#43)
//   recommendation  what the gate filed in place of an approval the actor may not give (#43)
//   eco_release     the change order number the PLM gave a released ECR (#72)
//   erp_package     the lines a person enters in the ERP to carry the ECO out (#72)
//
// Norn never writes to the ERP (#71): everything here is for a person to read and act on. The shapes
// below are read from module/src/schema.ts and gate.ts, and for the package from the ERPNext connector's
// ErpChangePackage (connectors/erpnext/src/package.ts) and the worker's release.ts. Anything a row holds
// that is not in the shape expected is dropped quietly, except in the package, where a package the page
// cannot read says so rather than looking empty.
import type { ActivityEvent, ActorKind } from '../types.ts';

// ---------------------------------------------------------------- the rows, as much of them as we read

interface Ts { toDate(): Date }
export interface ReasonRow { rule: string; text: string }
export interface ApprovalRow {
  id: bigint; prId: bigint; prRevision: number; kind: string; bodyId: string; tierId: string; decisionJson: string;
  status: string; pendingRecheck: boolean; approverKind: string; approverName: string; approverOrigin: string;
  onBehalfOf: string | undefined; at: Ts; endedAt: Ts | undefined; endedReason: string;
}
export interface RecommendationRow {
  id: bigint; prId: bigint; prRevision: number; action: string; outcome: string; recommenderKind: string; recommenderName: string;
  recommenderOrigin: string; onBehalfOf: string | undefined; reasons: ReasonRow[]; recipients: string[]; awaitingSecondCheck: boolean; at: Ts;
}
export interface EcoReleaseRow { prId: bigint; ecoNumber: string; recordedAt: Ts }
export interface ErpPackageRow {
  prId: bigint; ecoNumber: string; s2RunId: bigint; erpBaseline: string; releaseJson: string; packageJson: string;
  lines: number; entered: number; conflicts: number; notesJson: string; builtAt: Ts; updatedAt: Ts;
}
export interface GateRows {
  approvals?: ApprovalRow[]; recommendations?: RecommendationRow[]; ecoReleases?: EcoReleaseRow[]; erpPackages?: ErpPackageRow[];
}
export interface GatePr { id: bigint; plmEcrNumber: string; status: string; revision: number }

// ---------------------------------------------------------------- the view-model

export type ApprovalState = 'approved' | 'pending_recheck' | 'withdrawn';
export type WhoKind = 'person' | 'norn' | 'agent';

export interface ApprovalView {
  id: string;
  who: string;
  whoKind: WhoKind;
  onBehalfOf?: string;
  /** The deciding body, or "Fast track". */
  role: string;
  tier?: string;
  fastTrack: boolean;
  state: ApprovalState;
  /** The ECR was released on this approval. */
  released: boolean;
  at: string;
  endedAt?: string;
  endedReason?: string;
  revision: number;
  reasons: ReasonRow[];
}

export interface RecommendationView {
  id: string;
  headline: string;
  by: string;
  whoKind: WhoKind;
  onBehalfOf?: string;
  action: string;
  outcome: string;
  reasons: ReasonRow[];
  recipients: string[];
  at: string;
  revision: number;
  /** Drawn for the blind second check, which is not built yet: it waits. */
  waitingForSecondCheck: boolean;
}

export type LineStatus = 'entered' | 'to_enter' | 'conflict';
export interface PackageLineView {
  id: string;
  title: string;
  status: LineStatus;
  /** The words on the page: "Entered", "To enter in ERPNext", "Conflict". */
  statusText: string;
  seat: string;
  instruction: string;
  doctype: string;
  note?: string;
  fields: { label: string; value: string }[];
  tables: { label: string; rows: string[] }[];
}
export interface PackageGroupView { id: string; title: string; lines: PackageLineView[]; entered: number }

export type PackageHealth = 'problems' | 'conflict' | 'to_enter' | 'entered' | 'nothing';

export interface PackageBuilt {
  state: 'built';
  ecoNumber: string;
  health: PackageHealth;
  /** One line that is true: never "nothing to enter" while there is a problem. */
  headline: string;
  counts: { lines: number; entered: number; toEnter: number; conflicts: number; problems: number };
  problems: string[];
  warnings: string[];
  effects: { program: string; name: string; costDelta: number; basis: string }[];
  groups: PackageGroupView[];
  /** What the package leaves out, and why. */
  notes: string[];
  builtAt: string;
  checkedAt: string;
  /** The ERP read the statuses come from, short. */
  erpRead: string;
  system: string;
}
export interface PackageMissing {
  state: 'missing';
  code: 'not_released' | 'no_eco_number' | 'building';
  why: string;
}
export type PackageView = PackageBuilt | PackageMissing;

export interface GateView {
  /** Newest recommendation made on the ECR's current revision, if it has not been acted on since. */
  recommendation?: RecommendationView;
  /** Every approval of the ECR, newest first. */
  approvals: ApprovalView[];
  /** The ECR stands approved on the fast track. */
  fastTrack?: ApprovalView;
  /** Why the release button is disabled, when an approval needs something first. */
  releaseBlock?: string;
  package: PackageView;
  /** Timeline entries for recommendations, fast-track approvals and withdrawn approvals. */
  events: ActivityEvent[];
}

export const RELEASE_BLOCKED = 'Release is refused while an approval is pending a re-check';

// ---------------------------------------------------------------- helpers

const iso = (t: Ts) => t.toDate().toISOString();
const parse = (s: string): any => {
  try { return JSON.parse(s); } catch { return undefined; }
};
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []);
const ACRONYMS = new Set(['cm', 'ccb', 'cfo', 'plm', 'erp', 'eco', 'ecr', 'trc', 'pmc']);

/** A role or body id in words: `cm_analyst` becomes "CM analyst". */
export function roleWords(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(w => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const s = words.join(' ');
  return s ? s[0].toUpperCase() + s.slice(1) : id;
}

function whoKindOf(origin: string, kind: string): WhoKind {
  if (kind === 'person') return 'person';
  return origin === 'norn' ? 'norn' : 'agent';
}
const actorKindOf = (k: WhoKind): ActorKind => (k === 'norn' ? 'norn' : k === 'agent' ? 'person_agent' : 'person');

// ---------------------------------------------------------------- approvals and recommendations

export function approvalView(a: ApprovalRow): ApprovalView {
  const d = parse(a.decisionJson);
  const whoKind = whoKindOf(a.approverOrigin, a.approverKind);
  const fastTrack = a.kind === 'fast_track';
  const bodyName: string | undefined = isObj(d) && isObj(d.route) && typeof d.route.bodyName === 'string' && d.route.bodyName ? d.route.bodyName : undefined;
  const state: ApprovalState = a.status === 'withdrawn' ? 'withdrawn' : a.status === 'standing' && a.pendingRecheck ? 'pending_recheck' : 'approved';
  return {
    id: String(a.id),
    who: whoKind === 'norn' ? 'Norn' : a.approverName,
    whoKind,
    onBehalfOf: a.onBehalfOf || undefined,
    role: fastTrack ? 'Fast track' : bodyName ?? (a.bodyId ? roleWords(a.bodyId) : 'Approver'),
    tier: a.tierId ? roleWords(a.tierId) : undefined,
    fastTrack,
    state,
    released: a.status === 'released',
    at: iso(a.at),
    endedAt: a.endedAt ? iso(a.endedAt) : undefined,
    endedReason: a.endedReason || undefined,
    revision: a.prRevision,
    reasons: isObj(d) && Array.isArray(d.reasons) ? d.reasons.filter((r: any) => isObj(r) && typeof r.text === 'string').map((r: any) => ({ rule: String(r.rule ?? ''), text: r.text })) : [],
  };
}

export function recommendationView(r: RecommendationRow): RecommendationView {
  const whoKind = whoKindOf(r.recommenderOrigin, r.recommenderKind);
  const by = whoKind === 'norn' ? 'Norn' : r.recommenderName;
  const what = r.action === 'release_eco' ? 'release' : 'approval';
  const waiting = r.awaitingSecondCheck || r.outcome === 'sampled';
  const headline = waiting ? `${by} would approve, but this one is held for a second check`
    : r.outcome === 'escalate' ? `${by} escalated this ECR`
    : `${by} recommends ${what}`;
  return {
    id: String(r.id), headline, by, whoKind, onBehalfOf: r.onBehalfOf || undefined, action: r.action, outcome: r.outcome,
    reasons: r.reasons.map(x => ({ rule: x.rule, text: x.text })), recipients: r.recipients.map(roleWords), at: iso(r.at), revision: r.prRevision, waitingForSecondCheck: waiting,
  };
}

const sentTo = (rec: RecommendationView) => (rec.recipients.length ? `Sent to ${rec.recipients.join(', ')}.` : 'No recipient was named.');

function recommendationEvent(r: RecommendationRow, pr: GatePr): ActivityEvent {
  const v = recommendationView(r);
  const old = r.prRevision < pr.revision;
  const verb = v.waitingForSecondCheck ? 'would approve this ECR, held for a second check' : r.outcome === 'escalate' ? 'escalated this ECR' : r.action === 'release_eco' ? 'recommended release' : 'recommended approval';
  return {
    id: `rec:${r.id}`, at: v.at, actor: v.by, actorKind: actorKindOf(v.whoKind), onBehalfOf: v.onBehalfOf, kind: 'review_requested',
    text: verb,
    detail: `${old ? `Superseded: made on revision ${r.prRevision}, and the ECR is now on revision ${pr.revision}. ` : ''}${sentTo(v)}${v.reasons.length ? ` ${v.reasons.map(x => x.text).join(' ')}` : ''}`,
    superseded: old || undefined,
  };
}

function approvalEvents(a: ApprovalRow, v: ApprovalView): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  // A person's approval at a tier is already a timeline entry (the status change in the action log).
  if (v.fastTrack) {
    out.push({
      id: `appr:${a.id}`, at: v.at, actor: v.who, actorKind: actorKindOf(v.whoKind), onBehalfOf: v.onBehalfOf, kind: 'approved',
      text: 'approved this ECR on the fast track', detail: v.reasons.map(x => x.text).join(' ') || undefined,
    });
  }
  if (v.state === 'withdrawn' && v.endedAt) {
    out.push({
      id: `appr-end:${a.id}`, at: v.endedAt, actor: 'Norn', actorKind: 'norn', kind: 'changes_requested',
      text: `withdrew the approval by ${v.who}`, detail: v.endedReason,
    });
  }
  return out;
}

// ---------------------------------------------------------------- the ERP change package

const GROUPS: { id: string; title: string; kinds: string[] }[] = [
  { id: 'cost', title: 'Standard costs', kinds: ['standard-cost-close', 'standard-cost'] },
  { id: 'bom', title: 'Bills of materials', kinds: ['bom', 'bom-replace', 'bom-retire'] },
  { id: 'journal', title: 'Journal entries', kinds: ['journal-entry'] },
];
const STATUS_TEXT: Record<LineStatus, string> = { entered: 'Entered', to_enter: 'To enter in ERPNext', conflict: 'Conflict: entered differently from the package' };

const fieldValue = (f: any): string => {
  if (!isObj(f)) return '';
  if (f.value === null || f.value === undefined) return f.from ? `(made by ${String(f.from)})` : '(not set)';
  if (typeof f.value === 'number') return f.money ? f.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(f.value);
  return String(f.value);
};

function lineView(l: any): PackageLineView | undefined {
  if (!isObj(l) || typeof l.title !== 'string') return undefined;
  const status: LineStatus = l.status === 'entered' ? 'entered' : l.status === 'conflict' ? 'conflict' : 'to_enter';
  return {
    id: String(l.id ?? l.title), title: l.title, status, statusText: STATUS_TEXT[status], seat: typeof l.enteredBy === 'string' ? l.enteredBy : '',
    instruction: typeof l.instruction === 'string' ? l.instruction : '', doctype: typeof l.doctype === 'string' ? l.doctype : '',
    note: typeof l.note === 'string' && l.note ? l.note : undefined,
    fields: (Array.isArray(l.fields) ? l.fields : []).filter(isObj).map((f: any) => ({ label: String(f.label ?? f.field ?? ''), value: fieldValue(f) })),
    tables: (Array.isArray(l.tables) ? l.tables : []).filter(isObj).map((t: any) => ({
      label: String(t.label ?? t.table ?? ''),
      rows: (Array.isArray(t.rows) ? t.rows : []).map((row: any) => (Array.isArray(row) ? row.map((f: any) => `${isObj(f) ? String(f.label ?? f.field ?? '') : ''} ${fieldValue(f)}`.trim()).join(' · ') : '')).filter(Boolean),
    })),
  };
}

/** Every problem the package has, from the three places the worker puts one, each said once. */
export function packageProblems(release: any, pkg: any, notes: any): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const p of strings(pkg?.problems)) add(p);
  for (const p of strings(notes?.problems)) add(p);
  // A change the assessment costs but the package cannot carry out (labour hours, a zero price) is a problem even
  // when the planner did not repeat it: the package must never read as "nothing to enter" while the assessment costs it.
  for (const u of strings(release?.unsupported)) if (!out.some(p => p.includes(u))) add(`Not in this package: ${u}`);
  return out;
}

export function packageView(row: ErpPackageRow): PackageBuilt {
  const release = parse(row.releaseJson);
  const pkg = parse(row.packageJson);
  const notes = parse(row.notesJson);
  const problems = packageProblems(release, pkg, notes);
  const readable = isObj(pkg) && Array.isArray(pkg.lines);
  const lines = readable ? (pkg.lines as any[]).map(lineView).filter((l): l is PackageLineView => !!l) : [];
  // The row's own counts are what the module checked; the lines are what the page can show. When they disagree, say so.
  if (row.lines > lines.length) problems.push(`The package row counts ${row.lines} line${row.lines === 1 ? '' : 's'}, but ${lines.length} could be read from it. Treat the list below as incomplete.`);
  const counts = { lines: row.lines, entered: row.entered, toEnter: Math.max(0, row.lines - row.entered - row.conflicts), conflicts: row.conflicts, problems: problems.length };
  const known = new Set<string>();
  const groups: PackageGroupView[] = [];
  for (const g of GROUPS) {
    const kept = (pkg?.lines as any[] | undefined)?.filter(l => isObj(l) && g.kinds.includes(l.kind)).map(lineView).filter((l): l is PackageLineView => !!l) ?? [];
    kept.forEach(l => known.add(l.id));
    if (kept.length) groups.push({ id: g.id, title: g.title, lines: kept, entered: kept.filter(l => l.status === 'entered').length });
  }
  const other = lines.filter(l => !known.has(l.id));
  if (other.length) groups.push({ id: 'other', title: 'Other lines', lines: other, entered: other.filter(l => l.status === 'entered').length });

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let health: PackageHealth;
  let headline: string;
  if (problems.length) {
    health = 'problems';
    headline = counts.lines
      ? `${plural(problems.length, 'problem')} to resolve by hand. ${counts.entered} of ${plural(counts.lines, 'line')} entered${counts.conflicts ? `, ${counts.conflicts} in conflict` : ''}.`
      : `${plural(problems.length, 'problem')} to resolve by hand. Nothing in the package can be entered as it stands.`;
  } else if (counts.conflicts) {
    health = 'conflict';
    headline = `${plural(counts.conflicts, 'line')} in conflict with what is in ERPNext. ${counts.entered} of ${plural(counts.lines, 'line')} entered.`;
  } else if (counts.lines === 0) {
    health = 'nothing';
    headline = 'The release changes nothing ERPNext holds, so there is nothing to enter.';
  } else if (counts.entered === counts.lines) {
    health = 'entered';
    headline = `All ${plural(counts.lines, 'line')} entered in ERPNext.`;
  } else {
    health = 'to_enter';
    headline = `${counts.entered} of ${plural(counts.lines, 'line')} entered, ${counts.toEnter} to enter in ERPNext.`;
  }
  return {
    state: 'built', ecoNumber: row.ecoNumber, health, headline, counts, problems,
    warnings: strings(pkg?.warnings),
    effects: (Array.isArray(pkg?.effects) ? pkg.effects : []).filter(isObj).map((e: any) => ({ program: String(e.program ?? ''), name: String(e.name ?? ''), costDelta: Number(e.costDelta) || 0, basis: String(e.basis ?? '') })),
    groups, notes: strings(notes?.notes), builtAt: iso(row.builtAt), checkedAt: iso(row.updatedAt), erpRead: row.erpBaseline.slice(0, 8), system: 'ERPNext',
  };
}

function packageFor(rows: GateRows, pr: GatePr): PackageView {
  const eco = rows.ecoReleases?.find(e => e.prId === pr.id);
  const row = rows.erpPackages?.find(p => p.prId === pr.id);
  if (row) return packageView(row);
  if (pr.status !== 'merged') {
    return { state: 'missing', code: 'not_released', why: `${pr.plmEcrNumber} is not released yet. Norn builds the ERP change package once its ECO is released.` };
  }
  if (!eco) {
    return { state: 'missing', code: 'no_eco_number', why: `${pr.plmEcrNumber} is released in Norn, but the PLM has not given its change order number yet. The package is built once it has.` };
  }
  return {
    state: 'missing', code: 'building',
    why: `${eco.ecoNumber} is released and the package is still building. A worker that reads the ERP builds it from the assessment and records it here.`,
  };
}

// ---------------------------------------------------------------- one ECR

export function buildGate(rows: GateRows, pr: GatePr): GateView {
  const mine = (rows.approvals ?? []).filter(a => a.prId === pr.id).sort((a, b) => Number(b.id - a.id));
  const approvals = mine.map(approvalView);
  const events: ActivityEvent[] = mine.flatMap((a, i) => approvalEvents(a, approvals[i]));

  const recs = (rows.recommendations ?? []).filter(r => r.prId === pr.id).sort((a, b) => Number(a.id - b.id));
  for (const r of recs) events.push(recommendationEvent(r, pr));
  // Only a row made on the current revision speaks for the ECR as it is now; and not once an approval has followed it.
  const latest = recs.filter(r => r.prRevision === pr.revision).at(-1);
  const acted = latest && mine.some(a => a.status !== 'withdrawn' && a.at.toDate() >= latest.at.toDate());
  const recommendation = latest && !acted ? recommendationView(latest) : undefined;

  const head = approvals[0];
  const pending = pr.status === 'approved' && approvals.some(a => a.state === 'pending_recheck');
  return {
    recommendation,
    approvals,
    fastTrack: head?.fastTrack && head.state !== 'withdrawn' ? head : undefined,
    releaseBlock: pending ? RELEASE_BLOCKED : undefined,
    package: packageFor(rows, pr),
    events,
  };
}
