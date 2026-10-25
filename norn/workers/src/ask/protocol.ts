// What the browser and the Ask Norn server say to each other. Pure types, so the web app can import
// them without pulling in anything from Node.

export interface AskRequest {
  /** The ECR number as the page shows it, e.g. "ECR-0417". */
  ecr: string;
  question: string;
}

/** A number or fact the answer rests on: where it came from in Norn's stored data. */
export interface AskCitation {
  /** The name a marker in the answer uses for it: "c1", "c2". */
  id: string;
  /** What Norn's stored data calls the thing cited (its own label, else its key). Never the agent's wording. */
  label: string;
  /** The check result key or input id the number was read from, e.g. "line:inventory:BW-5120-210". */
  refId: string;
  /** The value, for the chip. Only text whose numbers were found in the stored data, else the stored value's own display. */
  value: string;
  /** Set by the guardrail: the id was found in a tool result and the value matches it. */
  verified?: boolean;
}

/** A stretch of the answer. `unverified` marks a number that no cited tool result contains. */
export interface AskSegment {
  text: string;
  unverified?: boolean;
  /** The citations (ids such as "c1") whose markers followed this number in the agent's answer. */
  cites?: string[];
}

export interface AskAnswer {
  ok: true;
  /** The answer as shown, with the citation markers removed. */
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
  /** unavailable: no Claude login, no Norn MCP server or database. busy: too many questions at once. limited: too many questions in a while. failed: the session did not produce a usable answer. */
  kind: 'unavailable' | 'busy' | 'limited' | 'failed' | 'bad_request';
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
  /** The answer with a marker such as [c1] right after each number. */
  answer: string;
  /** id is the name the markers use (c1, c2, ...); when the agent leaves it out it is the citation's place in the list. */
  citations: { id?: string; label?: string; refId: string; value: string }[];
}

export const MAX_QUESTION_CHARS = 500;
export const ASK_PORT = 3918;
