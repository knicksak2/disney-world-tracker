/**
 * ThemeParks.wiki-sourced Live_Service orchestrator.
 *
 * The ThemeParks.wiki replacement for the retired Disney live orchestrator
 * (`services/catalog/disney/liveService.ts`). It wires the catalog
 * `getLiveDetail` port (`services/catalog/routes.ts`) to the pure
 * ThemeParks.wiki live projection (`themeParksLiveProject.ts`), keyed by the
 * Experience's `Enterprise_Id` (R11.1). It contacts ONLY the
 * ThemeParks.wiki live endpoint through the injected {@link ThemeParksLiveClient}
 * and NEVER a Disney source (R11.10, R12.3).
 *
 * The request lifecycle is identical to the retired orchestrator so the
 * resilience guarantees are unchanged; only the upstream and the projection
 * differ:
 *
 *   1. **Resolve** the Experience's `Enterprise_Id` via
 *      {@link LiveRepo.resolveUpstreamEntityId}. The catalog persists it as
 *      `experiences.upstream_entity_id`, and it equals the ThemeParks.wiki
 *      entity's `External_Id` (R11.2). A `null` result is a failed retrieval
 *      that NEVER contacts ThemeParks.wiki (mirrors R1.9) and falls through to
 *      the failure path.
 *   2. **Cache decision.** A cached entry within the `Live_Cache_TTL`
 *      (5 minutes) is served `stale:false` without any upstream call (R2.2).
 *   3. **Fetch fresh** under a 5-second deadline (R2.6) from the ThemeParks.wiki
 *      live endpoint keyed by `externalId = enterpriseId`, select the matching
 *      `liveData` entry, project via `projectThemeParksLive` in the entity's
 *      time zone (R11.9), store with a fresh `retrievedAt` (R2.4), and serve
 *      `stale:false`.
 *   4. **Failure with a cached entry:** serve the most recent cached value
 *      regardless of age, marked `stale:true`, without overwriting it
 *      (R2.6, R2.7, R3.1, R12.10).
 *   5. **Failure with NO cache:** throw `AppError('live_unavailable')` (→ 503),
 *      storing nothing (R2.8). NEVER falls back to a Disney source (R11.10,
 *      R12.3).
 *
 * The orchestrator depends only on injected collaborators so it is unit-testable
 * with in-memory fakes and a controlled clock — no Redis, database, or network.
 *
 * Validates: Requirements 11.1, 11.10, 12.3, 13.1
 */

import type { LiveDetailDTO } from '@dwt/shared';

import { AppError } from '../../errors/index.js';
import type { CachedLiveDetail, LiveCache } from './cache.js';
import { LIVE_CACHE_TTL_SECONDS } from './cache.js';
import type { LiveRepo } from './repo.js';
import { WDW_TIME_ZONE } from './parkTime.js';
import {
  projectThemeParksLive,
  type ThemeParksLiveInput,
} from './themeParksLiveProject.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveEntry,
  ThemeParksLiveResponse,
} from './themeParksLiveClient.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The retrieval metadata wrapping the projected Live_Detail served to the App.
 * Structurally identical to the retired `DisneyLiveDetailResult`:
 * `retrievedAt` is always present (R2.5); `stale` flags a fallback serve
 * (R2.6, R2.7, R3.1); `upstreamLastUpdated` is surfaced distinct from
 * `retrievedAt` when the projected detail carries it.
 */
export interface ThemeParksLiveDetailResult {
  readonly liveDetail: LiveDetailDTO;
  readonly retrievedAt: string;
  readonly stale: boolean;
  readonly upstreamLastUpdated?: string;
}

/** Public surface consumed by the catalog `getLiveDetail` port. */
export interface ThemeParksLiveService {
  /**
   * Resolve, cache-check, and (when needed) fetch the Live_Detail for an
   * Experience from ThemeParks.wiki. Throws `AppError('live_unavailable')`
   * only when a fresh retrieval fails and no cached value exists (R2.8).
   */
  getLiveDetail(
    experienceId: string,
    now?: Date,
  ): Promise<ThemeParksLiveDetailResult>;
}

