// Feature: friend-stats-viewing, Property 9: Completions ordering with
// case-insensitive tie-breaks. For any set of Completion_Entries, the returned
// list is ordered by Completion date DESCENDING, breaking ties by Experience
// name ASCENDING, then Park name ASCENDING, then Experience_Category ASCENDING,
// all under case-insensitive comparison.
/**
 * Property-based test for the Friend Completions read ordering (task 3.6).
 *
 * Validates: Requirements 4.8
 *
 * The ordering decision lives SQL-side in `repo.ts`:
 *
 *   ORDER BY c.completed_on DESC,
 *            lower(e.name)     ASC,
 *            lower(e.park)     ASC,
 *            lower(e.category) ASC
 *
 * Because the ordering is enforced by Postgres (exercised end-to-end by the
 * integration test, task 4.4), this property test models that exact comparator
 * in a hermetic fake `pg.Pool`. The fake receives a *shuffled* population of
 * generated entries, sorts them through the documented comparator (date desc,
 * then case-insensitive name, park, category ascending) — exactly what the SQL
 * `ORDER BY` would produce — and hands the ordered rows to the repo. The test
 * then asserts that the repo's row → `CompletionEntry` projection preserves
 * that order: for every adjacent pair in the result, the ordering predicate
 * holds.
 *
 * Generators deliberately force collisions and case differences:
 *   - dates are drawn from a tiny pool so many entries share a Completion date
 *     (exercising the tie-break chain rather than the date key alone);
 *   - names / parks / categories are drawn from small pools whose members
 *     differ only by case, so the case-insensitive comparison is the deciding
 *     factor on adjacent pairs.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { ExperienceCategory, Park } from '@dwt/shared';

import type { DbPool } from '../../../../db/pool.js';
import { createFriendCompletionsRepo } from '../repo.js';

const NUM_RUNS = 100;

const TARGET_USER_ID = '00000000-0000-4000-8000-000000000009';

// ---------------------------------------------------------------------------
// Generated entry shape
// ---------------------------------------------------------------------------

interface GeneratedEntry {
  readonly experienceName: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly completedOn: string; // YYYY-MM-DD
  readonly rating: number | null;
  readonly sharedNote: string | null;
}

// Small pools whose members collide under a case-insensitive comparison.
// Each canonical token appears in several case spellings so that two entries
// differing only by case land adjacent and the lower(...) comparison decides.
const DATES = ['2025-01-10', '2025-01-10', '2025-06-22', '2024-12-31'] as const;
const NAMES = ['alpha', 'Alpha', 'ALPHA', 'beta', 'Beta', 'gamma', 'GAMMA'] as const;
// Park / Category are typed unions in production, but the ordering is purely a
// `lower(text)` comparison; we generate case-variant spellings to exercise the
// case-insensitive tie-break and cast at the boundary (the repo never inspects
// the union values, it only carries them through).
const PARK_SPELLINGS = ['epcot', 'EPCOT', 'Epcot', 'magic kingdom', 'Magic Kingdom'] as const;
const CATEGORY_SPELLINGS = ['ride', 'Ride', 'RIDE', 'show', 'Show'] as const;

const entryArb: fc.Arbitrary<GeneratedEntry> = fc.record({
  experienceName: fc.constantFrom(...NAMES),
  park: fc.constantFrom(...PARK_SPELLINGS) as unknown as fc.Arbitrary<Park>,
  category: fc.constantFrom(...CATEGORY_SPELLINGS) as unknown as fc.Arbitrary<ExperienceCategory>,
  completedOn: fc.constantFrom(...DATES),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
});

// ---------------------------------------------------------------------------
// Documented comparator (mirrors the production SQL ORDER BY)
// ---------------------------------------------------------------------------

/**
 * Compare two entries exactly as the SQL `ORDER BY` does:
 *   completed_on DESC, lower(name) ASC, lower(park) ASC, lower(category) ASC.
 * Returns < 0 when `a` should sort before `b`, > 0 when after, 0 when equal
 * on every key.
 */
