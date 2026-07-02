// Feature: disney-facilities-catalog-source, Property 14: Persisted descriptions are plain text
/**
 * Property-based tests for `sanitizeDescription` (catalog description
 * sanitization).
 *
 * Validates: Requirements 11.8
 *
 * Property 14 (design.md → Correctness Properties):
 *
 *   "For any upstream description, the persisted description contains no
 *    HTML or markup tags."
 *
 * Requirement 11.8:
 *
 *   "THE Catalog_Sync SHALL store each Facility_Document description with
 *    all HTML and markup tags removed, leaving plain text only."
 *
 * `sanitizeDescription` is the single point at which an upstream
 * (ThemeParks.wiki) `description` string becomes the plain-text value that
 * is persisted to `experiences.description`. The property therefore reads:
 *
 *   for any upstream description string `raw`,
 *   `sanitizeDescription(raw)` contains no HTML / markup tag.
 *
 * A "tag" here is anything matching the generic HTML/XML tag shape
 * `</?[^>]*>` — the same shape the implementation itself strips. This is
 * the direct, executable encoding of "contains no HTML or markup tags".
 *
 * Input space (see generators below). We drive `raw` with the kinds of
 * markup that genuinely appear in upstream CMS copy:
 *
 *   - plain-text runs (letters, digits, punctuation, whitespace);
 *   - opening / closing / self-closing HTML tags with attributes;
 *   - `<script>…</script>` and `<style>…</style>` blocks with bodies;
 *   - HTML comments;
 *   - the curated named character references the sanitizer decodes
 *     (`&amp;`, `&quot;`, `&apos;`, `&#39;`, `&nbsp;`).
 *
 * Two deliberate input-space constraints, both faithful to the contract
 * rather than weakenings of it:
 *
 *   1. Plain-text runs and attribute values exclude the raw `<` and `>`
 *      characters. Upstream copy that wants to *display* an angle bracket
 *      encodes it (`&lt;` / `&gt;`); an unencoded `<`/`>` in source is, by
 *      definition, tag syntax. Constraining the generator this way keeps
 *      generated "plain text" from being accidental malformed markup.
 *
 *   2. The named-entity tokens exclude `&lt;` and `&gt;`. The sanitizer
 *      decodes entities *after* stripping tags, and design.md's security
 *      note (mirrored in `sanitize.test.ts`) documents that a
 *      double-escaped `&lt;script&gt;` decodes to the literal text
 *      `<script>` and is intentionally rendered as plain text by the
 *      client — i.e. those characters are escaped *content*, not upstream
 *      *tags*. Property 14 is about markup tags present in the upstream
 *      document, so reconstructing tag-shaped literals from content
 *      entities is out of scope for this property.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { sanitizeDescription } from '../sanitize.js';

const NUM_RUNS = 100;

/** R11.8 / DB CHECK upper bound on a persisted description. */
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * The generic HTML/XML tag shape. A persisted plain-text description must
 * NOT match this anywhere. Mirrors the pattern the implementation strips.
 */
const ANY_HTML_TAG = /<\/?[^>]*>/;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A run of plain, tag-free text. Excludes `<` and `>` (raw angle brackets
 * are tag syntax, not display text — see the header note) and `&` (so a
 * plain run can never accidentally spell a decodable entity when abutting
 * an entity token). Whitespace is included so the collapse/trim behaviour
 * is exercised.
 */
const plainTextArb = fc
  .string({ minLength: 0, maxLength: 40 })
  .map((s) => s.replace(/[<>&]/g, ''));

/** Tag names drawn from the sort upstream descriptions actually contain. */
const tagNameArb = fc.constantFrom(
  'p',
  'b',
  'i',
  'em',
  'strong',
  'a',
  'span',
  'div',
  'br',
  'ul',
  'li',
  'h1',
  'h2',
);

