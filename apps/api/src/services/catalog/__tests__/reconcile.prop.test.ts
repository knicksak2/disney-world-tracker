// Feature: disney-world-tracker, Property 5: reconcile produces correct upsert and soft-delete sets
/**
 * Property-based tests for `reconcile(currentCache, upstreamSet)`.
 *
 * Validates: Requirements 1.14, 1.15, 1.16
 *
 * Property 5 (design.md → Correctness Properties):
 *
 *   For any (currentCache, upstreamSet) pair, the output of
 *   reconcile(currentCache, upstreamSet)
 *     (a) adds an Experience with internalId == derive(upstreamId) for
 *         every upstream id absent from currentCache,
 *     (b) marks active = false for every cache id absent from upstream
 *         while preserving the row and all foreign-key references from
 *         Completions, Ratings, and Notes,
 *     (c) updates name, Park, and Experience_Category to the upstream
 *         value while preserving the internal id when an upstream
 *         entity's metadata differs from the cached row.
 *
 * The implementation under test (`reconcile.ts`) layers two additional
 * deterministic rules on top of the property text:
 *
 *   (d) A soft-deleted cache row whose id reappears upstream is upserted
 *       (reactivation; `active` flips back to `true` with the same
 *       internal id) — design.md "Catalog_Sync" + R1.15.
 *   (e) An already-inactive cache row that is still missing upstream
 *       produces no diff (idempotency).
 *
 * The tests exercise (a)–(e) plus a global idempotency property: applying
 * the diff and re-running `reconcile` against the resulting cache and the
 * same upstream set produces an empty diff.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { reconcile } from '../reconcile.js';
import type {
  CatalogCacheRow,
  ReconcileResult,
  ReconcileSoftDelete,
  ReconcileUpsert,
  UpstreamExperience,
} from '../types.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// The generators below build cache and upstream sets in three stages so
// the property tests can talk directly about each diff rule:
//
//   1. A pool of distinct internal ids.
//   2. A "fact sheet" per id describing whether it appears in the cache,
//      the upstream set, or both, plus its metadata on each side.
//   3. Materialized cache rows and upstream entities.
//
// Building the cache and upstream sets from a shared per-id fact sheet is
// what lets the test assertions reason about expected upserts and
// soft-deletes without re-implementing `reconcile` itself.

const internalId = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `id-${n}`);

const park: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const category: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const name = fc.string({ minLength: 1, maxLength: 32 });
const description = fc.string({ minLength: 0, maxLength: 64 });

/**
 * Per-id presence in the cache and upstream set. The combinations cover
 * every diff rule:
 *
 *   - 'cache-only-active'   → active cache row missing upstream → soft-delete (rule b/d)
 *   - 'cache-only-inactive' → inactive cache row missing upstream → no-op (rule e)
 *   - 'upstream-only'       → upstream id missing from cache → upsert (rule a)
 *   - 'both-active-same'    → active cache row matching upstream → no-op
 *   - 'both-active-drift'   → active cache row with drift vs upstream → upsert (rule c)
 *   - 'both-inactive'       → inactive cache row whose id reappears upstream → upsert (rule d, reactivation)
 */
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

interface Fact {
  readonly id: string;
  readonly presence: Presence;
  // Cache-side metadata (used when the id is in the cache).
  readonly cacheName: string;
  readonly cachePark: Park;
  readonly cacheCategory: ExperienceCategory;
  // Upstream-side metadata (used when the id is in upstream).
  readonly upstreamName: string;
  readonly upstreamPark: Park;
  readonly upstreamCategory: ExperienceCategory;
  readonly upstreamDescription: string;
  readonly upstreamEntityId: string;
}

const fact: fc.Arbitrary<Omit<Fact, 'id'>> = fc.record({
  presence,
  cacheName: name,
  cachePark: park,
  cacheCategory: category,
  upstreamName: name,
  upstreamPark: park,
  upstreamCategory: category,
  upstreamDescription: description,
  upstreamEntityId: fc.string({ minLength: 1, maxLength: 24 }),
});

/**
 * A scenario is a set of `Fact` records keyed by distinct internal ids.
 * The materialized cache and upstream lists are derived from the same
 * facts, which is what lets the assertions name the expected diff
 * directly.
 */
const scenario = fc
  .uniqueArray(internalId, { minLength: 0, maxLength: 30 })
  .chain((ids) =>
    fc
      .tuple(...ids.map(() => fact))
      .map((facts) =>
        ids.map<Fact>((id, i) => {
          const f = facts[i] ?? facts[0];
          if (f === undefined) {
            // Unreachable because `ids` is empty when `facts` is empty.
            throw new Error('unreachable: empty fact at index');
          }
          return { id, ...f };
        }),
      ),
  );

function buildCache(facts: readonly Fact[]): CatalogCacheRow[] {
  const out: CatalogCacheRow[] = [];
  for (const f of facts) {
    switch (f.presence) {
      case 'cache-only-active':
      case 'both-active-same':
      case 'both-active-drift':
        out.push({
          id: f.id,
          active: true,
          name: f.cacheName,
          park: f.cachePark,
          category: f.cacheCategory,
        });
        break;
      case 'cache-only-inactive':
      case 'both-inactive':
        out.push({
          id: f.id,
          active: false,
          name: f.cacheName,
          park: f.cachePark,
          category: f.cacheCategory,
        });
        break;
      case 'upstream-only':
        // Not in cache.
        break;
    }
  }
  return out;
}

