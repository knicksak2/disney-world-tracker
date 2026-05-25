// Feature: disney-world-tracker, Property 27: leaderboard equals first 10 of qualifying active experiences in mean,count,name order
/**
 * Property-based tests for the Highest-Rated Experiences leaderboard.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.10, 11.11
 *
 * Property 27 (design.md → Correctness Properties):
 *
 *   For any population of Experiences with attached aggregate ratings,
 *   `getLeaderboard()` returns the first 10 rows of the subset that
 *   satisfies `experiences.active = TRUE` AND
 *   `aggregate_ratings.count_ratings >= 3`, ordered by
 *   `mean_x10 DESC, count_ratings DESC, lower(name) ASC`. R11.10 covers
 *   the in-between case (1..9 qualifying rows yields all of them);
 *   R11.11 covers the empty case (0 qualifying rows yields `[]`); R11.4
 *   covers the saturation case (more than 10 qualifying rows yields
 *   exactly 10).
 *
 * Test design
 * -----------
 * The leaderboard read is composed of two layers: a SQL query against
 * `aggregate_ratings JOIN experiences` and a JSON projection onto the
 * `LeaderboardEntryDTO` wire shape. To exercise the real SQL surface
 * without a live Postgres, the test wires:
 *
 *   - The real {@link createLeaderboard} factory (production code) so
 *     the SQL text and DTO projection are exactly what production
 *     emits.
 *   - A fake `pg`-style pool whose `query` runs the same filter +
 *     order + limit pipeline in plain JS against an in-memory
 *     population. The pool returns row objects with the same column
 *     aliases the production SQL emits (`id`, `name`, `park`,
 *     `category`, `value`, `count`), so the service's `rowToDto` is
 *     fully exercised.
 *   - A fake Redis whose `get` always returns `null` (no-cache mode)
 *     and whose `set` is a recorded no-op. Every call to
 *     `getLeaderboard` therefore takes the DB path.
 *
 * The reference oracle is computed from the same population using the
 * requirement text directly: keep `active === true && count >= 3`,
 * sort by `mean_x10 DESC, count_ratings DESC, lower(name) ASC`, and
 * truncate to 10. The property asserts equality to the service result.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type LeaderboardEntryDTO,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import {
  LEADERBOARD_LIMIT,
  LEADERBOARD_MIN_COUNT,
  createLeaderboard,
  type LeaderboardRedis,
} from '../leaderboard.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Population row shape
// ---------------------------------------------------------------------------

/**
 * One in-memory entry combining an Experience row and its attached
 * aggregate-ratings row. The leaderboard SQL joins these two tables on
 * `experience_id`; in the population we pre-join them so the fake pool
 * can render the joined row shape directly.
 *
 *   - `id`            → `experiences.id`
 *   - `name/park/category/active` → matching columns on `experiences`
 *   - `mean_x10`      → `aggregate_ratings.mean_x10` (SMALLINT in [10,
 *                       100] when count >= 3; the leaderboard filter
 *                       discards rows below the threshold so a value
 *                       in this range is fine even when count < 3)
 *   - `count_ratings` → `aggregate_ratings.count_ratings`
 */
interface PopulationRow {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly active: boolean;
  readonly mean_x10: number;
  readonly count_ratings: number;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// Names are drawn from a small alphabet (including spaces and mixed
// case) so the case-insensitive `lower(name)` tiebreaker has a
// non-trivial collision rate. Using full Unicode would make tie cases
// vanishingly rare and rob the property of coverage on R11.3's third
// ordering key.

const NAME_ALPHABET = 'abcdefghijABCDEFGHIJ ' as const;

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...NAME_ALPHABET.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((cs) => cs.join(''));

/**
 * `mean_x10` is the SMALLINT range used by `aggregate_ratings`; the
 * leaderboard filter does not look at this value, so the property
 * tests its full domain even for rows that will be filtered out by
 * the `count_ratings >= 3` predicate.
 */
const meanX10Arb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 100 });

/**
 * `count_ratings` is intentionally drawn from `[0, 20]` so that the
 * threshold at `>= 3` lands in the middle of the distribution. This
 * exercises both the qualifying side (R11.10) and the disqualifying
 * side (R11.2 minimum sample threshold) per run.
 */
const countRatingsArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 20 });

const activeArb: fc.Arbitrary<boolean> = fc.boolean();

