/**
 * Identity Bridge_Map (`bridge.ts`).
 *
 * A one-time migration step that guarantees Internal_Id continuity across the
 * switch from ThemeParks.wiki to Disney's own sources (design.md → "9. Identity
 * Bridge_Map", Requirements R6.6, R10.1–R10.4, R14.3).
 *
 * Two closely related concerns live here:
 *
 *   1. **`assignInternalId(enterpriseId, bridge)`** — the pure, total id
 *      assignment used by Catalog_Sync for every catalog item (Experience and
 *      Resort). It returns the bridged id when the `Enterprise_Id` appears in
 *      the `Bridge_Map` (R10.3) and otherwise the freshly derived UUIDv5 of the
 *      `Enterprise_Id` (R10.1, R10.4). Both halves reuse the existing
 *      {@link internalId} / {@link INTERNAL_ID_NAMESPACE} so Disney-sourced ids
 *      are derived exactly like the ThemeParks.wiki-era ids were (R6.6, R10.1).
 *
 *   2. **`buildBridgeMap(deps)`** — the one-time build step that reads the
 *      ThemeParks.wiki `externalId` field **exactly once** (R14.3) and persists
 *      an `enterprise_id -> internal_id` row per entity to `catalog_id_bridge`
 *      (R10.2). Each entity's `externalId` is the Disney `Enterprise_Id`, and
 *      the value it maps to is the Internal_Id previously derived from that
 *      ThemeParks.wiki entity's own id — i.e. `internalId(entity.id)` — so a
 *      bridged Experience keeps the exact id its Completions, Ratings, and
 *      Notes already reference (R10.5).
 *
 * Dependency injection: the ThemeParks.wiki client and the persistence sink are
 * both injected through {@link BridgeDeps}, so the build is unit-testable with
 * fakes and never reaches for a global pool or the real HTTP transport. The
 * pure {@link buildBridgeEntries} core (entities -> bridge entries) is exported
 * separately so its "maps each Enterprise_Id to the prior ThemeParks-derived
 * id" invariant (design Property 12) can be property-tested independently of
 * both the transport and the database.
 *
 * Validates: Requirements 6.6, 10.1, 10.2, 10.3, 10.4, 14.3
 */

import type { DbPool } from '../../../db/pool.js';
import { INTERNAL_ID_NAMESPACE, internalId } from '../internalId.js';
import {
  UpstreamError,
  type ThemeParksClient,
  type ThemeParksDestinationEntry,
} from '../themeparks.js';

// Re-exported for callers (and tests) that want to assert the assignment path
// reuses the single canonical namespace rather than re-deriving one (R10.1).
export { INTERNAL_ID_NAMESPACE };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The minimal shape of one source entity the Bridge_Map is built from: the
 * ThemeParks.wiki entity id (from which the prior Internal_Id was derived) and
 * its optional `externalId` (the Disney `Enterprise_Id`). Modeled structurally
 * so the pure core does not depend on the full upstream projection.
 */
export interface BridgeSourceEntity {
  /** ThemeParks.wiki entity id; the prior Internal_Id was `internalId(id)`. */
  readonly id: string;
  /** Disney `Enterprise_Id` exposed by ThemeParks.wiki as `externalId` (R10.2). */
  readonly externalId?: string;
}

/**
 * A single persisted Bridge_Map row: a Disney `Enterprise_Id` and the
 * previously derived Internal_Id it maps to (`catalog_id_bridge`).
 */
export interface BridgeEntry {
  /** Disney `Enterprise_Id` (== the ThemeParks.wiki entity's `externalId`). */
  readonly enterpriseId: string;
  /** Internal_Id previously derived from the ThemeParks.wiki entity (R10.2). */
  readonly internalId: string;
}

/**
 * Persistence sink for the built Bridge_Map. Injected so the build is testable
 * with an in-memory fake; the production implementation is
 * {@link createBridgePersistence}, which writes to `catalog_id_bridge`.
 */
export type BridgePersist = (entries: readonly BridgeEntry[]) => Promise<void>;

/**
 * Collaborators required by {@link buildBridgeMap}, injected for testability.
 */
export interface BridgeDeps {
  /**
   * ThemeParks.wiki client. Read **exactly once** during the build to obtain
   * each entity's `externalId`; no ThemeParks.wiki request is ever issued
   * afterwards (R14.3).
   */
  readonly themeparks: ThemeParksClient;
  /** Sink that persists the built entries to `catalog_id_bridge` (R10.2). */
  readonly persist: BridgePersist;
}

// ---------------------------------------------------------------------------
// assignInternalId — pure id assignment (R10.1, R10.3, R10.4)
// ---------------------------------------------------------------------------

/**
 * Assign the Internal_Id for a catalog item given its `Enterprise_Id` and the
 * built `Bridge_Map`.
 *
 *   - When `enterpriseId` appears in `bridge`, return the bridged Internal_Id
 *     verbatim so the item keeps the id its Completions/Ratings/Notes already
 *     reference (R10.3).
 *   - Otherwise derive the Internal_Id as UUIDv5 of the `Enterprise_Id` over
 *     the existing fixed {@link INTERNAL_ID_NAMESPACE} via {@link internalId}
 *     (R10.1, R10.4).
 *
 * Pure, total, and deterministic. Used identically for Experiences and Resorts
 * so both derive ids the same way (R6.6).
 */
export function assignInternalId(
  enterpriseId: string,
  bridge: ReadonlyMap<string, string>,
): string {
  const bridged = bridge.get(enterpriseId);
  if (bridged !== undefined) {
    return bridged;
  }
  return internalId(enterpriseId);
}

