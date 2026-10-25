// The seat's state for one ECR, derived from what is stored: the ECR's comments (questions, replies,
// reminders, escalations) and the assumptions already recorded. Nothing is kept in the worker, so a
// restart resumes where the conversation is, and a question that is on the ECR is never asked twice.
// Also: the gaps of a stored cost run, read from its detail row. Pure.
import type { SeatState } from './plan.ts';
import { ruleFor } from './gaps.ts';
import { routeGap } from './route.ts';
import { parseAnchor } from './thread.ts';
import type { AskRule, Gap, Person, Question, Reply, SeatDefinition } from './types.ts';

/** A comment row as the worker reads it: the author is the identity's hex string, `at` an ISO time. */
export interface StoredComment {
  id: number;
  author: string;
  anchor: string;
  body: string;
  at: string;
  /** The name the author's identity registered under, for the audit line on a reply. */
  authorName?: string;
}

/** The stored detail row of a cost run (the check's `detail` result), as far as the seat reads it. */
interface DetailInput { id: string; label: string; source: string; needsEstimate?: boolean }
interface DetailDriver { id: string; kind: string; swing: number }

/**
 * The gaps in a stored cost run: a blank line (an input the check flagged needsEstimate) or a default
 * whose swing is material. Same rules as findGaps, from the detail row instead of a fresh run, so the
 * worker needs no copy of the company's data to know what is missing.
 */
export function gapsFromDetail(seat: SeatDefinition, detailJson: string): Gap[] {
  const d = JSON.parse(detailJson) as { inputs?: DetailInput[]; drivers?: DetailDriver[] };
  if (!Array.isArray(d.inputs)) throw new Error("the cost run's detail row has no inputs");
  const gaps: Gap[] = [];
  const seen = new Set<string>();
  const unit = (label: string, id: string): AskRule['unit'] => ruleFor(seat, label, id)?.unit ?? 'usd';
  for (const i of d.inputs) {
    if (!i.needsEstimate || seen.has(i.id)) continue;
    seen.add(i.id);
    gaps.push({ inputId: i.id, label: i.label, kind: 'blank_row', swing: null, unit: unit(i.label, i.id) });
  }
  const inputs = new Map(d.inputs.map((i) => [i.id, i]));
  for (const dr of d.drivers ?? []) {
    const rec = inputs.get(dr.id);
    if (dr.kind !== 'input' || seen.has(dr.id) || !rec || rec.source !== 'default' || dr.swing < seat.materialityUsd) continue;
    seen.add(dr.id);
    gaps.push({ inputId: dr.id, label: rec.label, kind: 'default', swing: dr.swing, unit: unit(rec.label, dr.id) });
  }
  return gaps.sort((a, b) => (a.kind === b.kind ? (b.swing ?? 0) - (a.swing ?? 0) : a.kind === 'blank_row' ? -1 : 1));
}

export interface DeriveInput {
  ecr: string;
  program: string;
  originator: Person;
  gaps: Gap[];
  comments: StoredComment[];
  /** Input ids that have a current assumption from a person's answer (source 'given') on this ECR. */
  givenKeys: Iterable<string>;
}

/** A reply carries who typed it, which the audit line quotes. */
export interface StoredReply extends Reply { typedBy?: string }

export function deriveState(seat: SeatDefinition, people: Person[], inp: DeriveInput): SeatState & { replies: StoredReply[]; notes: string[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const gapBy = new Map(inp.gaps.map((g) => [g.inputId, g]));
  const comments = [...inp.comments].sort((a, b) => a.id - b.id);
  const questions: Question[] = [];
  const replies: StoredReply[] = [];
  const recorded = new Set<string>(inp.givenKeys);
  const notes: string[] = [];
  const reminded = new Set<string>();
  const escalated: Record<string, number> = {};
  const followAt = new Map<string, number>();
  const replyAt = new Map<string, number>();
  const seenAsk = new Set<string>();
  for (const c of comments) {
    const a = parseAnchor(c.anchor);
    if (!a) continue;
    const person = a.personId ? byId.get(a.personId) : undefined;
    const t = Date.parse(c.at);
    if (a.kind === 'record') { recorded.add(a.inputId); notes.push(a.inputId); continue; }
    if (a.kind === 'ask' && person && !seenAsk.has(a.inputId)) {
      // The question's gap may have been answered and gone from the cost page; the question stays on the ECR either way.
      const gap = gapBy.get(a.inputId);
      seenAsk.add(a.inputId);
      if (!gap) continue;
      const routed = routeGap(seat, gap, people, { originator: inp.originator, program: inp.program });
      const rule = routed?.rule ?? ruleFor(seat, gap.label, gap.inputId);
      if (!rule) continue;
      questions.push({ gap, to: person, rule, body: c.body, askedAt: c.at });
    } else if (a.kind === 'reply' && person) {
      replies.push({ inputId: a.inputId, from: person, text: c.body, at: c.at, typedBy: c.authorName });
      replyAt.set(a.inputId, t);
    } else if (a.kind === 'remind') reminded.add(a.inputId);
    else if (a.kind === 'escalate') escalated[a.inputId] = Math.max(escalated[a.inputId] ?? -1, a.level ?? 0);
    else if (a.kind === 'follow') followAt.set(a.inputId, t);
  }
  // A follow-up answers the latest reply only if it came after it; a newer reply is read afresh.
  const followedUp = [...followAt].filter(([id, t]) => t >= (replyAt.get(id) ?? 0)).map(([id]) => id);
  return { ecr: inp.ecr, program: inp.program, originator: inp.originator, gaps: inp.gaps, questions, replies, recorded: [...recorded], reminded: [...reminded], escalated, followedUp, notes };
}

/** Whether a question has been asked on the ECR for an input, whatever happened to its gap since. */
export function askedInputs(comments: StoredComment[]): Set<string> {
  const out = new Set<string>();
  for (const c of comments) {
    const a = parseAnchor(c.anchor);
    if (a?.kind === 'ask') out.add(a.inputId);
  }
  return out;
}
