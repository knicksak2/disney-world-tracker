// Feature: disney-world-tracker, Property 29: sourced image fields survive catalog reconciliation and new rows arrive null
/**
 * Property-based tests for sourced-image survival across catalog
 * reconciliation.
 *
 * Validates: Requirements 12.3, 12.4
 *
 * Property 29 (design.md → Correctness Properties):
 *
 *   For any Experience row carrying a non-null `image_url` /
 *   `image_attribution` and any sequence of catalog reconciliations
 *   applied to it (upserts of changed name/Park/Experience_Category,
 *   soft-delete, and re-appearance), the row's `image_url` and
 *   `image_attribution` values remain unchanged after every reconciliation
 *   step; and for any upstream entity id absent from the cache, the
 *   Experience inserted for it has `image_url` and `image_attribution`
 *   both null.
 *
 * How this is tested (matching the design's "Image survival across sync"
 * note and the repo's existing unit-test approach):
 *
 *   The survival invariant is enforced structurally at the SQL layer in
 *   `repo.ts` `applyReconciliation`. Image columns are populated entirely
 *   out of band by the Image_Sourcing_Job; the reconcile write paths
 *   deliberately never reference them:
 *
 *     - the upsert `INSERT ... ON CONFLICT (id) DO UPDATE SET ...` list
 *       omits `image_url` / `image_attribution`, so an existing curated
 *       image is left untouched on every upsert / re-appearance, and a
 *       brand-new row inserts those columns as their NULL default;
 *     - the soft-delete `UPDATE` only sets `active` / `updated_at`.
 *
 *   There is no live Postgres in unit tests, so we drive
 *   `applyReconciliation` over randomly generated reconcile diffs with an
 *   in-memory fake `pg` pool (the same pattern `repo.test.ts` uses) that
 *   records every SQL `text` + `params`, and assert the mechanical
 *   guarantee that no write path can ever mutate the image columns:
 *
 *     (1) No SQL statement issued across the random diff mentions
 *         `image_url` or `image_attribution` anywhere (case-insensitive) —
 *         so any pre-existing non-null image survives every
 *         upsert/soft-delete/reappearance step. (R12.3)
 *     (2) The upsert INSERT's column list omits the image columns and its
 *         parameter array carries only the six non-image columns — so a
 *         brand-new upstream row is inserted with `image_url` /
 *         `image_attribution` defaulting to NULL. (R12.4)
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { createCatalogRepo } from '../repo.js';
import type {
  ReconcileResult,
  ReconcileSoftDelete,
  ReconcileUpsert,
} from '../types.js';

const NUM_RUNS = 100;

const IMAGE_COLUMN_PATTERN = /image_url|image_attribution/i;

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------
//
// A minimal in-memory stand-in for `pg.Pool` / `pg.PoolClient` that records
// every SQL string and parameter array the repo issues. It mirrors the
// helper in `repo.test.ts`; we re-implement a small local copy here rather
// than exporting test helpers from `repo.ts`.

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakePool {
  readonly calls: FakeCall[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  connect(): Promise<{
    query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
    release(): void;
  }>;
}

function makePool(): FakePool {
  const calls: FakeCall[] = [];

  const dispatch = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ) => {
    calls.push({ text, params });
    return { rows: [] as ReadonlyArray<Record<string, unknown>> };
  };

  return {
    calls,
    async query(text, params) {
      return dispatch(text, params);
    },
    async connect() {
      return {
        async query(text, params) {
          return dispatch(text, params);
        },
        release() {
          /* no-op */
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const park: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const category: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const internalId = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `id-${n}`);
const name = fc.string({ minLength: 1, maxLength: 32 });
const description = fc.string({ minLength: 0, maxLength: 64 });
const upstreamEntityId = fc.string({ minLength: 1, maxLength: 24 });

const upsertArb: fc.Arbitrary<ReconcileUpsert> = fc.record({
  id: internalId,
  upstreamEntityId,
  name,
  park,
  category,
  description,
  active: fc.constant<true>(true),
});

const softDeleteArb: fc.Arbitrary<ReconcileSoftDelete> = fc.record({
  id: internalId,
});

/**
 * A random reconcile diff: an arbitrary mix of upserts (renames /
 * re-appearances / brand-new rows) and soft-deletes. Each diff models one
 * step in an arbitrary reconciliation sequence applied to the cache.
 */
