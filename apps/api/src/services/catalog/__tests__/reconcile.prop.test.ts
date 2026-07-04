// Feature: disney-facilities-catalog-source, Property 13: Reconciliation diff rules hold for both Experiences and Resorts
/**
 * Property-based tests for the pure reconciliation core
 * (`reconcile` / `reconcileResorts` / `reconcileCatalog`, `reconcile.ts`).
 *
 * Property 13 (design.md → Correctness Properties):
 *
 *   For any cache snapshot and upstream set (of Experiences *or* Resorts),
 *   `reconcile` emits:
 *     - an active INSERT for each upstream id absent from the cache (R11.1);
 *     - a REACTIVATION preserving the same internal id for each upstream id
 *       present as a soft-deleted row (R11.2 / R6.10);
 *     - an UPSERT to upstream values for each active row whose
 *       `name`/`park`/`category` (Experiences) or resort descriptive fields
 *       (Resorts) differ (R11.3, R6.3-R6.5);
 *     - NO CHANGE for each active row that already equals upstream (R11.4);
 *     - a SOFT-DELETE preserving the row and its internal id for each active
 *       cached row absent from upstream (R11.5 / R6.9 / R10.6).
 *
 * Validates: Requirements 6.9, 6.10, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5
 *
 * This is the Disney-sourced successor to the retired ThemeParks.wiki
 * reconcile property suite: the Experience arm now carries the enrichment /
 * area / imagery fields through the diff, and a parallel Resort arm exercises
 * the identical insert / reactivate / upsert / no-change / soft-delete rules
 * over the Resort descriptive fields.
 *
 * `numRuns: 100` per the spec convention.
 *
 * NOTE: this file is shared with Property 24 (image_url sole-writer); that
 * property lives in its own top-level `describe` block appended below this
 * one so the two suites stay independent.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type {
  AreaType,
  ExperienceCategory,
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  MealPeriodDTO,
  Park,
  WhyThisDTO,
} from '@dwt/shared';

import { reconcile, reconcileResorts, reconcileCatalog } from '../reconcile.js';
import { selectImageUrl } from '../disney/imagery.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import type {
  CatalogCacheRow,
  ReconcileResult,
  ResortCacheRow,
  ResortReconcileResult,
  UpstreamExperience,
  UpstreamResort,
} from '../types.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------
//
// Both the Experience and the Resort arm are built from the same six-way
// "presence" fact sheet so the assertions can name each diff rule directly
// without re-implementing `reconcile`:
//
//   - 'cache-only-active'   → active cache row missing upstream → soft-delete
//   - 'cache-only-inactive' → inactive cache row missing upstream → no-op
//   - 'upstream-only'       → upstream id missing from cache → insert
//   - 'both-active-same'    → active cache row matching upstream → no-op
//   - 'both-active-drift'   → active cache row drifted vs upstream → upsert
//   - 'both-inactive'       → soft-deleted cache row reappears upstream → reactivate

type Presence =
  | 'cache-only-active'
  | 'cache-only-inactive'
  | 'upstream-only'
  | 'both-active-same'
  | 'both-active-drift'
  | 'both-inactive';

const presence: fc.Arbitrary<Presence> = fc.constantFrom(
  'cache-only-active',
  'cache-only-inactive',
  'upstream-only',
  'both-active-same',
  'both-active-drift',
  'both-inactive',
);

const internalId = fc.integer({ min: 0, max: 1_000_000 }).map((n) => `id-${n}`);

const park: fc.Arbitrary<Park | null> = fc.option(fc.constantFrom(...PARKS), {
  nil: null,
});
const category: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const areaType: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);
const name = fc.string({ minLength: 1, maxLength: 24 });

// Descriptions / addresses / phones / image urls are drawn from a "clean"
// pool that `sanitizeDescription` leaves byte-for-byte unchanged (no tags, no
// entities, no leading/trailing/collapsible whitespace). That keeps the Resort
// description drift comparison — which compares against the *sanitized* form —
// free of spurious drift when a cache row is meant to mirror upstream exactly.
const cleanText = fc.constantFrom(
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Grand Floridian',
  'Polynesian Village',
  'Contemporary',
);
const cleanTextOrNull: fc.Arbitrary<string | null> = fc.option(cleanText, {
  nil: null,
});
const urlOrNull: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom(
    'https://cdn.disney.com/a.jpg',
    'https://cdn.disney.com/b.png',
    'https://cdn.disney.com/c.webp',
  ),
  { nil: null },
);
const coord: fc.Arbitrary<number | null> = fc.option(
  fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
  { nil: null },
);
const mealPeriods: fc.Arbitrary<readonly MealPeriodDTO[]> = fc.array(
  fc.record({
    type: fc.string({ minLength: 1, maxLength: 8 }),
    priceTier: fc.option(fc.constantFrom('$', '$$', '$$$'), { nil: null }),
  }),
  { maxLength: 3 },
);

// ---------------------------------------------------------------------------
// Enrichment field generators (Property 12 carry-through)
// ---------------------------------------------------------------------------
//
// The four persisted enrichment values that `toExperienceUpsert` must copy
// straight from the upstream Experience: `groupedFacets`, `heightRequirement`,
// `whyThis`, and `subType`. These arbitraries span the full input space
// (empty/absent through richly populated) so Property 12 exercises every shape.

const facetValue: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ minLength: 1, maxLength: 24 }),
});

const groupedFacets: fc.Arbitrary<GroupedFacetsDTO> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.array(facetValue, { maxLength: 4 }),
  { maxKeys: 4 },
);

const heightRequirement: fc.Arbitrary<HeightRequirementDTO | null> = fc.option(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    name: fc.string({ minLength: 1, maxLength: 24 }),
    minInches: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    minCentimeters: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  }),
  { nil: null },
);

const whyThis: fc.Arbitrary<WhyThisDTO | null> = fc.option(
  fc.record({
    title: fc.option(fc.string({ maxLength: 24 }), { nil: null }),
    bullets: fc.array(fc.string({ maxLength: 24 }), { maxLength: 4 }),
    quotes: fc.array(fc.string({ maxLength: 24 }), { maxLength: 4 }),
  }),
  { nil: null },
);

const subType: fc.Arbitrary<string | null> = fc.option(
  fc.string({ minLength: 1, maxLength: 16 }),
  { nil: null },
);

function indexBy<T extends { readonly id: string }>(
  rows: readonly T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.id, r);
  return m;
}

// ===========================================================================
// Experience arm
// ===========================================================================

interface ExperiencePayload extends UpstreamExperience {
  readonly presence: Presence;
}

const experiencePayload: fc.Arbitrary<Omit<ExperiencePayload, 'id' | 'presence'>> =
  fc.record({
    upstreamEntityId: fc.string({ minLength: 1, maxLength: 24 }),
    name,
    park,
    category,
    // Land is defaulted to `null` here: this suite (Property 13) does not
    // exercise Land drift, so keeping both the cache row and the upstream row
    // at `null` leaves the name/park/category diff rules unchanged. Land's own
    // reconciliation (Properties 4-6) is covered in reconcileLand.prop.test.ts.
    land: fc.constant<string | null>(null),
    resortArea: fc.constant<string | null>(null),
    description: cleanText,
    imageUrl: urlOrNull,
    areaType,
    resortId: fc.option(internalId, { nil: null }),
    representsResortId: fc.constant<string | null>(null),
    latitude: coord,
    longitude: coord,
    accessibility: fc.array(fc.constantFrom('wheelchair-access', 'audio', 'ecv'), {
      maxLength: 3,
    }),
    priceTier: fc.option(fc.constantFrom('$', '$$', '$$$'), { nil: null }),
    mealPeriods,
    groupedFacets,
    heightRequirement,
    whyThis,
    subType,
  });

const experienceScenario: fc.Arbitrary<readonly ExperiencePayload[]> = fc
  .uniqueArray(internalId, { minLength: 0, maxLength: 25 })
  .chain((ids) =>
    fc
      .tuple(...ids.map(() => fc.tuple(presence, experiencePayload)))
      .map((rows) =>
        ids.map<ExperiencePayload>((id, i) => {
          const entry = rows[i];
          if (entry === undefined) {
            throw new Error('unreachable: empty experience payload at index');
          }
          const [p, payload] = entry;
          return { id, presence: p, ...payload };
        }),
      ),
  );

function buildExperienceCache(
  facts: readonly ExperiencePayload[],
): CatalogCacheRow[] {
  const out: CatalogCacheRow[] = [];
  for (const f of facts) {
    switch (f.presence) {
      case 'upstream-only':
        break;
      case 'both-active-same':
      case 'cache-only-active':
        out.push({
          id: f.id,
          active: true,
          name: f.name,
          park: f.park,
          category: f.category,
          land: f.land,
          areaType: f.areaType,
          resortId: f.resortId,
          resortArea: f.resortArea,
          representsResortId: f.representsResortId,
        });
        break;
      case 'both-active-drift':
        // Force drift on `name`; park/category/area still mirror upstream so
        // the ONLY difference is a change-detected field (R11.3).
        out.push({
          id: f.id,
          active: true,
          name: `${f.name}~old`,
          park: f.park,
          category: f.category,
          land: f.land,
          areaType: f.areaType,
          resortId: f.resortId,
          resortArea: f.resortArea,
          representsResortId: f.representsResortId,
        });
        break;
      case 'cache-only-inactive':
      case 'both-inactive':
        out.push({
          id: f.id,
          active: false,
          name: f.name,
          park: f.park,
          category: f.category,
          land: f.land,
          areaType: f.areaType,
          resortId: f.resortId,
          resortArea: f.resortArea,
          representsResortId: f.representsResortId,
        });
        break;
    }
  }
  return out;
}

function buildExperienceUpstream(
  facts: readonly ExperiencePayload[],
): UpstreamExperience[] {
  const out: UpstreamExperience[] = [];
  for (const f of facts) {
    if (
      f.presence === 'upstream-only' ||
      f.presence === 'both-active-same' ||
      f.presence === 'both-active-drift' ||
      f.presence === 'both-inactive'
    ) {
      const { presence: _presence, ...exp } = f;
      void _presence;
      out.push(exp);
    }
  }
  return out;
}

/** Apply an Experience diff the way the repo's SQL caller is specified to. */
function applyExperienceDiff(
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
// Resort arm
// ===========================================================================

interface ResortPayload extends UpstreamResort {
  readonly presence: Presence;
}

const resortPayload: fc.Arbitrary<Omit<ResortPayload, 'id' | 'presence'>> =
  fc.record({
    upstreamEntityId: fc.string({ minLength: 1, maxLength: 24 }),
    name,
    description: cleanTextOrNull,
    imageUrl: urlOrNull,
    latitude: coord,
    longitude: coord,
    address: cleanTextOrNull,
    phone: cleanTextOrNull,
  });

const resortScenario: fc.Arbitrary<readonly ResortPayload[]> = fc
  .uniqueArray(internalId, { minLength: 0, maxLength: 25 })
  .chain((ids) =>
    fc
      .tuple(...ids.map(() => fc.tuple(presence, resortPayload)))
      .map((rows) =>
        ids.map<ResortPayload>((id, i) => {
          const entry = rows[i];
          if (entry === undefined) {
            throw new Error('unreachable: empty resort payload at index');
          }
          const [p, payload] = entry;
          return { id, presence: p, ...payload };
        }),
      ),
  );

/**
 * A resort cache row that mirrors an upstream payload exactly. Because the
 * clean-text pool is sanitize-stable, the cached (already-sanitized)
 * description equals `sanitizeResortDescription(payload.description)`, so a
 * mirrored row reports no drift.
 */
function mirroredResortRow(
  f: ResortPayload,
  active: boolean,
): ResortCacheRow {
  return {
    id: f.id,
    active,
    name: f.name,
    description: f.description,
    imageUrl: f.imageUrl,
    latitude: f.latitude,
    longitude: f.longitude,
    address: f.address,
    phone: f.phone,
  };
}

function buildResortCache(facts: readonly ResortPayload[]): ResortCacheRow[] {
  const out: ResortCacheRow[] = [];
  for (const f of facts) {
    switch (f.presence) {
      case 'upstream-only':
        break;
      case 'both-active-same':
      case 'cache-only-active':
        out.push(mirroredResortRow(f, true));
        break;
      case 'both-active-drift':
        // Force drift on `name` only; every other field mirrors upstream so
        // the row differs from upstream on exactly one descriptive field.
        out.push({ ...mirroredResortRow(f, true), name: `${f.name}~old` });
        break;
      case 'cache-only-inactive':
      case 'both-inactive':
        out.push(mirroredResortRow(f, false));
        break;
    }
  }
  return out;
}

function buildResortUpstream(
  facts: readonly ResortPayload[],
): UpstreamResort[] {
  const out: UpstreamResort[] = [];
  for (const f of facts) {
    if (
      f.presence === 'upstream-only' ||
      f.presence === 'both-active-same' ||
      f.presence === 'both-active-drift' ||
      f.presence === 'both-inactive'
    ) {
      const { presence: _presence, ...resort } = f;
      void _presence;
      out.push(resort);
    }
  }
  return out;
}

/** Apply a Resort diff the way the repo's SQL caller is specified to. */
function applyResortDiff(
  cache: readonly ResortCacheRow[],
  diff: ResortReconcileResult,
): ResortCacheRow[] {
  const next = new Map<string, ResortCacheRow>();
  for (const row of cache) next.set(row.id, row);
  for (const u of diff.upserts) {
    next.set(u.id, {
      id: u.id,
      active: u.active,
      name: u.name,
      description: u.description,
      imageUrl: u.imageUrl,
      latitude: u.latitude,
      longitude: u.longitude,
      address: u.address,
      phone: u.phone,
    });
  }
  for (const d of diff.softDeletes) {
    const existing = next.get(d.id);
    if (existing !== undefined) next.set(d.id, { ...existing, active: false });
  }
  return [...next.values()];
}

// ===========================================================================
// Property 13 — Experience arm
// ===========================================================================

describe('reconcile — Property 13: Experience diff rules', () => {
  it('inserts every upstream id absent from the cache, active (R11.1)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const diff = reconcile(cache, buildExperienceUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'upstream-only') {
            const u = upserts.get(f.id);
            expect(u, `insert expected for ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            expect(u?.name).toBe(f.name);
            expect(u?.park).toBe(f.park);
            expect(u?.category).toBe(f.category);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reactivates soft-deleted rows that reappear upstream with the same id (R11.2)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const diff = reconcile(cache, buildExperienceUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'both-inactive') {
            const u = upserts.get(f.id);
            expect(u, `reactivation expected for ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            expect(u?.name).toBe(f.name);
            expect(u?.park).toBe(f.park);
            expect(u?.category).toBe(f.category);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('upserts active rows whose name/park/category drift, to upstream values (R11.3)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const diff = reconcile(cache, buildExperienceUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'both-active-drift') {
            const u = upserts.get(f.id);
            expect(u, `upsert expected for drifted ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            expect(u?.name).toBe(f.name);
            expect(u?.park).toBe(f.park);
            expect(u?.category).toBe(f.category);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves active rows that already equal upstream unchanged (R11.4)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const diff = reconcile(cache, buildExperienceUpstream(facts));
        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        const softDeleteIds = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'both-active-same') {
            expect(upsertIds.has(f.id)).toBe(false);
            expect(softDeleteIds.has(f.id)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('soft-deletes active cache rows absent from upstream, preserving the row/id (R11.5)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const upstream = buildExperienceUpstream(facts);
        const diff = reconcile(cache, upstream);
        const softDeletes = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'cache-only-active') {
            expect(
              softDeletes.has(f.id),
              `soft-delete expected for ${f.id}`,
            ).toBe(true);
          }
        }
        // The soft-deleted id is preserved (still present in the cache); a
        // soft-delete never targets an id that is still upstream.
        const cacheIds = new Set(cache.map((r) => r.id));
        const upstreamIds = new Set(upstream.map((u) => u.id));
        for (const id of softDeletes) {
          expect(cacheIds.has(id)).toBe(true);
          expect(upstreamIds.has(id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no diff for already-inactive rows still missing upstream (idempotency)', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const diff = reconcile(cache, buildExperienceUpstream(facts));
        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        const softDeleteIds = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'cache-only-inactive') {
            expect(upsertIds.has(f.id)).toBe(false);
            expect(softDeleteIds.has(f.id)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces disjoint, all-active upserts and re-running yields an empty diff', () => {
    fc.assert(
      fc.property(experienceScenario, (facts) => {
        const cache = buildExperienceCache(facts);
        const upstream = buildExperienceUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        for (const u of diff.upserts) expect(u.active).toBe(true);
        for (const d of diff.softDeletes) expect(upsertIds.has(d.id)).toBe(false);

        const second = reconcile(applyExperienceDiff(cache, diff), upstream);
        expect(second.upserts).toEqual([]);
        expect(second.softDeletes).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 13 — Resort arm
// ===========================================================================

describe('reconcileResorts — Property 13: Resort diff rules', () => {
  it('inserts every upstream resort absent from the cache, active (R6.9/R11.1)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const diff = reconcileResorts(cache, buildResortUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'upstream-only') {
            const u = upserts.get(f.id);
            expect(u, `insert expected for resort ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            expect(u?.name).toBe(f.name);
            expect(u?.imageUrl).toBe(f.imageUrl);
            expect(u?.latitude).toBe(f.latitude);
            expect(u?.longitude).toBe(f.longitude);
            expect(u?.address).toBe(f.address);
            expect(u?.phone).toBe(f.phone);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reactivates soft-deleted resorts that reappear upstream with the same id (R6.10)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const diff = reconcileResorts(cache, buildResortUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'both-inactive') {
            const u = upserts.get(f.id);
            expect(u, `reactivation expected for resort ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('upserts active resorts whose descriptive fields drift, to upstream values (R6.3-R6.5)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const diff = reconcileResorts(cache, buildResortUpstream(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (f.presence === 'both-active-drift') {
            const u = upserts.get(f.id);
            expect(u, `upsert expected for drifted resort ${f.id}`).toBeDefined();
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            // Drifted `name` is corrected back to the upstream value.
            expect(u?.name).toBe(f.name);
            expect(u?.imageUrl).toBe(f.imageUrl);
            expect(u?.address).toBe(f.address);
            expect(u?.phone).toBe(f.phone);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves active resorts that already equal upstream unchanged (R11.4)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const diff = reconcileResorts(cache, buildResortUpstream(facts));
        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        const softDeleteIds = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'both-active-same') {
            expect(upsertIds.has(f.id)).toBe(false);
            expect(softDeleteIds.has(f.id)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('soft-deletes active resorts absent from upstream, preserving the row/id (R6.9/R10.6)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const upstream = buildResortUpstream(facts);
        const diff = reconcileResorts(cache, upstream);
        const softDeletes = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'cache-only-active') {
            expect(
              softDeletes.has(f.id),
              `soft-delete expected for resort ${f.id}`,
            ).toBe(true);
          }
        }
        const cacheIds = new Set(cache.map((r) => r.id));
        const upstreamIds = new Set(upstream.map((u) => u.id));
        for (const id of softDeletes) {
          expect(cacheIds.has(id)).toBe(true);
          expect(upstreamIds.has(id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no diff for already-inactive resorts still missing upstream (idempotency)', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const diff = reconcileResorts(cache, buildResortUpstream(facts));
        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        const softDeleteIds = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          if (f.presence === 'cache-only-inactive') {
            expect(upsertIds.has(f.id)).toBe(false);
            expect(softDeleteIds.has(f.id)).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces disjoint, all-active upserts and re-running yields an empty diff', () => {
    fc.assert(
      fc.property(resortScenario, (facts) => {
        const cache = buildResortCache(facts);
        const upstream = buildResortUpstream(facts);
        const diff = reconcileResorts(cache, upstream);

        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        for (const u of diff.upserts) expect(u.active).toBe(true);
        for (const d of diff.softDeletes) expect(upsertIds.has(d.id)).toBe(false);

        const second = reconcileResorts(applyResortDiff(cache, diff), upstream);
        expect(second.upserts).toEqual([]);
        expect(second.softDeletes).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 13 — combined reconcileCatalog composition
// ===========================================================================

describe('reconcileCatalog — Property 13: combined composition', () => {
  it('composes the Experience and Resort diffs exactly as the individual functions do', () => {
    fc.assert(
      fc.property(
        experienceScenario,
        resortScenario,
        (expFacts, resortFacts) => {
          const snapshot = {
            experiences: buildExperienceCache(expFacts),
            resorts: buildResortCache(resortFacts),
          };
          const upstream = {
            experiences: buildExperienceUpstream(expFacts),
            resorts: buildResortUpstream(resortFacts),
          };

          const combined = reconcileCatalog(snapshot, upstream);

          expect(combined.experiences).toEqual(
            reconcile(snapshot.experiences, upstream.experiences),
          );
          expect(combined.resorts).toEqual(
            reconcileResorts(snapshot.resorts, upstream.resorts),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Fixed regression examples (both arms)
// ===========================================================================

describe('reconcile / reconcileResorts — Property 13 fixed examples', () => {
  const baseExperience: UpstreamExperience = {
    id: 'exp-1',
    upstreamEntityId: '80010177;entityType=Attraction',
    name: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    land: 'Tomorrowland',
    description: 'Indoor roller coaster.',
    imageUrl: 'https://cdn.disney.com/space.jpg',
    areaType: 'ThemePark',
    resortId: null,
    representsResortId: null,
    resortArea: null,
    latitude: 28.4,
    longitude: -81.6,
    accessibility: ['wheelchair-access'],
    priceTier: null,
    mealPeriods: [],
    groupedFacets: {},
    heightRequirement: null,
    whyThis: null,
    subType: null,
  };

  const baseResort: UpstreamResort = {
    id: 'res-1',
    upstreamEntityId: '80010407;entityType=Resort',
    name: 'Grand Floridian',
    description: 'Flagship resort.',
    imageUrl: 'https://cdn.disney.com/gf.jpg',
    latitude: 28.41,
    longitude: -81.58,
    address: '4401 Floridian Way',
    phone: '407-555-1000',
  };

  it('experience + resort empty inputs produce empty diffs', () => {
    expect(reconcile([], [])).toEqual({ upserts: [], softDeletes: [] });
    expect(reconcileResorts([], [])).toEqual({ upserts: [], softDeletes: [] });
  });

  it('inserts a brand-new experience and resort as active', () => {
    const exp = reconcile([], [baseExperience]);
    expect(exp.softDeletes).toEqual([]);
    expect(exp.upserts).toHaveLength(1);
    expect(exp.upserts[0]).toMatchObject({ id: 'exp-1', active: true });

    const res = reconcileResorts([], [baseResort]);
    expect(res.softDeletes).toEqual([]);
    expect(res.upserts).toHaveLength(1);
    expect(res.upserts[0]).toMatchObject({ id: 'res-1', active: true });
  });

  it('soft-deletes an active experience and resort missing from upstream', () => {
    const exp = reconcile(
      [{ id: 'exp-1', active: true, name: 'Old', park: 'EPCOT', category: 'Ride', land: null, areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null }],
      [],
    );
    expect(exp.upserts).toEqual([]);
    expect(exp.softDeletes).toEqual([{ id: 'exp-1' }]);

    const res = reconcileResorts(
      [
        {
          id: 'res-1',
          active: true,
          name: 'Old',
          description: null,
          imageUrl: null,
          latitude: null,
          longitude: null,
          address: null,
          phone: null,
        },
      ],
      [],
    );
    expect(res.upserts).toEqual([]);
    expect(res.softDeletes).toEqual([{ id: 'res-1' }]);
  });

  it('reactivates a soft-deleted experience and resort that reappear upstream', () => {
    const exp = reconcile(
      [{ id: 'exp-1', active: false, name: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride', land: 'Tomorrowland', areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null }],
      [baseExperience],
    );
    expect(exp.softDeletes).toEqual([]);
    expect(exp.upserts[0]).toMatchObject({ id: 'exp-1', active: true });

    const res = reconcileResorts(
      [
        {
          id: 'res-1',
          active: false,
          name: 'Grand Floridian',
          description: 'Flagship resort.',
          imageUrl: 'https://cdn.disney.com/gf.jpg',
          latitude: 28.41,
          longitude: -81.58,
          address: '4401 Floridian Way',
          phone: '407-555-1000',
        },
      ],
      [baseResort],
    );
    expect(res.softDeletes).toEqual([]);
    expect(res.upserts[0]).toMatchObject({ id: 'res-1', active: true });
  });

  it('does not diff an already-inactive experience/resort still missing upstream', () => {
    expect(
      reconcile(
        [{ id: 'exp-1', active: false, name: 'Old', park: 'EPCOT', category: 'Ride', land: null, areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null }],
        [],
      ),
    ).toEqual({ upserts: [], softDeletes: [] });

    expect(
      reconcileResorts(
        [
          {
            id: 'res-1',
            active: false,
            name: 'Old',
            description: null,
            imageUrl: null,
            latitude: null,
            longitude: null,
            address: null,
            phone: null,
          },
        ],
        [],
      ),
    ).toEqual({ upserts: [], softDeletes: [] });
  });
});

// ===========================================================================
// Property 12 — upsert carries the new enrichment fields through unchanged
// ===========================================================================
// Feature: experience-facet-enrichment, Property 12: Upsert carries the new enrichment fields through unchanged
/**
 * Property 12 (design.md → Correctness Properties):
 *
 *   For any UpstreamExperience, the ReconcileUpsert produced by
 *   `toExperienceUpsert` carries identical `groupedFacets`,
 *   `heightRequirement`, `whyThis`, and `subType` values.
 *
 * Validates: Requirements 12.1
 *
 * `toExperienceUpsert` is private to reconcile.ts, so it is exercised through
 * the exported `reconcile(currentCache, upstreamSet)` with an EMPTY cache:
 * every upstream Experience then takes the insert path and produces exactly one
 * upsert, letting the assertion compare each upsert's four enrichment fields
 * against its source upstream Experience by internal id.
 *
 * `numRuns: 100` per the spec convention (reuses the shared NUM_RUNS).
 */

const upstreamExperiencesForCarryThrough: fc.Arbitrary<
  readonly UpstreamExperience[]
> = fc
  .uniqueArray(internalId, { minLength: 0, maxLength: 25 })
  .chain((ids) =>
    fc.tuple(...ids.map(() => experiencePayload)).map((payloads) =>
      ids.map<UpstreamExperience>((id, i) => {
        const payload = payloads[i];
        if (payload === undefined) {
          throw new Error('unreachable: empty carry-through payload at index');
        }
        return { id, ...payload };
      }),
    ),
  );

describe('reconcile — Property 12: upsert carries new enrichment fields through unchanged', () => {
  it('copies groupedFacets/heightRequirement/whyThis/subType verbatim into every insert upsert (R12.1)', () => {
    fc.assert(
      fc.property(upstreamExperiencesForCarryThrough, (upstream) => {
        // Empty cache → every upstream id is absent → every one is inserted,
        // so there is exactly one upsert per upstream Experience.
        const diff = reconcile([], upstream);
        expect(diff.upserts).toHaveLength(upstream.length);
        expect(diff.softDeletes).toEqual([]);

        const upserts = indexBy(diff.upserts);
        for (const exp of upstream) {
          const u = upserts.get(exp.id);
          expect(u, `upsert expected for ${exp.id}`).toBeDefined();
          // The four persisted enrichment fields pass through unchanged.
          expect(u?.groupedFacets).toEqual(exp.groupedFacets);
          expect(u?.heightRequirement).toEqual(exp.heightRequirement);
          expect(u?.whyThis).toEqual(exp.whyThis);
          expect(u?.subType).toEqual(exp.subType);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 24 — image_url sole-writer via reconciliation
// ===========================================================================
// Feature: disney-facilities-catalog-source, Property 24: Catalog_Sync is the sole writer of image_url, sourced from Disney via reconciliation
/**
 * Property 24 (design.md → Correctness Properties):
 *
 *   For any upstream Facility_Document set and cache snapshot, after
 *   reconciliation the persisted `image_url` of every catalog item (Experience
 *   or Resort) equals `selectImageUrl` of its document — the non-empty
 *   `detailImageUrl`, else the non-empty `listImageUrl`, else `null` — set only
 *   through the `reconcile` → `applyReconciliation` path and by no other
 *   writer, and no `image_attribution` value is persisted.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 14.8, 14.9
 *
 * This suite composes the real `selectImageUrl` (imagery.ts) with the real
 * `reconcile`/`reconcileResorts` (reconcile.ts) so the end-to-end sourcing —
 * Disney Facility_Document → `selectImageUrl` → reconcile diff → applied
 * `image_url` — is exercised as one pipeline. It lives in its own top-level
 * describe blocks, fully independent of the Property 13 suites above.
 *
 * `numRuns: 100` per the spec convention (reuses the shared NUM_RUNS).
 */

// A single candidate image-field value spanning the full R7 input space:
// absent (`undefined`), empty, and whitespace-only (all three → no image
// source, R7.3), plus genuine URLs — some padded with surrounding whitespace
// to prove `selectImageUrl` trims before the value reaches the diff (R7.1/7.2).
const imageFieldP24: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.constantFrom(
    'https://cdn.disney.com/detail.jpg',
    '  https://cdn.disney.com/list.png  ',
    'https://cdn.disney.com/hero.webp',
  ),
);

// A minimal Facility_Document carrying only what `selectImageUrl` reads
// (`detailImageUrl` / `listImageUrl`), each field independently
// present/absent/empty so detail-wins (R7.1), list-fallback (R7.2), and
// null-precedence (R7.3) are all exercised. `id` is irrelevant to imagery so a
// constant Enterprise_Id keeps the doc well-formed.
/**
 * Build a minimal Facility_Document carrying only the two image fields, setting
 * each one *only when defined* so the result satisfies
 * `exactOptionalPropertyTypes` (an explicit `undefined` is not assignable to an
 * optional `detailImageUrl?: string`).
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

const imageDocP24: fc.Arbitrary<FacilityDocument> = fc
  .record({
    detailImageUrl: imageFieldP24,
    listImageUrl: imageFieldP24,
  })
  .map((fields) => imageDoc(fields.detailImageUrl, fields.listImageUrl));

// A document guaranteed to carry NO usable image source (every field absent,
// empty, or whitespace-only) so `selectImageUrl` must yield `null` (R7.3).
const emptyImageDocP24: fc.Arbitrary<FacilityDocument> = fc
  .record({
    detailImageUrl: fc.constantFrom<string | undefined>(undefined, '', '   ', '\t\n'),
    listImageUrl: fc.constantFrom<string | undefined>(undefined, '', '   ', '\t\n'),
  })
  .map((fields) => imageDoc(fields.detailImageUrl, fields.listImageUrl));

// --- Experience arm facts --------------------------------------------------

interface ExperienceImageFactP24 {
  readonly id: string;
  readonly presence: Presence;
  readonly doc: FacilityDocument;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
}

function makeItemScenarioP24<Extra>(
  extra: fc.Arbitrary<Extra>,
): fc.Arbitrary<readonly ({ id: string; presence: Presence; doc: FacilityDocument } & Extra)[]> {
  return fc
    .uniqueArray(internalId, { minLength: 0, maxLength: 20 })
    .chain((ids) =>
      fc
        .tuple(
          ...ids.map(() =>
            fc.tuple(presence, imageDocP24, extra),
          ),
        )
        .map((rows) =>
          ids.map((id, i) => {
            const entry = rows[i];
            if (entry === undefined) {
              throw new Error('unreachable: empty P24 payload at index');
            }
            const [p, doc, rest] = entry;
            return { id, presence: p, doc, ...rest };
          }),
        ),
    );
}

const experienceImageScenarioP24: fc.Arbitrary<readonly ExperienceImageFactP24[]> =
  makeItemScenarioP24(fc.record({ name, park, category }));

function toUpstreamExperienceP24(f: ExperienceImageFactP24): UpstreamExperience {
  return {
    id: f.id,
    upstreamEntityId: f.doc.id,
    name: f.name,
    park: f.park,
    category: f.category,
    land: null,
    description: 'Alpha',
    // The one line under test: image_url is sourced from Disney via
    // `selectImageUrl`, verbatim, before it enters reconcile (R7, R14.9).
    imageUrl: selectImageUrl(f.doc),
    areaType: 'ThemePark',
    resortId: null,
    representsResortId: null,
    resortArea: null,
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

function buildExperienceCacheP24(
  facts: readonly ExperienceImageFactP24[],
): CatalogCacheRow[] {
  const out: CatalogCacheRow[] = [];
  for (const f of facts) {
    switch (f.presence) {
      case 'upstream-only':
        break;
      case 'both-active-same':
      case 'cache-only-active':
        out.push({ id: f.id, active: true, name: f.name, park: f.park, category: f.category, land: null, areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null });
        break;
      case 'both-active-drift':
        out.push({ id: f.id, active: true, name: `${f.name}~old`, park: f.park, category: f.category, land: null, areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null });
        break;
      case 'cache-only-inactive':
      case 'both-inactive':
        out.push({ id: f.id, active: false, name: f.name, park: f.park, category: f.category, land: null, areaType: 'ThemePark', resortId: null, resortArea: null, representsResortId: null });
        break;
    }
  }
  return out;
}

const UPSTREAM_PRESENCES: readonly Presence[] = [
  'upstream-only',
  'both-active-same',
  'both-active-drift',
  'both-inactive',
];

// A presence that should produce an upsert (insert / reactivate / drift) —
// i.e. a path where reconcile is expected to (re)write image_url.
const UPSERT_PRESENCES: readonly Presence[] = [
  'upstream-only',
  'both-active-drift',
  'both-inactive',
];

function buildExperienceUpstreamP24(
  facts: readonly ExperienceImageFactP24[],
): UpstreamExperience[] {
  return facts
    .filter((f) => UPSTREAM_PRESENCES.includes(f.presence))
    .map(toUpstreamExperienceP24);
}

// --- Resort arm facts ------------------------------------------------------

interface ResortImageFactP24 {
  readonly id: string;
  readonly presence: Presence;
  readonly doc: FacilityDocument;
  readonly name: string;
}

const resortImageScenarioP24: fc.Arbitrary<readonly ResortImageFactP24[]> =
  makeItemScenarioP24(fc.record({ name }));

function toUpstreamResortP24(f: ResortImageFactP24): UpstreamResort {
  return {
    id: f.id,
    upstreamEntityId: f.doc.id,
    name: f.name,
    description: null,
    // Same sourcing rule shared with Experiences (R6.5, R7).
    imageUrl: selectImageUrl(f.doc),
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
  };
}

function buildResortCacheP24(
  facts: readonly ResortImageFactP24[],
): ResortCacheRow[] {
  const out: ResortCacheRow[] = [];
  for (const f of facts) {
    const img = selectImageUrl(f.doc);
    const base = {
      id: f.id,
      name: f.name,
      description: null,
      imageUrl: img,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
    } as const;
    switch (f.presence) {
      case 'upstream-only':
        break;
      case 'both-active-same':
      case 'cache-only-active':
        out.push({ ...base, active: true });
        break;
      case 'both-active-drift':
        out.push({ ...base, active: true, name: `${f.name}~old` });
        break;
      case 'cache-only-inactive':
      case 'both-inactive':
        out.push({ ...base, active: false });
        break;
    }
  }
  return out;
}

function buildResortUpstreamP24(
  facts: readonly ResortImageFactP24[],
): UpstreamResort[] {
  return facts
    .filter((f) => UPSTREAM_PRESENCES.includes(f.presence))
    .map(toUpstreamResortP24);
}

describe('reconcile — Property 24: Experience image_url is Disney-sourced via reconciliation', () => {
  it('carries selectImageUrl(doc) verbatim on every insert/reactivate/drift upsert (R7.1/7.2, R14.9)', () => {
    fc.assert(
      fc.property(experienceImageScenarioP24, (facts) => {
        const cache = buildExperienceCacheP24(facts);
        const diff = reconcile(cache, buildExperienceUpstreamP24(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (UPSERT_PRESENCES.includes(f.presence)) {
            const u = upserts.get(f.id);
            expect(u, `upsert expected for ${f.id} (${f.presence})`).toBeDefined();
            // The diff carries the Disney-sourced image URL byte-for-byte.
            expect(u?.imageUrl).toBe(selectImageUrl(f.doc));
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries null when the document has no non-empty image source (R7.3)', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(internalId, { minLength: 1, maxLength: 12 })
          .chain((ids) =>
            fc
              .tuple(...ids.map(() => fc.tuple(emptyImageDocP24, name, park, category)))
              .map((rows) =>
                ids.map((id, i) => {
                  const entry = rows[i];
                  if (entry === undefined) throw new Error('unreachable');
                  const [doc, nm, pk, cat] = entry;
                  return { id, presence: 'upstream-only' as Presence, doc, name: nm, park: pk, category: cat };
                }),
              ),
          ),
        (facts) => {
          const diff = reconcile([], buildExperienceUpstreamP24(facts));
          expect(diff.upserts).toHaveLength(facts.length);
          for (const u of diff.upserts) {
            expect(u.imageUrl).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('reconcileResorts — Property 24: Resort image_url is Disney-sourced via reconciliation', () => {
  it('carries selectImageUrl(doc) verbatim on every insert/reactivate/drift upsert (R6.5, R7, R14.9)', () => {
    fc.assert(
      fc.property(resortImageScenarioP24, (facts) => {
        const cache = buildResortCacheP24(facts);
        const diff = reconcileResorts(cache, buildResortUpstreamP24(facts));
        const upserts = indexBy(diff.upserts);

        for (const f of facts) {
          if (UPSERT_PRESENCES.includes(f.presence)) {
            const u = upserts.get(f.id);
            expect(u, `resort upsert expected for ${f.id} (${f.presence})`).toBeDefined();
            expect(u?.imageUrl).toBe(selectImageUrl(f.doc));
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('reconcile / reconcileResorts — Property 24: sole-writer end-to-end via reconciliation', () => {
  it('is the only path that populates image_url: an empty store gains exactly the Disney-sourced URLs, then re-running writes nothing (R7.4, R14.9)', () => {
    fc.assert(
      fc.property(
        experienceImageScenarioP24,
        resortImageScenarioP24,
        (expFacts, resortFacts) => {
          const expUpstream = buildExperienceUpstreamP24(expFacts);
          const resortUpstream = buildResortUpstreamP24(resortFacts);

          // Model the persistence layer's image_url column as a store that
          // starts empty (no prior writer) and is mutated ONLY by applying the
          // reconcile diff — exactly what applyReconciliation does (R14.9).
          const expStore = new Map<string, string | null>();
          const resortStore = new Map<string, string | null>();

          const expDiff = reconcile([], expUpstream);
          for (const u of expDiff.upserts) expStore.set(u.id, u.imageUrl);
          // Soft-deletes only flip `active`; they never touch image_url.
          const resortDiff = reconcileResorts([], resortUpstream);
          for (const u of resortDiff.upserts) resortStore.set(u.id, u.imageUrl);

          // Every persisted image_url equals selectImageUrl of its document.
          const expDocById = indexBy(
            expFacts.filter((f) => UPSTREAM_PRESENCES.includes(f.presence)),
          );
          for (const u of expUpstream) {
            const f = expDocById.get(u.id);
            expect(expStore.get(u.id)).toBe(selectImageUrl(f!.doc));
          }
          const resortDocById = indexBy(
            resortFacts.filter((f) => UPSTREAM_PRESENCES.includes(f.presence)),
          );
          for (const u of resortUpstream) {
            const f = resortDocById.get(u.id);
            expect(resortStore.get(u.id)).toBe(selectImageUrl(f!.doc));
          }

          // Sole-writer / idempotency: re-running reconcile against a cache
          // that already mirrors upstream emits no upsert, so no second writer
          // and no rewrite of image_url.
          const expCacheAfter: CatalogCacheRow[] = expDiff.upserts.map((u) => ({
            id: u.id,
            active: u.active,
            name: u.name,
            park: u.park,
            category: u.category,
            land: u.land,
            areaType: u.areaType,
            resortId: u.resortId,
            resortArea: u.resortArea,
            representsResortId: u.representsResortId,
          }));
          const resortCacheAfter: ResortCacheRow[] = resortDiff.upserts.map((u) => ({
            id: u.id,
            active: u.active,
            name: u.name,
            description: u.description,
            imageUrl: u.imageUrl,
            latitude: u.latitude,
            longitude: u.longitude,
            address: u.address,
            phone: u.phone,
          }));
          expect(reconcile(expCacheAfter, expUpstream).upserts).toEqual([]);
          expect(reconcileResorts(resortCacheAfter, resortUpstream).upserts).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no image_attribution anywhere in the Experience or Resort diff shapes (R14.8)', () => {
    fc.assert(
      fc.property(
        experienceImageScenarioP24,
        resortImageScenarioP24,
        (expFacts, resortFacts) => {
          const expDiff = reconcile(
            buildExperienceCacheP24(expFacts),
            buildExperienceUpstreamP24(expFacts),
          );
          const resortDiff = reconcileResorts(
            buildResortCacheP24(resortFacts),
            buildResortUpstreamP24(resortFacts),
          );

          const allActions: object[] = [
            ...expDiff.upserts,
            ...expDiff.softDeletes,
            ...resortDiff.upserts,
            ...resortDiff.softDeletes,
          ];
          for (const action of allActions) {
            expect(action).not.toHaveProperty('image_attribution');
            expect(action).not.toHaveProperty('imageAttribution');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 13 (experience-facet-enrichment) — new enrichment fields are not a
// drift signal
// ===========================================================================
// Feature: experience-facet-enrichment, Property 13: New enrichment fields are not a drift signal
/**
 * Property 13 (design.md → Correctness Properties):
 *
 *   For any active cached Experience row and any upstream Experience that agree
 *   on the change-detection fields (`name`, `park`, `category`, `land`,
 *   `areaType`, `resortId`, `resortArea`), `reconcile` produces no upsert for
 *   that row even when their `groupedFacets`, `heightRequirement`, `whyThis`,
 *   or `subType` differ.
 *
 * Validates: Requirements 12.2
 *
 * `hasExperienceMaterialChange` scopes drift detection to exactly the seven
 * change-detection fields; `CatalogCacheRow` deliberately does NOT carry the
 * four enrichment values, so reconcile cannot even observe them in the diff.
 * This suite pins that down: it builds an active cache row and an upstream
 * Experience that agree on every change-detection field but carry arbitrary
 * (independently drawn) enrichment, then asserts the id appears in neither the
 * upserts nor the soft-deletes — i.e. the enrichment difference is invisible to
 * change detection. It is fully independent of the Property 12 / Property 13
 * (disney-facilities-catalog-source) / Property 24 suites above.
 *
 * `numRuns: 100` per the spec convention (reuses the shared NUM_RUNS).
 */

// Change-detection field generators local to this suite. `name`, `park`,
// `category`, and `areaType` reuse the shared generators above; `land`,
// `resortArea`, and `resortId` are drawn here so the cache row and upstream can
// agree on a genuinely varied (non-null) value.
const landP13NonDrift: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom('Tomorrowland', 'Fantasyland', 'World Celebration'),
  { nil: null },
);
const resortAreaP13NonDrift: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom('Magic Kingdom Resort Area', 'EPCOT Resort Area'),
  { nil: null },
);
const resortIdP13NonDrift: fc.Arbitrary<string | null> = fc.option(internalId, {
  nil: null,
});

// The four enrichment values the upstream Experience carries. They are drawn
// independently from the change-detection fields (and, conceptually, differ
// from whatever a prior sync persisted) so the property holds "even when their
// enrichment differs".
interface NonDriftFact {
  readonly id: string;
  // Shared change-detection fields (cache row and upstream agree on these).
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly land: string | null;
  readonly areaType: AreaType;
  readonly resortId: string | null;
  readonly resortArea: string | null;
  // Upstream-only enrichment (arbitrary; the cache row carries none of it).
  readonly groupedFacets: GroupedFacetsDTO;
  readonly heightRequirement: HeightRequirementDTO | null;
  readonly whyThis: WhyThisDTO | null;
  readonly subType: string | null;
  // Carried-through-but-not-change-detected fields required to build a
  // well-formed UpstreamExperience.
  readonly description: string;
  readonly imageUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accessibility: readonly string[];
  readonly priceTier: string | null;
  readonly mealPeriods: readonly MealPeriodDTO[];
}

const nonDriftPayload: fc.Arbitrary<Omit<NonDriftFact, 'id'>> = fc.record({
  name,
  park,
  category,
  land: landP13NonDrift,
  areaType,
  resortId: resortIdP13NonDrift,
  resortArea: resortAreaP13NonDrift,
  groupedFacets,
  heightRequirement,
  whyThis,
  subType,
  description: cleanText,
  imageUrl: urlOrNull,
  latitude: coord,
  longitude: coord,
  accessibility: fc.array(
    fc.constantFrom('wheelchair-access', 'audio', 'ecv'),
    { maxLength: 3 },
  ),
  priceTier: fc.option(fc.constantFrom('$', '$$', '$$$'), { nil: null }),
  mealPeriods,
});

const nonDriftScenario: fc.Arbitrary<readonly NonDriftFact[]> = fc
  .uniqueArray(internalId, { minLength: 0, maxLength: 25 })
  .chain((ids) =>
    fc.tuple(...ids.map(() => nonDriftPayload)).map((payloads) =>
      ids.map<NonDriftFact>((id, i) => {
        const payload = payloads[i];
        if (payload === undefined) {
          throw new Error('unreachable: empty non-drift payload at index');
        }
        return { id, ...payload };
      }),
    ),
  );

/** An ACTIVE cache row mirroring a fact's change-detection fields exactly. */
function nonDriftCacheRow(f: NonDriftFact): CatalogCacheRow {
  return {
    id: f.id,
    active: true,
    name: f.name,
    park: f.park,
    category: f.category,
    land: f.land,
    areaType: f.areaType,
    resortId: f.resortId,
    resortArea: f.resortArea,
    representsResortId: null,
  };
}

/**
 * An upstream Experience mirroring the same change-detection fields but
 * carrying the fact's arbitrary enrichment values, proving that enrichment is
 * never a drift signal.
 */
function nonDriftUpstream(f: NonDriftFact): UpstreamExperience {
  return {
    id: f.id,
    upstreamEntityId: `ent-${f.id}`,
    name: f.name,
    park: f.park,
    category: f.category,
    land: f.land,
    areaType: f.areaType,
    resortId: f.resortId,
    representsResortId: null,
    resortArea: f.resortArea,
    description: f.description,
    imageUrl: f.imageUrl,
    latitude: f.latitude,
    longitude: f.longitude,
    accessibility: f.accessibility,
    priceTier: f.priceTier,
    mealPeriods: f.mealPeriods,
    groupedFacets: f.groupedFacets,
    heightRequirement: f.heightRequirement,
    whyThis: f.whyThis,
    subType: f.subType,
    active: true,
  } as UpstreamExperience;
}

describe('reconcile — Property 13 (experience-facet-enrichment): new enrichment fields are not a drift signal', () => {
  it('emits no upsert and no soft-delete when only enrichment differs (R12.2)', () => {
    fc.assert(
      fc.property(nonDriftScenario, (facts) => {
        const cache = facts.map(nonDriftCacheRow);
        const upstream = facts.map(nonDriftUpstream);
        const diff = reconcile(cache, upstream);

        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        const softDeleteIds = new Set(diff.softDeletes.map((d) => d.id));

        for (const f of facts) {
          expect(
            upsertIds.has(f.id),
            `no upsert expected for ${f.id} (enrichment-only difference)`,
          ).toBe(false);
          expect(
            softDeleteIds.has(f.id),
            `no soft-delete expected for ${f.id} (still upstream)`,
          ).toBe(false);
        }

        // Change-detection fields all agree, so the diff is entirely empty.
        expect(diff.upserts).toEqual([]);
        expect(diff.softDeletes).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fixed example: rich enrichment drift on an otherwise-identical row yields an empty diff (R12.2)', () => {
    const cache: CatalogCacheRow[] = [
      {
        id: 'exp-1',
        active: true,
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        land: 'Tomorrowland',
        areaType: 'ThemePark',
        resortId: null,
        resortArea: null,
        representsResortId: null,
      },
    ];
    const upstream: UpstreamExperience[] = [
      {
        id: 'exp-1',
        upstreamEntityId: '80010177;entityType=Attraction',
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        land: 'Tomorrowland',
        resortArea: null,
        description: 'Indoor roller coaster.',
        imageUrl: 'https://cdn.disney.com/space.jpg',
        areaType: 'ThemePark',
        resortId: null,
        representsResortId: null,
        latitude: 28.4,
        longitude: -81.6,
        accessibility: ['wheelchair-access'],
        priceTier: null,
        mealPeriods: [],
        // Every enrichment field is richly populated, unlike the (implicitly
        // empty) cached enrichment — yet none of it is a drift signal.
        groupedFacets: {
          height: [{ id: 'h1', name: '40in (102cm) or taller' }],
          physicalConsiderations: [{ id: 'p1', name: 'Expectant Mothers Advisory' }],
          thrillFactor: [{ id: 't1', name: 'Thrill Rides' }],
        },
        heightRequirement: {
          id: 'h1',
          name: '40in (102cm) or taller',
          minInches: 40,
          minCentimeters: null,
        },
        whyThis: {
          title: 'Why visit',
          bullets: ['Iconic indoor coaster', 'Great for thrill seekers'],
          quotes: ['A must-ride!'],
        },
        subType: 'Roller Coaster',
        active: true,
      } as UpstreamExperience,
    ];

    expect(reconcile(cache, upstream)).toEqual({ upserts: [], softDeletes: [] });
  });
});
