// Live rows of the company gate and the ERP change package, in the view-model the Conversation tab draws.
// Pure, like build.ts: it reads a snapshot of four tables and returns a GateView.
//
//   approval        who approved, at which tier, and whether it still stands or waits for a re-check (#43)
//   recommendation  what the gate filed in place of an approval the actor may not give (#43)
//   eco_release     the change order number the PLM gave a released ECR (#72)
//   erp_package     the lines a person enters in the ERP to carry the ECO out (#72)
//
// Fern drafts, people submit (Tyler, 2026-10-25, reversing #71): Fern saves the package's BOM versions and journal
// entries in the ERP as drafts, and everything here is for a person to read, submit and act on. The shapes
// below are read from module/src/schema.ts and gate.ts, and for the package from the ERPNext connector's
// ErpChangePackage (connectors/erpnext/src/package.ts) and the worker's release.ts. Anything a row holds
// that is not in the shape expected is dropped quietly, except in the package, where a package the page
// cannot read says so rather than looking empty.
import type { ActivityEvent, ActorKind } from '../types.ts';
import { NO_NAMES, namesOf, plainReason, type Names } from './words.ts';

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
  /** norn_config rows: the stored company configuration names the tiers, bodies and roles that reasons mention. */
  configs?: { key: string; value: string }[];
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

export type LineStatus = 'entered' | 'drafted' | 'to_enter' | 'conflict';
export interface PackageLineView {
  id: string;
  title: string;
  status: LineStatus;
  /** The words on the page: "Entered", "To enter in ERPNext", "Conflict". */
  statusText: string;
  seat: string;
  /** Fern's draft of this line in ERPNext, waiting for a person to submit it. */
  draft?: { doctype: string; name: string; url: string; waitingFor: string };
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
  counts: { lines: number; entered: number; toEnter: number; conflicts: number; problems: number; drafted: number };
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
  /** Set when the rows are hand-made, not read from the ERP; the card shows a Mock label with this text. A real package never has it. */
  mock?: string;
}
export interface PackageMissing {
  state: 'missing';
  code: 'not_released' | 'no_eco_number' | 'building';
  why: string;
}
/** The package row is there but not in a shape the page can read. It is never shown as an empty package. */
export interface PackageUnreadable {
  state: 'unreadable';
  ecoNumber: string;
  why: string;
  rowLines: number;
  rowEntered: number;
  rowConflicts: number;
  /** Whatever problems could still be read. */
  problems: string[];
}
export type PackageView = PackageBuilt | PackageMissing | PackageUnreadable;

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

/** The company's names for its tiers, bodies and roles, from the stored configuration. */
export const namesFor = (rows: GateRows): Names => namesOf(rows.configs?.find(c => c.key === 'company_config')?.value);

/** Text from the gate or the action log in business words, with the company's own names. */
export const plainOf = (rows: GateRows) => {
  const names = namesFor(rows);
  return (text: string) => plainReason(text, names);
};

export const RELEASE_BLOCKED = 'Release is refused while an approval is pending a re-check';

// ---------------------------------------------------------------- helpers

const iso = (t: Ts) => t.toDate().toISOString();
const parse = (s: string): any => {
  try { return JSON.parse(s); } catch { return undefined; }
};
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
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

export function approvalView(a: ApprovalRow, names: Names = NO_NAMES): ApprovalView {
  const d = parse(a.decisionJson);
  const whoKind = whoKindOf(a.approverOrigin, a.approverKind);
  const fastTrack = a.kind === 'fast_track';
  const bodyName: string | undefined = isObj(d) && isObj(d.route) && typeof d.route.bodyName === 'string' && d.route.bodyName ? d.route.bodyName : undefined;
  const state: ApprovalState = a.status === 'withdrawn' ? 'withdrawn' : a.status === 'standing' && a.pendingRecheck ? 'pending_recheck' : 'approved';
  return {
    id: String(a.id),
    who: whoKind === 'norn' ? 'Fern' : a.approverName,
    whoKind,
    onBehalfOf: a.onBehalfOf || undefined,
    role: fastTrack ? 'Fast track' : bodyName ?? (a.bodyId ? roleWords(a.bodyId) : 'Approver'),
    tier: a.tierId ? roleWords(a.tierId) : undefined,
    fastTrack,
    state,
    released: a.status === 'released',
    at: iso(a.at),
    endedAt: a.endedAt ? iso(a.endedAt) : undefined,
    endedReason: a.endedReason ? plainReason(String(a.endedReason), names) : undefined,
    revision: a.prRevision,
    reasons: isObj(d) && Array.isArray(d.reasons) ? d.reasons.filter((r: any) => isObj(r) && typeof r.text === 'string').map((r: any) => ({ rule: String(r.rule ?? ''), text: plainReason(r.text, names) })) : [],
  };
}

