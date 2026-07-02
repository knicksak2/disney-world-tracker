// Feature: disney-world-tracker, Property 3: produced Experiences satisfy name/park/category/description constraints
/**
 * Property-based tests for Experience field constraints (R1.8).
 *
 * Validates: Requirements 1.8
 *
 * Property 3 (design.md → Correctness Properties):
 *
 *   For any upstream entity set processed into Experiences, every
 *   produced Experience has a name of length 1..200, a Park value in the
 *   Park enum, an Experience_Category value in the Experience_Category
 *   enum, and a description of length 0..1000.
 *
 * The catalog pipeline that turns an upstream entity set into Experience
 * records is:
 *
 *   raw entity ──classify──► category
 *              ──parent walk──► park
 *              ──internalId──► id
 *              ──reconcile──► ReconcileUpsert (the Experience-shaped row
 *                              the caller writes to the cache)
 *
 * `reconcile` is the single point at which fully-classified upstream
 * entities become Experience-shaped rows, so it is the natural target for
 * this property: feed it constraint-respecting upstream input and assert
 * every produced upsert validates against the canonical
 * `experienceSchema` from `@dwt/shared` (which encodes the R1.8
 * constraints in code).
 *
 * The generators below intentionally drive each constraint to its bounds:
 *
 *   - `name` covers 1..200 characters (lower bound is 1; upper bound is
 *     exactly 200).
 *   - `description` covers 0..1000 characters (lower bound is 0 — empty
 *     strings are allowed by R1.8 and the schema).
 *   - `park` and `category` are drawn from the canonical enum tuples.
 *   - `id` is derived from an arbitrary upstream entity id via
 *     `internalId`, which produces a UUID v5; `experienceSchema` requires
 *     `id` to be a UUID, so this keeps the schema validation honest.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  experienceSchema,
} from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { reconcile } from '../reconcile.js';
import { internalId } from '../internalId.js';
import type {
  CatalogCacheRow,
  ReconcileUpsert,
  UpstreamExperience,
} from '../types.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// All generators are constrained so that the *input* upstream entity set
// already respects R1.8. The property under test is that the catalog
// pipeline (`reconcile` over `internalId`-derived ids) preserves those
// constraints all the way through to the produced Experience-shaped row.

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

/**
 * Name 1..200 chars (R1.8). `fast-check`'s `string` length is measured in
 * UTF-16 code units, which is the same unit `String.prototype.length` and
 * Zod's `.max(200)` use, so the generator and the schema agree on the
 * length count.
 */
const nameArb = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Description 0..1000 chars (R1.8). Empty descriptions are explicitly
 * allowed by the requirement and the schema.
 */
const descriptionArb = fc.string({ minLength: 0, maxLength: 1000 });

/** Arbitrary upstream entity id (the caller derives the internal id). */
const upstreamEntityIdArb = fc.string({ minLength: 1, maxLength: 64 });

/**
 * Fill the enrichment / area / imagery fields the Disney-sourced
 * `UpstreamExperience` now requires with their "not persisted" defaults. This
 * property targets only the R1.8 core-field constraints (name/park/category/
 * description), so the enrichment fields are held at neutral values and do not
 * affect the assertions.
 */
function withEnrichmentDefaults(base: {
  id: string;
  upstreamEntityId: string;
  name: string;
  park: Park;
  category: ExperienceCategory;
  description: string;
}): UpstreamExperience {
  return {
    ...base,
    land: null,
    resortArea: null,
    imageUrl: null,
    areaType: 'ThemePark',
    resortId: null,
    latitude: null,
    longitude: null,
    accessibility: [],
    priceTier: null,
    mealPeriods: [],
  };
}

/**
 * One fully-classified upstream Experience whose fields already satisfy
 * R1.8. The internal `id` is the deterministic UUID v5 of the upstream
 * entity id (R1.7), so the produced row has a UUID `id` for the schema to
 * validate.
 */
