// Feature: friend-stats-viewing, Property 8: Completions are capped at 5,000
// most-recent entries. For any set of the target's Completions over Active
// Experiences, the returned list contains at most 5,000 Completion_Entries, and
// when more than 5,000 exist the returned set is exactly those with the most
// recent Completion dates (every returned entry's date is >= every excluded
// entry's date).
/**
 * Property-based test for the Friend Completions read's 5,000-entry cap
 * (task 3.5).
 *
 * Validates: Requirements 4.1
 *
 * The cap is enforced SQL-side in `repo.ts`:
 *
 *   ORDER BY c.completed_on DESC,
 *            lower(e.name) ASC, lower(e.park) ASC, lower(e.category) ASC
 *   LIMIT 5000
 *
 * The date-descending ordering combined with `LIMIT 5000` delivers the most
 * recent 5,000 Completions when more than 5,000 exist. Because the cap and the
 * "most-recent selection" both live in the database, this property test models
 * that exact behavior in a hermetic fake `pg.Pool`: given a generated
 * population of MORE than 5,000 rows with varied Completion dates, the fake
 * pool sorts by the documented `ORDER BY` and applies `LIMIT 5000`, returning
 * at most 5,000 rows — exactly as Postgres would. The repo passes those rows
 * through its row → `CompletionEntry` mapping, and the test asserts:
 *
 *   - the returned list length is `<= 5000` (R4.1 hard cap); and
 *   - when the population exceeds 5,000, every returned entry's Completion date
 *     is `>=` every excluded entry's Completion date (most-recent selection).
 *
 * To keep generation fast at `numRuns >= 100`, the population is generated as a
 * cheap array of integer day-offsets (which produce plentiful date collisions,
 * exercising the boundary where the 5,000th and 5,001st rows share a date), and
 * the tie-break fields (name/Park/Category) are derived deterministically per
 * row so the fake pool's comparator mirrors the production `ORDER BY` exactly.
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

/** Must match the production `LIMIT` in repo.ts. */
const MAX_ENTRIES = 5000;

const TARGET_USER_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Row shape (mirrors the production SELECT column aliases)
// ---------------------------------------------------------------------------

