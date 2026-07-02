// Feature: disney-facilities-catalog-source, Property 4: Normalization excludes tombstones and blank-name documents
/**
 * Property test for the Catalog_Sync normalization step (design.md → Property 4).
 *
 * Property 4: Normalization excludes tombstones and blank-name documents.
 *
 * The sync orchestrator's normalization step (`isIncludedDocument` in
 * `sync.ts`, applied via `documents.filter(isIncludedDocument)`) decides which
 * Facility_Documents survive into the upstream entity set. *For any*
 * Facility_Document:
 *
 *   - A tombstone — a document with `softDeleted === true` — is excluded
 *     (Requirement 3.4).
 *   - A document with no `name`, or a `name` consisting only of whitespace, is
 *     excluded (Requirement 3.7).
 *   - Every other document (not a tombstone, and carrying a name with at least
 *     one non-whitespace character) is kept, regardless of its `type` or any
 *     other field — the type split happens downstream.
 *
 * The oracle here is independent of the implementation: inclusion is computed
 * directly from the two exclusion predicates (`softDeleted === true` and a
 * blank/whitespace name) rather than by re-running the production filter, and
 * the batch property additionally checks that filtering a mixed list keeps
 * exactly the documents the oracle marks as included, in their original order.
 *
 * **Validates: Requirements 3.4, 3.7**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isIncludedDocument, __internal } from '../../sync.js';
import type { FacilityDocument } from '../facilityDoc.js';

/** Spec convention: every `fc.assert` runs with at least 100 iterations. */
const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Oracle: a document is included iff it is not a tombstone AND its name carries
// at least one non-whitespace character (R3.4, R3.7).
// ---------------------------------------------------------------------------

function expectedIncluded(doc: FacilityDocument): boolean {
  if (doc.softDeleted === true) {
    return false;
  }
  if (doc.name === undefined) {
    return false;
  }
  return doc.name.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** Strings made only of whitespace characters (space, tab, newline, CR). */
const whitespaceOnlyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
    minLength: 1,
    maxLength: 5,
  })
  .map((chars) => chars.join(''));

/** Zero-to-three whitespace characters used as optional padding. */
const optionalPaddingArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 3 })
  .map((chars) => chars.join(''));

/** Names that carry at least one non-whitespace character (surrounding ws ok). */
const nonBlankNameArb: fc.Arbitrary<string> = fc
  .tuple(
    optionalPaddingArb,
    fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    optionalPaddingArb,
  )
  .map(([before, core, after]) => `${before}${core}${after}`);

/** The three name variants: absent, blank/whitespace-only, and non-blank. */
const nameArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  whitespaceOnlyArb,
  nonBlankNameArb,
);

/** `softDeleted` variants: true (tombstone), false, and absent. */
const softDeletedArb: fc.Arbitrary<boolean | undefined> = fc.constantFrom(
  true,
  false,
  undefined,
);

/** A varied Facility_Document exercising both exclusion predicates. */
const facilityDocArb: fc.Arbitrary<FacilityDocument> = fc
  .record(
    {
      id: fc.string({ minLength: 1 }),
      name: nameArb,
      type: fc.option(
        fc.constantFrom(
          'attraction',
          'restaurant',
          'resort',
          'resort-area',
          'transportation',
        ),
        { nil: undefined },
      ),
      softDeleted: softDeletedArb,
    },
    { requiredKeys: ['id'] },
  )
  .map((partial) => partial as FacilityDocument);

// ---------------------------------------------------------------------------
// Property 4.
// ---------------------------------------------------------------------------

describe('normalization — Property 4: excludes tombstones and blank-name documents', () => {
  it('includes a document iff it is not a tombstone and its name is non-blank (R3.4, R3.7)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        expect(isIncludedDocument(doc)).toBe(expectedIncluded(doc));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('always excludes a tombstone regardless of name (R3.4)', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        const doc: FacilityDocument = {
          id: 'x',
          name,
          softDeleted: true,
        } as FacilityDocument;
        expect(isIncludedDocument(doc)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('always excludes an absent, empty, or whitespace-only name regardless of softDeleted (R3.7)', () => {
    const blankNameArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      whitespaceOnlyArb,
    );
    fc.assert(
      fc.property(blankNameArb, softDeletedArb, (name, softDeleted) => {
        const doc: FacilityDocument = {
          id: 'x',
          name,
          softDeleted,
        } as FacilityDocument;
        expect(isIncludedDocument(doc)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps a non-tombstone document with a non-blank name (R3.4, R3.7)', () => {
    fc.assert(
      fc.property(
        nonBlankNameArb,
        fc.constantFrom(false, undefined),
        (name, softDeleted) => {
          const doc: FacilityDocument = {
            id: 'x',
            name,
            softDeleted,
          } as FacilityDocument;
          expect(isIncludedDocument(doc)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('filtering a mixed list keeps exactly the included documents in order (R3.4, R3.7)', () => {
    fc.assert(
      fc.property(fc.array(facilityDocArb, { maxLength: 40 }), (docs) => {
        const filtered = docs.filter(__internal.isIncludedDocument);
        const expected = docs.filter(expectedIncluded);
        expect(filtered).toEqual(expected);
        // Every survivor is a non-tombstone with a non-blank name.
        for (const doc of filtered) {
          expect(doc.softDeleted).not.toBe(true);
          expect(doc.name !== undefined && doc.name.trim().length > 0).toBe(
            true,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
