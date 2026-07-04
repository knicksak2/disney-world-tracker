// Feature: disney-facilities-catalog-source, Property 23: Catalog filtering returns only items matching the requested facets
/**
 * Property-based tests for the `GET /catalog` route filtering (task 10.4).
 *
 * Validates: Requirements 16.3, 16.4
 *
 * Property 23 (design.md → Correctness Properties → "Catalog filtering
 * returns only items matching the requested facets"):
 *
 *   For any set of active Experiences and any combination of `parkId`,
 *   `category`, `areaType`, and case-insensitive substring `q` filters,
 *   every Experience the route returns matches ALL supplied filters — the
 *   route parses the query string, forwards the effective filters to the
 *   repo port, and never surfaces a non-matching row.
 *
 * Test strategy: the plugin is registered against an in-process Fastify
 * instance whose `listActiveExperiences` port is a faithful fake — it
 * applies the repo's documented filter semantics (active-only, `park`
 * equality, `category` equality, `areaType` equality, and case-insensitive
 * `name` substring) over a generated Experience set. Driving the filters
 * through the real HTTP query string exercises the route's own parsing and
 * `parkId → park` / whitespace-`q` normalization; the fake then filters the
 * generated rows.
 *
 * For each generated (dataset, filter-combination) pair the test:
 *   1. builds the query string exactly as the App would,
 *   2. computes the *effective* filters the way the route does — `q` is
 *      trimmed and a whitespace-only `q` collapses to "no query" (R1.20) —
 *      and independently computes the expected matching set, and
 *   3. asserts (a) every returned Experience matches every effective filter
 *      (soundness — Property 23 proper) and (b) the returned set equals the
 *      independently-computed expected set (completeness — the route neither
 *      drops matching rows nor over-filters).
 *
 * `numRuns: 100` per the spec convention.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type ExperienceCategory,
  type ExperienceDTO,
  type FacetValueDTO,
  type GroupedFacetsDTO,
  type HeightRequirementDTO,
  type Park,
  type WhyThisDTO,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  catalogRoutes,
  type CatalogListFilters,
} from '../routes.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Effective-filter model (mirrors the route + repo contract)
// ---------------------------------------------------------------------------

interface FilterSelection {
  readonly park?: Park;
  readonly category?: ExperienceCategory;
  readonly areaType?: AreaType;
  /** Raw, pre-trim `q` value as it would arrive on the query string. */
  readonly qRaw?: string;
}

/**
 * Compute the *effective* filters the route derives from the raw query
 * string: `parkId → park`, and `q` trimmed with a whitespace-only value
 * dropped (R1.20). This is the single source of truth the test uses both to
 * predict the expected set and to assert per-item soundness.
 */
function toEffectiveFilters(sel: FilterSelection): CatalogListFilters {
  const filters: {
    -readonly [K in keyof CatalogListFilters]: CatalogListFilters[K];
  } = {};
  if (sel.park !== undefined) filters.park = sel.park;
  if (sel.category !== undefined) filters.category = sel.category;
  if (sel.areaType !== undefined) filters.areaType = sel.areaType;
  if (sel.qRaw !== undefined) {
    const trimmed = sel.qRaw.trim();
    if (trimmed.length > 0) filters.q = trimmed;
  }
  return filters;
}

/**
 * Faithful reimplementation of the repo's active-list filter semantics.
 * `listActiveExperiences` returns active rows matching every supplied
 * filter; the `q` match is a case-insensitive substring over `name`.
 */
