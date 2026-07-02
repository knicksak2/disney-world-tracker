// Feature: disney-source-resilience, Property 2: Rate-limiter pacing bounds
/**
 * Property-based tests for the Rate_Limiter scheduling core `nextDispatchDelay`
 * (design.md → "2. Rate_Limiter", rateLimiter.ts).
 *
 * Validates: Requirements 2.2, 2.3, 2.5, 6.6, 8.3
 *
 * Property 2 — Rate-limiter pacing bounds:
 *
 *   - **Rate bound (R2.2, R2.5, R6.6, R8.3).** For any burst of requests and any
 *     Request_Budget, a runtime that paces every dispatch by waiting the delay
 *     that `nextDispatchDelay` returns produces a dispatch schedule in which no
 *     rolling 1-second window `[t, t + RATE_WINDOW_MS)` ever contains more than
 *     `maxRequestsPerSecond` dispatches. This is the pacing guarantee that the
 *     `Catalog_Sync` (R6.6) and the lazy/background menu retrieval (R8.3) rely
 *     on when they route every Disney request through the shared limiter.
 *   - **Concurrency bound (R2.3, R2.5).** The number of in-flight (dispatched
 *     but not yet released) requests never exceeds `maxConcurrency`, because the
 *     core signals an indefinite wait (`+Infinity`) whenever the concurrency
 *     budget is saturated, so the runtime never dispatches into a full budget.
 *   - **Non-negative, never-rejecting (R2.5).** Every delay the core returns is
 *     `>= 0` (or `+Infinity` on concurrency saturation); it is always a wait,
 *     never a negative value and never a rejection.
 *
 * The oracle is an independent discrete-event simulation of the runtime that
 * task 3.1 builds on top of this pure core: it advances an injected clock by
 * exactly the delay the core reports and maintains the sliding log of recent
 * dispatch instants the way the runtime's `grant` does (append, prune entries
 * older than one window, cap to the budget), releasing in-flight slots at each
 * request's completion. The invariants are then checked against the resulting
 * schedule — never by re-deriving them from the implementation.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RateLimiterConfig } from '@dwt/shared';

import {
  nextDispatchDelay,
  RATE_WINDOW_MS,
  type RateLimiterState,
} from '../rateLimiter.js';

const NUM_RUNS = 100;

/**
 * The outcome of simulating a burst of requests paced solely by
 * `nextDispatchDelay`.
 */
interface SimResult {
  /** Dispatch instants (epoch-ms), in non-decreasing dispatch order. */
  readonly dispatchTimes: readonly number[];
  /** The peak in-flight count observed across the whole run. */
  readonly maxInFlight: number;
  /** The minimum delay returned by the core across the run (Infinity ignored). */
  readonly minFiniteDelay: number;
}

/**
 * Faithfully simulate the `Rate_Limiter` runtime that task 3.1 layers on top of
 * the pure core. Every request in `durations` wants to dispatch immediately (a
 * burst); each occupies an in-flight slot for its duration once dispatched.
 *
 * The runtime advances the clock only forward: to the next permitted dispatch
 * (now + delay) or to the next in-flight completion, whichever is sooner. On a
 * grant it appends the dispatch instant to the sliding log, drops entries that
 * have aged out of the rolling window (`timestamp <= now - RATE_WINDOW_MS`), and
 * keeps at most `maxRequestsPerSecond` of the newest survivors — exactly what
 * the runtime's `grant` does.
 */
