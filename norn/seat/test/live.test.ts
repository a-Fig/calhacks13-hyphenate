// The live half of the seat: state from comments, reply matching, and the reducer arguments. No database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costEngineerSeat as seat } from '../../../bowman/norn-config/seats/cost-engineer.ts';
import { costCheck } from '../../checks/src/index.ts';
import { costCheckRows } from '../../checks/src/rows.ts';
import { chase, parseOffset } from '../src/chase.ts';
import { findGaps } from '../src/gaps.ts';
import { gapsFromDetail, type StoredComment } from '../src/state.ts';
import { anchorFor, parseAnchor } from '../src/thread.ts';
import type { Person } from '../src/types.ts';

const people: Person[] = bowman.people.map((p) => ({ id: p.id, name: p.name, title: p.title, seat: p.seat, programs: (p as { programs?: string[] }).programs }));
const ecr = bowman.ecrs.find((e) => e.id === 'ECR-0417')!;
const originator = people.find((p) => p.id === ecr.originator)!;
const cost = costCheck(bowman, ecr, { seed: 'norn-seed-1' });
const detailJson = costCheckRows(cost).find((r) => r.key === 'detail')!.detailJson;
const gaps = gapsFromDetail(seat, detailJson);
const T0 = '2026-10-25T09:00:00Z';
const at = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString();
const base = { prId: 7n, ecr: 'ECR-0417', program: ecr.program, originator, gaps, givenKeys: [] as string[], revisions: {} as Record<string, number> };

/** What the worker would have written for these calls, as stored comments. */
function stored(calls: ReturnType<typeof chase>['calls'], h: number, from = 0): StoredComment[] {
  return calls.filter((c) => c.call.reducer === 'add_comment').map((c, i) => {
    const a = (c.call as { args: { anchor: string; body: string } }).args;
    return { id: from + i + 1, author: 'seat', anchor: a.anchor, body: a.body, at: at(h) };
  });
}

test('anchors round-trip, including input ids that hold colons', () => {
  for (const a of [
    { kind: 'ask', personId: 'EMP-12', inputId: 'cost:ECR-0417:other:reinspection' },
    { kind: 'escalate', level: 1, personId: 'EMP-04', inputId: 'recovery:BW-5120-210' },
    { kind: 'record', inputId: 'cost:ECR-0417:other:x' },
    { kind: 'reply', personId: 'EMP-12', inputId: 'a:b:c' },
  ] as const) assert.deepEqual(parseAnchor(anchorFor(a)), a);
  assert.equal(parseAnchor('check_run:7'), undefined);
});

test('the gaps read from the stored detail row are the gaps of a fresh run', () => {
  const fresh = findGaps(seat, cost);
  assert.ok(fresh.length >= 3);
  assert.deepEqual(gaps.map((g) => g.inputId).sort(), fresh.map((g) => g.inputId).sort());
  assert.deepEqual(gaps.filter((g) => g.kind === 'default').map((g) => g.inputId), fresh.filter((g) => g.kind === 'default').map((g) => g.inputId));
});

test('first look asks once per gap; a restart with those comments asks nothing more', () => {
  const first = chase(seat, people, { ...base, comments: [] }, at(0));
  const asks = first.calls.filter((c) => c.action.kind === 'ask');
  assert.equal(asks.length, gaps.length);
  assert.equal(new Set(asks.map((c) => (c.call as { args: { anchor: string } }).args.anchor)).size, asks.length);
  const comments = stored(first.calls, 0);
  const again = chase(seat, people, { ...base, comments }, at(1));
  assert.equal(again.calls.length, 0);
  // the same look before the cache shows the comments: in flight anchors stop a second ask
  const inFlight = new Set(comments.map((c) => c.anchor));
  assert.equal(chase(seat, people, { ...base, comments: [], inFlight }, at(1)).calls.length, 0);
});

