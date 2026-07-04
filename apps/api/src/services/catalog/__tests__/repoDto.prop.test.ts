// Feature: disney-facilities-catalog-source, Property 9: The Experience and Resort DTOs expose exactly the persisted fields
/**
 * Property-based tests for the Catalog_Service repository DTO mapping
 * (`rowToDto` / `rowToResortDto`, `repo.ts`).
 *
 * Property 9 (design.md → Correctness Properties):
 *
 *   For any persisted `experiences` / `resorts` row, the DTO exposed through
 *   the public repo surface (`listActiveExperiences`, `getExperience`,
 *   `listActiveResorts`) carries EXACTLY the persisted fields — no more, no
 *   fewer:
 *
 *     - the Experience DTO always carries `id`, `name`, `park` (nullable),
 *       `category`, `description`, `active`, `imageUrl` (nullable), and
 *       `areaType`;
 *     - each enrichment field is present iff it was persisted: `resortId` when
 *       `resort_id` is non-null, `latitude`/`longitude` when non-null,
 *       `priceTier` when non-null, `accessibility`/`mealPeriods` when
 *       non-empty (R5.6, R5.7);
 *     - `menus` is never attached by the list/detail row mapping (a
 *       separate `getMenusFor` concern);
 *     - the Resort DTO always carries `id`, `name`, `description`, `imageUrl`,
 *       `latitude`, `longitude`, `address`, and `phone`, each equal to the
 *       persisted value (nullable per R6.4/R6.5), and nothing else (R6.8).
 *
 * Validates: Requirements 5.6, 5.7, 6.8
 *
 * The mapping functions are internal to `repo.ts`, so the property drives them
 * through the public surface: a fake `DbPool` whose `query()` returns generated
 * rows, exercised via `createCatalogRepo`. This mirrors the fake-pool pattern
 * in `repo.test.ts`.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type {
  MealPeriodDTO,
  GroupedFacetsDTO,
  FacetValueDTO,
} from '@dwt/shared';

import { createCatalogRepo } from '../repo.js';
import { deriveFacetViews } from '../disney/enrich.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Fake pool — returns a rigged row set for any SELECT the repo issues.
// ---------------------------------------------------------------------------

function poolReturning(rows: ReadonlyArray<Record<string, unknown>>) {
  return {
    async query() {
      return { rows };
    },
  };
}

// ---------------------------------------------------------------------------
// Row generators (the shape `pg` hands back for each table)
// ---------------------------------------------------------------------------

const mealPeriodArb: fc.Arbitrary<MealPeriodDTO> = fc.record({
  type: fc.string(),
  priceTier: fc.option(fc.string(), { nil: null }),
});

const coordinateArb = fc.option(
  fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  { nil: null },
);

// ---------------------------------------------------------------------------
// Facet-enrichment generators (Property 8)
// ---------------------------------------------------------------------------

/** The Persisted_Facet_Groups this feature captures (facilityDoc.ts source of truth). */
const PERSISTED_FACET_GROUPS = [
  'height',
  'physicalConsiderations',
  'interests',
  'thrillFactor',
  'age',
  'parkInterests',
  'disneyFavorites',
] as const;

const facetValueArb: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 30 }),
});

/**
 * A persisted Grouped_Facets structure: a subset of the Persisted_Facet_Groups,
 * each present group carrying at least one Facet_Value (mirroring how
 * `buildGroupedFacets` only emits groups with ≥1 valid facet). `{}` is a
 * reachable value (no groups present).
 */
const groupedFacetsArb: fc.Arbitrary<GroupedFacetsDTO> = fc
  .record(
    Object.fromEntries(
      PERSISTED_FACET_GROUPS.map((group) => [
        group,
        fc.option(fc.array(facetValueArb, { minLength: 1, maxLength: 3 }), {
          nil: undefined,
        }),
      ]),
    ) as Record<string, fc.Arbitrary<readonly FacetValueDTO[] | undefined>>,
  )
  .map((obj) => {
    const grouped: Record<string, readonly FacetValueDTO[]> = {};
    for (const [group, values] of Object.entries(obj)) {
      if (values !== undefined) grouped[group] = values;
    }
    return grouped;
  });

const heightRequirementArb = fc.option(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    minInches: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    minCentimeters: fc.option(fc.integer({ min: 0, max: 250 }), { nil: null }),
  }),
  { nil: null },
);

