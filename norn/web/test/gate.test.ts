// Checks for the gate and ERP-package builders, on hand-made rows:  npm test -w @norn/web
// Shapes follow module/src/schema.ts (approval, recommendation, eco_release, erp_package) and the
// ERPNext connector's package (connectors/erpnext/src/package.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAssessment, type PrRow, type ResultRow, type RunRow, type Snapshot } from '../src/assessment/live/build.ts';
import {
  RELEASE_BLOCKED, buildGate, packageProblems, packageView, roleWords,
  type ApprovalRow, type EcoReleaseRow, type ErpPackageRow, type RecommendationRow,
} from '../src/assessment/live/gate.ts';
import rows0417l3 from '../src/assessment/fixtures/ecr-0417.l3.json' with { type: 'json' };

const ts = (n: number) => ({ microsSinceUnixEpoch: BigInt(n) * 1_000_000n, toDate: () => new Date(n * 1000) });
const id = (h: string) => ({ toHexString: () => h });
const pr = (over: Partial<{ status: string; revision: number }> = {}) => ({ id: 1n, plmEcrNumber: 'ECR-0417', status: 'review', revision: 2, ...over });

const rec = (over: Partial<RecommendationRow> = {}): RecommendationRow => ({
  id: 1n, prId: 1n, prRevision: 2, action: 'approve_fast_track_ecr', outcome: 'recommend', recommenderKind: 'agent', recommenderName: 'norn-level1',
  recommenderOrigin: 'norn', onBehalfOf: undefined, reasons: [{ rule: 'approval.fastTrack.maxCost', text: 'The cost is above the 25,000 limit.' }],
  recipients: ['cm_analyst', 'cost_accountant'], awaitingSecondCheck: false, at: ts(100), ...over,
});
const appr = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: 1n, prId: 1n, prRevision: 2, kind: 'tier', bodyId: 'ccb', tierId: 'board', decisionJson: JSON.stringify({ route: { bodyName: 'Change Control Board' }, reasons: [{ rule: 'r', text: 'Within the board tier.' }] }),
  status: 'standing', pendingRecheck: false, approverKind: 'person', approverName: 'Rafael Quintero', approverOrigin: 'human', onBehalfOf: undefined,
  at: ts(200), endedAt: undefined, endedReason: '', ...over,
});

// A connector package: one standard cost entered, one journal entry still to enter.
const line = (kind: string, title: string, status: string) => ({
  id: `${kind}:${title}`, kind, title, enteredBy: 'cost accountant', doctype: 'Item Price', mode: 'new', path: '/app/item-price/new', instruction: `Enter ${title}.`, status,
  fields: [{ field: 'price_list_rate', label: 'Rate', value: 221, money: true }, { field: 'item', label: 'Item', value: null, from: 'bom:X' }], tables: [], amounts: {}, trace: {},
});
const pkgJson = (extra: object = {}, lines = [line('standard-cost', 'BW-5120-210 standard cost', 'entered'), line('journal-entry', 'Scrap on hand', 'to-enter')]) =>
  JSON.stringify({ version: 1, release: {}, erpUrl: 'x', readAt: 'y', lines, counts: { total: lines.length, entered: 1, toEnter: 1, conflict: 0 }, effects: [], warnings: [], problems: [], ...extra });
const pkgRow = (over: Partial<ErpPackageRow> = {}): ErpPackageRow => ({
  prId: 1n, ecoNumber: 'ECO-0319', s2RunId: 1n, erpBaseline: 'abcdef0123456789', releaseJson: '{}', packageJson: pkgJson(), lines: 2, entered: 1, conflicts: 0,
  notesJson: JSON.stringify({ notes: ['120 brackets on built aircraft are left to the retrofit.'], problems: [] }), builtAt: ts(300), updatedAt: ts(400), ...over,
});

test('a package with unsupported changes reads as problems, never as nothing to enter', () => {
  const unsupported = ['BW-5120-210 labor hours 0.5 -> 0.8: ERPNext holds labor as BOM operation time.', 'BW-7000-001 standard cost 4.00 -> 0.00: the package enters only standard costs above zero.'];
  // The planner repeated neither: the release's own list is still a problem.
  const v = packageView(pkgRow({ releaseJson: JSON.stringify({ unsupported }), packageJson: pkgJson({}, []), lines: 0, entered: 0 }));
  assert.equal(v.health, 'problems');
  assert.equal(v.counts.problems, 2);
  assert.equal(v.problems.length, 2);
  assert.match(v.problems[0], /labor hours/);
  assert.match(v.problems[1], /above zero/);
  assert.doesNotMatch(v.headline, /there is nothing to enter/);
  assert.match(v.headline, /2 problems/);
  assert.equal(v.groups.length, 0);
});

