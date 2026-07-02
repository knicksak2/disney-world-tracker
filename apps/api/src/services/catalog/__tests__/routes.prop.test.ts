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
  type Park,
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