/** Default deadline for a fresh ThemeParks.wiki retrieval (R2.6): five seconds. */
export const THEMEPARKS_LIVE_FETCH_DEADLINE_MS = 5_000;

// ---------------------------------------------------------------------------
// Dependencies / factory
// ---------------------------------------------------------------------------

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ThemeParksLiveServiceDeps {
  /** Read-only resolver of Experience id → `Enterprise_Id` (R11.1). */
  readonly repo: LiveRepo;
  /** Short-lived Live_Cache (R2.2, R2.4). */
  readonly cache: LiveCache;
  /** ThemeParks.wiki live source (R11.1); never a Disney source (R11.10). */
  readonly client: ThemeParksLiveClient;
  /**
   * Resolve an Experience's `Enterprise_Id` to the ThemeParks.wiki entity id
   * (a GUID) whose `externalId` equals it (R11.2). The live endpoint is keyed
   * by that entity id, NOT by the `externalId`, so this join must happen before
   * fetching. Returns `null` when ThemeParks.wiki tracks no such entity, which
   * drives the graceful `live_unavailable` fallback.
   */
  readonly resolveEntityId: (enterpriseId: string) => Promise<string | null>;
  /** Clock provider; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /**
   * IANA time zone for projection when the upstream response carries none;
   * defaults to WDW Eastern (R11.9).
   */
  readonly parkTimeZone?: string;
  /** Fresh-retrieval deadline in ms; defaults to {@link THEMEPARKS_LIVE_FETCH_DEADLINE_MS}. */
  readonly deadlineMs?: number;
  /** Timer injection for deterministic deadline tests. */
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeoutFn?: (handle: TimerHandle) => void;
}

/**
 * Construct a {@link ThemeParksLiveService} from injected collaborators.
 * Constructor injection keeps the orchestrator unit- and property-testable
 * with in-memory fakes and a controlled clock.
 */