function compareEntries(a: GeneratedEntry, b: GeneratedEntry): number {
  // 1. Completion date DESCENDING (later date first). YYYY-MM-DD sorts
  //    correctly under plain string comparison.
  if (a.completedOn !== b.completedOn) {
    return a.completedOn > b.completedOn ? -1 : 1;
  }
  // 2..4. Case-insensitive ascending on name, then park, then category.
  for (const key of ['experienceName', 'park', 'category'] as const) {
    const la = a[key].toLowerCase();
    const lb = b[key].toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Fake pool — sorts via the documented comparator, then returns the rows
// ---------------------------------------------------------------------------

/**
 * Build a fake `pg.Pool` whose `query` sorts the generated population through
 * {@link compareEntries} (the SQL `ORDER BY` oracle) and returns the ordered
 * rows with the production column aliases. This isolates the repo's
 * order-preservation: whatever order Postgres yields must survive the
 * row → entry mapping unchanged.
 */
function makePool(population: readonly GeneratedEntry[]): DbPool {
  const ordered = [...population].sort(compareEntries);
  const fake = {
    async query(_text: string, _params?: ReadonlyArray<unknown>) {
      return {
        rows: ordered.map((e) => ({
          experience_name: e.experienceName,
          park: e.park,
          category: e.category,
          completed_on: e.completedOn,
          rating: e.rating,
          shared_note: e.sharedNote,
        })),
      };
    },
  };
  return fake as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 9: ordering with case-insensitive tie-breaks', () => {
  it('every adjacent pair satisfies date desc, then case-insensitive name/park/category asc', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entryArb, { maxLength: 60 }), async (population) => {
        const repo = createFriendCompletionsRepo(makePool(population));
        const result = await repo.listCompletions(TARGET_USER_ID);

        // The mapping is 1:1 and order-preserving.
        expect(result).toHaveLength(population.length);

        for (let i = 0; i + 1 < result.length; i += 1) {
          const a = result[i]!;
          const b = result[i + 1]!;

          // Date is non-increasing (descending).
          expect(a.completedOn >= b.completedOn).toBe(true);

          if (a.completedOn === b.completedOn) {
            // Within a date tie, name is case-insensitively non-decreasing.
            const an = a.experienceName.toLowerCase();
            const bn = b.experienceName.toLowerCase();
            expect(an <= bn).toBe(true);

            if (an === bn) {
              // Then park ascending (case-insensitive).
              const ap = a.park.toLowerCase();
              const bp = b.park.toLowerCase();
              expect(ap <= bp).toBe(true);

              if (ap === bp) {
                // Then category ascending (case-insensitive).
                expect(a.category.toLowerCase() <= b.category.toLowerCase()).toBe(true);
              }
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 9 fixed examples', () => {
  function entry(partial: Partial<GeneratedEntry>): GeneratedEntry {
    return {
      experienceName: 'alpha',
      park: 'Epcot' as Park,
      category: 'Ride' as ExperienceCategory,
      completedOn: '2025-01-10',
      rating: null,
      sharedNote: null,
      ...partial,
    };
  }

  it('orders later dates before earlier dates', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([
        entry({ completedOn: '2024-12-31', experienceName: 'alpha' }),
        entry({ completedOn: '2025-06-22', experienceName: 'alpha' }),
        entry({ completedOn: '2025-01-10', experienceName: 'alpha' }),
      ]),
    );
    const result = await repo.listCompletions(TARGET_USER_ID);
    expect(result.map((e) => e.completedOn)).toEqual([
      '2025-06-22',
      '2025-01-10',
      '2024-12-31',
    ]);
  });

  it('breaks a date tie by case-insensitive name ascending', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([
        entry({ experienceName: 'gamma' }),
        entry({ experienceName: 'Alpha' }),
        entry({ experienceName: 'beta' }),
      ]),
    );
    const result = await repo.listCompletions(TARGET_USER_ID);
    expect(result.map((e) => e.experienceName.toLowerCase())).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('breaks a name tie (case-insensitive) by park then category ascending', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([
        entry({ experienceName: 'ALPHA', park: 'magic kingdom' as Park, category: 'Show' as ExperienceCategory }),
        entry({ experienceName: 'alpha', park: 'epcot' as Park, category: 'Show' as ExperienceCategory }),
        entry({ experienceName: 'Alpha', park: 'epcot' as Park, category: 'ride' as ExperienceCategory }),
      ]),
    );
    const result = await repo.listCompletions(TARGET_USER_ID);
    // All share name "alpha" (case-insensitive) and date; park epcot < magic kingdom,
    // and within epcot, category ride < show.
    expect(
      result.map((e) => `${e.park.toLowerCase()}/${e.category.toLowerCase()}`),
    ).toEqual(['epcot/ride', 'epcot/show', 'magic kingdom/show']);
  });
});
