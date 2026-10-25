// Who is named on an ECR page (#146): the PLM gives a login, the dataset an employee id.  npm test -w @norn/web
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { personOf } from '../src/assessment/live/directory.ts';

test('an employee id and a PLM login both name the person', () => {
  assert.equal(personOf('EMP-02'), 'Dana Okafor');
  assert.equal(personOf('dana.okafor@bowman-aviation.example'), 'Dana Okafor');
  assert.equal(personOf('weilin.zhao@bowman-aviation.example'), 'Wei-Lin Zhao', 'the address drops the hyphen; the match is on letters only');
});

test('a login that matches nobody is shown as it is, and none is blank', () => {
  assert.equal(personOf('cm-bot@bowman-aviation.example'), 'cm-bot@bowman-aviation.example');
  assert.equal(personOf('EMP-99'), 'EMP-99');
  assert.equal(personOf(undefined), '');
  assert.equal(personOf(''), '');
});
