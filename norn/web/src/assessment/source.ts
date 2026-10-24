// Where the screens get their data. This is the one seam between the screens and Norn.
//
// Screens call the hooks below, never a source directly. A source is a small store: `subscribe` to
// changes, and synchronous reads of what it holds so far (`undefined` while it loads).
//   VITE_NORN_SOURCE=saved  (the default) saved runs of the real checks plus mock narrative (./mock):
//                           works with no database, for demos and screenshots.
//   VITE_NORN_SOURCE=live   Norn's SpacetimeDB (./live): the checks' stored results through
//                           fromChecks() in ./adapter.ts, and the module's own tables for the rest.
import { useSyncExternalStore } from 'react';
import type { EcrSummary, ImpactAssessment } from './types.ts';
import { createLiveSource } from './live/store.ts';
import { mockAssessments, mockEcrs } from './mock/index.ts';

export interface AssessmentSource {
  /** True while any part of what the source gives is a fixture. Individual sections say which (`ImpactAssessment.mock`). */
  readonly isMock: boolean;
  subscribe(onChange: () => void): () => void;
  status(): { state: 'connecting' | 'ready' | 'error'; message?: string };
  /** The backlog, or undefined while it loads. Must return the same array until it changes. */
  list(): EcrSummary[] | undefined;
  /** One ECR's assessment, or undefined while it loads or when it has none. Stable until it changes. */
  get(id: string): ImpactAssessment | undefined;
  summary(id: string): EcrSummary | undefined;
}

const ready = { state: 'ready' as const };
const mockSource: AssessmentSource = {
  isMock: true,
  subscribe: () => () => {},
  status: () => ready,
  list: () => mockEcrs,
  get: id => mockAssessments[id],
  summary: id => mockEcrs.find(e => e.id === id),
};

const kind: string = import.meta.env.VITE_NORN_SOURCE ?? 'saved';
export const source: AssessmentSource = kind === 'live' ? createLiveSource() : mockSource;

export function useEcrList() {
  const data = useSyncExternalStore(source.subscribe, () => source.list());
  const status = useSyncExternalStore(source.subscribe, () => source.status());
  return { data, loading: data === undefined && status.state !== 'error', error: status.state === 'error' ? status.message : undefined };
}

export function useAssessment(id: string) {
  const assessment = useSyncExternalStore(source.subscribe, () => source.get(id));
  const summary = useSyncExternalStore(source.subscribe, () => source.summary(id));
  const status = useSyncExternalStore(source.subscribe, () => source.status());
  return {
    assessment,
    summary,
    loading: summary === undefined && status.state !== 'error' && source.list() === undefined,
    error: status.state === 'error' ? status.message : undefined,
  };
}
