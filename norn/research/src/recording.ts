// A recording: an agent's output and the pages its quotes come from, stored so the research pass
// can be replayed offline. Everything replayed from one is labelled RECORDED.

import { readFile } from 'node:fs/promises';
import type { RecordedPage } from './pages.ts';
import type { AgentOutput } from './types.ts';
import type { TargetContext } from './targets.ts';

export interface Recording {
  kind: 'norn-research-recording';
  version: 1;
  /** One line that says what this recording is and is not. Printed first. */
  label: string;
  ecr: string;
  seed: string;
  /** The day the pages were read; the replay's "today". */
  recordedOn: string;
  /** Lines of provenance, printed under RECORDED. */
  provenance: string[];
  /** How many research targets the recording was made with. */
  n: number;
  /** The generic facts about the scrapped part the questions were asked with. */
  context?: TargetContext;
  agentOutput: AgentOutput;
  /** Index (0-based) in agentOutput.proposals to a description of what was planted there to test the guardrails. */
  planted: Record<string, string>;
  pages: RecordedPage[];
}

export async function loadRecording(path: string): Promise<Recording> {
  const r = JSON.parse(await readFile(path, 'utf8')) as Recording;
  if (r.kind !== 'norn-research-recording' || r.version !== 1) throw new Error(`${path} is not a version 1 research recording`);
  return r;
}
