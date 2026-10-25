// A stored actor name reads as a person would say it; the raw name stays available.  npm test -w @norn/web
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLabel, displayActor, rawActor } from '../src/assessment/live/actors.ts';

test('an agent actor id becomes "Fern <role> agent"', () => {
  assert.equal(displayActor('agent:norn/level1/l1-ECR-0417-r1-e1-a1'), 'Fern Level 1 agent');
  assert.equal(displayActor('agent:norn/research/ECR-0417'), 'Fern research agent');
  assert.equal(displayActor('agent:norn/ask/ECR-0417/abc'), 'Fern ask agent');
});

test('the research worker name and other norn-prefixed names say Fern', () => {
  assert.equal(displayActor('norn research agent (cost engineer)'), 'Fern research agent (cost engineer)');
  assert.equal(displayActor('norn-scheduler'), 'Fern scheduler');
});

test('people, outside agents and names that already say Fern are unchanged, with no raw tooltip', () => {
  for (const n of ['Dana Okafor', 'agent:wei-lin.zhao/claude', 'Fern · CM analyst', 'Fern', 'Nornberg']) {
    assert.equal(displayActor(n), n);
    assert.equal(rawActor(n), undefined);
  }
});

test('the raw name is kept when the display differs', () => {
  assert.equal(rawActor('agent:norn/level1/x'), 'agent:norn/level1/x');
});

test('a run of agent events is labelled from its role', () => {
  assert.equal(agentLabel('level1-statement'), 'Fern Level 1 statement agent');
  assert.equal(agentLabel('researcher'), 'Fern researcher agent');
});