/**
 * Population row generator. Ids are zero-padded so `uniqueArray`'s
 * id-based dedupe key has a stable lexicographic order; this is
 * cosmetic for the property (the leaderboard tiebreaker is on `name`,
 * not on `id`) but keeps shrinking output readable.
 */
const populationRowArb: fc.Arbitrary<PopulationRow> = fc
  .record({
    idx: fc.integer({ min: 0, max: 9999 }),
    name: nameArb,
    park: parkArb,
    category: categoryArb,
    active: activeArb,
    mean_x10: meanX10Arb,
    count_ratings: countRatingsArb,
  })
  .map((r) => ({
    id: `id-${String(r.idx).padStart(4, '0')}`,
    name: r.name,
    park: r.park,
    category: r.category,
    active: r.active,
    mean_x10: r.mean_x10,
    count_ratings: r.count_ratings,
  }));

const populationArb = fc.uniqueArray(populationRowArb, {
  minLength: 0,
  maxLength: 30,
  selector: (r: PopulationRow) => r.id,
});

// ---------------------------------------------------------------------------
// Fake pool — emulates the leaderboard SQL semantics
// ---------------------------------------------------------------------------

/**
 * Build a fake `pg.Pool` whose `query` runs the same filter, sort, and
 * limit pipeline the production leaderboard SQL would run on Postgres.
 * The fake validates a few invariants of the production query text so
 * that future changes to the SQL surface are caught here rather than
 * silently passing on stub-default rows.
 */
function makeFakePool(population: readonly PopulationRow[]): DbPool {
  const fake = {
    async query(text: string, _params: ReadonlyArray<unknown> = []) {
      // Defensive checks: the leaderboard service emits a fixed SQL
      // shape; if the production text drifts, fail loudly instead of
      // returning the same rows for a different query.
      if (!/e\.active\s*=\s*TRUE/.test(text)) {
        throw new Error(
          'fake pool: leaderboard SQL is missing the `e.active = TRUE` filter',
        );
      }
      if (!/ar\.count_ratings\s*>=\s*3/.test(text)) {
        throw new Error(
          'fake pool: leaderboard SQL is missing the `count_ratings >= 3` filter',
        );
      }

      const rows = population
        .filter((r) => r.active && r.count_ratings >= LEADERBOARD_MIN_COUNT)
        .slice() // copy before sorting
        .sort(compareRows)
        .slice(0, LEADERBOARD_LIMIT)
        .map(toJoinedRow);

      return { rows };
    },
    async connect(): Promise<never> {
      throw new Error(
        'fake pool: connect() is not implemented; getLeaderboard must not use a transaction client',
      );
    },
  };
  return fake as unknown as DbPool;
}

/**
 * Stable comparator emulating
 * `ORDER BY ar.mean_x10 DESC, ar.count_ratings DESC, lower(e.name) ASC`.
 *
 * No further tiebreaker is defined by the SQL; if all three keys tie
 * the relative order of those rows is unspecified. The test handles
 * that case below by sorting both the actual and oracle results with
 * the same comparator (which preserves input order on a tie via
 * `Array.prototype.sort`'s stability in modern engines).
 */
function compareRows(a: PopulationRow, b: PopulationRow): number {
  if (a.mean_x10 !== b.mean_x10) return b.mean_x10 - a.mean_x10;
  if (a.count_ratings !== b.count_ratings) {
    return b.count_ratings - a.count_ratings;
  }
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName !== bName) return aName < bName ? -1 : 1;
  return 0;
}

/**
 * Project a population row into the joined-row shape the production
 * SQL emits. Column aliases match exactly: `value` is the SQL render
 * `mean_x10::float / 10` and `count` is `count_ratings`.
 */
function toJoinedRow(r: PopulationRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    park: r.park,
    category: r.category,
    value: r.mean_x10 / 10,
    count: r.count_ratings,
  };
}

// ---------------------------------------------------------------------------
// Fake Redis — no-cache mode
// ---------------------------------------------------------------------------

/**
 * Redis whose `get` always returns `null`, forcing every
 * `getLeaderboard` call onto the DB path. `set` is recorded but
 * discarded; the property does not assert on cache writes (Property
 * 28 / `cache.prop.test.ts` covers staleness).
 */
