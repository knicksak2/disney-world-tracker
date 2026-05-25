// Feature: disney-world-tracker, Property 6: rendered catalog equals filtered active subset grouped by Park, sorted by lower(name)
/**
 * Property-based tests for the Catalog_Service presentation pipeline.
 *
 * Validates: Requirements 1.17, 1.18, 1.19, 1.20, 1.21
 *
 * Property 6 (design.md → Correctness Properties):
 *
 *   For any list of Experiences, optional `parkFilter`, optional
 *   `categoryFilter`, and optional search `query`, the rendered catalog
 *   list is exactly the subset of `active` Experiences that satisfy
 *   every selected predicate (Park equals `parkFilter`,
 *   Experience_Category equals `categoryFilter`, name contains the
 *   trimmed `query` as a case-insensitive substring when `query` has at
 *   least one non-whitespace character), grouped by Park, sorted within
 *   each group by `lower(name)` ascending.
 *
 * Test design
 * -----------
 * The route's filter/order pipeline is composed of three layers:
 *
 *   route (Zod parse, q-trim, parkId→park rename)
 *     ↓
 *   repo  (SQL: WHERE active = TRUE [AND park = $] [AND category = $]
 *                      [AND name ILIKE $ ESCAPE '\\']
 *          ORDER BY park, lower(name), id)
 *     ↓
 *   pool  (Postgres)
 *
 * To exercise all three layers without a live database, the test wires:
 *
 *   - The real {@link catalogRoutes} plugin (route layer) onto a Fastify
 *     instance so the request decoding, Zod validation, and q-trim
 *     normalization are the exact production code.
 *   - The real {@link createCatalogRepo} (repo layer) so the SQL
 *     produced is the exact production SQL.
 *   - A fake `pg`-style pool whose `query` implementation parses the
 *     SQL produced by the repo, consumes the parameter array in the
 *     same order the repo pushes it (`park` → `category` → `q`), and
 *     emulates Postgres `ILIKE ... ESCAPE '\\'` and the canonical
 *     `park, lower(name), id` ordering in plain JS.
 *
 * The reference oracle is computed independently from the same
 * population and filter using the rule text (active=true, optional
 * park/category equality, optional case-insensitive substring match on
 * the trimmed query, ordered by park then lower(name) then id). The
 * property asserts that the route's HTTP response equals the oracle.
 *
 * Because the fake pool and the oracle each compute the same logical
 * filter+sort, the property is a tight check on:
 *
 *   - the route correctly forwards `parkId` → repo `park`;
 *   - the route correctly forwards `category` and `q`;
 *   - the route normalizes whitespace-only `q` to "no filter" (R1.20's
 *     "1 non-whitespace character" floor);
 *   - the repo's SQL produces parameters in the order the fake pool
 *     can map back to filter values;
 *   - the route does not re-order the repo's result (R1.17 requires the
 *     ordering be established server-side and preserved on the wire).
 *
 * `numRuns: 100` per the spec convention.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type ExperienceDTO,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createCatalogRepo } from '../repo.js';
import { catalogRoutes } from '../routes.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Domain types used by the test
// ---------------------------------------------------------------------------

/**
 * The shape held by the fake pool's in-memory population. Mirrors the
 * `experiences` row shape consumed by `repo.ts`.
 */
interface PopulationRow {
  readonly id: string;
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly description: string;
  readonly active: boolean;
}

/** The wire-level query-string filter the test sends to `GET /catalog`. */
interface RouteFilter {
  readonly parkId?: Park;
  readonly category?: ExperienceCategory;
  readonly q?: string;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// Names and search queries are drawn from a small alphabet so the
// substring-match predicate has a non-trivial hit rate. Using full
// Unicode would make most queries miss every name, which would let a
// broken filter pass the property by always returning `[]`.

const NAME_ALPHABET = 'abcdefghij ' as const;
const Q_ALPHABET = 'abcdefghijABCDEFGHIJ ' as const;

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...NAME_ALPHABET.split('')), {
    minLength: 1,
    maxLength: 16,
  })
  .map((cs) => cs.join(''));

/**
 * Bias `active` toward `true` (about 70%) so the population usually has
 * some matching rows. The property still holds for fully-inactive
 * populations (the oracle and the route both produce `[]`); biasing
 * just makes the typical run more informative.
 */
