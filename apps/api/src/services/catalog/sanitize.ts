/**
 * Plain-text sanitization for upstream `description` strings.
 *
 * The ThemeParks.wiki API returns Experience descriptions as free-form
 * strings. Per design.md "Security and Privacy Notes":
 *
 *   "Catalog_Service strips any HTML or script content from upstream
 *    `description` fields before persisting; the field is rendered as
 *    plain text in the client."
 *
 * This helper produces a deterministic, plain-text version of an upstream
 * description suitable for storage in the `experiences.description` column
 * (a `TEXT NOT NULL` with `CHECK char_length(description) BETWEEN 0 AND
 * 1000`). The pipeline is:
 *
 *   1. Drop `<script>...</script>` and `<style>...</style>` blocks **with
 *      their content**. Removing only the open/close tags would leak the
 *      script body into the visible text.
 *   2. Drop any remaining HTML/XML-shaped tags (anything matching
 *      `</?[^>]*>`).
 *   3. Decode the small set of named character references that legitimately
 *      appear in human-readable copy: `&amp;`, `&lt;`, `&gt;`, `&quot;`,
 *      `&apos;`, `&#39;`, `&nbsp;`. Decoding is intentionally limited to
 *      these because the input is already stripped of tags by step (2);
 *      decoding *after* tag stripping is safe and prevents
 *      `&lt;script&gt;` payloads from re-introducing tag-shaped content.
 *   4. Collapse runs of whitespace (including `\u00A0` non-breaking spaces
 *      already decoded from `&nbsp;`) into single spaces.
 *   5. Trim leading and trailing whitespace.
 *   6. Hard-clamp the result to the column's 1000-character limit (R1.8) by
 *      slicing the string. We slice rather than reject so a verbose
 *      upstream description still produces a valid row; the alternative
 *      would be an entire failed sync run for cosmetic overflow.
 *
 * The function is **pure**: same input produces the same output, no I/O,
 * no clock, no globals. This keeps the repo's persistence path free of
 * side-effects beyond the database write itself.
 *
 * Validates: Requirements 1.8 (description bounds), security/privacy notes
 *            on description sanitization (design.md).
 */

/** R1.8 upper bound on `description` length, mirrored in the DB CHECK. */
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Tags whose contents must be removed along with the tags themselves.
 * Matched case-insensitively (`/i`) and across line boundaries (`/s`).
 */
const SCRIPT_OR_STYLE_BLOCK = /<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

/** Generic HTML/XML tag pattern: `<tag ...>` or `</tag ...>`. */
const ANY_HTML_TAG = /<\/?[^>]*>/g;

/**
 * Named entity → replacement map. Limited to the small set of references
 * commonly produced by content management systems; anything outside this
 * set is left as-is and may be rendered verbatim by the client.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Pattern matching every key of {@link NAMED_ENTITIES}. */
const NAMED_ENTITY_PATTERN = new RegExp(
  Object.keys(NAMED_ENTITIES).join('|'),
  'g',
);

/**
 * Sanitize an upstream description string for persistence.
 *
 * Returns the empty string when `raw` is `null`, `undefined`, or
 * effectively empty after sanitization. This matches the
 * `experiences.description NOT NULL DEFAULT ''` column default and saves
 * the caller from a null-coalescing branch on every write.
 */
export function sanitizeDescription(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  // 1. Remove <script>...</script> and <style>...</style> blocks with
  //    their entire content.
  let result = raw.replace(SCRIPT_OR_STYLE_BLOCK, '');

  // 2. Strip every remaining tag.
  result = result.replace(ANY_HTML_TAG, '');

  // 3. Decode the small set of named references. Done after tag stripping
  //    so encoded `&lt;script&gt;` payloads cannot reintroduce tag-shaped
  //    content into the output.
  result = result.replace(
    NAMED_ENTITY_PATTERN,
    (match) => NAMED_ENTITIES[match] ?? match,
  );

  // 4. Collapse whitespace runs (including newlines and the no-break space
  //    that `&nbsp;` decodes to) into single spaces.
  result = result.replace(/\s+/g, ' ');

  // 5. Trim.
  result = result.trim();

  // 6. Clamp to the column's hard upper bound.
  if (result.length > MAX_DESCRIPTION_LENGTH) {
    result = result.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return result;
}
