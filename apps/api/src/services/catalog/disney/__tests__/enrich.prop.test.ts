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

import {
  deriveFacetViews,
  extractEnrichment,
  extractHeightRequirement,
  extractInterestFacets,
  extractPhysicalConsiderations,
  extractSubType,
  extractWhyThis,
  parseHeightMinimum,
} from '../enrich.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  INTEREST_FACET_GROUPS,
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
      groupedFacets: {},
      heightRequirement: null,
      physicalConsiderations: [],
      interestFacets: {},
      whyThis: null,
      subType: null,
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
      groupedFacets: {},
      heightRequirement: null,
      physicalConsiderations: [],
      interestFacets: {},
      whyThis: null,
      subType: null,
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
      groupedFacets: {},
      heightRequirement: null,
      physicalConsiderations: [],
      interestFacets: {},
      whyThis: null,
      subType: null,
    });
  });
});

// Feature: experience-facet-enrichment, Property 3: Height_Requirement selection and absence
/**
 * Property-based tests for `extractHeightRequirement` (design.md → "3.
 * Enrichment_Extractor"), the pure, total, deterministic helper that projects
 * the ride Height_Requirement out of a Facility_Document's persisted
 * Grouped_Facets.
 *
 * Validates: Requirements 2.1, 2.5
 *
 * Property 3 — Height_Requirement selection and absence:
 *
 *   For any Facility_Document, `extractHeightRequirement` returns the
 *   `{id, name}` of the **first** `height` Facet_Value when at least one is
 *   present (R2.1), and `null` when no `height` facet is present (R2.5). The
 *   derived numeric minimums (`minInches`/`minCentimeters`) are the concern of
 *   Property 4; here we assert only first-value selection (id and name
 *   preserved) and absence.
 */

/** A `{id, name}` Facet_Value; both fields are always strings. */
const facetValueArb = fc.record({
  id: fc.string(),
  name: fc.string(),
});

/** A non-empty list of `height` Facet_Values (at least one present). */
const heightValuesArb = fc.array(facetValueArb, { minLength: 1, maxLength: 5 });

/**
 * Other Persisted_Facet_Groups that may accompany (or stand in the absence of)
 * a `height` group, so the property covers documents whose Grouped_Facets carry
 * unrelated groups.
 */
const OTHER_GROUPS = [
  'physicalConsiderations',
  'interests',
  'thrillFactor',
  'age',
  'parkInterests',
  'disneyFavorites',
] as const;

/** A Grouped_Facets map of zero or more non-`height` groups, each with facets. */
const otherGroupedFacetsArb = fc
  .subarray([...OTHER_GROUPS], { minLength: 0, maxLength: OTHER_GROUPS.length })
  .chain((groups) =>
    fc
      .tuple(...groups.map(() => fc.array(facetValueArb, { minLength: 1, maxLength: 3 })))
      .map((valueLists) => {
        const map: Record<string, readonly { id: string; name: string }[]> = {};
        groups.forEach((group, i) => {
          map[group] = valueLists[i]!;
        });
        return map;
      }),
  );

/** Build a Facility_Document carrying the given Grouped_Facets structure. */
function docWithGroupedFacets(
  grouped: Record<string, readonly { id: string; name: string }[]>,
): FacilityDocument {
  return { id: '80010177;entityType=Attraction', groupedFacets: grouped } as FacilityDocument;
}

