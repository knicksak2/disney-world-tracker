// Feature: catalog-navigation-redesign, Properties 4-6: Land reconciliation
/**
 * Property-based tests for Land reconciliation in the pure `reconcile` core
 * (`reconcile.ts`). Land joins the Experience upsert payload and the
 * change-detection predicate exactly the way the other Disney fields do, so a
 * Land drift triggers an upsert, an equal Land is a no-op, repeated syncs are
 * idempotent, and a soft-delete/reactivate cycle preserves both the persisted
 * Land and the Internal_Id.
 *
 *   Property 4 — Drift triggers upsert / equality is a no-op:
 *     A cached Experience row that is identical to upstream except for its Land
 *     is upserted so the persisted Land equals the resolved Land (R2.4). A
 *     cached row equal in every change-detected field, Land included, produces
 *     no diff (R2.5).
 *
 *   Property 5 — Idempotence:
 *     Two or more consecutive syncs over the same upstream set leave the same
 *     persisted Land for every Experience; the second and third runs produce an
 *     empty diff (R2.6).
 *
 *   Property 6 — Soft-delete/reactivate retention:
 *     Soft-deleting an Experience (absent from upstream) preserves its row, its
 *     Internal_Id, and its persisted Land; reactivating it (reappearing
 *     upstream) preserves the Internal_Id and re-writes the resolved Land (R2.7).
 *
 * Validates: Requirements 2.4, 2.5, 2.6, 2.7
 *
 * These suites target the pure diff logic in isolation — no database, no clock,
 * no id derivation — mirroring the fast-check + vitest conventions of the
 * sibling reconcile property suite. `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { reconcile } from '../reconcile.js';
import type {
  CatalogCacheRow,
  ReconcileResult,
  UpstreamExperience,
} from '../types.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const internalId = fc.integer({ min: 0, max: 1_000_000 }).map((n) => `id-${n}`);
const park: fc.Arbitrary<Park | null> = fc.option(fc.constantFrom(...PARKS), {
  nil: null,
});
const category: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const name = fc.string({ minLength: 1, maxLength: 24 });

/**
 * A Land value spanning the full persisted input space: `null` (no Land) plus a
 * pool of representative Land names. Distinct names let the drift generator pick
 * an unequal pair, and reusing the pool keeps equality cases genuinely equal.
 */
const land: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom(
    'Fantasyland',
    'Tomorrowland',
    'Adventureland',
    'Frontierland',
    'World Showcase',
    'Pandora - The World of Avatar',
    'Toy Story Land',
  ),
  { nil: null },
);

/**
 * Build a fully-classified upstream Experience. The enrichment/area/imagery
 * fields are held at neutral "not persisted" defaults because these properties
 * exercise only the Land change-detection path.
 */
function makeUpstream(
  id: string,
  n: string,
  pk: Park | null,
  cat: ExperienceCategory,
  landValue: string | null,
): UpstreamExperience {
  return {
    id,
    upstreamEntityId: `up-${id}`,
    name: n,
    park: pk,
    category: cat,
    land: landValue,
    description: 'Alpha',
    imageUrl: null,
    areaType: 'ThemePark',
    resortId: null,
    representsResortId: null,
    resortArea: null,
    worldShowcaseCountry: null,
    latitude: null,
    longitude: null,
    accessibility: [],
    priceTier: null,
    mealPeriods: [],
    groupedFacets: {},
    heightRequirement: null,
    whyThis: null,
    subType: null,
  };
}

/** Build the change-detection projection of a persisted `experiences` row. */
function makeCacheRow(
  id: string,
  active: boolean,
  n: string,
  pk: Park | null,
  cat: ExperienceCategory,
  landValue: string | null,
): CatalogCacheRow {
  return {
    id,
    active,
    name: n,
    park: pk,
    category: cat,
    land: landValue,
    areaType: 'ThemePark',
    resortId: null,
    resortArea: null,
    worldShowcaseCountry: null,
    representsResortId: null,
  };
}

/**
 * Apply an Experience diff the way the repo's SQL caller is specified to: an
 * upsert rewrites the full row state (Land included), a soft-delete flips only
 * `active`. Returns the next cache snapshot so a subsequent `reconcile` sees the
 * persisted result.
 */
