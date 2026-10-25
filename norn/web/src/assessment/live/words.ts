// The company gate's reasons are written in the configuration's own ids ("The company sets
// approve_fast_track_ecr to approve_sampled for agents: ..."). A person reads them as business words.
// The ids are the configuration's (config/src/schema.ts: ACTIONS, AUTONOMY_LEVELS, TRIGGERS); each map is typed
// on them, so a new id fails the typecheck here until it has words.
import { ACTION_IDS, LEVEL_IDS, TRIGGER_IDS, type ActionId, type AutonomyLevel, type TriggerId } from '../../../../config/src/schema.ts';

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

const WB = String.raw`\b`;
const alt = (ids: readonly string[]) => [...ids].sort((a, b) => b.length - a.length).join('|');
const ACTION_RE = alt(ACTION_IDS);
const LEVEL_RE = alt(LEVEL_IDS);
const SNAKE_LEVEL_RE = alt(LEVEL_IDS.filter(l => l.includes('_')));
const TRIGGER_RE = alt(TRIGGER_IDS);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const action = (id: string) => ACTION_WORDS[id as ActionId];
const re = (source: string) => new RegExp(source, 'g');

/** A gate reason with the configuration's action, level and trigger ids in business words. Text with none is unchanged. */
export function plainReason(text: string): string {
  return text
    .replace(re(`The company sets (${ACTION_RE}) to (${LEVEL_RE}) for agents:`), (_m, a: string, l: string) => `For agents, the company's rule for ${action(a).ing} is to ${LEVEL_WORDS[l as AutonomyLevel]}:`)
    .replace(re(`${WB}(cannot|may) (${ACTION_RE})${WB}`), (_m, v: string, a: string) => `${v} ${action(a).base}`)
    .replace(re(`${WB}(${ACTION_RE}) follows a decision${WB}`), (_m, a: string) => `${cap(action(a).ing)} follows a decision`)
    .replace(re(`${WB}is set to (${LEVEL_RE})${WB}`), (_m, l: string) => `is set to ${LEVEL_WORDS[l as AutonomyLevel]}`)
    .replace(re(`${WB}(${ACTION_RE})${WB}`), (_m, a: string) => action(a).base)
    .replace(re(`${WB}(${SNAKE_LEVEL_RE})${WB}`), (_m, l: string) => LEVEL_WORDS[l as AutonomyLevel])
    .replace(re(`${WB}(${TRIGGER_RE})${WB}`), (_m, t: string) => TRIGGER_WORDS[t as TriggerId]);
}
