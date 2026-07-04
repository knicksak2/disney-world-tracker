// Feature: resort-tracking-and-stats, Property 7: Representation uniqueness and stability
/**
 * Property-based test for the resort-representing Experience emitted by
 * Catalog_Sync (Option A). The representing rows are produced by
 * `buildUpstreamCatalog` (via `toResortRepresentingExperience`) and flow
 * through the existing Experience `reconcile` diff exactly like any other
 * Experience, so this suite drives arbitrary *sequences* of syncs against the
 * pure `buildUpstreamCatalog` + `reconcile` seam and asserts the two invariants
 * the design (design.md → Correctness Properties) names:
 *
 *   Property 7 — Representation uniqueness and stability:
 *   After any sequence of syncs, at most one active representing Experience
 *   exists per Resort, and its id is stable across syncs for a fixed
 *   Enterprise_Id.
 *
 * Validates: Requirements 3.2, 3.5
 *
 * How the seam is driven:
 *   - Each sync is an upstream set of `resort` Facility_Documents (a subset of a
 *     fixed pool of distinct Enterprise_Ids, with a possibly-drifting name).
 *   - `buildUpstreamCatalog(docs, bridge)` emits one resort-representing
 *     `UpstreamExperience` per Resort; `reconcile(cache, experiences)` produces
 *     the insert / reactivate / upsert / no-change / soft-delete diff, which is
 *     applied to advance the cache to the next sync (mirroring the repo's SQL
 *     caller — including the schema's `UNIQUE(represents_resort_id)` guard,
 *     modelled here as a Map keyed by internal id).
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { __internal } from '../sync.js';
import { reconcile } from '../reconcile.js';
import { internalId, RESORT_VISIT_ID_NAMESPACE } from '../internalId.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import type { CatalogCacheRow, ReconcileResult } from '../types.js';

const { buildUpstreamCatalog } = __internal;

const NUM_RUNS = 100;
const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A resort Enterprise_Id in the Disney `<numeric>;entityType=Resort` shape. */
const resortEnterpriseId: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 9_999_999 })
  .map((n) => `${n};entityType=Resort`);

/**
 * A fixed pool of distinct resort Enterprise_Ids the sync sequence draws from.
 * Kept small so a run exercises repeated appearances/disappearances of the same
 * Resort across syncs (the stability + reactivation surface).
 */
const resortPool: fc.Arbitrary<readonly string[]> = fc.uniqueArray(
  resortEnterpriseId,
  { minLength: 1, maxLength: 8 },
);

/** Resort names drawn from a small pool so a Resort's name can drift across syncs. */
const resortName: fc.Arbitrary<string> = fc.constantFrom(
  'Grand Floridian',
  'Polynesian Village',
  'Contemporary',
  'Art of Animation',
  'Wilderness Lodge',
);

/**
 * A single sync over a fixed pool: a subset of the pool's indices, each with the
 * name the Resort's document carries this run. Modelled as unique indices so a
 * Resort appears at most once per sync (an upstream set has distinct ids).
 */
function syncArb(
  poolSize: number,
): fc.Arbitrary<readonly { readonly index: number; readonly name: string }[]> {
  return fc
    .uniqueArray(fc.nat({ max: poolSize - 1 }), { maxLength: poolSize })
    .chain((indices) =>
      fc
        .tuple(...indices.map(() => resortName))
        .map((names) =>
          indices.map((index, i) => ({ index, name: names[i] as string })),
        ),
    );
}

/** A full scenario: the pool plus an ordered sequence of syncs over it. */
interface Scenario {
  readonly pool: readonly string[];
  readonly syncs: readonly (readonly {
    readonly index: number;
    readonly name: string;
  }[])[];
}

