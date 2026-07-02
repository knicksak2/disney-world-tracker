// Feature: disney-facilities-catalog-source, Property 20: Catalog reads serve from cache, refresh past 24h, and preserve the cache on failure
/**
 * Property-based tests for `decideCatalogRead`.
 *
 * Validates: Requirements 12.1, 12.2, 12.4, 12.7, 12.9
 *
 * Property 20 (design.md → Correctness Properties → "Catalog reads serve
 * from cache, refresh past 24h, and preserve the cache on failure"):
 *
 *   For any cache age and upstream outcome:
 *     - cache age <= 24h                          ⇒ serve from cache without
 *       (R12.6/R12.9)                               refreshing, reporting the
 *                                                   observed age.
 *     - cache age > 24h (R12.9)                   ⇒ trigger an opportunistic
 *                                                   refresh raced against the
 *                                                   5-second read deadline.
 *     - refresh succeeds within the deadline      ⇒ staleCache=false; the
 *                                                   freshly written cache has
 *                                                   no meaningful prior age
 *                                                   (cacheAgeHours=null).
 *     - failed/timed-out refresh WITH prior cache ⇒ staleCache=true, the
 *       (R12.1/R12.4/R12.7)                         observed age is reported,
 *                                                   and the cache is left
 *                                                   unchanged.
 *     - failed/timed-out refresh with NO prior    ⇒ throw AppError(
 *       cache (R12.2)                               catalog_unavailable) → 503.
 *
 * `decideCatalogRead` returns a `ReadDecision` of shape
 * `{ staleCache: boolean; cacheAgeHours: number | null }`. Per R12.1 the
 * cache's age is conveyed alongside the staleness indicator, so these
 * assertions check the *full* object rather than `staleCache` alone.
 *
 * Test strategy: both the sync subsystem and the deadline timer are
 * injected through `ReadDecisionDeps`, so the test drives the race
 * deterministically without touching real timers. A fake `setTimeoutFn`
 * captures the deadline callback and returns an opaque handle; a deferred
 * Promise stands in for `runOrJoinSync`. Per the chosen `syncLatencyMs`,
 * the harness either resolves/rejects the deferred (sync wins) or invokes
 * the captured callback (timer wins). The 5-second deadline is the
 * boundary: latency < 5000 ⇒ sync wins, latency >= 5000 ⇒ timer wins.
 *
 * Mocking both the sync subsystem and the clock keeps the property check
 * independent of OS event-loop scheduling and fast: 100 runs per property
 * complete in well under a second.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { DISNEY_FAILURE_KINDS, type DisneyFailureKind } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import {
  decideCatalogRead,
  STALE_CACHE_AGE_HOURS,
  SYNC_RACE_DEADLINE_MS,
  type ReadDecision,
  type ReadDecisionDeps,
  type ReadDecisionRepo,
  type ReadDecisionSync,
  type ReadDecisionTimerHandle,
} from '../readDecision.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface RunArgs {
  readonly cacheAgeHours: number | null;
  readonly syncLatencyMs: number;
  readonly syncOutcome: 'success' | 'error';
  /**
   * When `syncOutcome === 'error'`, shape the rejection as a
   * `DisneyTransportError`-like value carrying this transport `kind` so
   * `outcomeFromError` classifies it (e.g. `waf_block`, `auth_failure`).
   *
   * When omitted, the sync rejects with a plain `Error`, which classifies to
   * `invalid_response` — the behavior the existing Property 20 tests rely on.
   */
  readonly syncErrorKind?: DisneyFailureKind;
}

/**
 * Build the rejection reason for a simulated failed refresh. A `syncErrorKind`
 * produces a transport-shaped error (`{ kind }`), matching what the real
 * `Disney_Transport` raises; `outcomeFromError` recognizes it structurally and
 * maps it to the corresponding `SyncRunOutcome`. Without a kind, a plain
 * `Error` is used (classifies to `invalid_response`).
 */
function makeSyncRejection(kind: DisneyFailureKind | undefined): unknown {
  if (kind === undefined) {
    return new Error('simulated upstream error');
  }
  return { kind, message: `simulated ${kind}` };
}

/**
 * `outcomeFromError`'s mapping from transport `kind` to `SyncRunOutcome`,
 * mirrored here so the property can assert the conveyed `staleReason`.
 * `http_status` is folded into `invalid_response` (retired from the outcome
 * set); every other kind maps to itself.
 */
