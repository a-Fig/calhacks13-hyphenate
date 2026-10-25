// How the seat's conversation sits on an ECR. Every comment the seat writes, and every reply a person
// writes to it, carries an anchor that says what it is and which input it is about, so a restart can
// rebuild the seat's state from the ECR's comments alone and a reply is matched to its question by
// the anchor, not by guessing at the text. Pure: the worker and the web page both import this.
//
//   seat:ask:<personId>:<inputId>            the question, to that person
//   seat:remind:<personId>:<inputId>         the reminder, to the person asked
//   seat:escalate:<level>:<personId>:<inputId>   the escalation, to that person (level counts from 0)
//   seat:follow:<personId>:<inputId>         the follow-up when a reply held no usable figure
//   seat:reply:<personId>:<inputId>          a person's answer, typed under the question
//   seat:record:<inputId>                    the note that the answer is recorded, with the new figure
//
// A person id has no colon (EMP-12); an input id may (cost:ECR-0417:other:...), so it comes last.

export type SeatKind = 'ask' | 'remind' | 'escalate' | 'follow' | 'reply' | 'record';

export interface SeatAnchor {
  kind: SeatKind;
  inputId: string;
  /** Who the comment is to (ask, remind, escalate, follow) or from (reply). Absent on a record note. */
  personId?: string;
  /** Escalations only. */
  level?: number;
}

export const SEAT_PREFIX = 'seat:';

export function anchorFor(a: SeatAnchor): string {
  if (a.kind === 'record') return `seat:record:${a.inputId}`;
  if (a.kind === 'escalate') return `seat:escalate:${a.level ?? 0}:${a.personId}:${a.inputId}`;
  return `seat:${a.kind}:${a.personId}:${a.inputId}`;
}

const SIMPLE = /^seat:(ask|remind|follow|reply):([^:]+):(.+)$/;
const ESCALATE = /^seat:escalate:(\d+):([^:]+):(.+)$/;
const RECORD = /^seat:record:(.+)$/;

export function parseAnchor(anchor: string): SeatAnchor | undefined {
  let m = SIMPLE.exec(anchor);
  if (m) return { kind: m[1] as SeatKind, personId: m[2], inputId: m[3] };
  m = ESCALATE.exec(anchor);
  if (m) return { kind: 'escalate', level: Number(m[1]), personId: m[2], inputId: m[3] };
  m = RECORD.exec(anchor);
  if (m) return { kind: 'record', inputId: m[1] };
  return undefined;
}

/** The seat's own words in the conversation: who they are posted as. */
export const SEAT_DISPLAY_PREFIX = 'Norn · ';