const activeArb: fc.Arbitrary<boolean> = fc.oneof(
  { weight: 7, arbitrary: fc.constant(true) },
  { weight: 3, arbitrary: fc.constant(false) },
);

/**
 * Population row generator. Ids are zero-padded so string comparison
 * matches numeric comparison; this makes the `id ASC` tiebreaker
 * predictable.
 */
const populationRowArb: fc.Arbitrary<PopulationRow> = fc
  .record({
    idx: fc.integer({ min: 0, max: 999 }),
    name: nameArb,
    park: parkArb,
    category: categoryArb,
    active: activeArb,
  })
  .map((r) => ({
    id: `id-${String(r.idx).padStart(4, '0')}`,
    upstreamEntityId: `up-${String(r.idx).padStart(4, '0')}`,
    name: r.name,
    park: r.park,
    category: r.category,
    description: '',
    active: r.active,
  }));

const populationArb = fc.uniqueArray(populationRowArb, {
  minLength: 0,
  maxLength: 25,
  selector: (r: PopulationRow) => r.id,
});

/**
 * Search-query generator. Three branches:
 *
 *   - whitespace-only (1..3 spaces): exercises the route's "trim →
 *     drop if empty" rule (R1.20).
 *   - alpha (1..6 chars from {a..j, A..J}): exercises the
 *     case-insensitive substring match (R1.20, R1.21).
 *
 * `searchQuerySchema` requires `q` to be 1..100 chars; both branches
 * stay well within that envelope.
 */
const qWhitespaceArb: fc.Arbitrary<string> = fc
  .array(fc.constant(' '), { minLength: 1, maxLength: 3 })
  .map((cs) => cs.join(''));

const qAlphaArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...Q_ALPHABET.split('')), {
    minLength: 1,
    maxLength: 6,
  })
  .map((cs) => cs.join(''))
  // Reject the all-whitespace case so the alpha branch always carries
  // at least one non-whitespace character; the whitespace branch
  // covers the trim-to-empty path independently.
  .filter((s) => s.trim().length > 0);

const qSomeArb: fc.Arbitrary<string> = fc.oneof(qWhitespaceArb, qAlphaArb);

const filterArb: fc.Arbitrary<RouteFilter> = fc
  .record({
    parkId: fc.option(parkArb, { nil: undefined }),
    category: fc.option(categoryArb, { nil: undefined }),
    q: fc.option(qSomeArb, { nil: undefined }),
  })
  .map((r) => {
    const out: { -readonly [K in keyof RouteFilter]: RouteFilter[K] } = {};
    if (r.parkId !== undefined) out.parkId = r.parkId;
    if (r.category !== undefined) out.category = r.category;
    if (r.q !== undefined) out.q = r.q;
    return out;
  });

// ---------------------------------------------------------------------------
// Fake pool — emulates the SQL semantics the repo depends on
// ---------------------------------------------------------------------------

/**
 * Detect which optional WHERE clauses are present in the SQL produced
 * by `repo.listActiveExperiences`. The repo always pushes parameters in
 * a fixed order: `park`, then `category`, then the `ILIKE` pattern.
 * That positional contract is what lets the fake pool map params back
 * to filter values.
 */
function parseListSql(text: string): {
  hasPark: boolean;
  hasCategory: boolean;
  hasLike: boolean;
} {
  return {
    hasPark: /park = \$\d+/.test(text),
    hasCategory: /category = \$\d+/.test(text),
    hasLike: /ILIKE \$\d+ ESCAPE '\\'/.test(text),
  };
}

/**
 * Compile a Postgres `LIKE` pattern with backslash escape into a
 * regular expression that performs the same match. Postgres
 * `ESCAPE '\\'` semantics:
 *
 *   - `\\`, `\%`, `\_` match the literal `\`, `%`, `_`.
 *   - unescaped `%` matches any (including empty) sequence of chars.
 *   - unescaped `_` matches exactly one char.
 *   - everything else matches literally.
 *
 * The repo's pattern is always shaped `%<escaped_q>%`, so the
 * resulting regex is anchored and effectively performs a case-
 * insensitive substring match (case-insensitivity is applied via the
 * `i` flag, mirroring `ILIKE`).
 */
function compileLikeToRegex(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      regex += escapeRegex(pattern[i + 1]!);
      i += 1;
    } else if (ch === '%') {
      regex += '.*';
    } else if (ch === '_') {
      regex += '.';
    } else {
      regex += escapeRegex(ch!);
    }
  }
  return new RegExp(`^${regex}$`, 'i');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stable comparator emulating `ORDER BY park ASC, lower(name) ASC, id ASC`. */