function simulate(
  durations: readonly number[],
  cfg: RateLimiterConfig,
  start: number,
): SimResult {
  let now = start;
  let state: RateLimiterState = {
    recentDispatches: [],
    inFlight: 0,
  };

  const completions: number[] = [];
  const dispatchTimes: number[] = [];
  let maxInFlight = 0;
  let minFiniteDelay = Number.POSITIVE_INFINITY;
  let idx = 0;

  while (idx < durations.length) {
    const delay = nextDispatchDelay(state, cfg, now);

    // R2.5: the core never yields a negative delay.
    expect(delay).toBeGreaterThanOrEqual(0);
    if (Number.isFinite(delay)) {
      minFiniteDelay = Math.min(minFiniteDelay, delay);
    }

    const dispatchCandidate =
      delay === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : now + delay;
    const nextCompletion =
      completions.length > 0 ? Math.min(...completions) : Number.POSITIVE_INFINITY;

    if (completions.length > 0 && nextCompletion <= dispatchCandidate) {
      // Advance to the earliest completion and release every slot tied at it.
      now = nextCompletion;
      let released = 0;
      for (let k = completions.length - 1; k >= 0; k -= 1) {
        if (completions[k] === now) {
          completions.splice(k, 1);
          released += 1;
        }
      }
      state = { ...state, inFlight: state.inFlight - released };
    } else {
      // Dispatch is permitted at `dispatchCandidate` (finite: when the delay is
      // Infinity a completion is always strictly sooner, since inFlight >=
      // maxConcurrency >= 1 guarantees an outstanding completion).
      now = dispatchCandidate;

      // Mirror the runtime's `grant`: append to the sliding log, prune entries
      // that have aged out of the rolling window, cap to the newest budget.
      const cutoff = now - RATE_WINDOW_MS;
      const kept = state.recentDispatches.filter((ts) => ts > cutoff);
      kept.push(now);
      if (kept.length > cfg.maxRequestsPerSecond) {
        kept.splice(0, kept.length - cfg.maxRequestsPerSecond);
      }
      const inFlight = state.inFlight + 1;
      state = { recentDispatches: kept, inFlight };

      maxInFlight = Math.max(maxInFlight, inFlight);
      dispatchTimes.push(now);
      completions.push(now + (durations[idx] ?? 0));
      idx += 1;
    }
  }

  return { dispatchTimes, maxInFlight, minFiniteDelay };
}

/**
 * The maximum number of dispatches falling within any rolling
 * `RATE_WINDOW_MS`-wide window. Because dispatch times are non-decreasing, it
 * suffices to anchor a window at each dispatch and count forward.
 */
function maxRollingWindowCount(dispatchTimes: readonly number[]): number {
  let peak = 0;
  for (let i = 0; i < dispatchTimes.length; i += 1) {
    const anchor = dispatchTimes[i];
    if (anchor === undefined) {
      continue;
    }
    const windowEnd = anchor + RATE_WINDOW_MS;
    let count = 0;
    for (let j = i; j < dispatchTimes.length; j += 1) {
      const t = dispatchTimes[j];
      if (t === undefined || t >= windowEnd) {
        break;
      }
      count += 1;
    }
    peak = Math.max(peak, count);
  }
  return peak;
}

const budgetArb: fc.Arbitrary<RateLimiterConfig> = fc.record({
  maxRequestsPerSecond: fc.integer({ min: 1, max: 8 }),
  maxConcurrency: fc.integer({ min: 1, max: 8 }),
});

// Durations span sub-window, ~window, and multi-window scales so concurrency
// blocking and window rollover both exercise the pacing core.
const durationsArb: fc.Arbitrary<number[]> = fc.array(
  fc.integer({ min: 1, max: 2500 }),
  { minLength: 1, maxLength: 40 },
);

const startArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 5_000 });