const EXPECTED_OUTCOME_BY_KIND: Readonly<Record<DisneyFailureKind, string>> = {
  http_status: 'invalid_response',
  waf_block: 'waf_block',
  auth_failure: 'auth_failure',
  network: 'network',
  invalid_response: 'invalid_response',
  aborted: 'aborted',
};

interface RunResult {
  readonly result?: ReadDecision | undefined;
  readonly error?: unknown;
  readonly syncCallCount: number;
  readonly getCacheAgeCallCount: number;
  readonly timerSet: boolean;
  readonly timerMs?: number | undefined;
  readonly clearTimeoutCount: number;
}

/**
 * Drive `decideCatalogRead` through one (cacheAge, latency, outcome)
 * triple. The repo, sync, and timer are all stubbed so the function's
 * decision is observable without ever touching the real event loop or DB.
 *
 * The repo exposes only `getCacheAgeHours` and no write path, which
 * mechanically enforces R12.4: the read decision cannot mutate the cache,
 * so a failed/timed-out refresh necessarily leaves it unchanged. The test
 * additionally asserts that the reported `cacheAgeHours` equals the
 * observed pre-refresh age on the stale-serve branch.
 */
async function runDecide(args: RunArgs): Promise<RunResult> {
  // --- sync stub ---------------------------------------------------------
  let syncCallCount = 0;
  let resolveSync!: () => void;
  let rejectSync!: (reason: unknown) => void;
  const syncPromise = new Promise<void>((resolve, reject) => {
    resolveSync = resolve;
    rejectSync = reject;
  });

  let getCacheAgeCallCount = 0;
  const repo: ReadDecisionRepo = {
    getCacheAgeHours: async () => {
      getCacheAgeCallCount++;
      return args.cacheAgeHours;
    },
  };
  const sync: ReadDecisionSync = {
    runOrJoinSync: () => {
      syncCallCount++;
      return syncPromise;
    },
  };

  // --- timer stub --------------------------------------------------------
  let timerCallback: (() => void) | undefined;
  let timerMs: number | undefined;
  let timerSet = false;
  let clearTimeoutCount = 0;
  const HANDLE: ReadDecisionTimerHandle = { id: 'fake-timer' };

  const deps: ReadDecisionDeps = {
    repo,
    sync,
    setTimeoutFn: (cb, ms) => {
      timerCallback = cb;
      timerMs = ms;
      timerSet = true;
      return HANDLE;
    },
    clearTimeoutFn: (h) => {
      clearTimeoutCount++;
      // Sanity: a handle other than the one we returned would mean the
      // implementation lost track of the deadline timer — surface that
      // immediately rather than letting a downstream assertion mask it.
      if (h !== HANDLE) {
        throw new Error('clearTimeoutFn received an unexpected handle');
      }
    },
  };

  // Kick off the function under test, but do not await yet — we drive the
  // race manually below.
  const decisionPromise = decideCatalogRead(deps);

  // Yield long enough for `getCacheAgeHours()` to resolve and for the
  // `raceSyncAgainstDeadline` setup (setTimeoutFn + runOrJoinSync +
  // chained .then/.catch) to run.
  await flushAsync();

  // --- fresh-cache branch ------------------------------------------------
  // The function has already returned; nothing to drive.
  if (
    args.cacheAgeHours !== null &&
    args.cacheAgeHours <= STALE_CACHE_AGE_HOURS
  ) {
    return await collectOutcome(decisionPromise, () => ({
      syncCallCount,
      getCacheAgeCallCount,
      timerSet,
      timerMs,
      clearTimeoutCount,
    }));
  }

  // --- stale or null cache: drive the race ------------------------------
  // 5000 ms is the demarcation: strictly less ⇒ sync wins, >= ⇒ timer wins.
  const syncWinsRace = args.syncLatencyMs < SYNC_RACE_DEADLINE_MS;

  if (syncWinsRace) {
    if (args.syncOutcome === 'success') {
      resolveSync();
    } else {
      rejectSync(makeSyncRejection(args.syncErrorKind));
    }
  } else {
    if (timerCallback === undefined) {
      throw new Error(
        'expected setTimeoutFn to have been called in the stale-cache branch',
      );
    }
    timerCallback();
  }

  const collected = await collectOutcome(decisionPromise, () => ({
    syncCallCount,
    getCacheAgeCallCount,
    timerSet,
    timerMs,
    clearTimeoutCount,
  }));

  // If the timer won the race, settle the underlying sync as well so the
  // test does not leave a dangling promise. The implementation's `.catch`
  // handler is already attached to the sync chain, so a late rejection is
  // harmless.
  if (!syncWinsRace) {
    if (args.syncOutcome === 'success') {
      resolveSync();
    } else {
      rejectSync(makeSyncRejection(args.syncErrorKind));
    }
    await flushAsync();
  }

  return collected;
}

