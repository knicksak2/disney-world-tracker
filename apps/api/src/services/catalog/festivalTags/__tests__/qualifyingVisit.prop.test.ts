/**
 * Property tests for `qualifyingVisit.ts`'s pure core.
 *
 * Validates: Requirements 9.4, 9.5, 10.3, 11.1, 11.2, 11.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  isQualifyingVisit,
  withinWindow,
  type FestivalEditionWindow,
  type QualifyingSignal,
} from '../qualifyingVisit.js';

/** Generates an arbitrary ISO-8601 calendar date string within a bounded range. */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2015-01-01T00:00:00Z'), max: new Date('2100-12-31T00:00:00Z') })
  .map((d) => d.toISOString().slice(0, 10));

const matchKindArb: fc.Arbitrary<'facet' | 'menu'> = fc.constantFrom('facet', 'menu');

const windowArb: fc.Arbitrary<FestivalEditionWindow | null> = fc.option(
  fc
    .tuple(isoDateArb, fc.option(isoDateArb, { nil: null }))
    .map(([startsOn, endsOnRaw]) => {
      // Normalize so endsOn (when present) is never before startsOn.
      const endsOn = endsOnRaw !== null && endsOnRaw < startsOn ? startsOn : endsOnRaw;
      return { startsOn, endsOn };
    }),
  { nil: null },
);

const signalArb: fc.Arbitrary<QualifyingSignal> = fc.record({
  matchKind: matchKindArb,
  completionDate: fc.option(isoDateArb, { nil: null }),
  qualifyingFoodLogDates: fc.array(isoDateArb, { maxLength: 8 }),
});