describe('nextDispatchDelay pacing bounds (Property 2)', () => {
  it('no rolling 1-second window exceeds maxRequestsPerSecond (R2.2, R2.5, R6.6, R8.3)', () => {
    fc.assert(
      fc.property(durationsArb, budgetArb, startArb, (durations, cfg, start) => {
        const { dispatchTimes } = simulate(durations, cfg, start);

        // Every request in the burst is eventually dispatched (never rejected).
        expect(dispatchTimes.length).toBe(durations.length);
        expect(maxRollingWindowCount(dispatchTimes)).toBeLessThanOrEqual(
          cfg.maxRequestsPerSecond,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('in-flight never exceeds maxConcurrency (R2.3, R2.5)', () => {
    fc.assert(
      fc.property(durationsArb, budgetArb, startArb, (durations, cfg, start) => {
        const { maxInFlight } = simulate(durations, cfg, start);
        expect(maxInFlight).toBeLessThanOrEqual(cfg.maxConcurrency);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('dispatch instants are non-decreasing and stay within the rolling bound (R2.2)', () => {
    fc.assert(
      fc.property(durationsArb, budgetArb, startArb, (durations, cfg, start) => {
        const { dispatchTimes } = simulate(durations, cfg, start);

        // The clock only moves forward, so dispatch instants never regress.
        for (let i = 1; i < dispatchTimes.length; i += 1) {
          const prev = dispatchTimes[i - 1];
          const cur = dispatchTimes[i];
          if (prev !== undefined && cur !== undefined) {
            expect(cur).toBeGreaterThanOrEqual(prev);
          }
        }
        // And, re-affirmed from the raw schedule, the sliding-window bound holds.
        expect(maxRollingWindowCount(dispatchTimes)).toBeLessThanOrEqual(
          cfg.maxRequestsPerSecond,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the core is total and never yields a negative delay (R2.5)', () => {
    fc.assert(
      fc.property(
        // Model a plausible runtime snapshot: a clock `now`, a sliding log of
        // past dispatch instants (all at or before `now`), and an in-flight
        // count. Past instants are `now - offset` for non-negative offsets.
        fc.record({
          now: fc.integer({ min: 0, max: 20_000 }),
          pastOffsets: fc.array(fc.integer({ min: 0, max: 2_000 }), {
            maxLength: 20,
          }),
          inFlight: fc.integer({ min: 0, max: 20 }),
        }),
        budgetArb,
        ({ now, pastOffsets, inFlight }, cfg) => {
          const recentDispatches = pastOffsets.map((offset) => now - offset);
          const state: RateLimiterState = { recentDispatches, inFlight };
          const delay = nextDispatchDelay(state, cfg, now);
          expect(delay).toBeGreaterThanOrEqual(0);
          // A finite delay is bounded by the window width; an infinite delay
          // only ever signals concurrency saturation.
          if (Number.isFinite(delay)) {
            expect(delay).toBeLessThanOrEqual(RATE_WINDOW_MS);
          } else {
            expect(state.inFlight).toBeGreaterThanOrEqual(cfg.maxConcurrency);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('nextDispatchDelay concrete scenarios (unit)', () => {
  const cfg: RateLimiterConfig = { maxRequestsPerSecond: 2, maxConcurrency: 1 };

  it('permits an immediate dispatch when both budgets have headroom', () => {
    expect(
      nextDispatchDelay({ recentDispatches: [], inFlight: 0 }, cfg, 0),
    ).toBe(0);
  });

  it('blocks on concurrency with an indefinite wait', () => {
    expect(
      nextDispatchDelay({ recentDispatches: [], inFlight: 1 }, cfg, 10),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('waits until the oldest in-window dispatch ages out when the rate budget is full', () => {
    // Two dispatches at t=0 and t=300 fill the budget; the next is deferred
    // until the oldest (t=0) leaves the rolling window at t=1000.
    expect(
      nextDispatchDelay({ recentDispatches: [0, 300], inFlight: 0 }, cfg, 400),
    ).toBe(RATE_WINDOW_MS - 400);
  });

  it('permits immediately once the constraining dispatches have aged out', () => {
    // At now=RATE_WINDOW_MS both t=0 entries are stale (not > now - window).
    expect(
      nextDispatchDelay({ recentDispatches: [0, 0], inFlight: 0 }, cfg, RATE_WINDOW_MS),
    ).toBe(0);
  });

  it('gates on concurrency ahead of a full rate window', () => {
    expect(
      nextDispatchDelay({ recentDispatches: [0, 300], inFlight: 1 }, cfg, 400),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('paces a boundary-straddling burst so no rolling second exceeds the budget (regression)', () => {
    // Regression for the fixed-window defect: dispatches at 0, 2, 1000 were all
    // admitted, then a 4th at 1001 packed three into the rolling window
    // [2, 1002). With the sliding window, after dispatches at t=2 and t=1000 a
    // request at t=1001 must wait until t=2 ages out at t=1002 (1ms).
    expect(
      nextDispatchDelay({ recentDispatches: [2, 1000], inFlight: 0 }, cfg, 1001),
    ).toBe(1);
  });
});
