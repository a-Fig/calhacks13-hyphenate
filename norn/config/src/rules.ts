// Rules that look across fields and sections: a reference must point at something that exists, a
// role must be allowed to do what the file asks of it, tiers must run in order. The shape of each
// field is the schema's job (schema.ts); these assume the sections they list in `needs` have
// already passed it, so they can read them without guarding.
//
// Every rule reports all the problems it finds, each against the path of the field to fix.

import type { Issue } from './kit.ts';
import { describe, didYouMean } from './kit.ts';
import {
  ACTION_IDS,
  ERP_ACTIONS,
  EVIDENCE_CLASS_IDS,
  FOLLOWS_APPROVAL,
  LEVEL_RANK,
  REQUIRED_FIELD_KINDS,
  type ActionId,
  type ClassRef,
  type CompanyConfig,
  type FieldKind,
  type SectionName,
} from './schema.ts';

export interface Rule {
  /** Sections that must be well formed for the rule to run. It reads nothing else. */
  needs: SectionName[];
  run(config: CompanyConfig, issues: Issue[]): void;
}

// ---------------------------------------------------------------- helpers

const quote = (values: readonly string[]): string => values.map((v) => JSON.stringify(v)).join(', ');

/** Complains at `path` unless `value` is one of `known`. Returns whether it was. */
function mustExist(value: string, known: readonly string[], what: string, path: string, issues: Issue[]): boolean {
  if (known.includes(value)) return true;
  issues.push({ path, message: `expected ${what} defined in this file (${quote(known)}), got ${describe(value)}${didYouMean(value, known)}` });
  return false;
}

function mustBeAllowedTo(roleId: string, action: ActionId, config: CompanyConfig, path: string, issues: Issue[]): void {
  const index = config.roles.findIndex((r) => r.id === roleId);
  const role = config.roles[index];
  if (role && !role.can.includes(action)) {
    issues.push({ path, message: `role ${JSON.stringify(roleId)} cannot ${action} (roles[${index}].can lacks it), but this entry needs it to` });
  }
}

function checkClassRef(ref: ClassRef, path: string, config: CompanyConfig, issues: Issue[]): void {
  const values = config.changeClasses[ref.axis].values.map((v) => v.id);
  mustExist(ref.value, values, `a ${ref.axis} class`, `${path}.value`, issues);
}

const roleIds = (config: CompanyConfig): string[] => config.roles.map((r) => r.id);

// ---------------------------------------------------------------- the rules