/** An attribute string like ` href="value"`, with `<`/`>`-free values. */
const attrArb = fc
  .record({
    name: fc.constantFrom('href', 'class', 'id', 'title', 'style', 'rel'),
    value: fc.string({ minLength: 0, maxLength: 15 }).map((s) =>
      s.replace(/[<>"]/g, ''),
    ),
  })
  .map(({ name, value }) => ` ${name}="${value}"`);

/** An opening tag, optionally with attributes: `<a href="x">`. */
const openTagArb = fc
  .tuple(tagNameArb, fc.array(attrArb, { maxLength: 3 }))
  .map(([name, attrs]) => `<${name}${attrs.join('')}>`);

/** A closing tag: `</a>`. */
const closeTagArb = tagNameArb.map((name) => `</${name}>`);

/** A self-closing tag: `<br/>` / `<span class="x"/>`. */
const selfCloseTagArb = fc
  .tuple(tagNameArb, fc.array(attrArb, { maxLength: 2 }))
  .map(([name, attrs]) => `<${name}${attrs.join('')}/>`);

/** An HTML comment with a `>`-free body: `<!-- note -->`. */
const commentArb = fc
  .string({ minLength: 0, maxLength: 20 })
  .map((s) => `<!--${s.replace(/>/g, '')}-->`);

/** A `<script>…</script>` block whose body must never survive. */
const scriptBlockArb = fc
  .string({ minLength: 0, maxLength: 30 })
  .map((body) => `<script>${body.replace(/<\/script/gi, '')}</script>`);

/** A `<style>…</style>` block whose body must never survive. */
const styleBlockArb = fc
  .string({ minLength: 0, maxLength: 30 })
  .map((body) => `<style>${body.replace(/<\/style/gi, '')}</style>`);

/**
 * A named character reference the sanitizer decodes. `&lt;`/`&gt;` are
 * intentionally excluded (see header note): they are escaped content, not
 * upstream tags, and decode to literal `<`/`>` that the client renders as
 * plain text.
 */
const entityArb = fc.constantFrom('&amp;', '&quot;', '&apos;', '&#39;', '&nbsp;');

/** Any single fragment of a synthetic upstream description. */
const fragmentArb = fc.oneof(
  { weight: 4, arbitrary: plainTextArb },
  { weight: 3, arbitrary: openTagArb },
  { weight: 3, arbitrary: closeTagArb },
  { weight: 2, arbitrary: selfCloseTagArb },
  { weight: 1, arbitrary: commentArb },
  { weight: 2, arbitrary: scriptBlockArb },
  { weight: 2, arbitrary: styleBlockArb },
  { weight: 2, arbitrary: entityArb },
);

/**
 * A full synthetic upstream description: any interleaving of the fragment
 * kinds above. `maxLength` is generous so long inputs exercise the
 * 1000-char clamp too.
 */
const upstreamDescriptionArb = fc
  .array(fragmentArb, { minLength: 0, maxLength: 60 })
  .map((parts) => parts.join(''));

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('catalog — Property 14: persisted descriptions are plain text (R11.8)', () => {
  it('produces output containing no HTML or markup tags for any upstream description', () => {
    fc.assert(
      fc.property(upstreamDescriptionArb, (raw) => {
        const out = sanitizeDescription(raw);
        expect(
          ANY_HTML_TAG.test(out),
          `sanitized output still contains a tag: ${JSON.stringify(out)} (from ${JSON.stringify(raw)})`,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves no raw angle brackets in the output (no partial/dangling tags)', () => {
    fc.assert(
      fc.property(upstreamDescriptionArb, (raw) => {
        const out = sanitizeDescription(raw);
        expect(
          out.includes('<') || out.includes('>'),
          `sanitized output still contains an angle bracket: ${JSON.stringify(out)} (from ${JSON.stringify(raw)})`,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never lets a <script> or <style> body survive into the output', () => {
    // Tag a recognizable payload inside script/style bodies and assert it
    // is gone. This complements the "no tags" property: it proves the
    // *content* of removed blocks is dropped, not just the delimiters.
    const marked = fc
      .tuple(plainTextArb, fc.constantFrom('script', 'style'), plainTextArb)
      .map(
        ([before, kind, after]) =>
          `${before}<${kind}>__SECRET_BODY__</${kind}>${after}`,
      );

    fc.assert(
      fc.property(marked, (raw) => {
        const out = sanitizeDescription(raw);
        expect(out.includes('__SECRET_BODY__')).toBe(false);
        expect(ANY_HTML_TAG.test(out)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('always produces a persisted description within the 0..1000 length bound', () => {
    fc.assert(
      fc.property(upstreamDescriptionArb, (raw) => {
        const out = sanitizeDescription(raw);
        expect(out.length).toBeGreaterThanOrEqual(0);
        expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('catalog — Property 14: fixed adversarial examples', () => {
  it('strips nested and mixed markup', () => {
    const out = sanitizeDescription(
      '<div class="x"><p>Space <b>Mountain</b> is <em>fast</em>!</p></div>',
    );
    expect(ANY_HTML_TAG.test(out)).toBe(false);
    expect(out).toBe('Space Mountain is fast!');
  });

  it('removes a script block with markup-shaped content in its body', () => {
    const out = sanitizeDescription(
      'Ride<script>var s = "<img src=x onerror=alert(1)>";</script>Info',
    );
    expect(ANY_HTML_TAG.test(out)).toBe(false);
    expect(out).toBe('RideInfo');
  });

  it('strips well-formed tags even with irregular internal whitespace', () => {
    const out = sanitizeDescription('<  p  >spaced<  /  p  >');
    expect(ANY_HTML_TAG.test(out)).toBe(false);
    expect(out).toBe('spaced');
  });

  it('keeps decoded content entities as plain text without forming tags', () => {
    const out = sanitizeDescription('Tom &amp; Jerry say &quot;hi&quot;');
    expect(ANY_HTML_TAG.test(out)).toBe(false);
    expect(out).toBe('Tom & Jerry say "hi"');
  });
});
