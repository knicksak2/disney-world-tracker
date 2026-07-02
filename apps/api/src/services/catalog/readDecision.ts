/**
 * Catalog read decision: when to serve cached data, when to opportunistically
 * refresh from the Disney sources, and when to declare the catalog
 * unavailable.
 *
 * This module encodes the rule set described in design.md (section 12,
 * "Routes" / the `decideCatalogRead` read path) and the corresponding
 * Disney Upstream-Resilience requirements (Requirement 12):
 *
 *   - R12.9  When the Catalog_Cache is older than 24 hours at the time of a
 *            catalog read, refresh the cache from the Disney sources; serve
 *            the existing cache if the refresh does not complete within the
 *            5-second read deadline.
 *   - R12.6  While the Disney sources are reachable, catalog reads are served
 *            from the Catalog_Cache. A cache age <= 24 hours serves from cache
 *            without an opportunistic refresh.
 *   - R12.1  When a Disney source fails (connection failure or the 10-second
 *            request timeout) and a prior Catalog_Cache exists, serve the
 *            cached catalog with a staleness indicator conveying that the
 *            response was served from cache and the cache's age.
 *   - R12.4  A failed Catalog_Sync run is recorded as `failed` and leaves the
 *            prior Catalog_Cache unchanged. This module never writes the
 *            cache; the repo/sync own all cache writes, so a failed refresh
 *            leaves the cache contents intact by construction.
 *   - R12.7  If a prior Catalog_Cache exists, the cached catalog is served
 *            rather than a `503 catalog_unavailable` error.
 *   - R12.2  When no prior Catalog_Cache exists and the Disney source is
 *            unreachable, the API responds with `503 catalog_unavailable` so
 *            the App can render the catalog-load error message.
 *
 * Disney Source Resilience (this spec) re-states the degradation contract and
 * widens the failure vocabulary this module must tolerate:
 *
 *   - R12.1 (resilience) — IF a Catalog_Sync run fails *for any reason* the
 *            prior Catalog_Cache is left byte-identical and the API keeps
 *            serving it with a staleness indicator conveying the cache's age.
 *   - R12.2 (resilience) — a Disney_Source block (`waf_block`) or credential
 *            rejection (`auth_failure`) must NOT surface an error while a prior
 *            Catalog_Cache exists; catalog reads continue from that cache.
 *
 * A failed opportunistic refresh now settles with a `SyncRunOutcome` drawn from
 * the shared closed set (`success | waf_block | auth_failure | network |
 * invalid_response | aborted`, `@dwt/shared`). Every non-`success` outcome is
 * treated identically by the degradation path — the observed cache is served
 * stale with its age — so a WAF edge block and a genuine auth failure both
 * degrade gracefully rather than error, and `catalog_unavailable` (503) is
 * surfaced *only* on a first-ever failure with no prior cache. The specific
 * outcome is additionally conveyed on the decision as `staleReason` so the
 * caller can distinguish *why* the cache is stale (block visibility, R12.4 /
 * R12.5) without changing the serve/degrade behavior.
 *
 * The decision logic itself is a pure orchestration over two injected
 * dependencies — a `repo` that knows the cache age and a `sync` orchestrator
 * that can trigger or join an in-flight Catalog_Sync — plus optional
 * `setTimeout`/`clearTimeout` injections so the read-decision property test
 * (Property 20) can drive the 5-second deadline against a deterministic
 * clock. The route handler (task 10.3, `routes.ts`) wires this module to the
 * real `apps/api/src/services/catalog/repo.ts` and
 * `apps/api/src/services/catalog/sync.ts` instances and reads the actual
 * experience rows from the repo *after* this function has decided whether the
 * cache is acceptable to serve. The returned `cacheAgeHours` is threaded into
 * the `/catalog` response alongside `staleCache` so the App receives the
 * cache's age (R12.1).
 *
 * The 5-second race never cancels the underlying sync: if the deadline
 * fires first, the sync continues in the background per the design. The
 * caller (this module) attaches a no-op `.catch` handler so that a late
 * sync rejection cannot escape as an unhandled rejection after the request
 * has already resumed from cache.
 *
 * Validates: Requirements 12.1, 12.2, 12.4, 12.6, 12.7, 12.9
 */

import { AppError } from '../../errors/index.js';
import { outcomeFromError } from './outcome.js';
import type { SyncRunOutcome } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cache-age threshold (R12.6/R12.9). The boundary is *strictly greater than*
 * 24 hours: a cache exactly 24h old is still considered fresh and is served
 * directly without an opportunistic refresh.
 */
export const STALE_CACHE_AGE_HOURS = 24;

/**
 * Deadline for the opportunistic-refresh race (R12.9). When the refresh does
 * not complete within this window, the caller serves the existing cache with
 * `staleCache: true` and the sync continues running in the background.
 */
export const SYNC_RACE_DEADLINE_MS = 5_000;