test('problems from the package, its notes and the release are each said once', () => {
  const unsupported = ['labor hours 1 -> 2'];
  const out = packageProblems({ unsupported }, { problems: ['not in this package: labor hours 1 -> 2', 'A price row is in the way.'] }, { problems: ['A price row is in the way.', 'No account is mapped.'] });
  assert.deepEqual(out, ['not in this package: labor hours 1 -> 2', 'A price row is in the way.', 'No account is mapped.']);
});

test('lines are grouped by kind, each with its status, and the counts come from the row', () => {
  const lines = [
    line('standard-cost', 'New standard cost', 'entered'), line('bom', 'New BOM version', 'to-enter'), line('bom-retire', 'Retire the old BOM', 'conflict'),
    line('journal-entry', 'Scrap on hand', 'to-enter'),
  ];
  const v = packageView(pkgRow({ packageJson: pkgJson({ warnings: ['The cost applies from 2026-11-01.'], effects: [{ program: 'Vesper', name: 'V4', costDelta: 3.5, basis: '1 x 3.50' }] }, lines), lines: 4, entered: 1, conflicts: 1 }));
  assert.deepEqual(v.groups.map(g => [g.title, g.lines.length, g.entered]), [['Standard costs', 1, 1], ['Bills of materials', 2, 0], ['Journal entries', 1, 0]]);
  assert.deepEqual(v.groups[1].lines.map(l => [l.status, l.statusText]), [['to_enter', 'To enter in ERPNext'], ['conflict', 'Conflict: entered differently from the package']]);
  assert.equal(v.groups[0].lines[0].statusText, 'Entered');
  assert.deepEqual(v.counts, { lines: 4, entered: 1, toEnter: 2, conflicts: 1, problems: 0 });
  assert.equal(v.health, 'conflict');
  assert.deepEqual(v.warnings, ['The cost applies from 2026-11-01.']);
  assert.equal(v.effects[0].costDelta, 3.5);
  assert.deepEqual(v.groups[0].lines[0].fields, [{ label: 'Rate', value: '221.00' }, { label: 'Item', value: '(made by bom:X)' }]);
  assert.equal(v.erpRead, 'abcdef01');
  assert.deepEqual(v.notes, ['120 brackets on built aircraft are left to the retrofit.']);
});

test('an empty package with no problems says there is nothing to enter; all entered says so', () => {
  const none = packageView(pkgRow({ packageJson: pkgJson({}, []), lines: 0, entered: 0 }));
  assert.equal(none.health, 'nothing');
  assert.match(none.headline, /nothing to enter/);
  const lines = [line('standard-cost', 'a', 'entered')];
  const done = packageView(pkgRow({ packageJson: pkgJson({}, lines), lines: 1, entered: 1 }));
  assert.equal(done.health, 'entered');
});

test('a package the page cannot read is flagged incomplete, not shown as empty', () => {
  // The record the offline checks leave has no lines array, only a count.
  const v = packageView(pkgRow({ packageJson: JSON.stringify({ check: true }), lines: 4, entered: 0 }));
  assert.equal(v.health, 'problems');
  assert.match(v.problems[0], /counts 4 lines, but 0 could be read/);
  assert.equal(packageView(pkgRow({ packageJson: 'not json', lines: 0, entered: 0 })).health, 'nothing');
});

test('without a package, the page says why: not released, no change order number, or still building', () => {
  const eco: EcoReleaseRow = { prId: 1n, ecoNumber: 'ECO-0319', recordedAt: ts(1) };
  const code = (p: { status: string }, rows: object) => {
    const v = buildGate(rows, pr(p)).package;
    return v.state === 'missing' ? v.code : 'built';
  };
  assert.equal(code({ status: 'approved' }, {}), 'not_released');
  assert.equal(code({ status: 'merged' }, {}), 'no_eco_number');
  assert.equal(code({ status: 'merged' }, { ecoReleases: [eco] }), 'building');
  assert.equal(code({ status: 'merged' }, { ecoReleases: [eco], erpPackages: [pkgRow()] }), 'built');
  const why = buildGate({ ecoReleases: [eco] }, pr({ status: 'merged' })).package;
  assert.ok(why.state === 'missing' && /ECO-0319/.test(why.why) && /still building/.test(why.why));
});

