/**
 * Disney-sourced Live_Service orchestrator.
 *
 * The Disney replacement for `services/live/service.ts`. It wires the catalog
 * `getLiveDetail` port (`services/catalog/routes.ts`) to the Disney live
 * projection (`disney/liveProject.ts`), keyed by the Experience's
 * `Enterprise_Id` (R9.1), and contacts only the Disney sources — never
 * ThemeParks.wiki (R14.1, R14.2).
 *
 * The request lifecycle mirrors the retired ThemeParks.wiki live orchestrator
 * so the resilience guarantees are unchanged; only the upstream and the
 * projection differ:
 *
 *   1. **Resolve** the Experience's `Enterprise_Id`. The catalog persists it as
 *      `experiences.upstream_entity_id` (set by `sync.ts` to the Facility
 *      Document `id`, e.g. `"80010177;entityType=Attraction"`), so the existing
 *      {@link LiveRepo.resolveUpstreamEntityId} read returns exactly the
 *      `Enterprise_Id`. A `null` result is a failed retrieval that never
 *      contacts Disney (mirrors R1.9) and falls through to the failure path.
 *   2. **Cache decision.** A cached entry within the `Live_Cache_TTL`
 *      (5 minutes) is served `stale:false` without any upstream call (R2.2).
 *   3. **Fetch fresh** under a 5-second deadline (R2.6) from the Disney live
 *      documents, project via `projectLiveDetail` in the Park time zone (R9.8),
 *      store with a fresh `retrievedAt` (R2.4), and serve `stale:false`.
 *   4. **Failure with a cached entry:** serve the most recent cached value
 *      regardless of age, marked `stale:true`, without overwriting it
 *      (R2.6, R2.7, R3.1, R12.10). This is also the "Disney source unavailable
 *      while migration complete → serve stale, never fall back to
 *      ThemeParks.wiki" behavior (R14.4).
 *   5. **Failure with NO cache:** throw `AppError('live_unavailable')` (→ 503),
 *      storing nothing.
 *
 * The orchestrator depends only on injected collaborators so it is unit-testable
 * with in-memory fakes and a controlled clock — no Redis, database, or network.
 *
 * Validates: Requirements 9.1, 9.8, 14.1, 14.2, 14.4
 */

import type { LiveDetailDTO } from '@dwt/shared';

import { AppError } from '../../../errors/index.js';
import type { CachedLiveDetail, LiveCache } from '../../live/cache.js';
import { LIVE_CACHE_TTL_SECONDS } from '../../live/cache.js';
import type { LiveRepo } from '../../live/repo.js';
import { WDW_TIME_ZONE } from '../../live/parkTime.js';
import {
  projectLiveDetail,
  type LiveProjectionInput,
  type ProjectionContext,
} from './liveProject.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The retrieval metadata wrapping the projected Live_Detail served to the App.
 * Structurally identical to the catalog route's `CatalogLiveDetailResult`:
 * `retrievedAt` is always present (R2.5); `stale` flags a fallback serve
 * (R2.6, R2.7, R3.1); `upstreamLastUpdated` is surfaced distinct from
 * `retrievedAt` when the projected detail carries it.
 */
export interface DisneyLiveDetailResult {
  readonly liveDetail: LiveDetailDTO;
  readonly retrievedAt: string;
  readonly stale: boolean;
  readonly upstreamLastUpdated?: string;
}

/**
 * The Disney live document source: given an Experience's `Enterprise_Id`, fetch
 * its live documents from the Disney Status, Dining-Status, Forecast, and
 * Schedule channels and return them as the projection's input (R9.1–R9.5).
 *
 * Injected so the orchestrator stays pure/testable and so the concrete
 * Sync-Gateway transport (`disney/liveClient.ts`) can be swapped for a fake.
 * The `signal` carries the orchestrator's 5-second deadline (R2.6).
 */
export interface DisneyLiveClient {
  getEntityLiveInput(
    enterpriseId: string,
    signal?: AbortSignal,
  ): Promise<LiveProjectionInput>;
}

/** Public surface consumed by the catalog `getLiveDetail` port. */
export interface DisneyLiveService {
  /**
   * Resolve, cache-check, and (when needed) fetch the Live_Detail for an
   * Experience from the Disney sources. Throws `AppError('live_unavailable')`
   * only when a fresh retrieval fails and no cached value exists (R2.8).
   */
  getLiveDetail(
    experienceId: string,
    now?: Date,
  ): Promise<DisneyLiveDetailResult>;
}

/** Default deadline for a fresh Disney retrieval (R2.6): five seconds. */
export const DISNEY_LIVE_FETCH_DEADLINE_MS = 5_000;

// ---------------------------------------------------------------------------
// Dependencies / factory
// ---------------------------------------------------------------------------

type TimerHandle = ReturnType<typeof setTimeout>;