export function recommendationView(r: RecommendationRow, names: Names = NO_NAMES): RecommendationView {
  const whoKind = whoKindOf(r.recommenderOrigin, r.recommenderKind);
  const by = whoKind === 'norn' ? 'Fern' : r.recommenderName;
  const what = r.action === 'release_eco' ? 'release' : 'approval';
  const waiting = r.awaitingSecondCheck || r.outcome === 'sampled';
  const headline = waiting ? `${by} would approve, but this one is held for a second check`
    : r.outcome === 'escalate' ? `${by} escalated this ECR`
    : `${by} recommends ${what}`;
  return {
    id: String(r.id), headline, by, whoKind, onBehalfOf: r.onBehalfOf || undefined, action: r.action, outcome: r.outcome,
    reasons: (Array.isArray(r.reasons) ? r.reasons : []).filter(x => isObj(x) && typeof x.text === 'string').map(x => ({ rule: String(x.rule ?? ''), text: plainReason(x.text, names) })),
    recipients: (Array.isArray(r.recipients) ? r.recipients : []).filter((x): x is string => typeof x === 'string').map(x => names.roles[x] ?? roleWords(x)), at: iso(r.at), revision: r.prRevision, waitingForSecondCheck: waiting,
  };
}

const sentTo = (rec: RecommendationView) => (rec.recipients.length ? `Sent to ${rec.recipients.join(', ')}.` : 'No recipient was named.');

function recommendationEvent(r: RecommendationRow, pr: GatePr, names: Names): ActivityEvent {
  const v = recommendationView(r, names);
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
      id: `appr-end:${a.id}`, at: v.endedAt, actor: 'Fern', actorKind: 'norn', kind: 'changes_requested',
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
const STATUS_TEXT: Record<LineStatus, string> = { entered: 'Entered', drafted: 'Draft in ERPNext', to_enter: 'To enter in ERPNext', conflict: 'Conflict: entered differently from the package' };

/** The package row is not in a shape the page can read. Its reason is shown instead of a package. */
class Unreadable extends Error {}
const bad = (why: string): never => { throw new Unreadable(why); };

/** An optional array of strings: absent is empty, anything else that is not an array of strings is unreadable. */
function stringList(owner: any, key: string, where: string): string[] {
  const v = owner?.[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return bad(`${where}.${key} is not a list of text`);
  return v.filter((x: string) => x.trim() !== '');
}
/** An optional array of records. */
function objectList(owner: any, key: string, where: string): Record<string, any>[] {
  const v = owner?.[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some(x => !isObj(x))) return bad(`${where}.${key} is not a list of records`);
  return v;
}
const textOf = (v: unknown, what: string): string => (typeof v === 'string' ? v : bad(`${what} is not text`));

const fieldValue = (f: Record<string, any>): string => {
  if (f.value === null || f.value === undefined) return f.from ? `(made by ${String(f.from)})` : '(not set)';
  if (typeof f.value === 'number') return f.money ? f.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(f.value);
  return String(f.value);
};

function lineView(l: Record<string, any>, n: number, erpUrl: string): PackageLineView {
  const where = `line ${n + 1}`;
  const title = textOf(l.title, `${where} title`);
  const status: LineStatus = l.status === 'entered' ? 'entered' : l.status === 'drafted' ? 'drafted' : l.status === 'conflict' ? 'conflict' : l.status === 'to-enter' ? 'to_enter' : bad(`${where} has no known status`);
  const seat = typeof l.enteredBy === 'string' ? l.enteredBy : '';
  const found = isObj(l.found) && typeof l.found.doctype === 'string' && typeof l.found.name === 'string' ? l.found as { doctype: string; name: string } : undefined;
  const draft = status === 'drafted' && found && erpUrl
    ? {
        doctype: found.doctype, name: found.name,
        url: `${erpUrl.replace(/\/+$/, '')}/app/${found.doctype.toLowerCase().replace(/\s+/g, '-')}/${encodeURIComponent(found.name)}`,
        waitingFor: typeof l.person === 'string' && l.person ? `${l.person}${seat ? ` (${seat})` : ''}` : seat ? `the ${seat}` : 'a person',
      }
    : undefined;
  return {
    id: String(l.id ?? title), title, status, statusText: STATUS_TEXT[status], seat, ...(draft ? { draft } : {}),
    instruction: typeof l.instruction === 'string' ? l.instruction : '', doctype: typeof l.doctype === 'string' ? l.doctype : '',
    note: typeof l.note === 'string' && l.note ? l.note : undefined,
    fields: objectList(l, 'fields', where).map(f => ({ label: String(f.label ?? f.field ?? ''), value: fieldValue(f) })),
    tables: objectList(l, 'tables', where).map(t => ({
      label: String(t.label ?? t.table ?? ''),
      rows: (Array.isArray(t.rows) ? t.rows : bad(`${where} table rows are not a list`)).map((row: unknown) =>
        (Array.isArray(row) ? row : bad(`${where} has a table row that is not a list`)).filter(isObj).map((f: Record<string, any>) => `${String(f.label ?? f.field ?? '')} ${fieldValue(f)}`.trim()).join(' · ')).filter(Boolean),
    })),
  };
}

function parsedObject(json: string, what: string): Record<string, any> {
  const v = parse(json);
  return isObj(v) ? v : bad(`${what} is not a record`);
}

/**
 * Every problem the package has, from the three places the worker puts one, each said once. Throws Unreadable when
 * one of them is present and not a list of text.
 */
export function packageProblems(release: any, pkg: any, notes: any): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const p of stringList(pkg, 'problems', 'package')) add(p);
  for (const p of stringList(notes, 'problems', 'notes')) add(p);
  // A change the assessment costs but the package cannot carry out (labour hours, a zero price) is a problem even
  // when the planner did not repeat it: the package must never read as "nothing to enter" while the assessment costs it.
  for (const u of stringList(release, 'unsupported', 'release')) if (!out.some(p => p.includes(u))) add(`Not in this package: ${u}`);
  return out;
}

