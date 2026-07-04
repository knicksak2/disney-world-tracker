// Feature: experience-facet-enrichment, Property 1: Facet_Normalization retains persisted groups faithfully
/**
 * Property-based tests for Facet_Normalization (design.md → "2. Facet_Normalization
 * — disney/facilityDoc.ts"), exercised through the public `adaptFacilityDocument`
 * entry point. When a raw stored document carries an array-shaped `facets`
 * field, `adaptFacilityDocument` synthesizes the `groupedFacets` structure via
 * the internal `buildGroupedFacets` pass.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 *
 * Property 1 — Facet_Normalization retains persisted groups faithfully:
 *
 *   For any raw `facets` array, `buildFacets` (via `adaptFacilityDocument`)
 *   produces a Grouped_Facets structure in which every entry whose `group` is
 *   one of the Persisted_Facet_Groups and whose `id` and `name` are both
 *   strings appears exactly once as a `{id, name}` Facet_Value under its group,
 *   in original appearance order (R1.1, R1.2, R1.3); and no entry whose group
 *   is not a Persisted_Facet_Group (R1.4), and no entry missing `group`/`id`/
 *   `name` (R1.5), appears anywhere in the structure.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FacetValueDTO, GroupedFacetsDTO } from '@dwt/shared';

import {
  adaptFacilityDocument,
  PERSISTED_FACET_GROUPS,
  type FacilityDocument,
} from '../facilityDoc.js';

const NUM_RUNS = 100;

/** The captured groups, as an array for generator use. */
const PERSISTED_GROUPS: readonly string[] = [...PERSISTED_FACET_GROUPS];

/**
 * Group tokens that are deliberately NOT Persisted_Facet_Groups (R1.4). These
 * include the collapsed-facet groups the flat `buildFacets` reads
 * (`priceRangeDining`, accessibility groups) plus an arbitrary extra token, so
 * the property proves non-persisted groups are excluded from Grouped_Facets.
 */
const NON_PERSISTED_GROUPS: readonly string[] = [
  'priceRangeDining',
  'mobilityDisabilities',
  'accessibility',
  'hearingDisabilities',
  'visualDisabilities',
  'serviceAnimals',
  'somethingUnknown',
];

const persistedGroupArb = fc.constantFrom(...PERSISTED_GROUPS);
const nonPersistedGroupArb = fc.constantFrom(...NON_PERSISTED_GROUPS);

/** A `group` field: a persisted group, a non-persisted group, or a non-string. */
const groupFieldArb = fc.oneof(
  { weight: 5, arbitrary: persistedGroupArb },
  { weight: 2, arbitrary: nonPersistedGroupArb },
  { weight: 1, arbitrary: fc.integer() },
);

/** An `id`/`name` field: mostly a string, occasionally a non-string. */
const stringOrNonStringArb = fc.oneof(
  { weight: 5, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.integer() },
);

/**
 * A single raw facet object. `requiredKeys: []` lets any of `group`/`id`/`name`
 * be omitted entirely, exercising the missing-field exclusion rule (R1.5)
 * alongside the non-string-value branch.
 */
const facetObjectArb = fc.record(
  {
    group: groupFieldArb,
    id: stringOrNonStringArb,
    name: stringOrNonStringArb,
  },
  { requiredKeys: [] },
);

/**
 * A raw `facets` array entry. Mostly facet objects, but occasionally a
 * non-object (null / number / string) so the property covers the tolerant
 * `typeof entry !== 'object'` skip branch.
 */
const facetEntryArb = fc.oneof(
  { weight: 8, arbitrary: facetObjectArb },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.constant('not-an-object') },
);

const rawFacetsArb = fc.array(facetEntryArb, { maxLength: 16 });

/**
 * Reference derivation straight from the acceptance criteria: keep only entries
 * that are objects (R1.5 tolerance), whose `group` is a Persisted_Facet_Group
 * (R1.1, R1.4) and whose `id` and `name` are both strings (R1.5), preserving
 * `id`+`name` (R1.2) and appearance order (R1.3).
 */
