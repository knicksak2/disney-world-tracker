// Feature: disney-world-tracker, Property 4: catalog read result follows cacheAge x syncOutcome x latency rule
/**
 * Property-based tests for `decideCatalogRead`.
 *
 * Validates: Requirements 1.11, 1.12, 1.13
 *
 * Property 4 (design.md → Correctness Properties → "Catalog read decision
 * over cache age and sync outcome"):
 *
 *   For any cacheAgeHours, simulated syncLatencyMs, and simulated
 *   syncOutcome ∈ {success, error, timeout}, the result of a catalog read
 *   matches:
 *     - cacheAgeHours <= 24                       ⇒ serve cache, no sync.
 *     - cacheAgeHours > 24, sync succeeds in <5s  ⇒ staleCache=false.
 *     - cacheAgeHours > 24, sync errors in <5s    ⇒ staleCache=true.
 *     - cacheAgeHours > 24, deadline fires first  ⇒ staleCache=true.
 *     - cacheAgeHours = null, sync does not       ⇒ throw AppError(
 *       resolve successfully in <5s                catalog_unavailable).
 *
 * Test strategy: both the sync subsystem and the deadline timer are
 * injected through `ReadDecisionDeps`, so the test can drive the race
 * deterministically without touching real timers. A fake `setTimeoutFn`
 * captures the deadline callback and returns an opaque handle; a deferred
 * Promise stands in for `runOrJoinSync`. Per the chosen `syncLatencyMs`,
 * the harness either resolves/rejects the deferred (sync wins) or
 * invokes the captured callback (timer wins). The 5-second deadline is
 * the boundary: latency < 5000 ⇒ sync wins, latency ≥ 5000 ⇒ timer wins.
 *
 * Mocking both the sync subsystem and the clock keeps the property check
 * independent of the OS event-loop scheduling and fast: 100 runs per
 * property complete in well under a second.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AppError } from '../../../errors/AppError.js';
import {
  decideCatalogRead,
  STALE_CACHE_AGE_HOURS,
  SYNC_RACE_DEADLINE_MS,
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
}

interface RunResult {
  readonly result?: { readonly staleCache: boolean } | undefined;
  readonly error?: unknown;
  readonly syncCallCount: number;
  readonly timerSet: boolean;
  readonly timerMs?: number | undefined;
  readonly clearTimeoutCount: number;
}

/**
 * Drive `decideCatalogRead` through one (cacheAge, latency, outcome)
 * triple. The repo, sync, and timer are all stubbed so the function's
 * decision is observable without ever touching the real event loop or DB.
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

  const repo: ReadDecisionRepo = {
    getCacheAgeHours: async () => args.cacheAgeHours,
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
      timerSet,
      timerMs,
      clearTimeoutCount,
    }));
  }

  // --- stale or null cache: drive the race ------------------------------
  // 5000 ms is the demarcation: strictly less ⇒ sync wins, ≥ ⇒ timer wins.
  const syncWinsRace = args.syncLatencyMs < SYNC_RACE_DEADLINE_MS;

  if (syncWinsRace) {
    if (args.syncOutcome === 'success') {
      resolveSync();
    } else {
      rejectSync(new Error('simulated upstream error'));
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
      rejectSync(new Error('simulated upstream error'));
    }
    await flushAsync();
  }

  return collected;
}

async function collectOutcome(
  decisionPromise: Promise<{ readonly staleCache: boolean }>,
  snapshot: () => Omit<RunResult, 'result' | 'error'>,
): Promise<RunResult> {
  let result: { readonly staleCache: boolean } | undefined;
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

describe('decideCatalogRead — Property 4: cacheAge × syncOutcome × latency rule', () => {
  it('serves fresh cache without a sync when cacheAgeHours <= 24 (R1.12)', async () => {
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
          expect(r.result).toEqual({ staleCache: false });
          // R1.12: no opportunistic sync is initiated.
          expect(r.syncCallCount).toBe(0);
          expect(r.timerSet).toBe(false);
          expect(r.clearTimeoutCount).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('races a 5-second sync when cacheAgeHours > 24 (R1.11)', async () => {
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
          // The race must always be set up: sync is invoked exactly once
          // and a deadline is registered against the 5-second limit.
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

  it('returns staleCache=false when sync succeeds within the deadline (R1.11)', async () => {
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
          expect(r.result).toEqual({ staleCache: false });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns staleCache=true when sync rejects within the deadline (R1.13)', async () => {
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
          expect(r.result).toEqual({ staleCache: true });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns staleCache=true when the deadline fires before the sync settles (R1.11/R1.13)', async () => {
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
          expect(r.result).toEqual({ staleCache: true });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns staleCache=false when no prior cache exists but the sync succeeds within the deadline (R1.11)', async () => {
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
          expect(r.result).toEqual({ staleCache: false });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws catalog_unavailable when no prior cache exists and the sync does not succeed (R1.13)', async () => {
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

          // Branch 1: fresh cache (R1.12).
          if (age !== null && age <= STALE_CACHE_AGE_HOURS) {
            expect(r.error).toBeUndefined();
            expect(r.result).toEqual({ staleCache: false });
            expect(r.syncCallCount).toBe(0);
            expect(r.timerSet).toBe(false);
            return;
          }

          // Branch 2 onwards: stale or missing cache.
          // The race is always entered.
          expect(r.syncCallCount).toBe(1);
          expect(r.timerSet).toBe(true);

          const syncWonAndSucceeded =
            lat < SYNC_RACE_DEADLINE_MS && out === 'success';
          if (syncWonAndSucceeded) {
            // Branch 2: success within deadline ⇒ fresh-flagged response.
            expect(r.error).toBeUndefined();
            expect(r.result).toEqual({ staleCache: false });
            return;
          }

          // Remaining branches: sync errored within deadline OR timer
          // fired first.
          if (age === null) {
            // Branch 3: no prior cache + failure ⇒ catalog_unavailable.
            expect(r.result).toBeUndefined();
            expect(r.error).toBeInstanceOf(AppError);
            expect((r.error as AppError).code).toBe('catalog_unavailable');
          } else {
            // Branch 4: prior cache + failure ⇒ stale flag, cache served
            // unchanged (R1.13).
            expect(r.error).toBeUndefined();
            expect(r.result).toEqual({ staleCache: true });
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
    expect(r.result).toEqual({ staleCache: false });
    expect(r.syncCallCount).toBe(0);
    expect(r.timerSet).toBe(false);
  });

  it('treats cacheAgeHours just over 24 as stale and races a sync', async () => {
    const r = await runDecide({
      cacheAgeHours: STALE_CACHE_AGE_HOURS + 0.0001,
      syncLatencyMs: 100,
      syncOutcome: 'success',
    });
    expect(r.result).toEqual({ staleCache: false });
    expect(r.syncCallCount).toBe(1);
    expect(r.timerSet).toBe(true);
    expect(r.timerMs).toBe(SYNC_RACE_DEADLINE_MS);
  });

  it('throws catalog_unavailable when there is no cache and the sync rejects', async () => {
    const r = await runDecide({
      cacheAgeHours: null,
      syncLatencyMs: 50,
      syncOutcome: 'error',
    });
    expect(r.result).toBeUndefined();
    expect(r.error).toBeInstanceOf(AppError);
    expect((r.error as AppError).code).toBe('catalog_unavailable');
  });

  it('throws catalog_unavailable when there is no cache and the sync times out', async () => {
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
