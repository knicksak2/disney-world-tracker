/**
 * Pure-function reconciliation between the local cache and the latest Disney
 * upstream catalog (Experiences and Resorts).
 *
 * `reconcile(currentCache, upstreamSet)` (Experiences) and
 * `reconcileResorts(currentResorts, upstreamResorts)` (Resorts) each return a
 * deterministic diff describing which rows the caller should upsert and which
 * existing rows the caller should soft-delete. `reconcileCatalog(snapshot,
 * upstream)` runs both and returns the combined `CatalogDiff` the repo applies
 * in a single transaction. None of these functions ever touches a database,
 * reads the clock, throws on duplicates, or derives an internal id; the caller
 * derives the stable internal ids (via `internalId`/`assignInternalId`),
 * classifies and enriches each Experience, and selects each item's Disney
 * image URL (via `selectImageUrl`) *before* calling reconcile. Keeping that
 * derivation outside these functions lets property tests pin the diff logic
 * down in isolation (Property 13).
 *
 * Diff rules — identical in spirit for Experiences and Resorts (anchored to
 * R6.9, R6.10, R10.6, R11.1-R11.5):
 *
 *   (a) UPSERT for every upstream id absent from the cache. The new row lands
 *       with `active = true` (R11.1).
 *   (b) UPSERT for every upstream id present in the cache as a soft-deleted
 *       row (`active = false`). The same internal id is preserved and `active`
 *       flips back to `true` (R11.2 / R6.10 reactivation).
 *   (c) UPSERT for every active upstream id whose cached row has drifted from
 *       upstream. For Experiences drift is scoped to `name`/`park`/`category`
 *       (R11.3); description and enrichment are carried through but are not on
 *       their own a change-detection signal (R11.4). For Resorts drift covers
 *       every persisted descriptive field (name, description, imageUrl,
 *       coordinates, address, phone — R6.3, R6.4, R6.5).
 *   (d) SOFT-DELETE for every active cache row whose id is absent from the
 *       upstream set. The row is preserved on disk so all referencing
 *       Completions, Ratings, and Notes remain valid (R11.5, R6.9, R10.6).
 *   (e) No diff for cache rows that are already inactive and still missing
 *       upstream (idempotent).
 *
 * Descriptions are run through `sanitizeDescription` here so the produced
 * upsert already carries plain text with all HTML/markup removed before it
 * reaches the persistence layer (R11.8). `sanitizeDescription` is pure, so
 * reconcile stays pure.
 *
 * Image URLs: previously (the ThemeParks.wiki design) `image_url` was owned by
 * an out-of-band image-sourcing job and was *deliberately excluded* from the
 * diff. That job is retired; `image_url` is now Disney-provided (R7) and flows
 * through the diff on every insert/upsert/reactivation, making Catalog_Sync
 * the sole writer of `image_url` (R14.9).
 *
 * Determinism: when either input contains duplicate `id` values the last
 * occurrence wins, mirroring how `INSERT ... ON CONFLICT DO UPDATE` collapses
 * duplicate rows on the way to disk.
 *
 * Validates: Requirements 6.9, 6.10, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5,
 *            11.8, 7.1, 14.9
 */

import { sanitizeDescription } from './sanitize.js';
import type {
  CatalogCacheRow,
  CatalogDiff,
  CatalogSnapshot,
  ReconcileResult,
  ReconcileUpsert,
  ResortCacheRow,
  ResortReconcileResult,
  ResortReconcileUpsert,
  UpstreamCatalog,
  UpstreamExperience,
  UpstreamResort,
} from './types.js';

// ---------------------------------------------------------------------------
// Generic diff core
// ---------------------------------------------------------------------------

/** Minimal shape a cache row must expose for the generic diff. */
interface DiffCacheRow {
  readonly id: string;
  readonly active: boolean;
}

/** Minimal shape an upstream record must expose for the generic diff. */
interface DiffUpstreamRow {
  readonly id: string;
}

interface SoftDelete {
  readonly id: string;
}