export interface DisneyLiveServiceDeps {
  /** Read-only resolver of Experience id → `Enterprise_Id` (R9.1). */
  readonly repo: LiveRepo;
  /** Short-lived Live_Cache (R2.2, R2.4). */
  readonly cache: LiveCache;
  /** Disney live document source (R9.1). */
  readonly client: DisneyLiveClient;
  /** Clock provider; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Park IANA time zone for projection; defaults to WDW Eastern (R9.8). */
  readonly parkTimeZone?: string;
  /** Fresh-retrieval deadline in ms; defaults to {@link DISNEY_LIVE_FETCH_DEADLINE_MS}. */
  readonly deadlineMs?: number;
  /** Timer injection for deterministic deadline tests. */
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeoutFn?: (handle: TimerHandle) => void;
}

/**
 * Construct a {@link DisneyLiveService} from injected collaborators.
 * Constructor injection keeps the orchestrator unit- and property-testable
 * with in-memory fakes and a controlled clock.
 */
export function createDisneyLiveService(
  deps: DisneyLiveServiceDeps,
): DisneyLiveService {
  const { repo, cache, client } = deps;
  const clock = deps.now ?? (() => new Date());
  const parkTimeZone = deps.parkTimeZone ?? WDW_TIME_ZONE;
  const deadlineMs = deps.deadlineMs ?? DISNEY_LIVE_FETCH_DEADLINE_MS;
  const setTimeoutImpl = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutImpl = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));

  return {
    async getLiveDetail(
      experienceId: string,
      nowOverride?: Date,
    ): Promise<DisneyLiveDetailResult> {
      const now = nowOverride ?? clock();

      // Step 1: resolve the Enterprise_Id (R9.1). An unresolved id never
      // contacts Disney and falls straight through to the failure path.
      const enterpriseId = await repo.resolveUpstreamEntityId(experienceId);

      // Read the cached entry once; it drives both the freshness decision and
      // the stale-serve fallback.
      const cached = await cache.get(experienceId);

      if (enterpriseId === null) {
        return failureFallback(experienceId, cached);
      }

      // Step 2: serve a sufficiently-fresh cached entry without upstream (R2.2).
      if (
        cached !== null &&
        cacheAgeSeconds(cached, now) <= LIVE_CACHE_TTL_SECONDS
      ) {
        return toResult(cached, false);
      }

      // Step 3: fetch fresh with a 5-second deadline (R2.6) and project (R9).
      try {
        const input = await fetchWithDeadline(enterpriseId);
        const ctx: ProjectionContext = { parkTimeZone, now };
        const liveDetail = projectLiveDetail(input, ctx);
        const retrievedAt = now.toISOString();
        const fresh: CachedLiveDetail = { liveDetail, retrievedAt };
        await cache.set(experienceId, fresh); // store with Retrieved_At (R2.4)
        return toResult(fresh, false);
      } catch {
        // Step 4/5: any failure falls back to cache or live_unavailable. The
        // Disney source being unreachable while complete serves stale rather
        // than ever contacting ThemeParks.wiki (R14.4).
        return failureFallback(experienceId, cached);
      }
    },
  };

  /**
   * Fetch the Disney live documents under a 5-second `AbortController`
   * deadline (R2.6). The timer aborts the in-flight request; the abort
   * surfaces as a rejected promise the caller's catch treats as a failed
   * retrieval.
   */
  async function fetchWithDeadline(
    enterpriseId: string,
  ): Promise<LiveProjectionInput> {
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), deadlineMs);
    try {
      return await client.getEntityLiveInput(enterpriseId, controller.signal);
    } finally {
      clearTimeoutImpl(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Serve the most recent cached value `stale:true` without overwriting it when
 * one exists (R2.6, R2.7, R3.1, R14.4); otherwise throw `live_unavailable` and
 * store nothing (R2.8).
 */
function failureFallback(
  experienceId: string,
  cached: CachedLiveDetail | null,
): DisneyLiveDetailResult {
  if (cached !== null) {
    return toResult(cached, true);
  }
  throw new AppError(
    'live_unavailable',
    `Live data is currently unavailable for experience ${experienceId}.`,
    { details: { experienceId } },
  );
}

/**
 * Build a {@link DisneyLiveDetailResult} from a cached entry, surfacing
 * `upstreamLastUpdated` distinct from `retrievedAt` only when the projected
 * detail carries it (R2.5).
 */
function toResult(
  entry: CachedLiveDetail,
  stale: boolean,
): DisneyLiveDetailResult {
  const upstreamLastUpdated = entry.liveDetail.upstreamLastUpdated;
  return {
    liveDetail: entry.liveDetail,
    retrievedAt: entry.retrievedAt,
    stale,
    ...(upstreamLastUpdated !== undefined ? { upstreamLastUpdated } : {}),
  };
}

/**
 * Age of a cached entry in seconds relative to `now`. An unparseable
 * `retrievedAt` yields `Infinity` so the entry is treated as past the TTL and a
 * fresh retrieval is attempted (a malformed stamp is never served as fresh).
 */
function cacheAgeSeconds(entry: CachedLiveDetail, now: Date): number {
  const retrievedMs = Date.parse(entry.retrievedAt);
  if (Number.isNaN(retrievedMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return (now.getTime() - retrievedMs) / 1000;
}
