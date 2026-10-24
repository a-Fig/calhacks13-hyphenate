// Run: node --test (from norn/config)
// Routes and decides with Bowman's real configuration. The cost facts of the demo ECRs come from the real cost
// check run on the dataset's baseline. The answers to the configuration's yes/no tests (safety part, retrofit
// and so on) and the slip and report level are test inputs, written out below with the reason for each: no
// check or classifier produces them yet.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bowman } from '../../../bowman/data/index.ts';
import { costCheck } from '../../checks/src/index.ts';
import {
  ACTION_IDS,
  ERP_ACTIONS,
  costForecastFromCheck,
  decideAction,
  formatIssue,
  loadConfigFile,
  measureCost,
  routeEcr,
  type Actor,
  type CompanyConfig,
  type CostCheckHeadline,
  type CostForecast,
  type EcrFacts,
  type ExactCostMeasure,
} from '../src/index.ts';

const BOWMAN = fileURLToPath(new URL('../../../bowman/norn-config/bowman.config.ts', import.meta.url));
const NORN: Actor = { kind: 'agent' };

let config: CompanyConfig;
/** What the real cost check gives: ranges of signed totals. Norn routes on these and never acts on them. */
const forecasts = new Map<string, CostForecast>();
/**
 * The same forecasts with an exact measure added. The check does not emit one yet, so these are test inputs. For the
 * demo ECRs every cost component has one sign, so in each draw the size is the window total's own size, and its
 * p50 and p90 are the p50 and p90 of that size: the range's own percentiles, on the side of zero it lies on.
 */
const exactForecasts = new Map<string, CostForecast>();

/** The exact measure Bowman's configuration asks for: p90, 12 months, savings not offset. */
const exactMeasure = (p50: number, p90: number, over: Partial<ExactCostMeasure> = {}): ExactCostMeasure => ({ source: 'exact', horizonMonths: 12, savingsOffset: false, p50, p90, ...over });
const DEMO = ['ECR-0423', 'ECR-0417', 'ECR-0409', 'ECR-0406'];

before(async () => {
  const loaded = await loadConfigFile(BOWMAN);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map(formatIssue).join('\n'));
  config = loaded.config;
  for (const id of DEMO) {
    const ecr = bowman.ecrs.find((e) => e.id === id)!;
    const f = costForecastFromCheck(costCheck(bowman, ecr, { seed: 'norn-seed-1' }));
    forecasts.set(id, f);
    const t = f.windowTotal;
    exactForecasts.set(id, { ...f, measured: exactMeasure(Math.abs(t.p50), Math.max(Math.abs(t.p10), Math.abs(t.p90))) });
  }
});

/** Answers for the tests of the fast-track criteria, as a classifier would give them. */
const NO_BLOCKS = { safety_part: false, interchangeability_or_interface: false, retrofit_of_delivered_units: false, supplier_process_or_tooling: false };

/**
 * Facts for a demo ECR. The class is the dataset's. The answers follow the dataset's own scenario notes:
 * - ECR-0423 (S3): not safety, interchangeable, same supplier, no tooling, no first article, no retrofit.
 *   It is a swap to the supplier's stock colour, which is the closest of the fast track's kinds of change.
 * - ECR-0417: Rev C is interchangeable but the aircraft already built are retrofitted, and Halden quotes
 *   fixtures and programming, which is tooling.
 * - ECR-0406 is the dataset's trap: Class II filed on a safety item.
 */
function factsFor(id: string, exact = true): EcrFacts {
  const ecr = bowman.ecrs.find((e) => e.id === id)!;
  const answers: Record<string, boolean> =
    id === 'ECR-0423'
      ? { ...NO_BLOCKS, no_form_fit_function_change: true, same_supplier_no_tooling: true, authorized_equivalent: true, obsolescence_replacement: false, documentation_fix: false }
      : id === 'ECR-0417'
        ? { ...NO_BLOCKS, retrofit_of_delivered_units: true, supplier_process_or_tooling: true, no_form_fit_function_change: false, same_supplier_no_tooling: false, authorized_equivalent: false, obsolescence_replacement: false, documentation_fix: false }
        : id === 'ECR-0406'
          ? { ...NO_BLOCKS, safety_part: true, no_form_fit_function_change: true, same_supplier_no_tooling: true, authorized_equivalent: true, obsolescence_replacement: false, documentation_fix: false }
          : { ...NO_BLOCKS };
  return {
    ecrId: id,
    cost: (exact ? exactForecasts : forecasts).get(id),
    classes: { company: ecr.companyClass, regulatory: ecr.faaClass },
    answers,
    // The timeline check does not exist yet. A colour change on a lot already quoted at the same lead time slips nothing.
    slipP90Days: id === 'ECR-0423' ? 0 : undefined,
    reportLevel: 1,
  };
}

const flat = (d: { reasons: { rule: string; text: string }[] }): string => d.reasons.map((r) => r.text).join(' ');
const personWith = (roleId: string) => config.people.find((p) => p.role === roleId)!;

/** A fast-track-eligible set of facts for any ECR id, at the given cost. */
function eligible(ecrId: string, size: number, more: Partial<EcrFacts> = {}): EcrFacts {
  return { ...factsFor('ECR-0423'), ecrId, cost: { windowMonths: 12, oneTime: { p10: 0, p50: 0, p90: 0 }, recurringWindow: { p10: 0, p50: 0, p90: 0 }, windowTotal: { p10: 0, p50: 0, p90: 0 }, measured: exactMeasure(size, size) }, ...more };
}

