// The Level 1 settings that decide whether the dispatcher waits for the research worker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsFromEnv } from './settings.ts';

test('the dispatcher does not wait for research unless told to, and the wait defaults to ten minutes', () => {
  const s = settingsFromEnv({});
  assert.equal(s.waitForResearch, false);
  assert.equal(s.researchWaitMs, 600_000);
  assert.deepEqual(s.researchEcrs, []);
  assert.equal(settingsFromEnv({ NORN_L1_WAIT_FOR_RESEARCH: 'true' }).waitForResearch, false, 'only 1 turns it on, like NORN_PUBLISH_COMMENT');
});

test('NORN_L1_WAIT_FOR_RESEARCH=1 turns the wait on; its length and ECR list are configurable', () => {
  const s = settingsFromEnv({ NORN_L1_WAIT_FOR_RESEARCH: '1', NORN_L1_RESEARCH_WAIT_MS: '90000', NORN_L1_RESEARCH_ECRS: 'ECR-0417, ECR-0423,' });
  assert.equal(s.waitForResearch, true);
  assert.equal(s.researchWaitMs, 90_000);
  assert.deepEqual(s.researchEcrs, ['ECR-0417', 'ECR-0423']);
  assert.equal(settingsFromEnv({ NORN_L1_RESEARCH_WAIT_MS: 'soon' }).researchWaitMs, 600_000, 'an unreadable value falls back');
});