function compareRows(a: PopulationRow, b: PopulationRow): number {
  if (a.park !== b.park) return a.park < b.park ? -1 : 1;
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName !== bName) return aName < bName ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Project a population row into the SQL row shape the repo reads. */
function toSqlRow(r: PopulationRow): Record<string, unknown> {
  return {
    id: r.id,
    upstream_entity_id: r.upstreamEntityId,
    name: r.name,
    park: r.park,
    category: r.category,
    description: r.description,
    active: r.active,
  };
}

/**
 * Build a fake `pg.Pool` whose `query` runs the same filter+sort
 * pipeline the repo's SQL would run on Postgres. `connect` is
 * intentionally unimplemented because `listActiveExperiences` does not
 * use a transaction client; if a future code change starts using one,
 * the test will fail loudly here rather than silently passing on
 * stub-default rows.
 */
function makeFakePool(population: readonly PopulationRow[]): DbPool {
  const fake = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const { hasPark, hasCategory, hasLike } = parseListSql(text);

      // Consume parameters in the order the repo pushes them.
      let idx = 0;
      let parkVal: Park | undefined;
      let categoryVal: ExperienceCategory | undefined;
      let likePattern: string | undefined;
      if (hasPark) parkVal = params[idx++] as Park;
      if (hasCategory) categoryVal = params[idx++] as ExperienceCategory;
      if (hasLike) likePattern = params[idx++] as string;

      let rows: PopulationRow[] = population.filter((r) => r.active);
      if (parkVal !== undefined) {
        rows = rows.filter((r) => r.park === parkVal);
      }
      if (categoryVal !== undefined) {
        rows = rows.filter((r) => r.category === categoryVal);
      }
      if (likePattern !== undefined) {
        const re = compileLikeToRegex(likePattern);
        rows = rows.filter((r) => re.test(r.name));
      }
      rows = [...rows].sort(compareRows);

      return { rows: rows.map(toSqlRow) };
    },
    async connect(): Promise<never> {
      throw new Error(
        'fake pool: connect() is not implemented; listActiveExperiences must not use a transaction client',
      );
    },
  };
  return fake as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Reference oracle — independent rule-text computation
// ---------------------------------------------------------------------------

/**
 * Compute the expected `experiences` array for a (population, filter)
 * pair using the requirement text directly:
 *
 *   - keep only `active === true` rows (R1.17, R1.18, R1.19, R1.20);
 *   - if `parkId` is set, keep rows with matching `park` (R1.19);
 *   - if `category` is set, keep rows with matching `category` (R1.18);
 *   - if `q` has at least one non-whitespace character (after trim),
 *     keep rows whose `name.toLowerCase()` includes
 *     `q.trim().toLowerCase()` (R1.20, R1.21);
 *   - sort by Park ASC, then `lower(name)` ASC, then `id` ASC (R1.17).
 */
function computeOracle(
  population: readonly PopulationRow[],
  filter: RouteFilter,
): ExperienceDTO[] {
  const trimmedQ =
    filter.q !== undefined && filter.q.trim().length > 0
      ? filter.q.trim()
      : null;
  const qLower = trimmedQ === null ? null : trimmedQ.toLowerCase();

  const matched = population.filter((r) => {
    if (!r.active) return false;
    if (filter.parkId !== undefined && r.park !== filter.parkId) return false;
    if (filter.category !== undefined && r.category !== filter.category)
      return false;
    if (qLower !== null && !r.name.toLowerCase().includes(qLower)) return false;
    return true;
  });

  const sorted = [...matched].sort(compareRows);
  return sorted.map((r) => ({
    id: r.id,
    name: r.name,
    park: r.park,
    category: r.category,
    description: r.description,
    active: r.active,
  }));
}

// ---------------------------------------------------------------------------
// Test app construction
// ---------------------------------------------------------------------------

/**
 * Build a Fastify instance with the real `catalogRoutes` plugin wired
 * to the real `createCatalogRepo`, backed by a fake pool that holds
 * the supplied population. `decideRead` always reports a fresh cache
 * because read-decision logic is exercised by Property 4
 * (`readDecision.prop.test.ts`); this property focuses on the
 * filter/sort/grouping pipeline.
 */
