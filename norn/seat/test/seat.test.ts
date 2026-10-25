import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { costEngineerSeat as seat } from '../../../bowman/norn-config/seats/cost-engineer.ts';
import { costCheck } from '../../checks/src/index.ts';
import { parseReply } from '../src/answer.ts';
import { findGaps } from '../src/gaps.ts';
import { nextActions, type SeatState } from '../src/plan.ts';
import { routeGap } from '../src/route.ts';
import type { Gap, Person } from '../src/types.ts';

const people: Person[] = bowman.people.map((p) => ({ id: p.id, name: p.name, title: p.title, seat: p.seat, programs: (p as { programs?: string[] }).programs }));
const byId = (id: string) => people.find((p) => p.id === id)!;
const ecr = bowman.ecrs.find((e) => e.id === 'ECR-0417')!;
const cost = costCheck(bowman, ecr, { seed: 'norn-seed-1' });
const gaps = findGaps(seat, cost);
const originator = byId(ecr.originator);
const fresh = (): SeatState => ({ ecr: 'ECR-0417', program: ecr.program, originator, gaps, questions: [], replies: [], recorded: [], reminded: [], escalated: {}, followedUp: [] });

test('replies are read only when they hold one figure, a range, or an explicit zero', () => {
  assert.equal((parseReply('About $4,500 total.', 'usd') as { value: number }).value, 4500);
  assert.equal((parseReply('roughly 4.5k', 'usd') as { value: number }).value, 4500);
  const r = parseReply('$3,000 to $5,000 for all ten.', 'usd') as { low: number; high: number };
  assert.deepEqual([r.low, r.high], [3000, 5000]);
  assert.equal((parseReply('None, the retrofit test covers it.', 'usd') as { value: number }).value, 0);
  assert.equal(parseReply("I'd have to check.", 'usd').ok, false);
  assert.equal(parseReply('$3,000 for parts and $2,000 for labor', 'usd').ok, false);
  assert.equal((parseReply('We usually get 12% back.', 'share') as { value: number }).value, 0.12);
  assert.equal(parseReply('Maybe 150%', 'share').ok, false);
});

test("ECR-0417's gaps: the blank cost lines first, then material defaults", () => {
  assert.deepEqual(gaps.map((g) => g.kind), ['blank_row', 'blank_row', 'blank_row', 'default']);
  assert.ok(gaps.every((g) => g.kind === 'blank_row' || (g.swing ?? 0) >= seat.materialityUsd));
});

test('each gap goes to the seat that owns that kind of number', () => {
  const to = (label: string) => routeGap(seat, { inputId: 'x', label, kind: 'blank_row', swing: null, unit: 'usd' } as Gap, people, { originator, program: ecr.program })!.to.seat;
  assert.equal(to('Re-inspection and test after retrofit'), 'quality');
  assert.equal(to('Delay cost of holding S/N 011-014 at the controller-install station'), 'production_planner');
  assert.equal(to('Installation labor, 12 h per aircraft'), 'manufacturing_engineer');
  assert.equal(to('BW-5120-210: share of scrapped value recovered'), 'buyer');
  assert.equal(to('Something nobody owns'), 'originator' === 'originator' ? originator.seat : '');
});

test('the seat asks each gap once, records an answer and re-runs the checks', () => {
  const s = fresh();
  const asks = nextActions(seat, people, s, '2026-10-24T09:00:00Z').filter((a) => a.kind === 'ask');
  assert.equal(asks.length, gaps.length);
  for (const a of asks) if (a.kind === 'ask') s.questions.push(a.question);
  assert.equal(nextActions(seat, people, s, '2026-10-24T10:00:00Z').length, 0);
  const q = s.questions[0];
  s.replies.push({ inputId: q.gap.inputId, from: q.to, text: '$3,000 to $5,000', at: '2026-10-24T11:00:00Z' });
  const acts = nextActions(seat, people, s, '2026-10-24T11:05:00Z');
  const rec = acts.find((a) => a.kind === 'record');
  assert.ok(rec && rec.kind === 'record' && rec.override.id === q.gap.inputId && rec.override.by === q.to.name);
  assert.ok(acts.some((a) => a.kind === 'rerun'));
  const after = costCheck(bowman, ecr, { seed: 'norn-seed-1', assumptions: rec.kind === 'record' ? [rec.override] : [] });
  assert.ok(after.headline.oneTimeTotal.p50 > cost.headline.oneTimeTotal.p50 + 3000);
});

test('silence gets a reminder at 24 hours, then escalations that skip the person asked', () => {
  const s = fresh();
  for (const a of nextActions(seat, people, s, '2026-10-24T09:00:00Z')) if (a.kind === 'ask') s.questions.push(a.question);
  const at25 = nextActions(seat, people, s, '2026-10-25T10:00:00Z');
  assert.equal(at25.filter((a) => a.kind === 'remind').length, gaps.length);
  for (const a of at25) if (a.kind === 'remind') s.reminded.push(a.question.gap.inputId);
  const at49 = nextActions(seat, people, s, '2026-10-26T10:00:00Z').filter((a) => a.kind === 'escalate');
  assert.equal(at49.length, gaps.length);
  for (const a of at49) if (a.kind === 'escalate') {
    assert.notEqual(a.to.id, a.question.to.id);
    assert.match(a.body, /Situation: .* Background: .* Assessment: .* Recommendation: /);
    s.escalated[a.question.gap.inputId] = a.level;
  }
  const at73 = nextActions(seat, people, s, '2026-10-27T10:00:00Z').filter((a) => a.kind === 'escalate');
  assert.ok(at73.length > 0 && at73.every((a) => a.kind === 'escalate' && a.to.seat === 'ccb_chair'));
});

test('a reply with no figure gets one follow-up, then the clock restarts from the reply', () => {
  const s = fresh();
  for (const a of nextActions(seat, people, s, '2026-10-24T09:00:00Z')) if (a.kind === 'ask') s.questions.push(a.question);
  const q = s.questions[1];
  s.replies.push({ inputId: q.gap.inputId, from: q.to, text: 'Let me check with the team.', at: '2026-10-24T12:00:00Z' });
  const f = nextActions(seat, people, s, '2026-10-24T12:05:00Z').filter((a) => a.kind === 'follow_up');
  assert.equal(f.length, 1);
  s.followedUp.push(q.gap.inputId);
  const later = nextActions(seat, people, s, '2026-10-25T10:00:00Z').filter((a) => a.kind !== 'ask' && 'question' in a && a.question.gap.inputId === q.gap.inputId);
  assert.equal(later.length, 0, '22 hours after the reply: nothing due yet');
});
