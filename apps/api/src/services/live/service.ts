/**
 * Live_Service orchestrator.
 *
 * Task 7.1 of the experience-live-details plan. Implements the request
 * lifecycle described in design.md "Orchestrator (service.ts)" and the
 * flow diagram, tying together the four collaborators in this folder:
 *
 *   - `repo.resolveUpstreamEntityId` — internal Experience id → upstream id (R1.1, R1.9)
 *   - `cache.get` / `cache.set`     — the short-lived Live_Cache (R2.2, R2.4)
 *   - `client.getEntityLive`        — the upstream live fetch (R1.1, R1.8, R2.6)
 *   - `projectLiveDetail`           — raw payload → strict Live_Detail (R1.2-R1.22)
 *
 * The five-step flow:
 *
 *   1. **Resolve** the upstream id. On `null`, treat as a failed retrieval and
 *      do NOT contact upstream (R1.9), falling through to the failure path.
 *   2. **Cache decision.** When a cached entry exists and its age is at most
 *      the `Live_Cache_TTL` (5 minutes), serve it `stale:false` without any
 *      upstream call (R2.2).
 *   3. **Fetch fresh** with a 5-second `AbortController` deadline when there is
 *      no cache or the cache is older than the TTL (R2.1). On success, project
 *      (R1.2-R1.22), store with a fresh `retrievedAt` (R2.4), and serve
 *      `stale:false` (R2.5).
 *   4. **Failure** (upstream error, unparseable body, deadline timeout, or
 *      unresolved id) WITH a cached entry: serve the most recent cached value
 *      regardless of age, marked `stale:true`, and do NOT overwrite it
 *      (R1.8, R2.6, R2.7, R3.1).
 *   5. **Failure with NO cache:** throw `AppError('live_unavailable')` and
 *      store nothing (R2.8).
 *
 * The orchestrator depends only on the injected collaborator interfaces (via
 * `createLiveService`), so the property tests in tasks 7.2-7.6 can drive it
 * with in-memory fakes and a controlled clock — no Redis, database, or network.
 *
 * Validates: Requirements 1.8, 1.9, 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1
 */

import { AppError } from '../../errors/index.js';
import type { CachedLiveDetail, LiveCache } from './cache.js';
import { LIVE_CACHE_TTL_SECONDS } from './cache.js';
import { projectLiveDetail, type ProjectionContext } from './project.js';
import type { LiveRepo } from './repo.js';
import { WDW_TIME_ZONE } from './parkTime.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveEntry,
  ThemeParksLiveResponse,
} from './themeparksLive.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The retrieval metadata wrapping the projected Live_Detail served to the App.
 * `retrievedAt` is always present (R2.5); `stale` flags a fallback serve
 * (R2.6, R2.7, R3.1); `upstreamLastUpdated` is surfaced distinct from
 * `retrievedAt` when the projected detail carries it (R1.22).
 */
export interface LiveDetailResult {
  readonly liveDetail: import('@dwt/shared').LiveDetailDTO;
  readonly retrievedAt: string;
  readonly stale: boolean;
  readonly upstreamLastUpdated?: string;
}

export interface LiveService {
  /**
   * Resolve, cache-check, and (when needed) fetch the Live_Detail for an
   * Experience. Throws `AppError('live_unavailable')` only when a fresh
   * retrieval fails and no cached value exists at all (R2.8).
   *
   * @param now optional override for the request instant (testing); defaults
   *            to the injected clock.
   */
  getLiveDetail(experienceId: string, now?: Date): Promise<LiveDetailResult>;
}

/**
 * Default deadline for a fresh upstream retrieval (R2.6). Five seconds mirrors
 * the Catalog_Service opportunistic-sync deadline.
 */
export const LIVE_FETCH_DEADLINE_MS = 5_000;

// ---------------------------------------------------------------------------
// Dependencies / factory
// ---------------------------------------------------------------------------

/**
 * Minimal timer surface so tests can drive the deadline without real timers.
 * Defaults to the host `setTimeout`/`clearTimeout`.
 */
type TimerHandle = ReturnType<typeof setTimeout>;

export interface LiveServiceDeps {
  readonly repo: LiveRepo;
  readonly cache: LiveCache;
  readonly client: ThemeParksLiveClient;
  /** Clock provider; defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Park IANA time zone for projection; defaults to WDW Eastern. */
  readonly parkTimeZone?: string;
  /** Fresh-retrieval deadline in ms; defaults to {@link LIVE_FETCH_DEADLINE_MS}. */
  readonly deadlineMs?: number;
  /** Timer injection for deterministic deadline tests. */
  readonly setTimeoutFn?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimeoutFn?: (handle: TimerHandle) => void;
}