function buildUpstream(facts: readonly Fact[]): UpstreamExperience[] {
  const out: UpstreamExperience[] = [];
  for (const f of facts) {
    switch (f.presence) {
      case 'upstream-only':
        out.push({
          id: f.id,
          upstreamEntityId: f.upstreamEntityId,
          name: f.upstreamName,
          park: f.upstreamPark,
          category: f.upstreamCategory,
          description: f.upstreamDescription,
        });
        break;
      case 'both-active-same':
        // Mirror cache metadata exactly so no drift is reported.
        out.push({
          id: f.id,
          upstreamEntityId: f.upstreamEntityId,
          name: f.cacheName,
          park: f.cachePark,
          category: f.cacheCategory,
          description: f.upstreamDescription,
        });
        break;
      case 'both-active-drift': {
        // Force at least one of name/park/category to differ from the
        // cached row so the case actually exercises rule (c). When the
        // upstream randomized triple happens to equal the cache, perturb
        // the name with a sentinel suffix (still within the 1..200 char
        // bound from R1.8 because cacheName <= 32 + suffix).
        const drift =
          f.upstreamName !== f.cacheName ||
          f.upstreamPark !== f.cachePark ||
          f.upstreamCategory !== f.cacheCategory;
        out.push({
          id: f.id,
          upstreamEntityId: f.upstreamEntityId,
          name: drift ? f.upstreamName : `${f.cacheName}~drift`,
          park: f.upstreamPark,
          category: f.upstreamCategory,
          description: f.upstreamDescription,
        });
        break;
      }
      case 'both-inactive':
        out.push({
          id: f.id,
          upstreamEntityId: f.upstreamEntityId,
          name: f.upstreamName,
          park: f.upstreamPark,
          category: f.upstreamCategory,
          description: f.upstreamDescription,
        });
        break;
      case 'cache-only-active':
      case 'cache-only-inactive':
        // Not in upstream.
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers used by the property assertions
// ---------------------------------------------------------------------------

function indexBy<T extends { readonly id: string }>(
  rows: readonly T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.id, r);
  return m;
}

/**
 * Apply a `ReconcileResult` to a cache snapshot the same way the design's
 * SQL caller is specified to apply it (UPSERT for `upserts`, set
 * `active = false` for `softDeletes`, leave everything else alone).
 *
 * Used to verify the global idempotency property: reconciling against the
 * upstream set after applying the diff must yield an empty diff.
 */
function applyDiff(
  cache: readonly CatalogCacheRow[],
  diff: ReconcileResult,
  upstream: readonly UpstreamExperience[],
): CatalogCacheRow[] {
  const upstreamById = indexBy(upstream);
  const next = new Map<string, CatalogCacheRow>();
  for (const row of cache) next.set(row.id, row);

  for (const u of diff.upserts) {
    next.set(u.id, {
      id: u.id,
      active: u.active,
      name: u.name,
      park: u.park,
      category: u.category,
    });
  }
  for (const d of diff.softDeletes) {
    const existing = next.get(d.id);
    if (existing !== undefined) {
      next.set(d.id, { ...existing, active: false });
    }
  }
  // Touch upstreamById to satisfy lint: it's not used by the apply rule
  // (the diff already encodes the apply intent), but keeping the parameter
  // makes the helper signature read like the SQL caller.
  void upstreamById;
  return [...next.values()];
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('reconcile — Property 5: correct upserts and soft-deletes', () => {
  it('upserts every upstream id absent from the cache (rule a)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upserts = indexBy(diff.upserts);
        for (const f of facts) {
          if (f.presence === 'upstream-only') {
            const u = upserts.get(f.id);
            expect(u, `upstream-only id ${f.id} must be upserted`).toBeDefined();
            // Internal id is the upstream id; the property text says
            // `internalId == derive(upstreamId)` — the caller is
            // responsible for derivation, and `reconcile` just preserves
            // whatever id the caller passed (R1.7 + design note).
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            expect(u?.name).toBe(f.upstreamName);
            expect(u?.park).toBe(f.upstreamPark);
            expect(u?.category).toBe(f.upstreamCategory);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('soft-deletes active cache rows absent from upstream (rule b)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const softDeletes = new Set(
          diff.softDeletes.map((d: ReconcileSoftDelete) => d.id),
        );
        for (const f of facts) {
          if (f.presence === 'cache-only-active') {
            expect(
              softDeletes.has(f.id),
              `active cache id ${f.id} missing upstream must soft-delete`,
            ).toBe(true);
          }
        }
        // Also: no soft-delete is emitted for any id that is still upstream.
        const upstreamIds = new Set(upstream.map((u) => u.id));
        for (const id of softDeletes) {
          expect(upstreamIds.has(id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('upserts active cache rows whose name/park/category drifts (rule c)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upserts = indexBy(diff.upserts);
        const cacheById = indexBy(cache);
        const upstreamById = indexBy(upstream);

        for (const f of facts) {
          if (f.presence === 'both-active-drift') {
            const cached = cacheById.get(f.id);
            const ent = upstreamById.get(f.id);
            expect(cached).toBeDefined();
            expect(ent).toBeDefined();
            // Drift exists by construction.
            const driftExists =
              cached!.name !== ent!.name ||
              cached!.park !== ent!.park ||
              cached!.category !== ent!.category;
            expect(driftExists).toBe(true);

            const u = upserts.get(f.id);
            expect(u, `drifted id ${f.id} must be upserted`).toBeDefined();
            // Internal id preserved (R1.16).
            expect(u?.id).toBe(f.id);
            expect(u?.active).toBe(true);
            // Name/park/category match upstream (R1.16).
            expect(u?.name).toBe(ent!.name);
            expect(u?.park).toBe(ent!.park);
            expect(u?.category).toBe(ent!.category);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reactivates soft-deleted cache rows that reappear upstream with the same id (rule d)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upserts = indexBy(diff.upserts);
        for (const f of facts) {
          if (f.presence === 'both-inactive') {
            const u = upserts.get(f.id);
            expect(
              u,
              `reappeared inactive id ${f.id} must be upserted (reactivation)`,
            ).toBeDefined();
            // Same internal id (R1.15: "preserve internal id on reactivation").
            expect(u?.id).toBe(f.id);
            // active flips back to true.
            expect(u?.active).toBe(true);
          }
        }
        // No soft-delete is emitted for an id present in upstream.
        const upstreamIds = new Set(upstream.map((u) => u.id));
        for (const d of diff.softDeletes) {
          expect(upstreamIds.has(d.id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no diff for already-inactive rows still missing upstream (rule e, idempotency)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upsertIds = new Set(
          diff.upserts.map((u: ReconcileUpsert) => u.id),
        );
        const softDeleteIds = new Set(
          diff.softDeletes.map((d: ReconcileSoftDelete) => d.id),
        );

        for (const f of facts) {
          if (f.presence === 'cache-only-inactive') {
            expect(
              upsertIds.has(f.id),
              `inactive id ${f.id} still missing upstream must not upsert`,
            ).toBe(false);
            expect(
              softDeleteIds.has(f.id),
              `inactive id ${f.id} still missing upstream must not soft-delete`,
            ).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits no diff for active cache rows that match upstream exactly', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upsertIds = new Set(
          diff.upserts.map((u: ReconcileUpsert) => u.id),
        );
        const softDeleteIds = new Set(
          diff.softDeletes.map((d: ReconcileSoftDelete) => d.id),
        );

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

  it('re-running reconcile after applying the diff produces an empty diff (idempotency)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const nextCache = applyDiff(cache, diff, upstream);
        const second = reconcile(nextCache, upstream);

        expect(second.upserts).toEqual([]);
        expect(second.softDeletes).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every emitted upsert lands with active = true (soft-delete never flows through upserts)', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        for (const u of diff.upserts) {
          expect(u.active).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('upsert and soft-delete sets are disjoint by id', () => {
    fc.assert(
      fc.property(scenario, (facts) => {
        const cache = buildCache(facts);
        const upstream = buildUpstream(facts);
        const diff = reconcile(cache, upstream);

        const upsertIds = new Set(diff.upserts.map((u) => u.id));
        for (const d of diff.softDeletes) {
          expect(upsertIds.has(d.id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('reconcile — fixed examples for regression', () => {
  it('produces empty diff for empty inputs', () => {
    const result = reconcile([], []);
    expect(result.upserts).toEqual([]);
    expect(result.softDeletes).toEqual([]);
  });

  it('upserts a brand-new upstream row that is absent from the cache', () => {
    const result = reconcile(
      [],
      [
        {
          id: 'exp-1',
          upstreamEntityId: 'wdw:attraction:1',
          name: 'Space Mountain',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'Indoor roller coaster.',
        },
      ],
    );
    expect(result.softDeletes).toEqual([]);
    expect(result.upserts).toHaveLength(1);
    expect(result.upserts[0]).toMatchObject({
      id: 'exp-1',
      active: true,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
    });
  });

  it('soft-deletes an active cache row that is missing from upstream', () => {
    const result = reconcile(
      [
        {
          id: 'exp-1',
          active: true,
          name: 'Old Ride',
          park: 'Magic Kingdom',
          category: 'Ride',
        },
      ],
      [],
    );
    expect(result.upserts).toEqual([]);
    expect(result.softDeletes).toEqual([{ id: 'exp-1' }]);
  });

  it('does not emit a diff for an already-inactive cache row missing from upstream', () => {
    const result = reconcile(
      [
        {
          id: 'exp-1',
          active: false,
          name: 'Old Ride',
          park: 'Magic Kingdom',
          category: 'Ride',
        },
      ],
      [],
    );
    expect(result.upserts).toEqual([]);
    expect(result.softDeletes).toEqual([]);
  });
});