describe('the real cost facts for the demo ECRs', () => {
  it('ECR-0423 saves a few hundred dollars over its first year, ECR-0417 costs about 160,000', () => {
    const small = forecasts.get('ECR-0423')!;
    const bracket = forecasts.get('ECR-0417')!;
    assert.equal(small.windowMonths, 12);
    assert.ok(small.windowTotal.p10 > -700 && small.windowTotal.p90 < -500, JSON.stringify(small.windowTotal));
    assert.ok(bracket.windowTotal.p50 > 150_000 && bracket.windowTotal.p90 < 170_000, JSON.stringify(bracket.windowTotal));
  });
});

describe('routing the demo ECRs', () => {
  it('ECR-0423 goes to the technical review committee and can take the fast track', () => {
    const route = routeEcr(config, factsFor('ECR-0423'));
    assert.equal(route.classes.company.value, 'II');
    assert.equal(route.classes.regulatory.value, 'minor');
    assert.equal(route.cost.basis, 'measured');
    assert.ok(route.cost.size! > 500 && route.cost.size! < 700, String(route.cost.size));
    assert.equal(route.tier.tierId, 'technical_review');
    assert.equal(route.tier.bodyId, 'trc');
    assert.equal(route.fastTrack.eligible, true);
    assert.match(route.fastTrack.why, /^Eligible for the fast track/);
  });

  it('ECR-0417 is over 150,000, so the CCB decides it, with the technical review committee also reviewing', () => {
    const route = routeEcr(config, factsFor('ECR-0417'));
    assert.equal(route.classes.company.value, 'I');
    assert.ok(route.cost.size! > 150_000 && route.cost.size! < 2_000_000, String(route.cost.size));
    assert.equal(route.tier.tierId, 'board');
    assert.equal(route.tier.bodyId, 'ccb');
    assert.equal(route.tier.bodyName, 'Change Control Board');
    assert.deepEqual(route.tier.alsoReviewedBy, [{ id: 'trc', name: 'Technical Review Committee' }]);
    assert.match(route.tier.why, /above 150,000 USD and within 2,000,000 USD/);
  });

  it('ECR-0417 cannot take the fast track: a retrofit and tooling are never fast-tracked, and it is not Class II', () => {
    const { fastTrack } = routeEcr(config, factsFor('ECR-0417'));
    assert.equal(fastTrack.eligible, false);
    assert.deepEqual(fastTrack.blockedBy.map((t) => t.id).sort(), ['retrofit_of_delivered_units', 'supplier_process_or_tooling']);
    assert.ok(fastTrack.unmet.some((t) => t.id === 'company_class_ii'));
    assert.match(fastTrack.why, /Never on the fast track: Retrofit of built or delivered aircraft/);
    assert.match(fastTrack.rule, /^approval\.neverFastTrack\[/);
  });

  it('ECR-0409 is FAA major, which no class answer can fast-track, and goes to the CCB', () => {
    const route = routeEcr(config, factsFor('ECR-0409'));
    assert.equal(route.fastTrack.eligible, false);
    assert.ok(route.fastTrack.blockedBy.some((t) => t.id === 'faa_major' && t.basis === 'class'));
    assert.equal(route.tier.bodyId, 'ccb');
  });

  it('ECR-0406, Class II on a safety item, is stopped by the safety rule though its class says fast track', () => {
    const route = routeEcr(config, factsFor('ECR-0406'));
    assert.equal(route.classes.company.value, 'II');
    assert.equal(route.fastTrack.eligible, false);
    assert.deepEqual(route.fastTrack.blockedBy.map((t) => t.id), ['safety_part']);
  });

  it('gives every answer a rule and a reason', () => {
    for (const id of DEMO) {
      const route = routeEcr(config, factsFor(id));
      assert.equal(route.reasons.length, 5);
      for (const r of route.reasons) assert.ok(r.rule.length > 0 && r.text.length > 0 && !r.text.includes(String.fromCharCode(0x2014)), JSON.stringify(r));
    }
  });
});

describe('classes and unanswered tests', () => {
  it('uses the configuration\'s whenUnsure class when none is set, and says so', () => {
    const route = routeEcr(config, { ecrId: 'ECR-0001' });
    assert.equal(route.classes.company.value, 'I');
    assert.equal(route.classes.company.source, 'when_unsure');
    assert.equal(route.classes.regulatory.value, 'major');
    assert.match(route.classes.regulatory.why, /None has been set/);
  });

  it('treats a class that is not on the axis as unset', () => {
    const route = routeEcr(config, { ecrId: 'ECR-0001', classes: { company: 'III' } });
    assert.equal(route.classes.company.source, 'when_unsure');
    assert.match(route.classes.company.why, /"III" is not one of this axis's classes/);
  });

  it('a test nobody has answered keeps the ECR off the fast track', () => {
    const facts = factsFor('ECR-0423');
    delete facts.answers!.safety_part;
    const { fastTrack } = routeEcr(config, facts);
    assert.equal(fastTrack.eligible, false);
    assert.deepEqual(fastTrack.unanswered.map((t) => t.id), ['safety_part']);
    assert.match(fastTrack.why, /Not yet answered/);
  });

  it('needs one of the kinds of change, and says when none was answered yes', () => {
    const facts = factsFor('ECR-0423');
    facts.answers!.authorized_equivalent = false;
    const { fastTrack } = routeEcr(config, facts);
    assert.equal(fastTrack.eligible, false);
    assert.deepEqual(fastTrack.unmet.map((t) => t.list), ['requireOneOf', 'requireOneOf', 'requireOneOf']);
  });
});

describe('the cost measure', () => {
  const range = (p10: number, p50: number, p90: number) => ({ p10, p50, p90 });
  const zero = range(0, 0, 0);
  const forecast = (oneTime = zero, recurring = zero, net = range(oneTime.p10 + recurring.p10, oneTime.p50 + recurring.p50, oneTime.p90 + recurring.p90), windowMonths = 12): CostForecast => ({
    windowMonths,
    oneTime,
    recurringWindow: recurring,
    windowTotal: net,
  });

  const withGross = (f: CostForecast, spend: ReturnType<typeof range>, saving: ReturnType<typeof range>): CostForecast => ({ ...f, gross: { spend, saving } });

  it('measures a 3M saving as a 3M change, and routes it to the program management committee', () => {
    const saving = range(-3_000_000, -2_000_000, -1_500_000);
    const f = withGross(forecast(zero, saving), zero, range(1_500_000, 2_000_000, 3_000_000));
    assert.equal(measureCost(config, f).size, 3_000_000);
    assert.equal(routeEcr(config, { ecrId: 'ECR-0001', cost: f }).tier.bodyId, 'pmc');
  });

  it('measures 1.8M of tooling that saves 1M as at least 1.8M, not as the 0.8M it nets to', () => {
    const f = withGross(forecast(range(1_800_000, 1_800_000, 1_800_000), range(-1_000_000, -1_000_000, -1_000_000)), range(1_800_000, 1_800_000, 1_800_000), range(1_000_000, 1_000_000, 1_000_000));
    const m = measureCost(config, f);
    assert.equal(m.size, 1_800_000);
    assert.equal(m.basis, 'lower_bound');
    assert.equal(routeEcr(config, { ecrId: 'ECR-0001', cost: f }).tier.bodyId, 'ccb');
  });

  it('puts exactly 150,000 in the first tier and one dollar more in the second', () => {
    const at = (n: number) => routeEcr(config, { ecrId: 'ECR-0001', cost: withGross(forecast(range(n, n, n)), range(n, n, n), zero) }).tier.bodyId;
    assert.equal(at(150_000), 'trc');
    assert.equal(at(150_001), 'ccb');
    assert.equal(at(2_000_000), 'ccb');
    assert.equal(at(2_000_001), 'pmc');
  });

  it('prefers the exact figure from the checks when they give one', () => {
    const f: CostForecast = { ...forecast(range(10, 10, 10)), measured: exactMeasure(400_000, 900_000) };
    const m = measureCost(config, f);
    assert.equal(m.size, 900_000);
    assert.equal(m.basis, 'measured');
  });

  it('is unmeasured without an assessment or over a different horizon, and then goes to the top tier', () => {
    for (const cost of [undefined, forecast(zero, zero, zero, 6)]) {
      const route = routeEcr(config, { ecrId: 'ECR-0001', cost });
      assert.equal(route.cost.size, null);
      assert.equal(route.cost.basis, 'unmeasured');
      assert.equal(route.tier.bodyId, 'pmc');
      assert.match(route.tier.why, /unmeasured/);
    }
  });

  it('follows the configuration: p50 and savingsOffset change the size', () => {
    const f = withGross(forecast(range(1_000, 2_000, 3_000), range(-500, -400, -300)), range(1_000, 2_000, 3_000), range(300, 400, 500));
    const copy = (change: (c: CompanyConfig) => void): CompanyConfig => {
      const c = structuredClone(config);
      change(c);
      return c;
    };
    assert.equal(measureCost(config, f).size, 3_000); // p90, no offset: spend 3000, saving 500
    const p50 = measureCost(copy((c) => (c.approval.costMeasure.percentile = 'p50')), f);
    assert.equal(p50.size, 2_000); // spend 2000, saving 400
    const offset = measureCost(copy((c) => (c.approval.costMeasure.savingsOffset = true)), f);
    assert.equal(offset.size, 2_700); // net runs from 500 to 2700
  });
});

describe('the same fast-track recommendation, from the configuration alone', () => {
  it('is approved on ECR-0423: the agent acts, within every limit, and the draw does not hold it', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: factsFor('ECR-0423') });
    assert.equal(d.outcome, 'approve_sampled');
    assert.equal(d.actsNow, true);
    assert.equal(d.sample!.sampled, false);
    assert.equal(d.sample!.value, 0.5386328629683703);
    assert.deepEqual(d.limits!.map((l) => [l.limit, l.held]), [['maxCost', true], ['maxP90SlipDays', true], ['minReportLevel', true]]);
    assert.match(flat(d), /Within every limit/);
  });

  it('is refused on ECR-0417, which goes to the CCB as a recommendation instead', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: factsFor('ECR-0417') });
    assert.equal(d.outcome, 'deny');
    assert.equal(d.actsNow, false);
    assert.match(d.decidedBy, /^approval\.neverFastTrack\[/);
    assert.match(flat(d), /Never on the fast track: Retrofit of built or delivered aircraft/);
    assert.match(flat(d), /goes the ordinary way, to the Change Control Board/);
    assert.equal(d.reroute!.action, 'approve_ecr_at_tier');
    assert.equal(d.reroute!.outcome, 'recommend');
    assert.deepEqual(d.reroute!.recipients, ['ccb_chair']);
    assert.equal(d.reroute!.reroute, undefined);
  });

  it('becomes a recommendation, not a refusal, when the ECR qualifies but is over a limit', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: eligible('ECR-0423', 30_000) });
    assert.equal(d.outcome, 'recommend');
    assert.equal(d.actsNow, false);
    assert.equal(d.decidedBy, 'autonomy.actions[approve_fast_track_ecr].limits');
    assert.match(flat(d), /30,000 USD against a limit of 25,000 USD/);
    assert.deepEqual(d.recipients!.sort(), ['cm_analyst', 'design_engineer']);
  });

  it('the limit is inclusive: 25,000 is approved, 25,001 is a recommendation', () => {
    assert.equal(decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: eligible('ECR-0423', 25_000) }).outcome, 'approve_sampled');
    assert.equal(decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: eligible('ECR-0423', 25_001) }).outcome, 'recommend');
  });

  it('a slip over 14 days, an unknown slip or a missing report each turn it into a recommendation', () => {
    for (const more of [{ slipP90Days: 15 }, { slipP90Days: undefined }, { reportLevel: undefined }]) {
      const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: { ...factsFor('ECR-0423'), ...more } });
      assert.equal(d.outcome, 'recommend', JSON.stringify(more));
      assert.equal(d.limits!.filter((l) => !l.held).length, 1);
    }
  });

  it('a named trigger sends it to the CM analyst with the work done, even within the limits', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: { ...factsFor('ECR-0423'), triggers: ['new_supplier', 'stale_data'] } });
    assert.equal(d.outcome, 'escalate');
    assert.deepEqual(d.escalatedFor, ['new_supplier', 'stale_data']);
    assert.deepEqual(d.recipients, ['cm_analyst']);
  });

  it('never fast-track wins over a trigger: an ineligible ECR is refused, not escalated', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: { ...factsFor('ECR-0417'), triggers: ['safety_part'] } });
    assert.equal(d.outcome, 'deny');
  });

  it('refuses the fast track on ECR-0406 though it is filed Class II, because it is a safety part', () => {
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: factsFor('ECR-0406') });
    assert.equal(d.outcome, 'deny');
    assert.equal(d.decidedBy, 'approval.neverFastTrack[safety_part]');
  });
});

