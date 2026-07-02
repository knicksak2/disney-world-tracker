// Feature: disney-facilities-catalog-source, Property 7: Enrichment extraction maps present fields and nulls absent ones
/**
 * Property-based tests for `extractEnrichment` (design.md → "6. Enrichment and
 * imagery"), the pure, total, deterministic core that projects an Experience's
 * coordinates, accessibility facets, dining price tier, and meal periods out of
 * a tolerant `FacilityDocument`.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * Property 7 — Enrichment extraction maps present fields and nulls absent ones:
 *
 *   - **Coordinates (R5.1, R5.2).** When *both* `latitude` and `longitude` are
 *     present and finite, both enrichment fields equal those values; when
 *     *either* is missing, both are `null` — a half-coordinate is never
 *     produced.
 *   - **Accessibility (R5.3).** The `accessibility` facet list is carried
 *     through (dropping any non-string entry defensively), defaulting to an
 *     empty array when the document carries no `accessibility` facets.
 *   - **Price tier & meal periods (R5.4, R5.5).** These are populated *only*
 *     for a `restaurant` document — the first non-empty `priceRangeDining`
 *     value and each `mealPeriods` entry that carries a non-empty `type`. For
 *     any other Facility_Type they are `null`/empty regardless of the facets or
 *     meal periods present on the document.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { extractEnrichment } from '../enrich.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  NON_EXPERIENCE_TYPES,
  type FacilityDocument,
} from '../facilityDoc.js';

const NUM_RUNS = 100;

/** The Facility_Type whose dining facets/meal periods are enriched (R5.4, R5.5). */
const RESTAURANT_TYPE = 'restaurant';

/** Non-restaurant Facility_Types drawn from the shared type-set source of truth. */
const NON_RESTAURANT_TYPES: readonly string[] = [
  ...[...EXPERIENCE_ELIGIBLE_TYPES].filter((t) => t !== RESTAURANT_TYPE),
  ...NON_EXPERIENCE_TYPES,
];

/**
 * Finite coordinate values within a realistic range. Bounding the range keeps
 * the generator to finite doubles (never NaN/Infinity), matching the
 * present-and-finite branch of `extractCoordinates`.
 */
const coordArb = fc.double({ min: -180, max: 180, noNaN: true });

/** A latitude/longitude that is either a finite number or omitted (undefined). */
const optionalCoordArb = fc.option(coordArb, { nil: undefined });

/**
 * Accessibility facet entries. Mostly strings, but occasionally a non-string so
 * the property exercises the defensive `typeof tag === 'string'` filter (R5.3).
 */
const accessibilityEntryArb = fc.oneof(
  { weight: 4, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.constant(null) },
);

/** `priceRangeDining` facet values, including empty strings (must be skipped). */
const priceTierArb = fc.oneof(fc.constant('$'), fc.constant('$$'), fc.string());

/** A single `mealPeriods` entry with an optional `type` and optional `priceTier`. */
const mealPeriodArb = fc.record(
  {
    type: fc.option(fc.string(), { nil: undefined }),
    priceTier: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: [] },
);

/**
 * A tolerant `FacilityDocument` generator. Every enrichment-relevant field may
 * be present or absent so the property covers the full null/empty space. The
 * accessibility array may carry non-strings (cast through), so the result is
 * asserted as `FacilityDocument` for the defensive-filter branch.
 */
function facilityDocArb(typeArb: fc.Arbitrary<string | undefined>): fc.Arbitrary<FacilityDocument> {
  return fc
    .record(
      {
        id: fc.constant('80010177;entityType=Facility'),
        type: typeArb,
        latitude: optionalCoordArb,
        longitude: optionalCoordArb,
        facets: fc.option(
          fc.record(
            {
              accessibility: fc.option(fc.array(accessibilityEntryArb), { nil: undefined }),
              priceRangeDining: fc.option(fc.array(priceTierArb), { nil: undefined }),
            },
            { requiredKeys: [] },
          ),
          { nil: undefined },
        ),
        mealPeriods: fc.option(fc.array(mealPeriodArb), { nil: undefined }),
      },
      { requiredKeys: ['id'] },
    )
    .map((doc) => doc as unknown as FacilityDocument);
}

/** Bias the type toward `restaurant` so the dining-gated branches are exercised. */
const mixedTypeArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant<string | undefined>(RESTAURANT_TYPE) },
  { weight: 3, arbitrary: fc.constantFrom<string>(...NON_RESTAURANT_TYPES) },
  { weight: 1, arbitrary: fc.constant<string | undefined>(undefined) },
);

