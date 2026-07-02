// Feature: disney-facilities-catalog-source, Property 3: Multipart parsing recovers every well-formed part and drops only the malformed ones
/**
 * Property test for `parseBulkGet` (design.md → Property 3).
 *
 * Property 3: Multipart parsing recovers every well-formed part and drops only
 * the malformed ones.
 *
 * *For any* `multipart/related` `POST /_bulk_get` body encoding a mix of
 * well-formed JSON-object parts and malformed parts (invalid JSON, or valid
 * JSON that is not an object, or empty), `parseBulkGet` returns exactly the
 * well-formed documents — every one of them, in body order — and drops only the
 * malformed parts. A single bad part never removes a good one, and no bad part
 * is ever surfaced as a document (R3.1, R3.3).
 *
 * The oracle is independent of the implementation: the generator *knows* which
 * parts it made well-formed (it holds the exact document objects it encoded)
 * and which it deliberately corrupted, so the expected result is the list of
 * embedded good documents in order — never derived by re-running the parser's
 * own logic.
 *
 * A part-set is always generated with at least one well-formed document, so the
 * whole-body `invalid_response` failure (R3.2, a distinct property) is out of
 * scope here and never triggered.
 *
 * **Validates: Requirements 3.1, 3.3**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseBulkGet } from '../multipart.js';
import type { FacilityDocument } from '../facilityDoc.js';

/** Spec convention: every `fc.assert` runs with at least 100 iterations. */
const NUM_RUNS = 200;

const CRLF = '\r\n';

// ---------------------------------------------------------------------------
// Boundary: a hex token, long enough that it cannot collide with any payload
// substring the generators below can produce (they use single hyphens at most,
// never `--<hex-boundary>`).
// ---------------------------------------------------------------------------

const boundaryArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
    minLength: 12,
    maxLength: 32,
  })
  .map((chars) => `dwtboundary${chars.join('')}`);

// ---------------------------------------------------------------------------
// Well-formed document generator (JSON-object parts).
//
// String content is drawn from a safe vocabulary that never introduces the
// `--<boundary>` delimiter, and only defined values are ever present (optional
// keys are omitted, not set to `undefined`), so a JSON round-trip preserves the
// object exactly and the generated object is a faithful oracle for the parsed
// result.
// ---------------------------------------------------------------------------

const SAFE_TOKENS = [
  'magic',
  'river',
  'castle',
  'ride',
  'show',
  'plaza',
  'space',
  'pirates',
  'jungle',
  'haunted',
  'wheelchair-access', // single hyphens are safe; only `--<boundary>` collides
  'audio-description',
] as const;

const safeTextArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SAFE_TOKENS), { minLength: 0, maxLength: 3 })
  .map((words) => words.join(' '));

const docArb: fc.Arbitrary<FacilityDocument> = fc.record(
  {
    id: fc
      .array(fc.constantFrom(...SAFE_TOKENS), { minLength: 1, maxLength: 3 })
      .map((words) => words.join('_')),
    name: safeTextArb,
    type: fc.constantFrom(
      'attraction',
      'entertainment',
      'restaurant',
      'resort',
      'land',
      'recreation',
    ),
    subType: safeTextArb,
    description: safeTextArb,
    latitude: fc.integer({ min: -90, max: 90 }),
    longitude: fc.integer({ min: -180, max: 180 }),
    softDeleted: fc.boolean(),
    facets: fc.record(
      {
        accessibility: fc.array(
          fc.constantFrom('wheelchair-access', 'audio-description'),
          { maxLength: 3 },
        ),
        priceRangeDining: fc.array(fc.constantFrom('$', '$$', '$$$'), {
          maxLength: 2,
        }),
      },
      { requiredKeys: [] },
    ),
    channels: fc.array(fc.constantFrom('wdw.facilities.1_0.en_us'), {
      maxLength: 2,
    }),
  },
  { requiredKeys: ['id'] },
) as fc.Arbitrary<FacilityDocument>;

// ---------------------------------------------------------------------------
// Malformed payloads: either invalid JSON, or valid JSON that is not an object.
// None can parse into a document object, and none contains the boundary
// delimiter, so each must be dropped (R3.3).
// ---------------------------------------------------------------------------