function applyDiff(
  cache: readonly CatalogCacheRow[],
  diff: ReconcileResult,
): CatalogCacheRow[] {
  const next = new Map<string, CatalogCacheRow>();
  for (const row of cache) next.set(row.id, row);
  for (const u of diff.upserts) {
    next.set(u.id, {
      id: u.id,
      active: u.active,
      name: u.name,
      park: u.park,
      category: u.category,
      land: u.land,
      areaType: u.areaType,
      resortId: u.resortId,
      resortArea: u.resortArea,
      worldShowcaseCountry: u.worldShowcaseCountry,
      representsResortId: u.representsResortId,
    });
  }
  for (const d of diff.softDeletes) {
    const existing = next.get(d.id);
    if (existing !== undefined) next.set(d.id, { ...existing, active: false });
  }
  return [...next.values()];
}

// ===========================================================================
// Property 4 — Drift triggers upsert / equality is a no-op (R2.4, R2.5)
// ===========================================================================

describe('reconcile — Property 4: Land drift triggers upsert, equal Land is a no-op', () => {
  it('upserts an active row whose Land drifts, to the resolved Land (R2.4)', () => {
    fc.assert(
      fc.property(
        fc
          .record({
            id: internalId,
            name,
            park,
            category,
            cachedLand: land,
            resolvedLand: land,
          })
          // Only Land differs: name/park/category mirror upstream, so the diff
          // is attributable to Land alone.
          .filter((r) => r.cachedLand !== r.resolvedLand),
        (r) => {
          const cache = [
            makeCacheRow(r.id, true, r.name, r.park, r.category, r.cachedLand),
          ];
          const upstream = [
            makeUpstream(r.id, r.name, r.park, r.category, r.resolvedLand),
          ];

          const diff = reconcile(cache, upstream);

          expect(diff.softDeletes).toEqual([]);
          expect(diff.upserts).toHaveLength(1);
          const u = diff.upserts[0];
          expect(u?.id).toBe(r.id);
          expect(u?.active).toBe(true);
          // The persisted Land is corrected to the resolved value (R2.4).
          expect(u?.land).toBe(r.resolvedLand);

          // And after applying, the persisted Land equals the resolved Land.
          const after = applyDiff(cache, diff);
          expect(after.find((x) => x.id === r.id)?.land).toBe(r.resolvedLand);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no diff when the persisted Land already equals the resolved Land (R2.5)', () => {
    fc.assert(
      fc.property(
        fc.record({ id: internalId, name, park, category, land }),
        (r) => {
          const cache = [
            makeCacheRow(r.id, true, r.name, r.park, r.category, r.land),
          ];
          const upstream = [
            makeUpstream(r.id, r.name, r.park, r.category, r.land),
          ];

          const diff = reconcile(cache, upstream);

          expect(diff.upserts).toEqual([]);
          expect(diff.softDeletes).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 5 — Idempotence (R2.6)
// ===========================================================================

describe('reconcile — Property 5: repeated syncs over unchanged docs are idempotent for Land', () => {
  const scenario = fc.uniqueArray(
    fc.record({ id: internalId, name, park, category, land }),
    { minLength: 0, maxLength: 25, selector: (r) => r.id },
  );

  it('two or more consecutive syncs leave the same persisted Land (R2.6)', () => {
    fc.assert(
      fc.property(scenario, (rows) => {
        const upstream = rows.map((r) =>
          makeUpstream(r.id, r.name, r.park, r.category, r.land),
        );

        // First sync from an empty cache inserts every Experience.
        const first = reconcile([], upstream);
        const cache1 = applyDiff([], first);

        // Second sync over the unchanged docs must be a no-op.
        const second = reconcile(cache1, upstream);
        expect(second.upserts).toEqual([]);
        expect(second.softDeletes).toEqual([]);

        // Third sync too — idempotence holds for two *or more* runs.
        const cache2 = applyDiff(cache1, second);
        const third = reconcile(cache2, upstream);
        expect(third.upserts).toEqual([]);
        expect(third.softDeletes).toEqual([]);

        // Every persisted Land equals the resolved Land after each run.
        const byId = new Map(cache2.map((row) => [row.id, row]));
        for (const u of upstream) {
          expect(byId.get(u.id)?.land).toBe(u.land);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 6 — Soft-delete/reactivate retention (R2.7)
// ===========================================================================

describe('reconcile — Property 6: soft-delete then reactivate preserves Land and Internal_Id', () => {
  it('soft-delete retains the row/Land/id; reactivation re-writes the resolved Land (R2.7)', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: internalId,
          name,
          park,
          category,
          persistedLand: land,
          resolvedLand: land,
        }),
        (r) => {
          const cache0 = [
            makeCacheRow(r.id, true, r.name, r.park, r.category, r.persistedLand),
          ];

          // --- Sync 1: Experience absent from upstream -> soft-delete --------
          const diff1 = reconcile(cache0, []);
          expect(diff1.upserts).toEqual([]);
          expect(diff1.softDeletes).toEqual([{ id: r.id }]);

          const cache1 = applyDiff(cache0, diff1);
          const soft = cache1.find((x) => x.id === r.id);
          // The row is preserved (not deleted), only deactivated, with its
          // Internal_Id and persisted Land intact through the soft-delete.
          expect(soft).toBeDefined();
          expect(soft?.id).toBe(r.id);
          expect(soft?.active).toBe(false);
          expect(soft?.land).toBe(r.persistedLand);

          // --- Sync 2: Experience reappears upstream -> reactivation ---------
          const upstream = [
            makeUpstream(r.id, r.name, r.park, r.category, r.resolvedLand),
          ];
          const diff2 = reconcile(cache1, upstream);
          expect(diff2.softDeletes).toEqual([]);
          expect(diff2.upserts).toHaveLength(1);
          const u = diff2.upserts[0];
          // Same Internal_Id, reactivated, Land re-written to the resolved value.
          expect(u?.id).toBe(r.id);
          expect(u?.active).toBe(true);
          expect(u?.land).toBe(r.resolvedLand);

          const cache2 = applyDiff(cache1, diff2);
          const reactivated = cache2.find((x) => x.id === r.id);
          expect(reactivated?.id).toBe(r.id);
          expect(reactivated?.active).toBe(true);
          expect(reactivated?.land).toBe(r.resolvedLand);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Fixed regression examples
// ===========================================================================

describe('reconcile — Land reconciliation fixed examples', () => {
  const base = (landValue: string | null): UpstreamExperience =>
    makeUpstream('exp-1', 'Space Mountain', 'Magic Kingdom', 'Ride', landValue);

  it('a null->named Land drift upserts the resolved Land (R2.4)', () => {
    const cache: CatalogCacheRow[] = [
      makeCacheRow('exp-1', true, 'Space Mountain', 'Magic Kingdom', 'Ride', null),
    ];
    const diff = reconcile(cache, [base('Tomorrowland')]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({ id: 'exp-1', land: 'Tomorrowland' });
  });

  it('a named->null Land drift upserts null (R2.4)', () => {
    const cache: CatalogCacheRow[] = [
      makeCacheRow('exp-1', true, 'Space Mountain', 'Magic Kingdom', 'Ride', 'Tomorrowland'),
    ];
    const diff = reconcile(cache, [base(null)]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]?.land).toBeNull();
  });

  it('an unchanged named Land is a no-op (R2.5)', () => {
    const cache: CatalogCacheRow[] = [
      makeCacheRow('exp-1', true, 'Space Mountain', 'Magic Kingdom', 'Ride', 'Tomorrowland'),
    ];
    const diff = reconcile(cache, [base('Tomorrowland')]);
    expect(diff.upserts).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });

  it('soft-delete preserves Land, reactivation restores the same id (R2.7)', () => {
    const cache: CatalogCacheRow[] = [
      makeCacheRow('exp-1', true, 'Space Mountain', 'Magic Kingdom', 'Ride', 'Tomorrowland'),
    ];
    const del = reconcile(cache, []);
    expect(del.softDeletes).toEqual([{ id: 'exp-1' }]);
    const afterDelete = applyDiff(cache, del);
    expect(afterDelete[0]).toMatchObject({ id: 'exp-1', active: false, land: 'Tomorrowland' });

    const react = reconcile(afterDelete, [base('Tomorrowland')]);
    expect(react.upserts[0]).toMatchObject({ id: 'exp-1', active: true, land: 'Tomorrowland' });
  });

  it('a resortId drift (catch-all -> specific resort) triggers an upsert (R4.14)', () => {
    // A resort restaurant already cached with no specific resort (the R4.15
    // resort-wide catch-all), now re-resolved to a specific resort. Only the
    // resortId differs, so this exercises the resortId change-detection signal.
    const resortExp = (
      resortId: string | null,
      resortArea: string | null,
    ): UpstreamExperience => ({
      id: 'exp-1',
      upstreamEntityId: 'up-exp-1',
      name: 'Kimonos Lounge',
      park: null,
      category: 'Restaurant',
      land: null,
      description: 'Alpha',
      imageUrl: null,
      areaType: 'Resort',
      resortId,
      representsResortId: null,
      resortArea,
      worldShowcaseCountry: null,
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
      groupedFacets: {},
      heightRequirement: null,
      whyThis: null,
      subType: null,
    });
    const cache: CatalogCacheRow[] = [
      {
        id: 'exp-1',
        active: true,
        name: 'Kimonos Lounge',
        park: null,
        category: 'Restaurant',
        land: null,
        areaType: 'Resort',
        resortId: null,
        resortArea: 'EPCOT Resort Area',
        worldShowcaseCountry: null,
        representsResortId: null,
      },
    ];
    const diff = reconcile(cache, [resortExp('resort-swan', 'EPCOT Resort Area')]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({ id: 'exp-1', resortId: 'resort-swan' });
  });

  it('a resortArea drift (null -> resolved zone) triggers an upsert', () => {
    const cache: CatalogCacheRow[] = [
      {
        id: 'exp-1',
        active: true,
        name: 'Kimonos Lounge',
        park: null,
        category: 'Restaurant',
        land: null,
        areaType: 'Resort',
        resortId: 'resort-swan',
        resortArea: null,
        worldShowcaseCountry: null,
        representsResortId: null,
      },
    ];
    const upstream: UpstreamExperience = {
      id: 'exp-1',
      upstreamEntityId: 'up-exp-1',
      name: 'Kimonos Lounge',
      park: null,
      category: 'Restaurant',
      land: null,
      description: 'Alpha',
      imageUrl: null,
      areaType: 'Resort',
      resortId: 'resort-swan',
      representsResortId: null,
      resortArea: 'EPCOT Resort Area',
      worldShowcaseCountry: null,
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
      groupedFacets: {},
      heightRequirement: null,
      whyThis: null,
      subType: null,
    };
    const diff = reconcile(cache, [upstream]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({
      id: 'exp-1',
      resortArea: 'EPCOT Resort Area',
    });
  });

  it('an areaType drift (Resort -> ThemePark) triggers an upsert (R4.11)', () => {
    const cache: CatalogCacheRow[] = [
      {
        id: 'exp-1',
        active: true,
        name: 'Storybook Treats',
        park: 'Magic Kingdom',
        category: 'Restaurant',
        land: null,
        areaType: 'Resort',
        resortId: null,
        resortArea: 'Magic Kingdom Resort Area',
        worldShowcaseCountry: null,
        representsResortId: null,
      },
    ];
    const upstream: UpstreamExperience = {
      id: 'exp-1',
      upstreamEntityId: 'up-exp-1',
      name: 'Storybook Treats',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      land: null,
      description: 'Alpha',
      imageUrl: null,
      areaType: 'ThemePark',
      resortId: null,
      representsResortId: null,
      resortArea: null,
      worldShowcaseCountry: null,
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
      groupedFacets: {},
      heightRequirement: null,
      whyThis: null,
      subType: null,
    };
    const diff = reconcile(cache, [upstream]);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({ id: 'exp-1', areaType: 'ThemePark' });
  });

  it('unchanged areaType, resortId, and resortArea is a no-op (R4.11, R4.14)', () => {
    const cache: CatalogCacheRow[] = [
      {
        id: 'exp-1',
        active: true,
        name: 'Kimonos Lounge',
        park: null,
        category: 'Restaurant',
        land: null,
        areaType: 'Resort',
        resortId: 'resort-swan',
        resortArea: 'EPCOT Resort Area',
        worldShowcaseCountry: null,
        representsResortId: null,
      },
    ];
    const upstream: UpstreamExperience = {
      id: 'exp-1',
      upstreamEntityId: 'up-exp-1',
      name: 'Kimonos Lounge',
      park: null,
      category: 'Restaurant',
      land: null,
      description: 'Alpha',
      imageUrl: null,
      areaType: 'Resort',
      resortId: 'resort-swan',
      representsResortId: null,
      resortArea: 'EPCOT Resort Area',
      worldShowcaseCountry: null,
      latitude: null,
      longitude: null,
      accessibility: [],
      priceTier: null,
      mealPeriods: [],
      groupedFacets: {},
      heightRequirement: null,
      whyThis: null,
      subType: null,
    };
    const diff = reconcile(cache, [upstream]);
    expect(diff.upserts).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });
});
