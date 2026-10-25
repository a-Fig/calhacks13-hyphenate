// The company gate's reasons are written in the configuration's own ids ("The company sets
// approve_fast_track_ecr to approve_sampled for agents: ..."). A person reads them as business words.
// The ids are the configuration's (config/src/schema.ts: ACTIONS, AUTONOMY_LEVELS, TRIGGERS); each map is typed
// on them, so a new id fails the typecheck here until it has words.
import { ACTION_IDS, LEVEL_IDS, SECTION_NAMES, TRIGGER_IDS, type ActionId, type AutonomyLevel, type TriggerId } from '../../../../config/src/schema.ts';

/** `base` follows "may" or "cannot"; `ing` stands as the subject of a sentence. */
export const ACTION_WORDS: Record<ActionId, { base: string; ing: string }> = {
  file_ecr: { base: 'file an ECR', ing: 'filing an ECR' },
  review_ecr: { base: 'record concurrence on an ECR', ing: 'recording concurrence on an ECR' },
  set_company_class: { base: 'set the company change class', ing: 'setting the company change class' },
  set_regulatory_class: { base: 'set the regulatory change class', ing: 'setting the regulatory change class' },
  post_impact_statement: { base: 'post an impact statement', ing: 'posting an impact statement' },
  approve_fast_track_ecr: { base: 'approve an ECR on the fast track', ing: 'approving an ECR on the fast track' },
  approve_ecr_at_tier: { base: "decide an ECR as chair of its cost tier's body", ing: "deciding an ECR as chair of its cost tier's body" },
  release_eco: { base: 'release the ECO', ing: 'releasing the ECO' },
  write_bom: { base: 'enter the new bill of materials in the ERP', ing: 'entering the new bill of materials in the ERP' },
  update_standard_cost: { base: 'enter a new standard cost in the ERP', ing: 'entering a new standard cost in the ERP' },
  draft_journal_entry: { base: 'enter a journal entry in the ERP', ing: 'entering a journal entry in the ERP' },
  post_journal_entry: { base: 'post a journal entry to the ledger', ing: 'posting a journal entry to the ledger' },
};

export const LEVEL_WORDS: Record<AutonomyLevel, string> = {
  approve: 'approve',
  approve_sampled: 'approve, with a sampled second check',
  recommend: 'recommend',
  escalate: 'escalate',
};

export const TRIGGER_WORDS: Record<TriggerId, string> = {
  safety_part: 'a safety part',
  new_supplier: 'a new supplier',
  conflicting_open_ecr: 'a conflicting open ECR',
  shared_supplier_exposure: 'shared supplier exposure',
  linchpin_assumption_agent_estimated: 'a key assumption an agent estimated',
  sources_conflict: 'conflicting sources',
  stale_data: 'stale data',
  checker_disagrees: 'a disagreeing checker',
};

/**
 * The company's own names for its ids, read from the stored configuration (norn_config, key company_config):
 * a tier is named by the body that decides it, a role by its label.
 */
export interface Names {
  bodies: Record<string, string>;
  tiers: Record<string, string>;
  roles: Record<string, string>;
}
export const NO_NAMES: Names = { bodies: {}, tiers: {}, roles: {} };

const isRec = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const read = new Map<string, Names>();
/** The names in a stored company configuration; empty for text that is not one. Remembered per text. */
export function namesOf(configText: string | undefined): Names {
  if (!configText) return NO_NAMES;
  const seen = read.get(configText);
  if (seen) return seen;
  const out: Names = { bodies: {}, tiers: {}, roles: {} };
  try {
    const c = JSON.parse(configText);
    for (const b of Array.isArray(c?.approval?.bodies) ? c.approval.bodies : []) if (isRec(b) && typeof b.id === 'string' && typeof b.name === 'string') out.bodies[b.id] = b.name;
    for (const t of Array.isArray(c?.approval?.tiers) ? c.approval.tiers : []) if (isRec(t) && typeof t.id === 'string' && typeof t.body === 'string' && out.bodies[t.body]) out.tiers[t.id] = out.bodies[t.body];
    for (const r of Array.isArray(c?.roles) ? c.roles : []) if (isRec(r) && typeof r.id === 'string' && typeof r.label === 'string') out.roles[r.id] = r.label;
  } catch { /* not a configuration: no names */ }
  if (read.size > 20) read.clear();
  read.set(configText, out);
  return out;
}

const WB = String.raw`\b`;
const alt = (ids: readonly string[]) => [...ids].sort((a, b) => b.length - a.length).join('|');
const esc = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const ACTION_RE = alt(ACTION_IDS);
const LEVEL_RE = alt(LEVEL_IDS);
const SNAKE_LEVEL_RE = alt(LEVEL_IDS.filter(l => l.includes('_')));
const TRIGGER_RE = alt(TRIGGER_IDS);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const action = (id: string) => ACTION_WORDS[id as ActionId];
const re = (source: string) => new RegExp(source, 'g');
const camel = (w: string) => w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