/**
 * The shared insert / reactivate / upsert / no-change / soft-delete engine
 * used by both `reconcile` and `reconcileResorts`. Parameterizing over the
 * `toUpsert` mapper and the `hasMaterialChange` predicate keeps the two
 * callers structurally identical so their diff rules cannot drift apart.
 */
function diffRows<
  Cache extends DiffCacheRow,
  Upstream extends DiffUpstreamRow,
  Upsert,
>(
  currentCache: readonly Cache[],
  upstreamSet: readonly Upstream[],
  toUpsert: (entity: Upstream) => Upsert,
  hasMaterialChange: (cached: Cache, entity: Upstream) => boolean,
): { upserts: Upsert[]; softDeletes: SoftDelete[] } {
  // Index both inputs by internal id. On duplicate keys the later entry wins;
  // this keeps the function pure (deterministic for identical inputs) without
  // forcing the caller to dedupe first.
  const cacheById = new Map<string, Cache>();
  for (const row of currentCache) {
    cacheById.set(row.id, row);
  }

  const upstreamById = new Map<string, Upstream>();
  for (const entity of upstreamSet) {
    upstreamById.set(entity.id, entity);
  }

  const upserts: Upsert[] = [];
  const softDeletes: SoftDelete[] = [];

  // -- Upserts ---------------------------------------------------------------
  // Walk upstream first so the result preserves the caller's upstream ordering,
  // giving property and golden-file tests a stable shape to assert against.
  for (const entity of upstreamSet) {
    // Re-resolve from the map so duplicate upstream ids collapse to the last
    // occurrence (matches the dedupe rule documented above).
    if (upstreamById.get(entity.id) !== entity) {
      continue;
    }

    const cached = cacheById.get(entity.id);

    if (cached === undefined) {
      // (a) New upstream id -> insert.
      upserts.push(toUpsert(entity));
      continue;
    }

    if (!cached.active) {
      // (b) Reactivation of a previously soft-deleted row.
      upserts.push(toUpsert(entity));
      continue;
    }

    if (hasMaterialChange(cached, entity)) {
      // (c) Active row with drifted metadata.
      upserts.push(toUpsert(entity));
    }
    // Otherwise the cache already reflects upstream; emit no diff.
  }

  // -- Soft-deletes ----------------------------------------------------------
  // Walk the cache in iteration order so the result is stable across runs.
  for (const row of currentCache) {
    // Same dedupe rule as above: only act on the last occurrence of a dup id.
    if (cacheById.get(row.id) !== row) {
      continue;
    }

    if (upstreamById.has(row.id)) {
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

// ---------------------------------------------------------------------------
// Experience reconciliation
// ---------------------------------------------------------------------------

/**
 * Build the Experience cache-mutation diff for a single sync run.
 *
 * @param currentCache The current contents of the local `experiences` cache.
 * @param upstreamSet  The fully classified/enriched upstream Experiences for
 *                     this run, with internal ids already derived and image
 *                     URLs already selected by the caller.
 * @returns            The set of Experience upserts and soft-deletes to apply.
 */
export function reconcile(
  currentCache: readonly CatalogCacheRow[],
  upstreamSet: readonly UpstreamExperience[],
): ReconcileResult {
  return diffRows(
    currentCache,
    upstreamSet,
    toExperienceUpsert,
    hasExperienceMaterialChange,
  );
}

/**
 * Build the upsert payload for a single upstream Experience, locking `active`
 * to `true` and running the description through `sanitizeDescription` (R11.8)
 * so the persisted value is plain text. The Disney-provided `imageUrl` and all
 * enrichment/area fields are carried through unchanged (R7.1, R14.9, R5.x).
 */
function toExperienceUpsert(entity: UpstreamExperience): ReconcileUpsert {
  return {
    id: entity.id,
    upstreamEntityId: entity.upstreamEntityId,
    name: entity.name,
    park: entity.park,
    category: entity.category,
    land: entity.land,
    description: sanitizeDescription(entity.description),
    imageUrl: entity.imageUrl,
    areaType: entity.areaType,
    resortId: entity.resortId,
    latitude: entity.latitude,
    longitude: entity.longitude,
    accessibility: entity.accessibility,
    priceTier: entity.priceTier,
    mealPeriods: entity.mealPeriods,
    active: true,
  };
}

/**
 * True when the upstream Experience's `name`, `park`, `category`, or `land`
 * differs from the cached row. Change detection is scoped to exactly these
 * fields (R11.3, R11.4, R2.4-R2.7); `upstreamEntityId` never drifts (it is the
 * row's derivation source), and description/imagery/enrichment are carried
 * through without being change-detection signals on their own. Including
 * `land` ensures a Land drift triggers an upsert (R2.4), an equal Land is a
 * no-op (R2.5), and repeated syncs stay idempotent (R2.6).
 */
function hasExperienceMaterialChange(
  cached: CatalogCacheRow,
  entity: UpstreamExperience,
): boolean {
  return (
    cached.name !== entity.name ||
    cached.park !== entity.park ||
    cached.category !== entity.category ||
    cached.land !== entity.land
  );
}

// ---------------------------------------------------------------------------
// Resort reconciliation
// ---------------------------------------------------------------------------

/**
 * Build the Resort cache-mutation diff for a single sync run, applying the
 * same insert / reactivate / upsert / no-change / soft-delete rules as
 * Experiences (R6.9, R6.10, R11.1-R11.5).
 *
 * @param currentResorts  The current contents of the local `resorts` cache.
 * @param upstreamResorts The Resort records for this run, with internal ids
 *                        already derived and image URLs already selected.
 * @returns               The set of Resort upserts and soft-deletes to apply.
 */
export function reconcileResorts(
  currentResorts: readonly ResortCacheRow[],
  upstreamResorts: readonly UpstreamResort[],
): ResortReconcileResult {
  return diffRows(
    currentResorts,
    upstreamResorts,
    toResortUpsert,
    hasResortMaterialChange,
  );
}

/**
 * Sanitize a Resort description while preserving the `null` "absent" signal
 * (R6.4): an omitted description stays `null`, and a present one is reduced to
 * plain text (R11.8).
 */
function sanitizeResortDescription(raw: string | null): string | null {
  return raw === null ? null : sanitizeDescription(raw);
}

/**
 * Build the upsert payload for a single upstream Resort, locking `active` to
 * `true`, sanitizing the (possibly `null`) description, and carrying the
 * Disney-provided `imageUrl` and every descriptive field through (R6.3-R6.5).
 */
function toResortUpsert(entity: UpstreamResort): ResortReconcileUpsert {
  return {
    id: entity.id,
    upstreamEntityId: entity.upstreamEntityId,
    name: entity.name,
    description: sanitizeResortDescription(entity.description),
    imageUrl: entity.imageUrl,
    latitude: entity.latitude,
    longitude: entity.longitude,
    address: entity.address,
    phone: entity.phone,
    active: true,
  };
}

/**
 * True when any persisted Resort field differs from what the upstream record
 * would produce. The description is compared against its sanitized form so a
 * cosmetic markup difference that sanitization removes does not trigger a
 * spurious upsert (the cached description is already stored as plain text).
 */
function hasResortMaterialChange(
  cached: ResortCacheRow,
  entity: UpstreamResort,
): boolean {
  return (
    cached.name !== entity.name ||
    cached.description !== sanitizeResortDescription(entity.description) ||
    cached.imageUrl !== entity.imageUrl ||
    cached.latitude !== entity.latitude ||
    cached.longitude !== entity.longitude ||
    cached.address !== entity.address ||
    cached.phone !== entity.phone
  );
}

// ---------------------------------------------------------------------------
// Combined catalog reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile both Experiences and Resorts in one call, returning the combined
 * {@link CatalogDiff} the repo applies transactionally (R11.6, R11.7). This is
 * a thin, pure composition of `reconcile` and `reconcileResorts`.
 */
export function reconcileCatalog(
  snapshot: CatalogSnapshot,
  upstream: UpstreamCatalog,
): CatalogDiff {
  return {
    experiences: reconcile(snapshot.experiences, upstream.experiences),
    resorts: reconcileResorts(snapshot.resorts, upstream.resorts),
  };
}