test('a recommendation for an old revision is superseded in the timeline and not shown in the box', () => {
  const old = rec({ id: 1n, prRevision: 1, at: ts(100) });
  const g = buildGate({ recommendations: [old] }, pr({ revision: 2 }));
  assert.equal(g.recommendation, undefined);
  assert.equal(g.events.length, 1);
  assert.equal(g.events[0].superseded, true);
  assert.match(g.events[0].detail!, /Superseded: made on revision 1, and the ECR is now on revision 2/);
  assert.equal(g.events[0].text, 'recommended approval');
  assert.equal(g.events[0].actor, 'Norn');
});

test('the newest recommendation on the current revision is the one in the box, with its reasons and recipients', () => {
  const rows = [rec({ id: 1n, prRevision: 1, at: ts(100) }), rec({ id: 2n, prRevision: 2, at: ts(150) }), rec({ id: 3n, prRevision: 2, at: ts(160), reasons: [{ rule: 'a', text: 'Newer reason.' }] })];
  const g = buildGate({ recommendations: rows }, pr({ revision: 2 }));
  assert.equal(g.recommendation!.id, '3');
  assert.equal(g.recommendation!.headline, 'Norn recommends approval');
  assert.deepEqual(g.recommendation!.reasons, [{ rule: 'a', text: 'Newer reason.' }]);
  assert.deepEqual(g.recommendation!.recipients, ['CM analyst', 'Cost accountant']);
  assert.deepEqual(g.events.map(e => [e.id, !!e.superseded]), [['rec:1', true], ['rec:2', false], ['rec:3', false]]);
});

test('a recommendation an approval has followed, or one held for a second check, reads accordingly', () => {
  const followed = buildGate({ recommendations: [rec({ at: ts(100) })], approvals: [appr({ at: ts(200) })] }, pr({ status: 'approved' }));
  assert.equal(followed.recommendation, undefined, 'the approval answers it');
  const withdrawn = buildGate({ recommendations: [rec({ at: ts(100) })], approvals: [appr({ at: ts(200), status: 'withdrawn', endedAt: ts(250), endedReason: 'its inputs changed' })] }, pr());
  assert.ok(withdrawn.recommendation, 'a withdrawn approval does not answer it');
  const held = buildGate({ recommendations: [rec({ outcome: 'sampled', awaitingSecondCheck: true })] }, pr());
  assert.match(held.recommendation!.headline, /would approve, but this one is held for a second check/);
  assert.equal(held.recommendation!.waitingForSecondCheck, true);
  const esc = buildGate({ recommendations: [rec({ outcome: 'escalate', recommenderName: "Jeff's agent", recommenderOrigin: 'external', onBehalfOf: 'Jeff Hargrove' })] }, pr());
  assert.equal(esc.recommendation!.headline, "Jeff's agent escalated this ECR");
  assert.equal(esc.recommendation!.whoKind, 'agent');
});

test('an approval pending a re-check is shown as such, and the release is refused with the reason', () => {
  const g = buildGate({ approvals: [appr({ pendingRecheck: true })] }, pr({ status: 'approved' }));
  assert.equal(g.approvals[0].state, 'pending_recheck');
  assert.equal(g.approvals[0].who, 'Rafael Quintero');
  assert.equal(g.approvals[0].role, 'Change Control Board');
  assert.equal(g.releaseBlock, RELEASE_BLOCKED);
  assert.equal(RELEASE_BLOCKED, 'Release is refused while an approval is pending a re-check');
  // Once the re-check is done, or the ECR is not approved, there is nothing to wait for.
  assert.equal(buildGate({ approvals: [appr()] }, pr({ status: 'approved' })).releaseBlock, undefined);
  assert.equal(buildGate({ approvals: [appr({ pendingRecheck: true })] }, pr({ status: 'review' })).releaseBlock, undefined);
});

