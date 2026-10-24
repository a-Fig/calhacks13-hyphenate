// Run: node --test (from norn/config)
// Loads Bowman's file, then breaks copies of it one way at a time and checks that the message
// names the field to fix.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
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

const ruleIndex = (action: string): number => good.autonomy.actions.findIndex((a) => a.action === action);
const bodyIndex = (id: string): number => good.approval.bodies.findIndex((b) => b.id === id);

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
    assert.deepEqual(good.approval.tiers.map((t) => t.upTo), tiers);
    assert.deepEqual(good.approval.tiers.map((t) => t.upTo).slice(0, 2), [150_000, 2_000_000]);
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

describe("what Bowman's file takes from the dataset and how it says so", () => {
  const byId = <T extends { id: string }>(list: T[], id: string): T => list.find((x) => x.id === id)!;

  it('each never-fast-track id carries the text it is named for, whatever order the data lists them in', () => {
    const wanted: Record<string, string> = {
      safety_part: 'safety',
      interchangeability_or_interface: 'Interchangeability',
      retrofit_of_delivered_units: 'Retrofit',
      supplier_process_or_tooling: 'first-article',
      faa_major: 'FAA-major',
    };
    for (const [id, word] of Object.entries(wanted)) {
      assert.ok(byId(good.approval.neverFastTrack, id).text.includes(word), id + ' should be the rule that mentions ' + word);
    }
    assert.deepEqual(
      [...good.approval.neverFastTrack.map((t) => t.text)].sort(),
      [...company.changeControl.neverFastTrack].sort(),
      'every rule in the data is used once'
    );
  });

  it('the fast-track tests carry the data\'s own wording', () => {
    assert.ok(byId(good.approval.fastTrack.requireAll, 'no_form_fit_function_change').text.includes('form, fit, function'));
    assert.ok(byId(good.approval.fastTrack.requireAll, 'same_supplier_no_tooling').text.includes('first-article'));
  });

  it('the Technical Review Committee is the one the data lists, with the director of engineering as chair', () => {
    const trc = byId(good.approval.bodies, 'trc');
    assert.equal(trc.chairRole, 'engineering_director');
    assert.deepEqual(trc.memberRoles, ['quality', 'certification', 'cm_analyst']);
  });

  it('the board is the data\'s seats', () => {
    const ccb = byId(good.approval.bodies, 'ccb');
    assert.equal(ccb.chairRole, 'ccb_chair');
    assert.equal(ccb.secretaryRole, 'cm_analyst');
    assert.ok(ccb.memberRoles.length >= 8);
  });

  it('says where the membership came from: sourced for the committee and board, invented for the PMC', () => {
    assert.equal(byId(good.approval.bodies, 'trc').prov?.basis, 'sourced');
    assert.equal(byId(good.approval.bodies, 'ccb').prov?.basis, 'sourced');
    assert.equal(byId(good.approval.bodies, 'pmc').prov?.basis, 'invented');
    for (const body of good.approval.bodies) assert.ok(body.prov, body.id + ' has no provenance');
  });

  it('says the cost measure and the permission model are invented', () => {
    assert.equal(good.approval.costMeasure.prov?.basis, 'invented');
    for (const role of good.roles) assert.equal(role.prov?.basis, 'invented', role.id);
  });

  it('measures cost one way, for the tiers and for every limit, and does not let savings offset spend', () => {
    assert.deepEqual({ ...good.approval.costMeasure, prov: undefined }, { percentile: 'p90', horizonMonths: 12, savingsOffset: false, prov: undefined });
    const limited = good.autonomy.actions.filter((a) => a.limits?.maxCost !== undefined);
    assert.ok(limited.length >= 3);
    assert.ok(!JSON.stringify(good).includes('maxP90Cost'), 'no second definition of cost is left');
  });

  it('Class I is tied to the materiality thresholds, so a small saving does not make it Class I', () => {
    const [classI, classII] = good.changeClasses.company.values;
    const cost = classI!.triggers!.find((t) => /cost/.test(t))!;
    assert.match(cost, /by more than the materiality thresholds/);
    assert.match(classII!.meaning, /less than the materiality thresholds/);
  });

  it('carries out an approval on release_eco and update_standard_cost, and keeps the ledger human', () => {
    const rule = (action: string) => good.autonomy.actions[ruleIndex(action)]!;
    assert.equal(rule('release_eco').carriesOutApproval, true);
    assert.equal(rule('update_standard_cost').carriesOutApproval, true);
    for (const action of ['write_bom', 'draft_journal_entry', 'post_journal_entry']) assert.equal(rule(action).carriesOutApproval, undefined, action);
    assert.equal(rule('draft_journal_entry').level, 'approve');
    assert.equal(rule('post_journal_entry').level, 'recommend');
  });

  it('reads the fast-track approvers, the board chair and the committee\'s reach from the data', () => {
    assert.deepEqual(good.approval.fastTrack.approvers, [
      { role: 'cm_analyst', mustOwnTheChange: false },
      { role: 'design_engineer', mustOwnTheChange: true },
    ]);
    const chair = company.changeControl.approvalTiers.find((t) => t.approver.startsWith('Change Control Board'))!;
    assert.match(chair.approver, /chaired by the Vesper program manager/);
    assert.equal(byId(good.approval.bodies, 'ccb').chairRole, 'ccb_chair');
    assert.equal(good.approval.tiers[0]!.alsoReviewsAbove, true);
  });

  it('the fast track has the three kinds of change the data lists, and not the supplier-notified change', () => {
    assert.deepEqual(good.approval.fastTrack.requireOneOf.map((t) => t.id), ['authorized_equivalent', 'obsolescence_replacement', 'documentation_fix']);
  });

  it('keeps reviewer notes out of the stored config', () => {
    assert.ok(!/to confirm/i.test(canonicalJson(good)), 'a note to a reviewer is in a stored string');
  });

  it('has its own sample seed', () => {
    assert.equal(good.autonomy.sampleSeed, 'norn-sample-1');
  });

  it('says one thing about who decides the company class', () => {
    assert.equal(good.changeClasses.company.decidedBy, 'cm_analyst');
    const help = good.ecrForm.sections.flatMap((s) => s.fields).find((f) => f.kind === 'companyClass')!.help!;
    assert.equal(help, 'Norn proposes a class; the CM analyst has the final say.');
  });

  it('avoids the git words that are never business words, and not "commit"', () => {
    assert.deepEqual(good.vocabulary.avoid, ['ECN', 'change notice', 'branch', 'merge', 'pull request']);
  });

  it('lets certification and the program manager ask for a deep review', () => {
    assert.ok(good.reviewDepth.deepReview.mayRequest.includes('certification'));
    assert.ok(good.reviewDepth.deepReview.mayRequest.includes('program_manager'));
  });

  it('records a person\'s seat on the board as ccbRole', () => {
    assert.equal(good.people.find((p) => p.id === 'EMP-01')?.ccbRole, 'chair');
    assert.ok(!JSON.stringify(good).includes('boardRole'));
  });

  it('names no amount after a currency: amounts are in the company currency', () => {
    const names: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          names.push(key);
          walk(child);
        }
      }
    };
    walk(good);
    assert.deepEqual(names.filter((n) => /(Usd|USD|Eur)$/.test(n)), []);
  });
});