function expectedGroupedFacets(rawFacets: readonly unknown[]): GroupedFacetsDTO {
  const grouped: Record<string, FacetValueDTO[]> = {};
  for (const entry of rawFacets) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { group, id, name } = entry as Record<string, unknown>;
    if (
      typeof group !== 'string' ||
      typeof id !== 'string' ||
      typeof name !== 'string'
    ) {
      continue;
    }
    if (!PERSISTED_FACET_GROUPS.has(group)) {
      continue;
    }
    (grouped[group] ??= []).push({ id, name });
  }
  return grouped;
}

/** Build a raw stored document carrying an array-shaped `facets` field. */
function docWithFacets(rawFacets: readonly unknown[]): Record<string, unknown> {
  return { id: '80010177;entityType=Facility', facets: rawFacets };
}

describe('adaptFacilityDocument — Property 1: retains persisted facet groups faithfully', () => {
  it('produces exactly the persisted-group Facet_Values in appearance order (R1.1–R1.5)', () => {
    fc.assert(
      fc.property(rawFacetsArb, (rawFacets) => {
        const doc = adaptFacilityDocument(docWithFacets(rawFacets));
        expect(doc.groupedFacets).toEqual(expectedGroupedFacets(rawFacets));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every group key is a Persisted_Facet_Group and every value is a {id,name} string pair (R1.2, R1.4)', () => {
    fc.assert(
      fc.property(rawFacetsArb, (rawFacets) => {
        const grouped = adaptFacilityDocument(docWithFacets(rawFacets)).groupedFacets ?? {};
        for (const [group, values] of Object.entries(grouped)) {
          expect(PERSISTED_FACET_GROUPS.has(group)).toBe(true);
          for (const value of values) {
            expect(Object.keys(value).sort()).toEqual(['id', 'name']);
            expect(typeof value.id).toBe('string');
            expect(typeof value.name).toBe('string');
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retains each qualifying facet exactly once (count preserved per group) (R1.1, R1.3)', () => {
    fc.assert(
      fc.property(rawFacetsArb, (rawFacets) => {
        const grouped = adaptFacilityDocument(docWithFacets(rawFacets)).groupedFacets ?? {};
        const expected = expectedGroupedFacets(rawFacets);
        for (const group of PERSISTED_GROUPS) {
          expect((grouped[group] ?? []).length).toBe((expected[group] ?? []).length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws for any generated facets array', () => {
    fc.assert(
      fc.property(rawFacetsArb, (rawFacets) => {
        expect(() => adaptFacilityDocument(docWithFacets(rawFacets))).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('adaptFacilityDocument — Property 1 fixed regression examples', () => {
  it('keeps persisted groups in order, preserving id and name (R1.1, R1.2, R1.3)', () => {
    const rawFacets = [
      { group: 'height', id: 'h-40in', name: '40in (102cm) or taller' },
      { group: 'physicalConsiderations', id: 'pc-expectant', name: 'Expectant Mothers' },
      { group: 'interests', id: 'int-thrill', name: 'Thrill Rides' },
      { group: 'interests', id: 'int-classic', name: 'Classic Attractions' },
    ];
    const grouped = adaptFacilityDocument(docWithFacets(rawFacets)).groupedFacets;
    expect(grouped).toEqual({
      height: [{ id: 'h-40in', name: '40in (102cm) or taller' }],
      physicalConsiderations: [{ id: 'pc-expectant', name: 'Expectant Mothers' }],
      interests: [
        { id: 'int-thrill', name: 'Thrill Rides' },
        { id: 'int-classic', name: 'Classic Attractions' },
      ],
    });
  });

  it('excludes non-persisted groups and entries missing group/id/name (R1.4, R1.5)', () => {
    const rawFacets = [
      { group: 'priceRangeDining', id: '$$', name: 'Moderate' }, // non-persisted → excluded
      { group: 'age', id: 'age-all', name: 'All Ages' }, // persisted → kept
      { group: 'age', id: 'age-missing-name' }, // missing name → excluded
      { id: 'no-group', name: 'No Group' }, // missing group → excluded
      { group: 'thrillFactor', name: 'No Id' }, // missing id → excluded
      { group: 'height', id: 123, name: 'Non-string id' }, // non-string id → excluded
    ];
    const grouped = adaptFacilityDocument(docWithFacets(rawFacets)).groupedFacets;
    expect(grouped).toEqual({
      age: [{ id: 'age-all', name: 'All Ages' }],
    });
  });

  it('produces an empty structure when nothing qualifies', () => {
    const rawFacets = [
      { group: 'priceRangeDining', id: '$', name: 'Low' },
      null,
      42,
      'nope',
      { group: 'accessibility', id: 'wheelchair', name: 'Wheelchair' },
    ];
    const grouped = adaptFacilityDocument(docWithFacets(rawFacets)).groupedFacets;
    expect(grouped).toEqual({});
  });
});

// Feature: experience-facet-enrichment, Property 2: Facet_Normalization preserves the existing flat outputs
/**
 * Property 2 — Facet_Normalization preserves the existing flat outputs:
 *
 *   For any raw `facets` array, the flat `accessibility`, `priceRangeDining`,
 *   and `interests` lists produced by the extended `buildFacets` (exercised via
 *   `adaptFacilityDocument`, surfacing on the returned doc's `facets` object)
 *   are identical to those produced by the pre-change collapse rule for the
 *   same input (R1.6).
 *
 * The reference implementation below encodes the pre-change collapse rule
 * verbatim: it collapses the raw `facets` array down to the three flat id
 * lists, mapping the accessibility Facet_Groups (`mobilityDisabilities`,
 * `accessibility`, `hearingDisabilities`, `visualDisabilities`,
 * `serviceAnimals`) into `accessibility`, `priceRangeDining` into
 * `priceRangeDining`, and `interests` into `interests`, keying only off the
 * `group`/`id` strings (the pre-change rule never inspected `name`).
 *
 * Validates: Requirements 1.6
 */

/**
 * The accessibility Facet_Group tokens the pre-change collapse rule folds into
 * the flat `accessibility` list (mirrors the internal `ACCESSIBILITY_GROUPS`
 * set in facilityDoc.ts, kept local so the reference rule is self-contained).
 */
const ACCESSIBILITY_GROUP_TOKENS: readonly string[] = [
  'mobilityDisabilities',
  'accessibility',
  'hearingDisabilities',
  'visualDisabilities',
  'serviceAnimals',
];
const ACCESSIBILITY_GROUP_SET: ReadonlySet<string> = new Set(ACCESSIBILITY_GROUP_TOKENS);

/**
 * Reference implementation of the pre-change collapse rule. Walks the raw
 * `facets` array once, pushing each entry's `id` into the flat list its `group`
 * maps to, considering only entries that are objects with string `group` and
 * string `id`, and returns the collapsed `facets` object (or `undefined` when
 * no flat list has any members) exactly as the original `buildFacets` did.
 */
function expectedFlatFacets(
  rawFacets: readonly unknown[],
): FacilityDocument['facets'] {
  const accessibility: string[] = [];
  const priceRangeDining: string[] = [];
  const interests: string[] = [];
  for (const entry of rawFacets) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const group = (entry as { group?: unknown }).group;
    const id = (entry as { id?: unknown }).id;
    if (typeof group !== 'string' || typeof id !== 'string') {
      continue;
    }
    if (ACCESSIBILITY_GROUP_SET.has(group)) {
      accessibility.push(id);
    } else if (group === 'priceRangeDining') {
      priceRangeDining.push(id);
    } else if (group === 'interests') {
      interests.push(id);
    }
  }
  const facets: {
    accessibility?: readonly string[];
    priceRangeDining?: readonly string[];
    interests?: readonly string[];
  } = {};
  if (accessibility.length > 0) facets.accessibility = accessibility;
  if (priceRangeDining.length > 0) facets.priceRangeDining = priceRangeDining;
  if (interests.length > 0) facets.interests = interests;
  return Object.keys(facets).length > 0 ? facets : undefined;
}

/**
 * Group tokens that feed the flat outputs, so the property gets dense coverage
 * of the accessibility-collapse, price-range, and interests branches (the
 * `interests` group also being a Persisted_Facet_Group exercises the shared
 * single-pass path).
 */
const FLAT_GROUP_TOKENS: readonly string[] = [
  ...ACCESSIBILITY_GROUP_TOKENS,
  'priceRangeDining',
  'interests',
];

/** A `group` field weighted toward the flat-output groups plus other tokens. */
const flatGroupFieldArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...FLAT_GROUP_TOKENS) },
  { weight: 2, arbitrary: fc.constantFrom(...PERSISTED_GROUPS) },
  { weight: 1, arbitrary: fc.constantFrom('somethingUnknown', 'thrillFactor') },
  { weight: 1, arbitrary: fc.integer() },
);

/**
 * A single raw facet object for the flat-output property. `requiredKeys: []`
 * lets `group`/`id`/`name` be omitted so the property also covers the
 * pre-change rule's tolerance of missing/non-string fields.
 */
const flatFacetObjectArb = fc.record(
  {
    group: flatGroupFieldArb,
    id: stringOrNonStringArb,
    name: stringOrNonStringArb,
  },
  { requiredKeys: [] },
);

const flatFacetEntryArb = fc.oneof(
  { weight: 8, arbitrary: flatFacetObjectArb },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.constant('not-an-object') },
);

const flatRawFacetsArb = fc.array(flatFacetEntryArb, { maxLength: 16 });

describe('adaptFacilityDocument — Property 2: preserves the existing flat outputs', () => {
  it('produces flat accessibility/priceRangeDining/interests identical to the pre-change collapse rule (R1.6)', () => {
    fc.assert(
      fc.property(flatRawFacetsArb, (rawFacets) => {
        const doc = adaptFacilityDocument(docWithFacets(rawFacets));
        expect(doc.facets).toEqual(expectedFlatFacets(rawFacets));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws while producing the flat outputs', () => {
    fc.assert(
      fc.property(flatRawFacetsArb, (rawFacets) => {
        expect(() => adaptFacilityDocument(docWithFacets(rawFacets)).facets).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('adaptFacilityDocument — Property 2 fixed regression examples', () => {
  it('collapses accessibility groups, priceRangeDining, and interests to flat id lists (R1.6)', () => {
    const rawFacets = [
      { group: 'mobilityDisabilities', id: 'wheelchair-access', name: 'Wheelchair Accessible' },
      { group: 'serviceAnimals', id: 'service-animals', name: 'Service Animals' },
      { group: 'priceRangeDining', id: '$$', name: 'Moderate' },
      { group: 'interests', id: 'thrill', name: 'Thrill Rides' },
      { group: 'height', id: 'h-40in', name: '40in or taller' }, // persisted but not flat
    ];
    const facets = adaptFacilityDocument(docWithFacets(rawFacets)).facets;
    expect(facets).toEqual({
      accessibility: ['wheelchair-access', 'service-animals'],
      priceRangeDining: ['$$'],
      interests: ['thrill'],
    });
  });

  it('omits the facets object entirely when no flat group qualifies', () => {
    const rawFacets = [
      { group: 'height', id: 'h-40in', name: '40in or taller' },
      { group: 'age', id: 'age-all', name: 'All Ages' },
      { group: 'priceRangeDining', name: 'Missing Id' }, // non-string id → skipped
      null,
      99,
    ];
    const facets = adaptFacilityDocument(docWithFacets(rawFacets)).facets;
    expect(facets).toBeUndefined();
  });
});
