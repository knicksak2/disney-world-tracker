// Feature: friend-stats-viewing, Property 5: completion-entry content and rating inclusion
/**
 * Property-based tests for the Friend Completions read mapping.
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 *
 * Property 5 (design.md → Correctness Properties):
 *
 *   For any set of the target's Completions over Active Experiences,
 *   every returned Completion_Entry carries the completed Experience's
 *   name, Park, Experience_Category, and Completion date matching the
 *   source rows, includes the Friend's Rating as an integer in `1..10`
 *   exactly when a Rating exists for that Experience, and carries a
 *   `null` no-rating indicator otherwise.
 *
 * Test design
 * -----------
 * `listCompletions` is composed of a single SQL read and a row → DTO
 * projection (`rowToEntry`). Property 5 is concerned only with the
 * projection's content faithfulness and the rating-inclusion rule, not
 * with the SQL filter/order/limit semantics (those are Properties 6–9).
 *
 * To exercise the real projection without a live Postgres, the test
 * wires the production {@link createFriendCompletionsRepo} factory to a
 * fake `pg`-style pool whose `query` returns a generated population of
 * joined rows using the exact column aliases the production SQL emits
 * (`experience_name`, `park`, `category`, `completed_on`, `rating`,
 * `shared_note`). The fake validates that the production query selects
 * the rating column so a future SQL drift is caught here.
 *
 * Ratings are generated three ways to mirror the `pg` type parser:
 *   - absent (`null`)            → entry.rating must be exactly `null`
 *   - a JS `number` in `1..10`   → entry.rating must equal that integer
 *   - a numeric string `"1".."10"` (pg may return NUMERIC/BIGINT as a
 *     string) → entry.rating must be the parsed integer
 *
 * Completion dates are generated both as ISO `YYYY-MM-DD` strings and as
 * `Date` values pinned to UTC midnight (the two shapes `pg`'s DATE
 * parser can yield), and the oracle computes the expected `YYYY-MM-DD`
 * for each so the date-formatting branch is exercised on both paths.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../../db/pool.js';
import { createFriendCompletionsRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Source row shape (mirrors the production SELECT column aliases)
// ---------------------------------------------------------------------------

interface SourceRow {
  readonly experience_name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  /** Either an ISO `YYYY-MM-DD` string or a UTC-midnight `Date`. */
  readonly completed_on: string | Date;
  /** Canonical `YYYY-MM-DD` the mapping should emit for `completed_on`. */
  readonly expectedCompletedOn: string;
  /** Raw rating as the pg parser might yield it. */
  readonly rating: number | string | null;
  /** Expected mapped rating: integer `1..10` or `null`. */
  readonly expectedRating: number | null;
  readonly shared_note: string | null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// Names use a small mixed-case alphabet so the content assertions see
// realistic, occasionally-colliding strings without pulling in full
// Unicode (which is irrelevant to Property 5's content/rating focus).

const NAME_ALPHABET = 'abcdefghijABCDEFGHIJ ' as const;

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...NAME_ALPHABET.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .map((cs) => cs.join(''));

/** A valid calendar date as `{ y, m, d }`; day capped at 28 to stay valid. */
const calendarDateArb = fc.record({
  y: fc.integer({ min: 2000, max: 2030 }),
  m: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }),
});

