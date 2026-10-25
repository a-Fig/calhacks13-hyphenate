// Text normalisation for quote verification and the leak check. Pure.

/** Zero-width, soft-hyphen, bidi and other invisible format characters (Unicode category Cf), and control characters. */
const INVISIBLE = /[\p{Cf}\p{Cc}]/gu;

/** Removes invisible characters without leaving a gap, so "Bow​man" is "Bowman"; tabs and newlines become spaces. NFKC. */
export function stripInvisible(s: string): string {
  return s.replace(/[\t\n\r\f\v]/g, ' ').replace(INVISIBLE, '').normalize('NFKC');
}

/**
 * Normal form for comparing a quote with a page: invisible and format characters removed, Unicode
 * NFKC, lowercase, markdown decoration removed (the live scrape returns markdown and the agent
 * quotes what it read), typographic quotes and dashes made plain, whitespace collapsed. Two texts
 * that differ only in those ways compare equal. Digits are never touched.
 */
export function normalizeForQuote(s: string): string {
  return stripInvisible(s)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[*_`~]/g, '')
    .replace(/[#>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const isDigit = (c: string | undefined) => c !== undefined && /\p{Nd}/u.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isCurrency = (c: string | undefined) => c !== undefined && /\p{Sc}/u.test(c);

/** Words and signs that change what a number means when they follow it: 75 percent, 1.5 million, 75 k. */
const SCALE_AFTER = /^(?:%|‰|¢|percent\b|per cent\b|cents?\b|thousand\b|million\b|billion\b|trillion\b|hundred\b|dozen\b|k\b|m\b|mm\b|b\b|bn\b)/;

/**
 * True when the quote, found at `[start, end)` of the normalised page, starts or ends in the middle
 * of a number on the page.
 *
 * A quote that begins with a digit may not be preceded by a digit, a letter, a decimal point or
 * thousands separator, a sign, a slash, a colon or a currency sign: dropping "$0." from "$0.75"
 * changes the price a hundredfold. A quote that ends in a digit may not be followed by a digit, a
 * letter ("75k"), a decimal point or separator and a digit, a percent sign, or a scale word
 * ("1.5 million"). Normalisation has already turned no-break and thin spaces into plain spaces, so
 * the space-separated groups of "1 200" are covered too.
 */
function cutsANumber(page: string, start: number, end: number): boolean {
  const first = page[start];
  const last = page[end - 1];
  const before = page[start - 1];
  const before2 = page[start - 2];
  if (isDigit(first) || ((first === '.' || first === ',') && isDigit(page[start + 1]))) {
    if (isAlnum(before) || (before !== undefined && /[.,:/+\-±]/.test(before)) || isCurrency(before)) return true;
    if (before === "'" && isDigit(before2)) return true; // 1'200
    if (before === ' ' && isCurrency(before2)) return true; // "$ 75"
    // The "200" of "1 200": three digits that follow a group of one to three digits and a space.
    if (before === ' ' && isDigit(before2) && /(?:^|\D)\d{1,3}$/.test(page.slice(0, start - 1)) && /^\d{3}(?!\d)/.test(page.slice(start))) return true;
  }
  if (isDigit(last)) {
    const after = page[end];
    const after2 = page[end + 1];
    if (isDigit(after) || isAlnum(after)) return true;
    if ((after === '.' || after === ',' || after === "'") && isDigit(after2)) return true;
    if (after === '%' || after === '‰' || after === '¢') return true;
    if (after === ' ' && SCALE_AFTER.test(page.slice(end + 1))) return true;
    // The "1" of "1 200".
    if (after === ' ' && /^\d{3}(?!\d)/.test(page.slice(end + 1)) && /(?:^|\D)\d{1,3}$/.test(page.slice(0, end))) return true;
  }
  return false;
}

/**
 * True when `quote` appears in `page` after normalising both, and some occurrence does not cut into
 * a number: the quote's first and last numbers must be whole tokens of the page (`cutsANumber`).
 */
export function quoteInPage(quote: string, page: string): boolean {
  const q = normalizeForQuote(quote);
  if (q === '') return false;
  const p = normalizeForQuote(page);
  for (let at = p.indexOf(q); at >= 0; at = p.indexOf(q, at + 1)) {
    if (!cutsANumber(p, at, at + q.length)) return true;
  }
  return false;
}

/**
 * Lowercase words only, padded with spaces, so a whole-word search is `includes(' word ')`.
 * Invisible and format characters are removed, accents stripped and NFKC applied first.
 */
export function wordForm(s: string): string {
  return ` ${stripInvisible(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

/** Letters and digits only, run together: "Jeff Hargrove", "JeffHargrove" and "jeff-hargrove" are all "jeffhargrove". */
export function compactForm(s: string): string {
  return wordForm(s).replace(/ /g, '');
}
