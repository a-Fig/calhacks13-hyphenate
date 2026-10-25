/** The id the "why" panel knows a cited result or input by, or null when the page has no trace for it. */
export function resolveTraceId(refId: string, traces: Record<string, unknown>): string | null {
  const bare = refId.replace(/^s\d_[a-z_]+\./i, '');
  for (const id of [refId, bare, `in:${refId}`, `in:${bare}`]) if (id in traces) return id;
  return null;
}