describe('extractHeightRequirement — Property 3: height selection and absence', () => {
  it('returns the first height Facet_Value id and name when at least one is present (R2.1)', () => {
    fc.assert(
      fc.property(heightValuesArb, otherGroupedFacetsArb, (heights, other) => {
        const doc = docWithGroupedFacets({ ...other, height: heights });
        const result = extractHeightRequirement(doc);

        // A height facet is present, so a Height_Requirement is produced...
        expect(result).not.toBeNull();
        // ...carrying the id and name of the *first* height Facet_Value (R2.1).
        expect(result?.id).toBe(heights[0]!.id);
        expect(result?.name).toBe(heights[0]!.name);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when no height facet is present (R2.5)', () => {
    fc.assert(
      fc.property(otherGroupedFacetsArb, (other) => {
        // `other` never contains a `height` group by construction.
        const doc = docWithGroupedFacets(other);
        expect(extractHeightRequirement(doc)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when the height group is present but empty (R2.5)', () => {
    fc.assert(
      fc.property(otherGroupedFacetsArb, (other) => {
        const doc = docWithGroupedFacets({ ...other, height: [] });
        expect(extractHeightRequirement(doc)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when the document carries no Grouped_Facets at all (R2.5)', () => {
    const doc: FacilityDocument = { id: '1;entityType=Attraction' } as FacilityDocument;
    expect(extractHeightRequirement(doc)).toBeNull();
  });
});

// Feature: experience-facet-enrichment, Property 4: Height minimum parsing derives the encoded unit only
/**
 * Property-based tests for `parseHeightMinimum` (design.md → "3.
 * Enrichment_Extractor"), the pure, total, deterministic parser that derives a
 * ride's numeric minimum height from a `height` Facet_Value `id`.
 *
 * Validates: Requirements 2.2, 2.3, 2.4
 *
 * Property 4 — Height minimum parsing derives the encoded unit only:
 *
 *   For any height facet `id`, `parseHeightMinimum` returns `minInches` equal to
 *   the encoded value with `minCentimeters` null when the id encodes an inches
 *   minimum (R2.2), `minCentimeters` equal to the encoded value with `minInches`
 *   null when the id encodes a centimeters minimum (R2.3), and both `null` when
 *   the id encodes no parseable numeric minimum (R2.4) — no unit conversion is
 *   performed. The surrounding Height_Requirement (via
 *   `extractHeightRequirement`) always retains the original `id` and `name`.
 */

/**
 * A numeric value rendered as a string. The parser captures `\d+(?:\.\d+)?` and
 * applies `Number(...)`, so the expected numeric minimum is `Number(valueStr)`
 * (e.g. `"40.50"` → 40.5). Generating the value as a string keeps the encoded
 * id and the expected number in lock-step.
 */
const valueStringArb = fc.oneof(
  fc.integer({ min: 0, max: 300 }).map(String),
  fc
    .tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 1, max: 99 }))
    .map(([whole, frac]) => `${whole}.${frac}`),
);

/** Recognized inches unit tokens (case-insensitive; longer spellings included). */
const inchesUnitArb = fc.constantFrom('in', 'inch', 'inches', '"', 'IN', 'Inch', 'INCHES');

/** Recognized centimeters unit tokens (case-insensitive). */
const cmUnitArb = fc.constantFrom('cm', 'centimeter', 'centimeters', 'CM', 'Centimeter', 'CENTIMETERS');

/**
 * Separators the parser tolerates between the number and its unit:
 * `\s*-?\s*` (whitespace and/or a single hyphen).
 */
const sepArb = fc.constantFrom('', ' ', '-', ' - ', '  ', '\t');

/**
 * Optional prefix text placed before the number. Digit-free by construction so
 * it can never introduce a competing numeric-unit match ahead of the real one.
 */
const prefixArb = fc.constantFrom('', 'height', 'min', 'heightMinimum', 'ride', 'must-be');

/**
 * Optional suffix text placed after the unit token. Each option begins with a
 * non-letter so the parser's trailing `(?![a-z])` lookahead still succeeds, and
 * none contains a competing unit token. Digit-free so it introduces no second
 * numeric-unit pair.
 */
const suffixArb = fc.constantFrom('', '-min', '_requirement', ';', ' or taller', '/max');

/** An id encoding an inches minimum, paired with its expected numeric value. */
const inchesIdArb = fc
  .record({ prefix: prefixArb, value: valueStringArb, sep: sepArb, unit: inchesUnitArb, suffix: suffixArb })
  .map(({ prefix, value, sep, unit, suffix }) => ({
    id: `${prefix}${value}${sep}${unit}${suffix}`,
    expected: Number(value),
  }));

/** An id encoding a centimeters minimum, paired with its expected numeric value. */
const cmIdArb = fc
  .record({ prefix: prefixArb, value: valueStringArb, sep: sepArb, unit: cmUnitArb, suffix: suffixArb })
  .map(({ prefix, value, sep, unit, suffix }) => ({
    id: `${prefix}${value}${sep}${unit}${suffix}`,
    expected: Number(value),
  }));

/**
 * An id that encodes no parseable numeric minimum. Two provably-unparseable
 * families:
 *   - digit-free strings — the parser requires a `\d`, so no match is possible;
 *   - a number followed by a non-height unit token (`kg`/`lbs`/`px`/…), or by
 *     nothing, so no recognized height unit is adjacent to the number.
 */
const unparseableIdArb = fc.oneof(
  fc.string().map((s) => s.replace(/[0-9]/g, '')),
  fc
    .tuple(valueStringArb, fc.constantFrom('', 'kg', 'lbs', 'px', 'years', 'meters', 'feet'))
    .map(([value, unit]) => `${value}${unit}`),
);

/** A non-empty display name for the surrounding Height_Requirement. */
const heightNameArb = fc.string({ minLength: 1 });

/** Build a Facility_Document whose first (only) `height` facet carries `id`/`name`. */
function docWithHeightId(id: string, name: string): FacilityDocument {
  return {
    id: '80010177;entityType=Attraction',
    groupedFacets: { height: [{ id, name }] },
  } as FacilityDocument;
}

describe('parseHeightMinimum — Property 4: derives the encoded unit only', () => {
  it('sets minInches to the encoded value and minCentimeters null for an inches id (R2.2)', () => {
    fc.assert(
      fc.property(inchesIdArb, ({ id, expected }) => {
        const result = parseHeightMinimum(id);
        expect(result.minInches).toBe(expected);
        expect(result.minCentimeters).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sets minCentimeters to the encoded value and minInches null for a cm id (R2.3)', () => {
    fc.assert(
      fc.property(cmIdArb, ({ id, expected }) => {
        const result = parseHeightMinimum(id);
        expect(result.minCentimeters).toBe(expected);
        expect(result.minInches).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sets both minInches and minCentimeters null when no numeric minimum is encoded (R2.4)', () => {
    fc.assert(
      fc.property(unparseableIdArb, (id) => {
        const result = parseHeightMinimum(id);
        expect(result.minInches).toBeNull();
        expect(result.minCentimeters).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never populates both units at once — at most one minimum is non-null', () => {
    fc.assert(
      fc.property(fc.oneof(inchesIdArb, cmIdArb, unparseableIdArb.map((id) => ({ id, expected: null }))), ({ id }) => {
        const result = parseHeightMinimum(id);
        expect(result.minInches === null || result.minCentimeters === null).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retains the original id and name on the Height_Requirement regardless of parse outcome', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          inchesIdArb.map(({ id }) => id),
          cmIdArb.map(({ id }) => id),
          unparseableIdArb,
        ),
        heightNameArb,
        (id, name) => {
          const result = extractHeightRequirement(docWithHeightId(id, name));
          expect(result).not.toBeNull();
          // The surrounding Height_Requirement always retains id and name...
          expect(result?.id).toBe(id);
          expect(result?.name).toBe(name);
          // ...and its numeric minimums equal the standalone parser's output.
          expect(result?.minInches).toBe(parseHeightMinimum(id).minInches);
          expect(result?.minCentimeters).toBe(parseHeightMinimum(id).minCentimeters);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('parseHeightMinimum — Property 4 fixed regression examples', () => {
  it('parses common inches encodings (R2.2)', () => {
    expect(parseHeightMinimum('40in')).toEqual({ minInches: 40, minCentimeters: null });
    expect(parseHeightMinimum('40-inches')).toEqual({ minInches: 40, minCentimeters: null });
    expect(parseHeightMinimum('height-40inch')).toEqual({ minInches: 40, minCentimeters: null });
    expect(parseHeightMinimum('40"')).toEqual({ minInches: 40, minCentimeters: null });
    expect(parseHeightMinimum('40.5in')).toEqual({ minInches: 40.5, minCentimeters: null });
  });

  it('parses common centimeters encodings (R2.3)', () => {
    expect(parseHeightMinimum('102cm')).toEqual({ minInches: null, minCentimeters: 102 });
    expect(parseHeightMinimum('102 cm')).toEqual({ minInches: null, minCentimeters: 102 });
    expect(parseHeightMinimum('102-centimeters')).toEqual({ minInches: null, minCentimeters: 102 });
  });

  it('yields both null for unparseable ids (R2.4)', () => {
    expect(parseHeightMinimum('anyHeight')).toEqual({ minInches: null, minCentimeters: null });
    expect(parseHeightMinimum('40kg')).toEqual({ minInches: null, minCentimeters: null });
    expect(parseHeightMinimum('')).toEqual({ minInches: null, minCentimeters: null });
    expect(parseHeightMinimum('noHeightRestriction')).toEqual({ minInches: null, minCentimeters: null });
  });
});

// Feature: experience-facet-enrichment, Property 5: Facet-view extraction preserves order, omits empties
/**
 * Property-based tests for `extractPhysicalConsiderations`,
 * `extractInterestFacets`, and the shared `deriveFacetViews` (design.md → "3.
 * Enrichment_Extractor"), the pure, total, deterministic views over a persisted
 * Grouped_Facets structure.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4
 *
 * Property 5 — Facet-view extraction preserves order, omits empties:
 *
 *   For any Facility_Document, `extractPhysicalConsiderations` returns exactly
 *   the `physicalConsiderations` group's Facet_Values in appearance order,
 *   empty when the group is absent/empty (R3.1, R3.2, R3.3); and
 *   `extractInterestFacets` returns a structure containing exactly those
 *   interest/targeting groups (`interests`, `thrillFactor`, `age`,
 *   `parkInterests`, `disneyFavorites`) that carry at least one facet, each
 *   with its `{id, name}` Facet_Values in appearance order, omitting empty
 *   groups (`{}` when none) (R4.1, R4.2, R4.3, R4.4). The same holds for
 *   `deriveFacetViews` applied to any persisted Grouped_Facets — the two
 *   entry points share one derivation, so they agree by construction.
 */

/** Non-persisted / unrelated group names that must never influence either view. */
const NON_PERSISTED_GROUPS = ['tags', 'cuisine', 'random', 'height'] as const;

/**
 * The candidate group keys the generator draws from: the physical-considerations
 * group, every interest/targeting group, and some unrelated groups so the
 * property proves both selection (interest groups) and exclusion (unrelated
 * groups) simultaneously.
 */
const CANDIDATE_GROUPS: readonly string[] = [
  'physicalConsiderations',
  ...INTEREST_FACET_GROUPS,
  ...NON_PERSISTED_GROUPS,
];

/**
 * A Grouped_Facets map over a random subset of {@link CANDIDATE_GROUPS}. Each
 * selected group is assigned a facet-value list that may be empty (so the
 * property exercises the omit-empty-group rule) or non-empty (so it exercises
 * order preservation and selection).
 */
const groupedFacetsArb: fc.Arbitrary<Record<string, readonly { id: string; name: string }[]>> = fc
  .subarray([...CANDIDATE_GROUPS], { minLength: 0, maxLength: CANDIDATE_GROUPS.length })
  .chain((groups) =>
    fc
      .tuple(...groups.map(() => fc.array(facetValueArb, { minLength: 0, maxLength: 4 })))
      .map((valueLists) => {
        const map: Record<string, readonly { id: string; name: string }[]> = {};
        groups.forEach((group, i) => {
          map[group] = valueLists[i]!;
        });
        return map;
      }),
  );

/** Build a Facility_Document carrying the given Grouped_Facets structure. */
function docWithGrouped(
  grouped: Record<string, readonly { id: string; name: string }[]>,
): FacilityDocument {
  return { id: '80010177;entityType=Attraction', groupedFacets: grouped } as FacilityDocument;
}

/** Reference: the Physical_Considerations list the extractor must produce (R3). */
function expectedPhysicalConsiderations(
  grouped: Record<string, readonly { id: string; name: string }[]>,
): readonly { id: string; name: string }[] {
  return grouped.physicalConsiderations ?? [];
}

/** Reference: the Interest_Facets structure the extractor must produce (R4). */
function expectedInterestFacets(
  grouped: Record<string, readonly { id: string; name: string }[]>,
): Record<string, readonly { id: string; name: string }[]> {
  const result: Record<string, readonly { id: string; name: string }[]> = {};
  for (const group of INTEREST_FACET_GROUPS) {
    const values = grouped[group];
    if (values !== undefined && values.length > 0) {
      result[group] = values;
    }
  }
  return result;
}

describe('extractPhysicalConsiderations / extractInterestFacets — Property 5: order preserved, empties omitted', () => {
  it('physicalConsiderations returns the group values in appearance order, empty when absent/empty (R3.1, R3.2, R3.3)', () => {
    fc.assert(
      fc.property(groupedFacetsArb, (grouped) => {
        const doc = docWithGrouped(grouped);
        // Exact values, in appearance order — id and name preserved (R3.1, R3.2).
        expect(extractPhysicalConsiderations(doc)).toEqual(expectedPhysicalConsiderations(grouped));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('physicalConsiderations is empty when no physicalConsiderations facet is present (R3.3)', () => {
    fc.assert(
      fc.property(
        groupedFacetsArb.map((grouped) => {
          const { physicalConsiderations: _omit, ...rest } = grouped;
          return rest;
        }),
        (grouped) => {
          expect(extractPhysicalConsiderations(docWithGrouped(grouped))).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('interestFacets contains exactly the non-empty interest groups, in appearance order (R4.1, R4.2, R4.3)', () => {
    fc.assert(
      fc.property(groupedFacetsArb, (grouped) => {
        const doc = docWithGrouped(grouped);
        const result = extractInterestFacets(doc);

        // Exactly the interest groups that carry at least one facet, each with
        // its values in appearance order; empty and unrelated groups omitted.
        expect(result).toEqual(expectedInterestFacets(grouped));

        // Every key is an interest/targeting group (never physicalConsiderations
        // or an unrelated group), and every included group is non-empty (R4.3).
        for (const [group, values] of Object.entries(result)) {
          expect(INTEREST_FACET_GROUPS).toContain(group);
          expect(values.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('interestFacets is empty when no interest group carries a facet (R4.4)', () => {
    fc.assert(
      fc.property(
        // Only physicalConsiderations and unrelated groups; every interest group
        // is either absent or explicitly empty.
        fc
          .tuple(
            fc.array(facetValueArb, { minLength: 0, maxLength: 4 }),
            fc.subarray([...INTEREST_FACET_GROUPS], { minLength: 0, maxLength: INTEREST_FACET_GROUPS.length }),
          )
          .map(([physical, emptyInterestGroups]) => {
            const map: Record<string, readonly { id: string; name: string }[]> = {
              physicalConsiderations: physical,
            };
            for (const group of emptyInterestGroups) {
              map[group] = [];
            }
            return map;
          }),
        (grouped) => {
          expect(extractInterestFacets(docWithGrouped(grouped))).toEqual({});
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveFacetViews agrees with the document-level extractors for any persisted Grouped_Facets', () => {
    fc.assert(
      fc.property(groupedFacetsArb, (grouped) => {
        const derived = deriveFacetViews(grouped);
        const doc = docWithGrouped(grouped);

        // The two entry points share one derivation, so they must agree, and
        // both must equal the independent reference (R3, R4).
        expect(derived.physicalConsiderations).toEqual(expectedPhysicalConsiderations(grouped));
        expect(derived.interestFacets).toEqual(expectedInterestFacets(grouped));
        expect(extractPhysicalConsiderations(doc)).toEqual(derived.physicalConsiderations);
        expect(extractInterestFacets(doc)).toEqual(derived.interestFacets);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated Grouped_Facets', () => {
    fc.assert(
      fc.property(groupedFacetsArb, (grouped) => {
        const doc = docWithGrouped(grouped);
        expect(() => {
          extractPhysicalConsiderations(doc);
          extractInterestFacets(doc);
          deriveFacetViews(grouped);
        }).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 5 fixed regression examples', () => {
  it('preserves physicalConsiderations order and derives interest views, omitting empties', () => {
    const grouped = {
      physicalConsiderations: [
        { id: 'expectant-mothers', name: 'Expectant Mothers Advisory' },
        { id: 'motion-sensitivity', name: 'Motion Sensitivity' },
      ],
      interests: [{ id: 'thrill-rides', name: 'Thrill Rides' }],
      thrillFactor: [{ id: 'big-drops', name: 'Big Drops' }],
      age: [],
      tags: [{ id: 'unrelated', name: 'Unrelated' }],
    };
    const doc = docWithGrouped(grouped);

    expect(extractPhysicalConsiderations(doc)).toEqual([
      { id: 'expectant-mothers', name: 'Expectant Mothers Advisory' },
      { id: 'motion-sensitivity', name: 'Motion Sensitivity' },
    ]);
    expect(extractInterestFacets(doc)).toEqual({
      interests: [{ id: 'thrill-rides', name: 'Thrill Rides' }],
      thrillFactor: [{ id: 'big-drops', name: 'Big Drops' }],
    });
  });

  it('yields empty views when no relevant facets are present', () => {
    const doc = docWithGrouped({ tags: [{ id: 'x', name: 'X' }] });
    expect(extractPhysicalConsiderations(doc)).toEqual([]);
    expect(extractInterestFacets(doc)).toEqual({});
  });

  it('yields empty views for a document with no Grouped_Facets at all', () => {
    const doc: FacilityDocument = { id: '1;entityType=Attraction' } as FacilityDocument;
    expect(extractPhysicalConsiderations(doc)).toEqual([]);
    expect(extractInterestFacets(doc)).toEqual({});
  });
});

// Feature: experience-facet-enrichment, Property 6: Why_This normalization maps present fields and nulls/empties absent ones
/**
 * Property-based tests for `extractWhyThis` (design.md → "3.
 * Enrichment_Extractor"), the pure, total, deterministic normalizer that
 * projects the structured Why_This marketing copy out of a Facility_Document.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * Property 6 — Why_This normalization maps present fields and nulls/empties
 * absent ones:
 *
 *   For any Facility_Document, `extractWhyThis` returns `null` when no `whyThis`
 *   object is present; otherwise it returns a value whose `title` is the source
 *   title or `null` when omitted, and whose `bullets` and `quotes` equal the
 *   source lists in order (each an empty list when omitted).
 */

/** The tolerant `whyThis` source shape carried on a Facility_Document. */
interface WhyThisSource {
  readonly title?: string;
  readonly bullets?: readonly string[];
  readonly quotes?: readonly string[];
}

/**
 * A `whyThis` object with any subset of `title`/`bullets`/`quotes` present, so
 * the property covers the full present/omitted space for every field. Lists may
 * be empty or carry several strings so order preservation is exercised.
 */
const whyThisSourceArb: fc.Arbitrary<WhyThisSource> = fc.record(
  {
    title: fc.string(),
    bullets: fc.array(fc.string(), { maxLength: 5 }),
    quotes: fc.array(fc.string(), { maxLength: 5 }),
  },
  { requiredKeys: [] },
);

/** Build a Facility_Document with the given `whyThis` object (present branch). */
function docWithWhyThis(whyThis: WhyThisSource): FacilityDocument {
  return { id: '80010177;entityType=Attraction', whyThis } as FacilityDocument;
}

describe('extractWhyThis — Property 6: present fields mapped, absent nulled/emptied', () => {
  it('returns null when no whyThis object is present (R5.5)', () => {
    fc.assert(
      fc.property(
        // A document carrying arbitrary unrelated fields but never a `whyThis`.
        fc.record(
          { subType: fc.option(fc.string(), { nil: undefined }) },
          { requiredKeys: [] },
        ),
        (extra) => {
          const doc = { id: '1;entityType=Attraction', ...extra } as FacilityDocument;
          expect(extractWhyThis(doc)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps present fields and nulls/empties absent ones, preserving list order (R5.1, R5.2, R5.3, R5.4)', () => {
    fc.assert(
      fc.property(whyThisSourceArb, (whyThis) => {
        const result = extractWhyThis(docWithWhyThis(whyThis));

        // A whyThis object is present, so a value is always produced.
        expect(result).not.toBeNull();

        // Title is the source title, or null when omitted (R5.3).
        expect(result?.title).toBe(whyThis.title ?? null);

        // Bullets and quotes equal the source lists in order, each empty when
        // omitted (R5.1, R5.2, R5.4).
        expect(result?.bullets).toEqual(whyThis.bullets ?? []);
        expect(result?.quotes).toEqual(whyThis.quotes ?? []);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated whyThis object', () => {
    fc.assert(
      fc.property(whyThisSourceArb, (whyThis) => {
        expect(() => extractWhyThis(docWithWhyThis(whyThis))).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 6 fixed regression examples', () => {
  it('returns null when the document carries no whyThis (R5.5)', () => {
    const doc: FacilityDocument = { id: '1;entityType=Attraction' } as FacilityDocument;
    expect(extractWhyThis(doc)).toBeNull();
  });

  it('maps a fully-populated whyThis, preserving order (R5.1, R5.2, R5.3, R5.4)', () => {
    const doc = docWithWhyThis({
      title: 'Why visit',
      bullets: ['Thrilling drops', 'Great for families'],
      quotes: ['"Best ride ever" — a guest', '"Loved it"'],
    });
    expect(extractWhyThis(doc)).toEqual({
      title: 'Why visit',
      bullets: ['Thrilling drops', 'Great for families'],
      quotes: ['"Best ride ever" — a guest', '"Loved it"'],
    });
  });

  it('nulls an omitted title and empties omitted lists (R5.1, R5.2, R5.3, R5.4)', () => {
    expect(extractWhyThis(docWithWhyThis({ bullets: ['Only a bullet'] }))).toEqual({
      title: null,
      bullets: ['Only a bullet'],
      quotes: [],
    });
    expect(extractWhyThis(docWithWhyThis({ title: 'Only a title' }))).toEqual({
      title: 'Only a title',
      bullets: [],
      quotes: [],
    });
    expect(extractWhyThis(docWithWhyThis({}))).toEqual({
      title: null,
      bullets: [],
      quotes: [],
    });
  });
});

// Feature: experience-facet-enrichment, Property 7: Facility_SubType is the non-empty trimmed value or null
/**
 * Property-based tests for `extractSubType` (design.md → "3.
 * Enrichment_Extractor"), the pure, total, deterministic helper that projects
 * the optional finer classification `subType` out of a Facility_Document.
 *
 * Validates: Requirements 6.1, 6.2
 *
 * Property 7 — Facility_SubType is the non-empty trimmed value or null:
 *
 *   For any Facility_Document, `extractSubType` returns the trimmed `subType`
 *   when it is present and not whitespace-only (R6.1), and `null` when
 *   `subType` is omitted or whitespace-only (R6.2).
 */

/** The whitespace characters the trimming rule treats as blank. */
const WHITESPACE_CHARS = [' ', '\t', '\n', '\r', '\f', '\v'] as const;

/** A run of one or more whitespace characters (never empty). */
const whitespaceRunArb = fc
  .array(fc.constantFrom(...WHITESPACE_CHARS), { minLength: 1, maxLength: 5 })
  .map((chars) => chars.join(''));

/** Optional leading/trailing whitespace padding (may be empty). */
const paddingArb = fc
  .array(fc.constantFrom(...WHITESPACE_CHARS), { minLength: 0, maxLength: 5 })
  .map((chars) => chars.join(''));

/**
 * A non-whitespace-only `subType` core: a string whose trimmed form is
 * non-empty. Generated by taking an arbitrary string, ensuring it carries at
 * least one non-whitespace character, so `trim()` yields a non-empty value.
 */
const nonBlankCoreArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

/** Build a Facility_Document carrying the given `subType` value. */
function docWithSubType(subType: string): FacilityDocument {
  return { id: '80010177;entityType=Attraction', subType } as FacilityDocument;
}

describe('extractSubType — Property 7: non-empty trimmed value or null', () => {
  it('returns the trimmed subType when present and not whitespace-only (R6.1)', () => {
    fc.assert(
      fc.property(paddingArb, nonBlankCoreArb, paddingArb, (lead, core, trail) => {
        const raw = `${lead}${core}${trail}`;
        const result = extractSubType(docWithSubType(raw));

        // The result is the trimmed value: non-null, equal to raw.trim(), and
        // itself carrying no surrounding whitespace.
        expect(result).toBe(raw.trim());
        expect(result).not.toBeNull();
        expect(result).toBe(result?.trim());
        expect((result as string).length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when subType is whitespace-only (R6.2)', () => {
    fc.assert(
      fc.property(whitespaceRunArb, (blank) => {
        expect(extractSubType(docWithSubType(blank))).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null when subType is an empty string (R6.2)', () => {
    expect(extractSubType(docWithSubType(''))).toBeNull();
  });

  it('returns null when subType is omitted (R6.2)', () => {
    fc.assert(
      fc.property(
        // A document carrying arbitrary unrelated fields but never a `subType`.
        fc.record(
          { latitude: fc.option(coordArb, { nil: undefined }) },
          { requiredKeys: [] },
        ),
        (extra) => {
          const doc = { id: '1;entityType=Attraction', ...extra } as FacilityDocument;
          expect(extractSubType(doc)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated subType', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), whitespaceRunArb, nonBlankCoreArb),
        (subType) => {
          expect(() => extractSubType(docWithSubType(subType))).not.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 7 fixed regression examples', () => {
  it('returns the trimmed value for a padded non-empty subType (R6.1)', () => {
    expect(extractSubType(docWithSubType('Table Service'))).toBe('Table Service');
    expect(extractSubType(docWithSubType('  Quick Service  '))).toBe('Quick Service');
    expect(extractSubType(docWithSubType('\tSignature Dining\n'))).toBe('Signature Dining');
  });

  it('returns null for an omitted, empty, or whitespace-only subType (R6.2)', () => {
    const bare: FacilityDocument = { id: '1;entityType=Attraction' } as FacilityDocument;
    expect(extractSubType(bare)).toBeNull();
    expect(extractSubType(docWithSubType(''))).toBeNull();
    expect(extractSubType(docWithSubType('   '))).toBeNull();
    expect(extractSubType(docWithSubType('\t\n  \r'))).toBeNull();
  });
});