const diffArb: fc.Arbitrary<ReconcileResult> = fc.record({
  upserts: fc.array(upsertArb, { maxLength: 12 }),
  softDeletes: fc.array(softDeleteArb, { maxLength: 12 }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the column list from an `INSERT INTO experiences ( ... )`
 * statement: the comma-separated identifiers between the first parenthesis
 * after the table name and its matching `)` that precedes `VALUES`.
 */
function insertColumns(text: string): string[] {
  const match = /INSERT INTO experiences\s*\(([^)]*)\)/i.exec(text);
  if (match === null || match[1] === undefined) {
    throw new Error(`could not parse INSERT column list from: ${text}`);
  }
  return match[1]
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('applyReconciliation — Property 29: sourced images survive reconciliation', () => {
  it('never references the image columns in any reconcile statement (R12.3)', async () => {
    await fc.assert(
      fc.asyncProperty(diffArb, async (diff) => {
        const pool = makePool();
        const repo = createCatalogRepo(pool as never);

        await repo.applyReconciliation(diff);

        // Every statement (BEGIN, each upsert, each soft-delete, COMMIT)
        // must be free of any reference to the image columns — there is no
        // write path that can mutate a curated image, so a non-null
        // image_url / image_attribution survives every step.
        for (const call of pool.calls) {
          expect(
            IMAGE_COLUMN_PATTERN.test(call.text),
            `statement must not reference image columns: ${call.text}`,
          ).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('inserts brand-new rows without image columns, so they default to NULL (R12.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(upsertArb, { minLength: 1, maxLength: 12 }),
        async (upserts) => {
          const pool = makePool();
          const repo = createCatalogRepo(pool as never);

          await repo.applyReconciliation({ upserts, softDeletes: [] });

          const inserts = pool.calls.filter((c) =>
            /INSERT INTO experiences/i.test(c.text),
          );
          // One INSERT per upsert.
          expect(inserts).toHaveLength(upserts.length);

          for (const insert of inserts) {
            const columns = insertColumns(insert.text);
            // The image columns are absent from the column list, so a new
            // row arrives with image_url / image_attribution = NULL.
            expect(
              columns.some((c) => IMAGE_COLUMN_PATTERN.test(c)),
              `INSERT column list must omit image columns: ${columns.join(', ')}`,
            ).toBe(false);
            // The non-image columns are exactly id, upstream_entity_id,
            // name, park, category, description (active/updated_at are
            // literals, not params), so the param array has length 6.
            expect(insert.params).toHaveLength(6);
            // None of the supplied params is an image value either.
            for (const value of insert.params) {
              expect(typeof value === 'string' || value === null).toBe(true);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('soft-deletes touch only active/updated_at, never the image columns (R12.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(softDeleteArb, { minLength: 1, maxLength: 12 }),
        async (softDeletes) => {
          const pool = makePool();
          const repo = createCatalogRepo(pool as never);

          await repo.applyReconciliation({ upserts: [], softDeletes });

          const updates = pool.calls.filter((c) =>
            /UPDATE experiences/i.test(c.text),
          );
          expect(updates).toHaveLength(softDeletes.length);

          for (const update of updates) {
            expect(IMAGE_COLUMN_PATTERN.test(update.text)).toBe(false);
            expect(update.text).toMatch(/active = FALSE/);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed examples for regression
// ---------------------------------------------------------------------------

const MAGIC_KINGDOM: Park = 'Magic Kingdom';
const RIDE: ExperienceCategory = 'Ride';

describe('applyReconciliation — image survival fixed examples', () => {
  it('an explicit rename upsert omits the image columns', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation({
      upserts: [
        {
          id: 'exp-1',
          upstreamEntityId: 'wdw:attraction:1',
          name: 'Space Mountain (renamed)',
          park: MAGIC_KINGDOM,
          category: RIDE,
          description: 'Indoor roller coaster.',
          active: true,
        },
      ],
      softDeletes: [],
    });

    const insert = pool.calls.find((c) =>
      /INSERT INTO experiences/i.test(c.text),
    );
    expect(insert).toBeDefined();
    expect(IMAGE_COLUMN_PATTERN.test(insert?.text ?? '')).toBe(false);
    expect(insert?.params).toHaveLength(6);
  });

  it('an explicit soft-delete omits the image columns', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation({
      upserts: [],
      softDeletes: [{ id: 'exp-1' }],
    });

    const update = pool.calls.find((c) =>
      /UPDATE experiences/i.test(c.text),
    );
    expect(update).toBeDefined();
    expect(IMAGE_COLUMN_PATTERN.test(update?.text ?? '')).toBe(false);
    expect(update?.text).toMatch(/active = FALSE/);
  });
});