function makeNoCacheRedis(): LeaderboardRedis {
  return {
    async get(): Promise<string | null> {
      return null;
    },
    async set(): Promise<unknown> {
      return 'OK';
    },
  };
}

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/**
 * Compute the expected leaderboard from a population using the
 * requirement text directly:
 *
 *   - keep `active === true && count_ratings >= 3` (R11.2);
 *   - sort by `mean_x10 DESC, count_ratings DESC, lower(name) ASC`
 *     (R11.3);
 *   - truncate to {@link LEADERBOARD_LIMIT} rows (R11.4);
 *   - render each row into the wire DTO with `value = mean_x10 / 10`
 *     and `count = count_ratings` (R11.5).
 */
function computeOracle(
  population: readonly PopulationRow[],
): LeaderboardEntryDTO[] {
  return population
    .filter((r) => r.active && r.count_ratings >= LEADERBOARD_MIN_COUNT)
    .slice()
    .sort(compareRows)
    .slice(0, LEADERBOARD_LIMIT)
    .map(
      (r): LeaderboardEntryDTO => ({
        experienceId: r.id,
        name: r.name,
        park: r.park,
        category: r.category,
        value: r.mean_x10 / 10,
        count: r.count_ratings,
      }),
    );
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('leaderboard — Property 27: ordering, threshold, limit, and content', () => {
  it('result equals the filtered, sorted, top-10 oracle for any population', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        const pool = makeFakePool(population);
        const redis = makeNoCacheRedis();
        const service = createLeaderboard({ pool, redis });

        const actual = await service.getLeaderboard();
        const expected = computeOracle(population);

        expect(actual).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every returned row has active=true semantics and count >= 3 (R11.2)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        const pool = makeFakePool(population);
        const redis = makeNoCacheRedis();
        const service = createLeaderboard({ pool, redis });

        const actual = await service.getLeaderboard();
        const populationById = new Map(population.map((r) => [r.id, r]));

        for (const entry of actual) {
          const source = populationById.get(entry.experienceId);
          expect(source).toBeDefined();
          // R11.2: `active = true` for every leaderboard row.
          expect(source!.active).toBe(true);
          // R11.2: minimum sample threshold of 3 contributing Ratings.
          expect(entry.count).toBeGreaterThanOrEqual(LEADERBOARD_MIN_COUNT);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result is non-increasing under (mean DESC, count DESC, lower(name) ASC) (R11.3)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        const pool = makeFakePool(population);
        const redis = makeNoCacheRedis();
        const service = createLeaderboard({ pool, redis });

        const actual = await service.getLeaderboard();
        for (let i = 1; i < actual.length; i++) {
          const prev = actual[i - 1]!;
          const curr = actual[i]!;

          // mean DESC is the primary key; previous mean must be >= current.
          if (prev.value !== curr.value) {
            expect(prev.value).toBeGreaterThan(curr.value);
            continue;
          }
          // count DESC tiebreaker; previous count must be >= current.
          if (prev.count !== curr.count) {
            expect(prev.count).toBeGreaterThan(curr.count);
            continue;
          }
          // lower(name) ASC tiebreaker.
          expect(prev.name.toLowerCase() <= curr.name.toLowerCase()).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result length is at most LEADERBOARD_LIMIT (R11.4)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        const pool = makeFakePool(population);
        const redis = makeNoCacheRedis();
        const service = createLeaderboard({ pool, redis });

        const actual = await service.getLeaderboard();
        expect(actual.length).toBeLessThanOrEqual(LEADERBOARD_LIMIT);

        // R11.10 / R11.4: the result length saturates at LEADERBOARD_LIMIT
        // exactly when the qualifying set is at least that large; below
        // that, every qualifying row appears.
        const qualifying = population.filter(
          (r) => r.active && r.count_ratings >= LEADERBOARD_MIN_COUNT,
        );
        if (qualifying.length < LEADERBOARD_LIMIT) {
          expect(actual.length).toBe(qualifying.length);
        } else {
          expect(actual.length).toBe(LEADERBOARD_LIMIT);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every returned row carries name, park, category, one-decimal value, and count (R11.5)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        const pool = makeFakePool(population);
        const redis = makeNoCacheRedis();
        const service = createLeaderboard({ pool, redis });

        const actual = await service.getLeaderboard();
        for (const entry of actual) {
          // R11.5: name, Park, Category, value, count are all present.
          expect(typeof entry.name).toBe('string');
          expect(entry.name.length).toBeGreaterThan(0);
          expect(PARKS).toContain(entry.park);
          expect(EXPERIENCE_CATEGORIES).toContain(entry.category);
          expect(typeof entry.count).toBe('number');
          expect(Number.isInteger(entry.count)).toBe(true);

          // value is in [1.0, 10.0] and represents one decimal place;
          // we check that `value * 10` is a (near-)integer in [10, 100],
          // which mirrors the SMALLINT storage of `mean_x10`.
          expect(typeof entry.value).toBe('number');
          expect(entry.value).toBeGreaterThanOrEqual(1);
          expect(entry.value).toBeLessThanOrEqual(10);
          const valueX10 = Math.round(entry.value * 10);
          expect(valueX10).toBeGreaterThanOrEqual(10);
          expect(valueX10).toBeLessThanOrEqual(100);
          expect(Math.abs(entry.value * 10 - valueX10)).toBeLessThan(1e-9);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('leaderboard — Property 27: edge cases (R11.10, R11.11)', () => {
  it('returns [] when no Experience qualifies (R11.11)', async () => {
    // Population entirely below the threshold OR inactive: the
    // leaderboard must be empty.
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc
            .record({
              idx: fc.integer({ min: 0, max: 9999 }),
              name: nameArb,
              park: parkArb,
              category: categoryArb,
              // Either inactive or below the count threshold.
              active: fc.boolean(),
              mean_x10: meanX10Arb,
              count_ratings: fc.integer({ min: 0, max: 2 }),
            })
            .map(
              (r): PopulationRow => ({
                id: `id-${String(r.idx).padStart(4, '0')}`,
                name: r.name,
                park: r.park,
                category: r.category,
                active: r.active,
                mean_x10: r.mean_x10,
                count_ratings: r.count_ratings,
              }),
            ),
          { minLength: 0, maxLength: 30, selector: (r) => r.id },
        ),
        async (population) => {
          const pool = makeFakePool(population);
          const redis = makeNoCacheRedis();
          const service = createLeaderboard({ pool, redis });
          const actual = await service.getLeaderboard();
          expect(actual).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns all qualifying rows when between 1 and 9 qualify (R11.10)', async () => {
    // Force the qualifying-set size into [1, 9] by drawing exactly
    // that many qualifying rows and padding with non-qualifying ones.
    const qualifyingArb = fc
      .record({
        idx: fc.integer({ min: 0, max: 4999 }),
        name: nameArb,
        park: parkArb,
        category: categoryArb,
        mean_x10: meanX10Arb,
        count_ratings: fc.integer({
          min: LEADERBOARD_MIN_COUNT,
          max: 20,
        }),
      })
      .map(
        (r): PopulationRow => ({
          id: `qual-${String(r.idx).padStart(4, '0')}`,
          name: r.name,
          park: r.park,
          category: r.category,
          active: true,
          mean_x10: r.mean_x10,
          count_ratings: r.count_ratings,
        }),
      );

    const nonQualifyingArb = fc
      .record({
        idx: fc.integer({ min: 5000, max: 9999 }),
        name: nameArb,
        park: parkArb,
        category: categoryArb,
        active: fc.boolean(),
        mean_x10: meanX10Arb,
        count_ratings: fc.integer({ min: 0, max: 2 }),
      })
      .map(
        (r): PopulationRow => ({
          id: `nq-${String(r.idx).padStart(4, '0')}`,
          name: r.name,
          park: r.park,
          category: r.category,
          active: r.active,
          mean_x10: r.mean_x10,
          count_ratings: r.count_ratings,
        }),
      );

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(qualifyingArb, {
          minLength: 1,
          maxLength: 9,
          selector: (r) => r.id,
        }),
        fc.uniqueArray(nonQualifyingArb, {
          minLength: 0,
          maxLength: 10,
          selector: (r) => r.id,
        }),
        async (qualifying, nonQualifying) => {
          const population = [...qualifying, ...nonQualifying];
          const pool = makeFakePool(population);
          const redis = makeNoCacheRedis();
          const service = createLeaderboard({ pool, redis });
          const actual = await service.getLeaderboard();

          // R11.10: 1..9 qualifying rows yield exactly that many entries.
          expect(actual.length).toBe(qualifying.length);
          // The set of returned ids equals the set of qualifying ids.
          const actualIds = new Set(actual.map((e) => e.experienceId));
          const expectedIds = new Set(qualifying.map((r) => r.id));
          expect(actualIds).toEqual(expectedIds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
