// Feature: disney-facilities-catalog-source, Property 24: Catalog_Sync is the sole writer of image_url, sourced from Disney via reconciliation
/**
 * Property-based tests for Disney-sourced `image_url` flowing through catalog
 * reconciliation and being persisted by `applyReconciliation`.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 14.8, 14.9
 *
 * Property (design.md → "Behavior change — `image_url` now flows through
 * reconciliation" and Correctness Property 24):
 *
 *   In the retired ThemeParks.wiki design, `applyReconciliation` deliberately
 *   NEVER touched `image_url`/`image_attribution`: imagery was owned by an
 *   out-of-band sourcing job, so the reconcile write paths left those columns
 *   alone. With the Disney sources that job is gone, `image_url` is
 *   Disney-provided (R7), and `image_attribution` is dropped (R14.8). This
 *   suite asserts the INVERTED behavior:
 *
 *     (1) `image_url` now flows end-to-end: for any Facility_Document set,
 *         `selectImageUrl(doc)` → `reconcile` diff → `applyReconciliation`
 *         writes that exact value. The experience upsert's INSERT column list
 *         INCLUDES `image_url`, and the parameter carried at its position
 *         equals `selectImageUrl(doc)` — making Catalog_Sync the sole writer of
 *         `image_url` (R7.1, R7.2, R7.3, R14.9).
 *     (2) `image_attribution` is gone: no SQL statement issued by
 *         `applyReconciliation` mentions it anywhere, and no attribution value
 *         is persisted (R14.8).
 *     (3) A soft-delete still touches only `active`/`updated_at`; it does not
 *         (re)write `image_url`, so a soft-delete never clobbers the
 *         Disney-sourced image of a row it preserves.
 *
 * There is no live Postgres in unit tests, so `applyReconciliation` is driven
 * over generated reconcile diffs with an in-memory fake `pg` pool (the same
 * pattern `repo.test.ts` uses) that records every SQL `text` + `params`.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { createCatalogRepo } from '../repo.js';
import { reconcile } from '../reconcile.js';
import { selectImageUrl } from '../disney/imagery.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import type {
  CatalogDiff,
  ReconcileResult,
  ReconcileSoftDelete,
  ReconcileUpsert,
  ResortReconcileResult,
  UpstreamExperience,
} from '../types.js';

const NUM_RUNS = 100;

/** The attribution column is dropped entirely (R14.8); it must never appear. */
const ATTRIBUTION_PATTERN = /image_attribution|imageAttribution/i;
/** The experience upsert must reference `image_url` (R14.9). */
const IMAGE_URL_PATTERN = /image_url/i;

/** An empty Resort reconcile arm — these tests focus on the Experience path. */
const EMPTY_RESORTS: ResortReconcileResult = { upserts: [], softDeletes: [] };

/** Wrap an Experience reconcile result into the combined {@link CatalogDiff}. */
function toCatalogDiff(experiences: ReconcileResult): CatalogDiff {
  return { experiences, resorts: EMPTY_RESORTS };
}

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

/**
 * A candidate image field spanning the full R7 input space: absent, empty, and
 * whitespace-only (all → no image source, R7.3), plus genuine URLs (some padded
 * to prove `selectImageUrl` trims, R7.1/7.2).
 */
const imageField: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.constantFrom(
    'https://cdn.disney.com/detail.jpg',
    '  https://cdn.disney.com/list.png  ',
    'https://cdn.disney.com/hero.webp',
  ),
);

/**
 * Build a Facility_Document carrying only the two image fields, setting each
 * one *only when defined* so the result satisfies `exactOptionalPropertyTypes`.
 */
function imageDoc(
  detailImageUrl: string | undefined,
  listImageUrl: string | undefined,
): FacilityDocument {
  const doc: {
    id: string;
    detailImageUrl?: string;
    listImageUrl?: string;
  } = { id: '80010177;entityType=Attraction' };
  if (detailImageUrl !== undefined) doc.detailImageUrl = detailImageUrl;
  if (listImageUrl !== undefined) doc.listImageUrl = listImageUrl;
  return doc;
}

const facilityDocArb: fc.Arbitrary<FacilityDocument> = fc
  .record({ detailImageUrl: imageField, listImageUrl: imageField })
  .map((f) => imageDoc(f.detailImageUrl, f.listImageUrl));

/**
 * A fully-classified upstream Experience whose `imageUrl` is sourced from
 * Disney via `selectImageUrl(doc)` — exactly what the orchestrator does before
 * calling reconcile. The remaining enrichment fields are held at their "not
 * persisted" defaults; this property targets only the imagery write path.
 */
const upstreamExperienceArb: fc.Arbitrary<UpstreamExperience> = fc
  .record({
    id: internalId,
    upstreamEntityId,
    name,
    park,
    category,
    description,
    doc: facilityDocArb,
  })
  .map((r) => ({
    id: r.id,
    upstreamEntityId: r.upstreamEntityId,
    name: r.name,
    park: r.park,
    category: r.category,
    land: null,
    description: r.description,
    imageUrl: selectImageUrl(r.doc),
    areaType: 'ThemePark' as const,
    resortId: null,
    latitude: null,
    longitude: null,
    accessibility: [] as readonly string[],
    priceTier: null,
    mealPeriods: [],
  }));