describe('the four ERP actions are always a recommendation', () => {
  const approvals: Array<EcrFacts['approvedBy']> = ['fast_track', 'trc', 'ccb', 'pmc'];

  for (const action of ERP_ACTIONS) {
    it(`${action}: a recommendation to the role that holds it, whatever the ECR, the cost or the approval`, () => {
      const holders = config.roles.filter((r) => r.can.includes(action)).map((r) => r.id);
      for (const id of ['ECR-0423', 'ECR-0417', 'ECR-0409']) {
        for (const approvedBy of approvals) {
          const d = decideAction(config, { action, actor: NORN, facts: { ...factsFor(id), approvedBy } });
          assert.equal(d.outcome, 'recommend', `${id} ${approvedBy}`);
          assert.equal(d.actsNow, false);
          assert.deepEqual(d.recipients, holders);
          assert.equal(d.sample, undefined);
        }
      }
    });

    it(`${action}: not available at all before the ECR is approved`, () => {
      const d = decideAction(config, { action, actor: NORN, facts: factsFor('ECR-0423') });
      assert.equal(d.outcome, 'deny');
      assert.match(flat(d), /has not been approved/);
    });
  }

  it('an agent acting for the person who holds the action still only recommends', () => {
    const accountant = personWith('cost_accountant');
    const d = decideAction(config, { action: 'post_journal_entry', actor: { kind: 'agent', actingFor: accountant.id }, facts: { ...factsFor('ECR-0423'), approvedBy: 'fast_track' } });
    assert.equal(d.outcome, 'recommend');
  });
});