test('a reply to the question is matched by its anchor and recorded as a given assumption by the person', () => {
  const first = chase(seat, people, { ...base, comments: [] }, at(0));
  const q = first.calls.find((c) => c.action.kind === 'ask' && /re-?inspect/i.test((c.action as { question: { gap: { label: string } } }).question.gap.label))!;
  assert.ok(q, 'Quality is asked about re-inspection');
  const ask = (q.call as { args: { anchor: string } }).args.anchor;
  const { inputId, personId } = parseAnchor(ask)!;
  const comments: StoredComment[] = [
    ...stored(first.calls, 0),
    { id: 99, author: 'web', authorName: 'Visitor 4', anchor: anchorFor({ kind: 'reply', personId, inputId }), body: 'Roughly $3,000 to $5,000 for all ten.', at: at(4) },
  ];
  const next = chase(seat, people, { ...base, comments, revisions: { [inputId]: 0 } }, at(5));
  const rec = next.calls.find((c) => c.call.reducer === 'record_assumption')!;
  assert.ok(rec);
  const args = (rec.call as { args: Record<string, unknown> }).args;
  assert.equal(args.key, inputId);
  assert.equal(args.source, 'given');
  assert.equal(args.prId, 7n);
  assert.equal(args.expectedRev, 0);
  assert.deepEqual(args.affects, ['s2_cost']);
  const dist = JSON.parse(args.distJson as string);
  assert.equal(dist.kind, 'lognormal');
  assert.ok(Math.abs(dist.median - Math.sqrt(3000 * 5000)) < 1);
  assert.match(args.rationale as string, /Beatriz Nowak/);
  assert.match(args.rationale as string, /Typed by Visitor 4 through the demo sign-in as Beatriz Nowak/);
  // other questions are not affected, and nothing is asked again
  assert.equal(next.calls.filter((c) => c.action.kind === 'ask').length, 0);
  // once the assumption is stored, the answer is not recorded a second time
  const done = chase(seat, people, { ...base, comments, givenKeys: [inputId] }, at(6));
  assert.equal(done.calls.filter((c) => c.call.reducer === 'record_assumption').length, 0);
});

test('a reply with no figure gets one follow-up, not one per look', () => {
  const first = chase(seat, people, { ...base, comments: [] }, at(0));
  const { inputId, personId } = parseAnchor((first.calls[0].call as { args: { anchor: string } }).args.anchor)!;
  const reply: StoredComment = { id: 50, author: 'web', anchor: anchorFor({ kind: 'reply', personId, inputId }), body: "I'd have to check.", at: at(2) };
  const a = chase(seat, people, { ...base, comments: [...stored(first.calls, 0), reply] }, at(3));
  const fu = a.calls.filter((c) => c.action.kind === 'follow_up');
  assert.equal(fu.length, 1);
  const b = chase(seat, people, { ...base, comments: [...stored(first.calls, 0), reply, ...stored(fu, 3, 60)] }, at(4));
  assert.equal(b.calls.filter((c) => c.action.kind === 'follow_up').length, 0);
});

test('reminders and escalations come from the real clock, or a shifted demo clock, once each', () => {
  const first = chase(seat, people, { ...base, comments: [] }, at(0));
  let comments = stored(first.calls, 0);
  assert.equal(chase(seat, people, { ...base, comments }, at(10)).calls.length, 0);
  const r = chase(seat, people, { ...base, comments, demoClock: '+25h' }, at(25));
  assert.equal(r.calls.filter((c) => c.action.kind === 'remind').length, gaps.length);
  assert.ok(r.calls.every((c) => (c.call as { args: { body: string } }).args.body.endsWith('(demo clock +25h)')));
  comments = [...comments, ...stored(r.calls, 25, 100)];
  assert.equal(chase(seat, people, { ...base, comments }, at(26)).calls.length, 0);
  const e = chase(seat, people, { ...base, comments }, at(49));
  const esc = e.calls.filter((c) => c.action.kind === 'escalate');
  assert.equal(esc.length, gaps.length);
  assert.match((esc[0].call as { args: { anchor: string } }).args.anchor, /^seat:escalate:\d+:EMP-\d+:/);
  comments = [...comments, ...stored(e.calls, 49, 200)];
  assert.equal(chase(seat, people, { ...base, comments }, at(50)).calls.filter((c) => c.action.kind === 'escalate').length, 0);
});

test('the demo clock shift is parsed, and a bad one is refused', () => {
  assert.equal(parseOffset('+25h'), 25 * 3_600_000);
  assert.equal(parseOffset('90m'), 90 * 60_000);
  assert.equal(parseOffset('+2d'), 2 * 86_400_000);
  assert.throws(() => parseOffset('tomorrow'));
});