export const rules: Rule[] = [
  {
    // The form must carry what Norn's checks read, once each, and options only where they belong.
    needs: ['ecrForm'],
    run({ ecrForm }, issues) {
      const found = new Map<FieldKind, string>();
      ecrForm.sections.forEach((section, s) =>
        section.fields.forEach((field, f) => {
          const path = `ecrForm.sections[${s}].fields[${f}]`;
          if (field.kind === 'choice' && !field.options) {
            issues.push({ path: `${path}.options`, message: 'expected the options to choose from, because kind is "choice", got nothing' });
          }
          if (field.kind !== 'choice' && field.options) {
            issues.push({ path: `${path}.options`, message: `expected no options, because kind is ${JSON.stringify(field.kind)} and only "choice" takes options` });
          }
          const single = REQUIRED_FIELD_KINDS.includes(field.kind);
          const first = found.get(field.kind);
          if (single && first) issues.push({ path: `${path}.kind`, message: `expected each field of kind ${JSON.stringify(field.kind)} to appear once, already used at ${first}` });
          else if (single) found.set(field.kind, `${path}.kind`);
        })
      );
      for (const kind of REQUIRED_FIELD_KINDS) {
        if (!found.has(kind)) issues.push({ path: 'ecrForm.sections', message: `expected a field of kind ${JSON.stringify(kind)}, because Norn's checks read it, got none` });
      }
    },
  },
  {
    needs: ['ecrForm', 'changeClasses'],
    run({ ecrForm, changeClasses }, issues) {
      const classes = changeClasses.company.values.map((v) => v.id);
      ecrForm.sections.forEach((section, s) =>
        section.fields.forEach((field, f) =>
          field.askedFor?.forEach((value, k) => mustExist(value, classes, 'a company class', `ecrForm.sections[${s}].fields[${f}].askedFor[${k}]`, issues))
        )
      );
    },
  },
  {
    needs: ['changeClasses', 'roles'],
    run(config, issues) {
      const { changeClasses } = config;
      const gate = { company: 'set_company_class', regulatory: 'set_regulatory_class' } as const;
      for (const axis of ['company', 'regulatory'] as const) {
        const a = changeClasses[axis];
        mustExist(a.whenUnsure, a.values.map((v) => v.id), `a ${axis} class`, `changeClasses.${axis}.whenUnsure`, issues);
        if (mustExist(a.decidedBy, roleIds(config), 'a role', `changeClasses.${axis}.decidedBy`, issues)) {
          mustBeAllowedTo(a.decidedBy, gate[axis], config, `changeClasses.${axis}.decidedBy`, issues);
        }
      }
    },
  },
  {
    // Tiers run from cheap to dear, the last has no limit, and each names a body that exists, one body to a tier.
    needs: ['approval'],
    run({ approval }, issues) {
      const bodies = approval.bodies.map((b) => b.id);
      const tierOfBody = new Map<string, number>();
      approval.tiers.forEach((tier, i) => {
        const path = `approval.tiers[${i}]`;
        const last = i === approval.tiers.length - 1;
        if (mustExist(tier.body, bodies, 'an approval body', `${path}.body`, issues)) {
          const first = tierOfBody.get(tier.body);
          if (first === undefined) tierOfBody.set(tier.body, i);
          else issues.push({ path: `${path}.body`, message: `expected a body that no other tier uses, but ${JSON.stringify(tier.body)} already decides approval.tiers[${first}]` });
        }
        if (!last && tier.upTo === null) {
          issues.push({ path: `${path}.upTo`, message: 'expected a number, because only the last tier has no limit, got null' });
        } else if (last && tier.upTo !== null) {
          issues.push({ path: `${path}.upTo`, message: `expected null, because the last tier takes every cost above the one before it, got ${tier.upTo}` });
        }
        const before = approval.tiers[i - 1]?.upTo;
        if (i > 0 && typeof before === 'number' && typeof tier.upTo === 'number' && tier.upTo <= before) {
          issues.push({ path: `${path}.upTo`, message: `expected a number above tiers[${i - 1}].upTo (${before}), got ${tier.upTo}` });
        }
      });
    },
  },
  {
    // Bodies and the fast track name roles; the roles must be allowed to do the deciding.
    needs: ['approval', 'roles'],
    run(config, issues) {
      const { approval } = config;
      const known = roleIds(config);
      approval.bodies.forEach((body, i) => {
        const path = `approval.bodies[${i}]`;
        if (mustExist(body.chairRole, known, 'a role', `${path}.chairRole`, issues)) mustBeAllowedTo(body.chairRole, 'approve_ecr_at_tier', config, `${path}.chairRole`, issues);
        body.memberRoles.forEach((role, k) => {
          if (mustExist(role, known, 'a role', `${path}.memberRoles[${k}]`, issues)) mustBeAllowedTo(role, 'review_ecr', config, `${path}.memberRoles[${k}]`, issues);
        });
        if (body.secretaryRole) mustExist(body.secretaryRole, known, 'a role', `${path}.secretaryRole`, issues);
      });
      approval.fastTrack.approvers.forEach((approver, i) => {
        const path = `approval.fastTrack.approvers[${i}].role`;
        if (mustExist(approver.role, known, 'a role', path, issues)) mustBeAllowedTo(approver.role, 'approve_fast_track_ecr', config, path, issues);
      });
    },
  },
  {
    // Class checks in the fast-track and never-fast-track tests must name real classes; test ids are unique across the three lists.
    needs: ['approval', 'changeClasses'],
    run(config, issues) {
      const { approval } = config;
      const lists = [
        ['fastTrack.requireAll', approval.fastTrack.requireAll],
        ['fastTrack.requireOneOf', approval.fastTrack.requireOneOf],
        ['neverFastTrack', approval.neverFastTrack],
      ] as const;
      const seen = new Map<string, string>();
      for (const [name, list] of lists) {
        list.forEach((t, i) => {
          const path = `approval.${name}[${i}]`;
          if (t.whenClass) checkClassRef(t.whenClass, `${path}.whenClass`, config, issues);
          const first = seen.get(t.id);
          if (first) issues.push({ path: `${path}.id`, message: `duplicate id ${describe(t.id)}, already used at ${first}` });
          else seen.set(t.id, `${path}.id`);
        });
      }
    },
  },
  {
    // People point at roles and at each other; a reporting line must not loop.
    needs: ['people', 'roles'],
    run(config, issues) {
      const { people } = config;
      const ids = people.map((p) => p.id);
      const reports = new Map(people.map((p) => [p.id, p.reportsTo]));
      const looped = new Set<string>();
      people.forEach((p, i) => {
        mustExist(p.role, roleIds(config), 'a role', `people[${i}].role`, issues);
        if (p.reportsTo === undefined) return;
        const path = `people[${i}].reportsTo`;
        if (p.reportsTo === p.id) return void issues.push({ path, message: 'expected another person, got the person themselves' });
        if (!mustExist(p.reportsTo, ids, 'a person', path, issues)) return;
        const chain = [p.id];
        for (let next = reports.get(p.id); next !== undefined; next = reports.get(next)) {
          if (next === p.id) {
            if (!chain.some((c) => looped.has(c))) issues.push({ path, message: `expected a reporting line that ends, but it loops back to ${p.id} through ${chain.slice(1).join(', ') || 'itself'}` });
            chain.forEach((c) => looped.add(c));
            break;
          }
          if (chain.includes(next)) break; // someone else's loop, reported there
          chain.push(next);
        }
      });
    },
  },
  {
    // Every action has a rule, and each rule is consistent with itself.
    needs: ['autonomy', 'roles'],
    run(config, issues) {
      const { autonomy } = config;
      const known = roleIds(config);
      const covered = new Set<ActionId>(autonomy.actions.map((a) => a.action));
      for (const action of ACTION_IDS) {
        if (!covered.has(action)) issues.push({ path: 'autonomy.actions', message: `expected a rule for ${JSON.stringify(action)}, because every action needs an explicit level, got none` });
      }
      autonomy.actions.forEach((rule, i) => {
        const path = `autonomy.actions[${i}]`;
        const levels = [rule.level, ...(rule.otherwise ? [rule.otherwise] : [])];
        const acts = rule.level === 'approve' || rule.level === 'approve_sampled';
        // Norn never writes to the ERP, so these can only be recommended, to the person who enters them (#71, #72).
        // The refusals here replace the checks on limits, fallbacks and carrying out an approval below, which would only repeat them.
        const erp = ERP_ACTIONS.includes(rule.action);
        if (erp) {
          const because = `Norn never writes to the ERP (#71), so ${rule.action} can only be recommended, in the ERP change package for a person to enter (#72)`;
          if (rule.level !== 'recommend') {
            issues.push({ path: `${path}.level`, message: `expected "recommend", because ${because}, got ${JSON.stringify(rule.level)}` });
          }
          for (const key of ['limits', 'otherwise', 'carriesOutApproval'] as const) {
            if (rule[key] !== undefined) issues.push({ path: `${path}.${key}`, message: `expected no ${key}, because ${because}, got ${JSON.stringify(rule[key])}` });
          }
        }
        // A limit left undefined is not a limit: it would be dropped when the config is stored, and the stored copy refused.
        if (!erp && rule.limits && Object.values(rule.limits).every((v) => v === undefined)) {
          issues.push({ path: `${path}.limits`, message: 'expected at least one limit, got none' });
        }
        if (!erp && rule.limits && !acts) {
          issues.push({ path: `${path}.limits`, message: `expected no limits, because level ${JSON.stringify(rule.level)} does not let the agent act and limits only bound a level that does` });
        }
        if (!erp && rule.carriesOutApproval !== undefined) {
          if (!FOLLOWS_APPROVAL.includes(rule.action)) {
            issues.push({ path: `${path}.carriesOutApproval`, message: `expected nothing, because only ${FOLLOWS_APPROVAL.join(' and ')} can carry out an approval and ${rule.action} cannot, got ${rule.carriesOutApproval}` });
          } else if (!rule.limits) {
            issues.push({ path: `${path}.carriesOutApproval`, message: 'expected limits to be set, because carrying out an approval only waives limits, got no limits' });
          }
        }
        if (!erp && rule.otherwise && !rule.limits) {
          issues.push({ path: `${path}.otherwise`, message: 'expected limits to be set, because otherwise only applies once a limit is passed, got no limits' });
        }
        if (!erp && rule.otherwise && LEVEL_RANK[rule.otherwise] >= LEVEL_RANK[rule.level]) {
          issues.push({ path: `${path}.otherwise`, message: `expected a level less autonomous than ${JSON.stringify(rule.level)}, because a fallback that is not lower takes no authority away once a limit is passed, got ${JSON.stringify(rule.otherwise)}` });
        }
        if (levels.includes('approve_sampled') && rule.sampleRate === undefined) {
          issues.push({ path: `${path}.sampleRate`, message: 'expected a sample rate, because a level is approve_sampled, got nothing' });
        }
        if (!levels.includes('approve_sampled') && rule.sampleRate !== undefined) {
          issues.push({ path: `${path}.sampleRate`, message: 'expected no sample rate, because no level is approve_sampled' });
        }
        const escalates = levels.includes('escalate') || (rule.escalateOn?.length ?? 0) > 0;
        if (escalates && !rule.escalateTo) {
          issues.push({ path: `${path}.escalateTo`, message: 'expected the role to escalate to, because the rule can escalate, got nothing' });
        }
        // Whoever receives the matter must be able to finish it.
        if (rule.escalateTo && mustExist(rule.escalateTo, known, 'a role', `${path}.escalateTo`, issues)) {
          mustBeAllowedTo(rule.escalateTo, rule.action, config, `${path}.escalateTo`, issues);
        }
      });
    },
  },
  {
    // A role that the file makes responsible for something needs a person in it, or the work has nobody to go to.
    needs: ['approval', 'changeClasses', 'autonomy', 'people', 'roles'],
    run(config, issues) {
      const { approval, changeClasses, autonomy, people } = config;
      const known = roleIds(config);
      const held = new Set(people.map((p) => p.role));
      const needsSomeone = (role: string, path: string, duty: string): void => {
        // A role that does not exist is reported where roles are checked.
        if (known.includes(role) && !held.has(role)) {
          issues.push({ path, message: `expected a role that at least one person holds, because it ${duty}, got ${JSON.stringify(role)}, which nobody in people holds` });
        }
      };
      approval.bodies.forEach((body, i) => needsSomeone(body.chairRole, `approval.bodies[${i}].chairRole`, 'chairs a body'));
      for (const axis of ['company', 'regulatory'] as const) {
        needsSomeone(changeClasses[axis].decidedBy, `changeClasses.${axis}.decidedBy`, 'decides a change class');
      }
      approval.fastTrack.approvers.forEach((approver, i) => needsSomeone(approver.role, `approval.fastTrack.approvers[${i}].role`, 'signs on the fast track'));
      autonomy.actions.forEach((rule, i) => {
        if (rule.escalateTo) needsSomeone(rule.escalateTo, `autonomy.actions[${i}].escalateTo`, 'receives escalations');
      });
    },
  },
  {
    // A recommendation is read by a role that holds the action, so some person must be in such a role.
    needs: ['autonomy', 'roles', 'people'],
    run({ autonomy, roles, people }, issues) {
      const held = new Set(people.map((p) => p.role));
      autonomy.actions.forEach((rule, i) => {
        const path = `autonomy.actions[${i}]`;
        // The loader fills in 'recommend' as the fallback of a rule with limits, so that counts too.
        const fallback = rule.otherwise ?? (rule.limits ? 'recommend' : undefined);
        let where: string;
        let because: string;
        if (rule.level === 'recommend') [where, because] = [`${path}.level`, 'the agent recommends it'];
        else if (fallback === 'recommend') [where, because] = [rule.otherwise ? `${path}.otherwise` : `${path}.limits`, 'the agent recommends it once a limit is passed'];
        else return;
        const holders = roles.filter((r) => r.can.includes(rule.action));
        if (holders.length === 0) {
          issues.push({ path: where, message: `expected a role that can ${rule.action}, because ${because} and the recommendation goes to a role that holds it, got none (no role's can lists it)` });
        } else if (!holders.some((r) => held.has(r.id))) {
          issues.push({ path: where, message: `expected a person in a role that can ${rule.action}, because ${because}, got none (nobody in people holds ${quote(holders.map((r) => r.id))})` });
        }
      });
    },
  },
  {
    // The board is the approval body that vocabulary.terms.board names. A person's seat on it must agree with its roles.
    needs: ['people', 'approval', 'vocabulary'],
    run({ people, approval, vocabulary }, issues) {
      const seated = people.flatMap((person, i) => (person.ccbRole === undefined ? [] : [{ person, path: `people[${i}].ccbRole` }]));
      if (seated.length === 0) return;
      const boardName = vocabulary.terms.board.name;
      const boards = approval.bodies.filter((b) => b.name === boardName);
      if (boards.length !== 1) {
        issues.push({ path: seated[0]!.path, message: `expected exactly one approval body named ${JSON.stringify(boardName)} (vocabulary.terms.board), because people sit on it, got ${boards.length}` });
        return;
      }
      const board = boards[0]!;
      let chairAt: string | undefined;
      for (const { person, path } of seated) {
        if (person.ccbRole === 'chair') {
          if (chairAt !== undefined) issues.push({ path, message: `expected one chair at most, but ${chairAt} is already the chair` });
          else chairAt = path;
          if (person.role !== board.chairRole) issues.push({ path, message: `expected a person in the board's chair role (${JSON.stringify(board.chairRole)}), got role ${JSON.stringify(person.role)}` });
        } else if (person.ccbRole === 'secretary') {
          if (person.role !== board.secretaryRole) issues.push({ path, message: `expected a person in the board's secretary role (${board.secretaryRole === undefined ? 'none is set' : JSON.stringify(board.secretaryRole)}), got role ${JSON.stringify(person.role)}` });
        } else if (!board.memberRoles.includes(person.role)) {
          issues.push({ path, message: `expected a person in one of the board's member roles (${quote(board.memberRoles)}), got role ${JSON.stringify(person.role)}` });
        }
      }
    },
  },
  {
    needs: ['reviewDepth', 'changeClasses', 'roles'],
    run(config, issues) {
      const { deepReview } = config.reviewDepth;
      deepReview.autoFor?.forEach((ref, i) => checkClassRef(ref, `reviewDepth.deepReview.autoFor[${i}]`, config, issues));
      deepReview.mayRequest.forEach((role, i) => mustExist(role, roleIds(config), 'a role', `reviewDepth.deepReview.mayRequest[${i}]`, issues));
    },
  },
  {
    // The likelihood words must tile a range without gaps or overlaps, and all four evidence classes need a label.
    needs: ['postingStandards'],
    run({ postingStandards }, issues) {
      const scale = postingStandards.likelihoodScale;
      scale.forEach((word, i) => {
        const path = `postingStandards.likelihoodScale[${i}]`;
        if (word.toPct <= word.fromPct) issues.push({ path: `${path}.toPct`, message: `expected a number above fromPct (${word.fromPct}), got ${word.toPct}` });
        const before = scale[i - 1];
        if (before && word.fromPct !== before.toPct) {
          issues.push({ path: `${path}.fromPct`, message: `expected ${before.toPct}, where ${JSON.stringify(before.word)} ends, so no probability falls between two words, got ${word.fromPct}` });
        }
      });
      const named = new Set(postingStandards.evidenceClasses.map((c) => c.id));
      for (const needed of EVIDENCE_CLASS_IDS) {
        if (!named.has(needed)) issues.push({ path: 'postingStandards.evidenceClasses', message: `expected a label for ${JSON.stringify(needed)}, because all four evidence classes are shown, got none` });
      }
    },
  },
];