describe('an agent acting for a person gets the stricter limit', () => {
  const asAgentFor = (personId: string): Actor => ({ kind: 'agent', actingFor: personId });

  it('is refused when the person lacks the action, though the company would let the agent do it', () => {
    const engineer = personWith('design_engineer');
    assert.ok(!config.roles.find((r) => r.id === 'design_engineer')!.can.includes('set_company_class'));
    const own = decideAction(config, { action: 'set_company_class', actor: NORN, facts: factsFor('ECR-0423') });
    assert.equal(own.outcome, 'approve_sampled');
    const forHim = decideAction(config, { action: 'set_company_class', actor: asAgentFor(engineer.id), facts: factsFor('ECR-0423') });
    assert.equal(forHim.outcome, 'deny');
    assert.equal(forHim.decidedBy, 'roles[design_engineer].can');
    assert.match(flat(forHim), /an agent acting for someone can do no more than they can/);
  });

  it('is decided by the company rule when the person holds the action', () => {
    const analyst = personWith('cm_analyst');
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: asAgentFor(analyst.id), facts: factsFor('ECR-0423') });
    assert.equal(d.outcome, 'approve_sampled');
    assert.equal(d.actsNow, true);
    assert.match(flat(d), /so the company's agent limits decide/);
  });

  it('is held to the company limits even when the person could do it unchecked', () => {
    const analyst = personWith('cm_analyst');
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: asAgentFor(analyst.id), facts: eligible('ECR-0423', 30_000) });
    assert.equal(d.outcome, 'recommend');
  });

  it('keeps the person\'s own conditions: a design engineer must own the change for the agent to approve on the fast track', () => {
    const engineer = personWith('design_engineer');
    const notOwner = decideAction(config, { action: 'approve_fast_track_ecr', actor: asAgentFor(engineer.id), facts: factsFor('ECR-0423') });
    assert.equal(notOwner.outcome, 'deny');
    assert.match(flat(notOwner), /must own the changed item/);
    const owner = decideAction(config, { action: 'approve_fast_track_ecr', actor: asAgentFor(engineer.id), facts: { ...factsFor('ECR-0423'), ownerId: engineer.id } });
    assert.equal(owner.outcome, 'approve_sampled');
  });

  it('is refused for a person who is not in the configuration', () => {
    const d = decideAction(config, { action: 'post_impact_statement', actor: asAgentFor('EMP-999'), facts: factsFor('ECR-0423') });
    assert.equal(d.outcome, 'deny');
    assert.match(flat(d), /not a person in this configuration/);
  });

  it('cannot approve at a tier for a person who does not chair a body that decides the change', () => {
    const director = personWith('engineering_director'); // chairs the technical review committee, up to 150,000
    const d = decideAction(config, { action: 'approve_ecr_at_tier', actor: asAgentFor(director.id), facts: factsFor('ECR-0417') });
    assert.equal(d.outcome, 'deny');
    assert.match(flat(d), /Change Control Board/);
  });
});

