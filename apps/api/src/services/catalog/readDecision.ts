/**
 * Catalog read decision: when to serve cached data, when to opportunistically
 * sync, and when to declare the catalog unavailable.
 *
 * This module encodes the rule set described in design.md ("Opportunistic
 * sync on read") and the corresponding requirements:
 *
 *   - R1.11  Cache age strictly > 24 hours triggers an opportunistic sync;
 *            serve the existing cache if the sync does not complete within
 *            5 seconds.
 *   - R1.12  Cache age <= 24 hours serves from cache without an
 *            opportunistic sync.
 *   - R1.13  Any upstream error keeps the existing cache contents intact and
 *            returns the data with a `staleCache: true` flag.
 *   - R1.24  When no successful prior cache exists and upstream is
 *            unreachable, the API returns 503 `catalog_unavailable` so the
 *            App can render the catalog-load error message.
 *
 * The decision logic itself is a pure orchestration over two injected
 * dependencies — a `repo` that knows the cache age and a `sync` orchestrator
 * that can trigger or join an in-flight Catalog_Sync — plus optional
 * `setTimeout`/`clearTimeout` injections so the property test in task 9.7
 * (Property 4) can drive the 5-second deadline against a deterministic
 * clock. The route handler in task 9.6 wires this module to the real
 * `apps/api/src/services/catalog/repo.ts` (task 9.2) and
 * `apps/api/src/services/catalog/sync.ts` (task 9.3) instances and reads
 * the actual experience rows from the repo *after* this function has
 * decided whether the cache is acceptable to serve.
 *
 * The 5-second race never cancels the underlying sync: if the deadline
 * fires first, the sync continues in the background per the design. The
 * caller (this module) attaches a no-op `.catch` handler so that a late
 * sync rejection cannot escape as an unhandled rejection after the request
 * has already resumed from cache.
 *
 * Validates: Requirements 1.11, 1.12, 1.13, 1.24
 */

import { AppError } from '../../errors/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cache-age threshold (R1.11/R1.12). The boundary is *strictly greater than*
 * 24 hours: a cache exactly 24h old is still considered fresh and is served
 * directly without an opportunistic sync.
 */
export const STALE_CACHE_AGE_HOURS = 24;

/**
 * Deadline for the opportunistic-sync race (R1.11). When the sync does not
 * complete within this window, the caller serves the existing cache with
 * `staleCache: true` and the sync continues running in the background.
 */
export const SYNC_RACE_DEADLINE_MS = 5_000;

// ---------------------------------------------------------------------------
// Injected dependency interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal projection of the Catalog repo (task 9.2) that the read-decision
 * logic needs. The full repo also exposes `listActiveExperiences`,
 * `getExperience`, etc.; those are read by the route handler *after* the
 * decision is made and are intentionally out of scope here.
 */
export interface ReadDecisionRepo {
  /**
   * Age of the most recent successful Catalog_Sync snapshot, expressed in
   * hours. Returns `null` when no Catalog_Sync has ever succeeded against
   * this database (i.e. there is no cache to fall back on).
   *
   * Per R1.13 a failed sync leaves the cache contents unchanged, so a
   * non-null result here is always backed by readable rows.
   */
  getCacheAgeHours(): Promise<number | null>;
}

/**
 * Minimal projection of the Catalog_Sync orchestrator (task 9.3). The
 * orchestrator is responsible for the Redis NX lock that prevents
 * duplicate concurrent syncs; this module never observes the lock
 * directly. From this module's perspective there is one operation —
 * "make sure a sync is running, and tell me when it's done" — and that is
 * exactly what `runOrJoinSync` provides.
 */
export interface ReadDecisionSync {
  /**
   * Trigger an opportunistic Catalog_Sync, or join an already-running one
   * if a sync is in flight. Resolves when the sync has *successfully*
   * refreshed the cache. Rejects when the sync run fails (upstream error,
   * lock contention timeout, etc.).
   *
   * Implementations must not cancel a sync run if the returned promise is
   * abandoned by the caller: per design.md the sync continues in the
   * background even when the read request resumes from cache after the
   * 5-second deadline.
   */
  runOrJoinSync(): Promise<void>;
}

/**
 * Aggregate dependency bundle for `decideCatalogRead`.
 *
 * `setTimeoutFn` and `clearTimeoutFn` default to the host's `setTimeout`
 * and `clearTimeout`; tests override them to drive the deadline against
 * a controlled clock without relying on Vitest's fake-timer global state.
 */
export interface ReadDecisionDeps {
  readonly repo: ReadDecisionRepo;
  readonly sync: ReadDecisionSync;
  /** Override for the deadline timer; defaults to the global `setTimeout`. */
  readonly setTimeoutFn?: (
    callback: () => void,
    ms: number,
  ) => ReadDecisionTimerHandle;
  /** Override for the deadline timer cleanup; defaults to global `clearTimeout`. */
  readonly clearTimeoutFn?: (handle: ReadDecisionTimerHandle) => void;
}

/**
 * Opaque timer handle threaded between `setTimeoutFn` and `clearTimeoutFn`.
 * Real Node returns an object; browser/JSDOM returns a number; tests can
 * return anything they like. We do not introspect the value.
 */