const whyThisArb = fc.option(
  fc.record({
    title: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
    bullets: fc.array(fc.string({ maxLength: 40 }), { maxLength: 3 }),
    quotes: fc.array(fc.string({ maxLength: 40 }), { maxLength: 3 }),
  }),
  { nil: null },
);

const subTypeArb = fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
  nil: null,
});

/** An `experiences` row exactly as `repo.ts` reads it back. */
const experienceRowArb = fc.record({
  id: fc.uuid(),
  upstream_entity_id: fc.string(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  description: fc.string(),
  active: fc.boolean(),
  land: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
  resort_area: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
  image_url: fc.option(fc.webUrl(), { nil: null }),
  latitude: coordinateArb,
  longitude: coordinateArb,
  area_type: fc.constantFrom(...AREA_TYPES),
  resort_id: fc.option(fc.uuid(), { nil: null }),
  accessibility: fc.array(fc.string(), { maxLength: 5 }),
  price_tier: fc.option(fc.string(), { nil: null }),
  meal_periods: fc.array(mealPeriodArb, { maxLength: 4 }),
  grouped_facets: groupedFacetsArb,
  height_requirement: heightRequirementArb,
  why_this: whyThisArb,
  sub_type: subTypeArb,
});

/** A `resorts` row exactly as `repo.ts` reads it back. */
const resortRowArb = fc.record({
  id: fc.uuid(),
  upstream_entity_id: fc.string(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  description: fc.option(fc.string(), { nil: null }),
  image_url: fc.option(fc.webUrl(), { nil: null }),
  latitude: coordinateArb,
  longitude: coordinateArb,
  address: fc.option(fc.string(), { nil: null }),
  phone: fc.option(fc.string(), { nil: null }),
  active: fc.constant(true),
  // Option A: the active resort-representing Experience id joined in by
  // `listActiveResorts`, or null when the Resort has no active representing row.
  representing_experience_id: fc.option(fc.uuid(), { nil: null }),
});

// ---------------------------------------------------------------------------
// Expected-DTO oracles (independent restatement of the "iff persisted" rule)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function expectedExperienceDto(row: Row): Record<string, unknown> {
  const dto: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    park: row.park,
    category: row.category,
    description: row.description,
    active: row.active,
    imageUrl: row.image_url,
    areaType: row.area_type,
  };
  if (row.land !== null) dto.land = row.land;
  if (row.resort_area !== null) dto.resortArea = row.resort_area;
  if (row.resort_id !== null) dto.resortId = row.resort_id;
  if (row.latitude !== null) dto.latitude = row.latitude;
  if (row.longitude !== null) dto.longitude = row.longitude;
  if ((row.accessibility as unknown[]).length > 0) {
    dto.accessibility = row.accessibility;
  }
  if (row.price_tier !== null) dto.priceTier = row.price_tier;
  if ((row.meal_periods as unknown[]).length > 0) {
    dto.mealPeriods = row.meal_periods;
  }
  // --- Facet enrichment (Property 8) ---
  if (row.height_requirement !== null) {
    dto.heightRequirement = row.height_requirement;
  }
  const grouped = (row.grouped_facets as GroupedFacetsDTO) ?? {};
  if (Object.keys(grouped).length > 0) dto.groupedFacets = grouped;
  const { physicalConsiderations, interestFacets } = deriveFacetViews(grouped);
  if (physicalConsiderations.length > 0) {
    dto.physicalConsiderations = physicalConsiderations;
  }
  if (Object.keys(interestFacets).length > 0) {
    dto.interestFacets = interestFacets;
  }
  if (row.why_this !== null) dto.whyThis = row.why_this;
  if (row.sub_type !== null) dto.subType = row.sub_type;
  return dto;
}

function expectedResortDto(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    phone: row.phone,
    representingExperienceId: row.representing_experience_id ?? null,
  };
}

/** Assert the DTO equals the oracle in both value AND exact key set. */
function assertExactly(dto: object, expected: object): void {
  expect(dto).toEqual(expected);
  expect(Object.keys(dto).sort()).toEqual(Object.keys(expected).sort());
}

// ---------------------------------------------------------------------------
// Property 9 — Experience DTO
// ---------------------------------------------------------------------------

