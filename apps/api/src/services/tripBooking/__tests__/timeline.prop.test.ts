import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveBookingTimeline,
  resolveSettings,
  type TimelineTripInput,
  type StoredBookingSettings,
} from '../timeline.js';
import {
  STAY_TYPES,
  LIGHTNING_LANE_TIMINGS,
  WINDOW_KINDS,
  BOOKING_RULES_VERSION,
  addCalendarDays,
  listCalendarDates,
  isCheckInOverrideValid,
  type StayType,
  type LightningLaneTiming,
} from '@dwt/shared';
import { wdwMinutesFromMidnight, wdwOffsetMinutes } from '../../trips/wdwClock.js';

// Custom arbitrary generators
const baseDateArb = fc.oneof(
  // Biased toward DST transition dates and surrounding dates
  fc.constantFrom(
    '2025-03-08',
    '2025-03-09',
    '2025-03-10',
    '2025-11-01',
    '2025-11-02',
    '2025-11-03',
    '2025-06-14',
    '2025-01-01',
    '2025-12-31'
  ),
  fc.integer({ min: 0, max: 364 }).map(offset => addCalendarDays('2025-01-01', offset))
);

const tripInputArb: fc.Arbitrary<TimelineTripInput> = fc
  .record({
    startDate: baseDateArb,
    nights: fc.integer({ min: 0, max: 30 }),
    hasResortStay: fc.boolean(),
    hasSettings: fc.boolean(),
    stayType: fc.constantFrom<StayType | null>(null, ...STAY_TYPES),
    lightningLaneTiming: fc.constantFrom<LightningLaneTiming | null>(null, ...LIGHTNING_LANE_TIMINGS),
    overrideOffset: fc.constantFrom<number | null>(null, -35, -31, -30, -15, 0, 1, 5),
  })
  .map(r => {
    const endDate = addCalendarDays(r.startDate, r.nights);
    const checkInOverride =
      r.overrideOffset !== null ? addCalendarDays(r.startDate, r.overrideOffset) : null;
    const settings: StoredBookingSettings | null = r.hasSettings
      ? {
          stayType: r.stayType,
          lightningLaneTiming: r.lightningLaneTiming,
          checkInOverride,
        }
      : null;
    return {
      startDate: r.startDate,
      endDate,
      hasResortStay: r.hasResortStay,
      settings,
    };
  });

