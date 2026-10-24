// Where the screens get their data. This is the one seam between the screens and the checks.
//
// Today: mock fixtures (./mock), labelled mock on screen. To go live once #41 (cost check) and #42
// (impact statement) land, write `liveSource` below: read the check results and agent events from
// SpacetimeDB, turn each ECR's results into an ImpactAssessment with fromChecks() in ./adapter.ts, and
// export it as `source`. Nothing under src/screens or src/ui changes.
import type { EcrSummary, ImpactAssessment } from './types.ts';
import { mockAssessments, mockEcrs } from './mock/index.ts';

export interface AssessmentSource {
  /** True while the numbers are fixtures. Screens show the mock label whenever this is true. */
  readonly isMock: boolean;
  listEcrs(): EcrSummary[];
  getAssessment(id: string): ImpactAssessment | undefined;
  getSummary(id: string): EcrSummary | undefined;
}

const mockSource: AssessmentSource = {
  isMock: true,
  listEcrs: () => mockEcrs,
  getAssessment: id => mockAssessments[id],
  getSummary: id => mockEcrs.find(e => e.id === id),
};

export const source: AssessmentSource = mockSource;
