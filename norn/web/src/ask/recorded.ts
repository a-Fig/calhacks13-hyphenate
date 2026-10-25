// The example Ask Norn shows when it is not connected to Norn's database (the saved-runs page).
// It is labelled RECORDED on screen. It is not a live answer: the question and answer are written by
// hand, and the "tool results" are ECR-0417's saved check rows in the shape `get_impact` returns
// them. The answer goes through the same guardrail as a live one, so what shows as checked is checked.
import { guardAnswer, type ToolResultText } from '../../../workers/src/ask/guard.ts';
import type { AgentAnswer, AskAnswer } from '../../../workers/src/ask/protocol.ts';
import rows from '../assessment/fixtures/ecr-0417.l1.json' with { type: 'json' };

type Row = { key: string; label: string; unit: string; p10: number; p50: number; p90: number; detailJson: string };

export const RECORDED_ECR = 'ECR-0417';
export const RECORDED_QUESTION = 'Where does the cancellation charge come from?';

/** What `get_impact` returns for the inventory line and for the inputs behind it. */
export function recordedToolResults(saved: Row[] = rows as Row[]): ToolResultText[] {
  const pick = (key: string) => {
    const r = saved.find(x => x.key === key);
    if (!r) throw new Error(`the saved run has no ${key} row`);
    return { key: r.key, label: r.label, unit: r.unit, p10: r.p10, p50: r.p50, p90: r.p90, evidence: 'computation', mock: false, trace: JSON.parse(r.detailJson) };
  };
  return [{ tool: 'mcp__norn__get_impact', content: JSON.stringify({ ecr: RECORDED_ECR, results: [pick('line:inventory:BW-5120-210'), pick('detail')] }) }];
}

export const RECORDED_AGENT_ANSWER: AgentAnswer = {
  answer:
    'The cancellation charge is 10% [c1] of the part price. The supplier quoted 18.64 [c1] per unit for the 60 [c1] on order (supplier quote Q-HAL-26-1187 line 6 [c1]). It is part of the $60,439 [c2] inventory disposition line for BW-5120-210, which covers scrapping 324 [c2] and cancelling 60 [c2].',
  citations: [
    { id: 'c1', refId: 'cancel:BW-5120-210', value: '10%' },
    { id: 'c2', refId: 'line:inventory:BW-5120-210', value: '$60,439' },
  ],
};

export function recordedAnswer(agent: AgentAnswer = RECORDED_AGENT_ANSWER, saved?: Row[]): AskAnswer {
  const g = guardAnswer(agent, recordedToolResults(saved));
  return { ok: true, answer: g.text, segments: g.segments, citations: g.citations, unverifiedNumbers: g.unverifiedNumbers, mock: g.mock, recorded: true, model: 'recorded', durationMs: 0 };
}