describe('people acting as themselves', () => {
  it('may do what their role lists, and are refused the rest', () => {
    const analyst = personWith('cm_analyst');
    assert.equal(decideAction(config, { action: 'set_company_class', actor: { kind: 'person', id: analyst.id }, facts: factsFor('ECR-0423') }).outcome, 'approve');
    assert.equal(decideAction(config, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: analyst.id }, facts: factsFor('ECR-0417') }).outcome, 'deny');
  });

  it('decide a change at a tier only if they chair a body whose tier covers it', () => {
    const decides = (roleId: string, ecr: string) => decideAction(config, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: personWith(roleId).id }, facts: factsFor(ecr) }).outcome;
    assert.equal(decides('ccb_chair', 'ECR-0417'), 'approve');
    assert.equal(decides('cfo', 'ECR-0417'), 'approve'); // a tier above covers it
    assert.equal(decides('engineering_director', 'ECR-0417'), 'deny'); // a tier below does not
    assert.equal(decides('engineering_director', 'ECR-0423'), 'approve');
    assert.equal(decides('ccb_chair', 'ECR-0423'), 'approve');
  });

  it('say which other roles must sign the fast track', () => {
    const analyst = personWith('cm_analyst');
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: { kind: 'person', id: analyst.id }, facts: factsFor('ECR-0423') });
    assert.equal(d.outcome, 'approve');
    assert.match(flat(d), /also needs the signature of Design engineer/);
  });

  it('are refused the fast track on an ECR that cannot take it, and told where it goes', () => {
    const analyst = personWith('cm_analyst');
    const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: { kind: 'person', id: analyst.id }, facts: factsFor('ECR-0417') });
    assert.equal(d.outcome, 'deny');
    assert.equal(d.reroute!.outcome, 'deny');
    assert.match(flat(d), /Change Control Board/);
  });

  it('are denied for an unknown person or an unknown action, without throwing', () => {
    assert.equal(decideAction(config, { action: 'file_ecr', actor: { kind: 'person', id: 'nobody' }, facts: factsFor('ECR-0423') }).outcome, 'deny');
    assert.equal(decideAction(config, { action: 'delete_everything', actor: NORN, facts: factsFor('ECR-0423') }).outcome, 'deny');
  });
});

describe('releasing an ECO carries out an approval while the approving body still covers the change', () => {
  const release = (facts: EcrFacts) => decideAction(config, { action: 'release_eco', actor: NORN, facts });

  it('is refused until the ECR is approved', () => {
    assert.equal(release(factsFor('ECR-0417')).outcome, 'deny');
  });

  it('releases ECR-0417 at 160,000 when the CCB approved it, though the limit is 25,000', () => {
    const d = release({ ...factsFor('ECR-0417'), approvedBy: 'ccb' });
    assert.equal(d.outcome, 'approve');
    assert.equal(d.actsNow, true);
    assert.equal(d.limits, undefined);
    assert.match(flat(d), /limits are waived/);
  });

  it('does not when only the technical review committee approved it, which does not cover its tier', () => {
    const d = release({ ...factsFor('ECR-0417'), approvedBy: 'trc' });
    assert.equal(d.outcome, 'recommend');
    assert.match(flat(d), /16\d,\d{3} USD against a limit of 25,000 USD/);
  });

  it('stops waiving when a re-quote lifts the change past the approving body\'s tier', () => {
    const f = eligible('ECR-0417', 3_000_000, { approvedBy: 'ccb' });
    assert.equal(release(f).outcome, 'recommend');
    assert.equal(release({ ...f, approvedBy: 'pmc' }).outcome, 'approve');
  });

  it('holds a fast-track approval to the limits: 600 is released, 30,000 is not', () => {
    assert.equal(release({ ...factsFor('ECR-0423'), approvedBy: 'fast_track' }).outcome, 'approve');
    assert.equal(release(eligible('ECR-0423', 30_000, { approvedBy: 'fast_track' })).outcome, 'recommend');
  });

  it('cannot waive the limits when the cost is unmeasured', () => {
    assert.equal(release({ ecrId: 'ECR-0417', approvedBy: 'pmc' }).outcome, 'recommend');
  });
});

