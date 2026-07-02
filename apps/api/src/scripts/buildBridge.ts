#!/usr/bin/env node
/**
 * One-time identity Bridge_Map build.
 *
 * Populates the `catalog_id_bridge` table so that Internal_Ids stay stable
 * across the migration from ThemeParks.wiki to Disney's own sources. Without
 * this step, the first Disney-sourced Catalog_Sync would derive fresh
 * Internal_Ids from each Disney `Enterprise_Id`, and any existing Completions,
 * Ratings, and Notes (which reference the prior ThemeParks.wiki-derived ids)
 * would be orphaned.
 *
 * What it does (see `services/catalog/disney/bridge.ts`):
 *   1. Reads the Walt Disney World entity tree from the PUBLIC ThemeParks.wiki
 *      API exactly once (`GET /destinations` then `GET /entity/{wdwId}/children`).
 *      This is the ONLY ThemeParks.wiki read the migrated system performs
 *      (Requirement 14.3) and needs no credentials.
 *   2. For every entity carrying an `externalId` (the Disney `Enterprise_Id`),
 *      maps that `Enterprise_Id` to the Internal_Id previously derived from the
 *      ThemeParks.wiki entity id, and upserts it into `catalog_id_bridge`
 *      (Requirement 10.2). Re-running is idempotent.
 *
 * Run this AFTER `npm run migrate` and BEFORE the first `npm run sync`.
 *
 * Usage:
 *   npm run build-bridge
 */

import { loadConfig } from '../config.js';
import { closePool, getPool } from '../db/pool.js';
import { createThemeParksClient } from '../services/catalog/themeparks.js';
import {
  buildBridgeMap,
  createBridgePersistence,
  type BridgeEntry,
  type BridgePersist,
} from '../services/catalog/disney/bridge.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = getPool();

  // Public ThemeParks.wiki client (no credentials); base URL from config.
  const themeparks = createThemeParksClient({
    baseUrl: config.themeparks.baseUrl,
  });

  // Wrap the real persistence sink so we can report how many continuity
  // entries were written without re-querying the table.
  const persistToDb = createBridgePersistence(pool);
  let entryCount = 0;
  const persist: BridgePersist = async (entries: readonly BridgeEntry[]) => {
    entryCount = entries.length;
    await persistToDb(entries);
  };

  try {
    await buildBridgeMap({ themeparks, persist });
    console.log(
      `[build-bridge] done: persisted ${entryCount} enterprise_id -> internal_id ` +
        'bridge entries to catalog_id_bridge.',
    );
    if (entryCount === 0) {
      console.warn(
        '[build-bridge] WARNING: no bridge entries were produced. Either the ' +
          'ThemeParks.wiki WDW entity tree exposed no externalId values, or the ' +
          'upstream response was empty. Existing user data will NOT be preserved ' +
          'if you proceed to sync — investigate before running `npm run sync`.',
      );
    }
  } finally {
    await closePool();
  }
}

main().catch((err: unknown) => {
  console.error('[build-bridge] failed:', err);
  process.exitCode = 1;
});
