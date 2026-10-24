// Run: node --test (from norn/config)
// Loads Bowman's file, then breaks copies of it one way at a time and checks that the message
// names the field to fix.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { company } from '../../../bowman/data/company.ts';
import { run } from '../src/cli.ts';
import { COMPANY_CONFIG_KEY, canonicalJson, configEntries, formatIssue, loadConfigFile, validateConfig, type CompanyConfig } from '../src/index.ts';

const BOWMAN = fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

let good: CompanyConfig;
before(async () => {
  const loaded = await loadConfigFile(BOWMAN);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map(formatIssue).join('\n'));
  good = loaded.config;
});

/** Validates a copy of Bowman's config after `change`, and returns one line per problem. */
function problems(change: (c: any) => void): string[] {
  const copy = structuredClone(good) as any;
  change(copy);
  const result = validateConfig(copy);
  return result.ok ? [] : result.issues.map(formatIssue);
}

/** Asserts that exactly one problem was found, at `path`, with a message containing `text`. */
function assertOne(change: (c: any) => void, path: string, text: string): void {
  const found = problems(change);
  assert.equal(found.length, 1, `expected one problem, got:\n${found.join('\n')}`);
  assert.ok(found[0]!.startsWith(`${path}: `), `expected the problem at ${path}, got: ${found[0]}`);
  assert.ok(found[0]!.includes(text), `expected "${text}" in: ${found[0]}`);
}

describe("Bowman's file", () => {
  it('loads and validates', () => {
    assert.equal(good.company.currency, 'USD');
    assert.equal(good.approval.tiers.length, 3);
    assert.equal(good.people.length, 18);
  });

  it('takes its policy and people from the dataset', () => {
    const tiers = company.changeControl.approvalTiers.map((t) => (t.upToUsd >= Number.MAX_SAFE_INTEGER ? null : t.upToUsd));
    assert.deepEqual(good.approval.tiers.map((t) => t.upToUsd), tiers);
    assert.deepEqual(good.approval.tiers.map((t) => t.upToUsd).slice(0, 2), [150_000, 2_000_000]);
    assert.deepEqual(good.approval.bodies.find((b) => b.id === 'ccb')?.meetings, company.changeControl.ccbMeetings);
    assert.equal(good.approval.neverFastTrack.length, company.changeControl.neverFastTrack.length);
  });

  it('gives every action an explicit autonomy rule', () => {
    assert.equal(good.autonomy.actions.length, 12);
  });

  it('passes the CLI with exit code 0 and prints a summary', async () => {
    const out: string[] = [];
    const err: string[] = [];
    assert.equal(await run([BOWMAN], (l) => out.push(l), (l) => err.push(l)), 0);
    assert.equal(err.length, 0);
    assert.ok(out[0]!.endsWith(': valid'));
    assert.ok(out.some((l) => l.includes('autonomy')));
  });
});

