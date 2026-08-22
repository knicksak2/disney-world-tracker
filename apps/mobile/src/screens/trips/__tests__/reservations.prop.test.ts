// Feature: trip-reservations, Property 4: Reservation grouping is total, ordered, and lossless

import fc from 'fast-check';
import { RESERVATION_KINDS, type PlannedItemDTO, type ReservationKind } from '@dwt/shared';

import { groupReservationsByDate, countReservations } from '../reservations';

const NUM_RUNS = 200;

/** A small pool of dates so groups collide often enough to exercise grouping. */
const dateArb = fc.constantFrom(
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2027-01-15',
);

/** A small pool of times so ties happen often enough to exercise the tie-break. */
const timeArb = fc.constantFrom('12:00', '14:30', '18:00', '22:00');

const kindArb: fc.Arbitrary<ReservationKind | null> = fc.option(
  fc.constantFrom(...RESERVATION_KINDS),
  { nil: null },
);

const plannedItemArb: fc.Arbitrary<PlannedItemDTO> = fc
  .record({
    id: fc.uuid(),
    plannedDate: fc.option(dateArb, { nil: null }),
    time: timeArb,
    reservationKind: kindArb,
    experienceName: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
    customTitle: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
    partySize: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
    confirmationNumber: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  })
  .map(
    ({
      id,
      plannedDate,
      time,
      reservationKind,
      experienceName,
      customTitle,
      partySize,
      confirmationNumber,
    }): PlannedItemDTO => ({
      id,
      experienceId: experienceName == null ? null : 'exp-1',
      experienceName,
      park: 'Magic Kingdom',
      customTitle,
      addedByDisplayName: 'Ada',
      plannedDate,
      plannedTime: plannedDate == null ? null : `${plannedDate}T${time}:00.000Z`,
      isFixed: reservationKind != null && reservationKind !== 'lightning_lane',
      isLightningLane: reservationKind === 'lightning_lane',
      useSingleRider: false,
      priority: 2,
      itemType: experienceName == null ? 'break' : 'experience',
      durationMinutes: null,
      windowStartMinutes: null,
      windowEndMinutes: null,
      mealPeriod: null,
      scheduledShowtime: null,
      predictedWaitMinutes: null,
      travelFromPrev: null,
      optimizedAt: null,
      reservationKind,
      confirmationNumber,
      partySize,
    }),
  );

const plannedListArb = fc.array(plannedItemArb, { maxLength: 25 });

describe('Property 4: Reservation grouping is total, ordered, and lossless', () => {
  it('returns exactly the reservations that have a date, with no duplication or loss', () => {
    fc.assert(
      fc.property(plannedListArb, (items) => {
        const groups = groupReservationsByDate(items);

        const expected = items.filter(
          (i) => i.reservationKind != null && i.plannedDate != null,
        );
        const emitted = groups.flatMap((g) => [...g.items]);

        // Same multiset of ids: nothing lost, nothing duplicated, nothing invented.
        expect(countReservations(groups)).toBe(expected.length);
        expect([...emitted.map((i) => i.id)].sort()).toEqual(
          [...expected.map((i) => i.id)].sort(),
        );

        // Never emits an ordinary planned item.
        for (const item of emitted) {
          expect(item.reservationKind).not.toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits strictly ascending, distinct group dates and never an empty group', () => {
    fc.assert(
      fc.property(plannedListArb, (items) => {
        const groups = groupReservationsByDate(items);

        for (const group of groups) {
          expect(group.items.length).toBeGreaterThan(0);
        }

        const dates = groups.map((g) => g.date);
        expect(new Set(dates).size).toBe(dates.length);
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1]! < dates[i]!).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('places every item under its own plannedDate', () => {
    fc.assert(
      fc.property(plannedListArb, (items) => {
        for (const group of groupReservationsByDate(items)) {
          for (const item of group.items) {
            expect(item.plannedDate).toBe(group.date);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('orders each group non-descending by Booked_Time with a stable id tie-break', () => {
    fc.assert(
      fc.property(plannedListArb, (items) => {
        for (const group of groupReservationsByDate(items)) {
          for (let i = 1; i < group.items.length; i++) {
            const prev = group.items[i - 1]!;
            const curr = group.items[i]!;
            const prevMs = Date.parse(prev.plannedTime!);
            const currMs = Date.parse(curr.plannedTime!);
            expect(prevMs).toBeLessThanOrEqual(currMs);
            // Equal times fall back to ascending id, giving a total order.
            if (prevMs === currMs) {
              expect(prev.id < curr.id).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: the same input yields an identical result', () => {
    fc.assert(
      fc.property(plannedListArb, (items) => {
        expect(groupReservationsByDate(items)).toEqual(groupReservationsByDate(items));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is order-insensitive: shuffling the input yields the same grouping', () => {
    fc.assert(
      fc.property(plannedListArb, fc.integer({ min: 0, max: 1000 }), (items, seed) => {
        // A deterministic rotation is enough to prove the output does not depend
        // on input order, without needing a second shuffled generator.
        const rotation = items.length === 0 ? 0 : seed % items.length;
        const rotated = [...items.slice(rotation), ...items.slice(0, rotation)];
        expect(groupReservationsByDate(rotated)).toEqual(groupReservationsByDate(items));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
