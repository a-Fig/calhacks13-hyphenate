// A seat is a job a company gives Norn: the duties it owns, who it asks for what, its deadlines and
// who it escalates to. A company's seat file says all of it; this package holds no company names.

/** One duty the seat owns: what starts it and what it delivers. */
export interface Duty {
  id: string;
  title: string;
  /** What starts the duty, in words a person reads on the seat page. */
  trigger: string;
  /** What the seat delivers when the duty is done. */
  output: string;
}

/** Who the seat asks about an input it cannot settle from data. First matching rule wins. */
export interface AskRule {
  /** Matched against the input's label and id, case-insensitive. */
  match: string;
  /** The company seat that owns this kind of number. `originator` means the person who filed the ECR. */
  seat: string;
  /** What to ask for, in the unit the check needs. */
  unit: 'usd' | 'share' | 'hours';
  /** Why that seat owns it, shown to a reviewer. */
  why: string;
}

export interface SeatDefinition {
  id: string;
  title: string;
  /** The person whose seat this is today, if any: the job Norn takes over. */
  replaces?: string;
  duties: Duty[];
  asks: AskRule[];
  /** Hours to wait for an answer before a reminder, then before each escalation. */
  deadlines: { remindAfterHours: number; escalateAfterHours: number[] };
  /** Seats to escalate to, in order, when nobody answers. */
  escalation: string[];
  /** An input is worth asking about when it is a blank cost line, or a default that swings the window total by at least this much. */
  materialityUsd: number;
}

/** A person in the company, with the seat they hold. */
export interface Person {
  id: string;
  name: string;
  title: string;
  seat: string;
  programs?: string[];
}

/** An input the seat should get from a person rather than guess. */
export interface Gap {
  /** The input or cost-row id an answer replaces (the checks' assumption id). */
  inputId: string;
  label: string;
  kind: 'blank_row' | 'default';
  /** How much the window total moves across the input's range, USD; null for a blank row nobody has sized. */
  swing: number | null;
  block?: string;
  unit: AskRule['unit'];
}

export interface Question {
  gap: Gap;
  to: Person;
  rule: AskRule;
  body: string;
  askedAt: string;
}

export interface Reply {
  inputId: string;
  from: Person;
  text: string;
  at: string;
}

export type Action =
  | { kind: 'ask'; question: Question }
  | { kind: 'remind'; question: Question; body: string }
  | { kind: 'escalate'; question: Question; to: Person; body: string; level: number }
  | { kind: 'record'; reply: Reply; override: import('../../checks/src/types.ts').AssumptionOverride }
  | { kind: 'follow_up'; reply: Reply; body: string }
  | { kind: 'rerun'; ecr: string; reason: string };