describe('a malformed file is rejected with the path of the bad field', () => {
  it('a missing section', () => {
    assertOne((c) => delete c.approval, 'approval', 'required section, but missing');
  });

  it('a missing field', () => {
    assertOne((c) => delete c.company.currency, 'company.currency', 'required, but missing');
  });

  it('a wrong type', () => {
    assertOne((c) => (c.approval.tiers[0].upToUsd = '150000'), 'approval.tiers[0].upToUsd', 'expected a number of at least 0, got "150000"');
  });

  it('tiers out of order', () => {
    const found = problems((c) => (c.approval.tiers[1].upToUsd = 90_000));
    assert.deepEqual(found, ['approval.tiers[1].upToUsd: expected a number above tiers[0].upToUsd (150000), got 90000']);
  });

  it('a last tier that has a limit', () => {
    assertOne((c) => (c.approval.tiers[2].upToUsd = 5_000_000), 'approval.tiers[2].upToUsd', 'expected null');
  });

  it('a tier with no limit before the last', () => {
    assertOne((c) => (c.approval.tiers[0].upToUsd = null), 'approval.tiers[0].upToUsd', 'only the last tier has no limit');
  });

  it('a tier that names a body that does not exist', () => {
    assertOne((c) => (c.approval.tiers[1].body = 'ccc'), 'approval.tiers[1].body', '"ccc"');
  });

  it('an unknown autonomy level, with a suggestion', () => {
    assertOne((c) => (c.autonomy.actions[0].level = 'approve-sampled'), 'autonomy.actions[0].level', 'did you mean "approve_sampled"?');
  });

  it('a person id that does not exist', () => {
    assertOne((c) => (c.people[3].reportsTo = 'EMP-99'), 'people[3].reportsTo', 'expected a person defined in this file');
  });

  it('a person in a role that does not exist', () => {
    assertOne((c) => (c.people[0].role = 'wizard'), 'people[0].role', 'expected a role defined in this file');
  });

  it('a duplicate id', () => {
    const found = problems((c) => (c.people[5].id = c.people[0].id));
    assert.deepEqual(found, ['people[5].id: duplicate id "EMP-01", already used at people[0].id']);
  });

  it('a reporting line that loops', () => {
    const found = problems((c) => {
      c.people[0].reportsTo = 'EMP-05'; // EMP-05 already reports to EMP-01
    });
    assert.equal(found.length, 1);
    assert.ok(found[0]!.startsWith('people[0].reportsTo: '));
    assert.ok(found[0]!.includes('loops back'));
  });

  it('a typo in a field name, which also leaves the real field missing', () => {
    const found = problems((c) => {
      c.approval.tires = c.approval.tiers;
      delete c.approval.tiers;
    });
    assert.deepEqual(found.sort(), ['approval.tiers: required, but missing', 'approval.tires: unknown field (did you mean "tiers"?)']);
  });

  it('a role that cannot do what the body needs of it', () => {
    const cfo = (c: any) => c.roles.find((r: any) => r.id === 'cfo');
    const found = problems((c) => (cfo(c).can = ['review_ecr']));
    assert.equal(found.length, 1);
    assert.ok(found[0]!.startsWith('approval.bodies[2].chairRole: '));
    assert.ok(found[0]!.includes('approve_ecr_at_tier'));
  });

  it('an action with no autonomy rule', () => {
    assertOne((c) => c.autonomy.actions.pop(), 'autonomy.actions', 'expected a rule for "post_journal_entry"');
  });

  it('a sampled level with no sample rate', () => {
    const at = (c: any) => c.autonomy.actions.findIndex((a: any) => a.action === 'write_bom');
    const found = problems((c) => delete c.autonomy.actions[at(c)].sampleRate);
    assert.equal(found.length, 1);
    assert.ok(found[0]!.includes('.sampleRate: expected a sample rate'));
  });

  it('a fallback level more autonomous than the level it falls back from', () => {
    const at = (c: any) => c.autonomy.actions.findIndex((a: any) => a.action === 'update_standard_cost');
    const found = problems((c) => (c.autonomy.actions[at(c)].level = 'recommend'));
    assert.ok(found.some((p) => p.includes('.limits: expected no limits')), found.join('\n'));
  });

  it('an escalation with nobody to escalate to', () => {
    const at = (c: any) => c.autonomy.actions.findIndex((a: any) => a.action === 'set_company_class');
    const found = problems((c) => delete c.autonomy.actions[at(c)].escalateTo);
    assert.equal(found.length, 1);
    assert.ok(found[0]!.includes('.escalateTo: expected the role to escalate to'));
  });

  it('a sample rate out of range', () => {
    const at = (c: any) => c.autonomy.actions.findIndex((a: any) => a.action === 'write_bom');
    const found = problems((c) => (c.autonomy.actions[at(c)].sampleRate = 1.5));
    assert.equal(found.length, 1);
    assert.ok(found[0]!.includes('.sampleRate: expected a number above 0 and up to 1, got 1.5'));
  });

  it('an ECR form without a field Norn reads', () => {
    const found = problems((c) => {
      c.ecrForm.sections[3].fields = [{ id: 'when', label: 'When', kind: 'date', required: 'submit' }];
    });
    assert.deepEqual(found, ['ecrForm.sections: expected a field of kind "effectivity", because Norn\'s checks read it, got none']);
  });

  it('a choice field with no options', () => {
    assertOne((c) => (c.ecrForm.sections[0].fields[0].kind = 'choice'), 'ecrForm.sections[0].fields[0].options', 'because kind is "choice"');
  });

  it('a field asked for a class that does not exist', () => {
    assertOne((c) => (c.ecrForm.sections[1].fields[2].askedFor = ['III']), 'ecrForm.sections[1].fields[2].askedFor[0]', 'expected a company class');
  });

  it('a fast-track test that names a class that does not exist', () => {
    assertOne((c) => (c.approval.fastTrack.requireAll[0].whenClass.value = 'III'), 'approval.fastTrack.requireAll[0].whenClass.value', 'expected a company class');
  });

  it('a likelihood scale with a gap', () => {
    assertOne((c) => (c.postingStandards.likelihoodScale[2].fromPct = 25), 'postingStandards.likelihoodScale[2].fromPct', 'expected 20, where "very unlikely" ends');
  });

  it('a missing evidence class', () => {
    assertOne((c) => c.postingStandards.evidenceClasses.pop(), 'postingStandards.evidenceClasses', 'expected a label for "judgment"');
  });

  it('a deep review limit that is not a positive whole number', () => {
    assertOne((c) => (c.reviewDepth.deepReview.maxPasses = 0), 'reviewDepth.deepReview.maxPasses', 'expected a whole number from 1 to 10, got 0');
    assertOne((c) => (c.reviewDepth.deepReview.maxPasses = 1.5), 'reviewDepth.deepReview.maxPasses', 'got 1.5');
  });

  it('an unsupported schema version', () => {
    assertOne((c) => (c.schemaVersion = 2), 'schemaVersion', 'expected one of 1, got 2');
  });

  it('reports every error, not only the first', () => {
    const found = problems((c) => {
      delete c.approval;
      c.company.currency = 'dollars';
      c.people[3].reportsTo = 'EMP-99';
      c.autonomy.actions[0].level = 'maybe';
      c.materiality.unitCost.absoluteUsd = -1;
    });
    assert.equal(found.length, 5, found.join('\n'));
    for (const path of ['approval', 'company.currency', 'people[3].reportsTo', 'autonomy.actions[0].level', 'materiality.unitCost.absoluteUsd']) {
      assert.ok(found.some((p) => p.startsWith(`${path}: `)), `no problem reported at ${path}:\n${found.join('\n')}`);
    }
  });

  it('is not an object', () => {
    const result = validateConfig('hello');
    assert.ok(!result.ok);
    assert.equal(formatIssue(result.issues[0]!), '(file): expected an object with the company\'s configuration, got "hello"');
  });
});