/** The mock marker: the notes may carry `mock` (text or true). Real packages never do. */
const mockOf = (notes: any): string | undefined => (notes?.mock === true ? 'Mock rows, not read from the ERP' : typeof notes?.mock === 'string' && notes.mock ? notes.mock : undefined);

function builtView(row: ErpPackageRow): PackageBuilt {
  const release = parsedObject(row.releaseJson, 'The release');
  const pkg = parsedObject(row.packageJson, 'The package');
  const notes = parsedObject(row.notesJson, 'The notes');
  if (!Array.isArray(pkg.lines)) bad('The package has no list of lines');
  const problems = packageProblems(release, pkg, notes);
  const raw = pkg.lines as unknown[];
  const erpUrl = typeof pkg.erpUrl === 'string' ? pkg.erpUrl : '';
  const all = raw.map((l, i) => lineView(isObj(l) ? l : bad(`line ${i + 1} is not a record`), i, erpUrl));
  // The row's own counts are what the module checked; the lines are what the page can show. When they disagree, say so.
  if (row.lines !== all.length) problems.push(`The package row counts ${row.lines} line${row.lines === 1 ? '' : 's'}, but ${all.length} could be read from it. Treat the list below as incomplete.`);
  const drafted = all.filter(l => l.status === 'drafted').length;
  const counts = { lines: row.lines, entered: row.entered, toEnter: Math.max(0, row.lines - row.entered - row.conflicts - drafted), conflicts: row.conflicts, problems: problems.length, drafted };
  const groups: PackageGroupView[] = [];
  const placed = new Set<PackageLineView>();
  for (const g of GROUPS) {
    const kept = all.filter((_, i) => g.kinds.includes((raw[i] as Record<string, any>).kind));
    kept.forEach(v => placed.add(v));
    if (kept.length) groups.push({ id: g.id, title: g.title, lines: kept, entered: kept.filter(l => l.status === 'entered').length });
  }
  const other = all.filter(v => !placed.has(v));
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
    // Only here: the package parsed, its lines are a real empty list, and it names no problem and no unsupported change.
    health = 'nothing';
    headline = 'The release changes nothing ERPNext holds, so there is nothing to enter.';
  } else if (counts.entered === counts.lines) {
    health = 'entered';
    headline = `All ${plural(counts.lines, 'line')} entered in ERPNext.`;
  } else {
    health = 'to_enter';
    headline = `${counts.entered} of ${plural(counts.lines, 'line')} entered${counts.drafted ? `, ${counts.drafted} drafted by Fern and waiting to be submitted` : ''}, ${counts.toEnter} to enter in ERPNext.`;
  }
  const effects = objectList(pkg, 'effects', 'package').map(e => ({ program: String(e.program ?? ''), name: String(e.name ?? ''), costDelta: Number(e.costDelta) || 0, basis: String(e.basis ?? '') }));
  return {
    state: 'built', ecoNumber: row.ecoNumber, health, headline, counts, problems,
    warnings: stringList(pkg, 'warnings', 'package'),
    effects, groups, notes: stringList(notes, 'notes', 'notes'), mock: mockOf(notes),
    builtAt: iso(row.builtAt), checkedAt: iso(row.updatedAt), erpRead: String(row.erpBaseline).slice(0, 8), system: 'ERPNext',
  };
}

