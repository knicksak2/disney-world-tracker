/**
 * Property-based test for `projectLiveDetail` — Property 3.
 *
 * Kept in its own file (one property per file) so concurrent authoring of the
 * sibling projection properties never clobbers a shared file.
 *
 *   - Property 3: Minute-valued fields are whole numbers in [0, 1440] or absent
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { projectLiveDetail, type ProjectionContext, WDW_TIME_ZONE } from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 100;

/** A fixed projection context; the current day is irrelevant to minute bounds. */
const CTX: ProjectionContext = {
  parkTimeZone: WDW_TIME_ZONE,
  now: new Date('2024-06-15T18:00:00.000Z'),
};

/** The upper bound on every minute-valued field per R1.5/R1.11/R1.15/R1.16. */
const MAX_MINUTES = 1440;

/**
 * Oracle mirroring the projection's minute rule (R1.5, R1.6, R1.11, R1.12,
 * R1.15): a minute-valued upstream value survives projection iff it is a
 * genuine integer in [0, 1440]; everything else becomes absent.
 */
function expectedMinutes(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  if (value < 0 || value > MAX_MINUTES) {
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Minute-candidate generator: a wide spread across the valid / invalid space
// ---------------------------------------------------------------------------

/**
 * Generate a candidate minute value that intelligently covers every branch of
 * the projection's range/integer check: valid in-range integers, the [0, 1440]
 * boundaries, out-of-range high/negative integers, non-integer floats, NaN,
 * and the absent forms (`null` / `undefined`).
 */
const minuteCandidate: fc.Arbitrary<number | null | undefined> = fc.oneof(
  // Valid whole minutes in range (the keep case).
  fc.integer({ min: 0, max: MAX_MINUTES }),
  // Exact boundaries get extra weight.
  fc.constantFrom(0, MAX_MINUTES),
  // Out of range high.
  fc.integer({ min: MAX_MINUTES + 1, max: 100_000 }),
  // Negative.
  fc.integer({ min: -100_000, max: -1 }),
  // Non-integer floats (forced off the integers).
  fc.double({ min: -50, max: 2000, noNaN: true }).map((n) => (Number.isInteger(n) ? n + 0.5 : n)),
  // Pathological numerics.
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  // Absent forms.
  fc.constantFrom(null, undefined),
);

/** A valid park-local-ish ISO instant for forecast entries. */
const isoInstant: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/** A percentage that is always valid so the forecast does not degrade for that reason. */
const validPercentage: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 });

// ===========================================================================
// Property 3: Minute-valued fields are whole numbers in [0, 1440] or absent
// ===========================================================================
// Feature: experience-live-details, Property 3: Minute-valued fields are whole numbers in [0, 1440] or absent
//
// Validates: Requirements 1.5, 1.6, 1.11, 1.12, 1.15
//
// For any raw upstream entry, every minute-valued field that the projection
// emits (standby `waitMinutes`, `singleRiderWaitMinutes`, the boarding-group
// `estimatedWaitMinutes`, and each forecast `waitMinutes`) is an integer in
// [0, 1440]; and a missing, non-integer, or out-of-range upstream value is
// represented as absent (matching the `expectedMinutes` oracle).

describe('projectLiveDetail — Property 3: minute-valued fields are whole numbers in [0, 1440] or absent', () => {
  it('standby waitMinutes is kept iff a valid in-range integer, else absent (R1.5, R1.6)', () => {
    fc.assert(
      fc.property(minuteCandidate, (raw) => {
        const entry: ThemeParksLiveEntry = { queue: { STANDBY: { waitTime: raw as number } } };
        const detail = projectLiveDetail(entry, CTX);

        // Round-trip against the oracle.
        expect(detail.waitMinutes).toBe(expectedMinutes(raw));
        // Whenever present, it satisfies the integer/range invariant.
        if (detail.waitMinutes !== undefined) {
          expect(Number.isInteger(detail.waitMinutes)).toBe(true);
          expect(detail.waitMinutes).toBeGreaterThanOrEqual(0);
          expect(detail.waitMinutes).toBeLessThanOrEqual(MAX_MINUTES);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('singleRiderWaitMinutes is kept iff a valid in-range integer, else absent (R1.11, R1.12)', () => {
    fc.assert(
      fc.property(minuteCandidate, (raw) => {
        const entry: ThemeParksLiveEntry = { queue: { SINGLE_RIDER: { waitTime: raw as number } } };
        const detail = projectLiveDetail(entry, CTX);

        expect(detail.singleRiderWaitMinutes).toBe(expectedMinutes(raw));
        if (detail.singleRiderWaitMinutes !== undefined) {
          expect(Number.isInteger(detail.singleRiderWaitMinutes)).toBe(true);
          expect(detail.singleRiderWaitMinutes).toBeGreaterThanOrEqual(0);
          expect(detail.singleRiderWaitMinutes).toBeLessThanOrEqual(MAX_MINUTES);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('boarding-group estimatedWaitMinutes is kept iff a valid in-range integer, else absent (R1.15)', () => {
    fc.assert(
      fc.property(minuteCandidate, (raw) => {
        // A recognized allocation token is required for the boarding group to
        // project at all, so the estimated-wait branch is actually exercised.
        const entry: ThemeParksLiveEntry = {
          queue: { BOARDING_GROUP: { allocationStatus: 'AVAILABLE', estimatedWait: raw as number } },
        };
        const detail = projectLiveDetail(entry, CTX);

        // The group itself is always present here (valid allocation token).
        expect(detail.boardingGroup).toBeDefined();
        expect(detail.boardingGroup?.estimatedWaitMinutes).toBe(expectedMinutes(raw));
        if (detail.boardingGroup?.estimatedWaitMinutes !== undefined) {
          const m = detail.boardingGroup.estimatedWaitMinutes;
          expect(Number.isInteger(m)).toBe(true);
          expect(m).toBeGreaterThanOrEqual(0);
          expect(m).toBeLessThanOrEqual(MAX_MINUTES);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every projected forecast waitMinutes is an integer in [0, 1440] (R1.16)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ time: isoInstant, waitTime: minuteCandidate, percentage: validPercentage }),
          { minLength: 1, maxLength: 8 },
        ),
        (forecastEntries) => {
          // The generated entries deliberately carry invalid `waitTime`
          // values (null / undefined / out-of-range / non-integer) so the
          // projection's forecast-collapse rule is exercised. The upstream
          // wire type only models `waitTime?: number`, so we bridge the gap
          // with an `unknown` hop and strip the optional-index `undefined`
          // from the array type via `NonNullable`.
          const entry: ThemeParksLiveEntry = {
            forecast: forecastEntries as unknown as NonNullable<ThemeParksLiveEntry['forecast']>,
          };
          const detail = projectLiveDetail(entry, CTX);

          // The forecast survives only when EVERY entry has a valid minute.
          const allMinutesValid = forecastEntries.every(
            (e) => expectedMinutes(e.waitTime) !== undefined,
          );

          if (allMinutesValid) {
            expect(detail.forecast).toBeDefined();
            for (const f of detail.forecast ?? []) {
              expect(Number.isInteger(f.waitMinutes)).toBe(true);
              expect(f.waitMinutes).toBeGreaterThanOrEqual(0);
              expect(f.waitMinutes).toBeLessThanOrEqual(MAX_MINUTES);
            }
          } else {
            // A single bad minute collapses the whole forecast to absent;
            // there is then no projected forecast minute to violate the bound.
            expect(detail.forecast).toBeUndefined();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