async function collectOutcome(
  decisionPromise: Promise<ReadDecision>,
  snapshot: () => Omit<RunResult, 'result' | 'error'>,
): Promise<RunResult> {
  let result: ReadDecision | undefined;
  let error: unknown;
  try {
    result = await decisionPromise;
  } catch (e) {
    error = e;
  }
  const snap = snapshot();
  return {
    result,
    error,
    syncCallCount: snap.syncCallCount,
    getCacheAgeCallCount: snap.getCacheAgeCallCount,
    timerSet: snap.timerSet,
    timerMs: snap.timerMs,
    clearTimeoutCount: snap.clearTimeoutCount,
  };
}

/**
 * Flush pending microtasks plus a macrotask round so the async function
 * under test has fully advanced past every internal `await`. Two
 * `setImmediate` rounds covers `await getCacheAgeHours()` plus the
 * `Promise.race` setup chain.
 */
async function flushAsync(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** [0, 24] inclusive — the fresh-cache band. */
const freshAgeArb = fc.double({
  min: 0,
  max: STALE_CACHE_AGE_HOURS,
  noNaN: true,
  noDefaultInfinity: true,
});

/** (24, 200] — the stale band. The +1e-3 offset stays safely above the
 *  threshold even after FP rounding while still exercising values near
 *  the boundary. */
const staleAgeArb = fc.double({
  min: STALE_CACHE_AGE_HOURS + 0.001,
  max: 200,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Cache age: fresh, stale, or absent (no successful prior sync). */
const cacheAgeArb = fc.oneof(
  freshAgeArb,
  staleAgeArb,
  fc.constant<number | null>(null),
);

/** Latency in [0, 7000] ms — straddles the 5000 ms deadline both ways. */
const latencyArb = fc.integer({ min: 0, max: 7000 });

const outcomeArb = fc.constantFrom<'success' | 'error'>('success', 'error');

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('decideCatalogRead — Property 20: cache serve / 24h refresh / preserve-on-failure', () => {
  it('serves fresh cache without a refresh, reporting the observed age, when cacheAgeHours <= 24 (R12.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        freshAgeArb,
        latencyArb,
        outcomeArb,
        async (age, lat, out) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: out,
          });
          expect(r.error).toBeUndefined();
          // Full shape: served from cache, staleness age conveyed (R12.1).
          expect(r.result).toEqual({ staleCache: false, cacheAgeHours: age });
          // R12.6: no opportunistic refresh is initiated.
          expect(r.syncCallCount).toBe(0);
          expect(r.timerSet).toBe(false);
          expect(r.clearTimeoutCount).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('triggers a refresh raced against the 5-second deadline when cacheAgeHours > 24 (R12.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        staleAgeArb,
        latencyArb,
        outcomeArb,
        async (age, lat, out) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: out,
          });
          // The refresh must always be triggered: sync is invoked exactly
          // once and a deadline is registered against the 5-second limit.
          expect(r.syncCallCount).toBe(1);
          expect(r.timerSet).toBe(true);
          expect(r.timerMs).toBe(SYNC_RACE_DEADLINE_MS);
          // The deadline timer is always cleared on the way out, whether
          // the sync or the timer won the race.
          expect(r.clearTimeoutCount).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns staleCache=false with a freshly-written cache (age=null) when the refresh succeeds within the deadline (R12.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        staleAgeArb,
        fc.integer({ min: 0, max: SYNC_RACE_DEADLINE_MS - 1 }),
        async (age, lat) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: 'success',
          });
          expect(r.error).toBeUndefined();
          // The refresh rewrote the cache; the pre-refresh age no longer
          // describes the served rows, so no staleness age is reported.
          expect(r.result).toEqual({ staleCache: false, cacheAgeHours: null });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('serves the prior cache with staleCache=true and the observed age, leaving it unchanged, when the refresh fails within the deadline (R12.1/R12.4/R12.7)', async () => {
    await fc.assert(
      fc.asyncProperty(
        staleAgeArb,
        fc.integer({ min: 0, max: SYNC_RACE_DEADLINE_MS - 1 }),
        async (age, lat) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: 'error',
          });
          expect(r.error).toBeUndefined();
          // R12.1: staleness indicator + the cache's (unchanged) age. A plain
          // rejection classifies to the `invalid_response` outcome, surfaced as
          // `staleReason` so the caller can tell *why* the cache is stale.
          expect(r.result).toEqual({
            staleCache: true,
            cacheAgeHours: age,
            staleReason: 'invalid_response',
          });
          // R12.4: the cache is read exactly once and never written — the
          // decision path has no write capability, so the prior cache is
          // preserved by construction.
          expect(r.getCacheAgeCallCount).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('serves the prior cache with staleCache=true and the observed age when the deadline fires before the refresh settles (R12.1/R12.7/R12.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        staleAgeArb,
        fc.integer({ min: SYNC_RACE_DEADLINE_MS, max: 7000 }),
        outcomeArb,
        async (age, lat, out) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: out,
          });
          expect(r.error).toBeUndefined();
          expect(r.result).toEqual({ staleCache: true, cacheAgeHours: age });
          expect(r.getCacheAgeCallCount).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns staleCache=false (age=null) when no prior cache exists but the refresh succeeds within the deadline (R12.9)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: SYNC_RACE_DEADLINE_MS - 1 }),
        async (lat) => {
          const r = await runDecide({
            cacheAgeHours: null,
            syncLatencyMs: lat,
            syncOutcome: 'success',
          });
          expect(r.error).toBeUndefined();
          expect(r.result).toEqual({ staleCache: false, cacheAgeHours: null });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws catalog_unavailable when no prior cache exists and the refresh does not succeed (R12.2)', async () => {
    await fc.assert(
      fc.asyncProperty(latencyArb, outcomeArb, async (lat, out) => {
        const isFailure = lat >= SYNC_RACE_DEADLINE_MS || out === 'error';
        // The success-within-deadline + null-cache case is exercised by a
        // dedicated property above; restrict this property to the failure
        // subspace.
        fc.pre(isFailure);

        const r = await runDecide({
          cacheAgeHours: null,
          syncLatencyMs: lat,
          syncOutcome: out,
        });
        expect(r.result).toBeUndefined();
        expect(r.error).toBeInstanceOf(AppError);
        expect((r.error as AppError).code).toBe('catalog_unavailable');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Combined-rule cross-check
// ---------------------------------------------------------------------------

describe('decideCatalogRead — full rule cross-check', () => {
  it('matches the (cacheAge, syncOutcome, latency) decision table for every triple', async () => {
    await fc.assert(
      fc.asyncProperty(
        cacheAgeArb,
        latencyArb,
        outcomeArb,
        async (age, lat, out) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: out,
          });

          // Branch 1: fresh cache (R12.6).
          if (age !== null && age <= STALE_CACHE_AGE_HOURS) {
            expect(r.error).toBeUndefined();
            expect(r.result).toEqual({
              staleCache: false,
              cacheAgeHours: age,
            });
            expect(r.syncCallCount).toBe(0);
            expect(r.timerSet).toBe(false);
            return;
          }

          // Branch 2 onwards: stale or missing cache.
          // The refresh is always triggered.
          expect(r.syncCallCount).toBe(1);
          expect(r.timerSet).toBe(true);

          const syncWonAndSucceeded =
            lat < SYNC_RACE_DEADLINE_MS && out === 'success';
          if (syncWonAndSucceeded) {
            // Branch 2: success within deadline ⇒ freshly-written cache.
            expect(r.error).toBeUndefined();
            expect(r.result).toEqual({
              staleCache: false,
              cacheAgeHours: null,
            });
            return;
          }

          // Remaining branches: refresh errored within deadline OR timer
          // fired first.
          if (age === null) {
            // Branch 3: no prior cache + failure ⇒ catalog_unavailable (R12.2).
            expect(r.result).toBeUndefined();
            expect(r.error).toBeInstanceOf(AppError);
            expect((r.error as AppError).code).toBe('catalog_unavailable');
          } else {
            // Branch 4: prior cache + failure ⇒ stale flag, observed age,
            // cache served unchanged (R12.1/R12.4/R12.7). A refresh that
            // *errored* within the deadline conveys the classified outcome as
            // `staleReason` (a plain rejection ⇒ `invalid_response`); a
            // deadline timeout is not (yet) a failure, so no reason is
            // attached.
            expect(r.error).toBeUndefined();
            const erroredWithinDeadline =
              lat < SYNC_RACE_DEADLINE_MS && out === 'error';
            if (erroredWithinDeadline) {
              expect(r.result).toEqual({
                staleCache: true,
                cacheAgeHours: age,
                staleReason: 'invalid_response',
              });
            } else {
              expect(r.result).toEqual({
                staleCache: true,
                cacheAgeHours: age,
              });
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples — boundary and intent checks
// ---------------------------------------------------------------------------

describe('decideCatalogRead — fixed examples for regression', () => {
  it('treats cacheAgeHours === 24 as fresh (boundary is strictly greater than 24)', async () => {
    const r = await runDecide({
      cacheAgeHours: STALE_CACHE_AGE_HOURS,
      syncLatencyMs: 0,
      syncOutcome: 'success',
    });
    expect(r.result).toEqual({
      staleCache: false,
      cacheAgeHours: STALE_CACHE_AGE_HOURS,
    });
    expect(r.syncCallCount).toBe(0);
    expect(r.timerSet).toBe(false);
  });

  it('treats cacheAgeHours just over 24 as stale and refreshes', async () => {
    const r = await runDecide({
      cacheAgeHours: STALE_CACHE_AGE_HOURS + 0.0001,
      syncLatencyMs: 100,
      syncOutcome: 'success',
    });
    expect(r.result).toEqual({ staleCache: false, cacheAgeHours: null });
    expect(r.syncCallCount).toBe(1);
    expect(r.timerSet).toBe(true);
    expect(r.timerMs).toBe(SYNC_RACE_DEADLINE_MS);
  });

  it('serves the stale cache with its age when a refresh fails and a prior cache exists (R12.1)', async () => {
    const r = await runDecide({
      cacheAgeHours: 48,
      syncLatencyMs: 100,
      syncOutcome: 'error',
    });
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual({
      staleCache: true,
      cacheAgeHours: 48,
      staleReason: 'invalid_response',
    });
  });

  it('throws catalog_unavailable when there is no cache and the refresh rejects (R12.2)', async () => {
    const r = await runDecide({
      cacheAgeHours: null,
      syncLatencyMs: 50,
      syncOutcome: 'error',
    });
    expect(r.result).toBeUndefined();
    expect(r.error).toBeInstanceOf(AppError);
    expect((r.error as AppError).code).toBe('catalog_unavailable');
  });

  it('throws catalog_unavailable when there is no cache and the refresh times out (R12.2)', async () => {
    const r = await runDecide({
      cacheAgeHours: null,
      syncLatencyMs: 6000,
      syncOutcome: 'success',
    });
    expect(r.result).toBeUndefined();
    expect(r.error).toBeInstanceOf(AppError);
    expect((r.error as AppError).code).toBe('catalog_unavailable');
  });
});

// ---------------------------------------------------------------------------
// Feature: disney-source-resilience, Property 14: Catalog degradation
// preserves cache and conveys staleness
// ---------------------------------------------------------------------------
/**
 * Property 14 (design.md → Correctness Properties → "Catalog degradation
 * preserves cache and conveys staleness"):
 *
 *   For ANY Catalog_Sync failure outcome — including a WAF edge block
 *   (`waf_block`) or a credential rejection (`auth_failure`) — WITH a prior
 *   Catalog_Cache:
 *     - `decideCatalogRead` resolves WITHOUT throwing (R12.2 resilience: a
 *       block/auth failure must not surface an error while a cache exists),
 *     - reports `staleCache: true`,
 *     - conveys the cache's (unchanged) age via `cacheAgeHours` — equal to the
 *       age the repo reported, modeling a byte-identical cache (R12.1),
 *     - conveys a staleness indicator via `staleReason` — the classified
 *       `SyncRunOutcome` for the failure (R12.1/R12.2 resilience).
 *
 *   The cache is preserved *by construction*: the read-decision path has no
 *   write capability. The injected `ReadDecisionRepo` projection exposes only
 *   `getCacheAgeHours` — there is no write/mutation method to call — so a
 *   failed refresh cannot alter the cache. The property additionally asserts
 *   the repo is read exactly once (`getCacheAgeCallCount === 1`) and never
 *   otherwise touched, and that the reported age equals the observed age.
 *
 *   Finally, a first-ever failure with NO prior cache (`cacheAgeHours === null`)
 *   still surfaces `catalog_unavailable` (503) — even for `waf_block` /
 *   `auth_failure` — because there is nothing to serve (R12.2).
 *
 * Validates: Requirements 12.1, 12.2
 *
 * `numRuns: 100` per the spec convention.
 */

/** All transport failure kinds; waf_block / auth_failure are the block/auth
 *  outcomes this property specifically exercises. */
const failureKindArb = fc.constantFrom<DisneyFailureKind>(
  ...DISNEY_FAILURE_KINDS,
);

/** Latency strictly inside the 5s deadline, so the refresh *fails* (rather
 *  than merely timing out) and the failure outcome is observable as a
 *  `staleReason`. */
const withinDeadlineLatencyArb = fc.integer({
  min: 0,
  max: SYNC_RACE_DEADLINE_MS - 1,
});

describe('decideCatalogRead — Property 14: degradation preserves cache and conveys staleness', () => {
  it('serves the byte-identical prior cache with its age + a staleness reason for ANY sync failure kind, without throwing (R12.1/R12.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        staleAgeArb,
        withinDeadlineLatencyArb,
        failureKindArb,
        async (age, lat, kind) => {
          const r = await runDecide({
            cacheAgeHours: age,
            syncLatencyMs: lat,
            syncOutcome: 'error',
            syncErrorKind: kind,
          });

          // R12.2 (resilience): a failure over a prior cache never errors —
          // even a WAF block or auth failure degrades gracefully.
          expect(r.error).toBeUndefined();

          // R12.1: staleness indicator + the cache's (unchanged) age +
          // the classified reason so the caller knows *why* it is stale.
          expect(r.result).toEqual({
            staleCache: true,
            cacheAgeHours: age,
            staleReason: EXPECTED_OUTCOME_BY_KIND[kind],
          });

          // The conveyed age is byte-identical to the value the repo
          // reported (the cache was not rewritten).
          expect(r.result?.cacheAgeHours).toBe(age);

          // Cache preserved by construction: the repo is read exactly once
          // and never written — the projection has no write method — so the
          // refresh failure cannot mutate the cache.
          expect(r.getCacheAgeCallCount).toBe(1);
          expect(r.syncCallCount).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('conveys distinct staleReasons for waf_block vs auth_failure over a prior cache (block visibility, R12.1)', async () => {
    const waf = await runDecide({
      cacheAgeHours: 72,
      syncLatencyMs: 100,
      syncOutcome: 'error',
      syncErrorKind: 'waf_block',
    });
    expect(waf.error).toBeUndefined();
    expect(waf.result).toEqual({
      staleCache: true,
      cacheAgeHours: 72,
      staleReason: 'waf_block',
    });

    const auth = await runDecide({
      cacheAgeHours: 72,
      syncLatencyMs: 100,
      syncOutcome: 'error',
      syncErrorKind: 'auth_failure',
    });
    expect(auth.error).toBeUndefined();
    expect(auth.result).toEqual({
      staleCache: true,
      cacheAgeHours: 72,
      staleReason: 'auth_failure',
    });

    // The two block/auth outcomes are conveyed as distinct staleReasons.
    expect(waf.result?.staleReason).not.toBe(auth.result?.staleReason);
  });

  it('still surfaces catalog_unavailable (503) for a first-ever failure with NO prior cache, even for a block/auth failure (R12.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        withinDeadlineLatencyArb,
        failureKindArb,
        async (lat, kind) => {
          const r = await runDecide({
            cacheAgeHours: null,
            syncLatencyMs: lat,
            syncOutcome: 'error',
            syncErrorKind: kind,
          });
          // No cache to serve ⇒ the block/auth failure surfaces as 503.
          expect(r.result).toBeUndefined();
          expect(r.error).toBeInstanceOf(AppError);
          expect((r.error as AppError).code).toBe('catalog_unavailable');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('fixed example: a WAF block with no prior cache is a 503, but with a prior cache degrades to stale', async () => {
    const noCache = await runDecide({
      cacheAgeHours: null,
      syncLatencyMs: 50,
      syncOutcome: 'error',
      syncErrorKind: 'waf_block',
    });
    expect(noCache.error).toBeInstanceOf(AppError);
    expect((noCache.error as AppError).code).toBe('catalog_unavailable');

    const withCache = await runDecide({
      cacheAgeHours: 30,
      syncLatencyMs: 50,
      syncOutcome: 'error',
      syncErrorKind: 'waf_block',
    });
    expect(withCache.error).toBeUndefined();
    expect(withCache.result).toEqual({
      staleCache: true,
      cacheAgeHours: 30,
      staleReason: 'waf_block',
    });
  });
});