export function createThemeParksLiveService(
  deps: ThemeParksLiveServiceDeps,
): ThemeParksLiveService {
  const { repo, cache, client } = deps;
  const clock = deps.now ?? (() => new Date());
  const resolveEntityId = deps.resolveEntityId;
  const parkTimeZone = deps.parkTimeZone ?? WDW_TIME_ZONE;
  const deadlineMs = deps.deadlineMs ?? THEMEPARKS_LIVE_FETCH_DEADLINE_MS;
  const setTimeoutImpl = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutImpl = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));

  return {
    async getLiveDetail(
      experienceId: string,
      nowOverride?: Date,
    ): Promise<ThemeParksLiveDetailResult> {
      const now = nowOverride ?? clock();

      // Step 1: resolve the Enterprise_Id (R11.1). An unresolved id never
      // contacts ThemeParks.wiki and falls straight through to the failure path.
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

      // Step 3: resolve the ThemeParks.wiki entity id (a GUID) whose
      // `externalId` equals the Enterprise_Id (R11.2), then fetch its live feed
      // under a 5-second deadline (R2.6) and project (R11). The live endpoint is
      // keyed by the entity id, not the externalId, so this join is required.
      // A resolution miss (ThemeParks.wiki tracks no such entity) degrades to
      // the cache / live_unavailable fallback rather than erroring.
      let themeParksId: string | null;
      try {
        themeParksId = await resolveEntityId(enterpriseId);
      } catch {
        themeParksId = null;
      }
      if (themeParksId === null) {
        return failureFallback(experienceId, cached);
      }

      try {
        const response = await fetchWithDeadline(themeParksId);
        const entry = selectLiveEntry(response, themeParksId);
        const input = toThemeParksLiveInput(entry, response.timezone);
        // Prefer the entity's own IANA time zone from the feed; fall back to the
        // orchestrator's configured Park time zone when the feed carries none
        // (R11.9).
        const liveDetail = projectThemeParksLive(
          input,
          now,
          response.timezone ?? parkTimeZone,
        );
        const retrievedAt = now.toISOString();
        const fresh: CachedLiveDetail = { liveDetail, retrievedAt };
        await cache.set(experienceId, fresh); // store with Retrieved_At (R2.4)
        return toResult(fresh, false);
      } catch {
        // Step 4/5: any failure (fetch error, deadline abort, empty feed) falls
        // back to the cache or live_unavailable — never to a Disney source
        // (R11.10, R12.3).
        return failureFallback(experienceId, cached);
      }
    },
  };

  /**
   * Fetch the ThemeParks.wiki live feed for a resolved ThemeParks entity id (a
   * GUID), under a 5-second `AbortController` deadline (R2.6). The timer aborts
   * the in-flight request; the abort surfaces as a rejected promise the caller's
   * catch treats as a failed retrieval.
   */
  async function fetchWithDeadline(
    themeParksId: string,
  ): Promise<ThemeParksLiveResponse> {
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), deadlineMs);
    try {
      return await client.getEntityLive(themeParksId, controller.signal);
    } finally {
      clearTimeoutImpl(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Select the `liveData` entry that corresponds to the resolved ThemeParks
 * entity. The feed is keyed by the entity's own id, so a well-formed response
 * carries the matching entity's live data as the first (and usually only)
 * `liveData` entry. When several entries are present we prefer the one whose
 * `id` equals the resolved `themeParksId`; otherwise we take the first entry.
 * An empty feed throws so the caller falls back to stale-serve or 503 rather
 * than projecting a fabricated empty detail.
 */
function selectLiveEntry(
  response: ThemeParksLiveResponse,
  themeParksId: string,
): ThemeParksLiveEntry {
  const entries = response.liveData;
  if (entries.length === 0) {
    throw new Error(
      `ThemeParks.wiki live feed for ${themeParksId} carried no liveData entries.`,
    );
  }
  const matched = entries.find((entry) => entry.id === themeParksId);
  return matched ?? (entries[0] as ThemeParksLiveEntry);
}

/**
 * Adapt a {@link ThemeParksLiveEntry} (the live client's wire shape) into the
 * projection's {@link ThemeParksLiveInput}. The two shapes are structurally
 * close but declared independently, so the queue / forecast / dining-array
 * sub-shapes are bridged explicitly. The projection is fully defensive, so any
 * shape drift is tolerated field-by-field there rather than here.
 */
function toThemeParksLiveInput(
  entry: ThemeParksLiveEntry,
  timezone: string | undefined,
): ThemeParksLiveInput {
  return {
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.lastUpdated !== undefined ? { lastUpdated: entry.lastUpdated } : {}),
    ...(entry.queue !== undefined
      ? { queue: entry.queue as unknown as NonNullable<ThemeParksLiveInput['queue']> }
      : {}),
    ...(entry.showtimes !== undefined ? { showtimes: entry.showtimes } : {}),
    ...(entry.operatingHours !== undefined
      ? { operatingHours: entry.operatingHours }
      : {}),
    ...(entry.forecast !== undefined
      ? {
          forecast:
            entry.forecast as unknown as NonNullable<ThemeParksLiveInput['forecast']>,
        }
      : {}),
    ...(entry.diningAvailability !== undefined
      ? {
          diningAvailability:
            entry.diningAvailability as unknown as NonNullable<
              ThemeParksLiveInput['diningAvailability']
            >,
        }
      : {}),
    ...(timezone !== undefined ? { timezone } : {}),
  };
}

/**
 * Serve the most recent cached value `stale:true` without overwriting it when
 * one exists (R2.6, R2.7, R3.1); otherwise throw `live_unavailable` and store
 * nothing (R2.8). Never contacts a Disney source (R11.10, R12.3).
 */
function failureFallback(
  experienceId: string,
  cached: CachedLiveDetail | null,
): ThemeParksLiveDetailResult {
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
 * Build a {@link ThemeParksLiveDetailResult} from a cached entry, surfacing
 * `upstreamLastUpdated` distinct from `retrievedAt` only when the projected
 * detail carries it (R2.5).
 */
function toResult(
  entry: CachedLiveDetail,
  stale: boolean,
): ThemeParksLiveDetailResult {
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
