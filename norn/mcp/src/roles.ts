// Roles whose credential is narrower than "a job on these ECRs".
//
// Most job roles (`level1-writeup`, the research worker, ...) see every tool and every ECR for reads;
// their `ecrs` only limit where they may write. A role listed here is different: its token can read
// only the ECRs it names, and the server registers only the tools listed for it. Any role not listed
// is untouched, so adding a role here can never change what Level 1 or the research worker may do.

/** Ask Norn: a finance reader's question about one ECR, answered from Norn's stored assessment. */
export const ASK_NORN_ROLE = 'ask-norn';

/** The only tools an `ask-norn` credential gets. No list_ecrs, no write tool, no comment, no proposed assumption. */
export const ASK_NORN_TOOLS = ['get_ecr', 'get_impact', 'list_assumptions', 'get_ecr_history', 'get_part'] as const;

const RESTRICTED: Record<string, readonly string[]> = {
  [ASK_NORN_ROLE]: ASK_NORN_TOOLS,
};

/** The tools a role may use, or null when the role has no restriction (every tool, as before). */
export function toolsForRole(role: string): ReadonlySet<string> | null {
  return Object.hasOwn(RESTRICTED, role) ? new Set(RESTRICTED[role]) : null;
}

/** Does this role read only the ECRs its token names? */
export function readsOnlyOwnEcrs(role: string): boolean {
  return Object.hasOwn(RESTRICTED, role);
}