function isoDate({ y, m, d }: { y: number; m: number; d: number }): string {
  const yyyy = String(y).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * `completed_on` generator: yields the column value as either the ISO
 * string or a UTC-midnight `Date`, paired with the canonical
 * `YYYY-MM-DD` the mapping is expected to emit for that value.
 */
const completedOnArb: fc.Arbitrary<{
  value: string | Date;
  expected: string;
}> = calendarDateArb.chain((cal) => {
  const iso = isoDate(cal);
  return fc.constantFrom<{ value: string | Date; expected: string }>(
    { value: iso, expected: iso },
    { value: new Date(Date.UTC(cal.y, cal.m - 1, cal.d)), expected: iso },
  );
});

/**
 * `rating` generator: covers the no-rating case (`null`) and the
 * present case as a JS number or numeric string (both shapes `pg` may
 * yield), paired with the expected mapped integer (or `null`).
 */
const ratingArb: fc.Arbitrary<{
  value: number | string | null;
  expected: number | null;
}> = fc.oneof(
  fc.constant<{ value: number | string | null; expected: number | null }>({
    value: null,
    expected: null,
  }),
  fc
    .integer({ min: 1, max: 10 })
    .map((n) => ({ value: n, expected: n })),
  fc
    .integer({ min: 1, max: 10 })
    .map((n) => ({ value: String(n), expected: n })),
);

const sourceRowArb: fc.Arbitrary<SourceRow> = fc
  .record({
    name: nameArb,
    park: parkArb,
    category: categoryArb,
    completedOn: completedOnArb,
    rating: ratingArb,
    sharedNote: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  })
  .map((r) => ({
    experience_name: r.name,
    park: r.park,
    category: r.category,
    completed_on: r.completedOn.value,
    expectedCompletedOn: r.completedOn.expected,
    rating: r.rating.value,
    expectedRating: r.rating.expected,
    shared_note: r.sharedNote,
  }));

const populationArb = fc.array(sourceRowArb, { minLength: 0, maxLength: 40 });

const userIdArb = fc.uuid();

// ---------------------------------------------------------------------------
// Fake pool — returns the generated population unchanged
// ---------------------------------------------------------------------------

/**
 * Build a fake `pg.Pool` whose `query` returns the generated population
 * as joined rows. Property 5 exercises the row → entry projection, so
 * the fake does not re-implement SQL filtering/ordering; it does assert
 * the production query selects the rating column to catch SQL drift.
 */
function makeFakePool(population: readonly SourceRow[]): {
  pool: DbPool;
  calls: { text: string; params: ReadonlyArray<unknown> }[];
} {
  const calls: { text: string; params: ReadonlyArray<unknown> }[] = [];
  const fake = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (!/AS\s+rating/i.test(text)) {
        throw new Error(
          'fake pool: friend-completions SQL is missing the `AS rating` projection',
        );
      }
      const rows = population.map((r) => ({
        experience_name: r.experience_name,
        park: r.park,
        category: r.category,
        completed_on: r.completed_on,
        rating: r.rating,
        shared_note: r.shared_note,
      }));
      return { rows };
    },
    async connect(): Promise<never> {
      throw new Error(
        'fake pool: connect() is not implemented; listCompletions must not use a transaction client',
      );
    },
  };
  return { pool: fake as unknown as DbPool, calls };
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('friend completions — Property 5: entry content and rating inclusion', () => {
  it('each entry mirrors its source row content positionally', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        const { pool } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        const entries = await repo.listCompletions(userId);

        // The mapping is 1:1 and order-preserving over the rows the pool
        // returns, so entry[i] must correspond to population[i].
        expect(entries).toHaveLength(population.length);
        for (let i = 0; i < population.length; i++) {
          const src = population[i]!;
          const entry = entries[i]!;

          // R4.2: name, Park, Category, and Completion date match source.
          expect(entry.experienceName).toBe(src.experience_name);
          expect(entry.park).toBe(src.park);
          expect(entry.category).toBe(src.category);
          expect(entry.completedOn).toBe(src.expectedCompletedOn);
          // Completion date is a calendar date `YYYY-MM-DD`.
          expect(entry.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rating is an integer 1..10 exactly when the source has a rating, else null (R4.3, R4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        const { pool } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        const entries = await repo.listCompletions(userId);

        for (let i = 0; i < population.length; i++) {
          const src = population[i]!;
          const entry = entries[i]!;

          if (src.rating === null) {
            // R4.4: no Rating → null no-rating indicator.
            expect(entry.rating).toBeNull();
          } else {
            // R4.3: Rating present → integer in 1..10.
            expect(entry.rating).not.toBeNull();
            expect(typeof entry.rating).toBe('number');
            expect(Number.isInteger(entry.rating)).toBe(true);
            expect(entry.rating).toBeGreaterThanOrEqual(1);
            expect(entry.rating).toBeLessThanOrEqual(10);
            expect(entry.rating).toBe(src.expectedRating);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('passes the target userId as the sole query parameter', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        const { pool, calls } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        await repo.listCompletions(userId);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.params).toEqual([userId]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