// ---------------------------------------------------------------------------
// buildBridgeEntries — pure entities -> entries core (design Property 12)
// ---------------------------------------------------------------------------

/**
 * Build the Bridge_Map entries from a set of ThemeParks.wiki source entities.
 *
 * For every entity carrying a non-empty `externalId`, emit one entry mapping
 * that `externalId` (the Disney `Enterprise_Id`) to the Internal_Id previously
 * derived from the entity's own ThemeParks.wiki id (`internalId(entity.id)`,
 * R10.2). Entities without an `externalId` (or with a whitespace-only one)
 * carry no continuity signal and are skipped.
 *
 * `enterprise_id` is the primary key of `catalog_id_bridge`, so duplicate
 * `externalId` values are de-duplicated first-wins to keep the entry set a
 * function of `Enterprise_Id`; the upstream tree does not produce duplicates in
 * practice, but the de-dup keeps the persist step conflict-free and
 * deterministic.
 *
 * Pure, total, and deterministic.
 */
export function buildBridgeEntries(
  entities: readonly BridgeSourceEntity[],
): readonly BridgeEntry[] {
  const entries: BridgeEntry[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const externalId = entity.externalId;
    if (externalId === undefined || externalId.trim().length === 0) {
      continue;
    }
    if (seen.has(externalId)) {
      continue;
    }
    seen.add(externalId);
    entries.push({
      enterpriseId: externalId,
      internalId: internalId(entity.id),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// buildBridgeMap — one-time build + persist (R10.2, R14.3)
// ---------------------------------------------------------------------------

/**
 * Build the Bridge_Map by reading the ThemeParks.wiki `externalId` field
 * exactly once and persisting each `enterprise_id -> internal_id` mapping to
 * `catalog_id_bridge` (R10.2, R14.3).
 *
 * The single ThemeParks.wiki read walks the Walt Disney World destination's
 * entity tree (`GET /destinations` then `GET /entity/{wdwId}/children`),
 * mirroring the entity set the retired ThemeParks.wiki-era Catalog_Sync cached,
 * so every previously derived Internal_Id has a continuity entry. The pure
 * {@link buildBridgeEntries} core turns those entities into entries, and the
 * injected {@link BridgeDeps.persist} sink writes them.
 *
 * This is the ONLY ThemeParks.wiki read the migrated system ever performs
 * (R14.3); all subsequent catalog/live data is sourced from Disney.
 */
export async function buildBridgeMap(deps: BridgeDeps): Promise<void> {
  const entities = await collectThemeParksEntities(deps.themeparks);
  const entries = buildBridgeEntries(entities);
  await deps.persist(entries);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Build a {@link BridgePersist} that writes the Bridge_Map to the
 * `catalog_id_bridge` table.
 *
 * All rows are written inside a single transaction so a partial failure leaves
 * the table untouched. Each row uses `INSERT ... ON CONFLICT (enterprise_id) DO
 * UPDATE` so the one-time build is idempotent — re-running it refreshes the
 * mapping rather than failing on the `enterprise_id` primary key. An empty
 * entry set is a no-op (no connection is taken).
 */
export function createBridgePersistence(pool: DbPool): BridgePersist {
  return async (entries: readonly BridgeEntry[]): Promise<void> => {
    if (entries.length === 0) {
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        await client.query(
          `INSERT INTO catalog_id_bridge (enterprise_id, internal_id)
           VALUES ($1, $2)
           ON CONFLICT (enterprise_id) DO UPDATE SET
             internal_id = EXCLUDED.internal_id`,
          [entry.enterpriseId, entry.internalId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Surface the original cause; rollback failures are handled by the
        // pool layer and do not change the user-visible error.
      }
      throw err;
    } finally {
      client.release();
    }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers — the single ThemeParks.wiki read (R14.3)
// ---------------------------------------------------------------------------

/**
 * Match a Walt Disney World destination by name or slug, mirroring the retired
 * Catalog_Sync's detection so the walked entity set matches what was cached.
 */
const WDW_NAME_PATTERN = /walt\s*disney\s*world/i;
const WDW_SLUG_PATTERN = /waltdisneyworld/i;

/**
 * Perform the one-time ThemeParks.wiki read: resolve the Walt Disney World
 * destination and return its entity tree as {@link BridgeSourceEntity}s
 * carrying each entity's id and `externalId`.
 */
async function collectThemeParksEntities(
  client: ThemeParksClient,
): Promise<readonly BridgeSourceEntity[]> {
  const destinations = await client.getDestinations();
  const wdw = findWdwDestination(destinations.destinations);

  const childrenResp = await client.getEntityChildren(wdw.id);
  return childrenResp.children.map((child) =>
    child.externalId !== undefined
      ? { id: child.id, externalId: child.externalId }
      : { id: child.id },
  );
}

/**
 * Pick the Walt Disney World Resort entry out of the destinations list. A
 * missing destination means the one-time read cannot proceed, which surfaces
 * as an `invalid_response` upstream error (matching the retired Catalog_Sync).
 */
function findWdwDestination(
  destinations: readonly ThemeParksDestinationEntry[],
): ThemeParksDestinationEntry {
  for (const dest of destinations) {
    if (
      WDW_NAME_PATTERN.test(dest.name) ||
      (dest.slug !== undefined && WDW_SLUG_PATTERN.test(dest.slug))
    ) {
      return dest;
    }
  }
  throw new UpstreamError(
    'invalid_response',
    'Walt Disney World destination not present in /destinations response.',
  );
}