const upstreamExperienceArb: fc.Arbitrary<UpstreamExperience> = fc
  .record({
    upstreamEntityId: upstreamEntityIdArb,
    name: nameArb,
    park: parkArb,
    category: categoryArb,
    description: descriptionArb,
  })
  .map((r) =>
    withEnrichmentDefaults({
      id: internalId(r.upstreamEntityId),
      upstreamEntityId: r.upstreamEntityId,
      name: r.name,
      park: r.park,
      category: r.category,
      description: r.description,
    }),
  );

/**
 * An upstream entity set with distinct internal ids. Distinctness keeps
 * `reconcile`'s last-write-wins dedupe rule from collapsing entries before
 * the assertions can see them; it does not weaken the property because
 * R1.8 is a per-row constraint.
 */
const upstreamSetArb = fc.uniqueArray(upstreamExperienceArb, {
  minLength: 0,
  maxLength: 30,
  selector: (e: UpstreamExperience) => e.id,
});

/**
 * A cached row whose fields also satisfy R1.8. Used in the
 * "drift triggers an upsert" scenario so the assertion can confirm that
 * the upserted row still satisfies R1.8 after reconciliation. The cache
 * itself is not stored long-term; only the diff is asserted on.
 */
const cacheRowArb: fc.Arbitrary<CatalogCacheRow> = fc.record({
  id: upstreamEntityIdArb.map((s) => internalId(`cache-${s}`)),
  active: fc.boolean(),
  name: nameArb,
  park: parkArb,
  category: categoryArb,
  land: fc.constant<string | null>(null),
  areaType: fc.constant<'ThemePark'>('ThemePark'),
  resortId: fc.constant<string | null>(null),
  resortArea: fc.constant<string | null>(null),
});

/** Cache with distinct ids; same dedupe-avoidance reasoning as upstream. */
const cacheArb = fc.uniqueArray(cacheRowArb, {
  minLength: 0,
  maxLength: 15,
  selector: (r: CatalogCacheRow) => r.id,
});

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

/**
 * Strip `upstreamEntityId` from a `ReconcileUpsert` so the result has the
 * shape `experienceSchema` validates. The schema is `.strict()`, so any
 * extra field would itself be a violation; this projection is intentional.
 */
function toExperienceShape(u: ReconcileUpsert): {
  id: string;
  name: string;
  park: Park | null;
  category: ExperienceCategory;
  description: string;
  active: boolean;
} {
  return {
    id: u.id,
    name: u.name,
    park: u.park,
    category: u.category,
    description: u.description,
    active: u.active,
  };
}