const softDeleteArb: fc.Arbitrary<ReconcileSoftDelete> = fc.record({
  id: internalId,
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

describe('applyReconciliation — Property 24: image_url is Disney-sourced and written by reconciliation', () => {
  it('never references image_attribution in any reconcile statement (R14.8)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(upstreamExperienceArb, {
          maxLength: 12,
          selector: (e) => e.id,
        }),
        fc.array(softDeleteArb, { maxLength: 12 }),
        async (upstream, softDeletes) => {
          const pool = makePool();
          const repo = createCatalogRepo(pool as never);

          // An empty cache inserts every upstream row; the generated
          // soft-deletes are layered on to exercise both write paths.
          const diff: ReconcileResult = {
            upserts: reconcile([], upstream).upserts,
            softDeletes,
          };
          await repo.applyReconciliation(toCatalogDiff(diff));

          // The dropped attribution column appears in no statement.
          for (const call of pool.calls) {
            expect(
              ATTRIBUTION_PATTERN.test(call.text),
              `statement must not reference image_attribution: ${call.text}`,
            ).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('writes each upsert\'s Disney-sourced image_url through the INSERT (R7.1-R7.3, R14.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(upstreamExperienceArb, {
          minLength: 1,
          maxLength: 12,
          selector: (e) => e.id,
        }),
        async (upstream) => {
          const pool = makePool();
          const repo = createCatalogRepo(pool as never);

          const diff = reconcile([], upstream);
          await repo.applyReconciliation(toCatalogDiff(diff));

          const inserts = pool.calls.filter((c) =>
            /INSERT INTO experiences/i.test(c.text),
          );
          // One INSERT per upsert (an empty cache inserts every upstream row).
          expect(inserts).toHaveLength(upstream.length);

          // The upserts preserve upstream order, so the INSERTs line up with
          // the upstream entities index-for-index.
          inserts.forEach((insert, i) => {
            const columns = insertColumns(insert.text);
            // image_url IS in the column list — reconciliation now writes it.
            expect(
              columns.some((c) => IMAGE_URL_PATTERN.test(c)),
              `INSERT column list must include image_url: ${columns.join(', ')}`,
            ).toBe(true);
            // And the attribution column is absent.
            expect(
              columns.some((c) => ATTRIBUTION_PATTERN.test(c)),
              `INSERT column list must omit image_attribution: ${columns.join(', ')}`,
            ).toBe(false);

            // The image_url parameter (7th param: id, upstream_entity_id, name,
            // park, category, description, image_url, ...) equals
            // selectImageUrl(doc) as carried by the diff.
            const expectedImageUrl = diff.upserts[i]?.imageUrl ?? null;
            expect(insert.params[6]).toBe(expectedImageUrl);
            expect(insert.params[6] === null || typeof insert.params[6] === 'string').toBe(true);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('soft-deletes touch only active/updated_at, never the image columns (R14.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(softDeleteArb, { minLength: 1, maxLength: 12 }),
        async (softDeletes) => {
          const pool = makePool();
          const repo = createCatalogRepo(pool as never);

          await repo.applyReconciliation(
            toCatalogDiff({ upserts: [], softDeletes }),
          );

          const updates = pool.calls.filter((c) =>
            /UPDATE experiences/i.test(c.text),
          );
          expect(updates).toHaveLength(softDeletes.length);

          for (const update of updates) {
            // A soft-delete never rewrites image_url, so it cannot clobber a
            // Disney-sourced image on the preserved row.
            expect(IMAGE_URL_PATTERN.test(update.text)).toBe(false);
            expect(ATTRIBUTION_PATTERN.test(update.text)).toBe(false);
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

function experienceUpsert(
  override: Partial<ReconcileUpsert> = {},
): ReconcileUpsert {
  return {
    id: 'exp-1',
    upstreamEntityId: 'wdw:attraction:1',
    name: 'Space Mountain',
    park: MAGIC_KINGDOM,
    category: RIDE,
    land: null,
    description: 'Indoor roller coaster.',
    imageUrl: 'https://cdn.disney.com/space.jpg',
    areaType: 'ThemePark',
    resortId: null,
    latitude: null,
    longitude: null,
    accessibility: [],
    priceTier: null,
    mealPeriods: [],
    active: true,
    ...override,
  };
}

describe('applyReconciliation — image sourcing fixed examples', () => {
  it('writes the Disney detailImageUrl through the upsert and omits attribution', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation(
      toCatalogDiff({
        upserts: [experienceUpsert({ imageUrl: 'https://cdn.disney.com/a.jpg' })],
        softDeletes: [],
      }),
    );

    const insert = pool.calls.find((c) =>
      /INSERT INTO experiences/i.test(c.text),
    );
    expect(insert).toBeDefined();
    expect(IMAGE_URL_PATTERN.test(insert?.text ?? '')).toBe(true);
    expect(ATTRIBUTION_PATTERN.test(insert?.text ?? '')).toBe(false);
    // 7th parameter carries the Disney image URL.
    expect(insert?.params[6]).toBe('https://cdn.disney.com/a.jpg');
  });

  it('writes null image_url when the document had no image source (R7.3)', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation(
      toCatalogDiff({
        upserts: [experienceUpsert({ imageUrl: null })],
        softDeletes: [],
      }),
    );

    const insert = pool.calls.find((c) =>
      /INSERT INTO experiences/i.test(c.text),
    );
    expect(insert).toBeDefined();
    expect(insert?.params[6]).toBeNull();
  });

  it('an explicit soft-delete omits both image columns', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation(
      toCatalogDiff({ upserts: [], softDeletes: [{ id: 'exp-1' }] }),
    );

    const update = pool.calls.find((c) =>
      /UPDATE experiences/i.test(c.text),
    );
    expect(update).toBeDefined();
    expect(IMAGE_URL_PATTERN.test(update?.text ?? '')).toBe(false);
    expect(ATTRIBUTION_PATTERN.test(update?.text ?? '')).toBe(false);
    expect(update?.text).toMatch(/active = FALSE/);
  });
});
