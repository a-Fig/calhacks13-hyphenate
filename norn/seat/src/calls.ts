// A seat action as the arguments of the module's reducers. Pure; the argument types come from the
// generated bindings, so a change to add_comment or record_assumption breaks the typecheck here
// instead of a demo.
import type { DbConnection } from '@norn/bindings';
import type { Dist } from '../../checks/src/dist.ts';
import { anchorFor } from './thread.ts';
import type { StoredReply } from './state.ts';
import type { Action } from './types.ts';

type Reducers = DbConnection['reducers'];
export type AddCommentArgs = Omit<Parameters<Reducers['addComment']>[0], 'meta'>;
export type RecordAssumptionArgs = Omit<Parameters<Reducers['recordAssumption']>[0], 'meta'>;

export type Call =
  | { reducer: 'add_comment'; args: AddCommentArgs; label: string }
  | { reducer: 'record_assumption'; args: RecordAssumptionArgs; label: string };

/** The stored form of a distribution: the shapes the worker reads back (workers/src/impact.ts toOverride). */
export function distToJson(d: Dist): string {
  switch (d.kind) {
    case 'lognormal': return JSON.stringify({ kind: 'lognormal', median: d.median, sigmaLow: d.sigmaLow, sigmaHigh: d.sigmaHigh });
    case 'pert':
    case 'triangular': return JSON.stringify({ kind: d.kind, min: d.min, mode: d.mode, max: d.max });
    case 'point': return JSON.stringify({ kind: 'fixed', value: d.value });
  }
}

/** The stages that read the input: a lead time is the timeline's, every other cost input the cost check's. */
export const affectsFor = (inputId: string): string[] => (/:lead$/.test(inputId) ? ['s3_timeline'] : ['s2_cost']);

export interface CallContext {
  prId: bigint;
  /** The current revision of the input's assumption on this ECR; 0 when there is none. */
  expectedRev: (inputId: string) => number;
  /** Set when the clock is shifted for a demo: said in the comment, so nobody reads it as 24 real hours. */
  demoClock?: string;
}

const tagged = (body: string, demoClock?: string) => (demoClock ? `${body} (demo clock ${demoClock})` : body);

/** The call for an action. `rerun` has none: the module re-checks the ECR itself when an assumption changes. */
export function toCall(a: Action, c: CallContext): Call | undefined {
  switch (a.kind) {
    case 'ask':
      return { reducer: 'add_comment', label: `ask ${a.question.to.name} about ${a.question.gap.inputId}`, args: { prId: c.prId, anchor: anchorFor({ kind: 'ask', personId: a.question.to.id, inputId: a.question.gap.inputId }), body: a.question.body } };
    case 'remind':
      return { reducer: 'add_comment', label: `remind ${a.question.to.name}`, args: { prId: c.prId, anchor: anchorFor({ kind: 'remind', personId: a.question.to.id, inputId: a.question.gap.inputId }), body: tagged(a.body, c.demoClock) } };
    case 'escalate':
      return { reducer: 'add_comment', label: `escalate to ${a.to.name} (level ${a.level})`, args: { prId: c.prId, anchor: anchorFor({ kind: 'escalate', level: a.level, personId: a.to.id, inputId: a.question.gap.inputId }), body: tagged(a.body, c.demoClock) } };
    case 'follow_up':
      return { reducer: 'add_comment', label: `follow up with ${a.reply.from.name}`, args: { prId: c.prId, anchor: anchorFor({ kind: 'follow', personId: a.reply.from.id, inputId: a.reply.inputId }), body: a.body } };
    case 'record': {
      const typedBy = (a.reply as StoredReply).typedBy;
      const via = typedBy ? ` Typed by ${typedBy} through the demo sign-in as ${a.reply.from.name}.` : '';
      const o = a.override;
      return {
        reducer: 'record_assumption',
        label: `record ${o.id}`,
        args: { prId: c.prId, key: o.id, distJson: distToJson(o.dist!), source: 'given', rationale: `${o.rationale}${via}`, affects: affectsFor(o.id), expectedRev: c.expectedRev(o.id) },
      };
    }
    case 'rerun':
      return undefined;
  }
}

/** The note on the ECR once the checks have re-run on a recorded answer. */
export function recordNote(a: { personName: string; label: string; before: string | null; after: string | null }): string {
  const move = a.after ? (a.before && a.before !== a.after ? ` One-time cost: ${a.before} to ${a.after}.` : ` One-time cost: ${a.after}.`) : '';
  return `Recorded ${a.personName}'s answer for "${a.label}".${move}`;
}
