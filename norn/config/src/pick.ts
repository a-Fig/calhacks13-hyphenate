// A helper for configuration files that take values from another source, such as a company's
// dataset, instead of restating them. Matching by what an entry says, not by where it sits in a
// list, means a reordered source still gives the right entry, and a source that dropped or doubled
// the entry stops the file from loading instead of quietly mapping the wrong text.

/**
 * Returns the one entry whose text contains `needle` (every string in it, if it is a list).
 * Matching is case-sensitive. Throws, naming `what`, when no entry matches or more than one does.
 * `textOf` says which text of an entry to search; it defaults to the entry itself, for strings.
 */
export function findOne<T>(entries: readonly T[], needle: string | readonly string[], what: string, textOf: (entry: T) => string = String): T {
  const needles = typeof needle === 'string' ? [needle] : needle;
  if (needles.length === 0 || needles.some((n) => n === '')) throw new Error(`${what}: expected a non-empty text to look for`);
  const wanted = needles.map((n) => JSON.stringify(n)).join(' and ');
  const found = entries.filter((entry) => needles.every((n) => textOf(entry).includes(n)));
  if (found.length === 1) return found[0]!;
  const seen = entries.map((entry) => JSON.stringify(textOf(entry))).join(', ');
  const problem = found.length === 0 ? 'found none' : `found ${found.length}`;
  throw new Error(`${what}: expected exactly one entry containing ${wanted}, ${problem} among ${entries.length}: ${seen}`);
}
