// Where the screens get their data. This is the one seam between the screens and the checks.
//
// Screens call the hooks below, never a source directly. A source is a small store: `subscribe`
// to changes, and a synchronous read of what it holds so far (`undefined` while it loads). The mock
// source holds fixtures built from saved runs of the real checks plus mock narrative (./mock). The
// live one will subscribe to SpacetimeDB, turn each ECR's check_result rows into an assessment with
// fromChecks() in ./adapter.ts, add the narrative parts, and notify; the hooks and every screen stay
// as they are.
import { useSyncExternalStore } from 'react';
import type { EcrSummary, ImpactAssessment } from './types.ts';
import { mockAssessments, mockEcrs } from './mock/index.ts';

export interface AssessmentSource {
  /** True while any part of what the source gives is a fixture. Individual sections say which (`ImpactAssessment.mock`). */
  readonly isMock: boolean;
  subscribe(onChange: () => void): () => void;
  /** The backlog, or undefined while it loads. Must return the same array until it changes. */
  list(): EcrSummary[] | undefined;
  /** One ECR's assessment, or undefined while it loads or when it has none. Stable until it changes. */
  get(id: string): ImpactAssessment | undefined;
  summary(id: string): EcrSummary | undefined;
}

const mockSource: AssessmentSource = {
  isMock: true,
  subscribe: () => () => {},
  list: () => mockEcrs,
  get: id => mockAssessments[id],
  summary: id => mockEcrs.find(e => e.id === id),
};

export const source: AssessmentSource = mockSource;

export function useEcrList() {
  const data = useSyncExternalStore(source.subscribe, () => source.list());
  return { data, loading: data === undefined };
}

export function useAssessment(id: string) {
  const assessment = useSyncExternalStore(source.subscribe, () => source.get(id));
  const summary = useSyncExternalStore(source.subscribe, () => source.summary(id));
  return { assessment, summary, loading: assessment === undefined && summary === undefined && source.list() === undefined };
}