describe('sampling', () => {
  // Norn acts only on an exact cost measure, so each call here carries one, whatever the action's own limits.
  const exactAt = (ecrId: string): EcrFacts => ({ ecrId, cost: eligible(ecrId, 600).cost });

  // The draws pinned in sample.test.ts, now through the decision. A draw under the rate holds the action for the blind check.
  const CLASS_CALLS: Array<[string, number, boolean]> = [
    ['ECR-0423', 0.8392148073762655, false],
    ['ECR-0417', 0.6571187830995768, false],
    ['ECR-0409', 0.18520728405565023, true],
    ['ECR-0415', 0.16507800621911883, true],
  ];
  const FAST_TRACK: Array<[string, number, boolean]> = [
    ['ECR-0423', 0.5386328629683703, false],
    ['ECR-0417', 0.28841888601891696, false],
    ['ECR-0409', 0.4529122475069016, false],
    ['ECR-0415', 0.2095401156693697, false],
  ];

  for (const [ecr, value, sampled] of CLASS_CALLS) {
    it(`${ecr} set_company_class: ${value.toFixed(4)} against 0.25, so ${sampled ? 'it waits for the second check' : 'the agent acts'}`, () => {
      const d = decideAction(config, { action: 'set_company_class', actor: NORN, facts: exactAt(ecr) });
      assert.equal(d.outcome, 'approve_sampled');
      assert.equal(d.sample!.value, value);
      assert.equal(d.sample!.rate, 0.25);
      assert.equal(d.sample!.sampled, sampled);
      assert.equal(d.actsNow, !sampled);
    });
  }

  for (const [ecr, value, sampled] of FAST_TRACK) {
    it(`${ecr} approve_fast_track_ecr: ${value.toFixed(4)} against 0.2, so ${sampled ? 'it waits for the second check' : 'the agent acts'}`, () => {
      // Whatever its real answers, give each ECR the facts that make it eligible, to reach the draw.
      const d = decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts: eligible(ecr, 600) });
      assert.equal(d.outcome, 'approve_sampled');
      assert.equal(d.sample!.value, value);
      assert.equal(d.sample!.sampled, sampled);
    });
  }

  it('a safety part on a class call goes to the CM analyst before any draw', () => {
    const d = decideAction(config, { action: 'set_company_class', actor: NORN, facts: { ecrId: 'ECR-0409', triggers: ['safety_part'] } });
    assert.equal(d.outcome, 'escalate');
    assert.equal(d.sample, undefined);
  });

  it('without a PLM number nothing is drawn: the agent recommends, and says it waits for the number', () => {
    for (const ecrId of ['NORN-12', '', 'ECR-17']) {
      const d = decideAction(config, { action: 'set_company_class', actor: NORN, facts: exactAt(ecrId) });
      assert.equal(d.outcome, 'recommend', ecrId);
      assert.equal(d.waitsForPlmNumber, true);
      assert.equal(d.sample, undefined);
      assert.equal(d.actsNow, false);
      assert.match(flat(d), /decided again once the PLM has numbered the ECR/);
    }
  });

  it('an action that does not sample does not need the number', () => {
    assert.equal(decideAction(config, { action: 'post_impact_statement', actor: NORN, facts: exactAt('NORN-12') }).outcome, 'approve');
  });

  it('a company\'s own sample seed decides the draw', () => {
    const other = structuredClone(config);
    other.autonomy.sampleSeed = 'a-different-seed';
    const a = decideAction(config, { action: 'set_company_class', actor: NORN, facts: exactAt('ECR-0423') });
    const b = decideAction(other, { action: 'set_company_class', actor: NORN, facts: exactAt('ECR-0423') });
    assert.notEqual(a.sample!.value, b.sample!.value);
  });
});

describe('every action has an answer, and every answer has its reasons', () => {
  it('decides each action for Norn\'s own agent on each demo ECR, with a rule and no em dash', () => {
    for (const action of ACTION_IDS) {
      for (const id of DEMO) {
        const d = decideAction(config, { action, actor: NORN, facts: { ...factsFor(id), approvedBy: 'ccb' } });
        assert.ok(['approve', 'approve_sampled', 'recommend', 'escalate', 'deny'].includes(d.outcome));
        assert.ok(d.decidedBy.length > 0 && d.reasons.length > 0, `${action} ${id}`);
        for (const r of d.reasons) assert.ok(!r.text.includes(String.fromCharCode(0x2014)), r.text);
      }
    }
  });

  it('is the same every time', () => {
    const input = { action: 'approve_fast_track_ecr', actor: NORN, facts: factsFor('ECR-0423') };
    assert.deepEqual(decideAction(config, input), decideAction(config, input));
  });
});

