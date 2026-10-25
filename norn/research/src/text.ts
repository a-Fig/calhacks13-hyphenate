// Text normalisation for quote verification and the leak check. Pure.

/**
 * Normal form for comparing a quote with a page: Unicode NFKC, lowercase, markdown decoration
 * removed (the live scrape returns markdown and the agent quotes what it read), typographic quotes
 * and dashes made plain, whitespace collapsed. Two texts that differ only in those ways compare equal.
 * Digits and words are never touched, so a changed number never verifies.
 */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[*_`~]/g, '')
    .replace(/[#>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when `quote` appears in `page` after normalising both. */
export function quoteInPage(quote: string, page: string): boolean {
  const q = normalizeForQuote(quote);
  if (q === '') return false;
  return normalizeForQuote(page).includes(q);
}

/** Lowercase words only, padded with spaces, so a whole-word search is `includes(' word ')`. */
export function wordForm(s: string): string {
  return ` ${s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}