/**
 * Construct a {@link LiveService} from injected collaborators. Constructor
 * injection (rather than module-level singletons) keeps the orchestrator
 * unit- and property-testable with in-memory fakes.
 */
export function createLiveService(deps: LiveServiceDeps): LiveService {
  const { repo, cache, client } = deps;
  const clock = deps.now ?? (() => new Date());
  const parkTimeZone = deps.parkTimeZone ?? WDW_TIME_ZONE;
  const deadlineMs = deps.deadlineMs ?? LIVE_FETCH_DEADLINE_MS;
  const setTimeoutImpl = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutImpl = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));

  return {
    async getLiveDetail(
      experienceId: string,
      nowOverride?: Date,
    ): Promise<LiveDetailResult> {
      const now = nowOverride ?? clock();

      // Step 1: resolve the upstream id (R1.1, R1.9).
      const upstreamId = await repo.resolveUpstreamEntityId(experienceId);

      // Read the cached entry once; it is needed both for the freshness
      // decision (step 2) and the stale-serve fallback (step 4).
      const cached = await cache.get(experienceId);

      // An unresolved id is a failed retrieval that never contacts upstream
      // (R1.9): fall straight through to the failure path.
      if (upstreamId === null) {
        return failureFallback(experienceId, cached);
      }

      // Step 2: serve a sufficiently-fresh cached entry without upstream (R2.2).
      if (cached !== null && cacheAgeSeconds(cached, now) <= LIVE_CACHE_TTL_SECONDS) {
        return toResult(cached, false);
      }

      // Step 3: fetch fresh with a 5-second deadline (R2.1, R2.6).
      try {
        const response = await fetchWithDeadline(upstreamId);
        const entry = pickEntry(response, upstreamId);
        const ctx: ProjectionContext = { parkTimeZone, now };
        const liveDetail = projectLiveDetail(entry, ctx);
        const retrievedAt = now.toISOString();
        const fresh: CachedLiveDetail = { liveDetail, retrievedAt };
        await cache.set(experienceId, fresh); // store with Retrieved_At (R2.4)
        return toResult(fresh, false);
      } catch {
        // Step 4/5: any failure falls back to cache or live_unavailable.
        return failureFallback(experienceId, cached);
      }
    },
  };

  /**
   * Fetch the upstream live payload under a 5-second `AbortController`
   * deadline. The timer aborts the in-flight request, surfacing as an
   * `UpstreamError('aborted')` that the caller's catch treats as a failed
   * retrieval (R2.6).
   */
  async function fetchWithDeadline(
    upstreamId: string,
  ): Promise<ThemeParksLiveResponse> {
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), deadlineMs);
    try {
      return await client.getEntityLive(upstreamId, controller.signal);
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
 * one exists (R1.8, R2.6, R2.7, R3.1); otherwise throw `live_unavailable` and
 * store nothing (R2.8).
 */
function failureFallback(
  experienceId: string,
  cached: CachedLiveDetail | null,
): LiveDetailResult {
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
 * Build a {@link LiveDetailResult} from a cached entry, surfacing
 * `upstreamLastUpdated` distinct from `retrievedAt` only when the projected
 * detail carries it (R1.22, R2.5).
 */
function toResult(entry: CachedLiveDetail, stale: boolean): LiveDetailResult {
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
 * `retrievedAt` yields `Infinity` so the entry is treated as past the TTL and
 * a fresh retrieval is attempted (a malformed stamp is never served as fresh).
 */
function cacheAgeSeconds(entry: CachedLiveDetail, now: Date): number {
  const retrievedMs = Date.parse(entry.retrievedAt);
  if (Number.isNaN(retrievedMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return (now.getTime() - retrievedMs) / 1000;
}

/**
 * Select the liveData entry to project: the one whose `id` matches the
 * resolved upstream id, else the first entry (design "The projection operates
 * on the matching liveData entry"). An empty `liveData` array has no entry to
 * project and is treated as a failed retrieval.
 */
function pickEntry(
  response: ThemeParksLiveResponse,
  upstreamId: string,
): ThemeParksLiveEntry {
  const entries = response.liveData;
  const matched = entries.find((entry) => entry.id === upstreamId);
  const entry = matched ?? entries[0];
  if (entry === undefined) {
    throw new Error('Upstream live response contained no liveData entries.');
  }
  return entry;
}