async function buildApp(
  population: readonly PopulationRow[],
): Promise<FastifyInstance> {
  const pool = makeFakePool(population);
  const repo = createCatalogRepo(pool);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({
      decideRead: async () => ({ staleCache: false }),
      listActiveExperiences: (filters) => repo.listActiveExperiences(filters),
      getExperience: (id) => repo.getExperience(id),
    }),
  );
  return app;
}

/**
 * Encode a route filter into a `/catalog` URL using `URLSearchParams`
 * so that values like `"Magic Kingdom"` or `"  "` are escaped exactly
 * as the client would send them.
 */
function buildCatalogUrl(filter: RouteFilter): string {
  const params = new URLSearchParams();
  if (filter.parkId !== undefined) params.set('parkId', filter.parkId);
  if (filter.category !== undefined) params.set('category', filter.category);
  if (filter.q !== undefined) params.set('q', filter.q);
  const qs = params.toString();
  return qs.length > 0 ? `/catalog?${qs}` : '/catalog';
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('catalog presentation — Property 6: filter, group, and sort', () => {
  it('rendered list equals the active filtered subset, ordered by park then lower(name) then id', async () => {
    await fc.assert(
      fc.asyncProperty(
        populationArb,
        filterArb,
        async (population, filter) => {
          const app = await buildApp(population);
          try {
            const res = await app.inject({
              method: 'GET',
              url: buildCatalogUrl(filter),
            });
            expect(res.statusCode).toBe(200);
            const body = res.json() as {
              experiences: ExperienceDTO[];
              staleCache: boolean;
            };
            expect(body.staleCache).toBe(false);
            expect(body.experiences).toEqual(computeOracle(population, filter));
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('every returned row has active=true and respects parkId, category, and trimmed-q predicates', async () => {
    await fc.assert(
      fc.asyncProperty(
        populationArb,
        filterArb,
        async (population, filter) => {
          const app = await buildApp(population);
          try {
            const res = await app.inject({
              method: 'GET',
              url: buildCatalogUrl(filter),
            });
            expect(res.statusCode).toBe(200);
            const body = res.json() as { experiences: ExperienceDTO[] };

            const trimmedQ =
              filter.q !== undefined && filter.q.trim().length > 0
                ? filter.q.trim().toLowerCase()
                : null;

            for (const e of body.experiences) {
              // R1.17/R1.18/R1.19/R1.20: only active rows are returned.
              expect(e.active).toBe(true);
              if (filter.parkId !== undefined) {
                expect(e.park).toBe(filter.parkId);
              }
              if (filter.category !== undefined) {
                expect(e.category).toBe(filter.category);
              }
              if (trimmedQ !== null) {
                expect(e.name.toLowerCase().includes(trimmedQ)).toBe(true);
              }
            }
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('whitespace-only q is normalized to "no q" (R1.20: at least one non-whitespace character)', async () => {
    await fc.assert(
      fc.asyncProperty(
        populationArb,
        fc.record({
          parkId: fc.option(parkArb, { nil: undefined }),
          category: fc.option(categoryArb, { nil: undefined }),
        }),
        qWhitespaceArb,
        async (population, baseFilter, whitespaceQ) => {
          const app = await buildApp(population);
          try {
            const baseUrl = buildCatalogUrl({
              ...(baseFilter.parkId !== undefined
                ? { parkId: baseFilter.parkId }
                : {}),
              ...(baseFilter.category !== undefined
                ? { category: baseFilter.category }
                : {}),
            });
            const wsUrl = buildCatalogUrl({
              ...(baseFilter.parkId !== undefined
                ? { parkId: baseFilter.parkId }
                : {}),
              ...(baseFilter.category !== undefined
                ? { category: baseFilter.category }
                : {}),
              q: whitespaceQ,
            });

            const [resBase, resWs] = await Promise.all([
              app.inject({ method: 'GET', url: baseUrl }),
              app.inject({ method: 'GET', url: wsUrl }),
            ]);
            expect(resBase.statusCode).toBe(200);
            expect(resWs.statusCode).toBe(200);
            expect(resWs.json()).toEqual(resBase.json());
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('list is non-decreasing under (park, lower(name), id) ordering', async () => {
    await fc.assert(
      fc.asyncProperty(
        populationArb,
        filterArb,
        async (population, filter) => {
          const app = await buildApp(population);
          try {
            const res = await app.inject({
              method: 'GET',
              url: buildCatalogUrl(filter),
            });
            expect(res.statusCode).toBe(200);
            const body = res.json() as { experiences: ExperienceDTO[] };

            for (let i = 1; i < body.experiences.length; i++) {
              const prev = body.experiences[i - 1]!;
              const curr = body.experiences[i]!;
              if (prev.park !== curr.park) {
                expect(prev.park < curr.park).toBe(true);
              } else {
                const prevName = prev.name.toLowerCase();
                const currName = curr.name.toLowerCase();
                if (prevName !== currName) {
                  expect(prevName < currName).toBe(true);
                } else {
                  expect(prev.id <= curr.id).toBe(true);
                }
              }
            }
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('catalog presentation — fixed examples for regression', () => {
  it('returns an empty list when the population has no active rows', async () => {
    const population: PopulationRow[] = [
      {
        id: 'id-0001',
        upstreamEntityId: 'up-0001',
        name: 'Retired Ride',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: '',
        active: false,
      },
    ];
    const app = await buildApp(population);
    try {
      const res = await app.inject({ method: 'GET', url: '/catalog' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ experiences: [], staleCache: false });
    } finally {
      await app.close();
    }
  });

  it('groups by Park and sorts by lower(name) ascending within each Park', async () => {
    const population: PopulationRow[] = [
      // Out-of-order across two Parks; expected result groups MK first
      // (alphabetical Park order: "EPCOT" < "Magic Kingdom" by string
      // comparison), then sorts case-insensitively by name within each
      // group.
      {
        id: 'id-0003',
        upstreamEntityId: 'up-0003',
        name: 'spaceship earth',
        park: 'EPCOT',
        category: 'Ride',
        description: '',
        active: true,
      },
      {
        id: 'id-0001',
        upstreamEntityId: 'up-0001',
        name: 'Big Thunder Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: '',
        active: true,
      },
      {
        id: 'id-0002',
        upstreamEntityId: 'up-0002',
        name: 'Astro Orbiter',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: '',
        active: true,
      },
      {
        id: 'id-0004',
        upstreamEntityId: 'up-0004',
        name: 'Living with the Land',
        park: 'EPCOT',
        category: 'Ride',
        description: '',
        active: true,
      },
    ];
    const app = await buildApp(population);
    try {
      const res = await app.inject({ method: 'GET', url: '/catalog' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { experiences: ExperienceDTO[] };
      expect(body.experiences.map((e) => [e.park, e.name])).toEqual([
        ['EPCOT', 'Living with the Land'],
        ['EPCOT', 'spaceship earth'],
        ['Magic Kingdom', 'Astro Orbiter'],
        ['Magic Kingdom', 'Big Thunder Mountain'],
      ]);
    } finally {
      await app.close();
    }
  });

  it('applies parkId, category, and trimmed q filters together (R1.21)', async () => {
    const population: PopulationRow[] = [
      {
        id: 'id-0001',
        upstreamEntityId: 'up-0001',
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: '',
        active: true,
      },
      {
        id: 'id-0002',
        upstreamEntityId: 'up-0002',
        name: 'Mission: SPACE',
        park: 'EPCOT',
        category: 'Ride',
        description: '',
        active: true,
      },
      {
        id: 'id-0003',
        upstreamEntityId: 'up-0003',
        name: 'Space 220 Restaurant',
        park: 'EPCOT',
        category: 'Restaurant',
        description: '',
        active: true,
      },
    ];
    const app = await buildApp(population);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/catalog?parkId=EPCOT&category=Ride&q=%20space%20',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { experiences: ExperienceDTO[] };
      expect(body.experiences.map((e) => e.name)).toEqual(['Mission: SPACE']);
    } finally {
      await app.close();
    }
  });

  it('matches case-insensitively on the trimmed q (R1.20)', async () => {
    const population: PopulationRow[] = [
      {
        id: 'id-0001',
        upstreamEntityId: 'up-0001',
        name: 'Pirates of the Caribbean',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: '',
        active: true,
      },
    ];
    const app = await buildApp(population);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/catalog?q=PIRATES',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { experiences: ExperienceDTO[] };
      expect(body.experiences).toHaveLength(1);
      expect(body.experiences[0]!.name).toBe('Pirates of the Caribbean');
    } finally {
      await app.close();
    }
  });
});