export type ReadDecisionTimerHandle = unknown;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Decision outcome. The route handler reads the actual catalog rows from
 * the repo separately; this module only signals whether the response must
 * carry the stale-cache flag.
 *
 *   - `staleCache: false` — cache age <= 24h, or the opportunistic sync
 *      refreshed the cache successfully within the 5-second deadline.
 *   - `staleCache: true`  — cache exists but the opportunistic sync
 *      timed out at 5 seconds or failed; the cache contents are unchanged
 *      per R1.13 and must be served with the stale flag.
 *
 * The "no cache + upstream unreachable" case is signaled by throwing an
 * `AppError('catalog_unavailable')` instead of returning a result, so the
 * route handler propagates the error envelope unchanged.
 */
export interface ReadDecision {
  readonly staleCache: boolean;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Decide whether the catalog read may proceed against the existing cache,
 * whether the response should carry the `staleCache: true` flag, or
 * whether the catalog is unavailable.
 *
 * The function never reads the catalog rows itself; the caller does so
 * from the repo once this function returns. That separation keeps the
 * decision logic free of row-shape dependencies and makes Property 4 (task
 * 9.7) testable purely over `(cacheAgeHours, syncOutcome, syncLatencyMs)`
 * without needing to fabricate experience fixtures.
 *
 * @throws AppError('catalog_unavailable') when there is no successful prior
 *         cache and the opportunistic sync did not succeed within the
 *         deadline. HTTP 503 is applied by the global error hook via
 *         `errorCodeToHttpStatus['catalog_unavailable']`.
 */
export async function decideCatalogRead(
  deps: ReadDecisionDeps,
): Promise<ReadDecision> {
  const cacheAgeHours = await deps.repo.getCacheAgeHours();

  // R1.12: a fresh cache is served directly. The strict-greater-than
  // comparison matches R1.11 ("strictly exceeds 24 hours") so a cache
  // age of exactly 24h falls through here.
  if (cacheAgeHours !== null && cacheAgeHours <= STALE_CACHE_AGE_HOURS) {
    return { staleCache: false };
  }

  // R1.11: cache is stale (or missing). Race a sync against the 5-second
  // deadline. The sync continues in the background regardless of which
  // side of the race resolves first.
  const outcome = await raceSyncAgainstDeadline(deps);

  if (outcome === 'success') {
    // The sync refreshed the cache before the deadline fired. Whatever
    // cache age we observed earlier is no longer relevant; the route
    // handler will read the freshly written rows.
    return { staleCache: false };
  }

  // R1.13 / R1.24: timeout or error. If we have any prior successful cache
  // to serve, mark the response stale; otherwise surface 503.
  if (cacheAgeHours === null) {
    throw new AppError(
      'catalog_unavailable',
      'The Disney World catalog could not be loaded.',
    );
  }
  return { staleCache: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Outcome of the deadline race. `'timeout'` means the deadline fired
 * before the sync settled; `'error'` means the sync settled with a
 * rejection inside the deadline window; `'success'` means the sync
 * resolved inside the deadline window.
 */
type SyncRaceOutcome = 'success' | 'error' | 'timeout';

/**
 * Race the injected sync orchestrator against the 5-second deadline.
 *
 * The sync rejection is converted to a settled `'error'` value via
 * `.catch`, which simultaneously serves as the unhandled-rejection guard
 * for the case where the deadline wins the race and the underlying sync
 * later fails after the request has already moved on.
 *
 * The deadline timer is always cleared on the way out so that a
 * fast-resolving sync does not leave a stray timer pending in the event
 * loop.
 */
async function raceSyncAgainstDeadline(
  deps: ReadDecisionDeps,
): Promise<SyncRaceOutcome> {
  const setTimeoutImpl = deps.setTimeoutFn ?? defaultSetTimeout;
  const clearTimeoutImpl = deps.clearTimeoutFn ?? defaultClearTimeout;

  const syncPromise: Promise<SyncRaceOutcome> = deps.sync
    .runOrJoinSync()
    .then<SyncRaceOutcome>(() => 'success')
    .catch<SyncRaceOutcome>(() => 'error');

  let timerHandle: ReadDecisionTimerHandle | undefined;
  const timeoutPromise = new Promise<SyncRaceOutcome>((resolve) => {
    timerHandle = setTimeoutImpl(() => resolve('timeout'), SYNC_RACE_DEADLINE_MS);
  });

  try {
    return await Promise.race([syncPromise, timeoutPromise]);
  } finally {
    if (timerHandle !== undefined) {
      clearTimeoutImpl(timerHandle);
    }
  }
}

/**
 * Default `setTimeout` adapter. Wrapping the global keeps the typed
 * dependency interface narrow (we expose only `(cb, ms) => handle`) and
 * lets tests substitute a controllable clock without monkey-patching
 * globals.
 */
function defaultSetTimeout(
  callback: () => void,
  ms: number,
): ReadDecisionTimerHandle {
  return setTimeout(callback, ms);
}

/**
 * Default `clearTimeout` adapter; companion to {@link defaultSetTimeout}.
 */
function defaultClearTimeout(handle: ReadDecisionTimerHandle): void {
  // The global `clearTimeout` accepts both Node `Timeout` objects and
  // browser numeric handles; a typed cast keeps the public API agnostic.
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}