/** The package as the card draws it; or, when the row is not readable, a state that says so and never reads as empty. */
/**
 * The problems that can be read when the row as a whole cannot. Each of the three places is recovered on its own, so
 * one malformed source does not hide what the others say.
 */
export function recoverProblems(row: ErpPackageRow): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  const from = (json: string, f: (o: Record<string, any>) => string[]) => {
    try {
      const o = parse(json);
      if (isObj(o)) f(o).forEach(add);
    } catch { /* this source is unreadable; the others still count */ }
  };
  from(row.packageJson, o => stringList(o, 'problems', 'package'));
  from(row.notesJson, o => stringList(o, 'problems', 'notes'));
  from(row.releaseJson, o => stringList(o, 'unsupported', 'release').filter(u => !out.some(p => p.includes(u))).map(u => `Not in this package: ${u}`));
  return out;
}

export function packageView(row: ErpPackageRow): PackageBuilt | PackageUnreadable {
  try {
    return builtView(row);
  } catch (e) {
    // Whatever problems can still be read are kept: they may be the reason a person has to act.
    const problems = recoverProblems(row);
    return {
      state: 'unreadable', ecoNumber: String(row.ecoNumber),
      why: e instanceof Unreadable ? e.message : `The package row could not be read (${e instanceof Error ? e.message : String(e)})`,
      rowLines: row.lines, rowEntered: row.entered, rowConflicts: row.conflicts, problems,
    };
  }
}

function packageFor(rows: GateRows, pr: GatePr): PackageView {
  const eco = rows.ecoReleases?.find(e => e.prId === pr.id);
  const row = rows.erpPackages?.find(p => p.prId === pr.id);
  if (row) return packageView(row);
  if (pr.status !== 'merged') {
    return { state: 'missing', code: 'not_released', why: `${pr.plmEcrNumber} is not released yet. Fern builds the ERP change package once its ECO is released.` };
  }
  if (!eco) {
    return { state: 'missing', code: 'no_eco_number', why: `${pr.plmEcrNumber} is released in Fern, but the PLM has not given its change order number yet. The package is built once it has.` };
  }
  return {
    state: 'missing', code: 'building',
    why: `${eco.ecoNumber} is released and the package is still building. A worker that reads the ERP builds it from the assessment and records it here.`,
  };
}

// ---------------------------------------------------------------- one ECR

/** A row that cannot be read is left out; one bad row must not take the page down. */
function each<T, U>(rows: T[], f: (r: T) => U): U[] {
  const out: U[] = [];
  for (const r of rows) {
    try { out.push(f(r)); } catch { /* skipped */ }
  }
  return out;
}

export function buildGate(rows: GateRows, pr: GatePr): GateView {
  try {
    return buildGateOf(rows, pr);
  } catch (e) {
    // Never throws out of buildAssessment: the page keeps its other parts, and the package says what happened.
    return {
      approvals: [], events: [],
      package: { state: 'unreadable', ecoNumber: '', why: `The gate's rows could not be read (${e instanceof Error ? e.message : String(e)})`, rowLines: 0, rowEntered: 0, rowConflicts: 0, problems: [] },
    };
  }
}

function buildGateOf(rows: GateRows, pr: GatePr): GateView {
  const mine = (rows.approvals ?? []).filter(a => a.prId === pr.id).sort((a, b) => Number(b.id - a.id));
  const names = namesFor(rows);
  const pairs = each(mine, a => ({ a, v: approvalView(a, names) }));
  const approvals = pairs.map(x => x.v);
  const events: ActivityEvent[] = pairs.flatMap(x => each([x], y => approvalEvents(y.a, y.v)).flat());

  const recs = (rows.recommendations ?? []).filter(r => r.prId === pr.id).sort((a, b) => Number(a.id - b.id));
  const recPairs = each(recs, r => ({ r, v: recommendationView(r, names) }));
  events.push(...each(recs, r => recommendationEvent(r, pr, names)));
  // Only a row made on the current revision speaks for the ECR as it is now; and not once an approval has followed it.
  const latest = recPairs.filter(x => x.r.prRevision === pr.revision).at(-1);
  const acted = latest && approvals.some(v => v.state !== 'withdrawn' && v.at >= latest.v.at);
  const recommendation = latest && !acted ? latest.v : undefined;

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
