#!/usr/bin/env node
/**
 * One-off Catalog_Sync trigger.
 *
 * Forces a single, immediate Catalog_Sync pass against ThemeParks.wiki,
 * reconciling the result into the local `experiences` cache. This is the
 * manual counterpart to the 24-hour scheduled job (`scheduler.ts`) and the
 * opportunistic on-read sync (`readDecision.ts`); use it when you need the
 * cache refreshed *now* rather than on the next scheduled tick — e.g. after
 * a change to classification logic (`classify.ts`) that should be applied to
 * rows already in the cache.
 *
 * Note: this does NOT wipe the cache. `runSync` runs the pure `reconcile`
 * diff, which updates only the rows whose `name`, `park`, or `category`
 * drifted from upstream (R1.16) and soft-deletes rows that disappeared
 * upstream (R1.15). Existing Completions, Ratings, and Notes are preserved
 * because the internal ids are stable (R1.7) and rows are never hard-deleted.
 *
 * The run coordinates through the same Redis lock as every other sync path,
 * so triggering this while the scheduled job (or another manual run) is in
 * flight is safe: the loser simply reports `{ status: 'skipped' }`.
 *
 * Usage:
 *   npm run sync
 */

import { closePool, getPool } from '../db/pool.js';
import { closeRedisClient } from '../redis/client.js';
import { runSync } from '../services/catalog/sync.js';
import { createCatalogRepo } from '../services/catalog/repo.js';
import { resolveDiningLinksSeedPath } from './seedDiningLinksPath.js';
import {
  diffDiningLinkCandidates,
  formatDiningLinkCandidateReport,
  readSeedEntries,
} from '../services/catalog/diningLinkCandidates.js';

/**
 * Post-sync dining-link-candidate check (restaurant-menu-display follow-up).
 *
 * Detection-only: reports Restaurant Experiences that are newly eligible for
 * curation (they match the `reservations-accepted` facet rule but have no
 * entry in the curated seed) so a human can look up and add the real Disney
 * dining-page URL. Never guesses or writes a URL itself — see
 * `diningLinkCandidates.ts`'s module doc for why. Failures here are logged
 * and swallowed rather than failing the sync; this check is a convenience,
 * not part of Catalog_Sync's own correctness.
 */
async function reportNewDiningLinkCandidates(): Promise<void> {
  try {
    const repo = createCatalogRepo(getPool());
    const [candidates, seedEntries] = await Promise.all([
      repo.listDiningLinkEligibleRestaurants(),
      readSeedEntries(resolveDiningLinksSeedPath()),
    ]);
    const newCandidates = diffDiningLinkCandidates(candidates, seedEntries);
    const report = formatDiningLinkCandidateReport(newCandidates);
    if (report) {
      console.log(`\n${report}`);
    }
  } catch (err) {
    console.error('[dining-links] candidate check failed (non-fatal):', err);
  }
}

async function main(): Promise<void> {
  try {
    const result = await runSync();

    switch (result.status) {
      case 'success':
        console.log(
          `[sync] success: runId=${result.runId} ` +
            `entitiesProcessed=${result.entitiesProcessed} ` +
            `upserts=${result.upserts} softDeletes=${result.softDeletes}`,
        );
        await reportNewDiningLinkCandidates();
        break;
      case 'skipped':
        console.log(
          `[sync] skipped: another sync holds the lock (reason=${result.reason}). ` +
            'Re-run once it completes if you need a fresh pass.',
        );
        break;
      case 'failed':
        console.error(
          `[sync] failed: runId=${result.runId} reason=${result.reason}`,
        );
        console.error(result.error);
        process.exitCode = 1;
        break;
    }
  } finally {
    // Release the singleton DB pool and Redis connection so the process can
    // exit instead of hanging on open sockets.
    await Promise.allSettled([closePool(), closeRedisClient()]);
  }
}

main().catch((err: unknown) => {
  console.error('[sync] unexpected failure:', err);
  process.exitCode = 1;
});