describe('defaults the loader fills in', () => {
  it('gives a fallback level of recommend where limits are set and the file says nothing', () => {
    const at = ruleIndex('update_standard_cost');
    const copy = structuredClone(good) as any;
    delete copy.autonomy.actions[at].otherwise;
    const result = validateConfig(copy);
    assert.ok(result.ok);
    assert.equal(result.config.autonomy.actions[at]!.otherwise, 'recommend');
    // A rule with no limits has nothing to fall back from.
    assert.equal(result.config.autonomy.actions[ruleIndex('write_bom')]!.otherwise, undefined);
  });

  it('fills false and none for the optional flags and lists', () => {
    const copy = structuredClone(good) as any;
    delete copy.approval.tiers[1].alsoReviewsAbove;
    delete copy.approval.fastTrack.approvers[0].mustOwnTheChange;
    delete copy.reviewDepth.deepReview.autoFor;
    const result = validateConfig(copy);
    assert.ok(result.ok);
    assert.equal(result.config.approval.tiers[0]!.alsoReviewsAbove, true, 'a value the file gave is kept');
    assert.equal(result.config.approval.tiers[1]!.alsoReviewsAbove, false);
    assert.equal(result.config.approval.fastTrack.approvers[0]!.mustOwnTheChange, false);
    assert.deepEqual(result.config.reviewDepth.deepReview.autoFor, []);
  });

  it('does not change what it is given, and filling twice changes nothing', () => {
    const copy = structuredClone(good) as any;
    delete copy.reviewDepth.deepReview.autoFor;
    const before = canonicalJson(copy);
    const once = validateConfig(copy);
    assert.ok(once.ok);
    assert.equal(canonicalJson(copy), before);
    const twice = validateConfig(once.config);
    assert.ok(twice.ok);
    assert.equal(canonicalJson(twice.config), canonicalJson(once.config));
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
    assertOne((c) => (c.approval.tiers[0].upTo = '150000'), 'approval.tiers[0].upTo', 'expected a number of at least 0, got "150000"');
  });

  it('tiers out of order', () => {
    const found = problems((c) => (c.approval.tiers[1].upTo = 90_000));
    assert.deepEqual(found, ['approval.tiers[1].upTo: expected a number above tiers[0].upTo (150000), got 90000']);
  });

  it('a last tier that has a limit', () => {
    assertOne((c) => (c.approval.tiers[2].upTo = 5_000_000), 'approval.tiers[2].upTo', 'expected null');
  });

  it('a tier with no limit before the last', () => {
    assertOne((c) => (c.approval.tiers[0].upTo = null), 'approval.tiers[0].upTo', 'only the last tier has no limit');
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
    assertOne((c) => (c.people[3].role = 'wizard'), 'people[3].role', 'expected a role defined in this file');
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

  it('limits on a level that does not let the agent act', () => {
    const at = ruleIndex('update_standard_cost');
    const found = problems((c) => (c.autonomy.actions[at].level = 'recommend'));
    assert.ok(found.some((p) => p.startsWith('autonomy.actions[' + at + '].limits: expected no limits')), found.join('\n'));
  });

  it('a fallback level more autonomous than the level it falls back from', () => {
    const at = ruleIndex('update_standard_cost'); // approve_sampled, otherwise recommend
    assertOne((c) => (c.autonomy.actions[at].otherwise = 'approve'), 'autonomy.actions[' + at + '].otherwise', 'expected a level less autonomous than "approve_sampled"');
  });

  it('a fallback level equal to the level it falls back from, which limits nothing', () => {
    const at = ruleIndex('update_standard_cost'); // approve_sampled, otherwise recommend
    assertOne((c) => (c.autonomy.actions[at].otherwise = 'approve_sampled'), 'autonomy.actions[' + at + '].otherwise', 'expected a level less autonomous than "approve_sampled"');
    const approving = ruleIndex('release_eco'); // approve, otherwise recommend
    assertOne((c) => (c.autonomy.actions[approving].otherwise = 'approve'), 'autonomy.actions[' + approving + '].otherwise', 'expected a level less autonomous than "approve"');
  });

  it('a fallback level with no limits to pass', () => {
    const at = ruleIndex('write_bom'); // approve_sampled, no limits
    assertOne((c) => (c.autonomy.actions[at].otherwise = 'recommend'), 'autonomy.actions[' + at + '].otherwise', 'expected limits to be set');
  });

  it('a class decider whose role may not set the class', () => {
    assertOne((c) => (c.changeClasses.company.decidedBy = 'buyer'), 'changeClasses.company.decidedBy', 'role "buyer" cannot set_company_class');
    assertOne((c) => (c.changeClasses.regulatory.decidedBy = 'cm_analyst'), 'changeClasses.regulatory.decidedBy', 'role "cm_analyst" cannot set_regulatory_class');
  });

  it('a fallback class that does not exist', () => {
    assertOne((c) => (c.changeClasses.company.whenUnsure = 'III'), 'changeClasses.company.whenUnsure', 'expected a company class');
    assertOne((c) => (c.changeClasses.regulatory.whenUnsure = 'severe'), 'changeClasses.regulatory.whenUnsure', 'expected a regulatory class');
  });

  it('a board member whose role may not review', () => {
    const ccb = bodyIndex('ccb');
    const next = good.approval.bodies[ccb]!.memberRoles.length;
    assertOne((c) => c.approval.bodies[ccb].memberRoles.push('design_engineer'), 'approval.bodies[' + ccb + '].memberRoles[' + next + ']', 'role "design_engineer" cannot review_ecr');
  });

  it('a fast-track approver whose role may not approve on the fast track', () => {
    assertOne((c) => (c.approval.fastTrack.approvers[1].role = 'buyer'), 'approval.fastTrack.approvers[1].role', 'role "buyer" cannot approve_fast_track_ecr');
  });

  it('an escalation to a role that does not exist', () => {
    const at = ruleIndex('set_company_class');
    assertOne((c) => (c.autonomy.actions[at].escalateTo = 'wizard'), 'autonomy.actions[' + at + '].escalateTo', 'expected a role defined in this file');
  });

  it('an escalation to a role that cannot do the work', () => {
    const at = ruleIndex('set_company_class');
    assertOne((c) => (c.autonomy.actions[at].escalateTo = 'buyer'), 'autonomy.actions[' + at + '].escalateTo', 'role "buyer" cannot set_company_class');
  });

  it('a deep review requester role that does not exist', () => {
    assertOne((c) => (c.reviewDepth.deepReview.mayRequest[0] = 'wizard'), 'reviewDepth.deepReview.mayRequest[0]', 'expected a role defined in this file');
  });

  it('a body chair that nobody holds', () => {
    const pmc = bodyIndex('pmc');
    assertOne(
      (c) => {
        c.roles.push({ id: 'vacant', label: 'Vacant seat', can: ['approve_ecr_at_tier'] });
        c.approval.bodies[pmc].chairRole = 'vacant';
      },
      'approval.bodies[' + pmc + '].chairRole',
      'which nobody in people holds'
    );
  });

  it('removing everyone from a role the file relies on', () => {
    const found = problems((c) => (c.people = c.people.filter((p: any) => p.role !== 'cm_analyst')));
    const wanted = [
      'approval.fastTrack.approvers[0].role',
      'autonomy.actions[' + ruleIndex('approve_fast_track_ecr') + '].escalateTo',
      'autonomy.actions[' + ruleIndex('set_company_class') + '].escalateTo',
      'changeClasses.company.decidedBy',
    ];
    assert.deepEqual(found.map((p) => p.split(': ')[0]).sort(), wanted.sort(), found.join('\n'));
    assert.ok(found.every((p) => p.includes('"cm_analyst", which nobody in people holds')));
  });

  it('carrying out an approval on an action that is not release_eco or update_standard_cost', () => {
    for (const action of ['approve_ecr_at_tier', 'approve_fast_track_ecr', 'set_company_class', 'file_ecr', 'write_bom', 'draft_journal_entry']) {
      const at = ruleIndex(action);
      assertOne((c) => (c.autonomy.actions[at].carriesOutApproval = true), 'autonomy.actions[' + at + '].carriesOutApproval', 'expected nothing, because only release_eco and update_standard_cost carry out an approval and ' + action + ' does not');
    }
    // The ledger keeps its human step: a posting rule that acts within a limit may not be waived past it.
    const post = ruleIndex('post_journal_entry');
    assertOne(
      (c) => (c.autonomy.actions[post] = { action: 'post_journal_entry', level: 'approve', limits: { maxCost: 1 }, carriesOutApproval: true, why: 'x' }),
      'autonomy.actions[' + post + '].carriesOutApproval',
      'expected nothing, because only release_eco and update_standard_cost carry out an approval and post_journal_entry does not'
    );
    // Even false is refused: the field does not belong on these actions at all.
    const at = ruleIndex('approve_ecr_at_tier');
    assertOne((c) => (c.autonomy.actions[at].carriesOutApproval = false), 'autonomy.actions[' + at + '].carriesOutApproval', 'expected nothing');
  });

  it('carrying out an approval with no limits to waive', () => {
    const at = ruleIndex('release_eco'); // follows an approval
    assertOne(
      (c) => {
        delete c.autonomy.actions[at].limits;
        delete c.autonomy.actions[at].otherwise;
      },
      'autonomy.actions[' + at + '].carriesOutApproval',
      'expected limits to be set'
    );
  });

  it('a date that is not a real date is reported, not thrown', () => {
    const ccb = bodyIndex('ccb');
    for (const bad of ['2026-13-12', '2026-00-10', '2026-02-30']) {
      assertOne((c) => (c.approval.bodies[ccb].meetings[0] = bad), 'approval.bodies[' + ccb + '].meetings[0]', 'expected a date as YYYY-MM-DD, got "' + bad + '"');
    }
    const found = problems((c) => {
      c.approval.bodies[ccb].meetings[0] = '2026-13-12';
      c.company.currency = 'dollars';
    });
    assert.equal(found.length, 2, 'the other problems are still reported:\n' + found.join('\n'));
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

  it('a recommendation that no role can receive', () => {
    const at = ruleIndex('post_journal_entry'); // recommend
    assertOne(
      (c) => {
        const accountant = c.roles.find((r: any) => r.id === 'cost_accountant');
        accountant.can = accountant.can.filter((a: string) => a !== 'post_journal_entry');
      },
      'autonomy.actions[' + at + '].level',
      'expected a role that can post_journal_entry'
    );
  });

  it('a recommendation whose only possible recipient is nobody', () => {
    const post = ruleIndex('post_journal_entry');
    const cost = ruleIndex('update_standard_cost'); // recommends past its limit
    const found = problems((c) => (c.people = c.people.filter((p: any) => p.role !== 'cost_accountant')));
    assert.deepEqual(found.map((p) => p.split(': ')[0]).sort(), ['autonomy.actions[' + post + '].level', 'autonomy.actions[' + cost + '].otherwise'].sort(), found.join('\n'));
    assert.ok(found.every((p) => p.includes('expected a person in a role that can ') && p.includes('nobody in people holds "cost_accountant"')), found.join('\n'));
  });

  it('a fallback recommendation, written or filled in, that no role can receive', () => {
    const release = ruleIndex('release_eco'); // otherwise: 'recommend', written out
    assertOne(
      (c) => c.roles.forEach((r: any) => (r.can = r.can.filter((a: string) => a !== 'release_eco'))),
      'autonomy.actions[' + release + '].otherwise',
      'once a limit is passed'
    );
    const cost = ruleIndex('update_standard_cost');
    const found = problems((c) => {
      delete c.autonomy.actions[cost].otherwise; // the loader fills in 'recommend'
      c.people = c.people.filter((p: any) => p.role !== 'cost_accountant');
    });
    assert.ok(found.some((p) => p.startsWith('autonomy.actions[' + cost + '].limits: expected a person in a role that can update_standard_cost')), found.join('\n'));
  });

  it('limits that are all undefined are not limits', () => {
    const at = ruleIndex('write_bom');
    assertOne((c) => (c.autonomy.actions[at].limits = { maxCost: undefined }), 'autonomy.actions[' + at + '].limits', 'expected at least one limit, got none');
    assertOne((c) => (c.autonomy.actions[at].limits = {}), 'autonomy.actions[' + at + '].limits', 'expected at least one limit, got none');
    // Waiving limits that do not exist is the case that mattered: it must not pass either.
    const release = ruleIndex('release_eco');
    const found = problems((c) => (c.autonomy.actions[release].limits = { maxCost: undefined }));
    assert.ok(found.some((p) => p.startsWith('autonomy.actions[' + release + '].limits: expected at least one limit')), found.join('\n'));
  });

  it('a field of the ECR form with options that is not a choice', () => {
    assertOne(
      (c) => (c.ecrForm.sections[0].fields[0].options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]),
      'ecrForm.sections[0].fields[0].options',
      'expected no options, because kind is "text"'
    );
  });

  it('a kind Norn reads that appears twice on the ECR form', () => {
    const next = good.ecrForm.sections[0]!.fields.length;
    assertOne(
      (c) => c.ecrForm.sections[0].fields.push({ id: 'priority_again', label: 'Priority again', kind: 'priority', required: 'submit' }),
      'ecrForm.sections[0].fields[' + next + '].kind',
      'expected each field of kind "priority" to appear once, already used at ecrForm.sections[0].fields[2].kind'
    );
  });

  it('a secretary role that does not exist', () => {
    const pmc = bodyIndex('pmc'); // the board has people sitting on it; this body does not
    assertOne((c) => (c.approval.bodies[pmc].secretaryRole = 'wizard'), 'approval.bodies[' + pmc + '].secretaryRole', 'expected a role defined in this file');
  });

  it('a test id reused across the fast-track and never-fast-track lists', () => {
    assertOne(
      (c) => (c.approval.neverFastTrack[0].id = c.approval.fastTrack.requireAll[0].id),
      'approval.neverFastTrack[0].id',
      'duplicate id "company_class_ii", already used at approval.fastTrack.requireAll[0].id'
    );
  });

  it('a person who reports to themselves', () => {
    assertOne((c) => (c.people[3].reportsTo = c.people[3].id), 'people[3].reportsTo', 'expected another person, got the person themselves');
  });

  it('a sample rate on a rule that never samples', () => {
    const at = ruleIndex('post_impact_statement'); // approve
    assertOne((c) => (c.autonomy.actions[at].sampleRate = 0.3), 'autonomy.actions[' + at + '].sampleRate', 'expected no sample rate, because no level is approve_sampled');
  });

  it('a deep review class that does not exist', () => {
    assertOne((c) => (c.reviewDepth.deepReview.autoFor[0].value = 'severe'), 'reviewDepth.deepReview.autoFor[0].value', 'expected a regulatory class');
  });

  it('a likelihood word that ends before it starts', () => {
    const last = good.postingStandards.likelihoodScale.length - 1;
    assertOne((c) => (c.postingStandards.likelihoodScale[last].toPct = 90), 'postingStandards.likelihoodScale[' + last + '].toPct', 'expected a number above fromPct (95), got 90');
  });

  it('a sample seed that is missing or empty', () => {
    assertOne((c) => delete c.autonomy.sampleSeed, 'autonomy.sampleSeed', 'required, but missing');
    assertOne((c) => (c.autonomy.sampleSeed = ''), 'autonomy.sampleSeed', 'expected a non-empty string');
  });

  it('a fast track with no conditions or no kinds of change', () => {
    assertOne((c) => (c.approval.fastTrack.requireAll = []), 'approval.fastTrack.requireAll', 'expected at least 1 entry, got 0');
    assertOne((c) => (c.approval.fastTrack.requireOneOf = []), 'approval.fastTrack.requireOneOf', 'expected at least 1 entry, got 0');
  });

  it('a body that decides two tiers', () => {
    assertOne((c) => (c.approval.tiers[2].body = 'ccb'), 'approval.tiers[2].body', 'but "ccb" already decides approval.tiers[1]');
  });

  it('a fast-track approver listed twice', () => {
    assertOne(
      (c) => c.approval.fastTrack.approvers.push({ role: 'cm_analyst' }),
      'approval.fastTrack.approvers[2].role',
      'duplicate role "cm_analyst", already used at approval.fastTrack.approvers[0].role'
    );
  });

  it('a second chair of the board', () => {
    const next = good.people.length;
    assertOne(
      (c) => c.people.push({ id: 'EMP-99', name: 'Pat Example', title: 'Deputy chair', role: 'ccb_chair', ccbRole: 'chair' }),
      'people[' + next + '].ccbRole',
      'expected one chair at most, but people[0].ccbRole is already the chair'
    );
  });

  it('a board seat that disagrees with the board\'s roles', () => {
    const ccb = bodyIndex('ccb');
    const chair = good.people.findIndex((p) => p.ccbRole === 'chair');
    assertOne((c) => (c.approval.bodies[ccb].chairRole = 'cfo'), 'people[' + chair + '].ccbRole', 'expected a person in the board\'s chair role ("cfo"), got role "ccb_chair"');
    const secretary = good.people.findIndex((p) => p.ccbRole === 'secretary');
    assertOne((c) => (c.approval.bodies[ccb].secretaryRole = 'program_manager'), 'people[' + secretary + '].ccbRole', 'expected a person in the board\'s secretary role ("program_manager"), got role "cm_analyst"');
    const member = good.people.findIndex((p) => p.ccbRole === 'member' && p.role === 'quality');
    assertOne(
      (c) => (c.approval.bodies[ccb].memberRoles = c.approval.bodies[ccb].memberRoles.filter((r: string) => r !== 'quality')),
      'people[' + member + '].ccbRole',
      'expected a person in one of the board\'s member roles'
    );
  });

  it('a board seat when no approval body is the board', () => {
    const ccb = bodyIndex('ccb');
    const first = good.people.findIndex((p) => p.ccbRole !== undefined);
    assertOne((c) => (c.approval.bodies[ccb].name = 'Board of Review'), 'people[' + first + '].ccbRole', 'expected exactly one approval body named "Change Control Board" (vocabulary.terms.board)');
  });

  it('reports every error, not only the first', () => {
    const found = problems((c) => {
      delete c.approval;
      c.company.currency = 'dollars';
      c.people[3].reportsTo = 'EMP-99';
      c.autonomy.actions[0].level = 'maybe';
      c.materiality.unitCost.absolute = -1;
    });
    assert.equal(found.length, 5, found.join('\n'));
    for (const path of ['approval', 'company.currency', 'people[3].reportsTo', 'autonomy.actions[0].level', 'materiality.unitCost.absolute']) {
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

  it('--json output validates again, as does the stored copy of a file that leaves optional values undefined', async () => {
    const out: string[] = [];
    assert.equal(await run([BOWMAN, '--json'], (l) => out.push(l), () => {}), 0);
    const stored = JSON.parse((JSON.parse(out.join('\n')) as { key: string; value: string }[])[0]!.value);
    const again = validateConfig(stored);
    assert.ok(again.ok, again.ok ? '' : again.issues.map(formatIssue).join('\n'));
    assert.equal(canonicalJson(again.config), canonicalJson(good));

    // A limit, an escalation or a rate set to undefined is the same as leaving it out, before and after storing.
    const copy = structuredClone(good) as any;
    const fast = copy.autonomy.actions[ruleIndex('approve_fast_track_ecr')];
    fast.limits.maxP90SlipDays = undefined;
    copy.autonomy.actions[ruleIndex('write_bom')].escalateTo = undefined;
    const first = validateConfig(copy);
    assert.ok(first.ok, first.ok ? '' : first.issues.map(formatIssue).join('\n'));
    const second = validateConfig(JSON.parse(canonicalJson(first.config)));
    assert.ok(second.ok, second.ok ? '' : second.issues.map(formatIssue).join('\n'));
  });
});

describe("when the dataset's wording changes", () => {
  // Copies the files Bowman's config reads into a temp directory, lets the test reword the copy of
  // company.ts, and loads the copy. The repository's own files are never touched.
  const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const base = mkdtempSync(join(tmpdir(), 'norn-drift-'));
  after(() => rmSync(base, { recursive: true, force: true }));
  let n = 0;

  async function loadWith(reword: (companyTs: string) => string) {
    const dir = join(base, 'c' + n++);
    cpSync(join(root, 'bowman', 'data'), join(dir, 'bowman', 'data'), { recursive: true, filter: (from) => !from.endsWith('bowman.json') });
    cpSync(join(root, 'bowman', 'norn-config'), join(dir, 'bowman', 'norn-config'), { recursive: true });
    cpSync(join(root, 'norn', 'config', 'src'), join(dir, 'norn', 'config', 'src'), { recursive: true });
    cpSync(join(root, 'norn', 'config', 'package.json'), join(dir, 'norn', 'config', 'package.json'));
    const file = join(dir, 'bowman', 'data', 'company.ts');
    const original = readFileSync(file, 'utf8');
    const reworded = reword(original);
    assert.notEqual(reworded, original, 'the test did not change the copy of company.ts');
    writeFileSync(file, reworded);
    return loadConfigFile(join(dir, 'bowman', 'norn-config', 'bowman.config.ts'));
  }

  /** Asserts the copy no longer loads, with a message that contains `text`. */
  async function refuses(reword: (companyTs: string) => string, text: string): Promise<void> {
    const result = await loadWith(reword);
    assert.ok(!result.ok, 'the reworded data still loaded');
    assert.ok(result.issues[0]!.message.includes(text), 'expected "' + text + '" in: ' + result.issues[0]!.message);
  }

  it('still loads when only the order of the never-fast-track rules changes (the control)', async () => {
    const safety = "'Anything touching safety or a flight-safety part'";
    const faa = "'FAA-major changes (14 CFR 21.93)'";
    const result = await loadWith((s) => s.replace(safety, '@@A@@').replace(faa, safety).replace('@@A@@', faa));
    assert.ok(result.ok, result.ok ? '' : result.issues.map(formatIssue).join('\n'));
    assert.ok(result.config.approval.neverFastTrack.find((t) => t.id === 'safety_part')!.text.includes('safety'));
    assert.ok(result.config.approval.neverFastTrack.find((t) => t.id === 'faa_major')!.text.includes('FAA-major'));
  });

  it('refuses a committee that no longer also reviews everything above', async () => {
    await refuses((s) => s.replace('; also reviews everything above', ''), 'also reviews everything above');
  });

  it('refuses fast-track approvers that are not the two the file has roles for', async () => {
    await refuses((s) => s.replace('The CM analyst and the owning design engineer, without convening the board', 'The CM analyst alone, without convening the board'), 'CM analyst alone');
    await refuses((s) => s.replace('The CM analyst and the owning design engineer', 'The CM analyst and the CFO'), 'which this file has no role for');
  });

  it('refuses a board chaired by someone the data does not seat as chair', async () => {
    await refuses((s) => s.replace('chaired by the Vesper program manager', 'chaired by the Meridian program manager'), 'should have ccbRole "chair"');
    await refuses((s) => s.replace('chaired by the Vesper program manager', 'chaired by the CFO'), 'the board chair "CFO"');
  });

  it('refuses a committee that no longer lists the seat the file makes its chair', async () => {
    await refuses((s) => s.replace('(engineering director, quality,', '(quality,'), 'engineering_director');
  });
});

describe('Norn stays general', () => {
  it('names no company in its source', () => {
    for (const name of readdirSync(SRC)) {
      assert.ok(!/bowman/i.test(readFileSync(join(SRC, name), 'utf8')), `${name} names a company`);
    }
  });
});