function matches(exp: ExperienceDTO, filters: CatalogListFilters): boolean {
  if (!exp.active) return false;
  if (filters.park !== undefined && exp.park !== filters.park) return false;
  if (filters.category !== undefined && exp.category !== filters.category) {
    return false;
  }
  if (filters.areaType !== undefined && exp.areaType !== filters.areaType) {
    return false;
  }
  if (
    filters.q !== undefined &&
    !exp.name.toLowerCase().includes(filters.q.toLowerCase())
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Query-string construction
// ---------------------------------------------------------------------------

/** Build the `GET /catalog` URL for a filter selection, encoding as the App would. */
function buildCatalogUrl(sel: FilterSelection): string {
  const params = new URLSearchParams();
  if (sel.park !== undefined) params.set('parkId', sel.park);
  if (sel.category !== undefined) params.set('category', sel.category);
  if (sel.areaType !== undefined) params.set('areaType', sel.areaType);
  if (sel.qRaw !== undefined) params.set('q', sel.qRaw);
  const qs = params.toString();
  return qs.length > 0 ? `/catalog?${qs}` : '/catalog';
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function buildApp(
  dataset: readonly ExperienceDTO[],
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({
      decideRead: async () => ({ staleCache: false, cacheAgeHours: null }),
      // Faithful repo fake: apply the documented filter semantics over the
      // generated set so the route's parse/forward path is what is exercised.
      listActiveExperiences: async (filters) =>
        dataset.filter((exp) => matches(exp, filters)),
      getExperience: async () => null,
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Name fragments drawn from a small alphabet so a substring `q` has a real
 * chance of matching (and of not matching) across a generated set, keeping
 * the filter non-trivially exercised.
 */
const nameArb = fc
  .array(fc.constantFrom('a', 'b', 'c', 'Space', 'Mountain', ' ', 'X'), {
    minLength: 1,
    maxLength: 5,
  })
  .map((parts) => parts.join(''))
  // `name` is a 1-200 char non-empty field; guarantee at least one char.
  .filter((s) => s.length >= 1);

const experienceArb: fc.Arbitrary<ExperienceDTO> = fc.record({
  id: fc.uuid(),
  name: nameArb,
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES),
  description: fc.string({ maxLength: 20 }),
  active: fc.boolean(),
  imageUrl: fc.constant<string | null>(null),
  areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
});

const datasetArb = fc.array(experienceArb, { minLength: 0, maxLength: 25 });

/** `q` values: some plain fragments, some with surrounding / only whitespace. */
const qRawArb = fc.oneof(
  fc.constantFrom('a', 'b', 'Space', 'Mountain', 'X', 'ab', 'zzz'),
  fc.constantFrom('  Space  ', ' a ', '   '),
);

const filterSelectionArb: fc.Arbitrary<FilterSelection> = fc.record(
  {
    park: fc.constantFrom<Park>(...PARKS),
    category: fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES),
    areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
    qRaw: qRawArb,
  },
  { requiredKeys: [] },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('GET /catalog filtering — Property 23: returns only items matching the requested facets', () => {
  it('every returned Experience matches all supplied facets, and no matching row is dropped (R16.3, R16.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        datasetArb,
        filterSelectionArb,
        async (dataset, selection) => {
          const app = await buildApp(dataset);
          try {
            const res = await app.inject({
              method: 'GET',
              url: buildCatalogUrl(selection),
            });

            expect(res.statusCode).toBe(200);
            const returned = res.json().experiences as ExperienceDTO[];

            const effective = toEffectiveFilters(selection);

            // Soundness (Property 23 proper): every returned item matches
            // every effective filter.
            for (const exp of returned) {
              expect(matches(exp, effective)).toBe(true);
            }

            // Completeness cross-check: the returned set is exactly the set
            // of active rows matching the effective filters — the route does
            // not drop matching rows nor over-filter.
            const expected = dataset.filter((exp) => matches(exp, effective));
            const sortById = (a: ExperienceDTO, b: ExperienceDTO) =>
              a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            expect([...returned].sort(sortById)).toEqual(
              [...expected].sort(sortById),
            );
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: experience-facet-enrichment, Property 10: Detail response passes new fields through by persistence
/**
 * Property-based test for the `GET /catalog/:experienceId` detail-response
 * pass-through of the six new enrichment fields (task 8.2).
 *
 * Validates: Requirements 10.1, 10.2
 *
 * Property 10 (design.md → Correctness Properties → "Detail response passes
 * new fields through by persistence"):
 *
 *   For any Experience_DTO, `toDetailResponse` includes each of the six new
 *   enrichment fields (`heightRequirement`, `groupedFacets`,
 *   `physicalConsiderations`, `interestFacets`, `whyThis`, `subType`) in the
 *   response exactly when the DTO carries it, and omits each field the DTO
 *   omits, leaving all existing detail fields unchanged.
 *
 * `toDetailResponse` is a private helper in `routes.ts`; it is exercised here
 * through the registered `GET /catalog/:experienceId` route with an injected
 * `getExperience` port returning the generated DTO — the same in-process
 * Fastify harness the other tests in this file use. `getMenusFor` is left
 * unwired so the detail response carries only the DTO's own fields (no `menus`
 * attachment), isolating the enrichment pass-through.
 *
 * Test strategy: generate an ExperienceDTO whose six new enrichment fields are
 * each independently present (possibly `null`, where the field's type allows
 * it) or absent, alongside the always-present core fields. The route returns
 * the projection; the test asserts (a) per-field presence parity — the
 * response carries a new field's key exactly when the DTO does — and (b) the
 * whole response equals the DTO with only `active` stripped, proving the new
 * fields pass through verbatim and every existing field is unchanged.
 *
 * `numRuns: 100` per the spec convention.
 */

/** A fixed valid UUID for the request path; the port ignores the argument. */
const DETAIL_PATH_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** The six new enrichment field names Property 10 governs. */
const ENRICHMENT_FIELDS = [
  'heightRequirement',
  'groupedFacets',
  'physicalConsiderations',
  'interestFacets',
  'whyThis',
  'subType',
] as const;

/** Build a detail-route app whose `getExperience` returns the given DTO. */
async function buildDetailApp(dto: ExperienceDTO): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({
      decideRead: async () => ({ staleCache: false, cacheAgeHours: null }),
      listActiveExperiences: async () => [],
      // Return the generated DTO regardless of the requested id; the route
      // only uses the id to validate the path and look the row up.
      getExperience: async () => dto,
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// Enrichment-field generators (mirror the shared DTO shapes)
// ---------------------------------------------------------------------------

const facetValueArb: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: fc.string({ maxLength: 12 }),
  name: fc.string({ maxLength: 12 }),
});

/** Grouped_Facets keyed by Persisted_Facet_Group names. */
const groupedFacetsArb: fc.Arbitrary<GroupedFacetsDTO> = fc.dictionary(
  fc.constantFrom(
    'height',
    'physicalConsiderations',
    'interests',
    'thrillFactor',
    'age',
    'parkInterests',
    'disneyFavorites',
  ),
  fc.array(facetValueArb, { maxLength: 4 }),
  { maxKeys: 4 },
);

const heightRequirementArb: fc.Arbitrary<HeightRequirementDTO> = fc.record({
  id: fc.string({ maxLength: 12 }),
  name: fc.string({ maxLength: 12 }),
  minInches: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  minCentimeters: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
});

const whyThisArb: fc.Arbitrary<WhyThisDTO> = fc.record({
  title: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  bullets: fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
  quotes: fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
});

/**
 * Generate the six new enrichment fields with independent presence/absence.
 * `requiredKeys: []` lets fast-check omit any subset of keys, exercising both
 * "carried" (present, possibly `null`) and "omitted" cases per field.
 */
const enrichmentArb = fc.record(
  {
    heightRequirement: fc.option(heightRequirementArb, { nil: null }),
    groupedFacets: groupedFacetsArb,
    physicalConsiderations: fc.array(facetValueArb, { maxLength: 4 }),
    interestFacets: groupedFacetsArb,
    whyThis: fc.option(whyThisArb, { nil: null }),
    subType: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  },
  { requiredKeys: [] },
);

/** Always-present core fields of an ExperienceDTO detail view. */
const coreExperienceArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES),
  description: fc.string({ maxLength: 30 }),
  active: fc.boolean(),
  imageUrl: fc.option(fc.webUrl(), { nil: null }),
  areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
});

const detailExperienceArb: fc.Arbitrary<ExperienceDTO> = fc
  .tuple(coreExperienceArb, enrichmentArb)
  .map(([core, enrichment]) => ({ ...core, ...enrichment }) as ExperienceDTO);

describe('GET /catalog/:experienceId — Property 10: detail response passes new fields through by persistence', () => {
  it('includes each new enrichment field exactly when the DTO carries it, leaving existing fields unchanged (R10.1, R10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(detailExperienceArb, async (dto) => {
        const app = await buildDetailApp(dto);
        try {
          const res = await app.inject({
            method: 'GET',
            url: `/catalog/${DETAIL_PATH_ID}`,
          });

          expect(res.statusCode).toBe(200);
          const body = res.json() as Record<string, unknown>;

          // (a) Per-field presence parity: the response carries a new
          // enrichment field's key exactly when the DTO does (R10.1, R10.2).
          for (const field of ENRICHMENT_FIELDS) {
            const dtoHas = Object.prototype.hasOwnProperty.call(dto, field);
            const bodyHas = Object.prototype.hasOwnProperty.call(body, field);
            expect(bodyHas).toBe(dtoHas);
            if (dtoHas) {
              expect(body[field]).toEqual(
                (dto as unknown as Record<string, unknown>)[field],
              );
            }
          }

          // (b) The whole response equals the DTO with only `active` stripped:
          // every new field passes through verbatim and no existing detail
          // field is changed (no `menus` is attached — the port is unwired).
          const { active: _active, ...expected } = dto;
          void _active;
          expect(body).toEqual(expected);
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
