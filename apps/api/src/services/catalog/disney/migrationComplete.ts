/**
 * Migration completeness predicate.
 *
 * Defines when the ThemeParks.wiki → Disney migration is *complete* and,
 * consequently, when the retirement invariants of Requirement 14 are in force.
 *
 * Requirement 14.5 fixes the definition precisely:
 *
 *   "THE migration state SHALL be defined as complete once the Bridge_Map has
 *    been built AND at least one Catalog_Sync run sourced entirely from the
 *    Disney sources has succeeded and persisted its results to the
 *    Catalog_Cache."
 *
 * So the predicate is the conjunction of two independently observable facts:
 *
 *   1. **Bridge_Map built.** The one-time `catalog_id_bridge` table carries at
 *      least one `enterprise_id -> internal_id` row (written by
 *      `buildBridgeMap`, the *only* permitted ThemeParks.wiki read, R14.3).
 *      An empty bridge means the one-time build has not run, so the migration
 *      cannot be complete.
 *
 *   2. **≥1 Disney-only sync succeeded and persisted.** The
 *      `catalog_cache_metadata.last_successful_sync_at` pointer is non-null,
 *      which `recordSyncRun` sets only inside the same transaction that records
 *      a `success` run and only after `applyReconciliation` has persisted the
 *      run's diff (`sync.ts`). Because every Catalog_Sync now enumerates only
 *      the Disney Facilities_Channel (`sync.ts` builds its `Facilities_Client`
 *      from `AppConfig.disney`, never ThemeParks.wiki), a recorded success is by
 *      construction a Disney-sourced success — there is no other sync path left
 *      that could set this pointer.
 *
 * Once both hold, the migration is complete and the retirement invariants apply:
 * the API sources all catalog and live data exclusively from Disney (R14.1) and
 * issues no request to ThemeParks.wiki (R14.2, R14.4). Before both hold, the
 * system is mid-migration; the predicate returning `false` is the signal that
 * the one-time bridge build and/or the first Disney sync still need to run.
 *
 * The predicate is deliberately expressed over a narrow, injectable dependency
 * surface ({@link MigrationStateReader}) — satisfied by the `CatalogRepo`'s
 * existing `getBridgeMap()` and `getCacheAge()` — so it is unit-testable with
 * fakes and never reaches for a global pool.
 *
 * Validates: Requirements 14.1, 14.2, 14.4, 14.5
 */

/**
 * The narrow read surface the completeness predicate needs. Both methods are
 * already provided by `CatalogRepo`, so production callers pass the repo
 * directly; tests pass a fake.
 */
export interface MigrationStateReader {
  /**
   * The one-time `enterprise_id -> internal_id` Bridge_Map. A non-empty map
   * means `buildBridgeMap` has run (R10.2, R14.3).
   */
  getBridgeMap(): Promise<ReadonlyMap<string, string>>;
  /**
   * Cache metadata carrying the timestamp of the most recent successful sync.
   * `lastSuccessfulSyncAt` is non-null once at least one sync has succeeded and
   * persisted its results (R14.5).
   */
  getCacheAge(now?: Date): Promise<{
    readonly lastSuccessfulSyncAt: Date | null;
  }>;
}

/**
 * Whether the Bridge_Map has been built — i.e. the one-time
 * `catalog_id_bridge` build has run and persisted at least one continuity
 * entry (R10.2, R14.3). A bridge with no entries is treated as "not built":
 * the migration has no continuity mapping to rely on yet.
 */
export async function isBridgeMapBuilt(
  reader: MigrationStateReader,
): Promise<boolean> {
  const bridge = await reader.getBridgeMap();
  return bridge.size > 0;
}

/**
 * Whether at least one Catalog_Sync run has succeeded and persisted its results
 * to the Catalog_Cache. Because every sync is now Disney-sourced, a recorded
 * success is a Disney-only success (R14.5). Signalled by a non-null
 * `last_successful_sync_at` pointer, which `recordSyncRun` sets only after
 * `applyReconciliation` persists a successful run.
 */
export async function hasSuccessfulDisneySync(
  reader: MigrationStateReader,
): Promise<boolean> {
  const info = await reader.getCacheAge();
  return info.lastSuccessfulSyncAt !== null;
}

/**
 * Evaluate the migration completeness predicate (R14.5): the Bridge_Map is
 * built AND at least one Disney-sourced Catalog_Sync has succeeded and
 * persisted. Returns `true` only when both facts hold, at which point the
 * ThemeParks.wiki retirement invariants (R14.1, R14.2, R14.4) are in force.
 *
 * The two reads are issued concurrently; both must be satisfied for the
 * conjunction to hold.
 */
export async function isMigrationComplete(
  reader: MigrationStateReader,
): Promise<boolean> {
  const [bridgeBuilt, syncSucceeded] = await Promise.all([
    isBridgeMapBuilt(reader),
    hasSuccessfulDisneySync(reader),
  ]);
  return bridgeBuilt && syncSucceeded;
}