const scenario: fc.Arbitrary<Scenario> = resortPool.chain((pool) =>
  fc
    .array(syncArb(pool.length), { minLength: 1, maxLength: 6 })
    .map((syncs) => ({ pool, syncs })),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal `resort` Facility_Document for a given Enterprise_Id + name. */
function resortDoc(enterpriseId: string, name: string): FacilityDocument {
  return { id: enterpriseId, name, type: 'resort' };
}

/**
 * Apply an Experience diff to the cache the way the repo's SQL caller is
 * specified to: upserts replace/insert by internal id (so at most one row per
 * id, mirroring the primary key), soft-deletes flip `active` to `false` while
 * preserving the row (R3.5).
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
      representsResortId: u.representsResortId,
    });
  }
  for (const d of diff.softDeletes) {
    const existing = next.get(d.id);
    if (existing !== undefined) next.set(d.id, { ...existing, active: false });
  }
  return [...next.values()];
}

/** The active cache rows that represent a Resort (`represents_resort_id IS NOT NULL`). */
function activeRepresentingRows(
  cache: readonly CatalogCacheRow[],
): CatalogCacheRow[] {
  return cache.filter((r) => r.active && r.representsResortId !== null);
}

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('resort-representing Experiences — Property 7: uniqueness and stability', () => {
  it('keeps at most one active representing Experience per Resort after any sequence of syncs', () => {
    fc.assert(
      fc.property(scenario, ({ pool, syncs }) => {
        let cache: CatalogCacheRow[] = [];

        for (const sync of syncs) {
          const docs = sync.map(({ index, name }) =>
            resortDoc(pool[index] as string, name),
          );
          const { experiences } = buildUpstreamCatalog(docs, EMPTY_BRIDGE);
          cache = applyDiff(cache, reconcile(cache, experiences));

          // (a) Uniqueness: no two active representing rows share a Resort.
          const byResort = new Map<string, number>();
          for (const row of activeRepresentingRows(cache)) {
            const key = row.representsResortId as string;
            byResort.set(key, (byResort.get(key) ?? 0) + 1);
          }
          for (const count of byResort.values()) {
            expect(count).toBe(1);
          }

          // Exactly the Resorts present in this sync are active + representing.
          const presentResortIds = new Set(
            docs.map((d) => internalId(d.id)),
          );
          expect(byResort.size).toBe(presentResortIds.size);
          for (const resortId of presentResortIds) {
            expect(byResort.get(resortId)).toBe(1);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('derives a stable representing id per Enterprise_Id across the whole sync sequence', () => {
    fc.assert(
      fc.property(scenario, ({ pool, syncs }) => {
        let cache: CatalogCacheRow[] = [];
        // Enterprise_Id -> the representing Experience id observed for it so far.
        const observed = new Map<string, string>();

        for (const sync of syncs) {
          const docs = sync.map(({ index, name }) =>
            resortDoc(pool[index] as string, name),
          );
          const { experiences } = buildUpstreamCatalog(docs, EMPTY_BRIDGE);

          for (const doc of docs) {
            const emitted = experiences.find(
              (e) => e.representsResortId === internalId(doc.id),
            );
            expect(emitted).toBeDefined();
            const repId = emitted?.id as string;

            // The id is exactly the distinct-namespace derivation of the
            // Enterprise_Id — stable and never colliding with the Resort's own
            // Internal_Id or an ordinary Experience id.
            expect(repId).toBe(
              internalId(doc.id, RESORT_VISIT_ID_NAMESPACE),
            );
            expect(repId).not.toBe(internalId(doc.id));

            // And it never changes across syncs for a fixed Enterprise_Id.
            const prior = observed.get(doc.id);
            if (prior !== undefined) {
              expect(repId).toBe(prior);
            } else {
              observed.set(doc.id, repId);
            }
          }

          cache = applyDiff(cache, reconcile(cache, experiences));

          // A reappearing Resort reactivates its original row with the same id
          // (R3.5): the active representing row for each present Resort carries
          // the stable derived id.
          for (const doc of docs) {
            const active = activeRepresentingRows(cache).find(
              (r) => r.representsResortId === internalId(doc.id),
            );
            expect(active?.id).toBe(
              internalId(doc.id, RESORT_VISIT_ID_NAMESPACE),
            );
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression example
// ---------------------------------------------------------------------------

describe('resort-representing Experiences — Property 7 fixed example', () => {
  it('reactivates the same representing id after a Resort disappears and returns', () => {
    const enterpriseId = '80010407;entityType=Resort';
    const stableId = internalId(enterpriseId, RESORT_VISIT_ID_NAMESPACE);

    let cache: CatalogCacheRow[] = [];

    // Sync 1: Resort present -> one active representing row.
    let build = buildUpstreamCatalog(
      [resortDoc(enterpriseId, 'Grand Floridian')],
      EMPTY_BRIDGE,
    );
    cache = applyDiff(cache, reconcile(cache, build.experiences));
    expect(activeRepresentingRows(cache)).toHaveLength(1);
    expect(activeRepresentingRows(cache)[0]?.id).toBe(stableId);

    // Sync 2: Resort absent -> representing row soft-deleted (preserved).
    build = buildUpstreamCatalog([], EMPTY_BRIDGE);
    cache = applyDiff(cache, reconcile(cache, build.experiences));
    expect(activeRepresentingRows(cache)).toHaveLength(0);
    expect(cache.find((r) => r.id === stableId)?.active).toBe(false);

    // Sync 3: Resort returns -> same row reactivated with the same id.
    build = buildUpstreamCatalog(
      [resortDoc(enterpriseId, 'Grand Floridian')],
      EMPTY_BRIDGE,
    );
    cache = applyDiff(cache, reconcile(cache, build.experiences));
    const active = activeRepresentingRows(cache);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(stableId);
  });
});
