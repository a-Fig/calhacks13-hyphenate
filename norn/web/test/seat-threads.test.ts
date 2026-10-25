// How the seat's comments are grouped into threads on the ECR page.  npm test -w @norn/web
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seatThreadsOf } from '../src/screens/seatThreads.ts';
import { anchorFor } from '../../seat/src/thread.ts';
import type { ActivityEvent } from '../src/assessment/types.ts';

const ev = (id: number, at: string, anchor: string, detail = 'x'): ActivityEvent => ({ id: `comment:${id}`, at, actor: 'A', actorKind: 'person', kind: 'comment', text: 'commented', detail, anchor });
const I = 'cost:ECR-0417:other:x';
const ask = ev(1, '2026-10-25T09:00:00Z', anchorFor({ kind: 'ask', personId: 'EMP-12', inputId: I }));
const reply = ev(2, '2026-10-25T10:00:00Z', anchorFor({ kind: 'reply', personId: 'EMP-12', inputId: I }));
const note = ev(3, '2026-10-25T10:01:00Z', anchorFor({ kind: 'record', inputId: I }));
const plain = ev(4, '2026-10-25T09:30:00Z', '');

test('the question, its reply and the recorded note form one thread; a plain comment stays out', () => {
  const { threads, others } = seatThreadsOf([note, plain, reply, ask]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].inputId, I);
  assert.deepEqual(threads[0].after.map((i) => i.a.kind), ['reply', 'record']);
  assert.equal(threads[0].recorded, true);
  assert.deepEqual(others, [plain]);
});

test('a reply whose question is not on the ECR is shown as a plain comment', () => {
  const { threads, others } = seatThreadsOf([reply]);
  assert.equal(threads.length, 0);
  assert.deepEqual(others, [reply]);
});
