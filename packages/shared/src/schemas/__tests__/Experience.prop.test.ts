// Feature: experience-facet-enrichment, Property 9: Experience schema accepts valid payloads and rejects malformed ones
/**
 * Property-based tests for the shared `experienceSchema`'s handling of the six
 * new Disney-sourced enrichment fields (`heightRequirement`, `groupedFacets`,
 * `physicalConsiderations`, `interestFacets`, `whyThis`, `subType`).
 *
 * Property 9 (design.md → Correctness Properties):
 *
 *   For any Experience_DTO carrying the new enrichment fields with valid
 *   values, and for any Experience_DTO omitting them, `experienceSchema`
 *   accepts the payload; and for any payload carrying a new enrichment field
 *   whose value violates its declared shape, `experienceSchema` rejects the
 *   payload.
 *
 * The schema is `.strict()`, so the malformed cases exercise both wrong value
 * types and unexpected extra keys inside the strict nested objects.
 *
 * Validates: Requirements 9.2, 9.3, 9.4
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { experienceSchema } from '../Experience.js';
import { EXPERIENCE_CATEGORIES, PARKS } from '../../enums.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Valid generators
// ---------------------------------------------------------------------------

/** A minimal, valid ExperienceDTO base without any enrichment field. */
const baseArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  description: fc.string({ maxLength: 100 }),
  active: fc.boolean(),
});

/** A finite number, since `z.number()` rejects NaN / ±Infinity. */
const finiteNumberArb = fc.double({ noNaN: true, noDefaultInfinity: true });

/** A valid `{id, name}` facet value. */
const facetValueArb = fc.record({ id: fc.string(), name: fc.string() });

/** A valid grouped-facets structure: group name → list of facet values. */
const groupedFacetsArb = fc.dictionary(
  fc.string({ maxLength: 20 }),
  fc.array(facetValueArb, { maxLength: 4 }),
  { maxKeys: 4 },
);

/** A valid height requirement (both minimums may be null). */
const heightRequirementArb = fc.record({
  id: fc.string(),
  name: fc.string(),
  minInches: fc.option(finiteNumberArb, { nil: null }),
  minCentimeters: fc.option(finiteNumberArb, { nil: null }),
});

/** A valid why-this block. */
const whyThisArb = fc.record({
  title: fc.option(fc.string(), { nil: null }),
  bullets: fc.array(fc.string(), { maxLength: 4 }),
  quotes: fc.array(fc.string(), { maxLength: 4 }),
});

/** All six enrichment fields with valid values. */
const validEnrichmentArb = fc.record({
  heightRequirement: fc.option(heightRequirementArb, { nil: null }),
  groupedFacets: groupedFacetsArb,
  physicalConsiderations: fc.array(facetValueArb, { maxLength: 4 }),
  interestFacets: groupedFacetsArb,
  whyThis: fc.option(whyThisArb, { nil: null }),
  subType: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
});

// ---------------------------------------------------------------------------
// Malformed injection generator — each produces a single enrichment field
// whose value violates the field's declared shape.
// ---------------------------------------------------------------------------

const malformedInjectionArb = fc.oneof(
  // heightRequirement: minInches must be number|null.
  fc
    .record({
      id: fc.string(),
      name: fc.string(),
      minInches: fc.oneof(fc.string(), fc.boolean()),
      minCentimeters: fc.constant(null),
    })
    .map((v) => ({ heightRequirement: v })),
  // heightRequirement: strict object rejects an unknown key.
  fc
    .record({
      id: fc.string(),
      name: fc.string(),
      minInches: fc.constant(null),
      minCentimeters: fc.constant(null),
      surprise: fc.integer(),
    })
    .map((v) => ({ heightRequirement: v })),
  // heightRequirement: id must be a string.
  fc
    .record({
      id: fc.integer(),
      name: fc.string(),
      minInches: fc.constant(null),
      minCentimeters: fc.constant(null),
    })
    .map((v) => ({ heightRequirement: v })),
  // groupedFacets: a facet value must not carry extra keys (strict).
  fc
    .record({ id: fc.string(), name: fc.string(), extra: fc.boolean() })
    .map((fv) => ({ groupedFacets: { group: [fv] } })),
  // groupedFacets: a facet value's id must be a string.
  fc
    .record({ id: fc.integer(), name: fc.string() })
    .map((fv) => ({ groupedFacets: { group: [fv] } })),
  // groupedFacets: each group value must be an array.
  fc.string().map((s) => ({ groupedFacets: { group: s } })),
  // physicalConsiderations: each element must be a full facet value.
  fc
    .record({ id: fc.string() })
    .map((fv) => ({ physicalConsiderations: [fv] })),
  // physicalConsiderations: must be an array.
  fc.string().map((s) => ({ physicalConsiderations: s })),
  // interestFacets: a facet value's name is required.
  fc
    .record({ id: fc.string() })
    .map((fv) => ({ interestFacets: { group: [fv] } })),
  // whyThis: title must be string|null.
  fc
    .record({
      title: fc.oneof(fc.integer(), fc.boolean()),
      bullets: fc.constant([]),
      quotes: fc.constant([]),
    })
    .map((v) => ({ whyThis: v })),
  // whyThis: bullets must be a string array.
  fc
    .array(fc.integer(), { minLength: 1, maxLength: 3 })
    .map((bullets) => ({ whyThis: { title: null, bullets, quotes: [] } })),
  // whyThis: strict object rejects an unknown key.
  fc
    .record({
      title: fc.constant(null),
      bullets: fc.constant([]),
      quotes: fc.constant([]),
      surprise: fc.integer(),
    })
    .map((v) => ({ whyThis: v })),
  // subType: must be a string.
  fc.oneof(fc.integer(), fc.boolean()).map((v) => ({ subType: v })),
  // subType: must not exceed 200 characters.
  fc
    .string({ minLength: 201, maxLength: 260 })
    .map((s) => ({ subType: s })),
);

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Property 9: Experience schema accepts valid payloads and rejects malformed ones', () => {
  it('accepts a payload carrying every enrichment field with valid values (R9.2)', () => {
    fc.assert(
      fc.property(baseArb, validEnrichmentArb, (base, enrichment) => {
        const result = experienceSchema.safeParse({ ...base, ...enrichment });
        expect(result.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts a payload omitting all enrichment fields (R9.3)', () => {
    fc.assert(
      fc.property(baseArb, (base) => {
        const result = experienceSchema.safeParse(base);
        expect(result.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts a payload carrying an arbitrary subset of enrichment fields (R9.2, R9.3)', () => {
    // Independently decide, per field, whether to include its valid value.
    const subsetArb = fc.record(
      {
        heightRequirement: heightRequirementArb,
        groupedFacets: groupedFacetsArb,
        physicalConsiderations: fc.array(facetValueArb, { maxLength: 4 }),
        interestFacets: groupedFacetsArb,
        whyThis: whyThisArb,
        subType: fc.string({ maxLength: 200 }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(baseArb, subsetArb, (base, subset) => {
        const result = experienceSchema.safeParse({ ...base, ...subset });
        expect(result.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a payload whose enrichment field violates its declared shape (R9.4)', () => {
    fc.assert(
      fc.property(baseArb, malformedInjectionArb, (base, malformed) => {
        const result = experienceSchema.safeParse({ ...base, ...malformed });
        expect(result.success).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
