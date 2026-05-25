/**
 * Pure-function reconciliation between the local cache and the latest
 * ThemeParks.wiki upstream entity set.
 *
 * `reconcile(currentCache, upstreamSet)` returns a deterministic diff
 * describing which rows the caller should upsert and which existing rows
 * the caller should soft-delete. The function never touches a database,
 * never reads the clock, never throws on duplicates, and never derives an
 * internal id; the caller is responsible for translating the upstream
 * entity ids into stable internal ids before calling this function (see
 * task 4.3 `internalId(upstreamId)`). Keeping derivation outside this
 * function lets property tests pin down the diff logic in isolation.
 *
 * Diff rules (anchored to design.md "Catalog_Sync" and Property 5):
 *
 *   (a) UPSERT for every upstream id absent from the cache. The new row
 *       lands with `active = true` (R1.14).
 *   (b) UPSERT for every upstream id present in the cache as a soft-deleted
 *       row (`active = false`). The same internal id is preserved and
 *       `active` flips back to `true` (R1.15 reactivation; matches the
 *       task's "re-appearance flips active=true with the same internal
 *       id" instruction).
 *   (c) UPSERT for every upstream id whose cached row has a different
 *       `name`, `park`, or `category` value than the upstream record
 *       (R1.16). Description is copied through but is not on its own a
 *       change-detection signal — the task scopes upserts to "new id, or
 *       changed name/park/category".
 *   (d) SOFT-DELETE for every active cache row whose id is absent from the
 *       upstream set. The row is preserved on disk so all referencing
 *       Completions, Ratings, and Notes remain valid (R1.15).
 *   (e) No diff for cache rows that are already inactive and still missing
 *       upstream (idempotent: re-running reconcile against the same inputs
 *       produces the same empty additional diff).
 *
 * Determinism: when either input contains duplicate `id` values the last
 * occurrence wins. This mirrors how `INSERT ... ON CONFLICT DO UPDATE`
 * collapses duplicate rows on the way to disk and keeps `reconcile`'s
 * output identical for identical inputs regardless of incidental ordering
 * inside duplicates.
 *
 * Validates: Requirements 1.14, 1.15, 1.16
 */

import type {
  CatalogCacheRow,
  ReconcileResult,
  ReconcileSoftDelete,
  ReconcileUpsert,
  UpstreamExperience,
} from './types.js';

/**
 * Build the cache-mutation diff for a single sync run.
 *
 * @param currentCache The current contents of the local `experiences` cache.
 * @param upstreamSet  The fully classified upstream entities for this run,
 *                     with internal ids already derived by the caller.
 * @returns            The set of upserts and soft-deletes the caller should
 *                     apply transactionally.
 */
export function reconcile(
  currentCache: readonly CatalogCacheRow[],
  upstreamSet: readonly UpstreamExperience[],
): ReconcileResult {
  // Index both inputs by internal id. On duplicate keys the later entry
  // wins; this keeps the function pure (deterministic for identical
  // inputs) without forcing the caller to dedupe first.
  const cacheById = new Map<string, CatalogCacheRow>();
  for (const row of currentCache) {
    cacheById.set(row.id, row);
  }

  const upstreamById = new Map<string, UpstreamExperience>();
  for (const entity of upstreamSet) {
    upstreamById.set(entity.id, entity);
  }

  const upserts: ReconcileUpsert[] = [];
  const softDeletes: ReconcileSoftDelete[] = [];

  // -- Upserts -----------------------------------------------------------
  // Walk upstream first so the result preserves the caller's upstream
  // ordering; this gives property tests and golden-file tests a stable
  // shape to assert against without needing to sort.
  for (const entity of upstreamSet) {
    // Re-resolve from the map so duplicate upstream ids collapse to the
    // last occurrence (matches the dedupe rule documented above).
    const resolved = upstreamById.get(entity.id);
    if (resolved !== entity) {
      // Skip every duplicate except the last; the last one will hit the
      // `resolved === entity` branch on its own iteration.
      continue;
    }

    const cached = cacheById.get(entity.id);

    if (cached === undefined) {
      // (a) New upstream id -> insert.
      upserts.push(toUpsert(entity));
      continue;
    }

    if (!cached.active) {
      // (b) Reactivation of a previously soft-deleted row. Preserve the
      //     internal id; reapply upstream metadata; flip active back on.
      upserts.push(toUpsert(entity));
      continue;
    }

    if (hasMaterialChange(cached, entity)) {
      // (c) Active row with drifted name/park/category metadata.
      upserts.push(toUpsert(entity));
    }
    // Otherwise the cache already reflects upstream; emit no diff.
  }

  // -- Soft-deletes ------------------------------------------------------
  // Walk the cache in iteration order so the result is stable across runs
  // for any given input ordering.
  for (const row of currentCache) {
    // Same dedupe rule as above: only act on the last occurrence of any
    // duplicate cache id.
    if (cacheById.get(row.id) !== row) {
      continue;
    }

    const stillUpstream = upstreamById.has(row.id);
    if (stillUpstream) {
      continue;
    }

    if (!row.active) {
      // (e) Already soft-deleted and still gone -> idempotent no-op.
      continue;
    }

    // (d) Active cache row absent from upstream -> soft-delete.
    softDeletes.push({ id: row.id });
  }

  return { upserts, softDeletes };
}

/**
 * Build the upsert payload for a single upstream entity, locking the
 * `active` literal to `true` so the caller cannot accidentally schedule a
 * "soft-delete via upsert" through this code path.
 */
function toUpsert(entity: UpstreamExperience): ReconcileUpsert {
  return {
    id: entity.id,
    upstreamEntityId: entity.upstreamEntityId,
    name: entity.name,
    park: entity.park,
    category: entity.category,
    description: entity.description,
    active: true,
  };
}

/**
 * True when the upstream entity's name, park, or category differs from the
 * cached row. The task scopes change detection to exactly these three
 * fields (R1.16); upstreamEntityId never drifts because it is the row's
 * derivation source, and description is allowed to vary without forcing
 * an upsert on its own.
 */
function hasMaterialChange(
  cached: CatalogCacheRow,
  entity: UpstreamExperience,
): boolean {
  return (
    cached.name !== entity.name ||
    cached.park !== entity.park ||
    cached.category !== entity.category
  );
}
