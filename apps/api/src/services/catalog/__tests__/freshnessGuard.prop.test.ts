/**
 * Property-based test for the scheduled-run freshness guard (design.md →
 * "Property 11: Sync freshness guard").
 *
 * A `'scheduled'` `Catalog_Sync` invocation fires on a fixed BullMQ cadence.
 * Because Disney facility data changes rarely, a scheduled tick that lands
 * while the most recent successful sync is still within the freshness interval
 * must be a no-op (R9.2), so low-change-rate static data imposes minimal load
 * on the fragile source. The pure `isWithinFreshness(lastSuccessfulSyncAt,
 * now, intervalMs)` seam is the exact comparison behind that guard: `runSync`
 * skips the run (`{ status: 'skipped', reason: 'fresh' }`) iff this returns
 * `true`, and proceeds otherwise.
 *
 * Documented contract of the seam:
 *
 *   - Returns `true` (fresh → scheduled run skips) iff a prior successful sync
 *     exists AND its age `(now - lastSuccessfulSyncAt)` is at most `intervalMs`.
 *
 *   - A `null` `lastSuccessfulSyncAt` (no successful sync yet) is NEVER fresh,
 *     so a first-ever scheduled run always proceeds.
 *
 *   - The boundary is strictly-greater-than: an age of exactly `intervalMs` is
 *     still fresh (`true`), matching the on-read staleness boundary (R9.3).
 *
 *   - A negative age (writer/reader clock skew — a "future" last-sync
 *     timestamp) is treated as fresh (`true`): a sync that appears to have
 *     completed in the future has certainly completed within the interval.
 *
 * `isWithinFreshness` is pure and total, so this property runs entirely
 * in-memory with no timers, Redis, network, or database, driving the decision
 * across the whole input space (null, and arbitrary sync/now instants and
 * positive intervals, with the boundary and clock-skew cases hit explicitly).
 *
 * // Feature: disney-source-resilience, Property 11: Sync freshness guard
 * Validates: Requirements 9.2
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isWithinFreshness } from '../sync.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A positive freshness interval in ms. Spans sub-second ticks up to well
 * beyond the ≥24h production default (86_400_000 ms) so the property covers
 * both tight and realistic windows. The guard only ever consults a positive
 * interval (`disney.syncIntervalMs`), so the generator stays ≥ 1.
 */
const intervalMsArb: fc.Arbitrary<number> = fc.integer({
  min: 1,
  max: 7 * 24 * 60 * 60 * 1000,
});

/** A `now` wall-clock instant across a broad, realistic epoch range. */
const nowArb: fc.Arbitrary<Date> = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970-01-01 .. 2100-01-01
  .map((ms) => new Date(ms));

/**
 * An arbitrary age offset (ms) applied to `now` to derive the last successful
 * sync instant. Spans negative (future timestamp / clock skew) through large
 * positive ages, so the generated `lastSuccessfulSyncAt` lands on both sides
 * of any interval boundary.
 */
const ageOffsetMsArb: fc.Arbitrary<number> = fc.integer({
  min: -60 * 60 * 1000, // up to an hour in the "future" (clock skew)
  max: 14 * 24 * 60 * 60 * 1000, // up to two weeks stale
});

// ---------------------------------------------------------------------------
// Property 11: Sync freshness guard
// ---------------------------------------------------------------------------

describe('isWithinFreshness (Property 11: Sync freshness guard)', () => {
  it('is fresh (skip scheduled run) exactly when a prior sync exists and its age <= interval', () => {
    fc.assert(
      fc.property(nowArb, ageOffsetMsArb, intervalMsArb, (now, ageMs, intervalMs) => {
        const lastSuccessfulSyncAt = new Date(now.getTime() - ageMs);

        const fresh = isWithinFreshness(lastSuccessfulSyncAt, now, intervalMs);

        // The reference decision derived straight from the documented contract:
        // a prior sync exists here (non-null), so fresh iff age <= interval.
        // `ageMs` is exactly `now - lastSuccessfulSyncAt` by construction.
        expect(fresh).toBe(ageMs <= intervalMs);
      }),
      { numRuns: 100 },
    );
  });

  it('is never fresh when there is no prior successful sync (first run always proceeds)', () => {
    fc.assert(
      fc.property(nowArb, intervalMsArb, (now, intervalMs) => {
        // (R9.2) A `null` last-sync means the scheduled run must proceed: the
        // guard is never satisfied regardless of `now` or the interval.
        expect(isWithinFreshness(null, now, intervalMs)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('treats the boundary (age === interval) as fresh (strictly-greater-than staleness)', () => {
    fc.assert(
      fc.property(nowArb, intervalMsArb, (now, intervalMs) => {
        // Age exactly equal to the interval: the boundary is inclusive of
        // fresh, so a scheduled run at exactly `intervalMs` old is still a
        // no-op (matches the on-read staleness boundary, R9.3).
        const lastSuccessfulSyncAt = new Date(now.getTime() - intervalMs);
        expect(isWithinFreshness(lastSuccessfulSyncAt, now, intervalMs)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('proceeds when the age exceeds the interval by even 1ms', () => {
    fc.assert(
      fc.property(nowArb, intervalMsArb, (now, intervalMs) => {
        // Just past the boundary: age = interval + 1ms is stale, so the
        // scheduled run proceeds (guard returns false).
        const lastSuccessfulSyncAt = new Date(now.getTime() - (intervalMs + 1));
        expect(isWithinFreshness(lastSuccessfulSyncAt, now, intervalMs)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('treats a negative age (future last-sync timestamp / clock skew) as fresh', () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.integer({ min: 1, max: 60 * 60 * 1000 }),
        intervalMsArb,
        (now, skewMs, intervalMs) => {
          // A last-sync timestamp in the "future": age is negative, which is
          // <= any positive interval, so the guard treats it as fresh.
          const lastSuccessfulSyncAt = new Date(now.getTime() + skewMs);
          expect(isWithinFreshness(lastSuccessfulSyncAt, now, intervalMs)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