// A configuration path: a section of the configuration, then fields and [ids]: autonomy.actions[release_eco].level
const PATH_RE = re(`${WB}(?:${SECTION_NAMES.join('|')})(?:\\[[^\\]]+\\]|\\.[A-Za-z]+)+`);
const LIMIT_WORDS: Record<string, string> = { maxCost: 'cost limit', maxP90SlipDays: 'slip limit', minReportLevel: 'report-level limit' };

/** A configuration path in words: "the company's autonomy setting for releasing the ECO, cost limit". */
function pathWords(path: string, names: Names): string {
  const parts = [...path.matchAll(/([A-Za-z]+)|\[([^\]]+)\]/g)].map(m => (m[1] !== undefined ? { name: m[1] } : { id: m[2] }));
  const at = (i: number) => parts[i] as { name?: string; id?: string } | undefined;
  const root = at(0)?.name;
  if (root === 'autonomy' && at(1)?.name === 'actions' && at(2)?.id) {
    const id = at(2)!.id!;
    const what = ACTION_WORDS[id as ActionId]?.ing ?? id.replace(/_/g, ' ');
    const tail = parts.slice(3).map(p => p.name).filter((n): n is string => !!n && n !== 'level');
    const extra = tail[0] === 'limits' ? LIMIT_WORDS[tail[1] ?? ''] : tail[0] === 'carriesOutApproval' ? 'carrying out an approval' : tail[0] === 'escalateOn' ? 'escalation triggers' : tail.map(camel).join(' ');
    return `the company's autonomy settings for ${what}${extra ? `, ${extra}` : ''}`;
  }
  if (root === 'roles' && at(1)?.id) {
    const id = at(1)!.id!;
    return `what the ${names.roles[id] ?? id.replace(/_/g, ' ')} role may do`;
  }
  if (root === 'approval' && at(1)?.name === 'tiers' && at(2)?.id) return `the ${names.tiers[at(2)!.id!] ?? at(2)!.id!.replace(/_/g, ' ')} rule`;
  if (root === 'approval' && at(1)?.name === 'bodies' && at(2)?.id) return `the ${names.bodies[at(2)!.id!] ?? at(2)!.id!.replace(/_/g, ' ')} rule`;
  const words = parts.map(p => (p.name ? camel(p.name) : (p.id ?? '').replace(/_/g, ' '))).join(' ');
  return `the company's ${words} setting`;
}

/**
 * A gate reason (or an action-log policy or summary) with the configuration's action, level, trigger, tier, body
 * and role ids, and its configuration paths, in business words. Text with none is unchanged. `names` are the
 * company's own names for tiers, bodies and roles; without them those ids are left alone.
 */
export function plainReason(text: string, names: Names = NO_NAMES): string {
  let out = text
    .replace(re(`The company sets (${ACTION_RE}) to (${LEVEL_RE}) for agents:`), (_m, a: string, l: string) => `For agents, the company's rule for ${action(a).ing} is to ${LEVEL_WORDS[l as AutonomyLevel]}:`)
    .replace(re(`${WB}(cannot|may) (${ACTION_RE})${WB}`), (_m, v: string, a: string) => `${v} ${action(a).base}`)
    .replace(re(`${WB}(${ACTION_RE}) follows a decision${WB}`), (_m, a: string) => `${cap(action(a).ing)} follows a decision`)
    .replace(re(`${WB}is set to (${LEVEL_RE})${WB}`), (_m, l: string) => `is set to ${LEVEL_WORDS[l as AutonomyLevel]}`)
    .replace(PATH_RE, m => pathWords(m, names))
    .replace(re(`${WB}(${ACTION_RE})${WB}`), (_m, a: string) => action(a).base)
    .replace(re(`${WB}(${SNAKE_LEVEL_RE})${WB}`), (_m, l: string) => LEVEL_WORDS[l as AutonomyLevel])
    .replace(re(`${WB}(${TRIGGER_RE})${WB}`), (_m, t: string) => TRIGGER_WORDS[t as TriggerId]);
  const tiers = Object.keys(names.tiers);
  if (tiers.length) {
    // "the board tier" is the body's name; a bare id is replaced only when it cannot be an ordinary word.
    out = out.replace(re(`${WB}(${alt(tiers.map(esc))}) tier${WB}`), (_m, t: string) => names.tiers[t]);
    const snake = tiers.filter(t => t.includes('_'));
    if (snake.length) out = out.replace(re(`${WB}(${alt(snake.map(esc))})${WB}`), (_m, t: string) => names.tiers[t]);
  }
  const bodies = Object.keys(names.bodies);
  if (bodies.length) out = out.replace(re(`(?<![\\w.])(${alt(bodies.map(esc))})(?![\\w])`), (_m, b: string) => names.bodies[b]);
  const roles = Object.keys(names.roles).filter(r => r.includes('_'));
  if (roles.length) out = out.replace(re(`${WB}(${alt(roles.map(esc))})${WB}`), (_m, r: string) => names.roles[r]);
  return out;
}
