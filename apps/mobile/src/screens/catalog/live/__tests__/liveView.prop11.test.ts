// Feature: experience-live-details, Property 11: Forecast view shows only upcoming entries, sorted ascending, highlighting the unique lowest wait
//
// Validates: Requirements 4.11, 4.12
//
// Property 11 (from design.md → Correctness Properties):
//   For any Wait_Time_Forecast and any "current time" `now`, the forecast view:
//     - shows only the entries whose forecast time is at or after `now`
//       (upcoming), sorted strictly ascending by forecast time (R4.11);
//     - yields an empty list — driving the "no wait time forecast available"
//       empty state — when the forecast is absent, empty, or has no upcoming
//       entries (R4.12);
//     - highlights the single upcoming entry with the lowest predicted standby
//       wait; that highlighted entry is always a member of the upcoming list
//       and its wait is <= every other upcoming entry's wait (R4.11).
//
// Test strategy:
//   - Generate ForecastEntry lists over a bounded epoch range. Each entry's
//     time is generated from a millisecond instant so we can compute the
//     expected ordering/filtering directly from numbers (no ISO re-parsing in
//     the oracle). `now` is generated independently from the same range so all
//     three partitions (all upcoming, none upcoming, mixed) are exercised.
//   - Distinct millisecond instants are NOT forced, so ties on time are
//     sampled too, validating the ascending (>=) + stable-by-index contract.
//   - These helpers are pure/total/deterministic, so the test asserts directly
//     on returned arrays — no mocking, no clock, no I/O.

import fc from 'fast-check';
import type { ForecastEntry } from '@dwt/shared';

import { upcomingForecast, lowestWaitEntry } from '../liveView';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A bounded instant range so generated `now` lands inside, before, and after
// the entry cluster across runs — exercising all/none/mixed upcoming subsets.
const MIN_MS = Date.UTC(2024, 0, 1, 0, 0, 0);
const MAX_MS = Date.UTC(2024, 0, 2, 0, 0, 0); // 24h window

const instantMsArb: fc.Arbitrary<number> = fc.integer({ min: MIN_MS, max: MAX_MS });

const forecastEntryArb: fc.Arbitrary<ForecastEntry> = fc.record({
  time: instantMsArb.map((ms) => new Date(ms).toISOString()),
  waitMinutes: fc.integer({ min: 0, max: 1440 }),
  percentage: fc.integer({ min: 0, max: 100 }),
});

const forecastArb: fc.Arbitrary<readonly ForecastEntry[]> = fc.array(forecastEntryArb, {
  maxLength: 12,
});

const nowArb: fc.Arbitrary<Date> = instantMsArb.map((ms) => new Date(ms));

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 11: Forecast view shows only upcoming entries, sorted ascending, highlighting the unique lowest wait (R4.11, R4.12)', () => {
  test('upcomingForecast filters+sorts and lowestWaitEntry highlights the minimum upcoming wait', () => {
    fc.assert(
      fc.property(forecastArb, nowArb, (forecast, now) => {
        const nowMs = now.getTime();
        const upcoming = upcomingForecast(forecast, now);

        // R4.11 — every returned entry is upcoming (time >= now).
        for (const entry of upcoming) {
          expect(Date.parse(entry.time)).toBeGreaterThanOrEqual(nowMs);
        }

        // R4.11 — sorted ascending (non-decreasing) by forecast time.
        for (let i = 1; i < upcoming.length; i += 1) {
          const prev = upcoming[i - 1];
          const curr = upcoming[i];
          expect(prev).toBeDefined();
          expect(curr).toBeDefined();
          expect(Date.parse(prev!.time)).toBeLessThanOrEqual(
            Date.parse(curr!.time),
          );
        }

        // R4.11 — no upcoming entry was dropped: count matches the oracle.
        const expectedCount = forecast.filter((e) => Date.parse(e.time) >= nowMs).length;
        expect(upcoming.length).toBe(expectedCount);

        // R4.12 — absent/empty/no-upcoming forecast yields [].
        if (expectedCount === 0) {
          expect(upcoming).toEqual([]);
        }

        const highlighted = lowestWaitEntry(upcoming);

        if (upcoming.length === 0) {
          // R4.12 — nothing to highlight when there are no upcoming entries.
          expect(highlighted).toBeUndefined();
        } else {
          // R4.11 — the highlight is a member of the upcoming list...
          expect(highlighted).toBeDefined();
          expect(upcoming).toContain(highlighted);

          // ...and its wait is <= every other upcoming entry's wait.
          const minWait = Math.min(...upcoming.map((e) => e.waitMinutes));
          expect(highlighted!.waitMinutes).toBe(minWait);
          for (const entry of upcoming) {
            expect(highlighted!.waitMinutes).toBeLessThanOrEqual(entry.waitMinutes);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('absent forecast yields an empty upcoming list (R4.12)', () => {
    expect(upcomingForecast(undefined, new Date(MIN_MS))).toEqual([]);
    expect(lowestWaitEntry([])).toBeUndefined();
  });
});