describe('catalog — Property 3: produced Experiences satisfy field constraints (R1.8)', () => {
  it('every upsert from an empty cache validates against experienceSchema', () => {
    fc.assert(
      fc.property(upstreamSetArb, (upstream) => {
        const result = reconcile([], upstream);

        for (const upsert of result.upserts) {
          const parsed = experienceSchema.safeParse(toExperienceShape(upsert));
          expect(
            parsed.success,
            parsed.success
              ? ''
              : `upsert ${upsert.id} failed schema: ${JSON.stringify(parsed.error.issues)}`,
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every upsert from a non-empty cache (drift, reactivation, new ids) validates against experienceSchema', () => {
    fc.assert(
      fc.property(cacheArb, upstreamSetArb, (cache, upstream) => {
        const result = reconcile(cache, upstream);

        for (const upsert of result.upserts) {
          const parsed = experienceSchema.safeParse(toExperienceShape(upsert));
          expect(
            parsed.success,
            parsed.success
              ? ''
              : `upsert ${upsert.id} failed schema: ${JSON.stringify(parsed.error.issues)}`,
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produced Experience names are between 1 and 200 characters', () => {
    fc.assert(
      fc.property(upstreamSetArb, (upstream) => {
        const result = reconcile([], upstream);

        for (const upsert of result.upserts) {
          expect(upsert.name.length).toBeGreaterThanOrEqual(1);
          expect(upsert.name.length).toBeLessThanOrEqual(200);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produced Experience descriptions are between 0 and 1000 characters', () => {
    fc.assert(
      fc.property(upstreamSetArb, (upstream) => {
        const result = reconcile([], upstream);

        for (const upsert of result.upserts) {
          expect(upsert.description.length).toBeGreaterThanOrEqual(0);
          expect(upsert.description.length).toBeLessThanOrEqual(1000);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produced Experience park values lie within the Park enum', () => {
    fc.assert(
      fc.property(upstreamSetArb, (upstream) => {
        const result = reconcile([], upstream);

        for (const upsert of result.upserts) {
          expect(PARKS).toContain(upsert.park);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produced Experience category values lie within the ExperienceCategory enum', () => {
    fc.assert(
      fc.property(upstreamSetArb, (upstream) => {
        const result = reconcile([], upstream);

        for (const upsert of result.upserts) {
          expect(EXPERIENCE_CATEGORIES).toContain(upsert.category);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('catalog — Property 3: bound-driving fixed examples', () => {
  it('accepts the exact 200-character name upper bound', () => {
    const name = 'a'.repeat(200);
    const upstreamId = 'wdw:attraction:bound-200';
    const result = reconcile(
      [],
      [
        withEnrichmentDefaults({
          id: internalId(upstreamId),
          upstreamEntityId: upstreamId,
          name,
          park: 'Magic Kingdom',
          category: 'Ride',
          description: '',
        }),
      ],
    );
    expect(result.upserts).toHaveLength(1);
    const u = result.upserts[0];
    expect(u).toBeDefined();
    expect(experienceSchema.safeParse(toExperienceShape(u!)).success).toBe(true);
  });

  it('accepts the exact 1000-character description upper bound', () => {
    const description = 'd'.repeat(1000);
    const upstreamId = 'wdw:attraction:bound-1000';
    const result = reconcile(
      [],
      [
        withEnrichmentDefaults({
          id: internalId(upstreamId),
          upstreamEntityId: upstreamId,
          name: 'A Ride',
          park: 'EPCOT',
          category: 'Ride',
          description,
        }),
      ],
    );
    expect(result.upserts).toHaveLength(1);
    const u = result.upserts[0];
    expect(u).toBeDefined();
    expect(experienceSchema.safeParse(toExperienceShape(u!)).success).toBe(true);
  });

  it('accepts the empty description lower bound', () => {
    const upstreamId = 'wdw:attraction:bound-empty-desc';
    const result = reconcile(
      [],
      [
        withEnrichmentDefaults({
          id: internalId(upstreamId),
          upstreamEntityId: upstreamId,
          name: 'A Show',
          park: 'Hollywood Studios',
          category: 'Show',
          description: '',
        }),
      ],
    );
    expect(result.upserts).toHaveLength(1);
    const u = result.upserts[0];
    expect(u).toBeDefined();
    expect(experienceSchema.safeParse(toExperienceShape(u!)).success).toBe(true);
  });

  it('the canonical experienceSchema rejects a name longer than 200 (sanity check)', () => {
    const tooLong = 'x'.repeat(201);
    const parsed = experienceSchema.safeParse({
      id: internalId('wdw:negative:201'),
      name: tooLong,
      park: 'Animal Kingdom',
      category: 'Ride',
      description: '',
      active: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('the canonical experienceSchema rejects a description longer than 1000 (sanity check)', () => {
    const tooLong = 'y'.repeat(1001);
    const parsed = experienceSchema.safeParse({
      id: internalId('wdw:negative:1001'),
      name: 'A Restaurant',
      park: 'Disney Springs',
      category: 'Restaurant',
      description: tooLong,
      active: true,
    });
    expect(parsed.success).toBe(false);
  });
});