describe('timeline.ts property tests', () => {
  // Feature: trip-booking-timeline, Property 1: Covered_Dates partition the Stay_Dates and Window_Keys are unique
  it('Property 1: Covered_Dates partition the Stay_Dates and Window_Keys are unique', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.integer({ min: -5, max: 5 }),
        (trip, endDelta) => {
          const tripWithAdjustedEnd: TimelineTripInput = {
            ...trip,
            endDate: addCalendarDays(trip.endDate, endDelta),
          };
          const timeline = deriveBookingTimeline(tripWithAdjustedEnd);
          const arrival = timeline.arrival.value;
          const expectedStayDates = listCalendarDates(arrival, tripWithAdjustedEnd.endDate);

          expect(timeline.stayDates).toEqual(expectedStayDates);

          // Unique window keys across all windows
          const keys = timeline.windows.map(w => w.windowKey);
          const uniqueKeys = new Set(keys);
          expect(uniqueKeys.size).toBe(keys.length);

          for (const kind of WINDOW_KINDS) {
            const kindWindows = timeline.windows.filter(w => w.kind === kind);
            if (expectedStayDates.length === 0) {
              expect(kindWindows.length).toBe(0);
              continue;
            }

            // Each window has non-empty coveredDates, ascending within window
            for (const w of kindWindows) {
              expect(w.coveredDates.length).toBeGreaterThan(0);
              const sorted = [...w.coveredDates].sort();
              expect(w.coveredDates).toEqual(sorted);
            }

            // Disjoint union matches expectedStayDates exactly
            const allCovered = kindWindows.flatMap(w => w.coveredDates);
            expect(allCovered).toEqual(expectedStayDates);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 2: Every window's anchor, offset, and count follow the Booking_Rules table
  it('Property 2: Every window\'s anchor, offset, and count follow the Booking_Rules table', () => {
    // Independent oracle hard-coding 60, 10, 7, 14, 3
    function oracleWindows(
      stayDates: readonly string[],
      arrival: string,
      stayType: StayType,
      llTiming: LightningLaneTiming
    ) {
      if (stayDates.length === 0) return { dining: [], ll: [] };
      const n = stayDates.length;

      // Dining:
      // resort -> headOffset 60, cover min(n, 10); tail: date - 60 for later dates
      // partner_hotel / offsite -> headOffset 60, cover 1 (min(n, 1)); tail: date - 60 for later dates
      const diningHeadCover = stayType === 'resort' ? Math.min(n, 10) : Math.min(n, 1);
      const diningHead = {
        dropOn: addCalendarDays(arrival, -60),
        covered: stayDates.slice(0, diningHeadCover),
      };
      const diningTail = stayDates.slice(diningHeadCover).map(d => ({
        dropOn: addCalendarDays(d, -60),
        covered: [d],
      }));
      const expectedDining = [diningHead, ...diningTail];

      // Lightning Lane:
      // seven_day -> headOffset 7, cover min(n, 14); tail: when n > 14, ONE shared window at arrival - 3
      // three_day -> headOffset 3, cover all; tail: null
      // three_day_daily -> headOffset 3, cover 1; tail: date - 3 for later dates
      let expectedLL: { dropOn: string; covered: readonly string[] }[] = [];
      if (llTiming === 'seven_day') {
        const headCover = Math.min(n, 14);
        const head = {
          dropOn: addCalendarDays(arrival, -7),
          covered: stayDates.slice(0, headCover),
        };
        const tail =
          n > 14
            ? [
                {
                  dropOn: addCalendarDays(arrival, -3),
                  covered: stayDates.slice(14),
                },
              ]
            : [];
        expectedLL = [head, ...tail];
      } else if (llTiming === 'three_day') {
        expectedLL = [
          {
            dropOn: addCalendarDays(arrival, -3),
            covered: stayDates,
          },
        ];
      } else if (llTiming === 'three_day_daily') {
        expectedLL = stayDates.map(d => ({
          dropOn: addCalendarDays(d, -3),
          covered: [d],
        }));
      }

      return { dining: expectedDining, ll: expectedLL };
    }

    fc.assert(
      fc.property(tripInputArb, trip => {
        const timeline = deriveBookingTimeline(trip);
        const expected = oracleWindows(
          timeline.stayDates,
          timeline.arrival.value,
          timeline.stayType.value,
          timeline.lightningLaneTiming.value
        );

        const actualDining = timeline.windows
          .filter(w => w.kind === 'dining')
          .map(w => ({ dropOn: w.dropOn, covered: w.coveredDates }));
        const actualLL = timeline.windows
          .filter(w => w.kind === 'lightning_lane')
          .map(w => ({ dropOn: w.dropOn, covered: w.coveredDates }));

        expect(actualDining).toEqual(expected.dining);
        expect(actualLL).toEqual(expected.ll);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 3: Drop_At is the exact WDW wall-clock time and calendar arithmetic is DST-immune
  it('Property 3: Drop_At is the exact WDW wall-clock time and calendar arithmetic is DST-immune', () => {
    fc.assert(
      fc.property(tripInputArb, trip => {
        const timeline = deriveBookingTimeline(trip);
        for (const w of timeline.windows) {
          const minutes = wdwMinutesFromMidnight(w.dropOn, w.dropAt);
          if (w.kind === 'dining') {
            expect(minutes).toBe(360); // 06:00 WDW
          } else {
            expect(minutes).toBe(420); // 07:00 WDW
          }

          const offset = wdwOffsetMinutes(w.dropOn);
          // EDT (-240 min): 06:00 WDW = 10:00 UTC, 07:00 WDW = 11:00 UTC
          // EST (-300 min): 06:00 WDW = 11:00 UTC, 07:00 WDW = 12:00 UTC
          if (offset === -240) {
            if (w.kind === 'dining') {
              expect(w.dropAt.endsWith('T10:00:00.000Z')).toBe(true);
            } else {
              expect(w.dropAt.endsWith('T11:00:00.000Z')).toBe(true);
            }
          } else if (offset === -300) {
            if (w.kind === 'dining') {
              expect(w.dropAt.endsWith('T11:00:00.000Z')).toBe(true);
            } else {
              expect(w.dropAt.endsWith('T12:00:00.000Z')).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 4: Derivation is ordered, deterministic, versioned, and total
  it('Property 4: Derivation is ordered, deterministic, versioned, and total', () => {
    // Stub clock to throw on un-argumented calls to verify no clock is read
    const originalDateNow = Date.now;
    Date.now = () => {
      throw new Error('System clock read is forbidden in pure timeline derivation');
    };

    try {
      fc.assert(
        fc.property(
          tripInputArb,
          fc.integer({ min: -5, max: -1 }),
          (trip, negativeNights) => {
            // Case 1: normal derivation deterministic & sorted & versioned
            const t1 = deriveBookingTimeline(trip);
            const t2 = deriveBookingTimeline(trip);
            expect(t1).toEqual(t2);
            expect(t1.rulesVersion).toBe(BOOKING_RULES_VERSION);

            for (let i = 0; i < t1.windows.length - 1; i++) {
              const a = t1.windows[i]!;
              const b = t1.windows[i + 1]!;
              const cmpTime = a.dropAt.localeCompare(b.dropAt);
              if (cmpTime === 0) {
                const cmpKind = WINDOW_KINDS.indexOf(a.kind) - WINDOW_KINDS.indexOf(b.kind);
                if (cmpKind === 0) {
                  expect(a.coveredDates[0]!.localeCompare(b.coveredDates[0]!)).toBeLessThanOrEqual(0);
                } else {
                  expect(cmpKind).toBeLessThan(0); // dining before lightning_lane
                }
              } else {
                expect(cmpTime).toBeLessThan(0);
              }
            }

            // Case 2: end precedes arrival (total, 0 windows, no throw)
            const emptyTrip: TimelineTripInput = {
              ...trip,
              endDate: addCalendarDays(t1.arrival.value, negativeNights),
            };
            const emptyTimeline = deriveBookingTimeline(emptyTrip);
            expect(emptyTimeline.rulesVersion).toBe(BOOKING_RULES_VERSION);
            expect(emptyTimeline.windows).toEqual([]);
            expect(emptyTimeline.stayDates).toEqual([]);
          }
        ),
        { numRuns: 100 }
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  // Feature: trip-booking-timeline, Property 5: Shifting a Trip by k days shifts the timeline by k days
  it('Property 5: Shifting a Trip by k days shifts the timeline by k days', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.integer({ min: -60, max: 60 }),
        (trip, k) => {
          const shiftedTrip: TimelineTripInput = {
            startDate: addCalendarDays(trip.startDate, k),
            endDate: addCalendarDays(trip.endDate, k),
            hasResortStay: trip.hasResortStay,
            settings: trip.settings
              ? {
                  ...trip.settings,
                  checkInOverride:
                    trip.settings.checkInOverride !== null
                      ? addCalendarDays(trip.settings.checkInOverride, k)
                      : null,
                }
              : null,
          };

          const t1 = deriveBookingTimeline(trip);
          const t2 = deriveBookingTimeline(shiftedTrip);

          expect(t2.windows.length).toBe(t1.windows.length);
          for (let i = 0; i < t1.windows.length; i++) {
            const w1 = t1.windows[i]!;
            const w2 = t2.windows[i]!;
            expect(w2.kind).toBe(w1.kind);
            expect(w2.dropOn).toBe(addCalendarDays(w1.dropOn, k));
            expect(w2.coveredDates).toEqual(w1.coveredDates.map(d => addCalendarDays(d, k)));
            // Minutes from midnight is identical on shifted dropOn
            expect(wdwMinutesFromMidnight(w2.dropOn, w2.dropAt)).toBe(
              wdwMinutesFromMidnight(w1.dropOn, w1.dropAt)
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 6: Settings resolution applies stored values, auto rules, and the override range exactly
  it('Property 6: Settings resolution applies stored values, auto rules, and the override range exactly', () => {
    fc.assert(
      fc.property(tripInputArb, trip => {
        // Deep freeze input to verify no mutation
        const frozenTrip = Object.freeze({
          startDate: trip.startDate,
          endDate: trip.endDate,
          hasResortStay: trip.hasResortStay,
          settings: trip.settings ? Object.freeze({ ...trip.settings }) : null,
        });

        const res = resolveSettings(frozenTrip);

        // Stay type
        if (trip.settings?.stayType != null) {
          expect(res.stayType).toEqual({ value: trip.settings.stayType, source: 'override' });
        } else {
          const expectedAuto = trip.hasResortStay ? 'resort' : 'offsite';
          expect(res.stayType).toEqual({ value: expectedAuto, source: 'auto' });
        }

        // Lightning lane timing
        if (trip.settings?.lightningLaneTiming != null) {
          expect(res.lightningLaneTiming).toEqual({
            value: trip.settings.lightningLaneTiming,
            source: 'override',
          });
        } else {
          const defaultTiming = res.stayType.value === 'offsite' ? 'three_day' : 'seven_day';
          expect(res.lightningLaneTiming).toEqual({
            value: defaultTiming,
            source: 'auto',
          });
        }

        // Arrival date
        const override = trip.settings?.checkInOverride;
        if (override != null && isCheckInOverrideValid(override, trip.startDate)) {
          expect(res.arrival).toEqual({ value: override, source: 'override' });
        } else {
          expect(res.arrival).toEqual({ value: trip.startDate, source: 'trip_start' });
        }
      }),
      { numRuns: 100 }
    );
  });

  // Unit example from design.md
  it('derives correct windows for resort party arriving 2025-06-14, 5 nights, default settings', () => {
    const input: TimelineTripInput = {
      startDate: '2025-06-14',
      endDate: '2025-06-19', // 5 nights: stay dates 2025-06-14 to 2025-06-19
      hasResortStay: true,
      settings: null,
    };
    const timeline = deriveBookingTimeline(input);

    expect(timeline.stayType).toEqual({ value: 'resort', source: 'auto' });
    expect(timeline.lightningLaneTiming).toEqual({ value: 'seven_day', source: 'auto' });
    expect(timeline.arrival).toEqual({ value: '2025-06-14', source: 'trip_start' });

    expect(timeline.windows.length).toBe(2);

    const dining = timeline.windows.find(w => w.kind === 'dining')!;
    expect(dining.dropOn).toBe('2025-04-15');
    expect(dining.dropAt).toBe('2025-04-15T10:00:00.000Z');
    expect(dining.coveredDates).toEqual([
      '2025-06-14',
      '2025-06-15',
      '2025-06-16',
      '2025-06-17',
      '2025-06-18',
      '2025-06-19',
    ]);

    const ll = timeline.windows.find(w => w.kind === 'lightning_lane')!;
    expect(ll.dropOn).toBe('2025-06-07');
    expect(ll.dropAt).toBe('2025-06-07T11:00:00.000Z');
    expect(ll.coveredDates).toEqual(dining.coveredDates);
  });
});