test('approvals: who, role, state and when, newest first; withdrawn ones keep their reason and appear in the timeline', () => {
  const rows = [
    appr({ id: 1n, status: 'withdrawn', at: ts(100), endedAt: ts(150), endedReason: "the ECR's own revision changed" }),
    appr({ id: 2n, kind: 'fast_track', bodyId: 'fast_track', approverKind: 'agent', approverName: 'check-gate-agent', approverOrigin: 'norn', onBehalfOf: 'Dana Okafor', at: ts(200), decisionJson: JSON.stringify({ reasons: [{ rule: 'x', text: 'Class II, same supplier.' }, { rule: 'y', text: 'Within the cost limit.' }] }) }),
    appr({ id: 3n, status: 'released', at: ts(300), endedAt: ts(350), endedReason: 'released as baseline v2' }),
  ];
  const g = buildGate({ approvals: rows }, pr({ status: 'merged' }));
  assert.deepEqual(g.approvals.map(a => [a.id, a.state, a.released]), [['3', 'approved', true], ['2', 'approved', false], ['1', 'withdrawn', false]]);
  const ft = g.approvals[1];
  assert.deepEqual([ft.who, ft.whoKind, ft.role, ft.fastTrack, ft.onBehalfOf], ['Norn', 'norn', 'Fast track', true, 'Dana Okafor']);
  assert.equal(g.approvals[2].endedReason, "the ECR's own revision changed");
  const ev = Object.fromEntries(g.events.map(e => [e.id, e]));
  assert.equal(ev['appr:2'].text, 'approved this ECR on the fast track');
  assert.equal(ev['appr:2'].detail, 'Class II, same supplier. Within the cost limit.');
  assert.equal(ev['appr-end:1'].text, 'withdrew the approval by Rafael Quintero');
  assert.equal(ev['appr:1'], undefined, 'a person\'s tier approval is already a status-change entry');
});

test('the fast track outcome is the newest approval when it is a fast-track one that has not been withdrawn', () => {
  const ft = appr({ id: 2n, kind: 'fast_track', bodyId: 'fast_track', approverKind: 'agent', approverName: 'a', approverOrigin: 'norn', decisionJson: JSON.stringify({ reasons: [{ rule: 'x', text: 'Why.' }] }) });
  assert.equal(buildGate({ approvals: [ft] }, pr({ status: 'approved' })).fastTrack!.reasons[0].text, 'Why.');
  assert.equal(buildGate({ approvals: [{ ...ft, status: 'withdrawn', endedAt: ts(5) }] }, pr()).fastTrack, undefined);
  assert.equal(buildGate({ approvals: [appr()] }, pr({ status: 'approved' })).fastTrack, undefined);
  assert.equal(buildGate({ approvals: [ft, appr({ id: 3n })] }, pr({ status: 'approved' })).fastTrack, undefined, 'a later person approval is the head');
});

test('a role id is said in words', () => {
  assert.equal(roleWords('cm_analyst'), 'CM analyst');
  assert.equal(roleWords('technical_review'), 'Technical review');
  assert.equal(roleWords('ccb'), 'CCB');
});

test('the assessment carries the gate: its entries join the timeline and the package sits beside it', () => {
  const prRow: PrRow = { id: 1n, plmEcrNumber: 'ECR-0417', title: 't', description: 'd', status: 'approved', revision: 2, createdBy: id('aa'), createdAt: ts(1), updatedAt: ts(1) };
  const run: RunRow = { id: 1n, prId: 1n, stage: 's2_cost', status: 'done', note: '', createdAt: ts(10), finishedAt: ts(20) };
  const results: ResultRow[] = (rows0417l3 as { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string }[])
    .map((r, i) => ({ ...r, id: BigInt(i + 1), checkRunId: 1n, prId: 1n, mock: false }));
  const s: Snapshot = {
    prs: [prRow], revisions: [], runs: [run], results, statements: [], comments: [], actions: [], events: [], principals: [],
    approvals: [appr({ pendingRecheck: true })], recommendations: [rec({ prRevision: 1 })],
  };
  const out = buildAssessment(s, prRow)!;
  assert.equal(out.gate!.releaseBlock, RELEASE_BLOCKED);
  assert.equal(out.gate!.package.state, 'missing');
  const sup = out.activity.find(e => e.id === 'rec:1')!;
  assert.equal(sup.superseded, true);
  // A snapshot with none of the gate's tables (an older client) still builds.
  const bare = buildAssessment({ ...s, approvals: undefined, recommendations: undefined }, prRow)!;
  assert.deepEqual(bare.gate!.approvals, []);
  assert.equal(bare.gate!.recommendation, undefined);
});
