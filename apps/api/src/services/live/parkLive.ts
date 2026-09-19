/**
 * ThemeParks.wiki-sourced ParkLiveService orchestrator.
 * (Requirements 9.1, 9.3, 9.4, 9.5, 9.7, design.md Section 7)
 *
 * Implements park-wide live retrieval with:
 *   1. Cache-first check against PARK_LIVE_CACHE_TTL_SECONDS (5 minutes).
 *   2. Park -> ThemeParks GUID resolution via ParkGuidResolver.
 *   3. Fresh fetch from ThemeParks.wiki with a 5-second deadline.
 *   4. Projection via projectParkLive onto active tracked experiences for that park.
 *   5. Stale-serve fallback when fresh retrieval fails and a cached snapshot exists.
 *   6. live_unavailable AppError (503) when retrieval fails and no cached snapshot exists.
 *   7. Complete isolation from Disney sources (ThemeParks.wiki only).
 */

import type { Park } from '@dwt/shared';
import { AppError } from '../../errors/index.js';
import type { CachedParkLive, ParkLiveCache, ParkLiveEntrySnapshot } from './parkLiveCache.js';
import { PARK_LIVE_CACHE_TTL_SECONDS } from './parkLiveCache.js';
import type { ParkGuidResolver } from './parkResolve.js';
import { projectParkLive } from './parkLiveProject.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveResponse,
} from './themeParksLiveClient.js';

export interface ParkLiveSnapshotResult {
  readonly park: Park;
  readonly entries: readonly ParkLiveEntrySnapshot[];
  readonly retrievedAt: string;
  readonly stale: boolean;
}

export interface ParkLiveService {
  /**
   * Resolve the Park's ThemeParks.wiki entity, cache-check, and (when needed)
   * fetch+project its live feed in one request (R9.1).
   * Throws AppError('live_unavailable') only when fresh retrieval fails and no
   * cached snapshot exists (R9.5).
   */
  getParkLive(park: Park, now?: Date): Promise<ParkLiveSnapshotResult>;
}

export const PARK_LIVE_FETCH_DEADLINE_MS = 5_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ParkLiveServiceDeps {
  readonly client: ThemeParksLiveClient;
  readonly cache: ParkLiveCache;
  readonly parkResolver: ParkGuidResolver;
  /**
   * Bulk experience lookup: resolves experiences for the park (or all active experiences)
   * into { id, upstream_entity_id } pairs.
   */
  readonly getExperiencesWithUpstreamIds: (
    park?: Park,
  ) => Promise<readonly { id: string; upstream_entity_id: string }[]>;
  readonly getEntityIdMap?: () => Promise<ReadonlyMap<string, string>>;
  readonly resolveEntityId?: (enterpriseId: string) => Promise<string | null>;
  readonly now?: () => Date;
  readonly deadlineMs?: number;
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeoutFn?: (handle: TimerHandle) => void;
}

export function createParkLiveService(deps: ParkLiveServiceDeps): ParkLiveService {
  const { client, cache, parkResolver, getExperiencesWithUpstreamIds } = deps;
  const clock = deps.now ?? (() => new Date());
  const deadlineMs = deps.deadlineMs ?? PARK_LIVE_FETCH_DEADLINE_MS;
  const setTimeoutImpl = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutImpl = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));

  async function fetchWithDeadline(parkGuid: string): Promise<ThemeParksLiveResponse> {
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), deadlineMs);
    try {
      return await client.getEntityLive(parkGuid, controller.signal);
    } finally {
      clearTimeoutImpl(timer);
    }
  }

  function failureFallback(park: Park, cached: CachedParkLive | null): ParkLiveSnapshotResult {
    if (cached !== null) {
      return {
        park,
        entries: cached.entries,
        retrievedAt: cached.retrievedAt,
        stale: true,
      };
    }
    throw new AppError(
      'live_unavailable',
      `Live data is currently unavailable for park ${park}.`,
      { details: { park } },
    );
  }

  function cacheAgeSeconds(entry: CachedParkLive, now: Date): number {
    const retrievedMs = Date.parse(entry.retrievedAt);
    if (Number.isNaN(retrievedMs)) {
      return Number.POSITIVE_INFINITY;
    }
    return (now.getTime() - retrievedMs) / 1000;
  }

  return {
    async getParkLive(park: Park, nowOverride?: Date): Promise<ParkLiveSnapshotResult> {
      const now = nowOverride ?? clock();

      const cached = await cache.get(park);

      // Serve from cache within freshness window (Requirement 9.3)
      if (
        cached !== null &&
        cacheAgeSeconds(cached, now) <= PARK_LIVE_CACHE_TTL_SECONDS
      ) {
        return {
          park,
          entries: cached.entries,
          retrievedAt: cached.retrievedAt,
          stale: false,
        };
      }

      // Resolve Park entity GUID (Requirement 9.2)
      let parkGuid: string | null;
      try {
        parkGuid = await parkResolver.resolveParkGuid(park);
      } catch {
        parkGuid = null;
      }

      if (parkGuid === null) {
        return failureFallback(park, cached);
      }

      // Fetch fresh under deadline
      try {
        const response = await fetchWithDeadline(parkGuid);
        const experiences = await getExperiencesWithUpstreamIds(park);
        const map = new Map<string, string>();

        let entityIdMap: ReadonlyMap<string, string> | null = null;
        if (deps.getEntityIdMap) {
          try {
            entityIdMap = await deps.getEntityIdMap();
          } catch {
            entityIdMap = null;
          }
        }

        for (const exp of experiences) {
          // Direct fallback for mock unit tests
          map.set(exp.upstream_entity_id, exp.id);
          if (entityIdMap) {
            const tpGuid = entityIdMap.get(exp.upstream_entity_id);
            if (tpGuid) {
              map.set(tpGuid, exp.id);
            }
          }
        }

        if (!entityIdMap && deps.resolveEntityId) {
          await Promise.all(
            experiences.map(async (exp) => {
              try {
                const tpGuid = await deps.resolveEntityId!(exp.upstream_entity_id);
                if (tpGuid) {
                  map.set(tpGuid, exp.id);
                }
              } catch {
                // ignore
              }
            }),
          );
        }

        const entries = projectParkLive(response, map);
        const retrievedAt = now.toISOString();
        const fresh: CachedParkLive = { entries, retrievedAt };
        await cache.set(park, fresh);
        return {
          park,
          entries,
          retrievedAt,
          stale: false,
        };
      } catch {
        // Fall back to stale cache or throw live_unavailable (Requirements 9.4, 9.5)
        return failureFallback(park, cached);
      }
    },
  };
}