// Regression tests for the review of e829bc0. Each input is the reviewer's, and each test failed before its fix.
describe('when the facts cannot show an action is within its limits, it does not act', () => {
  const r3 = (n: number) => ({ p10: n, p50: n, p90: n });
  const fastTrack = (facts: EcrFacts) => decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN, facts });
  const withCost = (cost: CostForecast): EcrFacts => ({ ...factsFor('ECR-0423'), cost });

  it('netted totals cannot stand in for the gross spend: +200,000 tooling and a -190,000 credit is not a 10,000 change', () => {
    const netted: CostForecast = { windowMonths: 12, oneTime: r3(200_000), recurringWindow: r3(-190_000), windowTotal: r3(10_000) };
    assert.equal(config.approval.costMeasure.savingsOffset, false);
    const route = routeEcr(config, withCost(netted));
    assert.equal(route.cost.basis, 'unmeasured');
    assert.equal(route.cost.size, null);
    assert.notEqual(route.tier.bodyId, 'trc');
    const d = fastTrack(withCost(netted));
    assert.equal(d.actsNow, false);
    assert.equal(d.outcome, 'recommend');
    assert.match(flat(d), /unmeasured/);
  });

  it('accepts the gross spend and saving when the caller gives them, and routes the larger: 200,000 goes to the CCB', () => {
    const gross: CostForecast = { windowMonths: 12, oneTime: r3(200_000), recurringWindow: r3(-190_000), windowTotal: r3(10_000), gross: { spend: r3(200_000), saving: r3(190_000) } };
    const route = routeEcr(config, withCost(gross));
    assert.equal(route.cost.size, 200_000);
    assert.equal(route.tier.bodyId, 'ccb');
  });

  it('a lower bound that mixes spend and saving routes the change but never lets an agent act on it', () => {
    const small: CostForecast = { windowMonths: 12, oneTime: r3(10_000), recurringWindow: r3(-9_000), windowTotal: r3(1_000), gross: { spend: r3(10_000), saving: r3(9_000) } };
    const route = routeEcr(config, withCost(small));
    assert.equal(route.cost.size, 10_000);
    assert.equal(route.cost.basis, 'lower_bound');
    const d = fastTrack(withCost(small));
    assert.equal(d.actsNow, false);
    assert.equal(d.outcome, 'recommend');
    assert.match(flat(d), /Norn acts only on an exact measure/);
    assert.match(flat(d), /only a lower bound/);
  });

  it('a spend with no saving in any draw is exact from its own range', () => {
    const pure: CostForecast = { windowMonths: 12, oneTime: r3(0), recurringWindow: { p10: 100, p50: 200, p90: 300 }, windowTotal: { p10: 100, p50: 200, p90: 300 }, gross: { spend: { p10: 100, p50: 200, p90: 300 }, saving: r3(0) } };
    const m = measureCost(config, pure);
    assert.equal(m.size, 300);
    assert.equal(m.basis, 'estimated');
  });

  it('a range that straddles zero does not bound the p90 size: triangular(-40000, 0, 40000) is not a 22,111 change', () => {
    // Its p10 and p90 are about -22,111 and +22,111, but p90 of |x| is 27,351, over the 25,000 limit.
    const straddle = { p10: -22_111, p50: 0, p90: 22_111 };
    const offset = structuredClone(config);
    offset.approval.costMeasure.savingsOffset = true;
    const f = withCost({ windowMonths: 12, oneTime: straddle, recurringWindow: r3(0), windowTotal: straddle });
    assert.equal(routeEcr(offset, f).cost.basis, 'unmeasured');
    const d = decideAction(offset, { action: 'approve_fast_track_ecr', actor: NORN, facts: f });
    assert.equal(d.actsNow, false);
    assert.equal(d.outcome, 'recommend');
  });

  it('a range on one side of zero is used as it is, and a straddling one is a safe upper bound only at p50', () => {
    const offset = structuredClone(config);
    offset.approval.costMeasure.savingsOffset = true;
    const net = (windowTotal: { p10: number; p50: number; p90: number }): CostForecast => ({ windowMonths: 12, oneTime: r3(0), recurringWindow: r3(0), windowTotal });
    assert.equal(measureCost(offset, net({ p10: 100, p50: 150, p90: 300 })).size, 300);
    assert.equal(measureCost(offset, net({ p10: -300, p50: -150, p90: -100 })).size, 300);
    offset.approval.costMeasure.percentile = 'p50';
    assert.equal(measureCost(offset, net({ p10: -22_111, p50: 0, p90: 20_000 })).size, 22_111);
  });

  it('a cached route cannot be reused after the facts change: 140,000 with technical review approval is not 3,000,000', () => {
    const at = (size: number): EcrFacts => eligible('ECR-0417', size, { approvedBy: 'trc' });
    const stale = routeEcr(config, at(140_000));
    const fresh = decideAction(config, { action: 'release_eco', actor: NORN, facts: at(3_000_000), route: stale } as Parameters<typeof decideAction>[1]);
    assert.equal(fresh.actsNow, false);
    assert.equal(fresh.outcome, 'recommend');
    assert.match(flat(fresh), /3,000,000 USD against a limit of 25,000 USD/);
  });

  it('an exact figure is refused unless it is the configured measure over the configured horizon', () => {
    const f = eligible('ECR-0423', 600);
    const refused = (cost: CostForecast) => {
      assert.equal(routeEcr(config, { ...f, cost }).cost.basis, 'unmeasured');
      assert.equal(fastTrack({ ...f, cost }).actsNow, false);
    };
    refused({ ...f.cost!, measured: exactMeasure(600, 600, { horizonMonths: 6 }) });
    refused({ ...f.cost!, windowMonths: 6 });
    refused({ ...f.cost!, measured: exactMeasure(600, 600, { savingsOffset: true }) });
    refused({ ...f.cost!, measured: { ...exactMeasure(600, 600), source: 'estimate' } as unknown as ExactCostMeasure });
    refused({ ...f.cost!, measured: exactMeasure(-1, -1) });
    assert.equal(fastTrack(f).actsNow, true);
  });

  it('an approval by something that is not a configured body does not satisfy the prerequisite', () => {
    for (const action of ['release_eco', 'post_journal_entry', 'write_bom']) {
      const d = decideAction(config, { action, actor: NORN, facts: { ...factsFor('ECR-0423'), approvedBy: 'not-a-body' } });
      assert.equal(d.outcome, 'deny', action);
      assert.match(flat(d), /not-a-body/);
    }
    assert.equal(decideAction(config, { action: 'release_eco', actor: NORN, facts: { ...factsFor('ECR-0423'), approvedBy: 'ccb' } }).outcome, 'approve');
  });
});