// ---------------------------------------------------------------------------
// Injected dependency interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal projection of the Catalog repo that the read-decision logic needs.
 * The full repo also exposes `listActiveExperiences`, `getExperience`, etc.;
 * those are read by the route handler *after* the decision is made and are
 * intentionally out of scope here.
 */
export interface ReadDecisionRepo {
  /**
   * Age of the most recent successful Catalog_Sync snapshot, expressed in
   * hours. Returns `null` when no Catalog_Sync has ever succeeded against
   * this database (i.e. there is no cache to fall back on).
   *
   * Per R12.4 a failed sync leaves the cache contents unchanged, so a
   * non-null result here is always backed by readable rows.
   */
  getCacheAgeHours(): Promise<number | null>;
}

/**
 * Minimal projection of the Catalog_Sync orchestrator. The orchestrator is
 * responsible for the Redis NX lock that prevents duplicate concurrent
 * syncs; this module never observes the lock directly. From this module's
 * perspective there is one operation — "make sure a sync is running, and
 * tell me when it's done" — and that is exactly what `runOrJoinSync`
 * provides.
 */
export interface ReadDecisionSync {
  /**
   * Trigger an opportunistic Catalog_Sync, or join an already-running one
   * if a sync is in flight. Resolves when the sync has *successfully*
   * refreshed the cache. Rejects when the sync run fails (upstream error,
   * lock contention timeout, etc.).
   *
   * A rejection is classified into a `SyncRunOutcome` (the shared closed set
   * `success | waf_block | auth_failure | network | invalid_response |
   * aborted`) via `outcomeFromError`, so a `DisneyTransportError` carrying a
   * `waf_block` or `auth_failure` `kind` is recognized as its own degradation
   * reason. The read-decision path treats every non-`success` outcome the
   * same way — serve the prior cache stale (or 503 when there is none) — and
   * only uses the classified outcome to convey *why* the cache is stale.
   *
   * Implementations must not cancel a sync run if the returned promise is
   * abandoned by the caller: per design.md the sync continues in the
   * background even when the read request resumes from cache after the
   * 5-second deadline. A failed run leaves the prior Catalog_Cache
   * unchanged and is recorded as `failed` by the orchestrator (R12.4);
   * this module performs no cache writes of its own.
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
 * carry the stale-cache flag and the observed age of the cache.
 *
 *   - `staleCache: false` — cache age <= 24h, or the opportunistic refresh
 *      updated the cache successfully within the 5-second deadline.
 *   - `staleCache: true`  — cache exists but the opportunistic refresh
 *      timed out at 5 seconds or failed; the cache contents are unchanged
 *      per R12.4 and must be served with the stale flag (R12.1, R12.7).
 *
 * `cacheAgeHours` is the age (in hours) of the cache being served, taken
 * from the repo observation made at the start of the decision. The route
 * handler (task 10.3) surfaces it in the `/catalog` response so the App
 * receives the cache's age alongside the staleness indicator (R12.1):
 *
 *   - When serving a fresh cache directly (age <= 24h), it is the observed
 *      age.
 *   - When serving a stale cache after a failed/timed-out refresh, it is the
 *      observed age (which necessarily exceeds 24h).
 *   - When the refresh succeeded within the deadline, the cache was just
 *      rewritten and the pre-refresh age no longer describes it, so this is
 *      `null` (freshly refreshed; no meaningful staleness to report).
 *
 * The "no cache + upstream unreachable" case is signaled by throwing an
 * `AppError('catalog_unavailable')` instead of returning a result, so the
 * route handler propagates the error envelope unchanged (R12.2).
 */
export interface ReadDecision {
  readonly staleCache: boolean;
  readonly cacheAgeHours: number | null;
  /**
   * Why the served cache is stale, when the staleness was caused by a *failed*
   * opportunistic refresh (R12.1/R12.2, resilience). Carries the classified
   * `SyncRunOutcome` — `waf_block`, `auth_failure`, `network`,
   * `invalid_response`, or `aborted` — so the caller can distinguish an Akamai
   * edge block from a credential failure for block visibility (R12.4, R12.5)
   * without altering the serve-stale behavior that is identical across every
   * failure kind.
   *
   * Omitted (never `undefined`, per `exactOptionalPropertyTypes`) when there
   * is no failure to report: on a fresh serve, on a successful refresh, and on
   * a deadline timeout where the refresh has not (yet) failed and the sync
   * continues in the background.
   */
  readonly staleReason?: SyncRunOutcome;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Decide whether the catalog read may proceed against the existing cache,
 * whether the response should carry the `staleCache: true` flag and the
 * cache's age, or whether the catalog is unavailable.
 *
 * The function never reads the catalog rows itself, nor does it write the
 * cache; the caller reads rows from the repo once this function returns and
 * the sync orchestrator owns all cache writes. That separation keeps the
 * decision logic free of row-shape dependencies, guarantees a failed refresh
 * leaves the cache unchanged (R12.4), and makes Property 20 testable purely
 * over `(cacheAgeHours, syncOutcome, syncLatencyMs)` without needing to
 * fabricate experience fixtures.
 *
 * @throws AppError('catalog_unavailable') when there is no successful prior
 *         cache and the opportunistic refresh did not succeed within the
 *         deadline. HTTP 503 is applied by the global error hook via
 *         `errorCodeToHttpStatus['catalog_unavailable']` (R12.2).
 */
export async function decideCatalogRead(
  deps: ReadDecisionDeps,
): Promise<ReadDecision> {
  const cacheAgeHours = await deps.repo.getCacheAgeHours();

  // R12.6: a fresh cache is served directly. The strict-greater-than
  // comparison matches R12.9 ("older than 24 hours") so a cache age of
  // exactly 24h falls through here and is served without a refresh.
  if (cacheAgeHours !== null && cacheAgeHours <= STALE_CACHE_AGE_HOURS) {
    return { staleCache: false, cacheAgeHours };
  }

  // R12.9: cache is stale (or missing). Race a refresh against the 5-second
  // deadline. The sync continues in the background regardless of which
  // side of the race resolves first.
  const outcome = await raceSyncAgainstDeadline(deps);

  if (outcome.kind === 'success') {
    // The refresh rewrote the cache before the deadline fired. The pre-refresh
    // age no longer describes the served rows, so we report a fresh serve with
    // no staleness age; the route handler reads the freshly written rows.
    return { staleCache: false, cacheAgeHours: null };
  }

  // R12.4 / R12.1 / R12.2 / R12.7: timeout or failure. The failed refresh left
  // the cache byte-identical (this module performs no writes). Distinguish a
  // first-ever failure with no cache from a degradation over a prior cache:
  //
  //   - `cacheAgeHours === null` ⇒ no successful Catalog_Sync has ever run, so
  //     there is nothing to serve. Surface `catalog_unavailable` (503). This is
  //     the *only* branch that errors, and only while no prior cache exists.
  //   - otherwise ⇒ a prior successful cache exists, so serve it stale with its
  //     observed age. On any refresh *failure* (`waf_block`, `auth_failure`,
  //     `network`, `invalid_response`, `aborted`) the classified outcome is
  //     conveyed as `staleReason`; on a deadline timeout the refresh has not
  //     failed yet, so no reason is attached.
  if (cacheAgeHours === null) {
    throw new AppError(
      'catalog_unavailable',
      'The Disney World catalog could not be loaded.',
    );
  }
  if (outcome.kind === 'error') {
    return { staleCache: true, cacheAgeHours, staleReason: outcome.outcome };
  }
  return { staleCache: true, cacheAgeHours };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Outcome of the deadline race, as a discriminated union:
 *   - `{ kind: 'success' }` — the sync resolved inside the deadline window.
 *   - `{ kind: 'error', outcome }` — the sync settled with a rejection inside
 *      the deadline window; `outcome` is the classified `SyncRunOutcome`
 *      (`waf_block`, `auth_failure`, `network`, `invalid_response`, or
 *      `aborted`) derived from the rejection via `outcomeFromError`.
 *   - `{ kind: 'timeout' }` — the deadline fired before the sync settled; the
 *      sync continues in the background and no failure outcome is known yet.
 */
type SyncRaceResult =
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly outcome: SyncRunOutcome }
  | { readonly kind: 'timeout' };

/**
 * Race the injected sync orchestrator against the 5-second deadline.
 *
 * The sync rejection is converted to a settled `{ kind: 'error', outcome }`
 * value via `.catch`, which simultaneously serves as the unhandled-rejection
 * guard for the case where the deadline wins the race and the underlying sync
 * later fails after the request has already moved on. The rejection reason is
 * classified into a `SyncRunOutcome` so the caller can convey *why* the cache
 * is stale (R12.4, R12.5) — a WAF edge block, an auth failure, or another
 * transport kind — while still degrading identically for every failure.
 *
 * The deadline timer is always cleared on the way out so that a
 * fast-resolving sync does not leave a stray timer pending in the event
 * loop.
 */
async function raceSyncAgainstDeadline(
  deps: ReadDecisionDeps,
): Promise<SyncRaceResult> {
  const setTimeoutImpl = deps.setTimeoutFn ?? defaultSetTimeout;
  const clearTimeoutImpl = deps.clearTimeoutFn ?? defaultClearTimeout;

  const syncPromise: Promise<SyncRaceResult> = deps.sync
    .runOrJoinSync()
    .then<SyncRaceResult>(() => ({ kind: 'success' }))
    .catch<SyncRaceResult>((err: unknown) => ({
      kind: 'error',
      outcome: outcomeFromError(err),
    }));

  let timerHandle: ReadDecisionTimerHandle | undefined;
  const timeoutPromise = new Promise<SyncRaceResult>((resolve) => {
    timerHandle = setTimeoutImpl(
      () => resolve({ kind: 'timeout' }),
      SYNC_RACE_DEADLINE_MS,
    );
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