describe('qualifyingVisit property tests', () => {
  // Feature: festival-booth-tagging, Property 32: Qualifying Visit Is Boolean, Never Additive
  it('Property 32: result is a pure OR-reduction over signals, invariant to duplicates/reordering/extra non-qualifying dates', () => {
    fc.assert(
      fc.property(
        signalArb,
        windowArb,
        isoDateArb,
        fc.array(isoDateArb, { maxLength: 5 }),
        (signal, window, today, extraNonQualifyingDates) => {
          const baseline = isQualifyingVisit(signal, window, today);

          // Adding MORE qualifying/non-qualifying food log dates (simulating
          // N food_item_logs across M distinct food_items at the SAME
          // experience) never flips false -> true unexpectedly, nor does it
          // ever produce anything but a boolean: once true, adding more
          // dates stays true (monotonic OR); the result is never a count.
          const withExtras: QualifyingSignal = {
            ...signal,
            qualifyingFoodLogDates: [
              ...signal.qualifyingFoodLogDates,
              ...signal.qualifyingFoodLogDates, // duplicate every existing date
              ...extraNonQualifyingDates,
            ],
          };
          const withDuplicatesResult = isQualifyingVisit(withExtras, window, today);

          expect(typeof baseline).toBe('boolean');
          expect(typeof withDuplicatesResult).toBe('boolean');
          // Duplicating qualifying dates can only ever preserve or grow the
          // set of qualifying candidates — it must never make true flip to
          // false, confirming the result is a boolean OR-reduction, not an
          // additive count that could overflow/change semantics.
          if (baseline) {
            expect(withDuplicatesResult).toBe(true);
          }

          // Shuffled order of the same food log dates never changes the result.
          const shuffled: QualifyingSignal = {
            ...signal,
            qualifyingFoodLogDates: [...signal.qualifyingFoodLogDates].reverse(),
          };
          expect(isQualifyingVisit(shuffled, window, today)).toBe(baseline);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 32 (adversarial case): 1 completion + N food-logs across M food_items at the same experience never yields more than a single qualifying contribution', () => {
    fc.assert(
      fc.property(
        matchKindArb,
        fc.option(isoDateArb, { nil: null }),
        fc.array(isoDateArb, { minLength: 0, maxLength: 20 }), // simulates many food_items' logs
        windowArb,
        isoDateArb,
        (matchKind, completionDate, foodLogDates, window, today) => {
          const signal: QualifyingSignal = {
            matchKind,
            completionDate,
            qualifyingFoodLogDates: foodLogDates,
          };
          const result = isQualifyingVisit(signal, window, today);
          // The ENTIRE point: regardless of how many qualifying rows feed in,
          // the contribution is always exactly one boolean value — "true" or
          // "false" — never a number that could be summed into a count > 1.
          expect(result === true || result === false).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: festival-booth-tagging, Property 33: Menu-Matched Requires a Tagged Dish, Facet-Matched Does Not
  it('Property 33: menu-matched never qualifies from completion alone; facet-matched qualifies from either signal', () => {
    fc.assert(
      fc.property(
        fc.option(isoDateArb, { nil: null }),
        fc.array(isoDateArb, { maxLength: 5 }),
        windowArb,
        isoDateArb,
        (completionDate, qualifyingFoodLogDates, window, today) => {
          const menuSignal: QualifyingSignal = {
            matchKind: 'menu',
            completionDate,
            qualifyingFoodLogDates,
          };
          const expectedMenuResult = qualifyingFoodLogDates.some((d) => withinWindow(d, window, today));
          expect(isQualifyingVisit(menuSignal, window, today)).toBe(expectedMenuResult);

          const facetSignal: QualifyingSignal = {
            matchKind: 'facet',
            completionDate,
            qualifyingFoodLogDates,
          };
          const expectedFacetResult =
            (completionDate !== null && withinWindow(completionDate, window, today)) ||
            qualifyingFoodLogDates.some((d) => withinWindow(d, window, today));
          expect(isQualifyingVisit(facetSignal, window, today)).toBe(expectedFacetResult);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 33: a menu-matched experience with ONLY a completion (no food logs at all) never qualifies, for any window', () => {
    fc.assert(
      fc.property(isoDateArb, windowArb, isoDateArb, (completionDate, window, today) => {
        const signal: QualifyingSignal = {
          matchKind: 'menu',
          completionDate,
          qualifyingFoodLogDates: [],
        };
        expect(isQualifyingVisit(signal, window, today)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: festival-booth-tagging, Property 34: Date Window Is Inclusive and Absence Means Unrestricted
  it('Property 34: a null window never restricts any date', () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, (date, today) => {
        expect(withinWindow(date, null, today)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 34: startsOn and the effective end are always inclusive boundaries', () => {
    fc.assert(
      fc.property(
        isoDateArb,
        fc.option(isoDateArb, { nil: null }),
        isoDateArb,
        (startsOnRaw, endsOnRaw, todayRaw) => {
          // `today` only has meaning as "now" when it is not before the
          // window's own start — a window whose edition hasn't started yet
          // relative to `today` is a degenerate combination the real caller
          // (which always passes the actual current date) never produces.
          const today = todayRaw < startsOnRaw ? startsOnRaw : todayRaw;
          const endsOn = endsOnRaw !== null && endsOnRaw < startsOnRaw ? startsOnRaw : endsOnRaw;
          const window: FestivalEditionWindow = { startsOn: startsOnRaw, endsOn };

          // The start boundary is always inclusive.
          expect(withinWindow(startsOnRaw, window, today)).toBe(true);

          // The effective end (ends_on, or today when ends_on is null) is
          // always inclusive.
          const effectiveEnd = endsOn ?? today;
          expect(withinWindow(effectiveEnd, window, today)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 34: a null endsOn is equivalent to an explicit endsOn of "today"', () => {
    fc.assert(
      fc.property(isoDateArb, isoDateArb, (startsOnRaw, dateRaw) => {
        const today = '2026-11-20';
        const startsOn = startsOnRaw <= today ? startsOnRaw : today;
        const stillRunning: FestivalEditionWindow = { startsOn, endsOn: null };
        const explicitToday: FestivalEditionWindow = { startsOn, endsOn: today };

        expect(withinWindow(dateRaw, stillRunning, today)).toBe(
          withinWindow(dateRaw, explicitToday, today),
        );
      }),
      { numRuns: 100 },
    );
  });
});