/** Reference: the accessibility list `extractEnrichment` must produce (R5.3). */
function expectedAccessibility(doc: FacilityDocument): readonly string[] {
  const tags = doc.facets?.accessibility;
  if (tags === undefined) {
    return [];
  }
  return (tags as readonly unknown[]).filter((t): t is string => typeof t === 'string');
}

describe('extractEnrichment — Property 7: present fields mapped, absent fields nulled', () => {
  it('coordinates are both set when both present and finite, else both null (R5.1, R5.2)', () => {
    fc.assert(
      fc.property(facilityDocArb(mixedTypeArb), (doc) => {
        const e = extractEnrichment(doc);
        const bothFinite = Number.isFinite(doc.latitude) && Number.isFinite(doc.longitude);
        if (bothFinite) {
          expect(e.latitude).toBe(doc.latitude);
          expect(e.longitude).toBe(doc.longitude);
        } else {
          expect(e.latitude).toBeNull();
          expect(e.longitude).toBeNull();
        }
        // A half-coordinate is never produced: latitude null iff longitude null.
        expect(e.latitude === null).toBe(e.longitude === null);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accessibility carries string facets through, empty when absent (R5.3)', () => {
    fc.assert(
      fc.property(facilityDocArb(mixedTypeArb), (doc) => {
        const e = extractEnrichment(doc);
        expect(e.accessibility).toEqual(expectedAccessibility(doc));
        // Every carried entry is a string (non-strings defensively dropped).
        expect(e.accessibility.every((t) => typeof t === 'string')).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('price tier & meal periods are populated only for a restaurant (R5.4, R5.5)', () => {
    fc.assert(
      fc.property(facilityDocArb(mixedTypeArb), (doc) => {
        const e = extractEnrichment(doc);

        if (doc.type === RESTAURANT_TYPE) {
          const tiers = doc.facets?.priceRangeDining;
          const expectedTier =
            tiers === undefined
              ? null
              : (tiers.find((v) => typeof v === 'string' && v !== '') ?? null);
          expect(e.priceTier).toBe(expectedTier);

          const periods = doc.mealPeriods ?? [];
          const expectedPeriods = periods
            .filter((p) => typeof p.type === 'string' && p.type !== '')
            .map((p) => ({ type: p.type, priceTier: p.priceTier ?? null }));
          expect(e.mealPeriods).toEqual(expectedPeriods);
        } else {
          // Non-restaurant: dining enrichment is never populated, regardless of
          // any priceRangeDining facet or mealPeriods present on the document.
          expect(e.priceTier).toBeNull();
          expect(e.mealPeriods).toEqual([]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated document', () => {
    fc.assert(
      fc.property(facilityDocArb(mixedTypeArb), (doc) => {
        expect(() => extractEnrichment(doc)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('extractEnrichment — Property 7 fixed regression examples', () => {
  it('maps a fully-populated restaurant document (R5.1, R5.3, R5.4, R5.5)', () => {
    const doc: FacilityDocument = {
      id: '90001234;entityType=restaurant',
      type: 'restaurant',
      latitude: 28.42,
      longitude: -81.58,
      facets: {
        accessibility: ['wheelchair-access', 'service-animals'],
        priceRangeDining: ['$$'],
      },
      mealPeriods: [
        { type: 'Breakfast', priceTier: '$' },
        { type: 'Dinner' },
      ],
    };
    expect(extractEnrichment(doc)).toEqual({
      latitude: 28.42,
      longitude: -81.58,
      accessibility: ['wheelchair-access', 'service-animals'],
      priceTier: '$$',
      mealPeriods: [
        { type: 'Breakfast', priceTier: '$' },
        { type: 'Dinner', priceTier: null },
      ],
    });
  });

  it('nulls a half-coordinate and skips dining enrichment for a non-restaurant (R5.2, R5.4, R5.5)', () => {
    const doc: FacilityDocument = {
      id: '80010177;entityType=Attraction',
      type: 'attraction',
      latitude: 28.42,
      // longitude omitted
      facets: {
        priceRangeDining: ['$$$'],
      },
      mealPeriods: [{ type: 'Lunch', priceTier: '$$' }],
    };
    expect(extractEnrichment(doc)).toEqual({
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
    });
  });

  it('defaults to empty/null for a bare document with only required id (R5.2, R5.3)', () => {
    const doc: FacilityDocument = { id: '1;entityType=restaurant', type: 'restaurant' };
    expect(extractEnrichment(doc)).toEqual({
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
    });
  });
});
