// Feature: experience-live-details, Property 14: Dining view empty states are decided purely from the data
/**
 * Property-based tests for `diningHoursState` and `diningWalkupState`.
 *
 * Validates: Requirements 6.3, 6.7
 *
 * The two dining empty-state decisions are pure functions of their inputs:
 *
 *   - `diningHoursState(operatingHours)` returns `{ kind: 'unavailable' }`
 *     exactly when there is no current-day Operating_Hours set carrying BOTH a
 *     present opening time AND a present closing time (R6.3); otherwise it
 *     returns `{ kind: 'available', hours }` where `hours` is the usable subset
 *     (every set with both an open and a close present).
 *
 *   - `diningWalkupState(diningAvailability)` returns `{ kind: 'unavailable' }`
 *     exactly when the Dining_Availability list is empty (R6.7); otherwise it
 *     returns `{ kind: 'available', entries }` carrying the entries through.
 *
 * Test strategy:
 *   - For hours, generate each open/close slot independently as present (a real
 *     ISO instant), empty-string, or absent (undefined). "Present" for the
 *     implementation means a non-empty string, so empty-string and undefined
 *     are both treated as absent — the generators sweep all three variants so
 *     the boundary is exercised directly.
 *   - Compute the expected usable subset with the same present/absent predicate
 *     and assert the function's decision and carried subset match exactly.
 *   - For walk-up, generate dining lists of varying length including empty and
 *     assert the empty-state decision is driven solely by `length === 0`.
 *   - Both suites run >= 100 iterations.
 */

import fc from 'fast-check';

import type { DiningAvailabilityEntry, OperatingHours } from '@dwt/shared';

import { diningHoursState, diningWalkupState } from '../liveView.js';

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A single open/close time slot, sampled across the three variants the
 * present/absent predicate must distinguish:
 *   - a present, non-empty ISO-8601 instant (the only "usable" case),
 *   - an empty string `''` (present-but-empty -> treated as absent),
 *   - absent (`undefined`).
 */
const timeSlotArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc
    .date({ min: new Date('2024-01-01T00:00:00.000Z'), max: new Date('2030-12-31T23:59:59.000Z') })
    .map((d) => d.toISOString()),
  fc.constant(''),
  fc.constant(undefined),
);

const operatingHoursTypeArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('Operating', 'Early Entry', 'Extended Evening'),
);

/**
 * An Operating_Hours-shaped record whose open/close may be present, empty, or
 * absent. The published type declares `open`/`close` as required strings; the
 * implementation defends against missing/empty values, so we build the raw
 * shape here and cast at the call site to exercise that defence.
 */
const rawHoursArb = fc
  .record({
    open: timeSlotArb,
    close: timeSlotArb,
    type: operatingHoursTypeArb,
  })
  .map((h) => {
    // Drop undefined keys so the object mirrors a real upstream projection
    // (absent fields are missing, not explicitly `undefined`).
    const out: Record<string, unknown> = {};
    if (h.open !== undefined) out.open = h.open;
    if (h.close !== undefined) out.close = h.close;
    if (h.type !== undefined) out.type = h.type;
    return out as unknown as OperatingHours;
  });

const operatingHoursListArb = fc.array(rawHoursArb, { minLength: 0, maxLength: 8 });

const diningEntryArb: fc.Arbitrary<DiningAvailabilityEntry> = fc.record(
  {
    partySize: fc.integer({ min: 1, max: 12 }),
    estimatedWaitMinutes: fc.integer({ min: 0, max: 1440 }),
  },
  { requiredKeys: [] },
);

const diningListArb = fc.array(diningEntryArb, { minLength: 0, maxLength: 8 });

/** Mirror of the implementation's `isPresent`: a present, non-empty string. */
function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// diningHoursState (R6.3)
// ---------------------------------------------------------------------------

describe('diningHoursState (Property 14: dining hours empty state from data, R6.3)', () => {
  it('is unavailable exactly when no hours set carries both a present open and close; otherwise carries the usable subset', () => {
    fc.assert(
      fc.property(operatingHoursListArb, (hours) => {
        const result = diningHoursState(hours);

        const expectedUsable = hours.filter(
          (h) => isPresent((h as { open?: unknown }).open) && isPresent((h as { close?: unknown }).close),
        );

        if (expectedUsable.length === 0) {
          // R6.3: no set with both open and close -> unavailable empty state.
          expect(result).toEqual({ kind: 'unavailable' });
        } else {
          expect(result.kind).toBe('available');
          if (result.kind === 'available') {
            // Carries exactly the usable subset, preserving order and identity.
            expect(result.hours).toEqual(expectedUsable);
            // Every carried set genuinely has both an open and a close present.
            for (const h of result.hours) {
              expect(isPresent(h.open)).toBe(true);
              expect(isPresent(h.close)).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('decides purely from the data: identical inputs yield identical results', () => {
    fc.assert(
      fc.property(operatingHoursListArb, (hours) => {
        expect(diningHoursState(hours)).toEqual(diningHoursState(hours));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats empty-string and absent open/close as not present (boundary)', () => {
    fc.assert(
      fc.property(fc.constantFrom('', undefined), fc.constantFrom('', undefined), (open, close) => {
        const raw: Record<string, unknown> = {};
        if (open !== undefined) raw.open = open;
        if (close !== undefined) raw.close = close;
        // A lone set whose open/close are empty/absent is never usable.
        expect(diningHoursState([raw as unknown as OperatingHours])).toEqual({
          kind: 'unavailable',
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// diningWalkupState (R6.7)
// ---------------------------------------------------------------------------

describe('diningWalkupState (Property 14: walk-up empty state from data, R6.7)', () => {
  it('is unavailable exactly when the dining list is empty; otherwise carries the entries through', () => {
    fc.assert(
      fc.property(diningListArb, (entries) => {
        const result = diningWalkupState(entries);

        if (entries.length === 0) {
          // R6.7: empty Dining_Availability -> unavailable empty state.
          expect(result).toEqual({ kind: 'unavailable' });
        } else {
          expect(result).toEqual({ kind: 'available', entries });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('decides purely from the data: identical inputs yield identical results', () => {
    fc.assert(
      fc.property(diningListArb, (entries) => {
        expect(diningWalkupState(entries)).toEqual(diningWalkupState(entries));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
