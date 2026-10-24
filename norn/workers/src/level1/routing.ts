// The seam for change class and approval route (#75). Another session owns the real functions, pure
// functions over Bowman's configuration (norn/config) and the numbers. Until they land this returns
// nothing, so a Level 1 statement carries only what its own agent proposed: a class marked judgment,
// and the route "Pending Norn's routing". Nothing in this folder computes a class or a tier.
//
// Both the dispatcher (to tell the agent what it must not guess) and the publisher (to fill the PLM's
// class and route fields) call it. When #75's functions exist, call them here and nowhere else.

export interface EcrRef {
  /** The ECR number as Norn holds it, e.g. ECR-0417. */
  number: string;
  title: string;
  /** The change-request revision the numbers are for. */
  revision: number;
}

export interface AssessmentRef {
  /** The headline check results by key (`unit_cost_delta:vesper`, `one_time_total`, `net_total_year_one`). */
  numbers: Record<string, { p10: number; p50: number; p90: number; unit: string }>;
}

export interface Routing {
  /** The change class, as the PLM spells it (`Class I` or `Class II`). */
  class?: string;
  /** The approval route, as text. */
  route?: string;
}

/** What Norn's routing says about this ECR, or nothing yet. */
export function routeFor(_ecr: EcrRef, _assessment: AssessmentRef): Routing {
  return {};
}

/** What the agent writes as the route when routing has not decided one. */
export const ROUTE_PENDING = "Pending Norn's routing";