describe('Property 9: Experience DTO exposes exactly the persisted fields', () => {
  it('listActiveExperiences maps each row to exactly its persisted fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(experienceRowArb, { maxLength: 6 }),
        async (rows) => {
          const repo = createCatalogRepo(poolReturning(rows) as never);
          const dtos = await repo.listActiveExperiences();

          expect(dtos).toHaveLength(rows.length);
          dtos.forEach((dto, i) => {
            assertExactly(dto, expectedExperienceDto(rows[i]!));
            // `menus` is a detail-view concern, never attached by rowToDto.
            expect('menus' in dto).toBe(false);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('getExperience maps the single row to exactly its persisted fields', async () => {
    await fc.assert(
      fc.asyncProperty(experienceRowArb, async (row) => {
        const repo = createCatalogRepo(poolReturning([row]) as never);
        const dto = await repo.getExperience(row.id);

        expect(dto).not.toBeNull();
        assertExactly(dto as object, expectedExperienceDto(row));
        expect('menus' in (dto as object)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9 — Resort DTO
// ---------------------------------------------------------------------------

describe('Property 9: Resort DTO exposes exactly the persisted fields', () => {
  it('listActiveResorts maps each row to exactly the persisted fields plus the joined representing experience id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(resortRowArb, { maxLength: 6 }),
        async (rows) => {
          const repo = createCatalogRepo(poolReturning(rows) as never);
          const dtos = await repo.listActiveResorts();

          expect(dtos).toHaveLength(rows.length);
          dtos.forEach((dto, i) => {
            assertExactly(dto, expectedResortDto(rows[i]!));
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: experience-facet-enrichment, Property 8: Read projection includes
// persisted enrichment and omits the rest.
//
// For any `experiences` row, `rowToDto` (driven via the public repo surface)
// includes the Height_Requirement, Grouped_Facets, Why_This, and
// Facility_SubType exactly when they are persisted (non-null / non-empty),
// derives the Physical_Considerations and Interest_Facets views from the
// persisted Grouped_Facets equal to `deriveFacetViews`, and omits any field
// whose backing column is null / empty.
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
// ---------------------------------------------------------------------------

describe('Property 8: Read projection includes persisted enrichment and omits the rest', () => {
  it('projects each enrichment field present-only-when-persisted and derives views via deriveFacetViews', async () => {
    await fc.assert(
      fc.asyncProperty(experienceRowArb, async (row) => {
        const repo = createCatalogRepo(poolReturning([row]) as never);
        const dto = (await repo.getExperience(row.id)) as unknown as Record<
          string,
          unknown
        >;
        expect(dto).not.toBeNull();

        // R8.1 — Height_Requirement present iff persisted (non-null).
        if (row.height_requirement !== null) {
          expect(dto.heightRequirement).toEqual(row.height_requirement);
        } else {
          expect('heightRequirement' in dto).toBe(false);
        }

        // R8.2 — Grouped_Facets present iff persisted (non-empty).
        const grouped = row.grouped_facets;
        const hasGrouped = Object.keys(grouped).length > 0;
        if (hasGrouped) {
          expect(dto.groupedFacets).toEqual(grouped);
        } else {
          expect('groupedFacets' in dto).toBe(false);
        }

        // R8.2 — Physical_Considerations / Interest_Facets are derived views
        // over the persisted Grouped_Facets, equal to deriveFacetViews, and
        // omitted when empty.
        const { physicalConsiderations, interestFacets } =
          deriveFacetViews(grouped);
        if (physicalConsiderations.length > 0) {
          expect(dto.physicalConsiderations).toEqual(physicalConsiderations);
        } else {
          expect('physicalConsiderations' in dto).toBe(false);
        }
        if (Object.keys(interestFacets).length > 0) {
          expect(dto.interestFacets).toEqual(interestFacets);
        } else {
          expect('interestFacets' in dto).toBe(false);
        }

        // R8.3 — Why_This present iff persisted (non-null).
        if (row.why_this !== null) {
          expect(dto.whyThis).toEqual(row.why_this);
        } else {
          expect('whyThis' in dto).toBe(false);
        }

        // R8.4 — Facility_SubType present iff persisted (non-null).
        if (row.sub_type !== null) {
          expect(dto.subType).toEqual(row.sub_type);
        } else {
          expect('subType' in dto).toBe(false);
        }

        // R8.5 — the projected DTO carries EXACTLY the persisted fields.
        assertExactly(dto, expectedExperienceDto(row));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