// Regression tests for the second review. No estimate from summary quantiles authorizes anything: Norn acts only on
// the exact measure, computed per draw by the checks.
describe('Norn acts only on an exact cost measure', () => {
  const r3 = (n: number) => ({ p10: n, p50: n, p90: n });
  const NORN_: Actor = { kind: 'agent' };
  const fastTrack = (facts: EcrFacts) => decideAction(config, { action: 'approve_fast_track_ecr', actor: NORN_, facts });
  const MEASURE_REASON = /Norn acts only on an exact measure/;

  it('ECR-0423 on the fast track: an exact measure within the limit acts, the check\'s estimate recommends', () => {
    const exact = fastTrack(factsFor('ECR-0423'));
    assert.equal(exact.outcome, 'approve_sampled');
    assert.equal(exact.actsNow, true);
    const estimate = fastTrack(factsFor('ECR-0423', false));
    assert.equal(routeEcr(config, factsFor('ECR-0423', false)).cost.basis, 'estimated');
    assert.equal(estimate.outcome, 'recommend');
    assert.equal(estimate.actsNow, false);
    assert.match(flat(estimate), MEASURE_REASON);
    assert.match(flat(estimate), /estimated from the assessment's ranges/);
  });

  it('with only the check\'s estimates, every action Norn would take is a recommendation', () => {
    const approved = { approvedBy: 'trc' };
    for (const id of ['ECR-0423', 'ECR-0417', 'ECR-0409', 'ECR-0406']) {
      for (const action of ACTION_IDS) {
        const d = decideAction(config, { action, actor: NORN_, facts: { ...factsFor(id, false), ...approved } });
        assert.equal(d.actsNow, false, `${id} ${action}: ${d.outcome}`);
      }
    }
  });

  it('a row of +200,000 one-time and -190,000 unit cost nets to 10,000 inside the check, and is not a 10,000 spend', () => {
    const row = { id: 'r1', oneTime: r3(200_000), extended: r3(-190_000) };
    const netted: CostCheckHeadline = {
      window: { months: 12 },
      headline: { oneTimeTotal: r3(10_000), recurringWindow: r3(0), windowTotal: r3(10_000) },
      blocks: { production: [row] },
    };
    const forecast = costForecastFromCheck(netted);
    assert.equal(forecast.gross, undefined);
    assert.equal(routeEcr(config, { ...factsFor('ECR-0423'), cost: forecast }).cost.basis, 'unmeasured');
    const d = decideAction(config, { action: 'release_eco', actor: NORN_, facts: { ...factsFor('ECR-0423'), cost: forecast, approvedBy: 'fast_track' } });
    assert.equal(d.actsNow, false);
    assert.equal(d.outcome, 'recommend');
    assert.match(flat(d), /unmeasured/);
    // Rows that all share a sign in both components do give a gross figure.
    const pure = costForecastFromCheck({ ...netted, blocks: { production: [{ id: 'r1', oneTime: r3(200_000), extended: r3(50_000) }] } });
    assert.ok(pure.gross);
    assert.equal(pure.gross.saving.p90, 0);
  });

  it('stock dispositions are read as components of their row, not through the row total', () => {
    const f = costForecastFromCheck({
      window: { months: 12 },
      headline: { oneTimeTotal: r3(10_000), recurringWindow: r3(0), windowTotal: r3(10_000) },
      blocks: { production: [{ id: 'stock', oneTime: r3(10_000), extended: null }] },
      inventory: [{ rowId: 'stock', rows: [{ cost: r3(200_000) }, { cost: r3(-190_000) }] }],
    });
    assert.equal(f.gross, undefined);
  });

  it('unknown tails: 9% uniform[-100000,-90000] and 91% uniform[0,27000] is not a 24,033 change that may act', () => {
    // p10, p50 and p90 are about 297, 12,165 and 24,033, but the true p90 of |x| is 26,703, over the 25,000 limit.
    const q = { p10: 297, p50: 12_165, p90: 24_033 };
    const cost: CostForecast = { windowMonths: 12, oneTime: q, recurringWindow: r3(0), windowTotal: q, gross: { spend: q, saving: r3(0) } };
    const offset = structuredClone(config);
    offset.approval.costMeasure.savingsOffset = true;
    for (const c of [config, offset]) {
      const d = decideAction(c, { action: 'approve_fast_track_ecr', actor: NORN_, facts: { ...factsFor('ECR-0423'), cost } });
      assert.equal(d.actsNow, false);
      assert.equal(d.outcome, 'recommend');
      assert.match(flat(d), MEASURE_REASON);
    }
  });

  it('a lower bound does not authorize a chair: spend and saving both at a p90 of 100,000 can be 200,000 as the larger of the two', () => {
    // 82% (100k, 100k), 9% (200k, 100k), 9% (100k, 200k): both gross p90s are 100k, the p90 of the larger is 200k.
    const cost: CostForecast = { windowMonths: 12, oneTime: r3(0), recurringWindow: r3(0), windowTotal: r3(0), gross: { spend: r3(100_000), saving: r3(100_000) } };
    const facts: EcrFacts = { ...factsFor('ECR-0417'), cost };
    const route = routeEcr(config, facts);
    assert.equal(route.cost.basis, 'lower_bound');
    assert.equal(route.tier.bodyId, 'trc');
    const d = decideAction(config, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: personWith('engineering_director').id }, facts });
    assert.equal(d.actsNow, false);
    assert.equal(d.outcome, 'recommend');
    assert.match(flat(d), MEASURE_REASON);
    assert.deepEqual(d.recipients, ['engineering_director']);
    // With the exact measure at 100,000 the same director approves; at 200,000 the tier is the CCB and they may not.
    const at = (size: number) => decideAction(config, { action: 'approve_ecr_at_tier', actor: { kind: 'person', id: personWith('engineering_director').id }, facts: eligible('ECR-0417', size) });
    assert.equal(at(100_000).actsNow, true);
    assert.equal(at(200_000).outcome, 'deny');
  });
});
