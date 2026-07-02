// Feature: disney-facilities-catalog-source, Property 8: Imagery selection prefers detail then list then null
/**
 * Property-based tests for `selectImageUrl` (design.md → "6. Enrichment and
 * imagery"), the single pure, total, deterministic core that resolves a
 * Facility_Document's catalog `imageUrl` using the shared Disney imagery
 * precedence used by both Experiences and Resorts (R6.5).
 *
 * Validates: Requirements 6.5, 7.1, 7.2, 7.3
 *
 * Property 8 — Imagery selection prefers detail then list then null:
 *
 *   - **Detail wins (R7.1).** When `detailImageUrl` is non-empty after
 *     trimming, the result is its trimmed value, regardless of `listImageUrl`.
 *   - **List is the fallback (R7.2).** When `detailImageUrl` does not qualify
 *     but `listImageUrl` is non-empty after trimming, the result is the trimmed
 *     `listImageUrl`.
 *   - **Otherwise null (R7.3).** When neither field qualifies, the result is
 *     `null`.
 *   - **Empty/whitespace never counts.** An absent, empty, or whitespace-only
 *     field is not an image source; the returned value carries no surrounding
 *     whitespace.
 *   - **Shared rule (R6.5).** The same precedence holds for every document
 *     shape, so Experiences and Resorts cannot drift.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { selectImageUrl } from '../imagery.js';
import type { FacilityDocument } from '../facilityDoc.js';

const NUM_RUNS = 100;

/** Does a candidate field qualify as a non-empty image source (non-empty after trimming)? */
function qualifies(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * A whitespace-only string generator (spaces, tabs, newlines). These must never
 * count as an image source, so the result trims them away to nothing.
 */
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(''));

/**
 * A non-empty, non-whitespace URL-ish string. Padded with optional surrounding
 * whitespace so the property also exercises the trimming behaviour, while the
 * trimmed core stays non-empty.
 */
const nonEmptyUrlArb = fc
  .tuple(
    fc.option(whitespaceArb, { nil: '' }),
    fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    fc.option(whitespaceArb, { nil: '' }),
  )
  .map(([lead, core, trail]) => `${lead}${core}${trail}`);

/**
 * A candidate image field: either a qualifying (non-empty-after-trim) value, or
 * a non-qualifying value (absent, empty string, or whitespace-only).
 */
const imageFieldArb = fc.oneof(
  { weight: 3, arbitrary: nonEmptyUrlArb },
  { weight: 1, arbitrary: fc.constant<string | undefined>(undefined) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: whitespaceArb },
);

/**
 * A tolerant `FacilityDocument` carrying the two imagery fields (each possibly
 * qualifying or not). Only `id` is required; the rest is irrelevant to imagery
 * selection.
 */
const facilityDocArb: fc.Arbitrary<FacilityDocument> = fc
  .record(
    {
      id: fc.constant('80010177;entityType=Facility'),
      detailImageUrl: imageFieldArb,
      listImageUrl: imageFieldArb,
    },
    { requiredKeys: ['id'] },
  )
  .map((doc) => doc as FacilityDocument);

describe('selectImageUrl — Property 8: detail wins, else list, else null', () => {
  it('returns the trimmed detailImageUrl whenever it is non-empty after trimming (R7.1)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        fc.pre(qualifies(doc.detailImageUrl));
        expect(selectImageUrl(doc)).toBe(doc.detailImageUrl!.trim());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('falls back to the trimmed listImageUrl when detail does not qualify but list does (R7.2)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        fc.pre(!qualifies(doc.detailImageUrl) && qualifies(doc.listImageUrl));
        expect(selectImageUrl(doc)).toBe(doc.listImageUrl!.trim());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when neither field qualifies (R7.3)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        fc.pre(!qualifies(doc.detailImageUrl) && !qualifies(doc.listImageUrl));
        expect(selectImageUrl(doc)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches the full precedence reference for every document shape (R6.5, R7.1, R7.2, R7.3)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        const expected = qualifies(doc.detailImageUrl)
          ? doc.detailImageUrl.trim()
          : qualifies(doc.listImageUrl)
            ? doc.listImageUrl.trim()
            : null;
        expect(selectImageUrl(doc)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never returns an empty or whitespace-padded string (R7.1, R7.2, R7.3)', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        const result = selectImageUrl(doc);
        if (result !== null) {
          expect(result.length).toBeGreaterThan(0);
          expect(result).toBe(result.trim());
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated document', () => {
    fc.assert(
      fc.property(facilityDocArb, (doc) => {
        expect(() => selectImageUrl(doc)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('selectImageUrl — Property 8 fixed regression examples', () => {
  it('detail wins over a present list value (R7.1)', () => {
    const doc: FacilityDocument = {
      id: '90001234;entityType=restaurant',
      detailImageUrl: 'https://cdn.disney.com/detail.jpg',
      listImageUrl: 'https://cdn.disney.com/list.jpg',
    };
    expect(selectImageUrl(doc)).toBe('https://cdn.disney.com/detail.jpg');
  });

  it('trims whitespace off the selected detail value (R7.1)', () => {
    const doc: FacilityDocument = {
      id: '1;entityType=Attraction',
      detailImageUrl: '  https://cdn.disney.com/detail.jpg\n',
    };
    expect(selectImageUrl(doc)).toBe('https://cdn.disney.com/detail.jpg');
  });

  it('falls back to list when detail is whitespace-only (R7.2)', () => {
    const doc: FacilityDocument = {
      id: '1;entityType=Attraction',
      detailImageUrl: '   ',
      listImageUrl: 'https://cdn.disney.com/list.jpg',
    };
    expect(selectImageUrl(doc)).toBe('https://cdn.disney.com/list.jpg');
  });

  it('falls back to list when detail is absent (R7.2)', () => {
    const doc: FacilityDocument = {
      id: '1;entityType=resort',
      listImageUrl: 'https://cdn.disney.com/resort-list.jpg',
    };
    expect(selectImageUrl(doc)).toBe('https://cdn.disney.com/resort-list.jpg');
  });

  it('returns null when both fields are empty or whitespace-only (R7.3)', () => {
    const doc: FacilityDocument = {
      id: '1;entityType=Attraction',
      detailImageUrl: '',
      listImageUrl: '   ',
    };
    expect(selectImageUrl(doc)).toBeNull();
  });

  it('returns null when both fields are absent (R7.3)', () => {
    const doc: FacilityDocument = { id: '1;entityType=resort' };
    expect(selectImageUrl(doc)).toBeNull();
  });
});