interface SourceRow {
  readonly experience_name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly completed_on: string; // ISO YYYY-MM-DD
  readonly rating: number | null;
  readonly shared_note: string | null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// Generating thousands of rich records per run is wasteful and slow. Property
// 8 only cares about Completion dates and the cap, so we generate a cheap array
// of integer day-offsets (range chosen so dates collide heavily, exercising the
// tie boundary at the 5,000th row) and derive every other field deterministically
// from the row index. This keeps generation to a single integer per row.

const BASE_DATE_MS = Date.UTC(2000, 0, 1);
const MS_PER_DAY = 86_400_000;

/** Convert a non-negative day offset to an ISO `YYYY-MM-DD` calendar date. */
function dayToIso(dayOffset: number): string {
  return new Date(BASE_DATE_MS + dayOffset * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Build a faithful source row from a generated day offset and its index. */
function rowFromDay(dayOffset: number, index: number): SourceRow {
  return {
    experience_name: `experience-${index}`,
    park: PARKS[index % PARKS.length]!,
    category: EXPERIENCE_CATEGORIES[index % EXPERIENCE_CATEGORIES.length]!,
    completed_on: dayToIso(dayOffset),
    rating: null,
    shared_note: null,
  };
}

/**
 * A population of MORE than 5,000 rows. The day-offset range (0..730, i.e. two
 * years) is deliberately small relative to the row count so many rows share a
 * Completion date — including across the 5,000-row boundary — which is the case
 * the most-recent-selection property must hold under.
 */
const overflowPopulationArb: fc.Arbitrary<readonly SourceRow[]> = fc
  .array(fc.integer({ min: 0, max: 730 }), {
    minLength: MAX_ENTRIES + 1,
    maxLength: MAX_ENTRIES + 300,
  })
  .map((days) => days.map((d, i) => rowFromDay(d, i)));

// ---------------------------------------------------------------------------
// Fake pool — mirrors the production ORDER BY + LIMIT exactly
// ---------------------------------------------------------------------------

/**
 * Order two rows by the production `ORDER BY`: Completion date descending, then
 * case-insensitive name, Park, Category ascending. ISO `YYYY-MM-DD` strings
 * compare lexicographically in the same order as calendar dates, so a plain
 * string comparison reproduces `completed_on DESC`.
 */
function compareRows(a: SourceRow, b: SourceRow): number {
  if (a.completed_on !== b.completed_on) {
    // Descending date.
    return a.completed_on < b.completed_on ? 1 : -1;
  }
  const an = a.experience_name.toLowerCase();
  const bn = b.experience_name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  const ap = a.park.toLowerCase();
  const bp = b.park.toLowerCase();
  if (ap !== bp) return ap < bp ? -1 : 1;
  const ac = a.category.toLowerCase();
  const bc = b.category.toLowerCase();
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

/**
 * Build a fake `pg.Pool` whose single `query()` reproduces the database's
 * `ORDER BY ... LIMIT 5000`: it sorts the population by {@link compareRows} and
 * returns at most {@link MAX_ENTRIES} rows. The fake asserts the production SQL
 * actually carries the `LIMIT 5000` clause so a future SQL drift is caught here.
 */
function makeFakePool(population: readonly SourceRow[]): DbPool {
  const fake = {
    async query(text: string, _params?: ReadonlyArray<unknown>) {
      if (!new RegExp(`LIMIT\\s+${MAX_ENTRIES}`, 'i').test(text)) {
        throw new Error(
          `fake pool: friend-completions SQL is missing the \`LIMIT ${MAX_ENTRIES}\` clause`,
        );
      }
      const sorted = [...population].sort(compareRows);
      return { rows: sorted.slice(0, MAX_ENTRIES) };
    },
  };
  return fake as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 8: capped at 5,000 most-recent entries', () => {
  it('returns at most 5,000 entries and those are the most recent by date', async () => {
    await fc.assert(
      fc.asyncProperty(overflowPopulationArb, async (population) => {
        const repo = createFriendCompletionsRepo(makeFakePool(population));

        const entries = await repo.listCompletions(TARGET_USER_ID);

        // R4.1: hard cap — never more than 5,000 entries.
        expect(entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
        // The population overflows, so exactly 5,000 come back.
        expect(entries).toHaveLength(MAX_ENTRIES);

        // Most-recent selection: every returned entry's date is >= every
        // excluded entry's date. Computed via the boundary min/max so the
        // assertion is O(n) rather than O(n^2):
        //   minReturnedDate = smallest date among the returned entries,
        //   maxExcludedDate = largest date among the excluded entries.
        const returnedDates = entries.map((e) => e.completedOn);
        const minReturnedDate = returnedDates.reduce((m, d) => (d < m ? d : m));

        const sorted = [...population].sort(compareRows);
        const excluded = sorted.slice(MAX_ENTRIES);
        expect(excluded.length).toBeGreaterThan(0);
        const maxExcludedDate = excluded
          .map((r) => r.completed_on)
          .reduce((m, d) => (d > m ? d : m));

        // ISO date strings compare lexicographically as calendar dates.
        expect(minReturnedDate >= maxExcludedDate).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never truncates when the population is at or below the cap', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.integer({ min: 0, max: 730 }), {
            minLength: 0,
            maxLength: MAX_ENTRIES,
          })
          .map((days) => days.map((d, i) => rowFromDay(d, i))),
        async (population) => {
          const repo = createFriendCompletionsRepo(makeFakePool(population));

          const entries = await repo.listCompletions(TARGET_USER_ID);

          // At or below the cap: all rows are returned, none dropped.
          expect(entries).toHaveLength(population.length);
          expect(entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression example
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 8 fixed example', () => {
  it('keeps the newest 5,000 of 5,500 distinct-dated completions', async () => {
    // 5,500 rows, each a distinct day offset so the selection is unambiguous:
    // the newest 5,000 (largest day offsets) must be the ones returned.
    const population: SourceRow[] = Array.from({ length: 5500 }, (_, i) =>
      rowFromDay(i, i),
    );
    const repo = createFriendCompletionsRepo(makeFakePool(population));

    const entries = await repo.listCompletions(TARGET_USER_ID);

    expect(entries).toHaveLength(MAX_ENTRIES);
    // The oldest 500 day-offsets (0..499) are dropped; the newest returned
    // entry is the largest offset (5499) and the oldest returned is offset 500.
    const minReturnedDate = entries
      .map((e) => e.completedOn)
      .reduce((m, d) => (d < m ? d : m));
    expect(minReturnedDate).toBe(dayToIso(500));
  });
});
