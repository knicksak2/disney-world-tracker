/**
 * Redis-backed cache for Park_Live_Snapshot.
 * (Requirements 9.3, 9.4, design.md Section 9)
 *
 * Stores the most recently retrieved park-wide live snapshot for a Park,
 * keyed under `park-live:v1:{park}`. Evaluates freshness in application code
 * via retrievedAt while retaining keys for 24 hours to support stale-serve fallback.
 */

import type { LightningLaneState, Park } from '@dwt/shared';
import { parkLiveEntrySchema } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Freshness window in seconds (5 minutes).
 * Evaluated in application code (Requirement 9.3).
 */
export const PARK_LIVE_CACHE_TTL_SECONDS = 300;

/**
 * Redis key retention in seconds (24 hours).
 * Backs stale-serve fallback when fresh upstream read fails (Requirement 9.4).
 */
export const PARK_LIVE_CACHE_RETENTION_SECONDS = 86400;

/**
 * Build the Redis key for a Park's cached live snapshot.
 */
export function parkLiveCacheKey(park: Park): string {
  return `park-live:v1:${park}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParkLiveEntrySnapshot {
  readonly experienceId: string;
  readonly name: string;
  readonly status: string;
  readonly waitMinutes: number | null;
  readonly lightningLane?: LightningLaneState;
}

export interface CachedParkLive {
  readonly entries: readonly ParkLiveEntrySnapshot[];
  readonly retrievedAt: string;
}

export interface ParkLiveCacheRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export interface ParkLiveCache {
  get(park: Park): Promise<CachedParkLive | null>;
  set(park: Park, entry: CachedParkLive): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createParkLiveCache(redis: ParkLiveCacheRedis): ParkLiveCache {
  return {
    async get(park: Park): Promise<CachedParkLive | null> {
      const raw = await redis.get(parkLiveCacheKey(park));
      if (raw === null) return null;
      return parseCachedParkLive(raw);
    },

    async set(park: Park, entry: CachedParkLive): Promise<void> {
      await redis.set(
        parkLiveCacheKey(park),
        JSON.stringify(entry),
        'EX',
        PARK_LIVE_CACHE_RETENTION_SECONDS,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function parseCachedParkLive(raw: string): CachedParkLive | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj['retrievedAt'] !== 'string') return null;
  if (!Array.isArray(obj['entries'])) return null;

  for (const item of obj['entries']) {
    const res = parkLiveEntrySchema.safeParse(item);
    if (!res.success) return null;
  }

  return {
    entries: obj['entries'] as ParkLiveEntrySnapshot[],
    retrievedAt: obj['retrievedAt'],
  };
}
