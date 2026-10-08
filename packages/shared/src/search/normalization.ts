/**
 * Pure text normalization and query tokenization pipeline for search.
 *
 * Implements:
 *   - disney-world-tracker Property 30 (Requirements 1.20, 1.25)
 *   - catalog-navigation-redesign Property 1 (Requirements 5.2, 5.8)
 */

/**
 * Regex matching standard and modifier quotes, apostrophes, and okina codepoints:
 * ASCII ' (U+0027), ‘ (U+2018), ’ (U+2019), ‛ (U+201B), ` (U+0060), ´ (U+00B4),
 * ʹ (U+02B9), ʺ (U+02BA), ʻ (U+02BB), ʼ (U+02BC), ′ (U+2032), " (U+0022),
 * “ (U+201C), ” (U+201D).
 */
export const QUOTES_AND_APOSTROPHES_REGEX =
  /[\u0027\u2018\u2019\u201B\u0060\u00B4\u02B9\u02BA\u02BB\u02BC\u2032\u0022\u201C\u201D]/gu;

/**
 * Normalizes text for search matching via a strict 6-step pipeline:
 * 1. Lowercase
 * 2. Unicode NFD decomposition & diacritic strip (Note: non-decomposable characters like ø, ß, æ are not decomposed by NFD)
 * 3. Strip all quotes, apostrophes, okina, and modifier-letter apostrophes
 * 4. Replace non-alphanumeric punctuation and symbols with space (preserving & and +)
 * 5. Normalize connectors (&, +, standalone n) to ' and ', preserving leading boundary whitespace in $1
 *    (Note: connectors run after quote/apostrophe stripping so rock 'n' roll has already become rock n roll with bare n)
 * 6. Collapse consecutive whitespace and trim
 *
 * Limitation note: Because punctuation replacement preserves & and + and connector normalization
 * requires whitespace boundaries, non-space-delimited connectors survive as literal characters
 * (e.g. normalizeSearchText("M&M's") === 'm&ms', a single token containing '&', so 'M and M' will
 * not match it).
 */
export function normalizeSearchText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  return (
    text
      // 1. Lowercase
      .toLowerCase()
      // 2. Unicode NFD & diacritic strip
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // 3. Strip all quotes, apostrophes, and modifier letter apostrophes
      .replace(QUOTES_AND_APOSTROPHES_REGEX, '')
      // 4. Replace non-alphanumerics (preserving & and + for connector normalization) with space
      .replace(/[^\p{L}\p{N}\s&+]/gu, ' ')
      // 5. Normalize connectors (&, +, standalone n) to ' and ', preserving leading boundary in $1
      .replace(/(^|\s)(?:n|&|\+)(?=\s|$)/g, '$1and')
      // 6. Collapse whitespace and trim
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Tokenizes a search query into non-empty normalized string tokens.
 */
export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ').filter((t) => t.length > 0);
}
