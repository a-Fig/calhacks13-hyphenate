// What the browser and the Ask Norn server say to each other. Pure types, so the web app can import
// them without pulling in anything from Node.

export interface AskRequest {
  /** The ECR number as the page shows it, e.g. "ECR-0417". */
  ecr: string;
  question: string;
}

/** A number or fact the answer rests on: where it came from in Norn's stored data. */
export interface AskCitation {
  /** Plain words for the chip: "One-time cost", "Cancellation charge". */
  label: string;
  /** The check result key or input id the number was read from, e.g. "line:inventory:BW-5120-210". */
  refId: string;
  /** The value as the tool result gave it, e.g. "$60,439". */
  value: string;
  /** Set by the guardrail: the id was found in a tool result and the value matches it. */
  verified?: boolean;
}

/** A stretch of the answer. `unverified` marks a number that no cited tool result contains. */
export interface AskSegment {
  text: string;
  unverified?: boolean;
}

export interface AskAnswer {
  ok: true;
  answer: string;
  segments: AskSegment[];
  citations: AskCitation[];
  /** Numbers in the answer that the cited tool results do not contain. Empty is the good case. */
  unverifiedNumbers: string[];
  /** A tool result said mock: placeholder numbers. The panel says so. */
  mock: boolean;
  /** Set only for the recorded example the panel can show offline. */
  recorded?: boolean;
  model: string;
  durationMs: number;
}

export interface AskRefusal {
  ok: false;
  /** unavailable: no Claude login, no Norn MCP server or database. busy: too many questions at once. failed: the session did not produce a usable answer. */
  kind: 'unavailable' | 'busy' | 'failed' | 'bad_request';
  message: string;
}

export type AskResponse = AskAnswer | AskRefusal;

export interface AskStatus {
  available: boolean;
  /** When not available, why, in a sentence a finance reader can follow. */
  reason?: string;
}

/** The JSON object the agent is told to return. */
export interface AgentAnswer {
  answer: string;
  citations: { label: string; refId: string; value: string }[];
}

export const MAX_QUESTION_CHARS = 500;
export const ASK_PORT = 3918;