const malformedPayloadArb: fc.Arbitrary<string> = fc.constantFrom(
  '{ this is not valid json',
  'not json at all',
  '{"unclosed": ',
  '}{',
  '{key: value}', // unquoted key → invalid JSON
  '[1, 2, 3]', // valid JSON, but an array (not a document object)
  '42',
  '3.14',
  '"just a string"',
  'true',
  'null',
);

// ---------------------------------------------------------------------------
// Part specs: a tagged union the generator fully controls.
// ---------------------------------------------------------------------------

type PartSpec =
  | { readonly kind: 'good'; readonly doc: FacilityDocument }
  | { readonly kind: 'bad'; readonly payload: string };

const goodSpecArb: fc.Arbitrary<PartSpec> = docArb.map((doc) => ({
  kind: 'good' as const,
  doc,
}));

const badSpecArb: fc.Arbitrary<PartSpec> = malformedPayloadArb.map(
  (payload) => ({ kind: 'bad' as const, payload }),
);

const anySpecArb: fc.Arbitrary<PartSpec> = fc.oneof(goodSpecArb, badSpecArb);

/**
 * A list of part specs guaranteed to contain at least one well-formed document,
 * placed at an arbitrary position so ordering and interleaving with bad parts
 * are exercised.
 */
const specsArb: fc.Arbitrary<readonly PartSpec[]> = fc
  .tuple(
    fc.array(anySpecArb, { minLength: 0, maxLength: 8 }),
    goodSpecArb,
    fc.nat(),
  )
  .map(([specs, guaranteedGood, rawIndex]) => {
    const pos = specs.length === 0 ? 0 : rawIndex % (specs.length + 1);
    return [...specs.slice(0, pos), guaranteedGood, ...specs.slice(pos)];
  });

// ---------------------------------------------------------------------------
// Encoder: turn part specs into a real multipart/related wire body.
// ---------------------------------------------------------------------------

function payloadFor(spec: PartSpec): string {
  return spec.kind === 'good' ? JSON.stringify(spec.doc) : spec.payload;
}

function encodeBody(specs: readonly PartSpec[], boundary: string): string {
  const delimiter = `--${boundary}`;
  let body = '';
  for (const spec of specs) {
    body += delimiter + CRLF;
    body += 'Content-Type: application/json' + CRLF;
    body += CRLF; // blank line separates part headers from payload
    body += payloadFor(spec) + CRLF;
  }
  body += `${delimiter}--${CRLF}`; // closing delimiter
  return body;
}

/** The `Content-Type` header, in either quoted or unquoted boundary form. */
function contentTypeFor(boundary: string, quoted: boolean): string {
  return quoted
    ? `multipart/related; boundary="${boundary}"`
    : `multipart/related; boundary=${boundary}`;
}

function expectedGoodDocs(specs: readonly PartSpec[]): FacilityDocument[] {
  return specs
    .filter((s): s is Extract<PartSpec, { kind: 'good' }> => s.kind === 'good')
    .map((s) => s.doc);
}

// ---------------------------------------------------------------------------
// Property 3.
// ---------------------------------------------------------------------------

describe('parseBulkGet — Property 3: recover well-formed parts, drop malformed ones', () => {
  it('recovers exactly the well-formed documents in order and drops only the malformed parts', () => {
    fc.assert(
      fc.property(
        specsArb,
        boundaryArb,
        fc.boolean(),
        (specs, boundary, quotedBoundary) => {
          const body = encodeBody(specs, boundary);
          const contentType = contentTypeFor(boundary, quotedBoundary);

          const result = parseBulkGet(contentType, body);
          const expected = expectedGoodDocs(specs);

          // Every well-formed part is recovered, in body order, and nothing
          // else is surfaced — so malformed parts are the only ones dropped.
          expect(result.documents).toEqual(expected);
          expect(result.documents.length).toBe(expected.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('recovers all documents when every part is well-formed (R3.1)', () => {
    const allGoodArb = fc.array(docArb, { minLength: 1, maxLength: 10 });
    fc.assert(
      fc.property(allGoodArb, boundaryArb, (docs, boundary) => {
        const specs: PartSpec[] = docs.map((doc) => ({ kind: 'good', doc }));
        const body = encodeBody(specs, boundary);
        const result = parseBulkGet(contentTypeFor(boundary, false), body);
        expect(result.documents).toEqual(docs);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
