// Feature: friend-stats-viewing, Property 7: Completions exclude inactive Experiences.
// For any set of Completions mixing Active and inactive Experiences, no returned
// Completion_Entry references an inactive Experience, while the underlying
// Completion rows remain unmodified.
/**
 * Property-based test for the Friend Completions read's active-only filter
 * (task 3.4).
 *
 * Validates: Requirements 4.5
 *
 * The active-only decision lives SQL-side in `repo.ts` as the inner JOIN
 *
 *   JOIN experiences e ON e.id = c.experience_id AND e.active = TRUE
 *
 * so that a Completion whose Experience is inactive is dropped from the result
 * set entirely — without deleting or mutating the underlying `completions`
 * rows (R4.5: the records are "preserved").
 *
 * Because the decision is enforced in SQL (exercised end-to-end by the
 * integration test, task 4.4), this property test models that exact JOIN rule
 * in a hermetic fake `pg.Pool`: each generated Completion is tied to an
 * Experience carrying an `active` flag, and the fake pool — mirroring
 * `JOIN ... AND e.active = TRUE` — returns ONLY the rows whose Experience is
 * active. The test then asserts:
 *
 *   1. no returned `CompletionEntry` references an inactive Experience, and
 *   2. the generated source set (the Completion rows) is left unmodified by
 *      the read — `listCompletions` performs no mutation.
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
// Generated source Completion (tied to an Experience with an active flag)
// ---------------------------------------------------------------------------

/**
 * A generated Completion row joined to its Experience. `active` is the
 * Experience's flag; only active Experiences survive the production JOIN.
 * `experienceId` lets us assert which underlying rows were/weren't surfaced.
 */
interface GeneratedCompletion {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly completedOn: string;
  readonly rating: number | null;
  readonly sharedNote: string | null;
  readonly active: boolean;
}

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const completionArb: fc.Arbitrary<GeneratedCompletion> = fc.record({
  experienceId: fc.uuid(),
  experienceName: fc.string({ minLength: 1, maxLength: 40 }),
  park: parkArb,
  category: categoryArb,
  completedOn: fc
    .date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
    .map((d) => d.toISOString().slice(0, 10)),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  // Deliberately bias toward a mix of active/inactive within each population.
  active: fc.boolean(),
});

const populationArb = fc.array(completionArb, { minLength: 0, maxLength: 40 });

const userIdArb = fc.uuid();

// ---------------------------------------------------------------------------
// Fake pool that mirrors the production `JOIN ... AND e.active = TRUE`
// ---------------------------------------------------------------------------

/**
 * Build a fake `pg.Pool` whose `query` returns ONLY the active rows of the
 * generated population — exactly the rows the production
 * `JOIN experiences e ON ... AND e.active = TRUE` would let through. The fake
 * never sees or returns inactive rows, modeling the SQL filter faithfully.
 *
 * It also asserts the production query actually carries the active-only JOIN
 * predicate, so SQL drift that drops the filter is caught here.
 */
function makeFakePool(population: readonly GeneratedCompletion[]): {
  pool: DbPool;
  calls: { text: string; params: ReadonlyArray<unknown> }[];
} {
  const calls: { text: string; params: ReadonlyArray<unknown> }[] = [];
  const fake = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (!/e\.active\s*=\s*TRUE/i.test(text)) {
        throw new Error(
          'fake pool: friend-completions SQL is missing the `e.active = TRUE` JOIN predicate',
        );
      }
      const rows = population
        .filter((c) => c.active)
        .map((c) => ({
          experience_name: c.experienceName,
          park: c.park,
          category: c.category,
          completed_on: c.completedOn,
          rating: c.rating,
          shared_note: c.sharedNote,
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
// Property 7
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 7: completions exclude inactive Experiences', () => {
  it('no returned entry references an inactive Experience', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        const { pool } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        const entries = await repo.listCompletions(userId);

        // Names of Experiences that are inactive in the source population.
        // (Active and inactive may share a name; a returned name is only safe
        // when there exists an active source row matching every field of it.)
        const activeKeys = new Set(
          population
            .filter((c) => c.active)
            .map((c) => entryKey(c.experienceName, c.park, c.category, c.completedOn)),
        );

        // Every returned entry must correspond to an ACTIVE source row.
        for (const entry of entries) {
          const key = entryKey(
            entry.experienceName,
            entry.park,
            entry.category,
            entry.completedOn,
          );
          expect(activeKeys.has(key)).toBe(true);
        }

        // The count of returned entries equals the count of active source rows.
        const activeCount = population.filter((c) => c.active).length;
        expect(entries).toHaveLength(activeCount);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves the underlying source Completion rows unmodified (no mutation)', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        // Deep snapshot of the generated source set before the read.
        const before = JSON.parse(JSON.stringify(population));

        const { pool } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        await repo.listCompletions(userId);

        // R4.5: inactive Completions are excluded from the result, but the
        // underlying Completion records are preserved — the read mutates
        // nothing in the source set.
        expect(population).toEqual(before);

        // The read is a pure SELECT (single query, no transaction client).
        // No mutating SQL verbs reach the pool.
        // (Verified via the fake pool's recorded calls below.)
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('issues a single read-only SELECT with the target userId as the sole param', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, userIdArb, async (population, userId) => {
        const { pool, calls } = makeFakePool(population);
        const repo = createFriendCompletionsRepo(pool);

        await repo.listCompletions(userId);

        expect(calls).toHaveLength(1);
        expect(calls[0]!.params).toEqual([userId]);
        // No mutating verb in the issued statement.
        expect(calls[0]!.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
        expect(calls[0]!.text).toMatch(/\bSELECT\b/i);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable identity key for a returned entry over its content fields. */
function entryKey(
  name: string,
  park: Park | null,
  category: ExperienceCategory,
  completedOn: string,
): string {
  return JSON.stringify([name, park, category, completedOn]);
}

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 7 fixed examples', () => {
  const baseActive: GeneratedCompletion = {
    experienceId: '00000000-0000-4000-8000-000000000010',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    completedOn: '2025-01-15',
    rating: 9,
    sharedNote: null,
    active: true,
  };

  const baseInactive: GeneratedCompletion = {
    experienceId: '00000000-0000-4000-8000-000000000011',
    experienceName: 'Retired Show',
    park: 'EPCOT',
    category: 'Show',
    completedOn: '2024-06-01',
    rating: null,
    sharedNote: null,
    active: false,
  };

  it('drops an inactive Experience while keeping the active one', async () => {
    const { pool } = makeFakePool([baseActive, baseInactive]);
    const repo = createFriendCompletionsRepo(pool);

    const entries = await repo.listCompletions('00000000-0000-4000-8000-000000000001');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.experienceName).toBe('Space Mountain');
    expect(entries.some((e) => e.experienceName === 'Retired Show')).toBe(false);
  });

  it('returns an empty list when every Experience is inactive', async () => {
    const { pool } = makeFakePool([baseInactive, { ...baseInactive, experienceName: 'Gone' }]);
    const repo = createFriendCompletionsRepo(pool);

    const entries = await repo.listCompletions('00000000-0000-4000-8000-000000000001');

    expect(entries).toEqual([]);
  });
});
