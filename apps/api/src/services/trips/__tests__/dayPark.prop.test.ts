// Feature: trips, Property 28: Setting or clearing a Day_Park changes only that date's startingPark
/**
 * Property-based tests for `applyDayPark`.
 *
 * Validates: Requirements 24.2, 24.3, 24.4, 24.7
 *
 * Property 28: Setting or clearing a Day_Park changes only that date's startingPark
 * For any day_touring_hours map M (including empty, and including dates with arbitrary other fields
 * such as startHour, endHour, startMode), any date d, and any p in PARKS:
 * (a) applyDayPark(M, d, p) has startingPark = p at d, every other field of d's entry is equal
 *     to its value in M, and every other date's entry is deeply equal to its value in M;
 * (b) applyDayPark(M, d, null) has no startingPark at d, every other field of d's entry is unchanged,
 *     d's key is absent exactly when its entry would otherwise be empty, and every other date is unchanged;
 * (c) both operations are idempotent (apply(apply(M,d,x),d,x) deep-equals apply(M,d,x));
 * (d) for a date d absent from M, applyDayPark(applyDayPark(M, d, p), d, null) deep-equals M;
 * and (e) the input M is never mutated.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PARKS, type Park } from '@dwt/shared';

import { applyDayPark } from '../dayPark.js';

const NUM_RUNS = 100;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
}

const parkArb = fc.constantFrom<Park>(...PARKS);

const dayTouringHoursEntryArb = fc.record(
  {
    startHour: fc.integer({ min: 0, max: 23 }),
    endHour: fc.integer({ min: 0, max: 23 }),
    startMinutes: fc.integer({ min: 0, max: 1439 }),
    startMode: fc.constantFrom<'park_open' | 'party_mix_in' | 'custom'>('park_open', 'party_mix_in', 'custom'),
    useEarlyEntry: fc.boolean(),
    useExtendedEvening: fc.boolean(),
    hasAfterHoursTicket: fc.boolean(),
    startingPark: fc.oneof(parkArb, fc.string()),
  },
  { withDeletedKeys: true },
);

const dateArb = fc.integer({ min: 18000, max: 22000 }).map((day) =>
  new Date(day * 86_400_000).toISOString().slice(0, 10),
);

const dayTouringHoursMapArb = fc.dictionary(dateArb, dayTouringHoursEntryArb);

describe('Property 28: Setting or clearing a Day_Park changes only that date\'s startingPark', () => {
  it('(a) setting Day_Park: startingPark = p at d, other fields of d unchanged, other dates deeply equal', () => {
    fc.assert(
      fc.property(dayTouringHoursMapArb, dateArb, parkArb, (rawMap, date, park) => {
        const frozenMap = deepFreeze(structuredClone(rawMap));
        const originalEntry = frozenMap[date];

        const updated = applyDayPark(frozenMap, date, park);

        // startingPark is set to park at d
        expect(updated[date]?.startingPark).toBe(park);

        // other fields of d are equal to their values in M
        if (originalEntry) {
          const expectedOtherFields = { ...originalEntry };
          delete expectedOtherFields.startingPark;
          const actualOtherFields = { ...updated[date] };
          delete actualOtherFields.startingPark;
          expect(actualOtherFields).toEqual(expectedOtherFields);
        }

        // every other date's entry is deeply equal to its value in M
        for (const [key, val] of Object.entries(frozenMap)) {
          if (key !== date) {
            expect(updated[key]).toEqual(val);
          }
        }
        for (const key of Object.keys(updated)) {
          if (key !== date) {
            expect(frozenMap[key]).toEqual(updated[key]);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(b) clearing Day_Park: startingPark removed at d, other fields unchanged, d absent iff empty, other dates unchanged', () => {
    fc.assert(
      fc.property(dayTouringHoursMapArb, dateArb, (rawMap, date) => {
        const frozenMap = deepFreeze(structuredClone(rawMap));
        const originalEntry = frozenMap[date];

        const updated = applyDayPark(frozenMap, date, null);

        if (!originalEntry) {
          // date was absent from M, should remain absent
          expect(updated[date]).toBeUndefined();
        } else {
          const remainingOriginal = { ...originalEntry };
          delete remainingOriginal.startingPark;

          if (Object.keys(remainingOriginal).length === 0) {
            // entry had no other fields: d's key is absent
            expect(updated[date]).toBeUndefined();
          } else {
            // entry had other fields: startingPark is absent, other fields unchanged
            expect(updated[date]?.startingPark).toBeUndefined();
            expect(updated[date]).toEqual(remainingOriginal);
          }
        }

        // every other date's entry is deeply equal to its value in M
        for (const [key, val] of Object.entries(frozenMap)) {
          if (key !== date) {
            expect(updated[key]).toEqual(val);
          }
        }
        for (const key of Object.keys(updated)) {
          if (key !== date) {
            expect(frozenMap[key]).toEqual(updated[key]);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(c) both operations are idempotent: apply(apply(M,d,x),d,x) deep-equals apply(M,d,x)', () => {
    fc.assert(
      fc.property(
        dayTouringHoursMapArb,
        dateArb,
        fc.oneof(parkArb, fc.constant(null)),
        (rawMap, date, parkOrNull) => {
          const frozenMap = deepFreeze(structuredClone(rawMap));

          const once = applyDayPark(frozenMap, date, parkOrNull);
          deepFreeze(once);
          const twice = applyDayPark(once, date, parkOrNull);

          expect(twice).toEqual(once);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('(d) absent date round-trip: applyDayPark(applyDayPark(M, d, p), d, null) deep-equals M for d absent from M', () => {
    fc.assert(
      fc.property(dayTouringHoursMapArb, dateArb, parkArb, (rawMap, date, park) => {
        // Ensure date is absent from map
        const mapWithoutDate = { ...rawMap };
        delete mapWithoutDate[date];
        const frozenMap = deepFreeze(mapWithoutDate);

        const setThenCleared = applyDayPark(
          applyDayPark(frozenMap, date, park),
          date,
          null,
        );

        expect(setThenCleared).toEqual(frozenMap);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(e) input map is never mutated (deep-frozen input)', () => {
    fc.assert(
      fc.property(
        dayTouringHoursMapArb,
        dateArb,
        fc.oneof(parkArb, fc.constant(null)),
        (rawMap, date, parkOrNull) => {
          const frozenMap = deepFreeze(structuredClone(rawMap));
          // Will throw if applyDayPark attempts mutation of frozenMap or its entries
          expect(() => applyDayPark(frozenMap, date, parkOrNull)).not.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