describe('the loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norn-config-'));
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };

  it('says so when the file is missing', async () => {
    const result = await loadConfigFile(join(dir, 'nope.ts'));
    assert.ok(!result.ok);
    assert.ok(result.issues[0]!.message.includes('no such file'));
  });

  it('says so when the file has no default export', async () => {
    const result = await loadConfigFile(file('none.mjs', 'export const x = 1;'));
    assert.ok(!result.ok);
    assert.ok(result.issues[0]!.message.includes('no default export'));
  });

  it('says so when the file does not load', async () => {
    const result = await loadConfigFile(file('throws.mjs', 'throw new Error("boom");'));
    assert.ok(!result.ok);
    assert.ok(result.issues[0]!.message.includes('boom'));
  });

  it('says so when a JSON file is not JSON', async () => {
    const result = await loadConfigFile(file('bad.json', '{ nope'));
    assert.ok(!result.ok);
    assert.ok(result.issues[0]!.message.includes('not valid JSON'));
  });

  it('exits 1 and lists every problem through the CLI', async () => {
    const copy = structuredClone(good) as any;
    delete copy.approval;
    copy.company.currency = 'dollars';
    const path = file('broken.json', JSON.stringify(copy));
    const err: string[] = [];
    const out: string[] = [];
    assert.equal(await run([path], (l) => out.push(l), (l) => err.push(l)), 1);
    assert.equal(out.length, 0);
    assert.ok(err[0]!.endsWith(': 2 problems'));
    assert.ok(err.some((l) => l.includes('approval: required section, but missing')));
    assert.ok(err.some((l) => l.includes('company.currency: ')));
  });

  it('exits 2 on a bad command line', async () => {
    const err: string[] = [];
    assert.equal(await run([], () => {}, (l) => err.push(l)), 2);
    assert.ok(err[0]!.startsWith('usage: '));
  });

  it('loads what it wrote: the canonical JSON validates again', async () => {
    const path = file('round-trip.json', canonicalJson(good));
    const result = await loadConfigFile(path);
    assert.ok(result.ok, result.ok ? '' : result.issues.map(formatIssue).join('\n'));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the output for set_config', () => {
  it('canonical JSON does not depend on key order and leaves out unset fields', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: null } }), '{"a":{"c":null,"d":[2,{"z":1}]},"b":1}');
    assert.equal(canonicalJson(good), canonicalJson(JSON.parse(canonicalJson(good))));
  });

  it('gives the whole config and the knobs that already exist', () => {
    const entries = configEntries(good);
    assert.deepEqual(entries.map((e) => e.key), [COMPANY_CONFIG_KEY, 'deep_review_mode', 'deep_review_limit']);
    assert.deepEqual(JSON.parse(entries[0]!.value), JSON.parse(JSON.stringify(good)));
    assert.deepEqual(entries.slice(1), [
      { key: 'deep_review_mode', value: 'on_request' },
      { key: 'deep_review_limit', value: '2' },
    ]);
  });

  it('shapes values the way the reducer checks them', () => {
    const [, mode, limit] = configEntries(good);
    assert.ok(['on_request', 'auto'].includes(mode!.value));
    assert.match(limit!.value, /^[1-9]\d{0,8}$/);
  });

  it('prints the pairs with --json', async () => {
    const out: string[] = [];
    assert.equal(await run([BOWMAN, '--json'], (l) => out.push(l), () => {}), 0);
    assert.deepEqual(JSON.parse(out.join('\n')), configEntries(good));
  });
});

describe('Norn stays general', () => {
  it('names no company in its source', () => {
    for (const name of readdirSync(SRC)) {
      assert.ok(!/bowman/i.test(readFileSync(join(SRC, name), 'utf8')), `${name} names a company`);
    }
  });
});
